/** Build-off app: same Renderer + same library both sides; the switch is only the evaluator. */
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Renderer } from "../../../packages/react-lang/src/Renderer";
import { createLibrary, defineComponent } from "../../../packages/react-lang/src/library";
import { COMPONENT_DEFS } from "../components.mjs";
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
  chosen: string[];
}

const init: SideState = { source: "", ms: 0, errors: 0, running: false, stream: "", chosen: [] };

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

  const build = async () => {
    if (building) return;
    setBuilding(true);
    setBadge("building…");
    setBase({ ...init, running: true });
    setJev({ ...init, running: true });
    let baseMs = 0, jevMs = 0;

    const p1 = (async () => {
      await runBuild("baseline", (e: any) => {
        if (e.type === "token") setBase((s) => ({ ...s, stream: (s.stream + e.text).slice(-2000) }));
        if (e.type === "done") {
          baseMs = e.ms;
          setBase((s) => ({ ...s, running: false, ms: e.ms, errors: e.errors, source: e.source }));
        }
        if (e.type === "error") setBase((s) => ({ ...s, running: false, stream: "ERROR: " + e.message }));
      });
    })();
    const p2 = (async () => {
      await runBuild("jev", (e: any) => {
        if (e.type === "status") setJev((s) => ({ ...s, stream: e.text }));
        if (e.type === "decisions") {
          jevMs = e.ms;
          setBadge(`✓ Jev done in ${Math.round(e.ms)}ms — still waiting on baseline…`);
          setJev((s) => ({
            ...s, running: false, ms: e.ms, errors: e.errors, source: e.source, chosen: e.chosen,
            stream: `all ${INSTANCES.length} decisions in ${Math.round(e.ms)}ms (single response)\n[parser: ${e.errors} errors]`,
          }));
        }
        if (e.type === "error") setJev((s) => ({ ...s, running: false, stream: "ERROR: " + e.message }));
      });
      setBadge((b) => b === "building…" ? `✓ Jev done — still waiting on baseline…` : b);
    })();
    // Interim notice once Jev lands (p2 resolves its stream first in practice).
    await Promise.all([p1, p2]);
    setBadge(`Jev ${Math.round(jevMs)}ms vs baseline ${Math.round(baseMs)}ms — ${(baseMs / jevMs).toFixed(1)}x faster (live)`);
    setBuilding(false);
  };

  return (
    <>
      <h1>Live build-off: building the same dashboard UI</h1>
      <p className="sub">Both sides render through the real <code>Renderer</code> + the same <code>createLibrary</code> catalog.
        The switch is only the evaluator: one <code>gpt-4o-mini</code> call vs one <code>jev-latest</code> round trip.</p>
      <button id="build" onClick={build} disabled={building}>Build both interfaces</button>
      <span id="badge">{badge}</span>
      <div className="grid">
        <Panel title="Without Jev — LLM evaluator" side="base" state={base} />
        <Panel title="With Jev — batched evaluator" side="jev" state={jev} />
      </div>
      <p><small>Keys stay server-side. Jev selects from the catalog only — it cannot invent prose, prop values, or layout.
        Reproduce: <code>npm i; node client/build.mjs; node live.mjs</code>, open this page.</small></p>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
