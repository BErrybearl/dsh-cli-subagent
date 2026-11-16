// 运行记录的资源卫生：保留策略、孤儿清扫与尾部读取。
// 纯 Node 实现、不依赖 dsh 宿主，便于 scripts/test-retention.mjs 直接单元测试。
import { closeSync, fstatSync, openSync, readdirSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** 运行记录目录的总量预算：超出后按 endedAt 从旧到新删除 transcript（索引行保留）。 */
export const MAX_RUN_BYTES = 256 * 1024 * 1024;
/** 启动恢复时单份 transcript 只读文件末尾约这么多字节。 */
export const TAIL_READ_BYTES = 256 * 1024;
/** 单份 transcript 恢复时最多保留的尾部事件数。 */
export const MAX_TAIL_EVENTS = 60;
/** 孤儿清扫的低频周期。 */
export const ORPHAN_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** 一条运行的转录文件（.jsonl 与 .err.log）。 */
export function runTranscriptFiles(dir, id) {
	return [join(dir, `${id}.jsonl`), join(dir, `${id}.err.log`)];
}

/** 删除单条运行的转录（transcript）文件。 */
export function removeRunTranscript(dir, id) {
	for (const path of runTranscriptFiles(dir, id)) {
		try { rmSync(path, { force: true }); } catch {}
	}
}

/** 删除单条运行的全部产物文件（转录 + prompt + hide.json）。 */
export function removeRunArtifacts(dir, id) {
	removeRunTranscript(dir, id);
	try { rmSync(join(dir, `${id}.prompt.txt`), { force: true }); } catch {}
	try { rmSync(join(dir, `${id}.hide.json`), { force: true }); } catch {}
}

/** 目录内全部普通文件的总字节数。 */
export function dirSizeBytes(dir) {
	let total = 0;
	let entries;
	try { entries = readdirSync(dir); } catch { return 0; }
	for (const name of entries) {
		try {
			const stat = statSync(join(dir, name));
			if (stat.isFile()) total += stat.size;
		} catch {}
	}
	return total;
}

/** 单条运行转录占用的字节数。 */
export function transcriptBytes(dir, id) {
	let total = 0;
	for (const path of runTranscriptFiles(dir, id)) {
		try { total += statSync(path).size; } catch {}
	}
	return total;
}

/**
 * 应用保留策略并返回保留后的索引行。会实际删除文件：
 * 1) 超出 maxRuns 的旧行：连同其 transcript/prompt/hide 一并删除（被淘汰）。
 * 2) 目录总量超出 maxBytes 时：按 endedAt 从旧到新删除 transcript（索引行保留、running 跳过）。
 */
export function applyRetention(dir, runs, { maxRuns = 24, maxBytes = MAX_RUN_BYTES } = {}) {
	const list = Array.isArray(runs) ? runs : [];
	const kept = list.slice(0, maxRuns);
	const evicted = list.slice(maxRuns);
	for (const meta of evicted) {
		if (meta?.id) removeRunArtifacts(dir, meta.id);
	}
	let total = dirSizeBytes(dir);
	if (total > maxBytes) {
		const candidates = kept
			.filter((meta) => meta?.id && meta.status !== "running")
			.slice()
			.sort((a, b) => (a.endedAt ?? a.startedAt ?? 0) - (b.endedAt ?? b.startedAt ?? 0));
		for (const meta of candidates) {
			if (total <= maxBytes) break;
			const before = transcriptBytes(dir, meta.id);
			removeRunTranscript(dir, meta.id);
			total -= before;
		}
	}
	return { kept, evicted };
}

/**
 * 孤儿清扫：删除 runs 目录里 basename 不在索引中的 `.jsonl` / `.err.log`。
 * 只清理这两类运行产物，不碰 index.json、*.tmp、prompt、hide。
 */
export function sweepOrphanRunFiles(dir, keepIds) {
	const keep = keepIds instanceof Set ? keepIds : new Set(keepIds ?? []);
	let entries;
	try { entries = readdirSync(dir); } catch { return 0; }
	let removed = 0;
	for (const name of entries) {
		let id = null;
		if (name.endsWith(".jsonl")) id = name.slice(0, -".jsonl".length);
		else if (name.endsWith(".err.log")) id = name.slice(0, -".err.log".length);
		if (id === null) continue;
		if (keep.has(id)) continue;
		try { rmSync(join(dir, name), { force: true }); removed += 1; } catch {}
	}
	return removed;
}

/**
 * 从文件末尾读取约 maxBytes 字节并对齐到首个换行，避免从半行开始解析。
 * 返回的文本只会包含完整行（文件很小时从文件头开始，不丢内容）。
 */
export function readTailChunk(path, maxBytes = TAIL_READ_BYTES) {
	let fd;
	try { fd = openSync(path, "r"); } catch { return ""; }
	try {
		const size = fstatSync(fd).size;
		const start = Math.max(0, size - Math.max(0, maxBytes));
		const length = size - start;
		if (length <= 0) return "";
		const buffer = Buffer.alloc(length);
		readSync(fd, buffer, 0, length, start);
		let text = buffer.toString("utf8");
		if (start > 0) {
			const newline = text.indexOf("\n");
			text = newline >= 0 ? text.slice(newline + 1) : "";
		}
		return text;
	} catch {
		return "";
	} finally {
		closeSync(fd);
	}
}
