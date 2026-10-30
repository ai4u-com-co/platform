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
export declare const DEFAULT_CLIENT_ERROR_ENDPOINT = "/api/client-error";
export declare const CLIENT_ERROR_MAX_MESSAGE = 2000;
export declare const CLIENT_ERROR_MAX_STACK = 4000;
/** Máximo de reportes por sesión de página (por carga del bundle). */
export declare const CLIENT_ERROR_MAX_PER_SESSION = 5;
/** Ventana de deduplicación de la misma firma. */
export declare const CLIENT_ERROR_DEDUPE_MS = 60000;
export type ClientErrorKind = "error" | "unhandledrejection" | "manual";
export interface ClientErrorPayload {
    message: string;
    stack?: string;
    name?: string;
    kind: ClientErrorKind;
    path: string;
    service?: string;
    extra?: Record<string, string | number | boolean>;
}
export interface ClientErrorReporterOptions {
    /** Ruta servidor que recibe el reporte (default "/api/client-error"). */
    endpoint?: string;
    /** Nombre del servicio/app para filtrar en el panel. */
    service?: string;
}
/** Solo para tests: reinicia el estado del módulo. */
export declare function __resetClientErrorReporter(): void;
/**
 * Reporta un error manualmente (p. ej. desde `error.tsx` / `global-error.tsx`).
 * Aplica deduplicación (misma firma en 60 s) y el tope de reportes por sesión.
 * Devuelve true si se envió.
 */
export declare function reportClientError(error: unknown, extra?: Record<string, string | number | boolean | null | undefined>, kind?: ClientErrorKind): boolean;
/**
 * Instala los listeners globales `error` y `unhandledrejection`. Idempotente: llamarla de nuevo
 * (p. ej. en un efecto que se re-ejecuta) solo actualiza endpoint/service, no duplica listeners.
 * Usa addEventListener (no pisa un `window.onerror` existente).
 */
export declare function installClientErrorReporter(options?: ClientErrorReporterOptions): void;
//# sourceMappingURL=index.d.ts.map