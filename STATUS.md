# STATUS — dsh-subagent-plus

## 当前

- 已发布公开仓库：GitHub `dsh-subagent-plus`（main 分支）。
- 已在 WorkHub `05-vibe-coding` 登记为 VC-011（下一号 VC-012）。
- 1.1.24（未发布）：修面板写回协议（按 key 发 {key,value}、reset 清本地覆盖）与 providers 整段覆盖丢字段；停用后端保留设置（新增 enabled 字段）；管理面板合并到「插件 › 本插件详情」，删掉设置侧边栏「子代理」分区、Tab 头部加「管理」按钮。
- 1.1.23（未发布）：侧边栏按方案 D 合并——设置导航「子代理」为唯一管理界面；插件页只留指路条 + dsh 自动生成的原始表单；设置页加「原始配置（只读）」折叠块。
- 1.1.22（未发布）：修复内置子代理统计（改读 `projectionsBySession[父].values.subagentCatalog` + `byId[子].running`/`subagentTiming`，跳过 mode=external）；管理界面移到设置侧边栏「子代理」分区，Tab 只留运行。
- 1.1.21（未发布）：管理界面收口到「子代理」Tab 的「运行 / 设置」两个子页（不再在插件页重复）；dock 无内容即不出现、✕ 隐藏整条；后端分组可添加自定义后端并编辑模型/强度/并发/二进制（新增 `backend-config` 接口）。
- 1.1.20（未发布）：主控可选模型/强度（`subagent_backends` 列出每后端默认模型、可选模型、强度档位；委派工具加 `model`/`reasoning`，白名单校验、指定模型排回退链最前）；设置页加「后端」分组（只列检测到的 CLI + 一键启用，`providers` 默认空）；pi 显示真实模型。
- 1.1.13：委派 label 改为「后端名 · 描述」。
- 1.1.19（未发布）：dock 卡片精简为单行（状态/后端/模型/耗时/停止，任务改为悬停）；成本改为 `panel.showCost` 开关（默认关），金额仍来自 CLI 上报。
- 1.1.18（未发布）：dock 常驻（空闲也显示统计，新增 hideWhenIdle 开关）；运行面板设置并入「自由子代理」插件页并分组、分段按钮、恢复默认；内置子代理投影改为按需挂载。
- 1.1.16（未发布）：在 1.1.15 基础上增加 `panel.includeNative` 开关（默认关），把 dsh 自带子代理以「内置」标只读并入面板（读会话投影 subagentCatalog / subagentTiming）。
- 1.1.15（未发布）：修正 dock 位置（`conversation.input.dock`，输入框正上方）、会话串号（按 `sessionId` 过滤）、
  重启后旧记录假弹出（`restored` 标记）；dock 加 ✕ 隐藏、默认收起、有新运行自动展开；六个开关迁到插件配置
  `panel` 节点（`cordis.patch.yml` 可见，设置界面写回、即时生效，失败退回本地）。
- `node --check` 通过；`node scripts/build-client.mjs` 构建通过（已生成 `lib/client.js`）。
- 本地 dsh profile 已装本仓库 1.1.14（`github:BErrybearl/dsh-subagent-plus#f8b9214`）；1.1.16 待重新安装。

## 决定与约束

- 保持 npm 包名 `dsh-subagent` 与内部 id 不变；GitHub 仓库名用 `dsh-subagent-plus`。
- 不改 dsh 核心；「外部子代理无 dsh 子会话」属核心行为，不在本仓库范围。
- 面板两个视图（dock / Tab）共用同一份 runs 快照；开关存插件配置 `panel` 节点，改后即时生效（volatile）。
- dock 槽位为 `conversation.input.dock`（list, session 作用域，props 带 sessionId）；`shell.overlay` 是页面级浮层，已弃用。
- 发布要避开 npm 上他人的 `dsh-subagent-plus@0.0.3`（同名不同物），建议加 scope 或改名。

## 待办

- 部署 1.1.16 到 dsh profile，在真实会话验证（需完全退出 dsh 后安装；命令行里 `DSH_HOME` 要指向 dsh 主目录，否则会报「先打开一次再完全退出」）。
- 待开发：「让所有子代理调用都走本插件路径」——①引导优先走插件 ②监测非托管 CLI 进程 ③PATH 命令包装强制接管，风险递增，暂不启用。
- 迭代：面板样式/字段微调、历史详情增强、范围（本会话/全部）在无会话 id 时的回退。
- 待实测（1.1.24 装后）：①「插件 › dsh-subagent」详情页是否显示完整面板（两位复核对“是否自动渲染 schema 表单”结论相反，pi 说不渲染）；②开关是否真的写进 `cordis.patch.yml`（以前只落 localStorage）；③内置子代理是否出现在面板里；④停用后端再启用，模型设置是否仍在。若面板没出现，先查 `plugins.bundle.config` 的 key 是否等于包名 `dsh-subagent`。
- 待开发：升级/禁用期间暂停查询（`ctx.pluginChanges.bundle(packageName)`）；停用后是否清理存储与进程策略。
