# Jev demo: component-candidate selection (LLM baseline vs Jev)

Top use case from the Jev evaluation: constrain generative UI to a
`createLibrary` catalog by selecting discrete components instead of letting an
LLM freely generate trees.

## What this demo does

Same 8 candidates (`candidates.json`), same request:

- **Without Jev** (`demo.mjs` → OpenAI): one `gpt-4o-mini` JSON-mode call
  returning `{"chosen": [...]}`.
- **With Jev** (`demo.mjs` → TypeSafe): one `jev-latest` `POST /v1/systemone`
  call with 8 batched `Noul` questions (`include_<id>`, threshold ≥ 0.5).
  All questions evaluate in parallel in a single round trip.

`index.html` renders the side-by-side result from `results.json`
(timing bars, chosen ids, mock preview). No keys in the page.

## Live build-off (realistic UI construction)

`live.mjs` + `live.html` hit the live APIs while two interfaces build side by side:

```bash
set -a; source ~/shared_config; set +a
node live.mjs [--port 8123]
# open http://localhost:8123/live.html → "Build both interfaces"
```

Left is one `gpt-4o-mini` call streaming the full composed spec
(`sections` with grouped, ordered components — OpenUI's real generation path).
Right makes one real
`jev-latest` round trip (all 28 decisions arrive together), flips candidate
chips, then renders the same dashboard with grouping/ordering done in code. Timers and the speedup badge are measured
live, so numbers vary run to run (typical: ~0.3s vs ~1.5–2s).

## Benchmark (timed runs)

```bash
set -a; source ~/shared_config; set +a
node demo.mjs --trials 3
# → prints timing table, writes results.json
python3 -m http.server 8000  # then open examples/jev-component-selection/index.html
```

Requires `TYPESAFE_API_KEY` and `OPENAI_API_KEY` (server-side only).

## Interpret

Expect Jev median ~100–400ms vs LLM baseline ~1–5s on this task
(roughly an order of magnitude; exact numbers vary by run).
Jev returns per-candidate probabilities; gate on them
(e.g. act if confidence high, else escalate).

## Limits (honest)

- Jev picks from the catalog only. It cannot invent prose, prop values,
  bindings, or layout — pair it with prepared candidates + `initialState`.
- Text-only, closed API, no self-host. Keep keys server-side.
- Confidence is not a correctness guarantee; completion ≠ correctness.
- Baseline choice (`gpt-4o-mini`) is deliberately the fastest reasonable LLM
  path; larger models would widen the gap but cost more.
