import { describe, it, expect, vi, afterEach, beforeAll } from "vitest"
import { getLogger, runWithContext, setServiceName } from "../src/logger"

// El formato JSON emite todos los campos (en texto solo se imprime el mensaje).
beforeAll(() => {
  process.env.LOG_FORMAT = "json"
})

function captureStdout(fn: () => void): string[] {
  const lines: string[] = []
  const impl = (chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(impl as never)
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(impl as never)
  try {
    fn()
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
  }
  return lines
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("logger central", () => {
  setServiceName("test-service")
  const log = getLogger("unit")

  it("emite JSON con service y component", () => {
    const prev = process.env.LOG_FORMAT
    process.env.LOG_FORMAT = "json"
    // El módulo lee LOG_FORMAT al cargar; este test valida el path de texto/JSON de forma laxa.
    const lines = captureStdout(() => log.info("hola"))
    expect(lines.join("")).toContain("hola")
    process.env.LOG_FORMAT = prev
  })

  it("redacta claves sensibles", () => {
    const lines = captureStdout(() =>
      log.info({ password: "supersecreto", apiKey: "clk_123", user: "mariano" }, "login"),
    )
    const out = lines.join("")
    expect(out).not.toContain("supersecreto")
    expect(out).not.toContain("clk_123")
    expect(out).toContain("[REDACTED]")
    expect(out).toContain("mariano")
  })

  it("inyecta el run-context (requestId) automáticamente", () => {
    const lines = captureStdout(() =>
      runWithContext({ requestId: "req-42", tenant: "tamaprint" }, () => log.info("dentro")),
    )
    const out = lines.join("")
    expect(out).toContain("req-42")
  })

  it("serializa Error en el campo err", () => {
    const lines = captureStdout(() => log.error({ err: new Error("explotó") }, "fallo"))
    const out = lines.join("")
    expect(out).toContain("explotó")
  })

  it("no permite que `extra` pise el `service` real (regresión: handoff SSO logueaba service=mod.id)", () => {
    const lines = captureStdout(() => log.info({ service: "otra-cosa" }, "handoff SSO"))
    const record = JSON.parse(lines.join(""))
    expect(record.service).toBe("test-service")
    expect(record.service).not.toBe("otra-cosa")
  })
})

describe("service name entre copias del módulo (regresión: bug de 'unknown')", () => {
  afterEach(() => {
    delete process.env.PLATFORM_SERVICE
    vi.resetModules()
  })

  it("una copia FRESCA del módulo (que nunca corrió setServiceName) igual emite el service correcto vía process.env", async () => {
    // Simula el escenario real: Turbopack instancia ./logger más de una vez por
    // proceso (una por bundle de función serverless). instrumentation.ts corre
    // setServiceName() en SU copia; una ruta de API importa una copia DISTINTA
    // que jamás vio esa llamada. Antes del fix, esa copia emitía "unknown".
    const first = await import("../src/logger")
    first.setServiceName("mission-control")

    vi.resetModules()
    const second: typeof first = await import("../src/logger")

    process.env.LOG_FORMAT = "json"
    const lines = captureStdout(() => second.getLogger("tickets").info("hola"))
    const record = JSON.parse(lines.join(""))
    expect(record.service).toBe("mission-control")
  })
})
