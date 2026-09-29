/**
 * Comparación de secretos en tiempo constante.
 *
 *   import { safeEqual } from "@ai4u/platform/security"           // Node (route handlers, backends)
 *   import { safeEqualEdge } from "@ai4u/platform/security/edge"  // middleware / Edge Runtime
 *
 * Nunca compares secretos con `===`: la comparación de strings sale en el primer
 * carácter distinto y filtra por tiempo cuánto del secreto adivinó el atacante.
 */
import { createHash, timingSafeEqual } from "node:crypto"

export { safeEqualEdge } from "./edge"

type Secretish = string | null | undefined

function isUsable(v: Secretish): v is string {
  return typeof v === "string" && v.length > 0
}

function sha256(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest()
}

/**
 * Compara dos secretos en tiempo constante (Node): SHA-256 de ambos +
 * `crypto.timingSafeEqual`, así tolera largos distintos sin filtrarlos.
 *
 * `undefined`, `null` y `""` nunca son iguales a nada (devuelve `false`): un secreto
 * vacío o no configurado jamás autentica.
 */
export function safeEqual(a: Secretish, b: Secretish): boolean {
  const valid = isUsable(a) && isUsable(b)
  const equal = timingSafeEqual(sha256(isUsable(a) ? a : ""), sha256(isUsable(b) ? b : ""))
  return valid && equal
}
