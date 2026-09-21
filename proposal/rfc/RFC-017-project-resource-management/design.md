# RFC-017｜设计

状态：Done · 2026-09-21。

## 现状证据

`modules/project/adapters/persistence/tables.ts:41` 定义全局规格；`apps/console/src/features/admin/components/projects/ProjectComputeForm.tsx:44` 已提供 Agent／开发资源；`modules/release/application/pipelineDeploy.ts:43` 按 Manifest 取服务规格；`modules/task-runtime/application/createEnvironment.ts:50` 在创建时读取项目资源与准入配额。

## 服务政策与配额

服务分配属于 L2 project。其 schema 新增 `service_plan_policies`（project_id 主键、policy、revision、updated_by／at）；迁移只增表。独立仓储经现有 UnitOfWork 接入，不跨 schema 联查、不新增模块。

GET／PUT `/v1/projects/:projectId/service-policy`：policy 为 mode（inherit／restricted）和 allowedPlanIds（不重复 UUID，最多 200 项）。inherit 清单必须为空，未配置视为继承。成员读、管理员写，项目与规格必须存在。expectedRevision 执行原子插入／更新 CAS。

发布在迁移启动前和 startDeploy 两处经 platform 注入 project 解析，使用 release.projectId 校验范围，失败保留具体原因且不调用迁移器／部署器。迁移期间撤回分配也阻止部署。已运行服务维护仍可读取原规格，不因撤销未来部署资格而无法维护。capabilities 按访问者和项目读取允许目录，被限制的全局默认规格不再作为推荐规格返回。

已有 quota PUT 新增可选 expectedMaxConcurrentTasks，工作台必传，仓储条件更新；省略的旧调用方保持兼容。占用继续取 task-runtime，不新增计数来源。

## 工作台

项目目录和模板页共用项目管理子导航。模板页包含服务与任务容器两页签，复用现有编辑器和草稿保护；移除左栏及总览两个平铺的套餐入口。`/admin/projects/:projectId/resources` 显示三张独立保存的卡片：服务范围、Agent 与开发容器、任务并发。各卡片独立重读，避免保存／重读一个卡片时丢掉另一个草稿。compute 和原套餐地址 replace 跳转。

## 验证

契约边界和 strict；真实 PostgreSQL 的保存／角色／并发／配额；发布不允许规格时不部署；console 的导航、成功／空／错／加载、草稿及旧入口；构建预览的窄屏与实际 DOM；最后运行一次候选完整门禁。
