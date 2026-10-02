# 集群历史与指标清理 owner

> 状态：实现候选，未发布、未部署；永久删除入口继续关闭。此参与者只清理 cluster-management 的内容，实际对象、卷与命名空间由 cluster-control 负责。

## 范围与归属

`modules/cluster-management/adapters/persistence/projectDeletion.ts` 聚合读取本 schema 的全部快照、检查、操作、指标观测、资源历史和存储采样，不使用列表的分页上限。快照、检查和操作还读取并清理 `legacy_body`，清除指向旧内容的 `identity_provenance`；纯身份别名和完成屏障保留最小身份。

项目与服务的旧标识来自公开身份目录，反向解析必须匹配原 UUID。原资源范围固定平台 ID 和实际 Kubernetes UID，旧 resource alias 也必须与原 UID 一致。名称引用只由已识别原对象的结构化路径生成摘要；完成屏障保存摘要，不保存对象显示名称或原正文。来源缺失、同一 ID 对应另一 UID、未登记内容表／列和混合历史的未识别版本均阻断。

旧版备份属于待删项目、当前记录属于其他项目时，只清空备份及其 provenance，保留当前记录。反方向的当前／备份跨项目冲突不能安全删除整行，盘点明确阻断。此问题由真实 PG 红反例发现和修复，失败原件保留。

其他项目的 opaque domain 明细如果仍包含无法识别的原 projectId／serviceId，投影后再次检查会阻断盘点，不能把“没有已登记对象”解释为内容已清空。原明细保留，等待归属来源补全；真实 PG 红反例与修正后的通过回执均保留。

共享行只删目标项目的对象、事实、引用、历史版本、指标身份、计数器段、节点中的项目 Pod 明细和挂载明细；其他项目当前持有的同 UID 对象和指标保留。节点／集群总体指标保留。领域投影位于 `domain/projectDeletion.ts`，不读取别的模块内部表。

## 闭准入与实际排空

每个项目使用独立的持久 shared／exclusive PostgreSQL 准入。操作工作器在调用原领域命令或 Kubernetes mutation 前再次检查原回调上下文；短内容锁只保护观测提交和元数据清理，不跨外部回调持有。

原回调在实际开始前独立持久化保护 backend、回调进程和原平台 Pod／容器／节点身份；只有实际 finally 或原容器停止来源加上保护 backend 已消失，才能记录退出。连接消失和队列租约失效不构成退出。旧非终态操作没有原回调来源时，迁移保存不可擦除的原操作 ID，并阻断盘点。seal 等待超过锁预算返回 waiting，其他项目继续运行。

同一世代的失败 seal 保持封闭且未确认；只有重新批准的新世代可重新盘点。stop、purge、prove、metadata、verify 按持久前序许可推进，metadata 和最终回执可重放。六个内容表的 SQL 触发器覆盖旧写入路径，禁止封闭后恢复项目内容；正常采集在提交前投影掉已封闭项目。

## 结构整理与装配

同概念归并删除七个生产文件：inventory 类型并入 observations、storageTopology 并入 storageUsage、observeStorage 并入 observeMetrics、historyQueries 并入 metricQueries、resourceReferences 并入 ledgerOverlay、两个持久化表文件并入 tables。原功能保持，用原回归保护。模块生产文件由 44 减至 37，再加入三个清理实现文件，最终 40，遵守既有上限，无新模块或 schema 转移。

Root 在实际 platform Pod UID 已配置时，通过 project 的公开许可、公共身份目录及现有原 Pod 停止来源装配这个 owner，使用独立 finalizer `crewstation.io/cluster-project-stop`。未接齐全部参与者，HTTP 删除计划仍为 404，管理员删除按钮未开放。

## 本地验证

使用本任务已授权的隔离 PostgreSQL，保留原容器、基础数据库和 keeper；只创建并清理由各用例拥有的独立数据库。没有操作原验收项目或原资源。

- 502 行共享快照及旧版备份，目标内容全清、另一项目保留，迟到正常采集投影和裸 SQL 恢复拒绝。
- 另一项目实际当前持有历史同 UID、同名引用和指标系列，清理后及后续写入仍保留。
- 原检查和操作的名称引用：先保留红反例，加入原结构化身份摘要后变绿。
- 回调实际退出、30 秒真实锁等待、原保护 backend 被结束后回调仍未退出、迟到外部 mutation 为零。
- 旧迁移升级、旧回调来源不可擦除、混合历史归属未知阻断、新内容列和旧别名冲突阻断、重复 metadata 回执一致。

专项候选 v10 为 16 pass／0 fail、145 断言；新增旧来源不可擦除的红反例后，upgrade／ambiguous 两项为 2 pass／0 fail。较宽候选 v11 为 101 pass／3 Prometheus 环境 skip／0 fail、712 断言，精确 lint 通过，494／512 改动行受保护。复核发现上述当前／备份跨项目冲突后，新增红回归并修正投影，v11 不复用为修订后候选证明。最终候选 v12 接续较宽覆盖和静态验证；不能将专项结果称为全仓、实机或全删除通过。

最终候选 v13 的较宽真实 PG／Root／停止来源回归为 103 pass／3 Prometheus 环境 skip／0 fail、731 断言；后端类型、精确 lint 和 arch:check 均通过。54 个源码／测试／迁移路径冻结，0007 校验和为 `0f6dd984f1e0f96ea32a3af8bac8f1d906d524bf2626ba3ec5a17dd4aed7ef48`，锁共 212 项且保留并行 0020。新全量门禁、精确提交／CI、部署与原资源实机验收尚未执行，不以旧 e403 的 CI 关闭此候选。
