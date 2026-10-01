# 网关清理 owner 的候选验证

## 范围与实际落位

本批落实已批准的 T6、T10、PD-10、18、19、20，设计见 [gateway-owner](../gateway-owner.md)。六张本项目内容表、全部历史共享放行文档、原 callback 工作事实由 gateway 自有适配器盘点和清理。正式 project 许可与公共 API 在 platform 组合根装配，最小原身份不含正文、凭据或业务内容。IngressRoute、Middleware 与命名空间的物理清除仍须 resources/cluster-control 的原 UID 证明。

0011 增加本 schema 的屏障、原归属、文档版本内归属、原 work 和原进程停止回执，不改旧迁移。原 schema／限流表和协调函数归并进既有文件，生产 TS 由 41 减 3 加 2，最终 40；没有扩大结构阈值、加模块或层级例外。

## 已实际验证的行为

- 合成旧库升级前后七张原内容表逐字段保持。原 service、operation、Pod 和每个文档 version 的 caller／operation 绑定 project UUID，同 slug 的新 UUID 不取得旧授权；已删根后 API 目录仍能读取原操作最小归属。
- 102 份历史文档与 502 条维护记录全量清理，保留其他项目原文、数组顺序、附加字段和平台默认限流。不同 caller 中指向本项目接口的授权会计入关联材料并移除。
- 全部六张内容表用原主键继续分页。真实 PG 的并发删除反例在原 OFFSET 上为 0 pass／1 fail，502 条目标只数到 4 条；修订后同一用例通过，日志分别为 /private/tmp/cs-rfc037-gateway-pagination-red-1.log 与 gateway-pagination-green-1.log。
- 根状态批量读取与持久本地封闭共同裁剪每请求视图。旧允许表／维护缓存、defaultOpen、同 slug 重建、旧 Pod 重放和路由观测都不能绕过原项目关闭。启动恢复登记最新版原关系，后续 view 与 caller 读取不再逐授权键查跨模块目录，也不写内容表。
- 原操作正式许可、世代、确认摘要、参与者和阶段均核对；范围变化持久封闭，普通继续不替换摘要，管理员新计划与世代才可继续。未知内容表、原身份、版本或文档结构不能解释为空；未知表在确认后出现时，封闭事实仍持久保留。
- 实际挂起的路由回调有独立 workId、backend PID 与原 Pod/container/Node。真实 pg_terminate_backend 后 callback 仍挂起，seal 返回 waiting，租约／连接消失不算退出；实际 finally 使用独立事务登记后才排空，迟到路由结果被触发器拒绝。
- 原容器停止证明只恢复四项原来源完全一致的 callback；直接改状态或清除 work 拒绝。平台适配器对替换 Pod／Node／容器、读取故障、失联、过期 Lease 与缺失 Pod 拒绝证明，按 UID CAS 保留 events 与外部 finalizer。
- 平台正式装配缺少原进程来源时拒绝副作用。同名替换 UID 的组合反例保留原路由和 work；原目录发布、proxy 改名与消费者重试用例仍通过。

## 命令与边界

覆盖组合读取 gateway、api-catalog/tests、project 的删除和模块用例、platform 的 workloadOwnership／gatewayCatalogRoutes／appAccessComposition 及原 callback K8s 适配器。首次 SQL／夹具列顺序、JSON 运算、日期参数及 shared 锁排队的失败均已实际修正，早期命令不视为通过。

稳定第四次覆盖组合为 **142 pass／0 fail、1277 断言、30 文件、39.58 秒**，日志 /private/tmp/cs-rfc037-gateway-coverage-4.log；新增可执行行 **372／372，100%**，所有改动生产文件加载，回执 gateway-patch-coverage-4.json。精确 lint 与后端类型通过；最初被并行 RFC-034 在制类型／结构阻断的检查保留，不视为通过。

本批一次完整 bun run check 静态四层全部通过，完整用例为 **4781 pass／143 skip／6 fail、4930 tests、954 文件、31660 断言、1029.08 秒**。六项均为未追踪的 apps/console/src/tests/runtimeSourceStatistics.test.tsx，在并行响应夹具的 acceptedProfiles 与当时严格 schema 尚未一致时失败；未修改该 owner 内容。39 个冻结源码、测试与配置路径（含三项删除）前后指纹一致，新增网关回归全部通过。日志 /private/tmp/cs-rfc037-gateway-full-check-1.log，回执 gateway-full-gate-1.json。此结果不是全仓通过，不重复运行同一网关源码全量；后续按精确提交的 hosted CI 取得最终整仓结论。

固定过程身份、假 K8s 与其他 owner 的空范围只用于模块边界测试，不是正式 22 owner 或真实物理删除成功。此次清理了首次失败夹具遗留的六个独立测试数据库：核对专属 gateway-delete／gateway-keep、gateway-admin、创建时间、网关表清单与零活动连接，逐库重验后未用 FORCE 删除；真实专用项目保持，回执 /private/tmp/cs-rfc037-gateway-test-database-cleanup.json。

并行 owner 已在 `50dbd7a7` 发布接线所需的来源与开发 API，原 39 个本批指纹保持；精确网关候选两侧类型为 0 诊断。加入数据库原生物理来源后的稳定完整候选为 4797 pass／143 skip／0 fail，定向覆盖组合 185 pass／3 skip／0 fail，详见[数据库候选回执](database-physics.md)。这次有新源码的候选门禁不替换前一轮网关的红运行，也不触发重复相同源码的全量检查。

当前合并候选尚未提交、取得精确 CI、应用 0011 迁移或部署。共享 platform/wiring 保留并行输出；剩余 owner、管理员二次确认界面与专用项目真实永久删除继续，产品删除入口保持关闭。
