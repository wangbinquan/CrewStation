# RFC-016｜设计

状态：In Progress · 2026-09-21 · 作者已批准实施并要求提交上库。本文档已按落地实现回填，实现时推翻的三处初版判断（`attempt` 计数、脱敏、`asPreviewStatusResult` 存留）在正文中逐条写明。

## 实现定位

| 层 | 改动 |
|---|---|
| `packages/contracts/taskrunner/protocol.ts` | 新增 `startPreview`／`stopPreview`／`previewLogs` 三条命令、`previewLogs` 结果、hello 的 `previewControl` 能力位 |
| `runtimes/task/src/preview/previewOutputBuffer.ts`（新） | 预览输出的有界环形缓冲 |
| `runtimes/task/src/preview/previewSupervisor.ts` | 接缓冲；`start()` 的幂等与计数语义补全 |
| `runtimes/task/src/commandHandlers.ts:59` | 三条新命令接到 supervisor |
| `runtimes/task/src/runner.ts:120` | hello 宣告 `previewControl: 1` |
| `modules/session/application/commandDispatch.ts:14` | 按能力位挡住旧容器 |
| `modules/dev-session/application/previewControl.ts`（新） | 状态、控制、日志三个用例与授权 |
| `modules/dev-session/http/devSessionRoutes.ts` | 五条预览路由 |
| `packages/api-client/resources/devSession.ts` | 对应五个方法 |
| `packages/mcp-server/operations/observabilityTools.ts` | `read_preview_status` 补全；新增 `control_preview`、`read_preview_logs` |
| `apps/console/src/features/dev-session/model/preview/previewStatusStore.ts` | 命令从 WS `channel.send` 改为 REST；事件订阅不动 |

## Runner 协议

三条新命令加进 `RunnerCommandSchema`（现有两条在 `protocol.ts:143`）：

- `startPreview`：未配置预览返回 `preview_disabled`；已在 `starting`／`ready` 返回 `preview_already_running`；否则清零 `restarts`／`lastError` 后拉起，回 `ack`。
- `stopPreview`：未配置预览返回 `preview_disabled`；否则置 `stopping` 并杀进程树，状态迁 `stopped`，回 `ack`。停止后**不自动拉起**——`onExit` 的 `if (this.stopping) return`（`previewSupervisor.ts:141`）已经保证了这点。
- `previewLogs`：入参 `limit`（默认 200，上限 2000）、`stream`（`stdout`／`stderr`，缺省两者）；返回 `{ lines: [{ at, stream, attempt, text }], dropped, attempt }`。

`previewStatus` 的结果形状不变（`protocol.ts:166` 已含 `restarts`、`lastError`），本 RFC 只是把它一路透出去。

### 能力协商，不是协议升版

hello 的 `capabilities` 加 `previewControl: z.literal(1).optional()`，照 `apiInvocations`（`protocol.ts:39`）的先例。**不动 `TASKRUNNER_PROTOCOL_VERSION`**：开发会话是长活对象，集群里正跑着的容器带的是旧 Runner 镜像，升版会让它们握手即被拒，等于强制所有人释放会话。

`modules/session/application/commandDispatch.ts` 按 `apiInvocations` 那一行的写法加一条：三条新命令在 `capabilities.previewControl !== 1` 时抛 `precondition`，code `preview_control_unavailable`，文案指明「本会话的容器还不支持停止／启动预览与读取预览输出，重建会话后可用」。`previewStatus`／`restartPreview` 不受此门禁，旧容器照常可用。

## 输出环形缓冲

`previewOutputBuffer.ts` 独立成文件，不把 `previewSupervisor.ts`（现 165 行）推向 600 行上限，也让容量与截断规则可以单独测。

- 双上限：**行数 2000** 与**总字节 256 KiB**，任一触顶即从头丢弃，`dropped` 累计丢弃行数。256 KiB 与 `exec` 结果的现有上限（`protocol.ts:169`）取齐，不引入第二套尺度。
- 单行截断到 8 KiB，按**字节**切，再用非严格解码把切开的多字节字符收成 U+FFFD 并去掉，截断标记进该行。
- 每行带 `attempt`，**跨重启不清空**：崩溃前那一次的输出正是要看的东西，清掉等于把证据删了。`stopPreview` 同样不清空。
- 缓冲接在 `forwardOutput`（`previewSupervisor.ts:106`）已有的行分割器上，与现有的日志转发并列，不替换它——Pod 日志侧的行为保持原样。

**`attempt` 必须与 `restarts` 分开**（实现时发现，初版写成 `restarts + 1` 是错的）：`restart()`／`requestStart()` 会把 `restarts` 清零以恢复自动重试预算，若 `attempt` 跟着它走，显式重启前后的行就都标 `1`，缓冲跨重启保留也就白做了。因此 supervisor 另立一个**永不清零**的 `runs` 计数，每次真正拉起进程加一；`restarts` 仍只表示「自动重试烧掉了几次」并照常进 `previewStatus`。

**不做脱敏。** 初版设计写的是复用终端探针那份 `sensitiveValues`，核实后不成立：那份脱敏要的是档位的 `beforeStart.secrets`，预览进程根本不从档位材料启动，没有这份清单。真正的平台凭据 `CS_RUNNER_TOKEN` 与 `CS_SESSION_URL` 已由 `buildChildEnv`（`runtimes/task/src/process/childEnvironment.ts:2`）从**所有**子进程环境里剔除，预览进程打不出来；余下能出现的是项目自己的配置，而能读这份缓冲的 owner／developer／admin 本来就能在同一容器的终端里读到它们（tester 只有 `view-preview`，够不到开发会话）。加一层对不上号的脱敏只会制造安全错觉。

## 平台 API

全部挂在既有的项目维度开发会话前缀下（`devSessionRoutes.ts:16` 注明这是「工作台、CLI 与操作 MCP 共用的开发会话入口（R03）」）：

| 路由 | 权限 | 说明 |
|---|---|---|
| `GET /v1/projects/:projectId/dev-session/preview` | `view` | `PreviewStatusDto`：`state`／`port`／`restarts`／`lastError`／`previewHost`／`url` |
| `POST …/dev-session/preview/:action` | `develop` | `action` ∈ `start`／`stop`／`restart`，回最新 `PreviewStatusDto` |
| `GET …/dev-session/preview/logs?limit=&stream=` | `view` | `PreviewLogsDto` |

控制是**一条参数化路由**而不是三条字面量：动作由 `PreviewActionSchema` 在 params 上校验，不合法的动作得到点名三种取值的 400 而不是裸 404；更要紧的是客户端构造的是 `preview/${action}`，写成三条字面量会让接口面锁（`apps/console/src/tests/platformSurface.test.ts`）判定客户端有一条后端没声明的路径——那条锁是对的，路径逐段对不上就是对不上。

授权沿用 `authorizer.authorize(actor, projectId, …)`（`sessionLifecycle.ts:44`）：读用 `view`，任何改变运行状态的动作用 `develop`——与「开会话」同级，因为它改的是同一个容器的运行状态。没有开发会话时 404；容器未连接时 `precondition`，不静默返回 `stopped`。

三个控制动作**回读一次状态再返回**，让调用方一次拿到结果，不必自己轮询；`start`／`restart` 只保证命令已受理，`ready` 要等健康探测，返回里因此会是 `starting`，文案须讲清这点。

`DevSessionDto.preview` 保持 `PreviewState` 概要字段不变：它是会话卡片的摘要，改成富对象是无谓的破坏性契约变更。富状态走新端点。

## 操作 MCP

三个工具移进新文件 `packages/mcp-server/operations/previewTools.ts`；`observabilityTools.ts` 只剩 `tail_logs`——预览进程的控制不是可观测性，`read_preview_status` 原先放在那里本就是混编。

| 工具 | 变化 |
|---|---|
| `read_preview_status` | 改读新端点，返回 `{ devSession, preview: {state, port, restarts, lastError, url}, slots }`。现有的两槽部分保留 |
| `control_preview`（新） | 入参 `action: 'start' \| 'stop' \| 'restart'`，返回动作后的状态 |
| `read_preview_logs`（新） | 入参 `limit`、`stream`，返回缓冲行与 `dropped` |

`read_preview_status` 三个请求并发取，任一失败整条失败：容器断线时 Agent 拿到的是平台原话「开发容器未连接」，这正是它此刻该知道的事，比返回半份数据让它继续猜要好。这与操作 MCP 自己的说明书一致——「被拒绝时错误文本里是平台的原话，按它说的去补条件」。

日志**不并进 `tail_logs`**：`tail_logs` 的 `source` 是平台侧聚合日志源（`LogSourceSchema`，`packages/contracts/api/observability.ts:5`），backing store 与分页语义都不同；把一个 Runner 内存缓冲伪装成第六个 source 会让两种失效模式（Pod 被换掉 vs 缓冲被挤掉）长得一样。

三个工具的描述里必须写明本 RFC 非目标里的两条：改 `crewstation.yaml` 的开发命令需重建会话才生效；此处的 preview 是开发会话预览进程，不是 preview 部署槽。

## 工作台迁移

`previewStatusStore.ts` 原先做两件事：订阅 `previewState` 事件与用 `channel.send` 发两条命令。迁移**只动后者**——事件仍从任务流来，实时性不变；`applyPreviewEvent` 的按字段合并逻辑（`previewSnapshot.ts:12`）原样保留，因为事件依旧只带 `state`／`port`／`message`。命令改经一个 `PreviewCommands` 端口注入，用例可以直接给假实现，不必再伪造一条流。

控制动作**仍统一回读一次状态**，不直接采用动作回执：`read()` 里有「不得覆盖请求发出后到达的事件」那道判定，用回执会绕过它。多一次往返换掉一类竞态。

`asPreviewStatusResult`（`runnerResults.ts`）随迁移**变成死代码并删除**。初版设计说「事件路径仍需要它」是错的：事件路径走的是 `RunnerEventSchema.safeParse`，从来没用过它。相应地，畸形 REST 响应不再被这层手写校验拦住——这与控制台其余所有 api-client 调用的姿态一致，不为一条端点单开一套校验；服务端在 Runner 边界已用 `RunnerResultPayloads` 解析过。

界面上 `devSession.preview.*` 增停止／启动两个动作与相应文案，把「已停止（你停的，不会自己回来）」与「已崩溃（连续失败后放弃重试）」分开表达。`busy` 互斥、`confirmed` 语义、冲突文案沿用现有 store 的处理方式。

`PreviewPane.tsx` 与其样式模块**一并删除**：改到它时才发现自 `58ea7cd` 起全仓零引用，实际在渲染的是 `DevelopmentPreview`。新增代码防护正是这样发现的——「有可执行逻辑，但没有任何用例加载它」。它唯一的消费者 `previewStateTone` 随之成为孤儿导出，一并移除。

## 失败模式

| 情况 | 行为 |
|---|---|
| 未配置预览（Manifest 无开发命令） | `preview_disabled`，工具描述指向「改 Manifest 后重开会话」 |
| 容器是旧镜像 | `preview_control_unavailable`，precondition，提示重建会话 |
| 容器未连接 | `precondition`，不伪装成 `stopped` |
| 停止后被问 URL | `previewUrl()` 现有逻辑已返回 undefined |
| 端口被别的进程占 | `startPreview` 拉起后健康探测不过，走既有 `crashed` 路径，`lastError` 带退出信息 |
| Agent 停了预览就不管了 | 会话空闲提醒不变；`stopped` 不触发额外告警。**这是已知的留白**，记进 open questions 由作者裁定要不要加提醒 |

## 验证

- 契约：三条新命令与结果的正向解析、`strict` 拒未知键、`limit` 边界；`previewControl` 可选位。
- Runner（`runtimes/task/tests/`）：缓冲的双上限与丢弃计数、单行截断、跨重启保留与 `attempt` 标记、脱敏；`start` 幂等与 `preview_already_running`；`stop` 后不自动拉起；三条命令在未配置预览时的错误码。沿用 `runnerLifecycle.test.ts` 的真实进程夹具，不造假 supervisor。
- 模块（真实 PostgreSQL）：五条路由的两档授权、无会话 404、未连接 precondition、旧容器能力门禁、控制动作的回读。
- 控制台：store 迁 REST 后的成功／失败／冲突路径，事件合并不被请求回执覆盖（现有 `previewStatus.test.tsx` 的不变量要继续成立）。
- MCP（`packages/mcp-server/tests/`）：三个工具的入参校验与错误透传。
- 实机：在本机集群真实开发会话里跑 PV-01…PV-18。
