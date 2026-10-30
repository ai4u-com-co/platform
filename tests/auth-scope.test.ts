import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createSession } from "@ai4u/mc-sso"

const SECRET = "test-secret-auth-scope-0123456789abcdef"

function reqWith(token: string | null): Request {
  return new Request("https://x/api/test", { headers: token ? { cookie: `mc_session=${token}` } : {} })
}
const session = (tenant: string, serviceId?: string, modules?: string[] | null) =>
  createSession(tenant, SECRET, 60_000, { userId: "u1", roles: ["admin"], allowedModules: modules, serviceId })

// Cada test carga un módulo fresco: el WARN "una vez por proceso" y configureIdentity son estado de módulo.
async function load() {
  vi.resetModules()
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("@ai4u/platform/identity")]
  const logger = await import("../src/logger")
  const warn = vi.fn()
  vi.spyOn(logger, "getLogger").mockReturnValue({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never)
  const auth = await import("../src/auth")
  return { auth, warn }
}

beforeEach(() => {
  delete process.env.SERVICE_ID
})
afterEach(() => vi.restoreAllMocks())

describe("P2 readIdentity con serviceId / allowedTenants / acceptLegacy", () => {
  it("expone serviceId de la sesión en Identity", async () => {
    const { auth } = await load()
    const id = auth.readIdentity(reqWith(session("flexoimpresos", "kpis")), { secret: SECRET })
    expect(id?.serviceId).toBe("kpis")
  })

  it("serviceId distinto al de la sesión => null (cookie de otra app)", async () => {
    const { auth } = await load()
    const t = session("flexoimpresos", "otra-app")
    expect(auth.readIdentity(reqWith(t), { secret: SECRET, serviceId: "kpis" })).toBeNull()
    expect(auth.readIdentity(reqWith(t), { secret: SECRET, serviceId: "otra-app" })?.tenantId).toBe("flexoimpresos")
  })

  it("allowedTenants rechaza otro tenant y [] es fail-closed", async () => {
    const { auth } = await load()
    const t = session("tamaprint", "kpis")
    expect(auth.readIdentity(reqWith(t), { secret: SECRET, allowedTenants: ["flexoimpresos"] })).toBeNull()
    expect(auth.readIdentity(reqWith(t), { secret: SECRET, allowedTenants: [] })).toBeNull()
    expect(auth.readIdentity(reqWith(t), { secret: SECRET, allowedTenants: ["Tamaprint"] })?.tenantId).toBe("tamaprint")
  })

  it("acceptLegacy:false rechaza sesiones sin serviceId; por defecto se aceptan", async () => {
    const { auth } = await load()
    const legacy = session("flexoimpresos")
    expect(auth.readIdentity(reqWith(legacy), { secret: SECRET })?.serviceId).toBeUndefined()
    expect(auth.readIdentity(reqWith(legacy), { secret: SECRET, acceptLegacy: false })).toBeNull()
  })

  it("SIN opciones el comportamiento no cambia, aunque SERVICE_ID del entorno no coincida", async () => {
    process.env.SERVICE_ID = "no-coincide-con-el-handler-sso"
    const { auth } = await load()
    const id = auth.readIdentity(reqWith(session("flexoimpresos", "kpis")), { secret: SECRET })
    expect(id?.tenantId).toBe("flexoimpresos")
  })

  it("configureIdentity fija el default de la app; las opciones por llamada lo pisan", async () => {
    const { auth } = await load()
    auth.configureIdentity({ serviceId: "kpis", allowedTenants: ["flexoimpresos"] })
    expect(auth.readIdentity(reqWith(session("flexoimpresos", "otra")), { secret: SECRET })).toBeNull()
    expect(auth.readIdentity(reqWith(session("tamaprint", "kpis")), { secret: SECRET })).toBeNull()
    expect(auth.readIdentity(reqWith(session("flexoimpresos", "kpis")), { secret: SECRET })?.serviceId).toBe("kpis")
    expect(
      auth.readIdentity(reqWith(session("flexoimpresos", "otra")), { secret: SECRET, serviceId: "otra" }),
    ).not.toBeNull()
  })

  it("emite UN solo WARN por proceso cuando no hay serviceId configurado", async () => {
    const { auth, warn } = await load()
    auth.readIdentity(reqWith(session("flexoimpresos", "kpis")), { secret: SECRET })
    auth.readIdentity(reqWith(session("flexoimpresos", "kpis")), { secret: SECRET })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("no emite WARN si serviceId está configurado (por opción o por configureIdentity)", async () => {
    const a = await load()
    a.auth.readIdentity(reqWith(session("flexoimpresos", "kpis")), { secret: SECRET, serviceId: "kpis" })
    expect(a.warn).not.toHaveBeenCalled()
    const b = await load()
    b.auth.configureIdentity({ serviceId: "kpis" })
    b.auth.readIdentity(reqWith(session("flexoimpresos", "kpis")), { secret: SECRET })
    expect(b.warn).not.toHaveBeenCalled()
  })
})

describe("P2 modo estricto de módulos (null/[] = ninguno)", () => {
  it("isModuleAllowed conserva la semántica actual y isModuleAllowedStrict la invierte", async () => {
    const { auth } = await load()
    expect(auth.isModuleAllowed("kpis", null)).toBe(true)
    expect(auth.isModuleAllowed("kpis", [])).toBe(true)
    expect(auth.isModuleAllowedStrict("kpis", null)).toBe(false)
    expect(auth.isModuleAllowedStrict("kpis", undefined)).toBe(false)
    expect(auth.isModuleAllowedStrict("kpis", [])).toBe(false)
    expect(auth.isModuleAllowedStrict("kpis", ["kpis"])).toBe(true)
    expect(auth.isModuleAllowedStrict("kpis", ["otro"])).toBe(false)
  })

  it("requireModule({strict:true}) lanza 403 con allowedModules null; sin strict pasa", async () => {
    const { auth } = await load()
    const id = { tenantId: "t", allowedModules: null }
    expect(auth.requireModule(id, "kpis")).toBe(id)
    expect(() => auth.requireModule(id, "kpis", { strict: true })).toThrow(/módulo/)
    expect(auth.requireModule({ tenantId: "t", allowedModules: ["kpis"] }, ["x", "kpis"], { strict: true })).toBeTruthy()
  })
})

describe("P2 withApiHandler({ strictModules })", () => {
  it("con strictModules una sesión sin allowedModules => 403; sin la opción pasa (compat)", async () => {
    vi.resetModules()
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("@ai4u/platform/identity")]
    const { withApiHandler } = await import("../src/http")
    const req = () => reqWith(session("flexoimpresos", "kpis", null))
    const strict = withApiHandler(async () => ({ ok: true }), {
      requireModule: "kpis",
      strictModules: true,
      sessionAuth: { secret: SECRET, serviceId: "kpis" },
    })
    expect((await strict(req())).status).toBe(403)
    const lax = withApiHandler(async () => ({ ok: true }), {
      requireModule: "kpis",
      sessionAuth: { secret: SECRET, serviceId: "kpis" },
    })
    expect((await lax(req())).status).toBe(200)
  })
})
