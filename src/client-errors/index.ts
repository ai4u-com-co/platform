/**
 * Receptor servidor de los errores reportados por `@ai4u/platform/client`.
 *
 *   // app/api/client-error/route.ts
 *   import { createClientErrorHandler } from "@ai4u/platform/client-errors"
 *   export const POST = createClientErrorHandler()
 *
 * ⚠ Es un endpoint SIN AUTENTICACIÓN (el navegador del visitante no tiene credenciales de servicio).
 *   Riesgo: cualquiera puede intentar llenar platform_logs de basura. Mitigaciones incluidas:
 *   solo application/json, tope de tamaño (413), mismo origen (Origin/Sec-Fetch-Site, 403), límite
 *   por IP en memoria (429), validación estricta de forma y truncado de campos, y respuesta 204 sin
 *   eco. El límite por IP es de MEJOR ESFUERZO: en serverless cada instancia tiene su propio Map
 *   y se reinicia en cold start; no sustituye a un WAF/rate-limit de plataforma. El origen se
 *   comprueba por cabeceras que un cliente no-navegador puede falsificar: sirve contra abuso
 *   cross-site desde navegadores, no contra un atacante dedicado.
 *
 * Los campos recibidos son DATOS NO CONFIABLES: se registran como datos (con saneado de caracteres
 * de control), nunca se interpretan como instrucciones ni pueden fijar nivel, servicio ni component
 * del log (el handler siempre registra level=ERROR, component="client").
 */
import { getLogger, newRequestId, runWithContext, flushLogs } from "../logger"

export interface ClientErrorHandlerOptions {
  /** Tamaño máximo del cuerpo en bytes (default 8192). */
  maxBytes?: number
  /** Reportes máximos por IP por minuto (default 20). */
  maxPerMinute?: number
}

const MAX_MESSAGE = 2000
const MAX_STACK = 4000
const WINDOW_MS = 60_000
const KINDS = ["error", "unhandledrejection", "manual"] as const
const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i

interface ValidPayload {
  message: string
  stack?: string
  name?: string
  kind: (typeof KINDS)[number]
  path: string
  service?: string
  extra?: Record<string, string | number | boolean>
}

/** Quita caracteres de control (conserva \n y \t) y trunca. */
function clean(v: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max)
}

function validate(raw: unknown): ValidPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.message !== "string" || o.message.length === 0) return null
  if (o.stack !== undefined && typeof o.stack !== "string") return null
  if (o.name !== undefined && typeof o.name !== "string") return null
  if (o.service !== undefined && typeof o.service !== "string") return null
  if (typeof o.path !== "string") return null
  if (!KINDS.includes(o.kind as (typeof KINDS)[number])) return null
  if (o.extra !== undefined && (typeof o.extra !== "object" || o.extra === null || Array.isArray(o.extra))) return null

  const out: ValidPayload = {
    message: clean(o.message, MAX_MESSAGE),
    kind: o.kind as ValidPayload["kind"],
    // Solo pathname: descarta querystring/hash aunque el cliente los mande.
    path: clean(o.path.split(/[?#]/)[0], 200),
  }
  if (typeof o.stack === "string") out.stack = clean(o.stack, MAX_STACK)
  if (typeof o.name === "string") out.name = clean(o.name, 100)
  if (typeof o.service === "string") out.service = clean(o.service, 80)
  if (o.extra) {
    const extra: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(o.extra as Record<string, unknown>).slice(0, 10)) {
      if (!/^[\w.-]{1,40}$/.test(k) || SENSITIVE_KEY.test(k)) continue
      if (typeof v === "string") extra[k] = clean(v, 200)
      else if (typeof v === "number" && Number.isFinite(v)) extra[k] = v
      else if (typeof v === "boolean") extra[k] = v
    }
    if (Object.keys(extra).length) out.extra = extra
  }
  return out
}

function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin") return false
  const origin = req.headers.get("origin")
  if (origin) {
    let originHost: string
    try {
      originHost = new URL(origin).host
    } catch {
      return false
    }
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host
    return originHost === host.split(",")[0].trim()
  }
  // Sin Origin: solo vale si el navegador declaró same-origin vía Sec-Fetch-Site.
  return site === "same-origin"
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim() || "unknown"
  return req.headers.get("x-real-ip") ?? "unknown"
}

const empty = (status: number) => new Response(null, { status })

export function createClientErrorHandler(options: ClientErrorHandlerOptions = {}): (req: Request) => Promise<Response> {
  const maxBytes = options.maxBytes ?? 8_192
  const maxPerMinute = options.maxPerMinute ?? 20
  const hits = new Map<string, { count: number; reset: number }>()

  function limited(ip: string): boolean {
    const now = Date.now()
    if (hits.size > 1000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
    const h = hits.get(ip)
    if (!h || h.reset <= now) {
      hits.set(ip, { count: 1, reset: now + WINDOW_MS })
      return false
    }
    h.count++
    return h.count > maxPerMinute
  }

  return async function POST(req: Request): Promise<Response> {
    if (req.method !== "POST") return empty(405)
    const ctype = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
    if (ctype !== "application/json") return empty(415)
    if (!sameOrigin(req)) return empty(403)
    if (limited(clientIp(req))) return empty(429)

    const declared = Number(req.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > maxBytes) return empty(413)
    let text: string
    try {
      text = await req.text()
    } catch {
      return empty(400)
    }
    if (new TextEncoder().encode(text).length > maxBytes) return empty(413)

    let payload: ValidPayload | null
    try {
      payload = validate(JSON.parse(text))
    } catch {
      payload = null
    }
    if (!payload) return empty(400)

    await runWithContext({ requestId: newRequestId() }, async () => {
      const err = new Error(payload.message)
      err.name = payload.name || "ClientError"
      err.stack = payload.stack ?? `${err.name}: ${payload.message}`
      getLogger("client").error(
        {
          err,
          category: "client",
          kind: payload.kind,
          path: payload.path,
          clientService: payload.service,
          clientExtra: payload.extra,
        },
        `client error: ${payload.message.replace(/\s+/g, " ").slice(0, 200)}`,
      )
      await flushLogs()
    })
    return empty(204)
  }
}
