import React from "react";

/**
 * 子代理运行面板：输入框上方 dock（conversation.input.dock）+「子代理」标签页
 * （conversation.view）+ 设置侧边栏「子代理」分区（settings.section，唯一管理入口）。
 * 数据来自 host 的 dsh-cli-hub/runs 快照；开关存在插件 config 的 panel 节点
 * （cordis.patch.yml 可见），设置界面写回配置并即时生效，写不进去时退回本地覆盖。
 */
const h = React.createElement;

const DEFAULTS = {
	dock: true,
	showTab: false,
	scope: "session",
	autoHideSeconds: 30,
	maxCards: 20,
	allowStop: true,
	includeNative: false,
	hideWhenIdle: false,
	showCost: false,
	includeExternal: false,
	externalMatch: "pi-run.ps1",
};
const HIDE_KEY = "dsh-cli-hub.panel.hideAt";
const OVERRIDE_KEY = "dsh-cli-hub.panel.override";
const EVT = "dsh-cli-hub:panel-cfg";

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
	return connection.rpc.call("/api", `dsh-cli-hub/${endpoint}`, payload, AbortSignal.timeout(timeout)).then((result) => {
		if (!result?.ok) throw new Error(result?.error?.message ?? "rpc failed");
		return result.value;
	});
}

/** 轮询节奏：有运行中 2s，全空闲 6s，页面不可见 12s（后台不跟着刷新）。 */
const POLL_ACTIVE = 2000;
const POLL_IDLE = 6000;
const POLL_HIDDEN = 12000;
/** 中断成功后本地乐观标记的有效期：超时还报运行中就撤销，界面如实回到「运行中」。 */
const INTERRUPT_GRACE_MS = 10000;

/**
 * panel/runs 的共享 store：dock、标签页、设置页订阅同一份快照，
 * 全插件只有一个计时器；订阅者归零就停表。
 */
function createRunsStore() {
	let snapshot = { runs: [], natives: [], stats: null, cfg: null, now: Date.now() };
	const subs = new Set();
	let timer = null;
	// 每次 stop / 重排都 +1；在飞的 loop 拿旧值对不上就不再排下一次，计时器不会复活或翻倍。
	let epoch = 0;
	let pulling = false;
	let getConnection = () => null;
	// 中断成功的本地标记：投影/中断回执有延迟，靠这里先按已结束显示。
	const interrupted = new Map();

	const emit = () => {
		for (const cb of subs) {
			try { cb(snapshot); } catch {}
		}
	};
	const allRows = () => [...(snapshot.runs || []), ...(snapshot.natives || [])];
	const busy = () => allRows().some((run) => run.status === "running" || run.activity === "running");
	const hidden = () => typeof document !== "undefined" && document.visibilityState !== "visible";
	const delay = () => (hidden() ? POLL_HIDDEN : busy() ? POLL_ACTIVE : POLL_IDLE);
	const pull = async () => {
		const connection = getConnection();
		if (!connection || pulling) return;
		pulling = true;
		try {
			const next = await rpc(connection, "runs", { limit: 40 });
			if (next) {
				snapshot = next;
				const now = Date.now();
				// host 已经报结束的行，撤掉本地乐观标记；一直报运行中的超时也撤掉，别把界面锁在「已取消」。
				for (const run of allRows()) if (run.status !== "running" && run.activity !== "running") interrupted.delete(run.id);
				for (const [id, at] of interrupted) if (now - at > INTERRUPT_GRACE_MS) interrupted.delete(id);
				emit();
			}
		} catch {
			// 拉取失败保留上一份快照，界面不闪空。
		} finally {
			pulling = false;
		}
	};
	/** 排下一次拉取：始终先撤掉已有计时器，保证同一时刻只有一个。 */
	const schedule = (ms) => {
		if (timer) clearTimeout(timer);
		epoch += 1;
		const gen = epoch;
		timer = setTimeout(() => {
			timer = null;
			loop(gen);
		}, ms);
	};
	const loop = async (gen) => {
		await pull();
		// 订阅者已归零，或期间被 stop / reschedule 作废：到此为止，不再排计时器。
		if (subs.size === 0 || gen !== epoch) return;
		schedule(delay());
	};
	// 可见性变化或节奏变化时重排下一次拉取(立即拉一次)。
	const reschedule = () => {
		if (subs.size === 0) return;
		schedule(0);
	};
	const stop = () => {
		epoch += 1;
		if (timer) clearTimeout(timer);
		timer = null;
		if (typeof document !== "undefined") document.removeEventListener("visibilitychange", reschedule);
	};
	const subscribe = (cb) => {
		subs.add(cb);
		if (subs.size === 1) {
			if (typeof document !== "undefined") document.addEventListener("visibilitychange", reschedule);
			schedule(0);
		}
		// 新订阅者先拿到手上的快照，不必等下一轮。
		cb(snapshot);
		return () => {
			if (!subs.delete(cb)) return;
			if (subs.size === 0) stop();
		};
	};
	/** 中断成功后记一个乐观标记并换快照引用触发重渲染；行的显示由 applyInterrupt 叠加。 */
	const markInterrupted = (id) => {
		const at = Date.now();
		interrupted.set(id, at);
		snapshot = { ...snapshot, now: at };
		emit();
	};
	return {
		configure: (getter) => { getConnection = getter; },
		get: () => snapshot,
		interruptedAt: (id) => interrupted.get(id) ?? null,
		subscribe,
		markInterrupted,
	};
}

/** 全插件唯一的 runs 数据源；组件里不要再建第二个。 */
const runsStore = createRunsStore();

/** 订阅共享快照，卸载即退订（只改局部 state，适配 React 18 并发渲染）。 */
function useRuns() {
	const [snap, setSnap] = React.useState(() => runsStore.get());
	React.useEffect(() => runsStore.subscribe(setSnap), []);
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
function modelText(run) { return run.native ? (run.name || "dsh 内置") : (run.model || (run.external ? "pi 默认" : "CLI 默认")); }
/** 内置行的活动状态：host 给了 activity 就用，缺失时按 status 推断，界面不出现 undefined。 */
function activityOf(run) {
	if (!run?.native) return "";
	if (run.activity === "running" || run.activity === "inactive") return run.activity;
	return run.status === "running" ? "running" : "inactive";
}
/** 状态点/状态字颜色：内置行运行中沿用运行色，已结束时出错仍标红，其余灰。 */
function dotColor(run) {
	const activity = activityOf(run);
	if (activity === "running") return STATUS.running[1];
	if (activity === "inactive") return run.status === "error" ? STATUS.error[1] : "#8a8a8a";
	return statusOf(run)[1];
}
/** 耗时列：内置行优先用 host 的 elapsedMs，缺值显示占位而不是 undefined。 */
function elapsedText(run) {
	if (run.native) {
		if (typeof run.elapsedMs === "number" && Number.isFinite(run.elapsedMs)) return fmtDur(run.elapsedMs);
		if (activityOf(run) === "running") return fmtDur(Date.now() - (run.startedAt || 0));
		return "—";
	}
	return run.status === "running" ? fmtDur(Date.now() - (run.startedAt || 0)) : fmtDur((run.endedAt || 0) - (run.startedAt || 0));
}
/** 该行是不是在跑；内置行还要看 activity，host 的 status 可能滞后。 */
function runningRow(run) {
	return Boolean(run) && (run.status === "running" || activityOf(run) === "running");
}
/**
 * 内置行能不能给「中断」：在跑，且 host 没明说回合已收盘。
 * turnRunning=false 是「会话还活着但回合已结束」，这种行不给按钮，避免对已结束的行一直显示中断。
 */
function interruptible(run) {
	return Boolean(run?.native) && activityOf(run) === "running" && run.turnRunning !== false;
}
/**
 * 内置子代理行：host 的 runs.natives 优先（name/activity/elapsedMs 更全，id 与中断接口同一套），
 * 客户端投影算出来的 nativeRunsFrom 只在 host 那一份为空时兜底，两份不并列显示。
 */
function nativeRows(snap, projected, scope, sessionId) {
	const rows = Array.isArray(snap?.natives) && snap.natives.length ? snap.natives : (projected || []);
	if (scope === "all") return rows;
	if (!sessionId) return [];
	return rows.filter((run) => run.parentId === sessionId);
}
/** 内置行可能同时来自 host 快照和客户端投影，按 id 去重，host 那份优先。 */
function withNative(external, natives) {
	if (!natives || natives.length === 0) return external;
	const seen = new Set(external.map((run) => run.id));
	return [...external, ...natives.filter((run) => !seen.has(run.id))];
}
/** 中断成功后投影还没跟上的短暂窗口里，界面先按已结束显示该行；超过宽限期就如实回到运行中。 */
function applyInterrupt(run) {
	const at = runsStore.interruptedAt(run.id);
	if (!at || Date.now() - at > INTERRUPT_GRACE_MS) return run;
	if (!runningRow(run)) return run;
	return {
		...run,
		status: "aborted",
		activity: "inactive",
		endedAt: at,
		elapsedMs: typeof run.elapsedMs === "number" ? run.elapsedMs : run.startedAt ? Math.max(0, at - run.startedAt) : null,
	};
}
/** 中断 dsh 内置子代理；host 用值的 ok 字段表示是否真的停了，拿不到明确 ok 也算失败。 */
function interruptNative(connection, sessionId) {
	return rpc(connection, "native-interrupt", { sessionId }).then((value) => {
		if (!value || value.ok === false) throw new Error(value?.error || "中断失败");
		runsStore.markInterrupted(sessionId);
		return value;
	});
}
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
			const settled = typeof timing?.settledMs === "number" ? timing.settledMs : null;
			const startedAt = typeof item.createdAt === "number" ? item.createdAt : 0;
			const endedAt = running ? null : (typeof row.updatedAt === "number" ? row.updatedAt : startedAt + (settled ?? 0));
			out.push({
				id: item.id,
				// 真实子代理名：投影里有就用，没有回退到占位文案。
				name: item.name || item.agentName || null,
				activity: running ? "running" : "inactive",
				// 运行中不给 elapsedMs，交给界面按 startedAt 实时算；结束的按 settledMs。
				elapsedMs: running ? null : (settled ?? (startedAt && endedAt ? Math.max(0, endedAt - startedAt) : null)),
				provider: "dsh 内置",
				driver: item.mode || "",
				label: item.label || row.displayTitle || row.projectionValues?.title || row.title || item.id,
				model: null,
				status: running ? "running" : "completed",
				startedAt,
				endedAt,
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

function Card({ run, onStop, onInterrupt, stopEnabled, showCost }) {
	const dot = dotColor(run);
	const running = run.status === "running";
	const cost = typeof run.costUsd === "number" && run.costUsd > 0 ? `$${run.costUsd.toFixed(4)}` : "—";
	const effort = run.effort && run.effort !== "auto" ? run.effort : "—";
	const canStop = running && stopEnabled && !run.native;
	// 内置子代理不杀进程，走 dsh 自己的中断；只要还在跑就给按钮（host 说回合已收盘就不给）。
	const canInterrupt = interruptible(run);
	const task = run.label || run.prompt || "—";
	const progress = run.lastEvent ? `${run.lastEvent.kind}: ${run.lastEvent.text}` : "—";
	const steps = String(run.eventCount || 0);
	// 两行卡片：上行是固定列宽的状态栏；下行把「任务 / 进度 / 步骤」横向平铺、始终可见，
	// 不再点击逐项折叠展开。空间主要用于这三列信息，缺值也用占位符保持对齐。
	return h("div", {
		className: "sap-card" + (run.status === "error" ? " sap-err" : run.status === "completed" ? " sap-done" : ""),
		title: task,
	},
		h("div", { className: "sap-row" + (showCost ? "" : " sap-nocost") },
			h("span", { className: "sap-dot" + (run.stalled ? " sap-stall" : ""), style: { background: run.stalled ? "#d9a400" : dot } }),
			h("span", { className: "sap-agent", title: run.provider || "" }, run.provider || "?"),
			h("span", { className: "sap-model", title: modelText(run) }, modelText(run)),
			h("span", { className: "sap-effort", title: run.native ? `${activityOf(run) === "running" ? "运行中" : "已结束"}的 dsh 自带子代理` : `强度 ${effort}` }, run.native ? "内置" : effort),
			h("span", { className: "sap-time" }, elapsedText(run)),
			showCost ? h("span", { className: "sap-cost", title: cost === "—" ? "该 CLI 未上报金额" : "成本按 CLI 上报" }, cost) : null,
			h("span", { className: "sap-act" },
				canInterrupt ? h("button", { className: "sap-x", title: "中断该内置子代理", onClick: (e) => { e.stopPropagation(); onInterrupt?.(run.id); } }, "中断")
					: canStop ? h("button", { className: "sap-x", title: "停止该子代理", onClick: (e) => { e.stopPropagation(); onStop(run.id); } }, "停止")
						: null),
		),
		h("div", { className: "sap-meta" },
			h("span", { className: "sap-meta-item sap-meta-task", title: task },
				h("b", { className: "sap-meta-k" }, "任务"), h("span", { className: "sap-meta-v" }, task)),
			h("span", { className: "sap-meta-item sap-meta-prog", title: progress },
				h("b", { className: "sap-meta-k" }, "进度"), h("span", { className: "sap-meta-v" }, progress)),
			h("span", { className: "sap-meta-item sap-meta-steps" },
				h("b", { className: "sap-meta-k" }, "步骤"), h("span", { className: "sap-meta-v" }, steps)),
		),
	);
}

/** 输入框正上方的常驻条：默认一行显示统计，有新运行自动展开；可收起/隐藏。 */
function Dock({ connection, sessionId, hooks, onOpenTab }) {
	const [hideAt, setHideAt] = React.useState(readHideAt);
	const [open, setOpen] = React.useState(true);
	const [projected, setProjected] = React.useState([]);
	const [stopError, setStopError] = React.useState("");
	const snap = useRuns();
	const [cfg] = useCfg(snap);
	const external = scopedRuns(snap.runs || [], cfg, sessionId);
	// host 的 natives 优先；只有 host 没给行时才用客户端投影（projected）。
	const all = withNative(external, cfg.includeNative ? nativeRows(snap, projected, cfg.scope, sessionId) : []).map(applyInterrupt);
	// ✕ 隐藏整条 dock:只显示点击之后新开始的运行,旧记录不会把它顶回来。
	const visible = all.filter((run) => (run.startedAt || 0) > hideAt);
	const stats = statsOf(visible);
	const now = Date.now();
	const autoHide = Math.max(0, Number(cfg.autoHideSeconds) || 0);
	const active = visible.filter((run) => runningRow(run));
	const recent = visible.filter((run) => !runningRow(run) && !run.restored && !run.native && autoHide > 0 && (now - (run.endedAt || 0)) < autoHide * 1000);
	const shown = [...active, ...recent].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, Math.max(1, Number(cfg.maxCards) || 20));
	const prevActive = React.useRef(0);
	React.useEffect(() => {
		if (active.length > prevActive.current) setOpen(true);
		prevActive.current = active.length;
	}, [active.length]);
	// 中断失败提示过几秒自己消失，不长期占着 dock。
	React.useEffect(() => {
		if (!stopError) return;
		const t = setTimeout(() => setStopError(""), 8000);
		return () => clearTimeout(t);
	}, [stopError]);
	if (!cfg.dock) return null;
	if (cfg.scope === "session" && !sessionId) return null;
	// 没有可显示的内容就整条不出现,新建会话不再顶一条空的。
	if (shown.length === 0) return null;
	const onStop = (id) => { rpc(connection, "stop", { runId: id }).catch(() => {}); };
	// 内置子代理的中断：失败时在 dock 里留一行提示，不静默吞掉。
	const onInterrupt = (id) => {
		setStopError("");
		interruptNative(connection, id).catch((error) => setStopError(`中断失败：${String(error?.message ?? error).slice(0, 80)}`));
	};
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
		cfg.includeNative && !(snap.natives && snap.natives.length) ? h(NativeProbe, { hooks, sessionId, scopeAll: cfg.scope === "all", onData: setProjected }) : null,
		h("div", { className: "sap-dock" + (open && shown.length ? "" : " sap-fold") },
			h("div", { className: "sap-head" },
				shown.length ? h("span", { className: "sap-care" + (open ? " sap-open" : ""), onClick: () => setOpen((o) => !o), title: open ? "收起" : "展开" }, "▸") : h("span", { className: "sap-care" }, "·"),
				h("span", { className: "sap-h1", onClick: () => shown.length && setOpen((o) => !o) }, "子代理"),
				...summary,
				h("span", { className: "sap-sp" }),
				h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部"),
				onOpenTab && sessionId && cfg.showTab ? h("button", { className: "sap-open2", title: "在「子代理」页查看全部", onClick: () => onOpenTab(sessionId) }, "↗") : null,
				h("button", { className: "sap-close", title: "隐藏这一行（新运行会再出现）", onClick: dismiss }, "✕"),
			),
			stopError ? h("div", { className: "sap-warn", style: { padding: "0 9px 6px" } }, stopError) : null,
			open && shown.length ? h("div", { className: "sap-cards" }, shown.map((run) => h(Card, {
				key: run.id,
				run,
				onStop,
				onInterrupt,
				stopEnabled: cfg.allowStop,
				showCost: cfg.showCost,
			}))) : null,
		),
	);
}

function Tab({ connection, sessionId, hooks }) {
	const [sel, setSel] = React.useState(null);
	const [projected, setProjected] = React.useState([]);
	const [stopError, setStopError] = React.useState("");
	const [, setTick] = React.useState(0);
	React.useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
	const snap = useRuns();
	const [cfg] = useCfg(snap);
	// 中断失败提示过几秒自己消失。
	React.useEffect(() => {
		if (!stopError) return;
		const t = setTimeout(() => setStopError(""), 8000);
		return () => clearTimeout(t);
	}, [stopError]);
	if (!cfg.showTab) return null;
	const external = scopedRuns(snap.runs || [], cfg, sessionId);
	const runs = withNative(external, cfg.includeNative ? nativeRows(snap, projected, cfg.scope, sessionId) : []).map(applyInterrupt).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
	const stats = statsOf(runs);
	const max = Math.max(1, Number(cfg.maxCards) || 20);
	const onStop = (id) => { rpc(connection, "stop", { runId: id }).catch(() => {}); };
	// 内置子代理的中断：失败时留在表头上方，不静默。
	const onInterrupt = (id) => {
		setStopError("");
		interruptNative(connection, id).catch((error) => setStopError(`中断失败：${String(error?.message ?? error).slice(0, 80)}`));
	};
	const selRun = sel ? runs.find((r) => r.id === sel) : null;
	return h("div", { className: "sap-tab" },
		cfg.includeNative && !(snap.natives && snap.natives.length) ? h(NativeProbe, { hooks, sessionId, scopeAll: cfg.scope === "all", onData: setProjected }) : null,
		h("div", { className: "sap-tabhead" },
			h("b", null, "子代理"),
			h("span", { className: "sap-stat" }, `总计 ${stats.total}`),
			h("span", { className: "sap-stat" }, `运行 ${stats.running}`),
			h("span", { className: "sap-stat" }, `完成 ${stats.completed}`),
			h("span", { className: "sap-stat sap-errt" }, `出错 ${stats.error}`),
			cfg.showCost ? h("span", { className: "sap-stat" }, `成本 $${stats.costUsd.toFixed(4)}`) : null,
			h("span", { className: "sap-scope" }, cfg.scope === "session" ? "本会话" : "全部会话"),
			h("span", { className: "sap-scope" }, "管理后端：设置 → 子代理"),
		),
		stopError ? h("div", { className: "sap-warn" }, stopError) : null,
		runs.length === 0
			? h("div", { className: "sap-empty" }, cfg.scope === "session" && !sessionId ? "等待会话加载…" : "暂无子代理运行记录。")
			: h("table", { className: "sap-table" },
				h("thead", null, h("tr", null, ["Agent", "模型", "状态", "耗时", "任务", ""].map((x, i) => h("th", { key: i }, x)))),
				h("tbody", null, runs.slice(0, max).map((run) => {
					const [st] = statusOf(run);
					const col = dotColor(run);
					const running = runningRow(run);
					const canInterrupt = interruptible(run);
					return h("tr", { key: run.id, className: "sap-tr", onClick: () => setSel(sel === run.id ? null : run.id) },
						h("td", null, h("b", null, run.provider || "?"), run.native ? h("span", { className: "sap-native", title: run.name ? `dsh 自带子代理：${run.name}` : "dsh 自带的子代理" }, "内置") : null),
						h("td", null, h("span", { className: "sap-model" }, modelText(run))),
						h("td", null, h("span", { style: { color: col, fontWeight: 600 } }, st)),
						h("td", null, elapsedText(run)),
						h("td", { className: "sap-celltask" }, run.label || run.prompt || ""),
						h("td", null,
							canInterrupt ? h("button", { className: "sap-x", title: "中断该内置子代理", onClick: (e) => { e.stopPropagation(); onInterrupt(run.id); } }, "中断")
								: running && cfg.allowStop && !run.native ? h("button", { className: "sap-x", onClick: (e) => { e.stopPropagation(); onStop(run.id); } }, "停止")
									: null),
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

/** 设置页可折叠分区（默认展开/收起由 defaultOpen 决定）。 */
function Section({ title, hint, defaultOpen = false, children }) {
	const [open, setOpen] = React.useState(defaultOpen);
	return h("div", { className: "sap-group" },
		h("div", {
			className: "sap-ghead" + (open ? " sap-gopen" : ""),
			role: "button", "aria-expanded": open ? "true" : "false", tabIndex: 0,
			onClick: () => setOpen((v) => !v),
			onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } },
		},
			h("span", { className: "sap-gcare" }, open ? "▾" : "▸"),
			h("b", { className: "sap-gtitle2" }, title),
			hint ? h("span", { className: "sap-sethint" }, hint) : null),
		open ? h("div", { className: "sap-gbody" }, children) : null);
}

/** 后端五态标签（四态 + 检测到未加入）。 */
const BACKEND_STATES = {
	available: ["已启用·可用", "sap-badge-ok"],
	need_login: ["已启用·需登录", "sap-badge-warn"],
	missing: ["已启用·路径失效", "sap-badge-bad"],
	disabled: ["已停用", "sap-badge-muted"],
	detected: ["已检测到·未加入", "sap-badge-muted"],
};
function backendStateOf(it) {
	if (!it.configured) return it.installed ? "detected" : "missing";
	if (!it.enabled) return "disabled";
	if (!it.installed) return "missing";
	if (it.needLogin === true) return "need_login";
	return "available";
}
function StateBadge({ state }) {
	const [label, cls] = BACKEND_STATES[state] || BACKEND_STATES.disabled;
	return h("span", { className: "sap-badge " + cls }, label);
}

/** 单个后端的参数：第一层 默认模型 / 默认强度；第二层「高级」才放 并发 / CLI 路径 / 实际协议。 */
function BackendAdvanced({ connection, item, onSaved }) {
	const [model, setModel] = React.useState(item.model || "");
	const [effort, setEffort] = React.useState(item.reasoningEffort || "auto");
	const [limit, setLimit] = React.useState(String(item.maxConcurrency || 2));
	// 只把「手动覆盖」回填进输入框；自动检测到的解析路径只作占位提示，避免保存后被固定。
	const [binary, setBinary] = React.useState(item.binaryOverride || "");
	const [catalog, setCatalog] = React.useState(Array.isArray(item.models) ? item.models : []);
	const [showAdv, setShowAdv] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const [msg, setMsg] = React.useState("");
	const [err, setErr] = React.useState("");
	const levels = EFFORT_CHOICES[item.driver] || [];
	const autoBinary = item.binary || "";
	const probe = async () => {
		setBusy(true); setMsg(""); setErr("");
		try {
			const r = await rpc(connection, "probe", { name: item.name });
			const list = Array.isArray(r?.models) ? r.models : [];
			setCatalog(list);
			setMsg(`探测到 ${list.length} 个模型（仅作选择建议，不改默认模型）`);
		} catch (e) { setErr(`探测失败：${String(e?.message ?? e).slice(0, 80)}`); }
		finally { setBusy(false); }
	};
	const save = async () => {
		setBusy(true); setMsg(""); setErr("");
		// 只发用户真正编辑的字段；不再回传 models，避免「模型目录」压过默认 model。
		const patch = { model, reasoningEffort: effort, maxConcurrency: Number(limit) || 2, binary };
		try {
			await rpc(connection, "backend-config", { name: item.name, patch });
			setMsg("已保存");
			onSaved?.();
		} catch (e) { setErr(`保存失败：${String(e?.message ?? e).slice(0, 80)}`); }
		finally { setBusy(false); }
	};
	const field = (label, control, hint) => h("label", { className: "sap-field sap-field-col" },
		h("span", { className: "sap-fieldlab" }, label),
		control,
		hint ? h("span", { className: "sap-sethint" }, hint) : null);
	return h("div", { className: "sap-adv" },
		h("div", { className: "sap-advrow" },
			h("b", { className: "sap-advlab" }, `参数 · ${item.name}`),
			h("span", { className: "sap-sethint" }, `实际协议：${item.driver}`),
			h("span", { className: "sap-sp" }),
			h("button", { className: "sap-bkbtn", onClick: probe, disabled: busy }, "探测模型"),
			h("button", { className: "sap-bkbtn sap-primary", onClick: save, disabled: busy }, "保存")),
		h("div", { className: "sap-fields2" },
			field("默认模型", h("input", { className: "sap-inp", value: model, placeholder: "留空 = CLI 默认", list: `sap-models-${item.name}`, onChange: (e) => setModel(e.target.value) })),
			levels.length
				? field("默认思考强度", h("select", { className: "sap-inp", value: effort, onChange: (e) => setEffort(e.target.value) },
					[["auto", "自动（不指定）"], ...levels.map((x) => [x, x])].map(([v, l]) => h("option", { key: v, value: v }, l))), "只列该后端支持的档位")
				: field("默认思考强度", h("span", { className: "sap-sethint" }, "该后端不支持强度档位"))),
		h("datalist", { id: `sap-models-${item.name}` }, catalog.slice(0, 50).map((m) => h("option", { key: m, value: m }))),
		h("button", { className: "sap-advtoggle", onClick: () => setShowAdv((v) => !v) }, showAdv ? "▾ 收起高级（并发 / CLI 路径 / 协议）" : "▸ 高级（并发 / CLI 路径 / 协议）"),
		showAdv ? h("div", { className: "sap-fields2" },
			field("并发上限", h("input", { className: "sap-inp sap-inp-num", value: limit, onChange: (e) => setLimit(e.target.value) }), "该后端同时运行的任务数"),
			field("CLI 路径", h("input", { className: "sap-inp sap-inp-wide", value: binary, placeholder: autoBinary ? `自动检测：${autoBinary}` : "留空 = 自动检测", onChange: (e) => setBinary(e.target.value) }), autoBinary ? `自动检测值：${autoBinary}（留空即用它，填写则改为手动覆盖）` : "留空 = 自动检测"),
			field("实际协议", h("input", { className: "sap-inp", value: item.driver, readOnly: true }), "决定启动参数与 JSON 协议，需与 CLI 一致")) : null,
		catalog.length ? h("div", { className: "sap-sethint" }, `可选模型（${catalog.length}，点默认模型输入框可见建议）：${catalog.slice(0, 12).join(" / ")}${catalog.length > 12 ? " …" : ""}`) : null,
		msg ? h("div", { className: "sap-sethint" }, msg) : null,
		err ? h("div", { className: "sap-warn" }, err) : null,
	);
}

/** scan 的返回包装和字段名由 host 决定，这里同时接受 items / candidates 两种写法。 */
function scanCandidates(value) {
	const list = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.candidates) ? value.candidates : [];
	const out = [];
	for (const item of list) {
		if (!item) continue;
		// 已配置（或已在用）的走主列表，不再当候选。
		if (item.configured === true || item.inUse === true) continue;
		const name = String(item.name ?? "").trim();
		const path = String(item.absolutePath ?? item.binary ?? item.path ?? "").trim();
		if (!name || !path) continue;
		out.push({
			key: String(item.id ?? `${name}|${path}`),
			name,
			path,
			driver: String(item.suggestedDriver ?? item.driver ?? ""),
			launchable: item.launchable !== false,
		});
	}
	return out;
}

/** backend-check 的结果：路径和一句提示分开取，字段名同样做兼容。 */
function checkedPathOf(value) {
	return String(value?.absolutePath ?? value?.binary ?? value?.path ?? "").trim();
}
function checkedNoteOf(value) {
	const path = checkedPathOf(value);
	const availability = value?.availability;
	// host 现有返回是 { ok, binary, driver }，也兼容带 availability / exists 的写法。
	if (availability === "missing" || value?.exists === false || value?.ok === false || !path) {
		return path ? `不可用：${path} 不存在或不能启动` : "没找到可执行文件，请填写绝对路径或可执行命令名";
	}
	if (availability === "unknown") return "无法确认该路径，留到运行时验证";
	if (value?.launchable === false) return `不可启动：${path}`;
	const driver = String(value?.driver ?? "");
	return `已找到可启动入口：${path}${driver ? `（建议 driver：${driver}）` : ""}；登录和协议兼容性在运行时验证`;
}

/**
 * 「我的后端」分区：每行只留 名称 · 状态 · 开关/修复 · ▸；
 * 停用与路径失效也能展开编辑（不再只有 enabled 才渲染参数）。
 * 添加后端收进按钮：搜索已安装 CLI 为主操作，手动添加为次操作；候选明确标注「登录与协议待验证」。
 */
function Backends({ connection }) {
	const [items, drivers, load] = useBackends(connection);
	const [expanded, setExpanded] = React.useState("");
	const [pane, setPane] = React.useState(""); // "" | "add"
	const [addMode, setAddMode] = React.useState("scan"); // scan | manual
	const [scan, setScan] = React.useState({ status: "idle", items: [], error: "", note: "" });
	const [picked, setPicked] = React.useState({});
	const [busy, setBusy] = React.useState("");
	const [form, setForm] = React.useState({ name: "", driver: "", binary: "" });
	const [checked, setChecked] = React.useState({ status: "idle", text: "" });
	const [err, setErr] = React.useState("");
	const toggle = async (it) => {
		setErr("");
		try { await rpc(connection, "backend", { name: it.name, enabled: !it.enabled }); load(); }
		catch (error) { setErr(`切换「${it.name}」失败（${String(error?.message ?? error).slice(0, 80)}）。`); }
	};
	const joinDetected = async (it) => {
		setErr("");
		try { await rpc(connection, "backend", { name: it.name, enabled: true }); load(); }
		catch (error) { setErr(`加入「${it.name}」失败（${String(error?.message ?? error).slice(0, 80)}）。`); }
	};
	const runScan = async () => {
		setAddMode("scan"); setErr("");
		setScan({ status: "loading", items: [], error: "", note: "" });
		try {
			const value = await rpc(connection, "scan", {}, 15000);
			setScan({
				status: "ready",
				items: scanCandidates(value),
				error: "",
				note: value?.status === "partial" || value?.timedOut ? "部分位置未能检查完，先列出已找到的" : "",
			});
		} catch (error) {
			setScan({ status: "error", items: [], error: `搜索失败：${String(error?.message ?? error).slice(0, 80)}`, note: "" });
		}
	};
	const join = async (cand, driver) => {
		setErr(""); setBusy(cand.key);
		try {
			await rpc(connection, "backend", { name: cand.name, driver, binary: cand.path, enabled: true });
			setScan((state) => ({ ...state, items: state.items.filter((item) => item.key !== cand.key) }));
			load();
		} catch (error) {
			setErr(`加入「${cand.name}」失败（${String(error?.message ?? error).slice(0, 80)}）。`);
		} finally { setBusy(""); }
	};
	const checkPath = async () => {
		setErr("");
		setChecked({ status: "loading", text: "检测中…" });
		try {
			const value = await rpc(connection, "backend-check", { name: form.name.trim(), binary: form.binary.trim() }, 15000);
			const path = checkedPathOf(value);
			if (path) setForm((current) => ({ ...current, binary: path }));
			setForm((current) => (current.driver || !value?.driver ? current : { ...current, driver: String(value.driver) }));
			setChecked({ status: "done", text: checkedNoteOf(value) });
		} catch (error) {
			setChecked({ status: "error", text: `检测失败：${String(error?.message ?? error).slice(0, 80)}` });
		}
	};
	const add = async () => {
		setErr("");
		const name = form.name.trim();
		if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) { setErr("名称只能用字母、数字、下划线或短横线（1–32 位）"); return; }
		try {
			await rpc(connection, "backend", { name, enabled: true, driver: form.driver || drivers[0] || "qoder-json", binary: form.binary.trim() });
			setPane("");
			setForm({ name: "", driver: "", binary: "" });
			setChecked({ status: "idle", text: "" });
			load();
		} catch (error) {
			setErr(`添加「${name}」失败（${String(error?.message ?? error).slice(0, 80)}）。`);
		}
	};

	const scanBlock = h("div", { className: "sap-addbody" },
		scan.status === "loading" ? h("div", { className: "sap-sethint" }, "正在扫描…") : null,
		scan.error ? h("div", { className: "sap-warn" }, scan.error) : null,
		scan.note ? h("div", { className: "sap-sethint" }, scan.note) : null,
		scan.status === "ready" && scan.items.length === 0 ? h("div", { className: "sap-sethint" }, "没找到还没加入的 CLI") : null,
		scan.items.map((cand) => {
			const driver = picked[cand.key] || cand.driver;
			return h("div", { className: "sap-setrow sap-scanrow", key: cand.key },
				h("div", { className: "sap-setlab sap-scanlab" },
					h("b", null, cand.name),
					h("div", { className: "sap-scanpath" }, cand.path),
					h("div", { className: "sap-sethint" },
						`建议协议：${cand.driver || "需手动选择"} · `,
						h("span", { className: "sap-badge sap-badge-warn" }, "登录与协议待验证"))),
				h("div", { className: "sap-setctl" },
					cand.driver ? null : h("select", { className: "sap-inp", value: picked[cand.key] || "", onChange: (e) => setPicked({ ...picked, [cand.key]: e.target.value }) },
						h("option", { value: "" }, "选择协议…"),
						drivers.map((d) => h("option", { key: d, value: d }, d))),
					h("button", {
						className: "sap-bkbtn sap-primary",
						disabled: !driver || busy === cand.key || cand.launchable === false,
						title: cand.launchable === false ? "该路径不能启动" : "加入并启用",
						onClick: () => join(cand, driver),
					}, busy === cand.key ? "加入中…" : "加入")));
		}),
	);

	const manualBlock = h("div", { className: "sap-addbody" },
		h("div", { className: "sap-advrow" },
			h("input", { className: "sap-inp", placeholder: "名称，如 codebuddy2", value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }) }),
			h("select", { className: "sap-inp", value: form.driver || drivers[0] || "", onChange: (e) => setForm({ ...form, driver: e.target.value }) },
				drivers.map((d) => h("option", { key: d, value: d }, d))),
			h("input", {
				className: "sap-inp sap-inp-wide",
				placeholder: "CLI 路径（可留空自动检测）",
				value: form.binary,
				onChange: (e) => { setForm({ ...form, binary: e.target.value }); setChecked({ status: "idle", text: "" }); },
			}),
			h("button", { className: "sap-bkbtn", onClick: checkPath, disabled: checked.status === "loading" }, "检测路径"),
			h("button", { className: "sap-bkbtn sap-primary", onClick: add }, "添加")),
		checked.text ? h("div", { className: checked.status === "error" ? "sap-warn" : "sap-sethint" }, checked.text) : null,
		h("div", { className: "sap-sethint" }, "driver/协议决定启动参数与 JSON 协议，须与 CLI 实际一致；登录与协议在运行时验证。"));

	const addPane = pane === "add" ? h("div", { className: "sap-addform" },
		h("div", { className: "sap-advrow" },
			h("b", { className: "sap-advlab" }, "添加后端"),
			h("span", { className: "sap-sp" }),
			h("button", { className: "sap-bkbtn", onClick: () => setPane("") }, "收起")),
		h("div", { className: "sap-advrow" },
			h("button", { className: "sap-bkbtn sap-primary", onClick: runScan, disabled: scan.status === "loading" }, scan.status === "loading" ? "正在扫描…" : "搜索已安装的 CLI"),
			h("button", { className: "sap-bkbtn", onClick: () => setAddMode("manual") }, "手动添加")),
		addMode === "scan" ? scanBlock : manualBlock,
	) : null;

	const rows = items.map((it) => {
		const state = backendStateOf(it);
		const openRow = expanded === it.name;
		const isDetected = state === "detected";
		return h(React.Fragment, { key: it.name },
			h("div", { className: "sap-setrow" },
				h("div", { className: "sap-setlab" },
					h("span", { className: "sap-link", onClick: () => setExpanded(openRow ? "" : it.name) },
						`${openRow ? "▾" : "▸"} `, h("b", null, it.name), h("span", { className: "sap-driver" }, it.driver)),
					state === "disabled" ? h("div", { className: "sap-sethint" }, "已停用；模型、强度、并发等设置保留，仍可展开编辑") : null,
					state === "missing" ? h("div", { className: "sap-sethint" }, "路径失效；可展开修改 CLI 路径或重新检测") : null,
					state === "need_login" ? h("div", { className: "sap-sethint" }, "已启用但需登录；登录后重试") : null),
				h("div", { className: "sap-setctl" },
					h(StateBadge, { state }),
					isDetected
						? h("button", { className: "sap-bkbtn sap-primary", onClick: () => joinDetected(it) }, "加入")
						: h("button", {
							className: "sap-pill" + (it.enabled ? " sap-on" : ""),
							role: "switch", "aria-checked": it.enabled ? "true" : "false",
							onClick: () => toggle(it),
						}, h("span")),
					!isDetected ? h("button", { className: "sap-bkbtn", onClick: () => setExpanded(openRow ? "" : it.name) }, openRow ? "收起" : (state === "missing" ? "修复" : "参数")) : null)),
			openRow ? h(BackendAdvanced, { connection, item: it, onSaved: load }) : null,
		);
	});

	return h(Section, {
		title: "我的后端",
		hint: items.length ? `共 ${items.length} 个（本机检测到的 + 已配置的）` : "还没发现本机 CLI",
		defaultOpen: true,
	},
		h("div", { className: "sap-toolbar" },
			h("button", { className: "sap-bkbtn sap-primary", onClick: () => { setPane(pane === "add" ? "" : "add"); setErr(""); } },
				pane === "add" ? "收起添加" : "＋ 添加后端")),
		addPane,
		rows,
		err ? h("div", { className: "sap-warn" }, err) : null,
	);
}

/** 状态与诊断里的自检：跑一次 dry-run，显示真实命令行、退出码、首条错误。 */
function SelfCheck({ connection }) {
	const [items] = useBackends(connection);
	const [name, setName] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [res, setRes] = React.useState(null);
	const [err, setErr] = React.useState("");
	const list = items.filter((it) => it.configured);
	const current = name || list[0]?.name || "";
	const run = async () => {
		if (!current) return;
		setBusy(true); setErr(""); setRes(null);
		try { setRes(await rpc(connection, "self-check", { name: current }, 20000)); }
		catch (e) { setErr(`自检失败：${String(e?.message ?? e).slice(0, 100)}`); }
		finally { setBusy(false); }
	};
	const copy = (value) => { try { navigator.clipboard?.writeText(String(value ?? "")); } catch {} };
	return h("div", { className: "sap-selfcheck" },
		h("div", { className: "sap-advrow" },
			h("select", { className: "sap-inp", value: current, onChange: (e) => setName(e.target.value) },
				list.length ? list.map((it) => h("option", { key: it.name, value: it.name }, it.name)) : h("option", { value: "" }, "（无已配置后端）")),
			h("button", { className: "sap-bkbtn sap-primary", onClick: run, disabled: busy || !current }, busy ? "自检中…" : "自检")),
		err ? h("div", { className: "sap-warn" }, err) : null,
		res ? h("div", { className: "sap-selfcheck-out" },
			h("div", null, h("b", null, "命令 "), h("code", { className: "sap-code" }, res.command || "—")),
			h("div", null, h("b", null, "退出码 "), String(res.exitCode ?? "未知"), res.ok ? h("span", { className: "sap-donet" }, " · 可启动") : h("span", { className: "sap-errt" }, " · 有错误")),
			res.firstError ? h("div", null, h("b", null, "首条错误 "), h("span", { className: "sap-errt" }, res.firstError)) : null,
			h("div", null, h("button", { className: "sap-bkbtn", onClick: () => copy(res.command) }, "复制命令"))) : null,
	);
}

/** 设置侧边栏「子代理」分区：7 个分区（我的后端 / 在哪显示 / 观测范围 / 状态与诊断 / 维护）。 */
function Settings({ connection }) {
	const snap = useRuns();
	const [cfg, overrides] = useCfg(snap);
	const [note, setNote] = React.useState("");
	const [showDetails, setShowDetails] = React.useState(false);
	const [confirmReset, setConfirmReset] = React.useState(false);
	const [batch, setBatch] = React.useState({ open: false });
	const [backendItems, , loadBackends] = useBackends(connection);
	const runs = snap.runs || [];
	const stats = statsOf(runs);
	const aborted = runs.filter((r) => r.status === "aborted").length;
	// 与 host 的协议对齐:一次改一个 key,发 {key,value};恢复默认发 {reset:true}。
	const persist = async (patch) => {
		try {
			if (patch.reset === true) {
				await rpc(connection, "panel", { reset: true });
				writeOverrides({});
			} else {
				for (const [key, value] of Object.entries(patch)) await rpc(connection, "panel", { key, value });
				const next = { ...overrides };
				for (const key of Object.keys(patch)) delete next[key];
				if (Object.keys(next).length === 0) writeOverrides({});
				else writeOverrides(next);
			}
			setNote("");
		} catch (error) {
			const next = { ...overrides };
			for (const [key, value] of Object.entries(patch)) if (key !== "reset") next[key] = value;
			writeOverrides(next);
			setNote(`写回配置失败（${String(error?.message ?? error).slice(0, 80)}），已改为本地生效。`);
		}
	};
	const dirty = Object.keys(overrides).filter((key) => key in DEFAULTS);
	const extInfo = snap.external;
	const extState = !extInfo ? "unknown"
		: extInfo.enabled === false ? "off"
			: extInfo.reason === "jobs-unavailable" ? "unsupported"
				: extInfo.reason === "error" ? "readfail"
					: ((extInfo.matched ?? 0) === 0 ? "zero" : "hit");
	const extLine = {
		unknown: "外部任务：未检测",
		off: "外部任务：已关闭",
		unsupported: "外部任务：当前 dsh 读不到 jobs 服务，此功能不可用",
		readfail: "外部任务：读取失败",
		zero: "外部任务：0 命中（检查关键词是否匹配任务标签）",
		hit: `外部任务：本机后台任务 ${extInfo?.jobs ?? 0} 个，命中 ${extInfo?.matched ?? 0} 个`,
	}[extState];
	const row = (label, hint, control, key) => h("div", { className: "sap-setrow" },
		h("div", { className: "sap-setlab" }, label, hint ? h("div", { className: "sap-sethint" }, hint) : null),
		h("div", { className: "sap-setctl" }, control),
		key && dirty.includes(key) ? h("span", { className: "sap-over", title: "写回配置失败，当前值只在本机生效" }) : null);
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
	const text = (key, placeholder) => h("input", {
		className: "sap-input",
		defaultValue: cfg[key] ?? "",
		placeholder,
		onBlur: (event) => {
			const next = String(event.target.value ?? "").trim();
			if (next !== String(cfg[key] ?? "")) persist({ [key]: next });
		},
		onKeyDown: (event) => { if (event.key === "Enter") event.target.blur(); },
	});
	const offBackends = backendItems.filter((it) => it.configured && !it.enabled);
	const refreshAt = snap.now ? new Date(snap.now).toLocaleTimeString() : "—";
	return h("div", { className: "sap-settings" },
		h(Backends, { connection }),
		h(Section, { title: "在哪显示", defaultOpen: true },
			row("输入框上方运行条", "有运行或有完成记录时才出现", toggle("dock"), "dock"),
			row("会话中的「子代理」页", "开启后会话里才出现该页（改动后重载插件生效）", toggle("showTab"), "showTab"),
			h("button", { className: "sap-advtoggle", onClick: () => setShowDetails((v) => !v) }, showDetails ? "▾ 收起显示细节" : "▸ 显示细节（范围 / 卡片数 / 完成停留 / 成本 / 停止按钮）"),
			showDetails ? h("div", { className: "sap-gbody" },
				row("范围", "", seg("scope", [["session", "本会话"], ["all", "全部"]]), "scope"),
				row("卡片上限", "", seg("maxCards", [["10", "10"], ["20", "20"], ["40", "40"]], Number), "maxCards"),
				row("完成卡片停留", "0 = 不显示完成卡片", seg("autoHideSeconds", [["0", "不显示"], ["10", "10s"], ["30", "30s"], ["60", "60s"], ["300", "5m"]], Number), "autoHideSeconds"),
				row("显示成本", "金额来自 CLI 上报，缺报显示 —", toggle("showCost"), "showCost"),
				row("停止按钮", "对可停止的后端任务显示", toggle("allowStop"), "allowStop")) : null),
		h(Section, { title: "观测范围", hint: extLine, defaultOpen: false },
			row("显示 dsh 内置子代理", "只读、带「内置」标", toggle("includeNative"), "includeNative"),
			row("显示 dsh 后台脚本任务", "如 pwsh 跑 pi-run.ps1 起的 pi；只读，不改你的脚本", toggle("includeExternal"), "includeExternal"),
			cfg.includeExternal ? row("匹配关键字", `按任务标签子串匹配；当前 ${extInfo?.matched ?? 0} 命中 / ${extInfo?.jobs ?? 0} 个任务`, text("externalMatch", "pi-run.ps1"), "externalMatch") : null,
			h("div", { className: "sap-sethint" }, extLine)),
		h(Section, { title: "状态与诊断", hint: "快照 / 自检 / 最近失败", defaultOpen: false },
			row("快照来源", "运行面板共享的 dsh runs 快照", h("span", { className: "sap-sethint" }, "runs 接口"), ""),
			row("最后刷新", "", h("span", { className: "sap-sethint" }, refreshAt), ""),
			row("取消数", "", h("span", { className: "sap-sethint" }, String(aborted)), ""),
			row("费用", "CLI 未上报时显示 —", h("span", { className: "sap-sethint" }, cfg.showCost ? "已开启" : "未显示"), ""),
			h(SelfCheck, { connection })),
		h(Section, { title: "维护", hint: "恢复默认 / 批量启用", defaultOpen: false },
			confirmReset
				? h("div", { className: "sap-setrow" },
					h("div", { className: "sap-setlab" }, "确认恢复面板默认？", h("div", { className: "sap-sethint" }, "只重置显示与观测偏好（dock/Tab/范围/卡片/成本/停止/观测），不动后端。")),
					h("div", { className: "sap-setctl" },
						h("button", { className: "sap-bkbtn", onClick: () => setConfirmReset(false) }, "取消"),
						h("button", { className: "sap-bkbtn sap-primary", onClick: async () => { await persist({ reset: true }); setConfirmReset(false); } }, "确认重置")))
				: h("div", { className: "sap-setrow" },
					h("div", { className: "sap-setlab" }, "恢复面板默认", h("div", { className: "sap-sethint" }, "只重置显示与观测偏好，不动后端配置")),
					h("div", { className: "sap-setctl" }, h("button", { className: "sap-bkbtn", onClick: () => setConfirmReset(true) }, "恢复默认"))),
			offBackends.length
				? h("div", { className: "sap-setrow" },
					h("div", { className: "sap-setlab" }, `批量启用已停用后端（${offBackends.length}）`, h("div", { className: "sap-sethint" }, "受影响：" + offBackends.map((it) => it.name).join(" / "))),
					h("div", { className: "sap-setctl" },
						batch.open
							? h(React.Fragment, null,
								h("button", { className: "sap-bkbtn", onClick: () => setBatch({ open: false }) }, "取消"),
								h("button", { className: "sap-bkbtn sap-primary", onClick: async () => { for (const it of offBackends) { try { await rpc(connection, "backend", { name: it.name, enabled: true }); } catch {} } setBatch({ open: false }); loadBackends(); } }, "确认启用全部"))
							: h("button", { className: "sap-bkbtn", onClick: () => setBatch({ open: true }) }, "批量启用")))
				: null),
		note ? h("div", { className: "sap-warn" }, note) : null,
		h("div", { className: "sap-foot" }, h("span", { className: "sap-note" }, "改完立即生效，并写回本插件配置的 panel 节点（cordis.patch.yml）。")),
	);
}

const PANEL_STYLE = `
.sap-dock { box-sizing: border-box; width: calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px)); max-width: var(--dsh-composer-card-max-width, 100%); margin: 4px auto 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; font-size: 12px; }
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
.sap-cards { display: flex; flex-direction: column; gap: 4px; padding: 0 8px 7px; max-height: 240px; overflow-y: auto; }
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
/* 卡片第二行：任务 / 进度 / 步骤 横向平铺、始终可见，不再逐项折叠 */
.sap-meta { display: flex; align-items: baseline; gap: 14px; padding: 1px 2px 5px 15px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sap-meta-item { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; }
.sap-meta-k { flex: none; color: var(--dsw-alias-label-primary); font-weight: 600; }
.sap-meta-v { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sap-meta-task { flex: 1 1 0; }
.sap-meta-prog { flex: 1.6 1 0; }
.sap-meta-steps { flex: 0 0 auto; }
.sap-meta-steps .sap-meta-v { font-variant-numeric: tabular-nums; }
/* 卡片详情已改为第二行平铺展示（.sap-meta），卡片不再整行点击展开 */
.sap-card.sap-expanded { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, transparent); }
.sap-detail2 { padding: 2px 4px 6px 14px; display: flex; flex-direction: column; gap: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; overflow-wrap: anywhere; }
.sap-detail2 b { color: var(--dsw-alias-label-primary); font-weight: 600; margin-right: 2px; }
.sap-detail2 .sap-ev2 { font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; opacity: .85; }
.sap-open2 { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 0 3px; cursor: pointer; }
.sap-open2:hover { color: var(--dsw-alias-brand-primary); }
/* 插件页的指路条 + 设置页里的只读原始配置（已随 1.1.24 合并删除，保留占位注释便于追溯） */
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
.sap-input { width: 132px; font-size: 11.5px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
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
/* 后端搜索候选：名字 / 绝对路径 / 建议 driver / 加入 */
.sap-scanrow { align-items: flex-start; }
.sap-scanlab { min-width: 0; flex: 1; }
.sap-scanpath { font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.sap-missed { color: var(--dsw-alias-label-secondary); font-size: 10px; opacity: .55; }
/* 设置页：统计条、两列分组、后端徽标、高级参数块 */
.sap-statbar { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; height: 32px; padding: 0 12px; margin: 2px 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.sap-statbar b { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; margin-left: 4px; }
.sap-statbar .sap-dotsep { color: var(--dsw-alias-border-l3); }
.sap-donet { color: #7cbc8e; }
.sap-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26px; }
.sap-col { min-width: 0; }
.sap-detected { color: var(--dsw-alias-label-secondary); font-size: 10px; opacity: .8; }
.sap-advhead { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.sap-advlab { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.sap-advlab span { font-weight: 400; color: var(--dsw-alias-label-secondary); margin-left: 6px; }
.sap-advact { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.sap-fields { display: grid; grid-template-columns: 1.15fr .8fr .6fr 1.5fr; gap: 9px; align-items: end; }

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
/* 设置页 7 分区：可折叠标题、状态徽标、自检、两列自适应 */
.sap-ghead { display: flex; align-items: center; gap: 8px; padding: 10px 0 6px; margin-top: 2px; cursor: pointer; border-bottom: 1px solid var(--dsw-alias-border-l1); user-select: none; }
.sap-ghead:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sap-gcare { color: var(--dsw-alias-brand-primary); width: 12px; display: inline-block; }
.sap-gtitle2 { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.sap-gbody { padding: 4px 0; }
.sap-badge { font-size: 10.5px; line-height: 16px; padding: 0 7px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
.sap-badge-ok { color: #1a7f4b; background: color-mix(in srgb, #3f9d5a 16%, transparent); border-color: color-mix(in srgb, #3f9d5a 40%, transparent); }
.sap-badge-warn { color: #8a5a00; background: color-mix(in srgb, #d9a400 16%, transparent); border-color: color-mix(in srgb, #d9a400 40%, transparent); }
.sap-badge-bad { color: #b42318; background: color-mix(in srgb, #e5533c 16%, transparent); border-color: color-mix(in srgb, #e5533c 40%, transparent); }
.sap-badge-muted { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.sap-driver { font-size: 10px; color: var(--dsw-alias-label-secondary); margin-left: 6px; }
.sap-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 0 4px; }
.sap-addbody { padding: 4px 0 6px; }
.sap-advtoggle { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11.5px; cursor: pointer; padding: 6px 0 2px; text-align: left; }
.sap-advtoggle:hover { color: var(--dsw-alias-label-primary); }
.sap-fields2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; padding: 6px 0; }
.sap-field-col { flex-direction: column; align-items: stretch; gap: 3px; }
.sap-fieldlab { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.sap-selfcheck { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--dsw-alias-border-l2); }
.sap-selfcheck-out { margin-top: 6px; display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.sap-code { font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; background: var(--dsw-alias-bg-layer-2); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
.sap-cols { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
`;

export function registerPanel(ctx) {
	ctx.effect(() => {
		const tag = document.createElement("style");
		tag.dataset.pluginPanel = "dsh-cli-hub-panel";
		tag.textContent = PANEL_STYLE;
		document.head.append(tag);
		return () => tag.remove();
	}, "dsh-cli-hub: panel styles");
	const connection = () => ctx.get("connection");
	// 共享 store 自己拉数据，连接在每次拉取时再取（注入时机不确定）。
	runsStore.configure(connection);
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
	// 「子代理」标签页默认不注册（showTab=false）；开启后会话里才出现该页。
	// slot 注册是一次性的，故这里读一次 host 配置决定是否注册，改动后需重载插件生效。
	const registerTab = () => ctx.slots.inject("conversation.view", () => ctx.slots.register({
		name: "conversation.view",
		id: "subagent-run-tab",
		order: 40,
		label: () => "子代理",
	}, (props) => h(Tab, {
		connection: connection(),
		sessionId: props?.sessionId ?? props?.session?.id ?? null,
		hooks: props,
	})));
	try {
		const conn = connection();
		if (conn) {
			Promise.resolve(rpc(conn, "runs", { limit: 1 }, 8000))
				.then((snap) => { if (snap?.cfg?.showTab) registerTab(); })
				.catch(() => {});
		}
	} catch {}
	// 管理界面只放一处:设置侧边栏的「子代理」分区,避免同一插件出现两个入口。
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "dsh-cli-hub",
		order: 17,
		label: () => "子代理",
	}, () => h(Settings, { connection: connection() })));
}
