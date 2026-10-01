import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import chalk from "../../node_modules/ink/node_modules/chalk/source/index.js"
import { ModeSwitcher } from "@/ui/mode-switcher"
import { findMode, MODES } from "@/core/modes"

chalk.level = 3

function frame(instance: { lastFrame: () => string | undefined }): string {
  return instance.lastFrame() ?? ""
}

function plain(instance: { lastFrame: () => string | undefined }): string {
  return frame(instance).replace(/\u001B\[[0-9;]*m/g, "")
}

describe("ModeSwitcher", () => {
  it("names every registered Mode in registry order", () => {
    const inst = render(<ModeSwitcher mode={findMode("build")!} />)
    const out = plain(inst)
    for (const mode of MODES) {
      expect(out).toContain(mode.name)
    }
    const positions = MODES.map((mode) => out.indexOf(mode.name))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(positions.every((position) => position >= 0)).toBe(true)
    inst.unmount()
  })

  it("brackets and colors only the active Mode", () => {
    const inst = render(<ModeSwitcher mode={findMode("discuss")!} />)
    const out = frame(inst)
    expect(out).toContain("[Discuss]")
    expect(out).not.toContain("[Build]")
    expect(out).not.toContain("[Plan]")
    expect(out).toContain("38;2;168;85;247")
    inst.unmount()
  })

  it("paints the active Mode in that Mode's design-token color", () => {
    const build = render(<ModeSwitcher mode={findMode("build")!} />)
    expect(frame(build)).toContain("\u001B[34m")
    build.unmount()

    const plan = render(<ModeSwitcher mode={findMode("plan")!} />)
    const planOut = frame(plan)
    expect(planOut).toContain("38;2;249;115;22")
    expect(planOut).toContain("[Plan]")
    plan.unmount()
  })

  it("wraps the inactive labels in the muted token, keeping Mode colors off them", () => {
    const inst = render(<ModeSwitcher mode={findMode("build")!} />)
    const out = frame(inst)
    expect(out).toMatch(/\u001B\[90mDiscuss\u001B\[39m/)
    expect(out).toMatch(/\u001B\[90mPlan\u001B\[39m/)
    expect(out).not.toContain("38;2;168;85;247")
    expect(out).not.toContain("38;2;249;115;22")
    inst.unmount()
  })

  it("renders all three names on a single row at a normal terminal width", () => {
    const inst = render(<ModeSwitcher mode={findMode("plan")!} />)
    expect(plain(inst).trim().split("\n")).toHaveLength(1)
    inst.unmount()
  })
})
