// 权限档位映射的离线断言：node scripts/test-permission-map.mjs，不引第三方框架。
import {
	PERMISSION_MODES,
	permissionArgs,
	permissionEnforceError,
	presetToMode,
	resolveInheritedMode,
	supportsPermission,
} from "../lib/permission-map.js";

let passed = 0;
let failed = 0;
function eq(actual, expected, label) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) { passed += 1; console.log(`PASS  ${label}`); }
	else { failed += 1; console.log(`FAIL  ${label}  got=${a} want=${e}`); }
}

// 1) 预设名 → 规范档位（inherit 映射）
eq(presetToMode("read-only"), "read-only", "预设 read-only → read-only");
eq(presetToMode("workspace-write"), "workspace-write", "预设 workspace-write → workspace-write");
eq(presetToMode("danger-full-access"), "danger-full-access", "预设 danger-full-access → danger-full-access");
eq(presetToMode("auto"), "danger-full-access", "预设 auto → danger-full-access");
eq(presetToMode("custom"), "workspace-write", "预设 custom → workspace-write（保守）");

// 2) 未知 / 空 preset：继承解析返回 null（调用方必须拒绝，fail-closed，绝不回退 bypass）
eq(presetToMode("weird-preset"), null, "未知预设 → null");
eq(resolveInheritedMode("weird-preset"), null, "未知预设 → null（拒绝，不回退 bypass）");
eq(resolveInheritedMode(undefined), null, "读不到(undefined) → null（拒绝，不回退 bypass）");
eq(resolveInheritedMode("auto"), "danger-full-access", "auto 继承 → danger-full-access");

// 3) 各 driver 的权限参数（逐 driver 对照实际 CLI 参数）
eq(permissionArgs("codex-json", "read-only"), ["-s", "read-only"], "codex read-only → -s read-only");
eq(permissionArgs("codex-json", "workspace-write"), ["-s", "workspace-write"], "codex workspace-write → -s workspace-write");
eq(permissionArgs("codex-json", "danger-full-access"), ["--dangerously-bypass-approvals-and-sandbox"], "codex danger-full-access → bypass flag");
eq(permissionArgs("claude-json", "read-only"), ["--permission-mode", "plan"], "claude read-only → plan");
eq(permissionArgs("claude-json", "workspace-write"), ["--permission-mode", "acceptEdits"], "claude workspace-write → acceptEdits");
eq(permissionArgs("claude-json", "danger-full-access"), ["--permission-mode", "bypassPermissions"], "claude danger-full-access → bypassPermissions");
eq(permissionArgs("qoder-json", "read-only"), ["--permission-mode", "plan"], "qoder read-only → plan");
eq(permissionArgs("qoder-json", "workspace-write"), ["--permission-mode", "accept_edits"], "qoder workspace-write → accept_edits");
eq(permissionArgs("qoder-json", "danger-full-access"), ["--permission-mode", "bypass_permissions"], "qoder danger-full-access → bypass_permissions");
eq(permissionArgs("codebuddy-json", "read-only"), ["--permission-mode", "plan"], "codebuddy read-only → plan");
eq(permissionArgs("codebuddy-json", "workspace-write"), ["--permission-mode", "acceptEdits"], "codebuddy workspace-write → acceptEdits");
eq(permissionArgs("codebuddy-json", "danger-full-access"), ["--permission-mode", "bypassPermissions"], "codebuddy danger-full-access → bypassPermissions");

// 4) 不支持的 driver 明确忽略
eq(supportsPermission("pi-json"), false, "pi 无权限开关");
eq(supportsPermission("opencode-json"), false, "opencode 无权限开关");
eq(permissionArgs("pi-json", "read-only"), null, "pi 忽略 read-only");
eq(permissionArgs("opencode-json", "danger-full-access"), null, "opencode 忽略 danger-full-access");
eq(supportsPermission("codex-json"), true, "codex 支持权限开关");

// 6) 驱动兑现不了限制 → 明确报错（fail-closed，不能默默放宽）
eq(typeof permissionEnforceError("pi-json", "read-only"), "string", "pi + read-only → 报错不能兑现");
eq(typeof permissionEnforceError("opencode-json", "workspace-write"), "string", "opencode + workspace-write → 报错不能兑现");
eq(permissionEnforceError("pi-json", "bypass_permissions"), null, "pi + bypass（放开档）→ 放行");
eq(permissionEnforceError("pi-json", "danger-full-access"), null, "pi + danger-full-access（放开档）→ 放行");
eq(permissionEnforceError("codex-json", "read-only"), null, "codex + read-only → 可兑现");

// 5) 档位常量完整
eq(PERMISSION_MODES.includes("inherit"), true, "档位表含 inherit");

console.log(`\nPERMISSION MAP TEST ${failed === 0 ? "OK" : "FAILED"} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
