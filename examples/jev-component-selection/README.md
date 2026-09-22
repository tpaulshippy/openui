# Jev build-off: same library, same Renderer — only the evaluator differs

Top Jev use case: discrete component-candidate selection from a component
catalog instead of free-form LLM generation.

## Library change (`packages/lang-core/src/jev/`)

New experimental module (server-side only — keys must never ship to browsers):

- `experimental_createJevEvaluator({ apiKey, model?, timeoutMs?, maxRetries? })`
  → batched `evaluate(state, questions)` with retry/backoff on 429/529
  (honoring `retry-after`) and descriptive errors on 401/422.
- `experimental_selectCandidates({ state, candidates, evaluate, threshold? })`
  → one batched call answers a Noul question per candidate; returns
  `{ chosen, scores, model }` so callers can gate on confidence.
- Tests: `src/jev/__tests__/select.test.ts` (`vitest run src/jev`).

## Live build-off (`live.html` + `live.mjs` + `client/`)

28-candidate sales dashboard. Both sides share one pipeline —
`selectCandidates → composeProgram (jsonToOpenUI) → parse → <Renderer>` —
over one `createLibrary` catalog (16 `defineComponent`s with zod schemas).
The switch is only the evaluator:

- **Without Jev**: LLM-backed `Experimental_JevEvaluate` adapter
  (one `gpt-4o-mini` call returning `{"chosen": [...]}`, mapped to Noul answers).
- **With Jev**: the real evaluator (one `jev-latest` round trip, all parallel).

Both sides render through the real react-lang `<Renderer>` with real React
components (`client/components.tsx`). Recorded run: **~0.3s vs ~1.3s**.

## Run

```bash
npm i && node client/build.mjs   # build React client (gitignored output)
set -a; source ~/shared_config; set +a
node demo.mjs --trials 3         # timed benchmark → results.json
node live.mjs                    # open live.html → Build
```

`demo.mjs` runs the same shared selector headlessly for medians.
`index.html` visualizes `results.json`.

## Limits (honest)

- Jev selects from the catalog only — no prose, prop values, or layout invention.
- Closed API, text-only, server-side keys. Confidence is not a correctness guarantee.
- The committed `vendor/lang-core.bundle.mjs` is a frozen build of
  `packages/lang-core/src` (see `vendor/PROVENANCE.md`) so the demo runs
  without a monorepo install; long term this should be a workspace dependency.
