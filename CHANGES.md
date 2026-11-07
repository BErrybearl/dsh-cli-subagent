# 本分支的改动

## 1.1.17（未发布）

- 修复：`panel` 配置里外层对象误标 `volatile()`，导致 dsh 拒绝加载
  （`$.panel.dock volatile fields require a fixed object path without an enclosing volatile field`）。
  改为只有叶子字段 volatile，路径固定为 `panel.<key>`，热更新照旧。

## 1.1.16（未发布）

- 新增开关 `panel.includeNative`（默认关）：把 dsh 自带的子代理（`subagent` / `subagent_fork` /
  Agent Team teammate）并入面板，带「内置」标、只读不可停止。
- 数据来源是客户端已有的会话投影：父会话 `subagentCatalog`（id / createdAt / mode / label）+
  子会话 `subagent` / `subagentTiming` 投影与 `contextTimeline`（模型、费用）。不新增 host 逻辑，
  投影属 dsh 内部结构，故放在开关后面，版本不符时关掉即可。

## 1.1.15（未发布）

- 修正 dock 位置：从页面级浮层 `shell.overlay` 换到 `conversation.input.dock`（输入框卡片正上方、全宽），
  不再贴住页面顶端。
- 修正会话串号：dock / Tab 直接使用槽位提供的 `sessionId` 过滤 `parentId`；拿不到 sessionId 时
  「本会话」范围显示空，不再退化成「全部会话」。
- 修正重启后假弹出：`resumePersistedRuns` 接管的旧记录标记 `restored`，dock 不把它们当作「刚完成」
  显示；自动收起只作用于真实新结束的运行。
- dock 增加 ✕ 隐藏（记住时间点，有新运行再出现）；dock 默认收起为一行，有新运行自动展开。
- 六个开关从浏览器 localStorage 迁到插件配置 `panel` 节点（`dock / tab / scope / autoHideSeconds /
  maxCards / allowStop`），`cordis.patch.yml` 可见；设置界面通过 `qoder-subagent/panel` 写回配置并
  即时生效，写回失败时退回本地覆盖并在界面提示。
- 统计改为客户端按筛选后的运行集合计算，dock / Tab / 设置三处一致。

## 1.1.14（未发布）

- 新增「子代理运行面板」：输入框上方浮层 dock（`shell.overlay`）+「子代理」标签页（`conversation.view`）
  + 设置分区（`settings.section`）。实时显示每次外部 CLI 子代理的 后端 / 实际模型 / 状态 / 耗时 /
  当前动作，并在 dock、Tab、设置三处展示统计（运行 / 完成 / 出错 / 成本）。
- host 新增 `qoder-subagent/runs` 快照接口（合并内存账本与 `runs/index.json`）与 `qoder-subagent/stop`
  停止接口；委派时记录 `driver / parentId`，从 CLI 事件采集「实际模型」并持久化到 `index.json`。
- 面板开关（浮层 / 标签页 / 范围 / 自动收起 / 卡片上限 / 停止按钮）位于「设置 › 自由子代理 › 运行面板」。
- 待开发（暂未实现）：「让所有子代理调用都走本插件路径」——①引导优先走插件 ②监测非托管 CLI 进程
  ③PATH 命令包装强制接管；难度与风险递增，先不启用。

## 1.1.13

- 委派工具改为插件自带实现：委派 label 从「仅任务描述」改为「后端名 · 任务描述」
  （例如 `codex · 检查登录`），这样在 dsh 的「子智能体」面板里能直接看出是哪个后端。
- 其余参数、输出（`started subagent <id>`）、并发与状态展示与官方委派工具保持一致。
- 说明：dsh 对「外部（external）」子代理不显示运行状态、也不可展开，这是 dsh 核心行为；
  本插件不改核心，运行状态仍可在插件自己的聊天工具行里查看。

## 与上游的差异范围

- 仅改 `lib/index.js` 中挂载委派工具的那一段。
- `src/client.js`、`lib/client.js` 及其他 host 逻辑未改。
