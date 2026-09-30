export declare const GATEWAY_IDENTITY_HEADER = "x-ai4u-identity";
export declare const GATEWAY_OIDC_AUDIENCE = "https://sap-b1-backend.ai4u";
/** Tope por defecto al intercambio de audiencia: no sumar latencia perceptible a cada llamada. */
export declare const GATEWAY_IDENTITY_TIMEOUT_MS = 1500;
/** Logger mínimo aceptado (el `Logger` de `@ai4u/platform/logger` lo cumple). */
export interface GatewayIdentityLogger {
    warn: (fields: Record<string, unknown>, msg: string) => void;
    debug: (fields: Record<string, unknown>, msg: string) => void;
}
export interface GatewayIdentityOptions {
    /** Tope al intercambio del token, en ms. Default 1500. */
    timeoutMs?: number;
    /** Fuente del token (tests / runtimes especiales). Default: `getVercelOidcToken` de `@vercel/oidc`. */
    getToken?: (opts: {
        audience: string;
    }) => Promise<string>;
    /** Logger para el aviso de "sin token". Default: `getLogger("gateway-identity")`. */
    logger?: GatewayIdentityLogger;
}
/**
 * Headers de identidad para el gateway: `{ "x-ai4u-identity": <token> }` o `{}`.
 * Nunca lanza.
 */
export declare function getGatewayIdentityHeaders(opts?: GatewayIdentityOptions): Promise<Record<string, string>>;
//# sourceMappingURL=index.d.ts.map