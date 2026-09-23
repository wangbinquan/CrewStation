# RFC-026｜验收记录

> 配套：[提案](./proposal.md) · [技术设计](./design.md) · [实施计划](./plan.md)

## 1. 部署（2026-09-23，UTC）

- 实现 `ac0b7c3f`，[CI 35866042993](https://github.com/wangbinquan/CrewStation/actions/runs/35866042993) 六项成功。控制面不动（快照原样透传，设计 §1）。
- 先工作台：13:29:34 console 滚到 `cs-console:replies-20260923b`。线上原是并行会话刚部署的 `traces-20260923b`（`009c0be3`，在本 RFC 之后），
  为不回退它，工作台用 `git archive origin/main`（`009c0be3`，同时含该会话的改动与本 RFC）构建，作者批准。
- 后任务底座：`crewstation/task-runtime:replies-20260923`（`sha256:b46218b859ab3c06cc1b462ae37e64afea28e4f51668655a8917209ece63997c`，
  源码 `ac0b7c3f`，同时带上 RFC-024 T9 的 90 秒超时）。默认档位 `volc-glm-5-2` 从修订 6 只换镜像另存**修订 7**，档位测试通过。

## 2. 逐项结果

| 编号 | 结果 | 证据 |
|---|---|---|
| RQ-01 | 通过 | 查询实录与逐条应答基准见设计 §2（任务底座镜像里用 PTY 录 OpenCode 1.18.29 的原始输出；浏览器 xterm.js 6 对照，256 色调色板 0 差异）。实机 OpenCode 画出界面（RQ-02） |
| RQ-02 | 通过 | 13:32 dev-developer 用接口起 OpenCode（修订 7），**自己不打开页面**。名册：+10.2 秒进程拉起、`ui.waiting`；+43.7 秒 `ui = { state: 'ready', by: 'screen' }`。七段：排队 2.4 秒、等待连接 2.6 秒、准备环境 0.3 秒、Agent 启动中 4.4 秒、**CLI 初始化 33.7 秒**（按屏幕判定，不是超时）。dev-admin 打开该 CLI 即是完整界面，状态条「空闲 · 点击终端即可输入」——全程没有任何视图持有控制（截图 `admin-view`） |
| RQ-03 | 通过 | 由 RQ-02 覆盖且更严：不是「持有后离开」，而是从头到尾没有人持有控制，CLI 照常画出界面 |
| RQ-04 | 通过 | dev-admin 的页面在打开前注入脚本记录 WebSocket 发出的帧：整个启动过程只有 `listFiles` 1 条、`attachTerminal` 1 条，**`terminalInput` 0 条**，也没有 `claimTerminalControl`；控制台无错误 |
| RQ-05 | 用例覆盖 | 验收项目没有旧底座档位的使用授权（同 RFC-024 UI-06）。`apps/console/src/tests/terminalQueryFilter.test.ts`：快照没有 `repliesQueries` 时浏览器照旧应答，同一终端改附着到新 Runner 后才拦下 |
| RQ-06 | 通过 | `terminalQueryReplies.test.ts`（真无头 xterm 的 DA／DSR／DECRQM 与 OSC 4／10／11／12 补答、不答的查询）、`nativeSupervisor.test.ts`（真 PTY、无人持有控制时脚本读到光标与背景色应答、快照声明）、`terminalQueryFilter.test.ts`（拦截、键盘不受影响、旧 Runner 回退、配色与 tokens.css 一致）；本机 unit 528／console 827 全过 |

收尾：验收用的 CLI 已停止，开发会话已释放。

## 3. 观察

- 同样是 150m CPU，RFC-024 验收时（创建者持有控制）CLI 初始化 43.2 秒，本次（无人持有控制）33.7 秒。两次之间只差了应答方，单次数据不足以量化提速；
  可以确定的是：以前这种情况会一直空白、等 RFC-024 的超时放行，现在按屏幕判定正常完成。
- 30 多秒仍主要是 OpenCode 在 150m CPU 下自身的启动耗时（不应答时额外要等约 8 秒，设计 §2），不在本 RFC 范围。
