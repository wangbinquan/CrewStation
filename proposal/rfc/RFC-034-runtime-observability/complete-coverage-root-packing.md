# RFC-034 原规模 TEMP 根索引的无损存储修复

本片只改变完整统计在原 PostgreSQL snapshot 连接私有 TEMP 中的物理存储，不改变选取、区间 AVL、逻辑 root key、原端点、原 Token/CNY、排序/分页或源 EOF。N4/N5 仍独立验收，producer OFF；本片不把旧规模失败改成 PASS。

## 已有证据与范围

原 source SHA 1224449c5252a118396250af4ad5764dd286b244 的原 10M self-total 在约 8.4M 叶根阶段因 PG 磁盘耗尽失败（约91.38GB）；100K任务/10M full-report 在原240分钟内未结束。完整用量 API 的任务/调用人口不能减少，原流程、预算与端点保持。当前 root 单叶已经内联原 [start,end]，但一个实际逻辑组为四桶及多个模型分区重复保留同一较长 group/session/treeOnly/model 字符串。

## 字节相同的逻辑身份与独立分区

只识别 coverageKeys.treeKey 生成的五项 JSON 数组，必须字节重编码相同、group/session/model 为 string、bucket 为四桶之一、treeOnly 为 boolean。任意不可解析/非规范/其他字符串继续现有 roots 格式和查询，不拒绝原 AVL 已接受的输入。

规范 key 的共同部分是原 [group,session,treeOnly,model]，model 使用原分区的完整不透明字节（all、null、modelAnyProvider、modelPartition 均独立）；在独立 packed-roots TEMP namespace 中以带格式标识的完整共同部分寻址。每个物理 document 保留格式版本、完整共同部分及固定四桶的 slots；每个桶独立保留原 id 和可选原 point，不能合并“all/null/某模型/未知provider”、四桶、treeOnly 或原 source/execution/root/session。

v1 设计门的 P2 指出不限制 model/provider 分区会让单个 document 随人口增长；本 v2 沿原 model/provider 分区持久分片，一个 document 最多四个固定桶 slot，与任何任务、调用、模型、provider、步骤或 session 总量无关。分片数量完全无上限，所有片仍经原键分页读到 EOF，绝不将模型/分区人口裁掉。

重读逐项验证共同部分、固定桶 slot、原 model 分区字节、原 id/point，按原五项顺序重建逻辑 tree，缓存的每个 Root 仍持有原 tree 全字节。hash 只寻址，不能代替内容比较。键冲突、重复物理身份、错分区、缺已声明节点或损坏 point 必须失败。原 safe-integer 端点对（包括原 API 接受的 start>end）不追加新的限制。

## 原快照读写与回退

新 root store 仍只调用同一个 CompleteWorkingRows；不引入第二数据库、事务、数值账本或外部索引。非规范 roots 的所有原行为、namespace、读取计数与已有测试不变。规范读取按共同部分批量 getMany，随后逐个原逻辑分区返回；原 legacy 格式的同一逻辑 key 可以回读，若该 key 已在 legacy 中则后续仍更新它，不能留下两个版本或覆盖其他原分区。

写入500个逻辑 root 的固定批次，按共同部分合并到原物理 document，保留固定四桶的所有已有 slot；不同 model/provider 分区从不进入同一 document。合并读取与写入在单 store 中串行；新物理读不缓存可能被并发旧读覆盖的权威 document。原 bounded roots/nodes 缓存、dirty buffer、rootWrites 修订重查、prefetch 等待后判定仍工作；排空只在实际 upsert 成功后移除对应快照中的 dirty 内容，不能 clear 掉等待期间的新写入。

空关系捷径仅在对应物理关系真正 EOF 后使用：非规范逻辑 key 沿用原 roots 的一次空 EOF 控制；规范 key 必须同时证明 legacy roots 和 packed-roots 空。任何 setRoot 先废止相关空证明，等待中的旧空页不能复活它。不要用 cache miss、LIMIT响应、总数相等或空第一组来假定 EOF。

prefetch 按原树惰性遍历，每批至多500个逻辑 key/有限物理共同部分，调度边界不限制总量。包括高于4096个不同模型/provider分区的同一原 group，片人口也全部保留；cache eviction/flush/reopen 后，同一原 key 仍返回原 id 和原每点前缀最大值。

## 有限功能门与真实验收

独立设计门先全文读本片及当前实现/原控制；只审功能P1/P2。本片经门禁后才开发。保留全部现有 coverage workspace 和 pointStorage 用例（原10001/5205/499与倒端点断言、预算都不改）。新增实际PG验证：四桶及all/null/模型/provider分区各自原逻辑区间，在超过500写入/4096cache/reopen/旋转/原prefetch并发读后完整一致；同共同部分物理root数减少而原逻辑分区一条不漏，每个物理 document 至多四桶；超过4096个不同模型/provider分片重开后完整 EOF且全部精确；损坏身份/摘要/point拒绝；canonical legacy回退保持。

实际原报告 controls 的201任务/1001执行/2001capture与10K记录保持。原10M self-total及100K任务/10M完整报告用同一原GitHub规模验收运行并等到终态，人数、调用数、240分钟和全部桶/CNY/独立源EOF断言不改。仍需分析 full-report 原阶段的耗时；物理存储节约不是完成时限PASS的替代证据。最终稳定候选一次完整本地门、exact SHA CI和本机部署另验。

## 保留原批量读取契约

根集合的批量预取仍对原 legacy roots 执行实际批量读取，包括该批的负查询；打包源同时保留，单点读取和串行写入继续复用各自已证明的空关系。原 legacy bulk 行在预取阶段保留，由真正 `coverage.root` 调用逐项核对缓存行的 tree 后才返回 id；打包文档仍在读取时严格核对原逻辑身份。原1201个会话批量控制、身份冲突负例、并发旧读控制及真实 EOF 断言保持，不用伪造查询或新增逐点查询满足测试。
