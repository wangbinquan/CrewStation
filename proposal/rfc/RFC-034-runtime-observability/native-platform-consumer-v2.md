# 原生 v2 平台数值消费者与完整统计接线

本片接续已批准 RFC-034 的开发采集范围。原 journal、Session PG 原页副本、普通 outbox 与原页读取口已经存在，继续使用原实现；当前平台消费者仍显式拒绝 v2，因此部署版本开发来源仍为 production-disabled。本设计不把原页读取、测试夹具或数字包数量当作数值消费者已交付。

## 实际现状与边界

`application/developmentUsage.ts` 的 prepareDevelopmentUsagePage 与 developmentUsageIngestion 只处理 v1；同一同步准备函数同时被 reconciliation 和 `wiring.ts` 的删除前原来源 drain 使用。`ports/developmentUsage.ts` 已有可选 nativePage(key, passId, ordinal)，实际平台组合返回 SessionModuleApi 的原 PG 副本。v2 不能通过 v1 的 ancestors 最大64数组、proof步骤数组或旧 capture summary 转换。

`packages/contracts/taskrunner/native-usage/pages.ts` 保留任意精度人口/扫描/页序、原 parent 引用及 EOF；单页1000原行与单frame100步骤是传输包。`development/nativePageRead.ts` 保留原document字符串、独立registration/pod、preparation、admission、ACK与实际rootCreatedAt。普通 outbox ACK之后副本仍可读。`DevelopmentNativePageCaptureSchema` 只说明序列/packet绑定，尚未证明frame里的每个步骤等于该原document对应的packet。

唯一数字账本仍为 usageEvidence / usageEvents / usageProjections / usageChanges / usageHeads，原 accepted price与model evidence用于CNY估值。新增来源元数据只保存原页/父链接/处理进度/唯一归属与证明，不能成为另一份Token总量或金额账本。项目和系统完整报告都从同一usageProjections读取。

默认业务公开 executionObservationsV1/V2 继续保留现有严格合同。V2目前只额外传v1 capture，不能把它称作paged-native合同。开发identity并非业务subtask identity，不能伪装后送进AW业务同步。后续业务原生分页同步须显式新capability与双方实现；不能静默改旧媒体类型或过滤遗漏记录。

## 原页packet准备

新增纯领域函数prepareDevelopmentNativePacket。输入为独立持久registration、冻结selection、来源frame与nativePage口返回的原证据；费用受理检查继续在原application层完成。函数严格解析现有schema，核对同一podUid、turn/turnIndex、namespace、pass/ownerReceipt/ordinal/ACK、sourceWatermark及原sourceGeneration/epoch。返回原证据与该packet原步骤，不重建document、不改四桶、模型、发生时间、stepId或parent引用。

packetCount必须等于max(1,ceil(originalPage.steps.length/100))；packetIndex决定原steps的对应切片。每一条frame measurement必须与该原切片的实际完整字段一致，空session-only/EOF原页也有一个真实空packet。帧重复沿用原数字序列和页fingerprint判定；缺片、额外片、改写/漏掉原步骤保持待核对，不能普通ACK后丢弃证据。所有packet只有逐页/逐包大小，没有pass数、页数、session数、步骤数、深度或总体积上限。

## 来源元数据与完整父链

Observability自有持久native pass/page/session/step-reference关系保存来源身份与处理进度，迁移只在本模块原链尾追加。pass以原development stream、turn、phase、原generation、root、namespace、epoch、owner receipt绑定；page以文本ordinal、原digest/cursor/scan位置/人口/EOF绑定。步骤引用指向Session原页及packet，不重复建Token投影。

所有收到的packet先在原ledger changeDevelopment事务保留元数据、原游标及待处理工作。若普通数字页ACK先于最终数值归并，其整个工作必须已经持久，可在进程重启和outbox空后由原页副本继续完成；不能只在内存保留任务。报告显式声明这个来源尚待归并，不能在未处理完成时标完整。删除前drain必须消费同一持久工作到原EOF，不能在 live consumer外留另一套v1路径。

pass闭合必须逐页核对连续ordinal/cursor、前后digest、累积digest、scan和三种人口，再验证原EOF。父节点晚到时保留原链接；EOF前不声称完整，EOF后缺父、环、另根或重复不同原身份保留具体缺口。父链采用持久链接及有界缓存，path/depth用原字符串/流式hash，不装进长度64数组。全pass与整树不常驻JS Map，也不用最大遍历次数代替EOF。链路扫描和排序沿用同一原snapshot/TEMP，包读可getMany，不能用进程缓存替代当前真实写后读。

新内部UsageRecord scope为原生分页引用：root/session/parent、turn/turnIndex/level，以及原pass identity、ownerReceipt、pageOrdinal、cumulativeDigest。旧scope保留原形。UsageRecord导出已通过contracts/index.ts的现有usageLedger星号出口，不需要收编其他会话的root export改动。completeUsageEvidence携带已核对的pathDigest/depth/nativeSource/generation；完整workspace在分配任何桶前验证全部原父链。legacy选择器不能把这种scope当作空ancestors或删除记录。

## Before / final、原归属与CNY

Resume只能基于同一原来源/namespace/root/generation/epoch的完整before与final，逐个原stepKey核对；未查到基线步骤只在before已原EOF且原键确实不存在时为零。fresh不等于零基线：原root出生、准备、独立登记和原before来源必须确有证明；rootCreatedAt为null、来源变化或已有历史无法排除时继续未知，不能凭fresh字符串、SDK计数或时间猜测完整。

final中的新增原步骤写同一数字账本，实际模型与occurredAt保持，scope引用最终原页。历史步骤变更只在原generation/path/step及唯一原owner得到证明时修订原meter，沿用其原execution/profile/accepted CNY price及发生时间；不能把旧步骤的差额移给当前turn。删除、重置、未知模型/桶、多个owner或未绑定活动保留来源证据与缺口。发生时间未知不以observedAt伪造。namespace/store/step唯一归属关系只指向原meter，不另存可加总的数字。

投影仍使用原revision/modelRevision、逐桶contribution与coveredThrough、原价格版本和估值修订；所有原numeric writer/replay/history修订走同一个task head。新增metadata工作不是金额可见性开关，也不修改项目现有费用设置。已知输入、缓存读、缓存写、输出与已记录人民币继续显示，缺口显式标记；未知不能补零或隐藏同组其它已知数字。

## 组合与恢复

原prepareDevelopmentUsagePage的v1同步入口保留原行为，新增异步准备入口按真实frame分支读取原页。reconciliation和原删除drain调用同一入口/处理器，原独立registration/owner/price检查先完成。v1不读取nativePage，v2缺读取口/原页时不ACK，不退回SDK或v1 proof。普通20页调度是公平批次，持久工作会在后续轮次继续到EOF，不能成为总体限制。

实际Session、platform source、observability wiring、project/system完整报告、CNY重估/历史修订与恢复装配全部接齐后，才进行producer资格验收。开启必须在已批准的明确验收配置先实际执行，之后再决定默认生产开关；本片落档时producer仍OFF。AW独立部署继续本机运行时CNY价格，CS托管形态使用CS冻结profile价与原平台同步合同，不能混用两个价本。

## 落地顺序与验收

1. N1：纯原页packet准备与完整字段/空页/分片/重复/变更回归；复用现有原页读取与schema，不先改默认producer。
2. N2：本模块原页关系、持久待处理工作、原SQLite/WAL来源→Session PG→平台PG、失败回滚与ACK后重启；全部packet/页/EOF对账。
3. N3：内部paged scope与完整父链workspace，1201步骤、超过64深度、父晚到、错误根/缺父/重复身份以及原EOF；旧v1全量回归保持。
4. N4：唯一ledger投影、实际模型和历史owner修订、原发生时间/费率四桶CNY；重放、双writer、未知与部分已知混组不遮蔽。
5. N5：live reconciliation和原删除drain/恢复同链，实际原Session根与platform source，不用mock查询替代真实数据库与传输。
6. N6：正式project/system页面、真实开发/CLI及业务任务核对、真实root与原生子会话、原100K/10M规模和原预算、确切SHA CI及本机部署。全部满足才可关闭RFC，未达成项留在remaining-work。

CS完整本机门只对最终同一候选运行一次；中途纯domain/原PG定向验证按内容留证，HEAD移动不重启已开始的有效门。AW仍只用确切SHA GitHub CI执行测试/类型/E2E。两个系统有限功能设计门和实现门与CI/原规模/正式页面分别留证，禁止把静态PASS或单个数据库夹具宣称为真实生产完成。

## N1 / N2 / N3 父链阶段实现记录（2026-10-06）

N1 原页 packet 准备已实现；N2 将原 pass/page/packet/session/step 引用与普通游标保留在同一个 ledger 事务。实际 SQLite WAL 的 1,201 条步骤、71 个会话与 70 层深度已完成原 EOF 核对；真实 PG 回滚、重放、缺片和 121 个待处理 pass 的续页验证通过。初次定向测试暴露的后页抢先问题已修复，失败证据保留。

N3 当前完成持久父链接与流式 path digest，实际 PG 的缺父、环、父引用冲突以及 Unicode 标识均已有回归。此阶段尚未接入内部 paged UsageRecord scope、数值投影、live / 删除 drain 和完整报告，因此 producer 仍 OFF，开发数值仍不声明可用或完整。N3 后续 scope/workspace、N4 至 N6 按上节继续；不能用这次领域或 PG 测试替代真实开发任务、原规模、exact-SHA CI 与本机部署验收。
