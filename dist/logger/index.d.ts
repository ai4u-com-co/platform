export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";
export interface RunContext {
    requestId?: string;
    tenant?: string;
    userId?: string;
    service?: string;
    [key: string]: unknown;
}
/** Corre `fn` con un contexto que todo log dentro hereda automáticamente. */
export declare function runWithContext<T>(ctx: RunContext, fn: () => T): T;
/** Agrega/actualiza campos del contexto activo (no-op si no hay contexto). */
export declare function setContextFields(fields: RunContext): void;
export declare function getContext(): RunContext;
export declare function setServiceName(name: string): void;
/** Enmascara claves, tokens y parámetros sensibles dentro de un texto. Pura, idempotente, nunca lanza. */
export declare function redactSecrets(text: string): string;
export interface TransportConfig {
    /** URL del ingest API del panel admin, p.ej. https://admin.ai4u.com/api/ingest/logs */
    endpoint: string;
    /** Secreto compartido para autenticar el ingest (header x-ingest-secret). */
    secret: string;
    /** ms entre flushes (default 2000). */
    flushMs?: number;
    /** máximo de registros por lote (default 50). */
    batchMax?: number;
}
/** Activa el envío a Supabase vía el ingest API. Llamar una vez al arrancar la app. */
export declare function configureTransport(cfg: TransportConfig): void;
/** Fuerza el envío inmediato del buffer (útil en cron/scripts antes de salir). */
export declare function flushLogs(): Promise<void>;
type LogMethod = {
    (msg: string): void;
    (fields: Record<string, unknown>, msg: string): void;
};
export declare class Logger {
    private readonly component;
    constructor(component: string);
    debug: LogMethod;
    info: LogMethod;
    warn: LogMethod;
    error: LogMethod;
    child(bindings: {
        component?: string;
    }): Logger;
}
export declare function getLogger(component: string): Logger;
/** Genera un request id corto (compatible con sap-b1-backend.newRequestId). */
export declare function newRequestId(): string;
export {};
//# sourceMappingURL=index.d.ts.map