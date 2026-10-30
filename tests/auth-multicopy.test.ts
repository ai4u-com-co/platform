import { describe, it, expect, vi, afterEach } from "vitest"
import { createSession } from "@ai4u/mc-sso"

const SECRET = "test-secret-multicopy-0123456789abcdef"
const tok = (tenant: string, svc: string) => createSession(tenant, SECRET, 60_000, { serviceId: svc })
const req = (t: string) => new Request("https://x/a", { headers: { cookie: `mc_session=${t}` } })

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("@ai4u/platform/identity")]
})

describe("A1 estado de identidad compartido entre copias del módulo (Turbopack)", () => {
  it("configureIdentity en una copia lo ve la otra", async () => {
    vi.resetModules()
    const copyA = await import("../src/auth")
    vi.resetModules()
    const copyB = await import("../src/auth")
    expect(copyA).not.toBe(copyB)
    copyA.configureIdentity({ serviceId: "kpis", allowedTenants: ["flexoimpresos"] })
    expect(copyB.readIdentity(req(tok("flexoimpresos", "otra")), { secret: SECRET })).toBeNull()
    expect(copyB.readIdentity(req(tok("flexoimpresos", "kpis")), { secret: SECRET })?.serviceId).toBe("kpis")
  })

  it("el WARN sale una sola vez por proceso aunque haya dos copias", async () => {
    const warn = vi.fn()
    vi.resetModules()
    const lg1 = await import("../src/logger")
    vi.spyOn(lg1, "getLogger").mockReturnValue({ warn } as never)
    const copyA = await import("../src/auth")
    vi.resetModules()
    const lg2 = await import("../src/logger")
    vi.spyOn(lg2, "getLogger").mockReturnValue({ warn } as never)
    const copyB = await import("../src/auth")
    copyA.readIdentity(req(tok("t", "s")), { secret: SECRET })
    copyB.readIdentity(req(tok("t", "s")), { secret: SECRET })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
