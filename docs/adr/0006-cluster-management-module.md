# 0006. 集群资源与运维操作归 cluster-management

- 状态：已接受；作者于 2026-09-20 批准 RFC-010 完整实现与提交上库
- 日期：2026-09-20
- 关联：[RFC-010](../../proposal/rfc/RFC-010-cluster-management/proposal.md)

## 背景

RFC-010 已确认同时需要跨项目资源盘点和重启、扩缩、删除。现有 observability（L6）拥有日志、健康与告警，
没有集群运维操作的持久化状态；platform（L7）只做组合，packages/k8s 只做协议，均不应承接运维领域规则。

## 决策

新增 L6 `modules/cluster-management`，按标准脚手架创建，拥有：

- `ManagedResource` 只读投影、采集批次与来源覆盖情况、归属与用途判断。
- `ClusterOperation` 的检查、受理、执行、观察、结果与幂等记录。
- 系统内置组件目录及操作能力规则。安装清单登记通过设置端口注入，不把部署路径写进模块。

仅依赖 packages 的通用能力及其他模块根入口注入的端口；项目、任务、发布、数据等状态依旧由各原模块拥有。
命名空间／资源映射、批量任务投影、发布槽查询、生命周期动作经 `ports/` 声明，由 `platform/wiring.ts` 回填。
需要调用同层 observability 的日志能力时也通过端口注入，不新增同层 import。
持久化使用自有 `cluster_management` schema，不跨模块 SQL join、不增加跨 schema 外键。
项目槽副本覆盖归 `release`，不在新模块和 release 同时存两份期望值。

`cs-api` 挂管理 HTTP；`cs-controller` 挂采集与操作 worker；它们在组合根装配，模块不认识进程名与端口。
前端独立 `features/cluster`，通过 contracts＋api-client 接 API，由 app 路由挂在既有管理布局下。

## 后果

获批实现时更新结构文档 §5／§6 与架构检查的模块登记，按已有迁移／契约锁规则增加新项。
不调整 600／20／80 上限，不引入 facade、跨层 import 或规则例外。
保持 observability 现有 API；新模块无法成为直接修改任务、发布、项目或数据表的旁路。
