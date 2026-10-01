import { Text } from "ink"
import { homedir } from "os"
import { COLORS } from "./theme"

interface ProjectRootPathProps {
  projectRoot?: string
}

const HOME_DIR = homedir()

function toForwardSlashes(path: string): string {
  return path.replace(/\\/g, "/")
}

function stripTrailingSlashes(path: string): string {
  if (path === "/") return path
  if (/^[A-Za-z]:\/$/.test(path)) return path
  return path.replace(/\/+$/, "") || "/"
}

function isDriveRoot(path: string): boolean {
  return /^[A-Za-z]:\/$/.test(path)
}

function formatProjectRootPath(projectRoot: string, home: string): string {
  const normalizedRoot = stripTrailingSlashes(toForwardSlashes(projectRoot))
  const normalizedHome = stripTrailingSlashes(toForwardSlashes(home))

  const isWindows = process.platform === "win32"
  const rootForCompare = isWindows ? normalizedRoot.toLowerCase() : normalizedRoot
  const homeForCompare = isWindows ? normalizedHome.toLowerCase() : normalizedHome

  if (rootForCompare === homeForCompare) {
    return "~"
  }

  if (homeForCompare === "/") {
    return `~${normalizedRoot}`
  }

  if (isDriveRoot(normalizedHome) && rootForCompare.startsWith(homeForCompare)) {
    return `~${normalizedRoot.slice(normalizedHome.length - 1)}`
  }

  if (
    rootForCompare.startsWith(homeForCompare) &&
    normalizedRoot.length > normalizedHome.length &&
    normalizedRoot[normalizedHome.length] === "/"
  ) {
    return `~${normalizedRoot.slice(normalizedHome.length)}`
  }

  return normalizedRoot
}

export function ProjectRootPath({ projectRoot }: ProjectRootPathProps) {
  if (!projectRoot) {
    return null
  }
  const display = formatProjectRootPath(projectRoot, HOME_DIR)
  return (
    <Text color={COLORS.muted} wrap="truncate-start">
      {display}
    </Text>
  )
}
