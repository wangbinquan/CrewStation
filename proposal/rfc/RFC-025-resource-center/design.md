# RFC-025｜技术设计

> 状态：In Progress · 2026-09-23 · 作者「批准并实施」：裁定见 [提案](./proposal.md) §4，取舍 B1–B11 批准，Q1–Q8 按草案写法
> 配套：[提案](./proposal.md) · [计划](./plan.md) · [现状盘点](./audit.md) · [ADR-0009](../../../docs/adr/0009-resource-center.md)

## 目录

- [1. 现状与落位](#1-现状与落位)
- [2. 声明式模型](#2-声明式模型)
- [3. 台账存储](#3-台账存储)
- [4. 契约](#4-契约)
- [5. 受理与统一预检](#5-受理与统一预检)
- [6. 调和器](#6-调和器)
- [7. 流量：路由、说明页、限流、身份索引](#7-流量路由说明页限流身份索引)
- [8. 推送流](#8-推送流)
- [9. 各领域模块的改动](#9-各领域模块的改动)
- [10. 工作台与命令行](#10-工作台与命令行)
- [11. 迁移与兼容](#11-迁移与兼容)
- [12. 失败模式与并发](#12-失败模式与并发)
- [13. 性能与规模](#13-性能与规模)
- [14. 测试策略](#14-测试策略)
- [15. 偏离与债](#15-偏离与债)

## 1. 现状与落位

现状逐条见 [audit.md](./audit.md) §1、§2：分配与释放分散在 `task-runtime`（L4）、`release`（L4）、`gateway`（L5）、`dev-session`（L5）、`business-task`（L5）、`data`（L3）、`provisioning`（L6），观测在 `cluster-management`（L6）与 `observability`（L6），只有 `gateway` 的 `podWatcher` 在 watch Pod（`modules/gateway/workers/podWatcher.ts:19-63`）。

落位（作者 D4「可以多个模块，状态收口在 infra 层」；结构决策见 ADR-0009，提案 Q1）：

| 单元 | 层 | 拥有 | 依赖 |
|---|---|---|---|
| `modules/resources`（新） | L1 | 台账（期望、实况、子对象、变更日志、别名）、种类注册表与阶段规则、受理与平台预检、额度推导、保留期、标准视图与推送流、可做操作 | 只依赖 packages；项目额度上限、角色裁剪、Kubernetes dry-run 经 `ports/` 由组合根提供 |
| `modules/cluster-control`（新） | L2 | 全部 Kubernetes 子对象的调和：Namespace、ResourceQuota、NetworkPolicy、Pod、PVC、Secret、Service、Deployment、Job、IngressRoute、Middleware；观测映射成实况；孤儿回收；旧对象收编；Pod 观测供身份索引 | `resources`；packages `k8s`、`queue`、`resource-runtime` |
| `modules/data-control`（新） | L2 | 数据面的调和：库、角色、访问授权（执行代码自 `data` 模块的供给适配器迁入） | `resources`；packages `persistence` 与数据面驱动 |
| `packages/resource-runtime`（新，领域无关） | — | 调和循环骨架：按种类的 list＋watch 缓存与定期全量核对、按资源 ID 去重的工作队列、租约、退避 | packages `k8s`、`persistence`、`kernel` |

依赖方向：所有写期望的领域模块（`data` L3、`release`／`task-runtime` L4、`dev-session`／`business-task`／`gateway` L5、`provisioning`／`cluster-management` L6）依赖 `resources`（L1）的根 `index.ts`，不依赖两个 `*-control` 模块；`*-control` 由组合根在 `cs-controller` 里装配成 worker，它们只认台账，不认领域。`resources` 与 `identity` 同在 L1、互不依赖。`tools/arch/policy.ts` 登记三个新单元与新增的依赖边。

各模块保留与交出的东西见 §9。

## 2. 声明式模型

### 2.1 期望与实况

- **期望（spec）只由所属模块写**：`declare(kind, id, owner, spec)` 新建或整体替换期望，代数（`generation`）加一；`requestRelease(id, reason)` 把期望改为「不要了」，也是一次代数加一。别的模块写不了（按 `owner.module` 核对），界面不解读期望的内部结构。
- **实况（status）只由资源中心写**：调和器把集群观测写进子对象与条件；所属模块经 `reportConditions(id, conditions)` 上报领域条件（B2）；阶段由 `resources` 按种类的规则从条件算出（§2.3），不接受任何人直接写阶段。
- `observedGeneration < generation` 表示期望还没被调和完；界面据此写「变更中」。

### 2.2 种类注册表

每个种类在 `resources/domain/kinds/` 有一份声明（纯数据＋纯函数）：

- 期望的 Schema（在 `packages/contracts`）与所属模块；
- 子对象的种类与数量约束（例如 `dev-workspace` 恰好一个 Pod、一个 Runner Secret、一个工作卷、一条开发预览路由）；
- 占不占额度、占几个单位（开发会话、业务任务、每个 Agent 执行各一个，D31、RFC-006）；
- 阶段规则（§2.3）与失败判定；
- 保留期（`dev-workspace` 失败保留 72 小时，D9；其余失败立即回收；历史保留见提案 Q5）；
- 可做的操作及各自的前置条件（例如「释放会话」在任何非终态可做；「重试」只在失败时；「删除工作卷」只对条件「待回收」的卷、只给管理员）。

### 2.3 阶段规则

阶段只由三类输入算出：期望（要不要、代数）、子对象观测、条件。通用规则（种类可加严，不能放宽）：

| 条件 | 阶段 |
|---|---|
| 期望是「不要了」，还有子对象 | `stopping` |
| 期望是「不要了」，子对象都已回收 | `stopped` |
| 已受理、还没拿到额度或还没有子对象 | `pending` |
| 正在建子对象 | `provisioning` |
| 子对象都在、`Ready` 条件未成立、没有失败信号 | `starting` |
| `Ready` 成立 | `ready` |
| 曾经 `ready`，现在 `Ready` 不成立或关键条件（例如 `RunnerConnected`）为假 | `degraded` |
| 失败信号（子对象判定失败、预检失败之后的执行失败、启动超时） | `failed` |

`Ready` 由种类定义：例如 `agent-execution` 需要 `ContainersReady`（中心观测）、`RunnerConnected` 与 `InterfaceReady`（dev-session 上报，RFC-024）；`service-slot` 需要 Deployment 就绪副本数等于期望；`route` 需要 IngressRoute 已应用且目标存在；`database` 需要数据面报告库与角色都在。

## 3. 台账存储

`resources` schema（一个模块一个 schema；迁移按模块 layer 执行，登记迁移锁）：

| 表 | 关键列 | 说明 |
|---|---|---|
| `records` | `id`、`kind`、`project_id`（可空）、`owner_module`、`owner_ref`、`parent_id`、`purpose`、`spec`（jsonb）、`generation`、`status`（jsonb：条件、启动进度、原因）、`observed_generation`、`phase`、`phase_since`、`idle_since`、`retain_until`、`version`（每次写加一）、`created_at`、`updated_at`、`compacted_at` | 索引：`(project_id, kind, phase)`、`(parent_id)`、`(retain_until) WHERE retain_until IS NOT NULL`、`(phase) WHERE phase NOT IN ('stopped','failed')` |
| `children` | `resource_id`、`kind`、`namespace`、`name`、`uid`、`observed`（jsonb：阶段、就绪、原因、节点、重启数）、`observed_at` | 主键 `(resource_id, kind, name)`；`uid` 唯一 |
| `changes` | `seq`（bigserial）、`project_id`、`resource_id`、`version`、`kind`（upsert／remove）、`at` | 推送流的来源；只追加；保留期见 §8.3 |
| `leases` | `resource_id`、`holder`、`expires_at` | 调和器分工（§6.3） |
| `aliases` | `resource_id`、`alias`、`source`（`rel`、`tsk`、`pvc-name`、`route-name`） | 旧形状对象的别名（B11） |
| `project_locks` | `project_id` | 受理时锁这一行，把同一项目的额度判定串行化（下文） |

写入规则：任何对 `records`／`children` 的修改在同一事务里 `version + 1` 并追加一行 `changes`；推送与增量读取只看 `changes`。

额度（B3）：受理时 `SELECT … FOR UPDATE` 锁 `resources.project_locks(project_id)` 一行，在同一事务里数该项目「占额度的种类」里阶段属于 `pending／provisioning／starting／ready／degraded／stopping` 的单位数，达到上限（经 `QuotaLimits` 端口从 `project` 取）就拒绝。释放不需要做减法：阶段一离开占额度的集合，额度自然回来。

> **实施补记（2026-09-23，第一期）**：表按上面落地（`modules/resources/adapters/persistence/migrations/0002_ledger.sql`），细节如下。
>
> - `children` 的主键含命名空间 `(resource_id, kind, namespace, name)`，另有唯一索引 `(kind, namespace, name)`：一个集群对象只属于一条记录，被别的记录认领时声明直接以 `conflict` 拒绝。期望里的子对象在记录「要」的时候一直在表里（没观测到的记 `absent`）；记录「不要了」且子对象都已回收时这些行删掉，名字随即可再用。
> - `changes` 的序号在**提交时**才盖：插入时 `seq` 为空，延迟约束触发器在提交前一刻取全局咨询锁再 `nextval`，锁到提交结束才放。于是序号顺序就是提交顺序，尾随器按 `seq` 读不会跳过「先取号、后提交」的早序号（先插入后提交的事务拿到更大的号，模块用例 `ledgerWrites.test.ts` 实测）；代价是提交阶段全局串行一小段。列名写作 `change`（与资源种类的 `kind` 区分）。
> - `records` 另有 `desired`（要／不要了）与 `release_reason`（期望的一部分，只由所属模块写）；`status` 里是条件、启动进度、原因与展示字段。
> - 所属模块可以在自己的事务里写期望（`owner(module).within(tx)`），与它自己的状态一同提交或回滚；领域模块不能写只归资源中心的条件（`Observed`、`Applied`、`ReconcileError`、`SpecDrift`、`CrashLooping`、`Superseded`、`PendingReclaim`、`ContainersReady`），写了按 `validation` 拒绝。

## 4. 契约

### 4.1 标准记录（`packages/contracts/api/resources/`）

```ts
ResourceRecordSchema = z.object({
  id: ResourceIdSchema, kind: ResourceKindSchema, projectId: ProjectIdSchema.optional(),
  owner: z.object({ module: z.string(), ref: z.string() }), parentId: ResourceIdSchema.optional(), purpose: ResourcePurposeSchema.optional(),
  phase: ResourcePhaseSchema, phaseSince: IsoTime, reason: ResourceReasonSchema.optional(),
  conditions: z.array(ResourceConditionSchema), children: z.array(ResourceChildSchema),
  startup: StartupRecordSchema.optional(),                 // RFC-022 的阶段，归入标准记录
  generation: z.number().int(), observedGeneration: z.number().int(),
  idleSince: IsoTime.optional(), retainUntil: IsoTime.optional(),
  actions: z.array(ResourceActionSchema), aliases: z.array(z.string()).optional(),
  version: z.number().int(), createdAt: IsoTime, updatedAt: IsoTime,
}).strict();
ResourceReasonSchema = z.object({ code: z.string(), message: z.string(), hint: z.string().optional() });
ResourceConditionSchema = z.object({ type: z.string(), status: z.enum(['true', 'false', 'unknown']), reason: z.string().optional(), message: z.string().optional(), since: IsoTime });
ResourceActionSchema = z.object({ id: ResourceActionIdSchema, enabled: z.boolean(), disabledReason: z.string().optional() });
```

期望不在标准记录里（界面不解读）；需要展示的期望字段（版本号、档位名、分支）由种类声明为「展示字段」放进 `status.display`，并在记录里以 `display` 出现（B1）。

### 4.2 视图与流

- `GET /v1/projects/:projectId/resources?kind=&parent=` → `{ items, counts, cursor }`：`counts` 按种类×阶段算好；`cursor` 是快照时刻的 `changes.seq`。
- `GET /v1/projects/:projectId/resources/stream`（SSE，§8）；管理员 `GET /v1/admin/resources` 与 `/stream` 是全平台版本（集群管理、系统层拓扑）。
- 可做操作经 `POST /v1/resources/:id/actions/:action` 统一受理，转给所属模块的用例执行（例如「释放会话」仍由 dev-session 核对未推送提交、负责人强制等领域规则），结果回到同一条记录。

> **实施补记（2026-09-23，第一期）**：续传游标也可放在查询参数 `cursor`（与 `Last-Event-ID` 等价，头优先），给带不了自定义头的客户端；可做操作受理成功返回 202，前置条件不满足 412（`details.code` 为 `action-disabled`／`action-unsupported`），版本对不上 409；没有权限的人看到的不可用原因是权限，而不是阶段条件。另有管理员只读的收编空跑报告 `GET /v1/admin/resources/adoption-report`（§6.5）。

### 4.3 旧词汇的映射

| 旧状态 | 阶段 | 条件／细节 |
|---|---|---|
| `EnvironmentState` creating／running／paused／releasing／released／failed | provisioning／ready（或 starting）／stopped（`Paused`）／stopping／stopped／failed | `RunnerConnected` |
| `native.state` queued／starting／running／cleaning／finished | pending／starting／ready／stopping／stopped | — |
| CLI `lifecycle` starting／running／ended／failed／unknown | starting／ready／stopped／failed／degraded | `stopRequested` 变为阶段 `stopping` |
| `DevSessionState` creating／running／releasing／released／failed | provisioning／ready／stopping／stopped／failed | 空闲起点 `idleSince` |
| 重建 queued／replacing／starting／ready／failed | 工作区记录的 `provisioning`／`starting`，条件 `Rebuilding` | 旧 Pod 是被替换的子对象 |
| `SlotHealth` empty／deploying／ready／degraded／failed | stopped（原因：已下线／尚未部署）／starting／ready／degraded／failed | `retention`（RFC-021 计时）作为条件 `RetentionDeadline` |
| 发布 pending…superseded／offline | 发布不是资源（它是领域对象）；它的构建、迁移 Job 与槽是资源 | — |
| 健康 healthy／degraded／crash-looping／unhealthy／unknown | ready／degraded（条件 `CrashLooping`）／failed／degraded（`Observed=unknown`） | — |
| 数据资源 requested／provisioning／ready／failed／releasing／released | pending／provisioning／ready／failed／stopping／stopped | — |

旧接口在迁移期间照旧返回旧字段，值改由标准记录推导（提案 Q8、§11.2）。

## 5. 受理与统一预检

「让一个工作负载起来」的每个入口（开始开发、重建、新开 CLI、headless Agent、业务任务与子任务、发布部署、重新部署、切流后的路由改写、开通命名空间、建库）走同一条路（B4）：

1. **领域预检**（所属模块，不写库）：例如 Manifest 按当前写法校验（cc99553d 的规则）、档位存在且可用、分支存在、维护窗口、兼容规则。
2. **平台预检**（`resources`，不写库）：种类的期望 Schema；套餐上限（端口）；额度（§3，只读预判）；子对象的 Kubernetes 服务端 dry-run（端口，由 `cluster-control` 提供，把期望渲染出的对象以 `dryRun=All` 提交一次）。
3. **受理**（一个事务）：锁项目行，重算额度，写记录（阶段 `pending`）与 `changes`。
4. 任何一步不过：不写记录，返回标准原因 `{code, message, hint}`：一般为 HTTP 412；额度不足沿用现有的 `quota_exceeded` 错误种类。

受理之后的失败（拉镜像失败、调度不上、启动超时）由调和器写进记录，阶段 `failed`，原因同样是标准格式；不会出现「部署代码途中抛错成 500」。

> **实施补记（2026-09-24，第三期第五步：发布侧）**：统一预检先接到发布侧的入口。标准原因在 release 的 `domain/precheck.ts`：原因码＋说明＋出路；预检不过返回 412，`message` 是说明加出路的完整句子（工作台、命令行、MCP 照读），`details` 另给 `code` 与 `hint`。
>
> - **重新部署**：领域部分——服务有部署、不是当前正式版本、可以重新部署、与正式版本的迁移规则相容、没有进行中的发布与运维；部署前检查——Manifest 按当前写法（`manifest-outdated`）、套餐存在且对本项目开放（`plan-unavailable`，即套餐被收回）、副本不超套餐上限（含运维覆盖）、算力档位存在（`profile-missing`，即档位被删）且协议合用、生产配置齐全；平台部分——要部署的 Deployment 与 Service 以服务端 dry-run 提交一次（`cluster-rejected`）。槽的渲染还在 release，dry-run 随它走 release 的部署适配器；渲染移交资源中心后改经 cluster-control 的端口。受理之后的部署失败不再抛成 500：发布与槽记为失败，原因写进发布记录，接口返回失败的发布。
> - 另有只读的 `GET /v1/releases/:releaseId/redeploy-precheck`：重新部署弹窗选中版本就问一次，不通过时直接写明原因与出路（提案 §8）；版本照常可选，确认时服务端给同样的原因（09-23 裁定）。
> - **流水线部署**用同一组部署前检查，不过时发布记为失败，失败原因是同样的文本。**切流**的前置条件（尚无部署、运维中、发布进行中、破坏性迁移禁止回退、需维护窗口、线上或待命版本已变化、待命槽未就绪）都给了原因码与出路。
> - **发布受理**（第三期第六步）：打标签之前按要打标签的那次提交（给了 `expectedCommitSha` 就是它，否则是分支当前的提交）读 `crewstation.yaml`——不在（`manifest-missing`）、不是合法 YAML 或不符合当前写法（`manifest-invalid`）都拒绝；再查迁移策略（破坏性迁移只在维护窗口里，`maintenance-window-required`）与部署到待命槽之前的同一组检查（套餐、副本、档位、生产配置）。任何一项不过都不打标签、不登记发布；此前这些问题要到构建之后才发现，那时标签已打、时间线上多一条失败的发布。构建之后流水线仍按标签处的 Manifest 再查一次（期间套餐被收回、进出维护照样拦住）。套餐查询被 project 模块直接拒绝（项目不再获准使用）也归为 `plan-unavailable`。
> - 还没做：任务类入口（开发会话、CLI、业务任务）的档位与额度预检经台账受理（与 T6 的额度计数器退役一并做）。

## 6. 调和器

### 6.1 运行时（`packages/resource-runtime`）

- **观测缓存**：每个 Kubernetes 种类一个 list＋watch（`packages/k8s` 的 `watch` 已支持书签与超时重连，`packages/k8s/client.ts:86-87`），按标签 `crewstation.io/resource-id` 建索引；每 10 分钟全量 list 一次纠偏。只观测带 `app.kubernetes.io/managed-by=crewstation` 的对象（B7）。
- **工作队列**：键是资源 ID，同一资源在队列里只有一项；触发来源：台账变更（`changes`）、观测事件、定时（非终态资源 60 秒一次；有 `retain_until` 的到期时刻）。
- **租约**（§6.3）与指数退避（上限 5 分钟，失败原因写进条件 `ReconcileError`）。

### 6.2 `cluster-control` 的调和

对一条资源：

1. 读期望，按种类渲染出子对象（Pod、PVC……）；子对象带标签 `crewstation.io/resource-id`、`crewstation.io/project`、`app.kubernetes.io/managed-by=crewstation` 与用途标签（沿用 RFC-010 的分类）。
2. 期望是「要」：缺的建、偏离的改（不可变字段偏离时按种类规则重建或报 `SpecDrift`）；期望是「不要了」：按顺序删（先 Pod 后 Secret、Service、路由），每次删除带 UID 前置条件（`packages/k8s/client.ts:15`）。
3. 把观测写回 `children` 与条件；启动进度沿用 RFC-022 的 `podStartup` 推导（从 `task-runtime` 移入本模块）。
4. 请 `resources` 重算阶段。

子对象的渲染代码从今天的位置迁入（`task-runtime/adapters/k8s/taskObjects.ts`、`nativeExecutions.ts`、`release/adapters/k8s/slotDeployer.ts`、`buildKitBuilder.ts`、`migrationJob.ts`、`gateway` 的 IngressRoute 适配器、`provisioning` 的 `ensureNamespace`），按种类一个文件，领域模块不再直接调 Kubernetes。

> **实施补记（2026-09-24，第四期第一步：命名空间、额度与网络策略）**：provisioning 给每个项目写两条稳定记录，引用都是项目 ID：`namespace`（子对象是 Namespace 与额度 `crewstation-project`，期望里写项目标签与四项上限）与 `network-policy-set`（子对象是这个项目该有的每条网络策略——默认、任务出站、构建出站，接入容器另有服务槽出站；期望里写默认策略放行的系统命名空间）。开通链写期望后按阶段推进：两条都运行中（期望里的子对象都观测到了）才去建仓，最多等 60 秒，等不到就开通失败并写明还缺哪个对象、作业照常重试；启动重下发只写期望（同样的期望台账不写库）。组合根不再直接 apply 这些对象。
>
> - **渲染**：调和器与原来同一组构造函数、同样的标签（不加资源 ID 标签，按名字归记录，线上对象一个字段都不用改）；网络策略按名字取模板，平台换版改了策略形状时调和器发现不一致即按新形状改回，不再靠启动重下发。缺了或不一致才 apply；先命名空间后额度，网络策略等所在命名空间观测到了再建；命名空间删除中不动（记录是降级，原因写明删完后补回），消失后按「缺了」再建；期望不完整的不渲染，只告警。命名空间、额度与网络策略调和器只建、只改回，从不删（§6.4）；项目归档时两条记录不释放，归档后的收尾待裁定（[I27](../../../docs/engineering/implementation-open-questions.md#i27-项目归档后命名空间记录与命名空间怎样收尾)）。
> - **观测**：观测缓存加上 Namespace（集群级）、ResourceQuota 与 NetworkPolicy。额度与命名空间没有 `generation`，有人改了上限或标签，观测不变、台账不记变更；所以调和器渲染的种类（路由、中间件、命名空间、额度、网络策略）一观测到变化就直接核对认领它的记录，不一致即改回——此前路由的标签被改也要等 10 分钟一次的全量核对。额度的已用数一变也会触发一次核对，比对一致不写。
> - 切换之前按新渲染逐个比对本机 14 个项目的 73 个对象（14 个命名空间、14 个额度、45 条网络策略），全部一致，也没有期望之外的受管网络策略，所以换写入者不改动线上对象。

### 6.3 多副本分工（RC-13）

`cs-controller` 多副本各跑一套调和器。处理一条资源前 `INSERT … ON CONFLICT DO UPDATE … WHERE expires_at < now()` 抢 `leases` 一行（持有期 30 秒，处理中续约）；抢不到就跳过（持有者会处理）。持有者崩溃后租约过期，另一副本在下一轮接手。观测缓存每个副本各自一份（只读，不需要分工）。

### 6.4 回收（D8、D9，提案 §7）

- **随阶段回收**：`stopping` 时按 §6.2 删除；跟随容器的工作卷随之删除；持久卷的工作卷记录转为 `stopped` 并加条件 `PendingReclaim`（原因：上级已结束）。
- **保留期**：`failed` 的 `dev-workspace` 写 `retain_until = 失败时刻 + 72h`；到期时调和器把它转成「不要了」（原因码 `retention-expired`），按上一条回收；工作卷进入 `PendingReclaim`。同项目又开始了新会话时，旧会话的开发预览路由立即摘除（§7.1），其余照保留期。
- **孤儿**：观测缓存里带受管标签、但找不到对应子对象记录（或对应资源已 `stopped`／保留期满）的对象：Pod、Secret、Service、IngressRoute、Middleware、ConfigMap 按 UID 删除，并在台账写一条系统审计；PVC 不删，建一条 `volume` 记录（阶段 `stopped`，条件 `PendingReclaim`，原因 `orphaned`）。命名空间与 `crewstation-system` 不在回收范围。
- **管理员删除工作卷**：集群管理对 `PendingReclaim` 的卷给出「删除工作卷」，确认弹窗要输入确认词（开发规则 §7）；受理后该卷期望改为「不要了」，由调和器删除。

### 6.5 收编（B11、RC-06、RC-15）

一次性的收编作业（每期迁移时运行，幂等）：

1. 从各模块现有的表（`task_runtime.environments`、`release.service_slots`、`gateway.routes`、`data` 的资源表、`provisioning` 的项目命名空间）生成记录与期望，子对象按 UID 认领；`rel_…`／`tsk_…` 与旧 PVC 名、旧路由名写进 `aliases`。
2. 可改的标签改成新标签（Pod、Deployment、Service、IngressRoute、PVC 的标签都可改）；名字不可改的保留别名。
3. 认领不到的受管对象按 §6.4 的孤儿规则处理——今天实查到的遗留对象（audit §1）在这一步收掉；PVC 只进「待回收」。

> **实施补记（2026-09-23，第一期空跑）**：空跑报告在 cs-api 按需计算，只读：一次性列出受管 Pod 与 PVC；按资源标签或期望子对象认领的是「已认领」；系统命名空间里的是「平台组件」（安装器管理，不在收编与回收范围）；按 `crewstation.io/task` 查任务环境，仍在的是「可收编」（给出候选种类），失败未满 72 小时（按最后活动时间算）的开发会话是「保留中」，已释放、已失败或查不到的是「孤儿」（PVC 只进待回收）；服务槽、构建与迁移的 Pod 是「可收编」（第三期由对应记录认领）；其余「未归类」。cs-controller 里的观测工作器照常把 Pod、PVC 的变化写回台账（第一期台账为空，绝大多数是 unowned；系统命名空间的对象不查不写），首轮全量处理完与此后每 10 分钟记一行汇总。
>
> **收编必须先解析旧 ID**：RFC-013 之前建的 PVC、Pod 标签上还是 `tsk_…`。本机第一次空跑按标签原值查任务环境，把 demo 正在运行的开发会话的工作卷判成了孤儿（`tsk_01a09541…` 经身份目录对应 `01a0c12a-de2a-705a-…`，状态 running）。现在先经身份目录（`task_runtime.resource_identity_aliases`）换成现 ID 再查；第六期正式收编与孤儿回收沿用同一条规则。

### 6.6 `data-control`

`database`：按期望在数据面建库与角色、轮换凭据、释放时删除（生产库的释放只随项目归档，沿用 data 模块现有规则）；`data-binding`：按期望授权与回收（到期回收由 7d12f70 接到了 cs-controller，迁入后由调和器按 `retain_until` 执行）。数据面的执行代码从 `data` 模块的供给适配器迁入；三种访问模式、审批与负责人规则仍在 `data`。

> **实施补记（2026-09-24，第四期第二步：数据资源投影与数据面观测）**：
>
> - **投影**：`data` 把生产库、开发库各写成一条 `database` 记录——记录 ID 沿用数据资源的 ID，子对象是数据面上的库与同名运行角色（种类 `PostgresDatabase`、`PostgresRole`），期望里写环境与套餐，展示库名与注入的变量名，连接串不进台账；供给失败报 `Failed`（原因照供给的报错）。开发会话的每条数据访问绑定写成一条 `data-binding` 记录，挂在会话的工作区记录下：诊断只读、生产变更的子对象是它的临时角色，开发模式没有数据面对象；等负责人批准时 `Prepared` 为假（排队，原因「等负责人批准」），生效时 `Granted` 为真，拒绝、收回、到期即「不要了」（原因照结束的方式）。数据库是稳定记录，绑定是一次性记录。投影跟在 data 的仓储写入之后，台账写失败只告警、操作照常完成；每 5 分钟补投影一次，也把绑定已结束或已不在、记录却还「要」的释放掉。
> - **观测**：新模块 `data-control`（L2）。数据面没有 watch，于是两条节奏：尾随台账变更（新声明、受理释放的记录随即核对），加每 30 秒一次全量（库或角色被人删了靠它发现）。每次核对取一份快照——`pg_database`、`pg_roles` 里 `cs_` 前缀的库与角色（平台自己的库与角色不在内），OID 当 UID——在的补观测，不在而台账记着在的补消失；临时角色过了 `VALID UNTIL` 记 `Expired`（还在，却已登录不了）。阶段：库与角色都观测到了是运行中；绑定再要 `Granted`。
> - **还没移交**：库与角色的建、改仍由 data 执行——建角色时口令由执行者当场生成，连接串要交回 data 注入容器，设计没写这条路，记为 [I28](../../../docs/engineering/implementation-open-questions.md#i28-数据面的调和器建角色时口令与连接串放在哪)；删除（收回、到期的临时角色）不需要口令，下一步移交。
>
> **实施补记（2026-09-24，第四期第三步：删除移交）**：「不要了」的访问绑定（收回、到期、拒绝）还在数据面上的临时角色由 `data-control` 删：与 data 供给适配器同一套步骤——断开它的连接，在生产库里把它拥有的对象转给运行角色并撤销授权，删它在全局的授权，再删角色；删之前按观测到的 OID 核对，同名的已是另一个角色就不删。只删临时角色形状的名字（`cs_t_<绑定 ID>`，以及 RFC-013 之前的 `<运行角色>_t_<旧 ID 末 8 位>`），运行角色一律不删；为此绑定的期望里多写所在的库与运行角色（生产库尚未供给时不写），第一步投影、期望里还没有库名的旧记录不删，记一条告警、等 data 删。删掉就当场写一条消失，记录随即进入「已结束」。data 收回、到期时自己也删（暂时保留，重复删除无害）；它的到期回收吞掉了删除的错误——删失败时角色原本会留在库里，现在由调和器补上。生产库、开发库在 data 里没有释放的路径（只随项目归档，而归档今天不释放任何数据资源），`data-control` 不删库。

## 7. 流量：路由、说明页、限流、身份索引

### 7.1 路由

- `route` 的期望：Host、路径前缀、目标（服务槽、开发会话工作区、说明页）、中间件链（ForwardAuth、限流、去身份头、stripPrefix）。`gateway` 按服务写槽路由、服务域路由与 `/api/<proxy>` 路由；`dev-session` 写开发预览路由（今天由 `task-runtime` 自建、网关不知道，audit §1.8）。
- 目标是服务槽时，调和器在槽「运行中」时指向槽的 Service；槽「已结束」时指向说明页（D13）。Traefik 的 `allowEmptyServices` 不再需要（RFC-021 80c4e1b 的权宜）。
- **一个 Host 一条生效路由**：调和器按 Host 聚合，多于一条时按上级阶段的优先级（`ready` ＞ `starting` ＞ 其余）取一条，其余摘除并写条件 `Superseded`（原因写明被谁压下）。
- 切流：release 改槽的期望（哪个物理槽是正式）并发 `trafficSwitched`；网关改写两个 Host 的路由期望；调和器应用。

> **实施补记（2026-09-24，第三期后半第一步）**：路由先投影、后移交。gateway 每次按服务重算路由（建项目、切流、发布登记、归档）之后，把每条路由写成一条 `route` 记录（`ref` 为 `<服务 ID>/<种类>`，种类是正式、待验证、服务域与内部 API 前缀），子对象是它的 IngressRoute，期望里带 Host、路径前缀、目标 Service 与中间件链，展示字段是种类、Host、前缀与目标；不在新计划里的几种（例如不再暴露内部 API、服务归档）标「不要了」；台账不重新声明已释放的记录，同一种路由摘掉之后再出现是一条新记录，`ref` 顺延为 `~2`、`~3`……路由是稳定记录（每个服务几条，视图缺省也列出）。阶段按 IngressRoute 的观测：在即运行中，删除中按启动中算。gateway 每 5 分钟按自己存的路由表补投影一次（不重新 apply）；台账写失败只告警。IngressRoute 的建删、说明页、同 Host 唯一与开发预览路由（今天挂在开发工作区记录下，由 task-runtime 建）在后面几步。
>
> **实施补记（2026-09-24，第三期后半第三步：移交）**：服务路由的 IngressRoute 改由调和器照 `route` 记录建、改、删。期望写全渲染要用的：所属服务名（IngressRoute 的服务标签）、前缀路由的优先级（100）、中间件链（平台的系统中间件带系统命名空间）；调和器在适配器里用与 gateway 相同的构造函数渲染，与观测缓存里的对象比对——期望的字段都在即一致（API Server 补的缺省不算），缺了或不一致才服务端 apply（同一字段管理者），删除中的等它消失再建，系统命名空间不碰，期望不完整的不渲染、只告警。子对象观测带上对象的 `generation`：有人改了 IngressRoute 的 spec，观测随之变化，调和器随即改回。配了台账时 gateway 只建路由引用的前缀剥离中间件（Middleware 的观测与渲染随限流一期），不再直接建删 IngressRoute；台账写失败向上抛，事件重投与每 5 分钟的补投影都会追上。切换之前按新渲染逐条比对本机线上的 55 条服务路由，全部一致，所以换写入者不改动线上对象。切流后路由的改写多一跳（声明→变更日志→调和器），约一秒。

### 7.2 说明页

- cs-api 新增 `GET /_crewstation/unavailable/:routeId`（经说明页路由的 `replacePath` 中间件到达，仍在 ForwardAuth 之后）。按路由的上级记录渲染：主机、原因（「某时由某人下线」「到期自动下线」「尚未部署」「尚未上线」）、成员看到「去发布与上线重新部署」的入口。
- `Accept` 含 `text/html` 给页面；其余给 503 与 `{ error: 'not_deployed', message, reason }`（B8、提案 Q6）。
- 页面是服务端渲染的静态 HTML（不加载工作台包），颜色走与工作台一致的令牌。

### 7.3 限流（D10–D12）

- `rate-limit-policy` 的期望：平台默认一条（平台设置里由管理员改）、项目覆盖若干条（管理员改）；`gateway` 负责校验与写期望。
- 调和器渲染 Traefik Middleware 到对应命名空间：
  - 平台接口：`rateLimit`（`sourceCriterion.requestHeaderName: x-cs-user-id`，平均、周期、突发）＋`inFlightReq`（同一键）；链在 ForwardAuth 之后，身份头由网关注入（`packages/contracts/convention.ts` 的 `IDENTITY_HEADERS`）。推送流与终端 WebSocket 的路由不挂 `inFlightReq`。未登录的请求按客户端 IP 计。
  - 用户域：每个项目的正式、待验证主机各挂两层——按用户（身份头）与按主机合计（`requestHost: true`）。
  - 服务域：按来源服务（cs-auth 在服务域认出来源后注入的来源服务头）与按目标合计。
- 超额：Traefik 返回 429；是否带 `Retry-After` 与多副本网关的全局计数（Traefik 的分布式后端）在 T2 实测（B9）。不带时由网关的错误页中间件补上；分布式后端不可用时，默认值按网关副本数折算并在平台设置里写明。
- 工作台：`packages/api-client` 把 429 解析成错误种类 `rate_limited`（带 `retryAfter`）；`useApiQuery` 对它按 `retryAfter` 自动重读并显示「请求过于频繁，N 秒后自动重试」；变更请求不自动重发。命令行照同一规则提示。能力说明 MCP 写明数字人会收到 429 与 `Retry-After`。

> **实施补记（2026-09-24，T10 第一步：策略的存取）**：限流策略由 gateway 自己存（`gateway.rate_limits`：平台默认一行，项目覆盖每个项目最多一行，按版本号乐观并发），校验照契约（令牌桶的突发不能小于平均，0 与过大的值不收），库里读出来再校验一遍、不合格的按没有处理。管理接口：`GET/PUT /v1/admin/settings/rate-limits`（平台默认，没人改过时是内置默认、版本 0）与 `GET/PUT /v1/admin/projects/:projectId/rate-limits`（项目覆盖：只覆盖用户域与服务域，写了哪一项整项照它；`override: null` 撤掉），只给管理员。Q4 的两个「合计」只给了平均，突发按平均的两倍。投影成 `rate-limit-policy` 记录、调和器渲染中间件、路由挂上中间件与界面在后面几步；这一步不改变任何请求的放行。
>
> **实施补记（2026-09-24，T10 第二步：策略进台账、调和器渲染中间件）**：gateway 把生效策略写成 `rate-limit-policy` 记录——平台一条（系统命名空间里的 `rate-limit-platform-api` 与 `in-flight-platform-api`，按 `x-cs-user-id` 分桶），每个在册项目一条（项目命名空间里的 `rate-limit-user`、`rate-limit-host`、`rate-limit-source`、`rate-limit-target`：用户域按用户与按主机，服务域按 `x-cs-source-service` 与按目标）；改平台默认时写平台与全部项目，改项目覆盖时只写那个项目，按服务重算路由时先写该项目的（路由要引用它的中间件），归档时那条标「不要了」，每 5 分钟补投影一次。调和器照记录渲染 Traefik Middleware（令牌桶是周期 1 秒的 `rateLimit`，并发上限是 `inFlightReq`），与观测比对、缺了或不一致才 apply；渲染出的对象带所属记录的资源 ID 标签，系统命名空间里带这个标签的照常观测与回收。中间件都在即记录运行中。这一步还没有路由引用这些中间件，不改变放行。
>
> **实施补记（2026-09-24，T10 第三步：挂上限流）**：项目的正式、待验证路由在用户 ForwardAuth 之后挂 `rate-limit-user`、`rate-limit-host`；服务域与 `/api/<proxy>` 路由在服务 ForwardAuth 之后挂 `rate-limit-source`、`rate-limit-target`（前缀剥离在最后）；只在配了资源台账时挂（中间件由限流记录渲染）。调和器应用路由前先看它引用的项目中间件是否都已建出，缺了就不动线上那一版、过两秒再核对（Traefik 遇到不存在的中间件会让整条路由失效）；路由的补投影改为按当前计划重算，已有服务才能挂上。平台接口：`console-api` 在用户 ForwardAuth 之后挂 `rate-limit-platform-api` 与 `in-flight-platform-api`；两条资源推送流（`/v1/projects/:id/resources/stream`、`/v1/admin/resources/stream`）拆成单独的 `console-resource-streams`，只限建连频率、不挂并发上限；任务流本来就走 `console-stream`，不挂。两个平台中间件以默认值写进安装清单（装好就有），之后由调和器按平台设置改写。工作台读请求遇到 `rate_limited` 按 `Retry-After` 自动重读（并发上限的 429 不带它，1 秒后），写请求不自动重发；命令行直接打印原因；能力说明 MCP 的接入约定写明超额返回 429 与 `Retry-After`。未登录请求的按 IP 限流（登录前的 `/auth`）没有做，Q4 也没给取值，留待 T15 校准时一并报作者。
>
> **实施补记（2026-09-24，T10 第四步：管理端界面）**：管理空间「平台设置」加「网关限流」卡——平台接口、用户域、服务域三组现值（每只桶写平均与突发，平台接口另写同时处理的上限），弹窗修改带开始修改时的版本号，校验与契约一致（正整数、范围、突发不能小于平均）。项目管理页（资源配置）加「限流」卡：用户域与服务域各标出「平台默认」或「单独设置」，弹窗里每组可选照平台默认或为这个项目单独设置（按生效值预填），可以撤销单独设置。
>
> **T2 实测（2026-09-23，本机 Traefik v3.7.13，临时探针路由测完已删）**：
>
> - `rateLimit` 超额：429，带 `Retry-After`（向上取整的秒数，2 次／秒时为 `1`）与 `X-Retry-In`（毫秒精度），正文是纯文本 `Too Many Requests`、不是平台错误体——`packages/api-client` 据此把它认作 `rate_limited`（平台额度不足的 429 带 `quota_exceeded` 错误体，不混淆）。
> - `inFlightReq` 超额：429，正文 `max connections reached: N`，**不带** `Retry-After`：要么由网关的错误页中间件补上，要么客户端按缺省间隔重试（T10 定）。不同键互不影响，前一个请求结束即放行。
> - **计数按路由各一份**：同一个 Middleware 挂在两条 IngressRoute 上，两条路由各有自己的桶，互不相加。「按主机合计」天然是每条路由一份；要跨路由合计只能靠分布式后端。
> - 按请求头分桶时，**缺这个头的请求全部落进同一个空键桶**：限流中间件必须链在 ForwardAuth 之后（此时一定有网关注入的身份头）；登录之前的路由改用客户端 IP（`ipStrategy`）分桶，不能用身份头。
> - 分布式后端：`rateLimit.redis`（CRD 字段在，v3.7 支持）；平台没有 Redis，本机未测，按上文的折算方案走；`inFlightReq` 没有分布式选项，始终按网关副本各计。

### 7.4 身份索引与放行表

- 身份索引改为读 `cluster-control` 的 Pod 观测（经 `resources` 的只读端口推给 `gateway`），`modules/gateway/workers/podWatcher.ts` 的独立 watch 去掉，全平台只剩一条 Pod watch。
- 墓碑按提案 Q5 的期限清理（今天 695 行里 666 行从未清理，audit §1.8）。
- 放行表仍是网关的领域规则，照旧由事件触发重算；新增定时全量核对，结果不一致时写进路由记录的条件。

> **实施补记（2026-09-24，墓碑）**：墓碑清理先做——cs-controller 每小时删掉标为删除超过 7 天的身份行（按 IP 反查与在册清单本就不读墓碑，同名 Pod 回来时那一行照旧复活）。补投影、墓碑清理这类定时作业共用 `packages/resource-runtime` 的 `periodicJob`（启动先跑一次、同一时刻只跑一轮、失败只告警）。
>
> **实施补记（2026-09-24，身份索引）**：身份索引改由 cluster-control 的观测缓存驱动，`podWatcher` 删去，全平台只剩这一条 Pod watch（两者的选择器本就相同）。转交走 cluster-control 的 `PodSubscriber` 端口、由组合根接到 gateway，而不是经 `resources`：系统命名空间里的平台组件不进台账却要进身份索引，台账里也不存 Pod IP。每个 Pod 变化先交身份索引（来源 IP 认人，越早越好）再写台账观测，两边失败互不耽误；观测缓存第一次全量同步后交一次全部 Pod，身份索引据此把这次没列到的在册行标删除，此后重列时消失的照常以「消失」报来。删除中的 Pod 照旧在册（优雅退出期间它的 IP 仍是它的），对象消失才标删除。
>
> **实施补记（2026-09-24，放行表核对）**：cs-controller 每 10 分钟（启动时先跑一次）按当前在册服务与授权推导一份放行表，与最新一版比内容（不看先后；默认开放的操作或操作路由变了算影响全体）。一致就不动；不一致就重算一版并告警（`allowlist drift repaired`）——事件驱动的重算照旧，这里兜住漏掉的事件。结果写进每个服务的服务域路由记录的条件 `AllowlistDrift`：这一轮有出入的为真（写明重算到第几版），其余为假，下一轮一致时恢复为假。

## 8. 推送流

### 8.1 协议（B5）

`GET /v1/projects/:projectId/resources/stream`，`text/event-stream`：

| 事件 | 数据 |
|---|---|
| `snapshot` | `{ items, counts, cursor }`；连上时（没有 `Last-Event-ID` 或游标过旧）先发一次 |
| `upsert` | `{ record, counts }`，`id:` 为 `changes.seq` |
| `remove` | `{ id, counts }`（记录被压缩或删除时） |
| `heartbeat` | 每 15 秒一次，维持经网关的连接 |
| `reset` | 服务端丢了这个连接的增量（缓冲溢出），客户端重连拿快照 |

续传：客户端重连带 `Last-Event-ID`；该游标之后的 `changes` 还在保留期内就逐条补发，否则先发 `snapshot`。

### 8.2 服务端

- 每个 cs-api 副本一个尾随器：按 `seq` 递增读 `changes`（有新行时连续读，没有时 250 毫秒一轮），按项目分发给本副本上的订阅者；每个订阅者有有界缓冲，溢出发 `reset` 并断开。
- 连上时按项目核对 `develop`／`view` 授权；项目成员变化的领域事件到达时，重新核对该项目上的连接，失权的断开（不变量：角色变化复核既有连接）。每个用户同时打开的流有上限（写在平台设置里）。
- 经 Traefik：流路由关闭响应缓冲，不挂 `inFlightReq`（§7.3）。

> **实施补记（2026-09-23，第一期）**：
>
> - 推送流的请求关掉 Bun 默认 10 秒的空闲断开（`server.timeout(req, 0)`），靠 15 秒心跳维持。
> - **T2 实测（2026-09-23，本机 Traefik v3.7.13）**：经网关不缓冲——探针流首帧在响应头后 1 毫秒到达，15 秒一帧逐帧准时到达；静默 70 秒与 200 秒的流都没有被网关断开（入口的 60 秒读超时、180 秒空闲超时都不作用于进行中的响应）。静默断流只来自上游进程自己的空闲超时：探针的 Bun 服务设了 120 秒，流在 118 秒被它断开——这正是 cs-api 要逐个请求关掉 Bun 空闲断开的原因。部署后经网关读 cs-api 的推送流：快照在响应头后 3 毫秒到达，心跳在 +15.0、+30.0 秒到达。
> - 失权断开的机制与上文不同：平台里没有成员或角色变化的领域事件，第一期沿用 cs-session 会话流的先例（`modules/session/application/authorizedSink.ts`）——发出带资源内容的事件前复核授权（至多每 5 秒一次），不通过只发一个 `reset`（`forbidden`）后断开，事件不会发给失权的人；空闲的流每 60 秒复核一次。待作者裁定（`docs/engineering/implementation-open-questions.md` I24）。
> - 每个连接的缓冲 256 条，溢出只发 `reset` 后断开；同一批里同一资源只推最后一次（中间态可能合并，顺序不倒退）。每人同时打开的流上限第一期是模块默认值 8，平台设置项随 T10（限流设置）一并加入。

### 8.3 保留与压缩

`changes` 保留 24 小时；更早的续传一律走快照。已结束的记录保留 7 天后压缩（只留身份、种类、最终阶段与原因、时间），提案 Q5。

> **实施补记（2026-09-24）**：压缩只针对终态——期望已是「不要了」且已结束满 7 天。期望仍在、此刻已结束的记录（下线的服务槽、暂停的业务工作区、待回收的工作卷）不是终态，不压缩。第一期的实现漏了这一条：待回收的工作卷满 7 天会被压掉子对象、失去对那个 PVC 的认领（本机最早 09-30 到期），第三期第三步在到期前改正。

## 9. 各领域模块的改动

| 模块 | 交出 | 保留 |
|---|---|---|
| `task-runtime`（L4） | Pod、PVC、Secret、预览 Service 的建删与观测，对账与启动观测循环，额度计数器 `admissions`，`environment_rebuilds` 的执行（换成工作区记录的期望变更） | TaskRunner 归属与协议服务端语义、Runner 令牌、执行环境的领域规则（父工作区须在运行、每个 Agent 一个执行环境），写期望与上报领域条件 |
| `dev-session`（L5） | CLI 的 `lifecycle` 判定（改读记录）、开发预览路由的隐式建删 | 一项目一会话、分支、空闲提醒、强制释放、未推送检查、CLI 名册的终端信息（PTY、档位名）、个人布局（只存显示偏好） |
| `business-task`（L5） | 容器与子任务 Pod 的生命周期判定 | 业务任务与 SubtaskRun 契约、attempt、契约校验 |
| `release`（L4） | Deployment／Service／Job 的建删与状态读取、`pollDeploy` 里的集群读取 | 发布状态机、Manifest 校验、迁移兼容、切流、下线与重新部署的领域规则（RFC-021）；槽的期望 |
| `gateway`（L5） | IngressRoute／Middleware 的应用、独立的 Pod watch | 路由表与放行表的领域规则、限流策略的校验与写期望、身份索引的下发 |
| `data`（L3） | 库、角色、授权的执行 | 数据资源与三种访问模式的领域规则、审批 |
| `provisioning`（L6） | 命名空间、额度、网络策略的直接应用 | 开通编排（写期望，按阶段推进） |
| `cluster-management`（L6） | 自有的采集快照作为唯一来源 | 管理员的清单、筛选、历史用量（RFC-015）、运维操作的受理与审计；执行改为写期望（C6） |
| `observability`（L6） | 每次请求实时读 Deployment | 日志、告警；健康改读槽记录 |
| `capabilities`（L6） | 概览摘要里自己组合的状态 | 摘要改读标准视图 |

## 10. 工作台与命令行

- `shared/resources/useProjectResources(projectId)`：先读快照，再开 SSE；把记录放进 React Query 缓存（按 ID 原位替换，`keepPrevious`）；断线自动重连并续传；页面隐藏时保持连接但不渲染。取代拓扑、概览、开发会话卡、开发页名册状态、健康卡、发布页槽卡上的轮询。
- 拓扑：`buildProjectTopology` 改为只吃标准记录（一种输入），节点与边来自记录与子对象；文案沿用 RFC-019。
- 开发页：CLI 标签的状态来自 `agent-execution` 记录的阶段；`isLiveTerminal` 改为「阶段属于 pending／provisioning／starting／ready／degraded」，`stopping` 显示「结束中」且 × 不可用；个人布局只存显示偏好（8e5b022d 已不再用页面内存）。
- 概览与发布页：阶段、原因、可做操作来自记录；槽卡的「部署版本…」预检不通过时写明原因。
- 集群管理：清单与拓扑读全平台视图；「待回收的工作卷」筛选与删除。
- 页面不得自行推导资源状态：`apps/console/src/tests/` 新增守卫用例，禁止在 `features/` 里对资源 DTO 的 `lifecycle`／`state` 做新的推导分支（白名单只含从标准记录读取的辅助函数）。

> **实施补记（2026-09-23，T7）**：`shared/resources/useProjectResources` 先读快照、再开 SSE，同一项目（同一 QueryClient）一条连接、按引用计数，最后一个使用者离开 5 秒后才断；事件按 ID 原位合进 React Query 缓存（旧版本不盖新版本，游标只进不退），reset、连接关闭或坏帧时重读快照、从新游标续上（1/2/5/10/30 秒退避）；缓存键是独立的顶层前缀，不随项目前缀的失效重读。拓扑的开发会话与业务任务两带只照记录画（服务槽那半边仍按盘点，第三期改）；概览开发卡的 CLI 数与会话徽标照记录。开发页的名册与台账合并：结束与失败以台账为准（推送流一到，所有窗口的标签同时写「结束中」、× 收起），启动与运行中的细节（RFC-022 步骤条、RFC-024 界面就绪）仍按名册，等名册的 lifecycle 在服务端由记录推导（§11.2）后再收。守卫用例按「只减不增」登记了按 CLI lifecycle 分支的存量文件，并禁止页面在内存里另记「刚关掉」。
>
> **实施补记（2026-09-24，第三期）**：健康卡直接读服务槽记录；发布页槽卡与单个项目的概览摘要不再只靠定时重读——共用 `shared/resources/useRecordRefresh`：项目里指定种类的记录一有变化就静默重读一次页面自己的数据（发布页看服务槽；概览看服务槽、开发会话、构建与迁移），第一次拿到记录时不重读，别的种类变化不重读。概览每 30 秒先核对身份再重读的节奏照旧（成员与角色的变化靠它，09-23 裁定），测试者读不到资源视图，不开推送流。项目列表页的摘要仍按 30 秒重读（每个项目一条推送流代价太大，等全平台视图，T13）。
- 命令行 `crewstation session show` 与 `crewstation status` 读同一视图。

## 11. 迁移与兼容

### 11.1 分期（B10，计划 §1）

1. 基础：契约、`resources`、`resource-runtime`、`cluster-control` 骨架、推送流；收编作业空跑（只报告）。
2. 任务类容器：工作区、Agent 执行、业务任务、工作卷、Secret、开发预览路由、额度推导、72 小时保留、孤儿回收；工作台开发页、拓扑、概览改读记录。
3. 服务槽与构建：槽、构建与迁移 Job；统一预检接入发布与重新部署；健康与发布页改读记录。
4. 路由与限流：槽路由、服务域与 `/api/<proxy>` 路由、说明页、同 Host 唯一、身份索引改读观测、限流策略与中间件、429 处理。
5. 命名空间、额度、网络策略；数据资源与数据访问绑定。
6. 集群管理与摘要改读台账；收编作业正式运行，处理全部遗留对象；D53 与各 RFC 回填。

> **实施补记（2026-09-23，第二期第一步）**：第二期先把台账接上真实数据，再移交执行，分两步走：
>
> 1. **投影**：task-runtime 在环境仓储落库的同一事务里，把每个环境投影成台账记录——开发工作区／业务任务工作区／Agent 执行各一条（记录 ID 沿用环境 ID，Agent 执行的上级就是父工作区），自带工作卷的再加一条 `volume`；领域条件 `Failed`、`Paused`、`Rebuilding`、`Prepared`（执行环境排队中为假）、`RunnerConnected`（从没连上不报，连上后断开才报假），启动进度原样；释放或执行环境清理即「不要了」。投影包在保存点里，台账写失败只回滚保存点、记一条告警，环境操作照常提交。每 5 分钟（与启动时）补投影一次：锁住环境行再读、再投影，部署前已有的会话由它第一次写进台账。这一步 Kubernetes 对象仍由 task-runtime 建删。
>    - 工作区直接释放时，受理那一步还说不出原因（释放完才写 `released: <原因>`），先报泛泛的 `released`；台账规定：已受理释放的记录，只有原来的原因码是 `released` 时才换成后来给的具体原因。
> 2. **按记录核对观测**：记录往往是在对象建好之后才声明的（投影、补投影、收编），观测事件不会再来一次。cluster-control 尾随变更日志（每秒一轮）、观测缓存同步后与此后每 10 分钟全量一次，把记录 ID 排进去重队列，按记录的期望去观测缓存里补观测：缓存里有的补在，缓存里没有而台账记着在的补消失。同样的观测（除观测时刻外无变化）不写库，否则核对会自己跟自己转圈。
> 3. **回收移交**（第二步）：建与删分开交。删除不需要凭据，先交给调和器：「不要了」的记录按 Pod、Secret、Service、路由的顺序删它还在的子对象（观测缓存里这个名字的实例，删除带那个实例的 UID；删除中的不重复删；系统命名空间里不带任务标签的平台组件不碰），PVC 只随工作卷记录删。task-runtime 自己的删除暂时保留（重复删除无害），创建与重建仍由它执行——调和器建带凭据的 Pod 与 Secret 时凭据放在哪是设计缺口，记为 [I25](../../../docs/engineering/implementation-open-questions.md#i25-调和器接手建任务容器时凭据放在哪)，等作者裁定再移交。
>    - 投影的子对象补齐到与 task-runtime 建出的名字一一对应：Pod；执行环境与重建过的工作区另有 Runner Secret（`<Pod 名>-runner`）；有开发预览的工作区另有预览 Service 与 IngressRoute（重建后沿用按环境 ID 算的原路由名）。观测缓存加上 Secret、Service、IngressRoute（Secret 的内容不进缓存）。
>    - **保留期从失败时刻起算**（D9）：第一步按「记录第一次进入失败」算，补投影进来的旧失败会话（09-21 就失败了）被重新计了 72 小时。现在所属模块报条件时可带发生时刻（task-runtime 报判失败那次落库的时间），台账只会把已记的起点往早改；保留到期按「失败」条件的起点每次重算。
>    - **到期之后**：资源中心的维护作业把记录改成「不要了」（retention-expired），调和器删容器与路由；工作卷不删，写上只归资源中心的条件「待回收」（PendingReclaim），按「已结束」算——持久卷的上级结束时同样处理，跟随容器的卷仍由所属模块随释放标成「不要了」。task-runtime 的补投影看到保留期满，把环境记为已释放（不自己删集群对象、不删卷）；这之前的恢复请求直接拒绝（「已过 72 小时保留期」）。
> 4. **孤儿回收**（第三步）：cs-controller 在观测缓存同步后 10 分钟起、每 10 分钟一轮，逐个核对带任务标签的 Pod、Secret、Service、路由与 PVC：建出满 10 分钟、台账里没有记录认领、它的任务环境已不在（已释放或查不到），或在台账里有记录却不列它（重建换下的旧 Runner Secret、RFC-013 改名前留下的同 Host 预览路由）的，是孤儿；任务环境还在而台账里还没有它的记录时不判（台账没跟上）。Pod、Secret、Service、路由按 UID 删；PVC 不删，由资源中心建一条自己名下的工作卷记录认领它并写「待回收」（原因 orphaned），等管理员确认。收编空跑用同一判定。
> 5. 此后：额度计数器退役、旧接口的 lifecycle 由记录推导（§11.2）。
>    - **额度经台账受理**（2026-09-24）：task-runtime 的额度收成一个端口——配了台账时，开发会话、业务任务、CLI／Agent／子任务执行、失败会话的重建与业务任务的恢复，都在自己的事务里经台账受理（`admit`：锁 `resources.project_locks`、按阶段数额度、够才声明工作负载记录），不够抛 `quota_exceeded`，文案照各入口原来的说法；释放、暂停、失败不再做减法，阶段离开占额度的集合额度就回来——结束中仍占（§3，D31），所以额度在容器真正回收完才空出来，而不是受理释放那一刻。已有记录再受理时，此刻占着额度的不再数（期望更新），此刻不占的（暂停后恢复、失败后重建）照新受理数，否则恢复会绕过额度；业务任务恢复被额度挡住时由 412 改为与其他入口一致的 `quota_exceeded`。受理不包保存点：台账出错就不受理；受理之后的投影仍包在保存点里，写失败只告警。`task_runtime.admissions` 只留作项目行锁（串行化同一项目的创建、释放、恢复）；它的计数只在没配台账时（用例、独立部署）与档位测试的平台并发上限里用，表留到第六期收编完成后再删。项目的已用额度（`runningTaskCount`）照台账数。
>
> **实施补记（2026-09-23，第三期第一步）**：服务槽照同一做法先投影、后移交。每个服务两条 `service-slot` 记录（蓝、绿两个物理槽，`ref` 为 `<服务 ID>/<物理槽>`），记录稳定、不随版本新建——同一个 Deployment 换版本时原地更新，台账里「不要了」的记录不能再声明，所以「此刻该不该有工作负载」不用期望的「不要了」，而用领域条件 `Serving`：尚未部署、下线（手动、回退目标到期、无人访问、集群管理删除）为假，阶段按已结束算（工作负载还在时是结束中），原因照写（D13）；流水线判部署失败是 `Failed`。子对象这一步只有 Deployment（槽的 Service 仍由 release 管，第三期后半与路由一起入账，那时说明页接替 `allowEmptyServices`）。阶段按 Deployment 的观测：新版本的副本都就绪是运行中，推进中是启动中，推进超时与副本为 0 是降级。release 在保存槽的同一事务里投影（保存点包着），每 5 分钟补投影一次；Deployment 的建删仍由 release 执行。
>
> **实施补记（2026-09-24，第三期第三步）**：槽的副本由槽记录认领（§6.5「第三期由对应记录认领」）。观测到 ReplicaSet 管的 Pod 时带上它所属的 Deployment（控制者 ReplicaSet 的名字去掉 `-<pod-template-hash>`，Kubernetes 的命名规则），对象本身没被认领就由认领那个 Deployment 的记录认领，作为观测到的子对象入账（不在期望里，消失即删去）；台账接上之前就在的副本在按记录核对时补上。崩溃重启不按单个 Pod 写：调和器每次核对槽记录时汇总这个 Deployment 名下的所有 Pod——各容器重启累计至少 3 次、最近一次退出在 10 分钟内（G22，与旧的健康判定一致）——写条件 `CrashLooping`，成立时约在最近一次退出满 10 分钟时再核对一次；成立期间槽记录是降级（原因 `crash-looping`），副本眼下都就绪也一样（§4.3）。Deployment 的观测带上期望与就绪副本数。旧的健康接口（`GET /v1/projects/:projectId/health`，概览与 MCP 的项目摘要也经它）与告警巡检改由槽记录推导（契约里的 `healthOfSlotRecord`），台账读失败或还没有这个槽的记录时退回按请求读集群；工作台的健康卡直接读项目资源记录、随推送流更新，不再请求 `/health`。视图缺省也列出稳定记录（种类注册表的 `stable`：服务槽每个服务两条，下线、尚未部署时按已结束算），已下线的槽才画得出来；已结束的一次性记录（会话、执行）仍缺省不列。子对象的上限随之放到 64（至多 20 个副本，换版本时新旧两批同时在）。
>
> **实施补记（2026-09-24，第三期第七步）**：构建与迁移 Job 进台账。release 在流水线启动 Job 时声明 `build-job`／`migration-job` 记录（`ref` 为 `<发布 ID>/build|migration`，子对象是那个 Job，展示字段是发布与版本；包在保存点里，写失败只告警）。资源中心观测 Job（Complete、Failed、Active、Pending），Job 管的 Pod 按控制者由记录认领；Job 结束时写只归资源中心的条件 `Finished`（成功或失败，带原因），阶段照它——Kubernetes 的 TTL 删掉 Job 与 Pod 之后记录仍是已结束或失败（提案 §5.1「TTL 之外台账记录结果」）。Job 还在跑是运行中，建了没跑起来是启动中（原因照它的 Pod，例如调度不上）。记录不随发布结束改成「不要了」：删 Job 交给 TTL，构建日志在 TTL 之前照常可读。形态图「构建与迁移」带的 Job 节点有记录时照记录的阶段。

### 11.2 旧接口

迁移期间旧接口保留、字段不删，值改由记录推导（提案 Q8）：例如 `GET /v1/tasks/:taskId/agent-terminals` 的 `lifecycle` 由阶段映射（§4.3），`stopRequested` 期间为 `running`，另加可选字段 `phase`；槽的 `state` 由槽记录映射。契约锁按「只增不删」处理，业务契约面不受影响。

> **实施补记（2026-09-23，第三期）**：槽的 `state` 先做到「就绪之后照台账」：部署流水线推进中（deploying）、槽为空、流水线已判失败时仍以流水线为准——期望刚变的那一瞬台账沿用旧版本 Deployment 的观测，会误报就绪；流水线判定就绪之后以观测为准：副本后来没全就绪（新版本已铺完而崩溃重启、探针失败，观测记 `Unready`）是 `degraded`，被重新铺开（运维重启）是 `deploying`，失败是 `failed`。发布页、概览与命令行读的都是这份 DTO。CLI 名册的 `lifecycle` 仍在工作台合并（§10 补记），服务端推导随后做。
>
> **实施补记（2026-09-24，名册）**：`GET /v1/tasks/:taskId/agent-terminals` 在服务端按台账推导：dev-session 经端口读这个工作区名下各执行记录的阶段（记录沿用执行环境的任务 ID），执行记录已结束就是 `ended`（Runner 报的 `failed` 照旧）、失败就是 `failed`；启动与运行中的细节（RFC-022 步骤、RFC-024 界面就绪）仍按 Runner，结束中仍报 `running`；每一项另带可选的 `phase`。读不到台账时照 Runner 的说法给出。工作台仍按推送流合并（记录比名册的重读更早到），两边的规则相同。
>
> **实施补记（2026-09-24，第三期第四步）**：槽 DTO 的副本数与状态同一规则——流水线判定就绪之后照 Deployment 的观测（副本后来崩溃、被缩容，槽卡照实写）。待命槽的保留计时（RFC-021）以条件 `RetentionDeadline` 进槽记录（原因是回退目标或待验证版本），到期时刻（按当前平台策略算）、周期、推迟次数与可推迟时的提醒时刻放在展示字段；访问推后到期（每个服务至多 5 分钟记一次）、推迟、提醒、改时长都让记录变化。发布页的槽卡不再每 5 秒轮询：服务槽记录随推送流一变就在原位重读槽的 DTO，回到前台补读照旧。概览的项目摘要还带着开发会话、发布与切流，仍按原来的节奏重读，随后再改。

## 12. 失败模式与并发

| 情形 | 处理 |
|---|---|
| 调和器在删除途中崩溃 | 租约过期后另一副本接手，从观测重新判断；删除带 UID 前置条件，不会误删同名新对象 |
| watch 断开或漏事件 | 书签续 watch；10 分钟全量 list 纠偏；台账侧 60 秒定时调和 |
| Kubernetes API 暂时不可用 | 阶段不变，条件 `Observed=unknown`，界面写明「集群观测暂不可用」，不把资源判成失败 |
| 所属模块写期望与调和并发 | 期望带代数；调和按读到的代数执行，完成后写 `observedGeneration`；期间期望又变则再排一次 |
| 两个请求同时抢最后一个额度 | 项目行锁串行，后到的拒绝（D31） |
| 同 Host 两条路由（迁移中） | §7.1 的优先级规则，被压下的立即摘除 |
| 推送尾随器落后 | 有界缓冲溢出发 `reset`，客户端改读快照；不阻塞写入 |
| 数据库不可用 | 受理与调和都停；已运行的工作负载不受影响（调和器不做「不知道就删」） |
| 时钟偏差 | 保留期、租约用数据库时间（`now()`），不用进程时间 |

## 13. 性能与规模

设计目标（非实测）：全公司数百个数字人、数百个节点，每个数字人两槽、若干任务。

- 观测缓存按种类只缓存受管对象，Pod 字段按需裁剪（只留标签、状态、节点、UID、容器状态）。
- `changes` 每次写一行；24 小时保留；按 `seq` 顺序读，索引 `(seq)`、`(project_id, seq)`。
- 推送按项目分发；每个 cs-api 副本一个尾随器，与连接数无关。
- 规模与 HA 在 M6 一次验证（接受的风险不变）；T16 在本机做两副本的租约与接手核对。

## 14. 测试策略

| 层 | 内容 |
|---|---|
| 单元（纯函数） | 各种类的阶段规则、旧词汇映射（§4.3 逐行）、保留期到期判定、同 Host 路由取舍、额度推导、可做操作的前置条件、SSE 帧编码与续传判定 |
| 模块（真实 PostgreSQL） | `resources`：受理事务、额度并发（两个事务抢最后一个单位）、代数与 `observedGeneration`、`changes` 连续性、压缩；`cluster-control`：用假 Kubernetes 客户端跑建、改、删、孤儿回收、UID 前置条件、租约抢占与接手；`data-control`：用测试库建删库与授权 |
| 工作台 | `useProjectResources` 的快照、增量、续传、`reset`；开发页 × 之后「结束中」、离开再回来不重现；拓扑只吃记录；429 自动重读与写请求不重发；说明页不依赖工作台 |
| 实机（e2e） | 提案 §13 的 RC-01…RC-15；限流用突发脚本；多副本用两个 cs-controller |
| 守卫 | 页面不自行推导资源状态（§10）；领域模块不再 import `packages/k8s` 写集群（`tools/arch` 新规则，读只允许经 `resources`） |

## 15. 偏离与债

- **D53 修订**（C6）：「原模块保留生命周期与期望配置所有权」改为「原模块保留期望与领域规则，生命周期实况由资源中心持有」；ADR-0006 与 RFC-010 同步修订。回填基线时新增决策号与需求号。
- **RFC-022 的归属变化**：启动进度的容器阶段推导（`podStartup`）从 `task-runtime` 移入 `cluster-control`，契约与阶段不变；CLI 的领域阶段仍由 dev-session 组合并经条件上报。
- **RFC-021**：`allowEmptyServices` 与「preview 路由一直在」的描述作废，改为说明页（D13）。
- **RFC-010／RFC-015**：集群盘点不再自己采集 Pod、Deployment 等受管对象（改读观测缓存）；节点与用量（RFC-015 的 Prometheus 数据）仍由它自己采集。
- **task-runtime 缩小**：交出大部分集群适配器后，模块内以 TaskRunner 协议与执行规则为主；缩小后的结构文档条目随实施更新。
- 本 RFC 不处理：`crewstation-system` 里平台组件的生命周期（安装器负责，M6）。
