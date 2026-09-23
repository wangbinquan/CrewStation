# RFC-024｜技术设计

> 状态：Done · 2026-09-23 · 作者批准三件套，Q1–Q3 取推荐方案（静止 500 ms、超时 45 秒、代答查询另立 RFC）；实机验收见 [acceptance.md](./acceptance.md)
> 配套：[提案](./proposal.md) · [实施计划](./plan.md)

## 目录

- [1. 落位](#1-落位)
- [2. 契约](#2-契约)
- [3. Runner：界面判定](#3-runner界面判定)
- [4. 平台：七段组合](#4-平台七段组合)
- [5. 工作台](#5-工作台)
- [6. 兼容与失败模式](#6-兼容与失败模式)
- [7. 测试策略](#7-测试策略)
- [8. 本 RFC 承担的结构演进与留下的债](#8-本-rfc-承担的结构演进与留下的债)

## 1. 落位

| 改动 | 位置 | 层 |
|---|---|---|
| 记录上的界面状态、阶段种类 `interface` | `packages/contracts/taskrunner/nativeTerminal.ts`、`packages/contracts/api/progress/startupProgress.ts` | 契约（无领域依赖） |
| 判定器（纯函数状态机） | `runtimes/task/src/terminal/interfaceReadiness.ts`（新文件） | 任务容器运行时 |
| 屏幕可见文字统计 | `runtimes/task/src/terminal/terminalScreen.ts` | 同上 |
| 判定接线、超时、上报 | `runtimes/task/src/terminal/nativeSupervisor.ts` | 同上 |
| 七段组合 | `modules/dev-session/domain/nativeTerminalProjection.ts`（`composeCliStartup`） | dev-session 领域层 |
| 事件读取 | `modules/dev-session/application/nativeExecution.ts`（`startupOf`） | dev-session 应用层 |
| 段名文案、创建者控制保持 | `apps/console/src/app/i18n/*`、`features/dev-session/hooks/native/useCreatorClaim.ts` | 工作台 |

`runtimes/task` 仍只依赖 contracts／kernel／ws／agent-drivers；dev-session 不新增跨模块依赖；
`nativeTerminal` 事件已是持久事件（`modules/session/domain/eventDurability.ts:6`），不改 session 模块。

## 2. 契约

### 2.1 Runner 记录

`NativeTerminalRecordSchema` 增加可选字段：

```ts
/** RFC-024：CLI 界面是否已画出。新 Runner 在进程拉起时写 waiting；旧 Runner 没有这一项。 */
ui: z.object({
  state: z.enum(['waiting', 'ready']),
  readyAt: z.iso.datetime().optional(),     // Runner 判定时刻，仅用于日志与排查
  by: z.enum(['screen', 'timeout']).optional(), // ready 时必有
}).optional(),
```

只加可选字段，TaskRunner 协议版本（`TASKRUNNER_PROTOCOL_VERSION = 3`）不变。

### 2.2 启动阶段

`StartupStageKindSchema` 增加 `interface`，位于 `agent` 与 `ready` 之间。工作台与平台同批部署；
已冻结的旧 `startup`（六段）照常可读，不做数据迁移。档位测试不产出这一段（提案 N3）。

## 3. Runner：界面判定

### 3.1 判定器

`interfaceReadiness.ts` 导出纯函数状态机，不持有计时器，便于用例驱动：

```ts
type ReadinessInput =
  | { kind: 'output'; at: number; visibleChars: number }  // 一次写入完成后的屏幕统计
  | { kind: 'tick'; at: number };                          // 计时器到点
interface ReadinessState { spawnedAt: number; lastOutputAt?: number; visible: number; done?: 'screen' | 'timeout' }
function stepReadiness(state, input, limits = { quietMs: 500, timeoutMs: 45_000, minVisible: 1 }): { state; nextTickAt?: number }
```

- 可见文字：当前活动缓冲区（normal 或 alternate）视口内非空白字符数 ≥ `minVisible`。
- 完成（screen）：可见文字达标，且距最后一次输出 ≥ `quietMs`。
- 完成（timeout）：距进程拉起 ≥ `timeoutMs`。
- 已完成后忽略一切输入（只判一次）。
- `nextTickAt` 告诉调用方下一次该在何时 tick：有可见文字时为 `lastOutputAt + quietMs`，否则为 `spawnedAt + timeoutMs`。

终端查询（DECRQM、DSR、OSC 4/10/11、DA）由 xterm 解析，不落到屏幕上，因此不计入可见文字。这就是只看可见文字、不看「有没有字节」的原因。

### 3.2 屏幕统计

`createTerminalScreen` 增加 `visibleChars(): number`：在写入队列尾之后（与 `snapshot` 一样 `await tail`）遍历
`terminal.buffer.active` 的视口 `viewportY … viewportY + rows - 1` 行，`translateToString(true)` 去掉空白后累加长度。
视口最多 rows × cols 个单元格；判定完成后不再调用，开销只落在启动那几十秒。

### 3.3 接线

`NativeEntry` 增加 `readiness?: ReadinessState` 与 `readinessTimer?: Timer`。

1. `launch()` 把记录改成 `running` 时同时写 `ui: { state: 'waiting' }`（同一次 `emit`，不多发事件），初始化判定状态并按 `nextTickAt` 排计时器。
2. `output()` 里写入屏幕完成后（已有的 `.then`），若判定未完成：取 `visibleChars()`，`stepReadiness(output)`，按新的 `nextTickAt` 重排计时器。
3. 计时器到点：`stepReadiness(tick)`；完成时记录改为 `ui: { state: 'ready', readyAt, by }` 并 `emit`，写一行 info 日志 `native terminal interface ready`（带 `agentId`、`by`、距拉起毫秒数）。
4. `exited()`、`stop()`、`closeAll()` 清掉计时器；进程在判定前退出时不再发 ready。

`nativeSupervisor.ts` 现为 244 行，增加约 30 行，低于 600 行上限；`terminal/` 目录增加一个文件后为 10 个源码文件。

## 4. 平台：七段组合

### 4.1 输入

`CliStartupInput` 增加 `interface?: { reports: boolean; at?: string; by?: 'screen' | 'timeout' }`：

- `reports`：执行任务的 nativeTerminal 事件（或名册记录）里是否出现过 `ui` 字段；新 Runner 在 running 事件里就带 `ui`，为假即旧 Runner。
- `at`：第一条 `ui.state === 'ready'` 的 nativeTerminal 事件被平台收到的时间（与 `runningAt` 同一取法，`stored.at`）。
- `by`：该事件的判定方式。

`startupOf()` 在已有的事件循环里一并读出；读名册兜底（事件未读到）时，`reports` 取 `record.ui !== undefined`，
`at` 在 `record.ui?.state === 'ready'` 时取本次看到的时刻。

### 4.2 组合规则

在 `composeCliStartup` 中，`agent` 之后插入 `interface` 段：

| 条件 | `interface` 段 |
|---|---|
| `agent` 未成功 | `pending` |
| `agent` 成功且 `!reportsInterface`（旧 Runner） | `skipped`，起止都是 `runningAt`，时长 0（行为与今天一致） |
| `agent` 成功且有 `interfaceAt` | `succeeded`，从 `runningAt` 到 `interfaceAt`；`by === 'timeout'` 时 `detail` 写「未检测到界面，已超时放行」 |
| `agent` 成功、等待中、CLI 未结束 | `running`，从 `runningAt` 起，`detail`「进程已拉起，等待 CLI 画出界面」 |

`ready` 在 `interface` 成功或跳过时成功，时刻取其 `endedAt`。

`FAILURE_AT` 增加 `interface: 'agent-start-failed'`：CLI 在初始化段结束（退出、Runner 重启）时，`settle` 已有的逻辑
把进行中的段记为失败，错误信息沿用记录的 `error` 或「启动没有完成」；被关闭仍记为取消。

「准备环境或 Agent 启动中失败时留日志」（`keepFailureLog`）的判断增加 `interface`：初始化段失败时也留主容器日志尾部。

### 4.3 冻结

不变：整体进入 ready／failed／cancelled 时写进 `execution.startup`。整体 ready 的时间因此推迟到界面画出，冻结时刻随之推迟。

## 5. 工作台

- 文案：`ui.progress.stage.interface`「CLI 初始化（等待界面）」，中英各一条。`StageProgress` 按 `stages.length` 计数，「x/7」无需改代码。
- `NativeTerminalView` 不改：它按 `startup.state === 'running'` 盖步骤条，整体 ready 推迟后自然盖到界面画出。
- `useCreatorClaim` 的返回值（「启动期间视为在用」）抽成纯函数 `holdsDuringStartup(createdHere, terminal)`：`starting`，或 `running`
  且 `startup.state === 'running'`。进程拉起后取得成功会作废创建者登记，所以「这个窗口创建过它」由 hook 以 state 记住（渲染中按上一次的值调整）。
  保证初始化段内控制不被 30 秒空闲释放，OpenCode 的查询一直有人应答。
- 启动期间每秒刷新名册（`useNativeTerminals`）已按 `startup` 是否 running 判断，初始化段内继续每秒刷新，无需改。

## 6. 兼容与失败模式

| 情形 | 结果 |
|---|---|
| 旧任务底座（Runner 不写 `ui`） | `interface` 段跳过，进程拉起即就绪，与今天一致 |
| 平台已升级、工作台未升级 | 部署同批；若旧工作台遇到 `interface` 种类，契约解析失败——因此部署顺序为工作台与平台同一批，写进计划 |
| CLI 从不输出可见文字（卡在查询、无人应答） | 45 秒超时放行，段内写明 |
| CLI 画出第一帧后又停顿超过 500 ms 才画完 | 提前放行，用户可能看到界面补画；Q1 实机测后再调 |
| Runner 在判定前重启 | 平台按现有规则把 CLI 判为 runner-restarted，进行中的 `interface` 段失败 |
| ready 事件丢失（未入库） | 组合保持 running；名册兜底读到 `record.ui.state === 'ready'` 时按本次时刻补上 |

## 7. 测试策略

| 层 | 文件 | 必写用例 |
|---|---|---|
| unit | `runtimes/task/src/terminal/interfaceReadiness.test.ts` | 可见文字＋静止 500 ms 判 screen；静止期内有新输出顺延；只有查询（可见 0）不判完成、到 45 秒判 timeout；判定后忽略输入；`nextTickAt` 取值 |
| unit | `runtimes/task/src/terminal/terminalScreen.test.ts`（新增） | 真无头 xterm：只写查询序列可见 0；进备用屏写文字后按活动缓冲区计数；退出备用屏后回到 normal 缓冲区计数 |
| unit | `runtimes/task/tests/nativeSupervisor.test.ts` | running 事件带 `ui.waiting`；真 PTY 的 shell 提示出现并静止后发 `ui.ready/screen`（判据调小）；无输出到超时发 `ui.ready/timeout`；判定前退出不再发 ready、计时器已清 |
| unit | `modules/dev-session/domain/nativeTerminalProjection.test.ts` | 新 Runner 等待中为七段且整体 running；ready 后七段首尾相接、整体 ready；timeout 的 detail；旧 Runner 段跳过且整体 ready 时刻与今天相同；初始化中退出记失败（agent-start-failed）；初始化中被关闭记取消 |
| module | dev-session 名册读取既有模块用例 | 事件里带 `ui` 的组合与冻结；名册兜底 |
| console | `apps/console/src/tests/` | `StageProgress` 渲染 `interface` 段文案与 x/7；`useCreatorClaim` 在 running 且 startup running 时仍返回「在用」、startup ready 后不再 |
| contract | contracts Schema 用例 | `ui` 可选、`interface` 种类可解析；六段旧冻结记录仍可解析 |

实机验收见提案 §7。

## 8. 本 RFC 承担的结构演进与留下的债

- 演进：界面判定写成纯函数状态机，与 PTY、计时器解耦，Runner 里第一个「从屏幕推导状态」的点有了可复用的形状。
- 债：`nativeSupervisor.ts` 继续承担接线（判定、控制、活动通道都在一个类里）。若后续再加屏幕推导（例如 Q3 的代答查询），应把每个 CLI 的屏幕相关职责抽成 `NativeScreenSession`，本 RFC 不做。
