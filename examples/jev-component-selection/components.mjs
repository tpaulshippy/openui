/**
 * Shared component definitions for the Jev build-off demo.
 *
 * Each entry carries the OpenUI component name, its description, and a
 * schema thunk (fresh zod objects per library — never shared across
 * registries). The server builds a lang-core library (`component: null`,
 * never inspected); the browser client builds a react-lang library with
 * real React implementations from `./client/components.tsx`.
 */
import { z } from "./vendor/lang-core.bundle.mjs";

export const COMPONENT_DEFS = [
  {
    name: "Dashboard",
    description: "Root sales dashboard container",
    schema: () => z.object({ title: z.string(), children: z.array(z.any()) }),
  },
  {
    name: "Table",
    description: "Data table with rows",
    schema: () => z.object({ title: z.string() }),
  },
  {
    name: "KpiCard",
    description: "Metric KPI card with value and change",
    schema: () =>
      z.object({ label: z.string(), value: z.string(), delta: z.string() }),
  },
  {
    name: "Chart",
    description: "Chart with line, bar, or area variant",
    schema: () =>
      z.object({ title: z.string(), variant: z.enum(["line", "bar", "area"]) }),
  },
  {
    name: "Panel",
    description: "Titled container panel for nested fields",
    schema: () =>
      z.object({ title: z.string(), children: z.array(z.any()).optional() }),
  },
  {
    name: "TextInput",
    description: "Text field bound to state",
    schema: () =>
      z.object({ label: z.string(), bind: z.string(), placeholder: z.string() }),
  },
  {
    name: "Button",
    description: "Action button",
    schema: () => z.object({ label: z.string() }),
  },
  {
    name: "Avatar",
    description: "Profile avatar",
    schema: () => z.object({ seed: z.string() }),
  },
  {
    name: "Select",
    description: "Dropdown select bound to state",
    schema: () => z.object({ label: z.string(), bind: z.string() }),
  },
  {
    name: "Form",
    description: "Signup-style form",
    schema: () => z.object({ title: z.string() }),
  },
  {
    name: "Carousel",
    description: "Content carousel",
    schema: () => z.object({ title: z.string() }),
  },
  {
    name: "Accordion",
    description: "Collapsible accordion",
    schema: () => z.object({ title: z.string() }),
  },
  {
    name: "Feed",
    description: "Activity feed",
    schema: () => z.object({ title: z.string() }),
  },
  {
    name: "Calendar",
    description: "Month calendar widget",
    schema: () => z.object({ title: z.string() }),
  },
  {
    name: "Map",
    description: "Locations map widget",
    schema: () => z.object({ title: z.string() }),
  },
  {
    name: "Chat",
    description: "Support chat widget",
    schema: () => z.object({ title: z.string() }),
  },
];
