import chalk from "../../node_modules/ink/node_modules/chalk/source/index.js"

chalk.level = 1

const ANSI_CODES: Record<string, string> = {
  black: "30",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  magenta: "35",
  cyan: "36",
  white: "37",
  gray: "90",
}

export function ansiCode(color: string): string {
  const code = ANSI_CODES[color]
  if (!code) throw new Error(`no ANSI code mapped for palette color: ${color}`)
  return `\u001B[${code}m`
}