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
import { type Logger } from "../logger";
export interface RunJobOptions {
    /** Logger a usar; por defecto `getLogger("job")`. */
    log?: Logger;
    /** Relanzar la excepción tras registrarla (default true). */
    rethrow?: boolean;
    /** Tenant del trabajo, si aplica (se agrega al contexto del log). */
    tenant?: string;
}
export declare function runJob<R>(name: string, fn: (log: Logger) => Promise<R> | R, options: RunJobOptions & {
    rethrow: false;
}): Promise<R | undefined>;
export declare function runJob<R>(name: string, fn: (log: Logger) => Promise<R> | R, options?: RunJobOptions & {
    rethrow?: true;
}): Promise<R>;
//# sourceMappingURL=index.d.ts.map