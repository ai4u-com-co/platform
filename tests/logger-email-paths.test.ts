import { describe, it, expect, vi, afterEach } from "vitest"
import { getLogger, redactSecrets } from "../src/logger"

afterEach(() => vi.restoreAllMocks())

describe("correos: '@' como frontera y rutas", () => {
  it("'@' antes del correo no lo esconde", () => {
    expect(redactSecrets("@alice@example.com")).toBe("[correo]@example.com")
    expect(redactSecrets("a@b@alice@example.com")).toBe("[correo]@example.com")
    expect(redactSecrets("to=@ana@x.com")).toBe("[correo]@x.com")
    expect(redactSecrets("x=@alice@example.com y")).toBe("[correo]@example.com y")
  })

  it("correo precedido de ruta: se enmascara la parte local", () => {
    expect(redactSecrets("https://host/ana@example.com")).toBe("https://host/[correo]@example.com")
    expect(redactSecrets("/ana@example.com/x")).toBe("/[correo]@example.com/x")
  })

  it("paquetes npm con scope quedan intactos", () => {
    for (const s of [
      "/app/node_modules/@scope/pkg/index.js:12:5",
      "/@types/node/index.d.ts",
      "node_modules/@ai4u/platform/dist/logger/index.js:80:3",
      "Cannot find module '@types/node'",
    ]) {
      expect(redactSecrets(s), s).toBe(s)
    }
  })

  it("correo tras una ruta con scope: se enmascara el correo, no la ruta", () => {
    expect(redactSecrets("/app/node_modules/@scope/pkg/mail@cliente.com")).toBe(
      "/app/node_modules/@scope/pkg/[correo]@cliente.com",
    )
    expect(redactSecrets("/@scope/pkg/x@example.com")).toBe("/@scope/pkg/[correo]@example.com")
    expect(redactSecrets("ana@example.com/@scope/pkg")).toBe("[correo]@example.com/@scope/pkg")
  })

  it("fuera de una ruta clara, la racha completa es parte local (sin fuga de 'a/')", () => {
    expect(redactSecrets("a/b@x.com")).toBe("[correo]@x.com")
    expect(redactSecrets("ana/perez@x.com")).toBe("[correo]@x.com")
    expect(redactSecrets("x:a/b@x.com")).toBe("x:[correo]@x.com")
    expect(redactSecrets("falló para ana/perez@x.com.")).toBe("falló para [correo]@x.com.")
  })

  it("prefijos de ruta claros conservan lo que precede", () => {
    expect(redactSecrets("./dir/ana@x.com")).toBe("./dir/[correo]@x.com")
    expect(redactSecrets("../dir/ana@x.com")).toBe("../dir/[correo]@x.com")
    expect(redactSecrets("~/dir/ana@x.com")).toBe("~/dir/[correo]@x.com")
    expect(redactSecrets("node_modules/pkg/ana@x.com")).toBe("node_modules/pkg/[correo]@x.com")
  })

  it("'@' suelto (menciones) no cambia, e idempotencia", () => {
    expect(redactSecrets("hola @user y @ solo")).toBe("hola @user y @ solo")
    for (const s of [
      "@alice@example.com", "a@b@alice@example.com", "https://host/ana@example.com",
      "/app/node_modules/@scope/pkg/mail@cliente.com", "x@y.com/z@w.com", "a@münchen.de/q",
    ]) {
      const once = redactSecrets(s)
      expect(redactSecrets(once), s).toBe(once)
    }
  })

  it("rendimiento (< 200 ms)", () => {
    const cases: Record<string, string> = {
      arroba_a: "@a".repeat(100_000),
      barra_a_arroba: "/a@".repeat(60_000),
      arroba_barra: "@/".repeat(100_000),
      a_barra_arroba: "a/@".repeat(30_000),
      arrobas: "@".repeat(200_000),
      scopes: "/@s/p".repeat(40_000),
    }
    const slow: string[] = []
    for (const [name, s] of Object.entries(cases)) {
      const t0 = performance.now()
      redactSecrets(s)
      const ms = performance.now() - t0
      console.log(`perf ep ${name}: ${ms.toFixed(1)} ms`)
      if (ms >= 200) slow.push(`${name}=${ms.toFixed(0)}ms`)
    }
    expect(slow).toEqual([])
  })

  it("integración: getLogger().error({ err }) con '@' delante", () => {
    const lines: string[] = []
    const impl = (c: unknown) => (lines.push(String(c)), true)
    vi.spyOn(process.stderr, "write").mockImplementation(impl as never)
    process.env.LOG_FORMAT = "json"
    getLogger("ep").error({ err: new Error("to=@fake.persona@cliente.example") }, "falló")
    expect(lines.join("")).not.toContain("fake.persona")
  })
})
