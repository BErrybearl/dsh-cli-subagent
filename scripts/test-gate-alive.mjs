// 并发锁「存活判据」的离线断言：node scripts/test-gate-alive.mjs。
// 伪造 mtime 过期但 pid=本进程的锁 → 应判定存活、不被回收；pid 不存在 / 超过硬上限才回收。
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SharedProviderGate } from "../lib/shared-gate.js";

const ROOT = join(tmpdir(), "dsh-subagent-gate");
// 与 shared-gate.js 的 providerDirName 保持一致（同一 hash 规则）。
function providerDirName(name) {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
	return `${(hash >>> 0).toString(36)}-${name.replace(/[^\w.-]/g, "_")}`;
}

let passed = 0;
let failed = 0;
function ok(cond, label, detail = "") {
	if (cond) { passed += 1; console.log(`PASS  ${label}${detail ? "  " + detail : ""}`); }
	else { failed += 1; console.log(`FAIL  ${label}${detail ? "  " + detail : ""}`); }
}

const madeDirs = [];
function writeLock(name, slot, pid, ageMs) {
	const dir = join(ROOT, providerDirName(name));
	mkdirSync(dir, { recursive: true });
	madeDirs.push(dir);
	const file = join(dir, slot);
	writeFileSync(file, JSON.stringify({ pid, token: "test-token", since: Date.now() }));
	const t = (Date.now() - ageMs) / 1000;
	utimesSync(file, t, t);
	return file;
}

try {
	const gate = new SharedProviderGate();

	// 1) mtime 已过期(60s>旧30s阈值)但 pid=本进程存活 → 仍算存活
	const aliveName = `gate-alive-${process.pid}-a`;
	writeLock(aliveName, "slot-0.lock", process.pid, 60_000);
	ok(gate.active(aliveName) === 1, "mtime 过期但 pid 存活 → 判定存活", `active=${gate.active(aliveName)}`);

	// 2) 该存活槽位不被回收：并发上限 1 已占满，acquire 应拿不到(null)
	const acquired = gate.tryAcquire(aliveName, 1);
	ok(acquired === null, "存活槽位不被回收（占用满，acquire 返回 null）", `result=${acquired === null ? "null" : "acquired"}`);
	if (typeof acquired === "function") acquired();

	// 3) pid 不存在的旧槽位 → 不算存活
	const deadName = `gate-dead-${process.pid}-b`;
	writeLock(deadName, "slot-0.lock", 2147480000, 60_000);
	ok(gate.active(deadName) === 0, "pid 不存在的旧槽位 → 不算存活（可回收）", `active=${gate.active(deadName)}`);

	// 4) 硬上限：pid 存活但 mtime 超过 12 小时未刷新 → 回收（防 PID 复用永久占位）
	const staleName = `gate-stale-${process.pid}-c`;
	writeLock(staleName, "slot-0.lock", process.pid, 13 * 60 * 60 * 1000);
	ok(gate.active(staleName) === 0, "超过 12 小时未刷新 → 回收（防 PID 复用）", `active=${gate.active(staleName)}`);
} finally {
	for (const dir of new Set(madeDirs)) {
		try { rmSync(dir, { recursive: true, force: true }); } catch {}
	}
}

console.log(`\nGATE ALIVE TEST ${failed === 0 ? "OK" : "FAILED"} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
