/**
 * Hook `onRequestError` de Next.js (15/16) listo para re-exportar desde `instrumentation.ts`:
 *
 *   export { onRequestError } from "@ai4u/platform/instrumentation"
 *
 * Next lo invoca cuando falla un render de servidor, un route handler, una server action o el
 * proxy/middleware, incluso errores que ninguna ruta envuelta con `withApiHandler` ve (p. ej. un
 * fallo de render de una página RSC). Registra a nivel ERROR y espera el flush al ingest.
 *
 * Seguridad: NUNCA se registran headers, cookies ni cuerpo de la petición. De `request.path` se
 * descarta el querystring (puede llevar tokens). Solo corre en el runtime Node (el logger usa
 * node:async_hooks): en Edge es un no-op.
 *
 * Firma verificada contra next.js (packages/next/src/server/instrumentation/types.ts):
 *   (error: unknown, errorRequest: Readonly<{ path; method; headers }>, errorContext) => void | Promise<void>
 * Se declaran tipos estructurales propios para no depender de `next`.
 */

export interface OnRequestErrorRequest {
  path: string
  method: string
  // Presente en Next, pero este módulo no lo lee nunca.
  headers?: unknown
}

export interface OnRequestErrorContext {
  routerKind?: "Pages Router" | "App Router" | string
  routePath?: string
  routeType?: "render" | "route" | "action" | "proxy" | string
  renderSource?: string
  revalidateReason?: "on-demand" | "stale" | undefined | string
}

function stripQuery(path: unknown): string {
  if (typeof path !== "string") return ""
  return path.split(/[?#]/)[0].slice(0, 300)
}

function short(v: unknown, max = 200): string | undefined {
  return typeof v === "string" ? v.slice(0, max) : undefined
}

export async function onRequestError(
  err: unknown,
  request: Readonly<OnRequestErrorRequest>,
  context: Readonly<OnRequestErrorContext>,
): Promise<void> {
  // Edge no soporta el logger (node:async_hooks). Sin NEXT_RUNTIME (tests/scripts) se asume Node.
  const runtime = process.env.NEXT_RUNTIME
  if (runtime && runtime !== "nodejs") return
  try {
    // Import dinámico con specifier literal: el bundler Edge no arrastra el logger.
    const { getLogger, flushLogs } = await import("../logger")
    const digest = (err as { digest?: unknown } | null)?.digest
    const fields: Record<string, unknown> = {
      err,
      path: stripQuery(request?.path),
      method: short(request?.method, 10),
      routerKind: short(context?.routerKind),
      routeType: short(context?.routeType),
      routePath: short(context?.routePath),
      renderSource: short(context?.renderSource),
      digest: short(digest),
    }
    for (const k of Object.keys(fields)) if (fields[k] === undefined || fields[k] === "") delete fields[k]
    getLogger("next-request").error(fields, "onRequestError")
    await flushLogs()
  } catch {
    // Un fallo de observabilidad jamás debe romper ni enmascarar el error original.
  }
}
