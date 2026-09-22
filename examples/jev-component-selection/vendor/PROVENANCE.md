Built from the real library — no modifications, minified only.

- Source: `packages/lang-core/src/` at the demo branch commit
  (`library.ts`, `parser/parser.ts`, `parser/serialize.ts` + their imports)
- Runtime dependency: `zod@4.6.5` (satisfies the workspace `^3.25.0 || ^4.0.0` range)
- Command: `esbuild entry.ts --bundle --platform=node --format=esm --minify`
  (see `/tmp/jev-lib/entry.ts` during development; entry re-exports
  `createLibrary, defineComponent, compileSchema, parse, jsonToOpenUI, z`)
- Why vendored: the demo runs with plain `node live.mjs` (no pnpm install,
  no build step). Long term this should become a workspace dependency on
  `@openuidev/lang-core`, not a vendored bundle.
