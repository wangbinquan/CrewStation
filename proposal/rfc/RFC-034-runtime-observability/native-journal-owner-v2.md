# 原开发日志的 native v2 持久 owner

本片属于已批准 RFC-034 完整采集与原生 owner 范围。现有分页 reader/owner pump 已发布 `7b07ad8d3faac2f7a51e555358d38e1a61c93823`：精确 CI `37265018049` 六个作业通过，三份同 SHA 镜像已用于本机八组件部署。现有正式任务核验为 16,148 Token（输入276、缓存读15,488、缓存写0、输出384）、¥0.011368、两条执行泳道。该事实不证明 journal owner、producer 或十百万条规模已完成；开发 producer 仍 OFF。

## 原存储与明确选用

复用 `DevelopmentUsageJournal` 的实际 FULL/WAL SQLite、已有 Pod UID/journalId/incarnation/payloadDigest 与原受理键，不开第二个数字库、不复制原 native 文件。新的启动意图明确选用 native v2；已有 v1 header/replay 不得通过修改默认值自动升级。原 intent 中的 nativeUsageLineageKey、实际运行 turn、generation/epoch、原 root 与 before-spawn 回执一起冻结。原已关闭受理不得凭历史扫描重新获得 launch permission。

实际 native 文件 generation 来自既有 observer 的真实 path/file identity 和持久 sourceEpoch。尚未创建的文件不能用当前时间或临时字符串充当 before generation；缺少可证明的实际 before/root-birth 时，保留真实已知 SDK 数字并标明缺口，不宣称空基线或 complete。旧存储缺根创建时间仍为 null。

## 本 owner 片必须先完成的严格合同

现有 `DevelopmentStartIntentSchema.nativeSource` 仅允许 version=1，且 reserve 与 payload digest 实际严格 parse。这不是已有 v2 入口。本 owner 同片先增加明确的 version=2 选用分支，并更新严格受理/header、原意图摘要和必要合同冻结；不能把新字段塞入旧 v1 或在 replay 时给它新含义。受理的原 identity、profile/revision、nativeUsageLineageKey、resumeSessionId 及 v2 选用共同参与原 payload digest。不存在/旧 v1 选用保持原合同，新 owner factory 必须检查已持久 header 明确 version=2；仅同一 journal/key/Pod/incarnation 的有效受理可 prepare/admit。此项不激活 producer 或宣称平台已支持。

同片定义严格的 v2 native source-frame 公共合同：有限的原 key/turn/lineage/sourceGeneration 与 pass/page/ACK 引用、页内明确 delta/self 的真实步骤数字及单帧最多100项的传输包；完整父链由持久分页 parent/path 引用证明，不能回塞64层 ancestors 或整树数组。frame 必须引用原 committed page、其实际 sequence 范围和全四桶；未知数值为 null。旧 Runner capture/version1 原数字、SDK 合同及 replay 保持，新 version2 分支单独验证与序列化，不能通过宽松 object 或把版本1 parser错误忽略来持久。

平台 v2 解析/投影和 producer 仍可作为后继组合，但在它们完成前不得将 v2 宣告为可启动采集能力，不得把未支持 source 标成已投影/完整。owner 回归只在明确新受理上验证真实持久、严格 frame 与重送；平台正式旧 producer 仍 OFF，新 frame 不流入一个只理解旧 v1 的消费者。后继接线必须让原平台读取/ACK能证明每个 v2 source 已进入唯一 ledger，再允许原 evidence 回收。

## 正回执仅来自事务提交

在原 journal 连接增加 accepted-key-bound native preparation、passes、ordered pages、step membership 与完整 parent 索引。原 schema 初始化属于同一 journal 的结构升级，不动平台数据库迁移或其他模块。对页重复交付，逐字验证原 identity/cursor/ordinal/scan position、payload/cumulative digest、计数与 EOF；确实相同才返回同一已持久 ACK，内容不同则拒绝并保持缺口。

`admit` 保存同一原 reader BEGIN 获得的 rootCreatedAt、原 prepared binding 和初始 cursor，提交后返回 admission。`persist` 在同一 actual SQLite transaction 中写原页、member/parent、按原 admitted authority 构造的数字 source 帧及对应 sequence、水位和冻结 ACK；只有 transaction 实际 COMMIT 后才返回 `NativeUsagePassAck`。页内数字拆成既有单帧最大100项的传输包，但整页原子提交，不以100或页数作为总人口上限。ACK sourceWatermark 指向这批数字/source 实际已提交的末尾 sequence。原 numeric ledger 仍是平台唯一用量账本；journal 页和索引只作原事实与交付留存。

新的原生 owner API 单独返回正 ACK，不能把现有 `capture():void`、AgentRunBase 的 true、事件流 processed 或 supervisor 收到事件当成持久回执。journal 写入/ACK/marker/磁盘失败必须向 pump 拒绝，保留当前未确认原页并中断原 pass。不中断已有模型结果展示，但缺口和无法恢复状态必须准确。真实进程 exit/reap/drain 与 numeric terminal 仍分开，采集失败不能补造退出或完成。

## 分页、恢复与保留

移除开发数字 journal 的64MiB累计 spool 上限。event/page 字节数和一次 capture 数量只限制传输包；磁盘未满时持续保存所有记录，并按实际平台投影 ACK 回收已交付普通 outbox。原 native pages/member/parent 和 pass ACK 不跟随普通 sequence ACK 删除：它们必须保留到平台唯一 numeric ledger 确认对应完整 source 与完成/归档回执后，再按原保留策略回收。不能用“已发送”“processed”或当前内存队列为空替代这些事实。

before 与 final 全部真正 EOF、同 source generation、完整父链、原 numeric membership、历史唯一 owner 修订和实际 root-birth/原有效 admission 才支持 complete。过程包、root/session、深度、步骤、任务、调用和累计字节没有人为总上限。每次只处理有限页；在事务之间让出事件循环并让平台按页恢复，不能在 SQLite 写事务中等待外部 IPC/模型或长生命周期 reader。

重启沿原 journal marker 与已提交 cursor/source/ACK恢复；原 reader 快照已丢失时不能从另一次读继续旧 pass，状态保持 interrupted，已有数字保留。旧 header/native v1 replay 和实际原控制回执继续按原合同读取，不篡改旧 source 或任务归属。

## 先验收 owner，再启用 producer

本次先实现最小严格 v2 受理/header/digest/source-frame 合同、实际 journal owner 与正式 key-bound factory，复用已经发布的 persistNativeUsagePass pump；正式 producer 的能力协商与选用、原 driver 正回执 sink、before/final completion、平台 native v2 projection 与 CS→AW 公共契约是下一项组合实现，未接好前保持 OFF。business execution journal 仍使用原已受理 identity/attempt/payload，不把开发 journal 接到业务上下文；后续按原 business store 单独接相同 owner 合同。

真实 journal 用例必须覆盖：多页直到 EOF、100以上单页步骤分帧同事务、64MiB之后仍持久、丢ACK重送幂等、失败事务没有页/索引/source/cursor前进、marker/key/pod/incarnation/header改变、缺第N行与parent、错误EOF/计数/digest、同快照根时刻与真实 generation、平台普通 ACK 后原页仍可核验、重启与原 pass 不可恢复、旧v1 replay不自动选用，以及真正正ACK之前 reader不能释放当前页。保留所有原进程/terminal/stop和数字四桶/人民币用例，不以源码文本或手写成功ACK代替真实事务。

设计与实现需独立有限功能门；CS 候选只跑一次有效完整本机门，精确提交后验 GitHub CI，再以对应镜像本机部署及正式页面、真实任务和全规模核验。此设计不关闭任何 RFC，不把先前 CI/部署当成本次新 writer 的验收。
