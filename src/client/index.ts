/**
 * Reporte de errores del NAVEGADOR hacia `platform_logs` (vía la ruta servidor creada con
 * `createClientErrorHandler` de `@ai4u/platform/client-errors`).
 *
 * Este módulo NO importa el logger (que usa node:async_hooks): es seguro en un bundle de cliente.
 *
 *   "use client"
 *   import { installClientErrorReporter } from "@ai4u/platform/client"
 *   useEffect(() => { installClientErrorReporter({ service: "mi-app" }) }, [])
 *
 * Privacidad: solo viaja `location.pathname` (nunca querystring ni hash), mensaje y stack truncados.
 * Sin cookies, sin cuerpo de formularios, sin user agent propio.
 */

export const DEFAULT_CLIENT_ERROR_ENDPOINT = "/api/client-error"
export const CLIENT_ERROR_MAX_MESSAGE = 2000
export const CLIENT_ERROR_MAX_STACK = 4000
/** Máximo de reportes por sesión de página (por carga del bundle). */
export const CLIENT_ERROR_MAX_PER_SESSION = 5
/** Ventana de deduplicación de la misma firma. */
export const CLIENT_ERROR_DEDUPE_MS = 60_000

export type ClientErrorKind = "error" | "unhandledrejection" | "manual"

export interface ClientErrorPayload {
  message: string
  stack?: string
  name?: string
  kind: ClientErrorKind
  path: string
  service?: string
  extra?: Record<string, string | number | boolean>
}

export interface ClientErrorReporterOptions {
  /** Ruta servidor que recibe el reporte (default "/api/client-error"). */
  endpoint?: string
  /** Nombre del servicio/app para filtrar en el panel. */
  service?: string
}

let endpoint = DEFAULT_CLIENT_ERROR_ENDPOINT
let service: string | undefined
let installed = false
let sentCount = 0
const seen = new Map<string, number>()

/** Solo para tests: reinicia el estado del módulo. */
export function __resetClientErrorReporter(): void {
  endpoint = DEFAULT_CLIENT_ERROR_ENDPOINT
  service = undefined
  installed = false
  sentCount = 0
  seen.clear()
}

function currentPath(): string {
  try {
    return (globalThis as { location?: { pathname?: string } }).location?.pathname ?? "/"
  } catch {
    return "/"
  }
}

function normalize(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack, name: err.name }
  if (typeof err === "string") return { message: err }
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; stack?: unknown; name?: unknown }
    if (typeof o.message === "string") {
      return {
        message: o.message,
        stack: typeof o.stack === "string" ? o.stack : undefined,
        name: typeof o.name === "string" ? o.name : undefined,
      }
    }
  }
  try {
    return { message: JSON.stringify(err) ?? String(err) }
  } catch {
    return { message: String(err) }
  }
}

function transmit(payload: ClientErrorPayload): void {
  const body = JSON.stringify(payload)
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator
    if (nav && typeof nav.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" })
      if (nav.sendBeacon(endpoint, blob)) return
    }
  } catch {
    // cae al fetch
  }
  try {
    if (typeof fetch === "function") {
      void fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {})
    }
  } catch {
    // reportar nunca debe lanzar
  }
}

/**
 * Reporta un error manualmente (p. ej. desde `error.tsx` / `global-error.tsx`).
 * Aplica deduplicación (misma firma en 60 s) y el tope de reportes por sesión.
 * Devuelve true si se envió.
 */
export function reportClientError(
  error: unknown,
  extra?: Record<string, string | number | boolean | null | undefined>,
  kind: ClientErrorKind = "manual",
): boolean {
  try {
    if (sentCount >= CLIENT_ERROR_MAX_PER_SESSION) return false
    const n = normalize(error)
    const path = currentPath()
    const message = n.message.slice(0, CLIENT_ERROR_MAX_MESSAGE)
    const stack = n.stack?.slice(0, CLIENT_ERROR_MAX_STACK)
    // Firma: tipo + mensaje + primera línea del stack con frame + ruta.
    const sig = `${kind}|${message}|${stack?.split("\n")[1] ?? ""}|${path}`
    const now = Date.now()
    const prev = seen.get(sig)
    if (prev !== undefined && now - prev < CLIENT_ERROR_DEDUPE_MS) return false
    seen.set(sig, now)
    if (seen.size > 50) {
      for (const [k, t] of seen) if (now - t >= CLIENT_ERROR_DEDUPE_MS) seen.delete(k)
    }
    sentCount++

    const payload: ClientErrorPayload = { message, kind, path }
    if (stack) payload.stack = stack
    if (n.name) payload.name = n.name.slice(0, 100)
    if (service) payload.service = service
    if (extra) {
      const clean: Record<string, string | number | boolean> = {}
      for (const [k, v] of Object.entries(extra).slice(0, 10)) {
        if (typeof v === "string") clean[k] = v.slice(0, 200)
        else if (typeof v === "number" || typeof v === "boolean") clean[k] = v
      }
      if (Object.keys(clean).length) payload.extra = clean
    }
    transmit(payload)
    return true
  } catch {
    return false
  }
}

function isNoise(message: string): boolean {
  // "Script error." = error de otro origen sin detalle; ResizeObserver = ruido benigno del navegador.
  return message === "Script error." || message.startsWith("ResizeObserver loop")
}

/**
 * Instala los listeners globales `error` y `unhandledrejection`. Idempotente: llamarla de nuevo
 * (p. ej. en un efecto que se re-ejecuta) solo actualiza endpoint/service, no duplica listeners.
 * Usa addEventListener (no pisa un `window.onerror` existente).
 */
export function installClientErrorReporter(options: ClientErrorReporterOptions = {}): void {
  if (options.endpoint) endpoint = options.endpoint
  if (options.service) service = options.service
  if (installed) return
  const w = (globalThis as { window?: Window }).window
  if (!w || typeof w.addEventListener !== "function") return
  installed = true

  w.addEventListener("error", (event: ErrorEvent) => {
    // Errores de carga de recursos (img/script) llegan con target distinto de window: se ignoran.
    if (event.target && event.target !== w) return
    const err = event.error ?? event.message
    const msg = normalize(err).message
    if (isNoise(msg)) return
    reportClientError(err, undefined, "error")
  })
  w.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, undefined, "unhandledrejection")
  })
}
