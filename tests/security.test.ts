import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { safeEqual, safeEqualEdge } from "../src/security"
import { safeEqualEdge as safeEqualEdgeDirect } from "../src/security/edge"
import * as barrel from "../src"

const CASES: Array<[string | null | undefined, string | null | undefined, boolean]> = [
  ["s3cr3t", "s3cr3t", true],
  ["s3cr3t", "s3cr3T", false],
  ["s3cr3t", "s3cr3t-mas-largo", false],
  ["corto", "un-secreto-mucho-mas-largo-que-el-otro", false],
  ["ñandú-🔑", "ñandú-🔑", true],
  ["ñandú-🔑", "nandu-🔑", false],
  [undefined, "x", false],
  ["x", undefined, false],
  [null, null, false],
  [undefined, undefined, false],
  ["", "", false],
  ["", "x", false],
]

describe("safeEqual (Node)", () => {
  it.each(CASES)("safeEqual(%j, %j) → %s", (a, b, expected) => {
    expect(safeEqual(a, b)).toBe(expected)
  })

  it("compara digests de igual largo: no lanza con entradas de largo distinto", () => {
    // timingSafeEqual sobre las entradas crudas lanzaría RangeError por largos distintos.
    expect(() => safeEqual("a", "b".repeat(64))).not.toThrow()
  })
})

describe("safeEqualEdge (Web Crypto)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(CASES)("safeEqualEdge(%j, %j) → %s", async (a, b, expected) => {
    await expect(safeEqualEdge(a, b)).resolves.toBe(expected)
  })

  it("coincide con safeEqual en entradas aleatorias", async () => {
    for (let i = 0; i < 200; i++) {
      const a = Math.random().toString(36).slice(2, 2 + (i % 12) + 1)
      const b = i % 3 === 0 ? a : Math.random().toString(36).slice(2, 2 + (i % 12) + 1)
      expect(await safeEqualEdge(a, b)).toBe(safeEqual(a, b))
    }
  })

  it("hashea siempre ambas entradas (sin salida temprana por inválidas)", async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, "digest")
    await safeEqualEdge(undefined, "x")
    await safeEqualEdge("a", "b")
    expect(spy).toHaveBeenCalledTimes(4)
    spy.mockRestore()
  })

  it("lanza un error claro si no hay Web Crypto", async () => {
    vi.stubGlobal("crypto", undefined)
    await expect(safeEqualEdge("a", "a")).rejects.toThrow(/Web Crypto/)
  })

  it("el módulo edge no importa nada de node:* (apto para middleware)", () => {
    const src = readFileSync(join(__dirname, "../src/security/edge.ts"), "utf8")
    expect(src).not.toMatch(/from\s+["']node:/)
    expect(src).not.toMatch(/require\(/)
  })
})

describe("exports", () => {
  it("el barrel y el subpath exponen las mismas funciones", () => {
    expect(barrel.safeEqual).toBe(safeEqual)
    expect(barrel.safeEqualEdge).toBe(safeEqualEdgeDirect)
    expect(safeEqualEdge).toBe(safeEqualEdgeDirect)
  })
})
