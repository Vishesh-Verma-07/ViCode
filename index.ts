#!/usr/bin/env bun

// Launcher that works whether run by Bun or (re)spawned via a node shim.
// Bun resolves `.ts` imports natively, so that path imports the CLI directly.
// Node cannot load the `.tsx` UI graph, so when launched under Node we
// re-execute the real entry (src/cli.ts) through `bun` on PATH with the same
// arguments and stdio.

const isBun = typeof Bun !== "undefined"

if (isBun) {
  await import("./src/cli.ts")
} else {
  const { spawn } = await import("node:child_process")
  const { resolve, dirname } = await import("node:path")
  const { fileURLToPath } = await import("node:url")

  const entry = resolve(dirname(fileURLToPath(import.meta.url)), "src", "cli.ts")
  const child = spawn("bun", [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
  })

  // The child shares our process group, so terminal signals reach it directly.
  // Swallow them here and let the child handle them, then exit with its code.
  process.on("SIGINT", () => {})
  process.on("SIGTERM", () => {})

  child.on("error", (error) => {
    console.error("Vicode requires Bun to run, but `bun` was not found on PATH.")
    console.error(error.message)
    console.error("Install Bun from https://bun.sh")
    process.exit(1)
  })

  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 130 : 1)
  })
}
