import { describe, it, expect } from "bun:test"
import { tokenizeCodeText } from "./code-tokenizer"

describe("tokenizeCodeText", () => {
  it("returns a single prose segment for plain text", () => {
    expect(tokenizeCodeText("Just a normal message.")).toEqual([
      { kind: "prose", text: "Just a normal message." },
    ])
  })

  it("turns a triple-backtick fenced block into a fenced segment", () => {
    const result = tokenizeCodeText("```\necho hi\n```")
    expect(result).toEqual([{ kind: "fenced", text: "echo hi", language: undefined }])
  })

  it("captures the language tag after the opening fence", () => {
    const result = tokenizeCodeText("```bash\necho hi\n```")
    expect(result).toEqual([{ kind: "fenced", text: "echo hi", language: "bash" }])
  })

  it("keeps prose before and after a fenced block as separate prose segments", () => {
    const result = tokenizeCodeText("Run this:\n```js\nconst x = 1\n```\nDone")
    expect(result).toEqual([
      { kind: "prose", text: "Run this:" },
      { kind: "fenced", text: "const x = 1", language: "js" },
      { kind: "prose", text: "Done" },
    ])
  })

  it("handles a fenced block with an empty body", () => {
    const result = tokenizeCodeText("```bash\n```")
    expect(result).toEqual([{ kind: "fenced", text: "", language: "bash" }])
  })

  it("keeps multiple fenced blocks as separate segments", () => {
    const result = tokenizeCodeText("```a\none\n```\ntext\n```b\ntwo\n```")
    expect(result).toEqual([
      { kind: "fenced", text: "one", language: "a" },
      { kind: "prose", text: "text" },
      { kind: "fenced", text: "two", language: "b" },
    ])
  })

  it("runs an unclosed fence through to the end of the text", () => {
    const result = tokenizeCodeText("```yaml\nkey: value\non: [pull_request]")
    expect(result).toEqual([
      { kind: "fenced", text: "key: value\non: [pull_request]", language: "yaml" },
    ])
  })

  it("preserves backticks inside a fenced body literally", () => {
    const body = "const s = `hello`\n``` not a real fence"
    expect(tokenizeCodeText(`\`\`\`\n${body}\n\`\`\``)).toEqual([
      { kind: "fenced", text: body, language: undefined },
    ])
  })

  it("treats a closing fence as a line containing only backticks", () => {
    const result = tokenizeCodeText("```\na\n````")
    expect(result).toEqual([{ kind: "fenced", text: "a", language: undefined }])
  })

  it("allows leading whitespace before an opening fence", () => {
    const result = tokenizeCodeText("  ```python\nprint(1)\n  ```")
    expect(result).toEqual([{ kind: "fenced", text: "print(1)", language: "python" }])
  })

  it("splits inline (single-backtick) code out of prose", () => {
    const result = tokenizeCodeText("Run `bun test` to verify.")
    expect(result).toEqual([
      { kind: "prose", text: "Run " },
      { kind: "inline-code", text: "bun test" },
      { kind: "prose", text: " to verify." },
    ])
  })

  it("splits multiple inline-code spans out of one prose run", () => {
    const result = tokenizeCodeText("use `a` then `b` now")
    expect(result).toEqual([
      { kind: "prose", text: "use " },
      { kind: "inline-code", text: "a" },
      { kind: "prose", text: " then " },
      { kind: "inline-code", text: "b" },
      { kind: "prose", text: " now" },
    ])
  })

  it("leaves an unmatched backtick in prose", () => {
    const result = tokenizeCodeText("oops `unclosed")
    expect(result).toEqual([{ kind: "prose", text: "oops `unclosed" }])
  })

  it("does not tokenize backticks inside a fenced body as inline code", () => {
    const result = tokenizeCodeText("```md\nInline `code` and ``` fences\n```")
    expect(result).toEqual([
      { kind: "fenced", text: "Inline `code` and ``` fences", language: "md" },
    ])
  })

  it("trims the language tag", () => {
    const result = tokenizeCodeText("```  bash  \necho hi\n```")
    expect(result).toEqual([{ kind: "fenced", text: "echo hi", language: "bash" }])
  })
})