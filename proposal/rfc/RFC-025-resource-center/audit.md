# RFC-025｜现状盘点（事实底稿）

> 只读盘点，2026-09-23 约 11:20–11:30Z。代码以当时已提交的 `main`（`e34bdeb` 之后）为准；集群与库只跑了 `kubectl get/logs` 与 `psql SELECT`。行号是当时的行号。
> 盘点期间，案例 (c) 的缺陷修复正在进行，已于 8e5b022d 提交：`reconcileTerminals` 改为跳过已关闭列表、去掉页面内存 `dismissed`，布局读写加 15 秒上限，概览「N 个 CLI」只数没结束的。§2、§5(c) 引用的行号与行为是修复之前的版本。案例 (a) 已于 cc99553d 修复。
> 「应当收口」「待裁定」两节只列事实与问题；作者的裁定见 [提案](./proposal.md) §4。

## 目录

1. 按资源种类的现状（申请、状态机、释放、对账、本机实查的不一致）
2. 界面现在从哪里读状态
3. 可复用的公共能力与各自的状态词汇
4. 结构约束、相关不变量与决策、会被改写的 RFC
5. 今天的三个失败案例
6. 应当收口的状态清单与待作者裁定的设计点

---

## 1. 按资源种类的现状

### 1.0 总览：谁在管什么

| 资源 | 申请／创建 | 状态存在哪 | 释放／回收 | 对账 |
|---|---|---|---|---|
| 开发会话工作区 Pod＋工作卷 | `task-runtime` `createEnvironmentUseCase`（由 `dev-session` 调） | `task_runtime.environments`（`state`、`startup`、`connected`） | 用户「释放会话」→ `releaseEnvironment` | `reconcile` 15 秒、`observeStartup` 1 秒，只判失败不删 |
| 重建 | `task-runtime` `requestRebuild` → `rebuildWorker` | `task_runtime.environment_rebuilds` | 旧 Pod 由重建删；旧 Runner Secret 不删 | 重建作业自身 |
| CLI／headless Agent／子任务执行 Pod＋Secret | `task-runtime` `createNativeExecutionUseCase` → `nativeExecutionWorker` | `task_runtime.environments.native`＋`dev_session.native_terminal_starts.record`＋执行 Pod 里 Runner 的名册 | `dev-session` 停止 → `requestStop` → `tick` → `releaseEnvironment` | 执行作业＋`reconcile` |
| 业务任务 Pod 与子任务 Pod | `business-task` → `task-runtime` | `business_task.tasks／subtasks`＋`task_runtime.environments` | 业务关闭任务 → `releaseEnvironment('business')` | 同上 |
| 并发额度 | 同一事务里 `admissions.tryAcquire` | `task_runtime.admissions.running`（计数器）＋`project.task_quotas` | 各路径各自 `admissions.release` | 无自愈重算 |
| 两槽 Deployment／Service／副本 | `release` 流水线 `startDeploy`、`redeploy` | `release.service_slots`＋`release.releases`＋`release.replica_overrides` | 下线 `removeWorkload`（RFC-021）＋巡检 60 秒 | `pollDeploy`；健康另由 `observability` 实时读 |
| 构建 Job／迁移 Job | `release` `buildKitBuilder`／`migrationJob` | `release.releases.pipeline`（`buildRef`、`migrationRef`） | Kubernetes TTL 3600 秒 | 流水线轮询 |
| 网关路由（槽） | `gateway` `reconcileService` | `gateway.routes`＋集群 `IngressRoute` | 项目归档 `removeService` | 事件触发重算，无周期对账 |
| 开发预览路由 | `task-runtime` `ensureTaskPreview`（不经 `gateway`） | 只在集群（Service＋IngressRoute） | `deletePod` 顺带删 | 无 |
| 切流 | `release` `switchTrafficUseCase` | `release.service_slots.active`＋`release.traffic_switches` | 回退＝反向切流 | `gateway` 订阅 `trafficSwitched` 重算路由 |
| 服务域放行表、Pod 身份索引 | `gateway` `rebuildAllowlist`、`podWatcher` | `gateway.allowlists`、`gateway.pod_identities` | 身份行打墓碑（`deleted_at`） | 放行表按事件重建；身份索引 list＋watch |
| 请求限流 | 无 | — | — | — |
| 集群盘点（只读投影） | `cluster-management` 采集作业 | `cluster_management.snapshots` 等 | — | 每 30 秒全量采集 |

平台里只有 `gateway` 的 `podWatcher` 在 watch Pod（`modules/gateway/workers/podWatcher.ts:19-63`）；任务、槽、盘点都靠轮询；界面没有任何资源状态的推送。

### 1.1 开发会话工作区 Pod 与工作卷

- **创建**：`modules/task-runtime/application/createEnvironment.ts:46-94`。一个事务里做四件事：锁项目额度行、检查「一项目一会话」（`:70`）、`tryAcquire`（`:71`）、插记录并发 `taskCreated`。事务外再建 PVC（`adapters/k8s/taskCluster.ts:47-51`）和 Pod（`:52-56`），同时建预览 Service＋IngressRoute（`adapters/k8s/taskObjects.ts:62-78`）。集群那一步失败时标 `failed`、退还额度（`createEnvironment.ts:82-90`），但已建出的 PVC 不删。
- **Pod 标签**：`crewstation.io/project／service／workload／task`，重建另加 `crewstation.io/rebuild`，执行 Pod 另加 `crewstation.io/workspace-task`（`taskObjects.ts:46-60`）。
- **状态机**：`EnvironmentState = creating | running | paused | releasing | released | failed`（`domain/taskEnvironment.ts:10`），迁移表见 `:86-93`。`occupiesQuota` 计入 creating、running、releasing（`:113-116`）。启动进度 `startup` 随迁移收束（`:105-111`）。
- **表**：`task_runtime.environments`（`adapters/persistence/tables.ts:6-36`），关键列 `state`、`pod_name`、`pod_uid`、`pvc_name`、`connected`、`native`、`release`、`startup`、`rebuild_id`、`legacy_cluster`（RFC-013 前的 `tsk_…` 身份）。
- **释放**：`application/lifecycle.ts:28-56`。先删 Pod，再按条件删卷：只有 `volumeMode === 'follow-container'` 才删（`:46`），然后记 `released`、退额度、发 `taskReleased`。开发会话的入口是 `modules/dev-session/application/sessionLifecycle.ts:106-118`（本人或负责人 `force`）。
- **失败**：`application/failEnvironment.ts:21-51`。工作区（非执行环境）判失败后记 `failed` 并退额度（`:48-49`），**不删 Pod、PVC、预览 Service 与路由**。之后只有两条出路：用户释放，或 `restartTarget`，后者只回收「检出或更早就失败」的会话（`modules/dev-session/application/sessionLifecycle.ts:29-33`）。
- **一项目一会话的判定**：`findDevSession` 只看 creating／running／releasing（`adapters/persistence/drizzleRepositories.ts:34-41`）。失败的会话挡不住新开，新会话建的预览路由与旧的同一个 Host，名字不同。
- **对账**：`application/reconcile.ts:13-25` 每 15 秒一轮（`wiring.ts:143`），只看 creating／running：Pod 不见、Failed、Succeeded 就判 failed，**从不删除集群对象，也不看 failed／released 记录名下是否还有对象**。启动观测每秒一轮（`reconcile.ts:31-46`，`wiring.ts:144`）。
- **空闲**：只提醒，不释放。提醒作业每 60 秒一轮（`modules/dev-session/wiring.ts:111`），状态在 `dev_session.idle_reminders`。

**本机实查（与记录不一致的对象）**：

| 命名空间 | 集群里还在的 | 记录状态 | 说明 |
|---|---|---|---|
| `cs-rfc006-verify` | Pod `task-01a0bc96ee15`（Failed）、PVC、预览 Service、IngressRoute `dev.rfc006-verify` | `01a0c12a-de2a-7025-…` failed（09-21 04:18:35） | 僵尸 Pod，自 09-20 起 |
| `cs-rfc003-ux`、`cs-rfc003-verify-delivery`、`cs-rfc003-verify-files` | PVC、预览 Service、IngressRoute（Pod 已不在） | 三条都在 09-21 04:18:35 同一秒 failed（Unknown，退出码 255） | 节点重启后的批量失败，一直没人处理 |
| `cs-rfc022-verify` | 两个 PVC（`task-01a0ccf96e42…-work`、`task-01a0ccf9cbfc…-work`） | failed（检出失败，09-23 06:35） | RFC-022 修订之前留下的 |

合计：175 条环境记录，其中 released 154、failed 19、running 2。running 的两条是 demo 与 rfc003-verify-workbench。

### 1.2 重建（`environment_rebuilds`）

- **表**：`task_runtime.environment_rebuilds`（`adapters/persistence/rebuildTables.ts:6-15`），状态 `queued | replacing | starting | ready | failed`（`packages/contracts/api/devSessionRecovery.ts:28`）。
- **执行**：`application/rebuildExecution.ts:29-45`。按 UID 核对原 Pod 与原卷，删原 Pod（`adapters/k8s/taskRecoveryCluster.ts:34-42`），再为本次重建建 Secret `task-r-<id>-runner` 和新 Pod。
- **预览路由**：沿用原路由名 `podNameFor(record.taskId)`，注释写明是为了避免同 Host 的两个 IngressRoute 竞争（`adapters/k8s/rebuildProvisioner.ts:64-67`）。RFC-013 把任务 ID 从 `tsk_…` 换成 UUID 之后，名字变了，旧名路由没人删。
- **清理**：只删本次重建记录名下的 Pod 与 Secret（`rebuildProvisioner.ts:68-71`）。**上一次重建的 Runner Secret 不删**。

**本机实查**：
- `cs-demo`：3 个 Runner Secret，其中 2 个过期（`task-01a095410744-r-e4e5aa6e256b-runner`，09-20；`task-r-01a0c7fc4f73…-runner`，09-22）。2 条 IngressRoute 同为 Host `dev.demo.cs.localhost`（`task-01a095410744` 旧名、`task-01a0c12ade2a705a…` 新名），各带一个 Service。
- `cs-rfc003-verify-workbench`：4 个 Runner Secret，其中 3 个过期；同样两条同 Host 的预览路由。

### 1.3 CLI／headless Agent 执行 Pod 与 Secret（RFC-006：每个 Agent 一个 Pod）

- **受理**：`modules/task-runtime/application/nativeExecution.ts:32-57`。同一项目事务里检查父工作区在运行且已连接、`tryAcquire` 一个额度、插记录、入队。
- **记录**：`volumeMode` 固定为 `persistent`（挂父任务的卷）。Pod 名前缀分用途：`cli-`、`agt-`、`sub-`（`:25-29`、`:61-71`）。执行状态 `native.state = queued | starting | running | cleaning | finished`（`domain/taskEnvironment.ts:36`）。
- **建与删**：`adapters/k8s/nativeExecutions.ts:91-116`。建 Secret 与 Pod，带意图注解与标签；删除时带 UID 前置条件。
- **清理意图**：`scheduleExecutionCleanup`（`nativeExecution.ts:88-97`）让记录进 releasing＋cleaning，作废 Runner 令牌，再入队。
- **同一个 CLI 在三处有状态**，还有页面自己的两份：
  1. `task_runtime.environments`（`state`＋`native.state`）；
  2. `dev_session.native_terminal_starts.record`：`lifecycle = starting | running | ended | failed | unknown`，由 Runner 上报，`revision` 只增。写入规则是一旦 ended／failed 就不再覆盖（`modules/dev-session/adapters/persistence/drizzleNativeTerminals.ts:35-38`）。另有 `execution.stopRequested`（`:39`）；
  3. 执行 Pod 里 Runner 自己的名册（实时问，`modules/dev-session/application/nativeExecution.ts:60-72`）；
  4. 界面的个人布局 `dev_session.workspace_layouts.layout.hiddenTerminalIds`；
  5. 页面内存里的 `dismissed`（见 §2）。
- **停止**：`modules/dev-session/application/nativeTerminals.ts:76-83`。只记 `stopRequested`，再 `void this.execution.dispatch(...)`（发出即返回，所以 HTTP 204 早于进程结束）。`dispatch` 是 cs-api 进程内的，最多并发 2 个（`nativeExecution.ts:186-188`），超出的等 cs-controller 的 `nativeExecutionWorker` 补跑。
- **读出**：`nativeExecution.ts:73-79`。`stopRequested` 只体现为 `execution.message = '正在结束此 CLI'` 这句文案。**`lifecycle` 要到 `finishRecord` 才变 ended**，契约里没有「停止中」这个可判定的状态。
- **旧路径投影**：`modules/dev-session/domain/nativeTerminalProjection.ts:5-12`。名册里找不到、Runner 也没换，就报 `unknown`。

### 1.4 业务任务 Pod 与子任务 Pod

- **状态**：业务任务 `creating | running | paused | closing | closed | failed`，子任务 `pending | running | awaiting-input | verifying | succeeded | failed | cancelled`（`packages/contracts/api/businessTask.ts:5`、`:30`），表在 `business_task.tasks／subtasks`。容器与额度走 `task-runtime`，子任务 Pod 是 `native.purpose = 'subtask'`。
- **暂停**：先清理全部子执行，再删容器、退额度（`modules/task-runtime/application/lifecycle.ts:99-116`）。
- **持久卷**：释放时不删（`lifecycle.ts:46` 只删 follow-container）。

**本机实查**：已释放业务任务的 PVC 仍在——`cs-rfc006-verify/task-01a0b3e0c77e-work`（09-18）、`cs-rfc010-cluster-qa/task-01a0beeee213-work`、`task-01a0befe5410-work`（09-20）。不变量 14 只写了「可选持久卷持久」，没写任务释放之后卷何时回收。

### 1.5 并发额度

- **计数器**：`task_runtime.admissions(project_id, running)`（`adapters/persistence/tables.ts:38-41`），上限在 `project.task_quotas.max_concurrent_tasks`。
- **准入**：条件 UPDATE `running < limit`；释放用 `GREATEST(running - 1, 0)` 兜底（`drizzleRepositories.ts:47-57`）。每条路径各自负责加减：创建、失败、释放、暂停、恢复、执行环境。没有按记录重算计数器的自愈。
- **本机实查**：11 个项目的计数器都等于按记录数出来的占用数（demo 1、workbench 1、其余 0）。

### 1.6 两槽 Deployment／Service／副本与运维副本覆盖

- **部署**：`modules/release/adapters/k8s/slotDeployer.ts:10-24`，`apply` Deployment＋Service，标签带 `crewstation.io/release`。
- **状态**：`status`（`:25-34`）实时读 Deployment；`removeWorkload` 只删本版本的 Deployment、保留 Service（`:41-47`）。
- **状态机**：`SlotHealth = empty | deploying | ready | degraded | failed`，另有 `retention`（到期计时）与 `offline`（下线原因）（`modules/release/domain/slots.ts:5-51`），表 `release.service_slots`（每服务一行，`blue`／`green` 两列 JSON，`active` 指向正式槽）。
- **发布状态**：`pending | building | migrating | deploying | ready | failed | superseded | offline`（`packages/contracts/events/topics.ts:45`），迁移表 `modules/release/domain/release.ts:36-45`。
- **重新部署**：`application/slotLifecycle.ts:235-270`，预检 `prepareSlotDeploy`（`application/pipelineDeploy.ts:48-63`）。**Manifest 从库里原样读出，不再校验**：`adapters/persistence/drizzleRepositories.ts:112` 的 `json<Manifest>(row.manifest)`。
- **巡检**：每 60 秒一轮，提醒、到期下线、补删工作负载（`modules/release/wiring.ts:67`、`:109-111`）。
- **副本覆盖**：`release.replica_overrides`。按 ADR-0006，副本期望值归 release，集群管理只转发。
- **健康**：另由 `observability` 每次请求时实时读 Deployment（`modules/observability/application/logsAndHealth.ts:28-36`），规则见 `domain/health.ts:12-14`。

槽的状态因此有四种表示：`release.service_slots`（平台记录）、`observability` 实时读、`cluster-management` 快照（30 秒）、`gateway.routes`（路由）。

**本机实查**：
- 22 个在跑的槽，记录与 Deployment 一一对应，没有多余的 Deployment。
- 其中 16 个 Deployment 的 `crewstation.io/release` 仍是 RFC-013 之前的 `rel_…`，靠别名匹配（2e2600b）。
- 5 个新项目的正式槽为空、待验证槽有版本，这是「首次发布进待命槽」的设计。

### 1.7 构建 Job 与迁移 Job

- 建 Job：`modules/release/adapters/k8s/buildKitBuilder.ts:31`、`:41`，`migrationJob.ts:13`、`:16`，都带 `activeDeadlineSeconds`。
- 回收：靠 Kubernetes TTL，`ttlSecondsAfterFinished` 默认 3600 秒（`packages/k8s/objects/workloads.ts:109`）。平台记录只有 `releases.pipeline.buildRef／migrationRef`。
- 本机现有：`cs-rfc023-verify/build-01a0cdfde5f1…`（Complete）与两个系统迁移 Job，都在 TTL 内。

### 1.8 网关路由、切流、服务域放行、Pod 身份索引、开发预览路由

- **槽路由**：`modules/gateway/application/reconcileRoutes.ts:13-29` 按服务幂等重算四类路由：prod、preview、service 域、`/api/<proxy>`，然后 apply 并存 `gateway.routes`。preview 路由**不管待命槽有没有工作负载都在**，只是指向没有 endpoint 的 Service，Traefik 为此开了 `allowEmptyServices=true`，见 RFC-021 的 80c4e1b。
- **触发**：`projectCreated`、`projectArchived`、`trafficSwitched`、`grantChanged`、`openPolicyChanged`（`modules/gateway/wiring.ts:90-102`），没有周期对账。
- **切流**：`modules/release/application/switchTraffic.ts:10-48`。锁槽、核对期望版本与迁移限制，改 `active`，插 `traffic_switches`，发 `trafficSwitched`，由网关重算路由。
- **开发预览路由**：由 `task-runtime` 直接建和删（`taskObjects.ts:62-78`、`taskCluster.ts:74-81`），注释说放进网关的按服务重算对不上生命周期。所以网关的路由表里没有它，`gateway.routes` 只是路由的一部分。
- **放行表与身份索引**：
  - 身份索引按源 Pod IP 反查身份，由 `podWatcher` 先 list 再 watch，维护 `gateway.pod_identities`。
  - **本机实查**：共 695 行，在用 29 行，666 行是 09-11 以来的墓碑（`deleted_at` 非空），从未清理。
- **维护**（RFC-021）：`gateway.service_maintenance`，由 ForwardAuth 在网关侧执行用户流量、服务域调用、事件推送三个开关。它也是一种流量控制，但不是限流。

### 1.9 现有的限流与并发控制

- **网关**：本机只有 4 个系统中间件（`drop-identity-headers`、三个 `forwardAuth`）和各项目的 `stripPrefix`，**没有任何 `rateLimit`／`inFlightReq`**。Traefik 启动参数里也没有入口级限流（`kubectl -n crewstation-system get deploy traefik` 的 args）。
- **服务端零散的节流**，都是局部补丁，没有统一机制：
  - e73d98e：名册顺带的原生活动页，同一任务同一人 5 秒内复用结果（`modules/dev-session/application/nativeActivity.ts` 的 `rosterActivity`）；
  - release 记待验证槽访问时有进程内节流（`modules/release/api/moduleApi.ts:45`）；
  - `dispatch` 进程内最多并发 2 个（§1.3）；
  - 启动观测上一轮没跑完就跳过（`modules/task-runtime/wiring.ts:132-139`）；
  - 集群运维操作 worker 并发 2（`modules/cluster-management/wiring.ts:35`）。
- **前端**：各查询自己定轮询间隔（1–30 秒），全局 `staleTime` 30 秒（`apps/console/src/shared/api/queryClient.ts:9`）。
- **I16**：高并发时连接池出错。今天 10:52:19 一次布局保存在旧驱动的 cs-api 里挂了 490 秒，没有请求级超时兜住。

### 1.10 命名空间、配额对象、网络策略（作者本轮范围未列，供参考）

- 由 `provisioning` 的 `ensureNamespace` 下发，控制面启动时对全部未归档项目重跑一遍（`modules/provisioning/application/reapplyNamespaces.ts:5-30`）。
- `cluster-management` 把每项目的 `ResourceQuota crewstation-project` 与四条 NetworkPolicy 登记为「保留」，把槽 Service 登记为「跨发布保留」（`modules/platform/wiring.ts:452-462`）。

---

## 2. 界面现在从哪里读状态

| 页面／部件 | 读哪些接口（轮询间隔） | 推送 | 页面自己拼的 |
|---|---|---|---|
| 运行与诊断「状态」拓扑 `apps/console/src/features/logs/pages/TopologyPage.tsx:16-30` | 项目盘点 `api.cluster.projectResources`（15 秒）、槽 `api.services.listSlots`（15 秒）、开发会话 `api.devSession.get`（15 秒）、数据资源（默认） | 无 | **是**：`apps/console/src/shared/topology/projectTopology.ts:24-80` 用盘点、会话、槽、数据资源四个来源组装。开发会话横带只要会话不是 released、**或**命名空间里还有开发类 Pod 就画出来（`:60-71`），失败的会话也画 |
| 运行与诊断健康卡 `features/logs/components/HealthCards.tsx:28` | `api.observability.health`（默认 30 秒），服务端实时读 Deployment | 无 | 否 |
| 概览形态卡 `features/projects/components/summary/DeploymentTopologyCard.tsx:24-35` | 项目盘点（15 秒）＋概览摘要里的 development／slots 两部分 | 无 | **是**：同一个 `buildProjectTopology`，但会话来自摘要，并把 `paused` 改写成 `running`（`:30`） |
| 概览三张状态卡 `features/projects/components/summary/StatusCards.tsx` | 概览摘要（`capabilities` 服务端组合，各部分带状态与新鲜度，`modules/capabilities/application/projectSummaries.ts:9-40`）；开发卡另读 CLI 名册（30 秒）与版本比较 | 无 | **是**：「N 个 CLI」直接取 `items.length`（`:58`），把已结束、失败的都算进去。demo 现在 14 条记录（8 ended、6 failed）、0 个在跑，卡上显示「14 个 CLI」 |
| 开发页 CLI 标签 `features/dev-session/components/native/NativeWorkspace.tsx` | 会话 `useDevSession`（启动中 1 秒，平时 10 秒）、名册 `useNativeTerminals`（启动中 1 秒，平时 10 秒）、个人布局 GET／PUT | 任务流 WebSocket（cs-session）：Runner 事件 `nativeTerminal`、`nativeActivity`、`runnerState`、`terminalOutput` 等；收到 `nativeTerminal` 后 100 ms 重读名册（`hooks/native/useNativeTerminals.ts:27-35`） | **是**：名册＋布局 `hiddenTerminalIds`＋内存 `dismissed`（`NativeWorkspace.tsx:49`、`:65`），对账规则在 `model/layout/terminalGroups.ts:115-123` |
| 开发页会话 `features/dev-session/hooks/useDevSession.ts:25-45` | 同上 | 同上 | **是**：404、已释放、缺 `taskId` 三种都在页面上按「没有会话」处理，注释写明是为了防止同时渲染工作区与开会话表单 |
| 发布页槽卡 `features/release/components/DeploymentVersions.tsx:44` | 槽（5 秒）、发布列表、维护状态（`shared/project/useServiceMaintenance.ts:14`） | 无 | 部分：候选版本由服务端 `redeployable` 决定（`features/release/model/redeployCandidates.ts`） |
| 集群管理页 `features/cluster/*` | 摘要、清单、节点、指标（15 秒）、操作（3 秒）、动作面板（2–3 秒） | 无 | 否，都读快照 |
| 顶栏守卫 `app/layout/AdminGuard.tsx:23`、`DeveloperGuard.tsx:15` | 15 秒 | 无 | — |

要点：
- **资源状态没有推送**：唯一的推送通道是 cs-session 的任务流，每个任务一条，只承载 Runner 事件。Pod 被删、槽变化、发布状态、路由变化，界面都靠轮询得知。
- **同一事实有多份时效不同的读数**：例如一个 CLI 在名册里（10 秒）、概览卡上（30 秒）、拓扑盘点里（30 秒采集＋15 秒轮询）各有一份。全局 `staleTime` 30 秒，切页回来时不重读（`shared/api/queryClient.ts:9`）。
- **页面自带兜底逻辑**：`isLiveTerminal(undefined)` 返回 true（`terminalGroups.ts:15-17`），`unknown` 算在运行（`:13`）。个人布局保存是串行的且没有超时，一次挂住就挡住后面所有保存（`model/layout/workspaceLayoutStore.ts:84-98`）。

---

## 3. 可复用的公共能力与各自的状态词汇

| 能力 | 位置 | 可复用的点 | 局限 |
|---|---|---|---|
| RFC-022 启动进度 | `packages/contracts/api/progress/startupProgress.ts`；`modules/task-runtime/domain/podStartup.ts` | 分段、只进不退、平台判定才算失败、带 `logTail`，界面共用步骤条 | 只管「启动」一段，不管运行与释放 |
| RFC-010 集群盘点与运维 | `packages/contracts/api/cluster/resources.ts:5-17`；`modules/platform/wiring.ts:420-466`（按用途把检查、执行、观察转给各模块） | `ClusterResource` 已有归属、用途、`phase`、`ready`、`abnormal`、`reason`、`availableActions`、`taskId`、`parentTaskId`、`releaseId`、`slotRole`；运维操作有持久状态机 | 是 K8s 对象的观测快照（30 秒），不含平台的期望与生命周期（例如「停止中」「已释放但卷保留」）；D53／ADR-0006 明定「原模块保留生命周期和期望配置所有权」 |
| RFC-019 拓扑模型 | `apps/console/src/shared/ui/topology/topologyModel.ts`、`shared/topology/projectTopology.ts` | 节点、横带、边（`observed`／静态）的视觉语法 | 在前端组装，四个来源 |
| RFC-021 槽生命周期 | `modules/release/domain/slots.ts`、`domain/slotLifecycle.ts` | 下线原因、到期、提醒、推迟都是纯函数；巡检幂等，逐步锁行 | 只管槽 |
| RFC-017／RFC-012 资源配置与额度 | `project.task_quotas`、`service_plans`、`task_profiles`、`agent_runtime.project_compute_policies` | 套餐、规格、额度上限 | 占用计数器分散在各条路径里加减 |
| RFC-006 每个 Agent 一个 Pod | `modules/task-runtime/application/nativeExecution.ts` | 受理意图＋队列＋租约＋UID 前置条件删除，是较完整的「意图 → 调和」样板 | 三处状态（§1.3） |
| `packages/k8s` | `client.ts`（带 `preconditions` 的删除、watch、list）、`objects/*`、`LABELS` | 统一标签键、按 UID 删 | 没有 informer／缓存层；只有网关在 watch |
| 概览摘要组合 | `modules/capabilities/application/projectSummaries.ts` | 服务端组合、每部分带状态与新鲜度、总时长 2.5 秒 | 是按页面临时拼的，不是标准资源视图 |

**现有状态词汇（统一前需要对齐）**：

- 任务环境 `EnvironmentState`：creating、running、paused、releasing、released、failed。执行环境 `native.state`：queued、starting、running、cleaning、finished。释放原因：user、owner-force、business、failed、pod-lost、profile-test。
- 重建：queued、replacing、starting、ready、failed。
- 开发会话 `DevSessionState`：creating、running、releasing、released、failed（`packages/contracts/api/devSession.ts:17`）。
- CLI：`lifecycle` 为 starting、running、ended、failed、unknown；`connection` 为 connected、disconnected、unknown；`finalScreen` 为 pending、available、unavailable（`packages/contracts/api/nativeTerminal.ts:16-21`）。
- 历史 Agent `AgentInstanceState`：starting、preparing、running、awaiting-input、completed、failed、cancelled。
- 业务任务与子任务：见 §1.4。
- 启动进度：
  - 整体 running、ready、failed、cancelled；
  - 段 queue、replace、container、checkout、connect、prepare、agent、interface、ready；
  - 段状态 pending、running、succeeded、failed、skipped；
  - 失败码 13 个。
- 槽 `SlotHealth`：empty、deploying、ready、degraded、failed。下线原因：manual、rollback-expired、idle、cluster。保留计时：rollback-target、pending。
- 发布：见 §1.6。
- 健康：healthy、degraded、crash-looping、unhealthy、unknown。告警：firing、resolved。
- 集群用途（14 种）：development-workspace、development-cli、development-agent、business-workspace、business-subtask、profile-test、digital-worker-service、api-proxy、event-producer、build、migration、platform-service、platform-infrastructure、unknown。
- 集群动作：restart、scale、restore-replicas、delete，执行路由 kubernetes、release、task、none。运维操作阶段：queued、executing、observing、succeeded、failed、needs-attention。
- 数据资源：requested、provisioning、ready、failed、releasing、released。数据访问绑定：requested、approved、rejected、active、expired、revoked。
- 档位测试：queued、running、passed、failed、unknown、superseded。档位可用性：ready、disabled、testing、test-failed、untested。
- 项目：provisioning、active、archived、failed。

---

## 4. 结构约束、相关不变量与决策、会被改写的 RFC

**结构约束**（`docs/engineering/repository-structure.md`）：

- **分层**（§5，`:188-210`），当前 19 个模块：
  - L1 `identity`
  - L2 `project`
  - L3 `scm`、`config`、`data`、`api-catalog`、`events`、`agent-runtime`
  - L4 `release`、`task-runtime`
  - L5 `dev-session`、`business-task`、`session`、`gateway`
  - L6 `cluster-management`、`observability`、`capabilities`、`provisioning`
  - L7 `platform`
- **依赖方向**：模块只能依赖层号更小的模块，同层互不依赖（`:169`）。需要高层能力时，由低层声明端口、组合根回填，或者订阅事件（`:173-174`）。
- **跨模块只经对方根 `index.ts`**（`:152`），每模块一个 PostgreSQL schema，不跨 schema join，没有跨模块外键（`:250-251`）。
- **新增模块要写 ADR**，说明拥有哪些对象、在哪一层、为什么不能并入现有模块（`:317`）；调层、删模块同样要 ADR（`:348`）。
- **单个模块**超过 40 个源码文件或 6000 行，要先写 ADR 提出拆分（`:315`）。
- **目录结构**：`workers/` 放协调循环（reconciler），`wiring.ts` 负责装配（`:131-132`）。

**Design 不变量**（`proposal/design.md` §1.1）：

- 2：任务一个长驻容器，单个 Agent 进程结束不终结任务容器。这正是「关掉 CLI，会话还在」的依据。
- 11、12：发布与切流、两槽。
- 13：数据独立于任务。
- 14：存储随任务；意图任务释放即回收；业务任务可选持久卷；空闲只提醒，不自动释放。**没有规定失败的会话和持久卷在释放后如何处理。**
- 15：一项目一命名空间。
- 17：「已分配地址」不等于「已就绪」，各项分别显示状态，与标准状态输出直接相关。
- 19：HA 与规模是首版约束。
- 21：运营元素是平台能力。

**相关决策**：

- D21：取消、暂停、关闭分开；开发会话没有暂停。
- D31：并发任务额度是首版唯一预算，超额一律拒绝。
- D36：一项目一开发会话。
- D45：两槽。
- D50：空闲只提醒。
- D53：受管集群目录与运维操作独立为 L6 `cluster-management`，**原模块保留生命周期和期望配置所有权**。这与「状态收口到 infra 层」直接冲突，需要修订或取代。
- D55：拓扑从集群快照画出。
- D56、D57：待命槽下线、维护。
- D58：启动进度。
- D54、D60：出站只由 NetworkPolicy 决定。

**会被改写的内容**：

- RFC-006：执行环境的受理与回收。
- RFC-010 与 ADR-0006：盘点与运维，以及「原模块保留所有权」。
- RFC-017、RFC-012：额度与规格。
- RFC-019：拓扑的数据来源从前端拼装改为标准视图。
- RFC-021：槽的下线与重新部署，以及 preview 路由随槽生命周期挂上摘除。
- RFC-022：启动进度并入标准阶段。
- RFC-024（Draft）：新增的 `interface` 段。
- RFC-003 development-workspace 与 2026-09-23 的 Xshell 标签组修订：× 的语义、名册对账。
- RFC-008、RFC-016：预览进程。
- RFC-020：运行与诊断、概览卡。
- Design：§5 开发会话与 TaskRunner、§6 发布与切流、§8 网关（新增限流）、§14.6 拓扑。
- Proposal：R 编号，需要新增需求。

---

## 5. 今天的三个失败案例

### (a) 重新部署 500

- **现象**：`POST /v1/releases/{demo v0.1.2}/redeploy` 在 10:56:12 返回 500。
- **根因**：`release.releases.manifest` 里存的是 RFC-001 之前的写法（`agentProfiles` 只有 `driver`／`model`，没有 `compute`）。读出时不校验（`modules/release/adapters/persistence/drizzleRepositories.ts:112`），重新部署拿它做预检（`application/slotLifecycle.ts:248`），`computeProblem` 读 `f.name.kind` 抛 TypeError（`application/pipelineDeploy.ts:34`）。
- **影响面**：44 份存量 Manifest 中有 4 份不符合当前写法：demo v0.1.2、v0.1.3，gitlab-event-producer v0.1.0，reference-api-proxy v0.1.0。
- **资源中心该由哪条机制兜住**：
  - 启动控制的统一预检：任何「让一个工作负载起来」的请求，进入分配之前都先把它的完整规格按当前契约校验一遍；不合格就给出标准失败原因（阶段＝受理、原因码、出路），而不是在部署代码里途中崩掉。
  - 标准输出带出「可做的操作」及其不可做的原因，界面据此呈现，不必各页自己判断。

### (b) 拓扑里「开发会话」还在

- **现象**：作者 10:51 开、10:52 结束一个 CLI，执行 Pod 在 10:52:28 回收。拓扑里剩下的是会话工作区容器 `task-r-01a0cda7…`，它是 09:44 迁移 Calico 时「重建开发环境」建的，一直在跑。按不变量 2、14 与 D50，结束 CLI 不释放会话，空闲也不自动释放。
- **界面问题**：拓扑的开发会话横带由会话接口与盘点里的开发类 Pod 拼出（`projectTopology.ts:60-71`）。横带说明只有「分支 · N 个 Agent」，不区分工作区与 CLI，也不写会话已经空闲多久、怎么释放。同一页面上，失败会话留下的对象（§1.1）也会让横带出现。
- **资源中心该由哪条机制兜住**：
  - 一个资源一条标准记录，含用途（会话工作区／CLI）、阶段（运行中且空闲 N 分钟／失败、保留诊断）与可做的操作（释放会话）；拓扑、概览卡、开发页读同一份。
  - 失败与释放之后留下的子对象，由调和器按统一规则回收或标注。

### (c) 关掉的 CLI 切回来又出现

- **根因**，四处叠加：
  1. 「刚关掉」只记在组件内存里（`NativeWorkspace.tsx:49` 的 `dismissed`），切页就丢；
  2. 停止是异步的：204 早于进程结束约 2 秒，这段时间契约里没有可判定的「停止中」（`modules/dev-session/application/nativeExecution.ts:78` 只给了一句文案）；
  3. 名册前端缓存 30 秒内不重读（`queryClient.ts:9`），切回来时拿到的还是「运行中」；
  4. `reconcileTerminals` 把布局里记为已关闭的在运行 CLI 也放回（`terminalGroups.ts:115-123`），`unknown` 与 `undefined` 都算在运行（`:13-17`）。
- **随后**：它以后台标签回到原处，变成 ended 之后显示不可用，还能再结束一次（10:52:42 第二次 stop）。
- **叠加的问题**：放回后的那次布局 PUT 在旧驱动的 cs-api 里挂了 490 秒（499）。布局存储串行且没有超时（`workspaceLayoutStore.ts:84-98`），后面的保存全部排在它后面，11:00:29 才落库。
- **资源中心该由哪条机制兜住**：
  - 生命周期阶段由服务端持久产出，包括「停止中」；停止请求被受理的那一刻，标准记录就进入停止中，所有界面读到的都一样。
  - 界面只按标准记录渲染，不在内存里记状态，不自己推断「在运行」。
  - 推送流让变化即时到达，页面不依赖轮询和缓存时效。
  - 请求级超时与网关限流让一次挂住的请求有明确结局。

---

## 6. 应当收口的状态清单与待作者裁定的设计点

### 6.1 应当收口的状态（资源种类 × 生命周期阶段；表内是现在承载该状态的地方）

| 资源种类 | 受理／准入 | 创建 | 启动→就绪 | 运行（观测） | 停止／释放中 | 已释放／回收 | 失败 | 流量挂载 |
|---|---|---|---|---|---|---|---|---|
| 会话工作区 Pod | `admissions`＋`environments`（creating） | `taskCluster.createPod` | `startup`（RFC-022） | `connected`、`reconcile`、`idle_reminders` | `environments.releasing` | `released`，但 PVC、Service、路由看条件 | `failed`，对象保留 | 预览 Service＋IngressRoute，task-runtime 自建 |
| 工作卷 PVC | 随上 | `ensureVolume` | — | 盘点 | — | follow-container 删，persistent 永留 | 保留 | — |
| 重建 | `environment_rebuilds.queued` | replacing | starting | — | — | ready | failed | 沿用原路由名（RFC-013 后失效） |
| 执行 Pod＋Secret（CLI／Agent／子任务） | `admissions`＋`native.queued` | starting | `startup`＋名册 `lifecycle` | Runner 名册（实时问） | `stopRequested`（只有文案）、`native.cleaning` | `finished`＋`record.ended` | `record.failed`＋`native.failureReason` | 无 |
| 业务任务 | `business_task.tasks`＋`environments` | 同上 | 同上 | 同上 | closing | closed／released | failed | 无 |
| 额度 | `admissions.running` 计数器 | — | — | — | — | 各路径各自减 | 失败时减 | — |
| 服务槽 | 流水线（`releases`） | `slotDeployer.apply` | `pollDeploy` → `service_slots.ready` | `observability` 实时读、盘点快照 | 下线（RFC-021） | `offline`（保留 Service） | failed／degraded | `gateway.routes`，两个 Host 总在 |
| 构建／迁移 Job | `releases.pipeline` | Job | 流水线轮询 | — | — | K8s TTL 3600 秒 | 发布 failed | — |
| 切流 | — | — | — | `service_slots.active` | — | — | 预检拒绝 | 事件触发网关重算 |
| 放行表、身份索引 | — | — | — | `gateway.allowlists`、`pod_identities` | — | 墓碑永留 | — | ForwardAuth 执行 |
| 限流 | 无 | | | | | | | |

### 6.2 需要作者裁定的设计点（只列问题与可选方案）

1. **台账的粒度**
   - (a) 按平台资源一条，例如「会话」「CLI」「槽」「路由」，K8s 对象挂在下面；
   - (b) 按 K8s 对象一条，平台含义作为字段；
   - (c) 两层都有。
2. **与现有状态表的关系**，也就是 D53 怎么改
   - (a) 资源中心成为唯一的状态主人，各模块的状态表迁入或改为只存领域字段；
   - (b) 各模块仍是期望状态的主人，资源中心是必须经过的分配、释放入口加统一投影；
   - (c) 只做统一投影（作者已表示要把状态收口到 infra 层，此项可能已排除）。
3. **分层与模块形态**
   - (a) 新建一个低层模块（在 L4 之下，`release`、`task-runtime`、`gateway` 都依赖它），需要 ADR；
   - (b) `task-runtime`＋`cluster-management` 下沉合并；
   - (c) 按资源大类拆成多个 infra 模块，共用一个状态契约。
   - 另需决定：K8s 对账（watch／informer）放在这一层，还是保留在各自的 worker 里。
4. **调和器的权限**：台账说已释放或已失败、集群里却还在的对象（§1.1、§1.2、§1.4 实查到的那些）怎么处理？
   - (a) 自动删除；
   - (b) 只标注，由管理员在集群管理里处理；
   - (c) 按种类区分，例如 Secret 与路由自动删、PVC 只标注。
5. **失败会话的去留**
   - (a) 保留到用户处理（现状）；
   - (b) 保留 N 天供诊断，之后自动回收；
   - (c) 重新开始时一律回收，不再只回收「检出或更早」失败的。
6. **持久卷业务任务释放后的卷**
   - (a) 永久保留（现状）；
   - (b) 随任务释放删除；
   - (c) 保留期满后删除。
7. **「停止中」是否成为标准阶段**，停止请求一受理就对所有界面生效？以及是否把「空闲 N 分钟」写进运行阶段的标准字段？
8. **推送流**
   - (a) 扩展 cs-session 的任务流，加一条按项目订阅的资源流；
   - (b) 新建独立的 SSE／WebSocket 通道。
   - 另需决定断线补偿怎么做：快照加增量游标，还是只推「有变化」再重读。
9. **路由随生命周期挂上摘除**
   - 待命槽没有工作负载时，preview 路由是摘除还是保留？摘除后访问看到平台的「未部署」页，还是 404？
   - 开发预览路由是否收回由网关统一生成？
10. **网关限流**：作者已定只在网关做，还需定：
    - 维度：按用户、项目、接口还是来源 Pod；
    - 范围：只管平台 API，还是连用户域访问数字人、服务域互调一起管；
    - 超额行为：429＋`Retry-After`，还是排队；
    - 默认值与配置归属：平台设置还是套餐；
    - 是否需要按项目覆盖。
11. **旧形状对象的归一**：`rel_…` 发布标签、`tsk_…` 路由名与 PVC 名、RFC-001 之前的 Manifest。
    - (a) 迁移时一次性改写或清理；
    - (b) 保留别名匹配，只在标准记录里给出统一 ID。
12. **历史记录在标准视图里的呈现**：已结束、失败的 CLI 是否计入「N 个 CLI」？身份索引墓碑保留多久？
13. **范围是否包括** 命名空间、ResourceQuota、NetworkPolicy（现由 `provisioning` 下发，作者本轮未列）与数据资源（`data` 模块，另有状态机）。
