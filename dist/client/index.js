"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_ERROR_DEDUPE_MS = exports.CLIENT_ERROR_MAX_PER_SESSION = exports.CLIENT_ERROR_MAX_STACK = exports.CLIENT_ERROR_MAX_MESSAGE = exports.DEFAULT_CLIENT_ERROR_ENDPOINT = void 0;
exports.__resetClientErrorReporter = __resetClientErrorReporter;
exports.reportClientError = reportClientError;
exports.installClientErrorReporter = installClientErrorReporter;
exports.DEFAULT_CLIENT_ERROR_ENDPOINT = "/api/client-error";
exports.CLIENT_ERROR_MAX_MESSAGE = 2000;
exports.CLIENT_ERROR_MAX_STACK = 4000;
/** Máximo de reportes por sesión de página (por carga del bundle). */
exports.CLIENT_ERROR_MAX_PER_SESSION = 5;
/** Ventana de deduplicación de la misma firma. */
exports.CLIENT_ERROR_DEDUPE_MS = 60000;
let endpoint = exports.DEFAULT_CLIENT_ERROR_ENDPOINT;
let service;
let installed = false;
let sentCount = 0;
const seen = new Map();
/** Solo para tests: reinicia el estado del módulo. */
function __resetClientErrorReporter() {
    endpoint = exports.DEFAULT_CLIENT_ERROR_ENDPOINT;
    service = undefined;
    installed = false;
    sentCount = 0;
    seen.clear();
}
function currentPath() {
    try {
        return globalThis.location?.pathname ?? "/";
    }
    catch {
        return "/";
    }
}
function normalize(err) {
    if (err instanceof Error)
        return { message: err.message, stack: err.stack, name: err.name };
    if (typeof err === "string")
        return { message: err };
    if (err && typeof err === "object") {
        const o = err;
        if (typeof o.message === "string") {
            return {
                message: o.message,
                stack: typeof o.stack === "string" ? o.stack : undefined,
                name: typeof o.name === "string" ? o.name : undefined,
            };
        }
    }
    try {
        return { message: JSON.stringify(err) ?? String(err) };
    }
    catch {
        return { message: String(err) };
    }
}
function transmit(payload) {
    const body = JSON.stringify(payload);
    try {
        const nav = globalThis.navigator;
        if (nav && typeof nav.sendBeacon === "function") {
            const blob = new Blob([body], { type: "application/json" });
            if (nav.sendBeacon(endpoint, blob))
                return;
        }
    }
    catch {
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
            }).catch(() => { });
        }
    }
    catch {
        // reportar nunca debe lanzar
    }
}
/**
 * Reporta un error manualmente (p. ej. desde `error.tsx` / `global-error.tsx`).
 * Aplica deduplicación (misma firma en 60 s) y el tope de reportes por sesión.
 * Devuelve true si se envió.
 */
function reportClientError(error, extra, kind = "manual") {
    try {
        if (sentCount >= exports.CLIENT_ERROR_MAX_PER_SESSION)
            return false;
        const n = normalize(error);
        const path = currentPath();
        const message = n.message.slice(0, exports.CLIENT_ERROR_MAX_MESSAGE);
        const stack = n.stack?.slice(0, exports.CLIENT_ERROR_MAX_STACK);
        // Firma: tipo + mensaje + primera línea del stack con frame + ruta.
        const sig = `${kind}|${message}|${stack?.split("\n")[1] ?? ""}|${path}`;
        const now = Date.now();
        const prev = seen.get(sig);
        if (prev !== undefined && now - prev < exports.CLIENT_ERROR_DEDUPE_MS)
            return false;
        seen.set(sig, now);
        if (seen.size > 50) {
            for (const [k, t] of seen)
                if (now - t >= exports.CLIENT_ERROR_DEDUPE_MS)
                    seen.delete(k);
        }
        sentCount++;
        const payload = { message, kind, path };
        if (stack)
            payload.stack = stack;
        if (n.name)
            payload.name = n.name.slice(0, 100);
        if (service)
            payload.service = service;
        if (extra) {
            const clean = {};
            for (const [k, v] of Object.entries(extra).slice(0, 10)) {
                if (typeof v === "string")
                    clean[k] = v.slice(0, 200);
                else if (typeof v === "number" || typeof v === "boolean")
                    clean[k] = v;
            }
            if (Object.keys(clean).length)
                payload.extra = clean;
        }
        transmit(payload);
        return true;
    }
    catch {
        return false;
    }
}
function isNoise(message) {
    // "Script error." = error de otro origen sin detalle; ResizeObserver = ruido benigno del navegador.
    return message === "Script error." || message.startsWith("ResizeObserver loop");
}
/**
 * Instala los listeners globales `error` y `unhandledrejection`. Idempotente: llamarla de nuevo
 * (p. ej. en un efecto que se re-ejecuta) solo actualiza endpoint/service, no duplica listeners.
 * Usa addEventListener (no pisa un `window.onerror` existente).
 */
function installClientErrorReporter(options = {}) {
    if (options.endpoint)
        endpoint = options.endpoint;
    if (options.service)
        service = options.service;
    if (installed)
        return;
    const w = globalThis.window;
    if (!w || typeof w.addEventListener !== "function")
        return;
    installed = true;
    w.addEventListener("error", (event) => {
        // Errores de carga de recursos (img/script) llegan con target distinto de window: se ignoran.
        if (event.target && event.target !== w)
            return;
        const err = event.error ?? event.message;
        const msg = normalize(err).message;
        if (isNoise(msg))
            return;
        reportClientError(err, undefined, "error");
    });
    w.addEventListener("unhandledrejection", (event) => {
        reportClientError(event.reason, undefined, "unhandledrejection");
    });
}
