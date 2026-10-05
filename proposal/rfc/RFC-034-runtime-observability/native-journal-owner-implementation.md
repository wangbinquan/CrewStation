# 原开发 Journal 持久分页 owner 实现

## 已实现的范围

`runtimes/task/src/agents/developmentUsageJournal.ts:210` 的 `nativeOwner(key, prepared)` 绑定原 Pod、物理 journal、incarnation、启动意图摘要与实际冻结的 v2 选择。准备由原 `DevelopmentNativeObserver` 观察的存储元数据给出；它不证明上游 SQLite fd，不制造 fresh 零基线或完成证明。`packages/agent-drivers/drivers/usage/nativeUsagePassStore.ts:46` 的根出生时刻来自同一次真实 BEGIN，未知保持 null。

`runtimes/task/src/agents/developmentNativeJournal.ts:32` 在原 FULL/WAL 连接内追加 preparation、pass、raw page、ACK、完整 parent/path 和 step membership 证据。这些表是证据与索引，数值事件仍写入原 events／executions，不建立第二套 Token 账本。每个原页的 membership、父链、连续 source 序列、ACK、cursor／digest／counts／EOF 同一个 BEGIN IMMEDIATE 提交；方法仅在真实 COMMIT 后返回正 ACK。

原页可按每帧最多 100 条数字和现有字节传输标准拆包。单包只控制传输，pass 到实际 EOF，没有总行数、页数、步骤数或父链深度上限。移除原 outbox 的 64 MiB 累积截止；每帧和响应包的字节标准保留。原 SDK v1 捕获和 receipt 的严格形状继续工作。

丢失回执后的重送核对原 raw page 和冻结 ACK、实际 membership、完整原父链及尚未确认的 source 帧。普通数值 ACK 可删除已确认的 events，原分页证据与会员关系仍保留。无法核对原事实时不返回正 ACK。实际追加失败回滚全部页和数字相关写入，不能提前释放 reader 原页。重启后原来源继续可读，旧 incarnation 不能续写或伪造终态。

## 原测试与检查证据

`runtimes/task/src/agents/developmentNativeJournal.test.ts:84` 起的真实原 native SQLite → 原 journal → 原 outbox 回归：12,002 步、80 层父链，原输入／输出／缓存读取／缓存写入逐条汇总；实际模型、发生时刻、原根出生与 unrelated root 排除均有断言。另含原 FULL/WAL lost ACK 重送、普通数值 ACK 后重送、真实 SQLite trigger 写入失败与回滚、缺 membership／parent／pending source、payload/counts 改变、原选择／source／incarnation／phase 冲突、未知出生和真实重启。

原数值 outbox 实际写入和读取超过 64 MiB，全部 source sequence 到末尾，无累积截断或 journal-limit。`modules/observability/tests/developmentConsumerLedger.test.ts:251` 起在既存验收 PostgreSQL 上验证：显式 v2 意图不能被原 v1 平台确认或投影，所有原数字账本字段和水位保持，每次独立查询的 snapshot ID 继续独立生成。

本批三个测试文件最终 39 pass、0 fail、36,989 次断言。初次错误消息预言与新查询 snapshot ID 的差别分别留证后精确修正，没有删除原断言。最终目标文件 lint 通过。原 contracts:lock 确认业务 HTTP 契约面无变化，不修改金样。

本批新增代码的 TypeScript 类型问题已修正。当前全仓检查尚有其他会话未提交的 modules/platform/tests/nativeStorageHistory.test.ts 字面量类型错误；不收编、不改写该文件。完整门禁、有限源码检视、matching 登记、确切 SHA hosted CI 与本机部署分开记录，不能把本段针对性结果记作全仓通过。

## 仍需完成，不能关闭 RFC

正式 producer 保持关闭，公开能力仍使用已部署原合同；旧平台显式拒绝 v2 意图／帧，不能确认或丢掉原数字页。下一片必须完成原 Task／开发 Agent 的 before 与 final reader 生命周期、v2 原页／parent 读协议、原平台持久 owner 映射、完整 baseline 配对／历史修订／seal、实际受理价格与模型归属，再切换生产接线。

原 frozen seal 不能改写。未知分类与缺口保持原已记录下界，不能把回调、exit、EOF 或单页 ACK 冒充完整 Token。全部任务／全部原记录的人口到实际 EOF。100K Task／10M usage 的原人口规模验收、两系统真任务和正式页面复验、全部必要 hosted CI 与 CS 本机部署仍需完成。此片不代表整个 RFC-034 或 RFC-371 完成。

## 内外 owner 版本类型与原受理补验

SOURCE12 有限功能门通过后，实际 typecheck v3 仍发现开发会话内部 DevelopmentUsageResolved 未同步 v2，不能记作其他会话错误。v4 继续指出平台组合端口仍为 v1。后继补齐 dev-session 的内部端口、公开 API 和 platform 的组合端口为显式 version 1|2；原 consumer 在投影前仍拒绝 v2，未启用 producer。原 owner 的冻结选择、namespace、独立 key、价格与元数据过滤回归同时覆盖 v1/v2：真实验收 PostgreSQL 12 pass、0 fail、108 断言。typecheck v5 实际退出0，四目标文件 lint 通过。

本批唯一完整 check v1 在其他会话未提交的 Garage deletionPhysics 函数行数86>80处停止，候选未漂移；原失败保留，不称全仓通过，也不修改该外部文件。原 SOURCE12 的11代码／测试／设计文件保持，本文仅追加实际补验记录；精确发布必须包含上述四个必要类型／测试依赖。完整有效检查、确切 hosted CI 与本机部署分开核对，剩余 producer/platform v2/seal/全规模不关闭。

## 原严格启动意图用例的版本补验

00ef7dc05686ab1224c4dbf8390a8e9ed4e9e2f6 的确切 hosted CI（37293646743）中，unit 原 `nativeSource.test.ts` 仍将 `{version:2}` 判为非法，与本批已实现的显式、不可变 v2 选择不一致。后继只修正该用例的版本预言：undefined 继续不默认选择，v1 原 roundtrip 保留，明确验证 v2 roundtrip；非法版本改为3，v1/v2 的未知 path 字段都继续拒绝。原 hello/source v1、普通事件严格形状和投影前拒绝 v2 的保护不变，不启用 producer，不调整生产代码。原失败运行保留，目标用例、目标 lint 与后继确切提交 CI 的实际结果分别留证。

本次原目标用例实际 6 pass、0 fail、45 次断言；原目标 eslint 退出0。没有重跑未变更的全仓检查，也不将目标结果当成新确切 SHA CI 通过。

## 平台接线所需的原页只读入口（开发中）

在原 journal 内补 `nativePage(key, passId, ordinal)`，返回原 preparation、原 admission、同 BEGIN rootCreatedAt、原序列化页与冻结 ACK。读取核对当前实际 Pod/journal、原 accepted key/header/source/turn、原页 digest、member/完整 parent 和原 pending 数字 source；数字 ACK 后继续验证留存关系。已结束或重启的原数据可以作为历史证据读取，但不授予当前 owner、启动许可、process终态或完整统计资格。原数字水位不前进，不构造第二份 numeric ledger，不回读另一份 native 快照。

该内部 primitive 仍需接原 Runner/Session/platform 的严格分页通道和完整投影，producer 保持 OFF。本批新增真实 journal 的原字节、普通ACK后、结束后、真实重启及缺证据/变更内容回归；尚未运行的检查不能当成通过，两个RFC继续开放。

本批原 journal 两测试文件最终35 pass、0 fail、36,952断言；实际2501步骤的全部留存页到原EOF、普通ACK后零数字events及未知rootCreatedAt均复核。typecheck v1 中本会话 pageDigests 的 mutable/readonly 参数问题真实失败留证；改为原 owner.persist 的入参类型后，v2 typecheck、arch:check和三个自有TS的精确lint均退出0。新候选只有一次完整 check 正在运行，结果尚未结束，不声明全仓通过。

此前452d2fd22a90e4f86d4d9a254477bcc0b8437779确切CI37296983040六项全部成功，固定来源镜像本机八组件Ready，248条锁定迁移已校验。正式页面刷新后原两Agent任务仍为16148=276输入+15488缓存读取+0缓存写入+384输出，人民币¥0.011368，两原执行泳道28.0s/29.4s，所属项目与算力名称可见。这不表示本批尚未发布的原页读取已部署，也不替代完整producer/platform v2与规模验收。

## 本批唯一完整检查的实际终态

2026-10-05 11:58:50Z，本候选唯一一次 `bun run check` 结束：arch、lint、后台类型和控制台类型通过；6189条测试／1205文件中6030 pass、156环境 skip、3 fail、261268次断言。原完整日志与失败终态保留，不记为全仓通过。两条 `modules/platform/tests/runtimeImageReferences.test.ts` 在原 fixture 直接写 catalog 时被共享工作树未提交的 native registry 准入触发器拒绝；一条其他会话已改的 `packages/api-client/tests/projectDeletion.test.ts` 期望尚未提供的 capabilities 方法。未修改或收编这些在制品，原三代码候选指纹始终不变。按 development-rules §3 的共享在制品规则，沿用本会话35条原 journal 用例／36952断言、精确lint和类型／结构结果，发布后以干净确切SHA hosted CI验核。

本片发布三个原页读取代码／测试文件、本文和完整共享STATE；SOURCE4的有限功能PASS复用，本文仅追加实际检查终态，不改原实现。此前452d2fd2六项CI／八组件部署的证据保持，本片的新CI和最终本机部署分别核对。before/final、平台v2持久映射／完整历史投影／seal、producer接线与100K Task／10M usage仍需完成，两个RFC不关闭。

## 原页 Runner 通道与 Session 持久副本（本批）

新增 `readDevelopmentNativePage` 严格命令，绑定原 key/pass/任意精度 ordinal 和字节 offset；原 Runner 的 journal 页按 64 KiB 块读取到实际字节 EOF，metadata 与冻结 ACK 全程不变。该数字只限制一个运输块，不限制原页总字节、原页数量或全部用量人口。未知原 rootCreatedAt 保持 null，结束／普通数字 ACK／重启后均能读同一历史文档；读取不增加当前写入或完整 Token 资格。沿用现有内部采集命令入口，浏览器视图不能发该命令，普通旧命令不变。参见 `runtimes/task/src/agents/developmentNativePageReader.ts:8`、`runtimes/task/src/commandHandlers.ts:54`。

Session 组装原字节到 EOF，核对实际 byte digest、fatal UTF-8、原文内容／累计 digest 和准备 sourceGeneration；原文 SHA 遵循原生产端 JSON 顺序，不替换为排序 JSONB hash。原文仅附在该页原首个数字帧已有 JSONB 的私有 nativeEvidence 中，与原数字 rows 在同一个 PG 事务提交；原 event digest 仍只针对原数字 frame。普通最多五帧／1 MiB outbox 去掉私有文档，原完整页走独立严格内部只读接口；未新增第二份 numeric ledger 或迁移锁。参见 `modules/session/domain/developmentNativeEvidence.ts:7`、`modules/session/adapters/persistence/developmentNativeCopies.ts:8`、`modules/session/adapters/persistence/developmentUsageTables.ts:19`、`modules/session/http/developmentUsageRoutes.ts:21`。

正常采集在 PG 原副本提交之后才发送 Runner ACK；整个已提交范围若仍有任一 v2 原页缺失，则不能完成该数字 stream 或确认 Runner。SQL 的存在性查询只取第一条缺口作为拒绝证据，所有已提交记录都参加判定，不是统计取样或总量上限。原 source 消费 ACK、重启和普通数字删除之后，PG 原文仍可按原 key/pass/ordinal 读取。参见 `modules/session/application/developmentUsageIngestion.ts:31`、`modules/session/adapters/persistence/developmentNativeCopies.ts:32`。

本批相关31用例已实际通过，7.25秒；最后两份测试的类型收窄与原 key 字段顺序 HTTP 回归再验证10用例通过、2491断言，3.76秒。真实1201步骤逐页到EOF，四桶求和精确为输入721801、输出6005、缓存读8407、缓存写15613，实际模型名保留。真实 PG 原文写入异常回滚数字行、不发 ACK；实际 ACK 回复丢失后持久副本与原水位经重启恢复。初次 root 测试错误导入未提供的 drizzle 依赖、错误读取包装异常的顶层 message，以及一个新测试闭包类型收窄失败均保留；分别改用既有 PG client、原 PostgreSQL cause 与固定 capture 后通过，没有弱化原断言或扩大旧预算。当前类型与精确 lint 已通过，结构的前次结果保持；本候选唯一完整门尚待终态，新确切 SHA CI／本机部署分别验核。

CS3447104d 六项确切 CI37307118380已全部成功，固定三镜像本机八组件Ready；原 Pod／卷／数据库／248锁迁移保持。AW本会话 CI 时序修复 c835052b5 已直接提交远端，实际只触发主CI37313859339，Windows路径筛选未触发；不把首次假设两个工作流的查询失败或旧 Windows 成功当作本提交全套绿。浏览器当前连接不可用，尚未验核 CS 新部署的正式页刷新。完整 before/final、平台 v2 映射／历史seal、producer与100K Task／10M usage仍需完成，两个RFC继续 In Progress。

## 2026-10-05 本批检查与直接发布

固定24TS的补跑完整check于13:45:53Z终态exit2，54.03秒，候选首尾字节一致。结构与lint通过；停止于其他会话未提交的packages/filesystem-metrics/buildkit/controlTransport.ts:32 TS2367，未进入整仓测试，不记全量通过。前轮检查因会话中断无终态，原日志和中断回执保留。复用此前31项定向和最后10项回归、精确24TS lint与类型通过，依development-rules §3提交自有文件，以新精确SHA hosted六项CI核对干净提交树。SOURCE25功能复核通过；源文件没有为新HEAD重跑或修改。

AW c835052b5主CI37313859339已终态failure，原日志保留。实际失败为并行RFC370迁移后的旧路径与跨模块架构引用；本批原清理回归未再超时。旧定时布局失败已有后继full/WebKit/visual成功，今天full schedule37318548076正在运行。没有跨会话消息，foreign在制品保持。新CS精确CI、本机部署、生产采集与完整规模验收继续，两RFC保持In Progress。
