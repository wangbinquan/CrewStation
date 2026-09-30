# RFC-034 下一批限定设计：原键持久停止与启动窗口

范围：保留原协议3、旧普通命令、Stage1数字receipt；新增可选停止能力与数字停止命令。生产数字准入继续OFF。本批不实现实际来源沿革、owner完整派发、清理旁路、consumer或sourceScope扩大。

## 选择与合同

1. capabilities 增加 developmentUsageStopV1?:1，依赖 developmentUsageV1:1（后者已有usageObservationsV1依赖）。新Runner仅在实际数字journal已打开时宣告二者。新 stopDevelopmentAgent 命令携带严格 DevelopmentUsageAdmission 和预期 podUid；不携带解密材料、MCP令牌。旧普通Start、cancel、旧数字命令原形不变；Session对新停止命令先协商能力，旧Runner未宣告时不写socket。
2. 单独严格停止回执 {version:1,state:prevented|stopping|finished|unknown,receipt:DevelopmentUsageReceipt}。prevented仅证明此受理的CLI从未获得启动许可；并不借finalThrough=0声称原生完整零。stopping有可跟踪的当前Agent且已请求取消；finished只接受原持久终态且无interruption，或另有独立、持久退出证明；本批不新增该退出证明，所以所有interrupted finished都返回unknown（prevented已有独立从未许可控制证明除外）。旧incarnation未结束/实际进程无法跟踪/日志写失败为unknown或明确失败（owner保留未知，不回收）。
3. journal同FULL/WAL数据库新增私有启动控制表，绑定execution、原incarnation/摘要、Pod（数据库本来固定Pod）和stopRequested/launchPermitted。新受理同时创建控制行，旧已受理行不补造“未启动”证明。停止必须验证规范意图摘要和原key/Pod，原受理不存在时使用完整意图登记原受理和停止决定；与reserve/launch许可采用同SQLite immediate事务序列。停止先于Start会生成持久cancelled终态及prevented控制行，迟到Start reserve仅返回原结果，不运行Hook/模型。不同意图或Pod拒绝。
4. launch许可在Hook成功后、driver.start之前同步持久申请；与停止串行且无await分隔。stop已决定时返回false，发普通cancelled终态但不调用driver。许可记录只表明spawn可能发生，不把它当实际started。许可写失败拒绝spawn并保留中断/未知。已许可后的停止必须实际cancel并等终态/末尾；journal不能仅凭registered就伪造从未启动。运行数字事件、完整/中断finalThrough继续原合同。
5. 旧数字行没有启动控制证明时，只恢复/停止已知进程或保持unknown，不因row.phase=registered或无记录就声称从未启动。Runner重启保留stopRequested；原运行旧incarnation仍按现有runner-restarted中断。原prevented已finished取消能跨incarnation恢复。不存在当前可跟踪进程且原回执非终态时state=unknown；任何interrupted finished即使phase/result已终态也保持unknown，不能只检missing-terminal字面值（首个interruption可能已经是journal-unavailable）。本批不会由原v1 phase/result反推退出，不新增独立退出证明，绝不补起模型。
6. AgentSupervisor在首次await resolveCwd之前登记starting槽（连同原数字usage）。取消starting时先写持久stop，再标取消；数字写失败不能返回已阻止。等待CWD不阻塞取消返回；放行CWD后检查取消，在未运行Hook情况下结束。普通旧路径也可以取消其已经到达的starting，但没有原数字受理的未知Agent保持旧not_found，不承诺跨重启/迟到阻止。
7. starting/running同agentId冲突。重复数字Start依旧以reserve重放直接返回，不重跑Hook。starting finally只删除自己的槽。cancelAll覆盖starting与running并按既有shutdown grace处理在途等待。数字stop检查原agentId/key，不会误取消不同执行。
8. Session持久登记原注册头后才能发新stop；核同identity/profile/key/Pod。新stop回执核原key/Pod后将receipt复制入现有PG，原数字尾部仍通过worker排空。本批不自动申请drain、不以stop回执绕过M/N排空。Session已有drainReason时拒绝新的数字start（但允许info/read/ACK/stop）；检查到发送的剩余竞态由Runner持久stop收敛。用户浏览器不能直接发新stop，与现有数字控制命令同范围。

## 落位

- packages/contracts/taskrunner/developmentUsage.ts、protocol.ts（独立capability/command/reply）
- runtimes/task/src/agents/developmentUsageJournal.ts（控制行与原键停止/许可）；developmentAgentUsage.ts（同步许可/停止入口）；managedAgent.ts（Hook后同步gate）；agentSupervisor.ts（starting、取消/原键stop）；runner.ts、commandHandlers.ts
- modules/session/domain/runtimeNegotiation.ts、terminalViews.ts；application/developmentCommandReceipt.ts、commandDispatch.ts（原登记/Pod与drain校验、回执复制）
- 独立 helper 可按目录/函数尺寸拆分；不可跨module private imports。控制信息保存在数字journal，不进入普通输出。

## 验收

真实SQLite：driver流异常且子进程未退出时原v1回执可finished/error但新stop必须unknown；先journal-unavailable再missing-terminal也相同，重开与重发均保持unknown。stop先于Start，重发Stop/Start，原prevented跨Runner重启，已许可后stop不是prevented，旧incarnation未结束为unknown；旧无控制行不补证明；同/不同意图与Pod；控制表写失败不能spawn或报成功，数字capture尾部仍可读/ACK。
Runner真实监督器+假路径/驱动：暂停resolveCwd后取消，取消不等待CWD、放行后0Hook/0model；Hook进行中取消；许可后真实cancel/finalcapture在目录release之前；原键迟到Start与丢ACK不第二次spawn；并发重复；普通旧Start/发送/取消不变。
Session真实PG+fake socket：drain后Start拒绝，允许原stop/info/read/ACK；停止cap依赖/旧Runner无socket写；身份/Pod错拒绝；receipt先PG提交后返回；PG失败不承诺完成。旧严格合同金样保持，新合同单测覆盖。
门禁：限定设计PASS后实现，独立实现门/相关回归/一次冻结full check，精确SHA CI及本机部署另记。本批不会解除生产OFF，stop完成也不替代原生Token完整性。

独立设计首轮FAIL/P2：原v1普通终态不必然证明子进程退出。已收紧所有interrupted finished缺独立退出证明时为unknown，保留原v1receipt和首次中断原因合同，追加两种流异常顺序/重启/重发反例。本批不以现有phase/result伪造退出。

设计阶段历史检查点：修正设计独立静态功能门PASS；当时未运行测试、未实现，生产仍OFF。首次P2与修正保留如上。当时该基础和实际原生来源均未完成；后续实现与完整门禁见下文，CS-R02仍不关闭。

实现接线补充：数字stop与info/read/ACK同为初始化期间可用控制命令；等待镜像初始化不能拒绝持久停止、再让迟到Start执行。新回执stopping也不能携带finished原phase，任何缺退出证明的中断终态保持unknown（已有独立从未许可证明的prevented除外）。生产准入仍OFF。


### 原键持久停止限定实现检查点（2026-09-30）

原数字受理和 stopRequested/launchPermitted/prevented 已在同一 FULL/WAL SQLite 即时事务中持久化；Hook 后、driver.start 前同步申请许可，停止可先于迟到 Start。Supervisor 覆盖等待 CWD、Hook 与已启动进程；Session 校验原登记、能力、key、Pod，停止回执复制到 PostgreSQL 后才返回，drain 后拒绝新数字 Start。初始化等待仍允许数字 stop/info/read/ACK。旧普通命令及 v1 receipt 保持兼容；任何无独立退出证明的 interrupted finished 都为 unknown；已有独立从未许可证明的 prevented 除外。旧控制缺失不补造从未启动证明。

17 个源码/测试文件冻结 hash 的独立限定实现功能门 PASS；复核仅为静态。相关回归使用真实 SQLite、临时 PostgreSQL 与假驱动：47 pass、0 fail、224 断言、8 文件；后端类型、本批 lint、架构检查（58 单元/3372 源码）通过。首轮相关测试 38 pass/7 fail，7 项均因新夹具缺 numeric 目录而在行为前失败，已修正目录权限并重跑；首轮测试类型检查的协议数组字面量也已修正。独立复核发现 Stop 可能覆盖缓存失败终态、丢失原 interruption，已修复并新增两条真实 SQLite 重开回归；真实驱动取消委托疑点经退出等待链静态核对排除，不作为缺陷或实机验收。

一次完整冻结候选门禁、精确提交/CI及本机部署仍待回执。生产数字准入继续 OFF；本批只完成原键持久停止底座，不包含完整 owner 派发、实际原生来源证明、清理删除屏障、consumer、同快照事实或两级 UI。Session 数字副本 closure 仅证明传输终结，不替代实际进程退出；owner 必须同时核停止状态和数字排空后才能清理。CS-R02 与两 RFC 不关闭，实际身份/模型验收没有执行。


### 原键持久停止完整候选门禁回执（2026-09-30）

2026-09-30T03:15:42.642302+00:00，冻结17源码/测试及6文档共23路径的一次完整本地门禁结束：结构、全仓lint、后端/console类型通过；4307 pass／142 skip／0 fail、27307断言、860文件，完整命令957.71秒。全部候选指纹未变，独立限定实现门PASS，相关47/0与224断言通过。只修正文档当前状态及prevented例外、标注设计阶段历史并补本回执，不重复同内容完整门禁。精确提交/CI/本机部署另记；生产仍OFF，实际身份/模型验收及上述剩余依赖未完成，跳过项不计通过。
