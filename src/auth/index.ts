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
import { verifySession } from "@ai4u/mc-sso"
import { ForbiddenError, UnauthorizedError } from "../errors"
import { safeEqual } from "../security"

export interface Identity {
  tenantId: string
  userId?: string
  roles?: string[]
  allowedModules?: string[] | null
  displayName?: string
}

/** Forma extendida de la sesión (mc-sso lleva estos campos opcionales tras el handoff). */
interface ExtendedSession {
  tenantId: string
  userId?: string
  roles?: string[]
  allowedModules?: string[] | null
  displayName?: string
}

export interface SessionAuthConfig {
  /** Nombre de la cookie de sesión (default "mc_session"). */
  cookieName?: string
  /** Secreto de firma (default process.env.MISSION_CONTROL_SECRET). */
  secret?: string
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
  const data = verifySession(token, secret) as ExtendedSession | null
  if (!data) return null
  return {
    tenantId: data.tenantId,
    userId: data.userId,
    roles: data.roles,
    allowedModules: data.allowedModules ?? null,
    displayName: data.displayName,
  }
}

/* ── Permisos (misma regla que access.ts) ────────────────────────────────── */

export function isModuleAllowed(moduleId: string, allowedModules: string[] | null | undefined): boolean {
  if (!allowedModules || allowedModules.length === 0) return true
  return allowedModules.includes(moduleId)
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
export function requireModule(identity: Identity | null, moduleId: string | string[]): Identity {
  if (!identity) throw new UnauthorizedError()
  const ids = Array.isArray(moduleId) ? moduleId : [moduleId]
  if (!ids.some((id) => isModuleAllowed(id, identity.allowedModules))) {
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
