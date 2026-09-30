# RFC-034 持久结束作业限定实施设计

状态：限定设计 v2/v3 独立功能门 PASS，第一批内部实现已通过限定功能复核、随cc56推送，并随808c5af0实际部署；承接原键派发设计 v2 和已通过限定功能门的 participant。此批先落地 owner 的持久结束状态与恢复入口，生产仍 OFF。原选择/人民币受理/数字副本/私有消费已经具备部分底座，完整项目与系统事实、删除许可和生产接线仍未完成。

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


## 本批实施拆分与恢复约束

第一批实现持久作业、目标行保护和可单步调用的内部恢复 participant，不接 production lifecycle/定时器，不提供删除许可。字段 actualEndedAt 固定未知 null；当前 Runner/Session receipt 没有实际事件时刻，不从 AgentStart.endedAt 或 worker 时钟补造。已存在 AgentStart.endedAt 保留旧兼容显示，不能充当新执行事实。

结束作业以原 owner 为 FK，首次 reason/observedAt 稳定，逻辑 result 与停止请求独立；保存原键核验后的 StopReceipt.prevented/finished 证据和 Session closure，分别形成 awaiting-stop、awaiting-closure、evidence-complete。evidence-complete 仍只是收集到两类证据，task-runtime/resources/项目删除未消费完整守卫前不返回清理许可。unbound 作业允许封闭准入但永远等待，独立 Session 按执行查验及从未发送证明另批实现；forced-release/environment-lost 也不由本批凭字符串创建永久 loss。

每个作业有递增 fence、租约截止时刻、version 和 lastAttemptAt；有界查询最多32个，按最近尝试最久者与执行ID公平取候选。事务内只依 owner→AgentStart→ending 顺序取锁，重核完整原绑定；claim 用同一顺序且核当前租约，提交证据核 fence/version/租约未过期。过期工作者只能等待，不能覆盖新证据。外部停止命令原键幂等，租约超时不制造永久丢失。

漏掉 ordinary terminal 的恢复不依赖 finalized：owner 新增私有 ending_checked_at，按 coalesce(checkedAt,acceptedAt)/executionId 取绑定且没有结束作业的原记录，FOR UPDATE OF owner SKIP LOCKED，最多32行。先持久推进 checkedAt 再在事务外查 Session；暂时失败或进程崩溃在后续公平轮转中重试，同批不会因低ID运行中任务永远挡住后面的 finished。该标志不进入旧 owner/public JSON。独立恢复登记、finished 匹配后才 requestEnding；不读取当前档位/价格/秘密。

普通 AgentStart.update 的全行 UPDATE 在目标行以私有 logicalEnding=false 为原子条件；如果未更新，则只在 logicalEnding=true 的同一目标行推进 max(cursor) 和非空诊断。并发结束持有行锁时，PostgreSQL 条件重新检查阻止旧快照覆盖；普通更新不读取或反向获取 owner。ending 写入逻辑标志/state 与 owner.closeReason 和作业保持同一事务；原 identity/profile/请求和既有 finalized 保留，后续实际清理需独立许可路径推进。

单步 ending participant 先 claim，取完整原 binding 幂等 register 并严格核 registration/receipt；即使 owner 已关闭，也先恢复 Session 登记，然后原 admission stop 和 requestDrain。已有 Session drainReason 始终复用；stopping/unknown/普通 finished/网络错误不当物理停止证明，Session 的闭合水位独立校验。所有 Session/Runner I/O 都在本模块事务外。状态重放、请求取消但实际完成、M8/N10 尚未闭合、丢登记＋关闭＋重启、并发迟到全行更新、租约过期/抢占、32条公平补队列、旧迁移升级各自有真实 PG 或纯状态反例。

完整删除守卫、原 UID 丢失/force 的实际证明、unbound 独立 Session 查询、真实实际终态时刻、生产接线和两级事实/UI继续留待后续；不因本批内部队列或证据完整状态关闭 CS-R02。


## 持久结束第一批候选检查点（2026-09-30）

本批17自有源码/测试/迁移路径完成内部候选：dev-session私表原执行唯一作业、首次reason/observedAt、逻辑结果与未知actualEndedAt、原目标行私有不可回退保护、有界公平owner补漏和job租约/fence/version、关闭后的Session登记恢复与原admission停止/排空participant。没有生产定时器/lifecycle装配，也没有删除许可；evidence-complete仅内部证据状态。原价格/nonce/固定算力不重新获取，旧AgentStart/ownerJSON没有新字段。forced-release/environment-lost请求没有本批证明而拒绝；unbound只能封闭准入并等待。实际时间合同仍未提供，0014保留actualEndedAt=NULL。

真实隔离PG先确认旧全行更新可把ended写回pending：1pass/1fail；目标行logicalEnding条件修复后2pass/0fail。第一批其他回归11pass/7fail：Drizzle的FOR UPDATE OF带schema限定名被PG拒绝，以及严格回执夹具误含runtimeTaskId；改为唯一外层owner关系的FOR UPDATE SKIP LOCKED，显式原回执字段。次轮17pass/1fail是旧未选择夹具仍尝试bind，修正为旧选择无数字绑定；另修测试数组类型，未调整行为断言。首次失败记录保留。

修正候选最终47pass/0fail/0skip、327断言、7文件，包括纯状态/原登记反例、真实owner/jobPG并发、0014旧库实际升级、32条公平轮转、原键派发/冻结人民币原价既有回归。精确16个TS文件eslint和后端typecheck通过；相关lcov中ending应用/领域/持久request/store/transaction可执行行全部被覆盖，这仅为本地候选证据。结构检查当前只报外部packages/persistence的connection↔transactionContext文件环，本批没有结构违规；不改其并行内容，单次稳定候选完整门禁和clean exact-SHA CI另记。

当前限定实现独立功能复核待回执。所有Session/Runner入口在本批回归仍是传输替身，实际数据库仅验证本模块owner/job；不写作真实模型、完整Session排空或实际Pod删除验收。unbound独立Session按执行查验、force/实际UID丢失、全部删除旁路、task-runtime/resources及RFC037项目删除消费、真实终态时间、生产源与两级事实/UI继续；生产OFF、sourceScope=business-tasks、CS-R02/两个RFC保持In Progress。

迁移0014追加到共享锁时保留所有并行引用，仍未提交整份锁或推送main。已本地精确提交的消费者965b45e8和原键派发646da1e9继续保留；最新锁引用和其他会话的发布状态必须在短时Git临界区再次核对，不能扫入其未提交源码或从锁剥离条目。


## ending 限定实现 v1 失败与 v2 回执

v1独立18前身17路径功能门FAIL一项P2：I/O后虽读过时钟，但commit/retry/claim在数据库取锁前固定时间，等待owner行锁期间跨越30秒截止仍可能接受过期操作。新真实PG行锁反例0pass/3fail准确复现；v2给store注入Clock，在owner→AgentStart→job全部行锁取得后再读当前时钟，evidence.observedAt只保留来源观察含义。修复后3pass/0fail；并未用超时重试或增加租约时长绕过。首次FAIL与红回归保留。

最终18路径v2限定独立静态功能门PASS，首尾指纹一致，自有0014与共享锁SHA-256一致；未发现新限定功能阻断。实际最终相关50pass/0fail/0skip、335断言、8文件，精确17TS lint通过。首次后端typecheck通过；最终全仓typecheck现在被并行packages/persistence/transactionContext.test.ts的4项缺失导出/隐式类型错误阻断，没有本批自有路径报错，不能把最终类型检查写成全绿。上段结构文件环属于当时并行检查点，单次稳定候选完整check以其实际结果另记。

该PASS只覆盖内部作业、原目标行状态保护和可单步接续的participant；实际Session/Runner仍是传输替身，未生产装配、运行模型或回收Pod。evidence-complete没有清理许可；全部删除守卫、unbound独立登记查询、实际UID丢失/force证明、实际终态时间、生产来源和两级事实/UI继续。生产OFF、sourceScope=business-tasks、完整RFC不关闭。


## ending 稳定候选单次完整门禁回执

21路径（18源码/测试/迁移＋3自有RFC文档）冻结后仅跑一次完整bun run check，候选首尾全部未变。该命令在arch阶段退出1：外部packages/persistence的connection↔transactionContext文件环，以及并行resources/0007_project_admission_lock_holder新迁移未入锁；没有进入全仓lint、类型或测试。不能把此前定向50pass/0fail或首轮类型通过写成本次完整门禁全绿，也不因其后续改动重复完整检查。精确17TS lint、50项定向回归和限定实现v2 PASS保持；最终类型四项外部错误仍以记录为准。clean提交树exact-SHA CI须待共享迁移及对应依赖齐備后再验证。

下一步只精确本地提交自有21路径，整个共享锁和外部在制源码留工作树。不得提前push缺失依赖的累计main，不将本地提交写成远端或部署完成。生产OFF、evidence-complete无清理许可，完整开发删除守卫和两级事实/UI继续。

## 2026-10-01 内部底座已随实际布局版部署

本页内部实现已包含在实际本机源码 `808c5af0bf80445c8cfbaf1baca112b74c723b7f`；该提交[精确CI36739319297](https://github.com/wangbinquan/CrewStation/actions/runs/36739319297)六项success，2026-09-30T16:05:16.903Z本机八组件滚动完成，实际镜像/默认Runner/匿名入口复核见[布局查询部署回执](./development-environment.md#2026-10-01-实际布局查询精确发布与本机部署)。历史限定门禁的外部失败与只在本地的检查点继续保留，不以此删除历史证据。生产调用者仍未接通，开发采集OFF、sourceScope=business-tasks，删除许可/完整两级明细与实际身份模型验收继续，两个RFC不关闭。

## 2026-10-01 普通启动屏障外部失败的比例闭环

迁移锁的事件等待于登记后结束；2026-09-30T17:12:59.426126Z，只重查原 platform migrationCoverage 用例得到1pass/0fail、2断言，锁/装配/SQL/持久层5依据及9个自有源码指纹均未变。原唯一完整check4585pass/143skip/1fail和首次定向0pass/1fail的回执保留，不改写成全量0fail。随后共享持久层依赖变化的相关回归仍35pass/0fail、184断言、5文件，后台types-v3通过。

依据开发规则§3对他人在制品导致本地全量红的明确处理，以及用户共享候选“同内容完整门禁最多一次、无关变化只按比例核验”的要求，外部迁移失败已完成有证据的定向闭环；本批限定设计/实现审阅、精确lint/类型及相关用例有效。按17条精确路径进入发布，候选自身hosted CI另记；不收编并行迁移锁或资源删除文件，不重复完整门禁。此刻尚未提交/推送/取得自身CI或部署；实际本机仍808c5af0，生产OFF，sourceScope=business-tasks，CS-R02和两个RFC继续In Progress。
