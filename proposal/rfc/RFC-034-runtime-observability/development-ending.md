# RFC-034 持久结束作业限定实施设计

状态：限定设计 v2 独立功能门 PASS，未实现；承接原键派发设计 v2 和已通过限定功能门的 participant。此批先落地 owner 的持久结束状态与恢复入口，生产仍 OFF。原选择/人民币受理/数字副本/私有消费已经具备部分底座，完整项目与系统事实、删除许可和生产接线仍未完成。

## 已核实的断点与范围

AgentExecutionLifecycle.end 用当前时钟写 endedAt；tick 在 finalized 时直接退出，sweep 只读 listUnfinalized。drizzleAgentStarts.update 写回整行，较早读取的 pending/dispatched 快照可能覆盖并发结束状态。现有 owner.close 只封闭准入，既未创建持久结束作业，也不证明模型退出。dispatchDevelopmentAgent 已能返回原键 terminal，包括 Session 持久 finished 和同 Pod 重启后的回执；尚无调用者把它持久落地。

源码：modules/dev-session/application/agentExecution.ts；adapters/persistence/drizzleAgentStarts.ts、developmentUsage.ts；application/development/dispatch.ts；modules/session/api/moduleApi.ts；packages/contracts/taskrunner/developmentUsageStorage.ts、developmentUsage.ts。只在 dev-session 保存结束作业；Session 副本和资源的实际 owner 各自保有数据。跨模块只能通过独立 port/API，不联查 Session、资源或项目私表。

## owner 持久状态与事务

新增 owner-private development_agent_endings，以实际 executionTaskId 为唯一键并引用同模块原受理。原 key/Pod/身份/价格始终从不可替换 owner 读取；作业仅保存首次 reason、逻辑结果证据、observedAt、可证明的 actualEndedAt（nullable）、单调 version、停止证据、closure 水位引用、是否仍需接续。不复制 prompt/nonce/启动秘密/Token 数字或价目表，不将任何等待状态公开为新的业务 JSON。

requestEnding 先在事务外验证所需原 Session/Runner 回执，随后事务按 owner→AgentStart→ending 固定顺序锁定本模块记录，重新核实际执行、原 key/Pod、关闭状态和版本。幂等保存首次 reason、关闭新 bind/start 准入、建立同一 ending，并提交 AgentStart 逻辑结束；成功不是回收许可。并发普通事件、取消、父释放、重复 finished 只能产生一个作业。后续明确 force 请求以独立 loss/授权事实保存，不能自动覆写首次 reason。

普通 legacy 记录没有 owner/作业时保持现有行为。选中新来源后不得由普通 AgentStart 全行写回清空结束或恢复 pending/dispatched；结束提交在同一事务内把AgentStart当前行的私有逻辑结束标志设为不可回退；普通update以该目标行标志作原子条件，只推进允许的cursor/诊断，不覆写state/finalized/逻辑结果/时刻。不能仅在事务外查询ending是否存在再全行写回，否则检查后并发结束仍可能被覆盖；普通更新不为此反向获取owner/项目锁。标志不进入旧公开JSON/业务合同，不删除并发输出。已 ended/finalized 的原记录仍能建立结束作业，不能由旧 boolean 抑制恢复。

逻辑结果与请求 reason 分开：停止/父释放请求可先创建结束工作，真实 completed/error/cancelled 回执随后补逻辑证据，不把请求本身伪造成实际模型终态。已知实际事件时刻才能填 actualEndedAt；仅有无时刻的持久 finished 时保持 null、另存首次恢复 observedAt。不能把控制器重放时钟算作执行时长，也不能用末条 usage 的时刻猜模型结束。

## 恢复与数字/物理出口

作业使用独立有界 pending 查询/持久租约或等价 fencing，按实际执行 ID 公平接续，不依赖 AgentStart.listUnfinalized。恢复扫描原数字 owner，逐项经 Session API 读取精确 registration/receipt；匹配的持久 finished 即使旧 ordinary terminal/ACK 丢失或 Agent finalized，也幂等 requestEnding。新作业的 pending 与原 owner 的扫描都有固定页上限，controller 重启不会留下只有内存知道的等待。

网络、Session、stop 及实际 Pod 读取都在上述事务和项目/资源行锁外；结果回写用原 execution/key/Pod/version CAS。已有binding时，ending worker必须先在事务外用完整原binding调用Session.registerDevelopmentUsage幂等恢复登记，并严格对拍返回registration/key/Pod/full identity/profile；即使owner已关闭、普通dispatch直接返回ending，也不能跳过。登记临时失败继续重试，冲突只等待诊断，不发start、不用无键info重绑。只有原登记恢复/核验成功后才stop原admission与requestDrain。停止不重签MCP或读取当前档位；若Session已有drainReason，复用其已持久首次reason，不改写owner原请求reason；否则使用作业的首次reason，避免恢复或父释放制造reason冲突。临时错误仅重试，不写永久loss、不启动第二次模型。

正常停止证据只接受原 key/Pod/full identity 的 StopReceipt.prevented/finished；普通 Receipt.finished（尤其 interrupted finished）不是停止证明。stopping/unknown/not_found 不推定已经退出。原 Pod 已消失必须有 UID 一致的实际集群事实；force 必须有明确授权与先持久缺口，实际原 UID 退出后才能认为停止。数字出口独立核 Session closure 的实际 M、原 reported N 和缺口，M8/N10 且可读时先复制9/10。停止和数字 closure 都具备后才形成待消费删除许可。

未绑定的路径必须持久关闭准入并核“未发送”的独立证据：原新 layout/受理仍在首次派发前、没有数字绑定且 Session 独立查不到该实际执行的登记；不能单独依靠 pending、空 info、stop not_found 或零 finalThrough。实现若需要 Session 按实际 runtimeTaskId 查询登记，新增明确内部 API 与真实 PG 反例。旧 unsupported/已普通派发不借此证明数字已知零。

## 删除许可及后续接线边界

本批许可仍是内部状态，task-runtime/resources/项目删除未消费前不能开启 production。后续统一防护 scheduleExecutionCleanup、父释放、runnerLifecycle/ready、releaseOf、expireRetention、实际 cluster-control 删除、followRetention、三种 rebuild 和 RFC-037 项目删除。等待时不旋转原 Runner Token、不先转 cleaning/releasing、不投 absent；父关闭新准入并核闭合子集合/version。

删除许可在事务外准备，实际删除提交在 owning module 行锁内重核原 UID/key/version 与父子集合。CNY/outbox 落后不阻挡已有数字出口的 Pod 回收；原非敏感身份、价格、模型证据和来源登记必须保留到消费者/保留条件满足。清理秘密材料与清理归属元数据是两个阶段，不能让项目永久删除先抹掉消费依据。

## 必须回归与退出条件

- bind已提交＋Session register失败＋取消/父释放＋controller重启：原完整登记恢复后stop/drain，不换键、不重发模型。
- 持久 finished＋丢 ACK/普通终态＋同 Pod 重启；Agent ended/finalized；重复/并发请求；重启恢复同一作业与首次 reason。
- 迟到普通整行 pending/dispatched 更新不能回退结束，cursor/诊断仍推进；legacy 无新记录/字段/worker 行为。
- 无时刻 finished 保留 actualEndedAt=null/稳定 observedAt，有可证明事件时刻才补；取消请求和实际模型结果分开。
- 原注册/key/Pod/profile 错配、能力消失、环境替换；价格涨价后原受理/nonce 不变、不取新材料。
- stopping/unknown/interrupted finished、closure 完成但物理停止未知；可读尾部与临时 PG/网络失败；未绑定的独立 Session 查验。
- fencing/版本过期、controller 重启、公平有界补队列、项目/资源事务外 I/O，无 Agent→项目的反向取锁。
- 所有删除旁路与真实两级事实另批验收；传输替身不等于真实模型/集群回收，实际身份与验证资源仍待具体授权。

先限定设计复核，再做纯状态＋真实 PG 作业及恢复反例；实现门、单次稳定候选完整门禁、精确提交与 clean hosted CI 分开记录。共享锁里的外部 RFC 迁移依赖仍须各 owner 正常提交，不能剥离条目或扫入他人源码。此设计不关闭 CS-R02、完整 RFC 或生产 OFF。

## 限定设计门 v1 失败与 v2 修正

v1独立只读设计门FAIL一项P2：bind已提交但Session登记失败，owner随后关闭；普通dispatch直接返回ending，而stop/requestDrain均要求已有登记，因此结束作业可永久等待。v2明确已有binding的ending worker事务外先用完整原binding幂等恢复/核验Session，再原键stop/drain；任何冲突不重绑或启动。新增上述丢登记＋关闭＋重启反例，并明确复用Session已经持久的首次drainReason，owner原请求reason独立保留。另将旧整行写回保护细化为AgentStart当前行的不可回退标志/原子条件，不能仅凭事前查ending；标志仍是私有状态。首轮失败保留，v2当时重新冻结复核；未写结束队列实现、启用生产或执行真实模型验收。

## 限定设计 v2 回执

v2独立只读设计门PASS，冻结SHA-256为7433f4ea360a80d063a3563035a1b324a48caad5bf4cb42455a999577457fdd9，首尾一致。原登记恢复P2关闭；目标行原子标志可阻止迟到整行写回且不反向取owner锁，没有新增功能阻断。复核未写文件或运行测试。此为设计PASS，持久作业、Session按执行查询/恢复、状态原子保护、停止/排空、删除许可与production wiring仍须逐批实现和验证；生产OFF，CS-R02/两RFC不关闭。
