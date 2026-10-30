import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type Logger = typeof import("../src/logger")
let lines: string[]
async function fresh(): Promise<Logger> {
  vi.resetModules()
  return (await import("../src/logger")) as Logger
}
beforeEach(() => {
  process.env.LOG_FORMAT = "json"
  process.env.LOG_LEVEL = "DEBUG"
  delete process.env.PLATFORM_INGEST_URL
  delete process.env.INGEST_SECRET
  lines = []
  const sink = ((c: unknown) => (lines.push(String(c)), true)) as never
  vi.spyOn(process.stdout, "write").mockImplementation(sink)
  vi.spyOn(process.stderr, "write").mockImplementation(sink)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete process.env.PLATFORM_INGEST_URL
  delete process.env.INGEST_SECRET
})
const records = () => lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

describe("M3 buffers y colecciones grandes en extras", () => {
  it("Buffer/typed arrays se resumen y no se expanden por índice", async () => {
    const { getLogger } = await fresh()
    const t = Date.now()
    getLogger("c").info({ buf: Buffer.alloc(200_000), u8: new Uint8Array(5000) }, "m")
    expect(Date.now() - t).toBeLessThan(1000)
    const r = records()[0]
    expect(r.buf).toBe("[Buffer 200000 bytes]")
    expect(r.u8).toBe("[Uint8Array 5000 bytes]")
    expect(lines.join("").length).toBeLessThan(2000)
  })

  it("arrays y objetos con muchos elementos se truncan a 100 con marcador", async () => {
    const { getLogger } = await fresh()
    const big: Record<string, number> = {}
    for (let i = 0; i < 500; i++) big["k" + i] = i
    getLogger("c").info({ arr: Array.from({ length: 1000 }, (_, i) => i), big }, "m")
    const r = records()[0]
    expect(r.arr).toHaveLength(101)
    expect(r.arr[100]).toContain("…[truncado]")
    expect(Object.keys(r.big).length).toBeLessThanOrEqual(101)
    expect(JSON.stringify(r.big)).toContain("…[truncado]")
  })
})

describe("M4 el logging nunca lanza por un extra hostil", () => {
  it("un Proxy que lanza en ownKeys y un getter que lanza no rompen log.info", async () => {
    const { getLogger } = await fresh()
    const proxy = new Proxy({}, { ownKeys() { throw new Error("boom") } })
    const getter = { get bad(): string { throw new Error("getter") } }
    expect(() => getLogger("c").info({ proxy }, "uno")).not.toThrow()
    expect(() => getLogger("c").info(getter, "dos")).not.toThrow()
    const rs = records()
    expect(rs).toHaveLength(2)
    expect(rs[0].msg).toBe("uno")
    expect(JSON.stringify(rs[0])).toContain("_sanitizeFailed")
    expect(rs[1].msg).toBe("dos")
  })
})

describe("B1 claves de conteo de tokens no se enmascaran", () => {
  it("max_tokens, inputTokens, tokens_used y bypass se conservan; los secretos siguen enmascarados", async () => {
    const { getLogger } = await fresh()
    getLogger("c").info(
      { usage: { max_tokens: 100, inputTokens: 5, tokens_used: 3, output_tokens: 9, bypass: "si" },
        access_token: "s", apiToken: "s", refresh_token: "s", password: "p", userPass: "p", pass: "p", session_token: "s", token: "s" },
      "m",
    )
    const r = records()[0]
    expect(r.usage).toEqual({ max_tokens: 100, inputTokens: 5, tokens_used: 3, output_tokens: 9, bypass: "si" })
    for (const k of ["access_token", "apiToken", "refresh_token", "password", "userPass", "pass", "session_token", "token"]) {
      expect(r[k], k).toBe("[REDACTED]")
    }
  })
})

describe("M6 circuit breaker del flush", () => {
  it("tras 3 fallos consecutivos flushLogs deja de golpear al ingest durante el enfriamiento y luego reintenta", async () => {
    process.env.PLATFORM_INGEST_URL = "http://ingest.test/x"
    process.env.INGEST_SECRET = "s"
    const f = vi.fn(async () => { throw new Error("caído") })
    vi.stubGlobal("fetch", f)
    const { getLogger, flushLogs } = await fresh()
    getLogger("c").error("a")
    for (let i = 0; i < 6; i++) await flushLogs()
    expect(f).toHaveBeenCalledTimes(3)
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + 6000)
    await flushLogs()
    expect(f).toHaveBeenCalledTimes(4)
  })

  it("un éxito reinicia el contador", async () => {
    process.env.PLATFORM_INGEST_URL = "http://ingest.test/x"
    process.env.INGEST_SECRET = "s"
    let n = 0
    const f = vi.fn(async () => { n++; if (n <= 2) throw new Error("x"); return new Response("ok") })
    vi.stubGlobal("fetch", f)
    const { getLogger, flushLogs } = await fresh()
    getLogger("c").error("a")
    for (let i = 0; i < 4; i++) await flushLogs()
    expect(f).toHaveBeenCalledTimes(3) // 2 fallos + 1 éxito; luego buffer vacío
    getLogger("c").error("b")
    await flushLogs()
    expect(f).toHaveBeenCalledTimes(4)
  })
})

describe("B1 fail-closed: claves pass* y *token*", () => {
  const MASKED = ["password", "Password", "PASSWORD", "passwd", "pass", "userPass", "userpass", "PASS", "db_pass", "dbpass", "pass_word", "x-pass",
    "token", "tokens", "accessToken", "refresh_token", "secretTokens", "accessTokensList", "my_tokens", "authTokens", "apiToken", "csrfToken", "idToken"]
  const KEPT = ["bypass", "compass", "passenger", "passive", "passthrough", "max_tokens", "inputTokens", "tokens_used", "completionTokens",
    "maxTokens", "tokensUsed", "total_tokens", "cached_tokens", "reasoning_tokens", "tokens_remaining"]

  it("se enmascaran las claves sensibles", async () => {
    const { getLogger } = await fresh()
    getLogger("c").info({ n: Object.fromEntries(MASKED.map((k) => [k, "valor"])) }, "m")
    const n = records()[0].n
    for (const k of MASKED) expect(n[k], k).toBe("[REDACTED]")
  })

  it("se conservan las palabras seguras y los conteos de tokens", async () => {
    const { getLogger } = await fresh()
    getLogger("c").info({ n: Object.fromEntries(KEPT.map((k) => [k, 7])) }, "m")
    const n = records()[0].n
    for (const k of KEPT) expect(n[k], k).toBe(7)
  })
})
