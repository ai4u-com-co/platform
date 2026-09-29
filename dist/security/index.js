"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeEqualEdge = void 0;
exports.safeEqual = safeEqual;
/**
 * Comparación de secretos en tiempo constante.
 *
 *   import { safeEqual } from "@ai4u/platform/security"           // Node (route handlers, backends)
 *   import { safeEqualEdge } from "@ai4u/platform/security/edge"  // middleware / Edge Runtime
 *
 * Nunca compares secretos con `===`: la comparación de strings sale en el primer
 * carácter distinto y filtra por tiempo cuánto del secreto adivinó el atacante.
 */
const node_crypto_1 = require("node:crypto");
var edge_1 = require("./edge");
Object.defineProperty(exports, "safeEqualEdge", { enumerable: true, get: function () { return edge_1.safeEqualEdge; } });
function isUsable(v) {
    return typeof v === "string" && v.length > 0;
}
function sha256(v) {
    return (0, node_crypto_1.createHash)("sha256").update(v, "utf8").digest();
}
/**
 * Compara dos secretos en tiempo constante (Node): SHA-256 de ambos +
 * `crypto.timingSafeEqual`, así tolera largos distintos sin filtrarlos.
 *
 * `undefined`, `null` y `""` nunca son iguales a nada (devuelve `false`): un secreto
 * vacío o no configurado jamás autentica.
 */
function safeEqual(a, b) {
    const valid = isUsable(a) && isUsable(b);
    const equal = (0, node_crypto_1.timingSafeEqual)(sha256(isUsable(a) ? a : ""), sha256(isUsable(b) ? b : ""));
    return valid && equal;
}
