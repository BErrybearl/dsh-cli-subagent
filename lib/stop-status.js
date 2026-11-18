// 停止回执与终态判定的纯逻辑（不依赖 dsh 宿主，便于 scripts/test-stop-status.mjs 单测）。
// 目标：停止要如实三态（正在停止 / 停止失败 / 已确认停止），终态回写不得把「已取消」改成「出错/完成」。

/** 停止后等待进程树退出的有界期限。 */
export const STOP_CONFIRM_MS = 3000;

/**
 * 根据终止命令结果与进程是否退出，给出三态回执。
 * @param {{killError?: any, killCode?: number|null, exited?: boolean, waitedMs?: number}} input
 * @returns {{ok: boolean, state: "stopping"|"stop_failed"|"stopped", stopped: boolean, error?: string}}
 */
export function classifyStop({ killError, killCode, exited = false, waitedMs = STOP_CONFIRM_MS } = {}) {
	if (killError) {
		return { ok: false, state: "stop_failed", stopped: false, error: String(killError?.message ?? killError).slice(0, 200) };
	}
	if (killCode !== null && killCode !== undefined && killCode !== 0) {
		return { ok: false, state: "stop_failed", stopped: false, error: `终止命令退出码 ${killCode}` };
	}
	if (exited) return { ok: true, state: "stopped", stopped: true };
	return { ok: true, state: "stopping", stopped: false, error: `已请求终止，${Math.round(waitedMs / 1000)} 秒内进程仍在运行` };
}

/**
 * 决定一次运行最终写入索引的状态。
 * 关键：一旦被取消/面板停止（cancelled 或 existingStatus 已是 aborted），
 * 即使随后拿到 result 事件或 0 退出，也不得回写成 completed/error。
 * @returns {"completed"|"error"|"aborted"}
 */
export function decideFinalStatus({
	existingStatus,
	cancelled,
	activityStatus,
	hasResultEvent,
	resultIsError,
	usesResultEvent,
	exitCode,
	timedOut,
} = {}) {
	if (cancelled || existingStatus === "aborted") return "aborted";
	if (activityStatus && activityStatus !== "running") return activityStatus;
	if (hasResultEvent) return resultIsError ? "error" : "completed";
	if (!usesResultEvent && !timedOut && exitCode === 0) return "completed";
	return "error";
}

/** pid 是否仍存活（用 signal 0 探测）。 */
export function isPidAlive(pid) {
	if (!pid) return false;
	try { process.kill(pid, 0); return true; } catch { return false; }
}

/** 有界轮询等待进程退出；超时返回 false。 */
export async function waitForExit(pid, timeoutMs = STOP_CONFIRM_MS, intervalMs = 100) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isPidAlive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return !isPidAlive(pid);
}
