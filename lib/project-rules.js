// 项目规则提醒的纯逻辑（不依赖 dsh 宿主，便于 scripts/test-permission-map.mjs 单测）。
//
// applyProjectRules：projectRules=auto 且委派 cwd 或其上级存在 AGENTS.md 时，
// 在 prompt 最前面加一行简短环境说明（权限档位 + 遵守该目录 AGENTS.md 的纪律）。
// 只加这一行，不改用户任务正文；off 关闭。
//
// cwd 未传时（工具省略 cwd 是最常见的情况）子进程按宿主 process.cwd() 启动，
// 所以这里也退回 process.cwd() 去找 AGENTS.md，否则治理提醒在最常见场景永远不注入。

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 从 dir 逐级向上找 AGENTS.md；找到返回其所在目录，否则 null。
 * dir 省略或为空时默认用 process.cwd()（对齐子进程真实工作目录）。
 */
export function findAgentsMdUpwards(dir = process.cwd()) {
	let current = String(dir ?? "").trim();
	if (!current) current = process.cwd();
	let guard = 0;
	while (current && guard < 64) {
		try {
			if (existsSync(join(current, "AGENTS.md"))) return current;
		} catch {}
		const parent = dirname(current);
		if (!parent || parent === current) break;
		current = parent;
		guard += 1;
	}
	return null;
}

/**
 * 项目规则提醒：enabled 且 cwd（或退回 process.cwd()）其上级有 AGENTS.md 时，
 * 在 prompt 最前面加一行环境说明。返回 { prompt, injected }。
 */
export function applyProjectRules({ enabled, cwd, prompt, mode }) {
	if (!enabled) return { prompt, injected: false };
	const dir = cwd ?? process.cwd();
	if (!findAgentsMdUpwards(dir)) return { prompt, injected: false };
	const line = `【环境】权限档位=${mode}；遵守本目录 AGENTS.md：改动走独立分支/worktree、按路径提交、不合并主分支、不推送。`;
	return { prompt: `${line}\n\n${prompt}`, injected: true };
}
