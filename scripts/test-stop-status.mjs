// 停止回执三态与终态回写的离线断言：node scripts/test-stop-status.mjs，不引第三方框架。
import { spawn } from "node:child_process";
import { STOP_CONFIRM_MS, classifyStop, decideFinalStatus, isPidAlive, waitForExit } from "../lib/stop-status.js";

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
	const a = JSON.stringify(actual), e = JSON.stringify(expected);
	if (a === e) { passed += 1; console.log(`PASS  ${label}`); }
	else { failed += 1; console.log(`FAIL  ${label}  got=${a} want=${e}`); }
}
function ok(cond, label, detail = "") {
	if (cond) { passed += 1; console.log(`PASS  ${label}${detail ? "  " + detail : ""}`); }
	else { failed += 1; console.log(`FAIL  ${label}${detail ? "  " + detail : ""}`); }
}

// 1) 三态：确认停止 / 停止失败(退出码非0) / 停止失败(error) / 仅请求(stopping)
eq(classifyStop({ killCode: 0, exited: true }).state, "stopped", "kill 0 + 已退出 → stopped");
eq(classifyStop({ killCode: 0, exited: true }).stopped, true, "stopped 时 stopped=true");
eq(classifyStop({ killCode: 128, exited: false }).state, "stop_failed", "taskkill 退出码 128 → stop_failed");
eq(classifyStop({ killCode: 128 }).stopped, false, "stop_failed 时 stopped=false");
eq(classifyStop({ killError: new Error("denied") }).state, "stop_failed", "终止命令 error → stop_failed");
eq(classifyStop({ killCode: 0, exited: false }).state, "stopping", "kill 0 但进程仍在 → stopping");
eq(classifyStop({ killCode: 0, exited: false }).stopped, false, "stopping 时绝不谎报 stopped");

// 2) 终态回写：已取消不得被改成完成/出错
eq(decideFinalStatus({ existingStatus: "aborted", activityStatus: "completed", hasResultEvent: true }), "aborted", "索引已 aborted + 有完成事件 → 仍 aborted");
eq(decideFinalStatus({ cancelled: true, activityStatus: "completed", hasResultEvent: true }), "aborted", "cancelled + 有完成事件 → aborted");
eq(decideFinalStatus({ activityStatus: "completed" }), "completed", "正常完成 → completed");
eq(decideFinalStatus({ hasResultEvent: true, resultIsError: true }), "error", "result 错误 → error");
eq(decideFinalStatus({ usesResultEvent: false, exitCode: 0 }), "completed", "非 result 驱动 + 退出 0 → completed");
eq(decideFinalStatus({ usesResultEvent: false, exitCode: 125 }), "error", "非 result 驱动 + 退出 125(未知) → error 不记成功");
eq(decideFinalStatus({ usesResultEvent: true, activityStatus: "running", exitCode: 0 }), "error", "result 驱动未出 result → error");

// 3) 真实进程：杀掉后 waitForExit 能在有界期内确认退出
(async () => {
	const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 8000)"], { stdio: "ignore", windowsHide: true });
	try {
		await new Promise((r) => setTimeout(r, 200));
		ok(isPidAlive(child.pid), "子进程启动且存活");
		try { process.kill(child.pid, "SIGKILL"); } catch {}
		const gone = await waitForExit(child.pid, STOP_CONFIRM_MS, 50);
		ok(gone, "杀掉后 waitForExit 确认进程退出");
	} finally {
		try { process.kill(child.pid, "SIGKILL"); } catch {}
	}

	console.log(`\nSTOP-STATUS TEST ${failed === 0 ? "OK" : "FAILED"} (${passed} passed, ${failed} failed)`);
	process.exit(failed === 0 ? 0 : 1);
})();
