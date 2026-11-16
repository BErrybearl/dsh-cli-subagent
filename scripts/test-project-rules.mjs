// 项目规则提醒的离线断言：node scripts/test-project-rules.mjs，不引第三方框架。
// 重点覆盖「工具省略 cwd」这一最常见场景：应回退宿主 process.cwd() 找 AGENTS.md。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProjectRules, findAgentsMdUpwards } from "../lib/project-rules.js";

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) { passed += 1; console.log(`PASS  ${label}`); }
	else { failed += 1; console.log(`FAIL  ${label}  got=${a} want=${e}`); }
}

const root = mkdtempSync(join(tmpdir(), "ds-hub-rules-"));
const nested = join(root, "a", "b");
const origCwd = process.cwd();
try {
	mkdirSync(nested, { recursive: true });
	writeFileSync(join(root, "AGENTS.md"), "# rules\n");

	// 1) 从子目录逐级向上找到 AGENTS.md 所在目录
	eq(findAgentsMdUpwards(nested), root, "从子目录向上找到 AGENTS.md");

	// 2) 省略/空 cwd → 回退 process.cwd()（对齐子进程真实工作目录）
	try {
		process.chdir(nested);
		eq(findAgentsMdUpwards(""), root, "空字符串 cwd 回退 process.cwd() 命中");
		eq(findAgentsMdUpwards(), root, "省略 dir 回退 process.cwd() 命中");

		// 3) applyProjectRules：无 cwd 时也应注入（最常见场景）
		const r = applyProjectRules({ enabled: true, cwd: undefined, prompt: "TASK", mode: "workspace-write" });
		eq(r.injected, true, "applyProjectRules 无 cwd 时也注入");
		eq(r.prompt.startsWith("【环境】") && r.prompt.endsWith("TASK"), true, "注入说明加在 prompt 最前、不改正文");

		// 4) off 关闭注入
		eq(applyProjectRules({ enabled: false, cwd: nested, prompt: "T", mode: "x" }).injected, false, "off 关闭注入");
	} finally {
		process.chdir(origCwd);
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log(`\nPROJECT RULES TEST ${failed === 0 ? "OK" : "FAILED"} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
