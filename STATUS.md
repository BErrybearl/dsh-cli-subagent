# STATUS — dsh-subagent-plus

## 当前

- 已基于上游 dsh-subagent v1.1.12 建立独立仓库，完成「委派 label = 后端名 · 描述」改造，
  `node --check` 通过，仓库自带 check.ps1 通过。
- 本地仓库：`Documents/VibeDev/dsh-subagent-plus/repo`；规则版本 2026-11-07.3。
- 尚未把本地 dsh profile 切换到本仓库版本；尚未绑定远程仓库。

## 决定与约束

- 保持 npm 包名 `dsh-subagent` 与内部 id 不变，确保 `cordis.patch.yml` 可直接安装；
   GitHub 仓库名用 `dsh-subagent-plus` 以示区分。
- 不改 dsh 核心；「外部子代理在编队面板无运行状态」属核心行为，不在本仓库范围。
- 仅改 `lib/index.js` 的委派工具挂载段；`lib/client.js` 由 `node scripts/build-client.mjs` 生成。

## 待办

- 发布公开 GitHub 仓库并推送。
- 在 `05-vibe-coding/README.md` 登记 VC-011。
- 需要时切换 profile 安装本仓库版本并在真实会话里验证。
