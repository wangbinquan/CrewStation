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

## 下一批实现边界：受理快照透传与固定启动元数据

本批沿用 headless §§2～3，先补未被生产选择的内部链路，不启用开发采集，也不把清理屏障记为完成。

- task-runtime 的 CreateNativeExecutionInput 增加可选 developmentUsageStorage v1；只有开发工作区的独立 agent 用途接受该布局。首次受理固定到环境 render，同一执行重试必须匹配；旧请求省略字段时不追加布局。ledger 路径保留 execution.workspacePod，旧直接准备路径保存必要 render 但不带 execution，以免误交给资源调和器。
- task-runtime 的台账投影、cluster-control 的 WorkloadPodRender 解析和 workloadPodObject 完整透传该选择，使用已有双磁盘 emptyDir/Pod UID 构造。解析要求开发工作负载、原父工作区/PVC/节点齐全，不能混入业务、档位测试或 checkout/archive 路径。缺省仍渲染既有工作卷；实际数字配置仍由 containerEnv 生成。
- agent-runtime 增加内部 launchMetadata(ref)，只读取固定修订的名称、协议、镜像、资源套餐和 launch；不读取凭据仓储、不解密、不运行 Hook。launchMaterial 继续提供当次完整材料。dev-session 通过 compute 端口及 platform 接入元数据入口；目前尚无生产调用，之后 prepare 才能在签材料之前保存稳定意图。
- 真实 nativeUsageLineageKey、receipt 优先派发、取消/清理、source consumer 和两级查询仍按前文接续。不能为每次新执行随机造一条 lineage，不改变 worker HOME 或现有 OpenCode 原生目录。

验收包含实际 PG 的 ledger/直接两种受理与重试冲突、投影→解析→Pod 的双卷/Pod UID/原工作卷对拍、旧请求和业务/CLI/档位测试保持原布局，以及固定修订停用/当前修订变化后元数据不漂移、凭据读取/解密次数为零。独立功能门和完整候选门禁、精确 SHA CI、部署另记；这仍不是实际身份/模型验收。

名称是可修改的目录展示属性，不进入稳定意图。受理名称继续沿用AgentStart的owner快照；launchMetadata返回当前名称时不得覆盖原受理名称。

### CS-R02 owner 稳定受理底座发布与部署回执（2026-09-30）

- 精确源码：`8d2e547adc3251ab3307b61b3faa5134ed08aa67`，26路径提交，推后main/origin一致；独立限定范围功能门PASS，完整4277 pass/142 skip/0 fail、27123断言、854文件，候选内容未变。首轮未进入测试的类型失败及修正历史保留。
- [精确 CI36653568384](https://github.com/wangbinquan/CrewStation/actions/runs/36653568384) 终态success，static/unit/module/console/gate/e2e六项全部success。
- 本机于2026-09-30T01:20:19Z升级完成；迁移Job `rfc034-owner-migrate-8d2e547a` complete，owner与Session数字表存在，storage-contract=1。八组件generation=observedGeneration且Ready=1：console201、API195、auth93、controller160、events63、Session112、两个MCP各59。公开`/auth/login`只读HTTP200。
- 实际镜像摘要：console `b596d245352af9c4d5c725605acd3b38a549aff325153761070185a26e9068bb`；control-plane `f53b151f943a77ff898b2c56fa35e7a5c95121ef60571558e1d223a9ba857738`；默认Runner `10fb9e1c2357a77197a13bd01405deed9466ac3e0b8b333f815b1b395bb26577`。三张构建镜像OCI revision均为完整源码SHA，部署引用固定到摘要。
- 边界：未登录、未创建真实模型/开发验证资源、未重建旧会话或已固定档位。生产开发采集仍关闭；派发/排空删除、消费、正式两级事实/UI及真实身份/模型验收继续。142跳过项不是通过，CS-R02和两RFC不关闭。

后续在制：受理快照的双路径透传与固定启动元数据见development-owner末节设计，独立设计门PASS；生产尚不调用，相关检查与限定实现门继续，不提前记完整门禁通过。

### 受理快照透传与固定元数据候选检查点（2026-09-30）

本批仅补18个源码/测试路径与5份观测交接文档：developmentUsageStorage从实际受理/PG经投影、解析到公共Pod构造器；direct保存render而省略execution，ledger保留原workspace；同执行增删选择双向冲突。launchMetadata按固定修订读取，不取凭据或Hook；显示名仍是当前目录名称，不能覆盖owner受理名称。生产派发仍未调用，清理/consumer/两级事实UI不在本批完成范围。

相关24 pass/0 fail、188断言、6文件（真实PG/实际渲染/假K8s）；后端类型、18路径lint、修正后两测试lint、3368源文件结构检查通过；改到并被lcov识别的可执行行在相关用例中全部执行。独立限定实现功能门PASS（静态，未跑测试）。首轮20 pass/4 fail由套餐ID非UUID和直接准备队列夹具顺序造成，另有测试品牌类型/expected类型未收窄；已修夹具与类型，未放宽原断言。首次结果不计通过。冻结23路径后只跑一次完整本地候选门禁，精确发布/CI/本机回执另记；真实身份/模型验收未执行。

## 下一阶段必须补齐：实际原生来源与持久停止

这是独立只读规划复核发现的未实现合同，不是当前render/元数据候选的失败，也不是生产启用许可。

### 实际来源证明

普通headless未传persistentHome时，beforeStartRunner为每个Agent生成runDir/home；ManagedAgent将outcome.env.HOME覆盖到最终子进程环境，结束后release清理该目录。不能由worker的/work或父PVC UID推断实际OpenCode数据库位于持久卷。Hook输出不能改HOME，但可改变XDG_DATA_HOME或OPENCODE_DB；采集须在Hook完成后、baseline与spawn之前依据最终plan.env定位。

当前nativeUsageLineageKey是受理字符串，AgentRunBase直接写入证明；顺序sidecar epoch只证明扫描次序，不能单独证明原数据库未替换。下一阶段须把Hook前冻结的预期来源约束和Hook后实际来源证明分开；不可改原StartIntent/摘要，也不可为统计改变HOME/原生目录。

- 实际证明区分PVC UID、规范数据库路径、执行本地来源和来源沿革。两个包含相同root/step ID的复制库（/work/a.db与/work/b.db）不能仅凭同PVC合并；每执行随机lineage也不能丢掉同一真实库内旧步骤10→15的原归属修订。
- 仍待实现前裁定：临时HOME支持本轮执行本地原生采集，还是只保留stdout数值并将原生连续性标为未证明；数据库移动、复制、替换/重建的沿革规则。无可靠证据继续部分/未知，不将空数据库当完整零。
- 实际provider/model继续由原生assistant精确关联；配置model不能充作实际调用。
- 最低回归：同ID双数据库、Hook改变路径、最终环境定位、临时HOME结束清理、同库历史修订、替换/复制后的缺口、缺源resume。须验证最终capture先持久入数字日志，再清理Hook目录。

源码锚点：runtimes/task/src/beforeStart/beforeStartRunner.ts、agents/managedAgent.ts、process/childEnvironment.ts；packages/agent-drivers/drivers/agentRunBase.ts、usage/opencodeModel.ts、usage/nativeCapture.ts。上述是当前源码事实，不宣称现有沿革字符串已提供实际来源证明。

### 原键停止与迟到启动

现有AgentSupervisor在reserve后等待resolveCwd，之后才加入running；这段窗口内cancel返回not_found，原Start随后仍可运行Hook和模型。Session现有prepareDevelopmentCommand只核loss/closure，核验到实际发送还存在异步边界。仅阻止Session新派发不能撤回已经在途的Start。

- reserve后、首次await前登记可取消启动；数字路径按原key＋Pod持久停止决定，与reserve串行，Runner重启后仍有效。取消先于Start时，后来Start不得运行Hook/模型；不能因重发再次spawn。
- 回执区分确证已阻止且从未启动、正在停止、已结束、未知；空receipt或not_found不是从未运行证据。停止决定落盘失败保留未知，不能承诺完成后删除Pod。
- Session进入drain后拒绝新的启动派发；已经在途的Start由Runner持久停止收敛。只有确证不再产生数字，且原键/Pod的连续副本完成或明确不可取回缺口持久后，才能关闭清理屏障。
- finalThrough=0仅证明数字传输没有剩余；它不独自证明Token已知为零。源完整性与传输完成分别判定。
- 最低回归：暂停resolveCwd后取消、停止先于迟到Start、持久停止后重启、丢ACK重发、相异意图/原键/Pod拒绝、停止落盘失败、M8/N10先排空可读末尾。普通旧Runner保持原能力，未具备新停止合同不能启用生产数字路径。

下一批先完成这两个独立基础及相应设计/实现门；实际owner派发、全清理/保留/重建旁路、consumer和两级事实/UI按前文继续。当前23路径候选未实现上述合同，CS-R02仍未关闭。

### 双路径 render/固定元数据完整候选门禁回执（2026-09-30）

2026-09-30T01:55:33Z，冻结23路径的一次完整本地门禁结束：结构、全仓lint、后端/console类型通过；4288 pass／142 skip／0 fail、27227断言、857文件，测试976.92秒，完整命令1035.26秒。18源码/测试与5文档在检查期间全部指纹一致；独立限定实现功能门PASS，24项相关回归通过。仅补本回执及下一阶段规划，不重复运行同内容完整门禁。精确发布/hosted CI/本机部署另记；生产开发采集仍关闭，真实身份/模型验收未执行，142跳过项不计通过。

[下一批原键持久停止限定设计](./development-stop.md)修正后独立设计门PASS，首次P2（interrupted finished不是退出证明）及回归保留；只批准限定基础，生产仍OFF。

### CS-R02 render/固定元数据发布与本机部署回执（2026-09-30）

精确源码bc8522cb7c98a6ef308065a5b5821ce181775ad9已推送，23路径独立限定功能门PASS，完整4288 pass/142 skip/0 fail且指纹未变。[精确CI36657789922](https://github.com/wangbinquan/CrewStation/actions/runs/36657789922)六项success。2026-09-30T02:18:01Z本机八组件generation=observedGeneration、Ready=1：console202、API196、auth94、controller161、events64、Session113、两个MCP60；storage-contract=1，迁移Job rfc034-render-migrate-bc8522cb完成，数字表存在，公开/auth/login只读HTTP200。

实际镜像摘要：console sha256:7b530e71a889fe12c0c20d0b16c55a461aad65d6ba23cb561dd2e9e2e628c494；control-plane sha256:becb085ec393e49755e6de24d71a27da256c44ca35e84bafd74e5c3665e06cb4；默认Runner sha256:f8543bd2dfe21ee3efd8f18f2076762283c0321987e6bd90a3fe0b63c707eb60。固定摘要及OCI revision核对完整源码SHA。未登录、未运行真实模型或重建既有会话/档位；生产开发采集仍关闭。实际原生来源、原键停止、完整派发/清理/消费/两级事实UI继续，142skip不冒充通过。


### 原键持久停止限定实现检查点（2026-09-30）

原数字受理和 stopRequested/launchPermitted/prevented 已在同一 FULL/WAL SQLite 即时事务中持久化；Hook 后、driver.start 前同步申请许可，停止可先于迟到 Start。Supervisor 覆盖等待 CWD、Hook 与已启动进程；Session 校验原登记、能力、key、Pod，停止回执复制到 PostgreSQL 后才返回，drain 后拒绝新数字 Start。初始化等待仍允许数字 stop/info/read/ACK。旧普通命令及 v1 receipt 保持兼容；任何无独立退出证明的 interrupted finished 都为 unknown；已有独立从未许可证明的 prevented 除外。旧控制缺失不补造从未启动证明。

17 个源码/测试文件冻结 hash 的独立限定实现功能门 PASS；复核仅为静态。相关回归使用真实 SQLite、临时 PostgreSQL 与假驱动：47 pass、0 fail、224 断言、8 文件；后端类型、本批 lint、架构检查（58 单元/3372 源码）通过。首轮相关测试 38 pass/7 fail，7 项均因新夹具缺 numeric 目录而在行为前失败，已修正目录权限并重跑；首轮测试类型检查的协议数组字面量也已修正。独立复核发现 Stop 可能覆盖缓存失败终态、丢失原 interruption，已修复并新增两条真实 SQLite 重开回归；真实驱动取消委托疑点经退出等待链静态核对排除，不作为缺陷或实机验收。

一次完整冻结候选门禁、精确提交/CI及本机部署仍待回执。生产数字准入继续 OFF；本批只完成原键持久停止底座，不包含完整 owner 派发、实际原生来源证明、清理删除屏障、consumer、同快照事实或两级 UI。Session 数字副本 closure 仅证明传输终结，不替代实际进程退出；owner 必须同时核停止状态和数字排空后才能清理。CS-R02 与两 RFC 不关闭，实际身份/模型验收没有执行。


### 原键持久停止完整候选门禁回执（2026-09-30）

2026-09-30T03:15:42.642302+00:00，冻结17源码/测试及6文档共23路径的一次完整本地门禁结束：结构、全仓lint、后端/console类型通过；4307 pass／142 skip／0 fail、27307断言、860文件，完整命令957.71秒。全部候选指纹未变，独立限定实现门PASS，相关47/0与224断言通过。只修正文档当前状态及prevented例外、标注设计阶段历史并补本回执，不重复同内容完整门禁。精确提交/CI/本机部署另记；生产仍OFF，实际身份/模型验收及上述剩余依赖未完成，跳过项不计通过。
