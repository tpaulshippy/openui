// No-op stand-in for @openuidev/observability (browser demo only).
// The real export is callable — observability(level, detail) — with level
// shortcuts and listener methods, so the stub mirrors that shape.
const noop = () => {};
const unsub = () => {};
export function observability() {}
observability.info = noop;
observability.warn = noop;
observability.error = noop;
observability.listen = () => unsub;
observability.listenAll = () => unsub;
observability.publish = noop;
observability.subscribe = () => unsub;
