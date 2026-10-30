import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getLogger } from "../src/logger"
import { PLATFORM_VERSION } from "../src/version"

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
  version: string
  engines?: { node?: string }
  peerDependencies?: Record<string, string>
}

beforeAll(() => {
  process.env.LOG_FORMAT = "json"
})
afterEach(() => vi.restoreAllMocks())

describe("P6 higiene", () => {
  it("PLATFORM_VERSION coincide con la version de package.json (no se desincroniza)", () => {
    expect(PLATFORM_VERSION).toBe(pkg.version)
  })

  it("cada línea de log lleva platformVersion y los extras no la pisan", () => {
    const lines: string[] = []
    vi.spyOn(process.stdout, "write").mockImplementation(((c: unknown) => (lines.push(String(c)), true)) as never)
    getLogger("v").info({ platformVersion: "0.0.0-fake" }, "hola")
    expect(JSON.parse(lines[0]).platformVersion).toBe(pkg.version)
  })

  it("declara engines.node >=22", () => {
    expect(pkg.engines?.node).toBe(">=22")
  })

  it("no declara peerDependencies de next/react (el código no los importa)", () => {
    expect(pkg.peerDependencies?.next).toBeUndefined()
    expect(pkg.peerDependencies?.react).toBeUndefined()
  })
})
