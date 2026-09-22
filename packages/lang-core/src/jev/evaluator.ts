/**
 * Server-side evaluator for TypeSafe's Jev decision model.
 *
 * Experimental: the `experimental_` prefix means this API may change in any
 * release. Keep credentials server-side — never bundle the API key for
 * browsers.
 */
import type { Experimental_JevEvaluate, Experimental_JevResult } from "./types";

export interface Experimental_JevEvaluatorOptions {
  /** TypeSafe API key (`jev_...`). Server-side only. */
  apiKey: string;
  /** Model id. Defaults to `jev-latest`. */
  model?: string;
  /** Endpoint. Defaults to TypeSafe's evaluation endpoint. */
  endpoint?: string;
  /** Per-attempt timeout in ms. Defaults to 10000. */
  timeoutMs?: number;
  /** Extra retries on 429/529 beyond the first attempt. Defaults to 3. */
  maxRetries?: number;
  /** Override for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(500 * 2 ** attempt, 10_000);
}

/**
 * Create an evaluator that answers typed questions in one batched request.
 * Retries with backoff on 429/529 (honoring `retry-after`); throws
 * descriptive errors on 401/422.
 */
export function experimental_createJevEvaluator(
  options: Experimental_JevEvaluatorOptions,
): Experimental_JevEvaluate {
  const {
    apiKey,
    model = "jev-latest",
    endpoint = DEFAULT_ENDPOINT,
    timeoutMs = 10_000,
    maxRetries = 3,
    fetchImpl = fetch,
  } = options;
  if (!apiKey) throw new Error("[OpenUI] experimental_createJevEvaluator requires an apiKey.");

  return async (state, questions) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, state, questions }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        lastError = e;
        await sleep(retryDelay(attempt, null));
        continue;
      }
      if (res.status === 429 || res.status === 529) {
        lastError = new Error(`[OpenUI] Jev overloaded (HTTP ${res.status}), retrying.`);
        await sleep(retryDelay(attempt, res.headers.get("retry-after")));
        continue;
      }
      if (res.status === 401) {
        throw new Error("[OpenUI] Jev rejected the API key (HTTP 401).");
      }
      if (res.status === 422) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`[OpenUI] Jev rejected the request (HTTP 422): ${detail}`);
      }
      if (!res.ok) throw new Error(`[OpenUI] Jev request failed (HTTP ${res.status}).`);
      return (await res.json()) as Experimental_JevResult;
    }
    throw lastError instanceof Error ? lastError : new Error("[OpenUI] Jev request failed.");
  };
}
