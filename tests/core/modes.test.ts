import { describe, it, expect } from "bun:test"
import { join } from "path"
import { z } from "zod"
import { DEFAULT_MODE, MODES, cycleMode, resolveModeTools, isDocsBoundaryPath, selectModeTools, findMode, type ModeId } from "@/core/modes"
import type { ToolDefinition } from "@/core/types"
import { allTools, readOnlyTools, writeTools } from "@/tools/index"
import { COLORS } from "@/ui/theme"

const PROJECT_ROOT = join(process.cwd(), "repo")

describe("mode registry", () => {
  it("defaults to build", () => {
    expect(DEFAULT_MODE).toBe("build")
  })

  it("cycles build -> discuss -> plan -> build", () => {
    expect(cycleMode("build")).toBe("discuss")
    expect(cycleMode("discuss")).toBe("plan")
    expect(cycleMode("plan")).toBe("build")
  })

  it("resolves build tools to all six", () => {
    const tools = resolveModeTools("build")
    expect(tools).toHaveLength(6)
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["bash", "edit_file", "list_files", "read_file", "search", "write_file"],
    )
  })

  it("resolves plan tools to the read-only triplet", () => {
    const tools = resolveModeTools("plan")
    expect(tools.map((t) => t.name).sort()).toEqual(["list_files", "read_file", "search"])
  })

  it("resolves discuss tools to read-only plus write/edit with no bash", () => {
    const tools = resolveModeTools("discuss")
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(["edit_file", "list_files", "read_file", "search", "write_file"])
    expect(names).not.toContain("bash")
  })

  it("resolves every mode's tool set from the existing tool groups", () => {
    expect(resolveModeTools("build")).toEqual(allTools)
    expect(resolveModeTools("plan")).toEqual(readOnlyTools)
    const writeNoBash = writeTools.filter((t) => t.name !== "bash")
    expect(resolveModeTools("discuss")).toEqual([...readOnlyTools, ...writeNoBash])
  })

  it("gives every definition a name, a design-token color, and a non-empty prompt layer", () => {
    for (const mode of MODES) {
      expect(mode.name.length).toBeGreaterThan(0)
      expect(mode.color in COLORS).toBe(true)
      expect(mode.promptLayer.trim()).not.toBe("")
    }
  })

  it("maps mode colors to the design-token palette (blue, purple, orange)", () => {
    const colors: Record<ModeId, string> = {
      build: COLORS.modeBuild,
      discuss: COLORS.modeDiscuss,
      plan: COLORS.modePlan,
    }
    expect(colors.build).toBe("blue")
    expect(colors.discuss).toBe("purple")
    expect(colors.plan).toBe("orange")
  })
})

describe("selectModeTools", () => {
  const customTool: ToolDefinition = {
    name: "stamp_tool",
    description: "Stamp a marker",
    parameters: z.object({}),
    execute: async () => "stamped",
    dangerous: false,
  }
  const customCatalog = [...allTools, customTool]

  it("keeps the caller's whole catalog in build mode, custom tools included", () => {
    const selected = selectModeTools(customCatalog, "build")
    expect(selected.map((t) => t.name).sort()).toEqual(
      [...allTools.map((t) => t.name), "stamp_tool"].sort(),
    )
  })

  it("narrows the catalog to the read-only triplet in plan mode", () => {
    const selected = selectModeTools(customCatalog, "plan")
    expect(selected.map((t) => t.name).sort()).toEqual(["list_files", "read_file", "search"])
  })

  it("narrows the catalog to reads plus docs-safe writes in discuss mode", () => {
    const selected = selectModeTools(customCatalog, "discuss")
    expect(selected.map((t) => t.name).sort()).toEqual(
      ["edit_file", "list_files", "read_file", "search", "write_file"],
    )
  })

  it("agrees with resolveModeTools for the built-in catalog", () => {
    for (const mode of ["build", "discuss", "plan"] as const) {
      const selected = selectModeTools(allTools, mode)
      expect(selected.map((t) => t.name).sort()).toEqual(
        resolveModeTools(mode).map((t) => t.name).sort(),
      )
    }
  })
})

describe("findMode", () => {
  it("returns the definition for a known mode id", () => {
    expect(findMode("discuss")?.name).toBe("Discuss")
    expect(findMode("plan")?.promptLayer).toContain("plan mode")
  })

  it("returns undefined for an unknown mode id", () => {
    expect(findMode("unknown" as ModeId)).toBeUndefined()
  })
})

describe("discuss docs-boundary gate", () => {
  it("accepts CONTEXT.md at the project root", () => {
    expect(isDocsBoundaryPath("CONTEXT.md", PROJECT_ROOT)).toBe(true)
  })

  it("accepts GLOSSARY.md at the project root", () => {
    expect(isDocsBoundaryPath("GLOSSARY.md", PROJECT_ROOT)).toBe(true)
  })

  it("accepts absolute paths at the project root", () => {
    expect(isDocsBoundaryPath(join(PROJECT_ROOT, "CONTEXT.md"), PROJECT_ROOT)).toBe(true)
  })

  it("accepts files under docs/adr/", () => {
    expect(isDocsBoundaryPath("docs/adr/0001-foo.md", PROJECT_ROOT)).toBe(true)
    expect(isDocsBoundaryPath("docs/adr/nested/0002-bar.md", PROJECT_ROOT)).toBe(true)
  })

  it("rejects source paths outside the docs boundary", () => {
    expect(isDocsBoundaryPath("src/main.ts", PROJECT_ROOT)).toBe(false)
    expect(isDocsBoundaryPath("src/tools/index.ts", PROJECT_ROOT)).toBe(false)
  })

  it("rejects docs files outside docs/adr/", () => {
    expect(isDocsBoundaryPath("docs/other.md", PROJECT_ROOT)).toBe(false)
    expect(isDocsBoundaryPath("README.md", PROJECT_ROOT)).toBe(false)
    expect(isDocsBoundaryPath("docs/adr.md", PROJECT_ROOT)).toBe(false)
  })

  it("rejects paths escaping the project root", () => {
    expect(isDocsBoundaryPath(join("..", "outside", "CONTEXT.md"), PROJECT_ROOT)).toBe(false)
    expect(isDocsBoundaryPath(join("..", "outside", "src", "x.ts"), PROJECT_ROOT)).toBe(false)
  })

  it("rejects missing and empty paths", () => {
    expect(isDocsBoundaryPath("", PROJECT_ROOT)).toBe(false)
  })
})