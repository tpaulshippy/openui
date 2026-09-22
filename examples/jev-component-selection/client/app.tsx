/** Jev-first build-off: Jev composes immediately, LLM only on unavailable. */
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Renderer } from "../../../packages/react-lang/src/Renderer";
import { createLibrary, defineComponent } from "../../../packages/react-lang/src/library";
import { COMPONENT_DEFS } from "../components.mjs";
import { FOLLOW_UPS } from "../catalog.mjs";
import { INSTANCES } from "../catalog.mjs";
import { DemoStyles, IMPLS } from "./components";

const library = createLibrary({
  components: COMPONENT_DEFS.map((d) =>
    defineComponent({ name: d.name, props: d.schema(), description: d.description, component: IMPLS[d.name] }),
  ),
  root: "Dashboard",
});

type Side = "base" | "jev";
interface SideState {
  source: string;
  ms: number;
  errors: number;
  running: boolean;
  stream: string;
  promptChars: number;
  chosen: string[];
  fallback: boolean;
}

const init: SideState = { source: "", ms: 0, errors: 0, running: false, stream: "", promptChars: 0, chosen: [], fallback: false };

async function runBuild(mode: string, onEvent: (e: any) => void) {
  const res = await fetch("./api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop()!;
    for (const p of parts)
      for (const line of p.split("\n")) {
        const t = line.trim();
        if (t.startsWith("data:")) onEvent(JSON.parse(t.slice(5).trim()));
      }
  }
}

function useTimer(running: boolean, doneMs: number) {
  const [now, setNow] = useState(0);
  const t0 = useRef(0);
  React.useEffect(() => {
    if (!running) return;
    t0.current = performance.now();
    const id = setInterval(() => setNow(performance.now() - t0.current), 50);
    return () => clearInterval(id);
  }, [running]);
  return running ? Math.round(now) : Math.round(doneMs);
}

function Panel({ title, side, state }: { title: string; side: Side; state: SideState }) {
  const ms = useTimer(state.running, state.ms);
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="timer">{ms} ms</div>
      <div className="stream">{state.stream || (side === "base" ? "(tokens appear here)" : "(decision response appears here)")}</div>
      {state.fallback && <small style={{ color: "#e6c88a" }}>LLM fallback (unavailable)</small>}
      <div className="mock">
        <DemoStyles />
        {state.source ? (
          <Renderer response={state.source} library={library} isStreaming={state.running} />
        ) : (
          "(interface renders here)"
        )}
      </div>
      {side === "jev" && state.chosen.length > 0 && (
        <div className="chips">
          {INSTANCES.map((c) => (
            <span key={c.id} className={`chip${state.chosen.includes(c.id) ? " in" : ""}`}>{c.id}</span>
          ))}
        </div>
      )}
      {state.errors > 0 && <small style={{ color: "#f08a8a" }}>parser: {state.errors} errors</small>}
    </div>
  );
}

function App() {
  const [base, setBase] = useState<SideState>(init);
  const [jev, setJev] = useState<SideState>(init);
  const [badge, setBadge] = useState("press Build");
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editStatus, setEditStatus] = useState("build first, then tweak");

  const build = async () => {
    if (building) return;
    setBuilding(true);
    setBadge("building…");
    setBase({ ...init, running: true });
    setJev({ ...init, running: true });
    let baseMs = 0, jevMs = 0, jevFallback = false;

    const p1 = (async () => {
      let src = "";
      await runBuild("baseline", (e: any) => {
        if (e.type === "status") setBase((s) => ({ ...s, stream: e.text }));
        if (e.type === "token") {
          src += e.text;
          const snap = src;
          setBase((s) => ({ ...s, stream: (s.stream + e.text).slice(-2000), source: snap }));
        }
        if (e.type === "done") {
          baseMs = e.ms;
          setBase((s) => ({ ...s, running: false, ms: e.ms, errors: e.errors, source: e.source, promptChars: e.promptChars ?? 0 }));
        }
        if (e.type === "error") setBase((s) => ({ ...s, running: false, stream: "ERROR: " + e.message }));
      });
    })();
    const p2 = (async () => {
      let src = "";
      await runBuild("jev", (e: any) => {
        if (e.type === "status") setJev((s) => ({ ...s, stream: e.text, promptChars: e.promptChars ?? s.promptChars }));
        if (e.type === "decisions") {
          // Primary path: composed UI renders immediately, 0 LLM tokens.
          jevMs = e.ms;
          setBadge(`✓ Jev composed in ${Math.round(e.ms)}ms (no LLM) — still waiting on baseline…`);
          setJev((s) => ({
            ...s, running: false, ms: e.ms, errors: e.errors, source: e.source, chosen: e.chosen,
            fallback: false, promptChars: 0,
            stream: `all ${INSTANCES.length} decisions in ${Math.round(e.ms)}ms (single response, 0 LLM tokens)\n[parser: ${e.errors} errors]`,
          }));
        }
        if (e.type === "token") {
          // Fallback path only: LLM tokens stream like the baseline.
          src += e.text;
          const snap = src;
          setJev((s) => ({ ...s, running: true, fallback: true, stream: (s.stream + e.text).slice(-2000), source: snap }));
        }
        if (e.type === "done") {
          jevMs = e.ms;
          jevFallback = !!e.fallback;
          if (e.fallback) {
            setJev((s) => ({ ...s, running: false, ms: e.ms, errors: e.errors, source: e.source, chosen: e.chosen ?? s.chosen, fallback: true, promptChars: e.promptChars ?? 0 }));
          }
        }
        if (e.type === "error") setJev((s) => ({ ...s, running: false, stream: "ERROR: " + e.message }));
      });
      setBadge((b) => b === "building…" ? `✓ Jev done — still waiting on baseline…` : b);
    })();
    await Promise.all([p1, p2]);
    setBadge(jevFallback
      ? `Jev unavailable → LLM fallback ${Math.round(jevMs)}ms vs baseline ${Math.round(baseMs)}ms`
      : `Jev ${Math.round(jevMs)}ms (no LLM) vs baseline ${Math.round(baseMs)}ms — ${(baseMs / Math.max(jevMs, 1)).toFixed(1)}x faster (live)`);
    setBuilding(false);
  };

  return (
    <>
      <h1>Live build-off: Jev composer vs LLM baseline</h1>
      <p className="sub">Jev composes the dashboard directly from configured instances in one round trip (no LLM).
        The LLM runs only on the baseline side — and on the Jev side only as a fallback when Jev reports unavailable.
        Both render through the real <code>Renderer</code>.</p>
      <button id="build" onClick={build} disabled={building}>Build both interfaces</button>
      <span id="badge">{badge}</span>
      <div className="grid">
        <Panel title="Without Jev — LLM generates" side="base" state={base} />
        <Panel title="With Jev — composes directly" side="jev" state={jev} />
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Follow-up tweaks — Jev edits, no LLM</h2>
        <p className="sub">Each tweak is one Jev round trip over swap/add/remove ops against the current Jev tree.</p>
        {FOLLOW_UPS.map((prompt, i) => (
          <button key={prompt} id={`edit-${i + 1}`} onClick={() => runEdit(i)}
            disabled={building || editing || jev.chosen.length === 0}
            style={{ marginRight: 8 }}>{prompt}</button>
        ))}
        <div id="edit-status" style={{ marginTop: 8 }}>{editStatus}</div>
      </div>
      <p><small>Keys stay server-side. Jev selects from the catalog only — it cannot invent prose, prop values, or layout.
        Unavailable (empty/low-confidence selection or parse errors) routes to one LLM fallback call, flagged above.
        Reproduce: <code>npm i; node client/build.mjs; node live.mjs</code>, open this page.</small></p>
    </>
  );

  async function runEdit(index: number) {
    if (editing || jev.chosen.length === 0) return;
    setEditing(true);
    setEditStatus(`edit ${index + 1} running…`);
    try {
      const res = await fetch("./api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chosen: jev.chosen, prompt: FOLLOW_UPS[index], index }),
      });
      const e = await res.json();
      if (e.stopReason === "finish") {
        setJev((s) => ({ ...s, source: e.source, errors: 0, ms: e.ms, chosen: e.chosen }));
        setEditStatus(`edit ${index + 1} done: ${e.topKey} in ${Math.round(e.ms)}ms (no LLM)`);
      } else {
        setEditStatus(`edit ${index + 1} unavailable (top ${(e.topScore ?? 0).toFixed(2)}) — tree unchanged`);
      }
    } catch (err) {
      setEditStatus(`edit ${index + 1} ERROR: ${String((err as Error)?.message ?? err)}`);
    }
    setEditing(false);
  }
}

createRoot(document.getElementById("root")!).render(<App />);
