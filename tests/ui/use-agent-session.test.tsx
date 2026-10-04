import React from "react"
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { render } from "ink-testing-library"
import { Box, Text } from "ink"
import { useAgentSession, type AgentSession } from "@/ui/use-agent-session"
import { createModelCommand } from "@/commands/model"
import { createSession, type Session } from "@/core/session"
import { setActiveCatalog } from "@/core/catalog"
import { parseModelId } from "@/core/model-id"
import type { Message, PickerRequest } from "@/core/types"
import type { Provider } from "@/core/provider"

/**
 * The switch-confirmation contract at the hook seam, where the row index the
 * picker returns can be fixed and the confirmation callback left out entirely —
 * the two things the whole-App tests cannot arrange.
 */
describe("useAgentSession model switch confirmation", () => {
  const NARROW = 32_000
  const WIDE = 200_000

  const CATALOG = {
    providers: {
      openrouter: {
        "narrow-beta": {
          id: "narrow-beta",
          name: "Narrow Beta",
          protocol: "openai" as const,
          pricing: { inputPricePerToken: 0, outputPricePerToken: 0 },
          contextLength: NARROW,
        },
        "wide-alpha": {
          id: "wide-alpha",
          name: "Wide Alpha",
          protocol: "openai" as const,
          pricing: { inputPricePerToken: 2 / 1_000_000, outputPricePerToken: 8 / 1_000_000 },
          contextLength: WIDE,
        },
      },
      openai: {},
      anthropic: {},
      opencode: {},
      "opencode-go": {},
    },
  }

  beforeEach(() => {
    setActiveCatalog(CATALOG)
  })

  afterEach(() => {
    setActiveCatalog(null)
  })

  function createProvider(canonicalModelId: string): Provider {
    const model = parseModelId(canonicalModelId).model
    const contextLength = model === "narrow-beta" ? NARROW : WIDE
    return {
      getModelInfo: () => ({
        id: canonicalModelId,
        name: `MODEL:${canonicalModelId}`,
        provider: "openrouter" as const,
        contextLength,
      }),
      async listModels() {
        return []
      },
      // No turn runs in this suite: `/model` reports and returns.
      streamChat: () => {
        throw new Error("streamChat must not run while switching models")
      },
    }
  }

  /** A conversation far larger than the narrow Model's 22.4k budget. */
  function longConversation(turns: number): Message[] {
    return Array.from({ length: turns }, (_, i) => ({
      id: `user_${i}`,
      role: "user" as const,
      content: [{ type: "text" as const, text: "x".repeat(12_000) }],
      timestamp: 0,
    }))
  }

  function sessionWith(opts: {
    turns: number
    /** Row the picker returns. 1 is Narrow Beta: heading, then cheapest first. */
    pick: number
    confirmContextSwitch?: (warning: string) => Promise<boolean>
  }) {
    const warnings: string[] = []
    let current: AgentSession | null = null
    const initialSession: Session = createSession({
      model: "openrouter/wide-alpha",
      messages: longConversation(opts.turns),
    })
    const pickerRequests: PickerRequest[] = []

    function Harness() {
      const session = useAgentSession({
        provider: createProvider("openrouter/wide-alpha"),
        createProvider,
        tools: [],
        context: { projectPath: "/tmp/project" },
        initialSession,
        commands: [createModelCommand()],
        openPicker: async (request) => {
          pickerRequests.push(request)
          return opts.pick
        },
        resetDraft: () => {},
        resetHistory: () => {},
        view: "chat",
        enterChat: () => {},
        enterHome: () => {},
        keyFor: () => "test-key",
        confirmContextSwitch: opts.confirmContextSwitch
          ? (warning) => {
              warnings.push(warning)
              return opts.confirmContextSwitch!(warning)
            }
          : undefined,
      })
      current = session
      return (
        <Box flexDirection="column">
          {session.feedbackEntries.map((entry) => (
            <Text key={entry.id}>{entry.text}</Text>
          ))}
        </Box>
      )
    }

    const instance = render(<Harness />)
    const frameText = () => (instance.lastFrame() ?? "").replace(/\u001B\[[0-9;]*m/g, "")

    /** Ink flushes the feedback line on its own render pass, so wait for it. */
    function untilText(): Promise<string> {
      return new Promise((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          const frame = frameText()
          if (frame.trim().length > 0) {
            resolve(frame)
            return
          }
          if (Date.now() - started > 5000) {
            reject(new Error("timed out waiting for the command to report"))
            return
          }
          setTimeout(tick, 10)
        }
        tick()
      })
    }

    async function switchModel(): Promise<string> {
      await current!.handleSend("/model")
      return untilText()
    }

    return { ...instance, frameText, switchModel, untilText, warnings, pickerRequests }
  }

  it("names the row the switch would lose against the target budget", async () => {
    const { switchModel, warnings, unmount } = sessionWith({
      turns: 20,
      pick: 1,
      confirmContextSwitch: async () => false,
    })
    try {
      await switchModel()

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("60.1k")
      expect(warnings[0]).toContain("22.4k")
      expect(warnings[0]).toContain("32.0k")
      expect(warnings[0]).toContain("openrouter/narrow-beta")
      expect(warnings[0]).toContain("Switch anyway?")
    } finally {
      unmount()
    }
  })

  it("refuses and says what was kept when the user declines", async () => {
    const { frameText, switchModel, unmount } = sessionWith({
      turns: 20,
      pick: 1,
      confirmContextSwitch: async () => false,
    })
    try {
      const frame = await switchModel()

      expect(frame).toContain("Kept openrouter/wide-alpha")
      expect(frame).not.toContain("Switched to")
    } finally {
      unmount()
    }
  })

  it("switches when the user confirms, warning and all", async () => {
    const { frameText, switchModel, unmount } = sessionWith({
      turns: 20,
      pick: 1,
      confirmContextSwitch: async () => true,
    })
    try {
      const frame = await switchModel()

      expect(frame).toContain("Switched to openrouter/narrow-beta")
    } finally {
      unmount()
    }
  })

  it("switches without asking when the conversation already fits the budget", async () => {
    const { frameText, switchModel, warnings, unmount } = sessionWith({
      turns: 1,
      pick: 1,
      confirmContextSwitch: async () => true,
    })
    try {
      const frame = await switchModel()

      expect(frame).toContain("Switched to openrouter/narrow-beta")
      expect(warnings).toHaveLength(0)
    } finally {
      unmount()
    }
  })

  it("refuses rather than truncating in silence when no host can be asked", async () => {
    const { frameText, switchModel, unmount } = sessionWith({ turns: 20, pick: 1 })
    try {
      const frame = await switchModel()

      expect(frame).toContain("Kept openrouter/wide-alpha")
      expect(frame).not.toContain("Switched to")
    } finally {
      unmount()
    }
  })

  it("shows the context window on the row it is about to switch to", async () => {
    const { switchModel, pickerRequests, unmount } = sessionWith({ turns: 1, pick: 1 })
    try {
      await switchModel()

      const items = pickerRequests[0]!.items
      expect(items[1]!.metadata).toContain("32.0k ctx")
      expect(items[2]!.metadata).toContain("200.0k ctx")
    } finally {
      unmount()
    }
  })
})
