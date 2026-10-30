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
import { readMcSession } from "@ai4u/mc-sso"
import { ForbiddenError, UnauthorizedError } from "../errors"
import { getLogger } from "../logger"
import { safeEqual } from "../security"

export interface Identity {
  tenantId: string
  userId?: string
  roles?: string[]
  allowedModules?: string[] | null
  displayName?: string
  /** App para la que se emitió la sesión (mc-sso >= 1.3.0). undefined = sesión "legacy". */
  serviceId?: string
}

/**
 * Restricciones de app/tenant sobre la sesión (se pasan tal cual a `readMcSession` de mc-sso).
 * El secreto de firma se comparte entre apps: sin estas opciones una cookie de otra app/tenant
 * con firma válida PASA. Son opt-in; ver "Cómo adoptar el endurecimiento de auth" en CHANGELOG.
 */
export interface IdentityScope {
  /** `serviceId` de ESTA app (el mismo de su `createMcAuthHandler`). Sesión de otro servicio => null. */
  serviceId?: string
  /** Tenants aceptados (apps de un solo tenant). Fuera de la lista => null; `[]` rechaza todo. */
  allowedTenants?: readonly string[]
  /** Normalizador de tenant para comparar `allowedTenants` (p. ej. `normalizeTenant` de @ai4u/config). */
  normalizeTenant?: (tenantId: string) => string
  /** Aceptar sesiones sin `serviceId` (emitidas por mc-sso <= 1.2.0). Default de mc-sso: true. */
  acceptLegacy?: boolean
}

export interface SessionAuthConfig extends IdentityScope {
  /** Nombre de la cookie de sesión (default "mc_session"). */
  cookieName?: string
  /** Secreto de firma (default process.env.MISSION_CONTROL_SECRET). */
  secret?: string
}

/**
 * Estado compartido por proceso en globalThis: los bundlers (Turbopack) pueden instanciar este módulo
 * varias veces (una copia por bundle) y una variable de módulo haría que configureIdentity() en una
 * copia no lo viera otra, ni el WARN "una vez". (process.env no sirve: normalizeTenant es una función.)
 */
interface IdentityState {
  scope: IdentityScope
  warned: boolean
}
const STATE_KEY = Symbol.for("@ai4u/platform/identity")
function state(): IdentityState {
  const g = globalThis as unknown as Record<symbol, IdentityState | undefined>
  return (g[STATE_KEY] ??= { scope: {}, warned: false })
}

/**
 * Fija el alcance de identidad por defecto de ESTA app (una vez, p. ej. en instrumentation.ts o
 * en un módulo de config). Las opciones pasadas a `readIdentity`/`withApiHandler({sessionAuth})`
 * lo pisan campo a campo. No se deriva nada de `SERVICE_ID`: puede no coincidir con el serviceId
 * de su handler SSO y cortaría sesiones válidas.
 */
export function configureIdentity(scope: IdentityScope): void {
  state().scope = { ...scope }
}


type HeaderCarrier = { headers: { get(name: string): string | null } }

/**
 * Parsea el header Cookie. Nunca lanza: una cookie con percent-encoding inválido
 * (p.ej. `%E0%A4%A`, que hace lanzar URIError a decodeURIComponent) se IGNORA y se
 * siguen leyendo las demás — mismo criterio que el parser de cookies de Next
 * (@edge-runtime/cookies). Se ignora en vez de usar el valor crudo para que un
 * duplicado basura (`mc_session=<válido>; mc_session=%E0`) no pise al valor válido
 * y para no entregar nunca un valor que no es el que el servidor escribió.
 * Antes, una sola cookie así hacía lanzar a readIdentity → 500 en withApiHandler.
 */
function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(";")) {
    const i = part.indexOf("=")
    if (i === -1) continue
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      // Cookie mal codificada: se ignora (ver doc arriba).
    }
  }
  return out
}

/** Lee y verifica la identidad del usuario desde la cookie de sesión. null si no hay/no es válida. */
export function readIdentity(req: HeaderCarrier, cfg: SessionAuthConfig = {}): Identity | null {
  const cookieName = cfg.cookieName ?? "mc_session"
  const secret = cfg.secret ?? process.env.MISSION_CONTROL_SECRET
  if (!secret) return null
  const token = parseCookies(req.headers.get("cookie"))[cookieName]
  if (!token) return null
  const appScope = state().scope
  const scope: IdentityScope = {
    serviceId: cfg.serviceId ?? appScope.serviceId,
    allowedTenants: cfg.allowedTenants ?? appScope.allowedTenants,
    normalizeTenant: cfg.normalizeTenant ?? appScope.normalizeTenant,
    acceptLegacy: cfg.acceptLegacy ?? appScope.acceptLegacy,
  }
  if (scope.serviceId === undefined && !state().warned) {
    state().warned = true
    getLogger("platform/auth").warn(
      "readIdentity sin serviceId configurado: una sesión firmada para otra app con el mismo secreto sería aceptada. " +
        "Pasa { serviceId } a readIdentity/sessionAuth o llama configureIdentity({ serviceId }) (platform 0.8.0).",
    )
  }
  // Se reenvía solo el token ya parseado (parseCookies ignora duplicados mal codificados) y mc-sso
  // aplica firma, expiración y las restricciones de app/tenant.
  const data = readMcSession(`${cookieName}=${encodeURIComponent(token)}`, secret, { cookieName, ...scope })
  if (!data) return null
  return {
    tenantId: data.tenantId,
    userId: data.userId,
    roles: data.roles,
    allowedModules: data.allowedModules ?? null,
    displayName: data.displayName,
    serviceId: data.serviceId,
  }
}

/* ── Permisos (misma regla que access.ts) ────────────────────────────────── */

export function isModuleAllowed(moduleId: string, allowedModules: string[] | null | undefined): boolean {
  if (!allowedModules || allowedModules.length === 0) return true
  return allowedModules.includes(moduleId)
}

/**
 * Variante ESTRICTA: sin lista (null/undefined/[]) => NINGÚN módulo. Úsala en apps que no son
 * Mission Control, donde una sesión sin `allowedModules` no debería ver todo.
 */
export function isModuleAllowedStrict(moduleId: string, allowedModules: string[] | null | undefined): boolean {
  return Array.isArray(allowedModules) && allowedModules.includes(moduleId)
}

export function hasRole(identity: Identity | null, role: string): boolean {
  return !!identity?.roles?.includes(role)
}

export function isAdmin(identity: Identity | null): boolean {
  return hasRole(identity, "admin")
}

/**
 * Exige identidad y acceso a un módulo (acepta varios: any-of). Lanza errores
 * tipados que el wrapper HTTP convierte en 401/403 uniformes.
 */
export function requireModule(
  identity: Identity | null,
  moduleId: string | string[],
  opts: { strict?: boolean } = {},
): Identity {
  if (!identity) throw new UnauthorizedError()
  const ids = Array.isArray(moduleId) ? moduleId : [moduleId]
  const allowed = opts.strict ? isModuleAllowedStrict : isModuleAllowed
  if (!ids.some((id) => allowed(id, identity.allowedModules))) {
    throw new ForbiddenError("No autorizado para este módulo")
  }
  return identity
}

export function requireRole(identity: Identity | null, role: string | string[]): Identity {
  if (!identity) throw new UnauthorizedError()
  const roles = Array.isArray(role) ? role : [role]
  if (!roles.some((r) => hasRole(identity, r))) {
    throw new ForbiddenError("Rol insuficiente")
  }
  return identity
}

/* ── Servicio ↔ servicio ─────────────────────────────────────────────────── */

export interface ServiceAuthConfig {
  /** Secreto compartido aceptado en x-mc-secret (default process.env.MISSION_CONTROL_SECRET). */
  sharedSecret?: string
  /**
   * Secretos adicionales aceptados en x-mc-secret, además de `sharedSecret`.
   * Permite rotar sin downtime: durante la migración, el caller pasa el valor
   * viejo Y el nuevo aquí, y ambos autentican hasta que se retire el viejo.
   */
  sharedSecrets?: string[]
  /** API keys válidas por tenant: { tamaprint: "key...", flexoimpresos: "key..." }. */
  apiKeys?: Record<string, string>
}

export interface ServiceAuthResult {
  ok: boolean
  /** tenant resuelto cuando la auth fue por X-API-Key por tenant. */
  tenantId?: string
}

/** Valida auth de servicio (x-mc-secret o X-API-Key). Compara con `safeEqual` (SHA-256 + timingSafeEqual). */
export function verifyServiceRequest(req: HeaderCarrier, cfg: ServiceAuthConfig = {}): ServiceAuthResult {
  const sharedSecret = cfg.sharedSecret ?? process.env.MISSION_CONTROL_SECRET
  const candidates = [sharedSecret, ...(cfg.sharedSecrets ?? [])].filter(
    (s): s is string => typeof s === "string" && s.length > 0
  )
  const mcSecret = req.headers.get("x-mc-secret")
  if (mcSecret && candidates.some((candidate) => safeEqual(mcSecret, candidate))) return { ok: true }

  const apiKey = req.headers.get("x-api-key")
  if (apiKey && cfg.apiKeys) {
    for (const [tenantId, key] of Object.entries(cfg.apiKeys)) {
      if (key && safeEqual(apiKey, key)) return { ok: true, tenantId }
    }
  }
  return { ok: false }
}
