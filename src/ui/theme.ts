export const COLORS = {
  primary: "cyan",
  accent: "blue",
  success: "green",
  warning: "yellow",
  error: "red",
  muted: "gray",
  text: "white",
  dimText: "#666666",
  highlight: "cyanBright",
  border: "#444444",
  borderFocused: "cyan",
  surface: "#1a1a2e",
} as const

export const ICONS = {
  logo: "◆",
  user: "❯",
  assistant: "◈",
  tool: "⚙",
  success: "✓",
  error: "✗",
  warning: "⚠",
  chevron: "›",
  dot: "●",
  arrow: "→",
  check: "✓",
  cross: "✗",
  hourglass: "⏳",
  sparkle: "✦",
} as const

export const BORDER = {
  style: "round" as const,
  color: COLORS.border,
  focusedColor: COLORS.borderFocused,
} as const

export const ASCII_BANNER = [
  "",
  "  ██╗   ██╗██╗███████╗██╗    ███████╗",
  "  ██║   ██║██║██╔════╝██║    ██╔════╝",
  "  ██║   ██║██║█████╗  ██║    ███████╗",
  "  ╚██╗ ██╔╝██║██╔══╝  ██║    ╚════██║",
  "   ╚████╔╝ ██║███████╗███████╗███████║",
  "    ╚═══╝  ╚═╝╚══════╝╚══════╝╚══════╝",
  "",
].join("\n")
