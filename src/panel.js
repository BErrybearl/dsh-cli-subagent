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
	showCost: false,
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

/** 本机检测到的子代理后端列表：backends 接口一次拉全，backend 接口逐个开关。 */
function useBackends(connection) {
	const [items, setItems] = React.useState([]);
	const [drivers, setDrivers] = React.useState([]);
	const load = React.useCallback(() => {
		rpc(connection, "backends", {}).then((v) => { setItems(v?.items || []); setDrivers(v?.drivers || []); }).catch(() => {});
	}, [connection]);
	React.useEffect(() => { load(); }, [load]);
	return [items, drivers, load];
}

function fmtDur(ms) {
	const s = Math.max(0, Math.round((ms || 0) / 1000));
	const m = Math.floor(s / 60);
	return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}
const STATUS = { running: ["运行中", "#d9a400"], completed: ["完成", "#3f9d5a"], error: ["出错", "#e5533c"], aborted: ["已取消", "#8a8a8a"] };
function statusOf(run) { return STATUS[run.status] || ["…", "#8a8a8a"]; }
function modelText(run) { return run.native ? "dsh 内置" : (run.model || "CLI 默认"); }
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
function nativeRunsFrom(snap, sessionId, scopeAll) {
	if (!snap) return [];
	// dsh 的会话列表快照:byId 是会话摘要,子代理目录在 projectionsBySession[父会话].values.subagentCatalog。
	const byId = snap.byId ?? snap.list?.byId ?? {};
	const bySession = snap.projectionsBySession ?? snap.list?.projectionsBySession ?? {};
	const parents = scopeAll ? Object.keys(bySession) : sessionId ? [sessionId] : [];
	const seen = new Set();
	const out = [];
	for (const parentId of parents) {
		const catalog = bySession[parentId]?.values?.subagentCatalog ?? byId[parentId]?.projections?.subagentCatalog;
		if (!Array.isArray(catalog)) continue;
		for (const item of catalog) {
			// mode 为 external 的是本插件派出去的外部 CLI,已经在 runs 里,这里跳过。
			if (!item?.id || item.mode === "external" || seen.has(item.id)) continue;
			seen.add(item.id);
			const row = byId[item.id] ?? {};
			const timing = bySession[item.id]?.values?.subagentTiming ?? row.projections?.subagentTiming;
			const active = timing?.active;
			const running = row.running === true || Boolean(active && active.through == null);
			const settled = typeof timing?.settledMs === "number" ? timing.settledMs : 0;
			const startedAt = typeof item.createdAt === "number" ? item.createdAt : 0;
			out.push({
				id: item.id,
				provider: "dsh 内置",
				driver: item.mode || "",
				label: item.label || row.displayTitle || row.projectionValues?.title || row.title || item.id,
				model: null,
				status: running ? "running" : "completed",
				startedAt,
				endedAt: running ? null : (typeof row.updatedAt === "number" ? row.updatedAt : startedAt + settled),
				costUsd: null,
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

/** 展开某张卡片时拉取它的实时事件(只在展开期间轮询)。 */
function useActivity(connection, runId, enabled) {
	const [run, setRun] = React.useState(null);
	React.useEffect(() => {
		if (!enabled || !runId) { setRun(null); return; }
		let alive = true;
		const pull = () => rpc(connection, "activity", { runId })
			.then((v) => { if (alive) setRun(v?.run || null); })
			.catch(() => {});
		pull();
		const timer = setInterval(pull, 2500);
		return () => { alive = false; clearInterval(timer); };
	}, [connection, runId, enabled]);
	return run;
}

function Card({ connection, run, onStop, stopEnabled, showCost, expanded, onToggle }) {
	const [, col] = statusOf(run);
	const running = run.status === "running";
	const cost = typeof run.costUsd === "number" && run.costUsd > 0 ? `$${run.costUsd.toFixed(4)}` : "—";
	const effort = run.effort && run.effort !== "auto" ? run.effort : "—";
	const canStop = running && stopEnabled && !run.native;
	const detail = useActivity(connection, run.id, expanded);
	// 单行卡片,固定列宽:金额和停止位始终占位,缺值时也不让右侧漂移;点击整行就地展开详情。
	return h("div", {
		className: "sap-card" + (run.status === "error" ? " sap-err" : run.status === "completed" ? " sap-done" : "") + (expanded ? " sap-expanded" : ""),
		title: expanded ? "点击收起" : (run.label || run.prompt || "(任务)"),
		onClick: onToggle,
	},
		h("div", { className: "sap-row" + (showCost ? "" : " sap-nocost") },
			h("span", { className: "sap-dot" + (run.stalled ? " sap-stall" : ""), style: { background: run.stalled ? "#d9a400" : col } }),
			h("span", { className: "sap-agent", title: run.provider || "" }, run.provider || "?"),
			h("span", { className: "sap-model", title: modelText(run) }, modelText(run)),
			h("span", { className: "sap-effort", title: run.native ? "dsh 自带的子代理" : `强度 ${effort}` }, run.native ? "内置" : effort),
			h("span", { className: "sap-time" }, running ? fmtDur(Date.now() - (run.startedAt || 0)) : fmtDur((run.endedAt || 0) - (run.startedAt || 0))),
			showCost ? h("span", { className: "sap-cost", title: cost === "—" ? "该 CLI 未上报金额" : "成本按 CLI 上报" }, cost) : null,
			h("span", { className: "sap-act" }, canStop ? h("button", { className: "sap-x", title: "停止该子代理", onClick: (e) => { e.stopPropagation(); onStop(run.id); } }, "停止") : null),
		),
		expanded ? h("div", { className: "sap-detail2" },
			h("div", null, h("b", null, "任务 "), run.label || run.prompt || "—"),
			h("div", null, h("b", null, "最近 "), run.lastEvent ? `${run.lastEvent.kind}: ${run.lastEvent.text}` : "—"),
			(detail?.events || []).slice(-3).map((event, index) => h("div", { key: index, className: "sap-ev2" }, `${event.kind}: ${String(event.text ?? "").slice(0, 160)}`)),
			h("div", null, h("b", null, "会话 "), run.sessionId || "—", " · ", h("b", null, "步骤 "), String(run.eventCount || 0)),
		) : null,
	);
}

/** 输入框正上方的常驻条：默认一行显示统计，有新运行自动展开；可收起/隐藏。 */
function Dock({ connection, sessionId, hooks, onOpenTab }) {
	const [hideAt, setHideAt] = React.useState(readHideAt);
	const [open, setOpen] = React.useState(false);
	const [pinned, setPinned] = React.useState(null);
	const [natives, setNatives] = React.useState([]);
	const snap = useRuns(connection, 2000);
	const [cfg] = useCfg(snap);
	const external = scopedRuns(snap.runs || [], cfg, sessionId);
	const all = cfg.includeNative ? [...external, ...natives] : external;
	// ✕ 隐藏整条 dock:只显示点击之后新开始的运行,旧记录不会把它顶回来。
	const visible = all.filter((run) => (run.startedAt || 0) > hideAt);
	const stats = statsOf(visible);
	const now = Date.now();
	const autoHide = Math.max(0, Number(cfg.autoHideSeconds) || 0);
	const active = visible.filter((run) => run.status === "running");
	const recent = visible.filter((run) => run.status !== "running" && !run.restored && !run.native && autoHide > 0 && (now - (run.endedAt || 0)) < autoHide * 1000);
	const shown = [...active, ...recent].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, Math.max(1, Number(cfg.maxCards) || 20));
	const prevActive = React.useRef(0);
	React.useEffect(() => {
		if (active.length > prevActive.current) setOpen(true);
		prevActive.current = active.length;
	}, [active.length]);
	if (!cfg.dock) return null;
	if (cfg.scope === "session" && !sessionId) return null;
	// 没有可显示的内容就整条不出现,新建会话不再顶一条空的。
	if (shown.length === 0) return null;
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
	if (cfg.showCost && stats.costUsd > 0) summary.push(h("span", { key: "$", className: "sap-mut" }, `· $${stats.costUsd.toFixed(4)}`));
	return h(React.Fragment, null,
		cfg.includeNative ? h(NativeProbe, { hooks, sessionId, scopeAll: cfg.scope === "all", onData: setNatives }) : null,
		h("div", { className: "sap-dock" + (open && shown.length ? "" : " sap-fold") },
			h("div", { className: "sap-head" },
				shown.length ? h("span", { className: "sap-care" + (open ? " sap-open" : ""), onClick: () => setOpen((o) => !o), title: open ? "收起" : "展开" }, "▸") : h("span", { className: "sap-care" }, "·"),
				h("span", { className: "sap-h1", onClick: () => shown.length && setOpen((o) => !o) }, "子代理"),
				...summary,
				h("span", { className: "sap-sp" }),
				h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部"),
				onOpenTab && sessionId ? h("button", { className: "sap-open2", title: "在「子代理」页查看全部", onClick: () => onOpenTab(sessionId) }, "↗") : null,
				h("button", { className: "sap-close", title: "隐藏这一行（新运行会再出现）", onClick: dismiss }, "✕"),
			),
			open && shown.length ? h("div", { className: "sap-cards" }, shown.map((run) => h(Card, {
				key: run.id,
				connection,
				run,
				onStop,
				stopEnabled: cfg.allowStop,
				showCost: cfg.showCost,
				expanded: pinned === run.id,
				onToggle: () => setPinned((id) => (id === run.id ? null : run.id)),
			}))) : null,
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
			cfg.showCost ? h("span", { className: "sap-stat" }, `成本 $${stats.costUsd.toFixed(4)}`) : null,
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

/** 各驱动支持的强度档位(与 host 的 EFFORT_LEVELS 一致)。 */
const EFFORT_CHOICES = {
	"pi-json": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
	"codex-json": ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
};

/** 单个后端的高级参数：默认模型 / 强度 / 并发上限 / 二进制路径。 */
function BackendAdvanced({ connection, item, onSaved }) {
	const [model, setModel] = React.useState(item.model || "");
	const [models, setModels] = React.useState(Array.isArray(item.models) ? item.models : []);
	const [effort, setEffort] = React.useState(item.reasoningEffort || "auto");
	const [limit, setLimit] = React.useState(String(item.maxConcurrency || 2));
	const [binary, setBinary] = React.useState(item.binary || "");
	const [busy, setBusy] = React.useState(false);
	const [msg, setMsg] = React.useState("");
	const levels = EFFORT_CHOICES[item.driver] || [];
	const probe = async () => {
		setBusy(true); setMsg("");
		try {
			const r = await rpc(connection, "probe", { name: item.name });
			const list = Array.isArray(r?.models) ? r.models : [];
			setModels(list);
			setMsg(`检测到 ${list.length} 个模型`);
		} catch (error) {
			setMsg(`检测失败：${String(error?.message ?? error).slice(0, 60)}`);
		} finally { setBusy(false); }
	};
	const save = async () => {
		setBusy(true); setMsg("");
		try {
			await rpc(connection, "backend-config", { name: item.name, patch: { model, models, reasoningEffort: effort, maxConcurrency: Number(limit), binary } });
			setMsg("已保存");
			onSaved?.();
		} catch (error) {
			setMsg(`保存失败：${String(error?.message ?? error).slice(0, 60)}`);
		} finally { setBusy(false); }
	};
	const field = (label, control) => h("label", { className: "sap-field" }, h("span", null, label), control);
	return h("div", { className: "sap-adv" },
		h("div", { className: "sap-advrow" },
			field("默认模型", h("input", { className: "sap-inp", value: model, placeholder: "留空 = CLI 默认", onChange: (e) => setModel(e.target.value) })),
			levels.length ? field("默认强度", h("select", { className: "sap-inp", value: effort, onChange: (e) => setEffort(e.target.value) },
				[["auto", "自动"], ...levels.map((x) => [x, x])].map(([v, l]) => h("option", { key: v, value: v }, l)))) : null,
			field("并发上限", h("input", { className: "sap-inp sap-inp-num", value: limit, onChange: (e) => setLimit(e.target.value) })),
		),
		h("div", { className: "sap-advrow" },
			field("二进制路径", h("input", { className: "sap-inp sap-inp-wide", value: binary, placeholder: "留空 = 自动检测", onChange: (e) => setBinary(e.target.value) })),
			h("button", { className: "sap-bkbtn", onClick: probe, disabled: busy }, "探测模型"),
			h("button", { className: "sap-bkbtn sap-primary", onClick: save, disabled: busy }, "保存"),
			msg ? h("span", { className: "sap-sethint" }, msg) : null,
		),
		models.length ? h("div", { className: "sap-sethint" }, `可选模型（${models.length}）：${models.slice(0, 12).join(" / ")}${models.length > 12 ? " …" : ""}`) : null,
	);
}

/** 「后端」分组：管理本机 CLI 后端——开关、添加、每后端高级参数。 */
function Backends({ connection }) {
	const [items, drivers, load] = useBackends(connection);
	const [openMissing, setOpenMissing] = React.useState(false);
	const [expanded, setExpanded] = React.useState("");
	const [adding, setAdding] = React.useState(false);
	const [form, setForm] = React.useState({ name: "", driver: "", binary: "" });
	const [err, setErr] = React.useState("");
	const installed = items.filter((it) => it.installed);
	const missing = items.filter((it) => !it.installed);
	const off = installed.filter((it) => !it.enabled);
	const toggle = async (it) => {
		setErr("");
		try {
			await rpc(connection, "backend", { name: it.name, enabled: !it.enabled });
			load();
		} catch (error) {
			setErr(`切换「${it.name}」失败（${String(error?.message ?? error).slice(0, 80)}）。`);
		}
	};
	// 一键启用：依次逐个调 backend，避免并发打到 host；全部发完再统一刷新。
	const enableAll = async () => {
		setErr("");
		try {
			for (const it of off) await rpc(connection, "backend", { name: it.name, enabled: true });
			load();
		} catch (error) {
			load();
			setErr(`一键启用中断（${String(error?.message ?? error).slice(0, 80)}），已启用的保持生效。`);
		}
	};
	const add = async () => {
		setErr("");
		const name = form.name.trim();
		if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) { setErr("名称只能用字母、数字、下划线或短横线（1–32 位）"); return; }
		try {
			await rpc(connection, "backend", { name, enabled: true, driver: form.driver || drivers[0] || "qoder-json", binary: form.binary.trim() });
			setAdding(false);
			setForm({ name: "", driver: "", binary: "" });
			load();
		} catch (error) {
			setErr(`添加「${name}」失败（${String(error?.message ?? error).slice(0, 80)}）。`);
		}
	};
	const addForm = adding ? h("div", { className: "sap-addform" },
		h("div", { className: "sap-advrow" },
			h("input", { className: "sap-inp", placeholder: "名称，如 codebuddy2", value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }) }),
			h("select", { className: "sap-inp", value: form.driver || drivers[0] || "", onChange: (e) => setForm({ ...form, driver: e.target.value }) },
				drivers.map((d) => h("option", { key: d, value: d }, d))),
			h("input", { className: "sap-inp sap-inp-wide", placeholder: "CLI 路径（可留空自动检测）", value: form.binary, onChange: (e) => setForm({ ...form, binary: e.target.value }) }),
		),
		h("div", { className: "sap-advrow" },
			h("button", { className: "sap-bkbtn sap-primary", onClick: add }, "添加"),
			h("button", { className: "sap-bkbtn", onClick: () => { setAdding(false); setErr(""); } }, "取消")),
	) : null;
	return h("div", { className: "sap-group sap-backends" },
		h("div", { className: "sap-gtitle" }, "后端"),
		h("div", { className: "sap-sethint" }, "只列这台机器检测到的 CLI；未安装的收在下面，也可以手动添加"),
		installed.map((it) => h(React.Fragment, { key: it.name },
			h("div", { className: "sap-setrow" },
				h("div", { className: "sap-setlab" },
					h("span", { className: "sap-link", onClick: () => setExpanded(expanded === it.name ? "" : it.name) },
						`${expanded === it.name ? "▾" : "▸"} `, h("b", null, it.name)),
					it.guide ? h("div", { className: "sap-sethint" }, it.guide) : null),
				h("div", { className: "sap-setctl" },
					expanded === it.name ? h("span", { className: "sap-sethint" }, "参数见下方") : null,
					h("button", {
						className: "sap-pill" + (it.enabled ? " sap-on" : ""),
						role: "switch", "aria-checked": it.enabled ? "true" : "false",
						onClick: () => toggle(it),
					}, h("span")))),
			expanded === it.name && it.enabled ? h(BackendAdvanced, { connection, item: it, onSaved: load }) : null,
		)),
		off.length ? h("div", { className: "sap-setrow" },
			h("div", { className: "sap-setlab" }),
			h("div", { className: "sap-setctl" },
				h("button", { className: "sap-bkbtn", onClick: enableAll }, "一键启用已检测到的")),
		) : null,
		h("div", { className: "sap-setrow" },
			h("div", { className: "sap-setlab" },
				missing.length ? h("span", { className: "sap-link", onClick: () => setOpenMissing((o) => !o) }, `${openMissing ? "▾" : "▸"} 其他后端（${missing.length}，未安装）`) : h("span", { className: "sap-sethint" }, "其他后端（0，未安装）")),
			h("div", { className: "sap-setctl" },
				h("button", { className: "sap-bkbtn sap-primary", onClick: () => { setAdding((a) => !a); setErr(""); } }, "＋ 添加后端"))),
		openMissing ? missing.map((it) => h("div", { className: "sap-setrow", key: it.name },
			h("div", { className: "sap-setlab" }, h("span", { className: "sap-sethint" }, it.name)),
			h("div", { className: "sap-setctl" },
				it.enabled
					? h("span", { className: "sap-sethint" }, "已启用")
					: h("button", { className: "sap-bkbtn", onClick: () => toggle(it) }, "启用")),
		)) : null,
		addForm,
		err ? h("div", { className: "sap-warn" }, err) : null,
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
		h(Backends, { connection }),
		h("div", { className: "sap-stats" },
			h("span", null, `总计 ${stats.total}`),
			h("span", null, `运行 ${stats.running}`),
			h("span", null, `完成 ${stats.completed}`),
			h("span", null, `出错 ${stats.error}`),
			cfg.showCost ? h("span", null, `成本 $${stats.costUsd.toFixed(4)}`) : null,
		),
		group("入口", [
			row("输入框上方 dock", "有运行或有完成记录时才出现", toggle("dock"), "dock"),
		]),
		group("显示", [
			row("范围", "", seg("scope", [["session", "本会话"], ["all", "全部"]]), "scope"),
			row("卡片上限", "", seg("maxCards", [["10", "10"], ["20", "20"], ["40", "40"]], Number), "maxCards"),
			row("完成卡片收起", "", seg("autoHideSeconds", [["0", "不自动"], ["10", "10s"], ["30", "30s"], ["60", "60s"], ["300", "5m"]], Number), "autoHideSeconds"),
			row("显示成本", "开启后才显示金额；数据来自 CLI 上报", toggle("showCost"), "showCost"),
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
/* dock 卡片：单列、固定列宽（状态点 / 后端 / 模型 / 强度 / 耗时 / 成本 / 操作），缺值也不让右侧漂移 */
.sap-cards { display: flex; flex-direction: column; gap: 4px; padding: 0 8px 7px; max-height: 180px; overflow-y: auto; }
.sap-card { border: 1px solid var(--dsw-alias-border-l2); border-left: 2px solid var(--dsw-alias-brand-primary); border-radius: 7px; padding: 1px 8px; background: var(--dsw-alias-bg-layer-2); }
.sap-card.sap-done { border-left-color: #3f9d5a; }
.sap-card.sap-err { border-left-color: #e5533c; }
.sap-row { display: grid; align-items: center; gap: 6px; height: 24px; grid-template-columns: 8px 56px minmax(0, 1fr) 44px 46px 64px 44px; }
.sap-row.sap-nocost { grid-template-columns: 8px 56px minmax(0, 1fr) 44px 46px 44px; }
.sap-dot { width: 7px; height: 7px; border-radius: 50%; }
.sap-dot.sap-stall { animation: sap-blink 1.2s ease-in-out infinite; }
@keyframes sap-blink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.sap-agent { font-weight: 600; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sap-native { font-size: 9.5px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); }
.sap-model { font-size: 10px; line-height: 16px; padding: 0 6px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; justify-self: start; max-width: 100%; }
.sap-effort { font-size: 10px; line-height: 16px; text-align: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; color: var(--dsw-alias-label-secondary); overflow: hidden; white-space: nowrap; }
.sap-time { text-align: right; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.sap-cost { text-align: right; font-size: 10.5px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.sap-act { display: flex; justify-content: flex-end; }
.sap-x { font-size: 10px; line-height: 16px; padding: 0 7px; border-radius: 5px; border: 1px solid color-mix(in srgb, #e5533c 45%, transparent); color: #e5533c; background: transparent; cursor: pointer; white-space: nowrap; }
.sap-x:hover { background: color-mix(in srgb, #e5533c 10%, transparent); }
/* 卡片就地展开的详情 */
.sap-card { cursor: pointer; }
.sap-card.sap-expanded { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, transparent); }
.sap-detail2 { padding: 2px 4px 6px 14px; display: flex; flex-direction: column; gap: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; overflow-wrap: anywhere; }
.sap-detail2 b { color: var(--dsw-alias-label-primary); font-weight: 600; margin-right: 2px; }
.sap-detail2 .sap-ev2 { font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; opacity: .85; }
.sap-open2 { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 0 3px; cursor: pointer; }
.sap-open2:hover { color: var(--dsw-alias-brand-primary); }
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
/* 「后端」分组：与下方运行面板分组用一条分隔线隔开，折叠标题可点。 */
.sap-backends { border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 10px; margin-bottom: 2px; }
.sap-link { cursor: pointer; color: var(--dsw-alias-label-secondary); }
.sap-link:hover { color: var(--dsw-alias-label-primary); }
.sap-bkbtn { font-size: 11.5px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.sap-bkbtn:hover { background: var(--dsw-alias-bg-overlay); }
.sap-bkbtn.sap-primary { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); color: var(--dsw-alias-brand-primary); }
/* 「运行 / 设置」子页切换 */
.sap-subtabs { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; overflow: hidden; margin: 2px 0 6px; }
.sap-subtab { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 4px 14px; cursor: pointer; }
.sap-subtab-on { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); color: var(--dsw-alias-brand-primary); }
/* 后端高级参数与添加表单 */
.sap-adv { margin: 4px 0 10px; padding: 9px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; }
.sap-addform { margin: 6px 0 10px; padding: 9px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; }
.sap-advrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
.sap-field { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.sap-inp { font-size: 11.5px; padding: 3px 7px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); min-width: 120px; }
.sap-inp-num { min-width: 56px; width: 56px; }
.sap-inp-wide { min-width: 210px; }
.sap-inp:focus { outline: 1px solid var(--dsw-alias-brand-primary); }
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
	// 「↗」用 dsh 自己的会话视图绑定切到本插件的标签页(与我们注册的 id 一致)。
	const openTab = (sessionId) => {
		try {
			ctx.get("uiConversation")?.binding?.(sessionId)?.activate?.("subagent-run-tab");
		} catch {}
	};
	// 输入框卡片正上方的常驻条：这个槽位自带 session 作用域与 props.sessionId。
	ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
		name: "conversation.input.dock",
		id: "subagent-run-dock",
		order: 40,
	}, (props) => h(Dock, {
		connection: connection(),
		sessionId: props?.sessionId ?? props?.session?.id ?? null,
		hooks: props,
		onOpenTab: openTab,
	})));
	ctx.slots.inject("conversation.view", () => ctx.slots.register({
		name: "conversation.view",
		id: "subagent-run-tab",
		order: 40,
		label: () => "子代理",
	}, (props) => h(Tab, { connection: connection(), sessionId: props?.sessionId ?? props?.session?.id ?? null, hooks: props })));
	// 管理界面只放一处:设置侧边栏的「子代理」分区;插件页保留 dsh 自动生成的原始配置表单作兜底。
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "subagent-run-panel",
		order: 17,
		label: () => "子代理",
	}, () => h(Settings, { connection: connection() })));
}
