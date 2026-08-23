import type { Skill } from "../core/skills"
import type { Command } from "../core/types"
import { discoverSkills } from "../core/skills"
import { Picker } from "../ui/picker"
import { moveHighlight, NO_COMMANDS_MATCH_MESSAGE } from "../ui/command-suggestion"
import type { CommandContext } from "../core/types"

export function createSkillCommand(): Command {
  return {
    name: "skill",
    description: "Load a skill markdown file as a System Prompt layer",
    execute: async (_args, ctx): Promise<string> => {
      if (!ctx.openPicker) {
        throw new Error("/skill requires an interactive UI")
      }

      const skills = await ctx.skills?.list() ?? []

      if (skills.length === 0) {
        return "No skills available."
      }

      const selectedIndex = await ctx.openPicker({
        title: "Select skill",
        items: skills.map((skill) => ({
          label: skill.name,
          metadata: `Origin: ${skill.origin}`,
        })),
      })
      if (selectedIndex === null) return ""

      const chosen = skills[selectedIndex]
      if (!chosen) return ""

      ctx.onSkillActivate?.(chosen.content)

      return `Activated skill: ${chosen.name}`
    },
  }
}