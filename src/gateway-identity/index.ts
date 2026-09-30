/**
 * Identidad servicio-a-servicio hacia sap-b1-backend (Fase 3, OIDC de Vercel).
 *
 * Cada llamada al gateway adjunta el token OIDC del deployment, intercambiado por
 * uno con `aud` propia del gateway, en el header `x-ai4u-identity`. Hoy el gateway
 * solo lo VERIFICA Y REGISTRA (modo observación): la auth real sigue siendo
 * `x-mc-secret` / `X-API-Key`, que no se tocan.
 *
 * Subpath aparte a propósito (`@ai4u/platform/gateway-identity`, fuera del barrel
 * raíz): solo las apps que lo importan cargan `@vercel/oidc`. Solo servidor (Node).
 *
 * Reglas:
 * - El token se pide DENTRO de cada llamada (nunca a nivel de módulo ni guardado en
 *   una variable global): vive en el contexto del request y vence; en Fluid Compute
 *   el módulo se reutiliza entre invocaciones. El único caché es el interno de
 *   `@vercel/oidc` (por token origen + audiencia, respeta el vencimiento).
 * - Fail-open: sin token (local, error del intercambio, timeout) se devuelve `{}` y
 *   la llamada sale exactamente igual que antes. Nunca lanza. Nunca se loguea el token.
 *
 * Uso:
 *   const headers = { "x-mc-secret": secret, ...(await getGatewayIdentityHeaders()) }
 */
import { getVercelOidcToken } from "@vercel/oidc"
import { getLogger } from "../logger"

export const GATEWAY_IDENTITY_HEADER = "x-ai4u-identity"
export const GATEWAY_OIDC_AUDIENCE = "https://sap-b1-backend.ai4u"
/** Tope por defecto al intercambio de audiencia: no sumar latencia perceptible a cada llamada. */
export const GATEWAY_IDENTITY_TIMEOUT_MS = 1500

/** Logger mínimo aceptado (el `Logger` de `@ai4u/platform/logger` lo cumple). */
export interface GatewayIdentityLogger {
  warn: (fields: Record<string, unknown>, msg: string) => void
  debug: (fields: Record<string, unknown>, msg: string) => void
}

export interface GatewayIdentityOptions {
  /** Tope al intercambio del token, en ms. Default 1500. */
  timeoutMs?: number
  /** Fuente del token (tests / runtimes especiales). Default: `getVercelOidcToken` de `@vercel/oidc`. */
  getToken?: (opts: { audience: string }) => Promise<string>
  /** Logger para el aviso de "sin token". Default: `getLogger("gateway-identity")`. */
  logger?: GatewayIdentityLogger
}

/** Evita inundar los logs si el intercambio falla en cada request (1 warn/min por instancia). */
const WARN_EVERY_MS = 60_000
let lastWarnAt = 0

const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g

function reportMissing(logger: GatewayIdentityLogger | undefined, reason: string, err?: unknown): void {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : err === undefined ? undefined : String(err)
  const fields = {
    reason,
    // Por si algún mensaje de error trajera un JWT embebido: nunca registrarlo.
    ...(detail ? { detail: detail.replace(JWT_RE, "[redacted]").slice(0, 300) } : {}),
  }
  const msg = "sin token OIDC para sap-b1-backend; la llamada sigue sin x-ai4u-identity"
  try {
    const log = logger ?? getLogger("gateway-identity")
    // Fuera de Vercel (local/CI) es lo esperado: solo debug. En Vercel es una anomalía.
    const now = Date.now()
    if (process.env.VERCEL && now - lastWarnAt >= WARN_EVERY_MS) {
      lastWarnAt = now
      log.warn(fields, msg)
    } else {
      log.debug(fields, msg)
    }
  } catch {
    // Un logger roto nunca debe romper la llamada al gateway (fail-open).
  }
}

/**
 * Headers de identidad para el gateway: `{ "x-ai4u-identity": <token> }` o `{}`.
 * Nunca lanza.
 */
export async function getGatewayIdentityHeaders(opts: GatewayIdentityOptions = {}): Promise<Record<string, string>> {
  const timeoutMs = opts.timeoutMs ?? GATEWAY_IDENTITY_TIMEOUT_MS
  const getToken = opts.getToken ?? getVercelOidcToken
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    const token = await Promise.race([getToken({ audience: GATEWAY_OIDC_AUDIENCE }), timeout])
    if (token === null) {
      reportMissing(opts.logger, "timeout")
      return {}
    }
    if (typeof token !== "string" || !token) {
      reportMissing(opts.logger, "empty")
      return {}
    }
    return { [GATEWAY_IDENTITY_HEADER]: token }
  } catch (err) {
    reportMissing(opts.logger, "error", err)
    return {}
  } finally {
    if (timer) clearTimeout(timer)
  }
}
