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
const version_1 = require("../version");
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
/** Palabras que contienen "pass" pero no son credenciales (comparación por segmento completo). */
const PASS_SAFE_WORDS = new Set(["bypass", "compass", "passenger", "passive", "passthrough", "passed", "passing"]);
/** Métricas de conteo de tokens de LLM (únicas claves con "token" que no se enmascaran). */
const TOKEN_COUNT_KEY = /^(?:(?:max|min|input|output|prompt|completion|total|cached|reasoning)[-_]?tokens|tokens[-_]?(?:used|count|in|out|limit|remaining))$/i;
/**
 * FAIL-CLOSED: se enmascara toda clave que contenga password/passwd/secret/api key/authorization/cookie/
 * credential/pass/token, salvo (a) segmentos de una lista explícita de palabras seguras con "pass" y
 * (b) un patrón explícito de conteo de tokens (maxTokens, inputTokens, tokens_used…).
 */
function isSensitiveKey(k) {
    if (/password|passwd|secret|api[-_]?key|authorization|cookie|credential/i.test(k))
        return true;
    const norm = k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    if (norm.includes("token"))
        return !TOKEN_COUNT_KEY.test(norm);
    if (norm.includes("pass")) {
        return norm.split(/[^a-z0-9]+/).some((seg) => seg.includes("pass") && !PASS_SAFE_WORDS.has(seg));
    }
    return false;
}
function sanitize(fields) {
    // Un fallo de observabilidad nunca debe lanzar (Proxy / getter hostil, estructuras raras).
    try {
        return sanitizeObject(fields, 0, new WeakSet());
    }
    catch {
        return { _sanitizeFailed: true };
    }
}
/** Profundidad máxima al recorrer los extras de un log (lo más hondo se reemplaza por un marcador). */
const MAX_EXTRA_DEPTH = 4;
/** Tope de claves por objeto y de elementos por array en los extras. */
const MAX_EXTRA_ITEMS = 100;
function sanitizeObject(obj, depth, seen) {
    const out = {};
    let n = 0;
    for (const k of Object.keys(obj)) {
        if (n++ >= MAX_EXTRA_ITEMS) {
            out["…[truncado]"] = `+${Object.keys(obj).length - MAX_EXTRA_ITEMS} claves`;
            break;
        }
        out[k] = isSensitiveKey(k) ? "[REDACTED]" : sanitizeValue(obj[k], depth + 1, seen);
    }
    return out;
}
/** Redacta strings (con tope) y recorre objetos/arrays hasta una profundidad acotada; tolera ciclos. */
function sanitizeValue(v, depth, seen) {
    if (typeof v === "string")
        return redactAndCap(v, MAX_MESSAGE);
    if (v === null || typeof v !== "object")
        return v;
    if (v instanceof Date)
        return v;
    if (v instanceof Error)
        return serializeErr(v);
    // Buffer / typed arrays / DataView: se resumen, nunca se expanden por índice.
    if (ArrayBuffer.isView(v))
        return `[${v.constructor?.name ?? "Buffer"} ${v.byteLength} bytes]`;
    if (v instanceof ArrayBuffer)
        return `[ArrayBuffer ${v.byteLength} bytes]`;
    if (depth >= MAX_EXTRA_DEPTH || seen.has(v))
        return "[truncado]";
    seen.add(v);
    let res;
    if (Array.isArray(v)) {
        const items = v.slice(0, MAX_EXTRA_ITEMS).map((x) => sanitizeValue(x, depth + 1, seen));
        if (v.length > MAX_EXTRA_ITEMS)
            items.push(`…[truncado] +${v.length - MAX_EXTRA_ITEMS} elementos`);
        res = items;
    }
    else {
        res = sanitizeObject(v, depth, seen);
    }
    seen.delete(v);
    return res;
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
/** Envío en curso: los flush concurrentes lo esperan en vez de retornar con el buffer ya vaciado. */
let inflight = null;
/** Tope de registros retenidos (reencolados tras un fallo o acumulados): se descartan los más viejos. */
const MAX_BUFFER = 1000;
/** Timeout del POST al ingest: un ingest lento no puede retener la respuesta de la API. */
const FLUSH_TIMEOUT_MS = 2000;
/** Tras un fallo, los envíos automáticos (timer / lote lleno) esperan esto; flushLogs() siempre intenta. */
const FAIL_COOLDOWN_MS = 5000;
let lastFailAt = 0;
let lastFailed = false;
/** Fallos consecutivos del ingest: al llegar a BREAKER_FAILS, TAMBIÉN flushLogs() espera el enfriamiento. */
let consecutiveFails = 0;
const BREAKER_FAILS = 3;
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
    timer = setInterval(autoFlush, cfg.flushMs ?? 2000);
    // No mantener vivo el proceso solo por el logger.
    timer.unref?.();
}
/** Devuelve los registros de un lote fallido al frente del buffer, respetando el tope. */
function requeue(batch) {
    buffer = batch.concat(buffer);
    if (buffer.length > MAX_BUFFER)
        buffer = buffer.slice(buffer.length - MAX_BUFFER);
}
async function send(cfg, batch) {
    try {
        const res = await fetch(cfg.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", "x-ingest-secret": cfg.secret },
            body: JSON.stringify({ logs: batch }),
            keepalive: true,
            signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
        });
        // fetch() NO lanza por status HTTP no-2xx (p.ej. una redirección de Vercel
        // Deployment Protection hacia su login) — hay que chequearlo explícitamente
        // o el fallo pasa inadvertido igual que el bug de arriba.
        if (!res.ok) {
            process.stderr.write(`[platform/logger] ingest flush respondió ${res.status}: ${cfg.endpoint}\n`);
            // Transitorio (5xx / 408 / 429): se reintenta. Otro 4xx (secreto malo) no mejora reintentando.
            if (res.status >= 500 || res.status === 408 || res.status === 429) {
                requeue(batch);
                lastFailed = true;
                consecutiveFails++;
                lastFailAt = Date.now();
                return;
            }
        }
        lastFailed = false;
        consecutiveFails = 0;
    }
    catch (err) {
        // El ingest cayó o tardó demasiado: el lote vuelve al buffer (con tope) y la app no se rompe.
        process.stderr.write(`[platform/logger] ingest flush failed: ${String(err)}\n`);
        requeue(batch);
        lastFailed = true;
        consecutiveFails++;
        lastFailAt = Date.now();
    }
}
function flush() {
    if (inflight) {
        // Espera el envío en curso; si mientras tanto entró algo nuevo (y el envío no falló), lo manda.
        return inflight.then(() => (buffer.length > 0 && !lastFailed ? flush() : undefined));
    }
    const cfg = resolveTransport();
    if (!cfg || buffer.length === 0)
        return Promise.resolve();
    // Circuit breaker simple: con el ingest caído de forma sostenida, la ruta de request deja de pagar el
    // timeout en cada respuesta; el lote sigue en el buffer (con tope) y se reintenta pasado el enfriamiento.
    if (consecutiveFails >= BREAKER_FAILS && Date.now() - lastFailAt < FAIL_COOLDOWN_MS)
        return Promise.resolve();
    const batch = buffer;
    buffer = [];
    inflight = send(cfg, batch).finally(() => {
        inflight = null;
    });
    return inflight;
}
/** Envío automático (timer / lote lleno): respeta el enfriamiento tras un fallo. */
function autoFlush() {
    if (lastFailed && Date.now() - lastFailAt < FAIL_COOLDOWN_MS)
        return;
    void flush();
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
    if (buffer.length > MAX_BUFFER)
        buffer = buffer.slice(buffer.length - MAX_BUFFER);
    if (buffer.length >= (cfg.batchMax ?? 50))
        autoFlush();
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
        try {
            extra = { ...fieldsOrMsg }; // el spread ejecuta getters: un getter que lanza no debe romper el log
        }
        catch {
            extra = { _sanitizeFailed: true };
        }
    }
    const ctx = getContext();
    const errField = extra.err;
    if (errField)
        delete extra.err;
    // Claves reservadas del propio record: el caller nunca puede pisarlas vía
    // `extra` (primer argumento de log.info/warn/error/debug). Bug real: un
    // caller pasando `{ service: mod.id }` como campo de negocio silenciaba el
    // nombre real del servicio en cada log (mission-control/app/api/handoff).
    // tenant/userId/requestId: el contexto de la request manda (evita logs mal atribuidos entre
    // tenants); si no hay contexto, el extra sigue valiendo como dato informativo.
    const safeExtra = sanitize(extra);
    delete safeExtra.ts;
    delete safeExtra.level;
    delete safeExtra.service;
    delete safeExtra.component;
    delete safeExtra.msg;
    delete safeExtra.platformVersion;
    for (const k of ["tenant", "userId", "requestId"]) {
        if (ctx[k] !== undefined)
            delete safeExtra[k];
    }
    // El mensaje también puede traer secretos/PII (p. ej. texto de error de un navegador o de un tercero).
    message = redactAndCap(message, MAX_MESSAGE);
    const record = {
        ts: new Date().toISOString(),
        level,
        platformVersion: version_1.PLATFORM_VERSION,
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
