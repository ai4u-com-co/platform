"use strict";
/**
 * Comparación de secretos apta para Edge Runtime / middleware / navegador (Web Crypto).
 *
 * Este archivo NO puede importar nada de `node:*`: lo consume
 * `@ai4u/platform/security/edge` desde middleware/proxy de Next.js.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeEqualEdge = safeEqualEdge;
function isUsable(v) {
    return typeof v === "string" && v.length > 0;
}
/**
 * Compara dos secretos en tiempo constante usando Web Crypto: hashea ambos con SHA-256
 * (así el largo de la entrada no se filtra) y compara los 32 bytes sin salida temprana.
 *
 * `undefined`, `null` y `""` nunca son iguales a nada (devuelve `false`): un secreto
 * vacío o no configurado jamás autentica.
 */
async function safeEqualEdge(a, b) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error("[@ai4u/platform] safeEqualEdge: Web Crypto (crypto.subtle) no está disponible en este runtime.");
    const valid = isUsable(a) && isUsable(b);
    const enc = new TextEncoder();
    // Se hashea siempre (también las entradas inválidas, como "") para no ramificar el trabajo.
    const [ha, hb] = await Promise.all([
        subtle.digest("SHA-256", enc.encode(isUsable(a) ? a : "")),
        subtle.digest("SHA-256", enc.encode(isUsable(b) ? b : "")),
    ]);
    const x = new Uint8Array(ha);
    const y = new Uint8Array(hb);
    let diff = 0;
    for (let i = 0; i < x.length; i++)
        diff |= x[i] ^ y[i];
    return valid && diff === 0;
}
