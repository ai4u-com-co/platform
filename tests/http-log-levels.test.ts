import { describe, it, expect, vi, afterEach } from "vitest"
import { withApiHandler } from "../src/http"
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, ExternalServiceError, AppError } from "../src/errors"
import * as logger from "../src/logger"

afterEach(() => vi.restoreAllMocks())

function spyLogger() {
  const spies = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() }
  vi.spyOn(logger, "getLogger").mockReturnValue(spies as unknown as logger.Logger)
  return spies
}

describe("P4 nivel de log de errores LANZADOS según status", () => {
  it.each([
    ["UnauthorizedError", () => new UnauthorizedError(), 401],
    ["ForbiddenError", () => new ForbiddenError(), 403],
    ["NotFoundError", () => new NotFoundError(), 404],
    ["ValidationError", () => new ValidationError("x"), 400],
  ])("%s lanzado → log.warn, nunca log.error", async (_n, make, status) => {
    const spies = spyLogger()
    const res = await withApiHandler(async () => { throw make() })(new Request("https://x/a"))
    expect(res.status).toBe(status)
    expect(spies.warn).toHaveBeenCalledTimes(1)
    expect(spies.warn.mock.calls[0][0]).toMatchObject({ status })
    expect(spies.error).not.toHaveBeenCalled()
  })

  it("el warn de un 4xx lanzado no arrastra stack (campo err)", async () => {
    const spies = spyLogger()
    await withApiHandler(async () => { throw new UnauthorizedError() })(new Request("https://x/a"))
    expect(spies.warn.mock.calls[0][0]).not.toHaveProperty("err")
  })

  it.each([
    ["Error genérico", () => new Error("boom"), 500],
    ["ExternalServiceError", () => new ExternalServiceError("x"), 502],
    ["AppError 503 operacional", () => new AppError("x", "infrastructure", { httpStatus: 503 }), 503],
  ])("%s lanzado → log.error (5xx sigue en error)", async (_n, make, status) => {
    const spies = spyLogger()
    const res = await withApiHandler(async () => { throw make() })(new Request("https://x/a"))
    expect(res.status).toBe(status)
    expect(spies.error).toHaveBeenCalledTimes(1)
    expect(spies.error.mock.calls[0][0]).toMatchObject({ status })
    expect(spies.warn).not.toHaveBeenCalled()
  })

  it("M5: un 4xx NO operacional (bug inesperado) lanzado sigue en log.error con stack", async () => {
    const spies = spyLogger()
    const res = await withApiHandler(async () => {
      throw new AppError("estado imposible", "validation", { httpStatus: 400, isOperational: false })
    })(new Request("https://x/a"))
    expect(res.status).toBe(400)
    expect(spies.error).toHaveBeenCalledTimes(1)
    expect(spies.error.mock.calls[0][0]).toMatchObject({ status: 400 })
    expect(spies.warn).not.toHaveBeenCalled()
  })
})
