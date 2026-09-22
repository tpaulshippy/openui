/**
 * Catalog-candidate selection through a batched evaluator (Jev or compatible).
 *
 * The model selects from configured instances; code composes the result.
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
