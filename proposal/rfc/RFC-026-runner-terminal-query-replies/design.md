# RFC-026｜技术设计

> 状态：Draft · 2026-09-23
> 配套：[提案](./proposal.md) · [实施计划](./plan.md)

## 目录

- [1. 落位](#1-落位)
- [2. 现状实测](#2-现状实测)
- [3. Runner：统一应答](#3-runner统一应答)
- [4. 契约：声明由 Runner 应答](#4-契约声明由-runner-应答)
- [5. 工作台：拦下查询](#5-工作台拦下查询)
- [6. 兼容与失败模式](#6-兼容与失败模式)
- [7. 测试策略](#7-测试策略)
- [8. 本 RFC 承担的结构演进与留下的债](#8-本-rfc-承担的结构演进与留下的债)

## 1. 落位

| 改动 | 位置 | 层 |
|---|---|---|
| 查询应答（无头 xterm 的 `onData` 写回 PTY、OSC 配色补答） | `runtimes/task/src/terminal/terminalQueryReplies.ts`（新文件）；`terminalScreen.ts` 暴露应答事件 | 任务容器运行时 |
| 接线 | `runtimes/task/src/terminal/nativeSupervisor.ts` | 同上 |
| 快照声明 `repliesQueries` | `packages/contracts/taskrunner/nativeTerminal.ts`（`TerminalSnapshotSchema`） | 契约 |
| 浏览器拦截 | `apps/console/src/features/dev-session/model/native/terminalQueryFilter.ts`（新文件）；`nativeTerminalSurface.ts` 按快照声明装上 | 工作台 |

不经过控制面：应答在 Runner 内部完成，cs-session／cs-api 只透传快照字段（schema 非 strict，旧控制面也会透传——需在 T1 核对，否则同批部署）。
按 RFC-024 设计 §8 留下的债，把屏幕相关职责从 `nativeSupervisor` 挪出一步：应答逻辑独立成文件，supervisor 只接线。

## 2. 现状实测

`@xterm/headless` 6.0.0 对常见查询的应答（2026-09-23 本机脚本实测）：

| 查询 | 应答 |
|---|---|
| DA1 `CSI c` | `CSI ? 1 ; 2 c` |
| DA2 `CSI > c` | `CSI > 0 ; 276 ; 0 c` |
| DSR `CSI 6 n` / `CSI 5 n` | `CSI 1 ; 1 R` / `CSI 0 n` |
| DECRQM `CSI ? 2026 $ p` | `CSI ? 2026 ; 2 $ y` |
| DECRQSS `DCS $ q m ST` | `DCS 1 $ r 0 m ST` |
| OSC 10／11／4 查询 | **无应答**（无头终端没有主题服务） |
| kitty 键盘 `CSI ? u`、XTVERSION `CSI > 0 q` | 无应答（浏览器 xterm.js 同样不答） |

OpenCode 1.18.29 启动时具体发哪些、在等哪几条，T1 在实机抓 PTY 输出确认；上表之外若还有它等待的查询，按同样方式补答。

## 3. Runner：统一应答

- `createTerminalScreen` 增加 `onReply(listener)`：转发无头 xterm 的 `onData`（这里只会出现应答，无头终端没有键盘）。
- `terminalQueryReplies.ts`：
  - 在无头 xterm 上注册 `parser.registerOscHandler(10 | 11 | 12 | 4, …)`：参数为 `?` 时按固定配色（Q2）生成 `OSC n ; rgb:rrrr/gggg/bbbb ST` 经 `onReply` 发出，返回 `true`；其余参数返回 `false`，交给 xterm 默认处理。
  - 配色取工作台深色主题的终端前景、背景与 16 色（与 `apps/console/src/features/dev-session/model/terminalTheme.ts` 的深色值一致，写成契约常量 `TERMINAL_REPLY_PALETTE`，两边各有用例锁住一致）。
- `nativeSupervisor`：进程拉起后，`screen.onReply((data) => entry.session?.write(data))`；进程结束即停。应答顺序与 PTY 输出顺序一致（在屏幕写入回调里产生）。
- 光标位置等状态类应答以无头屏幕为准：它的尺寸由 `resize` 与 PTY 同步，是 CLI 真正所在的那块屏幕。

## 4. 契约：声明由 Runner 应答

`TerminalSnapshotSchema` 增加 `repliesQueries: z.boolean().optional()`：新 Runner 的 `attachTerminal` 快照恒为 `true`；旧 Runner 没有。
浏览器按附着时拿到的快照决定是否拦截。协议版本不变。

## 5. 工作台：拦下查询

- `terminalQueryFilter.ts` 导出 `installQueryFilter(terminal)`：在浏览器 xterm 上注册同一组查询（CSI `c`、`>c`、`n`、`?n`、`$p`、`?$p`，DCS `$q`，OSC 4/10/11/12 的 `?`）的处理器并返回 `true`，xterm 于是不产生应答；返回的 `dispose` 用于卸下。
- `NativeTerminalSurface.restore(snapshot)`：`snapshot.repliesQueries === true` 时装上，否则卸下（旧 Runner 由浏览器照旧应答）。
- 键盘输入不受影响：拦截只作用于**来自 CLI 的查询序列**的解析，不碰 `onData` 的键盘路径。
- 顺带：`CONTROL_RELEASE_MS` 的注释（应答续租）更新为历史说明；页面按焦点主动释放的逻辑保留。

## 6. 兼容与失败模式

| 情形 | 结果 |
|---|---|
| 新 Runner + 新工作台 | Runner 唯一应答 |
| 旧 Runner + 新工作台 | 快照无 `repliesQueries`，浏览器照旧应答（与今天一致） |
| 新 Runner + 旧工作台 | 两边都应答，CLI 收到重复应答（可能在输入框出现乱码）——因此工作台与任务底座同批部署、先滚工作台 |
| CLI 发了 Runner 不会答的查询 | 与今天「无人持有控制」时一样收不到；RFC-024 超时兜底；T1 实机抓取即为了消除这种情况 |
| Runner 写回 PTY 失败（进程刚退出） | 忽略，记 debug 日志 |

## 7. 测试策略

| 层 | 文件 | 必写用例 |
|---|---|---|
| unit | `runtimes/task/src/terminal/terminalQueryReplies.test.ts` | 真无头 xterm：DA1／DA2／DSR／DECRQM／DECRQSS 经 `onReply` 发出；OSC 10/11/4 `?` 按配色补答、非 `?` 参数不答 |
| unit | `runtimes/task/tests/nativeSupervisor.test.ts` | 真 PTY 起一个会发 `CSI 6 n` 并读应答的脚本，不持有控制也能读到应答；进程结束后不再写 |
| console | `apps/console/src/tests/terminalQueryFilter.test.ts` | 装上后查询不产生 `onData`、键盘输入照常；`repliesQueries` 缺省时不装 |
| contract | 快照 schema 用例；`TERMINAL_REPLY_PALETTE` 与工作台深色主题一致 | |

## 8. 本 RFC 承担的结构演进与留下的债

- 演进：屏幕相关的应答职责独立成 `terminalQueryReplies.ts`，`nativeSupervisor` 只接线（RFC-024 §8 记的债还一步）。
- 债：`NativeScreenSession`（把判定、应答、快照收成一个对象）仍未抽出。
