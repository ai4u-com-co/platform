"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
exports.runWithContext = runWithContext;
exports.setContextFields = setContextFields;
exports.getContext = getContext;
exports.setServiceName = setServiceName;
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
function serializeErr(err) {
    if (err instanceof Error)
        return { name: err.name, message: err.message, stack: err.stack };
    return { message: String(err) };
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
