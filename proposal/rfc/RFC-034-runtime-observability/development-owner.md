# RFC-034 开发 owner 接线与清理剩余工作

状态：In Progress。沿用已批准的 [headless设计](./development-headless.md) §§2～8。本页补实现落位与必须先关闭的反例，不新增产品范围、不声称生产开发采集已启用。

## 已验证底座与本批边界

Runner/协议 Stage 1 与 Session PG/outbox 底座已发布；Session 源码1326fdd1六项精确CI成功，本机八组件已部署。价格目录、内部开发身份和原价补算已有基础。当前正式统计和生产采集仍只声明业务来源。

本批仅提供 dev-session 私有稳定意图/nonce、首次人民币受理、实际子 Pod UID 查询、原 journal CAS 绑定、关闭准入及精确来源解析。意图/原键放在独立表，普通 AgentStart 整行状态写回不能清空或覆盖它。关闭准入只阻止新的绑定，不是 Pod 删除授权。数值源解析只返回原注册头和冻结原价，不返回 prompt、nonce 或启动材料。

内部 participant 尚未被生产派发调用。本批不选择 developmentUsageStorage、不创建新数字 Pod、不让两级查询扩大 sourceScope。当前缺少真实来源沿革的主动校验、派发/取消恢复、资源删除屏障、开发 outbox 消费和两级事实/UI，不能因本批存在 API 就启用来源。

## 下一批必须一起接通的路径

1. 受理固定原项目/工作区/Agent/实际执行、算力修订及非敏感 launch 元数据；先保存稳定意图并完成第一次 CNY 受理，再创建环境。价格受理重试只能返回原 acceptedAt/priceBookRevision，零目录仍是冻结的空目录。显式管理员重启用新的实际执行和新受理，不能展开旧绑定；失败后的运行镜像预留有明确 owner 收尾。
2. 首次查询实际子 Runner 的能力与 journal，核对 task-runtime 提供的子 Pod UID；先 CAS 保存原键并成功登记 Session，再发送启动命令。已绑定时先读取原键 receipt；已受理直接恢复，只有同一健康原日志明确未受理才重新取材料。超时、unknown、journal/Pod变化不得补起模型。MCP令牌和解密材料只进本次命令，不能改变原意图摘要。
3. “启动成功但ACK丢失后取消”仍可能有在运行的模型。pending不能被当成未启动：取消先恢复原受理，再请求实际停止及数字排空。数字采集故障自身不能停止正在运行的模型。
4. 接通 CreateNativeExecutionInput → render → ledgerProjection → cluster-control WorkloadPodRender → workloadPodObject 的数字双卷与 Pod UID 输入，同时保留直接渲染路径。非法用途/布局拒绝，旧 render 完全沿用旧能力。原生沿革使用真实持久来源，不能按每个新 Agent 切断旧步骤修订归属；没有原来源证据保持部分/未知。
5. 给正常终态、未派发取消、管理员停止/重启、父工作区释放、管理员工作区重建、启动失败和Pod丢失统一持久“请求结束、等待数字排空”阶段。Session有原键/Pod匹配的完整或中断 closure 之后，才能发布删除期望和回收。可读M=8/N=10先复制9/10，不能把N当M；不可读才记录(M,N]或开放缺口。临时PG/网络失败仍重试，明确强制释放可登记持久中断。估值消费者暂慢不永久占Pod。
6. 同时保护资源台账：native cleaning 和父 releasing 当前已经在 releaseOf 中生成释放期望；只挡 cleanupNativeExecution 太晚。父Pod/PVC及子Agent的删除期望都要等待相应屏障，队列随后接续清理，不能先让资源中心删掉可读证据。
7. 清理必须避免反向锁依赖。当前派发是Agent advisory lock → project admission lock；清理worker已经持project锁。Session/owner恢复在项目事务外做，事务内只重核实际执行、原Pod、原键与清理版本，再提交释放期望；禁止项目锁内回调再拿Agent锁或递归dispatch/release。

## 启用前验收矩阵

| 反例 | 必须观察到的结果 |
| --- | --- |
| 首次价格失败/原价为空/后续涨价 | 不越过受理；恢复仍是原 acceptedAt/目录，不套新单价 |
| 旧AgentStart快照写回、重复/并发first bind | 固定意图/nonce/原键不丢，只有一个原绑定 |
| 成功启动后丢ACK，再取消或重启控制器 | 原receipt优先，不重跑Hook/模型；实际停止后数字排空 |
| Pod/日志替换、新incarnation仍报告原receipt | 不认领新的空日志；保留原身份与未知缺口 |
| M=8/N=10末尾可读与损坏 | 前者持久到10再回收；后者保留8和缺口，不伪造完整零 |
| 父释放、管理员停止/重启/重建、启动失败 | 资源中心和task-runtime都不绕过数字屏障；父工作卷保持到子执行可回收 |
| Agent锁与项目锁并发 | 没有反向等待环；失败由持久队列接续 |
| 开发outbox/原价修订/两级合计 | 精确完整身份选贡献，不伪造subtask，不重复计同一工作区 |

本页实施约束已由独立只读复核确认；复核没有运行测试，也不是本批实现PASS。完成本批内部受理后仍按 [CS-R02～05](./remaining-work.md) 接通消费者、同快照事实与正式两级明细，一起启用并验证。CLI与平台算力测试各自验收，不借用headless结论。


## 本批实现复核与门禁检查点

2026-09-30：限定 owner preparation 的独立静态功能门 PASS，未发现本批必须修复的P1/P2；复核未运行测试、不代表生产全链路验收。首次检查曾发现API跨入ports、组合根超过600行及负例夹具类型错误，现使用独立公开API值、抽出价受理participant/资源记录组合并修正夹具；不删除现有输出来满足尺寸规则。首次测试误用了不存在的kernel工厂，已修正为现有PlatformError后通过。

真实PG和模拟owner环境的10项回归、平台组合7项，以及实际PG/Runner SQLite/冻结CNY估值的3项跨模块回归已通过；原价例实际得到CNY `2.000025`，后续涨价不改变原受理和原估值，空目录0仍不补套现价。首轮40项/277断言的定向覆盖已执行到全部新owner应用/域/持久层和价组合可执行行。随后补pending取消标记与外部受价并发校验，以及task-runtime实际子Pod UID的公开查询断言；修正内容的定向与冻结单次完整门禁待下文回执，不把旧覆盖或静态PASS当作最终检查。


修正候选40项/283断言的相关覆盖通过，实际子Pod UID来自task-runtime持久环境查询。首轮冻结26路径完整门禁在后端类型检查阶段退出2（37.65秒），跨模块精确断言没有标明已成功绑定的非空值；尚未进入全量测试，不能记为完整通过。现按此前已完成bind的事实修正测试断言，保留所有行为断言；生产源码未因此改动。修正后的类型/相关回归及单次完整门禁继续。


修正后的冻结候选完整门禁回执：2026-09-30T01:03:12Z，结构、全仓lint、后端/console类型全部通过；4277 pass／142 skip／0 fail、27,123断言、854文件，测试801.28秒（完整命令849.29秒）。21源码/测试/迁移/锁＋5文档共26路径指纹未变，限定owner preparation独立实现功能门PASS。本机仍1326fdd1；生产仍未调用本批participant。142跳过项和真实身份/模型/集群验收不计为通过。只补本回执与后续删除屏障规划后精确发布，同源代码不重跑完整本地门禁；精确CI及部署另外记录，CS-R02和两RFC不关闭。


## 下一批删除屏障的补充反例与落位

下一批独立只读规划复核确认原方向可实施，但不是代码实现PASS。除前述releaseOf外，必须覆盖以下实际旁路；在这些路径及消费/事实/UI全部接通前，生产仍关闭。

- 等待数字排空必须是独立持久阶段，不能提前使用当前cleaning的凭据轮换。scheduleExecutionCleanup立即换Runner令牌，onRunnerConnected同时拒绝releasing/cleaning；M=8/N=10时若断线，会失去读取9/10的重连机会。待排空阶段保留原Pod/原数字通道，重连不转回running、不经onRunnerReady再次启动模型；只有原键/Pod匹配的closure后才进入现有清理。
- resources的expireRetention可独立把失败父工作区设为absent，cluster-control随后直接removeChildren；需在保留期和实际删除前共同执行持久屏障，并同步task-runtime/ledgerResync的followRetention。已经发出的absent不能靠syncRecord补投影撤回。父Pod/PVC与原子执行集合都受保护。
- 失败恢复、协议不匹配恢复和管理员重启三类rebuild全部核对原子执行集合；不能只让administrator-restart等子执行。父释放先封新准入，再等待集合闭合，最后发布父删除期望。
- 项目锁外执行owner/Session恢复、实际停止与数字排空；项目事务内只重核execution/Pod/journal/清理版本和子集合。资源保留期回调也不在资源行锁内取项目锁，避免项目更新→资源投影与资源锁→项目锁构成等待环。
- Agent标为finalized后不再tick；等待排空须由task-runtime持久队列、pendingExecutions和reconcile补队列接续，普通失败判断不能提前结束它。闭合不等待CNY估值或outbox消费追上，临时网络/PG故障不构成永久丢失。
- 受理与停止之间还须验证“start已发出但ACK丢失/尚在处理，随即取消”的边界：Runner空receipt或cancel的not_found本身不能证明从未运行。迟到启动、迟到旧closure、Runner替换和恢复查询都必须保持原键且不补起模型；没有充分终态/缺口证据不写完整零。

| 新补验收 | 必须证据 |
| --- | --- |
| M8/N10排空中断线再重连 | 原连接归属保持，复制9/10后闭合，ready回调不派发新模型 |
| 失败父保留期到期 | resources与cluster-control不绕过屏障，父Pod/PVC保持到原子集合可回收 |
| 三类重建与父释放/新准入竞争 | 原子集合固定，旧closure不能授权新Pod或新清理版本 |
| Controller重启且Agent已finalized | 持久队列继续排空，不依赖再次Agent派发 |
| Agent/项目/资源锁并发 | 不存在反向锁等待，网络与Session操作在项目事务之外 |
| 已发启动/ACK丢失后停止 | 不把空receipt/not_found当未运行证明，不重复Hook或模型 |

源码落位：task-runtime/application/nativeExecution.ts、runnerLifecycle.ts、requestRebuild.ts、rebuildExecution.ts、ledgerResync.ts、reconcile.ts及pendingExecutions；task-runtime/domain/ledgerProjection.ts与adapters/persistence/ledgerProjection.ts；resources/application/maintenance.ts；cluster-control/application/reconcileObservations.ts；dev-session/application/agentExecution.ts及Session现有register/get/requestDrain/markUnavailable接口。CreateNativeExecutionInput→execution render→WorkloadPodRender→workloadPodObject的双卷透传也须共同验证，旧render保持原能力。
