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
import { Logger } from "../logger";
import { type Identity, type SessionAuthConfig, type ServiceAuthConfig } from "../auth";
export interface ApiContext {
    requestId: string;
    log: Logger;
    /** Identidad del usuario si la ruta requiere/lee sesión; null en rutas de servicio o públicas. */
    identity: Identity | null;
}
export interface WithApiHandlerOptions {
    /** Etiqueta para logs (p.ej. "GET sales analysis"). */
    label?: string;
    /** Exige sesión + acceso a este módulo (any-of si es array). */
    requireModule?: string | string[];
    /**
     * Con `requireModule`: modo estricto, una sesión sin `allowedModules` (null/[]) NO pasa.
     * Default false (compatibilidad: null/[] = acceso a todo).
     */
    strictModules?: boolean;
    /** Exige sesión + este rol (any-of si es array). */
    requireRole?: string | string[];
    /** Exige auth de servicio (x-mc-secret / X-API-Key). */
    requireService?: boolean;
    /** Config de sesión de usuario. */
    sessionAuth?: SessionAuthConfig;
    /** Config de auth de servicio. */
    serviceAuth?: ServiceAuthConfig;
}
type RouteHandler<R> = (req: Request, ctx: ApiContext & R) => Promise<unknown> | unknown;
export declare function withApiHandler<R extends object = object>(handler: RouteHandler<R>, options?: WithApiHandlerOptions): (req: Request, routeCtx?: R) => Promise<Response>;
export {};
//# sourceMappingURL=index.d.ts.map