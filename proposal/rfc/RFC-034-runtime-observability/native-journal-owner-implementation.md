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
