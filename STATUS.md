# STATUS — dsh-subagent-plus

## 当前

- 已发布公开仓库：GitHub `dsh-subagent-plus`（main 分支）。
- 已在 WorkHub `05-vibe-coding` 登记为 VC-011（下一号 VC-012）。
- 1.1.13：委派 label 改为「后端名 · 描述」。
- 1.1.15（未发布）：修正 dock 位置（`conversation.input.dock`，输入框正上方）、会话串号（按 `sessionId` 过滤）、
  重启后旧记录假弹出（`restored` 标记）；dock 加 ✕ 隐藏、默认收起、有新运行自动展开；六个开关迁到插件配置
  `panel` 节点（`cordis.patch.yml` 可见，设置界面写回、即时生效，失败退回本地）。
- `node --check` 通过；`node scripts/build-client.mjs` 构建通过（已生成 `lib/client.js`）。
- 本地 dsh profile 已装本仓库 1.1.14（`github:BErrybearl/dsh-subagent-plus#f8b9214`）；1.1.15 待重新安装。

## 决定与约束

- 保持 npm 包名 `dsh-subagent` 与内部 id 不变；GitHub 仓库名用 `dsh-subagent-plus`。
- 不改 dsh 核心；「外部子代理无 dsh 子会话」属核心行为，不在本仓库范围。
- 面板两个视图（dock / Tab）共用同一份 runs 快照；开关存插件配置 `panel` 节点，改后即时生效（volatile）。
- dock 槽位为 `conversation.input.dock`（list, session 作用域，props 带 sessionId）；`shell.overlay` 是页面级浮层，已弃用。
- 发布要避开 npm 上他人的 `dsh-subagent-plus@0.0.3`（同名不同物），建议加 scope 或改名。

## 待办

- 部署 1.1.15 到 dsh profile，在真实会话验证（需完全退出 dsh 后安装；命令行里 `DSH_HOME` 要指向 dsh 主目录，否则会报「先打开一次再完全退出」）。
- 待开发：「让所有子代理调用都走本插件路径」——①引导优先走插件 ②监测非托管 CLI 进程 ③PATH 命令包装强制接管，风险递增，暂不启用。
- 迭代：面板样式/字段微调、历史详情增强、范围（本会话/全部）在无会话 id 时的回退。
