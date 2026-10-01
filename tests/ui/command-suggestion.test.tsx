import React from "react"
import { describe, it, expect } from "bun:test"
import { render } from "ink-testing-library"
import { renderToString } from "ink"
import { CommandSuggestion, filterCommands, findUsageHint, moveHighlight, NO_COMMANDS_MATCH_MESSAGE } from "@/ui/command-suggestion"
import { COLORS } from "@/ui/theme"
import { ansiCode } from "@/ui/ansi-test"
import type { Command } from "@/core/types"

const RENAME_USAGE = "Give it a name: /rename <name>, or /rename clear to drop the current one."

const commands: Command[] = [
  { name: "help", description: "List available commands", execute: async () => "" },
  { name: "model", description: "Switch the model", execute: async () => "" },
  { name: "session", description: "Switch sessions", execute: async () => "" },
  { name: "skill", description: "Load a skill", execute: async () => "" },
  { name: "rename", description: "Name the current session", execute: async () => "", usage: RENAME_USAGE },
]

describe("filterCommands", () => {
  it("returns every command when the query is just /", () => {
    expect(filterCommands(commands, "/")).toEqual(commands)
  })

  it("filters case-insensitively on the typed fragment", () => {
    expect(filterCommands(commands, "/HE")).toEqual([commands[0]!])
    expect(filterCommands(commands, "/SE")).toEqual([commands[2]!])
  })

  it("matches only the first word fragment after the slash", () => {
    expect(filterCommands(commands, "/he")).toEqual([commands[0]!])
  })

  it("returns an empty array when nothing matches", () => {
    expect(filterCommands(commands, "/frobnicate")).toEqual([])
  })
})

describe("findUsageHint", () => {
  it("returns the usage of a command whose name has just been typed in full", () => {
    expect(findUsageHint(commands, "/rename")).toBe(RENAME_USAGE)
  })

  it("stays quiet while the name is still being typed", () => {
    expect(findUsageHint(commands, "/re")).toBeUndefined()
    expect(findUsageHint(commands, "/r")).toBeUndefined()
  })

  it("stays quiet once the user has started typing arguments", () => {
    expect(findUsageHint(commands, "/rename ")).toBeUndefined()
    expect(findUsageHint(commands, "/rename Deep work")).toBeUndefined()
  })

  it("returns nothing for a command that takes no arguments", () => {
    expect(findUsageHint(commands, "/help")).toBeUndefined()
  })

  it("matches the name exactly, the way the dispatcher does", () => {
    expect(findUsageHint(commands, "/Rename")).toBeUndefined()
    expect(findUsageHint(commands, "/renames")).toBeUndefined()
  })

  it("returns nothing for input that is not a command attempt", () => {
    expect(findUsageHint(commands, "rename")).toBeUndefined()
    expect(findUsageHint(commands, "")).toBeUndefined()
  })
})

describe("moveHighlight", () => {
  it("moves down but never past the last item", () => {
    expect(moveHighlight(0, 4, 1)).toBe(1)
    expect(moveHighlight(3, 4, 1)).toBe(3)
  })

  it("moves up but never above the first item", () => {
    expect(moveHighlight(2, 4, -1)).toBe(1)
    expect(moveHighlight(0, 4, -1)).toBe(0)
  })

  it("stays at zero for an empty list", () => {
    expect(moveHighlight(0, 0, 1)).toBe(0)
    expect(moveHighlight(0, 0, -1)).toBe(0)
  })
})

describe("CommandSuggestion", () => {
  it("lists every command with its description", () => {
    const { lastFrame } = render(<CommandSuggestion items={commands} highlightIndex={0} />)
    const frame = lastFrame() ?? ""
    for (const command of commands) {
      expect(frame).toContain(`/${command.name}`)
      expect(frame).toContain(command.description)
    }
  })

  it("renders only the items it is given", () => {
    const { lastFrame } = render(<CommandSuggestion items={[commands[2]!]} highlightIndex={0} />)
    const frame = lastFrame() ?? ""
    expect(frame).toContain("/session")
    expect(frame).not.toContain("/help")
    expect(frame).not.toContain("/model")
  })

  it("marks the highlighted command with > and others without", () => {
    const { lastFrame } = render(<CommandSuggestion items={commands} highlightIndex={2} />)
    const frame = lastFrame() ?? ""
    expect(frame).toContain("> /session")
    expect(frame).not.toContain("> /help")
    expect(frame).not.toContain("> /model")
    expect(frame).not.toContain("> /skill")
  })

  it("shows the no-match message instead of vanishing when there are no items", () => {
    const { lastFrame } = render(<CommandSuggestion items={[]} highlightIndex={0} />)
    const frame = lastFrame() ?? ""
    expect(frame).toContain(NO_COMMANDS_MATCH_MESSAGE)
  })

  it("renders a hint line below the commands when one is given", () => {
    const { lastFrame } = render(
      <CommandSuggestion items={[commands[4]!]} highlightIndex={0} hint={RENAME_USAGE} />,
    )
    const frame = lastFrame() ?? ""
    expect(frame).toContain("Give it a name: /rename <name>")
    expect(frame.indexOf("/rename")).toBeLessThan(frame.indexOf("Give it a name"))
  })

  it("renders no hint line when none is given", () => {
    const { lastFrame } = render(<CommandSuggestion items={commands} highlightIndex={0} />)
    expect(lastFrame() ?? "").not.toContain("Give it a name")
  })

  it("colors the highlight and description from the palette tokens", () => {
    const frame = renderToString(
      <CommandSuggestion items={commands} highlightIndex={2} />,
      { columns: 100 },
    )
    expect(frame).toContain("> /session")
    expect(frame).toContain(ansiCode(COLORS.primary))
    expect(frame).toContain(ansiCode(COLORS.muted))
  })
})
