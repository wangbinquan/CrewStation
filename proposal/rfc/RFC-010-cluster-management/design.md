# RFC-010｜技术设计

> 状态：Done；实现与实机验收完成，范围裁定见 [proposal.md](./proposal.md)，发布证据见 [acceptance.md](./acceptance.md)
> 日期：2026-09-20；设计前的源码核对见 [audit.md](./audit.md)，实施结果见第 10 节与 [验收记录](./acceptance.md)

## 目录

- [1. 模块与数据边界](#1-模块与数据边界)
- [2. 受管资源范围](#2-受管资源范围)
- [3. 用途与归属解析](#3-用途与归属解析)
- [4. 采集、数量与状态](#4-采集数量与状态)
- [5. 查询接口](#5-查询接口)
- [6. 操作接口与执行](#6-操作接口与执行)
- [7. 各类操作语义](#7-各类操作语义)
- [8. 前端交互与失败模式](#8-前端交互与失败模式)
- [9. 测试策略](#9-测试策略)
- [10. 实施记录](#10-实施记录2026-09-20)

## 1. 模块与数据边界

按 [repository-structure.md](../../../docs/engineering/repository-structure.md) 的 L6 聚合原则与标准模块模板，
采用 [ADR-0006](../../../docs/adr/0006-cluster-management-module.md) 的 `cluster-management`。

| 落点 | 责任 |
|---|---|
| `modules/cluster-management/domain/` | 归属、用途、状态归一化、工作负载计数、动作能力与操作状态机；纯函数 |
| `application/` | 采集用例、快照查询、动作检查／受理／观察／恢复 |
| `ports/` | 资源读取与受控写入、快照／操作仓储、项目／任务／发布／系统目录、领域动作 |
| `adapters/k8s/` | API 对象投影、分块读取、UID 校验、受控 patch／delete、事件与日志 |
| `adapters/persistence/` | `cluster_management` 的源批次、资源投影、检查记录、操作记录与迁移 |
| `http/`、`workers/` | 管理端协议；有界采集与持久化动作执行，复用 queue 租约与 fencing |
| `packages/k8s` | 显式 ResourceRef、listPage、带前置条件的 patch、日志 previous；不含 CrewStation 归属规则 |
| `packages/contracts/api/cluster/`、`packages/api-client/resources/cluster.ts` | 请求／响应 Zod Schema 与类型化客户端 |
| `modules/project`、`task-runtime`、`release` 等 | 各自的批量元数据投影、领域动作及其原状态／配额／事件 |
| `modules/platform/wiring.ts` | 注入端口、挂 HTTP／worker／迁移；不加入聚合逻辑 |
| `apps/console/src/features/cluster/` | 页面、组件、hooks、模型与中英文文案；不 import 其他 feature 或后端模块 |

新模块不跨 schema 查询。项目槽的副本覆盖归 release；资源索引只读它。
新增内部批量查询时仅返回归属与分类需要的字段，不通过整条任务记录暴露令牌或凭据。
本 RFC 补齐所触及资源的标签和安装清单登记，保留旧对象兼容解析；不重构其他项目设置／会话 UI。

## 2. 受管资源范围

先确认“是不是 CrewStation 的资源”，再解析“属于谁”。两者不能合并成一次字符串判断。

1. 项目模块提供带 namespace、slug、稳定 projectId、kind、state 的有界批量目录，包含已归档项目。
2. 已登记项目 namespace 中的命名空间级对象属于该项目；资源或控制器标签若指向其他项目，显示归属冲突，暂停写操作。
3. 系统范围使用配置的 systemNamespace 与安装组件目录（kind／namespace／name／可扩缩能力）确认。
   `part-of=crewstation`、`managed-by=crewstation`、本机 `crewstation-local` 作为辅助证据；不把同 namespace 中未知对象自动认领。
4. Pod／ReplicaSet／Job 从 controller ownerReferences 逐级解析到已知拥有者，必须匹配 namespace、kind、name、UID。
   仅检查标签相似或同名不能证明拥有关系；有非控制 owner 时也保留关联，但不用它替代 controller 链。
5. PVC 通过 StatefulSet 的 volumeClaimTemplates＋Pod 挂载引用、已登记数据／任务卷映射确认；Service／配置／策略通过安装登记或平台生命周期引用确认。
6. 有明确平台管理标识但项目资料缺失的对象进入“归属待确认”，不静默丢弃。与其他项目冲突时不选一边。

安装目录涵盖五个常驻服务、console、两个 MCP、Traefik、PostgreSQL、registry、BuildKit、本机 dev-auth、迁移 Job，
以及它们的 Service／配置／凭据／PVC／路由等对象；只登记实际部署形态使用的项。给新建和升级清单统一补标签，
旧对象通过精确安装登记读取，不因“查看列表”触发回写标签。

仅展示支持清单内的 namespace 级资源；不扩张为任意 CRD 浏览器。节点名称作为 Pod 调度信息，不纳入全局节点管理。
HPA 等伸缩控制器作为动作冲突检测的关联来源；发现其控制目标时明确指出不能同时手工覆盖。
资源详情只投影用途需要的元数据、状态、镜像、端口、资源 requests／limits、卷引用与容器状态；不返回环境变量值、Secret 数据、完整注解或原始 Pod YAML。

## 3. 用途与归属解析

按“经实例核对的平台记录 → 已验证的 owner 链 → 平台约定标签／安装目录”收集证据，冲突显式返回。
每行携带 `ownership.evidence` 与 `purpose.evidence`，详情用人能理解的短句解释，不把正则猜测写成确定事实。

| 依据 | 归一化用途 |
|---|---|
| 环境 kind=profile-test，namespace／podName 与记录一致 | profile-test（归属平台系统） |
| 环境 native.purpose=cli／agent／subtask；缺省 purpose 依旧按现有兼容规则 cli | development-cli／development-agent／business-subtask |
| 非 native 环境 kind=dev-session／business | development-workspace／business-workspace |
| workload=service＋项目 kind | digital-worker-service／api-proxy／event-producer |
| component=build／migration＋可解析的 release 或平台迁移目录 | build／migration |
| 内置组件目录 | platform-service／platform-infrastructure，附具体组件名 |
| 已受管，但用途证据不足或冲突 | unknown，附原因；不猜成开发会话 |

平台记录必须按 namespace＋podName 对上当前对象；有 podUid 时也必须相等，不能把回收后的同名 Pod 连到旧执行。
批量补充 taskId、parentTaskId、agentId、terminalId、subtaskId、releaseId、算力档位及修订；缺失则标缺失。
项目名称与 ID 从 project 公共查询取得；`crewstation.io/project=platform` 及档位测试哨兵不是项目查询键。
物理槽和 prod／preview 映射从 release 查询；切流影响映射且必须让对应快照过期。
不能通过标签推断 Runner 已连接或 Agent 正在生成模型输出，这些保留各领域自己的状态。

## 4. 采集、数量与状态

由 controller 中单个持租约的采集任务按需刷新，初始参数为 30 秒周期、每页 500 个对象、并发 4；这些是实现默认值，不是性能实测。
采集与资源操作使用独立 worker 容量，避免等待 rollout 或 finalizer 的操作占住后续手动刷新。
浏览器共享持久化投影，不为每个打开页面重新扫描集群。首次无快照返回采集中，手动刷新合并到同一待办，页面不可无限排队。

`K8sClient.listPage(ref, namespace, {limit, continue, labelSelector, signal})` 返回 items、continue、resourceVersion，
保持旧 list() 行为以兼容调用方。分页直到 continue 为空才把该来源标为完整；410 时丢弃该来源的半批数据重新读取，有界失败后保留上次成功数据并标过期。
支持资源读取期限与取消。项目／任务补充也批量分块，不逐 Pod 查库。资源行按 UID 去重。

每种资源／namespace 来源形成完整批次，查询快照保存来源批次向量与采集起止时间。
跨 kind 不宣称 Kubernetes 原子快照；同一 UI 快照的摘要和列表使用同一组来源批次。
部分来源读取失败时，成功来源可用；总量带 `complete=false`，显示“已读取 N，部分来源失败”，不会把残缺集合叫完整总量。
来源返回 403、超时、API 不支持与真实空列表分别记录；没有 CRD 时显示“不支持该类型”。
快照游标含 snapshotId、过滤指纹与稳定排序位置，保留 10 分钟；过期返回 410 并要求刷新，不拼接新旧页。

计数口径：

- 工作负载以顶层 Deployment／StatefulSet／DaemonSet／Job／CronJob、独立 ReplicaSet／ReplicationController 为单位；从属 ReplicaSet 和 CronJob 下 Job 展示在关系中，不重复计入顶层数量。
- 独立 Pod 计入全部 Pod 并另给独立 Pod 数；不凭空构造 Deployment。Job 终态资源仍可见，并有活跃／完成筛选。
- Pod phase 的 Running、Pending、Succeeded、Failed、Unknown 分组互斥；另列 Ready、Terminating、容器等待与退出原因。
- CrashLoopBackOff、ImagePullBackOff、OOMKilled、退出码、调度失败消息原样保留；Running 不等于 Ready。
- Service、PVC、配置和命名空间各自统计种类与状态，不统称“运行中”。CPU／内存先显示 requests／limits，未接 metrics 不展示伪实时使用率。

## 5. 查询接口

下面是已实现契约，统一管理员校验与现有错误信封。路径属于当前单集群，不引入多集群选择器。

| 方法与路径 | 参数／响应 |
|---|---|
| `GET /v1/admin/cluster/summary` | scope、projectId、namespace；返回 snapshotId、来源时间与完整性、各类型计数、状态／用途分布 |
| `GET /v1/admin/cluster/resources` | snapshotId、view、kind、scope、projectId、namespace、purpose、status、q、cursor、limit≤100；返回 items、total、complete、nextCursor |
| `GET /v1/admin/cluster/resources/:resourceId` | resourceId 为服务端快照标识；返回对象键、UID、归属、用途、状态、关联、availableActions |
| `GET /v1/admin/cluster/resources/:resourceId/events` | 按对象 UID 查事件；有界页；对象消失仍区分历史事件与新同名对象 |
| `GET /v1/admin/cluster/resources/:resourceId/logs` | 仅 Pod；container 必须存在，tailLines≤2000、since、previous；有限日志尾部，不宣称历史全量 |
| `POST /v1/admin/cluster/refresh` | 合并受理，返回 refreshId；不在请求线程等待整个扫描 |
| `GET /v1/admin/cluster/operations`、`GET .../operations/:operationId` | 有界列表及持久化进度；支持按目标 UID 与项目过滤 |

DTO 使用 resourceId、apiVersion、kind、namespace、name、uid、resourceVersion、observedAt；归属为
`project | system | unresolved` 联合类型，项目分支才有 projectId。数量可为 unknown，禁止用 0 替代读取错误。
动作能力为 `action、enabled、reason、executionRoute、impactSummary`，不能只有 disabled 按钮而没有原因。

## 6. 操作接口与执行

| 方法与路径 | 行为 |
|---|---|
| `POST .../resources/:resourceId/inspect-operation` | 输入 restart／scale／delete／restore-replicas 及参数；实时重读，返回短期 inspectionId、目标 UID、相关实例、影响清单与可执行性 |
| `POST /v1/admin/cluster/operations` | 输入 inspectionId、idempotencyKey 与确认的参数，受理后 202＋operationId；不信任客户端传来的归属或可用动作 |

检查阶段不做资源写入。确认有效期拟 5 分钟，锁定目标 UID、相关 owner／工作卷 UID、规范化期望配置与领域版本；
Pod 心跳、重启次数和 status.resourceVersion 变化本身不会让确认失效。再次受理与执行前校验最新权限及领域冲突。
不可执行 412；实例或期望配置改变 409；参数 400；非管理员 403；不在范围的对象 404。

操作记录与队列入站在同一事务；同一用户的相同幂等键＋请求只产生一个操作，不同请求复用该键返回 409。
记录拟含 `actorId、action、targetKey、targetUid、projectId?、inspectionId、params、phase、before、after、timestamps、error、traceId、domainOperationId?`。
不保存完整对象、凭据或日志正文。状态为 queued → executing → observing → succeeded／failed／needs-attention，未执行的过期检查直接拒绝。

原生写入使用 UID＋resourceVersion 的前置条件；先重读核对规范化配置，再用 JSON Patch test 或等价 CAS 写入。
遇到纯状态并发可重新核对后有限重试；业务配置改变必须重新检查。Delete 使用既有 UID preconditions，默认遵循 Kubernetes 正常终止与 finalizer。
重启标记包含 operationId，重试沿用同一个标记，不能每次生成新时间戳而反复滚动。
领域动作按 operationId 幂等受理，并把领域作业 ID 回填；不通过跨模块数据库事务硬连。

worker 崩溃、队列租约转移、cs-controller 自身重启后先读现状与操作标记，恢复观察，不盲目重放。
API 超时不等于写失败；无法证明执行结果时进入 needs-attention，保留原因与继续核对入口。
重启完成看新一代 Pod／控制器 Ready、扩缩看期望和实际副本、删除看原 UID 消失；同名新 UID 作为替代对象展示，不删除新实例。
默认观察期限为 5 分钟；超时显示未收敛与当前原因，不自动回滚或取消 Kubernetes 已受理的动作。
自重启 cs-api 时客户端按幂等键找回操作；重启数据库等依赖时保留“结果待连接恢复核对”，不以短暂断线判成功。

## 7. 各类操作语义

### 7.1 发布槽重启、扩缩与删除

新增 release 公开管理用例，共用 service 互斥与发布／切流检查；cluster-management 不直接更改 release 表。
动作记录当前角色与物理槽；确认期间发生切流或新发布，重新检查影响范围。
重启保留当前 image、env、发布标识与物理槽，遵循该 workload 的既有更新策略。

副本覆盖建议归 release，键为 serviceId＋physicalSlot，存 overrideReplicas 与修订；每次发布同一物理槽时读取覆盖。
界面同时显示 Manifest 副本、运维覆盖和当前期望／Ready，恢复发布配置清除覆盖并应用当前实际部署发布的值。
套餐变化导致覆盖超上限时明确阻断该操作／发布并提供调整入口，不静默钳制。HPA 管理的目标不同时接受手动覆盖。
本首版项目副本下限拟 1；暂停业务与缩到 0 不是当前部署槽模型的既有语义。

删除非正式槽 Deployment：先取得可重试的领域删除意图，删除该 UID 及从属 Pod，更新槽为无可用工作负载／不可切流，
保留 release 历史与 Service，详情列出保留对象，后续发布可重建。不能只删 K8s 后让槽继续 ready。
正式槽需要先切流到就绪目标；正在构建／迁移／部署的目标不允许旁路删除，说明当前作业和入口。
初版不增加“删除运行 Job 等于取消发布”的隐式语义。

### 7.2 任务与 Agent

正常开发环境受控重启是新增能力：沿用现有保卷作业的 UID、租约与补偿机制，增加明确的 administrator-restart 原因；
先展示未推送改动与子执行，终止／回收子执行后替换工作区 Pod，保留 taskId、PVC UID、Git 工作树、项目配额单位，重新等待 Runner 握手。
失败时保留卷和可恢复的领域作业，不让对账器误把“正在重启”判断成 pod-lost。不能简单放宽原 rebuild 条件而遗漏子执行。

独立 CLI／开发 Agent 的重启通过 dev-session 接受带 operationId 的单次重开请求：结束旧执行、以受理时确认的档位再开新实例，
记录新旧 ID，其他工作区和父卷不变。已有“重启单窗口”能力应复用其同一条领域路径。
业务任务工作区只对持久模式提供恢复；业务子任务通过原契约的取消／重试语义处理，不对已成功业务做自动重复调用。
同名业务 Pod 恢复前等待原 UID 真正消失，等待期间保持 paused 且不占配额；60 秒超时或同名 UID 变化时保留暂停状态并返回明确原因。
不具备合法重试状态的行仍显示具体原因和业务记录入口。

删除任务显示“释放会话／关闭任务／结束执行”准确文案与卷影响；通过所属 dev-session／business-task／agent-runtime 端口执行，
让事件、配额、CLI 状态和测试结果一起更新。只释放独立 Agent 时不能删除共用 PVC。
档位测试停止后，测试结果必须成为对应失败／未知终态，不可继续显示测试中或误标通过。
测试 ID 从与 Pod UID 绑定的持久化任务记录投影，不能假定真实 Pod 具有 profile-test ID 标签；确认后通过该测试记录执行停止。

### 7.3 系统组件与残留资源

内置组件目录声明允许 restart、minReplicas、maxReplicas 与依赖提示；未声明扩缩能力时禁用扩缩并说明原因。
PostgreSQL、registry、BuildKit、本机 dev-auth 等当前单实例配置不当成可任意横向扩容的服务。
核心组件允许重启，不开放删除或缩到 0；namespace、PV、节点、安装级卸载不通过本 API 操作。
这份新增动作矩阵随 RFC 审批，不改变既有安装器或命令行能力。

终态 Job、无活动引用的孤立受管 Pod、PVC、Service、ConfigMap、Secret、策略等可按对象删除。
检查要覆盖控制器引用、Pod 挂载、平台注册的保留卷／配置／路由／未完成领域作业；不能以“当前没有挂载 Pod”断言 PVC 没有业务用途。
检查来源不完整时不放行删除。有引用时列出引用者与所属处理入口，而不是把按钮藏掉。

## 8. 前端交互与失败模式

列表使用共享查询与轮询约定，后台页暂停刷新，焦点返回时重读；筛选变化与迟到响应隔离。
详情按资源 UID 固定，同名替换提示新对象，用户主动跳转。回退保留过滤、页码和选中资源。
计数可点入对应种类；用户点击系统范围能同时看到核心服务和 PostgreSQL／Traefik 等依赖。
操作面板显示自然语言动作、目标、影响、相关资源、必要输入与字段级约束；待执行中按钮去重，草稿与错误不会被轮询抹掉。
删除／重启确认用 InlineConfirm／ConfirmationPanel；不使用浏览器 alert／confirm。
关键失败必须能走通：未授权、403 来源、不支持类型、对象已消失／被替换、Pod 未调度、日志不可读、扩缩不收敛、删除卡 finalizer、领域作业中断。
用户保留操作 ID、HTTP 错误状态、traceId、耗时、阶段与原始原因；重新连接恢复查询，不能重复提交作为默认“重试”。

## 9. 测试策略

分类纯函数覆盖每种用途、标签缺失、owner UID 错配、归档项目、系统兼容目录、槽角色变化、独立 Pod 与未知状态。
分页用两页／空中间页＋continue／410／取消／403／混合来源测试，验证完整性与快照一致计数。
操作模块用真实临时数据库＋fake K8s 验证事务入队、重复受理、领域冲突、崩溃恢复、UID 条件和无法确认结果；
关键生命周期新增成功、边界与故障回归，包括父卷、配额、子执行与槽状态。
HTTP 必须同时测成功与拒绝路径，前端测真实路由交互、筛选和迟到结果，不只断言文本存在。
真实集群用专用验收项目完成重启／扩缩／清理；平台核心组件默认只查与操作检查，真实中断验证单独记录目标与执行授权。
完整 check、console build、实机 UI 证据和发布精确 SHA CI 各自记录，不能相互替代。


## 10. 实施记录（2026-09-20）

- 新模块、管理 API、前端六视图与所属领域动作已实现，第一笔代码提交为 `b7fb3e52b585bafc08bac8dd16d15a57007eee5b`；组合根与项目目录投影随并行 RFC-011 完整共享文件提交。
- K8s 每页 500、四路读取、来源 30 秒、单轮 120 秒；项目／任务／发布槽也按 500 条批次查询。单来源 resourceVersion 不一致或 410 丢弃半批重来；过期来源保留旧值并禁用相关操作。
- 快照用数据库单调 sequence 排序，避免同一毫秒内误读上一批；自动采集每 30 秒，浏览器读取共用快照。过期页 HTTP 410；刷新请求合并。
- 操作意图与队列在一个事务内受理。原操作的“继续核对”复用 Kubernetes marker 或所属领域持久命令；恢复代次隔离旧工作器写入，新的观察窗口不自动回滚已生效配置。
- `task_runtime.environments.pod_uid` 锁定非原生 Pod 实例；旧工作区只有完成原 Runner 身份校验后才能绑定当前 UID。没有实例证据时展示待核对原因，不根据同名 Pod 猜测用途与管理动作。
- 工作区重启保留任务/PVC、先回收子执行；CLI/Agent 新实例保留原算力修订。发布槽覆盖保留在物理 blue/green，删除试用槽保留 Service 和历史。业务持久工作区与失败子任务沿原暂停/恢复/重试流程；成功业务禁止从集群入口重放。
- 本机服务账号新增读取、受控 patch 与 Ingress 删除权限已获作者具体批准并应用；完整来源、项目管理动作、系统重启和 finalizer 恢复均已在真实集群核对。

实机范围、对应 CM 编号与发布证据以 [acceptance.md](./acceptance.md) 为准。
