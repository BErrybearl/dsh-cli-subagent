# 本分支的改动

## 1.1.24（未发布）

- **配置写回修好了**：客户端以前把整个补丁对象发给 `panel` 路由（`{dock:false}`），而 host 只认 `{key,value}`，
  导致每次改开关都抛错、退回本地 localStorage 覆盖，`cordis.patch.yml` 从不变化。现在按 key 逐个写回；
  「恢复默认」同时清空本地覆盖，避免旧值压过配置。
- **providers 不再整段覆盖**：启用/停用/改后端参数都改成在最新配置上按名字就地合并（`editor.edit` 内 mutate），
  并发或与 schema 表单同时修改不再丢字段。
- **停用后端保留设置**：`ProviderConfig` 增加 `enabled`（默认 true）；停用只关开关，模型/强度/并发/二进制都留着，
  重新启用即可恢复；列表里标注「已停用；设置保留」。
- **管理入口合并为一处**：完整管理面板放进「插件」页里本插件的详情区（`plugins.bundle.config`，key `dsh-subagent`），
  删除设置侧边栏的「子代理」分区，也不再新增插件页签；「子代理」标签页头部加「管理」按钮，
  用 `pluginNavigation.openBundle("dsh-subagent")` 打开详情。
- 面板样式按 Codex 设计稿对齐：统计条成一条带边框的行、开关分两列排、后端行加「已检测到」、
  高级参数收进带标题和「探测模型 / 保存」的虚线块；`panel.tab` 开关恢复生效（关掉后隐藏标签页与 dock 的 ↗）。
- 删除不完整的「原始配置（只读）」摘要，避免成为第三份配置真相源。
- 更正一条误判：插件管理器页**不会**自动渲染 schemastery 表单（该包 client 里 `schemastery/schema/ConfigField` 出现 0 次，
  只在插件注册了 `plugins.bundle.config` 时才渲染插件自己的内容）。所以详情页那份就是我们唯一的表单，不存在“藏不掉的自动表单”。

## 1.1.23（未发布）

- 侧边栏按方案 D 合并：**设置左侧导航的「子代理」是唯一管理界面**（后端管理 + 面板开关 + 统计）；
  插件管理器页注册 `plugins.bundle.config`（key `dsh-subagent`）只渲染一条指路说明，
  不再放第二份面板；下方 dsh 自动生成的原始表单保留作兜底（插件无法隐藏它）。
- 设置页新增「原始配置（只读）」折叠块：列出当前启用的 providers 与生效中的 panel 开关，便于核对，
  避免为了看一眼字段又跑去插件页。

## 1.1.22（未发布）

- **修复内置子代理统计不到**：dsh 的会话列表快照里，子代理目录在
  `projectionsBySession[父会话].values.subagentCatalog`，子会话状态在 `byId[子会话].running` 与 `subagentTiming` 投影；
  之前读的是 `byId[父].projections.subagentCatalog` 和并不存在的 `contextTimeline`，所以永远为空。
  现在按正确路径读取，并跳过 `mode: "external"`（本插件派出的外部 CLI，已在 runs 里，避免重复计数）。
  内置子代理的模型/成本这两个投影不提供，卡片显示「dsh 内置」与 `—`。
- 管理界面改到**设置侧边栏的「子代理」分区**（`settings.section`），「子代理」Tab 只留运行视图；
  插件页保留 dsh 自动生成的原始配置表单作兜底。

## 1.1.21（未发布）

- 管理界面按方案 A 收口：**只在「子代理」Tab 里**，分「运行 / 设置」两个子页；设置不再在「自由子代理」插件页重复嵌一份，
  侧边栏也不再另放，避免两处不一致。
- dock：没有可显示内容时整条不出现（新建会话不再顶一条空的）；`✕` 改为隐藏整条 dock，
  之后有**新**开始的运行才重新出现，旧记录不会把它顶回来。
- dock 卡片改为**单列固定列宽**：状态点 / 后端 / 模型 / 强度 / 耗时 / 成本 / 操作各占固定宽度，模型名占剩余宽度超长省略、
  悬停看全名；缺金额或不能停止时该列仍然占位，右侧不会漂移；卡片同时显示本次实际使用的强度和模型
  （先记派发时的意图，CLI 报出真实模型后覆盖）。
- 后端分组升级：检测到的逐行开关、未安装折叠、`＋ 添加后端`（名称 / 驱动 / 二进制路径），
  点后端名展开高级参数（默认模型、默认强度、并发上限、二进制路径，带「探测模型」和「保存」）。
  新增 `backend-config` 接口；`backend` 接口支持添加时带 `driver` / `binary`。
- dock 交互（轻量为主）：点卡片整行**就地展开**该条详情（任务、最近动作、最近三条事件、会话与步骤数，只在展开时轮询）；
  头部新增 `↗` 用 `uiConversation.binding(sessionId).activate()` 切到「子代理」标签页看全量；`✕` 仍是整条隐藏。
- 移除「子代理」标签页和「空闲时隐藏」两个开关：管理入口固定在 Tab 里，避免把它关掉后自己进不去。

## 1.1.20（未发布）

- **主控可以选模型和强度**：`subagent_backends` 提示词改为逐后端列出默认模型、可选模型、支持的强度档位；
  委派工具（工具名=后端名，如 `codex` / `pi`）新增两个可选参数 `model`、`reasoning`。
  - 白名单校验：模型必须在该后端配置的 `model` / `models` 里，强度必须在驱动支持的档位里，否则直接报错，不静默忽略。
  - 指定的模型排到回退链最前，失败后仍按配置里的其它模型继续；强度只覆盖本次调用。
  - 驱动映射（实测）：pi `--model` + `--thinking`（off/minimal/low/medium/high/xhigh/max）；
    codex `-m` + `-c model_reasoning_effort=`（minimal/low/medium/high/xhigh/max/ultra）。其余驱动不支持强度参数。
- 设置页新增「后端」分组：只列本机检测到的 CLI，未安装的收进折叠区；逐行开关写回 `providers`，
  另给「一键启用已检测到的」。`providers` 默认改为空数组，新装不再罗列全部内置后端名。
- pi 运行中显示真实调用的模型（`provider/model`，取自助手消息），不再一律显示「CLI 默认」。

## 1.1.19（未发布）

- dock 卡片精简成单行：状态点 / 后端 / 模型 / 耗时 /（可选成本）/ 停止；任务文案改为悬停 title，
  去掉第二行的动作与静默提示；运行中、完成计数保留在 dock 头部。
- 成本改为 `panel.showCost` 开关（默认关）：关掉后面板各处不再显示 `$` 金额，数据仍照常记录。
  金额来自 CLI 自己上报（`total_cost_usd` / `step_finish.part.cost` / `usage.cost.total`），不是本插件估算。

## 1.1.18（未发布）

- dock 改为**常驻**：空闲时也显示一行统计（`子代理 · 空闲 · 3 完成 · $0.01`），不再因为没有运行中的任务而整条消失；
  新增开关 `panel.hideWhenIdle`（默认关）用来恢复"空闲即隐藏"的旧行为。
- 运行面板设置从独立分区（`settings.section`）**并入「自由子代理」插件页**（`plugins.bundle.config`，key `dsh-subagent`），
  放在后端配置下方，按 入口 / 显示 / 操作 / 数据 分组；范围、卡片上限、自动收起改为分段按钮；
  底部加统计条与「恢复默认」（一次写回全部默认值）。
- 内置子代理的投影读取改为按需挂载（`NativeProbe`），关闭 `includeNative` 时完全不碰会话投影钩子，
  避免它影响 dock 本体的渲染。

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
