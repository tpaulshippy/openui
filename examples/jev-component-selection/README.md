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

## Run

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
