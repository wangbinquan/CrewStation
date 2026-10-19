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
  - 已有：`runtime_image_not_allowed`、`image_usage_unvalidated`、`image_unavailable`、`active_subtasks`、生命周期冲突与 fence 拒绝。

## 3. 数据

迁移 `business-task/0040_runtime_image_upgrade.sql`（只增）：

- `execution_lifecycles.payload jsonb null`：升级操作的目标快照（准入时固定，调度时使用）。
- `execution_task_runtime_images(service_id, task_id, generation, snapshot jsonb, operation_id, updated_at)`，主键为 `(service_id, task_id)`：记录当前钉住的快照，仅在与意图快照不同时存在。

读者统一走 `currentRuntimeImage(task) = upgraded?.snapshot ?? intent.task.runtimeImage`。

恢复材料摘要：`materialDigest = upgraded ? sha256(effectiveDigest ‖ snapshot.versionId) : effectiveDigest`。升级前做出的恢复评估因此自然失效，需要重新评估。

## 4. 流程

1. **准入**（`lifecycleAdmission`）：
   - 动作 `upgrade-runtime-image`：fence 必填，`generation == expectedGeneration` 且没有进行中的生命周期操作。
   - 任务须为 `paused`、持久卷、没有活动子执行。
   - 解析目标版本：缺省取当前正式发布（`execution_controls.activeReleaseId`）的 `tasksSpec.runtimeImageVersionId`；显式指定的版本须在该发布的选择集内。
   - 经平台端口查询两个版本的 `imageId` 并比较。
   - 目标等于当前版本 ⇒ 直接写一条已完成的操作。
   - 否则以拥有者 `{type: 'task', id}`、用途 task 预留新版本引用（与创建同一 `reserveImage`），得到快照写入 `payload`，代次加一，任务状态记为 `upgrading`（对外仍是暂停）。
2. **调度**（`execution/lifecycle.ts` 的工作循环）：
   - 确认新引用。
   - 调用 task-runtime 的 `repinPausedBusinessWorkspace({taskId, projectId, serviceId, operationId, generation, volumeUid, runtimeImage})`。
   - 成功后 upsert `execution_task_runtime_images`，释放旧版本引用，写任务事件 `task.runtime-image-upgraded`，操作 `done`，任务回到 `paused`。
3. **task-runtime**：
   - 在项目锁内检查：环境为 paused、`businessStorage` 持久、卷身份已验证、Pod 已不存在。
   - 改写 `render.image = snapshot.image`、`render.runtimeImage = snapshot`，记录 `render.runtimeImageRepin = {operationId, generation}` 供重放。`start` 不变。
   - 同一 `operationId` 重放返回同一环境；更老的代次报 `stale_generation`。
4. **恢复**：沿用现有路径。`render` 被原样复制，新 Pod 即使用新镜像；`start > 1`，所以不重新初始化存储，只运行运行镜像的初始化步骤。

## 5. 失败模式

- **准入拒绝**：不写任何状态。
- **崩溃位置**：
  - 改钉之前崩溃：重放时重新调度（task-runtime 按 `operationId` 幂等）；
  - 改钉之后、业务侧记账之前崩溃：重放时 task-runtime 返回已改钉的环境，业务侧补记。
- **调度阶段失败**（例如引用确认失败）：操作 `failed`，原钉住的镜像不变，新引用释放，任务仍是暂停。
- **并发**：升级与恢复、关闭等操作经同一代次与「无进行中操作」检查互斥。

## 6. 测试策略

- **business-task**：
  - 各原因码拒绝；
  - 正向路径：暂停 → 改钉 → 视图显示新版本，引用迁移，`materialProof` 成立；
  - 重放与同版本 no-op；并发操作冲突；
  - 升级后的恢复评估；关闭时释放当前引用；
  - 能力快照的新字段。

  用例对照 `executionLifecycle.test.ts`、`taskRecoveryRebuild.test.ts` 编写。
- **task-runtime**：
  - 暂停环境的改钉、拒绝路径与重放；
  - 改钉后恢复，台账规格的 `pod.image` 为新镜像（对照 `businessWorkspace.test.ts`）。
- **platform**：版本 `imageId` 查询端口。
- **锁**：契约锁 `bun run contracts:lock` 与迁移锁 `bun run migrations:lock`。

## 7. 与 AW 的耦合（AW RFC-370 §10 V21）

- **主动升级**：AW 的工作区生命周期对账在暂停一个空闲的持久共享父任务（`development:shared`）时，若其 `runtimeImage.versionId` 不等于能力快照的 `taskRuntimeImageVersionId`，就请求升级；下一次使用时照常恢复。
- **按需升级**：卷内命令对持久父任务报未知操作时，若父任务没有活动子执行，就依次暂停、升级、恢复并重试一次；否则返回可重试的明确错误。AW 任务卷同理，按需升级。
