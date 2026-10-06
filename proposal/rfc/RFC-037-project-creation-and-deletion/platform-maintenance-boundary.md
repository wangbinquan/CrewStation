# 全平台巡检任务的项目删除边界（2026-10-06 已批准）

作者在本会话回复“批准”，采用下述建议修正。授权仅覆盖确切三个全平台巡检任务的归属合同；业务、网关与原生 PostgreSQL 的其他历史缺口继续按原合同处理。既有提交、推送、本机部署和原专用项目验收授权保持。

## 实机问题

2026-10-06 原专用项目预检尚未受理任何删除。正式队列已有约15万条历史任务；其中 metrics 83,540 条、storage 21,359 条、refresh 44,707 条。旧 collector 会覆盖 request_id，0008 安装前的 metrics/storage 请求没有原来源记录，不能补造原请求。调整前的代码逐任务跨模块读取来源，并逐条线性去重阻塞项，造成长期等待。

## 已核对的实际合同

- `modules/cluster-management/adapters/persistence/metricsRepository.ts:36`：metrics/storage 由全局 kind 锁调度，collector 主键是 kind，正文只有 requestId；不是按项目调度。
- `modules/cluster-management/workers/metricsWorker.ts:11`：requestId 只认领全平台 collector，进入完整平台指标/存储采集；不传入 projectId，不执行项目资源操作。
- `modules/cluster-management/wiring.ts:49`：refresh 只触发全平台 collectSnapshot，requestId 用于记录完成。与 `cluster-management.operation` 的目标资源删除处理器分开。
- `modules/provisioning/domain/infrastructureOrigins.ts:47`：三个任务的当前正文均严格限定单个 UUIDv7 requestId。项目操作、重建、发布等均有独立类型及原来源。
- `modules/cluster-management/adapters/persistence/migrations/0008_infrastructure_origins.sql:20`：缺失原请求不能恢复，且禁止插入猜测的原来源。

## 已批准的修正

仅为 queue 中确切三个名称 `cluster-management.refresh`、`cluster-management.metrics`、`cluster-management.storage` 设定明确的全平台任务合同。每行仍读尽、核对原队列出生/内容摘要、严格正文及历史迁移摘要；旧正文也必须仅有非空 requestId。以实际队列内容及合同版本计算范围证据，不伪造原请求记录或 stopped 证明，不清除这些任务。

它们不属于任何单一项目，保留给平台继续运行，不再要求已过期的 collector 请求作为项目删除的先决条件。其余任务/事件仍必须经公开 owner 核对完整原归属；未知名称、多余字段、畸形当前/旧正文、错误迁移摘要、项目操作来源缺失仍阻断。直接 originalInfrastructureOwnership 端口的缺失历史语义和测试保持。

这是对原规则“所有任务逐条核原来源”的局部边界调整，不是历史回填，不允许按缺失行猜测项目范围。当前已获作者批准，纳入设计基线；原队列出生/内容、迁移摘要与完整 EOF 仍须核对。归属证据使用明确的合同版本及原正文摘要，不合成 collector 原请求、原进程停止或清理回执。

## 验证

用例必须覆盖三个名称、当前/旧正文、10001条真实队列分页与尾页损坏、未调用项目来源且平台任务全保留、未知项目来源继续阻断；实机重读完整原队列，所有非目标项目及这些平台任务在删除前后保持。
