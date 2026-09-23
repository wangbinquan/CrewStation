# RFC-022｜技术设计

> 状态：Done · 2026-09-23 · 作者裁定见 [提案](./proposal.md) §4 与 §8（第三轮批准并实施）
> 配套：[提案](./proposal.md) · [计划](./plan.md)

## 目录

- [1. 现状与落位](#1-现状与落位)
- [2. 契约](#2-契约)
- [3. 容器阶段：task-runtime](#3-容器阶段task-runtime)
- [4. CLI 的阶段：dev-session 组合](#4-cli-的阶段dev-session-组合)
- [5. 开发会话与重建](#5-开发会话与重建)
- [6. 档位测试迁移](#6-档位测试迁移)
- [7. 创建者自动取得输入控制](#7-创建者自动取得输入控制)
- [8. 工作台](#8-工作台)
- [9. crewstation 命令行](#9-crewstation-命令行)
- [10. 时序](#10-时序)
- [11. 失败模式与并发](#11-失败模式与并发)
- [12. 性能与规模](#12-性能与规模)
- [13. 测试策略](#13-测试策略)
- [14. 偏离与债](#14-偏离与债)

## 1. 现状与落位

按 [repository-structure.md](../../../docs/engineering/repository-structure.md) 落位，源码基线 `95c38de`。现状见提案 §2。

**模块规模。** `task-runtime` 现有 50 个生产文件、2708 行，`dev-session` 现有 51 个、2248 行，都已超过结构规则 §11 的 40 个文件；§11 要求模块再增长前先写拆分 ADR。本 RFC 照 RFC-019 对 `cluster-management` 的做法，**不给这两个模块新增生产文件**：新增的通用部分放进 `packages/contracts`（契约）和 `packages/k8s`（与领域无关的 Pod 启动观测），两个模块只扩已有文件；`task-runtime` 的 `domain/podFailures.ts`（8 行）更名为 `domain/podStartup.ts`，失败分类和阶段推导放在一处，文件数不变。拆分 ADR 仍然欠着（§14）。

| 落点 | 责任 |
|---|---|
| `packages/contracts/api/progress/startupProgress.ts`（新） | `StartupStageKind`、`StartupStage`、`StartupProgress` 三个 Schema；纯函数 `currentStage` |
| `packages/contracts/api/nativeTerminal.ts` | `NativeTerminalDto.startup` 可选 |
| `packages/contracts/api/devSession.ts` | `DevSessionDto.startup` 可选 |
| `packages/contracts/api/compute/computeProfile.ts` | `ProfileTestStage` 改为公共阶段的扩展；阶段状态与公共阶段共用；旧种类保留可读 |
| `packages/k8s/podStartup.ts`（新） | 从 Pod 对象和它的 Events 读出启动观测：调度、每个 init／主容器的等待原因与起止时间、退出码、镜像拉取；不含任何平台概念 |
| `modules/task-runtime`（L4） | 环境的 `startup` 列与迁移；阶段推导（`domain/podStartup.ts`）；每秒的启动观测用例（`application/reconcile.ts`）；受理、建 Pod、连上、握手被拒、判失败、释放、重建各处写阶段；失败时留日志尾部；`ports/cluster.ts`、`adapters/k8s/taskCluster.ts` 增加观测与读日志；环境视图带 `startup`；档位测试改读环境的阶段 |
| `modules/dev-session`（L5） | CLI 阶段的组合（`domain/nativeTerminalProjection.ts`）；读名册时组合，结束时冻结进受理记录已有的 `execution` 文档（`application/nativeExecution.ts`）；`ports/runtime.ts` 的 `EnvironmentView.startup` 与留日志端口；开发会话 DTO 带 `startup`（`application/sessionLifecycle.ts:11-17`） |
| `modules/agent-runtime`（L3） | 只随契约接受新的阶段种类；档位测试记录是 JSON，不迁移 |
| `runtimes/task` | `nativeSupervisor.claim` 在 CLI 启动中也接受；启动失败的几条路径释放控制计时器 |
| `packages/api-client` | 无新接口，字段随 DTO |
| `apps/console` | `shared/ui/progress/`（新目录：`StageProgress.tsx`、`StageProgress.module.css`、`stageProgressView.ts`）；应用级文案；CLI 视图、开发会话工作区、档位测试面板接入；创建者自动取得；启动期间每秒刷新 |
| `apps/cli` | `session open／show` 打印启动过程 |

不新增模块、不改层级、不新增跨模块 import。dev-session 读 task-runtime 的阶段走已有的 `Environments` 端口（`modules/dev-session/ports/runtime.ts:27-`），由组合根接线。`shared/ui` 根目录已有 20 个源码文件（上限），步骤条放进新子目录 `progress/`，与 `navigation/`、`dock/` 同级。

## 2. 契约

```ts
// packages/contracts/api/progress/startupProgress.ts（新）
export const StartupStageKindSchema = z.enum(['queue', 'replace', 'container', 'checkout', 'connect', 'prepare', 'agent', 'ready']);
export const StartupStageStateSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']);

export const StartupStageSchema = z.object({
  kind: StartupStageKindSchema,
  state: StartupStageStateSchema,
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  /** 名称里的参数：检出的分支。 */
  subject: z.string().max(300).optional(),
  /** 准备环境的 x/y。 */
  count: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }).optional(),
  /** 平台写的一句细节：节点、镜像与拉取用时、当前步骤名。不含凭据、脚本源码与文件正文。 */
  detail: z.string().max(1024).optional(),
  /** 仍在进行、Kubernetes 正在重试的问题：调度资源不足、镜像拉取退避。 */
  warning: z.string().max(1024).optional(),
  error: z.object({ code: z.string().min(1).max(64), message: z.string().max(4096) }).optional(),
  /** 判定失败后、回收容器前留下的日志尾部：最多 100 行，已按凭据形状打码。 */
  logTail: z.string().max(16_384).optional(),
});

export const StartupProgressSchema = z.object({
  state: z.enum(['running', 'ready', 'failed', 'cancelled']),
  stages: z.array(StartupStageSchema).max(16),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  /** 服务器给出这份进度的时刻；页面据此校正本机时钟偏差。库里不存，读出时填。 */
  observedAt: z.iso.datetime(),
});

/** 失败的那段；否则第一个进行中的；否则第一个未开始的；否则最后一段。工作台与命令行共用。 */
export function currentStage(progress: StartupProgress): StartupStage | undefined;
```

`error.code` 的取值：`admission-rejected`、`pod-create-failed`、`image-pull-failed`、`container-start-failed`、`checkout-failed`、`pod-exited`、`pod-missing`、`connect-timeout`、`runner-protocol-mismatch`、`replace-failed`、`before-start-failed`、`agent-start-failed`、`workspace-lost`。名称不进契约：工作台按 `kind` 取文案，命令行有自己的中文名表（§9），档位测试的段自带 `name`。

DTO：`NativeTerminalDtoSchema` 与 `DevSessionDtoSchema` 各加 `startup: StartupProgressSchema.optional()`。没有 `startup` 的是升级前创建的对象，页面按今天的方式显示。

档位测试：

```ts
export const ProfileTestStageStateSchema = StartupStageStateSchema;   // 取值与今天相同
export const ProfileTestStageSchema = StartupStageSchema.omit({ kind: true, error: true }).extend({
  id: z.string().min(1),
  kind: z.enum([...StartupStageKindSchema.options, 'step', 'model', 'command', /** 旧记录 */ 'image', 'runner', 'launch']),
  name: z.string().min(1),
  stepId: StepIdSchema.optional(),
  exitCode: z.number().int().nullable().optional(),
  log: z.object({ stdoutTail: z.string(), stderrTail: z.string() }).optional(),
  error: BeforeStartErrorSchema.extend({ code: z.string() }).optional(),
});
```

旧字段一个不删，旧记录照样通过解析（`packages/contracts/api/compute/computeProfile.ts:94-110`）。改完跑 `bun run contracts:lock`，确认不涉及业务契约面。

## 3. 容器阶段：task-runtime

### 3.1 存储

`task_runtime.environments` 加一列 `startup jsonb`（迁移 `0009_environment_startup.sql`，可空，不回填），另建部分索引 `where startup->>'state' = 'running'` 供观测用例取启动中的环境。领域类型 `TaskEnvironment.startup` 与契约相同，只是不带 `observedAt`；`environmentToDto`（`application/queries.ts:30`）读出时补上。

### 3.2 写入点

全部在已有的事务和项目锁里，与原来那次状态写入同一次 `update`。

| 时机 | 位置 | 阶段变化 |
|---|---|---|
| 受理（开发会话、业务任务、档位测试） | `application/createEnvironment.ts:65-70` | 新建：`queue` 进行中；开发会话首次创建带 `checkout`，`subject`＝分支 |
| 受理（执行环境） | `application/nativeExecution.ts:60-69` | 新建：`queue` 进行中（执行环境没有 init 容器） |
| Pod 已建 | `createEnvironment.ts:74-78,93-100`（`recordPodInstance`）；`nativeExecution.ts:113-116` | `queue` 成功，`container` 进行中 |
| 建 Pod 失败 | `createEnvironment.ts:79-88` | `queue` 失败，`pod-create-failed` |
| 重建受理 | `application/requestRebuild.ts:36-41` | 重置为重建的五段，`queue` 进行中 |
| 重建开始替换 | `workers/rebuildWorker.ts:15` | `queue` 成功，`replace` 进行中 |
| 重建建出新 Pod | `application/rebuildExecution.ts:46-47` | `replace` 成功，`container` 进行中 |
| 观测 | `application/reconcile.ts` 新用例（§3.5） | `container` 的细节与警告；`container`→`checkout`→`connect` 的推进 |
| TaskRunner 连上 | `application/runnerLifecycle.ts:11-28` | `connect` 成功；非执行环境再记 `ready` 成功、整体已就绪；执行环境的其余段由 dev-session 组合（§4） |
| 握手被拒 | `runnerLifecycle.ts:34-46` | `connect` 失败，`runner-protocol-mismatch`（开发会话与业务任务的环境状态照旧不变，只是进度记为失败） |
| 判定失败 | `application/failEnvironment.ts:9-31`（对账的镜像、容器、超时、退出；执行环境准备失败） | 当前进行中的段失败，`error.code` 按原因，附日志尾部（§3.6）；整体失败 |
| 重建补偿 | `rebuildExecution.ts:50-59` | 整体失败（失败的段已在判定时写好） |
| 用户释放、停止、业务暂停 | `application/lifecycle.ts` 各释放路径 | 整体已取消，进行中的段记为跳过 |
| 业务任务恢复 | `lifecycle.ts:71-85`（`resumeEnvironment`） | 重置为首次创建的阶段（只有数据，本 RFC 不做界面） |

### 3.3 读 Pod：`packages/k8s/podStartup.ts`

纯函数 `podStartup(pod, events): PodStartupObservation`，只认 Kubernetes 的概念：

| 字段 | 来源 |
|---|---|
| `scheduled: { at, node }` | 条件 `PodScheduled=True` 的 `lastTransitionTime`；`spec.nodeName` |
| `unschedulable: { reason, message }` | 条件 `PodScheduled=False` |
| `containers[]: { name, init, waiting?: { reason, message }, startedAt?, finishedAt?, exitCode? }` | `initContainerStatuses`、`containerStatuses` 的 `state.waiting／running／terminated` |
| `pulls[]: { container, image, startedAt?, endedAt?, cached, took? }` | Events `Pulling`、`Pulled`（`Successfully pulled … in 2.3s` 或 `already present on machine`）、`Failed`、`BackOff`；按 `involvedObject.fieldPath` 分到容器 |

task-runtime 的适配器（`adapters/k8s/taskCluster.ts`）增加 `observeStartup(env, { events })`：GET Pod；需要时按 `fieldSelector=involvedObject.uid=<Pod UID>` 列 Events，写法与 `modules/cluster-management/adapters/k8s/clusterReader.ts:18` 相同。今天的 `podPhase` 保留不动。

### 3.4 推导：`domain/podStartup.ts`

`advanceStartup(startup, observation, now)` 是纯函数：

- `container`：从 Pod 建出算起，到第一个容器（先 init 后主容器）的 `startedAt` 结束。细节依次是：等待调度 → 已调度到节点 X → 拉取镜像 Y → 镜像已就绪（用时 n 秒／节点上已有）→ 创建容器。等待原因属于 `IMAGE_PULL_FAILURES`、`CONTAINER_START_FAILURES`（原 `podFailures.ts` 的两个集合），或调度器报告调度不上时，写进 `warning`，这一段仍是进行中。
- `checkout`：init 容器 `checkout` 的 `startedAt` 到 `finishedAt`；以 0 退出为成功。非 0 退出时 Pod 不重启（`packages/k8s/objects/workloads.ts:90-97`），对账按 Pod `Failed` 判失败（`application/reconcile.ts:36-42`），失败由 §3.2 的判定写入，推导不自己判。
- `connect`：从主容器 `startedAt` 算起；只由 TaskRunner 连上结束。
- 只进不退：已成功或失败的段不再改。结束时间早于开始时间时（节点与控制面时钟偏差）取开始时间，`durationMs` 由同一对时间算出。
- 细节只写离散变化（换了子状态才写），不写计时，每次启动写库在十次以内。

### 3.5 观测用例

`application/reconcile.ts` 增加 `observeStartupUseCase`，组合根每秒调用一次（`wiring.ts:129` 旁边再挂一个计时器）：

1. 取启动中的环境（`startup.state = 'running'`，按 `updatedAt` 最早的在前，每次最多 64 个）；排队中、重建替换中的跳过（这两段由作业自己写）。
2. 每个环境读一次 Pod；`container` 进行中时同时读 Events。
3. 推导出的进度与库里不同时，在 `uow.run` 里加项目锁、重读、在最新记录上再推导一次后写回，避免覆盖同时发生的连上或判定。
4. 对同一批环境调用对账里判失败的同一个函数（把 `reconcile.ts` 循环体提成 `judgeEnvironment`）。规则一条不变，只是启动中的环境从每 15 秒检查一次变为每秒一次，失败能在一两秒内显示出来。

### 3.6 失败时留日志

判定失败时（`failEnvironment`），在进入事务之前按失败的段读日志：`checkout` 读 init 容器 `checkout`，`connect` 读主容器，`queue`、`container` 没有容器日志可读。读最后 100 行，超时 3 秒，用 `maskDiagnosticsText`（`domain/diagnosticsText.ts:11`）按凭据形状打码（包括 URL 里的令牌，克隆失败时 git 可能把带令牌的地址打出来），存进失败那段的 `logTail`。读不到就不存，不影响判定。

模块接口增加 `captureStartupLog(taskId, container)`，供 dev-session 在 CLI 的「准备环境」「Agent 启动中」失败时，于回收执行容器之前读主容器日志（§4.2）。

## 4. CLI 的阶段：dev-session 组合

### 4.1 组合规则

`domain/nativeTerminalProjection.ts` 增加纯函数 `composeCliStartup({ accepted, environment, beforeStart, runningAt, record })`：

| 输入 | 来源 |
|---|---|
| `accepted` | CLI 受理时间，即 `record.startedAt` |
| `environment` | 执行环境的 `startup`（`queue`、`container`、`connect`），经 `EnvironmentView` |
| `beforeStart` | 执行任务最近一条 beforeStart 事件（步骤与每步起止时间） |
| `runningAt` | 第一条 `lifecycle: 'running'` 的 nativeTerminal 事件被平台收到的时间 |
| `record` | CLI 记录的生命周期、原因、错误 |

- `queue` 从 `accepted` 算起（CLI 受理早于执行环境受理），其余三段照搬执行环境的；执行环境的 `ready` 不要。
- `prepare`：从 `connect` 结束算起；`count` 为已成功的步数与总步数，`detail` 为当前步骤名；在 beforeStart 的 `endedAt` 成功；beforeStart 失败或取消时失败，写出步骤名与原因；步骤数为 0 时记为跳过。
- `agent`：从 `prepare` 结束算起（跳过时从 `connect` 结束算起），到 `runningAt` 成功；记录以 `start-failed` 结束时失败。
- `ready`：在 `runningAt` 成功。
- 整体：有失败即失败；`ready` 成功即已就绪；记录以 `stopped` 结束且未就绪为已取消；否则启动中。
- 执行环境没有 `startup`（升级前受理）时不组合，`startup` 留空。

### 4.2 读取与冻结

`application/nativeExecution.ts` 的 `read()` 已经读执行环境并按需向 Runner 取名册（`:37-58`）。在此基础上：

1. 受理记录的 `execution` 文档（`adapters/persistence/nativeTerminalTable.ts:14`，JSON）里已有冻结的 `startup`，直接返回，不再读事件。
2. 否则读执行任务的事件 `runner.listEvents(executionTaskId, { kinds: ['beforeStart', 'nativeTerminal'] })`。执行任务里只有这一个 CLI，不需要按 agentId 过滤（事件表也没有为 nativeTerminal 抽 agentId，`modules/session/adapters/persistence/drizzleRepositories.ts:12`）。
3. 组合；整体已就绪、失败或已取消时，把结果写进 `execution.startup` 冻结，不加列、不迁移。
4. 「准备环境」「Agent 启动中」失败时，`cleanup()` 在请求回收执行环境之前调用 `captureStartupLog` 取主容器日志尾部，写进冻结结果的失败段。

事件表读取失败时，`prepare`、`agent` 保持进行中且不冻结，下次读取再算。

## 5. 开发会话与重建

`DevSessionDto.startup` 就是开发会话环境的 `startup`：五段全部由 task-runtime 产出（§3.2），dev-session 在 `toDto`（`application/sessionLifecycle.ts:11-17`）里原样带出。重建由 `requestRebuild` 重置为重建的五段，旧的启动过程被替换（提案 B10）；`DevSessionDto.rebuild` 照旧保留。

重试（提案 Q1）只在工作台组合已有动作：失败在 `checkout` 或更早时，调用释放与开始开发（同一分支）；失败在 `connect` 时，打开现有恢复流程（`inspectRebuild`／`requestRebuild`）。后端不加接口。

## 6. 档位测试迁移

- 测试环境与其他环境一样由观测用例维护 `startup`。执行器（`application/profileTest.ts`）的 `waitForRunner`（`:66-99`）不再自己读 Pod 推进阶段，改为读环境的 `startup`，把 `queue`、`container`、`connect` 三段接在报告的最前面；`describeRunner` 不再产出 `runner` 段。
- 判定规则不变，归类改为读阶段：

| 今天的依据 | 改后的依据 | 结论 |
|---|---|---|
| Pod 等待原因属于镜像拉取失败 | `container` 段 `warning` 或 `error` 的代码为 `image-pull-failed` | `image-pull-failed`，立即结束 |
| 环境失败、Pod `Failed／Succeeded／Missing`、容器无法创建 | `container`／`connect` 段失败，或 `warning` 为 `container-start-failed` | `runner-unavailable` |
| `runnerRejection` | `connect` 段失败，`runner-protocol-mismatch` | `runner-protocol-mismatch` |
| 5 分钟未连上（测试自己的时限） | 同左，不变 | `timeout` |

- `launchStage` 产出的段改为 `kind: 'agent'`、名称「Agent 启动中」；逐个步骤、模型轮次、测试命令不变（`domain/profileTestStages.ts`）。
- 工作台读旧记录时，`image`、`runner`、`launch` 照原名称显示。

## 7. 创建者自动取得输入控制

### 7.1 TaskRunner

- `nativeSupervisor.claim`（`runtimes/task/src/terminal/nativeSupervisor.ts:179-184`）改为 `starting`、`running` 都接受；`input`、`resize` 仍只在 `running` 接受。
- 启动失败的三条路径（`prepareEnvironment` 的失败、`launch` 的失败、`endStopped`）补上 `entry.control.dispose()`，今天只有进程退出时释放（`:163-171`）；否则启动中取得的控制会留下计时器。
- 协议版本不变，不加能力位：旧 Runner 在启动中拒绝取得（`terminal_ended`），页面把它当作「还不能取得」，进程拉起后再取。

### 7.2 工作台

- `useNativeTerminals.launch`（`hooks/native/useNativeTerminals.ts:27-37`）成功后，把 `clientRequestId` 记进本窗口的内存登记（`model/native/` 下一个小模块，页面刷新即清空）。
- `LiveNativeTerminalView` 收到 `createdHere`。满足「本窗口创建、能开发、终端已接上（phase `ready`）」时调用 `attachment.ensureControl()`：启动中即尝试；被旧 Runner 拒绝就在 `lifecycle` 变为 `running` 时再试；进程拉起后取得成功一次就从登记里删掉。
- 进程拉起时，若焦点不在别的可编辑元素（输入框、文本域、编辑器、其他终端）上，把焦点移进这个终端；否则只取得、不抢焦点，之后按 2026-09-23 的规则：焦点不在终端满 30 秒释放。
- 启动中取得时附件不能发改尺寸（Runner 会拒）：`resize` 在 `running` 之前只记下尺寸，进程拉起后发一次。

## 8. 工作台

### 8.1 公共组件：`shared/ui/progress/`

`StageProgress` 的属性：

| 属性 | 说明 |
|---|---|
| `progress` | 阶段列表、整体状态、`observedAt` |
| `label(stage)` | 段名。默认按 `kind` 取应用级文案；档位测试传自己的 `name` |
| `title` | 例如「正在启动 CLI · volc-glm-5-2」「正在准备开发环境 · 分支 main」「正在恢复开发环境」 |
| `actions` | 失败时的按钮，由使用方给（重试、查看日志） |
| `renderExtra(stage)` | 段下面的附加内容（档位测试的定位按钮、退出码、输出尾部） |

- 每段一行：✓ 成功（用时）、● 进行中（细节与计时）、○ 未开始、✕ 失败（原因）、— 跳过；`warning` 用黄色，失败用红色；`logTail` 折叠在失败段下，按钮「查看执行容器日志」展开它。
- 列表 `<ol>`，当前段 `aria-current="step"`；当前段变化经 `aria-live="polite"` 读出；尊重 `prefers-reduced-motion`；颜色取主题令牌，暗色与浅色都成立。
- `stageProgressView.ts` 放纯函数：当前段与序号、用时格式（`0.6 s`、`1 分 03 秒`）、时钟偏差 `skew = Date.parse(observedAt) − 收到响应时的本机时间`，进行中那段的计时用 `Date.now() + skew − startedAt`。计时器每秒刷新一次，只在有进行中的段时运行。

### 8.2 CLI

- `LiveNativeTerminalView`（`components/native/NativeTerminalView.tsx:52-96`）：`startup` 存在且未就绪时，在终端区域上层居中显示 `StageProgress`；xterm 照常挂载、照常接上（为了 §7 的提前取得），只是被盖住。就绪后移除步骤条。
- 状态条：启动中显示「启动中 x/6 · 当前段名 · 细节 · 计时」；失败显示「启动失败 · 段名：原因」；就绪后恢复今天的输入控制状态行。标签头的「启动中」后加「x/6」。
- 失败时的按钮：「重试」按提案 Q2（原位替换：同样的档位选择、权限、工作目录新开一个，在本人的布局里占据失败标签的位置）；「查看执行容器日志」展开 `logTail`，执行容器还在时另给日志页入口（`source: dev-session`、`taskId`＝执行任务，日志按 Pod 标签 `crewstation.io/task` 读取，执行 Pod 带这个标签：`modules/task-runtime/adapters/k8s/taskObjects.ts:49`）。
- 已结束、已失败的 CLI 仍走 `SavedNativeTerminalView`；启动阶段就失败的（没有末屏）显示冻结的步骤条代替空白末屏。

### 8.3 开发会话

- `startup` 存在且未就绪时，CLI 区域中间显示 `StageProgress`；`ConnectionGuide`（`components/session/ConnectionGuide.tsx`）在启动中与重建中不再显示「正在准备／正在恢复」那一句，保留「检查状态」「查看日志」按钮；页头芯片显示「启动中 x/5 · 段名」。
- 失败时按钮「重试」（提案 Q1）、「查看容器日志」。

> **2026-09-23 修订（提案 D3 同日修订）：** 工作区揭开之前，`NativeWorkspace` 的 `gate` 只渲染 `components/session/SessionCover.tsx`：`startup` 在进行或失败时是这张 `StageProgress`（`SessionEntryFrame` 居中、整页长满），失败时 `recovery`（`RebuildSessionControl`）排在它下面；`ConnectionGuide` 与页头芯片都在揭开后才出现。`SessionStartup` 在整页形态下不传 `onRecover`（没有面板可开），恢复卡始终是加载层的第二个子节点，状态卡、步骤清单与步骤条来回切换时不重挂，已提交的恢复请求与回执保留。揭开后同一次进页不再盖回，本节原有的「CLI 区域中间」只用于揭开后发起的重建。

### 8.4 档位测试

`ProfileTestPanel`（`features/admin/components/compute/ProfileTestPanel.tsx:68-86`）的 `<ol>` 换成 `StageProgress`，`label` 用段自带的 `name`（旧种类 `image`、`runner`、`launch` 各有文案），`renderExtra` 放原来的定位按钮、退出码、输出尾部；阶段状态徽章改用组件自己的图标。

### 8.5 刷新频率

- CLI 名册：有任一 CLI 的 `startup.state` 为 `running` 时每秒一次，否则 10 秒（`useNativeTerminals.ts:11`）；Runner 事件触发的补刷不变。
- 开发会话：`startup.state` 为 `running` 时每秒一次，否则 10 秒（`hooks/useDevSession.ts:32`）。

### 8.6 文案

应用级文案（`app/i18n/zh-CN.ts`、`en-US.ts`）：`progress.stage.<kind>` 八个段名（`checkout` 带 `{branch}`，`prepare` 带 `{done}`、`{total}`），`progress.state.*`、`progress.skipped`、`progress.cached`、`progress.pulled`、`progress.scheduled`、`progress.elapsed`、`progress.viewLog`、`progress.retry`。dev-session 与 admin 的文案只放各自的标题与按钮。文案键守卫（`apps/console/src/tests/i18nKeysInCode.test.ts`）与中英一致性用例照常覆盖。

## 9. crewstation 命令行

`apps/cli/src/commands/sessionCommands.ts:42-49` 的 `sessionFields` 之后，有 `startup` 时打印一段：

```text
启动过程（已就绪，共 10.5 s）
  ✓ 排队分配容器                    0.6 s
  ✓ 容器启动中（调度、拉取镜像）     3.3 s   已调度到节点 docker-desktop · 镜像节点上已有
  ✓ 检出代码（分支 main）           1.2 s
  ✓ 容器已启动，等待连接            0.6 s
  ✓ 已就绪
```

段名表放在命令行自己的输出模块里（命令行只有中文）。`--json` 原样输出 DTO。

## 10. 时序

新开 CLI：

1. 页面 `POST …/native-terminals` → dev-session 受理，CLI 记录 `starting`。
2. dev-session 的执行作业向 task-runtime 申请执行环境 → `startup`：`queue` 进行中。
3. task-runtime 的执行作业建 Pod → `queue` 成功、`container` 进行中。
4. 观测用例每秒读 Pod 与 Events → `container` 的细节；主容器 `startedAt` → `container` 成功、`connect` 进行中。
5. TaskRunner 连上 → `connect` 成功；页面此后接上终端，创建者的窗口提前取得输入控制（§7）。
6. dev-session 派发 `startAgentTerminal` → beforeStart 事件 → `prepare` 进行中（x/y）→ 成功。
7. nativeTerminal 事件 `running` → `agent`、`ready` 成功；dev-session 冻结进度。页面收到 Runner 事件后 100 毫秒补刷名册，移除步骤条；CLI 的第一次终端查询由创建者的窗口回答，界面直接出现。

开发会话：1–4 同上（开始开发时第 3 步由创建请求本身完成，`createEnvironment.ts:74-80`），init 容器的起止推进 `checkout`，TaskRunner 连上即 `connect`、`ready` 成功。重建：受理 → 作业开始替换（`replace`）→ 新 Pod 建出 → 同上。

## 11. 失败模式与并发

| 情况 | 处理 |
|---|---|
| 观测与「连上」「判定失败」同时写 | 都在项目锁里重读后写；阶段只进不退，已成功或失败的段不被观测覆盖 |
| 控制面多副本同时观测 | 推导是幂等的，时间取自 Kubernetes，重复写没有副作用 |
| Events 缺失、被合并或过期 | 只少了拉取用时的细节，阶段照常推进 |
| 节点与控制面时钟偏差 | 结束时间不早于开始时间；用时由同一对时间算出 |
| 浏览器时钟偏差 | 计时按 `observedAt` 校正 |
| 升级前创建的环境与 CLI | 没有 `startup`，页面按今天的方式显示 |
| 执行镜像里是旧 Runner | 启动中取得被拒，进程拉起后再取；这时 CLI 可能仍空白几秒 |
| 读事件表失败 | `prepare`、`agent` 保持进行中，不冻结 |
| 读日志失败或超时 | 不存 `logTail`，判定照常 |
| CLI 就绪后 Runner 重启、执行环境失败 | 启动进度已冻结，不改；生命周期照今天显示 |
| 启动中关闭 CLI 标签、释放开发会话 | 整体已取消，进行中的段记为跳过；不显示失败提示 |
| 重建中又失败 | 重建补偿照旧（`failEnvironment.ts:20-26`），失败段与日志照 §3.6 写入 |

## 12. 性能与规模

- 观测：每个启动中的环境每秒一次 GET Pod，`container` 段进行中时再加一次按 UID 过滤的 Events 列表；每秒最多 64 个环境。设计目标（数百个数字人服务）下同时启动的环境是少数且短暂；超过 64 个时靠后的环境更新变慢，时间仍准。
- 库：部分索引只覆盖启动中的行；每次启动写十次以内。
- 页面：每秒刷新只在有对象启动中时发生；启动中的 CLI 每次读名册多一次事件表查询，就绪后冻结，不再查。
- 规模与高可用仍在 M6 统一验证。

## 13. 测试策略

| 层 | 内容 |
|---|---|
| 契约 | 三个 Schema 的正向解析与越界拒绝；`currentStage`；`ProfileTestStage` 新旧种类都能解析；两个 DTO 不带 `startup` 仍能解析 |
| `packages/k8s` | `podStartup` 用夹具：未调度（原因）、已调度、拉取中、拉取完成（有用时／节点上已有）、拉取失败、init 运行／成功／失败、主容器运行、Events 缺失与合并 |
| task-runtime 单元 | `domain/podStartup.ts`：各子状态的细节与警告、推进顺序、只进不退、失败与取消、时钟偏差夹紧、三种阶段形状（首次、重建、执行环境） |
| task-runtime 模块（真实 PostgreSQL） | 迁移后列与索引存在；受理 → 建 Pod → 观测 → 连上的完整写入；握手被拒、四类判定失败与日志尾部、释放取消；重建重置与替换；观测用例的限量、跳过与幂等；判定函数提取后原对账用例全部照过；档位测试改读阶段后阶段与结论不变 |
| dev-session 单元 | `composeCliStartup`：无步骤跳过、x/y、步骤失败、拉起失败、启动中停止、旧环境无 `startup`、Runner 重启 |
| dev-session 模块 | 名册带 `startup`；冻结后不再读事件；失败时先取日志再回收；开发会话 DTO 带 `startup` |
| `runtimes/task` | `claim` 在 `starting` 接受、`input`／`resize` 仍拒绝；三条启动失败路径释放控制计时器 |
| 工作台 | `StageProgress` 五种状态、警告、失败与按钮、日志展开、`renderExtra`；`stageProgressView` 的用时格式与 ±30 秒偏差；CLI 视图从步骤条到终端的切换与状态条；创建者自动取得（只本窗口、只一次、旧 Runner 回退、不抢编辑器焦点、`resize` 延后）；开发会话步骤条（创建与重建）；档位测试面板保留定位、退出码、输出；刷新间隔切换；文案键守卫 |
| 命令行 | `session show` 输出启动过程；`--json` 带 `startup` |
| e2e／实机 | 提案 §10 的 SP-01…SP-13 |

每条拒绝与回退分支都有用例：旧 Runner 拒绝提前取得、旧记录无 `startup`、旧档位测试记录的种类。

## 14. 偏离与债

逐条呈作者确认（开发规则 §5.4）：

1. **模块规模。** `task-runtime`（50 个文件）与 `dev-session`（51 个）早已超过 §11 的 40 个。本 RFC 不给它们加生产文件，但已有文件会变长（估计 `task-runtime` 增加约 300 行、`dev-session` 约 150 行）。拆分 ADR 仍然欠着，不在本 RFC 里做。
2. **段名两份。** 工作台按 `kind` 取中英文案，命令行自己有一份中文名表。
3. **轮询，不用 watch。** 观测用例每秒轮询启动中的环境；换成 Kubernetes watch 留到 M6 规模验证时再看。
4. **新 Runner 要新镜像才生效。** 启动中取得依赖新底座；执行镜像来自管理员按底座构建、按摘要固定的档位修订，要管理员用新底座重建镜像、另存档位后才生效。在此之前创建者的窗口在进程拉起后取得，CLI 可能仍空白几秒。
5. **旧字段留着。** `execution.message` 仍在接口里，工作台启动期间不再显示它。
6. **日志页仍只读主容器。** init 容器 `checkout` 的日志只在检出失败时作为 `logTail` 留下，日志页本身不改。

### 14.1 实施补记（2026-09-23）

实现与实机验收中与上文不同、或上文没写到的地方（证据见[验收记录](./acceptance.md)）：

1. **档位测试的结论仍按 Pod 阶段归类。** 排队、容器、等待连接三段取自环境的启动进度，只用于显示；测试结论的分类沿用原来按 Pod 阶段的判定。
2. **作业里的推导放在应用层。** `workers/` 不能引用 `domain/`（结构规则），所以替换旧容器与准备失败写成应用层函数 `beginReplace`、`failPreparation`，由作业调用。
3. **判失败前先读一次 Pod。** `failEnvironment` 与 Runner 连上的处理先读一次 Pod，按 Pod 自己记的时间把进度推到出事的那一段，再收束。例如检出在一秒内就失败了，也能停在「检出代码」。
4. **开发会话的步骤条替换整个 CLI 区。** 开始开发、重建和启动失败时，CLI 区整块换成步骤条，并且不再叠一条连接说明（ConnectionGuide）。
5. **启动中读名册不等慢 Runner。** 执行容器的 CPU 限在档位额度里（本机 150m），拉起 CLI 时 Runner 要十几秒才回 `listAgentTerminals`，名册因此卡住。现在启动中最多等 1 秒，超时即按已连接返回；同一执行环境同时只发一条请求。
6. **受理时刻另存。** `record.startedAt` 会被 Runner 回报的记录改成进程启动时间，所以受理时把受理时刻另存为 `execution.acceptedAt`（执行文档里的 jsonb 新键，不需要迁移）；旧记录退回 `record.startedAt`。
7. **输入闸按 PTY 输出放开。** 原设计按名册的 `lifecycle` 放开输入，但 CLI 一启动就向终端发查询，名册要到下一次读才知道进程已拉起，xterm 的应答会被挡掉。现在一收到 PTY 输出就放开输入并补发尺寸。
8. **完成的段只留结果说明。** 成功或跳过的段去掉进行时的说明与过去的警告；容器段在完成的那一轮按观测写结果（节点、镜像已在节点上或拉取用时）。失败的段保留说明与警告，作为现场。
9. **留日志的两处修正。** 一是多读一些行（400）再去掉 Runner 的 debug 结构化行，info／warn／error 与非结构化原文照留；二是回收执行环境之前先算出并冻结启动进度，再留日志，否则没人读过名册时，失败的那一段挂不上日志。启动前步骤脚本的输出按 RFC-006 不向租户广播，不在日志里。
10. **档位测试两段补上时间。** 「Agent 启动中」从启动前步骤结束（没有步骤时从发出启动命令）算到进程拉起，「真实模型轮次」从拉起算到结束。
11. **时钟偏差的取法。** 取数时记下本机收到的时刻（`receivedAt`），与服务器的 `observedAt` 算出偏差，渲染时不取时间（React 规则）；刚收到的进度比上一次走表新时，以收到的时刻为准。`useApiQuery` 的轮询间隔可以按最近的数据决定。
12. **首帧由 CLI 自己决定。** 本机上 OpenCode 在 150m CPU 下，进程拉起约 9 秒后才第一次输出；创建者窗口已持有控制，查询在同一刻得到应答，30 秒内画出完整界面，全程无需点击。
13. **失败后等日志。** 失败段的日志由回收流程补上，比「失败」晚几秒。失败后 20 秒内（按服务器时间比）、日志还没到时，名册与会话仍每秒读一次；展开日志先写「正在收集容器日志…」，过了 20 秒还没有，才显示使用方给的「没有留下日志」说明。
14. **名册顺带的原生活动页按人复用 5 秒。** 名册接口顺带做一遍原生活动查询：问每个执行 Runner、同步事件、开快照读事务。启动中名册每秒读一次，这部分改成同一任务、同一人 5 秒内复用上一次，进行中的共用，拒绝不留。页面上的活动状态以单独的活动查询为准，名册里的只是兜底。
15. **CLI 起不来时 Runner 也写日志。** 进程没拉起（例如二进制路径错误）时，Runner 写 warn「native terminal start failed」并带上原因，失败的 CLI 展开日志时能看到。要等任务底座下次更新才生效。
16. **建 Pod 的宽限。** 环境记录先于 Pod 提交，Pod 建出并记下实例（podUid）之后才算建好。每秒一次的启动观测扫到这段空档时，会读到「Pod 不存在」；还没记下实例、创建不到 2 分钟的环境，这时不判失败。超过 2 分钟仍没有 Pod，照旧判容器不存在。执行环境与重建是建好 Pod 之后才进入可判定状态，不走这条宽限。

### 14.2 修订：重新开始时回收失败的会话（2026-09-23，作者裁定）

Q1 定的是「失败在检出代码或更早，**释放后**按原分支重新开始」，首版实现漏了释放：失败的会话已不算活动会话，重新开始时直接开了新的，失败的那个连同 Pod（停在 Init:Error）和工作卷一直留着。验收里 SP-08 的两个就是这样，工作台和集群管理都没有入口清理它们。作者裁定只在这个入口回收：

- 工作台的「重试」开新会话时，请求带上失败会话的任务号（`OpenDevSessionRequest.restartOf`）。
- 平台只认本项目最近一次失败、且失败在排队、容器或检出代码，不是重建（没有「替换旧容器」段）的会话。判定规则是 contracts 的 `restartsFromScratch`，工作台决定按钮做什么也用它。
- 新会话开好之后，用释放原因 `failed` 回收它：删 Pod，删跟随容器的工作卷。它的工作卷里还没有仓库，也没有任何人的改动。
- 回收失败只记告警，不影响新会话。其他情况照旧保留，供恢复：等待连接失败、重建失败、带的不是最近一次失败、没带 `restartOf`（例如「从远端另建工作树」）。

### 14.3 修订：「已就绪」改为 CLI 画出界面（RFC-024，2026-09-23）

§4.1 的「`ready`：在 `runningAt` 成功」由 [RFC-024](../RFC-024-cli-interface-ready/proposal.md) 修订：`agent` 之后增加「CLI 初始化（等待界面）」段，
新 Runner 在无头终端上按「可见文字＋静止 500 ms」判定界面画出（90 秒超时放行；RFC-024 初版为 45 秒，验收后修订）后才就绪；旧 Runner 不报界面状态，该段跳过，行为同上文。
