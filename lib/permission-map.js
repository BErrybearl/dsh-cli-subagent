// 权限档位到各 CLI 参数的纯映射（不依赖 dsh 宿主，便于 scripts/test-permission-map.mjs 单测）。
//
// dsh 的 Session 投影 `permissions` 只有 `currentValue`（预设名，可能是配置键 / auto / custom）。
// 这里只做「预设名 → 规范档位」与「规范档位 → 某 driver 的 CLI 参数」两段纯逻辑；
// 读投影、降级与告警在 lib/index.js 里做。

/** 插件对外暴露的权限档位。inherit 表示继承父会话，执行前会被解析成后四者之一。 */
export const PERMISSION_MODES = ["inherit", "bypass_permissions", "read-only", "workspace-write", "danger-full-access"];

/**
 * dsh 预设名 → 规范档位。
 * - 默认预设表键 read-only / workspace-write / danger-full-access 直接对应。
 * - auto（Auto review）固定 bundle = danger-full-access + ask → 按 danger-full-access。
 * - custom（不匹配任何预设）→ 保守按 workspace-write。
 * - 其它未知预设返回 null：调用方必须拒绝这次委派并说明原因，绝不回退 bypass（fail-closed）。
 */
const PRESET_TO_MODE = {
	"read-only": "read-only",
	"workspace-write": "workspace-write",
	"danger-full-access": "danger-full-access",
	"auto": "danger-full-access",
	"custom": "workspace-write",
};

/** 预设名映射为规范档位；未知返回 null。 */
export function presetToMode(currentValue) {
	const value = String(currentValue ?? "").trim();
	return Object.hasOwn(PRESET_TO_MODE, value) ? PRESET_TO_MODE[value] : null;
}

/** inherit 解析：能映射就用映射值，否则返回 null（调用方必须拒绝，不再回退 bypass）。 */
export function resolveInheritedMode(currentValue) {
	return presetToMode(currentValue);
}

/** 各 driver 是否支持权限档位开关（pi / opencode 没有，明确忽略）。 */
export const DRIVER_PERMISSION_SUPPORT = {
	"qoder-json": true,
	"codebuddy-json": true,
	"claude-json": true,
	"codex-json": true,
	"pi-json": false,
	"opencode-json": false,
};

/** driver 是否支持权限开关。 */
export function supportsPermission(driver) {
	return DRIVER_PERMISSION_SUPPORT[driver] === true;
}

/**
 * 驱动能否兑现某个规范档位。返回 null 表示可以；返回字符串表示不能兑现的原因。
 * 无权限开关的 driver（pi/opencode）对「限制类」档位无法兑现，必须拒绝而不是默默放宽；
 * danger-full-access / bypass_permissions 属放开档，不构成放宽，允许放行。
 */
export function permissionEnforceError(driver, mode) {
	const m = String(mode ?? "").trim();
	if (supportsPermission(driver)) return null;
	if (m === "read-only" || m === "workspace-write") {
		return `${driver} 没有权限开关，无法兑现权限档位 ${m}`;
	}
	return null;
}

/**
 * 规范档位 → 该 driver 的权限相关 argv 片段；不支持或未知返回 null。
 * 由各 driver 的 buildArgs 直接拼接，测试与运行时共用同一份规则。
 */
export function permissionArgs(driver, mode) {
	const m = String(mode ?? "").trim();
	switch (driver) {
		case "codex-json":
			if (m === "read-only") return ["-s", "read-only"];
			if (m === "workspace-write") return ["-s", "workspace-write"];
			if (m === "danger-full-access" || m === "bypass_permissions") return ["--dangerously-bypass-approvals-and-sandbox"];
			return null;
		case "claude-json":
			if (m === "read-only") return ["--permission-mode", "plan"];
			if (m === "workspace-write") return ["--permission-mode", "acceptEdits"];
			if (m === "danger-full-access" || m === "bypass_permissions") return ["--permission-mode", "bypassPermissions"];
			return null;
		case "qoder-json":
			// qoder 现有默认直接透传 snake 值，沿用其取值风格。
			if (m === "read-only") return ["--permission-mode", "plan"];
			if (m === "workspace-write") return ["--permission-mode", "accept_edits"];
			if (m === "danger-full-access" || m === "bypass_permissions") return ["--permission-mode", "bypass_permissions"];
			return null;
		case "codebuddy-json":
			if (m === "read-only") return ["--permission-mode", "plan"];
			if (m === "workspace-write") return ["--permission-mode", "acceptEdits"];
			if (m === "danger-full-access" || m === "bypass_permissions") return ["--permission-mode", "bypassPermissions"];
			return null;
		// pi-json / opencode-json 没有权限开关：明确忽略（调用方 warning 一次）。
		default:
			return null;
	}
}
