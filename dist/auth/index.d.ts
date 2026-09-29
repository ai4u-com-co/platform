export interface Identity {
    tenantId: string;
    userId?: string;
    roles?: string[];
    allowedModules?: string[] | null;
    displayName?: string;
}
export interface SessionAuthConfig {
    /** Nombre de la cookie de sesión (default "mc_session"). */
    cookieName?: string;
    /** Secreto de firma (default process.env.MISSION_CONTROL_SECRET). */
    secret?: string;
}
type HeaderCarrier = {
    headers: {
        get(name: string): string | null;
    };
};
/** Lee y verifica la identidad del usuario desde la cookie de sesión. null si no hay/no es válida. */
export declare function readIdentity(req: HeaderCarrier, cfg?: SessionAuthConfig): Identity | null;
export declare function isModuleAllowed(moduleId: string, allowedModules: string[] | null | undefined): boolean;
export declare function hasRole(identity: Identity | null, role: string): boolean;
export declare function isAdmin(identity: Identity | null): boolean;
/**
 * Exige identidad y acceso a un módulo (acepta varios: any-of). Lanza errores
 * tipados que el wrapper HTTP convierte en 401/403 uniformes.
 */
export declare function requireModule(identity: Identity | null, moduleId: string | string[]): Identity;
export declare function requireRole(identity: Identity | null, role: string | string[]): Identity;
export interface ServiceAuthConfig {
    /** Secreto compartido aceptado en x-mc-secret (default process.env.MISSION_CONTROL_SECRET). */
    sharedSecret?: string;
    /**
     * Secretos adicionales aceptados en x-mc-secret, además de `sharedSecret`.
     * Permite rotar sin downtime: durante la migración, el caller pasa el valor
     * viejo Y el nuevo aquí, y ambos autentican hasta que se retire el viejo.
     */
    sharedSecrets?: string[];
    /** API keys válidas por tenant: { tamaprint: "key...", flexoimpresos: "key..." }. */
    apiKeys?: Record<string, string>;
}
export interface ServiceAuthResult {
    ok: boolean;
    /** tenant resuelto cuando la auth fue por X-API-Key por tenant. */
    tenantId?: string;
}
/** Valida auth de servicio (x-mc-secret o X-API-Key). Compara con `safeEqual` (SHA-256 + timingSafeEqual). */
export declare function verifyServiceRequest(req: HeaderCarrier, cfg?: ServiceAuthConfig): ServiceAuthResult;
export {};
//# sourceMappingURL=index.d.ts.map