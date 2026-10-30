"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureIdentity = configureIdentity;
exports.readIdentity = readIdentity;
exports.isModuleAllowed = isModuleAllowed;
exports.isModuleAllowedStrict = isModuleAllowedStrict;
exports.hasRole = hasRole;
exports.isAdmin = isAdmin;
exports.requireModule = requireModule;
exports.requireRole = requireRole;
exports.verifyServiceRequest = verifyServiceRequest;
/**
 * Auth uniforme para todo el ecosistema: identidad + permisos.
 *
 * Dos modos:
 *   1. Sesión de usuario (apps con SSO): readIdentity() lee la cookie de sesión,
 *      la verifica con @ai4u/mc-sso y devuelve { tenantId, userId, roles,
 *      allowedModules }. Los permisos viajan EMBEBIDOS en el mc-token desde el
 *      handoff de Mission Control, así ninguna app necesita tocar la BD.
 *   2. Servicio↔servicio (backends): verifyServiceRequest() unifica los tres
 *      esquemas actuales (x-mc-secret compartido / X-API-Key por tenant).
 *
 * La regla de visibilidad de módulos es la misma de mission-control-main/lib/access.ts:
 * sin lista (null/[]) ⇒ ve todo; con lista ⇒ solo esos ids. Existe además el modo estricto
 * (`requireModule(..., { strict: true })` / `isModuleAllowedStrict`): sin lista ⇒ ninguno.
 */
const mc_sso_1 = require("@ai4u/mc-sso");
const errors_1 = require("../errors");
const logger_1 = require("../logger");
const security_1 = require("../security");
const STATE_KEY = Symbol.for("@ai4u/platform/identity");
function state() {
    const g = globalThis;
    return (g[STATE_KEY] ?? (g[STATE_KEY] = { scope: {}, warned: false }));
}
/**
 * Fija el alcance de identidad por defecto de ESTA app (una vez, p. ej. en instrumentation.ts o
 * en un módulo de config). Las opciones pasadas a `readIdentity`/`withApiHandler({sessionAuth})`
 * lo pisan campo a campo. No se deriva nada de `SERVICE_ID`: puede no coincidir con el serviceId
 * de su handler SSO y cortaría sesiones válidas.
 */
function configureIdentity(scope) {
    state().scope = { ...scope };
}
/**
 * Parsea el header Cookie. Nunca lanza: una cookie con percent-encoding inválido
 * (p.ej. `%E0%A4%A`, que hace lanzar URIError a decodeURIComponent) se IGNORA y se
 * siguen leyendo las demás — mismo criterio que el parser de cookies de Next
 * (@edge-runtime/cookies). Se ignora en vez de usar el valor crudo para que un
 * duplicado basura (`mc_session=<válido>; mc_session=%E0`) no pise al valor válido
 * y para no entregar nunca un valor que no es el que el servidor escribió.
 * Antes, una sola cookie así hacía lanzar a readIdentity → 500 en withApiHandler.
 */
function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(";")) {
        const i = part.indexOf("=");
        if (i === -1)
            continue;
        try {
            out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
        }
        catch {
            // Cookie mal codificada: se ignora (ver doc arriba).
        }
    }
    return out;
}
/** Lee y verifica la identidad del usuario desde la cookie de sesión. null si no hay/no es válida. */
function readIdentity(req, cfg = {}) {
    const cookieName = cfg.cookieName ?? "mc_session";
    const secret = cfg.secret ?? process.env.MISSION_CONTROL_SECRET;
    if (!secret)
        return null;
    const token = parseCookies(req.headers.get("cookie"))[cookieName];
    if (!token)
        return null;
    const appScope = state().scope;
    const scope = {
        serviceId: cfg.serviceId ?? appScope.serviceId,
        allowedTenants: cfg.allowedTenants ?? appScope.allowedTenants,
        normalizeTenant: cfg.normalizeTenant ?? appScope.normalizeTenant,
        acceptLegacy: cfg.acceptLegacy ?? appScope.acceptLegacy,
    };
    if (scope.serviceId === undefined && !state().warned) {
        state().warned = true;
        (0, logger_1.getLogger)("platform/auth").warn("readIdentity sin serviceId configurado: una sesión firmada para otra app con el mismo secreto sería aceptada. " +
            "Pasa { serviceId } a readIdentity/sessionAuth o llama configureIdentity({ serviceId }) (platform 0.8.0).");
    }
    // Se reenvía solo el token ya parseado (parseCookies ignora duplicados mal codificados) y mc-sso
    // aplica firma, expiración y las restricciones de app/tenant.
    const data = (0, mc_sso_1.readMcSession)(`${cookieName}=${encodeURIComponent(token)}`, secret, { cookieName, ...scope });
    if (!data)
        return null;
    return {
        tenantId: data.tenantId,
        userId: data.userId,
        roles: data.roles,
        allowedModules: data.allowedModules ?? null,
        displayName: data.displayName,
        serviceId: data.serviceId,
    };
}
/* ── Permisos (misma regla que access.ts) ────────────────────────────────── */
function isModuleAllowed(moduleId, allowedModules) {
    if (!allowedModules || allowedModules.length === 0)
        return true;
    return allowedModules.includes(moduleId);
}
/**
 * Variante ESTRICTA: sin lista (null/undefined/[]) => NINGÚN módulo. Úsala en apps que no son
 * Mission Control, donde una sesión sin `allowedModules` no debería ver todo.
 */
function isModuleAllowedStrict(moduleId, allowedModules) {
    return Array.isArray(allowedModules) && allowedModules.includes(moduleId);
}
function hasRole(identity, role) {
    return !!identity?.roles?.includes(role);
}
function isAdmin(identity) {
    return hasRole(identity, "admin");
}
/**
 * Exige identidad y acceso a un módulo (acepta varios: any-of). Lanza errores
 * tipados que el wrapper HTTP convierte en 401/403 uniformes.
 */
function requireModule(identity, moduleId, opts = {}) {
    if (!identity)
        throw new errors_1.UnauthorizedError();
    const ids = Array.isArray(moduleId) ? moduleId : [moduleId];
    const allowed = opts.strict ? isModuleAllowedStrict : isModuleAllowed;
    if (!ids.some((id) => allowed(id, identity.allowedModules))) {
        throw new errors_1.ForbiddenError("No autorizado para este módulo");
    }
    return identity;
}
function requireRole(identity, role) {
    if (!identity)
        throw new errors_1.UnauthorizedError();
    const roles = Array.isArray(role) ? role : [role];
    if (!roles.some((r) => hasRole(identity, r))) {
        throw new errors_1.ForbiddenError("Rol insuficiente");
    }
    return identity;
}
/** Valida auth de servicio (x-mc-secret o X-API-Key). Compara con `safeEqual` (SHA-256 + timingSafeEqual). */
function verifyServiceRequest(req, cfg = {}) {
    const sharedSecret = cfg.sharedSecret ?? process.env.MISSION_CONTROL_SECRET;
    const candidates = [sharedSecret, ...(cfg.sharedSecrets ?? [])].filter((s) => typeof s === "string" && s.length > 0);
    const mcSecret = req.headers.get("x-mc-secret");
    if (mcSecret && candidates.some((candidate) => (0, security_1.safeEqual)(mcSecret, candidate)))
        return { ok: true };
    const apiKey = req.headers.get("x-api-key");
    if (apiKey && cfg.apiKeys) {
        for (const [tenantId, key] of Object.entries(cfg.apiKeys)) {
            if (key && (0, security_1.safeEqual)(apiKey, key))
                return { ok: true, tenantId };
        }
    }
    return { ok: false };
}
