import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Logger } from "../src/logger"

// El token OIDC real solo existe dentro de un request en Vercel: se simula.
const getVercelOidcToken = vi.fn<(opts?: unknown) => Promise<string>>()
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: (opts?: unknown) => getVercelOidcToken(opts) }))

const logged: unknown[][] = []
const fakeLog = {
  debug: (...a: unknown[]) => logged.push(["debug", ...a]),
  info: (...a: unknown[]) => logged.push(["info", ...a]),
  warn: (...a: unknown[]) => logged.push(["warn", ...a]),
  error: (...a: unknown[]) => logged.push(["error", ...a]),
}

// Valores armados en runtime (no son secretos ni tokens reales).
const val = (...parts: string[]) => parts.join("-")
const fakeJwt = () => ["eyJ" + "hdr", "eyJ" + "pld", "sig"].join(".")

beforeEach(() => {
  vi.resetModules()
  getVercelOidcToken.mockReset()
  logged.length = 0
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// Tras vi.resetModules() el módulo carga una instancia NUEVA de ../src/logger: se espía esa.
async function load() {
  const fresh = await import("../src/logger")
  vi.spyOn(fresh, "getLogger").mockReturnValue(fakeLog as unknown as Logger)
  return import("../src/gateway-identity")
}

describe("constantes", () => {
  it("header y audiencia del gateway", async () => {
    const m = await load()
    expect(m.GATEWAY_IDENTITY_HEADER).toBe("x-ai4u-identity")
    expect(m.GATEWAY_OIDC_AUDIENCE).toBe("https://sap-b1-backend.ai4u")
    expect(m.GATEWAY_IDENTITY_TIMEOUT_MS).toBe(1500)
  })
})

describe("getGatewayIdentityHeaders", () => {
  it("importar el módulo NO pide el token (nada a nivel de módulo)", async () => {
    await load()
    expect(getVercelOidcToken).not.toHaveBeenCalled()
  })

  it("con token: devuelve x-ai4u-identity y pide la audiencia del gateway", async () => {
    const t = val("oidc", "tok")
    getVercelOidcToken.mockResolvedValue(t)
    const { getGatewayIdentityHeaders } = await load()
    expect(await getGatewayIdentityHeaders()).toEqual({ "x-ai4u-identity": t })
    expect(getVercelOidcToken).toHaveBeenCalledWith({ audience: "https://sap-b1-backend.ai4u" })
  })

  it("pide el token en CADA llamada (no lo guarda en variable de módulo)", async () => {
    getVercelOidcToken.mockResolvedValueOnce(val("a")).mockResolvedValueOnce(val("b"))
    const { getGatewayIdentityHeaders } = await load()
    expect(await getGatewayIdentityHeaders()).toEqual({ "x-ai4u-identity": "a" })
    expect(await getGatewayIdentityHeaders()).toEqual({ "x-ai4u-identity": "b" })
    expect(getVercelOidcToken).toHaveBeenCalledTimes(2)
  })

  it("si el intercambio falla: {} (fail-open), sin lanzar", async () => {
    getVercelOidcToken.mockRejectedValue(new Error("Failed to exchange token: boom"))
    const { getGatewayIdentityHeaders } = await load()
    await expect(getGatewayIdentityHeaders()).resolves.toEqual({})
  })

  it("si getToken lanza de forma síncrona: {} (fail-open), sin lanzar", async () => {
    const { getGatewayIdentityHeaders } = await load()
    const getToken = () => {
      throw new Error("sync boom")
    }
    await expect(getGatewayIdentityHeaders({ getToken })).resolves.toEqual({})
  })

  it("token vacío: {}", async () => {
    getVercelOidcToken.mockResolvedValue("")
    const { getGatewayIdentityHeaders } = await load()
    expect(await getGatewayIdentityHeaders()).toEqual({})
  })

  it("si el intercambio tarda más que el tope: {} a los 1.5 s, sin esperar", async () => {
    vi.useFakeTimers()
    getVercelOidcToken.mockReturnValue(new Promise<string>(() => {}))
    const { getGatewayIdentityHeaders, GATEWAY_IDENTITY_TIMEOUT_MS } = await load()
    const p = getGatewayIdentityHeaders()
    await vi.advanceTimersByTimeAsync(GATEWAY_IDENTITY_TIMEOUT_MS)
    await expect(p).resolves.toEqual({})
  })

  it("timeoutMs configurable", async () => {
    vi.useFakeTimers()
    getVercelOidcToken.mockReturnValue(new Promise<string>(() => {}))
    const { getGatewayIdentityHeaders } = await load()
    let settled = false
    const p = getGatewayIdentityHeaders({ timeoutMs: 200 }).then((r) => {
      settled = true
      return r
    })
    await vi.advanceTimersByTimeAsync(199)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(p).resolves.toEqual({})
    expect(logged.map((l) => [l[0], (l[1] as { reason: string }).reason])).toEqual([["debug", "timeout"]])
  })

  it("getToken inyectado reemplaza a @vercel/oidc y recibe la audiencia", async () => {
    const t = val("inj", "tok")
    const getToken = vi.fn(async () => t)
    const { getGatewayIdentityHeaders } = await load()
    expect(await getGatewayIdentityHeaders({ getToken })).toEqual({ "x-ai4u-identity": t })
    expect(getToken).toHaveBeenCalledWith({ audience: "https://sap-b1-backend.ai4u" })
    expect(getVercelOidcToken).not.toHaveBeenCalled()
  })

  it("logger inyectado reemplaza al logger de la plataforma", async () => {
    const own: unknown[][] = []
    const custom = {
      warn: (...a: unknown[]) => own.push(["warn", ...a]),
      debug: (...a: unknown[]) => own.push(["debug", ...a]),
    }
    getVercelOidcToken.mockRejectedValue(new Error("x"))
    const { getGatewayIdentityHeaders } = await load()
    await getGatewayIdentityHeaders({ logger: custom })
    expect(own.map((l) => l[0])).toEqual(["debug"])
    expect(logged).toEqual([])
  })

  it("un logger que lanza no rompe la llamada", async () => {
    const broken = {
      warn: () => {
        throw new Error("logger roto")
      },
      debug: () => {
        throw new Error("logger roto")
      },
    }
    getVercelOidcToken.mockRejectedValue(new Error("x"))
    const { getGatewayIdentityHeaders } = await load()
    await expect(getGatewayIdentityHeaders({ logger: broken })).resolves.toEqual({})
  })

  it("nunca registra el token, aunque venga dentro del mensaje de error", async () => {
    vi.stubEnv("VERCEL", "1")
    const jwt = fakeJwt()
    getVercelOidcToken.mockRejectedValue(new Error(`exchange failed for ${jwt}`))
    const { getGatewayIdentityHeaders } = await load()
    await getGatewayIdentityHeaders()
    expect(logged.length).toBeGreaterThan(0)
    expect(logged[0][0]).toBe("warn")
    expect(JSON.stringify(logged)).not.toContain(jwt)
    expect(JSON.stringify(logged)).toContain("[redacted]")
  })

  it("fuera de Vercel (local) solo registra a nivel debug", async () => {
    vi.stubEnv("VERCEL", "")
    getVercelOidcToken.mockRejectedValue(new Error("header missing"))
    const { getGatewayIdentityHeaders } = await load()
    await getGatewayIdentityHeaders()
    expect(logged.map((l) => l[0])).toEqual(["debug"])
  })

  it("en Vercel no inunda: 1 warn por minuto, el resto debug", async () => {
    vi.stubEnv("VERCEL", "1")
    getVercelOidcToken.mockRejectedValue(new Error("x"))
    const { getGatewayIdentityHeaders } = await load()
    await getGatewayIdentityHeaders()
    await getGatewayIdentityHeaders()
    expect(logged.map((l) => l[0])).toEqual(["warn", "debug"])
  })
})

describe("llamada al gateway con fetch", () => {
  it("sin token la llamada sale idéntica a hoy; con token solo suma el header", async () => {
    const calls: Array<Record<string, string>> = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init?.headers as Record<string, string>)
      return new Response("{}")
    })
    vi.stubGlobal("fetch", fetchMock)
    const { getGatewayIdentityHeaders } = await load()
    const s = val("mc", "s")
    const base = { "x-mc-secret": s, "x-consumer": "app-demo" }

    getVercelOidcToken.mockRejectedValue(new Error("no token"))
    await fetch("https://gw.example/api/v1/x", { headers: { ...base, ...(await getGatewayIdentityHeaders()) } })
    getVercelOidcToken.mockResolvedValue(val("oidc", "tok"))
    await fetch("https://gw.example/api/v1/x", { headers: { ...base, ...(await getGatewayIdentityHeaders()) } })

    expect(calls[0]).toEqual(base)
    expect(calls[1]).toEqual({ ...base, "x-ai4u-identity": "oidc-tok" })
    vi.unstubAllGlobals()
  })
})

describe("aislamiento del subpath", () => {
  it("el barrel raíz no re-exporta gateway-identity (no arrastra @vercel/oidc)", () => {
    const barrel = readFileSync(resolve(__dirname, "../src/index.ts"), "utf8")
    const stmts = barrel.split("\n").filter((l) => /^\s*(export|import)\b/.test(l))
    expect(stmts.length).toBeGreaterThan(0)
    expect(stmts.join("\n")).not.toMatch(/gateway-identity|@vercel\/oidc/)
  })
})
