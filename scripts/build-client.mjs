import { build } from "esbuild";
import { readFile, writeFile, rm } from "node:fs/promises";

// 模块 id 必须等于包名：dsh 的 client-modules 按包名校验注册项，写死旧名会报
// 「loaded without registering "<包名>" via __ModuleLoader__.load」。
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const moduleId = manifest.name;

await build({
	entryPoints: ["src/client.js"],
	outfile: "lib/client.raw.cjs",
	bundle: true,
	format: "cjs",
	platform: "browser",
	external: ["react"],
	target: "es2022",
	charset: "utf8",
});

const raw = await readFile("lib/client.raw.cjs", "utf8");
await rm("lib/client.raw.cjs");

// 构建产物只保留中文行注释，去掉 esbuild 自动生成的英文说明。
const code = raw
	.split("\n")
	.filter((line) => {
		const trimmed = line.trimStart();
		return !(trimmed.startsWith("//") && !/[\u4e00-\u9fff]/.test(trimmed));
	})
	.join("\n");

await writeFile(
	"lib/client.js",
	`window.__ModuleLoader__.load({
	id: ${JSON.stringify(moduleId)},
	factory: (require) => {
		var module = { exports: {} };
		(function (module, exports) {
${code}		})(module, module.exports);
		return module.exports;
	},
});
`,
);
console.log("built lib/client.js");
