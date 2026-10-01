# 项目资源大类与命名空间边界验收

最终源码：`a500a3e0fb897b10909258bd3356414601df25b5`，包含大类聚合、类型筛选及命名空间边界修正。

## 归属模型

| 入口 | 承载的内容 |
| --- | --- |
| 项目管理（根） | 项目概况、执行并发、项目配置与密钥元数据、仓库、日志与观测 |
| 命名空间 | 隔离与归属边界、命名空间 CPU／内存／Pod／PVC 总量约束及同步状态 |
| 服务与算力 | 业务服务、槽与发布、工作区、执行、算力／任务规格、运行镜像；运行时 Secret 留在来源领域 |
| 存储 | 数据库与角色、数据访问、对象空间／套餐、工作卷与 PVC |
| 网络 | 路由、网络策略、网关限流、中间件 |
| 平台 API 与事件 | 接口授权、事件类型／订阅、MCP |

主图表示项目资源关系，不把外部数据库、对象空间、共享规格或平台 API 伪装为 namespace 的内部物理对象。项目根加五类资源的节点数量有界，三列两行；仅映射原始有向关系，同类内部边仍在单项详情保留。

权限列表支持类型、资格、名称筛选。各成员保留原始身份、环境、配额 scope 与动作。负责人申请、管理员直接调整／审批、开发者只读；本次未变更后端资格边界。

## 本地检查

- 新增红回归先重现技术类型膨胀和命名空间误归配置，再验证修正。
- 45 项相关回归通过，357 个断言；包含长列表上下文、旧链接、配额和申请、三种角色、非法分类参数与原始身份边界。
- console 类型检查、作用域 lint、Vite 构建通过。
- 完整 `bun run check` 因同时在制的 `modules/platform/application/runtimeFactSources.ts` 与 `modules/platform/ports/runtimeFactSources.ts` 引用层次检查失败，本次候选内容未变；没有修改或提交这些文件。
- 只读浏览器预览：主图 6 个节点，viewBox 高 298；命名空间与项目管理分别显示自己的类型，类型筛选关闭单项后保留。

## 发布与实际验收

[最终源码 CI](https://github.com/wangbinquan/CrewStation/actions/runs/36806105699) 的 static、unit、module、console、gate、e2e 全部成功；核对 headSha 为上述完整源码 SHA。

2026-10-01T02:42:09.800Z 已仅更新 docker-desktop / crewstation-system / console，镜像为 `docker.io/library/cs-console@sha256:e33c14928b5f069e8224f95d98a7e760cf4c9c04c4a25c90ed2e3c06b452216f`，generation = observedGeneration = 218，Ready = 1。其余七个组件、Runner 镜像及验收项目的四个既有 Pod 身份均保持。部署前检查存储合同、镜像来源与已部署源码祖先关系，部署时使用 UID／resourceVersion 前置校验。完整回执见 [部署回执](./domains-deployment-receipt.json)。

真实验收项目为「RFC035 服务对象存储验收」：项目 ID `01a0e955-7714-7000-8e27-16c2372b16a5`，namespace `cs-rfc035-objects-0929`。保持现有 dev-admin 浏览器身份。两端均核对到以下 127 项成员：项目管理 4、命名空间 4、服务与算力 59、存储 9、网络 18、平台 API 与事件 33；图上为 6 个节点，viewBox `0 0 1018 298`，桌面画布可用高度 414px，无内部纵向溢出。[前次验收](./grouping.md)记录的同项目为 29 个节点、viewBox 高 2872。

- 管理端与项目开发端共享同一大类和权限入口；旧 API 类型书签正确进入新的平台 API 与事件列表。
- 命名空间列表的类型仅为 namespace、namespace-quota。管理员从其中打开调额表单，实际值为 CPU 8 核、内存 16 GiB、Pod 30、PVC 20；没有修改输入或提交。嵌套 Esc 返回后仍保留 namespace-quota 筛选。
- 项目管理列表包含执行并发、日志观测、项目概况、仓库，不包含 namespace；服务类中的 5 条运行时 Secret 留在服务列表。
- 两端 390×844 窄屏均显示 6 个入口，document.scrollWidth = innerWidth = 390；命名空间弹窗为 x=16、y=16、width=358、height=812，处于视口内。
- 真实验收只查看资源和打开表单；没有创建工作负载、提交授权／调额或切换身份。负责人申请、开发者只读及审批流程由隔离夹具回归验证，不作为真实身份端到端测试宣称。
- 浏览器尺寸已恢复，临时预览与验收页关闭，保留管理员资源总览页面。

## 页面证据

[管理端总览](./acceptance-screenshots/domains/admin-overview.png) · [项目端总览](./acceptance-screenshots/domains/project-overview.png) · [命名空间](./acceptance-screenshots/domains/namespace.png) · [命名空间调额](./acceptance-screenshots/domains/namespace-quota.png) · [项目管理](./acceptance-screenshots/domains/project-management.png) · [按类型筛选权限](./acceptance-screenshots/domains/permissions.png) · [管理端窄屏](./acceptance-screenshots/domains/admin-mobile.png) · [项目端窄屏](./acceptance-screenshots/domains/project-mobile.png)
