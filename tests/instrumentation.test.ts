import { describe, it, expect, vi, afterEach } from "vitest"
import { onRequestError } from "../src/instrumentation"
import * as logger from "../src/logger"

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.NEXT_RUNTIME
})

function spies() {
  const error = vi.fn()
  vi.spyOn(logger, "getLogger").mockReturnValue({ error } as never)
  const flush = vi.spyOn(logger, "flushLogs").mockResolvedValue()
  return { error, flush }
}

const request = {
  path: "/api/pedidos?token=SECRETO",
  method: "POST",
  headers: { cookie: "mc_session=SECRETO", authorization: "Bearer SECRETO" },
}
const context = { routerKind: "App Router", routeType: "route", routePath: "/api/pedidos", revalidateReason: undefined }

describe("onRequestError", () => {
  it("registra a nivel error con ruta/método/contexto/digest y hace flush", async () => {
    const { error, flush } = spies()
    process.env.NEXT_RUNTIME = "nodejs"
    const err = Object.assign(new Error("fallo render"), { digest: "abc123" })
    await onRequestError(err, request, context)
    expect(error).toHaveBeenCalledTimes(1)
    const [fields, msg] = error.mock.calls[0]
    expect(msg).toBe("onRequestError")
    expect(fields).toMatchObject({
      err,
      path: "/api/pedidos",
      method: "POST",
      routerKind: "App Router",
      routeType: "route",
      routePath: "/api/pedidos",
      digest: "abc123",
    })
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it("nunca filtra headers, cookies ni querystring", async () => {
    const { error } = spies()
    await onRequestError(new Error("x"), request, context)
    const dump = JSON.stringify(error.mock.calls[0][0], (_k, v) => (v instanceof Error ? v.message : v))
    expect(dump).not.toContain("SECRETO")
    expect(error.mock.calls[0][0]).not.toHaveProperty("headers")
  })

  it("es no-op fuera del runtime Node (Edge)", async () => {
    const { error, flush } = spies()
    process.env.NEXT_RUNTIME = "edge"
    await onRequestError(new Error("x"), request, context)
    expect(error).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it("no lanza si el logger o el flush fallan", async () => {
    spies()
    vi.spyOn(logger, "flushLogs").mockRejectedValue(new Error("ingest caído"))
    await expect(onRequestError(new Error("x"), request, context)).resolves.toBeUndefined()
  })

  it("tolera errores no-Error y contexto parcial", async () => {
    const { error } = spies()
    await onRequestError("texto", { path: "/", method: "GET" }, {})
    expect(error).toHaveBeenCalledTimes(1)
  })
})
