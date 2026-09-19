const approvedPaths = new Set<string>()

function normalize(resolvedPath: string): string {
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath
}

export function isPathApproved(resolvedPath: string): boolean {
  return approvedPaths.has(normalize(resolvedPath))
}

export function approvePath(resolvedPath: string): void {
  approvedPaths.add(normalize(resolvedPath))
}

export function clearApprovedPaths(): void {
  approvedPaths.clear()
}
