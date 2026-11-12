/**
 * dsh 内部包的兼容层。
 *
 * dsh 升级会改动内部包的导出与投影字段，这里把对内部包的 import 收拢到一处：
 * 任一包缺失或导出改名时只降级对应功能（跳过注册、用等价实现），
 * 插件本身仍然能加载，并在控制台留一行 `[dsh-subagent] compat: ...` 说明缺什么。
 *
 * 降级只用于**能与官方实现等价**的几处（会话 id 品牌、消息冻结、摘要截断）；
 * 不等价的（建工具定义）一律不降级：缺了就跳过注册，绝不塞假实现。
 */
import { randomUUID } from "node:crypto";

/** 已报告过的降级说明，同一条只打一次，避免每次调用刷屏。 */
const reported = new Set();
function report(text) {
	if (reported.has(text)) return;
	reported.add(text);
	try {
		console.warn(`[dsh-subagent] compat: ${text}`);
	} catch {}
}

/** 动态解析一个内部包；解析失败只返回错误，不往上抛。 */
async function load(specifier) {
	try {
		return { module: await import(specifier) };
	} catch (error) {
		return { error };
	}
}

const tools = await load("@deepseek-ai/dsh-tools");
const llm = await load("@deepseek-ai/dsh-llm");
const session = await load("@deepseek-ai/dsh-session");

/** 取一个函数导出；不是函数就当没有。 */
function pick(loaded, key) {
	const value = loaded.module?.[key];
	return typeof value === "function" ? value : undefined;
}

function reasonOf(loaded) {
	const error = loaded.error;
	return String(error?.code || error?.message || error || "unknown").slice(0, 120);
}

/** 官方 `boundContextSummary` 的上限（dsh-llm 的 CONTEXT_SUMMARY_MAX_CHARS）。 */
const CONTEXT_SUMMARY_MAX_CHARS = 120;

/**
 * 摘要截断的等价实现：`notice` 的 summary 只允许一行且不超过 120 字符。
 * 恒等会让超长摘要漏到宿主，所以这里按官方规则截断，不做假实现。
 */
function fallbackBoundContextSummary(summary) {
	const text = typeof summary === "string" ? summary : String(summary ?? "");
	return text.length <= CONTEXT_SUMMARY_MAX_CHARS
		? text
		: `${text.slice(0, CONTEXT_SUMMARY_MAX_CHARS - 1)}…`;
}

/** 递归冻结，与 dsh-llm 的 deepFreeze 同效（消息发出后不可再被改动）。 */
function deepFreeze(value) {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const key of Object.keys(value)) deepFreeze(value[key]);
	return Object.freeze(value);
}

/**
 * 建消息的等价实现：官方是 `deepFreeze(structuredClone({...input, role:'user', id:uuid}))`，
 * 这里逐字照搬这套形状，只是不经过 `@deepseek-ai/dsh-llm`。
 * 调用方都自带 content/source，不会出现字段缺省的对象。
 */
function fallbackCreateUserMessage(input) {
	if (!input || typeof input !== "object") throw new TypeError("createUserMessage requires an input object");
	if (input.content === undefined) throw new TypeError("createUserMessage requires content");
	return deepFreeze(structuredClone({ ...input, id: randomUUID(), role: "user" }));
}

/**
 * 会话 id 品牌的等价实现：官方 `SessionId` 就是 `brandString(value)`，
 * 运行时返回原字符串（类型层面才有区别），因此恒等降级在语义上是精确的。
 */
function fallbackSessionId(value) {
	return value;
}

export const defineTool = pick(tools, "defineTool");
export const createUserMessage = pick(llm, "createUserMessage") ?? fallbackCreateUserMessage;
export const boundContextSummary = pick(llm, "boundContextSummary") ?? fallbackBoundContextSummary;
export const SessionId = pick(session, "SessionId") ?? fallbackSessionId;

/** 各内部包的实际可用情况；调用方据此决定跳过哪些注册。 */
export const capabilities = {
	defineTool: Boolean(defineTool),
	llm: Boolean(pick(llm, "createUserMessage") && pick(llm, "boundContextSummary")),
	session: Boolean(pick(session, "SessionId")),
};

if (!capabilities.defineTool) {
	report(`缺 @deepseek-ai/dsh-tools 的 defineTool（${reasonOf(tools)}），委派工具与 sub_agent_status 不注册`);
}
if (!capabilities.llm) {
	report(`@deepseek-ai/dsh-llm 不完整（${reasonOf(llm)}），改用等价的本地消息构造与摘要截断`);
}
if (!capabilities.session) {
	report(`缺 @deepseek-ai/dsh-session 的 SessionId（${reasonOf(session)}），会话 id 按原字符串使用（与官方品牌等价）`);
}

/** 取服务；取值抛错按缺失处理。 */
function serviceOf(ctx, name) {
	try {
		return ctx?.get?.(name);
	} catch {
		return undefined;
	}
}

/**
 * 运行时探测 dsh 服务形态。
 *
 * 默认只在首次探测到缺服务时留一行说明（只针对 subagents：投影/会话服务由调用方
 * 在真正用到时自行报告，避免不相关的调用点刷假警告），不抛错；`quiet` 用于启动期
 * 的预探测（服务可能还没注册，此时的缺失不代表真的没有）。
 * @param ctx 插件作用域（用 ctx.get(name) 取服务）。
 * @param options `quiet: true` 表示只探测不报告。
 * @returns 能力标志。
 */
export function probeServices(ctx, options) {
	const subagents = serviceOf(ctx, "subagents");
	const projections = serviceOf(ctx, "sessionProjections");
	const sessions = serviceOf(ctx, "sessions");
	const flags = {
		subagents: Boolean(subagents),
		interrupt: typeof subagents?.interrupt === "function",
		sendMessage: typeof subagents?.sendMessage === "function",
		sessionProjections: typeof projections?.snapshot === "function",
		sessions: typeof sessions?.get === "function" && typeof sessions?.list === "function",
	};
	if (options?.quiet === true) return flags;
	if (!flags.subagents) report("ctx.get('subagents') 不可用，内置子代理中断 RPC 一律返回 unsupported");
	else if (!flags.interrupt) report("subagents 服务没有 interrupt()，内置子代理中断 RPC 一律返回 unsupported");
	return flags;
}

export { report as reportDegradation };
