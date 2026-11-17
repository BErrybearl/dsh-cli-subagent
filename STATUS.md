# STATUS — dsh-cli-hub

## 当前

- 2.0.6（已合并 main + tag v2.0.6 已推 GitHub，未发 npm）：dock UI 调整。dock 宽度改与输入卡（会话区列）一致并居中（用宿主 `--dsh-composer-side-clearance` / `--dsh-composer-card-max-width` 变量）；卡片由「单行+点击逐项展开」改为两行——上行固定状态列，下行「任务 / 进度 / 步骤」横向平铺、始终可见、缺值占位对齐；dock 默认展开；去掉逐项折叠与 activity 轮询（进度用 runs 快照 `lastEvent`、步骤用 `eventCount`）。
- 2.0.5（已合并 main + tag v2.0.5 已推 GitHub，未发 npm）：P1 四个风险 + 一个治理项 + P2 命名/UI 收敛。
  ①权限透传：新增后端 `permissionMode`（默认由 `bypass_permissions` 改为 `inherit`），inherit 读父会话 `permissions.currentValue` 映射到 codex/claude/qoder/codebuddy 实际参数，读不到/未知→回退 `bypass_permissions`+警告一次，pi/opencode 忽略并警告，activity 记 `权限: <值>`。
  ②默认超时 `timeoutSeconds=1800`，0 为不限。
  ③并发锁改为 pid 存活为主 + 12 小时硬上限。
  ④外部观测默认关，`job.label` 显示、去掉 `-Task/-Model/-Thinking` 解析，无 parentId 时最多扫 5 个 live 会话并缓存 5 秒。
  ⑤新增 `projectRules`（默认 auto）：cwd 上级有 AGENTS.md 时 prompt 前加一行环境说明。
  ⑥设置分区 id 统一 `dsh-cli-hub`（同步 README/docs）。
  ⑦新增 `panel.showTab`（默认 false，控制 Tab 是否注册；dock 保留、Tab 未注册时 ↗ 隐藏）。
  新增 `scripts/test-permission-map.mjs`、`scripts/test-gate-alive.mjs` 并纳入 `check.ps1`。
- 2.0.4（已合并 main + tag v2.0.4 已推 GitHub，未发 npm）：运行记录资源卫生 P0。
  ①保留策略：`writeRunIndex` 淘汰旧行时同步删 transcript/prompt/hide；新增 `MAX_RUN_BYTES = 256MB`，
  超预算按 `endedAt` 旧→新删 transcript（索引行保留、running 跳过）。
  ②启动只读尾部：completed/error 用 `readTailChunk` 只读末尾约 256KB、最多 60 事件，不再从头 fold；running 仍按 offset 增量。
  ③轮询收敛：`QoderToolView` settle 即停；`activity` 事件裁到最近 80 条并带 `eventCount`。
  ④孤儿清扫：启动一次 + 每 10 分钟，只删不在索引的 `.jsonl/.err.log`。
  pi-run 外部观测 / 权限默认 / 命名 / UI / engines 均未动；新增 `scripts/test-retention.mjs` 并纳入 `check.ps1`。
- 2.0.3（未发布）：新增「外部脚本任务」观测——只读 dsh 的 `jobs` 服务，把命令行含匹配关键字的后台任务
  （默认 `pi-run.ps1`）映射成面板行，与插件自身运行混排；新增面板开关 `includeExternal`（默认开）与
  `externalMatch`（默认 `pi-run.ps1`，可改）；`stop` 路由支持 `ext:` 前缀，转调 `jobs.kill`。
  只覆盖 dsh 后台 job 跑的脚本，绕过 dsh 的终端手跑 / `Start-Job` / 别的程序拉起的进程看不到。
- 2.0.2 更名：npm 包名 `dsh-cli-subagent` → `dsh-cli-hub`，插件 id 与配置节点同步为 `dsh-cli-hub`；
  GitHub 仓库名保留 `BErrybearl/dsh-cli-subagent`。同版修复所有后端派发的 `reading 'id'` undefined
  （startActivation spec 平铺）。**未发布 npm**（用户暂无账号），本机 desktop profile 依赖
  `github:BErrybearl/dsh-cli-subagent#v2.0.2`，用 dsh 自带 pnpm 装。
- 2.0.0 新增 `lib/compat.js`：内部包引用（`dsh-tools` 的 `defineTool`、`dsh-llm` 的 `createUserMessage` /
  `boundContextSummary`、`dsh-tool-subagent`、`dsh-session` 的 `SessionId`）改为能力探测，缺包/缺导出只降级并打
  `[dsh-subagent] compat: ...` 警告，插件仍能加载；`apply` 启动时跑一次服务探测。
- 2.0.0 内置子代理：`runs` 快照新增 `natives`（`subagentCatalog` 取真实名字，`subagentTiming` 算耗时，
  带 `activity` / `live` / `turnRunning` / `elapsedMs`，读不到返回 null，最多 200 条）；
  新增 `native-interrupt` 路由，内置子代理可从面板中断，缺服务时返回 `{ok:false,error:'unsupported'}`。
- 2.0.0 `scan` 加 60 秒缓存（`refresh:true` / `?refresh=1` 强刷）与 `fast:true` 快速模式（只查 PATH 与已知固定路径）。
- 1.1.26：管理面板在「设置 → 子代理」（`settings.section`，id `qoder-subagent`，order 17），补分区图标；
  后端列表为「已配置 ∪ 本机检测到」；host 有 `scan` 与 `backend-check` 两个只读路由。设计文档 `docs/settings-section-design.md`。
- 1.1.25 及以前见 [CHANGES.md](./CHANGES.md)；1.1.13 起委派 label 为「后端名 · 描述」。
- 已在 WorkHub `05-vibe-coding` 登记为 VC-011（下一号 VC-012）。
- `node --check lib/index.js` 通过；`node scripts/build-client.mjs` 构建通过（已生成 `lib/client.js`）。
- 本机 desktop profile 已装 2.0.5（`github:BErrybearl/dsh-cli-subagent#v2.0.5`，dsh 自带 pnpm 装进 node_modules）。本机 git 需配代理
  `http(s).proxy=http://127.0.0.1:28080`（pnpm 解析 `github:` 要先 `git ls-remote`），换机器或代理端口变了要同步改。

## 决定与约束

- 包名改为 `dsh-cli-subagent`：npm 上 `dsh-subagent` 被他人占位 0.0.1、`dsh-subagent-plus` 被他人占用 0.0.3，
  旧名会被插件管理器误判为「可更新」；内部插件 id 保持 `subagent-cli` 不变，避免已装用户的配置节点认不出来。
- 只支持 dsh `>=0.2.2-rc.1 <0.3.0`；对 dsh 内部包一律经 `lib/compat.js` 探测后使用，不做版本号硬判断。
- 不改 dsh 核心；「外部子代理无 dsh 子会话」属核心行为，不在本仓库范围。
- 面板两个视图（dock / Tab）与设置页共用同一份 runs 快照；开关存插件配置 `panel` 节点，改后即时生效（volatile）。
- dock 槽位为 `conversation.input.dock`（list，session 作用域，props 带 sessionId）；`shell.overlay` 已弃用。

## 待办

- 待开发：「让所有子代理调用都走本插件路径」的剩下两档——①引导优先走插件（规则层）②PATH 命令包装强制接管，
  风险递增，暂不启用。2.0.3 只补了「dsh 后台 job 里的脚本任务」这一种，不覆盖进程级扫描。
- 待开发：升级/禁用期间暂停查询（`ctx.pluginChanges.bundle(packageName)`）；停用后是否清理存储与进程策略。
- 迭代（设置界面，下一版统一改）：①两列布局改 `auto-fit minmax(260px,1fr)`，窄屏单列；
  ②「数据」拆成「观测范围」组（内置子代理 / 外部脚本任务 / 匹配关键字）；③匹配关键字加「当前匹配 N 条」反馈；
  ④后端区块默认折叠成一行；⑤「恢复默认」加二次确认。
- 待实测（2.0.3 装后）：①用 `pwsh` 跑 `pi-run.ps1` 起一个 pi，dock / Tab 里出现「外部脚本」行，任务名/强度/耗时正确；
  ②点「停止」能真的 kill 掉该 job；③关掉 `includeExternal` 后外部行消失，插件自身运行不受影响；
  ④`externalMatch` 改成别的关键字（如 `pi-run`）后仍能命中。
- 待实测（2.0.0 装后）：①设置侧边栏「子代理」一行有本插件图标（槽位缺失时回退默认齿轮，不影响分区）；
  ②打开 `includeNative` 后内置子代理显示真实名字与耗时，不再是 `—`；③内置子代理的「中断」按钮能停掉，
  dsh 无该服务时给出「不支持」而不是报错；④dock / Tab / 设置三处数字一致（运行、完成、出错）。
- 待实测（2.0.0 装后）：①缺 `dsh-llm` 等内部包时插件仍能加载，控制台只有 `compat:` 警告；
  ②`scan` 二次调用返回 `cached:true`，带 `refresh:true` 会重扫；③`fast:true` 不扫用户 bin 与 npm 目录但能列出已装 CLI。
