import React from "react";

/**
 * 子代理运行面板：输入框上方 dock（conversation.input.dock）+「子代理」标签页
 * （conversation.view）+「自由子代理」插件页里的运行面板分组（plugins.bundle.config）。
 * 数据来自 host 的 qoder-subagent/runs 快照；开关存在插件 config 的 panel 节点
 * （cordis.patch.yml 可见），设置界面写回配置并即时生效，写不进去时退回本地覆盖。
 */
const h = React.createElement;

const DEFAULTS = {
	dock: true,
	tab: true,
	scope: "session",
	autoHideSeconds: 30,
	maxCards: 20,
	allowStop: true,
	includeNative: false,
	hideWhenIdle: false,
};
const HIDE_KEY = "dsh-subagent.panel.hideAt";
const OVERRIDE_KEY = "dsh-subagent.panel.override";
const EVT = "dsh-subagent:panel-cfg";

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
	try { window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next)); } catch {}
	if (typeof window !== "undefined") {
		try { window.dispatchEvent(new CustomEvent(EVT)); } catch {}
	}
}
function readHideAt() {
	try { return Number(window.localStorage.getItem(HIDE_KEY)) || 0; } catch { return 0; }
}

function rpc(connection, endpoint, payload, timeout = 20000) {
	return connection.rpc.call("/api", `qoder-subagent/${endpoint}`, payload, AbortSignal.timeout(timeout)).then((result) => {
		if (!result?.ok) throw new Error(result?.error?.message ?? "rpc failed");
		return result.value;
	});
}

function useRuns(connection, intervalMs) {
	const [snap, setSnap] = React.useState({ runs: [], stats: null, cfg: null, now: Date.now() });
	React.useEffect(() => {
		if (!connection) return;
		let alive = true;
		let timer = null;
		const poll = async () => {
			try {
				const next = await rpc(connection, "runs", { limit: 40 });
				if (alive && next) setSnap(next);
			} catch {}
		};
		poll();
		timer = setInterval(poll, intervalMs || 2000);
		return () => { alive = false; if (timer) clearInterval(timer); };
	}, [connection, intervalMs]);
	return snap;
}

/** 生效配置：插件 config → 本地覆盖（写回失败时才有）。 */
function useCfg(snap) {
	const [overrides, setOverrides] = React.useState(readOverrides);
	React.useEffect(() => {
		const on = () => setOverrides(readOverrides());
		window.addEventListener(EVT, on);
		return () => window.removeEventListener(EVT, on);
	}, []);
	return [{ ...DEFAULTS, ...((snap && snap.cfg) || {}), ...overrides }, overrides];
}

function fmtDur(ms) {
	const s = Math.max(0, Math.round((ms || 0) / 1000));
	const m = Math.floor(s / 60);
	return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}
const STATUS = { running: ["运行中", "#d9a400"], completed: ["完成", "#3f9d5a"], error: ["出错", "#e5533c"], aborted: ["已取消", "#8a8a8a"] };
function statusOf(run) { return STATUS[run.status] || ["…", "#8a8a8a"]; }
function modelText(run) { return run.model || "CLI 默认"; }
function statsOf(runs) {
	const out = { total: runs.length, running: 0, completed: 0, error: 0, aborted: 0, costUsd: 0 };
	for (const run of runs) {
		if (run.status === "running") out.running += 1;
		else if (run.status === "completed") out.completed += 1;
		else if (run.status === "error") out.error += 1;
		else if (run.status === "aborted") out.aborted += 1;
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

/**
 * dsh 自带的子代理（subagent / subagent_fork / teammate）不经过本插件，
 * 但客户端本来就有它们的会话投影：父会话 `subagentCatalog`（id/createdAt/mode/label）
 * 加每个子会话的 `subagent` / `subagentTiming` 投影。这里映射成同一份 run 形状，只读。
 * 投影属 dsh 内部结构，故由 `includeNative` 开关控制、默认关闭。
 */
function sessionMap(snap) {
	if (!snap) return {};
	if (snap.byId && typeof snap.byId === "object") return snap.byId;
	if (snap.list?.byId && typeof snap.list.byId === "object") return snap.list.byId;
	return {};
}
function nativeRunsFrom(snap, sessionId, scopeAll) {
	const byId = sessionMap(snap);
	const parents = scopeAll ? Object.keys(byId) : sessionId ? [sessionId] : [];
	const seen = new Set();
	const out = [];
	for (const parentId of parents) {
		const catalog = byId[parentId]?.projections?.subagentCatalog;
		if (!Array.isArray(catalog)) continue;
		for (const item of catalog) {
			if (!item?.id || seen.has(item.id)) continue;
			seen.add(item.id);
			const row = byId[item.id] || {};
			const projections = row.projections || {};
			const timing = projections.subagentTiming;
			const active = timing?.active;
			const running = row.running === true || Boolean(active && active.through == null);
			const settled = typeof timing?.settledMs === "number" ? timing.settledMs : 0;
			const startedAt = typeof item.createdAt === "number" ? item.createdAt : 0;
			const identity = projections.subagent;
			const cost = typeof projections.contextTimeline?.cost === "number" ? projections.contextTimeline.cost : null;
			out.push({
				id: item.id,
				provider: "dsh 内置",
				driver: item.mode || identity?.mode || "",
				label: item.label || identity?.label || row.displayTitle || row.title || item.id,
				model: typeof projections.contextTimeline?.model === "string" ? projections.contextTimeline.model : null,
				status: running ? "running" : "completed",
				startedAt,
				endedAt: running ? null : (typeof row.updatedAt === "number" ? row.updatedAt : startedAt + settled),
				costUsd: cost,
				native: true,
				stalled: false,
				idleSeconds: active && typeof active.through === "number" ? Math.max(0, Math.round((Date.now() - active.through) / 1000)) : 0,
				parentId,
			});
		}
	}
	return out;
}

/** 只在打开 includeNative 时挂载：读会话投影并把结果交回上层，默认路径完全不受影响。 */
function NativeProbe({ hooks, sessionId, scopeAll, onData }) {
	const useSessions = hooks?.useSessions;
	const snap = typeof useSessions === "function" ? useSessions((value) => value) : null;
	const list = React.useMemo(() => nativeRunsFrom(snap, sessionId, scopeAll), [snap, sessionId, scopeAll]);
	React.useEffect(() => { onData(list); }, [list, onData]);
	return null;
}

function Card({ run, onStop, stopEnabled }) {
	const [, col] = statusOf(run);
	const running = run.status === "running";
	const cost = typeof run.costUsd === "number" && run.costUsd > 0 ? `$${run.costUsd.toFixed(4)}` : "";
	return h("div", { className: "sap-card" + (run.status === "error" ? " sap-err" : run.status === "completed" ? " sap-done" : "") },
		h("div", { className: "sap-row" },
			h("span", { className: "sap-dot" + (run.stalled ? " sap-stall" : ""), style: { background: run.stalled ? "#d9a400" : col } }),
			h("span", { className: "sap-agent" }, run.provider || "?"),
			run.native ? h("span", { className: "sap-native", title: "dsh 自带的子代理，只读" }, "内置") : null,
			h("span", { className: "sap-model" }, modelText(run)),
			h("span", { className: "sap-time" }, running ? fmtDur(Date.now() - (run.startedAt || 0)) : fmtDur((run.endedAt || 0) - (run.startedAt || 0))),
			running && stopEnabled && !run.native ? h("button", { className: "sap-x", title: "停止该子代理", onClick: () => onStop(run.id) }, "停止") : null,
		),
		h("div", { className: "sap-sub" },
			h("span", { className: "sap-task" }, run.label || run.prompt || "(任务)"),
			run.stalled ? h("span", { className: "sap-stalltag" }, `静默 ${run.idleSeconds}s`) : null,
			h("span", { className: "sap-act" }, lastAction(run)),
			cost ? h("span", { className: "sap-cost" }, cost) : null,
		),
	);
}

/** 输入框正上方的常驻条：默认一行显示统计，有新运行自动展开；可收起/隐藏。 */
function Dock({ connection, sessionId, hooks }) {
	const [hideAt, setHideAt] = React.useState(readHideAt);
	const [open, setOpen] = React.useState(false);
	const [natives, setNatives] = React.useState([]);
	const snap = useRuns(connection, 2000);
	const [cfg] = useCfg(snap);
	const external = scopedRuns(snap.runs || [], cfg, sessionId);
	const all = cfg.includeNative ? [...external, ...natives] : external;
	const stats = statsOf(all);
	const now = Date.now();
	const autoHide = Math.max(0, Number(cfg.autoHideSeconds) || 0);
	const active = all.filter((run) => run.status === "running");
	const recent = all.filter((run) => run.status !== "running" && !run.restored && !run.native && (run.endedAt || 0) > hideAt && autoHide > 0 && (now - (run.endedAt || 0)) < autoHide * 1000);
	const shown = [...active, ...recent].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, Math.max(1, Number(cfg.maxCards) || 20));
	const prevActive = React.useRef(0);
	React.useEffect(() => {
		if (active.length > prevActive.current) setOpen(true);
		prevActive.current = active.length;
	}, [active.length]);
	if (!cfg.dock) return null;
	if (cfg.scope === "session" && !sessionId) return null;
	if (cfg.hideWhenIdle && shown.length === 0) return null;
	const onStop = (id) => { rpc(connection, "stop", { runId: id }).catch(() => {}); };
	const dismiss = () => {
		const at = Date.now();
		setHideAt(at);
		setOpen(false);
		try { window.localStorage.setItem(HIDE_KEY, String(at)); } catch {}
	};
	const summary = [];
	if (stats.running > 0) summary.push(h("span", { key: "r", className: "sap-run" }, `${stats.running} 运行中`));
	else summary.push(h("span", { key: "i", className: "sap-mut" }, "空闲"));
	if (stats.completed) summary.push(h("span", { key: "c", className: "sap-mut" }, `· ${stats.completed} 完成`));
	if (stats.error) summary.push(h("span", { key: "e", className: "sap-errt" }, `· ${stats.error} 出错`));
	if (stats.costUsd > 0) summary.push(h("span", { key: "$", className: "sap-mut" }, `· $${stats.costUsd.toFixed(4)}`));
	return h(React.Fragment, null,
		cfg.includeNative ? h(NativeProbe, { hooks, sessionId, scopeAll: cfg.scope === "all", onData: setNatives }) : null,
		h("div", { className: "sap-dock" + (open && shown.length ? "" : " sap-fold") },
			h("div", { className: "sap-head" },
				shown.length ? h("span", { className: "sap-care" + (open ? " sap-open" : ""), onClick: () => setOpen((o) => !o), title: open ? "收起" : "展开" }, "▸") : h("span", { className: "sap-care" }, "·"),
				h("span", { className: "sap-h1", onClick: () => shown.length && setOpen((o) => !o) }, "子代理"),
				...summary,
				h("span", { className: "sap-sp" }),
				h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部"),
				h("button", { className: "sap-close", title: "隐藏这一行（新运行会再出现）", onClick: dismiss }, "✕"),
			),
			open && shown.length ? h("div", { className: "sap-cards" }, shown.map((run) => h(Card, { key: run.id, run, onStop, stopEnabled: cfg.allowStop }))) : null,
		),
	);
}

function Tab({ connection, sessionId, hooks }) {
	const [sel, setSel] = React.useState(null);
	const [natives, setNatives] = React.useState([]);
	const [, setTick] = React.useState(0);
	React.useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
	const snap = useRuns(connection, 2000);
	const [cfg] = useCfg(snap);
	if (!cfg.tab) return h("div", { className: "sap-empty" }, "运行面板已在「设置 › 插件 › 自由子代理 › 运行面板」中关闭。");
	const external = scopedRuns(snap.runs || [], cfg, sessionId);
	const runs = (cfg.includeNative ? [...external, ...natives] : external).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
	const stats = statsOf(runs);
	const max = Math.max(1, Number(cfg.maxCards) || 20);
	const onStop = (id) => { rpc(connection, "stop", { runId: id }).catch(() => {}); };
	const selRun = sel ? runs.find((r) => r.id === sel) : null;
	return h("div", { className: "sap-tab" },
		cfg.includeNative ? h(NativeProbe, { hooks, sessionId, scopeAll: cfg.scope === "all", onData: setNatives }) : null,
		h("div", { className: "sap-tabhead" },
			h("b", null, "子代理"),
			h("span", { className: "sap-stat" }, `总计 ${stats.total}`),
			h("span", { className: "sap-stat" }, `运行 ${stats.running}`),
			h("span", { className: "sap-stat" }, `完成 ${stats.completed}`),
			h("span", { className: "sap-stat sap-errt" }, `出错 ${stats.error}`),
			h("span", { className: "sap-stat" }, `成本 $${stats.costUsd.toFixed(4)}`),
			h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部会话"),
		),
		runs.length === 0
			? h("div", { className: "sap-empty" }, cfg.scope === "session" && !sessionId ? "等待会话加载…" : "暂无子代理运行记录。")
			: h("table", { className: "sap-table" },
				h("thead", null, h("tr", null, ["Agent", "模型", "状态", "耗时", "任务", ""].map((x, i) => h("th", { key: i }, x)))),
				h("tbody", null, runs.slice(0, max).map((run) => {
					const [st, col] = statusOf(run);
					const running = run.status === "running";
					return h("tr", { key: run.id, className: "sap-tr", onClick: () => setSel(sel === run.id ? null : run.id) },
						h("td", null, h("b", null, run.provider || "?"), run.native ? h("span", { className: "sap-native", title: "dsh 自带的子代理，只读" }, "内置") : null),
						h("td", null, h("span", { className: "sap-model" }, modelText(run))),
						h("td", null, h("span", { style: { color: col, fontWeight: 600 } }, st)),
						h("td", null, running ? fmtDur(Date.now() - (run.startedAt || 0)) : fmtDur((run.endedAt || 0) - (run.startedAt || 0))),
						h("td", { className: "sap-celltask" }, run.label || run.prompt || ""),
						h("td", null, running && cfg.allowStop && !run.native ? h("button", { className: "sap-x", onClick: (e) => { e.stopPropagation(); onStop(run.id); } }, "停止") : null),
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

/** 「自由子代理」插件页里的运行面板分组：入口 / 显示 / 操作 / 数据 + 统计 + 恢复默认。 */
function Settings({ connection }) {
	const snap = useRuns(connection, 4000);
	const [cfg, overrides] = useCfg(snap);
	const [note, setNote] = React.useState("");
	const runs = snap.runs || [];
	const stats = statsOf(runs);
	const persist = async (patch) => {
		try {
			await rpc(connection, "panel", patch);
			const next = { ...overrides };
			for (const key of Object.keys(patch)) if (key !== "reset") delete next[key];
			writeOverrides(next);
			setNote("");
		} catch (error) {
			const next = { ...overrides };
			for (const [key, value] of Object.entries(patch)) if (key !== "reset") next[key] = value;
			writeOverrides(next);
			setNote(`写回配置失败（${String(error?.message ?? error).slice(0, 80)}），已改为本地生效。`);
		}
	};
	const dirty = Object.keys(overrides).filter((key) => key in DEFAULTS);
	const row = (label, hint, control, key) => h("div", { className: "sap-setrow" },
		h("div", { className: "sap-setlab" }, label, hint ? h("div", { className: "sap-sethint" }, hint) : null),
		h("div", { className: "sap-setctl" }, control),
		dirty.includes(key) ? h("span", { className: "sap-over", title: "写回配置失败，当前值只在本机生效" }) : null);
	const group = (title, children) => h("div", { className: "sap-group" },
		h("div", { className: "sap-gtitle" }, title), children);
	const toggle = (key) => h("button", {
		className: "sap-pill" + (cfg[key] ? " sap-on" : ""),
		role: "switch", "aria-checked": cfg[key] ? "true" : "false",
		onClick: () => persist({ [key]: !cfg[key] }),
	}, h("span"));
	const seg = (key, options, cast) => h("div", { className: "sap-seg" }, options.map(([value, label]) =>
		h("button", {
			key: value,
			className: "sap-segbtn" + (String(cfg[key]) === value ? " sap-seg-on" : ""),
			onClick: () => persist({ [key]: cast ? cast(value) : value }),
		}, label)));
	return h("div", { className: "sap-settings" },
		h("div", { className: "sap-stats" },
			h("span", null, `总计 ${stats.total}`),
			h("span", null, `运行 ${stats.running}`),
			h("span", null, `完成 ${stats.completed}`),
			h("span", null, `出错 ${stats.error}`),
			h("span", null, `成本 $${stats.costUsd.toFixed(4)}`),
		),
		group("入口", [
			row("输入框上方 dock", "常驻一行显示统计", toggle("dock"), "dock"),
			row("「子代理」标签页", "表格详情 / 历史", toggle("tab"), "tab"),
			row("空闲时隐藏", "关 = 一直显示这一行", toggle("hideWhenIdle"), "hideWhenIdle"),
		]),
		group("显示", [
			row("范围", "", seg("scope", [["session", "本会话"], ["all", "全部"]]), "scope"),
			row("卡片上限", "", seg("maxCards", [["10", "10"], ["20", "20"], ["40", "40"]], Number), "maxCards"),
			row("完成卡片收起", "", seg("autoHideSeconds", [["0", "不自动"], ["10", "10s"], ["30", "30s"], ["60", "60s"], ["300", "5m"]], Number), "autoHideSeconds"),
		]),
		group("操作", [
			row("停止按钮（kill 进程）", "", toggle("allowStop"), "allowStop"),
		]),
		group("数据", [
			row("并入 dsh 内置子代理", "只读、带「内置」标", toggle("includeNative"), "includeNative"),
		]),
		note ? h("div", { className: "sap-warn" }, note) : null,
		h("div", { className: "sap-foot" },
			h("span", { className: "sap-note" }, "改完立即生效，并写回本插件配置的 panel 节点（cordis.patch.yml）。"),
			h("button", { className: "sap-reset", onClick: () => persist({ reset: true }) }, "恢复默认"),
		),
	);
}

const PANEL_STYLE = `
.sap-dock { margin: 4px 0 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; font-size: 12px; }
.sap-head { display: flex; align-items: center; gap: 6px; padding: 4px 9px; user-select: none; }
.sap-care { display: inline-block; transition: transform .15s; color: var(--dsw-alias-brand-primary); cursor: pointer; width: 10px; }
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
.sap-native { font-size: 9.5px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); }
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
.sap-settings { border-top: 1px solid var(--dsw-alias-border-l2); margin-top: 6px; padding-top: 4px; }
.sap-stats { display: flex; gap: 14px; flex-wrap: wrap; padding: 8px 0 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.sap-group { padding: 2px 0 6px; }
.sap-gtitle { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); padding: 8px 0 2px; }
.sap-setrow { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.sap-group .sap-setrow:last-child { border-bottom: 0; }
.sap-setlab { color: var(--dsw-alias-label-primary); font-size: 13px; }
.sap-sethint { color: var(--dsw-alias-label-secondary); font-size: 11px; margin-top: 1px; }
.sap-setctl { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.sap-over { width: 6px; height: 6px; border-radius: 50%; background: #d9a400; }
.sap-pill { width: 38px; height: 21px; border-radius: 999px; border: none; background: var(--dsw-alias-border-l3); position: relative; cursor: pointer; padding: 0; transition: background .15s; }
.sap-pill.sap-on { background: #3f9d5a; }
.sap-pill span { position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #fff; transition: left .15s; }
.sap-pill.sap-on span { left: 19px; }
.sap-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; overflow: hidden; }
.sap-segbtn { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11.5px; padding: 3px 9px; cursor: pointer; }
.sap-segbtn + .sap-segbtn { border-left: 1px solid var(--dsw-alias-border-l2); }
.sap-segbtn.sap-seg-on { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); color: var(--dsw-alias-brand-primary); font-weight: 600; }
.sap-foot { display: flex; align-items: center; gap: 10px; padding: 10px 0 4px; }
.sap-reset { margin-left: auto; font-size: 11.5px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.sap-reset:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-overlay); }
.sap-note { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sap-warn { color: #d9a400; font-size: 11px; padding: 6px 0; }
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
	// 输入框卡片正上方的常驻条：这个槽位自带 session 作用域与 props.sessionId。
	ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
		name: "conversation.input.dock",
		id: "subagent-run-dock",
		order: 40,
	}, (props) => h(Dock, { connection: connection(), sessionId: props?.sessionId ?? props?.session?.id ?? null, hooks: props })));
	ctx.slots.inject("conversation.view", () => ctx.slots.register({
		name: "conversation.view",
		id: "subagent-run-tab",
		order: 40,
		label: () => "子代理",
	}, (props) => h(Tab, { connection: connection(), sessionId: props?.sessionId ?? props?.session?.id ?? null, hooks: props })));
	// 并进「自由子代理」插件页，作为后端配置下方的一组，而不是独立的设置分区。
	ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
		name: "plugins.bundle.config",
		key: "dsh-subagent",
	}, () => h(Settings, { connection: connection() })));
}
