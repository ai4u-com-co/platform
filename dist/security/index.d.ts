export { safeEqualEdge } from "./edge";
type Secretish = string | null | undefined;
/**
 * Compara dos secretos en tiempo constante (Node): SHA-256 de ambos +
 * `crypto.timingSafeEqual`, así tolera largos distintos sin filtrarlos.
 *
 * `undefined`, `null` y `""` nunca son iguales a nada (devuelve `false`): un secreto
 * vacío o no configurado jamás autentica.
 */
export declare function safeEqual(a: Secretish, b: Secretish): boolean;
//# sourceMappingURL=index.d.ts.map