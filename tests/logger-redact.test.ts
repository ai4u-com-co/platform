import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { getLogger, redactSecrets } from "../src/logger"

// Todas las claves de este archivo son FALSAS y obvias (repo público).
const FAKE_GOOGLE = "AIzaFAKEFAKEFAKEFAKEFAKE0000"

beforeAll(() => {
  process.env.LOG_FORMAT = "json"
})
afterEach(() => vi.restoreAllMocks())

describe("redactSecrets", () => {
  it("enmascara parámetros de query sensibles conservando el nombre", () => {
    const url = "https://x.test/v1/a?foo=1&key=FAKE123&Api_Key=FAKE456#h"
    // En una URL completa se enmascara la query entera (el path se conserva).
    expect(redactSecrets(url)).toBe("https://x.test/v1/a?[redacted]#h")
    expect(redactSecrets("GET /p?foo=1&key=FAKE123&Api_Key=FAKE456#h")).toBe(
      "GET /p?foo=1&key=[redacted]&Api_Key=[redacted]#h",
    )
    for (const n of [
      "key", "api_key", "apikey", "access_token", "id_token", "refresh_token", "token",
      "signature", "sig", "secret", "client_secret", "password", "x-amz-signature",
      "x-goog-signature", "TOKEN",
    ]) {
      expect(redactSecrets(`GET /p?${n}=FAKEVALUE&z=2`)).toBe(`GET /p?${n}=[redacted]&z=2`)
    }
  })

  it("no toca parámetros cuyo nombre no termina en una palabra sensible", () => {
    expect(redactSecrets("GET /p?keyboard=2&q=token&page=3")).toBe("GET /p?keyboard=2&q=token&page=3")
    // Falso positivo conocido y aceptado (sufijo "key"): prioriza no filtrar.
    expect(redactSecrets("GET /p?monkey=1")).toBe("GET /p?monkey=[redacted]")
  })

  it("enmascara Bearer y Basic", () => {
    expect(redactSecrets("Authorization: Bearer abc123FAKEtoken.xyz")).toBe("Authorization: Bearer [redacted]")
    expect(redactSecrets("Authorization: Basic dXNlcjpwYXNzOkZBS0U=")).toBe("Authorization: Basic [redacted]")
    expect(redactSecrets("Basic authentication failed")).toBe("Basic authentication failed")
  })

  it("enmascara JWT", () => {
    const jwt = "eyJhbGciOiJGQUtFIn0.eyJzdWIiOiJmYWtlIn0.ZmFrZXNpZw"
    expect(redactSecrets(`token ${jwt} inválido`)).toBe("token [jwt] inválido")
  })

  it("enmascara formatos de clave conocidos", () => {
    const keys = [
      "sk-ant-FAKEFAKEFAKE1234", "sk-FAKEFAKE1234", "sb_secret_FAKEFAKE1234",
      "sb_publishable_FAKEFAKE1234", FAKE_GOOGLE, "ghp_" + "F".repeat(30),
      "github_pat_" + "F".repeat(30),
    ]
    for (const k of keys) {
      expect(redactSecrets(`fallo con ${k} al llamar`)).toBe("fallo con [redacted] al llamar")
    }
  })

  it("enmascara credenciales en URL", () => {
    expect(redactSecrets("connect https://user:FAKEPASS@db.test:5432/x")).toBe(
      "connect https://[redacted]@db.test:5432/x",
    )
  })

  it("deja IDÉNTICO el texto sin secretos", () => {
    const s = "request to https://api.test/v1/items failed, reason: ECONNRESET\n    at fetch (node:internal:1:1)"
    expect(redactSecrets(s)).toBe(s)
    expect(redactSecrets("")).toBe("")
  })

  it("es idempotente", () => {
    const s = `https://u:p@h/x?key=FAKE&a=1 Bearer FAKEFAKEFAKE ${FAKE_GOOGLE} sk-FAKEFAKE1234`
    const once = redactSecrets(s)
    expect(redactSecrets(once)).toBe(once)
  })

  it("no explota con cadenas largas que casi cuadran", () => {
    const inputs = [
      "?key".repeat(25_000), "Bearer ".repeat(15_000), "eyJ" + "a".repeat(100_000),
      "sk-".repeat(33_000), "https://" + "a:".repeat(50_000), "&token".repeat(16_000),
      "Basic " + "A".repeat(100_000),
    ]
    for (const s of inputs) {
      const t0 = performance.now()
      expect(typeof redactSecrets(s)).toBe("string")
      expect(performance.now() - t0).toBeLessThan(500)
    }
  })

  it("tiempo lineal con MUCHOS inicios de patrón (anti ReDoS cuadrático)", () => {
    let seed = 12345
    const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
    let rnd = ""
    for (let i = 0; i < 200_000; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      rnd += b64[seed % b64.length]
    }
    const cases: Record<string, string> = {
      jwt: "eyJaaaaa-".repeat(20_000),
      aiza: "AIza".repeat(30_000),
      ghp: "ghp_".repeat(30_000),
      sb: "sb_secret_".repeat(20_000),
      sk: "sk-aaaaaaaa-".repeat(15_000),
      bearer: "Bearer aaaaaaa ".repeat(10_000),
      basic: "Basic AAAAAAA ".repeat(10_000),
      urlcreds: "https://a:".repeat(15_000),
      query: "?key=&".repeat(30_000),
      random: rnd,
    }
    const slow: string[] = []
    for (const [name, s] of Object.entries(cases)) {
      const t0 = performance.now()
      redactSecrets(s)
      const ms = performance.now() - t0
      console.log(`perf ${name}: ${ms.toFixed(1)} ms`)
      if (ms >= 200) slow.push(`${name}=${ms.toFixed(0)}ms`)
    }
    expect(slow).toEqual([])
  })

  it("tokens gigantes se enmascaran completos (sin cabeza ni cola)", () => {
    const seg = (n: number) => "QXJZ7391".repeat(Math.ceil(n / 8)).slice(0, n)
    const jwt = `eyJ${seg(6000)}.${seg(100)}.${seg(100)}`
    expect(redactSecrets(`x ${jwt} y`)).toBe("x [jwt] y")
    const sk = `sk-${seg(2000)}`
    expect(redactSecrets(`x ${sk} y`)).toBe("x [redacted] y")
    for (const [pre, n] of [["AIza", 2000], ["ghp_", 2000], ["github_pat_", 2000], ["sb_secret_", 2000]] as const) {
      expect(redactSecrets(`x ${pre}${seg(n)} y`)).toBe("x [redacted] y")
    }
  })

  it("rendimiento extra: JWT con segmentos de 10 000 y repeticiones", () => {
    const seg = "A".repeat(10_000)
    const cases: Record<string, string> = {
      jwtlong: `eyJ${seg}.${seg}.${seg}`,
      jwtdots: "eyJaaaaa.bbbbbbb".repeat(10_000),
      eyj: "eyJ".repeat(60_000),
    }
    const slow: string[] = []
    for (const [name, s] of Object.entries(cases)) {
      const t0 = performance.now()
      redactSecrets(s)
      const ms = performance.now() - t0
      console.log(`perf ${name}: ${ms.toFixed(1)} ms`)
      if (ms >= 200) slow.push(`${name}=${ms.toFixed(0)}ms`)
    }
    expect(slow).toEqual([])
  })

  it("nunca lanza con entradas raras", () => {
    expect(() => redactSecrets(undefined as unknown as string)).not.toThrow()
  })
})

describe("logger.error({ err }) enmascara secretos", () => {
  it("no deja la clave en err.message ni en err.stack", () => {
    const lines: string[] = []
    const impl = (c: unknown) => (lines.push(String(c)), true)
    vi.spyOn(process.stderr, "write").mockImplementation(impl as never)
    vi.spyOn(process.stdout, "write").mockImplementation(impl as never)
    const err = new Error(`request to https://api.test/x?key=${FAKE_GOOGLE}&a=1 failed`)
    getLogger("redact").error({ err }, "falló")
    const rec = JSON.parse(lines.join("").trim().split("\n").pop()!)
    expect(rec.err.message).toBe("request to https://api.test/x?[redacted] failed")
    expect(rec.err.stack).not.toContain(FAKE_GOOGLE)
    expect(lines.join("")).not.toContain(FAKE_GOOGLE)
  })

  it("aplica el tope de longitud a message y stack", () => {
    const lines: string[] = []
    const impl = (c: unknown) => (lines.push(String(c)), true)
    vi.spyOn(process.stderr, "write").mockImplementation(impl as never)
    const err = new Error("x".repeat(1_000_000))
    err.stack = "s".repeat(1_000_000)
    getLogger("redact").error({ err }, "grande")
    const rec = JSON.parse(lines.join("").trim().split("\n").pop()!)
    expect(rec.err.message.length).toBe(16_384 + "…[truncado]".length)
    expect(rec.err.message.endsWith("…[truncado]")).toBe(true)
    expect(rec.err.stack.length).toBe(32_768 + "…[truncado]".length)
    expect(rec.err.stack.endsWith("…[truncado]")).toBe(true)
  })

  it("credencial a caballo del corte: ningún fragmento sobrevive (message y stack)", () => {
    const secret = "QXJZ7391".repeat(5)
    const grams = Array.from({ length: secret.length - 3 }, (_, i) => secret.slice(i, i + 4))
    const emit = (err: Error): string => {
      const lines: string[] = []
      const impl = (c: unknown) => (lines.push(String(c)), true)
      const spy = vi.spyOn(process.stderr, "write").mockImplementation(impl as never)
      getLogger("redact").error({ err }, "corte")
      spy.mockRestore()
      return lines.join("")
    }
    for (const lead of ["Bearer ", "sk-"]) {
      for (let d = -12; d <= 12; d++) {
        const start = (max: number) => max - 20 + d
        const mk = (max: number) => "a".repeat(start(max)) + " " + lead + secret + "b".repeat(max)
        const e1 = new Error(mk(16_384))
        const o1 = emit(e1)
        const e2 = new Error("m")
        e2.stack = mk(32_768)
        const o2 = emit(e2)
        for (const g of grams) {
          expect(o1.includes(g), `message ${lead} d=${d} ${g}`).toBe(false)
          expect(o2.includes(g), `stack ${lead} d=${d} ${g}`).toBe(false)
        }
      }
    }
  })

  it("también redacta cuando err no es un Error", () => {
    const lines: string[] = []
    const impl = (c: unknown) => (lines.push(String(c)), true)
    vi.spyOn(process.stderr, "write").mockImplementation(impl as never)
    getLogger("redact").error({ err: `fallo ?token=FAKESECRET` }, "falló")
    const out = lines.join("")
    expect(out).not.toContain("FAKESECRET")
    expect(out).toContain("token=[redacted]")
  })
})
