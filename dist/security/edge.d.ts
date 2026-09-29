/**
 * Comparación de secretos apta para Edge Runtime / middleware / navegador (Web Crypto).
 *
 * Este archivo NO puede importar nada de `node:*`: lo consume
 * `@ai4u/platform/security/edge` desde middleware/proxy de Next.js.
 */
type Secretish = string | null | undefined;
/**
 * Compara dos secretos en tiempo constante usando Web Crypto: hashea ambos con SHA-256
 * (así el largo de la entrada no se filtra) y compara los 32 bytes sin salida temprana.
 *
 * `undefined`, `null` y `""` nunca son iguales a nada (devuelve `false`): un secreto
 * vacío o no configurado jamás autentica.
 */
export declare function safeEqualEdge(a: Secretish, b: Secretish): Promise<boolean>;
export {};
//# sourceMappingURL=edge.d.ts.map