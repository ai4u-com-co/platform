"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withApiHandler = withApiHandler;
/**
 * Wrapper uniforme para route handlers (Next App Router / Web Fetch).
 *
 * Generaliza withCapability de sap-b1-backend para CUALQUIER ruta:
 *   - Genera/propaga x-request-id (trazabilidad entre capas y servicios).
 *   - Abre el run-context del logger (requestId/tenant/userId/service heredados).
 *   - Aplica auth opcional (módulo / rol / servicio) antes del handler.
 *   - Mide duración, captura TODA excepción, la clasifica, la loguea y responde
 *     un JSON uniforme { error, code, category, requestId }. Nada de fallos silenciosos.
 *
 * Tipa contra Request/Response estándar de la Web (los route handlers de Next los
 * soportan), por lo que el paquete no depende de `next` ni de `@vercel/*` —
 * el flush de logs se espera de forma bloqueante antes de responder (ver
 * scheduleFlush más abajo), agnóstico de runtime.
 */
const logger_1 = require("../logger");
const errors_1 = require("../errors");
/**
 * Garantiza el envío de logs ANTES de responder: `await flushLogs()` directo.
 * Agrega la latencia del POST al ingest (normalmente 50-150ms) a la respuesta,
 * pero es 100% confiable — no depende de configuración de infraestructura que
 * este paquete no controla ni puede verificar.
 *
 * BUG histórico #1 (jul-2026, v0.2.0): `import("next/server")` con specifier NO
 * literal (una variable) para evitar depender de Next.js en build. Turbopack/
 * webpack no pueden analizar estáticamente un import con nombre dinámico: lo
 * REEMPLAZAN por un throw sintético que dispara SIEMPRE en producción. El catch
 * (vacío) lo absorbía y caía a `void flushLogs()` sin esperar — en serverless
 * la función se congela apenas responde, el fetch de ingesta nunca llegaba a
 * completarse. platform_logs quedaba vacía en TODAS las apps del ecosistema.
 *
 * BUG histórico #2 (jul-2026, v0.2.1): se cambió a `waitUntil()` de
 * @vercel/functions (import estático, sin el problema de arriba). Pero
 * `waitUntil()` resuelve el contexto vía `globalThis[Symbol.for("@vercel/
 * request-context")]`, que Vercel solo inyecta con **Fluid Compute habilitado**
 * — sin eso, `getContext().waitUntil` es `undefined` y la llamada no hace nada
 * (fail silently por diseño del propio paquete de Vercel). No hay forma de
 * verificar ni activar Fluid Compute desde este paquete (es config del proyecto
 * en el dashboard de Vercel), así que no se puede depender de que esté activo
 * en las ~25 apps consumidoras. Confirmado en vivo: 0 requests llegaron al
 * ingest tras el fix de v0.2.1 en mission-control/sap-b1-backend.
 *
 * v0.2.2: vuelve a lo simple y verificable — await bloqueante. Si algún
 * consumidor confirma Fluid Compute activo, puede envolver su propio
 * withApiHandler con waitUntil() a nivel de su propio código; este paquete no
 * lo asume.
 */
async function scheduleFlush() {
    await (0, logger_1.flushLogs)();
}
const auth_1 = require("../auth");
function jsonResponse(body, status, requestId) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "x-request-id": requestId },
    });
}
function withApiHandler(handler, options = {}) {
    const label = options.label ?? "api";
    return async (req, routeCtx) => {
        const requestId = req.headers.get("x-request-id") ?? (0, logger_1.newRequestId)();
        const log = (0, logger_1.getLogger)(label);
        return (0, logger_1.runWithContext)({ requestId }, async () => {
            const start = Date.now();
            const buildResponse = async () => {
                try {
                    // ── Auth (opcional) ──
                    let identity = null;
                    if (options.requireService) {
                        const result = (0, auth_1.verifyServiceRequest)(req, options.serviceAuth);
                        if (!result.ok) {
                            log.warn({ status: 401 }, `${label}: auth de servicio inválida`);
                            return jsonResponse({ error: "No autenticado", code: "UNAUTHORIZED", category: "validation", requestId }, 401, requestId);
                        }
                        if (result.tenantId)
                            (0, logger_1.setContextFields)({ tenant: result.tenantId });
                    }
                    if (options.requireModule || options.requireRole) {
                        identity = (0, auth_1.readIdentity)(req, options.sessionAuth);
                        if (identity)
                            (0, logger_1.setContextFields)({ tenant: identity.tenantId, userId: identity.userId });
                        if (options.requireModule)
                            (0, auth_1.requireModule)(identity, options.requireModule);
                        if (options.requireRole)
                            (0, auth_1.requireRole)(identity, options.requireRole);
                    }
                    else {
                        // Lee identidad si está disponible, pero no la exige.
                        identity = (0, auth_1.readIdentity)(req, options.sessionAuth);
                        if (identity)
                            (0, logger_1.setContextFields)({ tenant: identity.tenantId, userId: identity.userId });
                    }
                    // ── Handler ──
                    const ctx = { requestId, log, identity, ...(routeCtx ?? {}) };
                    const result = await handler(req, ctx);
                    const durationMs = Date.now() - start;
                    if (result instanceof Response) {
                        // Clasifica por status: un handler puede devolver `NextResponse.json({...},
                        // {status: 500})` sin lanzar excepción, y ese caso debe quedar visible como
                        // ERROR/WARN en platform_logs (no como INFO) para paneles/automatizaciones
                        // que filtran por level.
                        const logPayload = { durationMs, status: result.status };
                        if (result.status >= 500) {
                            log.error(logPayload, label);
                        }
                        else if (result.status >= 400) {
                            log.warn(logPayload, label);
                        }
                        else {
                            log.info(logPayload, label);
                        }
                        // Propaga el requestId aunque el handler haya construido su propia Response.
                        if (!result.headers.get("x-request-id"))
                            result.headers.set("x-request-id", requestId);
                        return result;
                    }
                    log.info({ durationMs, status: 200 }, label);
                    return jsonResponse(result, 200, requestId);
                }
                catch (err) {
                    const durationMs = Date.now() - start;
                    const appErr = (0, errors_1.classifyUnknownError)(err);
                    // Log con detalle completo (stack incluido); la respuesta al cliente es segura.
                    log.error({ durationMs, status: appErr.httpStatus, code: appErr.code, err: appErr.cause ?? appErr }, `${label} error`);
                    const { status, body } = (0, errors_1.toErrorResponse)(appErr, requestId);
                    return jsonResponse(body, status, requestId);
                }
            };
            const response = await buildResponse();
            // Asegura el envío de logs tras responder (serverless-safe, sin bloquear latencia).
            await scheduleFlush();
            return response;
        });
    };
}
