import { describe, it, expect, vi, afterEach } from "vitest"
import { createClientErrorHandler } from "../src/client-errors"
import * as logger from "../src/logger"

afterEach(() => vi.restoreAllMocks())

const good = { message: "boom", kind: "error", path: "/ventas?x=1", stack: "Error: boom\n  at a" }

function req(body: unknown, headers: Record<string, string> = {}, method = "POST"): Request {
  return new Request("https://app.example.com/api/client-error", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.com",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  })
}

function spies() {
  const error = vi.fn()
  vi.spyOn(logger, "getLogger").mockReturnValue({ error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never)
  const flush = vi.spyOn(logger, "flushLogs").mockResolvedValue()
  return { error, flush }
}

describe("createClientErrorHandler", () => {
  it("registra a nivel error, component client, responde 204 vacío y hace flush", async () => {
    const { error, flush } = spies()
    const res = await createClientErrorHandler()(req(good))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe("")
    expect(logger.getLogger).toHaveBeenCalledWith("client")
    expect(error).toHaveBeenCalledTimes(1)
    const [fields, msg] = error.mock.calls[0]
    expect(fields).toMatchObject({ category: "client", kind: "error", path: "/ventas" })
    expect(fields.err).toBeInstanceOf(Error)
    expect(msg).toContain("boom")
    expect(flush).toHaveBeenCalled()
  })

  it("rechaza método distinto de POST (405)", async () => {
    const { error } = spies()
    expect((await createClientErrorHandler()(req(null, {}, "GET"))).status).toBe(405)
    expect(error).not.toHaveBeenCalled()
  })

  it("rechaza content-type que no es JSON (415)", async () => {
    const { error } = spies()
    const res = await createClientErrorHandler()(req("x", { "content-type": "text/plain" }))
    expect(res.status).toBe(415)
    expect(error).not.toHaveBeenCalled()
  })

  it("rechaza cuerpos mayores que maxBytes (413), por content-length y por tamaño real", async () => {
    const { error } = spies()
    const h = createClientErrorHandler({ maxBytes: 100 })
    const big = { ...good, message: "x".repeat(500) }
    expect((await h(req(big))).status).toBe(413)
    expect((await h(req(big, { "content-length": "9999" }))).status).toBe(413)
    expect(error).not.toHaveBeenCalled()
  })

  it("exige mismo origen (403): cross-site, Origin ajeno o sin ninguna señal", async () => {
    const { error } = spies()
    const h = createClientErrorHandler()
    expect((await h(req(good, { "sec-fetch-site": "cross-site" }))).status).toBe(403)
    expect((await h(req(good, { origin: "https://evil.com", "sec-fetch-site": "" }))).status).toBe(403)
    const bare = new Request("https://app.example.com/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(good),
    })
    expect((await h(bare)).status).toBe(403)
    expect(error).not.toHaveBeenCalled()
  })

  it("valida la forma (400) sin registrar", async () => {
    const { error } = spies()
    const h = createClientErrorHandler()
    expect((await h(req("no-json{"))).status).toBe(400)
    expect((await h(req({ ...good, kind: "fatal" }))).status).toBe(400)
    expect((await h(req({ ...good, message: 5 }))).status).toBe(400)
    expect((await h(req([]))).status).toBe(400)
    expect(error).not.toHaveBeenCalled()
  })

  it("limita por IP (429) tras maxPerMinute", async () => {
    spies()
    const h = createClientErrorHandler({ maxPerMinute: 2 })
    const r = () => h(req(good, { "x-forwarded-for": "1.2.3.4" }))
    expect((await r()).status).toBe(204)
    expect((await r()).status).toBe(204)
    expect((await r()).status).toBe(429)
    expect((await h(req(good, { "x-forwarded-for": "5.6.7.8" }))).status).toBe(204)
  })

  it("sanea y trunca: control chars, longitudes, extra con claves sensibles", async () => {
    const { error } = spies()
    await createClientErrorHandler({ maxBytes: 100_000 })(
      req({
        message: "a\u0000b\u0007" + "m".repeat(5000),
        stack: "s".repeat(9000),
        kind: "manual",
        path: "/p?token=1#h",
        service: "svc",
        extra: { digest: "d", authToken: "SECRETO", "mala clave": "x", n: 2, o: { a: 1 } },
      }),
    )
    const [fields] = error.mock.calls[0]
    const err = fields.err as Error
    expect(err.message.length).toBe(2000)
    expect(err.message).not.toContain("\u0000")
    expect(err.stack!.length).toBe(4000)
    expect(fields.path).toBe("/p")
    expect(fields.clientExtra).toEqual({ digest: "d", n: 2 })
  })

  it("no deja que el cliente fije nivel/service/component del log", async () => {
    const { error } = spies()
    await createClientErrorHandler()(req({ ...good, level: "DEBUG", component: "x", service: "svc" }))
    const [fields] = error.mock.calls[0]
    expect(fields).not.toHaveProperty("level")
    expect(fields).not.toHaveProperty("component")
    expect(fields).not.toHaveProperty("service")
    expect(fields.clientService).toBe("svc")
  })
})
