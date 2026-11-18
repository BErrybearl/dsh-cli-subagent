const { spawn } = require("node:child_process");
const { openSync } = require("node:fs");
const path = require("node:path");

// 以隐藏控制台托管 CLI:本进程保持 detached 以便 dsh 崩溃后继续运行,
// PowerShell 为 CLI 创建不可见控制台,避免其 shell 子进程弹黑框。
const configPath = process.argv[2];
const errPath = process.argv[3];
if (!configPath) process.exit(2);
let errFd = "ignore";
try {
	if (errPath) errFd = openSync(errPath, "a");
} catch {}
const child = spawn("powershell.exe", [
	"-NoProfile",
	"-ExecutionPolicy", "Bypass",
	"-File", path.join(__dirname, "hidden-runner.ps1"),
	"-ConfigPath", configPath,
], { windowsHide: true, stdio: ["ignore", "ignore", errFd] });
// 125 = EXIT_CODE_UNKNOWN：与 hidden-runner.ps1 约定的哨兵。拿不到退出码时回退它，
// 绝不回退 0；上层（lib/index.js）把非 0（含 125）判为失败/未知，不再谎报成功。
const EXIT_CODE_UNKNOWN = 125;
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? EXIT_CODE_UNKNOWN));
