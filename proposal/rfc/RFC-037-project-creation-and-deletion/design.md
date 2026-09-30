# RFC-037｜技术设计

> 状态：In Progress · 2026-09-30 · 完整方案已获作者批准；下文为实施合同，完成情况与证据见计划，不代表已经全部实现。
> 配套：[产品提案](./proposal.md) · [实施计划](./plan.md)

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
