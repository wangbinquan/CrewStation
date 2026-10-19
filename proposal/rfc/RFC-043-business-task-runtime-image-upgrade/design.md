# RFC-043 设计：业务任务运行镜像升级

> 状态：In Progress · 2026-10-19（作者批准按本设计实现）。落位：business-task（L4，合同、准入、调度与镜像读者）、task-runtime（L3，暂停环境的改钉）、runtime-environment（L3，引用与校验，沿用）、platform 端口（版本查询）。

## 1. 现状（按源码核对）

- **选择**：任务创建时按「请求的 `runtimeImageVersionId` → 调用方正式发布 `tasksSpec.runtimeImageVersionId` → 平台缺省」选择版本（`modules/business-task/application/taskRuntimeImage.ts:27-35`），经 `reserveImage` 校验并预留引用（`modules/runtime-environment/application/references.ts:22-50`）。
- **快照**：快照（`packages/contracts/api/runtimeImages/responses.ts:43-48`）含 `versionId`、`image`（`repo@sha256`）、`digest`、`validationId`、初始化与工具摘要，不含 `imageId`。
- **固定**：快照写入不可变的 `intent.task.runtimeImage`（计入 `effectiveDigest`，即恢复的 `materialDigest`），以及 task-runtime 环境的 `render.image` / `render.runtimeImage`（`modules/task-runtime/application/createEnvironment.ts:79,94`）。
- **暂停与恢复**：暂停删除 Pod、保留 PVC、释放额度，任务视图为 `paused` / `resourceState: released`（`modules/task-runtime/application/business/workspace.ts:19-53`）。恢复把 `render` 原样复制后 `start+1`（同文件 `:55-74`），由资源台账的 `Provisioning` 条件驱动 cluster-control 建 Pod（`modules/task-runtime/domain/ledgerProjection.ts:66-97`）。
- **镜像读者**：
  - 任务视图（`modules/business-task/application/execution/taskView.ts:8,19`）；
  - 恢复材料证明（`.../recovery/materialProof.ts:12-17`）；
  - 重建 / 重新执行（`.../recovery/rebuildExecution.ts:11-12`、`restartExecution.ts:29-35`）；
  - 关闭时释放引用（`.../taskRuntimeImage.ts:38-49`）；
  - 引用清理证明（`modules/business-task/adapters/persistence/execution/imageReferenceState.ts:18`）。

  它们都读创建时的意图快照。
- **生命周期操作**：落在 `execution_lifecycles`，唯一键为 `(service, task, action, request_key)`，没有载荷列（`modules/business-task/adapters/persistence/execution/lifecycleTables.ts:8-14`）。

## 2. 合同

- `POST /v3/business-tasks/:taskId/runtime-image`（服务身份）
  - 请求体 `UpgradeBusinessTaskRuntimeImageSchema`：`requestKey`、`fence`（必填）、`expectedGeneration`、可选的 `runtimeImageVersionId`。
  - 返回 202 `BusinessOperationDto`，`action: 'upgrade-runtime-image'`。
  - 结果沿用 `GET /v3/business-tasks/:taskId/operations/:operationId`。
- `BusinessTaskV3Dto.runtimeImage`：改为**当前**快照（有升级记录时取升级后的快照，否则取意图快照）。
- 能力快照（`BusinessCapabilitiesDtoSchema`）新增两个可选字段：
  - `runtimeImageUpgrade: 1`：本平台支持该操作；
  - `taskRuntimeImageVersionId`：调用方所属发布声明的缺省版本，可为 null。

  服务据此判断某个父任务是否落后于自己的发布。
- 原因码：
  - 任务不处于暂停：`task_not_paused`；
  - 运行镜像不同：`runtime_image_mismatch`；
  - 任务未固定运行镜像，或发布未声明缺省版本：`runtime_image_missing`；
  - 已有：`runtime_image_not_allowed`、`image_usage_unvalidated`、`image_unavailable`、`active_subtasks`、生命周期冲突与 fence 拒绝。
- 拒绝出现在两个阶段：
  - **受理阶段**同步返回 4xx，不写任何状态：缺 fence 或 fence 过期、版本不在发布选择集（`runtime_image_not_allowed`，400）、任务不处于暂停、非持久卷、代次过期、未固定镜像。
  - **执行阶段**依赖镜像目录的当前状态：镜像不同、版本不可用、用途未验证。这时接口照常返回 202，操作的 `state` 为 `failed`，原因码放在 `message`，与暂停、恢复等生命周期操作一致。

## 3. 数据

迁移 `business-task/0040_runtime_image_upgrade.sql`（只增两列）：

- `execution_lifecycles.payload jsonb null`：升级操作在准入时固定的目标，即目标版本、请求的版本、调用方发布的选择集，以及被替换的钉住版本 `fromVersionId`。
- `execution_task_states.runtime_image jsonb null`：升级后当前钉住的快照；为 NULL 时沿用准入快照。

实现时没有新建 `execution_task_runtime_images` 表。新表是内容表，要在项目删除的守卫、清单与清除里各登记一遍；而当前钉住版本本来就和任务的生命周期状态同行。升级只针对已暂停的任务，暂停已经写下这一行。

读者统一走 `currentTaskRuntimeImage(admitted, state) = state.runtimeImage ?? intent.task.runtimeImage`（`domain/executionLifecycle.ts`）。

恢复材料摘要：未升级的任务仍是 `effectiveDigest`；升级后为 `jsonHash({ admission: effectiveDigest, runtimeImageVersionId })`（`taskMaterialDigest`）。升级前做出的恢复评估因此失效，需要重新评估。重新执行时，新任务的 `effectiveDigest` 也用这个值。

## 4. 流程

1. **准入**（`mutateTask` 与 `lifecycleAdmission`，与暂停、恢复同一生命周期表和同一事务）：
   - 解析目标版本（`application/runtime-image/upgrade.ts`）：缺省取调用方发布的 `tasksSpec.runtimeImageVersionId`；显式版本须是缺省版本或在允许列表内，规则与任务创建相同。fence 必填并按 fenced 校验，所以调用方发布就是持有执行权的正式发布。
   - 动作 `upgrade-runtime-image`：`generation == expectedGeneration`，且没有进行中的生命周期操作。
   - 任务须为 `paused`、持久卷、没有活动子执行，并已固定运行镜像。
   - 目标等于当前钉住版本 ⇒ 写一条已完成的操作，代次不变。
   - 否则把目标与 `fromVersionId` 写入 `payload`，代次加一。任务状态保持 `paused` 并带上操作 ID；凭这个操作 ID，恢复、关闭与新工作都会被拒绝。
   - 镜像引用不在准入时预留：同一任务的引用以任务为拥有者，两个并发请求若都在准入时预留，落选的一方回滚时会删掉胜出方的引用。
2. **调度**（`dispatchRuntimeImageUpgrade`，在生命周期工作循环里，持有操作租约）：
   - 经平台端口 `versionImage` 比较两个版本的 `imageId`（`runtime_image_mismatch`），并要求目标版本 `available`（`image_unavailable`）。
   - 以拥有者 `{type: 'task', id}`、用途 task 预留目标版本（与创建同一 `reserveImage`，用途未验证报 `image_usage_unvalidated`），随即确认。
   - 调用 task-runtime 的 `repinPausedBusinessWorkspace({projectId, serviceId, taskId, operationId, generation, runtimeImage})`。
   - 在仍持有租约的事务里把新快照写入 `execution_task_states.runtime_image`；租约已丢失就交给下一个认领者重放。
   - 释放 `fromVersionId` 的任务引用，操作 `succeeded`，任务回到 `paused`。
   - 事件日志沿用生命周期已有的 `task-state` 事件，即受理与完成时各一条，状态 `paused`、新代次。不另加事件类型：业务事件合同是严格联合类型，新类型会让既有消费者解析失败。
3. **task-runtime**（`application/business/repin.ts`）：
   - 检查：环境为 `paused`（`businessWorkspace.phase = paused`）、持久 `businessStorage`、未进入归档终结、卷身份已验证、Pod 已不存在、存储停止已证明。随后在项目锁内重读，检查期间环境变化报 `workspace_changed`。
   - 改写 `render.image = snapshot.image`、`render.runtimeImage = snapshot`，并记录 `render.runtimeImageRepin = {operationId, generation, versionId}` 供重放。`start` 不变。
   - 同一 `operationId` 重放返回同一环境；目标或代次不同报 `idempotency_conflict`；更老的代次报 `stale_generation`；环境不存在报 `workspace_missing`。
4. **恢复**：沿用现有路径。`render` 被原样复制，新 Pod 即使用新镜像；`start > 1`，所以不重新初始化存储，只运行运行镜像的初始化步骤。
5. **其它读者**：任务视图（`runtimeImage` 取当前钉住版本，`image` 取环境）、恢复材料证明、重建、重新执行（新任务继承当前钉住版本，从原任务复制该版本的引用）、关闭（释放当前与准入两个版本的任务引用，引用不存在时为空操作）、引用回收的拥有者证明（任务只拥有当前钉住版本的引用）。

## 5. 失败模式

- **准入拒绝**：不写任何状态。
- **崩溃位置**：
  - 改钉之前崩溃：重放时重新调度（task-runtime 按 `operationId` 幂等）；
  - 改钉之后、业务侧记账之前崩溃：重放时 task-runtime 返回已改钉的环境，业务侧补记。
- **调度阶段失败**：
  - 镜像不同、版本不可用或用途未验证：操作 `failed`，没有预留任何引用。
  - 改钉被明确拒绝（precondition、conflict、validation）：操作 `failed`，释放新引用，原钉住的镜像不变，任务仍是暂停。
  - 未知错误：操作保持 `pending`（`lifecycle_unknown`）并在后台重放。预留、确认与改钉都按任务和操作幂等。
- **并发**：升级与恢复、关闭等操作经同一代次与「无进行中操作」检查互斥。

## 6. 测试策略

- **business-task**
  - `tests/runtimeImageUpgrade.test.ts`（真实 PostgreSQL，HTTP 入口）：
    - 正向顺序为同镜像检查 → 预留 → 确认 → 改钉 → 记录 → 释放旧引用；视图显示新版本，拥有者证明随钉住版本迁移；
    - 同键重放与目标冲突；已钉住目标的 no-op 不加代次；`task-state` 事件；升级后恢复；
    - 缺省目标取调用方发布；能力字段有无；
    - 受理阶段拒绝：缺 fence、fence 过期、版本不在选择集、代次过期、未暂停；
    - 执行阶段失败：镜像不同、版本不可用、用途未验证、改钉被拒（释放新引用）；
    - 未知错误阻塞恢复与关闭直至重放完成；丢失租约后由下一个认领者重放；并发升级只受理一个；关闭释放当前与准入两个引用。
  - `tests/runtimeImageUpgradeRecovery.test.ts`：材料证明与重建按当前钉住版本核对引用；升级前的恢复评估过期；重新执行复制当前钉住版本。
  - `domain/executionLifecycle.test.ts`：`currentTaskRuntimeImage` 与 `taskMaterialDigest`。
- **task-runtime**：`tests/businessWorkspace.test.ts` 的两条 RFC-043 用例：
  - 暂停环境的改钉、并发与重放、冲突与过期代次；恢复后台账规格的 `pod.image` 为新镜像，原卷不变；
  - 拒绝暂停中、跨项目与卷已变化的环境，原镜像不变。
- **platform**：`businessImagePorts.test.ts` 的版本查询端口：不存在的版本返回空，其它错误照常抛出。
- **客户端**：`packages/api-client` 的 `upgradeRuntimeImage` 路径与请求体。
- **锁**：契约锁 `bun run contracts:lock`（新增 3 处、破坏性 0）与迁移锁 `bun run migrations:lock`。

## 7. 与 AW 的耦合（AW RFC-370 §10 V21）

- **主动升级**：AW 的工作区生命周期对账在暂停一个空闲的持久共享父任务（`development:shared`）时，若其 `runtimeImage.versionId` 不等于能力快照的 `taskRuntimeImageVersionId`，就请求升级；下一次使用时照常恢复。
- **按需升级**：卷内命令对持久父任务报未知操作时，若父任务没有活动子执行，就依次暂停、升级、恢复并重试一次；否则返回可重试的明确错误。AW 任务卷同理，按需升级。
