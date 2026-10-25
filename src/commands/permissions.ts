import type { Command, PickerItem } from "../core/types"

export const PERMISSIONS_PICKER_HINT =
  "Ctrl+D revokes the highlighted approval; Esc closes"

function formatEntry(kind: "command" | "path", value: string): PickerItem {
  return {
    label: kind === "command" ? value : value,
    metadata: kind === "command" ? "command · this project" : "path · this session",
  }
}

/**
 * Reviews the two kinds of remembered consent: a Command Grant persisted for
 * this Project, and a path approved for this Session. Both are removed with
 * Ctrl+D, because a stored grant that cannot be revoked is a trap (ADR-0015).
 */
export function createPermissionsCommand(): Command {
  return {
    name: "permissions",
    description: "Review and revoke saved approvals",
    usage: "Pick an approval; Ctrl+D revokes it.",
    execute: async (_args, ctx) => {
      const permissions = ctx.permissions
      const openPicker = ctx.openPicker
      if (!permissions || !openPicker) {
        throw new Error("/permissions requires an interactive UI")
      }

      let entries = permissions.list()
      if (entries.length === 0) {
        return "No saved approvals for this project."
      }

      const entryForItem = new Map<PickerItem, (typeof entries)[number]>()
      const items = entries.map((entry) => {
        const item = formatEntry(entry.kind, entry.value)
        entryForItem.set(item, entry)
        return item
      })

      await openPicker({
        title: "Saved approvals",
        hint: PERMISSIONS_PICKER_HINT,
        items,
        onDelete: (item) => {
          const entry = entryForItem.get(item)
          if (!entry) return
          permissions.revoke(entry)
          entryForItem.delete(item)
          entries = entries.filter((candidate) => candidate !== entry)
        },
      })

      return ""
    },
  }
}
