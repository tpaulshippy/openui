#!/usr/bin/env node
/**
 * Live build-off server: Jev-first composer, LLM only on unavailable.
 *
 * - Catalog: real `defineComponent`/`createLibrary` in catalog.mjs.
 * - Baseline (left): full `lib.prompt()` as the system prompt; streams real
 *   openui-lang tokens from gpt-4o-mini, validates with the real `parse`,
 *   and the page renders only the validated AST.
 * - Jev (right, primary): one `jev-latest` round trip over the configured
 *   INSTANCES → `composeProgram(chosen)` → `parse`. The composed UI renders
 *   immediately on decisions (~0.3s) with 0 LLM tokens. `parse` must yield 0
 *   errors or the attempt is `unavailable`.
 * - Fallback: only on `unavailable` (empty/low-confidence selection or parse
 *   errors) → one gpt-4o-mini call under the filtered (or full) prompt whose
 *   tokens stream like the baseline. Flagged `fallback: true`.
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
  FOLLOW_UPS,
  FULL_PROMPT,
  INSTANCES,
  STATE,
  composeEdit,
  composeProgram,
  experimental_composeFromChosen,
  experimental_createJevEvaluator,
  filteredLibraryForChosen,
  lib,
  paramMap as fullParamMap,
  parse,
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

/** Stream one OpenAI chat completion as raw text deltas. Returns full text. */
async function streamLang(res, systemPrompt, onToken) {
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: STATE },
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
  return raw;
}

function finishSource(source, paramMap) {
  const result = parse(source, paramMap);
  return {
    source,
    errors: result.meta.errors.length,
    errorCodes: result.meta.errors.map((e) => e.code),
  };
}

async function handleBaseline(res) {
  send(res, { type: "status", text: `full prompt: ${FULL_PROMPT.length} chars, ${Object.keys(lib.components).length} components…` });
  const started = performance.now();
  const source = await streamLang(res, FULL_PROMPT, (delta) => send(res, { type: "token", text: delta }));
  const ms = performance.now() - started;
  const finished = finishSource(source, fullParamMap);
  send(res, { type: "done", ...finished, ms, promptChars: FULL_PROMPT.length, components: Object.keys(lib.components).sort() });
}

async function handleJev(res) {
  send(res, { type: "status", text: `1 round trip: evaluating ${INSTANCES.length} candidates in parallel…` });
  const selStarted = performance.now();
  const evaluate = experimental_createJevEvaluator({ apiKey: TYPESAFE_API_KEY });
  const attempt = await experimental_composeFromChosen({
    state: STATE,
    candidates: INSTANCES,
    evaluate,
    criteria: CRITERIA,
    compose: (chosen) => composeProgram(chosen),
    isValid: ({ result }) => result.meta.errors.length === 0,
  });
  const selectMs = performance.now() - selStarted;
  const { selection } = attempt;
  if (attempt.stopReason === "finish") {
    // Primary path: render immediately, no LLM tokens.
    const { source } = attempt.composed;
    send(res, {
      type: "decisions",
      chosen: selection.chosen,
      scores: selection.scores,
      maxScore: attempt.maxScore,
      stopReason: "finish",
      fallback: false,
      ms: selectMs,
      selectMs,
      promptChars: 0,
      llmTokens: 0,
      source,
      errors: 0,
      errorCodes: [],
      model: selection.model ?? "jev-latest",
    });
    send(res, { type: "done", chosen: selection.chosen, ms: selectMs, fallback: false, errors: 0 });
    return;
  }
  // Fallback path: LLM only on unavailable.
  const reason =
    selection.chosen.length === 0 ? "empty selection" : attempt.maxScore < 0.5 ? "low confidence" : "composed output failed validation";
  const filtered = selection.chosen.length > 0 ? filteredLibraryForChosen(selection.chosen) : null;
  const prompt = filtered ? filtered.prompt : FULL_PROMPT;
  const paramMap = filtered ? filtered.paramMap : fullParamMap;
  send(res, {
    type: "status",
    text: `unavailable (${reason}) — LLM fallback under ${filtered ? "filtered" : "full"} prompt…`,
    chosen: selection.chosen,
    scores: selection.scores,
    maxScore: attempt.maxScore,
    stopReason: "unavailable",
    selectMs,
    promptChars: prompt.length,
  });
  const genStarted = performance.now();
  const source = await streamLang(res, prompt, (delta) => send(res, { type: "token", text: delta }));
  const genMs = performance.now() - genStarted;
  const finished = finishSource(source, paramMap);
  send(res, {
    type: "done",
    ...finished,
    ms: selectMs + genMs,
    selectMs,
    genMs,
    promptChars: prompt.length,
    types: filtered ? filtered.types : Object.keys(lib.components).sort(),
    chosen: selection.chosen,
    scores: selection.scores,
    maxScore: attempt.maxScore,
    stopReason: "unavailable",
    fallback: true,
    model: selection.model ?? "jev-latest",
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/edit") {
      // Follow-up tweak: one Jev edit round over the caller's current tree.
      // Jev-only in live (no LLM fallback stream); unavailable is reported
      // honestly so the UI keeps the last good tree.
      let body = "";
      for await (const chunk of req) body += chunk;
      const { chosen, prompt, index } = JSON.parse(body || "{}");
      if (!Array.isArray(chosen) || typeof prompt !== "string" || !FOLLOW_UPS.includes(prompt)) {
        res.writeHead(400).end("unknown edit");
        return;
      }
      try {
        const evaluate = experimental_createJevEvaluator({ apiKey: TYPESAFE_API_KEY });
        const out = await composeEdit(evaluate, chosen, prompt);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...out, index }));
      } catch (e) {
        res.writeHead(500).end(String(e?.message ?? e));
      }
      return;
    }
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
