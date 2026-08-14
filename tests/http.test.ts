import { describe, it, expect, vi } from "vitest"
import { withApiHandler } from "../src/http"
import { ValidationError } from "../src/errors"
import * as logger from "../src/logger"

describe("withApiHandler", () => {
  it("dispara el flush de logs tras responder (regresión: scheduleFlush no debe tragarse el error del import dinámico roto)", async () => {
    const flushSpy = vi.spyOn(logger, "flushLogs").mockResolvedValue()
    const route = withApiHandler(async () => ({ ok: true }))
    await route(new Request("https://x/api/test"))
    expect(flushSpy).toHaveBeenCalledTimes(1)
    flushSpy.mockRestore()
  })

  it("envuelve un resultado en JSON 200 con x-request-id", async () => {
    const route = withApiHandler(async () => ({ hello: "world" }))
    const res = await route(new Request("https://x/api/test"))
    expect(res.status).toBe(200)
    expect(res.headers.get("x-request-id")).toBeTruthy()
    expect(await res.json()).toEqual({ hello: "world" })
  })

  it("propaga el x-request-id entrante (trazabilidad entre capas)", async () => {
    const route = withApiHandler(async (_req, ctx) => ({ rid: ctx.requestId }))
    const res = await route(new Request("https://x/api/test", { headers: { "x-request-id": "trace-123" } }))
    expect(res.headers.get("x-request-id")).toBe("trace-123")
    expect((await res.json()).rid).toBe("trace-123")
  })

  it("clasifica AppError → respuesta uniforme con status/code/category", async () => {
    const route = withApiHandler(async () => {
      throw new ValidationError("falta el campo nombre")
    })
    const res = await route(new Request("https://x/api/test", { headers: { "x-request-id": "r1" } }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: "falta el campo nombre",
      code: "VALIDATION_FAILED",
      category: "validation",
      requestId: "r1",
    })
  })

  it("error inesperado → 500 infraestructura, nunca silencioso", async () => {
    const route = withApiHandler(async () => {
      throw new Error("boom")
    })
    const res = await route(new Request("https://x/api/test"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.category).toBe("infrastructure")
    expect(body.code).toBe("UNEXPECTED_ERROR")
  })

  it("requireModule sin sesión → 401", async () => {
    const route = withApiHandler(async () => ({ ok: true }), { requireModule: "kpis" })
    const res = await route(new Request("https://x/api/test"))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe("UNAUTHORIZED")
  })

  it("respeta una Response construida por el handler y le añade x-request-id", async () => {
    const route = withApiHandler(async () => new Response("raw", { status: 201 }))
    const res = await route(new Request("https://x/api/test", { headers: { "x-request-id": "r2" } }))
    expect(res.status).toBe(201)
    expect(res.headers.get("x-request-id")).toBe("r2")
    expect(await res.text()).toBe("raw")
  })

  describe("clasificación de log según status de una Response explícita (no lanzada)", () => {
    function spyLogger() {
      const spies = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() }
      const getLoggerSpy = vi.spyOn(logger, "getLogger").mockReturnValue(spies as unknown as logger.Logger)
      return { spies, getLoggerSpy }
    }

    // Regresión: un handler que hace `return NextResponse.json({...}, {status: 500})`
    // nunca lanza excepción, así que antes del fix quedaba logueado como INFO y era
    // invisible para paneles/automatizaciones que filtran por level=ERROR.
    it("Response con status 500 (sin throw) → log.error, nunca log.info", async () => {
      const { spies, getLoggerSpy } = spyLogger()
      const route = withApiHandler(async () => new Response(null, { status: 500 }))
      await route(new Request("https://x/api/test"))
      expect(spies.error).toHaveBeenCalledTimes(1)
      expect(spies.error.mock.calls[0][0]).toMatchObject({ status: 500 })
      expect(spies.info).not.toHaveBeenCalled()
      expect(spies.warn).not.toHaveBeenCalled()
      getLoggerSpy.mockRestore()
    })

    it("Response con status 404 (sin throw) → log.warn, nunca log.info ni log.error", async () => {
      const { spies, getLoggerSpy } = spyLogger()
      const route = withApiHandler(async () => new Response(null, { status: 404 }))
      await route(new Request("https://x/api/test"))
      expect(spies.warn).toHaveBeenCalledTimes(1)
      expect(spies.warn.mock.calls[0][0]).toMatchObject({ status: 404 })
      expect(spies.info).not.toHaveBeenCalled()
      expect(spies.error).not.toHaveBeenCalled()
      getLoggerSpy.mockRestore()
    })

    it("Response con status 200 (sin throw) → log.info, sin regresión del caso feliz", async () => {
      const { spies, getLoggerSpy } = spyLogger()
      const route = withApiHandler(async () => new Response(null, { status: 200 }))
      await route(new Request("https://x/api/test"))
      expect(spies.info).toHaveBeenCalledTimes(1)
      expect(spies.info.mock.calls[0][0]).toMatchObject({ status: 200 })
      expect(spies.warn).not.toHaveBeenCalled()
      expect(spies.error).not.toHaveBeenCalled()
      getLoggerSpy.mockRestore()
    })
  })
})
