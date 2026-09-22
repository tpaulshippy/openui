#!/usr/bin/env node
/**
 * Jev vs LLM baseline for OpenUI component-candidate selection.
 *
 * Top use case from the Jev evaluation: choosing a discrete component subset
 * from a `createLibrary` catalog instead of free-form LLM generation.
 *
 * - WITHOUT Jev: one OpenAI chat-completion call (gpt-4o-mini, JSON mode)
 *   asked to return {"chosen": ["id", ...]} for the same candidates.
 * - WITH Jev: one TypeSafe `POST /v1/systemone` call with a batched set of
 *   Noul questions (include_<id>), threshold >= 0.5. All questions are
 *   evaluated in parallel in a single round trip.
 *
 * Usage:
 *   set -a; source ~/shared_config; set +a
 *   node demo.mjs [--trials 3]
 *
 * Env: TYPESAFE_API_KEY, OPENAI_API_KEY
 * Output: results.json (committed as a sample) + stdout timing table.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CRITERIA,
  INSTANCES as candidates,
  STATE,
  experimental_createJevEvaluator,
  experimental_selectCandidates,
} from "./catalog.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

const TRIALS = Number(process.argv[process.argv.indexOf("--trials") + 1]) || 3;

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

function candidateList() {
  return candidates.map((c) => `- ${c.id} (${c.component}): ${c.description}`).join("\n");
}

async function runWithoutJev() {
  const started = performance.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
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
          content: `Request: ${STATE}\n\nCandidates:\n${candidateList()}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const ms = performance.now() - started;
  let rawChosen = [];
  try {
    rawChosen = JSON.parse(json.choices[0].message.content).chosen ?? [];
  } catch {
    rawChosen = [];
  }
  // Route through the shared library selector so both arms differ only in evaluator.
  const evaluate = async (state, questions) => {
    const answers = {};
    for (const c of candidates) {
      const qid = `include_${c.id.replaceAll("-", "_")}`;
      if (questions[qid]) answers[qid] = { type: "noul", noul: rawChosen.includes(c.id) ? 1 : 0 };
    }
    return { model: "gpt-4o-mini", answers, usage: json.usage ?? { input_tokens: 0, output_tokens: 0 } };
  };
  const selection = await experimental_selectCandidates({
    state: STATE,
    candidates,
    evaluate,
    criteria: CRITERIA,
  });
  return { ms, chosen: selection.chosen, usage: json.usage ?? null };
}

async function runWithJev() {
  const evaluate = experimental_createJevEvaluator({ apiKey: TYPESAFE_API_KEY });
  const started = performance.now();
  const selection = await experimental_selectCandidates({
    state: STATE,
    candidates,
    evaluate,
    criteria: CRITERIA,
  });
  const ms = performance.now() - started;
  return { ms, chosen: selection.chosen, scores: selection.scores, usage: null, model: selection.model };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const baseline = [];
const jev = [];
for (let i = 0; i < TRIALS; i++) {
  const b = await runWithoutJev();
  baseline.push(b);
  console.log(`[baseline ${i + 1}/${TRIALS}] ${b.ms.toFixed(0)}ms chosen=${JSON.stringify(b.chosen)}`);
  const j = await runWithJev();
  jev.push(j);
  console.log(`[jev      ${i + 1}/${TRIALS}] ${j.ms.toFixed(0)}ms chosen=${JSON.stringify(j.chosen)}`);
}

const bMs = baseline.map((r) => r.ms);
const jMs = jev.map((r) => r.ms);
const speedup = median(bMs) / median(jMs);

console.log("\n=== Component-candidate selection: LLM baseline vs Jev ===");
console.log(`Baseline (gpt-4o-mini JSON mode): median ${median(bMs).toFixed(0)}ms, mean ${mean(bMs).toFixed(0)}ms`);
console.log(`Jev (jev-latest, ${candidates.length} batched Noul): median ${median(jMs).toFixed(0)}ms, mean ${mean(jMs).toFixed(0)}ms`);
console.log(`Speedup (median): ${speedup.toFixed(1)}x faster with Jev`);

const results = {
  state: STATE,
  trials: TRIALS,
  generatedAt: new Date().toISOString(),
  baseline: { model: "gpt-4o-mini", timesMs: bMs, runs: baseline.map((r) => ({ ms: r.ms, chosen: r.chosen })) },
  jev: { model: jev[0]?.model ?? "jev-latest", timesMs: jMs, runs: jev.map((r) => ({ ms: r.ms, chosen: r.chosen, scores: r.scores })) },
  speedupMedian: speedup,
};
writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2));
console.log("Wrote results.json");
