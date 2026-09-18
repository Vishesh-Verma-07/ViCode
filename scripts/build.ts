// Production build for the published npm package.
// Bundles ViCode's own source (src/cli.ts and everything under src/) into a
// single ESM entry (dist/index.js). Third-party packages stay external and are
// pulled from `dependencies` at runtime, which avoids bundler incompatibilities
// (e.g. zod v4, ink) while keeping the published tarball small.
//
// Ink lazily connects to React DevTools when process.env.DEV is set. Those
// modules (react-devtools-core, ws) are dev-only, so we stub them out at build
// time to keep the published bundle free of unresolvable imports.

import { build } from "bun"

const DEVTOOLS_STUBS = new Set(["react-devtools-core", "ws"])

const result = await build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  naming: "index.js",
  banner: "#!/usr/bin/env node",
  packages: "external",
  external: ["node:*"],
  plugins: [
    {
      name: "stub-ink-devtools",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          const file = args.path?.split("/").pop()
          if (args.path && (DEVTOOLS_STUBS.has(args.path) || (file && DEVTOOLS_STUBS.has(file)))) {
            return { path: args.path, namespace: "stub" }
          }
          return null
        })
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export default {};\n",
          loader: "js",
        }))
      },
    },
  ],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

for (const output of result.outputs) {
  console.log(`Built ${output.path}`)
}