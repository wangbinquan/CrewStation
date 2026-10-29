# RFC-044 设计

> Approved / In Progress · 2026-10-28，作者批准「按推荐实现」。复用 RFC-042 的世代、空目标供给、固定命令 Job、维护保留、执行冻结、候选槽与执行交接；新增的是迁移操作本身、Job 回调接口和首写前回退。AW 侧合同以 agent-workflow 仓库为准：`docs/crewstation-deployment.md`「epoch-2 发布的数据库切换」、`packages/backend/src/bootstrap/epochMigrationHosted.ts`、`packages/backend/src/bootstrap/epochMigrationHostedEntry.ts`。

## 1. 模块与所有权

| 范围 | 所有者与层次 |
|---|---|
| 目标库与 scratch 库的世代、生产绑定的切换与回退 | L3 data：在 RFC-042 的 `database_generations` / `database_environment_bindings` 上增加迁移来源；仍经 L2 data-control 供给真实库与角色 |
| 迁移操作、候选构建、Job、计划与批准、切换编排、回调接口 | L4 release：新表 `release.database_migrations` 与产物表；复用发布准入、维护、执行交接端口 |
| 执行冻结与停写证明 | L5 business-task：复用 RFC-042 的 migration barrier（`freezeMigration` / `withdrawMigrationBarrier`），经既有 reverse port 注入 release |
| 维护保留 | gateway：复用恢复的维护保留，记录操作种类 |
| API schema / DTO / 客户端 | packages/contracts、api-client |
| 页面 | apps/console release feature 新增迁移页，复用 FormDialog / ConfirmationDialog / ConfirmDialog |
| 装配 | platform/wiring 只调用公开根 API |

不新增跨层 facade 或结构例外。迁移与恢复的进行中规则合并为一个前置检查：同一服务同时只能有一个未结束的恢复或迁移。

## 2. 对外合同

### 2.1 Manifest

`spec.service.databaseMigration`（可选）：

```yaml
databaseMigration:
  command: [agent-workflow, migrate]                      # plan / run / rollback / complete 共用，ACTION 由平台注入
  verifyCommand: [agent-workflow, verify-database-migration]
  sourceKeyConfig: AW_SECRET_KEY                          # 可选：原样转交为 CS_DATABASE_MIGRATION_SOURCE_KEY 的配置项名
  servicePlanId: <服务套餐 ID>                             # 可选：迁移 Job 使用的套餐；缺省时用服务自己的套餐
```

`servicePlanId` 是 T9 验收后的修订（2026-10-28，作者批准「迁移 Job 单独指定套餐」）。AW 的 run Job 按服务套餐（250m/512Mi）运行时，内存一直顶在上限，进程反复 GC，几乎没有进展。迁移是一次性的重负载，不应迫使服务本身长期使用大套餐。构建候选时平台就核对这个套餐，不可用时操作停在 building，报「迁移套餐不可用」。

命令只能来自已构建镜像的 Manifest，发布时与其他字段一起校验。AW 的 `deploy/crewstation/crewstation.template.yaml` 随本 RFC 增加这一段（AW 侧改动在 AW 仓库提交）。

### 2.2 管理员 API

均在服务下，`requestId` 为 UUIDv7，幂等键绑定整份请求摘要（同 RFC-042）。

| 路由 | 请求 | 说明 |
|---|---|---|
| `POST /v1/services/:serviceId/database-migrations` | `requestId, expectedActiveReleaseId, expectedActiveGenerationId, branch, expectedCommitSha` | 创建操作；平台按该提交构建候选镜像（只构建，不运行普通迁移与部署） |
| `GET /v1/services/:serviceId/database-migrations[/:id]` | — | 阶段、revision、源/目标/scratch 世代、候选镜像、计划视图、批准、Job 尝试与回执、可用动作、阻塞原因 |
| `POST …/:id/replan` | `expectedRevision` | 计划阶段重新生成计划（例如在旧版本里处理完阻断项之后）；旧批准作废 |
| `POST …/:id/approve` | `expectedRevision, approvalDigest` | 必须等于当前计划的 `approvalDigest`；有阻断项时拒绝 |
| `POST …/:id/switch` | `expectedRevision, confirmationDigest` | 进入维护、冻结并开始迁移 |
| `POST …/:id/open` | `expectedRevision, confirmationDigest` | 验证通过后开放准入、交接执行权并切流 |
| `POST …/:id/rollback` | `expectedRevision` | 冻结之后、开放之前撤回到原世代与原版本 |
| `POST …/:id/cancel-rollback` | `expectedRevision` | 撤回 Job 失败且平台尚未回退时，取消撤回，回到待开放 |
| `POST …/:id/retry` | `expectedRevision` | 重试当前阶段失败的 Job 或平台步骤，输入不变 |
| `POST …/:id/abandon` | `expectedRevision` | 冻结之前放弃；目标库与 scratch 库保留 |

### 2.3 Job

一次迁移最多运行这些 Job，全部使用候选镜像。资源取 `databaseMigration.servicePlanId` 指定的套餐，未指定时取服务套餐；候选槽本身始终用服务套餐。`activeDeadlineSeconds` 默认 3600：

| Job | 命令 | `CS_DATABASE_MIGRATION_ACTION` | 额外输入 |
|---|---|---|---|
| plan | `command` | `plan` | — |
| run | `command` | `run` | `APPROVE`、`FREEZE_REFERENCE` |
| verify | `verifyCommand` | —（命令固定为 verify） | — |
| rollback | `command` | `rollback` | `FREEZE_REFERENCE` |
| complete | `command` | `complete` | — |

所有 Job 都注入：

- 服务的生产配置项（与 RFC-042 恢复 Job 相同的渲染方式）。
- `CS_DATABASE_MIGRATION_OPERATION_ID`：`dbm_e2_` 加操作 ID 去掉连字符，在所有 Job 中保持不变。
- `CS_DATABASE_MIGRATION_SOURCE_GENERATION`：源世代 ID。
- `CS_DATABASE_MIGRATION_SOURCE_URL`：当前生产库连接串。AW 只读源库，平台不另建只读角色。
- `CS_DATABASE_MIGRATION_TARGET_URL`：目标库。它在 plan Job 之前就已创建，AW 的迁移 journal 在这里。
- `CS_DATABASE_MIGRATION_SCRATCH_URL`：scratch 库。
- `CS_DATABASE_MIGRATION_CONTROL_URL`：本 Job 的回调地址（见 2.4）。
- `CS_DATABASE_MIGRATION_SOURCE_BORN_ON_POSTGRESQL=1`：平台只在 PostgreSQL 上供给服务数据库，这是平台事实。
- `CS_DATABASE_MIGRATION_SOURCE_KEY`：仅当 Manifest 声明了 `sourceKeyConfig` 时注入，值为该配置项的原值。
- `CS_PLATFORM_API_URL` 与 `CS_PLATFORM_API_TOKEN`：本 Job 的只读对象读取地址与令牌（见 2.4）。
- `CS_DATABASE_MIGRATION_SCRATCH_ROOT`：Job 的本地临时目录，挂在 emptyDir 上；容量按计划的 `estimates` 设置，默认 20 GiB。

不注入 `CS_DATABASE_GENERATION_ID` / `CS_DATABASE_GENERATION_OPERATION`，也不在之后的服务槽注入。AW 要求切换后的服务从环境推导出与源相同的 `dbg_cs_` 身份，与 RFC-042 恢复世代的做法不同。

输出：

- plan Job 在 stdout 打印一行 `CS_DATABASE_MIGRATION_PLAN=<JSON>`。
- run Job 在需要重新批准时同样打印 PLAN，否则打印多行的 `CS_DATABASE_MIGRATION_RECEIPT=<规范 JSON>`。
- verify / complete / rollback Job 打印 RECEIPT。

平台读取完整容器日志（上限 16 MiB）找到唯一的标记；RECEIPT 的内容再与产物表中同名回执逐字节核对（`activation-receipt.json`、`switch-receipt.json`、`completion-receipt.json`、`rollback-receipt.json`）。退出码 0 但没有合法标记的尝试记为 `receipt-invalid`。

### 2.4 Job 回调接口

AW 的回调请求不带认证头，所以每个 Job 拿到一个带能力令牌的路径：

- `CS_DATABASE_MIGRATION_CONTROL_URL = http://cs-api.<systemNs>.svc:8087/internal/database-migrations/<jobId>/<token>`
- `token = base64url(HMAC-SHA256(secretKey, "database-migration-control\0" + jobId + "\0" + requestDigest))`

令牌只在该 Job 是操作当前尝试、且操作处于允许该动作的阶段时有效。路径下按 AW 合同实现：

| 方法与路径（相对 `<CONTROL_URL>/v1/operations/<operationId>`） | 行为 |
|---|---|
| `POST /artifacts` `{operationId, name, digest, bytes(base64), requestKey}` | 写入一次性产物，返回 `{digest, bytes:<原始字节数>}`。同名同摘要重复写入视为成功，同名不同摘要返回 409 `write-once-conflict`。单个请求体上限 32 MiB（AW 大证据按 4 MiB 分块） |
| `GET /artifacts?operationId=&name=` | 返回 `{bytes, digest}`；不存在返回 200 与 `null` |
| `POST /freeze/verify` `{operationId, reference, sourceGenerationId, writersStopped}` | 冻结仍由本操作持有、引用与平台签发的一致、旧写入者仍为零时返回 `{verified:true}`，否则 `{verified:false}` |
| `POST /prepared` `{operationId, generationId, receiptDigest, location, requestKey}` | 记录激活准备（同 requestKey 幂等），`location.profileRef` 必须是 `crewstation:target`；返回 `{}` |
| `GET /activation?operationId=` | 按 data 绑定的真实状态返回 `{pointsAt:'source'|'target'|'other'|'none', pointerDigest}`，`pointerDigest` 为绑定 `{generationId, revision}` 规范 JSON 的 sha256 |
| `POST /rollback` `{requestKey}` | 记录 AW 已退役目标、请求平台回退；平台随后执行 4.6 的回退 |
| `GET /backup?reference=` | 第一版不支持旧 epoch 备份恢复，返回 404 `database_migration_restore_unsupported` |

错误统一返回 `{error, message, details}`；暂时不可用返回 503 并带 `retry-after`。只读对象接口复用 RFC-042 的 `/internal/database-restore-objects` 实现，身份改为迁移 Job：`GET <base>/<objectId>` 与 `GET <base>/<objectId>/content`。

产物存在 `release.database_migration_artifacts`：主键 `(operation_id, name)`，记录 digest、大小和 `bytea` 内容，只插不改。操作结束后保留，随项目删除一起清理。

## 3. 数据：世代与绑定

- `data.database_generations.origin` 增加 `migration` 与 `migration-scratch`，增加 `migration_operation_id`（唯一）。目标与 scratch 的物理名分别为 `cs_migrate_<id>` 和 `cs_mscratch_<id>`，沿用 RFC-042 的空库出生证明与身份检查。
- scratch 世代永远不能绑定为生产。
- `envFor` 对 `migration` 来源的世代不追加 `CS_DATABASE_GENERATION_*`。
- 新增两项操作：
  - `commitMigration`：在绑定上做 CAS，从源切到目标；源世代变为 `retained`，目标变为 `active`。
  - `revertMigration`：从目标切回源，只在首次开放之前允许；目标变为 `retained`。
- 两项都按操作 ID 幂等。迁移进行中，生产临时授权、凭据轮换与恢复都会被拒绝，返回 `database_migration_active`。

## 4. 持久流程

`release.database_migrations` 的结构与 RFC-042 相同：stage、revision、不可变的原输入、只追加的尝试历史、加密冻结的 Job 环境。一个服务同时最多一个未结束操作（恢复与迁移合计）。进度循环每 3 秒推进一次，跑在 cs-controller 上，并持有操作锁。

```
requested → provisioning → building → planning → awaiting-approval → approved
  → freezing → migrating → activating → verifying → ready-to-open → opening → completing → completed
旁支：rolling-back → rolled-back；abandoned（冻结之前）
```

### 4.1 准备

1. **requested → provisioning**：预留目标与 scratch 世代，由 data-control 创建空库；拿到空库证明后才能前进。
2. **building**：用请求里的提交创建候选发布（tag `<下一版本>+migrate.<op>`，`pipeline.databaseMigration` 标记），只执行构建阶段并固定镜像摘要；普通流水线忽略它。候选镜像的 Manifest 必须声明 `databaseMigration`，否则失败为 `database_migration_unsupported`。
3. **planning**：运行 plan Job，解析计划视图。阻断项为空则进入 awaiting-approval，有阻断项也进入，但只能 replan 或放弃。

### 4.2 批准与切换确认

- approve 保存 `approvalDigest` 和批准人。
- switch 的 `confirmationDigest` 覆盖：操作 ID、revision、计划摘要、approvalDigest、候选镜像、源与目标世代。
- 两个动作分开：先批准计划，再选择进入维护的时机。

### 4.3 冻结（freezing）

完全复用 RFC-042 恢复的冻结步骤：

1. 进入维护保留；
2. 调用 `migrationBarrier`，以操作 ID 和候选发布写入执行冻结；
3. 等 AW 当前实例确认 ready，并完成写入者排空；
4. `observeWritersStopped` 观察到零个业务任务写入者。

全部满足后签发冻结引用：`cs-freeze:<operationId>:<executionEpoch>:<sha256(冻结记录)>`。此后直到 opening 或回退结束，冻结一直由平台持有，Job 退出不释放。

### 4.4 迁移（migrating）

运行 run Job，传入 APPROVE 与冻结引用。

- **打印 PLAN**（转换与计划有实质差异）：进入 `awaiting-reapproval`，冻结继续保持。管理员重新 approve 后再跑 run，同一操作、同一目标。
- **打印 RECEIPT**：核对三件事：
  - 回执的 `digest` 等于 `/prepared` 记录的 `receiptDigest`；
  - 回执里的操作 ID 与目标位置与本操作一致；
  - 产物表里的 `activation-receipt.json` 与输出逐字节一致。

  核对通过后进入 activating。

### 4.5 激活与验证

**activating**：

1. data `commitMigration`：从这一刻起，`/activation` 返回 `target`。
2. 候选槽绑定目标世代后部署。执行冻结仍保留（候选在目标上以待命身份启动，AW 的 ready 会因「不是当前发布」被拒绝，这是预期行为）。
3. 观察候选的探针与镜像，留下候选证明。

**verifying**：运行 verify Job，得到 switch receipt（kind `verified`）后进入 ready-to-open。失败时保持维护与冻结，可以重试或回退。

### 4.6 回退（rolling-back）

冻结之后、opening 之前可以发起。运行 rollback Job：AW 先退役目标世代，若 `/activation` 为 `target`，再调用 `POST /rollback`。平台随后：

1. data `revertMigration`（若已提交）；
2. 候选槽下线，候选发布标记 failed；
3. 撤回执行冻结（epoch+1，phase inactive），原版本重新认领执行权；
4. 退出维护，结束世代预留；
5. 进入 `rolled-back`。

数据库流量一直没有切过去，旧槽始终是正式槽，所以回退不涉及切流。冻结之前的放弃直接走 RFC-042 的放弃步骤，不需要 Job。

T9 验收后补充 `rolling-back → cancel-rollback → ready-to-open`（2026-10-29，作者批准）。仅在未请求放弃、已有 verify 回执、当前 rollback 尝试的 Job 回执为 failed 且操作有 error、没有成功 rollback 回执也没有 `rollbackRequest` 时提供，retry 仍可用。受理时在操作锁内核对 revision、生产绑定仍指向本操作的目标世代、候选仍在目标槽，否则返回 409。平台只有收到成功撤回回执才会回退绑定、停止候选、撤回冻结和退出维护，因此失败的 Job 尚未改变这些状态。取消撤回只清空 error、observation，将失败尝试移入历史并清空当前尝试，回到待开放；管理员重新核对开放摘要后，沿原开放与完成流程继续。

### 4.7 开放与完成

**opening**：沿用 RFC-042 的执行交接与切流：

1. 插入 handoff：`freezing → preparing → routing → activating → complete`；
2. 候选以更新的 epoch 认领执行权；
3. 切流，等网关观察到正式路由。

从候选开始写入的那一刻起，撤回窗口关闭；平台在 opening 开始时就不再提供 rollback 动作。

**completing**：运行 complete Job，得到 completion receipt 后：退出维护，结束世代预留，进入 completed。源世代保持 retained，不删除。

### 4.8 失败、观察与冷恢复

与 RFC-042 相同：

- 平台拒绝类错误写入 `error`，等待管理员重试或放弃（回退）；
- 基础设施错误写入 `observation`，自动重试；
- Job 终态失败（`exit | deadline-exceeded | job-lost | pod-missing | receipt-invalid | receipt-mismatch`）记为一次尝试，retry 换新的 Job ID，目标、镜像、批准与冻结引用都不变。

AW 的迁移 journal 在目标库，Job 每次启动都从产物表重建本地状态，所以重试不会重复已完成的动作。第一版不提供 AW 的 `new-run`：需要新目标库时，先回退或放弃当前操作，再发起新的操作。

## 5. 页面

在服务发布页增加「数据库迁移」入口，打开独立的迁移页，与「从备份恢复」并列。页面内容：

- **阶段进度**：同 RFC-042。
- **候选与世代**：候选版本与镜像摘要，源 / 目标 / scratch 世代。
- **计划**：源与目标识别信息、阻断项（逐条列出代码、范围与处理建议）、限制、需要确认的事项、预计耗时与容量；完整计划可下载（产物中的 `plans/<digest>.md`）。
- **动作**：
  - 批准：ConfirmationDialog，显示 approvalDigest；
  - 进入维护并迁移：ConfirmationDialog，列出维护影响；
  - 开放：ConfirmationDialog，明确「开放后不能撤回」；
  - 回退：ConfirmDialog，确认词 `rollback`；
  - 放弃：ConfirmDialog，确认词 `abandon`；
  - 重试：只在有 error 时显示。
- **证据**：每个 Job 的尝试历史、失败种类、日志尾部，以及各回执的摘要。

请求意图存在 sessionStorage，响应丢失时用同一 requestId 重放（同 RFC-042）。项目成员只读查看。

## 6. 测试策略

- **domain**：阶段机的所有前进、回退与拒绝转移；confirmationDigest 失效；进行中前置检查（恢复与迁移互斥，发布 / 下线 / 切流 / 临时授权 / 凭据轮换被拒）。
- **真实 PostgreSQL**：
  - 操作与产物表的 CAS、一次性写入与幂等；
  - 世代 `commitMigration` / `revertMigration` 的并发与幂等；
  - 每服务一个未结束操作。
- **回调接口**：用 AW 的真实请求形状逐条测试：写入一次性、同摘要重复、冲突 409、不存在返回 null、冻结验证真假、prepared 幂等、activation 真实指向、rollback、令牌只对当前 Job 与阶段有效。
- **release 故障注入**：每个外部调用（data、Job、维护、冻结、交接、切流）前后中断，冷恢复后结果一致；Job 失败的各类尝试与重试；run 返回 PLAN 时进入重新批准。
- **k8s**：迁移 Job 的环境 Secret、emptyDir、镜像与命令核对；日志标记解析（单行 PLAN、多行 RECEIPT、缺失、多个、超长）。
- **页面**：各阶段的动作可见性，确认弹窗与过期摘要，回退 / 放弃确认词，错误与重试，深链与返回。
- **联调**：在真实 PostgreSQL 上运行 AW 的真实迁移镜像：独立验收服务从 epoch 1 迁到 epoch 2，覆盖重新批准、回退与完成三条路径；回调请求取自 AW 实际运行。
- **真实验收**：先在独立验收服务上做端到端迁移、回退和完成；再按实例批准迁移本机正式 AW。

先完成全部实现与用例，再集中验证（同仓库规则）。

## 7. 偏离与遗留

- 第一版不支持 AW 的 `restore`（旧 epoch 备份恢复）和 `new-run`：`/backup` 返回明确的不支持错误，需要新目标时放弃后重新发起。
- 产物存在 PostgreSQL 表里，没有放进对象存储：AW 的产物按 4 MiB 分块、总量与源库同量级，本机正式 AW 的源库只有 40 MB。源库很大的服务以后再评估改用对象存储。
- 源库访问使用生产连接串，没有另建只读角色。AW 的迁移 Job 只读源库，这一点由 AW 合同保证。
