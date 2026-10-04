# 完整原范围中的已记录用量与人民币

用户已要求缺口范围仍显示收到的数据并标记不完整，不能用空卡掩盖真实输入、缓存、输出与人民币。本修复适用于系统／项目及任务、Agent、项目、算力贡献，继续保留原整个 cohort、分页至 EOF、原唯一用量 ledger 和完整总量资格。

## 当前断点与范围

`domain/completeRuntimeMetrics.ts:22` 原 allocation fold 实际累加每条已选原贡献，却在有 gaps 时丢掉所有数值；`domain/completeReportFacts.ts:4` 又把 trend／source 及非普通 Task 明细全改成全范围缺口。`RuntimeReportState.tsx:7` 的大 Card 在所有数据页重复，原文 noPartial 也与用户的新明确要求矛盾。原完整 Token/CNY 字段继续保持未知；另呈现同一原 fold 中已有且归属确定的记录，不伪造丢失记录或供应商账单。

## 原贡献的独立证据

在原 CompleteRuntimeFold 内增加四桶已知值、各桶确切记录数和 pricedRecords。只在原 `addCompleteRuntimeAllocation`／merge 中累加，计数用 BigInt／十进制字符串，没有 Task／调用／记录／深度总量上限。原 selection 的 ambiguous／unavailable allocation 不产生假定贡献，records 分母仍完整保留；正常已收到且选定的部分原贡献按每个非 null 桶累加。原 `completeUsageSelection.ts:95–113` 在四桶均因部分重叠被排除时不会调用 allocate，不能只从已有 allocation 传播质量。后继在同一原 ordered-record pass 增加一个可选原记录质量回调（第三参数）：仅对 ambiguous／unavailable 原记录携带 record、quality 和实际 allocated 状态并 await；Task 调用者用既有 `attemptFor(original.identity)`、`context.attempts.put` 给该原 owner 的 attempt fold 标 coverage-incomplete，原 finish／merge 将它带到 Agent／profile／贡献／泳道。已经 allocated 的行继续只计一次原 records；未 allocated 的歧义原行保留一条未确认记录覆盖人口、priced=false，不加任何 Token／费用或桶已知计数。正常被完整覆盖的 excluded 行不触发该回调、不新增人口，原选择结果和归属校验保持；无法对应原 attempt 时继续原 Task identity-unmatched，不杜撰 owner。这里没有第二 ledger、额外实体或全量内存加载。未知桶没有任何可用原值时保持 null；已有桶可显示精确已知和及各自记录覆盖，合计明确表示已记录的分类和，不能称作完整总量。完全没有可用原桶时不制造零。

新增 optional recordedUsage：原 executions／observedExecutions／records，四桶值（允许 null）、各桶 bucketRecords 及已知分类和 total。至少一个桶有真实记录才存在；bucketRecords 不超过原 records，各桶为 null 恰对应零已知记录。ready 的完整四桶与总值保持原语义。有缺口时仍不产生原 tokens／cost 字段。

费用独立：costCoverage 保留所有原收到 records、pricedRecords、原 visible／hidden 状态；recordedCost 只使用匹配原 usageRevision、whole allocation、原 valuation availability=priced／completeness=complete 且有确定 selection 的人民币值。计数与金额允许真正零估值，但必须有真实已定价记录；无费率不造零，未定价记录不从分母消失。隐藏状态不携带金额。不能把完整 Task 子集小计冒充所有原收到记录。

## 同快照资格与旧报告

complete-facts summary 保留各日期／source 自己的 metrics，原 Task、Agent／project／profile 及其贡献、attempt／swimlane 保留自己的独立资格；继续严格 schema 核数值、人口与全原 scope。models／calls／captures 原受限集合不由此绕过资格。原 spool／stage／seal／digest／count／receipt／EOF／CAS 验证不放宽，损坏存储不能显示 partial 数字兜底。已有不带新字段的不可变报告继续读原未知状态；服务 executionFactsVersion 与 SPA scope 升级以生成新投影，旧内容不重写。原 project costVisible 改变时的 stale-report 拒绝也覆盖原 Task 新 recordedCost。

## 正式页

全局统计继续仅总览。Token/CNY 优先完整数字，缺口时显示实际已记录值及短“不完整”／调用覆盖／定价覆盖；分类桶逐项保持真实原值或未知。日趋势复用原分类柱、精确数字及键盘／点击／返回语义，已有数据不再被整根空轨道遮掉。大缺口 Card 改为总览内短状态及已有性能质量明细；未有 facts／failed／building 的真实错误保留。所有文案中英一致，复用原 Card／Stack／ActionRow／Button 与标准间距。

## 回归与验收

原拒绝把不完整值称为完整的断言全部保留，另外对新 recorded 字段精确对拍：已知与缺调用混合、未知桶、ambiguous allocation、全未定价／部分定价／hidden、原 revision 不匹配、零真实估值、超过旧10000条与大整数，merge／dimension 与独立 Task／project 一致；同一 attempt 的正常记录加一条四桶重叠排除记录，所有 attempt／Agent／profile／贡献／泳道均保留真实缺口与已收到正常记录，覆盖分母包含被确认有歧义的原记录；正常完全覆盖排除不改变原 totals 或人口。真 PG、原 spool／cache／所有续页至 EOF 及旧缓存升级需覆盖，不用 UI 桩代替后端。页面验收系统与项目、四桶／CNY、柱值与间距、390px、焦点、非总览无大提示；精确 SHA CI 后本机部署。

该修复只补真实已收到数据的呈现，不关闭未接线的 native owner、丢失 before／历史采集、真实大规模100K Task／10M usage及两个 RFC 的剩余工作。

## 本片检查记录（2026-10-05）

有限 DESIGN v2 通过；SOURCE31 v1 保留 FAIL（新增 priced 测试未缩窄 schema union 的 TS2322），仅缩窄实际 priced 分支后 SOURCE1 v2 通过，其余30候选逐字保持。原测试数据、断言与预算全部保留。

本片完整 check v1 在该真实测试类型问题停止；修正后的唯一新候选完整 check v2 在并行 filesystem-metrics/registry/inventory.ts 的 TS2769 停止，原失败回执保持，不能记整仓通过。原观测31候选首尾字节稳定，结构与 lint 通过，未因并行源码变动重复完整门。按 development-rules §3 对本次全部30源码／测试路径精确 lint、console 类型及全部13观测测试文件核对：59 pass／0 fail、25,821断言，真实原 PostgreSQL prepared10 实例身份保持，未增加数据库服务器或改变原预算；覆盖201任务／1001 attempts／10001原行、分页 EOF、同模型歧义与原归属、部分定价／hidden／零值、各范围与旧不可变缓存。

精确提交树六项 hosted CI、本机八组件部署和正式系统／项目页面对账仍待后继回执，不以本片专项代替这些验收。新录入的数字是实际已收到的原范围贡献与人民币验收费率估值；native owner 生产接线、完整 before／历史采集及真实100K Task／10M usage继续，两RFC尚未完成。
