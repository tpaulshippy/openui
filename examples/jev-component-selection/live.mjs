#!/usr/bin/env node
/**
 * Live build-off server: realistic UI-being-built demo (28-candidate
 * dashboard + preferences task) running on the REAL lang-core library.
 *
 * - Catalog: real `defineComponent`/`createLibrary` in catalog.mjs.
 * - Baseline: prompt is `lib.prompt()` (generated, not hand-written); the
 *   streamed openui-lang program is validated with the real `parse` and the
 *   page renders only the validated AST.
 * - Jev: one `jev-latest` round trip over catalog instances; selections are
 *   composed with the real `jsonToOpenUI` and re-validated with `parse`.
 *
 * Usage:
 *   node live.mjs [--port 8123]
 *   # open http://localhost:8123/live.html
 */
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

import {
  CRITERIA,
  INSTANCES,
  STATE,
  composeProgram,
  experimental_createJevEvaluator,
  experimental_selectCandidates,
  programChildren,
} from "./catalog.mjs";

const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!TYPESAFE_API_KEY || !OPENAI_API_KEY) {
  console.error("Need TYPESAFE_API_KEY and OPENAI_API_KEY in env.");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".json": "application/json", ".mjs": "text/javascript", ".js": "text/javascript", ".md": "text/markdown" };

function send(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// THE SWITCH — both arms run the identical library pipeline:
//   selectCandidates({ state, candidates, evaluate }) → composeProgram → parse → render.
// Only `evaluate` differs:
// - baseline: LLM-backed adapter for the Experimental_JevEvaluate interface
//   (one OpenAI call returning {"chosen": [...]}, tokens forwarded for display).
// - jev: experimental_createJevEvaluator (one Jev round trip, all parallel).

function createLlmEvaluate(onToken) {
  return async (state, questions) => {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You select UI components for a generative-UI composer. " +
              "Reply with JSON only: {\"chosen\": [\"<candidate-id>\", ...]} using exactly the candidate ids given.",
          },
          {
            role: "user",
            content:
              `Request: ${state}\n\nCandidates:\n` +
              INSTANCES.map((c) => `- ${c.id} (${c.component}): ${c.description}`).join("\n"),
          },
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
              onToken(delta);
            }
          } catch { /* keep-alive whitespace */ }
        }
      }
    }
    let chosen = [];
    try {
      chosen = JSON.parse(raw).chosen ?? [];
    } catch { /* fall through with empty selection */ }
    // Map onto Noul-shaped answers so the shared selector consumes both identically.
    const answers = {};
    for (const c of INSTANCES) {
      const qid = `include_${c.id.replaceAll("-", "_")}`;
      if (questions[qid]) answers[qid] = { type: "noul", noul: chosen.includes(c.id) ? 1 : 0 };
    }
    return { model: "gpt-4o-mini", answers, usage: { input_tokens: 0, output_tokens: 0 } };
  };
}

/** Shared finish: compose the selection into a validated program. */
function finishSelection(selection) {
  const { source, result } = composeProgram(selection.chosen);
  return {
    nodes: programChildren(result),
    errors: result.meta.errors.length,
    errorCodes: result.meta.errors.map((e) => e.code),
    source,
  };
}

async function handleBaseline(res) {
  const started = performance.now();
  const evaluate = createLlmEvaluate((delta) => send(res, { type: "token", text: delta }));
  const selection = await experimental_selectCandidates({
    state: STATE,
    candidates: INSTANCES,
    evaluate,
    criteria: CRITERIA,
  });
  const ms = performance.now() - started;
  const finished = finishSelection(selection);
  send(res, { type: "done", ...finished, ms });
}

async function handleJev(res) {
  send(res, { type: "status", text: `1 round trip: evaluating ${INSTANCES.length} candidates in parallel…` });
  const started = performance.now();
  const evaluate = experimental_createJevEvaluator({ apiKey: TYPESAFE_API_KEY });
  const selection = await experimental_selectCandidates({
    state: STATE,
    candidates: INSTANCES,
    evaluate,
    criteria: CRITERIA,
  });
  const ms = performance.now() - started;
  // All decisions arrived together in the single response; the page may
  // stagger chip rendering for visibility, which is presentational only.
  const finished = finishSelection(selection);
  send(res, {
    type: "decisions", chosen: selection.chosen, scores: selection.scores, ms,
    ...finished, model: selection.model ?? "jev-latest",
  });
  send(res, { type: "done", chosen: selection.chosen, ms });
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
