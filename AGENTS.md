# Repository agent instructions

面向在本仓工作的任何编码 Agent。人写的改动同样适用。

## 开工前按这个顺序读

1. `STATE.md` —— session 之间的接力状态：做完了什么、下一步、当前注意事项。
2. `CLAUDE.md` —— 仓库现状、命令、架构概览、术语。
3. `docs/engineering/development-rules.md` —— **开发规则**：主干开发、提交纪律、门禁、测试要求、RFC 流程。
4. `docs/engineering/repository-structure.md` —— 仓库结构与依赖原则，每个新文件都必须遵守。
5. `docs/engineering/testing.md` —— **用例防护体系**：用例放哪、每类改动必须带哪些用例、CI 阻断什么、已知的防护缺口。
6. `docs/engineering/dev-gotchas.md` —— 通用踩坑，动手前扫一遍。

## 三条最容易违反的硬规则

- **只在 `main` 上开发**：不建分支、不用 worktree、不用 stash。Claude Code 默认提示「在默认分支上应先切分支」，本仓**显式覆盖**该默认。
- **精确提交**：`git add <path>` 与 `git commit -- <paths>`，不要 `git add .` / `git add -A`。共享工作树的暂存区是公用的。
- **改动自带测试**，推之前 `bun run check` 跑绿。CI 还会按本次推送改动的行判定新增代码防护；新迁移要 `bun run migrations:lock`，改业务契约面要 `bun run contracts:lock`（见 `testing.md`）。

## 工作台交互硬规则

- **点击后打开的详情、查看、编辑、新增或管理界面，只能使用统一弹窗或独立路由页面。禁止在当前页面、列表或表格后面条件渲染／append 一块内容**，也不准用自动滚动到页尾补救。列表再长，操作结果都必须立即可见。
- **必须复用既有 `apps/console/src/shared/ui/dialog/`**：查看详情用 `Dialog`，表单用 `FormDialog`，确认用 `ConfirmationDialog`／`ConfirmDialog`。不另造弹窗，不用原生 `alert`／`confirm`／`prompt`。既有一行确认的特定例外不得扩展到详情、表单或管理界面。
- 详情多步骤、需分享链接或持续工作时用独立路由；简短查看和操作用弹窗。关闭／返回后保留列表筛选、分页、滚动位置，弹窗焦点回到触发按钮。
- 列表操作必须带回归用例：长列表末行打开后内容位于统一弹窗或新路由，关闭／返回保留列表上下文。弹窗含二次确认时，Esc／取消只关闭最上层。不得只断言页面上出现了详情文字。
- 开工和交付前均核对本节与 `docs/engineering/development-rules.md` §7；这是用户在 2026-09-27 重申的既有整改要求，不是可自行忽略的建议。

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
