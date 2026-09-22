/**
 * Catalog-candidate selection through a batched evaluator (Jev or compatible).
 *
 * Jev-first composition (json-render approach): the evaluator chooses among
 * app-owned configured instances in one batched round trip; the caller maps
 * chosen ids to validated output with deterministic code (`composeProgram` in
 * the demo: section ordering, preferences-panel grouping, `jsonToOpenUI` +
 * `parse`). The model never invents props, layout, or prose — it only selects
 * from what the app offers. The LLM is a fallback for `unavailable` only.
 * One evaluator call answers every question in parallel — adding candidates
 * barely changes latency, unlike one LLM call per decision.
 */
import type { Experimental_JevEvaluate } from "./types";

export interface Experimental_Candidate {
  /** Stable id used for the question key (`include_<id>`) and selection output. */
  id: string;
  /** Component name in the library catalog. */
  component: string;
  /** Configured props for this instance. */
  props: Record<string, unknown>;
  /** Human description — the decision-relevant signal for the evaluator. */
  description: string;
}

export interface Experimental_SelectOptions {
  /** The request/context to decide about (prompt text, records, …). */
  state: unknown;
  /** Configured instances to choose from. */
  candidates: Experimental_Candidate[];
  /** Batched evaluator (Jev, or an LLM-backed adapter for comparison). */
  evaluate: Experimental_JevEvaluate;
  /** Include threshold on the Noul probability. Defaults to 0.5. */
  threshold?: number;
  /** Rubric framing for the include decision. */
  criteria?: { true: string; false: string };
}

export interface Experimental_Selection {
  chosen: string[];
  scores: Record<string, number>;
  model: string | null;
}

/** Build one Noul question per candidate: should this instance be included? */
export function experimental_candidateQuestions(
  candidates: Experimental_Candidate[],
  criteria?: { true: string; false: string },
): Record<string, { type: "noul"; instructions: string; criteria?: { true: string; false: string } }> {
  const questions: Record<string, { type: "noul"; instructions: string; criteria?: { true: string; false: string } }> = {};
  for (const c of candidates) {
    questions[`include_${c.id.replaceAll("-", "_")}`] = {
      type: "noul",
      instructions: `Should the candidate "${c.id}" (${c.component} ${JSON.stringify(c.props)}: ${c.description}) be included in the composed UI?`,
      ...(criteria ? { criteria } : {}),
    };
  }
  return questions;
}

/**
 * Select catalog candidates in a single batched evaluation.
 * Returns ids at/above threshold with per-candidate probabilities so
 * callers can gate on confidence (act vs escalate).
 *
 * This is the Jev-first step of compose-then-validate: feed `chosen` into a
 * deterministic composer and validate the output. An empty `chosen` means
 * the evaluator judged nothing relevant — treat as "unavailable" and use the
 * LLM fallback; do not silently widen back to the full catalog.
 */
export async function experimental_selectCandidates(
  options: Experimental_SelectOptions,
): Promise<Experimental_Selection> {
  const { state, candidates, evaluate, threshold = 0.5, criteria } = options;
  const questions = experimental_candidateQuestions(candidates, criteria);
  const result = await evaluate(state, questions);
  const scores: Record<string, number> = {};
  for (const c of candidates) {
    const answer = result.answers[`include_${c.id.replaceAll("-", "_")}`];
    scores[c.id] = answer?.type === "noul" ? answer.noul : 0;
  }
  return {
    chosen: candidates.filter((c) => scores[c.id] >= threshold).map((c) => c.id),
    scores,
    model: result.model ?? null,
  };
}

/** Terminal status of a Jev-first composition attempt. */
export type Experimental_ComposeStopReason = "finish" | "unavailable";

export interface Experimental_ComposedFromChosen<T> {
  stopReason: Experimental_ComposeStopReason;
  selection: Experimental_Selection;
  /** Highest per-candidate score — below threshold means low confidence. */
  maxScore: number;
  /** Present only on `finish`: the validated composer output. */
  composed?: T;
}

/**
 * Compose-then-validate contract shared by Jev-first callers.
 *
 * 1. `selectCandidates` in one batched round trip.
 * 2. `unavailable` when `chosen` is empty OR every score is below threshold
 *    (low confidence) — the caller should run the LLM fallback.
 * 3. Otherwise run `compose(chosen)`; the composer must validate (e.g.
 *    `parse` with 0 errors). `isValid` false is also `unavailable`.
 *
 * Never widens to the full catalog silently: `unavailable` always routes to
 * the explicit fallback path so `results.json` can track fallback rate.
 */
export async function experimental_composeFromChosen<T>(options: {
  state: unknown;
  candidates: Experimental_Candidate[];
  evaluate: Experimental_JevEvaluate;
  threshold?: number;
  criteria?: { true: string; false: string };
  compose: (chosen: string[]) => Promise<T> | T;
  isValid: (composed: T) => boolean;
}): Promise<Experimental_ComposedFromChosen<T>> {
  const { threshold = 0.5, compose, isValid } = options;
  const selection = await experimental_selectCandidates(options);
  const maxScore = Math.max(0, ...Object.values(selection.scores));
  if (selection.chosen.length === 0 || maxScore < threshold) {
    return { stopReason: "unavailable", selection, maxScore };
  }
  const composed = await compose(selection.chosen);
  if (!isValid(composed)) {
    return { stopReason: "unavailable", selection, maxScore };
  }
  return { stopReason: "finish", selection, maxScore, composed };
}

/**
 * Map a candidate-id selection to the distinct component type names it uses.
 * Use this to build a filtered library/prompt for a downstream LLM:
 * `chosen` instance ids → `["Table", "KpiCard", ...]`. Always include the
 * library root separately — selection never votes on the root container.
 */
export function experimental_componentTypesForChosen(
  candidates: Experimental_Candidate[],
  chosen: readonly string[],
): string[] {
  const byId = new Map(candidates.map((c) => [c.id, c.component]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of chosen) {
    const component = byId.get(id);
    if (component && !seen.has(component)) {
      seen.add(component);
      out.push(component);
    }
  }
  return out.sort();
}
