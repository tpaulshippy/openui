/**
 * Real OpenUI catalog for the Jev build-off demo.
 *
 * Jev-first composition (json-render approach):
 * - baseline: full `lib.prompt()` → LLM generates openui-lang → `parse`.
 * - jev (primary path): `selectCandidates` over configured INSTANCES in one
 *   batched round trip → `composeProgram(chosen)` (deterministic section
 *   ordering, preferences-panel grouping, `jsonToOpenUI` + `parse`) → render.
 *   No LLM call, 0 LLM tokens. `parse` must yield 0 errors or the attempt is
 *   `unavailable`.
 * - fallback: LLM only on `unavailable` (empty/low-confidence selection or
 *   parse errors) via `filteredLibraryForChosen()` + one `gpt-4o-mini` call.
 * Both arms render through the real `<Renderer>`.
 */
import {
  compileSchema,
  createLibrary,
  defineComponent,
  experimental_componentTypesForChosen,
  experimental_composeFromChosen,
  experimental_createJevEvaluator,
  experimental_selectCandidates,
  jsonToOpenUI,
  parse,
  z,
} from "./vendor/lang-core.bundle.mjs";

export {
  experimental_componentTypesForChosen,
  experimental_composeFromChosen,
  experimental_createJevEvaluator,
  experimental_selectCandidates,
  jsonToOpenUI,
  parse,
};

import { COMPONENT_DEFS } from "./components.mjs";

const Null = null;

const defined = COMPONENT_DEFS.map((d) =>
  defineComponent({ name: d.name, props: d.schema(), description: d.description, component: Null }),
);

export const lib = createLibrary({
  components: defined,
  root: "Dashboard",
});

export const paramMap = compileSchema(lib.toJSONSchema());

export const STATE =
  "Build a sales dashboard with an orders table on top, then a KPI row " +
  "with revenue, orders and new-customers metrics, then a weekly revenue " +
  "line chart, plus an account preferences panel with a display-name field " +
  "and a Save button.";

/**
 * One candidate = one configured component instance, mirroring how a real
 * composer offers catalog choices. `section` drives code-side grouping for
 * the Jev arm (the model selects; code composes).
 */
export const INSTANCES = [
  { id: "orders-table", component: "Table", props: { title: "Orders" }, section: "orders", description: "Orders history table (id, customer, total, status)" },
  { id: "revenue-kpi", component: "KpiCard", props: { label: "Revenue", value: "$48.2k", delta: "+12.4%" }, section: "kpis", description: "Revenue KPI card" },
  { id: "orders-kpi", component: "KpiCard", props: { label: "Orders", value: "1,024", delta: "+8.1%" }, section: "kpis", description: "Orders KPI card" },
  { id: "customers-kpi", component: "KpiCard", props: { label: "New customers", value: "312", delta: "+4.6%" }, section: "kpis", description: "New customers KPI card" },
  { id: "churn-kpi", component: "KpiCard", props: { label: "Churn", value: "1.8%", delta: "-0.3%" }, section: "kpis", description: "Churn rate KPI card" },
  { id: "revenue-line", component: "Chart", props: { title: "Revenue — weekly", variant: "line" }, section: "chart", description: "Weekly revenue line chart" },
  { id: "revenue-bars", component: "Chart", props: { title: "Revenue — bars", variant: "bar" }, section: "chart", description: "Weekly revenue bar chart variant" },
  { id: "traffic-chart", component: "Chart", props: { title: "Traffic", variant: "area" }, section: "chart", description: "Site traffic area chart" },
  { id: "customers-table", component: "Table", props: { title: "Customers" }, section: null, description: "Customer directory table" },
  { id: "inventory-table", component: "Table", props: { title: "Inventory" }, section: null, description: "Warehouse inventory table" },
  { id: "preferences-panel", component: "Panel", props: { title: "Account preferences" }, section: "preferences", description: "Account preferences container" },
  { id: "name-input", component: "TextInput", props: { label: "Name", bind: "/name", placeholder: "Ada" }, section: "preferences", description: "Display-name field" },
  { id: "email-input", component: "TextInput", props: { label: "Email", bind: "/email", placeholder: "ada@x.com" }, section: "preferences", description: "Email field" },
  { id: "avatar", component: "Avatar", props: { seed: "Ada" }, section: "preferences", description: "Profile avatar" },
  { id: "save-button", component: "Button", props: { label: "Save" }, section: "preferences", description: "Save preferences button" },
  { id: "reset-button", component: "Button", props: { label: "Reset" }, section: "preferences", description: "Reset form button" },
  { id: "export-button", component: "Button", props: { label: "Export CSV" }, section: null, description: "Export dashboard CSV button" },
  { id: "date-filter", component: "Select", props: { label: "Range", bind: "/range" }, section: null, description: "Date-range filter" },
  { id: "search-bar", component: "TextInput", props: { label: "Search", bind: "/query", placeholder: "Search…" }, section: null, description: "Global search field" },
  { id: "login-card", component: "Panel", props: { title: "Login" }, section: null, description: "Login card" },
  { id: "signup-form", component: "Form", props: { title: "Signup" }, section: null, description: "Marketing signup form" },
  { id: "pricing-table", component: "Table", props: { title: "Pricing" }, section: null, description: "Pricing tiers table" },
  { id: "testimonials", component: "Carousel", props: { title: "Testimonials" }, section: null, description: "Testimonials carousel" },
  { id: "faq-accordion", component: "Accordion", props: { title: "FAQ" }, section: null, description: "Help FAQ accordion" },
  { id: "notifications", component: "Feed", props: { title: "Notifications" }, section: null, description: "Notifications feed" },
  { id: "calendar-widget", component: "Calendar", props: { title: "Team calendar" }, section: null, description: "Team calendar widget" },
  { id: "map-widget", component: "Map", props: { title: "Store map" }, section: null, description: "Store locations map" },
  { id: "chat-widget", component: "Chat", props: { title: "Support chat" }, section: null, description: "Support chat widget" },
];

export const CRITERIA = {
  true: "Needed for the requested dashboard (orders table, revenue/orders/customers KPIs, revenue line chart, preferences panel with name field and save)",
  false: "Unrelated, redundant, or not requested",
};

const SECTION_ORDER = ["orders", "kpis", "chart", "preferences"];

/**
 * Fallback-only path: map an instance-id selection to a filtered library for
 * the LLM fallback. Used solely when the Jev-first attempt is `unavailable`.
 * The primary path (`composeProgram`) uses the configured instance props
 * directly — this helper exists only so the fallback prompt stays small.
 */
export function filteredLibraryForChosen(chosenIds) {
  const types = experimental_componentTypesForChosen(INSTANCES, chosenIds);
  const wanted = new Set(["Dashboard", ...types]);
  const defs = COMPONENT_DEFS.filter((d) => wanted.has(d.name)).map((d) =>
    defineComponent({ name: d.name, props: d.schema(), description: d.description, component: Null }),
  );
  const filtered = createLibrary({ components: defs, root: "Dashboard" });
  const filteredParamMap = compileSchema(filtered.toJSONSchema());
  const prompt = filtered.prompt();
  return { types: [...wanted].sort(), lib: filtered, paramMap: filteredParamMap, prompt };
}

/** Full-catalog prompt (baseline). Computed once. */
export const FULL_PROMPT = lib.prompt();

/**
 * Follow-up edit operations over the current chosen-id list. Each op is a
 * discrete, reversible list surgery — the same shape as json-render's
 * add/replace/remove/move protocol, minus move (section ordering is
 * deterministic here, so order follows automatically).
 *
 * - swap: replace a shown instance with an unshown one of the same component
 *   type (chart variant for chart variant, KPI for KPI).
 * - remove: drop a shown instance (root Dashboard is never offered).
 * - add: include an unshown instance.
 *
 * Descriptions name current visibility ("shown"/"not shown") so the evaluator
 * grounds against the tree the user sees. One batched Noul round trip picks
 * the single best op at/above threshold; anything else is `unavailable`.
 */
export function buildEditOps(currentChosen) {
  const byId = new Map(INSTANCES.map((c) => [c.id, c]));
  const shown = new Set(currentChosen.filter((id) => byId.has(id)));
  const ops = [];
  const show = (id) => (shown.has(id) ? "shown" : "not shown");

  // Swaps within the same component type: shown member -> unshown member.
  const byType = new Map();
  for (const c of INSTANCES) {
    if (!byType.has(c.component)) byType.set(c.component, []);
    byType.get(c.component).push(c);
  }
  for (const [, group] of byType) {
    if (group.length < 2) continue;
    for (const from of group.filter((c) => shown.has(c.id))) {
      for (const to of group.filter((c) => !shown.has(c.id))) {
        ops.push({
          key: `swap:${from.id}:${to.id}`,
          type: "swap",
          from: from.id,
          to: to.id,
          description: `Swap the ${show(from.id)} "${from.description}" for the ${show(to.id)} "${to.description}"`,
        });
      }
    }
  }
  // Removes: anything shown (Dashboard root is never a candidate).
  for (const id of shown) {
    const c = byId.get(id);
    ops.push({
      key: `remove:${id}`,
      type: "remove",
      from: id,
      description: `Remove the shown "${c.description}" and its subtree`,
    });
  }
  // Adds: anything not shown.
  for (const c of INSTANCES.filter((c) => !shown.has(c.id))) {
    ops.push({
      key: `add:${c.id}`,
      type: "add",
      to: c.id,
      description: `Add the ${show(c.id)} "${c.description}" (${c.component})`,
    });
  }
  return ops;
}

/** Noul questions for one edit round: should this operation be applied? */
export function editOpQuestions(ops, criteria) {
  const questions = {};
  for (const op of ops) {
    questions[`apply_${op.key.replaceAll(/[^a-zA-Z0-9]/g, "_")}`] = {
      type: "noul",
      instructions: `The user asked for a follow-up tweak. Should this edit be applied: ${op.description}? Apply at most the single best-matching edit.`,
      ...(criteria ? { criteria } : {}),
    };
  }
  return questions;
}

/** Pure list surgery: apply one op key to the current chosen list. */
export function applyEditOp(currentChosen, op) {
  const next = currentChosen.filter((id) => id !== op.from);
  if ((op.type === "swap" || op.type === "add") && op.to && !next.includes(op.to)) next.push(op.to);
  return next;
}

/**
 * One Jev edit round over the current tree (shared by headless + live).
 * No LLM on `finish`: top op at/above threshold is applied, recomposed, and
 * must parse with 0 errors. Anything else is `unavailable` (LLM fallback).
 */
export async function composeEdit(evaluate, currentChosen, editPrompt, { threshold = 0.5, criteria = CRITERIA } = {}) {
  const ops = buildEditOps(currentChosen);
  const questions = editOpQuestions(ops, criteria);
  const started = performance.now();
  const result = await evaluate(editPrompt, questions);
  const ms = performance.now() - started;
  const qkey = (op) => `apply_${op.key.replaceAll(/[^a-zA-Z0-9]/g, "_")}`;
  const scored = ops.map((op) => {
    const a = result.answers[qkey(op)];
    return { op, score: a?.type === "noul" ? a.noul : 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < threshold) {
    return { ms, ops: ops.length, stopReason: "unavailable", topScore: top?.score ?? 0, topKey: top?.op.key ?? null };
  }
  const next = applyEditOp(currentChosen, top.op);
  const { source, result: parsed } = composeProgram(next);
  if (parsed.meta.errors.length > 0) {
    return { ms, ops: ops.length, stopReason: "unavailable", topScore: top.score, topKey: top.op.key, parseErrors: parsed.meta.errors.length };
  }
  return {
    ms,
    ops: ops.length,
    stopReason: "finish",
    topScore: top.score,
    topKey: top.op.key,
    opType: top.op.type,
    chosen: next,
    source,
    errors: 0,
  };
}

/** Preset follow-up chain for the demo (each starts from the previous tree). */
export const FOLLOW_UPS = [
  "Swap the weekly revenue line chart for the bar variant.",
  "Remove the new-customers KPI card.",
  "Add an Export CSV button to the dashboard.",
];

/**
 * Jev output path: compose validated Lang from chosen instance ids.
 * Deterministic section ordering + preferences-panel grouping, serialized
 * with the real `jsonToOpenUI` and re-validated with the real `parse`.
 * Callers must require `result.meta.errors.length === 0`; anything else is
 * `unavailable` and routes to the LLM fallback — never widen silently.
 */
export function composeProgram(chosenIds) {
  const byId = new Map(INSTANCES.map((c) => [c.id, c]));
  const order = new Map(INSTANCES.map((c, i) => [c.id, i]));
  // Unknown ids sort last; ties keep catalog order (stable, not input order).
  const known = chosenIds.filter((id) => byId.has(id));
  const ordered = [...known].sort((a, b) => {
    const rank = (id) => {
      const section = byId.get(id)?.section ?? null;
      const i = section == null ? -1 : SECTION_ORDER.indexOf(section);
      return i === -1 ? 99 : i;
    };
    return rank(a) - rank(b) || order.get(a) - order.get(b);
  });
function elementFor(inst) {
  return { type: "element", typeName: inst.component, props: { ...inst.props }, partial: false };
}
  const hasPanel = ordered.includes("preferences-panel");
  const panelKids = ordered
    .filter((id) => id !== "preferences-panel" && byId.get(id).section === "preferences")
    .map((id) => elementFor(byId.get(id)));
  const children = [];
  for (const id of ordered) {
    const inst = byId.get(id);
    // Without the panel container, preference kids render as siblings so
    // they are never silently dropped.
    if (inst.section === "preferences" && id !== "preferences-panel" && hasPanel) continue;
    if (id === "preferences-panel") {
      children.push({
        ...elementFor(inst),
        props: { ...inst.props, ...(panelKids.length ? { children: panelKids } : {}) },
      });
    } else {
      children.push(elementFor(inst));
    }
  }
  const node = {
    type: "element",
    typeName: "Dashboard",
    props: { title: "Sales dashboard", children },
    partial: false,
  };
  const source = jsonToOpenUI(node, lib);
  const result = parse(source, paramMap);
  return { source, result };
}

/** Flatten a validated program root into renderable child nodes. */
export function programChildren(result) {
  const kids = result.root?.props?.children;
  return Array.isArray(kids) ? kids.filter((k) => k && k.type === "element") : [];
}
