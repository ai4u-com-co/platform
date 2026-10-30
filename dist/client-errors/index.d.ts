export interface ClientErrorHandlerOptions {
    /** Tamaño máximo del cuerpo en bytes (default 8192). */
    maxBytes?: number;
    /** Reportes máximos por IP por minuto (default 20). */
    maxPerMinute?: number;
}
export declare function createClientErrorHandler(options?: ClientErrorHandlerOptions): (req: Request) => Promise<Response>;
//# sourceMappingURL=index.d.ts.map