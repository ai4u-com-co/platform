"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onRequestError = onRequestError;
function stripQuery(path) {
    if (typeof path !== "string")
        return "";
    return path.split(/[?#]/)[0].slice(0, 300);
}
function short(v, max = 200) {
    return typeof v === "string" ? v.slice(0, max) : undefined;
}
async function onRequestError(err, request, context) {
    // Edge no soporta el logger (node:async_hooks). Sin NEXT_RUNTIME (tests/scripts) se asume Node.
    const runtime = process.env.NEXT_RUNTIME;
    if (runtime && runtime !== "nodejs")
        return;
    try {
        // Import dinámico con specifier literal: el bundler Edge no arrastra el logger.
        const { getLogger, flushLogs } = await Promise.resolve().then(() => __importStar(require("../logger")));
        const digest = err?.digest;
        const fields = {
            err,
            path: stripQuery(request?.path),
            method: short(request?.method, 10),
            routerKind: short(context?.routerKind),
            routeType: short(context?.routeType),
            routePath: short(context?.routePath),
            renderSource: short(context?.renderSource),
            digest: short(digest),
        };
        for (const k of Object.keys(fields))
            if (fields[k] === undefined || fields[k] === "")
                delete fields[k];
        getLogger("next-request").error(fields, "onRequestError");
        await flushLogs();
    }
    catch {
        // Un fallo de observabilidad jamás debe romper ni enmascarar el error original.
    }
}
