#!/usr/bin/env node
/**
 * Live build-off server: realistic UI-being-built demo.
 *
 * Serves this directory statically plus two SSE endpoints that use REAL APIs:
 * - POST /api/build {"mode":"baseline"} → streams REAL OpenAI
 *   (gpt-4o-mini, stream:true) token deltas as SSE `token` events, then `done`.
 * - POST /api/build {"mode":"jev"} → one REAL TypeSafe `jev-latest`
 *   systemone call (8 batched Noul questions, single round trip), then
 *   `decisions` with all scores at once.
 *
 * Usage:
 *   set -a; source ~/shared_config; set +a
 *   node live.mjs [--port 8123]
 *   # open http://localhost:8123/live.html
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const candidates = JSON.parse(readFileSync(join(dir, "candidates.json"), "utf8"));
const STATE =
  "Create account preferences with a name field and Save button. " +
  "The form edits the user's display name and persists it on save.";

const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!TYPESAFE_API_KEY || !OPENAI_API_KEY) {
  console.error("Need TYPESAFE_API_KEY and OPENAI_API_KEY in env.");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".json": "application/json", ".mjs": "text/javascript", ".md": "text/markdown" };

function candidateList() {
  return candidates.map((c) => `- ${c.id} (${c.component}): ${c.description}`).join("\n");
}

function send(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function handleBaseline(res) {
  const started = performance.now();
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      stream: true,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You select UI components for a generative-UI composer. Reply with JSON only: {\"chosen\": [\"<candidate-id>\", ...]} using exactly the candidate ids given." },
        { role: "user", content: `Request: ${STATE}\n\nCandidates:\n${candidateList()}` },
      ],
    }),
  });
  if (!upstream.ok || !upstream.body) throw new Error(`OpenAI HTTP ${upstream.status}`);
  let raw = "";
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
          if (delta) {
            raw += delta;
            send(res, { type: "token", text: delta });
          }
        } catch { /* keep-alive whitespace */ }
      }
    }
  }
  const ms = performance.now() - started;
  let chosen = [];
  try { chosen = JSON.parse(raw).chosen ?? []; } catch { /* fall through */ }
  send(res, { type: "done", chosen, ms });
}

async function handleJev(res) {
  send(res, { type: "status", text: "1 round trip: evaluating 8 candidates in parallel…" });
  const questions = {};
  for (const c of candidates) {
    questions[`include_${c.id.replaceAll("-", "_")}`] = {
      type: "noul",
      instructions: `Request: ${STATE}. Should the candidate "${c.id}" (${c.component}: ${c.description}) be included in the composed UI?`,
      criteria: { true: "Needed for the requested preferences form (panel, name field, save action)", false: "Unrelated, redundant, or not requested" },
    };
  }
  const started = performance.now();
  const upstream = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state: STATE, questions }),
  });
  if (!upstream.ok) throw new Error(`Jev HTTP ${upstream.status}`);
  const json = await upstream.json();
  const ms = performance.now() - started;
  const key = (id) => `include_${id.replaceAll("-", "_")}`;
  const scores = Object.fromEntries(candidates.map((c) => [c.id, json.answers?.[key(c.id)]?.noul ?? 0]));
  const chosen = candidates.filter((c) => scores[c.id] >= 0.5).map((c) => c.id);
  // All decisions arrived together in the single response; the page may
  // stagger chip rendering for visibility, which is presentational only.
  send(res, { type: "decisions", chosen, scores, ms, model: json.model ?? "jev-latest" });
  send(res, { type: "done", chosen, ms });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/build") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { mode } = JSON.parse(body || "{}");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      try {
        if (mode === "jev") await handleJev(res);
        else await handleBaseline(res);
      } catch (e) {
        send(res, { type: "error", message: String(e?.message ?? e) });
      }
      res.end();
      return;
    }
    const path = normalize(req.url === "/" ? "/live.html" : (req.url ?? "/live.html")).replace(/^\.\.+/, "");
    const file = join(dir, path.split("?")[0]);
    if (!file.startsWith(dir) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    const ext = file.slice(file.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    res.writeHead(500).end(String(e?.message ?? e));
  }
});

const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 8123;
server.listen(port, () => console.log(`live build-off: http://localhost:${port}/live.html`));
