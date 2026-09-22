/** Real React implementations for the demo catalog (react-lang library). */
import React from "react";

type P = Record<string, any>;
type R = (props: P) => React.ReactNode;
type Ctx = { props: P; renderNode: (v: unknown) => React.ReactNode };

const css = `
.dash h3 { margin: 10px 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #8b93a1; }
.dash h3:first-child { margin-top: 0; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; color: #8b93a1; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid #2a2f38; }
.tbl td { padding: 5px 8px; border-bottom: 1px solid #1e232c; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; }
.pill.ok { background: #1e3a2a; color: #a8e6b0; }
.pill.warn { background: #3a2f1e; color: #e6c88a; }
.kpis { display: flex; gap: 8px; margin: 2px 0 4px; }
.dash > .kpi { display: inline-block; width: calc(33% - 8px); margin: 0 8px 4px 0; vertical-align: top; box-sizing: border-box; }
.kpi { flex: 1; background: #1a2029; border: 1px solid #2a2f38; border-radius: 8px; padding: 8px 10px; }
.kpi .l { font-size: 11px; color: #8b93a1; }
.kpi .v { font-size: 19px; font-weight: 700; }
.kpi .d { font-size: 11px; }
.d.up { color: #7ee2a0; } .d.down { color: #f08a8a; }
.panel { background: #1a2029; border: 1px solid #2a2f38; border-radius: 8px; padding: 10px 12px; margin-top: 8px; }
.panel .row { display: flex; gap: 10px; align-items: center; margin: 6px 0; }
.panel label { font-size: 12px; color: #9aa0a6; }
.panel input, .panel select { flex: 1; background: #0f1319; border: 1px solid #333a45; border-radius: 6px; color: #e8eaed; padding: 6px 8px; font-size: 13px; }
.btn { border: 1px solid #4a5160; background: #2b303b; color: #e8eaed; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
.btn.primary { background: #1a56c4; border-color: #1a56c4; color: #fff; }
.avatar { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg,#3b82f6,#8b5cf6); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
.bars { display: flex; align-items: flex-end; gap: 5px; height: 70px; padding: 4px 2px; }
.bars i { flex: 1; border-radius: 3px 3px 0 0; background: linear-gradient(180deg,#3b82f6,#1e3a8a); }
.widget { background: #1a2029; border: 1px solid #2a2f38; border-radius: 8px; padding: 8px 10px; font-size: 12px; margin: 4px 0; color: #c9cdd4; }
`;
export function DemoStyles() {
  return <style>{css}</style>;
}

const ORDERS: [string, string, string, string, string][] = [
  ["#1001", "Ada", "$42.00", "paid", "ok"],
  ["#1002", "Bo", "$18.50", "shipped", "warn"],
  ["#1003", "Cy", "$96.20", "paid", "ok"],
];

function OrdersTable({ title }: P) {
  return (
    <>
      <h3>{title}</h3>
      <table className="tbl">
        <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>{ORDERS.map((r) => (
          <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td>
            <td><span className={`pill ${r[4]}`}>{r[3]}</span></td></tr>
        ))}</tbody>
      </table>
    </>
  );
}

function GenericTable({ title }: P) {
  return (
    <>
      <h3>{title}</h3>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Detail</th></tr></thead>
        <tbody><tr><td>Item one</td><td>Active</td></tr><tr><td>Item two</td><td>Pending</td></tr></tbody>
      </table>
    </>
  );
}

export const IMPLS: Record<string, R> = {
  Dashboard: ({ props, renderNode }: Ctx) => (
    <div className="dash"><h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{props.title}</h2>{renderNode(props.children)}</div>
  ),
  Table: ({ props }: Ctx) =>
    props.title === "Orders" ? <OrdersTable title={props.title} /> : <GenericTable title={props.title} />,
  KpiCard: ({ props }: Ctx) => {
    const down = String(props.delta || "").startsWith("-");
    return (
      <div className="kpi"><div className="l">{props.label}</div><div className="v">{props.value}</div>
        <div className={`d ${down ? "down" : "up"}`}>{down ? "▼" : "▲"} {props.delta}</div></div>
    );
  },
  Chart: ({ props }: Ctx) => {
    if (props.variant === "bar")
      return (<><h3>{props.title}</h3><div className="bars">
        {[38, 52, 45, 62, 58, 74, 90].map((v, i) => <i key={i} style={{ height: `${v}%` }} />)}</div></>);
    if (props.variant === "area")
      return (<><h3>{props.title}</h3><div className="bars">
        {[55, 48, 60, 52, 66, 61, 72].map((v, i) => (
          <i key={i} style={{ height: `${v}%`, background: "linear-gradient(180deg,#34d399,#065f46)" }} />))}</div></>);
    return (<><h3>{props.title}</h3>
      <svg viewBox="0 0 300 96" width="100%" height="96">
        <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b82f6" stopOpacity=".45" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient></defs>
        {[20, 45, 70].map((y) => <line key={y} x1="0" y1={y} x2="300" y2={y} stroke="#222834" />)}
        <path d="M0,74 C25,70 35,52 60,54 C85,56 95,38 120,40 C145,42 155,30 180,28 C205,26 215,36 240,24 C265,12 280,18 300,10 L300,96 L0,96 Z" fill="url(#rg)" />
        <path d="M0,74 C25,70 35,52 60,54 C85,56 95,38 120,40 C145,42 155,30 180,28 C205,26 215,36 240,24 C265,12 280,18 300,10" fill="none" stroke="#5b9cf6" strokeWidth="2.5" />
        <circle cx="300" cy="10" r="3.5" fill="#5b9cf6" />
      </svg></>);
  },
  Panel: ({ props, renderNode }: Ctx) => (
    <div className="panel"><h3>{props.title}</h3>{renderNode(props.children)}</div>
  ),
  TextInput: ({ props }: Ctx) => (
    <div className="row"><label>{props.label}</label><input placeholder={props.placeholder} /></div>
  ),
  Button: ({ props }: Ctx) => (
    <button className={`btn${/save/i.test(props.label || "") ? " primary" : ""}`}>{props.label}</button>
  ),
  Avatar: ({ props }: Ctx) => <span className="avatar">{(props.seed || "A")[0]}</span>,
  Select: ({ props }: Ctx) => (
    <div className="row"><label>{props.label}</label><select><option>Last 30 days</option></select></div>
  ),
  Form: ({ props }: Ctx) => <div className="widget">{props.title} form</div>,
  Carousel: ({ props }: Ctx) => <div className="widget">{props.title}</div>,
  Accordion: ({ props }: Ctx) => <div className="widget">{props.title}</div>,
  Feed: ({ props }: Ctx) => <div className="widget">{props.title}</div>,
  Calendar: ({ props }: Ctx) => <div className="widget">{props.title}</div>,
  Map: ({ props }: Ctx) => <div className="widget">{props.title}</div>,
  Chat: ({ props }: Ctx) => <div className="widget">{props.title}</div>,
};
