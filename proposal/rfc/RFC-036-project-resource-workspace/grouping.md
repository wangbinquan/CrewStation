# 同类资源聚合修正验收

作者在 2026-10-01 明确要求：同类资源固定合并一个拓扑节点，点击后展示权限列表。

## 实现

源提交 `602bd14400f83ba95d7539134d5fbf4e298616e4` 包含 12 个本任务文件。两端共用按类型聚合的资源节点；权限、环境及成员数量不拆分同类节点。有限别名统一台账与观测类型，业务服务和 Kubernetes Service 保持区分。组节点不承载批量动作、不合并计量范围；原成员与有向关系保留。窄屏同样展示类型入口。

权限弹窗展示逐项资格、来源、环境、配额、状态和允许操作，可搜索、筛选、分页并打开原资源详情继续申请或管理。关闭成员详情保留组列表上下文，嵌套 Esc 只关闭最上层。旧成员与旧聚合链接继续可用。

## 候选验证

- 聚合初始回归为 0 pass／5 fail，实施后通过；旧模型与页面的类型 ID 断言按新行为更新，保留真实归属与配额边界断言。
- 最终 41 项专项回归通过，包含 8 项聚合回归、长列表末行下钻／滚动／焦点、混合环境与权限、别名、归档只读、窄屏类型入口和旧链接。
- console 类型检查、精确 lint、Vite 构建通过；专项覆盖结果 41 pass／0 fail。
- 一次完整本地 `bun run check` 在结构层被其他会话的 gateway `0011_project_deletion_fences.sql` 在制迁移阻断：6 项 persistence-ownership、1 项 migration-lock。未修改或提交这些文件。本次候选内容指纹在检查前后相同。
- 正式组件配合隔离 HTTP 演示数据验证了管理员数据库权限列表、搜索后下钻／返回、负责人配额申请入口、320px 窄屏弹窗和分组入口。演示不作为真实身份或真实资源申请证据。

## 发布与本机部署

- 源 SHA `602bd14400f83ba95d7539134d5fbf4e298616e4` 的 [CI 36800206366](https://github.com/wangbinquan/CrewStation/actions/runs/36800206366) 全部六项成功：static、unit、module、console、gate、e2e。推送后本地与远端同步。
- 从该提交的 Git 归档构建 console，镜像标签含完整来源 SHA；不把共享工作树在制品放入镜像。部署前验证 storage-contract，并用 UID／resourceVersion 比较保护现有 console。
- `2026-10-01T01:27:51.435Z` 部署完成：console generation／observedGeneration 均为 216，Ready 1；实际镜像 `docker.io/library/cs-console@sha256:555272b8213fd0a328fb2ca348f5b7eebfdea893d86a6f6fd3723af3bb775714`。
- 仅 console 代数变化，其他七个组件身份／镜像／就绪状态一致，Runner 一致；项目原有 4 个 Pod 的 UID 与镜像全部保留，没有缺失或变更。

## 真实浏览器复验

同一既有管理员会话在 `/admin/projects/01a0e955-7714-7000-8e27-16c2372b16a5/resources` 与 `/projects/01a0e955-7714-7000-8e27-16c2372b16a5/resource-center` 验证。没有切换身份或提交资源／授权／配额变更；负责人、开发者与归档边界由上述隔离回归验证。

| 项目 | 部署前 | 部署后 |
|---|---|---|
| 全图节点数 | 55 | 29（28 个资源类型＋项目根） |
| 画布 viewBox | `0 0 1018 5464` | `0 0 1018 2872` |
| 页面水平溢出 | 0 | 0 |

画布高度减少约 47%。API 31 项记录共用一个类型节点；进入弹窗后逐项显示授权资格、配额、来源、状态和原操作。已有能力／`commits/{sha}` 筛选匹配一个精确接口；打开单项详情后显示原资源 UUID 和项目授权边。Esc 返回后保留搜索、资格和匹配行，焦点回到详情按钮；再次关闭组返回 SVG 类型节点，底层分类保持。

执行并发类型节点可进入原额度详情，显示独立项目计量范围、有效 3 个／已用 0，并保留管理员“调整配额”入口。没有为了验收再次申请或修改额度。

项目页在 390×844 的拓扑入口保持 4 个执行类型＋项目根，没有退回逐项表格；320×720 权限弹窗边界为 left 16／right 304，页面及弹窗无水平溢出。管理员页在 390×844 的 API 权限弹窗同样无页面溢出，31 项全部可访问。表格内部可横向滚动查看后续列。临时 viewport 已复原，演示标签页和本任务模拟服务器清理；实际管理员权限列表保留为交付页。

证据：[部署与 UI 回执](./grouping-deployment-receipt.json)、[聚合全图](./acceptance-screenshots/grouping-overview.png)、[单类入口](./acceptance-screenshots/grouping-integration.png)、[权限列表](./acceptance-screenshots/grouping-permissions.png)、[项目端](./acceptance-screenshots/grouping-project.png)、[窄屏类型入口](./acceptance-screenshots/grouping-mobile.png)、[管理员窄屏](./acceptance-screenshots/grouping-admin-mobile.png)。前次发布与验收证据继续保留。
