import React from "react";

/**
 * 子代理运行面板：浮层 dock（shell.overlay）+「子代理」标签页（conversation.view）
 * + 设置分区（settings.section）。数据来自 host 的 qoder-subagent/runs 快照接口。
 * 轻量、只读为主；两个视图共用同一份快照与配置开关。
 */
const h = React.createElement;

const LS = {
	dock: "dsh-subagent.panel.dock",
	tab: "dsh-subagent.panel.tab",
	scope: "dsh-subagent.panel.scope",
	autoHide: "dsh-subagent.panel.autoHide",
	max: "dsh-subagent.panel.max",
	stop: "dsh-subagent.panel.stop",
};
const DEFAULTS = { dock: "1", tab: "1", scope: "session", autoHide: "30", max: "20", stop: "1" };
const EVT = "dsh-subagent:panel-cfg";

function getCfg() {
	const out = {};
	for (const k of Object.keys(LS)) {
		let v = null;
		try { v = window.localStorage.getItem(LS[k]); } catch {}
		out[k] = v == null ? DEFAULTS[k] : v;
	}
	return out;
}
function setCfg(k, v) {
	try { window.localStorage.setItem(LS[k], String(v)); } catch {}
	try { window.dispatchEvent(new CustomEvent(EVT)); } catch {}
}
function useCfg() {
	const [cfg, setState] = React.useState(getCfg);
	React.useEffect(() => {
		const on = () => setState(getCfg());
		window.addEventListener(EVT, on);
		window.addEventListener("storage", on);
		return () => { window.removeEventListener(EVT, on); window.removeEventListener("storage", on); };
	}, []);
	return cfg;
}

function rpc(connection, endpoint, payload, timeout = 20000) {
	return connection.rpc.call("/api", `qoder-subagent/${endpoint}`, payload, AbortSignal.timeout(timeout)).then((result) => {
		if (!result?.ok) throw new Error(result?.error?.message ?? "rpc failed");
		return result.value;
	});
}

function useRuns(connection, parentId, intervalMs) {
	const [snap, setSnap] = React.useState({ runs: [], stats: null, now: Date.now() });
	React.useEffect(() => {
		if (!connection) return;
		let alive = true;
		let timer = null;
		const poll = async () => {
			try {
				const next = await rpc(connection, "runs", { parentId: parentId || undefined, limit: 40 });
				if (alive && next) setSnap(next);
			} catch {}
		};
		poll();
		timer = setInterval(poll, intervalMs || 2000);
		return () => { alive = false; if (timer) clearInterval(timer); };
	}, [connection, parentId, intervalMs]);
	return snap;
}

function fmtDur(ms) {
	const s = Math.max(0, Math.round((ms || 0) / 1000));
	const m = Math.floor(s / 60);
	return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}
const STATUS = { running: ["运行中", "#d9a400"], completed: ["完成", "#3f9d5a"], error: ["出错", "#e5533c"], aborted: ["已取消", "#8a8a8a"] };
function statusOf(run) { return STATUS[run.status] || ["…", "#8a8a8a"]; }
function modelText(run) { return run.model || "CLI 默认"; }
function lastAction(run) {
	const e = run.lastEvent;
	if (!e) return run.status === "running" ? "启动中…" : "";
	const ic = { tool: "⚙", text: "▸", think: "◎", result: "✔", error: "✖", model: "◆" }[e.kind] || "·";
	return `${ic} ${e.text || ""}`;
}

function Card({ run, onStop, stopEnabled }) {
	const [st, col] = statusOf(run);
	const running = run.status === "running";
	const cost = typeof run.costUsd === "number" && run.costUsd > 0 ? `$${run.costUsd.toFixed(4)}` : "";
	return h("div", { className: "sap-card" + (run.status === "error" ? " sap-err" : run.status === "completed" ? " sap-done" : "") },
		h("div", { className: "sap-row" },
			h("span", { className: "sap-dot" + (run.stalled ? " sap-stall" : ""), style: { background: run.stalled ? "#d9a400" : col } }),
			h("span", { className: "sap-agent" }, run.provider || "?"),
			h("span", { className: "sap-model" }, modelText(run)),
			h("span", { className: "sap-time" }, running ? fmtDur(Date.now() - (run.startedAt || 0)) : fmtDur((run.endedAt || 0) - (run.startedAt || 0))),
			running && stopEnabled ? h("button", { className: "sap-x", title: "停止该子代理", onClick: () => onStop(run.id) }, "停止") : null,
		),
		h("div", { className: "sap-sub" },
			h("span", { className: "sap-task" }, run.label || run.prompt || "(任务)"),
			run.stalled ? h("span", { className: "sap-stalltag" }, `静默 ${run.idleSeconds}s`) : null,
			h("span", { className: "sap-act" }, lastAction(run)),
			cost ? h("span", { className: "sap-cost" }, cost) : null,
		),
	);
}

function Dock({ connection, sessionId }) {
	const cfg = useCfg();
	const [, setTick] = React.useState(0);
	const [open, setOpen] = React.useState(true);
	React.useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
	const scopeParent = cfg.scope === "session" ? sessionId || null : null;
	const snap = useRuns(connection, scopeParent, 2000);
	if (cfg.dock === "0") return null;
	const runs = snap.runs || [];
	const stats = snap.stats || {};
	const anyRunning = (stats.running || 0) > 0;
	const autoHide = Number(cfg.autoHide) || 0;
	const lastEnd = runs.reduce((m, r) => Math.max(m, r.endedAt || 0), 0);
	const fresh = lastEnd > 0 && (Date.now() - lastEnd) < autoHide * 1000;
	if (runs.length === 0) return null;
	if (!anyRunning && !fresh) return null;
	const max = Math.max(1, Number(cfg.max) || 20);
	const shown = runs.slice(0, max);
	const onStop = (id) => { rpc(connection, "stop", { runId: id }).catch(() => {}); };
	return h("div", { className: "sap-dock" + (open ? "" : " sap-fold") },
		h("div", { className: "sap-head", onClick: () => setOpen((o) => !o), title: open ? "收起" : "展开" },
			h("span", { className: "sap-care" + (open ? " sap-open" : "") }, "▸"),
			h("span", { className: "sap-h1" }, "子代理"),
			anyRunning ? h("span", { className: "sap-run" }, `${stats.running} 运行中`) : null,
			stats.completed ? h("span", { className: "sap-mut" }, `· ${stats.completed} 完成`) : null,
			stats.error ? h("span", { className: "sap-errt" }, `· ${stats.error} 出错`) : null,
			(typeof stats.costUsd === "number" && stats.costUsd > 0) ? h("span", { className: "sap-mut" }, `· $${stats.costUsd.toFixed(4)}`) : null,
			h("span", { className: "sap-sp" }),
			h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部"),
		),
		open ? h("div", { className: "sap-cards" }, shown.map((run) => h(Card, { key: run.id, run, onStop, stopEnabled: cfg.stop !== "0" }))) : null,
	);
}

function Tab({ connection, sessionId }) {
	const cfg = useCfg();
	const [sel, setSel] = React.useState(null);
	const [, setTick] = React.useState(0);
	React.useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
	const scopeParent = cfg.scope === "session" ? sessionId || null : null;
	const snap = useRuns(connection, scopeParent, 2000);
	if (cfg.tab === "0") return h("div", { className: "sap-empty" }, "运行面板已在「设置 › 自由子代理 › 运行面板」中关闭。");
	const runs = snap.runs || [];
	const stats = snap.stats || {};
	const max = Math.max(1, Number(cfg.max) || 20);
	const onStop = (id) => { rpc(connection, "stop", { runId: id }).catch(() => {}); };
	const selRun = sel ? runs.find((r) => r.id === sel) : null;
	return h("div", { className: "sap-tab" },
		h("div", { className: "sap-tabhead" },
			h("b", null, "子代理"),
			h("span", { className: "sap-stat" }, `运行 ${stats.running || 0}`),
			h("span", { className: "sap-stat" }, `完成 ${stats.completed || 0}`),
			h("span", { className: "sap-stat sap-errt" }, `出错 ${stats.error || 0}`),
			h("span", { className: "sap-stat" }, `成本 $${(stats.costUsd || 0).toFixed(4)}`),
			h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部会话"),
		),
		runs.length === 0
			? h("div", { className: "sap-empty" }, "暂无子代理运行记录。")
			: h("table", { className: "sap-table" },
				h("thead", null, h("tr", null, ["Agent", "模型", "状态", "耗时", "任务", ""].map((x, i) => h("th", { key: i }, x)))),
				h("tbody", null, runs.slice(0, max).map((run) => {
					const [st, col] = statusOf(run);
					const running = run.status === "running";
					return h("tr", { key: run.id, className: "sap-tr", onClick: () => setSel(sel === run.id ? null : run.id) },
						h("td", null, h("b", null, run.provider || "?")),
						h("td", null, h("span", { className: "sap-model" }, modelText(run))),
						h("td", null, h("span", { style: { color: col, fontWeight: 600 } }, st)),
						h("td", null, running ? fmtDur(Date.now() - (run.startedAt || 0)) : fmtDur((run.endedAt || 0) - (run.startedAt || 0))),
						h("td", { className: "sap-celltask" }, run.label || run.prompt || ""),
						h("td", null, running && cfg.stop !== "0" ? h("button", { className: "sap-x", onClick: (e) => { e.stopPropagation(); onStop(run.id); } }, "停止") : null),
					);
				})),
			),
		selRun ? h("div", { className: "sap-detail" },
			h("div", null, h("b", null, "ID "), selRun.id),
			h("div", null, h("b", null, "模型 "), modelText(selRun), " · ", h("b", null, "成本 "), typeof selRun.costUsd === "number" ? `$${selRun.costUsd.toFixed(4)}` : "—", " · ", h("b", null, "步骤 "), `${selRun.eventCount || 0}`),
			h("div", null, h("b", null, "任务 "), selRun.prompt || selRun.label || "—"),
			h("div", null, h("b", null, "最近 "), lastAction(selRun) || "—"),
		) : null,
	);
}

function Settings({ connection }) {
	const cfg = useCfg();
	const snap = useRuns(connection, null, 4000);
	const stats = snap.stats || {};
	const row = (label, hint, control) => h("div", { className: "sap-setrow" },
		h("div", { className: "sap-setlab" }, label, hint ? h("div", { className: "sap-sethint" }, hint) : null),
		h("div", { className: "sap-setctl" }, control));
	const toggle = (k) => h("button", { className: "sap-pill" + (cfg[k] !== "0" ? " sap-on" : ""), onClick: () => setCfg(k, cfg[k] === "0" ? "1" : "0") }, h("span"));
	const sel = (k, opts) => h("select", { className: "sap-sel", value: cfg[k], onChange: (e) => setCfg(k, e.target.value) }, opts.map(([v, t]) => h("option", { key: v, value: v }, t)));
	return h("div", { className: "sap-settings" },
		h("div", { className: "sap-stats" },
			h("span", null, `总计 ${stats.total || 0}`),
			h("span", null, `运行 ${stats.running || 0}`),
			h("span", null, `完成 ${stats.completed || 0}`),
			h("span", null, `出错 ${stats.error || 0}`),
			h("span", null, `成本 $${(stats.costUsd || 0).toFixed(4)}`),
		),
		row("显示浮层 dock", "输入框上方常驻条", toggle("dock")),
		row("显示「子代理」标签页", "详情 / 历史", toggle("tab")),
		row("范围", "", sel("scope", [["session", "本会话"], ["all", "全部会话"]])),
		row("完成卡片自动收起", "0 = 不自动收", sel("autoHide", [["0", "不自动"], ["10", "10 秒"], ["30", "30 秒"], ["60", "60 秒"]])),
		row("卡片上限", "", sel("max", [["10", "10"], ["20", "20"], ["40", "40"]])),
		row("[停止] 按钮（kill 进程）", "", toggle("stop")),
		h("div", { className: "sap-note" }, "数据来自插件 runs 账本；模型取自 CLI 事件，取不到时显示「CLI 默认」。「强制所有调用走插件路径」为待开发项，暂未启用。"),
	);
}

const PANEL_STYLE = `
.sap-dock { margin: 6px 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; font-size: 12px; }
.sap-head { display: flex; align-items: center; gap: 6px; padding: 5px 9px; cursor: pointer; user-select: none; }
.sap-care { display: inline-block; transition: transform .15s; color: var(--dsw-alias-brand-primary); }
.sap-care.sap-open { transform: rotate(90deg); }
.sap-h1 { font-weight: 600; }
.sap-run { color: var(--dsw-alias-brand-primary); font-weight: 600; }
.sap-mut { color: var(--dsw-alias-label-secondary); }
.sap-errt { color: #e5533c; }
.sap-sp { flex: 1; }
.sap-scope { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sap-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; padding: 0 8px 8px; }
.sap-card { border: 1px solid var(--dsw-alias-border-l2); border-top: 2px solid var(--dsw-alias-brand-primary); border-radius: 8px; padding: 5px 8px; min-width: 0; background: var(--dsw-alias-bg-layer-2); }
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
.sap-sub { display: flex; align-items: baseline; gap: 6px; margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; overflow: hidden; }
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
`;

export function registerPanel(ctx) {
	ctx.effect(() => {
		const tag = document.createElement("style");
		tag.dataset.pluginPanel = "dsh-subagent-panel";
		tag.textContent = PANEL_STYLE;
		document.head.append(tag);
		return () => tag.remove();
	}, "dsh-subagent: panel styles");
	const connection = () => ctx.get("connection");
	ctx.slots.inject("shell.overlay", () => ctx.slots.register({
		name: "shell.overlay",
		id: "subagent-run-dock",
		order: 40,
	}, (props) => h(Dock, { connection: connection(), sessionId: props?.session?.id ?? props?.sessionId ?? null })));
	ctx.slots.inject("conversation.view", () => ctx.slots.register({
		name: "conversation.view",
		id: "subagent-run-tab",
		order: 40,
		label: () => "子代理",
	}, (props) => h(Tab, { connection: connection(), sessionId: props?.session?.id ?? props?.sessionId ?? null })));
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "subagent-run-panel",
		order: 17,
		label: () => "运行面板",
	}, () => h(Settings, { connection: connection() })));
}
