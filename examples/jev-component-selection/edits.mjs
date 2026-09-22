#!/usr/bin/env node
/**
 * Follow-up edits benchmark: LLM first paint, Jev tweaks after.
 *
 * - Initial tree: one gpt-4o-mini call under the full prompt (creative work),
 *   plus the Jev-composed starting point for the edit chain.
 * - Each FOLLOW_UPS prompt: one `jev-latest` round trip over the enumerated
 *   edit ops (swap/add/remove against the current tree) → apply top op →
 *   `composeProgram` → `parse` (0 errors required). No LLM call.
 * - Fallback: LLM regenerates full Lang with the follow-up appended, only on
 *   `unavailable` (no op above threshold or parse errors). Flagged per edit.
 *
 * Usage:
 *   set -a; source ~/shared_config; set +a
 *   node edits.mjs [--trials 2]
 *
 * Env: TYPESAFE_API_KEY, OPENAI_API_KEY
 * Output: edits-results.json (committed as a sample) + stdout table.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  lib,
  paramMap as fullParamMap,
  parse,
} from "./catalog.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

const TRIALS = Number(process.argv[process.argv.indexOf("--trials") + 1]) || 2;

const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!TYPESAFE_API_KEY) {
  console.error("Missing TYPESAFE_API_KEY in env. Source ~/shared_config first.");
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in env. Source ~/shared_config first.");
  process.exit(1);
}

async function generateLang(systemPrompt, userText) {
  const started = performance.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const ms = performance.now() - started;
  const source = json.choices?.[0]?.message?.content ?? "";
  const result = parse(source, fullParamMap);
  return { ms, source, errors: result.meta.errors.length, usage: json.usage ?? null };
}

async function runJevEditRound(evaluate, currentChosen, editPrompt, threshold = 0.5) {
  return composeEdit(evaluate, currentChosen, editPrompt, { threshold });
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const trials = [];
for (let t = 0; t < TRIALS; t++) {
  // First paint: LLM (creative work) + Jev-composed starting point for edits.
  const initial = await generateLang(FULL_PROMPT, STATE);
  console.log(`[trial ${t + 1}] first paint (LLM): ${initial.ms.toFixed(0)}ms errors=${initial.errors}`);
  const evaluate = experimental_createJevEvaluator({ apiKey: TYPESAFE_API_KEY });
  const start = await experimental_composeFromChosen({
    state: STATE,
    candidates: INSTANCES,
    evaluate,
    criteria: CRITERIA,
    compose: (chosen) => composeProgram(chosen),
    isValid: ({ result }) => result.meta.errors.length === 0,
  });
  let current = start.stopReason === "finish" ? start.selection.chosen : [];
  if (start.stopReason !== "finish") {
    console.log(`[trial ${t + 1}] initial Jev compose unavailable — skipping chain`);
    trials.push({ initialMs: initial.ms, edits: [] });
    continue;
  }
  const edits = [];
  for (const prompt of FOLLOW_UPS) {
    const e = await runJevEditRound(evaluate, current, prompt);
    if (e.stopReason === "finish") {
      current = e.chosen;
      console.log(`  edit "${prompt.slice(0, 42)}…": ${e.topKey} in ${e.ms.toFixed(0)}ms (no LLM)`);
      edits.push({ prompt, ...e, fallback: false });
    } else {
      const fb = await generateLang(FULL_PROMPT, `${STATE}\n\nFollow-up change: ${prompt}`);
      console.log(`  edit "${prompt.slice(0, 42)}…": UNAVAILABLE → LLM fallback ${fb.ms.toFixed(0)}ms`);
      edits.push({ prompt, ...e, fallback: true, fallbackMs: fb.ms, errors: fb.errors });
    }
  }
  trials.push({ initialMs: initial.ms, edits });
}

const editTimes = trials.flatMap((t) => t.edits.filter((e) => !e.fallback).map((e) => e.ms));
const fallbackRate = trials.flatMap((t) => t.edits).filter((e) => e.fallback).length / Math.max(1, trials.flatMap((t) => t.edits).length);
console.log(`\n=== Follow-up edits: Jev tweaks after LLM first paint ===`);
console.log(`First paint (LLM) median: ${median(trials.map((t) => t.initialMs)).toFixed(0)}ms`);
console.log(`Jev edits median: ${editTimes.length ? median(editTimes).toFixed(0) : "n/a"}ms (no LLM), fallback rate ${(fallbackRate * 100).toFixed(0)}%`);

const results = {
  state: STATE,
  followUps: FOLLOW_UPS,
  trials: TRIALS,
  generatedAt: new Date().toISOString(),
  design: "LLM first paint, Jev edit ops (swap/add/remove) after; LLM fallback only on unavailable",
  fallbackRate,
  runs: trials.map((t) => ({
    initialMs: t.initialMs,
    edits: t.edits.map((e) => ({
      prompt: e.prompt,
      ms: e.ms,
      ops: e.ops,
      stopReason: e.stopReason,
      topKey: e.topKey,
      topScore: e.topScore,
      opType: e.opType ?? null,
      fallback: e.fallback,
      fallbackMs: e.fallbackMs ?? 0,
      errors: e.errors ?? 0,
    })),
  })),
};
writeFileSync(join(dir, "edits-results.json"), JSON.stringify(results, null, 2));
console.log("Wrote edits-results.json");
