# RFC-034 N5 原生分页采集完整报告接线补充

本片在已批准 native-platform-consumer-v2.md 的 N5/N6 内，不增加数字账本、不开启默认 producer、不改既有业务 executionObservationsV1/V2 媒体类型。本片设计门只审下述真实来源、报告完整性与显示，不声称生产或规模已通过。

## 同一原始来源

完整报告仍由原 snapshot Executor、usage_projections、execution_valuations 和既有 legacy native_captures 读取。新增可选 pagedCaptures 分页 reader 从已经持久的 development_native_passes/pages/paths/work 读取纯元数据，严格按 pass_key 前进直到实际 EOF。固定 pageSize 是调度/传输大小，不限制 pass、task 或 steps 总量。开发原 identity 使用和现有 usage/valuations 相同 selectedIdentity，不能按 workspace task_id 推测另一 execution。

每个元数据项必须匹配原 pass 的 document fingerprint、原身份/selection/source_namespace、完整 progress 及真实 EOF 页摘要。完整父链接使用 N3 的原 SQL/path digest 资格；不能用 session/step 数量相等替代父链。没有 work 行表示 pending，不虚造 numericEof/valuationEof。所有收到的页 issue 及 work/previousPopulation issue 保留到真实 EOF，没有诊断总数量截断。

## 明确新 DTO 与无数字能力

新增 RuntimeNativePagedCaptureSchema（独立报告 DTO，不能转换到 UsageNativeCaptureSchema）。id=原 passKey，sourceVersion=2，identity=原 UsageExecutionIdentity，sourceId=原 developmentCaptureSourceId，pass=原 NativeUsagePassIdentity，turnIndex=原 preparation.turnIndex，preparedAt=原 preparation.observedAt。

只包含：sourceState(receiving/source-eof)、pages/counts/scanPosition/sourceWatermark 的十进制文本、pathsComplete、workState(pending/processed)、visitedSteps/heldSteps/原工作 cursor、numericEof/valuationEof、baselineState(before-only/complete-before/complete-birth/unknown)、issues 和原源摘要。counts 是原会话/原始行/步骤人口，不是 Token；schema 严格禁止额外字段，不存 input/cache/output/金额或配置默认模型。该 DTO 不携带费用，从已有数字投影和估值读金额。

N4 work 追加 baselineState 纯资格元数据：最终轮次存实际 qualifyNativeBaseline 结果；baseline pass 用 before-only。未知且空 source 必须继续报告 baseline unknown，不能因为 visited=held=0 将其称完整或报告零 Token。旧 work 没有该字段就为 unknown，按原页重读后补证；不猜 fresh=zero。

## 完整报告与原数值归属

新增 native-pages section，作为可在 complete-facts 状态读取的严格非数值元数据。旧 captures section/旧 schema/旧事实数字门不变。文件 seal、fact transform、PG 积分校验和读取共用显式 strict schema 验证 native-pages，不以“没有 metrics”通放任意 row；历史报告保持原字节。服务器报告请求键和前端请求缓存/历史 pin 版本推进，旧缓存不被当作支持新來源。

buildCompleteRuntimeTask 无论 usage 是否存在，都消费新增 reader 的所有页、保留独立 source receipt，再做原 allocation。baseline 元数据参与来源 EOF，但不当作完成数值采集的 final。final 必须 source EOF/父链完整/actual baseline complete-before 或 complete-birth/数值与估值 EOF/visited 等于 original counts.steps/held=0/work processed/无来源和工作缺口，才有完整 final 资格。否则标 native-capture-incomplete，保留已知四桶与已记录人民币。没有 final 始终 native-capture-unobserved；空 final 只在资格完整时允许完整零用量。

每个 paged UsageRecord 用 scope.native.passKey 及原 identity/sourceId/root/turn 匹配该原 pass，不通过 legacy ancestors 数组或把一页当整轮。历史修订保留 scope 原 first pass/原 execution，故原 meter 继续匹配其实际原 capture；新 final 自身若有未解决历史归属，会由其 work/issue 单独使该新执行统计不完整。legacy UsageRecord 继续旧 capture 资格，两个来源不会相加一份数字。

report dimensions 将元数据按原 admitted attempt 的 parent 输出 native-pages；id唯一、attempt 精确匹配，baseline/final 都可追踪。已有 legacy capture 缺席不能使具备实际 paged final 的记录误标 unobserved，也不能使 legacy 数字绕过其既有 qualification。

## 页面

沿用现有原生采集 Card、DataTable、RuntimeRows 和 Dialog，两个 source section 在同一 Card 展示，空来源不制造重复大块提示。名称用已受理 attempt 名和轮次，根/原摘要放详情。来源 EOF、父链、基线、投影及估值状态明确区分；原准备时间明确叫“准备时间”，不能伪装“最近观测”。显示任意精度 steps/counts 的原文本；分页不降低总量。

## 验证

- 实际 WAL/原 journal/Session API PG/平台 consumer：ordinary ACK 后重启、211 原步骤和超过20 ordinary pages、缺原页口及独立 owner/namespace 不匹配；原 v1 控制保持。
- 实际新 consumer 产生的原账本构建原 task report：ready 四桶/CNY 与原账本一致；未知输出保持 known partial；空 unknown-birth 元数据不产生完整零；work pending 和 held 历史保留缺口；原 source receipts 每项 EOF。
- 同一项目/系统报告 native-pages 在 complete-facts 的 strict 元数据访问可用，数值明细与 legacy captures 原限制不变；费用隐藏仍不透出金额。
- 元数据 tamper 原 pass digest、错误 attempt/pass、非文本 count/额外金额/缺 EOF 严格拒绝。
- 原 201/1001/2001、迁移、断言和预算不变；一次最终稳定内容的完整 gate、exact-SHA CI、本机部署和真实 N6 另验。

Producer 仍 OFF。此设计及用例不替代真实供应商任务、业务原生分页公共合同或原 100K/10M 规模验收。

## 原通用事实与旧数据兼容

原 `RUNTIME_REPORT_FACT_SECTIONS` 保留九类通用事实；原生分页元数据由独立扩展列表纳入同一报告的严格发布、读取和解析，仍不承载第二套 Token 或金额。原 generic fact 用例的全部项目、身份和数值断言保持。

新增 `native_revision` 的 SQL 默认值不能自动填入 `jsonb_populate_record` 的完整行插入，因此原删除夹具的实际行及预期原行同时明确初始水位0，显式原水位优先。仅消费 `sequence` 的旧快照读取明确投影该列，不额外读取新字段。生产列约束、原迁移、原断言和预算不改。
