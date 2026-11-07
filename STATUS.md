# STATUS — dsh-subagent-plus

## 当前

- 已发布公开仓库：GitHub `dsh-subagent-plus`（main 分支）。
- 已在 WorkHub `05-vibe-coding` 登记为 VC-011（下一号 VC-012）。
- 1.1.13：委派 label 改为「后端名 · 描述」。
- 1.1.14（未发布）：新增「子代理运行面板」——输入框上方浮层 dock（`shell.overlay`）+「子代理」Tab（`conversation.view`）+ 设置分区（`settings.section`），含统计与开关；host 增加 `runs` 快照 / `stop` 接口、`driver/parentId` 记录、实际模型采集与持久化。
- `node --check` 通过；`node scripts/build-client.mjs` 构建通过（已生成 `lib/client.js`）。
- 本地 dsh profile 当前仍是上游 1.1.12 的手改版；尚未把本仓库 1.1.14 部署到 dsh。

## 决定与约束

- 保持 npm 包名 `dsh-subagent` 与内部 id 不变；GitHub 仓库名用 `dsh-subagent-plus`。
- 不改 dsh 核心；「外部子代理无 dsh 子会话」属核心行为，不在本仓库范围。
- 面板两个视图（浮层 / Tab）共用同一份 runs 快照；开关存 localStorage，改后即时生效。
- 发布要避开 npm 上他人的 `dsh-subagent-plus@0.0.3`（同名不同物），建议加 scope 或改名。

## 待办

- 部署 1.1.14 到 dsh profile，在真实会话验证（需完全退出 dsh 后安装）。
- 待开发：「让所有子代理调用都走本插件路径」——①引导优先走插件 ②监测非托管 CLI 进程 ③PATH 命令包装强制接管，风险递增，暂不启用。
- 迭代：面板样式/字段微调、历史详情增强、范围（本会话/全部）在无会话 id 时的回退。
