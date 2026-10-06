# 全平台巡检任务的项目删除边界（待作者批准）

## 实机问题

2026-10-06 原专用项目预检尚未受理任何删除。正式队列已有约15万条历史任务；其中 metrics 83,540 条、storage 21,359 条、refresh 44,707 条。旧 collector 会覆盖 request_id，0008 安装前的 metrics/storage 请求没有原来源记录，不能补造原请求。当前代码逐任务跨模块读取来源，并逐条线性去重阻塞项，造成长期等待。

## 已核对的实际合同

- `modules/cluster-management/adapters/persistence/metricsRepository.ts:36`：metrics/storage 由全局 kind 锁调度，collector 主键是 kind，正文只有 requestId；不是按项目调度。
- `modules/cluster-management/workers/metricsWorker.ts:11`：requestId 只认领全平台 collector，进入完整平台指标/存储采集；不传入 projectId，不执行项目资源操作。
- `modules/cluster-management/wiring.ts:49`：refresh 只触发全平台 collectSnapshot，requestId 用于记录完成。与 `cluster-management.operation` 的目标资源删除处理器分开。
- `modules/provisioning/domain/infrastructureOrigins.ts:20`：三个任务的当前正文均严格限定单个 UUIDv7 requestId。项目操作、重建、发布等均有独立类型及原来源。
- `modules/cluster-management/adapters/persistence/migrations/0008_infrastructure_origins.sql:20`：缺失原请求不能恢复，且禁止插入猜测的原来源。

## 建议修正

仅为 queue 中确切三个名称 `cluster-management.refresh`、`cluster-management.metrics`、`cluster-management.storage` 设定明确的全平台任务合同。每行仍读尽、核对原队列出生/内容摘要、严格正文及历史迁移摘要；旧正文也必须仅有非空 requestId。以实际队列内容及合同版本计算范围证据，不伪造原请求记录或 stopped 证明，不清除这些任务。

它们不属于任何单一项目，保留给平台继续运行，不再要求已过期的 collector 请求作为项目删除的先决条件。其余任务/事件仍必须经公开 owner 核对完整原归属；未知名称、多余字段、畸形当前/旧正文、错误迁移摘要、项目操作来源缺失仍阻断。直接 originalInfrastructureOwnership 端口的缺失历史语义和测试保持。

这是对已批准原规则“所有任务逐条核原来源”的局部边界调整，不是历史回填，不允许按缺失行猜测项目范围。依 development-rules.md §5.7，批准前只完成不改变范围的分页/去重修复及原生来源核对，不启用这个调整。

## 验证

用例必须覆盖三个名称、当前/旧正文、10001条真实队列分页与尾页损坏、未调用项目来源且平台任务全保留、未知项目来源继续阻断；实机重读完整原队列，所有非目标项目及这些平台任务在删除前后保持。
