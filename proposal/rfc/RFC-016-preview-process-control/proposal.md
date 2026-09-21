# RFC-016：开发会话预览进程的自主启停与调试

状态：Draft · 2026-09-21 · 待作者批准。范围与三项取舍由作者本轮当面裁定（见「裁定」）。

## 背景

开发会话里的预览进程由 TaskRunner 的 `PreviewSupervisor` 监督：按 Manifest 的开发命令拉起，轮询健康路径至 2xx 记 `ready`，意外退出按指数退避重启，连续 5 次失败记 `crashed` 后不再自动拉起（`runtimes/task/src/preview/previewSupervisor.ts:142`、`runtimes/task/src/config.ts:62`）。

意图 Agent 在开发容器里改代码，改坏预览是常态：改了启动脚本、装了不兼容的依赖、端口被占、健康路径返回非 2xx。但 Agent 今天**没有任何修复或诊断预览的手段**。已核实的现状：

1. **不能重启。** Runner 协议有 `restartPreview`（`packages/contracts/taskrunner/protocol.ts:144`），工作台经任务 WebSocket 直接发给 cs-session 用（`apps/console/src/features/dev-session/model/preview/previewStatusStore.ts:66`）。但 MCP 走的是 cs-api REST（`packages/mcp-server/caller/platformClient.ts`），而 `modules/dev-session/http/devSessionRoutes.ts` 里一条预览路由都没有。
2. **状态是有损的。** Runner 的 `previewStatus` 返回 `{state, port, restarts, lastError}`（`packages/contracts/taskrunner/protocol.ts:166`），但 `modules/dev-session/application/sessionLifecycle.ts:21` 只取 `.state` 就丢掉其余。操作 MCP 的 `read_preview_status` 读的正是这个字段，Agent 拿到的是一个光秃秃的 `crashed`，**看不出崩在哪、重试了几次**。
3. **输出无处可取。** 预览进程的 stdout／stderr 只按 `preview output` 打进 Runner 日志（`previewSupervisor.ts:107`），最终混在 Pod 日志里。`tail_logs(source: 'dev-session')` 会把 Runner、各 CLI 与预览的输出一起返回，Agent 得自己从中筛。
4. **不能停。** `PreviewSupervisor.stop()` 存在（`previewSupervisor.ts:75`），但只在 Runner 关停时调用；协议里没有对应命令。Agent 想自己在终端里跑一次 dev server 看原始输出时，端口被监督进程占着。

结果是：预览一旦崩掉，唯一的出路是人去工作台点「重启预览」，或释放并重开会话。Agent 明明就在容器里，却只能报告「预览坏了」。

## 目标

1. Agent 能自主**启动、停止、重启**本会话的预览进程。
2. Agent 能看到预览**为什么坏**：失败原因、重启次数、端口，以及预览进程自己的最近输出。
3. 预览的状态读取与控制**在工作台、CLI 与操作 MCP 之间走同一条 cs-api 入口**，授权判定只有一处。
4. 已在跑的旧容器不因此报协议错误，而是明确回答「本会话的容器不支持该操作」。

## 非目标

- 不做预览命令的持久化改写。预览命令／端口／健康路径在开会话时由 Manifest 推导（`sessionLifecycle.ts:53`），建 Pod 时固化成 `CS_PREVIEW_*` 环境变量（`modules/task-runtime/application/containerEnv.ts`），本 RFC 不改这条链，也不允许 Agent 临时覆盖（见裁定三）。**Agent 改了 `crewstation.yaml` 里的开发命令，重启预览不会生效，仍需重建会话**——这一点要在工具描述里写明，不留给 Agent 猜。
- 不改预览的自动重启策略（5 次上限、指数退避）。
- 不碰部署槽的预览（preview slot）；本 RFC 只涉及开发会话容器内的预览进程。这两个「preview」同名不同物，文档与工具描述都须消歧。
- 不给业务子任务这组能力：业务任务容器没有预览进程，也没有开发会话令牌（open question I2）。

## 裁定

作者本轮就三处取舍给出选择，RFC 按此展开：

| 取舍 | 选择 | 影响 |
|---|---|---|
| 控制权范围 | 重启 ＋ **停止／启动** | Runner 协议新增 `startPreview`／`stopPreview`；Agent 可腾出端口自己跑 dev server。代价：预览停着时开发预览域名返回 502，试用者看到挂掉的页面 |
| 调试信息 | 富状态 ＋ **预览输出环形缓冲** | Runner 侧新增有界输出缓冲与取回命令，Agent 一次拿到干净的崩溃栈 |
| 接入通道 | cs-api 新路由，**工作台也迁过来** | 同一操作只剩一条路径与一处授权判定；工作台的 `previewState` 事件订阅保持不变，实时性不受影响 |

## 能力影响清单

本方案不关闭任何既有能力。工作台的预览状态展示、重启按钮、`previewState` 实时事件、`previewUrl` 就绪判定、会话 DTO 的 `preview` 概要字段全部保留。

新增的停止能力会让预览进入 `stopped` 且不自动恢复，这是设计意图而非故障；工作台须把「已被停止」与「崩溃」在文案上分开，`previewUrl()` 现有逻辑（非 `ready` 不给地址，`previewSnapshot.ts:28`）已经覆盖了链接侧的表现。

## 验收

以 PV-01…PV-18 记在 [plan.md](./plan.md)。要点：在本机集群的真实开发会话里，由 Agent 经操作 MCP 走通「改坏预览 → 读状态看到 `crashed` 与原因 → 读预览输出定位 → 停止 → 在终端里手动跑通 → 启动 → 回到 `ready`」整条链；工作台迁到 REST 后重启按钮与实时状态仍然正确；旧容器（未宣告新能力）收到停止／启动请求时返回可读的 precondition 而非协议错误。
