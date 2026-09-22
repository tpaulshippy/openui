import { describe, expect, it, vi } from "vitest";
import { experimental_createJevEvaluator } from "../evaluator";
import { experimental_selectCandidates } from "../select";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("experimental_createJevEvaluator", () => {
  it("posts model/state/questions with bearer auth", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }),
    );
    const evaluate = experimental_createJevEvaluator({ apiKey: "k", fetchImpl });
    await evaluate("state-text", { q: { type: "noul", instructions: "?" } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init?.headers as Record<string, string>)?.["Authorization"]).toBe("Bearer k");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: "jev-latest",
      state: "state-text",
    });
  });

  it("retries 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn(async () => new Response("slow", { status: 429 }))
      .mockImplementationOnce(async () => new Response("slow", { status: 429 }))
      .mockImplementationOnce(async () =>
        jsonResponse({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }),
      );
    const evaluate = experimental_createJevEvaluator({ apiKey: "k", fetchImpl });
    const result = await evaluate("s", {});
    expect(result.model).toBe("jev-1.13.0");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws on 401 without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const evaluate = experimental_createJevEvaluator({ apiKey: "bad", fetchImpl, maxRetries: 2 });
    await expect(evaluate("s", {})).rejects.toThrow("401");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("requires an apiKey", () => {
    expect(() => experimental_createJevEvaluator({ apiKey: "" })).toThrow("apiKey");
  });
});

describe("experimental_selectCandidates", () => {
  it("thresholds Noul scores into chosen ids", async () => {
    const evaluate = vi.fn(async () => ({
      model: "jev-1.13.0",
      answers: {
        include_a: { type: "noul", noul: 0.9 },
        include_b: { type: "noul", noul: 0.2 },
      },
      usage: { input_tokens: 10, output_tokens: 0 },
    }));
    const selection = await experimental_selectCandidates({
      state: "request",
      candidates: [
        { id: "a", component: "Table", props: {}, description: "things" },
        { id: "b", component: "Table", props: {}, description: "other things" },
      ],
      evaluate,
    });
    expect(selection.chosen).toEqual(["a"]);
    expect(selection.scores).toEqual({ a: 0.9, b: 0.2 });
    // One batched call, not one per candidate.
    expect(evaluate).toHaveBeenCalledOnce();
  });
});
