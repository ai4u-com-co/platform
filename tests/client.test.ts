import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  installClientErrorReporter,
  reportClientError,
  __resetClientErrorReporter,
  CLIENT_ERROR_MAX_PER_SESSION,
  CLIENT_ERROR_DEDUPE_MS,
} from "../src/client"

type Handler = (e: unknown) => void
let handlers: Record<string, Handler[]>
let beacon: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>
let win: Record<string, unknown>

beforeEach(() => {
  vi.useFakeTimers()
  __resetClientErrorReporter()
  handlers = {}
  win = {
    addEventListener: vi.fn((type: string, h: Handler) => {
      ;(handlers[type] ??= []).push(h)
    }),
  }
  beacon = vi.fn(() => true)
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  vi.stubGlobal("window", win)
  vi.stubGlobal("location", { pathname: "/ventas", search: "?token=abc", hash: "#x" })
  vi.stubGlobal("navigator", { sendBeacon: beacon })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function sentBody(i = 0): Promise<Record<string, unknown>> {
  const blob = beacon.mock.calls[i][1] as Blob
  return JSON.parse(await blob.text())
}

describe("installClientErrorReporter", () => {
  it("es idempotente: no duplica listeners", () => {
    installClientErrorReporter()
    installClientErrorReporter()
    expect(handlers.error).toHaveLength(1)
    expect(handlers.unhandledrejection).toHaveLength(1)
  })

  it("reporta window error con sendBeacon, solo pathname, sin querystring", async () => {
    installClientErrorReporter({ service: "mi-app" })
    handlers.error[0]({ target: win, error: new Error("boom"), message: "boom" })
    expect(beacon).toHaveBeenCalledWith("/api/client-error", expect.any(Blob))
    const body = await sentBody()
    expect(body).toMatchObject({ message: "boom", kind: "error", path: "/ventas", service: "mi-app" })
    expect(JSON.stringify(body)).not.toContain("token=abc")
  })

  it("reporta unhandledrejection (reason no-Error)", async () => {
    installClientErrorReporter()
    handlers.unhandledrejection[0]({ reason: "rechazada" })
    expect((await sentBody()).kind).toBe("unhandledrejection")
  })

  it("ignora errores de carga de recursos y ruido conocido", () => {
    installClientErrorReporter()
    handlers.error[0]({ target: { tagName: "IMG" }, message: "x" })
    handlers.error[0]({ target: win, message: "Script error." })
    handlers.error[0]({ target: win, message: "ResizeObserver loop limit exceeded" })
    expect(beacon).not.toHaveBeenCalled()
  })

  it("deduplica la misma firma dentro de 60 s y la vuelve a enviar después", () => {
    installClientErrorReporter()
    const e = new Error("igual")
    expect(reportClientError(e)).toBe(true)
    expect(reportClientError(e)).toBe(false)
    vi.advanceTimersByTime(CLIENT_ERROR_DEDUPE_MS + 1)
    expect(reportClientError(e)).toBe(true)
    expect(beacon).toHaveBeenCalledTimes(2)
  })

  it("limita a 5 reportes por sesión", () => {
    for (let i = 0; i < 10; i++) reportClientError(new Error(`distinto ${i}`))
    expect(beacon).toHaveBeenCalledTimes(CLIENT_ERROR_MAX_PER_SESSION)
  })

  it("trunca mensaje (2000) y stack (4000)", async () => {
    const e = new Error("m".repeat(5000))
    e.stack = "s".repeat(9000)
    reportClientError(e)
    const body = await sentBody()
    expect((body.message as string).length).toBe(2000)
    expect((body.stack as string).length).toBe(4000)
  })

  it("cae a fetch keepalive si sendBeacon no existe o devuelve false", () => {
    beacon.mockReturnValue(false)
    reportClientError(new Error("a"))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/client-error",
      expect.objectContaining({ method: "POST", keepalive: true }),
    )
  })

  it("usa el endpoint configurado y filtra extra a escalares", async () => {
    installClientErrorReporter({ endpoint: "/api/x" })
    reportClientError(new Error("b"), { digest: "d1", n: 3, obj: {} as never, nada: undefined })
    expect(beacon.mock.calls[0][0]).toBe("/api/x")
    expect((await sentBody()).extra).toEqual({ digest: "d1", n: 3 })
  })

  it("nunca lanza aunque el transporte falle", () => {
    beacon.mockImplementation(() => {
      throw new Error("x")
    })
    fetchMock.mockImplementation(() => {
      throw new Error("y")
    })
    expect(() => reportClientError(new Error("c"))).not.toThrow()
  })
})
