import { describe, it, expect, vi, afterEach } from "vitest"
import { runJob } from "../src/jobs"
import * as logger from "../src/logger"

afterEach(() => vi.restoreAllMocks())

function mkLog() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() } as unknown as logger.Logger & {
    error: ReturnType<typeof vi.fn>
    info: ReturnType<typeof vi.fn>
  }
}

describe("runJob", () => {
  it("éxito: devuelve el resultado, registra inicio/fin con duración y hace flush", async () => {
    const flush = vi.spyOn(logger, "flushLogs").mockResolvedValue()
    const log = mkLog()
    const res = await runJob("sync", async () => ({ ok: 3, errors: 0 }), { log })
    expect(res).toEqual({ ok: 3, errors: 0 })
    expect(log.error).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledTimes(2)
    expect(log.info.mock.calls[1][0]).toMatchObject({ job: "sync", durationMs: expect.any(Number) })
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("excepción: log.error con err y job, relanza y hace flush", async () => {
    const flush = vi.spyOn(logger, "flushLogs").mockResolvedValue()
    const log = mkLog()
    const boom = new Error("boom")
    await expect(runJob("sync", () => Promise.reject(boom), { log })).rejects.toBe(boom)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0][0]).toMatchObject({ err: boom, job: "sync" })
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("rethrow:false devuelve undefined tras registrar y hacer flush", async () => {
    const flush = vi.spyOn(logger, "flushLogs").mockResolvedValue()
    const log = mkLog()
    const res = await runJob("sync", () => Promise.reject(new Error("x")), { log, rethrow: false })
    expect(res).toBeUndefined()
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("resultado con errors > 0 registra log.error con resumen sin cambiar lo devuelto", async () => {
    vi.spyOn(logger, "flushLogs").mockResolvedValue()
    const log = mkLog()
    const result = { procesados: 10, errors: 2 }
    const res = await runJob("sync", async () => result, { log })
    expect(res).toBe(result)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0][0]).toMatchObject({ job: "sync", errorCount: 2, procesados: 10 })
  })

  it("acepta `errores` como array y muestrea mensajes", async () => {
    vi.spyOn(logger, "flushLogs").mockResolvedValue()
    const log = mkLog()
    await runJob("sync", async () => ({ errores: [new Error("e1"), "e2"] }), { log })
    expect(log.error.mock.calls[0][0]).toMatchObject({ errorCount: 2, sample: ["e1", "e2"] })
  })

  it("los logs dentro de fn heredan requestId y job del contexto", async () => {
    vi.spyOn(logger, "flushLogs").mockResolvedValue()
    let ctx: logger.RunContext = {}
    await runJob("sync", async () => { ctx = logger.getContext() }, { log: mkLog() })
    expect(ctx.job).toBe("sync")
    expect(ctx.requestId).toBeTruthy()
  })

  it("usa getLogger('job') por defecto", async () => {
    vi.spyOn(logger, "flushLogs").mockResolvedValue()
    const log = mkLog()
    const g = vi.spyOn(logger, "getLogger").mockReturnValue(log)
    await runJob("sync", async () => 1)
    expect(g).toHaveBeenCalledWith("job")
  })
})
