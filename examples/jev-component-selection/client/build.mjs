/** Build the demo React client (committed source → gitignored bundle). */
import { buildSync } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..", "..", "..");

buildSync({
  entryPoints: [join(dir, "app.tsx")],
  bundle: true,
  platform: "browser",
  format: "iife",
  minify: true,
  outfile: join(dir, "..", "client.bundle.js"),
  loader: { ".tsx": "tsx", ".ts": "ts" },
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@openuidev/lang-core": join(repo, "packages", "lang-core", "src", "index.ts"),
    "@openuidev/observability": join(dir, "observability-stub.mjs"),
  },
  nodePaths: [join(dir, "..", "node_modules")],
  logLevel: "info",
});
console.log("wrote client.bundle.js");
