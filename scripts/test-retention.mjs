// 资源卫生保留策略的离线断言：node scripts/test-retention.mjs 直接跑，不引第三方框架。
// 全部在临时目录里造数据，绝不触碰真实 ~/.dsh。
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_RUN_BYTES,
	TAIL_READ_BYTES,
	applyRetention,
	dirSizeBytes,
	readTailChunk,
	sweepOrphanRunFiles,
} from "../lib/retention.js";

let passed = 0;
let failed = 0;
function ok(cond, label, detail = "") {
	if (cond) {
		passed += 1;
		console.log(`PASS  ${label}${detail ? "  " + detail : ""}`);
	} else {
		failed += 1;
		console.log(`FAIL  ${label}${detail ? "  " + detail : ""}`);
	}
}
function newDir(tag) {
	return mkdtempSync(join(tmpdir(), `dshcli-retention-${tag}-`));
}
function writeSized(path, bytes, fill) {
	const chunk = Buffer.from(fill ?? "x");
	writeFileSync(path, Buffer.alloc(bytes, chunk));
}

const dirs = [];
try {
	// --- 1) 30 条运行（3 条 5MB），保留 24 条并删掉被淘汰的 transcript ---
	const d1 = newDir("runs30");
	dirs.push(d1);
	const metas = [];
	for (let i = 0; i < 30; i += 1) {
		const id = `run-${String(i).padStart(2, "0")}`;
		// 数组顺序 = 索引顺序（最新在前）；endedAt 递减表示越往后越旧。
		metas.push({ id, status: "completed", startedAt: 1000 + (30 - i), endedAt: 1000 + (30 - i) });
		// 最新的 3 条写 5MB 假日志，其余写小日志。
		if (i < 3) writeSized(join(d1, `${id}.jsonl`), 5 * 1024 * 1024, "a");
		else writeFileSync(join(d1, `${id}.jsonl`), `{"line":${i}}\n`);
	}
	const before = dirSizeBytes(d1);
	const r1 = applyRetention(d1, metas, { maxRuns: 24 });
	ok(r1.kept.length === 24, "索引保留 24 条", `kept=${r1.kept.length}`);
	const evicted = metas.slice(24);
	ok(evicted.every((m) => !existsSync(join(d1, `${m.id}.jsonl`))), "被淘汰的 .jsonl 已删除", `evicted=${evicted.length}`);
	ok(metas.slice(0, 24).every((m) => existsSync(join(d1, `${m.id}.jsonl`))), "保留的 .jsonl 仍在");
	const after = dirSizeBytes(d1);
	ok(after <= MAX_RUN_BYTES, "目录总体积 ≤ MAX_RUN_BYTES", `${(after / 1024 / 1024).toFixed(1)}MB / ${(MAX_RUN_BYTES / 1024 / 1024).toFixed(0)}MB, 前 ${(before / 1024 / 1024).toFixed(1)}MB`);

	// --- 2) 总量预算：超预算时按 endedAt 从旧到新删 transcript，索引行保留 ---
	const d2 = newDir("budget");
	dirs.push(d2);
	const bmetas = [];
	for (let i = 0; i < 5; i += 1) {
		const id = `b-${i}`;
		// 数组最新在前，endedAt 递减 → b-4 最旧。
		bmetas.push({ id, status: "completed", startedAt: 100 + (5 - i), endedAt: 100 + (5 - i) });
		writeSized(join(d2, `${id}.jsonl`), 400 * 1024);
	}
	const totalBefore = dirSizeBytes(d2);
	const r2 = applyRetention(d2, bmetas, { maxRuns: 24, maxBytes: 1024 * 1024 });
	const totalAfter = dirSizeBytes(d2);
	ok(r2.kept.length === 5, "预算淘汰后索引行仍保留", `rows=${r2.kept.length}`);
	ok(totalAfter <= 1024 * 1024, "目录总量降到预算内", `${(totalBefore / 1024).toFixed(0)}KB -> ${(totalAfter / 1024).toFixed(0)}KB ≤ 1024KB`);
	ok(!existsSync(join(d2, "b-4.jsonl")), "最旧 transcript 先被删", "b-4 应已删除");

	// --- 3) 孤儿清扫：只删不在索引里的 .jsonl/.err.log ---
	const d3 = newDir("orphan");
	dirs.push(d3);
	writeFileSync(join(d3, "a.jsonl"), "{}\n");
	writeFileSync(join(d3, "b.jsonl"), "{}\n");
	writeFileSync(join(d3, "orphan.jsonl"), "{}\n");
	writeFileSync(join(d3, "ghost.err.log"), "err\n");
	writeFileSync(join(d3, "index.json"), "[]");
	writeFileSync(join(d3, "a.prompt.txt"), "p");
	const removed = sweepOrphanRunFiles(d3, new Set(["a", "b"]));
	ok(removed === 2, "孤儿清扫删除 2 个孤立文件", `removed=${removed}`);
	ok(existsSync(join(d3, "a.jsonl")) && existsSync(join(d3, "b.jsonl")), "索引内的文件保留");
	ok(!existsSync(join(d3, "orphan.jsonl")) && !existsSync(join(d3, "ghost.err.log")), "孤立 .jsonl/.err.log 已删除");
	ok(existsSync(join(d3, "index.json")) && existsSync(join(d3, "a.prompt.txt")), "index.json / prompt 不受影响");

	// --- 4) 尾部读取：5MB 的 completed transcript 只读末尾约 256KB ---
	const d4 = newDir("tail");
	dirs.push(d4);
	const bigPath = join(d4, "big.jsonl");
	const head = `{"marker":"HEAD"}\n`;
	const filler = `${JSON.stringify({ t: 1, text: "填充行".repeat(20) })}\n`.repeat(1);
	// 先写头标记，再堆大量填充行，最后写尾标记，凑到约 5MB。
	let body = head + filler;
	const unit = `${JSON.stringify({ t: 2, text: "历史事件".repeat(30) })}\n`;
	while (Buffer.byteLength(body, "utf8") < 5 * 1024 * 1024) body += unit;
	body += `{"marker":"TAIL-END"}\n`;
	writeFileSync(bigPath, body);
	const fileSize = statSync(bigPath).size;
	const tail = readTailChunk(bigPath);
	const readBytes = Buffer.byteLength(tail, "utf8");
	ok(readBytes > 0 && readBytes <= TAIL_READ_BYTES + 4096, "尾部读取字节数 ≈ 256KB 上限", `file=${(fileSize / 1024 / 1024).toFixed(2)}MB, read=${(readBytes / 1024).toFixed(0)}KB`);
	ok(tail.includes("TAIL-END"), "尾部读取包含最新内容");
	ok(!tail.includes("HEAD"), "尾部读取不含文件头（未从头全量解析）");
	ok(readBytes < fileSize * 0.2, "读取量远小于文件总量（不被历史拖累）", `${((readBytes / fileSize) * 100).toFixed(1)}%`);

	// --- 5) 活跃项保护：>24 条且含 running，running 不被裁剪/删除 ---
	const d5 = newDir("active");
	dirs.push(d5);
	const am = [];
	for (let i = 0; i < 28; i += 1) {
		const id = `a-${String(i).padStart(2, "0")}`;
		// a-26 位于第 27 条（超过 24 会被裁），标记为 running。
		const status = i === 26 ? "running" : "completed";
		am.push({ id, status, startedAt: 1000 + (28 - i), endedAt: status === "running" ? null : 1000 + (28 - i) });
		writeFileSync(join(d5, `${id}.jsonl`), "{}\n");
	}
	const r5 = applyRetention(d5, am, { maxRuns: 24 });
	const runningMeta = am.find((m) => m.status === "running");
	ok(r5.kept.includes(runningMeta), "running 行未被淘汰", `kept=${r5.kept.length}`);
	ok(existsSync(join(d5, `${runningMeta.id}.jsonl`)), "running 的 transcript 未被删除");
	ok(r5.evicted.some((m) => m.id === "a-27"), "最旧的非 running 项被淘汰", `evicted=${r5.evicted.map((m) => m.id).join(",")}`);
	ok(r5.kept.filter((m) => m.status !== "running").length <= 24, "非 running 保留数不超过上限");
} finally {
	for (const dir of dirs) {
		try { rmSync(dir, { recursive: true, force: true }); } catch {}
	}
}

console.log(`\nRETENTION TEST ${failed === 0 ? "OK" : "FAILED"} (${passed} passed, ${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
