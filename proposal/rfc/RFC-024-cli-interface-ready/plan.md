# RFC-024｜实施计划

> 状态：Done · 2026-09-23 · 作者批准三件套，Q1–Q3 取推荐方案（静止 500 ms、超时 45 秒、代答查询另立 RFC）；实机验收见 [acceptance.md](./acceptance.md)
> 配套：[提案](./proposal.md) · [技术设计](./design.md)

## 1. 任务与依赖

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| RFC-024-T1 | 三件套落档并登记；作者批准并裁定 Q1–Q3 | 作者 | 已完成（2026-09-23，Q1–Q3 取推荐） |
| RFC-024-T2 | 契约：`NativeTerminalRecord.ui`、`StartupStageKind` 增 `interface`；Schema 用例；`contracts:lock` 确认 | T1 | 已完成 |
| RFC-024-T3 | Runner：`interfaceReadiness.ts` 判定器、`terminalScreen.visibleChars`、`nativeSupervisor` 接线与计时器清理；单元用例 | T2 | 已完成 |
| RFC-024-T4 | dev-session：`composeCliStartup` 七段、`startupOf` 读 `ui`、`FAILURE_AT` 与 `keepFailureLog`；单元与模块用例 | T2 | 已完成 |
| RFC-024-T5 | 工作台：段名文案（中英）、`useCreatorClaim` 启动期间在用；用例 | T2 | 已完成 |
| RFC-024-T6 | 本地 `bun run check`、改动行防护、按路径提交推送、精确 SHA 查 CI 六项 | T3–T5 | 已完成（652677fa，CI 35855602907 六项成功） |
| RFC-024-T7 | 本机部署：控制面与工作台**同一批**、任务底座镜像；实机 UI-01…UI-06，按实测调 Q1 静止窗口；写 `acceptance.md` | T6 | 已完成（见 [验收记录](./acceptance.md)） |
| RFC-024-T8 | 回填：RFC-022 加修订记录（「已就绪」判据改为界面画出）；README、STATE.md 收口 | T7 | 已完成 |

单个提交序列即可；T3、T4、T5 可并行编写，同批提交。

## 2. 验收清单

对应提案 §7（UI-01…UI-06），实机记录身份、页面、名册接口返回与 Runner 日志，写进 `acceptance.md`。

## 3. 交付门禁

- 推之前本地 `bun run check` 绿（按本次改动文件单独 `bunx eslint` 复核，排除并行会话在制品的干扰）。
- CI `gate` 与 `e2e` 绿；改动行防护达标。
