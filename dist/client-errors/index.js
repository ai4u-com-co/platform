"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClientErrorHandler = createClientErrorHandler;
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
 *   por IP en memoria (429; clave desde x-vercel-forwarded-for/x-real-ip antes que x-forwarded-for, Map con tope), validación estricta de forma y truncado de campos, y respuesta 204 sin
 *   eco. El límite por IP es de MEJOR ESFUERZO: en serverless cada instancia tiene su propio Map
 *   y se reinicia en cold start; no sustituye a un WAF/rate-limit de plataforma. El origen se
 *   comprueba por cabeceras que un cliente no-navegador puede falsificar: sirve contra abuso
 *   cross-site desde navegadores, no contra un atacante dedicado.
 *
 * Los campos recibidos son DATOS NO CONFIABLES: se registran como datos (con saneado de caracteres
 * de control), nunca se interpretan como instrucciones ni pueden fijar nivel, servicio ni component
 * del log (el handler siempre registra level=ERROR, component="client").
 */
const logger_1 = require("../logger");
const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;
const WINDOW_MS = 60000;
const KINDS = ["error", "unhandledrejection", "manual"];
/** Tope de entradas del Map del rate limit: al llenarse se podan expirados y luego las más viejas. */
const MAX_HITS = 5000;
/** `service`: id de app corto (sin espacios ni saltos de línea). */
const SERVICE_RE = /^[A-Za-z0-9._-]{1,80}$/;
/** Caracteres de un pathname que el navegador produce tal cual (incluye `|`, `[`, `]`, `^`, `{`, `}`). */
const PATH_UNSAFE_RE = /[^A-Za-z0-9._~%!$&'()*+,;=:@/|[\]^{}-]/g;
const UNKNOWN_SERVICE = "unknown-client";
const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i;
/** Quita caracteres de control (conserva \n y \t) y trunca. */
function clean(v, max) {
    // eslint-disable-next-line no-control-regex
    return v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max);
}
function validate(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const o = raw;
    if (typeof o.message !== "string" || o.message.length === 0)
        return null;
    if (o.stack !== undefined && typeof o.stack !== "string")
        return null;
    if (o.name !== undefined && typeof o.name !== "string")
        return null;
    if (o.service !== undefined && typeof o.service !== "string")
        return null;
    if (typeof o.path !== "string")
        return null;
    if (!KINDS.includes(o.kind))
        return null;
    if (o.extra !== undefined && (typeof o.extra !== "object" || o.extra === null || Array.isArray(o.extra)))
        return null;
    // Solo pathname: descarta querystring/hash aunque el cliente los mande.
    // Un path raro NO descarta el reporte: se neutralizan los caracteres peligrosos (o "/invalid").
    const rawPath = clean(o.path.split(/[?#]/)[0], 200);
    const path = rawPath.startsWith("/") ? rawPath.replace(PATH_UNSAFE_RE, "_") : "/invalid";
    const out = {
        message: clean(o.message, MAX_MESSAGE),
        kind: o.kind,
        path,
    };
    if (typeof o.stack === "string")
        out.stack = clean(o.stack, MAX_STACK);
    if (typeof o.name === "string")
        out.name = clean(o.name, 100);
    if (typeof o.service === "string") {
        // Un service con formato raro tampoco descarta el reporte: se reemplaza por un valor por defecto.
        out.service = SERVICE_RE.test(o.service) ? o.service : UNKNOWN_SERVICE;
    }
    if (o.extra) {
        const extra = {};
        for (const [k, v] of Object.entries(o.extra).slice(0, 10)) {
            if (!/^[\w.-]{1,40}$/.test(k) || SENSITIVE_KEY.test(k))
                continue;
            if (typeof v === "string")
                extra[k] = clean(v, 200);
            else if (typeof v === "number" && Number.isFinite(v))
                extra[k] = v;
            else if (typeof v === "boolean")
                extra[k] = v;
        }
        if (Object.keys(extra).length)
            out.extra = extra;
    }
    return out;
}
function sameOrigin(req) {
    const site = req.headers.get("sec-fetch-site");
    if (site && site !== "same-origin")
        return false;
    const origin = req.headers.get("origin");
    if (origin) {
        let originHost;
        try {
            originHost = new URL(origin).host;
        }
        catch {
            return false;
        }
        const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
        return originHost === host.split(",")[0].trim();
    }
    // Sin Origin: solo vale si el navegador declaró same-origin vía Sec-Fetch-Site.
    return site === "same-origin";
}
/**
 * IP para el rate limit. Se prefieren las cabeceras que pone la plataforma (Vercel reescribe
 * `x-vercel-forwarded-for` / `x-real-ip` y el cliente no las controla) sobre `x-forwarded-for`,
 * cuyo primer valor puede venir falsificado por el cliente.
 */
function clientIp(req) {
    const trusted = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip");
    const first = trusted?.split(",")[0].trim();
    if (first)
        return first;
    const xff = req.headers.get("x-forwarded-for");
    if (xff)
        return xff.split(",")[0].trim() || "unknown";
    return "unknown";
}
/** Lee el cuerpo como stream y corta apenas supera `maxBytes` (null = excedido). Nunca carga todo en memoria. */
async function readBodyCapped(req, maxBytes) {
    if (!req.body)
        return "";
    const reader = req.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return null;
        }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        all.set(c, off);
        off += c.byteLength;
    }
    return new TextDecoder().decode(all);
}
const empty = (status) => new Response(null, { status });
function createClientErrorHandler(options = {}) {
    const maxBytes = options.maxBytes ?? 8192;
    const maxPerMinute = options.maxPerMinute ?? 20;
    const hits = new Map();
    function limited(ip) {
        const now = Date.now();
        if (hits.size >= MAX_HITS) {
            for (const [k, v] of hits)
                if (v.reset <= now)
                    hits.delete(k);
            // Aún lleno (muchas IPs en 1 min): se descartan las más viejas (Map conserva el orden de inserción).
            for (const k of hits.keys()) {
                if (hits.size < MAX_HITS)
                    break;
                hits.delete(k);
            }
        }
        const h = hits.get(ip);
        if (!h || h.reset <= now) {
            hits.set(ip, { count: 1, reset: now + WINDOW_MS });
            return false;
        }
        h.count++;
        return h.count > maxPerMinute;
    }
    return async function POST(req) {
        if (req.method !== "POST")
            return empty(405);
        const ctype = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (ctype !== "application/json")
            return empty(415);
        if (!sameOrigin(req))
            return empty(403);
        if (limited(clientIp(req)))
            return empty(429);
        const declared = Number(req.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxBytes)
            return empty(413);
        let text;
        try {
            text = await readBodyCapped(req, maxBytes);
        }
        catch {
            return empty(400);
        }
        if (text === null)
            return empty(413);
        let payload;
        try {
            payload = validate(JSON.parse(text));
        }
        catch {
            payload = null;
        }
        if (!payload)
            return empty(400);
        await (0, logger_1.runWithContext)({ requestId: (0, logger_1.newRequestId)() }, async () => {
            const err = new Error(payload.message);
            err.name = payload.name || "ClientError";
            err.stack = payload.stack ?? `${err.name}: ${payload.message}`;
            (0, logger_1.getLogger)("client").error({
                err,
                category: "client",
                kind: payload.kind,
                path: payload.path,
                clientService: payload.service,
                clientExtra: payload.extra,
            }, `client error: ${payload.message.replace(/\s+/g, " ").slice(0, 200)}`);
            await (0, logger_1.flushLogs)();
        });
        return empty(204);
    };
}
