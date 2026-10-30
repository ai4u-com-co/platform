import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { getLogger, redactSecrets } from "../src/logger"

beforeAll(() => {
  process.env.LOG_FORMAT = "json"
})
afterEach(() => vi.restoreAllMocks())

describe("redactSecrets: correos (PII)", () => {
  it("enmascara la parte local y conserva el dominio", () => {
    expect(redactSecrets("Recipient address rejected: ana.perez@cliente.com")).toBe(
      "Recipient address rejected: [correo]@cliente.com",
    )
    expect(redactSecrets("to <ana+facturas@mail.sub.cliente.com.co>")).toBe("to <[correo]@mail.sub.cliente.com.co>")
    expect(redactSecrets("Ana_P-1%x@Cliente.COM.")).toBe("[correo]@Cliente.COM.")
  })

  it("enmascara varios en una cadena", () => {
    expect(redactSecrets("a@x.com, bb@y.org; ccc@z.co")).toBe("[correo]@x.com, [correo]@y.org; [correo]@z.co")
  })

  it("es idempotente", () => {
    const once = redactSecrets("rechazado: ana@cliente.com y https://u:p@h.test/x")
    expect(redactSecrets(once)).toBe(once)
    expect(redactSecrets("[correo]@cliente.com")).toBe("[correo]@cliente.com")
  })

  it("deja IDÉNTICO el texto sin correos", () => {
    const s = "request to https://api.test/v1 failed @ 10:00 /node_modules/@scope/pkg/index.js"
    expect(redactSecrets(s)).toBe(s)
  })

  it("rendimiento en cadenas patológicas (< 200 ms)", () => {
    const cases: Record<string, string> = {
      arrobas: "a@".repeat(100_000),
      puntos: "a.".repeat(100_000),
      locales60: ("a".repeat(60) + "@").repeat(3_000),
      dominios: "a@b.".repeat(50_000),
    }
    const slow: string[] = []
    for (const [name, s] of Object.entries(cases)) {
      const t0 = performance.now()
      redactSecrets(s)
      const ms = performance.now() - t0
      console.log(`perf email ${name}: ${ms.toFixed(1)} ms`)
      if (ms >= 200) slow.push(`${name}=${ms.toFixed(0)}ms`)
    }
    expect(slow).toEqual([])
  })

  it("logger.error({ err }) no deja la parte local en message ni en stack", () => {
    const lines: string[] = []
    const impl = (c: unknown) => (lines.push(String(c)), true)
    vi.spyOn(process.stderr, "write").mockImplementation(impl as never)
    const err = new Error("Recipient address rejected: fake.persona@cliente.example")
    getLogger("email").error({ err }, "envío falló")
    const out = lines.join("")
    const rec = JSON.parse(out.trim().split("\n").pop()!)
    expect(rec.err.message).toBe("Recipient address rejected: [correo]@cliente.example")
    expect(out).not.toContain("fake.persona")
  })
})
