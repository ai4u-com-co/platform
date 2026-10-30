export interface Identity {
    tenantId: string;
    userId?: string;
    roles?: string[];
    allowedModules?: string[] | null;
    displayName?: string;
    /** App para la que se emitió la sesión (mc-sso >= 1.3.0). undefined = sesión "legacy". */
    serviceId?: string;
}
/**
 * Restricciones de app/tenant sobre la sesión (se pasan tal cual a `readMcSession` de mc-sso).
 * El secreto de firma se comparte entre apps: sin estas opciones una cookie de otra app/tenant
 * con firma válida PASA. Son opt-in; ver "Cómo adoptar el endurecimiento de auth" en CHANGELOG.
 */
export interface IdentityScope {
    /** `serviceId` de ESTA app (el mismo de su `createMcAuthHandler`). Sesión de otro servicio => null. */
    serviceId?: string;
    /** Tenants aceptados (apps de un solo tenant). Fuera de la lista => null; `[]` rechaza todo. */
    allowedTenants?: readonly string[];
    /** Normalizador de tenant para comparar `allowedTenants` (p. ej. `normalizeTenant` de @ai4u/config). */
    normalizeTenant?: (tenantId: string) => string;
    /** Aceptar sesiones sin `serviceId` (emitidas por mc-sso <= 1.2.0). Default de mc-sso: true. */
    acceptLegacy?: boolean;
}
export interface SessionAuthConfig extends IdentityScope {
    /** Nombre de la cookie de sesión (default "mc_session"). */
    cookieName?: string;
    /** Secreto de firma (default process.env.MISSION_CONTROL_SECRET). */
    secret?: string;
}
/**
 * Fija el alcance de identidad por defecto de ESTA app (una vez, p. ej. en instrumentation.ts o
 * en un módulo de config). Las opciones pasadas a `readIdentity`/`withApiHandler({sessionAuth})`
 * lo pisan campo a campo. No se deriva nada de `SERVICE_ID`: puede no coincidir con el serviceId
 * de su handler SSO y cortaría sesiones válidas.
 */
export declare function configureIdentity(scope: IdentityScope): void;
type HeaderCarrier = {
    headers: {
        get(name: string): string | null;
    };
};
/** Lee y verifica la identidad del usuario desde la cookie de sesión. null si no hay/no es válida. */
export declare function readIdentity(req: HeaderCarrier, cfg?: SessionAuthConfig): Identity | null;
export declare function isModuleAllowed(moduleId: string, allowedModules: string[] | null | undefined): boolean;
/**
 * Variante ESTRICTA: sin lista (null/undefined/[]) => NINGÚN módulo. Úsala en apps que no son
 * Mission Control, donde una sesión sin `allowedModules` no debería ver todo.
 */
export declare function isModuleAllowedStrict(moduleId: string, allowedModules: string[] | null | undefined): boolean;
export declare function hasRole(identity: Identity | null, role: string): boolean;
export declare function isAdmin(identity: Identity | null): boolean;
/**
 * Exige identidad y acceso a un módulo (acepta varios: any-of). Lanza errores
 * tipados que el wrapper HTTP convierte en 401/403 uniformes.
 */
export declare function requireModule(identity: Identity | null, moduleId: string | string[], opts?: {
    strict?: boolean;
}): Identity;
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