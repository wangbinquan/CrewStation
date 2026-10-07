# N4：原页到唯一原账本的数值与历史归属

本文细化已经批准的 RFC-034 `native-platform-consumer-v2.md` 的 N4。N1–N3 已提交，N4 当前尚未实现，producer OFF。本片不新增业务 V1/V2 合同，不增加第二份 Token／金额表，不改原规模人口、原测试预算、迁移或项目费用可见性。

## 原来源与处理输入

N1 的 `prepareDevelopmentNativePacket` 已逐字段核对真实 Session PG 页的原 document 与普通 outbox packet；N2 在原 changeDevelopment 事务保存每个原页、全部 packet、session／step 引用与普通游标，原 EOF 人口也已核对。普通 ACK 后原 document 仍在 Session PG。N3 已在完整持久父链／同一报告 TEMP 中完成原 graph EOF 核验。N4 只在这些原关系上继续。

后台 worker 直接重读 `nativePage(key, passId, ordinal)` 的原 document，不伪造已 ACK 的 outbox frame，也不重建 document。一个新的领域读校验器核对以下持久原绑定：完整 pass 元数据、独立 registration、preparation、admission、baselineKind／rootCreatedAt；页的 originalDocumentDigest、独立 ACK、ordinal／cursor／scan／counts／payload 与 cumulative digest、sequenceFrom/Through；原页全部 packet 已到且 steps/reference 指纹吻合。只有真实原文中的 steps 进入领域数值函数。每轮按一个原页／100 步工作包，处理游标续到真实 EOF，无步骤、页、pass、session、深度或总量上限。

投影函数输入应改为 `{passKey, passMetadata, pageMetadata, originalPageEvidence, stepIndex, step, qualifiedPath}`，而非强迫重构 DevelopmentNativePacket。步骤必须等于 actual document.steps[stepIndex]，且对应既有 step reference。模型是原 step.model；事件时间只来自原 step.occurredAt，null 保持 null。ModelEvidence 的 sequence/index 来自已持久的原页 packet 序列与原步骤片段位置，不能从 observedAt／当前配置推断。

## Before／final 与原 order

final 必须实际 source EOF、全部原 packet／session／step 人口吻合、完整父链核验。某条原页的数值缺口不应隐藏其它已忠实保留且可归属的步骤；原 sourceIssues 必须进入本 pass 的质量结果，不能被扔掉。完整 before 则还要求同一原 generation／epoch／root／physical namespace、同一原登记与 preparation、原 before EOF／人口／父链以及 sourceIssues 为空。只有这样的 before 中原 step key 真正不存在，才证明零基线。

fresh 仅在原 admission 已冻结 rootCreatedAt、原 preparation 实际早于根出生、全部原 physical source 相同且无更早归属时证明零；fresh 字符串、首次读、SDK 计数或 observedAt 猜测均不成立。更早归属必须排除本 final pass 已经原子提交的 claims；否则 commit 后重启会把同一 fresh pass 自己制造成缺口。

sourceWatermark 全程字符串 BigInt，仅在同一原 journal／physical family 中比较。不能把旧 v1 NativeUsageOrder.sequence 当作 v2 sourceWatermark。过时 final（owner 已受理更晚的 v2 watermark）只留证、不覆盖；同 pass 重放必须核对 lastPageWatermark 与原 step 指纹，数字与价格不会再加一次。

## 唯一原 owner

追加本模块链尾迁移，新增 `development_native_owners`（只引用、不存数值）：主键／唯一键是 physical sourceNamespace + sessionId + stepId；引用原 meter(identity/sourceId/recordId)、原 task/project、originalPassKey、lastPassKey、lastSourceWatermark、lastStepFingerprint 和原 pathDigest／depth。新增 `development_native_work`（passKey 唯一）保留 step cursor、原 numeric／valuation 进度与问题；统计人口／游标可以是任意精度字符串，绝不保存 Token 数或金额。

原 task usageHeads 行锁继续串行化同一 task 的 writer。唯一键阻止相同物理步骤被另一个执行再认领；冲突不能 silent onConflict 跳过或选第一条，必须继续未知并标明 owner conflict。新步骤从完整 before／出生证明零，原 identity、capture sourceId、原发生时间、原 scope 被固定；只产生一份原 usageEvidence。

历史步骤只能修订已唯一核对的原 meter。必须保持原 execution／profile、原 sourceId／recordId、原 scope／turn、原 occurredAt、原 accepted price。新 turn 中的 final 原量修订原 meter，不能把历史步骤的差额写进当前 turn。未知桶保持 null，原账本已知桶规则照旧。模型只允许实际来源证明的 null 到实际值细化；两个实际模型冲突保留缺口，不采用配置默认模型。

对旧 v1 owner，只允许显式“baseline adoption”：实际完整 v2 before 的同一物理 source／root／path／step，与唯一旧 nativeCapture／nativeStep／原 meter 的已受理投影、原实际模型逐项吻合。旧独立 begin／finish store、pod、namespace、sourceEpoch、实际 path 与 fileIdentity 必须都和 v2 preparation 原 store 相同。旧 ancestors 可以流式求同一 pathDigest，不截断。adoption 保存原旧 capture／projectionRevision 与实际 v2 before pass、ACK、step 指纹引用；lastWatermark 是这次真实 before ACK，不是把旧 v1 order 强转成新序。任何映射／指纹／唯一性不充分就不 adoption；旧数字不被删除，缺口显式保留。

## 原账本投影与双 writer

数字仍写 usageEvidence／usageEvents／usageProjections／usageChanges／usageHeads，数值修订使用原 validity=correction。为防旧 legacy overlay 或之后到达的普通 raw writer 覆盖已核对的原生修订，nativeRepairs 扩展为显式 tagged v2 引用：只保存原 meter、proof/owner 引用和 evidenceRevision／model 绑定，不复制原步骤 Token 数。既有无 version 的 NativeRepair 仍按原 v1 行为读取。

应用 v2 repair 时适配器从**同一原 usageEvidence**读取精确 evidenceRevision，核对 owner/scope/source/model 后形成短暂内存投影输入；原持久修订引用不存另一份数字。所有普通 writer／replay／原生 worker 都由原 project 路径调用这一分支。不能先停用旧 repair 然后让迟到 v1 writer 重新覆盖；v1 reconcile 必须识别已存在 v2 引用，只能在明确证明更晚原 order 的规则下替换，否则保留 v2。缺失引用／scope 冲突保持原已知投影与缺口，不能补零。

原 projectionRevision 只在最终投影变化时递增；原 modelRevision 与原所选 ModelEvidence 一致。新的 work commit 使用同一原 changeDevelopment 事务并明确 flush usageHeads，不能为了更新 head 伪造普通 outbox ACK/cursor。owner、evidence、model evidence、投影、变化序列、work cursor 要么同事务完成，要么全回滚。

费用沿用原 executionValuations、受理价与 exact usageRevision。number commit 后、valuation 前失败时，work cursor 保留待估值原 meter refs；restart 读原 usageProjection 与原 ModelEvidence，再幂等估值。F／P 两个人口仍互斥，未知币种／模型／桶／不整条分配不计估值，已知部分人民币继续显示。work processed 必须数字和估值均走到实际 EOF，不能只因普通 outbox 空而完成。

## N5 接线边界与质量

N4 先交付领域、真实 PG owner/work 与原账本联动的消费函数，v1 同步准备入口保留。N5 再把实际 source/nativePage 的异步准备、live reconciliation、删除前 drain、ACK 后恢复接到同一 worker；原注册／受理价核对先做，缺原页不 ACK，不退 SDK 或 legacy proof。

N5 完整报告需要显式新 paged capture 元数据合同／内部 reader，保留任意精度计数、原 pass／work EOF 与缺口；不能把新页数组塞进旧 v1 proof/count 或业务 ExecutionObservationV2。元数据不含可加总数值。报告的数字继续来自唯一原 ledger，当前 native pending/held 只能标记不完整。producer 先保持 OFF，N6 明确验收配置真实执行与正式页面验收后才宣称数值生产可用。

## 有限功能验收

领域回归：完整 before 的新增、fresh 出生／无出生、父链缺口、final 部分已知、未知 before；唯一／多个／无 owner；历史增减修订、未知桶保持、实际模型细化／冲突、原时间 null；相同 pass 重放与过时 pass；v1 adoption 禁止跨 order 强转。

真实 PG 回归：原 Session persisted document 与 Observability packet／EOF；1001+ 步、71+ session、70+ 深度；普通 ACK 后重启工作；numeric/model/owner/head/cursor 的事务回滚；两个 writer 的唯一 claim；旧 v1 raw／overlay 到达顺序互换；估值失败后原价 retry；完整原 EOF 不重计。保持原 legacy 全量回归与原规模人口／预算。中途仅比例定向，N4/N5 最终稳定候选完整门只跑一次；exact-SHA CI、真实任务、规模和 CS 本机部署分别核验。

当前 private 原型并未构成生产实现。本文没有将 N4、N5、N6、两个 RFC 或任何新 CI／部署标为完成。
