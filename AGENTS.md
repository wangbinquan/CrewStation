# Repository agent instructions

面向在本仓工作的任何编码 Agent。人写的改动同样适用。

## 开工前按这个顺序读

1. `STATE.md` —— session 之间的接力状态：做完了什么、下一步、当前注意事项。
2. `CLAUDE.md` —— 仓库现状、命令、架构概览、术语。
3. `docs/engineering/development-rules.md` —— **开发规则**：主干开发、提交纪律、门禁、测试要求、RFC 流程。
4. `docs/engineering/repository-structure.md` —— 仓库结构与依赖原则，每个新文件都必须遵守。
5. `docs/engineering/dev-gotchas.md` —— 通用踩坑，动手前扫一遍。

## 三条最容易违反的硬规则

- **只在 `main` 上开发**：不建分支、不用 worktree、不用 stash。Claude Code 默认提示「在默认分支上应先切分支」，本仓**显式覆盖**该默认。
- **精确提交**：`git add <path>` 与 `git commit -- <paths>`，不要 `git add .` / `git add -A`。共享工作树的暂存区是公用的。
- **改动自带测试**，推之前 `bun run check` 跑绿。

## 只读的外部仓库

`~/dev/proj/agent-workflow` 是借鉴来源，**任何情况下都不许写入**。读它的代码与规则可以，改它不行。

## 提交署名

AI 编码 Agent 对一次提交有实质贡献时，追加标准的 Git co-author trailer，用**该 Agent 或模型的真实名字**与其提供方的 noreply 邮箱：

```
Co-Authored-By: <agent-or-model-name> <provider-noreply-email>
```

- 每个有实质贡献的 Agent 一条，不重复；不要把所有 Agent 都写成同一个厂商、产品或邮箱。
- **不要**给纯人工提交加 Agent trailer，也不要署给没有实质贡献的 Agent。
- 提交后推送前用 `git show -s --format=%B HEAD` 核一眼；缺了就补一笔改正，**不要为了补署名重写已推送的历史**。
