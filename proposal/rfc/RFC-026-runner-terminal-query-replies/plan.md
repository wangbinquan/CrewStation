# RFC-026｜实施计划

> 状态：Draft · 2026-09-23
> 配套：[提案](./proposal.md) · [技术设计](./design.md)

## 1. 任务与依赖

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| RFC-026-T1 | 三件套落档并登记；作者裁定 Q1–Q3 与能力影响 C1、C2；实机抓取 OpenCode 启动时发出的查询（PTY 输出事件），补进设计 §2；核对旧控制面是否透传快照新字段 | 作者 | 进行中 |
| RFC-026-T2 | 契约：`TerminalSnapshot.repliesQueries`、`TERMINAL_REPLY_PALETTE`；用例 | T1 | 待办 |
| RFC-026-T3 | Runner：`terminalQueryReplies.ts`、`terminalScreen.onReply`、supervisor 接线；用例 | T2 | 待办 |
| RFC-026-T4 | 工作台：`terminalQueryFilter.ts`、`NativeTerminalSurface` 按快照装卸；用例 | T2 | 待办 |
| RFC-026-T5 | 本地 `bun run check`、按路径提交推送、精确 SHA 查 CI | T3、T4 | 待办 |
| RFC-026-T6 | 本机部署：**先工作台、后任务底座**，默认档位另存修订；实机 RQ-01…RQ-05，写 `acceptance.md` | T5 | 待办 |
| RFC-026-T7 | 回填：RFC-024 非目标 N2、RFC-022 §14 加修订记录；dev-gotchas「查询也会产生输入」补结论；README、STATE.md 收口 | T6 | 待办 |

## 2. 验收清单

对应提案 §7（RQ-01…RQ-06），实机记录身份、页面、名册、WS 帧与 Runner 日志，写进 `acceptance.md`。

## 3. 交付门禁

- 推之前本地 unit／module／console 三层绿，按改动文件单独 `bunx eslint`。
- CI `gate` 与 `e2e` 绿；改动行防护达标。
