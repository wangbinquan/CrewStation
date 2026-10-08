# RFC-037｜技术设计

I36 的已批准重建开发任务当前保留条件与模块落位见 [当前开发保留基线](acceptance/rebuilt-development-retention.md)。旧出生缺失保持原样；完整当前任务／Pod／挂载卷事实只绑定管理员逐项 retain，任何目标、共享、身份变化或不完整来源继续阻断，不授予回收资格。开通确认读取旧发布事件时复用严格冻结格式、完整双摘要与实际原迁移重新推导；仅供盘点与完整原文保留，当前执行契约不变。库存专用 `packages/contracts/events/history/tasks.ts` 分别冻结 fc833a01 的 driver／model 与 f94f0f32 的 compute 档位名完整文档；不允许混合版本或未知字段，实际迁移声明与完整重新推导仍须匹配。

2026-10-06 作者追加批准[后页来源消失记录的完整保留](legacy-recovery-options.md)：17 个无淘汰身份的已结束测试及旧项目 12 条队列／事件，仅逐项确认本目标不回收其完整原文，历史归属仍未知；完整原来源、私有错误及当前 Pod 配置反向引用检查保持。实现与红绿证据见 [I36 后页完整性](acceptance/current-ownership-completeness.md)。

2026-10-06 作者批准[全平台巡检边界](platform-maintenance-boundary.md)：仅确切三个队列任务在严格核对当前/旧正文、迁移摘要及原队列完整来源后按全平台合同保留，不再依赖已过期 collector 原请求。其他项目操作及未知归属仍拒绝；不补造历史、停止或清理证明。

> 状态：Done · 2026-10-09 · 创建弹窗／域名与模板说明、管理员二次确认永久删除已部署并实际回收；154 回执、九项独立 AFTER、准确六 CI 与实机界面通过，见 [最终实机验收](acceptance/complete-deletion.md)。

2026-10-06 HTTP 接续：完整管理员盘点、逐项确权、受理和重新确认可以超过 Bun 默认的 10 秒连接闲置时间。HTTP 适配器仅在核实当前管理员后，为这六类请求保持响应连接；普通读取、重试及其他 API 保持原配置。资源来源超时、归属和物理身份校验、外部引用阻断、两次确认以及持久工作器全部不变。需要真实服务器连接回归、精确 CI／部署和原项目实删验收，不能用独立只读工厂通过替代实际 HTTP 成功。
> 配套：[产品提案](./proposal.md) · [实施计划](./plan.md)

网关原身份、共享历史文档、缓存和已开始原生回调的落位与反例见[网关 owner 细化](gateway-owner.md)，属于下文已批准的完整清理合同。

PostgreSQL 的原 OID／实际目录核对见[数据库物理来源](database-physics.md)，非事务原库隔离与恢复步骤见[原生执行设计](database-operations.md)。它们沿 data-control 的现有 L2 边界补充设计 §6.2，不开放按名字删除的捷径。后续模块增长的结构盘点与候选拆分见 [ADR-0012](../../../docs/adr/0012-project-resource-owner-growth.md)，尚未实施新模块／层或 schema 转移。

原生服务器与共享卷的独立来源、实际安装核对及正式 owner 依赖见[原生 PostgreSQL 来源](native-postgres-source.md)。SQL system_identifier/目录摘要和 JS 回调停止保护各自不能替代这个存储来源；外部管理地址及未知 tablespace 缺少适配器时保持阻断。

## 1. 边界与现有约束

使用现有模块，不新增模块或调整 layer。模块只操作自己的 PostgreSQL schema，经公开 API 与反转端口协作；不在 `platform` 写跨模块删除 SQL。已有 `resources` 台账、`cluster-control` 的 UID 调和、`data-control` 数据面与队列／outbox 是执行基础，不能由前端或一个 `kubectl delete namespace` 替代。

本轮核实的缺口：

- 正式／待验证／服务域名都经 `project` 的 `HostNaming` 端口生成（`modules/project/application/toDto.ts:22`），组合根使用安装域名（`modules/platform/wiring.ts:99`）。创建目录未提供预览（`modules/project/http/catalogRoutes.ts:21`）。
- `ProjectState` 目前只有 provisioning／active／archived／failed（`packages/contracts/api/project.ts:8`），开通装载器只挡 archived（`modules/project/application/queryProjects.ts:75`），已装载的开通链逐步执行且末尾仍推进 active（`modules/provisioning/application/provisionProject.ts:13`）。增加删除状态必须同时堵住已经开始的工作。
- `scm` 的公开 GitLab 端口没有仓库删除（`modules/scm/ports/gitLabGateway.ts:30`）；底层客户端已有删除协议，且区分延迟标记与永久删除（`packages/gitlab-client/projects.ts:33`）。
- 数据面调和目前只回收访问绑定的临时角色，明确排除运行角色（`modules/data-control/application/observeDataPlane.ts:46`、`modules/data-control/domain/roleRemoval.ts:17`）；不能以现有 absent 投影推断业务库会自动被删。
- 任务卷只有原 UID 删除许可才进入回收，且有实际存储回收证明（`modules/cluster-control/application/storage/taskVolume.ts:26`）；普通任务终结还要求归档与消费者停止屏障（`modules/task-runtime/application/business/storageCleanup.ts:17`）。
- 对象删除先进入 deleting，活动引用与读传输会阻断物理清理，物理完成才退后端预留（`modules/data/adapters/persistence/objectContent.ts:52`、`:97`）。镜像 retire 不等于物理回收（`modules/runtime-environment/application/versionLifecycle.ts:29`）。

## 2. 落位

| 模块／层 | 本次职责与拟增位置 |
|---|---|
| `project` L2 | `application/creation/` 域名预览；`domain/` 生命周期规则；`application/` 删除意图、阶段回执、最终清理；`ports/` 仓储与生命周期许可；`adapters/persistence/` 本 schema 新迁移 |
| `provisioning` L6 | `application/` 删除盘点与编排；`ports/` 清理参与者；`http/` 删除材料与请求；`workers/` 原操作持续推进；现有开通步骤接生命周期许可 |
| 各资源所有模块 | `api/` 对外清理能力；`application/` 闭准入、停止、删除与证明；`ports/` 对外系统清理；`adapters/` 幂等实现；仅删本模块的项目数据 |
| `resources` L1／`cluster-control` L2 | 项目删除许可、受管对象观测、卷回收与最后命名空间回收；台账保留最小墓碑 |
| `data` L3／`data-control` L2 | 项目对象／库／角色清理意图与实际数据面回收，排空传输、原对象身份检查 |
| `platform` L7 | 只组合公开 API 与端口，完整登记参与者并汇总迁移 |
| `packages/contracts`／`api-client` | 创建域名预览、删除盘点／受理／进度／重试合同与客户端方法 |
| `apps/console/src/features/projects`／`admin` | 用途文案、域名预览、项目操作入口、共享弹窗及进度；共用无业务耦合的 UI 继续放 `shared/` |

新增迁移只操作所属 schema，序号在落盘时按实时工作树取下一项并精确入锁。RFC-036 正在增加项目资源策略、`resource-access` 与各能力分配记录，必须一起登记清理，不能遗漏未提交的新表或覆盖其在制文件；RFC-034 的停止与排空合同也须复用。

## 3. 创建说明与域名预览

创建从列表页打开 `FormDialog(size='large')`，表单主体单屏组织必要字段。创建成功刷新当前列表并呈现真实开通结果，查看后续进度再打开统一弹窗或状态详情。现有 `/projects/new`、`/admin/projects/new` 书签兼容为“定位原列表并打开创建弹窗”，不继续挂载独立创建页面。

自建在 projects feature 内管理弹窗与草稿；管理员列表通过 app 层组合 projects 的公开创建组件与 admin 目录入口，避免 admin feature 深 import projects 内部组件。草稿归打开者所有，关闭不清空；离开页面时才走既有未保存输入确认。复用 FormField、Button、Badge、FormDialog 和既有主题令牌，不修改共享弹窗外壳尺寸／按钮标准来美化单页。

新增只读 `GET /v1/catalog/project-domain-preview?slug=<slug>`，仅开发者／管理员可读。严格校验 slug 格式与保留名，返回 `{ slug, prodHost, previewHost, serviceHost }`，全部直接调用当前 `HostNaming`。不创建项目、资源或域名，不预占标识。创建时仍做原有唯一性校验。

管理员代建、自建及接入创建组件使用同一个 api-client 方法。按合法 slug 建查询键并做输入合并请求；输入变更立刻清除旧域名展示，迟到响应不得覆盖当前输入。空、非法输入不请求预览；服务失败显示“域名暂时无法读取”，不能补一个猜测域名。

界面优先呈现正式域名、待验证域名；服务域名按接入形态需要显示。创建前仅显示文字；创建后从真实服务读取域名。弹窗内同时显示所选模板和必配项，不再另加一页确认步骤。中英文说明直接回答“这项决定什么”，格式约束另行保留。

不改创建请求中 slug／template 的语义，不自动替换模板、不折叠掉作者要求保留的输入。在工作台既有文案目录新增按稳定模板 UUID 对应的友好名称、用途和初始内容说明，依据当前模板源码及 README 核对；目录选项仍来自真实模板目录，必配项仍来自当前 manifest。未登记的模板显示原目录名称和“复制此模板的初始代码与发布配置”通用说明，不宣称任意模板都有数据库、Agent 或某个业务功能。两个 DigitalWorker 模板及当前接入模板都补齐中英文用途，不把交互稿里的选择键作为正式模板 UUID。

## 4. 删除合同与持久化

删除 HTTP 编排由 provisioning 挂载；生命周期意图与进度由 project 的公开 API 管理。拟定接口：

| 接口 | 输入与结果 |
|---|---|
| `POST /v1/projects/:projectId/deletion-plans` | 管理员盘点；返回 planId、expiresAt、对象标识、域名、资源分组、完整性、来源修订、外部引用及阻塞项；不停止或删除任何资源 |
| `POST /v1/projects/:projectId/deletions` | 严格请求 `{ planId, requestKey, confirm: 'delete' }`；重新核实管理员与计划，首次受理返回 202 与 operationId／进度查询地址 |
| `GET /v1/project-deletions/:operationId` | 管理员查询原操作，包括项目记录已删除之后；返回阶段、各项状态、错误、阻塞、更新时刻及可否继续 |
| `POST /v1/project-deletions/:operationId/retry` | 管理员继续原操作；不改变确认范围，不重做已证明完成项 |

所有 ID 使用既有完整 UUIDv7。计划由服务端生成，不能接受客户端提交的资源名单。计划过期、归属或关键修订改变返回冲突，重新盘点并确认；读取失败／分页未完不解释为空。非管理员拒绝，401／403、严格输入校验和真实成功路径均有 HTTP 用例。

`project` 新增自己的删除计划、删除操作与阶段回执表。受理事务内锁项目并比较生命周期修订，原子写入删除意图、`deleting` 状态与 outbox；每项目唯一删除操作，requestKey 与确认摘要绑定。同键重放返回原操作，异参冲突；其他键遇到已有操作也不能启动第二条流程。

provisioning 消费 outbox 后用 operationId 入队。队列丢回执或控制器重启由持久操作重新补队；执行使用租约、单调世代与逐项回执，旧持有者不能覆盖新结果。project 仍是生命周期事实源，不做跨 schema 事务。

## 5. 生命周期与停止屏障

项目 provisioning／active／failed／archived 均可进入 `deleting`；该状态不回 active。清理进度使用独立操作状态 `accepted`／`running`／`needs-attention`／`succeeded`，失败仍保持项目 deleting 与闭准入，不借用普通开通 failed 恢复调度。

受理立刻关闭项目写入与新增资源准入。每个参与者在自己的锁与事务下记录同一 operationId／世代，排空已获得许可的执行，回执确认“不能再新增，既有副作用已可盘点”。所有参与者闭准入齐全前不销毁数据。

同标识重建及正文迟到的具体来源绑定见[原事件来源](./original-event-source.md)：原 projectId/serviceId、release/task ID 与实际 Pod UID 固定调用者；域名标识不承担不可复用身份。v1/v2 协议和合法调用形态保持，未知来源拒绝。

必须覆盖：HTTP 写入、开通每一步及最终 setProjectState、后台 release／image build、业务与开发新任务、Agent／CLI 派发、resume／rebuild／recovery、配置／授权／申请审批、对象上传／验证／恢复、数据库供给、资源重投影和重启后的队列／事件重放。只在 authorize 中加一次检查不能挡住已开始的流程。跨进程许可必须持久化；不能靠本地布尔变量或进程内广播。

实际停止顺序：先封新准入及入口，再停止接入投递／业务调度／流水线，然后终止任务、执行 Pod、CLI、Agent、验证与归档辅助工作。当前执行按既有停止／数字排空能力结束；无法取得尾部证据时保存明确缺口，不伪造正常完成。资源回收必须等待实际消费者停止证明。

迟到供给的已确认本项目资源纳入同一操作重新盘点；无法确认归属或超出已确认清理类别时阻塞，要求更新材料再确认。项目根记录必须保留到所有参与者完成，避免失去源码、库、卷与外部对象归属。

## 6. 全部参与者与清理次序

每个参与者提供 `inspect`／`seal`／`stop`／`purge`／`prove`，按需要实现阶段；不适用阶段也要提供明确回执。盘点返回完整游标与真实归属，不只取列表第一页。新加入的项目资源所有模块未登记时完整性检查失败，不能继续销毁。

| 参与者 | 要盘点和清理的归属 |
|---|---|
| gateway／identity | 项目三类路由、限流、放行关系、Pod 身份与服务／会话令牌；保留用户与平台身份 |
| events／api-catalog | 本服务能力登记、授权、请求、订阅、inbox／投递／死信与引用；展示其他项目受影响关系，经所属模块失效更新，不删除调用方项目内容 |
| provisioning／release／runtime-environment | 开通、发布、构建、迁移、蓝绿两槽、镜像验证／取消、私有镜像版本及所有冻结引用；全局共享定义保留 |
| dev-session／business-task／task-runtime／session | 开发父任务、子执行、业务任务、暂停／失败历史实例、原生终端、恢复请求、Runner 凭据、日志／原生执行记录、工作盘和消费者 |
| data／data-control | 开发和生产资源、数据访问绑定／角色、对象空间、上传／读／验证／垃圾队列、输入 pin、归档计划／回执／产物、数据库与运行角色 |
| scm／config | 原 remoteProjectId 仓库及 Git 凭据；两环境配置、密钥、定义和快照 |
| project／agent-runtime／runtime-environment／resource-access | 项目规格、默认绑定、算力／镜像／对象／API 分配、申请／审批／回执、成员、应用可见性及访问申请／图标 |
| observability／cluster-management | 项目执行原文与数值明细、工作台持久布局／已保存材料、项目运维请求；仅保留删除所需最小审计 |
| resources／cluster-control | 活动及 stopped 台账、已退休但未回收对象、命名空间内全部对象、原 PVC/PV 与存储证明；删除前保留归属，完成后压缩为最小墓碑 |

停止证明齐全 → 卷、库、对象、源码和制品清理 → 命名空间 → 各模块剩余记录／缓存／队列清理 → 完整二次盘点 → project 最后删除根记录并留下最小墓碑。不能先删数据库记录再希望孤儿回收猜出实际对象。

### 6.1 工作盘和命名空间

为本次已确认的数据销毁增加 `project-deletion` 原 UID 许可，覆盖 legacy、暂停、归档遗留卷；正常任务结束的归档合同不变。此路径不要求先生成新的归档副本，但必须满足全部消费者停止、原 PVC/PV 绑定与物理回收证明。已有归档／排空在制工作先停止并收尾，不能与删卷并发。

命名空间最后清理，沿用完整 API discovery、分页、未知对象阻断、租约和原 UID 条件；不强删 finalizer，不删同名替换实例。既有归档专用动作保留；新的项目删除许可通过独立入口进入同一底层盘点和回收能力，不伪造 archived 绕过规则。

项目停止另有自己的 Pod finalizer，在 seal 阶段按原 UID/resourceVersion 加入；原节点新鲜心跳及普通、init、临时容器的实际终止状态确认后，先持久写入最小停止摘要，再正常移除本操作的保护。API 中 Pod 不存在而没有原停止证明时阻断。卷的独立项目销毁许可仍要求所有前序 owner 的停止／排空回执，固定原 PVC/PV、供应器位置后才删除；CSI 依赖原删除 finalizer 的供应器流程，local-path 额外要求原节点认证探针确认目录不存在。Pending 原 PVC 首次绑定可在同操作内固定原供应器，已经固定的 PV 或目录不能替换。最小物理清理回执只含原身份、供应器位置、摘要及时间，保留位置用于元数据清理后的实际复核，不保存文件内容或秘密材料。

### 6.2 数据库、对象和源码

数据库清理先禁止供给／连接续发并停止消费者，清理临时角色，再按原数据库 OID／运行角色 OID 删除；验证重建的同名库必须阻断。扩展 data-control 显式项目删除协议，不把任意 database absent 自动变成 DROP。

对象先停止并排空原项目读写／验证／恢复／归档，释放本项目引用，按原后端位置、对象 key、placementRevision 逐项清理已提交文件和不确定上传。无法确定上传最终状态时继续恢复核实，不能先退额。跨项目有效引用阻断。后端本身及其他空间不删；quota／reserved／deleting 仅在真实清理完成后结清。

SCM 新增公开项目清理端口，按绑定的 remoteProjectId 查当前身份与路径、撤销凭据并执行远端删除；远端延迟删除与永久清除须按当前部署能力验证，等待确认原仓库已彻底不存在。认证失败／读取失败不等同不存在；平台 GitLab 组和全局令牌保留。

实际 19.2.4 协议及只读原来源盘点见 [SCM 删除协议回执](acceptance/scm-removal-protocol.md)。接口受理与 API absence 各自不能证明主仓库、Wiki、暂存删除目录、LFS、附件或其他项目独占文件已回收；正式 owner 仍须固定原消费者、原存储与完整物理范围。

### 6.3 镜像和共享资源

项目运行镜像、发布镜像、构建日志／缓存按归属盘点，先清理本项目消费者和引用。其他项目仍引用的私有资源阻塞，不能绕过现有 image_in_use。平台共享目录只清除本项目授权／引用。

新增所属模块的制品清理与实际回收观测端口，补足现有 pending-maintenance；仅设置 retired 或删除 tag 不能宣称物理完成。引用计数须涵盖多版本同 digest 与注册表共享 blob。可证明为其他项目／平台共享的底层 blob 保留，项目独占制品没有回收证据时操作继续等待，不默默降级为“只删元数据”。

## 7. 工作台交互

新建弹窗的布局及文案按 [交互稿](./prototype/README.md) 审阅。界面就地说明每个关键输入的用途和创建后的效果，避免大片提示卡、术语堆叠或依赖外部教程。管理员资源设置可按既有服务套餐与额度规则调整，自建仍使用平台默认，不因视觉简化而越过权限。

列表行提供管理员危险操作与删除中进度入口，项目生命周期页给同一能力；接入管理使用同一合同。盘点用 `Dialog`，第二次确认用已有 `ConfirmDialog(confirmWord='delete')`，实际进度保留在外层弹窗或独立管理员操作路由。禁止页尾 append、自制弹窗和浏览器 confirm。

受理 HTTP 请求期间锁住确认，收到 202 后恢复进度查看与关闭；关闭不取消后台操作。项目 deleting 时市场移除可用入口，管理员列表显示删除进度。完成后正常目录移除项目，管理员仍能按 operationId 看最小结果。操作按钮不能因为周期重读而闪动禁用。

## 8. 错误和完成判定

来源不可用、盘点不全、跨项目引用、同名替换、停止不实、数据库／对象／仓库／镜像清理失败均显示具体阻塞；暂时故障按原操作退避，需人工处理则 needs-attention，不能跳过项后成功。

完成须同时满足：所有登记参与者闭准入与清理回执完整；原项目独占运行／存储／外部对象不存在并有证明；实际占用与预留归零；完整复盘没有新残留；项目、服务和可恢复业务记录被清除，仅最小审计／墓碑保留。检查不得把查询上限或统计 0 当成全部资源不存在。

## 9. 测试策略

契约和纯规则覆盖域名预览、delete 确认、状态迁移、摘要与同键重放。模块层用真实 PostgreSQL 检查受理原子性、并发闭准入、跨参与者恢复、清理回执和旧库升级；每个新增 HTTP 路由必须包含成功与拒绝路径。

用有状态外部替身覆盖延迟供给、同名换 UID/OID、仓库标记删除、对象传输、PV 消失但存储未回收、镜像共享和注册表 GC 失败。不能只 mock 清理端口返回成功。控制器崩溃发生在副作用后／回执前，同操作重跑不得伤及替换资源。

console 覆盖两条创建路径、真实域名规则与迟到响应、模板说明、载入／空／错／成功、长列表末行两层弹窗、输入 delete、取消零写、Esc 层次、焦点／上下文、202 后进度、失败继续及中英文。实机在经单独授权的专用项目完成全资源回收，对比其他项目与共享资源身份；不对现有真实项目执行删除来“试一下”。


## SCM 原回调准入和副作用沿革接续

已批准的 SCM 清理边界在永久请求前补齐持久准入：建仓、模板推送／标签保护、代推、打标、两种令牌签发／撤销和旧网页地址回填共享项目锁；seal 持排他锁关闭同一原 projectId。普通 UOW 独立提交，SQL 触发器核对实际共享 backend，防止 seal 排队时已开始的写入自锁。最小 serviceId→projectId 历史不可改写，根消失后仍拒绝旧键写入。

每个回调在进入外部调用前独立提交原 workId／serviceId／backend PID 和可用的原 Pod／container／node 身份；锁或连接消失不能充当退出证明。回调真实 finally 与原容器停止恢复分别记录；恢复只接受正式 project 许可和原实例停止摘要。逐个建仓／令牌请求在发送前记录意图，收到数字 ID 后先记录不含秘密的结果，再落普通绑定／凭据；响应丢失保留未闭合意图，不能按当前同名路径接管。失败后已发生的副作用沿革不随普通 UOW 回滚。

公开只读历史必须跨一致快照读取本项目全部绑定、凭据与回调／最小身份；旧记录的原回调身份与结果保持缺失，不能补造。该端口只为正式 owner 提供来源；完整远端消费者、GitLab 的原存储和全部独占文件仍由独立来源证明，不能以 JavaScript 返回或 API404 宣告物理回收。


## 原生 SCM 物理适配器与独立消费者接线（2026-10-05）

SCM 的 `retained` 材料在既有不可变原范围 jsonb 中保留完整原生清单与完整文件范围，不加迁移；公开盘点只显示材料摘要。主/Wiki/design、snippet、upload、全部历史 artifact/trace/package/secure-file prefix 和原独占 LFS 覆盖已接入，父记录消失仍读原材料。Gitaly `+removed-*` 目录必须匹配留存原目录出生，不能只凭 basename 接管。

原容器 Linux 进程清单由 root 读取，再以每个原进程的实际服务 UID 只读核对全部线程 FD、mmap、cwd/root/exe 和 PID/TID 出生，前后完整进程清单不变。Workhorse/Gitaly 实际在途计数、Sidekiq 活跃和本项目队列是独立排空来源；读取失败不算零。停止调用正常 Projects::DestroyService，清理阶段只对原独占且未引用 LFS 调用其正常 model destroy，OID 同内容替换也阻断。实际文件移除仍要持久许可、独立停止与原文件身份。最后一次排空后重新盘点原生和文件，不能采用排空前的缺失证明。未创建仓库的项目通过完整空历史回收，不向当前归属恢复请求不存在的仓库。

当前实机证据只读、原项目保持；完整22方生产装配、Garage和镜像发布回收及管理员原专用项目全部资源验收继续，永久删除入口尚未开放。

## I36：重新确权与历史盘点基线（作者已批准）

[方案 B](./legacy-recovery-options.md)的七条约束为正式基线。结构按 repository-structure §3/§4：跨进程形状放 packages/contracts/api/projectDeletion；project/provisioning 组合公开 owner API，业务/网关/原生/队列 owner 在自己的 schema 持久化事实，application 通过 ports 注入，不跨 schema 事务、不深层 import。UI 复用 shared/ui/dialog/FormDialog，api-client 提供正式管理员路由。

每一项以目标 UUID、owner、原完整键与正文摘要、当前引用及原消费者完整证据形成候选摘要；管理员提交候选摘要与逐项决定，owner 在原准入锁内重读、比对并保存 actor/time/operator-confirmed/v1。保存回执可幂等读取，当前候选变化后必须重新确认。保留事实仅是目标项目的否定回收决定，未知历史 owner 不被改写。final seal 重读同一决定及证据；共享、目标关联、未知活跃消费者和来源不全不能保存或使用决定。作者追加批准的外项目活跃保留仅适用于公开 owner、旧完整记录和当前实际 Pod namespace/name/UID、project/service 标签一致、Running 且未终止、全部普通/init/ephemeral 容器身份完整、唯一活跃消费者对应该 Pod 且没有目标/共享引用的条目。明确 retain 后完整旧行及该运行资源保留；原未知出生不补写，原回收范围内的实际停止条件保持。

历史事件：当前 `modules/provisioning/domain/infrastructureOrigins.ts:47` 的严格生产解析保持；新增独立 inventory-only release 解析。冻结可核实原源码 fc833a01 的所有 Manifest 子对象为 strict；原前缀 ID 和 trace 按原格式检查。eventbus 通过 persistence 公开的只读原迁移重推导基元处理其现有 0003 声明，解析后的原正文只供检查，实际变换使用完整未剥字段的原正文。规范化结果全摘要必须等于实际 payload；provenance 双摘要与 current/legacy project/service/release 原见证全部相符才可识别。当前事件 producer、Manifest、投递和重放不接兼容路径。

PostgreSQL 当前基线覆盖全部注册旧名字与当前 OID/服务器/data-dir/实际独立存储身份。14条旧 journal NULL 保持；新事实不作为其 before/after。原 history.references、snapshot.foreignKeys/unownedCredentials、角色外部依赖、共享卷/目录和原实际停止仍验证。scope 的新许可仅替代批准的旧出生前提，实际 stop/purge/prove/metadata/verify 保持。

测试：纯规则拒绝全部未知/额外字段和错误双摘要；真实 PG 的管理员 HTTP 成功、401/403/400、重新读取/重启/重放、源变化失效、新行/共享/未知或目标活跃阻断及并行 seal、确证外项目 Running 完整保留和 UID/容器变化失效；console 长列表末行弹窗、上下层 Esc、草稿/焦点/上下文、保存零删除、两次确认保留；原生沿原 UID/OID/容器/卷验证真实清理及独立 after。


### I36-T11：当前原生基线等待采样（2026-10-07）

实际884b13a管理员界面已逐项保存76条严格保留，唯一PostgreSQL当前基线在确认及多次重读中被独立探针409拒绝。冻结源码完整77项只读复现确认`native_postgres_source_busy`；单独原生读取成功且原Pod／容器、PVC／PV、目录和OID保持。探针与30秒定时全量度量共享互斥入口，普通度量可占用55秒，不能用反复点击碰运气或放宽身份核对结束验收。

仅在`modules/data-control/adapters/postgres/databaseReclamation.ts`的`captureCurrent`内对独立来源capture／verify采用同一个60秒总等待预算，指数退避50ms至1秒，且每次尝试前核对原名字锁仍持有。只重试PlatformError的`native_postgres_source_busy`；其他错误、身份变化、源不可用及超时继续失败。历史出生、原SQL范围／角色依赖／消费者核对、普通capture和正式阶段均保持。复用既有nativeWork同样的采样等待语义；不停止平台采样、不改探针或外项目资源。真实PostgreSQL回归应先红后绿：capture与verify暂忙恢复后完整身份一致、非忙错误不重试、等待期间原卷替换仍拒绝；针对性防护及确切提交树六CI后部署并续原77项／22方／独立AFTER。现有完整check中的两项并行观测WIP失败继续保留，依§3单独检查本增量，不把旧候选全门记为新候选通过。


### I36-T12：原生业务记录的完整逐项保留（2026-10-07）

00c96ac3 的实际原生基线已成功核对并由管理员保存，原库／角色／服务器和卷身份不变。继续原22方预检发现 RFC-027 外项目三个已取消的执行及三个 idle 会话卷：其 TaskRuntime 原根缺失，业务公开原父任务和服务同属另一项目。这仍是已批准 B 的业务逐项否定回收决定；不补原运行身份、出生或退出，不授予物理回收资格。当前／历史运行标识完整只读审计共39个，缺失4个，其中1个是此前已确认的旧业务条目、3个对应这6条原生业务记录，不再以首个阻断作为全量结论。

候选新增 `execution_subtasks`／`execution_session_homes`，每个完整主键、原正文摘要仍单独确认。对执行／会话／卷标识做关联闭包，读尽25张原登记内容表的匹配记录；每个原父根、公开 task/service 来源、完整关联摘要及实际完整 Pod 来源一起绑定。原生执行必须已结束且 runtime_released、无owner／lease；home必须idle且无执行租约，并有完整业务执行关联。关联含未知、冲突、其他父任务、目标、共享或活跃引用继续阻断。读取错误不得解释为不存在。一个批次内共用同一关联及公开来源快照，保存前后的重读各自重新建立，不能将缓存跨请求作为证明。

业务正式 metadata purge 也须传入原 `context.target` 重读已保存决定；先前只传项目ID会在最终阶段重新碰到未知外项目历史。修复保持清理范围和原七阶段，不能改变目标主键／正文数量比对、原消费者停止或物理UID/OID条件。真实PG用例须覆盖两类逐项保留、原正文不变、跨重启／幂等、全部七阶段清理、来源／正文／关联变化失效、目标／活跃／未结束／共享／畸形／读取失败拒绝，以及601条前页后的实际cursor。部署后从管理员界面逐项核对六条新候选，原目标实际删除及所有独立AFTER通过前不关闭T6。

## I36-T13：原子受理与原实例身份（2026-10-07）

首次确认由 project 锁定请求键及项目，验证持久计划的完整22方、期限、规范摘要和当前项目身份，再原子写 operation、deleting 和 outbox。provisioning 不在关闭项目准入前再次读尽全部来源；实际 owner 的 seal 仍完整重读并严格匹配确认范围，全部22个 seal 回执齐全之前没有 stop/purge。内部直接调用若提供实时 inventory 仍执行原严格比较。封存差异只进入原操作 needs-attention，重新确认沿用其身份与已完成回执。

release 原生工作区的 full identity 继续绑定完整消费者/回调选择、原缓存、文件和实际来源，持久物理范围与证明不可替换。公开对象 sourceIdentity 绑定原 source epoch 与该对象的 kind/id/identity；coverage sourceIdentity 绑定原 epoch/version/覆盖种类。后台追加已结束回调只改变完整盘点修订；真实 Pod UID、配置、卷、原探针/容器出生、BuildKit 选择或计数变化仍阻断。Registry 原 byte graph、实例和文件身份校验保持。

只有事务写入前的确定拒绝返回 details.code=project_deletion_confirmation_rejected，并绑定原 planId/requestKey。console 仅在该明确409/412及请求绑定吻合后重新读取原操作：发现操作继续显示原回执；读取为空或原重新确认仍阻塞、且持久键与本请求一致时才清除本键并展示 plan-invalid。其他错误、读取失败、换操作或另一窗口键保持未知结果，不自动发新请求。既有统一两层确认、取消/Esc及列表上下文保持。

回归包括真实PG无二次前置扫描/原子deleting/同键重放、封存前身份变化零清理、过期与不完整拒绝标记；原生回调新增与真实对象/缓存出生边界；console确定拒绝恢复、未知错误和跨窗口键保留。实际原项目仍需154个回执及全部独立AFTER，不能以替身通过关闭RFC。

## I36-T14 轮询保留原重新确认计划

ProjectDeletionSession.read在无待定请求、原operation ID一致、state为needs-attention且phase为seal、当前plan.operationId与plan.supersedes都匹配时，只更新operation，保留已准备的完整或阻断计划。其余权威状态（新确认摘要、运行、后续阶段、成功）仍执行accepted清理。轮询始终只读，不发新计划或删除请求。回归包含完整和阻断清单跨refresh/open保留，以及确认摘要或phase/state改变后失效；实际正式浏览器需跨两个5秒周期仍显示完整阻断或确认清单。

T14诊断补充：在线API容器内额外构造整套Root触发22:14:05Z的OOMKilled并重启，停止该方案。三个来源失败由现有服务在盘点catch处记录participant、projectId及源码调用位置；只提取/app/modules与/app/packages的固定文件/行号，不记录异常消息、SQL、请求、堆栈首行或业务正文。报告仍为source-unavailable，资源与许可判定不变；验证内部日志有可定位调用位置且原错误中的私密内容不会输出。

## I36-T15 本地 Registry 来源字段的持久编码

实际单行原release fence为8,118,118字节、runtime fence为20,721字节；本机纯解析确认retained与native-work均通过，两个Registry materials都在原范围比较处失败。packages/filesystem-metrics/registry/retained.ts以JSON.stringify摘要包含opaque origin；JSONB改变origin字段排列。平台nativeRegistry/source.ts已有固定14字段原来源顺序。只恢复这一完整已声明本地来源的编码顺序，通过严格14字段schema读取；其他来源形状沿既有opaque契约，不省略未知字段。该schema值约束与生成器已有来源完全对应，任何UID、容器、镜像、卷、节点、物理路径或epoch变化都继续影响摘要。

真实原件的只读重建证据 /tmp/cs-rfc037-i36-registry-origin-order-proof-v1.json 表明两者origin字段和值均未变，完整physical scope、nativeHistory digest全部精确再现。原件和旧摘要不改，不采用新birth、不引入兼容身份白名单。修复落在原registry/retained primitive；回归为filesystem方法用例与platform既有OwnerComposition的真实PG JSONB保存/重读/重建工厂，以及身份和未知字段变化拒绝。持续中的T14唯一完整门不取消、不重复；此增量单独检查并以新确切提交树六CI为准。


## I36-T16 原Registry完整读取的测量竞争

只读最小适配器在现有controller读取原留存registry历史，未构造平台Root、未打开DB、未执行写许可；原controller UID／容器／OCI／restartCount保持。release连续328次精确测量busy409后在内层35081ms退出；runtime同原身份等待后30415ms完成完整graph／全部消费者／再次graph读，consumerCount=0。原source外围40秒与client默认35秒不一致，使正常完整读取被短内层预算中断。将该安装来源的整个capture与内层client统一为60秒，全部K8s分页、原Pod/PVC/PV/Node/probe、原filesystem epoch、时间和范围验证原样；精确busy才重读，未知409/403、到期和调用者取消一律拒绝。测试压缩真实35/40/60秒定时器，使用实际busy重试、实际文件图与原K8s来源，拒绝永久忙和未知冲突；不延长任何产品销毁许可。TaskRuntime仅对齐已有相邻真实PG用例15000ms整体预算，全部实际断言保持。修订候选唯一全库检查排队，确切提交六CI、实际部署与原操作全部AFTER分别留证。


T16最终固定3路径真实4文件22／0、119断言，精确lint和后端类型通过；console类型与结构沿未变更层复用，静态共4／4，官方改动行3／3、100%。初始测试fetch签名类型错误已修正，原static-v2失败保留，最终static-v3通过。原T15全库6382／157／1超时原样，第二条真实PG整体预算按相邻用例修正而实际封闭断言不改；新固定候选唯一全库检查排队，不能当作通过。按作者最快上库/部署授权接确切提交树六CI；六CI成功才部署，原项目实际回收及全部独立AFTER继续。


## I36-T17 原 Registry 探针宿主地址报告与物理身份

2026-10-07 实机：69c13b65 六项 CI 成功、八组件及256迁移实际就绪；同原操作的22方重新盘点全部完整，于新计划创建约2秒内实际提交两次确认，服务端在有效期内拒绝。API 原实例无重启，runtime-environment 原来源校验32行阻断。最小只读工厂没有 Root/DB/写许可；采集前后唯一被 pin 对象的变化是原探针 Pod 的 status.hostIPs 增加第二地址、resourceVersion 及 kubelet/status 已有管理项 time，UID、全部容器、挂载、spec、labels/annotations保持；后续只读观察第二地址又被撤回。原错误、计划与确认材料分别保持，当前7份seal回执未冒充回收。

修复边界：只有 Pod 同一个 primary hostIP 下，格式完整且唯一的一族宿主地址与两族地址互相增加/撤回时，才可忽略这份 hostIPs 报告及已有 kubelet/Update/v1/status/FieldsV1且登记hostIPs的管理项 time，并比较除此以外完整原对象。两边resourceVersion仍须存在；单独版本变化、主地址/次地址替换、重复或未知host字段、UID/容器/镜像/Ready/重启/节点/挂载/归属/metadata/其他status/管理者及管理字段变化全部拒绝；Namespace/Service/PVC/PV原完整版本守卫不变。原域/卷epoch、文件完整EOF、真实原来源身份、调用者取消、60秒硬界和精确busy重试均不变，不认领替代物。

这兑现作者已批准的原身份/归属变化仍阻断及外项目完整保留条件，仅修复不参与路由或物理归属的已实证状态报告，未改变清理范围；先实际文件系统红例再完整正反回归、静态和改动行防护，冻结新候选。已启动的T16完整门不取消，终态如实保存；新候选唯一完整门串行等待，不把旧结果冒充新候选。精确提交/CI/部署、同原操作最终受理和九项独立AFTER仍待实际证据，RFC保持In Progress。

T17 自有最终候选：真实文件系统红37/1、绿42/0及138断言，官方新行22/22；精确lint通过，当前共享后端仅两份外部未跟踪开发观测/Runner用例类型失败，原文件保持，console/arch既有未变化层保持。不称共享四层或完整门通过。3路径完整候选唯一排队，原T16完整门不取消；按照作者最快上库授权与开发规则§3，精确提交树六CI必须通过才部署，原154回执与全部AFTER必须完成才闭合。
## I36-T22 原项目身份与调和租约

2026-10-07 原操作重新盘点实证：项目受理后仅 state 从 active 变为 deleting、revision 从 4 变为 5；观测 owner 保存的完整原目标摘要仍属于首次确认。通过 project 的内部公开能力读取首次受理计划的原目标，验证完整原摘要及除生命周期状态／修订外的全部目标字段一致；不重写观测原屏障，不推导或补造原身份。首次计划缺失、目标字段变化和旧别名冲突仍阻断。

资源台账的七条过期调和租约来自既有控制器；原内容触发器禁止释放，却允许封闭后重新获取，造成已封闭范围持续变化。追加迁移只更换 leases 表的屏障：原在途持有者可续约和释放；封闭项目的 present 记录不接受新租约或过期租约复活，absent 记录继续允许实际停止调和。退休后仍拒绝普通写，原删除许可保持。维护仅提前回收封闭项目已过期的协调租约；外项目保留原维护期限。所有物理声明、原记录、准入与世代守卫保持。

真实 PG 回归必须覆盖首次计划在重新确认后保持、缺失来源与目标变更拒绝、全部七阶段与外项目观测保留、在途租约释放／续约、过期不复活、停止调和和外项目租约保留。固定候选只跑一次完整门，随后精确上库、确切 CI、原存储守卫部署及同一原操作独立 AFTER；未通过时不记完成。


2026-10-08 I36-T22 固定十二项功能候选与真实 HTTP 运输及原 STOP 两项测试夹具完成修正候选的实际完整 `bun run check`：6465 pass／158 环境 skip／0 fail、450140 断言、1313 文件；arch、lint、后端／console／arch 类型检查均通过，首末十二项功能与两项补充测试夹具内容摘要保持。真实 PG 相关 65／0、564 断言，新增可执行行 18／18 防护。首轮专用 PG 完整门6457／158环境skip／1fail，仅原观测全用例30秒超时；原断言诊断通过，阶段stop约20秒，框架预算调90秒，产品请求预算和全部断言保持；实际正式原用例27断言通过。较早 SQL、入口诊断依赖和测试类型失败保留，不混计通过。默认本地 PG 的完整门6456／159环境skip／1fail，仅 max_prepared_transactions=0 导致原生预备事务用例55000；该环境失败和候选首末相同的证据保留。配置已核实的接续门在他任务新增 runnerLifetime 86行/80行 lint 处停止，未进入测试；并发输出完整保留，等其候选修正后继续。真实原生预备事务原文件单项1／0、5断言通过，日志摘要解析错误另保留而不重跑该用例。其后实际完整门6460／158环境skip／2fail／1收尾error，统计夹具默认5秒超时和并发Session候选待握手退出原断言2/1失配；候选内容和完整失败日志保持，该轮未发布。随后实际共享完整门6464／158环境skip／1fail，唯一失败为原HTTP监听器413收到503；完整失败原文与不变候选保留。原用例隔离及63前序文件均通过，不覆盖完整失败。受控fetch模拟可复现旧夹具失配，但未证明该轮具体干扰来源；补充测试修正采用node:http真实本机连接，原32/256限额、65闲置与四项断言保持，增加模拟调用为零的断言，真实5／0、27断言及精确lint通过，独立复核VALID/PASS/P1=P2=0。正式完整门设置loopback NO_PROXY/no_proxy，其余代理保持。随后实际完整门6463／158环境skip／2fail，原TaskRuntime STOP两个串行PG组合在默认5000ms框架期限超时，原完整失败及首末稳定内容保持。原测试体诊断完成全部5项42断言，实际四次STOP约528／808／1686／64ms，连同PG准备、封闭与清理接近默认总预算；未证明该轮具体负载成因。仅两个用例显式15秒框架预算，与相邻存储用例相同；全部原代码和断言可字节还原，产品期限及其余框架预算保持。正式原5项及相邻2项7／0、72断言和精确lint通过，无CLI期限覆盖；独立有限复核绑定同一摘要。最终复用修正后的十四项候选与并发七项候选共同完成的真实成功完整门，首末十二项功能与两项补充测试夹具摘要和本候选逐项相同，不另开等价完整门。最终完整门使用原实际专用 PG d123、与已提交 CI 相同的 max_prepared_transactions=10，通过正式 CS_TEST_DATABASE_URL 和 CS_TEST_REQUIRE=database 配置，未关闭或伪造能力。首次计划原目标证明与租约追加迁移按已批准设计；既有原身份、许可、世代、二次确认和物理清理守卫保持。确切提交六项 CI、八组件守卫部署、同一原操作的 154 回执和独立 AFTER 仍待完成。


## I36-T23 原节点读取与嵌套探针状态核对（2026-10-08）

3100a14d 的六项准确提交 CI 与八组件实际部署已经通过，原操作仍 generation3/seal/19 回执、未进入物理删除。两次最新正式盘点分别在 nodeProcessOwners.ts:24 和 nodeFileConsumers.ts:34 返回来源不可用；原警告及两份失败计划保留。原探针进程来源的独立实际 HTTP 读取完整，原 boot/PID/cgroup/Pod/容器身份保持；仅 release Registry 的独立读取也完整，未创建额外 Platform Root。不能将统一的 original-identity-changed 提示当成物理替换事实，亦不推定失败时的具体进程或状态变化。

兑现已有暂时来源退避与 I36-T17 的原完整身份规则：process-owners/transport 在同一调用者期限内，仅对 process-changed/process-unreadable 重新读取原完整 owners 请求，保持 boot/PID/cgroup、原请求与所有者键；未知来源、换身份、未知冲突、取消及到期仍拒绝。首个不完整捕获的有效来源也固定，不能在等待后接管新出生。nodeFileConsumers/nodeProcessOwners 复用 Registry 已批准的完整 Pod 比较函数，只有主宿主地址不变、合法另一地址族发现/撤回及指定 kubelet 管理时间能不同；除此之外完整对象必须相等，原版本号仍必需。Namespace/Service/PVC/PV、物理范围、60秒总期限和七阶段准入保持。既有 Registry 函数逐字移至同适配层 nodeProbeObservation，不增加例外。

进程回归先红3/3；真实文件系统嵌套状态回归先红2/1，失败定位同原 nodeFileConsumers.ts:34。修复后原三文件47/0、159断言通过，原 Registry 21类身份/未知字段/存储拒绝保持。新增持续失败期限、调用者取消、部分读取出生变化与全 owner 键检查。冻结新七个源码/用例候选，唯一完整本地门与新准确 SHA 六CI、原存储部署后接同一原操作；此前6465/158/0仅作为旧候选实际通过，不冒充新候选门。


I36-T23 的第一次全量实际在 `typecheck` 发现新增测试 fixture 的 `version` 被推断为 `number`（TS2769，两个 `toEqual` 的响应型不符）；架构和 ESLint 已通过，全量测试尚未启动。原 FAIL 与日志保留为 `cs-rfc037-i36-node-observation-full-v2/result.json`，不得当作全绿。只给两份 fixture 声明既有 `ProcessOwnerResponse`、给两个 source blocker 字面量保留窄类型，未改断言或生产逻辑；随后独立 `bun run typecheck` 通过，3 文件原 47/0/159 回归再次通过。冻结候选 v2 后全量 v3 正在执行，尚未提交、部署或物理删除原目标。


I36-T23 修正后的七项节点读取候选与原14项内容固定，实际完整 `bun run check` 于 2026-10-07T20:31:58.001146+00:00 完成：6468 pass／158 环境skip／2 fail、450215 断言，arch/lint/前后端类型检查通过，首末21项内容相同。证据为 `cs-rfc037-i36-node-observation-full-v3/result.json` 和原完整日志；此前测试响应型 TS2769 的 v2 FAIL 保持。原47／0、159断言针对性回归和七文件精确lint通过；原集群观测/台账43／0、258断言独立诊断通过，原断言未改。完整门仍记FAIL：集群观测计数断言失配，具体全量成因未证明；另一个原生运行测试涉及检查期间改写的外任务源码/用例。按开发规则§3共享WIP例外精确提交本任务路径，不把局部成功当成全量成功，不重复同候选完整门。提交后的干净准确SHA六项CI必须全部成功才能部署。实际两镜像部署和原项目物理回收仍待实证，不标记RFC完成。


## I36-T24 重新确认的服务器受理计时（2026-10-08）

aebbda4a 的实际八组件部署和六项 CI 已核验，完整 console 树及本任务21项已验证内容与8ef40b4c一致。当前原操作仍 generation3/seal/19，原存储、探针、默认运行镜像和259项迁移保持。实际新一轮盘点等待期间，真实专用 PG 的 `deletionReconfirmationAdmission.test.ts` 稳定复现1 pass/3 fail：及时提交因后台核对跨过600000ms而被拒绝；提交时已过期仍先调用22方来源；身份变化的正确拒绝原因被后置期限判断覆盖。原始红证据保留于 `cs-rfc037-i36-reconfirmation-admission-red-v1.json/.log`。

原因锚定已部署 aebbda4a 的 `modules/provisioning/application/deletion/controller.ts:34` 与 `modules/project/application/deletion/reconfirmation.ts:36`：完整盘点发生在 project 意图方法调用前，期限判断使用盘点后的时钟。修正落在 provisioning/application 编排及 project/application 意图；三处既有 API/ports 只增加服务器内部的异步盘点供应器类型，既有数组调用继续可用，HTTP/Zod输入保持原形。project 在入口固定自身可信时钟，并经真实管理员资格、原请求重放和原操作/计划关系读取验证后检查十分钟窗口；过期请求当场拒绝。长盘点在数据库事务和角色锁之外执行，完成后再次核实真实管理员资格，在原事务内重新锁定请求/操作/项目并核对 supersedes、完整来源、原物理身份、摘要及阶段。确认时间使用服务器入口时间，更新/事件时间使用实际完成时间。

同键重放保持原回执。计划期限仍600000ms，原生范围、世代、seal/stop/七阶段屏障、B逐项保留和最终独立核验继续完整执行。回归覆盖及时提交跨窗、过期零盘点、来源换身份/不可读、原键过期重放及伪造管理员拒绝；补充盘点中撤销资格与改变摘要的拒绝。红绿后冻结唯一候选并执行本地门、准确提交六CI及实际原身份部署，再继续同原操作的真实154回执和九项独立AFTER。


I36-T24 完整门和补充夹具（2026-10-08）：26项固定内容的实际完整检查6482／158／1、450596断言，七项确认计时真实PG回归均通过；唯一失败为原文件消费者取消夹具未及时监听预期拒绝，完整FAIL原文保持。只新增提前接收原Promise拒绝及Error类型断言两行，可逐字恢复原用例；FIFO、取消位置、原错误断言和期限不变，未改产品逻辑。正式八项8／0、32断言及lint通过。新27项候选因该实际内容修正而执行一次完整v2；076f78be仅外任务文档推进，不作为重跑理由。精确发布、六CI、保留当前admissions的原存储／探针／默认Runner部署、同原操作154回执与九项独立AFTER继续，未宣告完成。


2026-10-08 I36-T24 最终固定候选完整 `bun run check` 于 2026-10-08T00:28:18.594707+00:00 至 2026-10-08T01:14:59.158090+00:00 实际终态退出0：6483 pass／158环境skip／0 fail、450589断言、6641用例／1317文件，27项首末及当前源码／测试摘要全部保持，原日志SHA已独立核对。真实PG确认计时7／0、50断言及正式取消夹具8／0、32断言保持，旧完整FAIL不覆盖。浏览器已恢复为Browser5/tab1并实际显示原项目和原操作01a11338-80af-7000-a710-9322722ebba4；01:00只读PG仍generation3/seal/19，无物理清理。本候选精确十路径提交推送、准确六CI／两镜像原身份部署、原操作最终二次确认／154回执及九项AFTER继续；RFC仍进行中。

## 清理工作器容量（2026-10-08 实机补充）

同一原删除在19份封写回执之后，controller出现三次实际OOMKilled／exit137。1Gi上限无法容纳日常协调和完整集群盘点同时运行；原操作/回执继续保留，租约到期后恢复，不用删除数据库事实或更换测试项目绕开。当前Pod先通过Kubernetes resize原地提升到2Gi，真实cgroup/Pod与容器身份及其他spec均核对。将部署声明同步为2Gi，CPU与requests保持，避免后续部署恢复旧上限。该容量修正单独执行28项固定候选完整门与准确CI；不把旧27项门禁或一次成功resize冒充最终清理完成。原操作实际完成和独立AFTER通过后，持久容量部署还须复核当前八组件镜像/Ready及保护资源。


## I36-T26 首次封写与当前租约的代次恢复

2026-10-08 实机原操作已 stop/generation12、27回执，SCM停止证明完成。runtime_environment.deletion_fences 仍保留首次 generation1、phase_index0、verified=true；其原 revision 与当前受理计划逐字相同。只读证据为 cs-rfc037-i36-runtime-stop-fence-actual-v1.json 和 runtime-stop-revision-actual-v1.json。源码 project/application/deletion/progress.ts:17 每次合法接手会提升全局租约代次，runtime-environment/adapters/persistence/projectDeletion.ts:40 却把它与首次封写代次等同，从而拒绝原停止。release、cluster-management、observability 具有同类比较。

这是原RFC已批准的同操作可恢复路径缺陷。当前全局 context 仍由 project.assertProjectDeletionGrant 验证有效租约、当前代次、阶段、原目标与完整确认材料；模块在实际独占锁内、提交前再次验证同一个当前许可。模块固定封写范围的 generation 保持其原值，不能重写原出生、物理范围、确认修订或阶段回执。合法当前代次必须不小于封写代次，原操作与 revision 必须完全相同；原封写或原范围缺失、旧许可、未来封写代次、换操作、换修订、错阶段、未知消费者仍拒绝。

已有SQL阶段守卫使用固定封写代次的 owner 标记；此标记只在验证当前全局许可并锁定原模块屏障后设置，phase 与当前许可保持相同。不改变已安装SQL守卫、不增加迁移、不回退全局代次、不人工改库，也不重新封写、清空或补造原回执。恢复时沿原phase_index继续，观测阶段摘要使用固定封写代次以保持重放稳定。真实PG回归覆盖多次接手、全部七阶段、未记录到全局时的模块回执重放、权限失效回滚、错误原身份/修订/阶段与外项目内容保持。新功能候选实际变动后执行唯一完整门、准确源码六CI及原资源保护部署，再接同一原操作最终154回执和九项独立AFTER。容量2Gi随该源码提交和部署固化，未执行的容量单独发布脚本不使用。


2026-10-08 T26固定34项候选唯一实际完整门终态PASS：6491／158环境skip／0fail、450688断言、6649用例／1319文件；2026-10-08T04:09:16.081006+00:00至2026-10-08T04:58:30.450585+00:00，所有34项内容保持。准确提交／六CI、守卫部署与持久2Gi、同原操作154回执和九项AFTER继续；此处不把最终任务标记完成。原四项恢复红结果、原28项外任务FAIL及全部旧证据保持。

## I36-T27 原 Pod 停止接口的对象键

2570d110 的准确六项CI与八组件实际部署通过，2Gi声明及实际cgroup已核验。同原操作接续后runtime-environment stop成功，原28回执与两份确认保持；release在进入原Pod停止接口时被阻断。只读原材料证明：native工作目录对象键只有kind／namespace／name，而resources确认的protected:Pod键完整包含apiVersion=v1。cluster-control公开stopSelected接口按原确认键精确匹配，因此缺失API版本的键不能进入停止。原Deployment已依法进入终结，原Pod保留停止观测finalizer；没有停止回执，不把Pod已结束状态冒充实际持久证明。

仅在platform/adapters/k8s/nativeProjectWork/pods.ts的跨模块调用边界构造完整v1/Pod确认键，工作目录及原物理scope、UID、spec摘要和回执均不重写。cluster-control的原键、原UID、确认范围和finalizer／停止证明守卫保持。platform既有nativeProjectWork.test.ts通过公开cluster-control工厂覆盖原资源参与者许可、完整确认键及已有停止证明；未确认的外Pod仍拒绝。先红后绿，冻结包含该两文件的新候选执行唯一完整门；准确源码六CI和原资源守卫部署通过后，继续同原操作及全部独立AFTER。这是已批准原清理流程的接口修复，不新增销毁范围、确认或操作。


2026-10-08 T27固定36项候选唯一实际完整门终态PASS：6492／158环境skip／0fail、450695断言、6650用例／1319文件；2026-10-08T05:54:56.126608+00:00至2026-10-08T06:51:53.551034+00:00，全部36项内容和原日志SHA保持。公开工厂组合的原红结果保留，正式相邻11／0、84断言和静态门保持。精确五路径发布、准确六CI、守卫八组件部署和同原操作最终154回执／九项独立AFTER继续；此处不将最终任务标Done。原c646受理与T26的真实门、准确CI、实际部署均单独保留。


## I36-T28 SCM 文件出生身份核对与清理工作器内存（2026-10-08）

T27 的准确提交238f29be46d9、六CI和八组件部署均实际通过。同一原操作继续后已有30回执及两份确认；controller在2Gi上限发生实际OOMKilled/137，随后恢复至stop/generation17并被SCM阻断。只读原生证明与同一GitLab实例的描述符元数据核验确认：tail／svlogd的三个GitLab日志句柄复用了原pack文件的device/inode，实际birthtimeNs全部不同，原目标文件已不存在。真实诊断保存于cs-rfc037-i36-scm-stop-proof-diagnostic-v4.json及scm-consumer-birth-readonly-v1.json，失败与原基线保留。

沿原已批准的出生身份设计修复SDK活动协议、Linux消费者观察器及SCM适配器：请求可携带原已封存的birthtimeNs，按device/inode/birthtimeNs去重和绑定；同inode而可核实不同出生的对象不属于原目标。旧二元组调用保持保守行为，出生信息未知仍阻断；重命名、未关闭的已删除文件、映射、cwd/root/exe与原PID/TID/boot/ns守卫保持，不按路径或进程名称忽略消费者。Ruby statx只读元数据，前后device/inode一致才能核对出生；无法证明的引用不得解释为空。

controller保持2Gi／CPU／requests，启用Bun --smol增加GC频率以降低瞬时内存占用；最终须以原操作实际完成及真实Pod内存／重启事实验收，不把参数变更当作OOM已解决。只更新同端口／认证／固定原来源的宿主SDK观察服务；原GitLab容器、原Probe、数据库及卷、默认Runner和所有外项目保持。先实测身份复用红绿、旧调用兼容与未知／原文件消费者拒绝，冻结新候选并执行唯一完整门、准确提交六CI和守卫部署。随后由原界面继续同一操作，不重发确认或改变封存范围，实际154回执、九项独立AFTER、成功界面和创建弹窗验收仍须全部通过。


T28验证接续：真实修正前SCM与协议2项失败、Linux原观察器拒绝出生字段的失败均保留；修复后正式相邻18 pass／0 fail、122断言与隔离Linux22项真实文件用例通过，精确lint、后端类型及架构均通过。正式候选观察器在同一原GitLab只读核验三个复用inode消费者已全部消失；该次workhorse仍有1个在途请求，实际证明仍waiting，未冒充停止完成。原四个封写、30回执／两确认与旧28回执完整保存。新44项候选冻结，唯一完整检查通过shared full-gate锁排队，尚未启动；前一08:06的检查不含本候选冻结前的完整内容，不能借作新PASS。native句柄47417、full-queue-v2保持等待，不重复完整门。精确12路径发布、准确六CI、守卫两镜像／八组件及原认证观察服务部署、同操作继续／154回执、九项AFTER和八文档归档脚本已经准备，均受真实结果守卫，尚未执行。


## I36-T28 源端授权补查与真实门禁记录

`deploy/local/scm-native/grants.ts` 的 purge/removal 前置校验也必须提交原＋当前完整 `device/inode/birthtimeNs`，以三元组去重并稳定排序，避免控制端已经排除的日志 inode 复用在源端再次误阻断。未知出生身份、真正原消费者与在途工作仍阻断；原材料、许可、固定来源和双层确认不变。新增两条源端回归先红后绿，完整相关用例 23 pass／167 断言，精确 lint、typecheck 与 arch 全过。

实际整库 44 项候选保持，6494 pass／158 环境 skip／1 fail，唯一失败为范围外并发在制 `nativeNumericWork` 120 秒超时。该失败原样保留，不能宣称最终 46 项全量通过；新增两项使用针对性检查，按开发规则 §3 只精确提交本任务文件，以准确提交的全部六个 hosted CI 作业判定是否可部署。

- [x] I36-T28：完成准确提交 CI、源端与平台部署，沿用原操作完成全部物理 AFTER 和创建弹窗验收后再收口。

## I36-T29 原 Pod 回调恢复的精确读取（2026-10-08）

T28已完成准确提交7c311bd1六项CI、八组件部署与原SCM出生身份修复；原操作继续后正式保留SCM stop回执。后续dev-session停止调用既有整体Pod恢复观察器，恢复器为14条旧Pod待退出回调读取外项目全部历史；现场original_callbacks共1356261行，目标项目0行，三个已停止平台Pod的待恢复记录仅14行。保留原运行操作、原确认和原全量失败，不能删除外项目历史来解除等待。

此增量只在modules/dev-session/adapters/persistence/deletion/workHistory.ts既有内部分页读取增加可选原Pod过滤，在workRecovery.ts恢复调用传入已由DevelopmentWorkPodSchema及整体停止见证校验的原身份。SQL同时限定project_id、exited_at IS NULL、完整podUid/nodeUid/nodeName，依旧按C排序游标读到EOF；每行保持完整出生、退出与授权Schema校验，恢复循环原再次身份检查、受保护整体Pod证明、事务、原更新及退出摘要均不变。默认完整历史与盘点读取继续遍历全部原行，不加迁移、索引或新契约，不改变外项目资源和历史正文。

实际PG回归先红后绿：恢复205条匹配待退出回调（超过200分页），数据库读取边界不向恢复器返回已结束历史或其他Pod/节点/节点名的待退出记录；匹配退出摘要完整、三类不同身份待退出保持、已结束原行逐字段保持。既有整体Pod和节点保护、防伪造、finally与完整历史用例同时通过。精确静态和准确SHA全部六CI后部署；原操作不重建，最终同项目154回执及九项AFTER仍为收口条件。

T29真实回归已完成：修正前新用例0／1（数据库把1条已结束记录和3条不同身份的待退出记录也交给恢复器）；修正后开发删除全部8文件25／0、850断言，覆盖205条原匹配回调、不同Pod/节点/节点名不变、原结束历史不变、完整历史与旧finally护栏。精确3路径lint、后端类型和架构通过，49项候选摘要未变。此前44项实际整库FAIL与7c311bd1准确六CI全部PASS保留为历史；本轮使用开发规则§3并发在制品的精确检查路径，当前49项的完整权威结果以其准确提交六CI为准，不借用历史全量或宣称新全量已跑绿。原操作仍running/stop，已新增SCM停止回执，未重复确认或改写原来源。

## I36-T30 全部回调恢复器的数据库读取边界（2026-10-08）

T29准确源码30bb782f8d5c的六CI和八组件部署通过，原操作已保留dev-session/stop回执，共32份／两确认。继续只读核验发现business-task恢复仍遍历1600772条历史、待退出5条；task-runtime同类恢复遍历1759600条历史、待退出14条，目标原回调均为0。一次性检查全部四个回调恢复模块：dev-session已有精确过滤，session在原事务内直接按完整Pod身份更新，不存在这一全历史物化问题；本轮只修复business-task与task-runtime。

两处既有内部分页历史读取增加可选、严格Schema校验的原Pod元组；仅整体Pod恢复调用传入该元组，SQL同时限定项目、未退出、原podUid/nodeUid/nodeName，保留C排序、200分页直至EOF、完整原行Schema、事务、再次身份核对和原退出摘要。默认完整历史、盘点及封写仍完整读取，运行模块的游标单调性保护保持。不删除外项目历史或运行资源，不新增迁移／契约，不改原删除范围、确认或操作。

两条新真实PG数据库边界反例均先失败（各多返回1条已结束和3条不同身份记录），修复后跨205条待退出回调的完整分页、不同Pod／节点／节点名完整原行保持及退出摘要全部通过。三个模块删除目录与会话恢复共122 pass／0 skip／0 fail、2972断言；精确6路径lint、后端类型和架构全部通过，55项源码／测试／部署指纹保持。依据开发规则§3精确检查并等待准确提交全部六CI后部署；历史T28完整FAIL和T29回执原样保留，未宣称当前本地全量已运行。原操作真实154回执、独立资源AFTER及成功界面通过前不标Done。


## I36-T31 完整盘点复用不可变来源（2026-10-08）

T30准确提交d4bc004a1ba9六项CI和八组件实际部署全部通过；原操作已完成22方停止，进入purge并保留48份回执／两次原确认，随后因SCM owner-failed暂停，真实原日志保留。TaskRuntime完整盘点仍逐条遍历约1759600份历史回调，每条重复读取相同不可变work_origins；现场只读SQL证实重复查询。

本轮在每次RuntimeContentSources实例内按[originKind,originKey]复用真实最小来源的Promise。首次读取仍通过原摘要与严格Schema；缺失仍拒绝。每份回调仍独立核对完整出生Schema、原ID／项目／revision、原项目公共身份及关系，完整11表所有行、C排序、200条游标到EOF和目标内容摘要均保持。缓存不跨盘点、事务或操作，不新增迁移／契约，不删外项目历史。

真实专用PG反例先红：507份回调返回507份来源查询，而非两份不同原来源。修复后完整游标盘点507行、目标506行、外项目原行完整保留；两次盘点分别真实读取两份来源，第二次重新读取而非复用前次缓存。末页第505份待退出回调的revision篡改仍被逐行关系验证拒绝。相邻删除回归123／0、2981断言；精确两路径lint、后端类型和架构均通过，57项候选保持。按开发规则§3的并发在制品例外精确发布，准确提交六CI通过后部署；旧44项完整FAIL、T29／T30真实验证分别保留，未宣称当前本地整库已跑绿。

- [x] I36-T31：准确六CI／八组件部署、恢复同原操作154回执、九项独立AFTER和真实成功界面全部通过后收口。


## I36-T32 原 SCM 空范围的幂等清理（2026-10-08）

T31准确源码53bad968已经提交推送并构建两镜像，六CI正在执行，尚未部署；为避免额外平台滚动，空范围补正与T31在下一准确源码一并部署，当前实际平台仍为d4bc004a。原操作仍48回执／两确认、needs-attention/purge。真实同安装只读诊断v5完整返回done，原生记录／文件／消费者均为零，原源码摘要与范围摘要完整绑定；该诊断不修改资源。原purge通路仍对已为空的范围再次执行原生purge/removal。原队列只保留包装异常，不声称已确认该次底层异常的具体原因。

修复只在既有完整独立proof返回done且nativeRemaining与storageRemaining同时为0时，重新核验当前持久许可后返回原证明。首次验证继续执行全部原范围材料、原安装身份、外国引用、所有类别、真实活动消费者和二次稳定读取。任何非零、waiting、来源不可读、替换身份或许可失效继续原路径／阻断，不根据HTTP ACK、元数据计数或标签推断零，不增加白名单或删除权限。非零范围仍按原守卫实际清理并独立证明。

新增受控原协议反例先失败：空范围仍发原生mutation；修复后同范围跨generation重放、两次完整活动读取、原材料不变及grant过期／活跃消费者／不可读／替换安装阻断均通过。实际专用PG两文件22／0、167断言；两路径lint、后端类型和架构全部通过。57项候选仅更新原SCM两项指纹，T31缓存的123／0／2981断言及全部未变源码继续有效；按开发规则§3精确发布并等待最终准确六CI。原44项整库FAIL保留，当前没有重跑本地全量。

- [x] I36-T32：准确六CI／守卫部署后恢复同原操作，原154回执、九项独立AFTER与成功界面通过后收口。

## I36-T33 原节点文件消费者的出生身份（2026-10-08）

a4778e 的准确六CI与八组件实际部署全部通过。原操作经原界面继续后保留51份回执及两次确认，SCM、api-catalog、runtime-environment 的purge已通过，release暂停。只读实机完整复盘确认原发布Pod与工作文件为0；原BuildKit选定缓存与history均为0，69份外缓存及49份外history保持。唯一报告的文件消费者为postgres PID3523750：旧目标目录 snapshots/4/fs/src/events 的device65025/inode314684/birth1790784077215050002已不存在，该inode实际被同一受保护Postgres Pod中的新FSM普通文件复用，出生1791473962286347013。原操作、封存材料和失败证据均保留。

延续T28已经批准的原文件出生身份语义，在通用Linux消费者观察器及协议中保留可选birthtimeNs。已知出生须按device/inode/birth绑定；旧二元组调用仍保守，未知出生、缺失映射元数据、PID/TID/boot/ns或原安装变化仍拒绝完整证明。文件描述符、映射、cwd/root/exe和未链接但仍打开的原文件均继续覆盖，不按进程名或路径忽略消费者。

原只读Probe镜像、Pod、UID及全部既有材料不替换。由同一原节点上的既有私有Registry观察服务补充出生身份读取：沿原认证、固定节点／Probe及真实宿主boot/ns校验全部消费者，只接收文件身份，不接收路径、PID、命令或完成布尔值。前后重核原Probe容器／镜像／挂载、节点与完整宿主来源。控制端继续使用原NodeConsumerOrigin，完整源端结果绑定原身份后才计算消费者数。该入口只读，不扩大项目销毁范围，不改变RBAC、确认、封存或物理删除权限。

针对真实文件出生复用、仍打开的原文件、映射及未知出生先红后绿；私有HTTP认证／输入／原来源替换与控制端完整绑定均带回归。精确候选检查、准确六CI和同安装观察服务／八组件部署通过后，再继续同一原操作，最终154收据、九项独立AFTER和成功界面全部通过才收口。


## 2026-10-09 完整交付

实际运行 `05f6acc63d49481e3a3ac6f1cefa16ac2d981ae9` 六CI／八组件／同安装观察服务通过；原项目同一操作 succeeded／154唯一回执／两确认、九项独立AFTER、外项目完整保留及真实成功／创建弹窗通过。[最终实机验收](acceptance/complete-deletion.md) 汇总最终事实。此前日期段落为相应时点历史；原FAIL保持，当前92项本地全量未重跑，TaskRuntime临时排序修复Linux47／0／1052、此前集群定向55／0／465、原未变出生定向141／0／819及准确提交CI分别留证。
