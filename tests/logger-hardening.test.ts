import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * P3 (platform 0.8.0): redacción de msg/extras, claves reservadas, timeout y flush del transporte,
 * x-request-id hostil. Cada test usa un módulo logger fresco (el transporte es estado de módulo).
 */
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

describe("P3 redacción de msg y extras", () => {
  it("msg y extras anidados no salen con Bearer, token ni correo", async () => {
    const { getLogger } = await fresh()
    getLogger("c").error(
      { headers: { authorization: "Bearer abcdefgh12345678" }, nested: { deep: { url: "https://a.com/x?key=ZZZSECRET99" } }, list: ["token=abcdef123456"] },
      "token=abcdef123456 mail ana@x.com",
    )
    const out = lines.join("")
    expect(out).not.toContain("abcdefgh12345678")
    expect(out).not.toContain("abcdef123456")
    expect(out).not.toContain("ana@x.com")
    expect(out).not.toContain("ZZZSECRET99")
    expect(out).toContain("[correo]@x.com")
  })

  it("claves sensibles anidadas se enmascaran y no se rompe con objetos circulares", async () => {
    const { getLogger } = await fresh()
    const circ: Record<string, unknown> = { password: "p4ss", ok: 1 }
    circ.self = circ
    expect(() => getLogger("c").info({ circ, a: { b: { c: { d: { e: { f: "deep" } } } } } }, "m")).not.toThrow()
    const r = records()[0]
    expect(r.circ.password).toBe("[REDACTED]")
    expect(r.circ.ok).toBe(1)
  })
})

describe("P3 claves reservadas no pisables por extras", () => {
  it("el contexto manda sobre tenant/userId/requestId/service pasados como extras", async () => {
    const { getLogger, runWithContext, setServiceName } = await fresh()
    setServiceName("svc-real")
    runWithContext({ tenant: "real", userId: "u-real", requestId: "rid-real" }, () =>
      getLogger("c").info({ tenant: "fake", userId: "u-fake", requestId: "rid-fake", service: "fake" }, "m"),
    )
    expect(records()[0]).toMatchObject({ tenant: "real", userId: "u-real", requestId: "rid-real", service: "svc-real" })
  })

  it("sin contexto, un extra tenant sigue siendo informativo (no se pierde)", async () => {
    const { getLogger } = await fresh()
    getLogger("c").info({ tenant: "t1" }, "m")
    expect(records()[0].tenant).toBe("t1")
  })
})

describe("P3 transporte al ingest", () => {
  function setup(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
    process.env.PLATFORM_INGEST_URL = "http://ingest.test/x"
    process.env.INGEST_SECRET = "s"
    const f = vi.fn(fetchImpl)
    vi.stubGlobal("fetch", f)
    return f
  }

  it("el fetch lleva una señal de timeout (AbortSignal)", async () => {
    const f = setup(async () => new Response("ok"))
    const { getLogger, flushLogs } = await fresh()
    getLogger("c").error("uno")
    await flushLogs()
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it("un ingest colgado no retiene la respuesta más allá del timeout", async () => {
    setup((_u, init) =>
      new Promise((_res, rej) => {
        // Sin señal de timeout el fetch nunca termina (ingest colgado).
        init.signal?.addEventListener("abort", () => rej(new Error("aborted")))
      }),
    )
    const { getLogger, flushLogs } = await fresh()
    getLogger("c").error("uno")
    const t = Date.now()
    await flushLogs()
    expect(Date.now() - t).toBeLessThan(3500)
  }, 10_000)

  it("un flush concurrente ESPERA al que está en vuelo (no retorna con buffer vacío)", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const f = setup(async () => (await gate, new Response("ok")))
    const { getLogger, flushLogs } = await fresh()
    getLogger("c").error("A")
    const p1 = flushLogs()
    let done2 = false
    const p2 = flushLogs().then(() => (done2 = true)) // buffer vacío, pero hay un envío en curso
    await new Promise((r) => setTimeout(r, 30))
    expect(done2).toBe(false)
    release()
    await Promise.all([p1, p2])
    expect(done2).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it("si el envío falla, el lote se reencola y se reenvía en el siguiente flush", async () => {
    let n = 0
    const f = setup(async () => {
      n++
      if (n === 1) throw new Error("ingest caído")
      return new Response("ok")
    })
    const { getLogger, flushLogs } = await fresh()
    getLogger("c").error("perdible")
    await flushLogs()
    await flushLogs()
    expect(f).toHaveBeenCalledTimes(2)
    expect(String(f.mock.calls[1][1].body)).toContain("perdible")
  })

  it("el reencolado tiene tope: no crece sin límite con el ingest caído", async () => {
    const f = setup(async () => new Response("no", { status: 503 }))
    const { getLogger, flushLogs } = await fresh()
    const log = getLogger("c")
    for (let i = 0; i < 3000; i++) log.error(`m${i}`)
    await flushLogs()
    await flushLogs()
    const last = JSON.parse(String(f.mock.calls.at(-1)![1].body)).logs as unknown[]
    expect(last.length).toBeLessThanOrEqual(1000)
    expect(last.length).toBeGreaterThan(200) // se retuvo lo pendiente (antes: el lote se perdía)
  })
})

describe("P3 x-request-id entrante", () => {
  async function ridFor(value: string): Promise<string> {
    vi.resetModules()
    const { withApiHandler } = await import("../src/http")
    const res = await withApiHandler(async () => ({}))(new Request("https://x/a", { headers: { "x-request-id": value } }))
    return res.headers.get("x-request-id")!
  }

  it("un id de 5000 caracteres se regenera", async () => {
    const rid = await ridFor("A".repeat(5000))
    expect(rid.length).toBeLessThanOrEqual(128)
    expect(rid).not.toContain("AAAAAAAAAA")
  })

  it("un id con caracteres fuera de [A-Za-z0-9._-] se regenera", async () => {
    expect(await ridFor("abc def")).not.toBe("abc def")
    expect(await ridFor("a<script>")).not.toBe("a<script>")
  })

  it("un id válido (trace-123, uuid, con punto) se conserva", async () => {
    expect(await ridFor("trace-123")).toBe("trace-123")
    expect(await ridFor("0b8f2c1e-aaaa.bbbb_cc")).toBe("0b8f2c1e-aaaa.bbbb_cc")
  })
})
