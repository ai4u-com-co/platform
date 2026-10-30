/**
 * Versión de @ai4u/platform, emitida como `platformVersion` en cada línea de log (permite medir
 * qué versión corre cada app en platform_logs). Se mantiene a mano junto a `version` de
 * package.json; tests/platform-version.test.ts falla si se desincronizan (un import de
 * package.json no compila con `rootDir: src`).
 */
export const PLATFORM_VERSION = "0.8.0"
