function normalize(resolvedPath: string): string {
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath
}

export interface ApprovedPaths {
  isApproved(resolvedPath: string): boolean
  approve(resolvedPath: string): void
  revoke(resolvedPath: string): void
  list(): string[]
  clear(): void
}

export function createApprovedPaths(): ApprovedPaths {
  const approvedPaths = new Set<string>()
  return {
    isApproved: (resolvedPath) => approvedPaths.has(normalize(resolvedPath)),
    approve: (resolvedPath) => approvedPaths.add(normalize(resolvedPath)),
    revoke: (resolvedPath) => {
      approvedPaths.delete(normalize(resolvedPath))
    },
    list: () => [...approvedPaths],
    clear: () => approvedPaths.clear(),
  }
}
