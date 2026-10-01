# RFC-036｜技术设计（已批准）

> 基线：main `bebb3d9b3b2a879a8e8ecf9b56b818fc912b15b7`。作者已批准实施；结构决策见 ADR-0011。

## 1. 已有能力与缺口

| 当前事实 | 源码依据 |
|---|---|
| SVG 分层排布、节点聚焦、键盘选择和关联高亮已存在 | `apps/console/src/shared/ui/topology/TopologyDiagram.tsx:39`、`topologyLayout.ts:22` |
| 拓扑详情已使用统一 Dialog，保留图与筛选挂载 | `apps/console/src/shared/ui/topology/TopologyWorkspace.tsx:49` |
| 管理员资源页当前有服务、算力、镜像、并发和限流五张卡片 | `apps/console/src/features/admin/pages/AdminProjectComputePage.tsx:30` |
| 能力聚合已有身份、地址、配额、默认规格、算力、配置、数据、API、订阅和 MCP | `modules/capabilities/application/describeCapabilities.ts:22` |
| 项目算力目前为 inherit／restricted；继承只允许 defaultVisible | `modules/agent-runtime/application/projectProfiles.ts:15` |
| 运行镜像已有默认开放与项目授权 | `modules/runtime-environment/application/access.ts:18` |
| 对象档位默认空集合，供给时检查项目授权与后端 | `modules/data/adapters/persistence/objectCatalog.ts:65`、`:133` |
| API 申请目前按 develop 校验，管理员审批 | `modules/api-catalog/application/requestAccess.ts:12`、`decideRequest.ts:13` |
| 生产数据访问目前按 develop 申请、approve-data-access 审批 | `modules/data/application/taskBindings.ts:38`、`:51` |
| 执行、工作区、归档助手共用项目并发额度，服务槽不占该额度 | `modules/resources/domain/kinds.ts:43` |
| 命名空间配额目前是平台固定模板，尚无项目级调额合同 | `modules/provisioning/domain/namespaceProjection.ts:12` |

历史 `/projects/:id/resources` 是参考资源旧地址的跳转。建议新增 `/projects/:id/resource-center`，保留旧书签的既有语义；管理员复用 `/admin/projects/:id/resources`，将旧五卡编辑收进节点弹窗。双方共用业务 feature，路由和外壳由 app 装配。

## 2. 领域分层与扩展

- `resources`（L1）继续拥有实际工作负载／数据资源的标准台账，不将未授权目录项写成已经存在的资源。
- 各领域继续拥有规格、分配、数据库绑定、对象空间、API 授权等事实；调整仍调用所属模块的公开 API。
- 建议新增 `resource-access`（L3）拥有跨类型申请、决定、应用回执和目录可申请政策。依赖 project 的身份／角色；访问其他领域走注入端口，不跨 schema、不同层深引用。新增模块必须先补获批 ADR。
- `capabilities`（L6）增加项目资源全景只读聚合，逐来源提供时间、完整性与可行动作。`platform`（L7）仅组合资源类型适配器和领域端口。
- `packages/contracts` 增加序列化快照、申请及动作合同；`packages/api-client` 提供调用。
- 前端 `features/project-resources` 承担状态、表单、申请记录；`shared/ui/topology` 保留通用绘图。图数据组装通过稳定身份映射，不复制绘图器。

类型适配器按 `resourceType` 注册：目录读取、有效授权、计量、可申请字段、审批影响预览、幂等 apply、回执查询、撤销规则。界面按后端 action descriptors 显示操作，禁止用前端类型列表决定权限。

## 3. 资源全景合同

节点身份分四类：`catalog:<type>:<id>`、`allocation:<project>:<type>:<id>`、`resource:<uuid>`、`request:<uuid>`。物理子对象另用 Kind／Namespace／UID 标识。聚合节点带 memberIds 和分项数量，不代替事实身份。

每节点包含：名称／类型／环境／归属、来源、授权状态、实际运行状态、配额与用量、默认项、消费者、更新时间、可执行动作。

授权状态：`owned | requestable | pending | unavailable`；已有节点可同时有一个 pendingChange。已有来源：自动供给／平台继承／项目授权；已授权未使用为 owned，运行状态为未使用。

配额以 `metric + unit + scopeId + used + reserved + limit + requestedLimit + observedAt` 表达；各数值允许 unknown／notApplicable，不能默认 0。CPU 请求量和实际 CPU 使用分开，PVC 申请容量和文件使用分开，Token 观测不伪装成已有预算。共享 scopeId 只汇总一次。

连线以 `sourceId + targetId + relation + state + memberRelations` 表达。relation 包括 owns、consumes-quota、uses、mounts、calls、pushes、grants、changes；state 为 configured／observed／proposed。配置与观测不混为一个证据位。现有图的 observed／static 不能直接当授权事实模型；原型适配只演示实线与虚线，产品实现需显式扩展通用渲染字段。

边来自权威绑定：槽→发布→规格；工作区→任务；Agent→父任务卷；服务→环境数据库／对象空间；项目→授权；请求→目标分配。禁用按名字相似、同 namespace 或同屏位置猜连线。不同环境、不同任务卷不因聚合而互相获得访问权限。

## 4. 申请与管理员直接调整

申请保存 projectId、资源类型／目标 ID、动作、原值修订、目标值、理由、发起人及角色、requestKey、决定与应用回执。服务端每次写入都重查真实身份和项目负责人资格；管理员动作重查管理员资格。开发者即使构造请求也被拒绝。

状态机：pending → approved → applying → applied；pending → rejected／cancelled；应用失败停在 apply-failed；修订冲突停在 needs-review。批准不等于已生效。一个项目同目标同动作只允许一个在途申请；重复 requestKey 返回原回执。负责人可撤回 pending 或尚未写入决定的 needs-review 申请，批准后的应用失败使用重试／补偿合同。

审批先读取最新资源和用量，用 expectedRevision 比较。管理员可批准申请值或在弹窗中修改批准值并填写理由。冲突保留输入，提供新旧值对照后重新确认；不能把旧快照覆盖到新配置上。

跨模块使用审批记录＋幂等领域应用回执，无跨 schema 事务。应用失败可在本页重试相同动作，不生成第二份授权。目录撤回／停用、负责人换人、归档、配额已变化等均重新裁决。

直接分配／直接调额与审批使用同一影响预览和 apply 端口，留审计来源 direct-admin。管理员点击已有待处理目标时可选择处理原申请，避免同时直接改额再批准过时申请。

**继承模式保护**：新增授权需要正向例外层；不能通过改成 restricted 来冻结未来平台默认。服务／算力／镜像有效授权分别遵循其现有模式，在原策略上附加显式分配。撤销默认继承能力须单独展示影响，不能借删除例外条目完成。

## 5. 额度与生效

项目 CPU／内存请求、Pod／PVC 上限需要新增 project 所属的可修订政策，由 provisioning 写期望、cluster-control 对账；批准后的 UI 在实际确认前显示「同步中」。不允许只改 Namespace 而被现有调和器改回。

任务并发按标准台账占用；结束中仍占用。下调低于在用量时明确显示超配和阻止新增的结果，不自动停止任务。对象容量须满足 used＋reserved＋deleting，后端总预算和生产耐久条件仍须通过。单个套餐规格是平台共享模板，项目页不会原地修改模板影响其他项目。

授权生效只扩大可选择范围；Manifest／开发配置仍决定实际使用。需新发布、新任务或重建才生效的变更，在提交前和批准后都显示条件，不自动创建、重建或终止工作负载。

## 6. 交互、性能和异常

- 页面头：项目身份与两端入口；下方为紧凑额度栏、状态／分类／搜索、拓扑／清单／申请记录。所有管理通过本页弹窗完成。
- 节点详情：授权来源、配额／用量、实际状态、归属和消费者、最近变更；主动作按角色决定。关联节点可在弹窗内前后浏览。
- 连线布局：跨列、跨领域连线必须避开节点正文，箭头落到真实目标。原型在设计附件中预演避障层，正式实现扩展既有 `topologyLayout`，不复制产品绘图器。支持统一弹窗展开大画布；底层筛选、滚动和缩放保留。
- 申请表单：当前值→目标值、单位、用途／环境／消费者、理由、审批方、生效条件。草稿按对象保存；关闭后重开继续。
- 管理员审批：请求方和理由、最新值与申请值、可编辑批准值、影响预览、批准／驳回。嵌套确认只关闭最上层。
- 搜索隐藏不匹配节点时保留其归属祖先；关系筛选不制造孤儿。位置由稳定 ID 与用户视图决定，轮询不重排、不丢焦点。
- 窄屏清单维持相同额度和关系，详情、申请仍是统一弹窗。列表长末行操作、焦点返回、嵌套 Esc 纳入验证。
- 按来源显示新鲜度和部分失败；过期配额允许查看，提交前必须读取最新值。错误不清空整张图，也不把未知写成未授权。
- 首屏聚合，实例按需分页展开；读取有并发和数量界限，完整性标记可见。SSE 更新资源阶段，授权／申请事件驱动缓存失效。

## 7. 权限变更与兼容

本轮用户确认的是新资源中心负责人提交、管理员审批。实施前必须逐条落实 proposal §5 的旧入口影响，尤其 API 申请、生产数据访问以及 CLI／MCP 同类入口。设计审阅对这份影响清单的确认是实施依据。

无授权和非 requestable 的目录项不进入项目聚合快照；管理员可见全目录，在同一页分配。前端筛选不是保密边界。无项目权限返回既有不可见语义；不返回内部地址、密钥或其他项目用量。

## 2026-10-01 聚合修正设计（按作者明确裁定）

仅调整 `features/project-resources`：`model/topology.ts` 按 category／resourceType 聚合全部非项目节点，稳定 ID 不含成员数量、环境或权限。项目根保持独立。每组保存原成员，权限数量及在途请求按成员／请求 ID 计数，不合计独立配额；状态取完整成员集合，不沿用首项的环境或授权展示。

组的位置按成员事实层级决定，目录／分配进入能力列，实际资源进入实例列。原始有向边经过成员到组的映射，再按关系与证据去重；同组内部边仍在单项详情保留，不制造新的实例关系。搜索和分类过滤保留组及真实归属祖先。

台账与观测名称通过有限类型别名合并（如 database／PostgresDatabase、namespace／Namespace），成员身份仍独立。业务 service 与 Kubernetes Service 等不同类型不混合。窄屏拓扑复用 `TopologyList` 展示相同的类型节点，避免退回逐项平铺；完整资源清单仍可单独切换。

`ResourceDetailDialog` 与 `ResourceList` 复用统一 Dialog、DataTable 和既有样式展示权限列表。组列表增加本地搜索／资格筛选及可用操作提示；分页、滚动、筛选在单项详情开关期间保持。旧单项书签仍可直达详情，旧聚合书签映射到新的类型节点。节点自身不携带批量管理动作，所有申请与调整仍对原资源 ID 执行。

回归覆盖：少量／单项及混合环境权限聚合、成员数量增长时的图尺寸上界、真实边去重与原成员关系、筛选上下文、旧链接、两端权限列表、长列表末行下钻和嵌套 Esc／焦点。无后端合同、迁移、权限或通用绘图器变更。
# 2026-10-01 大类收敛设计追加

按作者本轮裁定，前次按 category/resourceType 的图上分组被以下呈现模型替代。落位仍在 `features/project-resources/model`、既有共享页面、权限列表及双语词条，不改后端授权契约或绘图底座。

新增稳定的五类展示域：configuration、services、storage、network、platform。先以明确类型覆盖来源分类（例如执行并发归项目配置，任务卷／PVC 归存储，路由／NetworkPolicy／网关中间件归网络），再按后端 category 为未来类型提供确定归属。项目自身与 namespace、日志、整体额度合并为 configuration；服务、开发与执行资源合并为 services。主图使用单横带、三列两行布局，空类别不造资源。

成员身份、配额 scope、权限、动作完整保留；大类节点只有摘要及权限入口。成员到大类的映射聚合原始有向边，不猜测挂载或访问。搜索和大类过滤保留实际归属祖先及存在的项目配置入口。历史 category 参数规范化，历史类型分组链接按其成员定位新大类；原始成员链接继续打开精确详情。

权限弹窗在搜索／资格外增加类型筛选，并展示类型名称。单项弹窗关闭后保持类型、筛选、分页、滚动及焦点。新类型只能增加弹窗内选项；不增加主图节点。回归包括五域映射、未知类型回退、数百成员高度稳定、各配额范围独立、关系方向、双端及窄屏交互与历史链接。
