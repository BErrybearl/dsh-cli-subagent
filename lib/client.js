window.__ModuleLoader__.load({
	id: "dsh-subagent",
	factory: (require) => {
		var module = { exports: {} };
		(function (module, exports) {
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react2 = __toESM(require("react"), 1);

var import_react = __toESM(require("react"), 1);
var h = import_react.default.createElement;
var DEFAULTS = { dock: true, tab: true, scope: "session", autoHideSeconds: 30, maxCards: 20, allowStop: true };
var HIDE_KEY = "dsh-subagent.panel.hideAt";
var OVERRIDE_KEY = "dsh-subagent.panel.override";
function readOverrides() {
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeOverrides(next) {
  try {
    window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
  } catch {
  }
}
function readHideAt() {
  try {
    return Number(window.localStorage.getItem(HIDE_KEY)) || 0;
  } catch {
    return 0;
  }
}
function rpc(connection, endpoint, payload, timeout = 2e4) {
  return connection.rpc.call("/api", `qoder-subagent/${endpoint}`, payload, AbortSignal.timeout(timeout)).then((result) => {
    if (!result?.ok) throw new Error(result?.error?.message ?? "rpc failed");
    return result.value;
  });
}
function useRuns(connection, intervalMs) {
  const [snap, setSnap] = import_react.default.useState({ runs: [], stats: null, cfg: null, now: Date.now() });
  import_react.default.useEffect(() => {
    if (!connection) return;
    let alive = true;
    let timer = null;
    const poll = async () => {
      try {
        const next = await rpc(connection, "runs", { limit: 40 });
        if (alive && next) setSnap(next);
      } catch {
      }
    };
    poll();
    timer = setInterval(poll, intervalMs || 2e3);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [connection, intervalMs]);
  return snap;
}
function fmtDur(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1e3));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}
var STATUS = { running: ["运行中", "#d9a400"], completed: ["完成", "#3f9d5a"], error: ["出错", "#e5533c"], aborted: ["已取消", "#8a8a8a"] };
function statusOf(run) {
  return STATUS[run.status] || ["…", "#8a8a8a"];
}
function modelText(run) {
  return run.model || "CLI 默认";
}
function statsOf(runs) {
  const out = { total: runs.length, running: 0, completed: 0, error: 0, aborted: 0, costUsd: 0 };
  for (const run of runs) {
    if (run.status in out && run.status !== "total") out[run.status] += 1;
    if (typeof run.costUsd === "number") out.costUsd += run.costUsd;
  }
  return out;
}
function scopedRuns(runs, cfg, sessionId) {
  if (cfg.scope === "all") return runs;
  if (!sessionId) return [];
  return runs.filter((run) => run.parentId === sessionId);
}
function lastAction(run) {
  const e = run.lastEvent;
  if (!e) return run.status === "running" ? "启动中…" : "";
  const ic = { tool: "⚙", text: "▸", think: "◎", result: "✔", error: "✖", model: "◆" }[e.kind] || "·";
  return `${ic} ${e.text || ""}`;
}
function Card({ run, onStop, stopEnabled }) {
  const [, col] = statusOf(run);
  const running = run.status === "running";
  const cost = typeof run.costUsd === "number" && run.costUsd > 0 ? `$${run.costUsd.toFixed(4)}` : "";
  return h(
    "div",
    { className: "sap-card" + (run.status === "error" ? " sap-err" : run.status === "completed" ? " sap-done" : "") },
    h(
      "div",
      { className: "sap-row" },
      h("span", { className: "sap-dot" + (run.stalled ? " sap-stall" : ""), style: { background: run.stalled ? "#d9a400" : col } }),
      h("span", { className: "sap-agent" }, run.provider || "?"),
      h("span", { className: "sap-model" }, modelText(run)),
      h("span", { className: "sap-time" }, running ? fmtDur(Date.now() - (run.startedAt || 0)) : fmtDur((run.endedAt || 0) - (run.startedAt || 0))),
      running && stopEnabled ? h("button", { className: "sap-x", title: "停止该子代理", onClick: () => onStop(run.id) }, "停止") : null
    ),
    h(
      "div",
      { className: "sap-sub" },
      h("span", { className: "sap-task" }, run.label || run.prompt || "(任务)"),
      run.stalled ? h("span", { className: "sap-stalltag" }, `静默 ${run.idleSeconds}s`) : null,
      h("span", { className: "sap-act" }, lastAction(run)),
      cost ? h("span", { className: "sap-cost" }, cost) : null
    )
  );
}
function Dock({ connection, sessionId }) {
  const [overrides, setOverrides] = import_react.default.useState(readOverrides);
  const [hideAt, setHideAt] = import_react.default.useState(readHideAt);
  const [open, setOpen] = import_react.default.useState(false);
  const snap = useRuns(connection, 2e3);
  const cfg = { ...DEFAULTS, ...snap && snap.cfg || {}, ...overrides };
  const all = scopedRuns(snap.runs || [], cfg, sessionId);
  const stats = statsOf(all);
  const now = Date.now();
  const autoHide = Math.max(0, Number(cfg.autoHideSeconds) || 0);
  const active = all.filter((run) => run.status === "running");
  const recent = all.filter((run) => run.status !== "running" && !run.restored && (run.endedAt || 0) > hideAt && autoHide > 0 && now - (run.endedAt || 0) < autoHide * 1e3);
  const shown = [...active, ...recent].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, Math.max(1, Number(cfg.maxCards) || 20));
  const prevActive = import_react.default.useRef(0);
  import_react.default.useEffect(() => {
    if (active.length > prevActive.current) setOpen(true);
    prevActive.current = active.length;
  }, [active.length]);
  import_react.default.useEffect(() => {
    const on = () => setOverrides(readOverrides());
    window.addEventListener("dsh-subagent:panel-cfg", on);
    return () => window.removeEventListener("dsh-subagent:panel-cfg", on);
  }, []);
  if (!cfg.dock) return null;
  if (shown.length === 0) return null;
  const onStop = (id) => {
    rpc(connection, "stop", { runId: id }).catch(() => {
    });
  };
  const dismiss = () => {
    const at = Date.now();
    setHideAt(at);
    setOpen(false);
    try {
      window.localStorage.setItem(HIDE_KEY, String(at));
    } catch {
    }
  };
  return h(
    "div",
    { className: "sap-dock" + (open ? "" : " sap-fold") },
    h(
      "div",
      { className: "sap-head" },
      h("span", { className: "sap-care" + (open ? " sap-open" : ""), onClick: () => setOpen((o) => !o), title: open ? "收起" : "展开" }, "▸"),
      h("span", { className: "sap-h1", onClick: () => setOpen((o) => !o) }, "子代理"),
      stats.running > 0 ? h("span", { className: "sap-run" }, `${stats.running} 运行中`) : null,
      stats.completed ? h("span", { className: "sap-mut" }, `· ${stats.completed} 完成`) : null,
      stats.error ? h("span", { className: "sap-errt" }, `· ${stats.error} 出错`) : null,
      stats.costUsd > 0 ? h("span", { className: "sap-mut" }, `· $${stats.costUsd.toFixed(4)}`) : null,
      h("span", { className: "sap-sp" }),
      h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部"),
      h("button", { className: "sap-close", title: "隐藏（有新运行会再出现）", onClick: dismiss }, "✕")
    ),
    open ? h("div", { className: "sap-cards" }, shown.map((run) => h(Card, { key: run.id, run, onStop, stopEnabled: cfg.allowStop }))) : null
  );
}
function Tab({ connection, sessionId }) {
  const [sel, setSel] = import_react.default.useState(null);
  const [, setTick] = import_react.default.useState(0);
  import_react.default.useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1e3);
    return () => clearInterval(t);
  }, []);
  const snap = useRuns(connection, 2e3);
  const [overrides] = import_react.default.useState(readOverrides);
  const cfg = { ...DEFAULTS, ...snap && snap.cfg || {}, ...overrides };
  if (!cfg.tab) return h("div", { className: "sap-empty" }, "运行面板已在「设置 › 运行面板」中关闭。");
  const runs = scopedRuns(snap.runs || [], cfg, sessionId);
  const stats = statsOf(runs);
  const max = Math.max(1, Number(cfg.maxCards) || 20);
  const onStop = (id) => {
    rpc(connection, "stop", { runId: id }).catch(() => {
    });
  };
  const selRun = sel ? runs.find((r) => r.id === sel) : null;
  return h(
    "div",
    { className: "sap-tab" },
    h(
      "div",
      { className: "sap-tabhead" },
      h("b", null, "子代理"),
      h("span", { className: "sap-stat" }, `总计 ${stats.total}`),
      h("span", { className: "sap-stat" }, `运行 ${stats.running}`),
      h("span", { className: "sap-stat" }, `完成 ${stats.completed}`),
      h("span", { className: "sap-stat sap-errt" }, `出错 ${stats.error}`),
      h("span", { className: "sap-stat" }, `成本 $${stats.costUsd.toFixed(4)}`),
      h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部会话")
    ),
    runs.length === 0 ? h("div", { className: "sap-empty" }, cfg.scope === "session" && !sessionId ? "等待会话加载…" : "暂无子代理运行记录。") : h(
      "table",
      { className: "sap-table" },
      h("thead", null, h("tr", null, ["Agent", "模型", "状态", "耗时", "任务", ""].map((x, i) => h("th", { key: i }, x)))),
      h("tbody", null, runs.slice(0, max).map((run) => {
        const [st, col] = statusOf(run);
        const running = run.status === "running";
        return h(
          "tr",
          { key: run.id, className: "sap-tr", onClick: () => setSel(sel === run.id ? null : run.id) },
          h("td", null, h("b", null, run.provider || "?")),
          h("td", null, h("span", { className: "sap-model" }, modelText(run))),
          h("td", null, h("span", { style: { color: col, fontWeight: 600 } }, st)),
          h("td", null, running ? fmtDur(Date.now() - (run.startedAt || 0)) : fmtDur((run.endedAt || 0) - (run.startedAt || 0))),
          h("td", { className: "sap-celltask" }, run.label || run.prompt || ""),
          h("td", null, running && cfg.allowStop ? h("button", { className: "sap-x", onClick: (e) => {
            e.stopPropagation();
            onStop(run.id);
          } }, "停止") : null)
        );
      }))
    ),
    selRun ? h(
      "div",
      { className: "sap-detail" },
      h("div", null, h("b", null, "ID "), selRun.id),
      h("div", null, h("b", null, "模型 "), modelText(selRun), " · ", h("b", null, "成本 "), typeof selRun.costUsd === "number" ? `$${selRun.costUsd.toFixed(4)}` : "—", " · ", h("b", null, "步骤 "), `${selRun.eventCount || 0}`),
      h("div", null, h("b", null, "任务 "), selRun.prompt || selRun.label || "—"),
      h("div", null, h("b", null, "最近 "), lastAction(selRun) || "—")
    ) : null
  );
}
function Settings({ connection }) {
  const snap = useRuns(connection, 4e3);
  const [overrides, setOverrides] = import_react.default.useState(readOverrides);
  const [note, setNote] = import_react.default.useState("");
  const cfg = { ...DEFAULTS, ...snap && snap.cfg || {}, ...overrides };
  const runs = snap.runs || [];
  const stats = statsOf(runs);
  const persist = async (key, value) => {
    try {
      await rpc(connection, "panel", { key, value });
      const next = { ...overrides };
      delete next[key];
      setOverrides(next);
      writeOverrides(next);
      setNote("");
    } catch (error) {
      const next = { ...overrides, [key]: value };
      setOverrides(next);
      writeOverrides(next);
      setNote(`写回配置失败（${String(error?.message ?? error).slice(0, 80)}），已改为本地生效。`);
    }
  };
  const row = (label, hint, control) => h(
    "div",
    { className: "sap-setrow" },
    h("div", { className: "sap-setlab" }, label, hint ? h("div", { className: "sap-sethint" }, hint) : null),
    h("div", { className: "sap-setctl" }, control)
  );
  const toggle = (k) => h("button", { className: "sap-pill" + (cfg[k] ? " sap-on" : ""), onClick: () => persist(k, !cfg[k]) }, h("span"));
  const sel = (k, opts, cast) => h("select", { className: "sap-sel", value: String(cfg[k]), onChange: (e) => persist(k, cast(e.target.value)) }, opts.map(([v, t]) => h("option", { key: v, value: v }, t)));
  return h(
    "div",
    { className: "sap-settings" },
    h(
      "div",
      { className: "sap-stats" },
      h("span", null, `总计 ${stats.total}`),
      h("span", null, `运行 ${stats.running}`),
      h("span", null, `完成 ${stats.completed}`),
      h("span", null, `出错 ${stats.error}`),
      h("span", null, `成本 $${stats.costUsd.toFixed(4)}`)
    ),
    row("显示输入框上方 dock", "常驻一行，有新运行自动展开", toggle("dock")),
    row("显示「子代理」标签页", "详情 / 历史", toggle("tab")),
    row("范围", "", sel("scope", [["session", "本会话"], ["all", "全部会话"]], String)),
    row("完成卡片自动收起", "0 = 不自动收", sel("autoHideSeconds", [["0", "不自动"], ["10", "10 秒"], ["30", "30 秒"], ["60", "60 秒"], ["300", "5 分钟"]], Number)),
    row("卡片上限", "", sel("maxCards", [["10", "10"], ["20", "20"], ["40", "40"]], Number)),
    row("[停止] 按钮（kill 进程）", "", toggle("allowStop")),
    note ? h("div", { className: "sap-warn" }, note) : null,
    h("div", { className: "sap-note" }, "开关写回本插件的配置（cordis.patch.yml 的 panel 节点），改完立即生效，无需重启。数据来自插件 runs 账本；模型取自 CLI 事件，取不到时显示「CLI 默认」。「强制所有调用走插件路径」为待开发项。")
  );
}
var PANEL_STYLE = `
.sap-dock { margin: 4px 0 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; font-size: 12px; }
.sap-head { display: flex; align-items: center; gap: 6px; padding: 4px 9px; cursor: default; user-select: none; }
.sap-care { display: inline-block; transition: transform .15s; color: var(--dsw-alias-brand-primary); cursor: pointer; }
.sap-care.sap-open { transform: rotate(90deg); }
.sap-h1 { font-weight: 600; cursor: pointer; }
.sap-run { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.sap-mut { color: var(--dsw-alias-label-secondary); }
.sap-errt { color: #e5533c; }
.sap-sp { flex: 1; }
.sap-scope { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sap-close { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 11px; line-height: 1; padding: 2px 4px; border-radius: 5px; }
.sap-close:hover { background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); }
.sap-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; padding: 0 8px 7px; max-height: 180px; overflow-y: auto; }
.sap-card { border: 1px solid var(--dsw-alias-border-l2); border-top: 2px solid var(--dsw-alias-brand-primary); border-radius: 8px; padding: 4px 8px; min-width: 0; background: var(--dsw-alias-bg-layer-2); }
.sap-card.sap-done { border-top-color: #3f9d5a; }
.sap-card.sap-err { border-top-color: #e5533c; }
.sap-row { display: flex; align-items: center; gap: 5px; }
.sap-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.sap-dot.sap-stall { animation: sap-blink 1.2s ease-in-out infinite; }
@keyframes sap-blink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.sap-agent { font-weight: 600; }
.sap-model { font-size: 10px; padding: 0 6px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sap-time { margin-left: auto; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; font-size: 11px; }
.sap-x { font-size: 10px; padding: 1px 7px; border-radius: 6px; border: 1px solid color-mix(in srgb, #e5533c 45%, transparent); color: #e5533c; background: transparent; cursor: pointer; }
.sap-x:hover { background: color-mix(in srgb, #e5533c 10%, transparent); }
.sap-sub { display: flex; align-items: baseline; gap: 6px; margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; overflow: hidden; }
.sap-task { color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; }
.sap-act { overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; }
.sap-stalltag { color: #d9a400; font-size: 10px; }
.sap-cost { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.sap-tab { padding: 12px 16px; font-size: 13px; }
.sap-tabhead { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.sap-tabhead b { font-size: 15px; }
.sap-stat { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sap-table { width: 100%; border-collapse: collapse; }
.sap-table th, .sap-table td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--dsw-alias-border-l2); white-space: nowrap; }
.sap-table th { color: var(--dsw-alias-label-secondary); font-weight: 500; font-size: 12px; }
.sap-tr { cursor: pointer; }
.sap-tr:hover { background: var(--dsw-alias-bg-overlay); }
.sap-celltask { max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.sap-detail { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 12px; line-height: 1.7; word-break: break-all; }
.sap-empty { padding: 18px; color: var(--dsw-alias-label-secondary); }
.sap-settings { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; padding: 4px 14px; }
.sap-stats { display: flex; gap: 14px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.sap-setrow { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.sap-setrow:last-child { border-bottom: 0; }
.sap-setlab { color: var(--dsw-alias-label-primary); font-size: 13px; }
.sap-sethint { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 2px; }
.sap-setctl { margin-left: auto; }
.sap-pill { width: 38px; height: 21px; border-radius: 999px; border: none; background: var(--dsw-alias-border-l3); position: relative; cursor: pointer; padding: 0; transition: background .15s; }
.sap-pill.sap-on { background: #3f9d5a; }
.sap-pill span { position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #fff; transition: left .15s; }
.sap-pill.sap-on span { left: 19px; }
.sap-sel { height: 28px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; }
.sap-note { color: var(--dsw-alias-label-secondary); font-size: 11px; padding: 9px 0 4px; }
.sap-warn { color: #d9a400; font-size: 11px; padding: 6px 0; }
`;
function registerPanel(ctx) {
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.pluginPanel = "dsh-subagent-panel";
    tag.textContent = PANEL_STYLE;
    document.head.append(tag);
    return () => tag.remove();
  }, "dsh-subagent: panel styles");
  const connection = () => ctx.get("connection");
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "subagent-run-dock",
    order: 40
  }, (props) => h(Dock, { connection: connection(), sessionId: props?.sessionId ?? props?.session?.id ?? null })));
  ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "subagent-run-tab",
    order: 40,
    label: () => "子代理"
  }, (props) => h(Tab, { connection: connection(), sessionId: props?.sessionId ?? props?.session?.id ?? null })));
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "subagent-run-panel",
    order: 17,
    label: () => "运行面板"
  }, () => h(Settings, { connection: connection() })));
}

var name = "qoder-subagent-client";
var inject = ["slots", "locale", "configForms", "connection"];
var ENTRY_ID = "subagent-cli";
var LOCALE_NS = "settings.qoderSubagent";
var LOCALES = {
  zh: { meta: { title: "自由子代理", description: "把任务委派给本机已登录的外部 CLI 子代理,消耗各自会员额度。" }, nav: "自由子代理" },
  en: { meta: { title: "Free Subagents", description: "Delegate tasks to local external CLI subagents and spend their subscription quotas." }, nav: "Free Subagents" }
};
var STYLE = `
.qsub-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.qsub-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.qsub-field { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; min-height: 32px; }
.qsub-label { width: 130px; flex: none; color: var(--dsw-alias-label-primary); opacity: .7; font-size: 13px; }
.qsub-control { height: 32px; padding: 0 10px; border-radius: 8px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; outline: none; transition: border-color .15s, box-shadow .15s; }
.qsub-control:hover { border-color: var(--dsw-alias-border-l3); }
.qsub-control:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.qsub-control:disabled { opacity: .45; cursor: not-allowed; background: var(--dsw-alias-bg-overlay); }
.qsub-btn:disabled { opacity: .45; cursor: not-allowed; }
.qsub-control::placeholder { color: var(--dsw-alias-label-primary); opacity: .35; }
.qsub-select { min-width: 220px; padding-right: 6px; }
.qsub-number { width: 140px; }
.qsub-path { width: 380px; max-width: 100%; }
.qsub-btn { height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; cursor: pointer; transition: background .15s, border-color .15s; }
.qsub-btn:hover { background: var(--dsw-alias-bg-overlay); border-color: var(--dsw-alias-border-l3); }
.qsub-hint { color: var(--dsw-alias-label-primary); opacity: .55; font-size: 12px; }
.qsub-ok { color: #3f9d5a; }
.qsub-bad { color: #e5533c; }
.qsub-mono { font-family: ui-monospace, Consolas, monospace; }
.qsub-toolbar { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 10px; }
.qsub-active-btn { background: var(--dsw-alias-bg-overlay); border-color: var(--dsw-alias-border-l3); font-weight: 600; }
.qsub-tabs { display: flex; gap: 2px; margin-bottom: 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.qsub-tab { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 8px 14px; color: var(--dsw-alias-label-primary); opacity: .6; font-size: 13px; cursor: pointer; }
.qsub-tab:hover { opacity: .85; }
.qsub-tab-on { opacity: 1; font-weight: 600; border-bottom-color: var(--dsw-alias-brand-primary); }
.qsub-model-list { flex: 1; min-width: 0; }
.qsub-model-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
.qsub-model-name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qsub-model-rate { font-size: 12px; opacity: .55; flex: none; }
.qsub-icon-btn { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 12px; line-height: 1; }
.qsub-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-overlay); }
.qsub-icon-btn:disabled { opacity: .3; cursor: not-allowed; }
.qsub-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 3000; }
.qsub-toast { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; padding: 10px 20px; font-size: 15px; font-weight: 700; box-shadow: 0 8px 24px rgba(0,0,0,.18); z-index: 3100; }
.qsub-modal { width: 520px; max-width: calc(100vw - 40px); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 20px; box-shadow: 0 10px 40px rgba(0,0,0,.25); }
`;
var REASONING_EFFORTS = ["auto", "none", "low", "medium", "high", "xhigh", "max", "ultracode"];
var BUILTIN_BACKENDS = [
  { name: "qoder", driver: "qoder-json" },
  { name: "qodercn", driver: "qoder-json" },
  { name: "opencode", driver: "opencode-json" },
  { name: "pi", driver: "pi-json" },
  { name: "codebuddy", driver: "codebuddy-json" },
  { name: "codex", driver: "codex-json" },
  { name: "claude", driver: "claude-json" }
];
var RESUME_COMMANDS = {
  qoder: (id) => `qodercli --resume ${id}`,
  qodercn: (id) => `qoderclicn --resume ${id}`,
  codebuddy: (id) => `codebuddy --resume ${id}`,
  claude: (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`
};
var PERMISSION_MODES = [
  ["bypass_permissions", "完全放行(跳过权限检查)"],
  ["auto", "自动判断"],
  ["accept_edits", "自动接受编辑"],
  ["dont_ask", "不询问"],
  ["default", "默认"]
];
var h2 = import_react2.default.createElement;
function callRpc(connection, endpoint, payload, timeout = 6e4) {
  return connection.rpc.call("/api", `qoder-subagent/${endpoint}`, payload, AbortSignal.timeout(timeout)).then((result) => {
    if (!result?.ok) throw new Error(result?.error?.message ?? "probe failed");
    return result.value;
  });
}
function ProviderCard({ spec, index, form, connection, onRemove, onMove, canUp, canDown, removingName, probeCache }) {
  const [probe, setProbe] = import_react2.default.useState({ status: "idle" });
  const [saving, setSaving] = import_react2.default.useState(0);
  const [saveError, setSaveError] = import_react2.default.useState("");
  const [updating, setUpdating] = import_react2.default.useState(false);
  const [updateMsg, setUpdateMsg] = import_react2.default.useState("");
  const mountedRef = import_react2.default.useRef(true);
  import_react2.default.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const probeKey = `${spec.name}|${spec.binary ?? ""}`;
  import_react2.default.useEffect(() => {
    let alive = true;
    const hit = probeCache?.current?.get(probeKey);
    if (hit?.value) {
      setProbe({ status: "ready", value: hit.value });
    } else if (hit?.promise) {
      setProbe({ status: "loading" });
      hit.promise.then((value) => alive && setProbe({ status: "ready", value })).catch((error) => alive && setProbe({ status: "error", message: String(error?.message ?? error) }));
    } else {
      setProbe({ status: "loading" });
      const promise = callRpc(connection, "probe", { name: spec.name });
      probeCache?.current?.set(probeKey, { promise });
      promise.then((value) => {
        probeCache?.current?.set(probeKey, { value });
        if (alive) setProbe({ status: "ready", value });
      }).catch((error) => {
        probeCache?.current?.delete(probeKey);
        if (alive) setProbe({ status: "error", message: String(error?.message ?? error) });
      });
    }
    return () => {
      alive = false;
    };
  }, [probeKey, connection, probeCache]);
  const write = (patch) => {
    const current = form.getSnapshot().value ?? {};
    const providers = (current.providers ?? []).map((entry, i) => i === index ? { ...entry, ...patch } : entry);
    setSaving((n) => n + 1);
    setSaveError("");
    form.set("providers", providers).then((ok) => {
      if (!ok) setSaveError("保存被拒绝");
    }).catch((error) => setSaveError(`保存失败: ${String(error?.message ?? error).slice(0, 120)}`)).finally(() => setSaving((n) => Math.max(0, n - 1)));
  };
  const setField = (key) => (event) => {
    const raw = event.target.value;
    write({ [key]: raw === "" ? void 0 : raw });
  };
  const [drafts, setDrafts] = import_react2.default.useState({});
  const draftProps = (key, commit) => ({
    value: drafts[key] ?? (spec[key] ?? ""),
    onChange: (event) => setDrafts((current) => ({ ...current, [key]: event.target.value })),
    onBlur: () => {
      if (drafts[key] === void 0) return;
      commit(drafts[key]);
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    onKeyDown: (event) => {
      if (event.key === "Enter") event.currentTarget.blur();
    }
  });
  const commitNumber = (key, min = 1) => (raw) => {
    const text = String(raw).trim();
    if (text === "") return write({ [key]: void 0 });
    const value = Number(text);
    if (!Number.isFinite(value) || value < min) return;
    write({ [key]: value });
  };
  const updateCli = () => {
    if (updating) return;
    setUpdating(true);
    setUpdateMsg("");
    callRpc(connection, "update", { name: spec.name }, 19e4).then((value) => {
      probeCache?.current?.set(probeKey, { value });
      if (mountedRef.current) {
        setProbe({ status: "ready", value });
        setUpdateMsg(`CLI 已更新到 v${value.version ?? "最新版"}`);
      }
    }).catch((error) => {
      if (mountedRef.current) setUpdateMsg(`更新失败: ${String(error?.message ?? error).slice(0, 200)}`);
    }).finally(() => {
      if (mountedRef.current) setUpdating(false);
    });
  };
  const refresh = () => {
    setProbe({ status: "loading" });
    setUpdateMsg("");
    const promise = callRpc(connection, "refresh", { name: spec.name });
    probeCache?.current?.set(probeKey, { promise });
    promise.then((value) => {
      probeCache?.current?.set(probeKey, { value });
      if (mountedRef.current) setProbe({ status: "ready", value });
    }).catch((error) => {
      probeCache?.current?.delete(probeKey);
      if (mountedRef.current) setProbe({ status: "error", message: String(error?.message ?? error) });
    });
  };
  const info = probe.value;
  const disabled = probe.status === "loading";
  const models = Array.isArray(spec.models) && spec.models.length > 0 ? spec.models : spec.model ? [spec.model] : [];
  const writeModels = (next) => write({ models: next, model: void 0 });
  const moveModel = (index2, delta) => {
    const target = index2 + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index2], next[target]] = [next[target], next[index2]];
    writeModels(next);
  };
  const field = (name2, control, hint) => h2(
    "div",
    { className: "qsub-field", style: { alignItems: "flex-start" } },
    h2("span", { className: "qsub-label", style: { paddingTop: 6 } }, name2),
    control,
    hint ? h2("span", { className: "qsub-hint", style: { paddingTop: 6 } }, hint) : null
  );
  return h2(
    "section",
    { key: spec.name, className: "qsub-card" },
    h2(
      "div",
      { className: "qsub-head", style: { flexWrap: "wrap", rowGap: 6 } },
      h2("strong", { style: { fontSize: 15, whiteSpace: "nowrap" } }, spec.name),
      probe.status === "loading" && h2("span", { className: "qsub-hint", style: { whiteSpace: "nowrap" } }, "检测中…"),
      probe.status === "error" && h2("span", { className: "qsub-bad", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 } }, `检测失败: ${probe.message}`),
      probe.status === "ready" && (info.exists ? h2("span", { className: "qsub-ok", style: { whiteSpace: "nowrap" } }, `已安装 · v${info.version ?? "?"}`) : h2("span", { className: "qsub-bad", style: { whiteSpace: "nowrap" } }, "未找到 CLI")),
      saving > 0 && h2("span", { className: "qsub-hint", style: { color: "var(--dsw-alias-brand-primary)", whiteSpace: "nowrap" } }, "保存中…"),
      saveError && h2("span", { className: "qsub-bad", style: { whiteSpace: "nowrap" } }, saveError),
      onMove && h2("button", { type: "button", onClick: () => onMove(-1), className: "qsub-btn", disabled: disabled || !canUp, title: "上移(提高优先级)", style: { whiteSpace: "nowrap", flexShrink: 0 } }, "↑"),
      onMove && h2("button", { type: "button", onClick: () => onMove(1), className: "qsub-btn", disabled: disabled || !canDown, title: "下移(降低优先级)", style: { whiteSpace: "nowrap", flexShrink: 0 } }, "↓"),
      h2("button", { type: "button", onClick: refresh, className: "qsub-btn", disabled, style: { marginLeft: "auto", whiteSpace: "nowrap", flexShrink: 0 } }, "刷新"),
      onRemove && h2("button", { type: "button", onClick: onRemove, className: "qsub-btn", disabled: disabled || Boolean(removingName), title: "停用此后端(从配置移除)", style: { whiteSpace: "nowrap", flexShrink: 0 } }, removingName === spec.name ? "停用中…" : "停用")
    ),
    probe.status === "ready" && h2("div", { className: "qsub-hint qsub-mono", style: { marginBottom: 8, wordBreak: "break-all" } }, info.binary ?? "未解析到路径"),
    info?.updateAvailable && h2(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 } },
      h2("button", {
        type: "button",
        onClick: updateCli,
        className: "qsub-btn qsub-active-btn",
        disabled: disabled || updating,
        title: `更新 CLI 到 v${info.latestVersion}`,
        style: { whiteSpace: "nowrap", flexShrink: 0 }
      }, updating ? "更新中…" : "更新 CLI"),
      h2("span", { className: "qsub-hint", style: { whiteSpace: "nowrap" } }, `最新版本 v${info.latestVersion}`)
    ),
    updateMsg && h2("div", { className: updateMsg.startsWith("更新失败") ? "qsub-bad" : "qsub-ok", style: { marginBottom: 8 } }, updateMsg),
    field(
      "模型顺序",
      h2(
        "div",
        { className: "qsub-model-list" },
        models.length === 0 && h2("div", { className: "qsub-hint", style: { marginBottom: 6 } }, "未指定(用 CLI 默认模型);没有备用模型可切换"),
        models.map((model, position) => h2(
          "div",
          { key: `${model}:${position}`, className: "qsub-model-row" },
          h2("span", { className: "qsub-model-name" }, `${position + 1}. ${model}`),
          h2("span", { className: "qsub-model-rate" }, info?.rates?.[model] ? `${info.rates[model]} 额度` : ""),
          h2("button", { type: "button", className: "qsub-icon-btn", title: "上移", disabled: disabled || position === 0, onClick: () => moveModel(position, -1) }, "↑"),
          h2("button", { type: "button", className: "qsub-icon-btn", title: "下移", disabled: disabled || position === models.length - 1, onClick: () => moveModel(position, 1) }, "↓"),
          h2("button", { type: "button", className: "qsub-icon-btn", title: "移除", disabled, onClick: () => writeModels(models.filter((_, i) => i !== position)) }, "✕")
        )),
        h2(
          "select",
          {
            className: "qsub-control qsub-select",
            style: { marginTop: 6, width: "100%" },
            value: "",
            disabled,
            onChange: (event) => {
              const model = event.target.value;
              event.target.value = "";
              if (model) writeModels([...models, model]);
            }
          },
          h2("option", { value: "" }, "+ 添加模型…"),
          (info?.models ?? []).filter((model) => !models.includes(model)).map((model) => h2("option", { key: model, value: model }, info?.rates?.[model] ? `${model} · ${info.rates[model]} 额度` : model))
        ),
        h2("div", { className: "qsub-hint", style: { marginTop: 6 } }, "按顺序尝试,卡住自动切换下一个")
      )
    ),
    field("并发上限", h2("input", { className: "qsub-control qsub-number", type: "number", min: 1, step: 1, placeholder: "2", ...draftProps("maxConcurrency", commitNumber("maxConcurrency")), disabled }), "个,所有 dsh 任务共享同一上限;超出排队"),
    field("思考程度", h2(
      "select",
      { className: "qsub-control qsub-select", value: spec.reasoningEffort ?? "auto", onChange: setField("reasoningEffort"), disabled },
      REASONING_EFFORTS.map((level) => h2("option", { key: level, value: level }, level))
    )),
    field("上下文大小", h2("input", { className: "qsub-control qsub-number", type: "number", min: 1e3, step: 1e3, placeholder: "默认", ...draftProps("contextWindow", commitNumber("contextWindow")), disabled }), "tokens,留空用默认"),
    field("权限模式", h2(
      "select",
      { className: "qsub-control qsub-select", value: spec.permissionMode ?? "bypass_permissions", onChange: setField("permissionMode"), disabled },
      PERMISSION_MODES.map(([value, label]) => h2("option", { key: value, value }, `${label}(${value})`))
    )),
    field("单模型等待", h2("input", { className: "qsub-control qsub-number", type: "number", min: 0, placeholder: "90", ...draftProps("stallWarnSeconds", commitNumber("stallWarnSeconds", 0)), disabled }), "秒无输出则切换下一个模型,0 关闭"),
    field("允许等待", h2("input", { className: "qsub-control qsub-number", type: "number", min: 1, placeholder: "300", ...draftProps("allowedWaitSeconds", commitNumber("allowedWaitSeconds")), disabled }), "秒,整条链共用;超时直接上报主任务"),
    field("超时", h2("input", { className: "qsub-control qsub-number", type: "number", min: 1, placeholder: "不限", ...draftProps("timeoutSeconds", commitNumber("timeoutSeconds")), disabled }), "秒"),
    field("CLI 路径", h2("input", { className: "qsub-control qsub-path", type: "text", placeholder: "自动探测(含 PATH)", ...draftProps("binary", (raw) => write({ binary: String(raw).trim() || void 0 })), disabled }))
  );
}
function AddBackend({ options, form, connection, onCustom }) {
  const [probes, setProbes] = import_react2.default.useState({});
  const [saving, setSaving] = import_react2.default.useState(false);
  const [saveError, setSaveError] = import_react2.default.useState("");
  const names = options.map((option) => option.name).join(",");
  import_react2.default.useEffect(() => {
    let alive = true;
    setProbes({});
    for (const option of options) {
      callRpc(connection, "probe", { name: option.name }).then((value) => alive && setProbes((current) => ({ ...current, [option.name]: value }))).catch(() => alive && setProbes((current) => ({ ...current, [option.name]: { unavailable: true } })));
    }
    return () => {
      alive = false;
    };
  }, [names, connection]);
  const label = (option) => {
    const info = probes[option.name];
    if (!info) return `${option.name} · 检测中…`;
    if (info.unavailable) return `${option.name} · 无法检测`;
    if (!info.exists) return `${option.name} · 未找到 CLI`;
    return `${option.name} · 已安装${info.version ? ` v${info.version}` : ""}`;
  };
  const add = (name2) => {
    const option = options.find((candidate) => candidate.name === name2);
    if (!option) return;
    const current = form.getSnapshot().value ?? {};
    const providers = [...current.providers ?? [], { name: option.name, driver: option.driver }];
    setSaving(true);
    setSaveError("");
    form.set("providers", providers).then((ok) => {
      if (!ok) setSaveError("保存被拒绝");
    }).catch((error) => setSaveError(`保存失败: ${String(error?.message ?? error).slice(0, 120)}`)).finally(() => setSaving(false));
  };
  return h2(
    import_react2.default.Fragment,
    null,
    h2(
      "select",
      {
        className: "qsub-control qsub-select",
        style: { minWidth: 190 },
        value: "",
        disabled: saving,
        title: "只注册已添加的后端;装了但没添加的 CLI 不会出现在工具和指令里",
        onChange: (event) => {
          const name2 = event.target.value;
          event.target.value = "";
          if (name2 === "__custom__") onCustom?.();
          else if (name2) add(name2);
        }
      },
      h2("option", { value: "" }, saving ? "添加中…" : "+ 选择要启用的后端…"),
      options.map((option) => h2("option", { key: option.name, value: option.name }, label(option))),
      h2("option", { value: "__custom__" }, "添加自定义后端…")
    ),
    saveError ? h2("span", { className: "qsub-bad" }, saveError) : null
  );
}
var DRIVER_OPTIONS = [
  ["qoder-json", "qoder-json(Claude 风格 stream-json)"],
  ["codebuddy-json", "codebuddy-json(腾讯 CodeBuddy)"],
  ["claude-json", "claude-json(Claude Code)"],
  ["codex-json", "codex-json(OpenAI Codex)"],
  ["opencode-json", "opencode-json(OpenCode)"],
  ["pi-json", "pi-json(Pi)"]
];
function CustomBackendModal({ form, onClose }) {
  const open = true;
  const setOpen = (value) => {
    if (!value) onClose?.();
  };
  const [name2, setName] = import_react2.default.useState("");
  const [driver, setDriver] = import_react2.default.useState("qoder-json");
  const [binary, setBinary] = import_react2.default.useState("");
  const [error, setError] = import_react2.default.useState("");
  const [saving, setSaving] = import_react2.default.useState(false);
  import_react2.default.useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => {
    setOpen(false);
    setError("");
  };
  const add = () => {
    const trimmed = name2.trim();
    if (!trimmed) return setError("请填写后端名称,例如 mycli");
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return setError("名称只能包含字母、数字、- 和 _");
    const latest = form.getSnapshot().value?.providers ?? [];
    if (latest.some((entry2) => entry2.name === trimmed)) return setError("该名称已存在");
    const entry = { name: trimmed, driver, permissionMode: "bypass_permissions", models: [], extraArgs: [] };
    if (binary.trim()) entry.binary = binary.trim();
    setSaving(true);
    setError("");
    form.set("providers", [...latest, entry]).then((ok) => {
      if (!ok) setError("添加被拒绝");
      else {
        setName("");
        setBinary("");
        setOpen(false);
      }
    }).catch((reason) => setError(`添加失败: ${String(reason?.message ?? reason).slice(0, 120)}`)).finally(() => setSaving(false));
  };
  return h2(
    import_react2.default.Fragment,
    null,
    open && h2(
      "div",
      { className: "qsub-modal-mask", onClick: close },
      h2(
        "div",
        { className: "qsub-modal", onClick: (event) => event.stopPropagation() },
        h2("h3", { style: { margin: "0 0 12px", fontSize: 16 } }, "添加自定义后端"),
        h2(
          "div",
          { className: "qsub-field" },
          h2("span", { className: "qsub-label" }, "名称"),
          h2("input", { className: "qsub-control", style: { width: 300 }, placeholder: "只能包含字母、数字、- 和 _,例如 mycli", value: name2, disabled: saving, autoFocus: true, onChange: (event) => setName(event.target.value) })
        ),
        h2(
          "div",
          { className: "qsub-field" },
          h2("span", { className: "qsub-label" }, "驱动"),
          h2(
            "select",
            { className: "qsub-control qsub-select", value: driver, disabled: saving, onChange: (event) => setDriver(event.target.value) },
            DRIVER_OPTIONS.map(([value, label]) => h2("option", { key: value, value }, label))
          )
        ),
        h2(
          "div",
          { className: "qsub-field" },
          h2("span", { className: "qsub-label" }, "CLI 路径"),
          h2("input", { className: "qsub-control", style: { width: 380 }, placeholder: "可留空自动探测", value: binary, disabled: saving, onChange: (event) => setBinary(event.target.value) })
        ),
        error ? h2("div", { className: "qsub-bad", style: { marginBottom: 8 } }, error) : null,
        h2("div", { className: "qsub-hint", style: { marginBottom: 12 } }, "驱动须与 CLI 的 JSON 协议一致;添加后会生成同名工具、/指令,并出现在预设与状态列表里。"),
        h2(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
          h2("button", { type: "button", className: "qsub-btn", disabled: saving, onClick: close }, "取消"),
          h2("button", { type: "button", className: "qsub-btn qsub-active-btn", disabled: saving, onClick: add }, saving ? "添加中…" : "添加")
        )
      )
    )
  );
}
var LAYOUT_KEY = "qsub.layout";
function QoderSection({ form, connection }) {
  const subscribe = import_react2.default.useCallback((cb) => form.subscribe(cb), [form]);
  const getSnapshot = import_react2.default.useCallback(() => form.getSnapshot(), [form]);
  const snapshot = import_react2.default.useSyncExternalStore(subscribe, getSnapshot);
  const [layout, setLayout] = import_react2.default.useState(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === "tabs" ? "tabs" : "stack";
    } catch {
      return "stack";
    }
  });
  const [active, setActive] = import_react2.default.useState(0);
  const [limitDraft, setLimitDraft] = import_react2.default.useState(null);
  const [customOpen, setCustomOpen] = import_react2.default.useState(false);
  const [toast, setToast] = import_react2.default.useState("");
  const [toastPos, setToastPos] = import_react2.default.useState(null);
  const toastTimer = import_react2.default.useRef(0);
  const [modeDraft, setModeDraft] = import_react2.default.useState(null);
  const [modeSaving, setModeSaving] = import_react2.default.useState(false);
  const [modeError, setModeError] = import_react2.default.useState("");
  const modeTimer = import_react2.default.useRef(0);
  const [removing, setRemoving] = import_react2.default.useState("");
  const removingRef = import_react2.default.useRef(false);
  const probeCache = import_react2.default.useRef(/* @__PURE__ */ new Map());
  const providerKey = (snapshot.value?.providers ?? []).map((spec) => `${spec.name}|${spec.binary ?? ""}`).join("\0");
  import_react2.default.useEffect(() => {
    if (!connection || snapshot.status !== "ready") return;
    for (const spec of snapshot.value?.providers ?? []) {
      const key = `${spec.name}|${spec.binary ?? ""}`;
      if (probeCache.current.has(key)) continue;
      const promise = callRpc(connection, "probe", { name: spec.name });
      probeCache.current.set(key, { promise });
      promise.then((value) => probeCache.current.set(key, { value })).catch(() => probeCache.current.delete(key));
    }
  }, [providerKey, connection, probeCache]);
  const rootRef = import_react2.default.useRef(null);
  const showToast = (text) => {
    const rect = rootRef.current?.closest?.('[role="dialog"]')?.getBoundingClientRect?.();
    setToastPos(rect ? { left: Math.round(rect.left + rect.width / 2), top: Math.round(rect.top + 34) } : null);
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2500);
  };
  import_react2.default.useEffect(() => () => clearTimeout(modeTimer.current), []);
  const limitTimer = import_react2.default.useRef(0);
  const statusLimit = Number(snapshot.value?.statusListLimit ?? 16);
  const scheduleMode = modeDraft ?? (snapshot.value?.scheduleMode === "balanced" ? "balanced" : "priority");
  const changeMode = (value) => {
    setModeDraft(value);
    setModeError("");
    clearTimeout(modeTimer.current);
    modeTimer.current = setTimeout(async () => {
      setModeSaving(true);
      try {
        const ok = await form.set("scheduleMode", value);
        if (!ok) setModeError("保存被拒绝");
      } catch (error) {
        setModeError(`保存失败: ${String(error?.message ?? error).slice(0, 80)}`);
      } finally {
        setModeSaving(false);
        setModeDraft(null);
      }
    }, 400);
  };
  const chooseLayout = (value) => {
    setLayout(value);
    try {
      localStorage.setItem(LAYOUT_KEY, value);
    } catch {
    }
  };
  const changeLimit = (raw) => {
    const value = Number(raw);
    setLimitDraft(raw);
    clearTimeout(limitTimer.current);
    if (!Number.isFinite(value) || value < 1 || value > 24) return;
    limitTimer.current = setTimeout(() => {
      void form.set("statusListLimit", value);
      setLimitDraft(null);
    }, 500);
  };
  if (snapshot.status === "loading") return h2("div", { style: { opacity: 0.6 } }, "加载配置…");
  if (snapshot.status === "unavailable") return h2("div", null, "dsh-subagent 配置未挂载(检查 profile bundles)。");
  const providers = snapshot.value?.providers ?? [];
  const configured = new Set(providers.map((spec) => spec.name));
  const missing = BUILTIN_BACKENDS.filter((entry) => !configured.has(entry.name));
  const current = Math.min(active, Math.max(0, providers.length - 1));
  const removeProvider = (index) => {
    if (removingRef.current) return;
    const latest = form.getSnapshot().value?.providers ?? providers;
    const name2 = latest[index]?.name ?? "";
    if (!name2) return;
    removingRef.current = true;
    setRemoving(name2);
    form.set("providers", latest.filter((entry) => entry.name !== name2)).then((ok) => {
      showToast(ok ? `✅ 已停用后端 ${name2}` : "停用失败,请重试");
    }).catch(() => showToast("停用失败,请重试")).finally(() => {
      removingRef.current = false;
      setRemoving("");
    });
  };
  const moveProvider = (index, delta) => {
    const latest = form.getSnapshot().value?.providers ?? providers;
    const target = index + delta;
    if (target < 0 || target >= latest.length) return;
    const next = [...latest];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    void form.set("providers", next);
    setActive(target);
  };
  const layoutButton = (value, label) => h2("button", {
    type: "button",
    className: `qsub-btn${layout === value ? " qsub-active-btn" : ""}`,
    onClick: () => chooseLayout(value)
  }, label);
  return h2(
    "div",
    { style: { maxWidth: 640 }, ref: rootRef },
    h2("h2", null, "自由子代理"),
    h2("p", { className: "qsub-hint", style: { fontSize: 13 } }, `把任务委派给本机已登录的外部 CLI 子代理(当前启用:${providers.map((spec) => spec.name).join(" / ") || "无"}),消耗各自会员额度。子代理看不到当前对话,委派内容需自带完整上下文。`),
    h2(
      "div",
      { className: "qsub-toolbar" },
      providers.length > 0 && layoutButton("stack", "堆叠"),
      providers.length > 0 && layoutButton("tabs", "标签页"),
      h2(AddBackend, { options: missing, form, connection, onCustom: () => setCustomOpen(true) })
    ),
    h2(
      "div",
      { className: "qsub-field", style: { marginBottom: 12 } },
      h2("span", { className: "qsub-label" }, "状态列表条数"),
      h2("input", {
        className: "qsub-control qsub-number",
        type: "number",
        min: 1,
        max: 24,
        value: limitDraft ?? statusLimit,
        onChange: (event) => changeLimit(event.target.value)
      }),
      h2("span", { className: "qsub-hint" }, "1-24,/sub_agent_status 列出最近 N 次运行")
    ),
    h2(
      "div",
      { className: "qsub-field", style: { marginBottom: 12 } },
      h2("span", { className: "qsub-label" }, "调度模式"),
      h2(
        "select",
        { className: "qsub-control qsub-select", value: scheduleMode, disabled: modeSaving, onChange: (event) => changeMode(event.target.value) },
        h2("option", { value: "priority" }, "优先启动(按后端顺序)"),
        h2("option", { value: "balanced" }, "平均分配(轮流使用)")
      ),
      h2("span", { className: modeError ? "qsub-bad" : "qsub-hint", style: modeSaving ? { color: "var(--dsw-alias-brand-primary)" } : void 0 }, modeSaving ? "保存中…" : modeError || (scheduleMode === "priority" ? "从所选后端开始(↑↓ 调整顺序),满后自动转给下一个;全部满则等待" : "插件自动选择当前任务最少的后端,并遵守并发上限"))
    ),
    providers.length === 0 && h2("div", { className: "qsub-hint", style: { marginBottom: 12 } }, "当前没有启用任何后端,从下方添加一个内置后端。"),
    providers.length > 0 && layout === "tabs" && h2(
      "div",
      { className: "qsub-tabs" },
      providers.map((spec, index) => h2("button", {
        key: `${spec.name}:${index}`,
        type: "button",
        className: `qsub-tab${index === current ? " qsub-tab-on" : ""}`,
        onClick: () => setActive(index)
      }, spec.name))
    ),
    providers.length > 0 && (layout === "tabs" ? h2(ProviderCard, { key: `${providers[current].name}:${current}`, spec: providers[current], index: current, form, connection, onRemove: () => removeProvider(current), onMove: (delta) => moveProvider(current, delta), canUp: current > 0, canDown: current < providers.length - 1, removingName: removing, probeCache }) : providers.map((spec, index) => h2(ProviderCard, { key: `${spec.name}:${index}`, spec, index, form, connection, onRemove: () => removeProvider(index), onMove: (delta) => moveProvider(index, delta), canUp: index > 0, canDown: index < providers.length - 1, removingName: removing, probeCache }))),
    customOpen && h2(CustomBackendModal, { form, onClose: () => setCustomOpen(false) }),
    toast ? h2("div", { className: "qsub-toast", style: toastPos ? { left: toastPos.left, top: toastPos.top, transform: "translate(-50%, 0)" } : void 0 }, toast) : null
  );
}
function QoderToolView({ block, connection }) {
  const settled = block?.kind === "tool-result";
  const resultText = settled ? (block.content ?? []).find?.((item) => item?.type === "text")?.text ?? "" : "";
  const runId = /started subagent ([0-9a-fA-F-]{36})/.exec(resultText)?.[1];
  const [run, setRun] = import_react2.default.useState(null);
  const [open, setOpen] = import_react2.default.useState(false);
  const [, setTick] = import_react2.default.useState(0);
  const bodyRef = import_react2.default.useRef(null);
  const running = Boolean(runId) && (!run || run.status === "running");
  import_react2.default.useEffect(() => {
    if (!runId || !connection) return;
    let alive = true;
    const poll = async () => {
      try {
        const next = await callRpc(connection, "activity", { runId });
        if (alive) setRun(next.run ?? null);
      } catch {
      }
    };
    poll();
    const timer = setInterval(poll, 2e3);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [runId, connection]);
  import_react2.default.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((x) => x + 1), 1e3);
    return () => clearInterval(timer);
  }, [running]);
  import_react2.default.useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, run?.events?.length]);
  if (!settled) return h2("div", { style: { opacity: 0.6, fontSize: 13 } }, "正在启动子代理…");
  if (!runId) return h2("div", { style: { fontSize: 13 } }, resultText || "子代理");
  const status = run?.status ?? "running";
  const seconds = run ? Math.max(0, Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1e3)) : 0;
  const badge = { running: ["运行中", "#b8860b"], completed: ["已完成", "#3f9d5a"], error: ["出错", "#e5533c"], aborted: ["已取消", "#8a8a8a"] }[status] ?? ["…", "#8a8a8a"];
  const allEvents = run?.events ?? [];
  const shown = open ? allEvents : allEvents.slice(-6);
  const kindIcon = { tool: "⚙", text: "▸", think: "◎", result: "✔", error: "✖" };
  const creditsText = run?.credits ? run.credits.total > 0 ? `${run.credits.total.toFixed(4)} 额度` : run.credits.billable === false ? "免费" : "0 额度" : typeof run?.costUsd === "number" ? `$${run.costUsd.toFixed(4)}` : null;
  const idleSeconds = run && running ? Math.max(0, Math.round((Date.now() - (allEvents.at(-1)?.t ?? run.startedAt)) / 1e3)) : 0;
  const stallLimit = run?.stallWarnSeconds ?? 90;
  const stalled = running && stallLimit > 0 && idleSeconds >= stallLimit;
  return h2(
    "div",
    { style: { fontSize: 13, lineHeight: 1.5 } },
    h2(
      "div",
      {
        style: { display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer", userSelect: "none" },
        onClick: () => setOpen((x) => !x),
        title: open ? "收起详情" : "展开全部过程"
      },
      h2("span", { style: { display: "inline-block", transform: `rotate(${open ? 90 : 0}deg)`, transition: "transform .15s" } }, "▸"),
      h2("span", { style: { fontWeight: 600 } }, run?.provider ?? "qoder"),
      h2("span", { style: { color: badge[1] } }, badge[0]),
      h2("span", { style: { opacity: 0.55 } }, `${seconds}s`),
      stalled ? h2("span", { style: { color: "#e5533c" } }, `· 静默 ${idleSeconds}s`) : null,
      creditsText ? h2("span", { style: { opacity: 0.55 } }, `· ${creditsText}`) : null,
      run?.label ? h2("span", { style: { opacity: 0.55 } }, `· ${run.label}`) : null,
      h2("span", { style: { opacity: 0.45, marginLeft: "auto" } }, `${allEvents.length} 步`)
    ),
    shown.length > 0 && h2(
      "div",
      {
        ref: bodyRef,
        style: {
          marginTop: 4,
          paddingLeft: 10,
          borderLeft: "2px solid rgba(128,128,128,0.25)",
          maxHeight: open ? 420 : "none",
          overflowY: open ? "auto" : "hidden"
        }
      },
      shown.map((event, index) => h2("div", {
        key: index,
        style: {
          whiteSpace: open ? "pre-wrap" : "nowrap",
          overflow: open ? "visible" : "hidden",
          textOverflow: open ? void 0 : "ellipsis",
          maxWidth: 620,
          fontFamily: event.kind === "tool" ? "ui-monospace, Consolas, monospace" : void 0,
          opacity: event.kind === "think" ? 0.7 : 0.9
        }
      }, `${kindIcon[event.kind] ?? "·"} ${event.text}`)),
      open && run?.sessionId && RESUME_COMMANDS[run.provider] && h2(
        "div",
        { style: { marginTop: 8, opacity: 0.55, fontSize: 12 } },
        "完整记录已存 CLI 会话: ",
        h2("code", null, RESUME_COMMANDS[run.provider](run.sessionId))
      )
    )
  );
}
function apply(ctx) {
  const form = ctx.configForms.get(ENTRY_ID);
  ctx.effect(() => ctx.locale.register(LOCALE_NS, LOCALES), "qoder-subagent: copy");
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-subagent";
    tag.textContent = STYLE;
    document.head.append(tag);
    return () => tag.remove();
  }, "qoder-subagent: styles");
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "qoder-subagent",
    order: 16,
    locale: LOCALE_NS,
    label: () => "自由子代理",
    inject: () => ({ form, connection: ctx.get("connection") })
  }, QoderSection));
  for (const toolName of BUILTIN_BACKENDS.map((backend) => backend.name)) {
    ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
      name: "tool.call.toolview",
      key: toolName,
      locale: LOCALE_NS,
      inject: () => ({ connection: ctx.get("connection") })
    }, QoderToolView));
  }
  registerPanel(ctx);
}
		})(module, module.exports);
		return module.exports;
	},
});
