# RFC-034 持久用量事实与增量汇总（2026-10-11）

状态：源码现状已核对，补充设计与实现计划；尚未实施新缓存，尚未证明与 AW 同规模性能。承接用户完整统计与持久缓存要求；AW 对应 RFC-371 的 `persistent-usage-facts-20261011.md`。本页不替代原数字停止、物理结束、项目删除或人民币估值合同。

## 已有持久数据与重复环节

`adapters/persistence/reports/reportStore.ts` 已将完整报告、rows、counts、receipts、分页 digest 与 manifest 落在 observability 私有 schema。`originalRuntimeReportIdentity` 从原数据库 generation、runtime_report_clock 与 runtime_report_revisions 得到源版本；`application/complete-statistics/reportService.ts` 的 requestKey 包含全部 request 与这个版本。源改变、范围改变、taskId 或 sourceCollection 改变会触发全新报告。`wiring.ts` 的原 snapshot 再经公开事实 factory 收集 business-task/development-agent 全部 headers/attempts，逐任务从已经持久化的 usage projections、native captures、valuation 计算归属、趋势、维度和明细，然后重新封装落库。

`0016_complete_runtime_reports.sql` 的源 clock 已包含原 Task/执行/日志、Agent starts/native copies、项目/算力名称、usage/valuation/captures/steps/baselines/heads/model evidence/visibility 的 insert/update/delete/truncate；它是全局失效指示，不能单独说明“只哪一任务变了”。因此不能仅把更多报告永久留着作为新范围的计算缓存，也不能假设 count(clock) 代表完整逐条变更日志。

2026-10-11 本机小范围：系统 7 执行、两个项目范围各 5 执行，请求到完整事实可读分别 1142.964/1127.844/1165.736 ms，包含原客户端一秒状态轮询。三个范围均完整归于 known Token 四桶 45656/63424/0/446=109526、人民币 ¥0.126592，原 unknown/缺口仍在；这是单次小规模证据，不能证明 137 任务、数百调用或规模目标下也快。

## 持久事实、贡献与查询的分层

1. 原 usage/valuation/native-copy 已持久化，不复制成第二份权威账本。增加可重建的 normalized fact cache、依赖索引和 sealed epoch，键包含原 source authority/generation、project/task/execution/generation、source/record/revision、完整原指纹与 parser/selection 版本。保留原业务与开发两个 source kind，独立算力自测/CLI 是否接入由各原公开事实来源明确证明。
2. 在同一原 snapshot 上持久化已经完成的 usage selection/coverage family 的逐 meter 贡献与原估值引用，再维护按 project/task/Agent/算力/model/时间的索引与汇总。输入、缓存读、缓存写、输出均保留 known/unknown；CNY 使用原 decimal/整数比例，没有浮点或隐式美元换算。重用事实不重计包含子树、累计测量或共有 root。
3. 新 system/project/query report 读取同一封闭事实版本，继续原 actor、project准入、cost visibility、requestKey、原 snapshot ID、独立 cursor、完整 rows/counts/receipts/manifest。缓存不能把项目级可见报表直接扩大为全局，也不能把隐藏估值重新暴露。每次 page 只控制传输大小，完整统计持续至 EOF，没有总任务/调用/记录上限。

## 更新、失效与一致性

- 增加 owner-owned 的完整事务变更页/记录身份，在原写入同一事务记录 insert/update/delete/truncate。跨模块事实继续通过已批准公开端口由组合根接线；observability 不直接读取或加触发器到他模块私有表。现有全局 clock 保留作为缺漏检测：若 epoch 落后或 change journal 不能证明覆盖当前源版本，则对相关完整 source 做全量清单核对并重建，不能静默忽略。
- 新模型数据只解析变化的原记录；旧 ID 修订替换当前版本，删除带原 tombstone，迟到与原父边变化使相关完整 coverage family 重新选择，再原子替换贡献。不是把累计新值当 delta 加到旧总数。终态变化不证明 Token 原账本不可再修订，未知仍保持未知。
- 原冻结 compute profile/revision/priceBook 与原 valuation 使用记录保留；费率配置改变不会自动改历史估值。明确历史重估为独立受审计版本。名称变化只重投影展示属性，UUID 身份、采集/数字 key、原停止与物理 identity 不变。
- worker 原键幂等、独立 staging、完整 watermark/EOF/成员指纹/计数后发布 current sealed epoch；恢复未完成 work 不让查询看一半。相同 source revision 与不同查询范围复用事实，source 更换、database generation、parser/coverage 算法版本改变触发明确重建。旧报告和旧原 receipt 不变，新报告不重用其 nonce/cursor 伪装新 snapshot。
- 缓存恢复、项目删除参加现有观测 deletionLifecycle 的 quiesce/drain/clear；凡原删除、edge 或含项目的派生汇总均同步失效。缓存不得绕过旧项目 tombstone/当前准入。原 source 不可用时仍显示确实已知部分与缺口；不生成已知零，不把未闭合新版本认证为当前完整。

## 精确范围与 AW 托管

任务 cohort 仍依原任务开始，usage cohort 仍依每记录实际发生时间。整日汇总只适用于完全覆盖且时区一致的段，任意边界、DST 和跨日任务数量通过原 contribution/时间索引精确处理；执行时间读取完整原区间并求并集，不相加日汇总。改变 from/to 不重复收集和解析原模型 JSON。

CS 托管 AW 的原算力用量在 CS 账本原 authority/project/execution/meter 下只贡献一次；AW 消费公开观测来源及版本，不能把同一次模型支出同时作为 AW 自己的新本地支出计数。独立 AW 继续自身来源。RFC-370 的实际托管接线由其原所有者负责，本设计不声称当前已完成联合部署与同规模数据验收。

## 落地与验证

先固定当前无缓存完整 oracle，再补 sealed epoch/依赖/原内容指纹和 owner change-page 合同，最后接 incremental contribution 与范围索引；具体迁移/公开端口/文件级计划先过有限设计门。CS 所有变更经过有意义的失败回归、原 Linux 环境稳定候选唯一一次完整 check、独立功能门、对应 SHA 六个 hosted CI 和本机部署；保留并行输出，不修改旧 migration、不放宽阈值、不重复 gate 追绿。

验收场景分别为：首次完整历史导入、相同范围、不同范围、服务重启、新增记录、同 ID 修订、删除/truncate、迟到、父边/coverage 变化、源替换、规则版本变化、原 watermark 缺失、构建中断/租约接管和项目删除。每场景四桶/人民币/任务/attempt/调用、原明细/有序 rows/counts/receipts/EOF/缺口与对应原 oracle 全字段对齐。数字 tail、原 StopReceipt、Session closure 和物理 Pod UID 条件不因 cache hit 改变。

耗时分开记录原 source 确认/首次导入、归属计算、事实缓存读、查询聚合、stage/publish、整体请求到可见；注明数据量、多次独立观测、P50/P95。必须在与 AW 可比的负载上验证后再说明差异，不把当前 7 执行数据外推规模。现有报告落库缓存继续使用；本页描述的新事实增量缓存尚未实现。
