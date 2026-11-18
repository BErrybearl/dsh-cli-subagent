// 退出码回归：node scripts/test-exit-code.mjs（Windows 专用，直接跑真实包装器）。
// 复现并锁死：合成 CLI 退出 7，经 hidden-runner.cjs/ps1 包装后必须仍报 7，不能回退成 0。
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cjs = join(here, "..", "lib", "hidden-runner.cjs");

let passed = 0;
let failed = 0;
function ok(cond, label, detail = "") {
	if (cond) { passed += 1; console.log(`PASS  ${label}${detail ? "  " + detail : ""}`); }
	else { failed += 1; console.log(`FAIL  ${label}${detail ? "  " + detail : ""}`); }
}

if (process.platform !== "win32") {
	console.log("SKIP  exit-code wrapper test (仅 Windows 的 hidden-runner)");
	console.log("\nEXIT-CODE TEST OK (0 passed, 0 failed, skipped)");
	process.exit(0);
}

const dirs = [];
function runCase(exitCode) {
	const dir = mkdtempSync(join(tmpdir(), `dshcli-exit-${exitCode}-`));
	dirs.push(dir);
	const cli = join(dir, "cli.cjs");
	writeFileSync(cli, `process.stdout.write('seen-${exitCode}'); process.exit(${exitCode});`);
	const stdin = join(dir, "stdin.txt");
	writeFileSync(stdin, "x");
	const stdout = join(dir, "out.txt");
	const stderr = join(dir, "err.txt");
	const cfgPath = join(dir, "cfg.hide.json");
	writeFileSync(cfgPath, JSON.stringify({
		File: process.execPath,
		Arguments: `"${cli}"`,
		Stdin: stdin,
		Stdout: stdout,
		Stderr: stderr,
		Env: {},
	}));
	const runnerErr = join(dir, "runner.err.log");
	const res = spawnSync(process.execPath, [cjs, cfgPath, runnerErr], { encoding: "utf8", timeout: 60000 });
	const out = existsSync(stdout) ? readFileSync(stdout, "utf8") : "";
	return { status: res.status, out };
}

try {
	for (const n of [7, 0, 42]) {
		const r = runCase(n);
		ok(r.status === n, `合成 CLI 退出 ${n} → 包装器退出 ${n}`, `status=${r.status}`);
		ok(r.out === `seen-${n}`, `合成 CLI 退出 ${n} 的 stdout 正确透传`, `out=${JSON.stringify(r.out)}`);
	}
} finally {
	for (const dir of dirs) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

console.log(`\nEXIT-CODE TEST ${failed === 0 ? "OK" : "FAILED"} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
