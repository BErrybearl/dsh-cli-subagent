# dsh-subagent-plus

把本机的外部 CLI（Codex、Pi、Qoder、OpenCode、CodeBuddy 等）注册成 dsh（DeepSeek Harness）的**子代理后端**，
再配一个看得见运行状态的轻量面板。

本仓库是 [1373700184/dsh-subagent](https://github.com/1373700184/dsh-subagent)（MIT）的社区增强分支：
委派协议、驱动与 CLI 适配来自上游，面板、后端管理与模型/强度选择是本分支新增的。
与上游的逐版差异见 [CHANGES.md](./CHANGES.md)，致谢见 [NOTICE](./NOTICE)。

## 它现在长什么样

- **输入框上方的 dock**：一行显示有哪些子代理在跑。单列固定列宽（状态点 / 后端 / 模型 / 强度 / 耗时 / 成本 / 操作），
  缺金额时显示 `—` 占位、右侧不漂移；点卡片就地展开最近动作与最近三条事件；`↗` 跳到「子代理」页；`✕` 隐藏整条，有新运行再出现。
- **「子代理」标签页**：运行表格（状态、模型、耗时、任务、停止）+ 单条详情；头部「管理」打开本插件详情。
- **插件 › 本插件详情**：唯一的管理界面。后端开关、添加自定义后端、每个后端的默认模型 / 默认强度 / 并发上限 / 二进制路径、
  面板开关与统计都在这一个页面里；设置侧边栏不再单独开一页。停用后端只关开关，模型等设置保留。

## 能力

- **委派工具带参数**：工具名就是后端名（如 `codex`、`pi`），可选参数 `model`、`reasoning`。
  模型与强度有白名单校验，不合法直接报错并列出可选值；指定的模型排在回退链最前，失败仍按配置里的其它模型继续。
- **后端按检测结果呈现**：只列这台机器真实装了的 CLI，未安装的收进折叠区，可先启用、装好后自动可用；也可手动添加自定义后端。
- **成本是可开关的**：金额一律来自 CLI 自身上报（pi 的 `usage.cost.total`、OpenCode 系的 `total_cost_usd`、qoder 系的额度字段），
  插件不做估算；codex 事件里没有金额，显示 `—`。
- **内置子代理只读并入**：开关 `panel.includeNative`（默认开）把 dsh 自带的 `subagent` / `subagent_fork` 一并列出，带「内置」标、不能停止。
- **崩溃后能续**：子代理进程 detached 且日志落盘，dsh 重启后恢复运行记录与状态。
- **斜杠指令**：`/sub_<后端名>` 发起委派，`/sub_agent_status` 查进度。

## 安装

```sh
dsh plugin --profile desktop add "dsh-subagent@github:BErrybearl/dsh-subagent-plus#<commit>"
```

安装前请**完全退出 dsh**。装完重启生效。需要哪些 CLI，就先装好并登录对应的那个（插件只负责调用）。
装完可在 设置 › 子代理 里看到检测结果。

## 配置

运行时配置在 profile 的 `cordis.patch.yml`，`dsh-subagent` 节点的 `config` 下：

```yaml
providers:                # 启用的后端；默认空，按设置页勾选生成
  - name: pi
    driver: pi-json
    maxConcurrency: 10
  - name: codex
    driver: codex-json
    maxConcurrency: 10
panel:                    # 面板开关；改设置页会写回这里，即时生效
  includeNative: true
```

常用字段：`driver`（`pi-json` / `codex-json` / `claude-json` / `qoder-json` / `opencode-json` / `codebuddy-json`）、
`binary`（留空自动探测）、`model` / `models`（默认模型与回退链）、`reasoningEffort`、`maxConcurrency`、`timeoutSeconds`、`extraArgs`。

## 驱动与参数映射

| 后端 | 模型 | 强度 |
|---|---|---|
| pi | `--model provider/id` | `--thinking off\|minimal\|low\|medium\|high\|xhigh\|max` |
| codex | `-m <model>` | `-c model_reasoning_effort="minimal\|low\|medium\|high\|xhigh\|max\|ultra"` |

其它驱动按各自 CLI 的参数构造；不支持的驱动传强度会被明确拒绝，不会静默忽略。

## 已知限制

- 一次性执行：不支持续话与结构化输出，子代理看不到父会话上下文，任务单要自带完整上下文。
- 内置子代理的数据来自 dsh 客户端投影（`projectionsBySession[...].values.subagentCatalog` 等），属内部结构，
  dsh 升级后可能变化；坏了可以关掉 `includeNative`，主功能不受影响。这两个投影不提供模型与金额，故显示 `dsh 内置` 与 `—`。
- 本机没装 Claude 的需求，Claude 后端未做模型/强度映射。

## 开发

```sh
node scripts/build-client.mjs     # 构建 src/ → lib/client.js
pwsh -File scripts/check.ps1      # 4 项检查（规则标记、个人路径/密钥、构建产物、钩子）
```

`lib/index.js` 是 host 端（Node），`src/panel.js` 是面板 UI 源码，`lib/client.js` 是它的构建产物。

## 许可

MIT，见 [LICENSE](./LICENSE)。上游作者与第三方致谢见 [NOTICE](./NOTICE)。
