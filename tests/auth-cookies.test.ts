import { describe, it, expect } from "vitest"
import { createSession } from "@ai4u/mc-sso"
import { readIdentity } from "../src/auth"
import { withApiHandler } from "../src/http"

const SECRET = "test-secret-parse-cookies"
// Secuencia percent-encoding inválida: decodeURIComponent lanza URIError ("URI malformed").
const MALFORMED = "%E0%A4%A"

function reqWithCookie(cookie: string | null): Request {
  return new Request("https://x/api/test", { headers: cookie === null ? {} : { cookie } })
}

function validToken(): string {
  return createSession("flexoimpresos", SECRET, 60_000, { userId: "u1", roles: ["admin"] })
}

describe("readIdentity — cookies mal codificadas (regresión: URIError → 500)", () => {
  it("una cookie mal codificada sola no lanza y devuelve null", () => {
    expect(() => readIdentity(reqWithCookie(`basura=${MALFORMED}`), { secret: SECRET })).not.toThrow()
    expect(readIdentity(reqWithCookie(`basura=${MALFORMED}`), { secret: SECRET })).toBeNull()
  })

  it("mc_session válida se sigue leyendo aunque haya otra cookie mal codificada (antes o después)", () => {
    const token = validToken()
    for (const header of [
      `basura=${MALFORMED}; mc_session=${token}`,
      `mc_session=${token}; basura=${MALFORMED}`,
    ]) {
      const identity = readIdentity(reqWithCookie(header), { secret: SECRET })
      expect(identity?.tenantId).toBe("flexoimpresos")
      expect(identity?.userId).toBe("u1")
    }
  })

  it("mc_session mal codificada se ignora (null, sin lanzar)", () => {
    expect(readIdentity(reqWithCookie(`mc_session=${MALFORMED}`), { secret: SECRET })).toBeNull()
  })

  it("un duplicado mal codificado de mc_session no pisa al válido", () => {
    const identity = readIdentity(reqWithCookie(`mc_session=${validToken()}; mc_session=${MALFORMED}`), {
      secret: SECRET,
    })
    expect(identity?.tenantId).toBe("flexoimpresos")
  })

  it("header vacío o ausente → null", () => {
    expect(readIdentity(reqWithCookie(""), { secret: SECRET })).toBeNull()
    expect(readIdentity(reqWithCookie(null), { secret: SECRET })).toBeNull()
    expect(readIdentity(reqWithCookie(" ; ;"), { secret: SECRET })).toBeNull()
  })

  it("valores con '=' se leen completos (se corta solo en el primer '=')", () => {
    const token = validToken()
    const identity = readIdentity(reqWithCookie(`pref=a=b==; mc_session=${token}`), { secret: SECRET })
    expect(identity?.tenantId).toBe("flexoimpresos")
    // cookieName configurable: el valor con '=' llega entero a verifySession (firma inválida → null, sin lanzar).
    expect(readIdentity(reqWithCookie("pref=a=b=="), { secret: SECRET, cookieName: "pref" })).toBeNull()
  })

  it("sigue decodificando percent-encoding válido", () => {
    const token = validToken()
    const encoded = token.replace(".", "%2E")
    expect(readIdentity(reqWithCookie(`mc_session=${encoded}`), { secret: SECRET })?.tenantId).toBe("flexoimpresos")
  })
})

describe("withApiHandler — cookie mal codificada no produce 500", () => {
  it("responde 200 y conserva la identidad de mc_session", async () => {
    const route = withApiHandler(async (_req, ctx) => ({ tenant: ctx.identity?.tenantId ?? null }), {
      sessionAuth: { secret: SECRET },
    })
    const res = await route(reqWithCookie(`basura=${MALFORMED}; mc_session=${validToken()}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenant: "flexoimpresos" })
  })
})
