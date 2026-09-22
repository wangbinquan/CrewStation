# RFC-019｜技术设计

> 状态：In Progress · 2026-09-22 · 作者已批准；实施与实机证据见 [acceptance.md](./acceptance.md)
> 配套：[提案](./proposal.md) · [计划](./plan.md) · [交互设计稿核对](./prototype-review.md)

## 目录

- [1. 现状与落位](#1-现状与落位)
- [2. 数据模型](#2-数据模型)
- [3. 接口](#3-接口)
- [4. 形态的组装规则](#4-形态的组装规则)
- [5. 排布与渲染](#5-排布与渲染)
- [6. 权限、刷新与失败模式](#6-权限刷新与失败模式)
- [7. 测试策略](#7-测试策略)
- [8. 偏离与债](#8-偏离与债)

## 1. 现状与落位

按 [repository-structure.md](../../../docs/engineering/repository-structure.md) 落位。源码基线 `6a69195`。

现状：RFC-010 的 `cluster-management`（L6）已有按 UID 去重的盘点快照、用途与归属分类、Pod 级事实（节点、重启、容器、上级任务／Agent／终端、发布与槽），
但整套接口挂在 `/v1/admin/cluster/*`，只有管理员能读；项目侧的 slots、dev-session、data、business-task 接口有槽主机、开发预览主机、数据资源与任务记录，没有 Pod 事实。
`cluster-management` 现有 **40 个生产文件、1508 行**，已到结构规则 §11 的 40 文件上限：本 RFC **不给该模块新增生产文件**，只在既有文件内加读取用例与路由（`queries.ts` 38 行、`clusterRoutes.ts` 25 行、`dependencies.ts` 6 行都有余量）；形态的组装放在工作台。

| 落点 | 责任与新增内容 |
|---|---|
| `packages/contracts/api/cluster/resources.ts` | `ClusterSummarySchema.projects[]` 增加可选计数（workloads、pods、readyPods、abnormal、devSessions）；新增 `ProjectClusterResourcesSchema`（项目范围只读盘点的响应） |
| `packages/api-client/resources/cluster.ts` | `projectResources(projectId, { snapshotId? })` |
| `modules/cluster-management/application/queries.ts` | `projectResources(deps, actor, projectId, snapshotId?)`：成员校验、按项目过滤同一份快照、`availableActions` 置空；`snapshotSummary` 补每项目计数 |
| `modules/cluster-management/application/dependencies.ts` | `ClusterDeps` 增加 `authorizeProject(actor, projectId)`，由组合根用 `project` 模块 API 供给 |
| `modules/cluster-management/http/clusterRoutes.ts` | `GET /v1/projects/:projectId/cluster-resources` |
| `modules/platform/wiring.ts` | 注入 `authorizeProject`（`project.api.authorize`），不放逻辑 |
| `apps/console/src/app/theme/tokens.css` | 九组 `--cs-topo-<语义>-stroke／-fill`，浅色深色各一套 |
| `apps/console/src/shared/ui/topology/` | 无业务含义的渲染：`TopologyDiagram`、`topologyLayout`、`topologyModel`（图的类型与纯函数）、`TopologyLegend`、`TopologyFilters`、`TopologyList`、`useContainerWidth`、`Topology.module.css` |
| `apps/console/src/shared/topology/` | CrewStation 语义的组装：`projectTopology`（盘点＋槽＋开发会话＋数据资源 → 图）、`bandSummary`（横带汇总卡）、`systemTopology`（盘点＋静态架构模型）、`projectsLayer`（摘要 → 项目卡）、`staticArchitecture`（静态调用关系表） |
| `apps/console/src/features/projects/` | 概览页「部署与运行形态」卡（横带汇总） |
| `apps/console/src/features/logs/` | 运行与诊断新页签 `topology`：查询、筛选、全图、只读详情 `TopologyDetail`；`shared/project/operationsSearch.ts` 的页签枚举加 `topology` |
| `apps/console/src/features/cluster/` | 「拓扑」页签：层级切换、面包屑、项目层折叠、Pod 层与系统层复用 `ClusterDetail` |
| `tests/e2e/` | 三处入口的真实浏览器用例 |

`shared/ui/topology/` 与 `shared/topology/` 都是子目录，避免 `shared/ui` 平铺超过 20 个文件；`features/*` 之间仍不互相 import，两处项目入口都经 `shared/topology`。
不新增模块、不改 layer、不跨 schema 查询，不需要 ADR。

## 2. 数据模型

工作台内的图模型（`shared/ui/topology/topologyModel.ts`，与原型一致）：

```ts
type Semantic = 'gateway' | 'security' | 'service' | 'development' | 'business' | 'build' | 'data' | 'platform' | 'external';
type NodeStatus = 'ready' | 'running' | 'pending' | 'failed' | 'succeeded' | 'terminating' | 'idle' | 'unknown';
type NodeKind = 'route' | 'workload' | 'pod' | 'database' | 'volume' | 'job' | 'component' | 'external' | 'summary';
type EdgeKind = 'routes' | 'owns' | 'child' | 'mounts' | 'uses' | 'traffic' | 'control' | 'dial' | 'push';
interface TopologyNode { id; kind; semantic; title; subtitle?; status; statusText?; lane; band; row?; box?; meta?; facts?; counts?; abnormal?; resourceId?; purpose? }
interface TopologyBand { id; title; semantic; note?; boxes? }
interface TopologyEdge { from; to; kind; label?; evidence: 'observed' | 'static' }
interface Topology { id; title; lanes; bands; nodes; edges; observedAt; complete; incompleteReason? }
```

节点 `id` 取盘点的 `uid`（Pod、工作负载、PVC）、槽主机名、DataResource id，换快照时同一对象保持同一 id；`resourceId` 指向快照内的资源标识，详情按它读取。
后端不新增「拓扑」DTO：项目范围接口返回的仍是 RFC-010 的 `ClusterResource[]`，组装在工作台完成（见 §4），这样管理员与成员看到的 Pod 事实同源。

新增契约：

```ts
ProjectClusterResourcesSchema = { snapshotId, observedAt, complete, sources: ClusterSource[], items: ClusterResource[], truncated: boolean }
ClusterSummarySchema.projects[i] += { workloads?, pods?, readyPods?, abnormal?, devSessions? }   // 全部可选，旧客户端不受影响
```

## 3. 接口

| 方法与路径 | 谁 | 语义 |
|---|---|---|
| `GET /v1/projects/:projectId/cluster-resources?snapshotId=` | 负责人、开发者、管理员（`develop`） | 最新（或指定）快照里归属该项目的全部受管资源，`availableActions` 恒为空；单项目资源上限 500，超出置 `truncated=true` 并按 kind 优先保留 Pod／工作负载；快照过期 410 |
| `GET /v1/admin/cluster/summary` | 管理员 | `projects[]` 带计数，供项目层一次读取；其余不变 |

成员校验用 `project` 模块的 `authorize(actor, projectId, 'develop')`：负责人、开发者、管理员通过；测试员只有 `view`（运行与诊断的日志、健康读取用的动作），按提案 §4「测试员不看」的裁定这里用 `develop` 而不是 `view`；非成员 403，未登录 401，项目不存在 404，`snapshotId` 非法 400。
路由、用例与既有 `readSnapshot`／`pageResources` 共用快照读取，不另起采集。

## 4. 形态的组装规则

`shared/topology/projectTopology.ts`（纯函数，输入：项目盘点、槽列表、开发会话、数据资源；输出：`Topology`）：

| 横带 | 进入条件 | 节点与连线 |
|---|---|---|
| 线上槽 | 槽 `active=true` | 入口＝槽 `host`（用户域或服务域按项目 kind）；工作负载＝`slotRole=prod` 的 Deployment；Pod＝其 owner 链下的 Pod；`routes`、`owns`；Pod 对生产库 `uses`（标签为注入的环境变量名） |
| 待命槽 | 槽存在且非 active | 同上，`slotRole=preview` |
| 开发会话 | 开发会话状态非 released | 入口＝`previewHost`；工作区 Pod＝`purpose=development-workspace`；CLI／Agent Pod＝`development-cli`／`development-agent`，`child` 边由 `parentTaskId` 指向工作区；工作卷＝该会话的 PVC，`mounts` 边由 Pod 的卷引用；开发库 `uses` |
| 业务任务 | 存在 `business-workspace`／`business-subtask` Pod | Pod 节点；有 PVC 则 `mounts` |
| 构建与迁移 | 存在 `purpose=build`／`migration` 的 Job 或 Pod | Job 在工作负载泳道，其 Pod 在 Pod 泳道，`owns`；迁移 Pod 对生产库 `uses` |

状态归一：`phase`／`ready`／`abnormal`／`reason` 按 RFC-010 §4 口径映射到 `NodeStatus`，`statusText` 优先用原因短语；用途待核对的资源进「其他」横带并标 `unknown`，不猜成开发会话。
时长：Pod 用 `createdAt` 到 `observedAt`；Agent／子任务的执行时长取任务记录的开始时间（盘点 facts 已带上级任务与 Agent id，缺失则只显示 Pod 存活时长）。

`shared/topology/systemTopology.ts`：节点来自 `scope=system` 的盘点（平台服务、基础组件按组件名固定行号），调用方一栏来自 `summary.purposes` 聚合；连线来自 `staticArchitecture.ts` 的常量表（用户域→Traefik→cs-auth／cs-console／cs-api、服务槽↔Traefik、TaskRunner→cs-session、Agent→MCP、cs-events→Traefik、各服务→PostgreSQL、cs-api→Prometheus、cs-controller→BuildKit→registry、cs-controller→GitLab／Kubernetes API、cs-auth→OIDC），全部 `evidence: 'static'`。静态表随架构文档改动而改，不从集群推断。

`shared/topology/projectsLayer.ts`：输入 `summary.projects[]`，异常（`abnormal>0`）置顶为「需要关注」横带，其余为「正常」；超过 60 个时只列前 12 个并加一张「还有 N 个」卡，点击展开；列数由容器宽度决定（每列 ≥210px，2–8 列）。

`shared/topology/bandSummary.ts`：把项目图按横带汇成一行卡（最差状态、Pod 与就绪数、需要关注数），供概览页。

## 5. 排布与渲染

`shared/ui/topology/topologyLayout.ts`：泳道 x 由序号决定；横带自上而下；带内每条泳道按显式 `row` 或出现顺序堆叠；边界框取框内节点的包围盒并至少容下标题；
连线为正交圆角折线：相邻泳道右出左进，反向镜像，同泳道走左侧沟槽；成对的双向边上下错开 7px；连线标签只在最长水平段放得下时显示。
`fitMetrics` 按容器宽度撑宽节点（泳道数与间距不变，宽度在基准×0.9 与 360px 之间），SVG 以 `viewBox` 等宽 1:1 渲染，容器比最窄排布还窄时才等比缩小。
文本按估算像素宽裁剪并用 `<title>` 给全文；标题占第一行，状态短语在第二行右侧，事实行在底部；`counts` 只在高卡（项目层、横带汇总）逐行画。

`TopologyDiagram`：`<svg role="group">`，节点 `<g role="button" tabIndex=0 aria-pressed>`，Enter／空格选中；悬停、聚焦、选中都把非邻接节点与连线压到 22% 透明度；
筛选（语义、状态、只看需要关注）只压暗不移除，保持位置稳定。颜色全部走 `--cs-topo-*` 与既有 `--cs-tone-*`，不写裸色值；`prefers-reduced-motion` 下无过渡。
`TopologyList`：≤640px 的替代渲染，按横带分组，行内同样的状态点与语义色左边。

## 6. 权限、刷新与失败模式

- 项目侧查询用 `useApiQuery` 的 15 秒轮询与 `keepPrevious`（RFC-010 §8 修订）：换快照只换数据，不卸载图；详情按 `resourceId` 固定，对象消失时提示已被替换。
- 部分来源失败：`complete=false` 时观测行写明失败来源，受影响 kind 的节点标 `unknown`，计数显示占位；不把残缺集合当完整总量。
- 快照 410：与现有页面一致，提示刷新并重新读取最新快照。
- 项目侧不显示事件、日志与管理动作；管理员在 Pod 层点节点走 `ClusterDetail`（事件、日志、动作照旧）。
- 成员权限变化后现有查询按既有规则重新校验（角色变化 → 403 → 页面按现有 403 处理）。
- 项目层折叠只影响渲染，不影响筛选与计数；「还有 N 个」展开后本次会话内保持。

## 7. 测试策略

按 [testing.md](../../../docs/engineering/testing.md) §4：

| 改动 | 用例 | 位置 |
|---|---|---|
| 新路由 `GET /v1/projects/:id/cluster-resources` | 成功路径（负责人、开发者、管理员），测试员 403，非成员 404（`authorize` 对非成员按项目不存在处理，不暴露项目），未登录 401，项目不存在 404，`snapshotId` 非法 400，过期 410，`availableActions` 恒空，`truncated` 边界 | `modules/cluster-management/tests/`（真实 PostgreSQL） |
| `summary.projects[]` 计数 | 每项目计数与逐项过滤一致；部分来源失败时计数不为 0 而是缺席 | 同上 |
| 契约 Schema | 正向解析、`strict` 拒绝未知键、可选计数缺席兼容 | `packages/contracts/api/cluster/` 旁 |
| `projectTopology`／`systemTopology`／`projectsLayer`／`bandSummary` | 每条横带的进入条件、边的生成、状态归一、待核对不猜用途、折叠阈值、时长计算 | `apps/console/src/tests/topologyAssembly.test.ts` |
| `topologyLayout` | 显式行号、包围盒含标题、双向边错开、标签放不下不画、`fitMetrics` 上下限 | `apps/console/src/tests/topologyLayout.test.ts` |
| `TopologyDiagram`／`TopologyList`／筛选与图例 | 载入、空、错、成功四态；点选／键盘选中与压暗；筛选联动；窄屏改列表；换快照不重排（同 UID 位置不变） | `apps/console/src/tests/topologyDiagram.test.tsx` |
| 三处页面 | 概览卡、运行与诊断页签、集群拓扑三层与详情；中英文键（`i18nParity`） | `apps/console/src/tests/` |
| 令牌 | `--cs-topo-*` 只在 `tokens.css` 声明，浅深两套齐全 | 沿用 `projectNavigation.test.tsx` 的源码扫描写法 |
| 真实页面 | dev-admin 与开发者身份下三处入口在本机集群渲染，节点数与 `kubectl` 一致；测试员 403 | `tests/e2e/topology.test.ts` |

## 8. 偏离与债

- **形态在工作台组装而不是后端**：原因是 `cluster-management` 已到 40 文件上限，而后端组装还要读 data／release／dev-session 三个模块。成员与管理员读同一份 `ClusterResource[]`，同源性不受影响；代价是页面要并行发 4 个请求（盘点、槽、开发会话、数据资源）。若日后拆分 `cluster-management`（ADR），组装可以下沉。
- **静态架构表是手写常量**：随架构变化需要人工更新，图例已明示「不是实测」。
- **Agent 执行时长** 依赖盘点 facts 里的任务开始时间；缺失时只显示 Pod 存活时长，不伪造。
