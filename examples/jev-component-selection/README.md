# Jev-first build-off: Jev composes directly, LLM only on unavailable

Jev is the composer, not a pre-filter. It chooses among app-owned configured
instances in one batched round trip; deterministic code maps the choice to
validated openui-lang. The LLM runs only when Jev reports unavailable.

## Library change (`packages/lang-core/src/jev/`)

Server-side only — keys must never ship to browsers.
Evaluator (`experimental_createJevEvaluator`) is unchanged: direct
`POST https://api.typesafe.ai/v1/systemone` with `TYPESAFE_API_KEY`,
retry/backoff on 429/529, descriptive errors on 401/422.

- `experimental_selectCandidates({ state, candidates, evaluate, threshold? })`
  → one batched call answers a Noul question per candidate (`include_<id>`,
  threshold 0.5 default, `CRITERIA` rubric); returns `{ chosen, scores, model }`.
- `experimental_composeFromChosen({ state, candidates, evaluate, threshold?,
  criteria?, compose, isValid })` → compose-then-validate contract: `finish`
  with validated output, or `unavailable` when `chosen` is empty, max score is
  below threshold, or `isValid(composed)` fails. Never widens silently.
- `experimental_componentTypesForChosen(candidates, chosen)` → distinct sorted
  types, used only to size the fallback prompt.
- Tests: `src/jev/__tests__/select.test.ts` (composer success, empty →
  unavailable, invalid parse → unavailable).

## Live build-off (`live.html` + `live.mjs` + `client/`)

Sales dashboard over one `createLibrary` catalog (16 `defineComponent`s).
Both sides render through the real react-lang `<Renderer>`:

- **Without Jev**: full `lib.prompt()` → one `gpt-4o-mini` call streaming real
  Lang tokens → real `parse`.
- **With Jev (primary)**: one `jev-latest` round trip over 28 configured
  INSTANCES → `composeProgram(chosen)` (section ordering,
  preferences-panel grouping, `jsonToOpenUI` + `parse`) → UI renders
  immediately on the `decisions` event, 0 LLM tokens. `parse` must yield 0
  errors or the attempt is `unavailable`.
- **Fallback**: only on `unavailable` → one `gpt-4o-mini` call under the
  filtered (or full) prompt, tokens stream like the baseline. SSE `done`
  carries `stopReason` (`finish`/`unavailable`), per-candidate `scores`, and
  `fallback: true` so the badge, chips, and `results.json` show Jev-alone vs
  fallback cost separately.

## Run

```bash
npm i && node client/build.mjs   # build React client (gitignored output)
set -a; source ~/shared_config; set +a
node demo.mjs --trials 3         # Jev-alone benchmark → results.json
node demo.mjs --trials 1 --state "Add a store-locations map widget with custom prose about holiday hours and a poetic tagline."
                                 # off-catalog prompt: expect fallback:true
node live.mjs                    # open live.html → Build
```

`demo.mjs` metrics per run: ms (`selectMs` + `genMs` on fallback), prompt
chars, parser errors, `stopReason`, `fallback` flag, fallback rate.
`index.html` visualizes `results.json`.

## Follow-up edits (`edits.mjs` + `/api/edit` + `record/record_edits.py`)

LLM first paint, Jev tweaks after — the edit loop is where per-iteration
latency matters. `catalog.mjs` enumerates discrete ops against the current
tree (`buildEditOps`: swap within a component type, remove, add), one Jev
round trip picks the top op at/above threshold (`composeEdit`), list surgery
(`applyEditOp`) + `composeProgram` + `parse` must yield 0 errors. LLM
regenerates only on `unavailable`.

```bash
node edits.mjs --trials 2   # headless chain → edits-results.json
```

Headless medians: first paint (LLM) ~3s once, then tweaks at ~200ms each with
0 LLM tokens (swap chart variant, drop a KPI, add Export CSV — 0% fallback).
Live: after Build, three tweak buttons under the panels drive `/api/edit` and
re-render the Jev side in place; capture with
`python record/record_edits.py`.

## Reproduce the video

```bash
node live.mjs &  # serve the demo (needs TYPESAFE_API_KEY + OPENAI_API_KEY)
python record/record.py --out /tmp/jev-live-demo.mp4  # needs Playwright Chromium + ffmpeg
```

Clicks Build, waits for both sides, scrolls the result, encodes H.264 —
the same file attached to the PR via `gh pr edit --attach`.

## Limits (honest)

- Jev selects from the catalog only — no prose, prop values, or layout invention.
  Off-catalog requests (custom prose, uncovered components) are `unavailable`
  and cost a full LLM fallback call.
- Closed API, text-only, server-side keys. Confidence is not a correctness guarantee.
- The committed `vendor/lang-core.bundle.mjs` is a frozen build of
  `packages/lang-core/src` (see `vendor/PROVENANCE.md`) so the demo runs
  without a monorepo install; long term this should be a workspace dependency.
