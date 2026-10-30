/**
 * Wrapper para crons y trabajos en segundo plano.
 *
 *   const result = await runJob("sync-clientes", async (log) => syncClientes())
 *
 * - Abre un contexto (requestId + job) que heredan todos los logs de `fn`.
 * - Registra inicio y fin con duración.
 * - Si `fn` lanza: `log.error({ err, job })` y relanza (o devuelve undefined con `rethrow: false`).
 * - Si `fn` devuelve un resultado con `errors`/`errores` > 0 (número o array): `log.error` con el
 *   resumen, SIN alterar lo devuelto (el cron puede seguir respondiendo 200).
 * - SIEMPRE `await flushLogs()` en `finally` (serverless congela la función al responder).
 */
import { getLogger, newRequestId, runWithContext, flushLogs, type Logger } from "../logger"

export interface RunJobOptions {
  /** Logger a usar; por defecto `getLogger("job")`. */
  log?: Logger
  /** Relanzar la excepción tras registrarla (default true). */
  rethrow?: boolean
  /** Tenant del trabajo, si aplica (se agrega al contexto del log). */
  tenant?: string
}

function errorCount(result: unknown): { count: number; key: string } | null {
  if (!result || typeof result !== "object") return null
  const r = result as Record<string, unknown>
  for (const key of ["errors", "errores"]) {
    const v = r[key]
    if (typeof v === "number" && v > 0) return { count: v, key }
    if (Array.isArray(v) && v.length > 0) return { count: v.length, key }
  }
  return null
}

/** Resumen seguro: campos escalares del resultado + hasta 3 muestras de errores (truncadas). */
function summarize(result: object, key: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v
  }
  const list = (result as Record<string, unknown>)[key]
  if (Array.isArray(list)) {
    out.sample = list.slice(0, 3).map((e) => (e instanceof Error ? e.message : String(e)).slice(0, 200))
  }
  return out
}

export async function runJob<R>(
  name: string,
  fn: (log: Logger) => Promise<R> | R,
  options: RunJobOptions & { rethrow: false },
): Promise<R | undefined>
export async function runJob<R>(
  name: string,
  fn: (log: Logger) => Promise<R> | R,
  options?: RunJobOptions & { rethrow?: true },
): Promise<R>
export async function runJob<R>(
  name: string,
  fn: (log: Logger) => Promise<R> | R,
  options: RunJobOptions = {},
): Promise<R | undefined> {
  const log = options.log ?? getLogger("job")
  const rethrow = options.rethrow ?? true
  const ctx: Record<string, unknown> = { requestId: newRequestId(), job: name }
  if (options.tenant) ctx.tenant = options.tenant

  return runWithContext(ctx, async () => {
    const start = Date.now()
    try {
      log.info({ job: name }, `job ${name}: inicio`)
      const result = await fn(log)
      const durationMs = Date.now() - start
      const failed = errorCount(result)
      if (failed) {
        log.error(
          { job: name, durationMs, errorCount: failed.count, ...summarize(result as object, failed.key) },
          `job ${name}: terminó con errores`,
        )
      } else {
        log.info({ job: name, durationMs }, `job ${name}: fin`)
      }
      return result
    } catch (err) {
      log.error({ err, job: name, durationMs: Date.now() - start }, `job ${name}: falló`)
      if (rethrow) throw err
      return undefined
    } finally {
      await flushLogs()
    }
  })
}
