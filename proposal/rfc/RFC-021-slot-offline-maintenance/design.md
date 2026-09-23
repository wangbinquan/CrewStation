# RFC-021｜技术设计

> 状态：Done · 2026-09-23 · 作者裁定见 [提案](./proposal.md) §4；实施补记见 §14，验收见 [acceptance.md](./acceptance.md)
> 配套：[提案](./proposal.md) · [计划](./plan.md)

## 目录

- [1. 现状与落位](#1-现状与落位)
- [2. 待命槽的生命周期](#2-待命槽的生命周期)
- [3. 自动下线：计时、提醒、推迟](#3-自动下线计时提醒推迟)
- [4. 重新部署](#4-重新部署)
- [5. 正式版本维护](#5-正式版本维护)
- [6. 三类流量的执行点](#6-三类流量的执行点)
- [7. 破坏性迁移窗口](#7-破坏性迁移窗口)
- [8. 契约与接口](#8-契约与接口)
- [9. 工作台](#9-工作台)
- [10. 删除的能力](#10-删除的能力)
- [11. 失败模式与并发](#11-失败模式与并发)
- [12. 测试策略](#12-测试策略)
- [13. 偏离与债](#13-偏离与债)
- [14. 实施补记（2026-09-23）](#14-实施补记2026-09-23)

## 1. 现状与落位

按 [repository-structure.md](../../../docs/engineering/repository-structure.md) 落位，源码基线 `d8cdeec`。现状见提案 §2。

模块规模：`release` 已有 **38 个生产文件**，接近结构规则 §11 的 40 个上限。本 RFC 给它只加两个文件：`domain/slotLifecycle.ts` 放纯规则，`application/slotLifecycle.ts` 放用例。表、仓储、路由、工作器都扩进已有文件。正式版本维护是网关的放行规则，放进 `gateway`（19 个文件）。不新增模块、不改层级，不需要 ADR。

| 落点 | 责任 |
|---|---|
| `packages/contracts/api/release.ts` | 槽的 `retention`／`offline` 可选字段，`ReleaseDto.redeployable`，下线、推迟、重新部署三个请求，`SlotEventDto`，自动下线策略 |
| `packages/contracts/api/maintenance.ts`（新） | 维护的三个开关、`MaintenanceDto`、`SetMaintenanceRequest`、`ExitMaintenanceRequest`、维护记录与视图 |
| `packages/contracts/events/topics.ts` | `ReleaseStatus` 增加 `offline`；新主题 `gateway.maintenance-changed` |
| `packages/contracts/events/delivery.ts` | `DeliveryState` 增加 `held` |
| `packages/contracts/api/market/appListing.ts` | `MarketAppDto.maintenance` 可选 |
| `packages/contracts/api/project.ts` | `ProjectState` 删去 `paused` |
| `modules/release`（L4） | 下线、推迟、重新部署、自动下线巡检、访问记录、策略；RFC-010 的槽删除改走同一个下线动作；破坏性迁移改看项目维护 |
| `modules/gateway`（L5） | 维护状态与记录、放行判定（用户域入口与服务域调用）、给其他模块的只读查询、领域事件 |
| `modules/identity`（L1） | ForwardAuth 在 prod／preview 主机上询问入口状态（端口），返回维护页／未部署页（503） |
| `modules/events`（L3） | 投递前询问是否暂存（端口）；暂存与补发 |
| `modules/project`（L2） | 两个新动作 `manage-slots`、`manage-maintenance`（负责人＋管理员）；删除 `paused` |
| `modules/capabilities`（L6） | 市场卡片的维护标注 |
| `modules/cluster-management`（L6） | 槽删除的影响文案改为「下线」 |
| `modules/platform` | 按端口接线：release↔gateway、identity→gateway、events→gateway、capabilities→gateway，只接线不放逻辑 |
| `packages/settings` | 删除 `maintenanceWindow` |
| `packages/api-client` | 新接口的客户端方法 |
| `apps/console` | 发布页、概览版本卡、时间线、市场卡片、平台设置页、事件页的暂存状态；去掉 `paused` |

低层需要高层信息的地方全部用端口，由组合根接线（结构文档 §4.3）：`release` 问「项目是否处于完整维护」（L4→L5），`identity` 问「这个入口能不能进」（L1→L5），`events` 问「这个订阅方是否暂存」（L3→L5），都在各自的 `ports/` 里声明。

## 2. 待命槽的生命周期

`SlotState`（`release.service_slots` 的 `blue`／`green` JSON 列）新增两个可选字段，**不需要改表**：

```ts
type OfflineReason = 'manual' | 'rollback-expired' | 'idle' | 'cluster';
interface SlotRetention {            // 只在「有工作负载的待命槽」上
  kind: 'rollback-target' | 'pending';
  since: Date;                       // 计时起点：切流时刻／就绪时刻／升级后首次巡检（M26）
  lastAccessAt?: Date;               // 仅 pending 用：preview 最近一次访问
  postponedUntil?: Date;             // 推迟后的绝对到期时间
  postponements: number;             // 推迟次数（展示用）
  remindedAt?: Date; remindedFor?: Date;   // 已为哪一个到期时间发过提醒
}
interface SlotOffline { releaseId: ReleaseId; at: Date; reason: OfflineReason; actorUserId?: UserId; workloadRemoved: boolean }
```

状态迁移（纯函数，`domain/slotLifecycle.ts` 与 `domain/slots.ts`）：

| 事件 | 待命槽变化 | 发布记录变化 |
|---|---|---|
| 发布／重新部署开始部署到待命槽 | `releaseId` 换新，`state: deploying`，清掉 `offline` 与 `retention` | 原待命版本 `ready → superseded`（既有） |
| 部署就绪 | `state: ready`，`retention = { kind: 'pending', since: 就绪时刻 }` | `→ ready`，首次就绪记 `pipeline.readyAt` |
| 切流 | 新待命槽（原正式槽）`retention = { kind: 'rollback-target', since: 切流时刻 }`；新正式槽清掉 `retention` | — |
| 下线（手动、到期、集群管理） | `state: empty`，副本 0，去掉 `releaseId` 与 `retention`，写 `offline` | `ready → offline` |

`offline` 只存在于待命槽：切流要求目标槽就绪，已下线的槽不可能成为正式槽。旧库里被 RFC-010 删除过的非正式槽（`state: empty` 却还带 `releaseId`）在读取时归一成 `offline { reason: 'cluster' }`（`normalizeLegacySlot`，纯函数，不需要数据迁移）。

发布状态机（`domain/release.ts`）：`ready → superseded | offline | deploying`，`superseded → deploying`，`offline → deploying`，`failed → deploying`（只有首次就绪过的版本才允许，由用例检查 `pipeline.readyAt`）。`deploying` 之后照旧 `ready | failed`。`createdAt` 不变，因此切流里「目标早于当前版本即为回退」的判断（`switchTraffic.ts:28`）对重新部署的版本仍然成立。

下线动作（`application/slotLifecycle.ts`）：

1. 事务内锁住服务的槽行（`drizzleSlotRepository` 的 `FOR UPDATE`）。校验：有待命槽且上面有工作负载；`releaseId` 等于请求里的 `expectedReleaseId`；没有进行中的发布；没有进行中的集群运维操作。然后写槽、写发布状态、写一条 `slot_events` 记录。
2. 提交后删除 Deployment：`SlotDeployer.removeWorkload(namespace, service, physical, releaseId)`，只在 Deployment 的 `crewstation.io/release` 标签等于被下线的版本时删除，删成功后把 `offline.workloadRemoved` 置真。Service 与路由保留。
3. 删除失败不回滚数据库：巡检（§3）会对 `workloadRemoved = false` 的槽重试。按标签比对保证不会误删之后新部署上来的工作负载。

RFC-010 的槽删除（`application/slotMaintenance.ts` 的 `observeSlotOperation`）在 Deployment 确认消失后改用同一个 `takeSlotOffline`，原因记 `cluster`，操作人取 `ClusterOperation.actorId`。

## 3. 自动下线：计时、提醒、推迟

策略存一行，放在 `release.offline_policy`，默认值来自 M12、M22：

```ts
interface OfflinePolicy { rollbackRetentionHours: 72; idleOfflineDays: 14; reminderLeadHours: 24 }
```

到期时间按当前策略即时计算，所以管理员改了时长会立刻作用于所有项目：

```
rollback-target: deadline = max(since + R,               postponedUntil)
pending:         deadline = max(since + I, lastAccessAt + I, postponedUntil)
```

提醒与下线（`retentionStep`）：

- 已经为**当前** `deadline` 发过提醒（`remindedFor == deadline`），并且 `now ≥ max(deadline, remindedAt + lead)` → 下线。
- 还没为当前 `deadline` 发过提醒，并且 `now ≥ deadline − lead` → 发提醒。
- 否则什么都不做。

因为下线前必须先有一次至少提前 `lead` 的提醒，调短时长、访问改变到期时间，都不会不经提醒就下线（B3）。

推迟（M19、M23）：`postponedUntil = 当前 deadline + 一个周期`（回退目标 R，待验证版本 I），推迟次数加一，清掉提醒。请求带 `expectedDeadline`，页面上的到期时间过期时拒绝，避免连点两次推迟两个周期。

> **2026-09-23 修订（作者当面裁定，见提案 §4 末）：提醒发出之后才能推迟。** `canPostpone(retention, policy)`＝已为**当前** `deadline` 发过提醒（`remindedFor == deadline`，与槽 DTO 带 `remindedAt` 同一个条件），也就是到期前 `lead` 起、由巡检发出提醒之后。`SlotRetentionDto` 加必填的 `postponable`，由服务端按这条规则算好；工作台据此显示「推迟 72 小时下线」／「推迟 14 天下线」，不再一直显示。`postponeOffline` 在核对 `expectedDeadline` 之后按同一条规则拒绝（412：「还没到可以推迟的时候：到期前 N 小时提醒负责人之后才能推迟」）。推迟清掉提醒、到期后移，于是连点只有第一次生效；访问推后到期或管理员改了时长，旧提醒不再算数，要等新到期时间的提醒。巡检没发提醒时（进行中的发布或集群运维操作期间跳过）不能推迟，也不会下线。

访问记录（B2）：identity 的 ForwardAuth 放行 preview 请求后，经 gateway 调 `release.notePreviewAccess(serviceId)`。release 在进程内对每个服务最多每 5 分钟写一次库，写的是待命槽的 `lastAccessAt`。回退目标也记录访问时间，但不参与它的计时。

巡检（`sweepSlotLifecycle`）在 cs-controller 每 60 秒跑一次（与开发会话空闲提醒一样挂在 wiring 的定时器上）：

1. 读全部槽行与策略。
2. 对每个服务的待命槽：`state: empty` 且 `offline.workloadRemoved = false` → 重试删除工作负载。
3. 有进行中的发布或集群运维操作 → 跳过。
4. 有工作负载但还没有 `retention`（升级前就存在的槽）→ 以本次巡检时刻为 `since` 补上（M26）。`kind` 这样判断：最近一次切流的 `previousReleaseId` 等于这个槽上的版本，就是回退目标，否则是待验证版本。
5. 按 `retentionStep` 发提醒或下线。每一步都在自己的事务里重新锁行、重新校验（版本、计时起点都没变）后才写，所以多个 cs-controller 副本同时跑也只会生效一次。

提醒（B9）：写 `remindedAt`／`remindedFor` 和一条 `reminder` 记录，再经 `SlotNotifier` 通知负责人。组合根里这个端口与开发会话一样只写日志，渠道仍是 Q20。发布页与概览从槽的 `retention.remindedAt` 与 `deadline` 读出提醒并显示。

## 4. 重新部署

`POST /v1/releases/:releaseId/redeploy`，只限负责人与管理员（M10、M9）。

可以重新部署的版本：有镜像与 Manifest；首次就绪过（`pipeline.readyAt`）；现在不在任何槽上；状态是 `superseded`、`offline`、`failed`，或者旧数据里不在槽上的 `ready`。`ReleaseDto.redeployable` 由服务端算出，工作台据此显示按钮。

用例步骤：

1. **预检**（不写库）：服务套餐仍在且副本不超上限；算力档位没有问题（复用 `pipelineDeploy.ts` 的 `computeProblem`）；生产配置齐全（`renderSlotEnv`，按当前生产配置渲染，B4）。兼容检查：当前正式版本含破坏性迁移或 `rollback: blocked`，并且要重新部署的版本早于它 → 拒绝，与切流的回退规则同一句话。
2. **事务**：锁槽行；确认待命槽上的版本等于请求里的 `expectedStandbyReleaseId`（`null` 表示确认时待命槽为空）；没有进行中的发布与集群运维操作；这个版本不是正式槽上的版本。然后把发布推到 `deploying`（`targetSlot` 改为当前待命槽，`deployStartedAt` 记当前时间）；原待命版本若是 `ready` 就推到 `superseded`；待命槽写成 `deploying`；写一条 `redeploy` 记录。
3. **提交后**：`SlotDeployer.deploy`（与发布同一个适配器，镜像取发布记录里的 `image`），更新 `configVersion`，入队流水线轮询。之后走既有的 `pollDeploy → registerReady`：就绪后重新发布 `release.registered`，于是订阅、接口目录与任务契约跟着「最近一次就绪的版本」走，与发布一致。部署失败走既有的失败路径（发布 `failed`、槽 `failed`），这个版本仍可再次重新部署。

不产生构建 Job，也不产生迁移 Job（SM-03）。

> **2026-09-23 修订（作者实机报「部署待验证版本报内部错误」，当面裁定处理方式）。** 预检的第一项改为「发布记录里的 Manifest 仍符合当前平台的写法」（`prepareSlotDeploy` 按当前 `ManifestSchema` 校验）。平台之后收紧了写法的旧版本——本机是 RFC-001 之前的 `agentProfiles` 只写 `driver`／`model`、没有 `compute`（demo v0.1.2／v0.1.3 等 4 个）——照常算作可重新部署、出现在版本下拉里；确认时预检拒绝（412），原因写明哪里不合法、该怎么改（`describeManifestFailure`），并说明发布记录里的 Manifest 随标签固定，要改好仓库里的 `crewstation.yaml` 后发布新版本。此前这类版本在 `computeProblem` 读 `compute` 时抛错，接口返回 500。

## 5. 正式版本维护

gateway 新表 `gateway.service_maintenance`（每个服务最多一行，行存在就表示在维护中）与 `gateway.maintenance_events`（进入、调整、退出的记录）。

```ts
interface Maintenance {
  serviceId; projectId;
  switches: { users: boolean; services: boolean; events: boolean };   // M7
  allowUserIds: UserId[];            // 维护时临时指定的人，最多 100（M4）
  reason: string;                    // 必填，1–500 字（B1）
  expectedEndAt?: Date;              // 选填
  startedBy; startedAt; updatedBy; updatedAt; revision;
}
```

- **进入／调整**：`PUT /v1/services/:serviceId/maintenance`，带 `expectedRevision`（不在维护中时为 0）。权限 `manage-maintenance`（负责人、管理员）。一个事务里写状态、写记录、发 `gateway.maintenance-changed`（outbox）。
- **退出**：`POST /v1/services/:serviceId/maintenance/exit`，带 `expectedRevision`。删除这一行（临时指定的人随之清空），写记录，发事件。
- **读取**：`GET /v1/services/:serviceId/maintenance` 返回当前状态与最近 50 条记录，权限 `view`（负责人、开发者、管理员）。工作台按当前用户是否负责人或管理员决定显示操作按钮（M8）。
- **切流**：维护按服务存，不按物理槽存，所以切流后维护还在（M18）。

判定用的纯函数（`domain/maintenance.ts`）：

| 函数 | 规则 |
|---|---|
| `admitsUser(m, userId, isMemberOrAdmin)` | 用户流量开关关着，或者这个人是项目成员（负责人、开发者、测试者）或平台管理员，或者在临时指定名单里（M4） |
| `blocksServiceCall(m, callerIdentity, target)` | 服务域开关开着，并且调用方的服务身份不等于目标服务（M25）；平台自身工作负载在更前面就已放行（`allowlistEvaluation.ts:20`） |
| `holdsEvents(m)` | 事件开关开着 |
| `fullWindow(m)` | 在维护中，并且三个开关都开着（M17） |
| `retryAfterSeconds(m, now)` | 有预计恢复时间且在未来时，取距离它的秒数（最少 60 秒） |

放行判定每个请求都要用，所以 gateway 进程内缓存「当前所有维护中的服务」3 秒（`activeMaintenances`）。缓存里同时带上服务名、服务身份、proxy 名，用来匹配服务域的目标。改动后最多 3 秒生效。破坏性迁移的检查（§7）不走缓存，直接读库。

## 6. 三类流量的执行点

| 流量 | 执行点 | 被拦时 |
|---|---|---|
| 用户流量（prod 主机） | cs-auth 用户域 ForwardAuth：`forwardAuthUser` 在会话与成员检查之后，调端口 `ServiceEntry.check(userId, slug, 'prod')`；组合根把它接到 `gateway.api.userEntry` | 浏览器导航：503 维护页，显示原因与预计恢复时间，并带「返回工作台」；其他请求：503 JSON `{ error: 'maintenance', message, details: { reason, expectedEndAt } }`；有预计时间时加 `Retry-After` |
| 服务域调用 | cs-auth 服务域 ForwardAuth 调 `gateway.evaluate`；放行表判定通过之后，再按目标（`service:<name>` 或 `proxy:<proxy>`）找维护中的服务，按 `blocksServiceCall` 判定 | 503 JSON `{ error: 'maintenance', … }`；来源令牌不签发 |
| 事件推送 | cs-events 投递 worker：`deliverEvent` 在开始一次尝试**之前**问端口 `DeliveryHold.holds(serviceId)` | 投递状态记为 `held`（维护暂存），不加尝试次数，队列任务正常完成 |

preview 主机（B6）：同一个 `ServiceEntry.check(userId, slug, 'preview')`。待命槽没有工作负载时，返回 503「未部署待验证版本」页（写明何时因何下线、下线的版本号）；有工作负载时记一次访问（§3）并放行。

暂存事件的补发（B5）：

- 触发：`gateway.maintenance-changed` 事件，并且 `active && holdEvents` 不再成立；另有 cs-events 每 30 秒一次的兜底巡检，处理切换瞬间的竞态和漏掉的事件。
- 做法：把该服务所有 `held` 投递按创建时间（即事件接收顺序）逐条改回 `pending`，重新入队，`runAt` 依次递增 1 毫秒。队列按 `run_at` 认领（`packages/queue/jobs.ts:48`），所以按原顺序进入投递。之后的并发、退避与死信规则不变。

`EventDelivery` 信封（业务契约面）不变：业务仍然只看到 `attempt`，暂存期间它不增加。

## 7. 破坏性迁移窗口

`ReleaseSettings.maintenanceWindow` 删除，换成端口 `MaintenanceWindow.open(serviceId)`，由组合根接到 `gateway.api.fullWindow(serviceId)`（直接读库）。

- **部署**：`pipelineBuild.ts` 读完 Manifest 后，`assertMigrationAllowed(spec, await maintenance.open(serviceId))`。拒绝原因改为说清出路：「含破坏性迁移的版本只能在项目维护期间发布：请负责人进入维护，并拦住用户流量、服务域调用与事件推送」。
- **切流**（M27）：`switchTraffic` 的目标版本 Manifest 声明了 `destructive: true` 时，同样要求 `open`，否则拒绝并给出同样的出路。回退限制（`rollbackBlockedBy`）不变。

## 8. 契约与接口

新增或改动的 HTTP 接口：

| 方法与路径 | 谁 | 语义 |
|---|---|---|
| `POST /v1/services/:serviceId/slots/preview/offline` `{ expectedReleaseId }` | 负责人、管理员 | 下线待验证版本；返回两个槽 |
| `POST /v1/services/:serviceId/slots/preview/postpone` `{ expectedDeadline }` | 负责人、管理员 | 推迟一个周期；为当前到期时间发过提醒之前 412（2026-09-23 修订）；返回两个槽 |
| `POST /v1/releases/:releaseId/redeploy` `{ expectedStandbyReleaseId: id \| null }` | 负责人、管理员 | 重新部署到待命槽（202） |
| `GET /v1/services/:serviceId/slot-events` | `view` | 下线、重新部署、推迟、提醒记录（最近 50 条） |
| `GET`／`PUT /v1/admin/settings/auto-offline` | 管理员 | 三个时长；`PUT` 带 `expectedRevision`，校验提醒时间短于两个周期 |
| `GET /v1/services/:serviceId/maintenance` | `view` | 当前维护与记录 |
| `PUT /v1/services/:serviceId/maintenance` | 负责人、管理员 | 进入或调整维护 |
| `POST /v1/services/:serviceId/maintenance/exit` `{ expectedRevision }` | 负责人、管理员 | 退出维护 |

错误约定沿用平台：未登录 401；非成员 404（项目不暴露）；成员但没有这个动作的权限 403；Schema 不合 400；前置条件不满足 412；版本冲突 409。

契约变化（全部是工作台／CLI 自己消费的形状，不在业务契约金样里）：`SlotDto` 加可选的 `retention`（`deadline` 由服务端按当前策略算好；2026-09-23 修订加必填的 `postponable`）和 `offline`；`ReleaseDto` 加 `redeployable`；`ReleaseStatus` 加 `offline`；`DeliveryState` 加 `held`；`MarketAppDto` 加可选的 `maintenance { reason, expectedEndAt?, blocked }`；`ProjectState` 去掉 `paused`。新请求一律 `.strict()`。

## 9. 工作台

| 位置 | 内容 |
|---|---|
| 发布页正式版本卡 | 维护中时显示「维护中」角标、三个开关的状态、原因、预计恢复时间、临时指定的人；负责人和管理员看到「进入维护」／「调整」／「退出维护」。表单用行内面板：三个开关默认全开，原因必填，预计恢复时间选填，临时指定的人用已注册用户查询（现有 `member-candidates` 接口，组件从 `features/projects` 移到 `shared/project/`，两个功能共用） |
| 发布页待验证卡 | 「将于 X 自动下线（回退保留期／无人访问）」；提醒已发出时显示提醒时间；负责人和管理员看到「下线」（行内确认，写清不可恢复，只能从发布记录重新部署），提醒发出之后（`postponable`）还有「推迟 72 小时下线」／「推迟 14 天下线」（2026-09-23 修订：此前一直显示，文案是「推迟 72 小时」）；已下线时显示「已下线 vX · 原因 · 时间」；空着（已下线或尚未部署）且有可重新部署的版本时，主按钮是「部署版本…」，打开重新部署确认并默认选刚下线的版本（2026-09-23 修订：此前只有「重新部署 ＜刚下线的版本＞」，见提案 §4 末） |
| 发布记录与时间线 | 可重新部署的版本有「重新部署」（确认：第一行是版本下拉，预选这个版本，可改选其他可重新部署的版本，新到旧；写清替换待命槽上的哪个版本、不重新构建、不重跑迁移、按当前生产配置。2026-09-23 修订：加版本下拉；确认同日随全站裁定改为弹窗）；时间线合并下线、重新部署、推迟、提醒，以及进入、调整、退出维护，带人名 |
| 概览的两张版本卡 | 与发布页同一组件：维护角标、下线状态、到期提示 |
| 市场卡片 | 「维护中」角标与原因；被拦的人没有打开入口 |
| 管理空间「平台设置」`/admin/settings`（M28、B10） | 左栏末尾新分组「平台」；「自动下线」卡：三个时长，保存带版本号，校验提醒时间短于两个周期 |
| 事件投递页 | 新状态「维护暂存」 |
| 项目列表、管理目录 | 状态筛选去掉「暂停」 |

所有新文案中英文都有（`i18nParity`）；按钮、确认、表单复用 `shared/ui`（开发规则 §7）。

> **2026-09-23 修订（作者裁定，直接修改＋回填，不另立 RFC；表单与确认改弹窗）。** 上表「表单用行内面板」的维护表单改为弹窗 `MaintenanceDialog`（进入与调整共用）：取消、✕、Esc 只关窗，草稿留在发布页上，再点同一种（进入／调整）恢复，「清空」按此刻的维护状态重起一份；关窗期间别人进入或退出了维护就按此刻重起。重新部署确认是 `RedeployDialog`。平台设置「自动下线」卡的「修改」打开弹窗，三个时长常驻卡上；改过的输入关窗保留、「清空」回到当前时长，没改过的再打开按此刻读到的值重起，改过就进离开确认。待验证卡的「下线」仍是一行式行内确认（`InlineConfirm`）。

## 10. 删除的能力

对应提案 §6 能力影响清单：

1. `packages/settings/platformSettings.ts` 的 `maintenanceWindow` 与 `CS_MAINTENANCE_WINDOW`；`ReleaseSettings.maintenanceWindow`；用例里的 `maintenanceWindow: false`。
2. `ProjectStateSchema` 的 `paused`、`project.ts` 状态机里的 `paused`、工作台两处筛选、生命周期卡的 `paused`、`projects.state.paused` 文案、`appMarket` 用例夹具；基线的暂停项目接口与条目。
3. 与 4. 是新行为（自动下线），不删代码。

## 11. 失败模式与并发

| 情况 | 处理 |
|---|---|
| 下线写库成功、删 Deployment 失败 | 槽显示已下线；巡检按 `workloadRemoved = false` 重试；只删 `release` 标签匹配的 Deployment |
| 下线与发布同时进行 | 都要锁槽行；下线遇到进行中的发布拒绝；发布遇到已下线的待命槽照常部署（清掉 `offline`） |
| 两次点击「推迟」 | 第二次的 `expectedDeadline` 已过期，拒绝；页面重读后确认值是新的，但新到期时间还没提醒，同样拒绝（2026-09-23 修订） |
| 多个 cs-controller 副本同时巡检 | 每一步都在事务里重新锁行、重新校验，只生效一次 |
| 重新部署时配置缺键、套餐被收回 | 预检拒绝，发布记录不变 |
| 重新部署时部署失败 | 发布 `failed`、槽 `failed`，可以再次重新部署 |
| 维护缓存 3 秒 | 进入、退出后最多 3 秒生效；破坏性迁移检查不走缓存 |
| 退出维护的事件丢失，或补发时恰好又进入维护 | cs-events 每 30 秒兜底：只补发当前不暂存的服务；补发前逐条检查 |
| 维护页上的预计恢复时间已过 | 照常显示原时间并注明「已超过预计时间」，不自动退出维护 |
| 进入维护时临时指定的人不存在 | 400，逐个说明 |

## 12. 测试策略

| 层 | 内容 |
|---|---|
| 契约 | 新 Schema 的正向解析、`strict` 拒绝未知键、策略的交叉校验、`ReleaseStatus`／`DeliveryState` 新值、`ProjectState` 不再接受 `paused` |
| 单元（纯函数） | `domain/slotLifecycle.ts`：两种到期计算、推迟、访问、提醒与下线的判定（含调短时长、提醒之后访问）、旧槽归一、下线迁移；`domain/release.ts` 新迁移；`domain/maintenance.ts` 的五个函数；`migrationPolicy`；事件投递的暂存与释放 |
| 模块（真实 PostgreSQL） | `release`：下线、推迟、重新部署（含拒绝分支：权限、状态变化、进行中的发布、兼容规则、配置缺键）、巡检（提醒、下线、升级补计时、跳过进行中）、访问记录节流、策略读写与校验、HTTP 成功／401／403／404／400；RFC-010 槽删除走下线；破坏性迁移在部署与切流两处的拒绝与放行。`gateway`：维护的进入、调整、退出、版本冲突、记录、领域事件；用户域入口判定（五类身份与临时指定、开关关闭）；服务域判定（其他服务 503、自身与平台放行、proxy 前缀）；HTTP 四类错误。`identity`：维护页、未部署页、503 JSON 与 `Retry-After`；服务域 503。`events`：暂存不加尝试、补发顺序、兜底巡检、退出事件触发。`capabilities`：市场维护标注与 `blocked` |
| 工作台 | 发布页的维护表单（校验、开关、指定的人）、调整与退出；待验证卡的下线确认、推迟、到期与提醒显示；重新部署的确认；时间线合并；市场卡片；平台设置页；事件页暂存状态；四态与中英文 |
| 实机 | 按提案 §7 SM-01…SM-18，用五个身份在本机集群核对；e2e 增加平台设置页与维护入口的用例（CI 没有 GitLab 时，项目相关用例按既有闸门跳过） |

## 13. 偏离与债

- 访问记录经 gateway 转到 release（L5 → L4 的端口调用）。两层之间的方向是允许的，但这是 gateway 头一次「写」release 的数据（只写访问时间）。好处是 identity 只需要一个端口。
- 提醒的送达仍然只到日志与工作台（Q20 未定），与开发会话空闲提醒相同。
- 正式槽从未上线时，prod 地址的表现（网关报错）不在本 RFC 范围。
- 事件补发按接收顺序重新入队，之后与平时一样并发投递，不保证严格串行。

## 14. 实施补记（2026-09-23）

实机验收（[acceptance.md](./acceptance.md)）中发现、当天修复的四处实现缺口，不改变任何裁定：

| 缺口 | 现象 | 处理 |
|---|---|---|
| 未部署页依赖网关先执行 ForwardAuth | 待命槽下线后 Service 没有 endpoint，Traefik 默认丢掉整条路由、回裸 404，§6 的未部署说明页（B6）出不来 | Traefik 加 `--providers.kubernetescrd.allowEmptyServices=true`（`deploy/k8s/system/32-traefik.yaml`，80c4e1b）；只是还没就绪的服务由 404 变为 503 |
| 下线认不出 RFC-013 之前的工作负载 | Deployment 标签是旧 `rel_…` ID，`removeWorkload` 只认 UUID，槽记已下线而 Pod 一直在跑 | 按 UUID 与 `legacyResourceId` 一起匹配；标签属于别的版本时仍不删（2e2600b） |
| 默认开放不立即生效（既有缺陷，SM-10 撞见） | `setOpenPolicy` 不发事件，放行表要等无关的重算 | 同一事务发 `api-catalog.open-policy-changed`，网关据此重算（56ff345） |
| 服务域调用方认错（既有缺陷，SM-10 撞见） | Pod 身份索引不清 watch 断开期间删掉的 Pod，IP 被复用时认成死去的平台 Pod | 全量重列后把没刷新到的在册行标为删除（692207c） |

