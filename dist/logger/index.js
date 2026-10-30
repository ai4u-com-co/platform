"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
exports.runWithContext = runWithContext;
exports.setContextFields = setContextFields;
exports.getContext = getContext;
exports.setServiceName = setServiceName;
exports.redactSecrets = redactSecrets;
exports.configureTransport = configureTransport;
exports.flushLogs = flushLogs;
exports.getLogger = getLogger;
exports.newRequestId = newRequestId;
/**
 * Logger central del ecosistema superAI.
 *
 * Une lo mejor de los loggers que ya existían:
 *   - orderloader/lib/logger.ts  → niveles, JSON|text, child(), contexto por corrida.
 *   - sap-b1-backend/lib/logger.ts → redacción de secretos y requestId.
 *
 * Añade:
 *   - Contexto por request vía AsyncLocalStorage (requestId/tenant/userId/service se
 *     inyectan automáticamente en cada log sin pasarlos a mano por las capas).
 *   - Transporte async, en lote y "fire-and-forget" hacia el ingest API del panel
 *     admin. NUNCA bloquea el request; si el envío falla, cae a stderr (la app no
 *     se rompe por logging). Por defecto persiste TODOS los niveles.
 */
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
const LEVEL_VALUES = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
// Se leen dinámicamente del entorno para ser configurables (y testeables) sin
// reimportar el módulo.
function minLevel() {
    return LEVEL_VALUES[process.env.LOG_LEVEL?.toUpperCase() ?? "INFO"] ?? 20;
}
function jsonFormat() {
    return process.env.LOG_FORMAT === "json";
}
const als = new node_async_hooks_1.AsyncLocalStorage();
/** Corre `fn` con un contexto que todo log dentro hereda automáticamente. */
function runWithContext(ctx, fn) {
    return als.run({ ...ctx }, fn);
}
/** Agrega/actualiza campos del contexto activo (no-op si no hay contexto). */
function setContextFields(fields) {
    const ctx = als.getStore();
    if (ctx)
        Object.assign(ctx, fields);
}
function getContext() {
    return als.getStore() ?? {};
}
/** Service por defecto para todos los logs de esta app (p.ej. "kpis"). */
let SERVICE_NAME = process.env.PLATFORM_SERVICE ?? process.env.SERVICE_ID ?? "unknown";
function setServiceName(name) {
    SERVICE_NAME = name;
    // Mismo problema que resolveTransport() (ver abajo): otra copia de este
    // módulo (Turbopack puede instanciarlo más de una vez por proceso, una por
    // bundle de función serverless) nunca ve esta asignación y sigue emitiendo
    // "unknown". process.env sí es un singleton real de Node, ajeno al bundler.
    process.env.PLATFORM_SERVICE = name;
}
function resolveServiceName() {
    return process.env.PLATFORM_SERVICE ?? process.env.SERVICE_ID ?? SERVICE_NAME;
}
/* ── Redacción de secretos (red de seguridad de sap-b1-backend) ──────────── */
const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i;
function sanitize(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
        out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : v;
    }
    return out;
}
/*
 * Secretos que viajan DENTRO de textos de error (p. ej. googleapis pone `?key=AIza…`
 * en la URL del mensaje; node-fetch dice `request to <url> failed`). Se enmascara solo
 * lo sensible, no la URL entera. Todas las regex son lineales (sin cuantificadores
 * anidados) y el resultado es idempotente.
 */
// Query de URL completa: se conserva el path para diagnosticar, nunca los valores. Host/path
// acotados (2048) y sin cruzar otro "http(s)://" para que los inicios repetidos no sean cuadráticos.
const RE_URL_QUERY = /(\bhttps?:\/\/(?:(?!https?:\/\/)[^\s?#"'<>]){0,2048})\?[^\s#"'<>)]*/gi;
const RE_URL_CREDS = /\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/?#@:]+:[^\s/?#@]+@/gi;
// Parámetro `nombre=valor` cuyo nombre TERMINA en una palabra sensible (auth_token, private_key,
// x-amz-signature, session…), dentro o fuera de URLs. El lookbehind evita arrancar a mitad de racha.
const RE_SENSITIVE_PARAM = /(?<![\w.-])([\w.-]*(?:token|key|secret|signature|sig|password|passwd|pass|auth|credential|session))=[^&\s"'#<>]*/gi;
const RE_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g;
const RE_BASIC = /\bBasic\s+(?![A-Z]?[a-z]+\b)[A-Za-z0-9+/]{8,}={0,2}/g;
const RE_JWT = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const RE_KEYS = /(?<![A-Za-z0-9_-])(?:sk-[A-Za-z0-9_-]{8,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g;
// Correos (PII, no un secreto). FAIL-CLOSED: toda racha delimitada por espacios o puntuación que
// contenga `algo@algo` se enmascara (Unicode, locales largos, IDN, localhost, IP, `@` encadenados).
// La racha puede contener varias `@`: la última separa el dominio y TODO lo anterior (hasta la
// última `/`) es parte local. El dominio se conserva SOLO si parece un dominio ASCII normal.
// El lookbehind hace que solo arranque al inicio de una racha => coste lineal. La salida
// `[correo]@x` no vuelve a coincidir (`[`/`]` son delimitadores y no hay parte local) => idempotente.
const RE_EMAIL = /(?<![^\s<>"'(),;:\[\]{}])[^\s<>"'(),;:\[\]{}]+@[^\s@<>"'(),;:\[\]{}]+/gu;
const RE_ASCII_DOMAIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?){0,8}$/;
/** `@scope/pkg` de una ruta npm (no un correo): `@` al inicio o tras `/`, etiqueta sin punto y `/nombre`. */
function isNpmScope(m, at, end) {
    if (at !== 0 && m.charAt(at - 1) !== "/")
        return false;
    const slash = m.indexOf("/", at + 1);
    if (slash <= at + 1 || slash + 1 >= end)
        return false;
    if (m.slice(at + 1, slash).includes("."))
        return false;
    const c = m.charAt(slash + 1);
    return c !== "/" && c !== "@";
}
function maskDomain(domain) {
    const slash = domain.indexOf("/");
    const head = slash < 0 ? domain : domain.slice(0, slash);
    const rest = slash < 0 ? "" : domain.slice(slash);
    let cut = head.length;
    while (cut > 0 && ".!?*_-".includes(head.charAt(cut - 1)))
        cut--;
    const core = head.slice(0, cut);
    const tail = head.slice(cut) + rest;
    return RE_ASCII_DOMAIN.test(core) ? "[correo]@" + core + tail : "[correo]" + tail;
}
/** La racha parece claramente una ruta/URL: solo entonces se conserva lo que precede al correo. */
const RE_URL_SCHEME_START = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
function looksLikePath(m) {
    return (m.startsWith("/") || m.startsWith("./") || m.startsWith("../") || m.startsWith("~/") ||
        RE_URL_SCHEME_START.test(m) || m.includes("node_modules/"));
}
/** Recorre la racha de derecha a izquierda (iterativo, lineal): cada `@` es scope npm o correo. */
function maskEmail(m) {
    const parts = [];
    const pathLike = looksLikePath(m);
    let end = m.length;
    while (end > 0) {
        const at = m.lastIndexOf("@", end - 1);
        if (at < 0)
            break;
        if (isNpmScope(m, at, end)) {
            parts.push(m.slice(at, end));
            end = at;
            continue;
        }
        // Fuera de una ruta clara, `a/b@x.com` es un correo: toda la racha previa es parte local.
        const localStart = pathLike ? m.lastIndexOf("/", at - 1) + 1 : 0;
        if (localStart >= at) {
            // Sin parte local (p. ej. `x/@dominio` o `@` inicial): no hay nada que ocultar.
            parts.push(m.slice(at, end));
            end = at;
            continue;
        }
        parts.push(maskDomain(m.slice(at + 1, end)));
        end = localStart;
    }
    parts.push(m.slice(0, end));
    return parts.reverse().join("");
}
/** Enmascara claves, tokens y parámetros sensibles dentro de un texto. Pura, idempotente, nunca lanza. */
function redactSecrets(text) {
    try {
        if (typeof text !== "string" || text === "")
            return text;
        return text
            .replace(RE_URL_CREDS, "$1[redacted]@")
            .replace(RE_URL_QUERY, "$1?[redacted]")
            .replace(RE_SENSITIVE_PARAM, "$1=[redacted]")
            .replace(RE_BEARER, "Bearer [redacted]")
            .replace(RE_BASIC, "Basic [redacted]")
            .replace(RE_JWT, "[jwt]")
            .replace(RE_KEYS, "[redacted]")
            .replace(RE_EMAIL, maskEmail);
    }
    catch {
        return text;
    }
}
const MAX_MESSAGE = 16384;
const MAX_STACK = 32768;
const TRUNCATED = "…[truncado]";
/** Holgura sobre el tope: una credencial a caballo del corte se redacta completa antes de recortar. */
const REDACT_SLACK = 4096;
/**
 * Redacta primero una porción algo mayor que el tope (el coste sigue acotado porque la
 * entrada lo está) y DESPUÉS recorta el resultado ya redactado.
 */
function redactAndCap(text, max) {
    if (text.length <= max)
        return redactSecrets(text);
    const redacted = redactSecrets(text.slice(0, max + REDACT_SLACK));
    return redacted.slice(0, max) + TRUNCATED;
}
function serializeErr(err) {
    if (err instanceof Error) {
        return {
            name: err.name,
            message: redactAndCap(err.message, MAX_MESSAGE),
            stack: err.stack === undefined ? undefined : redactAndCap(err.stack, MAX_STACK),
        };
    }
    return { message: redactAndCap(String(err), MAX_MESSAGE) };
}
let transport = null;
let buffer = [];
let timer = null;
/**
 * Bundlers como Turbopack pueden instanciar este módulo más de una vez dentro
 * del mismo proceso (una copia por bundle de función serverless: una para
 * instrumentation.ts, otra para cada route handler que importe `./http`).
 * configureTransport() solo setea la variable `transport` de SU PROPIA copia
 * del módulo — si otra copia es la que realmente encola/envía logs, esa nunca
 * se entera y el flush queda silenciosamente vacío para siempre. Confirmado en
 * vivo (jul-2026): el log de arranque mostraba "transporte configurado" pero
 * platform_logs seguía en 0 filas.
 *
 * Por eso NO confiamos solo en el estado en memoria: si `configureTransport`
 * no corrió en ESTA copia del módulo, resolvemos el transporte leyendo
 * `process.env` directamente (que sí es un singleton real de Node, ajeno al
 * bundler) antes de descartar el log.
 */
function resolveTransport() {
    if (transport)
        return transport;
    const endpoint = process.env.PLATFORM_INGEST_URL;
    const secret = process.env.INGEST_SECRET;
    return endpoint && secret ? { endpoint, secret } : null;
}
/** Activa el envío a Supabase vía el ingest API. Llamar una vez al arrancar la app. */
function configureTransport(cfg) {
    transport = cfg;
    if (timer)
        clearInterval(timer);
    timer = setInterval(() => void flush(), cfg.flushMs ?? 2000);
    // No mantener vivo el proceso solo por el logger.
    timer.unref?.();
}
async function flush() {
    const cfg = resolveTransport();
    if (!cfg || buffer.length === 0)
        return;
    const batch = buffer;
    buffer = [];
    try {
        const res = await fetch(cfg.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", "x-ingest-secret": cfg.secret },
            body: JSON.stringify({ logs: batch }),
            keepalive: true,
        });
        // fetch() NO lanza por status HTTP no-2xx (p.ej. una redirección de Vercel
        // Deployment Protection hacia su login) — hay que chequearlo explícitamente
        // o el fallo pasa inadvertido igual que el bug de arriba.
        if (!res.ok) {
            process.stderr.write(`[platform/logger] ingest flush respondió ${res.status}: ${cfg.endpoint}\n`);
        }
    }
    catch (err) {
        // El ingest cayó: no perder del todo el dato ni romper la app.
        process.stderr.write(`[platform/logger] ingest flush failed: ${String(err)}\n`);
    }
}
/** Fuerza el envío inmediato del buffer (útil en cron/scripts antes de salir). */
function flushLogs() {
    return flush();
}
function enqueue(record) {
    const cfg = resolveTransport();
    if (!cfg)
        return;
    buffer.push(record);
    if (buffer.length >= (cfg.batchMax ?? 50))
        void flush();
}
function emit(level, component, fieldsOrMsg, msg) {
    // ERROR siempre se emite y persiste, aunque MIN_LEVEL sea más alto (nada de
    // fallos silenciosos). El resto respeta el umbral.
    if (level !== "ERROR" && LEVEL_VALUES[level] < minLevel())
        return;
    let message;
    let extra = {};
    if (typeof fieldsOrMsg === "string") {
        message = fieldsOrMsg;
    }
    else {
        message = msg ?? "";
        extra = { ...fieldsOrMsg };
    }
    const ctx = getContext();
    const errField = extra.err;
    if (errField)
        delete extra.err;
    // Claves reservadas del propio record: el caller nunca puede pisarlas vía
    // `extra` (primer argumento de log.info/warn/error/debug). Bug real: un
    // caller pasando `{ service: mod.id }` como campo de negocio silenciaba el
    // nombre real del servicio en cada log (mission-control/app/api/handoff).
    const safeExtra = sanitize(extra);
    delete safeExtra.ts;
    delete safeExtra.level;
    delete safeExtra.service;
    delete safeExtra.component;
    delete safeExtra.msg;
    const record = {
        ts: new Date().toISOString(),
        level,
        service: resolveServiceName(),
        component,
        ...ctx,
        ...safeExtra,
        msg: message,
    };
    if (errField !== undefined)
        record.err = serializeErr(errField);
    // 1) stdout/stderr — siempre (mantiene los logs de Vercel/Docker intactos).
    const stream = level === "ERROR" ? process.stderr : process.stdout;
    if (jsonFormat()) {
        stream.write(JSON.stringify(record) + "\n");
    }
    else {
        const time = record.ts.slice(0, 23).replace("T", " ");
        const rid = ctx.requestId ? ` rid=${ctx.requestId}` : "";
        stream.write(`${time} ${level.padEnd(5)} [${component}]${rid} ${message}\n`);
    }
    // 2) Supabase (vía ingest) — async, en lote, fire-and-forget.
    enqueue(record);
}
class Logger {
    constructor(component) {
        this.component = component;
        this.debug = (a, b) => emit("DEBUG", this.component, a, b);
        this.info = (a, b) => emit("INFO", this.component, a, b);
        this.warn = (a, b) => emit("WARN", this.component, a, b);
        this.error = (a, b) => emit("ERROR", this.component, a, b);
    }
    child(bindings) {
        return new Logger(bindings.component ?? this.component);
    }
}
exports.Logger = Logger;
function getLogger(component) {
    return new Logger(component);
}
/** Genera un request id corto (compatible con sap-b1-backend.newRequestId). */
function newRequestId() {
    return (0, node_crypto_1.randomUUID)().slice(0, 8);
}
