# 已知的部分人民币估值

落实已批准 RFC-034 与用户“已有数据应显示，只标记不完整”的要求，复用原 usage ledger、完整 allocation、冻结受理价与 valuation usageRevision。whole 且同修订、availability=priced 的原金额继续累计；完整估值还须四桶已知和 completeness=complete。partial 保留实际 CNY pico 金额但不成为完整估值，至少有一个真实已知桶。真实零显示 ¥0；全部未知、歧义、不可显示、陈旧修订和部分 allocation 不猜金额。

新增 optional partiallyPricedRecords，原 pricedRecords 继续只表示完整记录。两种计数互斥，合计不得超过 records，实际金额只加一次。非零才输出 optional 字段，原 complete-only 格式与历史报告保持。新的 partial 事实验证已知桶人口和同一 recordedCost/costCoverage 数量；旧 complete-only immutable schema 资格不改写。

同一个原 fold/维度/任务/趋势保留这些数，推进私有 executionFactsVersion 3→4，原 generation、sourceRevision、projectionVersion=2 与旧 reportId 不改写。复用原三张卡片与人民币组件，zh/en 显示完整/部分估值覆盖，不加新的卡片、更多筛选、CSV 或关注任务。

原 default 201任务/1001尝试/2001 capture、原四档验收费率、预算、完整金额和 EOF 回归保留。新的明确验收专用137尝试，只在首次 seed 接入原 rate 计算的部分估值：输入9,453、缓存读取未知、缓存写入0、输出未知、已记录估值 ¥0.018906；不代表供应商账单，不改原库或旧 valuation。系统/项目/任务、四次37页 EOF、Agent/算力/项目/泳道、cache v3历史与v4新报告回归另验。原仅丢弃 partial 金额的断言拆为原缺估值/陈旧路径和单独 partial 金额路径；其它断言保持。

本文记录已批准设计和在制实现候选，尚不声称本机检查、独立实现门、GitHub CI、部署或真实页面验收通过。N3 完整门 FAIL/两项超时与之后原预算10项定向 PASS 分别保留；最终新候选只运行一次完整门。

## 同候选完整检查（2026-10-07）

部分 CNY、N3 完整父链和实际报告 hook 静默刷新的固定候选一次完整 `bun run check` 已 PASS：6,327／0，157 原环境 skip，345,197 断言、1,288 文件；38 候选及 11 原控制首末保持。37／0、1,977 断言的原定向结果与真实 PG 137 条 partial 的 ¥0.018906、完整估值0／部分估值137均保留。原记录、受理费率和四桶未知未被补零，不改变项目费用可见性。

原早期类型／定向／完整检查失败保留。本机完整门使用专用验收 PG，无生产模型调用；此处不将数据库夹具称为真实模型任务或供应商账单。后继 exact-SHA CI、CS 本机部署与正式页面另验，原生数值生产接线和两个 RFC 仍未完成。
