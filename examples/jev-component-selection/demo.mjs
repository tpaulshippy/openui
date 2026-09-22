#!/usr/bin/env node
/**
 * Jev-first build-off: Jev composes directly, LLM only on unavailable.
 *
 * - WITHOUT Jev (baseline, arm A): full `lib.prompt()` → one gpt-4o-mini call
 *   generating openui-lang → `parse` against the full schema.
 * - WITH Jev (arm B, primary): one `jev-latest` round trip over the configured
 *   INSTANCES → `composeProgram(chosen)` → `parse`. No LLM call, 0 LLM tokens.
 *   Emit requires 0 parser errors, else the attempt is `unavailable`.
 * - Fallback: only on `unavailable` (empty selection, max score < threshold,
 *   or parse errors) → one gpt-4o-mini call under the filtered prompt (or the
 *   full prompt when nothing was chosen). Flagged `fallback: true` with
 *   `selectMs` + `genMs` tracked separately.
 *
 * Usage:
 *   set -a; source ~/shared_config; set +a
 *   node demo.mjs [--trials 3] [--state "..."]
 *
 * Env: TYPESAFE_API_KEY, OPENAI_API_KEY
 * Output: results.json (committed as a sample) + stdout timing table.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CRITERIA,
  FULL_PROMPT,
  INSTANCES as candidates,
  STATE as DEFAULT_STATE,
  composeProgram,
  experimental_composeFromChosen,
  experimental_createJevEvaluator,
  filteredLibraryForChosen,
  lib,
  paramMap as fullParamMap,
  parse,
} from "./catalog.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

const TRIALS = Number(process.argv[process.argv.indexOf("--trials") + 1]) || 3;
const STATE_ARG = process.argv.indexOf("--state");
const STATE = STATE_ARG !== -1 ? (process.argv[STATE_ARG + 1] ?? DEFAULT_STATE) : DEFAULT_STATE;
export const OFF_CATALOG_STATE =
  "Add a store-locations map widget with custom prose about holiday hours and a poetic tagline.";

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

/** One OpenAI call generating real openui-lang under the given system prompt. */
async function generateLang(systemPrompt, paramMap, state) {
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
        { role: "user", content: state },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const ms = performance.now() - started;
  const source = json.choices?.[0]?.message?.content ?? "";
  const result = parse(source, paramMap);
  return {
    ms,
    source,
    errors: result.meta.errors.length,
    errorCodes: result.meta.errors.map((e) => e.code),
    usage: json.usage ?? null,
  };
}

async function runWithoutJev(state) {
  const gen = await generateLang(FULL_PROMPT, fullParamMap, state);
  return {
    ...gen,
    promptChars: FULL_PROMPT.length,
    components: Object.keys(lib.components).sort(),
  };
}

async function runWithJev(state) {
  const evaluate = experimental_createJevEvaluator({ apiKey: TYPESAFE_API_KEY });
  const selStarted = performance.now();
  // Primary path: Jev composes directly from configured instances. No LLM.
  const attempt = await experimental_composeFromChosen({
    state,
    candidates,
    evaluate,
    criteria: CRITERIA,
    compose: (chosen) => composeProgram(chosen),
    isValid: ({ result }) => result.meta.errors.length === 0,
  });
  const selectMs = performance.now() - selStarted;
  const { selection } = attempt;
  const base = {
    selectMs,
    ms: selectMs,
    promptChars: 0,
    llmTokens: 0,
    types: [],
    chosen: selection.chosen,
    scores: selection.scores,
    maxScore: attempt.maxScore,
    model: selection.model,
    stopReason: attempt.stopReason,
    fallback: false,
  };
  if (attempt.stopReason === "finish") {
    const { source, result } = attempt.composed;
    return {
      ...base,
      source,
      errors: 0,
      errorCodes: [],
      sourceChars: source.length,
    };
  }
  // Fallback path: LLM only on unavailable. Narrow the prompt when Jev chose
  // something (even low-confidence); otherwise use the full prompt.
  const filtered = selection.chosen.length > 0 ? filteredLibraryForChosen(selection.chosen) : null;
  const gen = await generateLang(filtered ? filtered.prompt : FULL_PROMPT, filtered ? filtered.paramMap : fullParamMap, state);
  return {
    ...base,
    ...gen,
    ms: selectMs + gen.ms,
    genMs: gen.ms,
    promptChars: filtered ? filtered.prompt.length : FULL_PROMPT.length,
    types: filtered ? filtered.types : Object.keys(lib.components).sort(),
    llmTokens: (gen.usage?.prompt_tokens ?? 0) + (gen.usage?.completion_tokens ?? 0),
    sourceChars: gen.source.length,
    fallback: true,
  };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const baseline = [];
const jev = [];
for (let i = 0; i < TRIALS; i++) {
  const b = await runWithoutJev(STATE);
  baseline.push(b);
  console.log(`[baseline ${i + 1}/${TRIALS}] gen=${b.ms.toFixed(0)}ms prompt=${b.promptChars} errors=${b.errors}`);
  const j = await runWithJev(STATE);
  jev.push(j);
  console.log(
    `[jev      ${i + 1}/${TRIALS}] ${j.fallback ? `FALLBACK total=${j.ms.toFixed(0)}ms (select=${j.selectMs.toFixed(0)}+gen=${(j.genMs ?? 0).toFixed(0)})` : `alone=${j.ms.toFixed(0)}ms 0 LLM tokens`} errors=${j.errors} stop=${j.stopReason} chosen=${JSON.stringify(j.chosen)}`,
  );
}

const bMs = baseline.map((r) => r.ms);
const jMs = jev.map((r) => r.ms);
const fallbackRate = jev.filter((r) => r.fallback).length / jev.length;

console.log("\n=== Jev-first composer vs LLM baseline (gpt-4o-mini baseline only) ===");
console.log(`Baseline (full prompt ${FULL_PROMPT.length} chars): median gen ${median(bMs).toFixed(0)}ms, mean ${mean(bMs).toFixed(0)}ms, errors [${baseline.map((r) => r.errors).join(",")}]`);
console.log(`Jev arm: median ${median(jMs).toFixed(0)}ms, fallback rate ${(fallbackRate * 100).toFixed(0)}%, errors [${jev.map((r) => r.errors).join(",")}]`);

const results = {
  state: STATE,
  trials: TRIALS,
  generatedAt: new Date().toISOString(),
  design: "jev-first composer (composeProgram+parse, no LLM); LLM fallback only on unavailable",
  fullPromptChars: FULL_PROMPT.length,
  fullComponents: Object.keys(lib.components).sort(),
  baseline: {
    model: "gpt-4o-mini",
    timesMs: bMs,
    runs: baseline.map((r) => ({ ms: r.ms, promptChars: r.promptChars, errors: r.errors, errorCodes: r.errorCodes, sourceChars: r.source.length, usage: r.usage })),
  },
  jev: {
    selectModel: jev[0]?.model ?? "jev-latest",
    generateModel: "gpt-4o-mini (fallback only)",
    timesMs: jMs,
    fallbackRate,
    runs: jev.map((r) => ({
      ms: r.ms,
      selectMs: r.selectMs,
      genMs: r.genMs ?? 0,
      promptChars: r.promptChars,
      llmTokens: r.llmTokens,
      types: r.types,
      chosen: r.chosen,
      scores: r.scores,
      maxScore: r.maxScore,
      stopReason: r.stopReason,
      fallback: r.fallback,
      errors: r.errors,
      errorCodes: r.errorCodes,
      sourceChars: r.sourceChars ?? r.source?.length ?? 0,
    })),
  },
};
writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2));
console.log("Wrote results.json");
