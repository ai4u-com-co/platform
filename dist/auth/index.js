"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readIdentity = readIdentity;
exports.isModuleAllowed = isModuleAllowed;
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
 * sin lista (null/[]) ⇒ ve todo; con lista ⇒ solo esos ids.
 */
const mc_sso_1 = require("@ai4u/mc-sso");
const errors_1 = require("../errors");
const security_1 = require("../security");
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
    const data = (0, mc_sso_1.verifySession)(token, secret);
    if (!data)
        return null;
    return {
        tenantId: data.tenantId,
        userId: data.userId,
        roles: data.roles,
        allowedModules: data.allowedModules ?? null,
        displayName: data.displayName,
    };
}
/* ── Permisos (misma regla que access.ts) ────────────────────────────────── */
function isModuleAllowed(moduleId, allowedModules) {
    if (!allowedModules || allowedModules.length === 0)
        return true;
    return allowedModules.includes(moduleId);
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
function requireModule(identity, moduleId) {
    if (!identity)
        throw new errors_1.UnauthorizedError();
    const ids = Array.isArray(moduleId) ? moduleId : [moduleId];
    if (!ids.some((id) => isModuleAllowed(id, identity.allowedModules))) {
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
