/**
 * Typed questions and answers for TypeSafe's Jev ("System One") decision model.
 *
 * Jev evaluates questions against a state and returns structured decisions —
 * no text generation, no parsing. See https://docs.typesafe.ai/api
 */

export type JevQuestionType = "noul" | "choice" | "score";

export interface JevNoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type Experimental_JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Experimental_JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface Experimental_JevResult {
  model: string;
  answers: Record<string, Experimental_JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * An evaluation function: questions about a state, answered in one batch.
 * Satisfied by `experimental_createJevEvaluator` — or any compatible
 * implementation (including an LLM-backed adapter used for comparison).
 */
export type Experimental_JevEvaluate = (
  state: unknown,
  questions: Record<string, Experimental_JevQuestion>,
) => Promise<Experimental_JevResult>;
