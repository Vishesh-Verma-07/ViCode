import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  attachMentionedFiles,
  clearMentionFileIndex,
  composeFileAttachmentText,
  detectMention,
  extractMentions,
  filterMentionFiles,
  listMentionableFiles,
  MAX_ATTACHMENT_BYTES,
} from "@/core/file-mentions"
import { VICODE_TRUNCATION_SENTINEL } from "@/core/cap-result"
import type { ToolContext } from "@/core/types"

describe("detectMention", () => {
  it("finds the mention the Cursor sits in", () => {
    expect(detectMention("explain @src/app", 16)).toEqual({ start: 8, fragment: "src/app" })
  })

  it("finds an @ that opens the draft", () => {
    expect(detectMention("@app", 4)).toEqual({ start: 0, fragment: "app" })
  })

  it("reports an empty fragment just after the @", () => {
    expect(detectMention("@", 1)).toEqual({ start: 0, fragment: "" })
  })

  it("finds only the fragment before the Cursor, not the rest of the path", () => {
    expect(detectMention("@src/app.tsx", 4)).toEqual({ start: 0, fragment: "src" })
  })

  it("is inactive once the Cursor leaves the mention", () => {
    expect(detectMention("@app and more", 13)).toBeNull()
    expect(detectMention("@app", 0)).toBeNull()
  })

  it("never opens on an @ inside a word", () => {
    expect(detectMention("mail me@host.com", 16)).toBeNull()
    expect(detectMention("see(@app)", 9)).toBeNull()
  })

  it("is inactive for a bare @@", () => {
    expect(detectMention("@@", 2)).toBeNull()
  })
})

describe("extractMentions", () => {
  it("finds every word-start mention in a submitted input", () => {
    expect(extractMentions("compare @src/a.ts with @b.ts")).toEqual([
      { start: 8, end: 17, path: "src/a.ts" },
      { start: 23, end: 28, path: "b.ts" },
    ])
  })

  it("finds a mention that opens the input", () => {
    expect(extractMentions("@a.ts why?")).toEqual([{ start: 0, end: 5, path: "a.ts" }])
  })

  it("ignores an @ inside a word", () => {
    expect(extractMentions("mail me@host.com")).toEqual([])
  })

  it("finds nothing in an input with no mentions", () => {
    expect(extractMentions("plain question")).toEqual([])
  })
})

describe("mention candidates", () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "vicode-mentions-"))
    clearMentionFileIndex()
  })

  afterEach(() => {
    rmSync(project, { recursive: true, force: true })
    clearMentionFileIndex()
  })

  it("lists project text files as Project-Root-relative paths, skipping ignored dirs and binaries", () => {
    writeFileSync(join(project, "app.ts"), "x")
    mkdirSync(join(project, "node_modules", "pkg"), { recursive: true })
    writeFileSync(join(project, "node_modules", "pkg", "index.js"), "x")
    writeFileSync(join(project, "logo.png"), "not really an image")

    const files = listMentionableFiles(project)
    expect(files).toContain("app.ts")
    expect(files).not.toContain("logo.png")
    expect(files.some((f) => f.includes("node_modules"))).toBe(false)
  })

  it("keeps Sensitive Paths out of what an autocomplete offers", () => {
    writeFileSync(join(project, "app.ts"), "x")
    writeFileSync(join(project, ".env"), "SECRET=1")

    const files = listMentionableFiles(project)
    expect(files).toContain("app.ts")
    expect(files).not.toContain(".env")
  })

  it("answers from the index inside its window and re-walks after it", () => {
    writeFileSync(join(project, "first.ts"), "x")
    expect(listMentionableFiles(project, 1_000)).toEqual(["first.ts"])

    // A new file inside the window is not seen yet; past it, the walk runs again.
    writeFileSync(join(project, "second.ts"), "x")
    expect(listMentionableFiles(project, 5_000)).toEqual(["first.ts"])
    expect([...listMentionableFiles(project, 30_000)].sort()).toEqual(["first.ts", "second.ts"])
  })

  it("offers nothing rather than throwing when the project directory is gone", () => {
    expect(listMentionableFiles(join(project, "nope"))).toEqual([])
  })

  it("ranks a filename that starts with the fragment ahead of a deeper path", () => {
    expect(filterMentionFiles(["src/deep/app.ts", "app.ts"], "app")).toEqual(["app.ts", "src/deep/app.ts"])
  })

  it("drops files the fragment is not a subsequence of", () => {
    expect(filterMentionFiles(["package.json", "app.ts"], "app")).toEqual(["app.ts"])
  })

  it("matches case-insensitively", () => {
    expect(filterMentionFiles(["SRC/App.ts"], "app")).toEqual(["SRC/App.ts"])
  })

  it("bounds the list it returns", () => {
    const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts`)
    expect(filterMentionFiles(files, "", 8)).toHaveLength(8)
  })

  it("lists shallow files first when nothing has been typed yet", () => {
    const files = ["a/b/c/deep.ts", "top.ts", "a/mid.ts"]
    expect(filterMentionFiles(files, "")).toEqual(["top.ts", "a/mid.ts", "a/b/c/deep.ts"])
  })

  it("returns nothing when no file matches", () => {
    expect(filterMentionFiles(["app.ts"], "zzz")).toEqual([])
  })
})

describe("attachMentionedFiles", () => {
  let root: string
  let project: string
  let context: ToolContext

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vicode-attach-"))
    project = join(root, "project")
    mkdirSync(project)
    context = { projectPath: project }
    clearMentionFileIndex()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    clearMentionFileIndex()
  })

  it("attaches a named file's content verbatim", async () => {
    writeFileSync(join(project, "app.ts"), "const x = 1\n")
    const { attachments, notes } = await attachMentionedFiles("explain @app.ts", context)
    expect(attachments).toEqual([{ path: "app.ts", content: "const x = 1\n" }])
    expect(notes).toEqual([])
  })

  it("reads a manually typed path as readily as a picked one", async () => {
    mkdirSync(join(project, "src"))
    writeFileSync(join(project, "src", "a.ts"), "a")
    const { attachments } = await attachMentionedFiles("see @src/a.ts", context)
    expect(attachments.map((a) => a.path)).toEqual(["src/a.ts"])
  })

  it("collapses repeated mentions of one file into one attachment", async () => {
    writeFileSync(join(project, "a.ts"), "a")
    const { attachments } = await attachMentionedFiles("@a.ts and again @a.ts", context)
    expect(attachments).toHaveLength(1)
  })

  it("does not ask for an ordinary in-project file", async () => {
    writeFileSync(join(project, "a.ts"), "a")
    let asked = 0
    const { attachments } = await attachMentionedFiles("@a.ts", context, {
      requestApproval: async () => {
        asked++
        return true
      },
    })
    expect(asked).toBe(0)
    expect(attachments).toHaveLength(1)
  })

  it("notes a mention that names no file, and attaches nothing", async () => {
    const { attachments, notes } = await attachMentionedFiles("@ghost.ts hello", context)
    expect(attachments).toEqual([])
    expect(notes).toEqual(["@ghost.ts does not exist — nothing to attach."])
  })

  it("notes a mention that names a directory", async () => {
    mkdirSync(join(project, "src"))
    const { notes } = await attachMentionedFiles("@src hi", context)
    expect(notes).toEqual(["@src is a directory — only files can be attached."])
  })

  it("notes a binary file instead of attaching its bytes", async () => {
    writeFileSync(join(project, "blob.dat"), Buffer.from([0x61, 0x00, 0x62]))
    const { attachments, notes } = await attachMentionedFiles("@blob.dat", context)
    expect(attachments).toEqual([])
    expect(notes).toEqual(["@blob.dat is binary — not attached."])
  })

  it("caps a large file and says the attachment was capped", async () => {
    writeFileSync(join(project, "big.txt"), "x".repeat(MAX_ATTACHMENT_BYTES + 5_000))
    const { attachments } = await attachMentionedFiles("@big.txt", context)
    const content = attachments[0]!.content
    expect(content).toContain(VICODE_TRUNCATION_SENTINEL)
    expect(content).toContain(`file mention capped at ${MAX_ATTACHMENT_BYTES} bytes`)
    expect(content).not.toContain("tool result capped")
  })

  it("asks before reading a Sensitive Path and attaches it once approved", async () => {
    writeFileSync(join(project, ".env"), "SECRET=1")
    const asked: string[] = []
    const { attachments, notes } = await attachMentionedFiles("@.env", context, {
      requestApproval: async (path) => {
        asked.push(path)
        return true
      },
    })
    expect(asked).toEqual([".env"])
    expect(attachments).toEqual([{ path: ".env", content: "SECRET=1" }])
    expect(notes).toEqual([])
  })

  it("skips a Sensitive Path the user declined, and says so", async () => {
    writeFileSync(join(project, ".env"), "SECRET=1")
    const { attachments, notes } = await attachMentionedFiles("@.env", context, {
      requestApproval: async () => false,
    })
    expect(attachments).toEqual([])
    expect(notes).toEqual(["@.env was not approved — not attached."])
  })

  it("refuses a Sensitive Path rather than reading it unasked when no approval can be requested", async () => {
    writeFileSync(join(project, ".env"), "SECRET=1")
    const { attachments, notes } = await attachMentionedFiles("@.env", context)
    expect(attachments).toEqual([])
    expect(notes).toEqual(["@.env needs approval to read — not attached."])
  })

  it("gates a path outside the Project Root the same way", async () => {
    mkdirSync(join(root, "outside"))
    writeFileSync(join(root, "outside", "outside.txt"), "far away")
    const asked: string[] = []
    const { attachments } = await attachMentionedFiles("@../outside/outside.txt", context, {
      requestApproval: async (path) => {
        asked.push(path)
        return true
      },
    })
    expect(asked).toEqual(["../outside/outside.txt"])
    expect(attachments).toEqual([{ path: "../outside/outside.txt", content: "far away" }])
  })

  it("notes each unreadable mention beside the ones that worked", async () => {
    writeFileSync(join(project, "a.ts"), "a")
    const { attachments, notes } = await attachMentionedFiles("@a.ts and @missing.ts", context)
    expect(attachments.map((a) => a.path)).toEqual(["a.ts"])
    expect(notes).toEqual(["@missing.ts does not exist — nothing to attach."])
  })
})

describe("composeFileAttachmentText", () => {
  it("wraps the content in a tag naming the path, verbatim", () => {
    expect(composeFileAttachmentText({ path: "src/a.ts", content: "const x = 1" })).toBe(
      '<file path="src/a.ts">\nconst x = 1\n</file>',
    )
  })
})
