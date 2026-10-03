# 开通 owner 与协调内容的事务收尾

2026-10-03，基于 `75dd427227fc7e3f587015c37ca411904513c625`。本批仍是未提交、未部署的源码候选，永久删除入口保持关闭；原验收项目与资源没有执行删除。

开通 owner 已提供 seal、stop、purge、prove、namespace、metadata、verify 七阶段。封写使用既有项目排他准入；停止必须读取每个原回调的私有 finally 退出证明，或独立原容器停止恢复证明。真实测试断开原 PostgreSQL backend 后，回调仍未退出时 stop 保持 waiting，直到同一个原回调的 finally 实际落库。连接消失不算退出，共享控制面 PID 也不被当成项目独占进程。

队列、事件与错误由所属 package 的完整分页及原行 CAS 清理。确认后新生或替换的内容、缺失来源、共享项目归属、孤儿错误和未登记列均阻断。队列先删除而事件 CAS 失败时，整笔事务回滚。原回调仅在前五阶段持久证明齐全、原身份吻合且已退出后允许 metadata 删除；清理范围随后压缩为摘要、数量和阶段证明，保留封闭准入与最小结果，其他项目的回调和内容保持原样。

当前操作自己的协调队列与 `project.deletion-requested` 事件在普通盘点、清理阶段保留到最后，避免作业提前丢失心跳，也避免确认后新增的协调行使原计划必然失效。Project 提供实际 UOW 事务执行口：所有 154 条回执齐全后，协调队列、事件及其错误、项目根与成功状态在同一事务提交。失败会完整回滚。入队先对原操作使用 `FOR UPDATE SKIP LOCKED`，终态不再入队；忙碌时由恢复扫描接续，事件消费者不持有原事件行等待操作锁。这条并发路径已有真实事件消费者用例。

新迁移 `provisioning/0004_project_deletion.sql` 增加最小范围与持久阶段表，并扩展既有回调删除保护。旧迁移字节未改写；共享锁从 223 追加为 224 项，未代入锁观测任务的在制 0016。

验证结果：

- 本批最终专项：58 pass、0 fail、492 断言、12 文件，34.19 秒。包含实际 PG、实际队列工作器、事件消费者、完整分页、事务回滚、恢复与阶段回执；协调测试其余 21 owner 为有状态编排替身，开通 owner 的容器／归属来源为受控端口，均不替代集群实机证明。
- 当前共享树后端类型检查和本批 24 个 TS 路径 lint 通过。没有将架构检查或完整 `bun run check` 宣称通过。
- 以已提交基线加 96 路径候选做内存类型核对有 2 个缺失依赖：并行会话已在共同的 project／agent-runtime wiring 新增观测名称导出，对应两个 `observationNames.ts` 仍由对方持有。其输出未移除，未擅自扩大提交范围；这两个共享文件需要在发布时一并协调依赖。该内存核对不算独立候选通过。
- 官方改动防护按精确候选合并前轮成功覆盖：870／874 可执行改动行，99.54%，无违规及未加载生产文件。
- 全仓架构检查仍有 3 项并行观测 WIP：observability API 引入本模块 ports、平台 wiring 超过 600 行，以及观测 0016 未入锁。保留对方内容，未发送常规协调消息。
- 核对结束时 main 与 origin/main 为 0／0，共享索引为空；96 个候选路径已有内容指纹。

证据：`/private/tmp/cs-rfc037-provisioning-owner-v3.log`、`/private/tmp/cs-rfc037-provisioning-owner-v3.xml`、`/private/tmp/cs-rfc037-provisioning-owner-types-v3.log`、`/private/tmp/cs-rfc037-provisioning-owner-lint-v3.log`、`/private/tmp/cs-rfc037-provisioning-owner-arch-v2.log`、`/private/tmp/cs-rfc037-provisioning-owner-patch-v1.json`、`/private/tmp/cs-rfc037-provisioning-owner-exact-types-v1.json` 和 `/private/tmp/cs-rfc037-provisioning-owner-source-candidate-v1.json`。前轮原归属 source 回归仍见[原归属验收](infrastructure-origins.md)。

后续需要将完整来源组合、该 owner 和事务 finalizer 接入实际 Root，补齐任务与会话等剩余 owner 及 SCM 全物理范围，完成全仓门禁、提交／精确 SHA CI、部署、管理员二次确认和原资源实际回收对账。当前 API 工厂与测试不代表正式 Root 已挂载全部 22 个参与者。
