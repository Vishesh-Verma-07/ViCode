import { resolve } from "path"
import type { ToolContext } from "./types"

const WEB_FETCH_APPROVED_URLS = new Set<string>()

export function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url.trim())
    // Use the full URL string as-is (normalized by URL constructor)
    return parsed.toString()
  } catch {
    return url.trim()
  }
}

export function isUrlApproved(url: string): boolean {
  return WEB_FETCH_APPROVED_URLS.has(normalizeUrlKey(url))
}

export function approveUrl(url: string): void {
  WEB_FETCH_APPROVED_URLS.add(normalizeUrlKey(url))
}

export function clearApprovedUrls(): void {
  WEB_FETCH_APPROVED_URLS.clear()
}
