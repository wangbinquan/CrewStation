# RFC-034 原归属数值修订增量

状态：独立静态设计功能门 PASS（2026-09-29）；沿用已批准 T2/T3/T9，实现前先完成本门。本增量不改变业务结果或执行控制。

## 问题与既有所有者

上一批保留原生恢复前/后证据并定位原归属，发现旧步修订后仍显示已知下限；自动补正尚未实施。`domain/usageProjection.ts` 的 rebuildUsageProjection 按原生 revision 重放；`adapters/persistence/drizzleUsageLedger.ts` 的 task head 锁串行提交用量、证明和同步水位；`application/executionValuations.ts` 使用原执行的冻结价格独立估值。继续使用这些所有者。

不能简单给旧 measurement 分配 revision+1：`packages/agent-drivers/drivers/usage/capture.ts` 的 retryModels 在后续轮次仍可能补出旧步骤的原生 revision。也不能用接收顺序或 observedAt 判断原生快照先后；跨来源乱序和时钟偏移会把旧数字覆盖回来。

## 1. 可证明的原生快照顺序

在原生数据库旁建立 CrewStation 自有的轻量序号库 `<database>.crewstation-usage.sqlite`，只保留一个 epoch 和安全整数 sequence，不存提示词或用量正文；原 OpenCode DB 始终只读。序号库复用相同持久卷，跨 Pod 保留；丢失/重建生成新 epoch，绝不将新代次与旧代次自动合并。

新增库内的 orderedNativeSnapshot 包装既有 readNativeUsageSnapshot：先 BEGIN IMMEDIATE 取得排他序号锁，再读源库固定快照，再递增 sequence 并提交。锁必须覆盖读快照全过程；禁止先读后分配序号。锁忙、不可写、计数耗尽或落盘失败时保留本次可得数字和明确 `native-order-unavailable`，不颁发顺序证明、不自动修历史；锁等待为0，扫描仍有既有预算。序号按库全局递增，根不同也不会复用。

NativeUsageSnapshot 与可选 NativeUsageProof 扩展 `order: {epoch, sequence}`，恢复 baseline 同样保留其 order。兼容旧 Runner：缺 order 的数字照常接收，但历史修订只保留缺口。恢复前后 epoch 必须相同，final sequence 必须大于 baseline sequence；不满足时记录代次/顺序缺口。新顺序不使用来源事件 revision，也不改变业务日志游标。

## 2. 独立修订层，不占用原生 revision

在现有 observability persistence 文件中登记 `native_repairs` 表：原 meterKey 唯一，保存原 capture、修订来源 capture/ordinal、epoch/sequence、规范步骤指纹与四桶、实际模型证明。恢复基线和原始 measurement 继续不可变；完整审计材料已由 native_baselines/native_capture_history 保留。本层不是第二条用量摄取通道，仍在原 task head 事务中更新。

仅在以下条件全部成立时修正：原 owner 唯一且已持久完成；task/lineage/root、session/parent/完整祖先路径、稳定 recordId 一致；原记录为 request/delta/self/invocation；原 owner 与修订者的顺序 epoch 相同，修订 final sequence 晚于 owner final sequence；after 明确读到且四桶全部已知；实际模型与原投影 modelRef 一致（都未知可保留 unpriced；已知/未知不一致则待补模型，不借用默认模型）。原 owner 尚未到齐则保留待定，晚到后重查。

相同原 meter 只采纳更高 sequence；同 sequence 不同内容是冲突，不能覆盖；重放原回执幂等；低 sequence 标记已被新证据取代，不回滚数值。step 删除、未访问、来源代次改变、范围/模型冲突继续显示原归属未修复。

数字写入独立投影层：先按原生证据重建基础，再应用最新已证明修订，最后与原持久投影比较，仅变化时增加 projectionRevision。原始 evidence 的 native revision 与内容不变，公开用量文档保留原生 revision / observedRevision；用于统计的 projection.contribution 来自最终修订，并明确这是已提交对账结果。后到旧原生样本或模型补全不会盖掉修订层。原可用模型不变，因此原 modelRevision 仍指向持久原生模型证据。

有效下调也属于显式修订，允许 10→8，不能把差额扣到本轮新步骤。示例：原 S=10，本轮恢复看到 S=15、T=3，则原执行15、本轮3、总计18；相同证据重放仍18。修复后仅清除已经解决的历史修订缺口；其他采集、范围、模型与不完整数据原因继续保留。原快照水位冻结其旧数字/缺口，新水位输出替换投影。

## 3. 人民币估值与可恢复完成

每个实际修订使对应原用量 projectionRevision 增加，并留下待估值投影；同事务提交用量和任务同步水位。价格查询在账本事务外，仍通过 ExecutionPriceStore.price(originalIdentity, originalActualModel) 选择原受理时间、档位修订和目录水位。调价或删档位不改变这次补算的依据。

现有 valueRunnerUsagePage 在处理本页数字外，按当前 task 读取有界的未估值 native repair 原归属（每次最多200），用现有 executionValuations 幂等回执和 CAS 补算，再继续本页 ACK。仍有未完成项则留页待重试，不回滚已提交 Token，也不重新添加 Token；价格查询/响应丢失、重启和原生记录同时更新均保持可恢复。无实际模型或原价缺失仍为 unpriced，绝不写假零价。

## 4. 正式页面与兼容性

NativeCaptureSummary 增加“已校正历史步骤”计数；未修复与已校正分开，保留原证明和采集时间。读取 summary 时只在全部修订都已有确定结论时移除派生 native-prior-revision-gap；若原 proof 为 partial 且唯一原因是该已修复缺口，summary 可变完整，原 proof 保留为当时证据。原 owner 的 historicalRevisionGap 按未修复关联重算，不能只做一次性清空。

公共执行观察 v1 不增加新的 observation kind；仍输出 usage 投影和 CNY valuation，AW 的现有投影替换逻辑无需再减基线。pure-empty proof 同步仍是另一个明确增量，本批不冒称已完成。

## 5. 实施/验收清单

1. 序号库持久单调、跨进程并发锁、先锁后读、重开、锁忙/写失败/耗尽、旧 Runner/epoch 重建。
2. 原步骤增加/下降、原值本轮间变化、重复/乱序/同序不同内容、兄弟与不同 lineage、缺/多 owner、错根/祖先/实际模型、未访问/删除、原 owner 晚到与原始 metadata 晚到。
3. 源页与修订回滚、旧快照隔离、数字不重加、原价 CNY 补算、调价后重试、单连接池、崩溃后恢复与有界处理。
4. 正式原生详情展示未修复/已校正，双语和统一 Dialog；相关领域/合同/真实 PG/接线用例先行，独立实现门后唯一完整候选 check、精确路径发布和该 SHA CI。

结构约束：observability 仍保持40个生产文件，扩展既有 domain/application/ports/persistence/wiring；新迁移入锁。驱动新增一个职责单一的序号包装文件，遵循每文件600/每函数80/每目录20上限。保持并行在制品与既有部署记录完整。

设计复核通过。实施必须覆盖“新快照数值相等仍推进顺序水位”和“旧步骤模型晚到后修订数字保持、费用重新估值”两个回归；本结论不等于实现或实机已通过。

实施落位补充：native_steps 仅新增可空 modelEvidence，专门保留与当前 projection.modelRevision 匹配的实际模型证明，不随被拒绝的较新原生模型覆盖；迟到的低 revision 若正是当前已选模型同样补入。native_repairs 可停用；第二个原 owner 晚到造成歧义时，从 immutable raw evidence 重建并进入待估值，原快照仍冻结。独立复核指出必须保留已选模型证明，本实现与回归采用该约束。

已接受修订额外固定已选 modelRef，允许 null→已知一次补全；若迟到更早的原生 evidence 令已选已知模型改为不同值，先停用旧修订并重建，再用新投影估值，禁止将旧模型的修订数值套用到新模型。metadata 晚到只重用同一或更高已接受顺序，不批准更晚的模型未知修订；数字未知、删除、范围冲突仍保持缺口。

修订同时固定原 request 的完整 scope（含 turn/turnIndex、root/session/parent/ancestors），每次原生重建先校验 scope、delta/self/invocation 和模型适用性。失效修订不能作为更低顺序新证据的覆盖证明；只有仍适用的更高修订才可继续覆盖。来源页 advance 在 raw evidence 全部写入后复查关联 nativeKey，保证迟到记录改到无证明的 turn 时，也同步撤销旧摘要的已校正状态。

## 本批门检视与验证记录（2026-09-29）

独立静态实现功能门最终 PASS，已逐一关闭模型晚到导致摘要回退、迟到已知模型不匹配、失效后低序号误标校正、完整 scope 改变四组反例。SQLite 跨进程序号锁和读取先后验证通过；真实 PG 的201条分批、定价故障不ACK、响应丢失、冻结原价、数字上/下调、旧快照与原生metadata乱序已有回归。完整候选 check、精确 SHA CI 与本批升级尚待完成，不等同于真实模型执行已验收。

首轮完整门禁静态通过，4179 pass／142 skip／1 fail（26,505断言、835文件、662.39秒）；唯一失败为旧驱动用例未期待新增 native-order-unavailable。只更新该精确原因数组并增加 order 缺失断言，保留 completed/partial 原判据，未修改生产候选。两份相关驱动用例38 pass／0 fail、174断言；独立只读复核 PASS。修正候选重新冻结后执行唯一完整门禁。正式代码只读夹具另验证中英文、1280/390、校正前后计数、共享Dialog与Esc回焦点，非真实模型/身份验收。


修正候选完整门禁已终态通过：结构、全仓 lint、后端及 console 类型全部通过；4180 pass／142 skip／0 fail，26,516 断言，835 文件，876.94 秒。22 路径指纹与冻结候选一致。真实集群浏览器/模型执行未包含在这次本地门禁内；发布后的精确 SHA CI 与本机升级单独记录。
