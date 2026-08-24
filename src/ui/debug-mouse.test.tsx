import React, { useEffect } from "react"
import { describe, it } from "bun:test"
import { Text } from "ink"
import { render } from "ink-testing-library"
import { useInput } from "ink"

const Probe = () => {
  const [seen, setSeen] = React.useState<string[]>([])
  useInput((input, key) => {
    setSeen((prev) => [...prev.slice(-5), JSON.stringify({ input, pageUp: key.pageUp })])
  })
  return <Text>{seen.join(" | ") || "nothing"}</Text>
}

describe("debug mouse delivery", () => {
  it("what does useInput receive", async () => {
    const instance = render(<Probe />)
    await new Promise((r) => setTimeout(r, 100))
    instance.stdin.write("\u001B[<64;10;5M")
    await new Promise((r) => setTimeout(r, 200))
    console.log("SEEN:", instance.lastFrame())
    instance.stdin.write("\x1B[<65;3;4M")
    await new Promise((r) => setTimeout(r, 200))
    console.log("SEEN2:", instance.lastFrame())
    instance.unmount()
  }, 10000)
})
