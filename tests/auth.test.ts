import { describe, it, expect } from "vitest"
import { verifyServiceRequest } from "../src/auth"

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://x/api/test", { headers })
}

describe("verifyServiceRequest", () => {
  it("autentica con el shared secret explícito en x-mc-secret", () => {
    const result = verifyServiceRequest(reqWith({ "x-mc-secret": "s3cr3t" }), { sharedSecret: "s3cr3t" })
    expect(result).toEqual({ ok: true })
  })

  it("rechaza un x-mc-secret que no coincide", () => {
    const result = verifyServiceRequest(reqWith({ "x-mc-secret": "wrong" }), { sharedSecret: "s3cr3t" })
    expect(result.ok).toBe(false)
  })

  it("acepta el secreto viejo o el nuevo durante una migración (sharedSecrets)", () => {
    const cfg = { sharedSecret: "nuevo", sharedSecrets: ["viejo"] }
    expect(verifyServiceRequest(reqWith({ "x-mc-secret": "nuevo" }), cfg)).toEqual({ ok: true })
    expect(verifyServiceRequest(reqWith({ "x-mc-secret": "viejo" }), cfg)).toEqual({ ok: true })
    expect(verifyServiceRequest(reqWith({ "x-mc-secret": "ninguno-de-los-dos" }), cfg).ok).toBe(false)
  })

  it("autentica por X-API-Key resolviendo el tenant", () => {
    const result = verifyServiceRequest(reqWith({ "x-api-key": "key-flexo" }), {
      apiKeys: { tamaprint: "key-tama", flexoimpresos: "key-flexo" },
    })
    expect(result).toEqual({ ok: true, tenantId: "flexoimpresos" })
  })

  it("sin ningún header de auth, falla", () => {
    const result = verifyServiceRequest(reqWith({}), { sharedSecret: "s3cr3t" })
    expect(result.ok).toBe(false)
  })
})

describe("verifyServiceRequest usa safeEqual", () => {
  it("rechaza secretos de distinto largo y prefijos", () => {
    expect(verifyServiceRequest(reqWith({ "x-mc-secret": "s3cr" }), { sharedSecret: "s3cr3t" }).ok).toBe(false)
    expect(verifyServiceRequest(reqWith({ "x-mc-secret": "s3cr3t-extra" }), { sharedSecret: "s3cr3t" }).ok).toBe(false)
    expect(verifyServiceRequest(reqWith({ "x-api-key": "key-tam" }), { apiKeys: { tamaprint: "key-tama" } }).ok).toBe(
      false,
    )
  })

  it("un apiKey vacío en la config nunca autentica", () => {
    expect(verifyServiceRequest(reqWith({ "x-api-key": "" }), { apiKeys: { tamaprint: "" } }).ok).toBe(false)
  })
})
