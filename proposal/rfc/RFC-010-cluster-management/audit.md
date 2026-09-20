# RFC-010｜源码与集群现状核对

> 核对日期：2026-09-20；工作树基准 `6ebd6c7b071d42e87a15f104f778843b66159595`
> 已 fetch，核对时 main 与 origin/main 差异为 0／0。工作树含其他会话的 RFC-008、RFC-009 与门禁改动，以下涉及恢复的行为包含当时在制品。未修改生产代码、数据库或集群。

## 源码证据

| 事实 | 当前来源 | 设计影响 |
|---|---|---|
| 管理导航没有集群资源入口 | `apps/console/src/app/layout/AdminNav.tsx:37`；`apps/console/src/features/admin/routes.ts:21` | 新增独立管理页，不塞进项目设置 |
| 当前观测只有按项目的日志与健康查询 | `modules/observability/http/observabilityRoutes.ts:18`；`modules/observability/ports/sources.ts:24` | 不能用现有健康接口假装全量集群清单 |
| 项目 namespace 是平台注册资料，命名空间带项目 slug 标签 | `modules/project/application/createProject.ts:23`；`modules/platform/wiring.ts:310` | 以数据库映射为主；不依赖 `cs-` 字符串猜项目 |
| `listServices()` 会跳过已归档项目，且逐项目查询 | `modules/project/application/queryProjects.ts:61` | 新增批量且包含归档记录的资源归属投影，避免漏残留或 N＋1 |
| 服务 Deployment／Pod 带项目、服务、槽、发布、workload 标签；副本来自 Manifest | `modules/release/adapters/k8s/slotDeployer.ts:15`；`modules/release/application/pipelineDeploy.ts:39` | 正式／试用角色必须关联 release；扩缩需与发布协同 |
| 发布时校验 Manifest 副本不超过套餐 | `modules/release/application/pipelineDeploy.ts:36` | 运维副本也使用真实套餐上限 |
| CLI 与父开发任务共用 `dev-session` 标签 | `modules/task-runtime/adapters/k8s/taskObjects.ts:46`；同文件 `:51`、`:58` | 不能单靠 workload 标签分类 |
| 独立执行的 purpose 为 cli／agent／subtask，旧记录缺省 cli | `modules/task-runtime/domain/taskEnvironment.ts:7`、`:106` | 批量读环境用途及父任务，再与实际 Pod 实例核对 |
| 档位测试创建在系统命名空间，用特殊项目／服务标识与 emptyDir | `modules/task-runtime/application/testEnvironment.ts:32`、`:46` | 归属平台系统，用途算力档位测试；不把哨兵 ID 当真实项目 |
| 构建与迁移 Job 主要是 component＋release 标签 | `modules/release/adapters/k8s/buildKitBuilder.ts:31`；`modules/release/adapters/k8s/migrationJob.ts:13` | 由 namespace、ownerReferences 与 release 批量解析补全归属 |
| 删除任务 Pod 不会自动恢复任务，会把它判失败 | `modules/task-runtime/application/reconcile.ts:7`、`:36` | “重启工作区”必须新建受控用例，不能套用原生删 Pod |
| 当前重建仅接收失败或协议不兼容，非正常运行任务重启 | `modules/task-runtime/application/rebuildInspection.ts:11` | 明确扩展正常运行环境重启并与 RFC-008 在制品衔接 |
| 环境释放可能删除 follow-container 工作卷，同时更新配额与事件 | `modules/task-runtime/application/lifecycle.ts:26`、`:43` | 删除任务需显示实际影响，并经原生命周期执行 |
| list 接口丢弃 ListMeta，只返 items，limit 无 continue | `packages/k8s/client.ts:7`、`:54` | 增量增加分页原语，不能首 500 项当完整库存 |
| 当前资源注册缺 Node／ReplicaSet／DaemonSet／CronJob 等显式项 | `packages/k8s/resources.ts:35` | 对本范围所需种类显式登记；不依赖未知 kind 复数猜测 |
| 当前部署权限的 apps 组仅有 deployments | `deploy/k8s/platform/00-rbac.yaml:22` | 读取与动作逐类补齐；403 在页面明确呈现 |
| 控制面 Deployment 已有 platform 标签，部分 Service 没有 | `deploy/k8s/platform/30-cs-api.yaml:7`、`:39` | 初始兼容安装清单登记，逐步补齐所有受管对象标签 |
| PostgreSQL 有 part-of，缺 managed-by；dev-auth 的 managed-by 是 crewstation-local | `deploy/k8s/system/10-postgres.yaml:49`；`deploy/local/dev-auth.yaml:7` | 不可只用 managed-by=crewstation 过滤 |

## 本机只读盘点

Context 为 `docker-desktop`。2026-09-20 **09:38:45 UTC／17:38:45 上海时间**，读取 Namespace 与工作负载／Pod／Service／PVC。
本次 namespace 标签盘点确认九个 `cs-*` 命名空间都属于 CrewStation 项目；以下临时统计按这九个 namespace 与 `crewstation-system` 求和。
这是本机核对口径，正式产品必须按设计中的平台注册资料与系统组件登记确定范围，不能把此前缀规则带入实现。

| 对象 | 数量 |
|---|---:|
| Deployment | 25 |
| StatefulSet | 1 |
| DaemonSet／Job／CronJob | 本次范围内均为 0 |
| 上述控制器工作负载合计 | 26 |
| Pod | 38 |
| Running／Ready Pod | 38／38 |
| 平台系统 Pod | 13 |
| 无 controller ownerReference 的独立 Pod | 12 |
| Service | 33 |
| PVC | 10 |

ReplicaSet、配置、策略、事件未计入本次数量核对；上述不是所有 Kubernetes 类型的总量。
工作负载 26 不包含 12 个独立 Pod，它们在 Pod 统计与清单中完整呈现。统计随其他会话运行变化，不作将来的固定验收期望。

本机的 `buildkitd`、`console`、`registry`、`traefik`、`postgres` 无 managed-by 标签但有 part-of；
`cs-api` 等 Service 及 `data-postgres-0` PVC 连这组标签也不完整。只按一种标签查会漏资源，按整个系统 namespace 无差别认领又可能包含外部对象。

## Kubernetes 语义参考

- [Workloads](https://kubernetes.io/docs/concepts/workloads/)：区分控制器与 Pod。
- [Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/)：从属关系使用 ownerReferences，包括 UID；不按名称相似判断。
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)：phase、容器状态与 Ready 条件是不同维度。
- [API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/)：分页读取保留 continue 和 resourceVersion；410 后重新开始一致列表，不能把前后两份列表拼成完整统计。

## 当前验证边界

本次只执行源码读取、Git fetch 与 Kubernetes GET。重启、扩缩、删除、部署和数据库迁移均未执行。
完整门禁与实机操作验收安排在批准实现后；不能把本次健康的 38 个 Pod 当新管理页面验收通过。

方案收口时共享 main 已前进到 `1cd797dff587096de63b48ac2409f850feab422c`，RFC-008／009 各自发布记录已经更新；
上述盘点时间与最初源码核对基准保持原值，不冒充最终部署验收。后续实现须按最新已发布代码复核领域接口。
