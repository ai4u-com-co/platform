import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { getLogger, redactSecrets } from "../src/logger"

beforeAll(() => {
  process.env.LOG_FORMAT = "json"
})
afterEach(() => vi.restoreAllMocks())

describe("correos fail-closed", () => {
  it("unicode en la parte local", () => {
    expect(redactSecrets("rechazado: ñandú@ejemplo.com")).toBe("rechazado: [correo]@ejemplo.com")
  })
  it("local de 100 caracteres", () => {
    const local = "x".repeat(100)
    expect(redactSecrets(`to ${local}@ejemplo.com ok`)).toBe("to [correo]@ejemplo.com ok")
  })
  it("dominio IDN: se oculta todo (no es ASCII normal)", () => {
    expect(redactSecrets("a@münchen.de")).toBe("[correo]")
  })
  it("localhost e IP conservan el dominio", () => {
    expect(redactSecrets("user@localhost")).toBe("[correo]@localhost")
    expect(redactSecrets("user@192.168.0.1")).toBe("[correo]@192.168.0.1")
  })
  it("puntuación final fuera del dominio, y entre delimitadores", () => {
    expect(redactSecrets("(ana@x.com), <b@y.org>; 'c@z.co'.")).toBe("([correo]@x.com), <[correo]@y.org>; '[correo]@z.co'.")
    expect(redactSecrets("falló para ana@x.com.")).toBe("falló para [correo]@x.com.")
  })
  it("falsos positivos aceptados: pkg@1.2.3 y git@github.com", () => {
    expect(redactSecrets("foo@1.2.3")).toBe("[correo]@1.2.3")
    expect(redactSecrets("git@github.com:org/r.git")).toBe("[correo]@github.com:org/r.git")
  })
  it("no rompe rutas de paquetes con scope", () => {
    const s = "at /app/node_modules/@scope/pkg/dist/index.js:1:1"
    expect(redactSecrets(s)).toBe(s)
  })
  it("idempotente", () => {
    const once = redactSecrets("ñandú@ejemplo.com a@münchen.de x@localhost https://h/p?token=1")
    expect(redactSecrets(once)).toBe(once)
  })
})

describe("parámetros por sufijo y query de URL", () => {
  it("nombres con sufijo sensible, dentro y fuera de URLs", () => {
    for (const n of [
      "api_key", "auth_token", "private_key", "client_secret", "x-amz-signature", "sig",
      "session", "credential", "passwd", "pass", "auth", "password", "X-Goog-Signature",
    ]) {
      expect(redactSecrets(`GET /p?${n}=FAKEVALUE&z=2`), n).toBe(`GET /p?${n}=[redacted]&z=2`)
      expect(redactSecrets(`falló ${n}=FAKEVALUE fin`), n).toBe(`falló ${n}=[redacted] fin`)
    }
  })
  it("enmascara la query ENTERA de URLs y conserva el path", () => {
    expect(redactSecrets("request to https://api.test/v1/items?id=5&page=2#f failed")).toBe(
      "request to https://api.test/v1/items?[redacted]#f failed",
    )
    expect(redactSecrets("(see http://h/p?a=1)")).toBe("(see http://h/p?[redacted])")
    const once = redactSecrets("https://h/p?a=1&b=2")
    expect(redactSecrets(once)).toBe(once)
  })
  it("texto normal idéntico", () => {
    const s = "Error: ECONNRESET en /api/items/42 tras 3 intentos, status=500 retry=2"
    expect(redactSecrets(s)).toBe(s)
  })
})

describe("rendimiento fail-closed (< 200 ms)", () => {
  it("cadenas patológicas", () => {
    const cases: Record<string, string> = {
      arrobas: "a@".repeat(100_000),
      aes: "a".repeat(200_000),
      locales60: ("a".repeat(60) + "@").repeat(3_000),
      dominios: "a@b.".repeat(50_000),
      xigual: "x=".repeat(100_000),
      qigual: "?a=".repeat(80_000),
      racha: "abcdefghij".repeat(10_000),
      https: "http://".repeat(30_000),
      httpsq: "http://a?".repeat(30_000),
      sufijo: "token".repeat(40_000),
    }
    const slow: string[] = []
    for (const [name, s] of Object.entries(cases)) {
      const t0 = performance.now()
      redactSecrets(s)
      const ms = performance.now() - t0
      console.log(`perf fc ${name}: ${ms.toFixed(1)} ms`)
      if (ms >= 200) slow.push(`${name}=${ms.toFixed(0)}ms`)
    }
    expect(slow).toEqual([])
  })
})

describe("integración", () => {
  it("getLogger().error({ err }) no deja correo, query ni parámetros", () => {
    const lines: string[] = []
    const impl = (c: unknown) => (lines.push(String(c)), true)
    vi.spyOn(process.stderr, "write").mockImplementation(impl as never)
    const err = new Error("rechazado ñandú.largo@ejemplo.com en https://api.test/v1/x?auth_token=FAKESECRET&u=1 session=FAKESESS")
    getLogger("fc").error({ err }, "falló")
    const out = lines.join("")
    expect(out).not.toContain("ñandú")
    expect(out).not.toContain("FAKESECRET")
    expect(out).not.toContain("FAKESESS")
    const rec = JSON.parse(out.trim().split("\n").pop()!)
    expect(rec.err.message).toBe(
      "rechazado [correo]@ejemplo.com en https://api.test/v1/x?[redacted] session=[redacted]",
    )
  })
})
