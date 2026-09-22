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
