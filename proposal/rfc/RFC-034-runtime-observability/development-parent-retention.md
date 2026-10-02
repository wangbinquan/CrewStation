# RFC-034 原开发父任务结束与资源维护

状态：In Progress。父生命周期 v6 的独立设计门 PASS；这是完整批准设计的正式落点，实施按小批推进。生产开发采集仍 OFF。Resources 的中性 owner 回调、持久维护租约与共同父准入行锁已写；Task 的固定成员、专用 ending 作业、实际原父物理退出与二次/三次恢复仍待实施和验收。

## 当前实施证据（2026-10-02）

Resources 首轮独立源码门 FAIL，P2-01 是实际 `changes_stamp` 延迟提交锁可发生在末次租约核验之后。旧源码在真实 PostgreSQL 反例中为 6 pass / 2 fail；修正为所有资源/路由写入后排空 `resources.changes_stamp`，再以独立数据库时钟核最终租约，失败则整事务回滚。修正版六个真实数据库/领域文件 43 pass / 0 fail、224 断言；尚未过期的锁等待仍只提交一次。原 FAIL 回执保持。

Resources 登记和 grantStart 以 `storage advisory → 原父 FOR UPDATE → 原 child/volume` 持锁至提交；开放消费者重放重新核归属，非法 ending 字段存在也关闭新准入，已关闭的历史身份仍可读取。旧源码真实行锁回归为 1 pass / 7 fail，修正版三个文件 25 pass / 0 fail、149 断言。这些 SQL 封存回归证明 Resources 共同锁，Task 项目 fence、最后 writer 与投影原子性需后续实际集成验证。

20 路径 Resources 源码 v2 独立复核已 PASS（回执 SHA256 9e0974128c3b472fed745a4b3e1c688c9c77b16e52ef777ff0cf82991a2fde3f），仅证明中性维护与共同锁子集。精确 ESLint 成功；共享树后端类型检查曾被并行 SCM 的 `repositoryWrites` 在制依赖阻断，不能记为全类型通过。完整 CS `bun run check`、迁移锁登记、精确发布/CI、本机部署及父结束实机验证仍待本批实际候选准备。原规则、失败与首尾指纹保留，设计中的 future 验证不算已运行。


状态：v5 独立设计 PASS 已保留；v6 仅明确原 owner 父环境合法没有 render 的身份，不伪造原 render.start，待窄读复核。本片承接已批准 RFC-034 的生命周期退出要求，不开启生产开发采集。原 child 准入/数字退出和 c6860345 通用删除实现、失败回执与成功门保持。用户已批准完整实现、上库和 CS 本机部署；AW 的并行 Task 配置仍由其原会话负责。

## 产品结果与现有缺口

释放、管理员重启、保卷恢复和失败保留期回收应显示真正的等待状态。只要任何原开发子执行尚未取得数字退出和独立物理停止，父 Runner、Pod、render/start、工作卷和原凭据继续可用；界面不能提前称已停止，Task 不能提前释放占用。等待可能很久但不能变成成功、零消耗或自动跳过。

已读实际源码：requestRebuild 在项目事务里先调度 child 清理，随即改父 podName/render/start、Runner hash、连接和状态；execute/reconcileRebuild 只检查 native.state=finished。deferWorkspaceRelease 只看未结束 child；cleanupWorkspace 在项目锁里做 Kubernetes I/O。Resources.expireRetention 在资源行锁里直接 desired=absent。两套实际 rebuildObjects.cleanup 和 Task removeFailedPod/removeRebuildObject 不经过通用原数字许可。DevSession.releaseSession 又把尚未释放的返回对象固定标成 stopped。

本片覆盖 Task 父释放、现有重建请求/补偿、Resources 保留期/压缩和它们的实际 Kubernetes 删除入口。父原生 exec、所有在途命令/未绑定 writer、未知日志尾部、namespace/项目整体验收继续属于下一片；不声称本片已提供全 writer seal 或可以开启 producer。分支/工作树替换只能在原父退出后创建新会话，不能借本片绕过现有活动会话限制。

## 模块与持久原语

TaskRuntime 拥有新 private development-parent-ending 状态机，落在 domain/application/ports/adapters/workers；Resources 只声明中性到期 owner 端口，组合根接 Task 公开 API；ClusterControl 只收中性原对象查询与受限物理动作，不导入 Task 内部。Observability、工作台、用户和计价模块不签退出许可。

新增迁移0019，给 task_runtime.environments 增加 private parent_ending JSON 列；其严格核心字段为 version=1、endingId、原 epochHash、phase，缺/非法 presence 不可降级。另建 task_runtime.development_parent_endings 私有表：operation UUID、parent Task/Project、原 namespace/Pod 名、原 epoch/selection hash、操作类型 release/rebuild/retention/compensation、原材料指纹、数字与物理证据引用、阶段、待应用操作内容、retryAt、created/updated。另有同迁移的 development_parent_ending_children 和 development_parent_ending_objects：前者以 (endingId, childTaskId) 主键固定集合、每行固定原 native/render/选择材料与后续证据引用；后者索引 (kind, namespace, name) 并固定原 UID/hash/owner，供旧 Pod/凭据受界查最多两个。父行保存 membershipRevision=1、全体 memberCount 和冻结状态，不把 JS 的截断数组当完整集合。身份列不可在后续推进里替换，只允许追加证据与阶段；原 Runner 只存 hash，不存明文 token/连接串，所有私有材料不经 HTTP 返回。一个原 parent epoch 只能有一个活动 ending；同请求/同内容幂等，不同意图冲突。历史行不因新 parent render 替换消失，不得复用 Task 当前新 Pod 名来识别旧对象。

本片选择精确 predicate：该原父 epoch 存在 render.developmentUsageProtection presence 的 child（包括 usage-v1 和 removal-v1），或父持有从本片 ending 发布的新 rebuild epoch 的私有继承选择。两代 child 以其原受理字段独立处理；developmentRemovalProtection presence 不能脱离有效 usage protection。任何保护字段存在但非法时是 waiting，不能退回未选择。新 rebuild 的前向选择落在该新请求的 private 原身份中，不能靠 taskId 或名称继承旧 Pod许可。没有受保护 child、没有原 ending/继承选择的旧父仍走原已批准行为，不因加表而默认升级；开启生产采集时新受理保护 child 自然使其原父受本屏障约束。

本片新增专用持久 ending 作业，不伪装成 child 的 native job。作业 payload=endingId，dedupKey=endingId；Task scope 用 lockJobLease 核真实 jobId/fencingToken/kind/payload，在每次阶段提交前后均核。项目 fence 持有期间只有原状态/队列/投影 SQL，没有 Session/Kubernetes I/O、外部 heartbeat 或另一 owner 事务。

等待不消耗五次错误预算成为业务失败。ending 行始终保留 pending/blocked 与 retryAt；专用恢复 ticker 每轮按真实 keyset最多25个到期 ending，给尚无 active job 的行投同 endingId。既有 queue 的唯一 dedup 只覆盖 pending/running，旧 job completed/dead 后允许新 job；新 job 的真实 fence替代旧 job，不能继承旧租约。正常等待记录 retryAt后由 handler正常完成；ticker晚于该 job完成再投递，崩溃/接管按既有实际 lease恢复。暂时错误不能删除 ending 或材料；原操作冲突保持 blocked/可见原因，不能据次数判不可取回。

## 冻结父与 child 集合

接受 ending 时，Kubernetes 检查、服务/配额读取和待应用 render 准备先在锁外完成。原项目 admissions.lock 内只重读 parent 与重建/资源请求，对拍原 Pod/renderStart/Runner hash/工作卷/请求 revision，把原子 admission seal 与 ending 和 child 固定集合一起落库；外部快照过期就重新检查，事务不调用外部 owner。固定集合用同事务 INSERT…SELECT 从 Task 自有 environments 按 parentTaskId 冻结，不把无界 listChildren 传入 JS、不给用户引入新的 child 数量硬上限，也不按页截断。索引 parentTaskId+parentPodUid 使原 epoch 定位可查；每条原 native/render 值按显式版本固定并严格解析。已受理但物理尚未建出的 child、已结束的显式受保护 child 都纳入；不同 epoch 的 active/身份不全 child 固定为冲突成员而保持 waiting。较早 epoch 只有在自己的原退出证据齐全、且明确非活动时才作为历史排除；否则不能用旧新分类丢弃。memberCount 在同事务按固定表计数，阶段完成时用全成员未闭合计数复核，不用局部页摘要签全体出口。

Task 仅把 private parentEnding（上述核心字段）和消息持久到原 parent；保留原 state、connected、Runner hash、podName、render/start、profile、rebuildId 和工作卷。原父 Runner 回调继续核旧凭据；新 requestRebuild 只保存 queued 意图及新 ending，不先把新 rebuildId 放进父行，否则原 onRunnerConnected 会因 queued record 拒绝原父重连。getRebuild 可按 private pending ending 找到已受理请求，公开 DTO仍 queued。

普通和受保护 child admission 的最终项目事务、prepare 的最终提交及回调到父的重新启动路径，都重查 parentEnding；字段存在但非法也拒绝新 child。受理前在锁外做过检查的请求不能绕过最后一次项目 fence。每个原 child 调用既有 scheduleExecutionCleanup；受保护 child保留原 Runner 和 admission材料，由其真实原数字出口/原作业完成。原未选择 child仍走既有清理规则，不升级、回填或剥夺旧选择的成功路径。

每条固定 child 保存 Task身份、原 parentPodUid/PVC/Node、consumer/renderStart、保护选择 hash和必要已有材料引用，另冻结成员协议判别 usage-v1 / removal-v1 / legacy，后续不能改版。active child若不是该 parent epoch，或原身份不全，等待/明确冲突，不用最新目录重构。

removal-v1 只在原 render.developmentRemovalProtection presence 且严格版本合法时成立；finished 必须走 requireDevelopmentRemovalEvidence 验证原 terminal seal/selection，Resources 历史 admission Secret UID 和全部原数字/停止凭据也保持严格要求。非法 removal presence、缺自己的 seal/历史 UID 继续等待，不得被 usage-v1 分支放行。

usage-v1 只在有效 developmentUsageProtection 且 developmentRemovalProtection 严格为 undefined 时成立。活动成员沿已批准 cleanupDevelopmentWorkload 原作业完成，既不添加 removal 标记，也不生成历史 seal/Secret UID。finished 后要求原 state=released/failed 与 native.state=finished、持久 DevelopmentCleanupEvidenceSchema 成功解析，按其原 Task/Project/Agent/execution generation、profile revision、podUid、consumerId、renderStart 与冻结原材料逐项对拍；不以当前已旋转 Runner hash 重算旧 selectionHash，也不调用 requireDevelopmentRemovalEvidence。原 selectionHash 取自原持久数字出口并在 membership 冻结，不回填 originalRunnerTokenHash。独立 developmentPhysicalStop 对拍原 closed consumer、实际 Start permit、原 Pod/Node/all-container proof；原数字 closure 保留 complete/interrupted 差异，不能把未知尾部变完整。历史 admission Secret UID 对 usage-v1 继续使用 developmentAdmissionSecretUid 的原 undefined 例外，不能强加后来才有的回执。原物理 cleanup 成功路径和原 Pod/owned Runner Secret 的实际不存在必须确认；同名替换/读取失败保持等待，绝不删除替换实例。数字退出、消费者或原停止证明缺失不能仅凭 finished 放行。

无保护字段的 legacy 成员保持原清理成功能力。无 startPermit 的 closed tombstone、尚未建出的成员只按其已有版本的真实准入关闭路径处理，不能用无 Pod生成 stop proof，也不能在本片伪造未绑定 writer 出口；不满足自己原证据的成员等待下一片。mixed parent 同时含 finished usage-v1、新 removal-v1 和普通 legacy 时，各核自己的原版本后才能 children-closed，旧成功成员不被新增 seal 永久卡住。

推进每作业最多25个 child，按 childTaskId keyset读取固定表并持久 nextChildKey，循环到末尾再检查未闭合计数；waiting 成员保存 retryAt，不能每轮停在第一个。child退出后的 fresh Task项目事务重新比较固定集合数量/不可变绑定、原 parent epoch和当前真实作业 fence；新集合不能被静默补入旧身份。仅由原 receipt和物理来源的引用形成 children-closed阶段，不把 parent pending摘要当数字许可。每条已选择 child须原数字和独立物理双闭合；未选择 child保持既有清理语义，不伪造原数字/父日志证据。本片仍不证明未绑定 writer/在途命令全部退出，不能据 children-closed 开启 producer。child清理完成应唤醒对应 ending；恢复 ticker保障消息丢失后继续。

## 原 epoch 与可变诊断分离

epochHash 使用显式版本的不可变受理 tuple：parent Task/Project/kind/volume mode、namespace/原 podName/podUid/pvcName、原 profile/labels/volume identity、Runner token hash、原 render.start 及受理 render 材料。render 中 runtimeConnectionDeadline/runtimeInitializationDeadline 等可续诊断不入摘要；state、connected、message、updatedAt、startup 观察、parent_ending 阶段、child cursor/retryAt 均不参与。不能直接复用包含 state/connected 的 developmentParentWitness。原 Runner 的真实 connected 更新和诊断不会使同 ending 永久失配；原 token/hash/Pod/PVC/renderStart 改变则拒绝。物理 prepared 另对原真实 Pod/Node/PVC/Secrets UID 与不可变 spec/source facts形成 materialsHash，不把 ending annotation/finalizer 或 RV 等可变 metadata 算进不变量；每次实际 metadata/Delete 仍使用新读的 RV CAS。新 rebuild 发布形成新 epoch，仅旧 ending complete 后开放。

## 所有实际写点的同一 admission seal（v1 P2-01 / P2-03）

原父状态不变，因此拒绝新 writer 必须依据真正的 ending seal，不能依据 state=running/connected 的旧条件。接受 ending 的同项目事务把私有 parent_ending、完整固定 child membership 和 Resources 父 admission-sealed 投影一起提交。Task 的 syncEnvironmentLedger 遇到 parent_ending presence，必须对该投影失败重抛，不能沿用普通父保存点 catch 后吞掉的降级；这一原子性从接受、阶段提交一直保持。没有 ledger 的现有独立 Task 装配仍用 Task 最终 fence；正式 ledger 装配缺投影能力则不接受 selected ending，不把旧字段缺失当成功。

所有普通/受保护 child create 最后提交、直接 prepare、公开 Controller runnerValues 最后的 Runner hash 更新，以及 bindWorkload 的 state/Pod UID/Secret UID 最后事务，都在原 admissions.lock 下重读 parent_ending 与原 parent epoch。字段存在或非法时，新的 token/物理绑定结果不提交；旧 runnerValues 已在锁外生成 values 也不能返回作新创建材料。不能依赖第1到25条 scheduleExecutionCleanup，受 seal 的第26条及以后同样被关闭。checkoutValues 在取外部凭据前后核原 epoch/ending；所签结果不参与新的 Pod/Secret 创建，真正 writer 还受 Task/Resources 最后 fence。原已绑定、已持久身份的 child 回调和数字排空仍按既有原选择推进；禁止用 late 新身份修补 membership。

Resources 原 Agent/CLI 消费者 register 与 grantStart 的最终事务必须与父 seal 持共同父行锁。顺序固定为 lockStorageTask(consumer.taskId) → resources.records 的原 parent id FOR UPDATE → 读取子记录/卷/ending 并验证 → consumer 插入或 Start permit 更新；父锁持有到提交，不以重复普通 get 代替。assertConsumerOwner 改为先取得父记录写锁再读取子记录，register 的已有未关闭消费者分支也必须走同一最终检查，不能先用普通 needsDevelopmentOwnerCheck 读取后跳过；legacy 仍按其原 owner 条件成功。凡原 parent spec 出现 developmentParentEnding（非法也一样）拒绝新的 child register/grant；只允许其原持久 close/recordStop 退出。

Task 的同项目 Executor 中，接受 ending 的 env 更新和 ownerWriter.declare 父投影保持同一事务；declareIn 对同一个 resources.records 父 id 的 FOR UPDATE 与上述父锁真正冲突。Task 这条路径顺序为 admissions 项目锁 → Task 原父行/固定成员 SQL → resources 父行 → sealed 投影，拿父行后不反向调用独立 Resources safety 事务或申请 storage advisory。Resources 不持父行调用 Task 项目锁。项目锁串行所有 Task child 受理；Resources 父锁串行其已受理 child 后续启动，从而没有跨 owner 逆序锁。已取得父锁并读到 unsealed 的 grant/register 要先提交，seal 必须等它释放后冻结/提交；seal 先提交时，等待父锁的 grant/register 醒来看到 sealed 并拒绝。原 permit 在 seal 前已提交仍属于固定成员与原物理核验；不存在 seal 已提交而旧读许可随后成功的第三种结果。新 purpose=development 的 parent 观察也持同一父锁，仅严格 prepared owner 分支可注册/绑定；不开放任何新 child writer。新 purpose=development 的 parent 结束观察只走严格 prepared 的独立 owner 检查，不能借这条例外放行子消费者或普通 writer。closeConsumer/recordStop 保留原消费者出口，不被“关闭新启动”误挡。

Task 周期 reconcile、observeStartup、markFailed 的最终事务和 runtimeInitialization 的最终事务均同样检查 selected parent_ending。外层只用于节省无意义观察；真正保证在持项目锁后，不能用锁外旧读代替。pending 时，周期 Failed/Succeeded/Missing、旧 starting rebuild 的超时/失败，以及初始化 succeeded/failed/cancelled/unknown 都仅保存不改原身份的诊断并幂等唤醒 ending；不进入旧 failed/replacing/ready 转移、不覆盖 waiting 说明，不旋转令牌、不退额、不补投旧 rebuild、不在 selected 项目事务内 deletePod/podPhase。已经从本片发布的新 recovery epoch若首次遇到 terminal 初始化/启动失败，则先在同项目 fence接受该真实epoch的 compensation ending，后续物理操作移到专用 worker；原 Pod Missing仍缺 proof而等待。非法 parent_ending 同样不能进入旧删除/失败分支。

bindWorkload 和 runnerValues 对 selected 父本身也在最后事务核 ending；原 Runner 的连接/断开诊断可保留真实 connected 状态，不能借 bind/初始化把旧保留父推进新 rebuild 或新 epoch。释放/重建的新 render真正发布、原 ending complete之后，才开放属于新epoch的既有创建/初始化路径。初始化/启动观察的旧结果即使在 seal前读出、seal后才拿到项目锁，也不能覆盖封存的原父。

新增真实 PG 两种共同锁时序：在 grant/register 持父 FOR UPDATE 后挂起，seal 必须阻塞直到许可事务提交；先让 seal 提交，后续 grant/register 拿父锁后必须拒绝。故意移除父写锁的旧实现必须重现 seal 后旧许可提交。mixed usage-v1/removal-v1/legacy 的 finished 与 active 原真实 cleanup 各覆盖一次，旧成员无新 seal/历史 UID 仍可按原完整凭据推进，新成员坏字段/缺 seal 保持等待。原连接/诊断变化不改 epochHash，原 hash/Pod/renderStart 改变必须拒绝。新增真实 PG 与公开 Controller 反例：固定集合至少26项，令第26项 runnerValues/bind 先读后挂起，提交 parent seal，再放行旧结果；token/state/UID不变且无新 Start permit。并发 consumer register/grant 和父投影失败要证明只有两种完整结果：grant在seal前完成并成为原成员，或seal先提交后新grant拒绝；不允许 Task已seal、Resources未seal。两种周期入口与初始化的全部终态同样做锁竞争，断言无selected K8s I/O、无退额/旋转/旧恢复推进，并保留 legacy 正常流程。

## 新 parent 物理退出选择

本片的 parent fence是新 ending 操作此刻对活着的原父实例的前向保护，不能宣称它是父 Pod历史创建回执，也不改 c686 child marker 的“仅新建对象写标记”规则。缺原父 live实例、UID/Node/materials、原 child证据或独立停止来源时继续等待，绝不回填历史 UID 或标记来伪造已停止。

children-closed之后，专用物理 adapter读取原 parent Pod、工作 PVC、原节点和其实际引用的 Runner/owned checkout Secrets。每个 UID、原 Runner hash、不可变 Secret、镜像/卷/节点/容器布局均与原 ending 对拍，不能凭同名许可。共享的 SCM credential只作为材料依赖保留，不按父所有权删除。先准备原 source facts并以 UID+RV CAS把新的独立 ending annotation、WORKLOAD_CONSUMER_ANNOTATION=本次 consumerId 和 WORKLOAD_STOP_FINALIZER联合安装到当前原 Pod；父自己拥有的 Secret metadata 只安装 ending annotation。不可改变 Pod spec、Secret内容、其他 finalizer或 child标记，已有不同 consumer annotation 也不能覆盖。annotation只识别保护，值绑定本 endingId；既存冲突/同名替换均等待。

安装/回执丢失的接续只能按这一已持久 ending和原 UID/spec/Secret facts，读取同一 ending marker重新核证；不能把无 prior ending 的 marker收养为历史事实。新的 parent consumer由 Task选择，Resources持久，WorkloadConsumer purpose扩为 development（Intent/Consumer一致、finalization=null），与 business/agent/archive分开；此消费者只证明父物理退出，不赋予 Token零或原生日志 closure。顺序固定为原 ending/consumer 登记 → 原活 Pod/Secrets UID+RV metadata fence → 独立 Pod/Node Start identity 存储 ACK → close consumer → 发布 StopIntent。原 Pod已实际存在的选择必须有真实 Pod/Node start identity ACK，不能走“未登记且无 Pod”的 no-writer分支。

这个 ending consumer不进入原父 Runner启动/原生 Agent admission payload，不更换现有 Runner镜像或旧 init布局；是结束时新设的物理观察身份。Task 投影在原资源 spec 中增加独立的 developmentParentEnding 严格判别版本字段：admission-sealed/children 阶段只有 version/endingId/原 epochHash/原 renderStart 与 Pod名；prepared/stop-intent/proved 阶段才带完整 consumer Intent、原 Pod/PVC/Node UID、nodeName、原材料 hash。未完成物理身份阶段不能伪造 nullable Start 身份或允许 parent consumer register，并且只有 StopIntent 阶段添加 ReleasePending 条件；不把它写成新的 render.start 或原 startup admission。Controller 从原 record spec 的 ending 字段解析物理 consumer、从原 Pod metadata 核同 ending，不能假定原 Pod 启动时曾带过 WORKLOAD_CONSUMER 标记。新增字段的非法形状保持等待。若中途错误，仅保留、继续同 ending；未 ACK 不删原 Pod/Secrets，不轮换原 Runner。

Resources 新增单独 developmentParentEnding owner 检查，在 purpose=development 或 parent-ending 字段存在时优先执行，不能落进现有只允许 agent-execution 的 assertDevelopmentConsumerOwner，也不能因缺 record 降级 business。它只读 Resources 自有原 dev-workspace、volume、ending 投影：owner/ref/project、原 record.id=taskId、desired present、原 Pod/PVC children UID、原容器/卷绑定、完整 Intent/修订/节点、原 ending/material hash 全部一致。prepared 阶段允许原 Failed 条件，因为是在对真实已运行失败容器建立退出观察；其他 ending 阶段不开放新 register/grantStart。此例外仅新 purpose，原 Agent admission 的 Failed/Paused/ReleasePending 拒绝不放宽。grantStart 的 Pod/Node必须与该原投影身份相同，volume缺失/改变、旧 ending 或非法字段一律等待。现有 (namespace,podName) consumer唯一约束保持；已有不同 consumer的原父不能注册新身份、不能静默替换，等待明确冲突。后续 closeConsumer/readStop仍按这个原消费者，不能借新 purpose注册一般开发 writer。

Controller复用独立 observeWorkloadStop/classifyWorkloadStop来源：真实原 Pod UID、原 Node UID/lease、全部实际 init/normal/ephemeral容器实例与终止/确未启动证据。新 development purpose的 consumer如果原 Start ACK缺失，明确 unknown；不得复用 proveConsumer 里“无 permit + Pod不见”就成功的旧例外。proof须存储 ACK后才能移自己的停止 finalizer。秘密删除还要原 Pod确已消失，Pod消失本身不能生成proof。

parent删除查询继续使用已发布 inspectDevelopmentRemoval 的中性 target/decision，不新造可伪造的 HTTP permit。它先在私有原对象索引找 parent ending，再读 child旧查询；只读原 ending、固定 child数字/物理出口、原材料和Resources真正proof，不在Controller里推进owner、装假作业或冻结请求。operation=delete/Pod 仅在 children-closed+原 Start ACK+StopIntent 时允许 UID/RV停止请求，不要求此时已有 stop proof；operation=stop-finalizer 必须 parent proof ACK，delete/Secret 还要原 Pod实际不存在。无 query且有新 ending marker、marker非法、原 ending缺失/读取失败/材料冲突均等待；marker不能当permit。旧未标记且不装 query的批准旧调用方继续其原行为，不承诺识别无标记的保护历史；正式组合和生产开启前必须证明每个实际factory都接原Task query，并保留现有 nested factory scope/RV约束。

## 释放、重建与补偿

释放接受后只显示等待子执行/原物理停止；DevSession.releaseSession按返回的真实 Task状态及原 connected/previewOf 组 DTO，不能对 pending 固定传 stopped。原父 state 不作非法 running→creating 提前跳转；等待原因由原 message 与现有 queued rebuild DTO 显示。原父状态/连接可用不等于允许新 child，后者受 private ending fence独立拒绝。只有 child闭合、parent proof ACK与原 Pod真正消失后，真实ending作业在项目fence内将父改released、旋转原凭据、释放占用并一次发事件。原持久卷保留；follow-container卷仍需原批准的实际卷回收来源，不能靠parent摘要删PVC。

保卷重建的 proposed Pod/Secret/profile/render/start只在ending private记录与queued rebuild意图里，原父不提前变化。原 child和parent物理退出完成后，项目fence内把新期望一次发布并唤醒原rebuild worker/ledger；之后沿用原PVC UID检查、新不可变Secret/新Pod身份和启动流程，不自动重启旧CLI。正常等待不增加reconcileRebuild attempts或写failureReason。

新恢复Pod失败时，实际 owner/ledger两套cleanup都必须通过原owner ending许可；先受理独立compensation ending并保持失败Pod/Secrets/PVC/额度。其child集合按该新epoch冻结；Task仍creating的反例可证明不能新受理child，但不能仅因此伪造物理停止。原stopproof后才实际删除、失败终态/轮换/退额。Kubernetes I/O不得留在selected父操作的项目事务里；legacy未选择路径保持。

Task recoveryCluster.removeFailedPod、taskRemoval/removeRebuildObject/rebuildProvisioner和Controller rebuildObjects.cleanup的真正 DELETE统一接原query/新的parent physical adapter，UID+RV CAS，不仅包外层 facade。私有直接cleanup的 Pod与Secret按步骤等待，子数字或父物理读失败不能当已不存在。nested实际factory必须继承并再查原query，不丢RV或绕过自己的等待；默认与注入装配都覆盖。

## 完成 compensation 后的再次合法恢复（v3 P2-05）

原 rebuildInspection 明确支持 failed 会话的原 Pod 不存在但原 PVC 仍可用。新 selected compensation 删除 Pod、旋转 Runner hash后，下一次合法恢复必须保留该能力；此时不重新要求 live 旧 Pod，也不把当前旋转 hash当作旧 physical epoch。普通尚未退出的 ending仍执行前述 live prepared 链路，本节仅承接同物理 epoch 已完成的 compensation。

ending.complete 的同一个实际作业 fenced 项目事务新增不可替换 completionWitness：version=1、endingId、operation/outcome、原 physical epochHash、原 Pod/name/UID/renderStart/PVC UID/materialsHash、原 consumer与已 ACK stopProof digest、固定 membership/原退出摘要、最终 Task 转换 before/after digest、旋转后的 Runner hash、completedAt。after digest覆盖最终 state、Pod/PVC/render/profile/rebuild 绑定和新的 private parentEnding complete 指针；真实 connected/message/更新时间等诊断仍不参与。最终 env failed、原 ending complete与见证在同 Executor事务提交；投影失败须整体回滚。原 Pod/owned Secret actual absence ACK来自锁外原 UID观察，不能用 Task终态造 absence 或无 permit证明。该完成材料与历史对象索引保留，后续新请求不能改旧ending意图/consumer/closure。

在 environment_rebuilds 新增同迁移0019的私有 development_parent_binding JSON列，持久严格判别 pending-ending 与 completed-ending。前者记录原 pending endingId/epoch，后者记录 original endingId/physical epoch、completionWitnessHash/afterTransitionHash和原 PVC UID。domain EnvironmentRebuild 与真实 table/mapper完整保留；DTO rebuildToDto仍只输出现有公开 queued/replacing/start状态，不返回私有材料。原选中 rebuild 也持 pending-ending 回指，从该记录发布的真实新Pod epoch只有在 task.rebuildId/render.rebuild.id、该record.podName/PodUID/start/PVC绑定一致时继承新退出保护；原 completed proof不能作为这个新epoch的物理证明。缺/坏 binding不升级旧record，也不能清除既有选择。

新 requestId的再次恢复先在项目锁外执行既有 validateWorkspace/原PVC检查，并额外确认原 Pod与owned Secrets当前确不存在、原 PVC UID及保卷意图与 completionWitness一致。任一同名替换对象、变卷/变epoch、consumer/proof缺失或读取失败保持 waiting/冲突。项目 admissions.lock 内重读 Task与原 private complete ending：必须 outcome=compensation、Task当前 failed、complete指针/afterTransitionHash/当前Runner hash与见证相符，原物理tuple未换，固定成员闭合仍成立且无新active child。该分支不按旋转后的 hash重算旧epochHash。只给新的 queued rebuild record写 completed-ending binding和 proposed新材料，原Task/render/hash仍保持；不同输入/旧requestId遵循原请求幂等/冲突规则，不能改旧completed记录。

既有真实 rebuild作业消费这个 binding时，在锁外再读同 consumer/原 Start/已持久 stopProof、原对象absence/PVC UID，随后在其现有请求与项目fence内重读完整binding、Task after-transition见证和闭合成员。仅该相符的已退出物理epoch跳过旧 Pod/Secrets cleanup及live prepared步骤，把原新期望按一次事务发布并沿既有Owner/ledger provisioner创建新容器；不是建立第二个 ending consumer，也不添加旧对象索引重复记录。保留现有请求作业接管/失败对拍，不能用旧Worker修改新request。新请求成功发布后 private pending/complete父指针清除、状态按原 failed→creating转移，新immutable Runner材料/新的Pod名/start生成；新record的选择回指仅表示该新恢复须使用新epoch的独立 compensation，不赋予旧proof。新的失败产生新的物理ending；旧query仍只凭原历史 ending判断原旧对象。

真实回归必须经过 selected新Recovery失败→原独立全容器proof ACK→compensation complete/原UID Pod与owned Secrets删除→Controller/Taskworker重启→新的 requestId合法保卷恢复，证明旧Pod无需再出现、只有新Pod/Secret启动、旧 proof不充当新epoch proof，原PVC UID保持。补原stopProof/见证缺失、after hash/render/state/epoch/PVC/成员变化以及同名UID替换拒绝；竞争两次新request只受理一个，旧request重放不改新epoch；新Pod再次失败重新取得自己的停止证明后还能第三次恢复。原 released 终态仍无非法 released→creating扩展，legacy失败Pod已不存在的原成功能力保持。

## 已完成凭据的实际作业发布与单请求占位（v4 P2-05-R / P2-06）

同迁移0019增加私有 development_parent_rebuild_claims（sourceEndingId主键、currentRebuildId唯一、revision、afterTransitionHash、state=pending/published/released、retryAt）。该表与原 ending身份/完成见证分开；不得改原 complete ending的operation/consumer/closure或复制原对象索引。接受 completed-ending rebuild的项目事务先锁/核 source complete ending和当前 claim，再做受理 CAS、插 queued rebuild、写严格 binding（含claim revision）与投真实 REBUILD_JOB_KIND作业，事务整体提交。claim为pending且其currentRebuildId仍queued/replacing时，第二个不同requestId必须conflict；原 findRequest只处理同requestId幂等，不能代替claim。同一源实际发布新epoch后，旧source after-transition与当前Task不再相符，不能再借它接受新恢复。若旧请求明确终结在发布前，只有Task仍等于同原见证且没有任何新epoch发布时，才能CAS递增revision交接给新请求；旧worker必须核currentRebuildId/revision而拒绝迟到提交。新epoch再失败形成新的complete ending和独立claim。

owner与ledger的 completed-ending queued request都 enqueue真实task-runtime.rebuild payload={requestId:record.id}，不可沿原 requestRebuild 的 ledger不入队分支。rebuildJobHandler在解析真实payload后，把新 application/development/parent/rebuildPublication.ts作为runRebuild最早入口，位于 creation==='ledger'、env.rebuildId/state以及beginReplace早退之前。uow新增 rebuildLease.requireCurrent，真实lockJobLease核jobId、fencingToken、REBUILD_JOB_KIND与同requestId payload；新来源不借nativeLease、不只用heartbeat作为写授权。核consumer/proof/absence/PVC、准备新immutable材料均在项目事务外；publication的同项目短事务前后核实际job fence、claim revision/currentRebuildId、原完成见证、Task after-transition、全部closed成员及原工作卷绑定。quota.acquire使用真正将发布的新creating环境，原失败会话的额度不足时不改旧Task/原卷；正常临时等待记录可见原因/retryAt，不把wait变成五次失败。

同一publication事务更新 env的新podName/render/start/hash/rebuildId/state=creating、rebuild state保持现有queued、claim state=published。旧complete private指针清除，新render.rebuild带版本化的新恢复selection回指；该新selection存在时，syncEnvironmentLedger投影失败同样重抛整体回滚，不能因旧parent_ending已清除而退回吞错。投影与新Task必须完整一起提交。该selection仅令新epoch失败时受理自己的compensation，不携带旧physical proof。新phase发布后，owner job进入它的现有provisioner，ledger job结束并由既有resources变更日志唤醒Controller；Controller workloadApply此时才有实际新render.rebuild.id可进入reconcileRebuild。不能指望未发布render的Controller唤醒完成前置publication。

Task恢复ticker兼顾parent pending endings与上述pending claims，总每轮预算25，以各自持久/轮次keyset游标公平重投；claim的queued临时wait作业正常完成、retryAt后以真实新job fence继续，崩溃/已dead队列也能补投。重复投递仍用原dedupKey=新record.id；publication commit后job ACK丢失，复读published claim/实际新epoch，只接续同record provisioning，绝不再旋转hash/start或发第二份新Pod期望。真实worker与恢复ticker实例重启不丢claim。getRebuild/recoverableDevSession在原env.rebuildId之外也检查私有当前claim，故新请求已accepted而Task仍failed时UI看到真实queued且第二请求被拒绝；不把旧failed rebuild误作当前任务。

selected owner新epoch与ledger reconcile的Secret准备、Pod创建/读取、Preview/cleanup和heartbeat也必须移到Task项目事务外；每次SQL写只重查原新record/epoch/claim或Controller原resource heartbeat与Task identity，既有legacy路径保持。旧两个runRebuild SQL块或reconcileRebuild SQL块不能包住selected外部I/O；rebuildExecution提供被新handler和已发布ledger callback共同使用的selected分段推进，实际 ending/compensation阶段仍必须由专用持久ending作业核fence。Controller的创建模式仍由其受限operations执行，Task不自行写ledger-owned K8s对象。selected物理查询在无active ending时也核Task当前私有recovery selection；原对象未受理退出则waiting，不因尚无ending物理索引退回legacy delete。旧scope/query/UID/RV、坏selection waiting和未绑定来源未闭合的限制保留，不在此片声称全writer seal。

真实回归需先红后绿：owner和ledger两种queued completed-binding在旧env仍failed/旧rebuildId时，调用实际rebuildWorker.runOnce，证明前置publication可达且顺序正确；随后owner真正创建、ledger Controller真正创建/回调。并发两个不同requestId验证真实API只有一个accepted且另一conflict、同requestId幂等；worker在Project行锁等待时job lease接管/claim revision改变不得写Task/投影，job ACK丢失重启只有一次start/hash发布。原Job已dead后的ticker真实补投、额度不足完整保留原材料、selected所有外部I/O不在项目锁内、新epochcompensation→新claim→第三次恢复均覆盖。新选择非法或无作业fence不能沿legacy早退/错误补偿删对象。

## 保留期、压缩与资源 CAS

Resources的中性 RetentionEndingSnapshot含id/project/owner/kind/generation/version/retainUntil/specHash，handler结果为unselected、waiting或permitted绑定快照。不暴露Task数字或凭据，Resources不理解日志/价格。正式组合在启动maintenance前登记Task owner handler；新选中的资源缺handler保持waiting。其他owner和已证实未选择的旧Task记录仍走原到期规则。

每个due candidate先在Resources行锁外调用Task：接受相应 parent ending或原child cleaning并持久排队，原期望保留。Task在自己原项目fence内验证资源绑定，数字/物理依自己的worker推进；不持Resources记录锁等待Task/Session/Kubernetes，不在Task项目锁里回调独立Resources事务。

owner真正退出后，Resources才开启短资源事务重读record，对拍完整snapshot，仍failed、retainUntil到期、desired present、generation/version/spec/owner均未变才desired=absent/generation+1。变化就废弃旧结果，下一轮重新问owner；不能在锁里再次调用owner。已由Task同事务投影转absent的行不二次计数或覆盖原因。安全单调性来自已持久的Task admission seal/ending epoch，不用瞬时“当前没有任务”摘要。

compactStopped同样在资源锁外询问选中owner是否原终态/原材料已收妥；保持原Resources历史、Task ending及引用，waiting不压缩成owner查无。压缩最终 CAS和namespace/旧对象查找不删除原ending证据。无owner/临时错误保持原记录。

新增 resources/0009_maintenance_sweeps.sql，只有该模块的 maintenance_sweeps 状态（step=retention/compaction、scanCutoff、afterId、epoch、leaseHolder、leaseUntil、fencingToken），不存 Task身份或退出证据。每轮在短事务中行锁抢步租约，过期接管 fencingToken递增；holder为本轮新 nonce，先取得可能等待的 sweep 行锁，再以独立 SQL SELECT clock_timestamp() 取此刻时间，按该时刻发完整新租期；不采用事务稳定的 now()。用固定 scanCutoff 截取候选，按不可变 id 升序 keyset读取最多100个，不按会变化的 retainUntil/phaseSince 作游标；到期判断仍使用 retainUntil < scanCutoff / phaseSince < stoppedBefore。锁外逐项 owner 调用结束后，资源最终 CAS 和保存本页最后 id 的短事务采用统一 sweep 行锁 → 本项 resource 行锁的顺序；取得全部可能等待的锁后，另发独立 SELECT clock_timestamp()，核同 step、epoch、holder、fencingToken、leaseUntil 严格晚于此刻，并在实际最终 UPDATE 前以 clock_timestamp() 再拒绝到期。claim/renew 同样在拿锁后计算 TTL，不能依赖 FOR UPDATE 同语句目标列表的提前求值。waiting/错误也前进。进程崩溃时仅该页最多100个重放，不会重新困在前100个waiting对象。页为零后重置 afterId、更新截止时间并 epoch+1，之后重新遍历旧 waiting 和新到期项。步骤异常由现有日志报告；不提升每轮扫描预算，不把超界工作宣称完成。既有 retentionDue/compactable 端口保留兼容，正式维护改用新 sweep 页端口；selected owner 与 legacy 的最终 CAS均重新核数据库当前到期时刻和全部快照，不能因遍历游标而扩大许可。

maintenanceWorker 不允许 setInterval 形成重叠维护：single flight+finally 释放运行标记，stop 等待当前轮；跨进程只用新 sweep 表的真正 fenced lease，不以已有无 fencingToken 的 ResourceLeases冒充。owner调用前后以各自短 sweep 事务取得锁后取 clock_timestamp() 核/续同 lease，续租失败停止该页，旧轮不提交 owner许可或覆盖游标。owner接受 ending 本身仍为幂等、必须对拍原资源快照并由其自身项目 fence决定，不得撤销新的 owner意图。

## 精确验证与发布顺序

### 已核现有原语与源码锚点

| 原语 / 当前缺口 | 当前源码位置 | 本片落点 |
| --- | --- | --- |
| rebuild受理提前改 Runner/render/start | `modules/task-runtime/application/requestRebuild.ts:19`, `:47` | 锁外检查、锁内仅冻结原父与 queued 意图，退出后再发布 |
| release只扫 unfinished，锁内清理集群 | `modules/task-runtime/application/nativeExecution.ts:120`, `:166`, `:205` | selected父转专用ending worker，保留旧父环境 |
| rebuild只信child逻辑结束、cleanup直接删除 | `modules/task-runtime/application/rebuildExecution.ts:31`, `:62` | 真实双出口及两套实际adapter受限删除 |
| ledger重建回调与等待次数 | `modules/task-runtime/application/reconcileRebuild.ts:22`, `:31` | 尚未发布新render时不启动，不把ending waiting记失败 |
| 原 Runner只接受旧环境状态/凭据 | `modules/task-runtime/application/runnerLifecycle.ts:23` | pending不改state/连接/hash/rebuildId，允许原重连 |
| child最后准入与prepare项目 fence | `modules/task-runtime/application/development/workloadAdmission.ts:58`, `:108` | 所有最后提交重查原parent ending |
| native队列fence的真实kind/payload | `modules/task-runtime/adapters/persistence/drizzleUnitOfWork.ts:53` | ending专用kind/endingId和真正job lease，不能套native身份 |
| 当前Task原Pod只定位现行行 | `modules/task-runtime/adapters/persistence/drizzleRepositories.ts:33` | 新私有历史对象索引，原UID/材料不随新render丢失 |
| generic writer嵌套rebuild未带query | `modules/cluster-control/adapters/k8s/managedObjects.ts:84` | 内层实际factory继承同query/scope/RV |
| Controller/Task两套实际rebuild清理 | `modules/cluster-control/adapters/k8s/rebuildObjects.ts:77`, `modules/task-runtime/adapters/k8s/rebuildProvisioner.ts:68` | Pod→原proof→finalizer→Pod不存在→原Secret逐步查询与CAS |
| failedPod/rebuildObject直接删除 | `modules/task-runtime/adapters/k8s/taskRecoveryCluster.ts:34`, `modules/task-runtime/adapters/k8s/rebuildObjects.ts:17` | 原查询接到真正DELETE，UID/RV限制 |
| 缺permit与Podmissing捷径 / 实际all容器proof | `modules/cluster-control/application/workloadSafety.ts:37`, `modules/cluster-control/adapters/k8s/safety/workloadStop.ts:28` | development parent必须实际Start ACK与真正原proof |
| 现有Resources开发owner只准子Agent | `modules/resources/adapters/persistence/safety/development.ts:58`, `modules/resources/adapters/persistence/safety/guards.ts:18` | 严格独立parent-ending owner检查，不放宽原Agent |
| consumer登记/start/stop真实存储 | `modules/resources/adapters/persistence/safety/repository.ts:36`, `:80` | 复用真正register/grantStart/recordStop与原unique约束 |
| 现有消费者purpose与finalization | `packages/contracts/api/resources/workloadSafety.ts:8`, `:17` | 同时扩Intent/Consumer，development须null |
| retention / compaction锁内直接修改 | `modules/resources/application/maintenance.ts:19`, `:34` | 中性owner端口锁外询问，短资源CAS与持久sweep fence |
| maintenance timer可重叠、release DTO固定preview | `modules/resources/wiring.ts:140`, `modules/dev-session/application/sessionLifecycle.ts:123` | single flight与pending真实preview/state |
| Queue实际完成与去重范围 | `packages/queue/worker.ts:46`, `packages/queue/jobs.ts:33` | 正常等待handler完成，durable ticker重新投递 |

表格只锚当前实现；新增文件与待写测试属于精确候选的 plannedPaths，不声称其已存在或已通过门禁。

1. 独立设计门PASS才实施；精确候选与原参考/并行字节冻结，记录实际新DDL/迁移锁。共享DataControl迁移/锁输出保留，发布等其依赖准备，不扫入本片、不重写共享锁。
2. 真实PG：项目锁竞争冻结集合、已经finished的protected child、半受理/迟到prepare、新/旧child、原父Runner重连、同请求重放/不同内容冲突、真实child receipt+Resourcesproof、作业接管/旧结果不能提交、queue五次错误后真实恢复继续等待而无轮换/退额。
3. 实际K8s adapter：Pod/Node/PVC/Runner/checkout Secret替换，非法/孤儿marker，marker安装CAS/ACK丢失，全部init/normal/ephemeral状态，Pod消失无proof、缺start身份、异节点/restart、自己的finalizer及同UID不同RV，默认/注入nestedfactory和两套直接rebuild cleanup。proof、Pod意图、finalizer、Secret和额度每一步顺序有可断言来源。
4. 真实 PG sweep claim/renew/final CAS 在事务开始后等待锁跨过 leaseUntil 的反例必须拒绝原资源和游标写入；拿锁后的新租期按 clock_timestamp() 发足。同 holder未接管但过期也拒绝。释放/重建/retention/compaction及selected初始化的项目事务回调里不发生Session/Kubernetes I/O；Resources行锁内不发生owner调用。真实PG反例锁资源版本/原owner/规范specHash变化拒旧许可；maintenance waiting前缀后面的无关到期项和真实keyset续页可达。
5. 旧未选择/业务/原绑定正常数字退出和原价/四桶不回退。工作台按实际pending状态展示，不更换本机既有项目/session/Runner，也不把显示夹具当实采。
6. 独立实施门、稳定候选一次完整CS门禁、精确提交/远端同步/六项hosted CI、本机平台部署、可用浏览器和原真实验收资源各自取证。不由同候选无关HEAD变化重复full gate；本片没有AW本机测试/服务许可。

退出本片仍不等于CS-R02/R13或RFC-034整体完成。全writer/在途seal、未绑定和unknown-tail须后续自己的版本证据与实际任务验收；生产producer保持OFF。

## v1 独立失败与 v2 修正回执

v1 候选 `c1a25f238150ac00e0f61b0b3eece7a57bd9f7d74d41a7bab09fd2d1743a1ea2` 与原三份窄参考补充保持。原独立 FAIL 回执 `observability-cs-parent-retention-design-review-v1.json` SHA256 `f625a39e4512e56d9020cf2a4b04d321218a242586a5be96c0b7da7a0151ef9b` 不覆盖。

v2 将三个实际写入缺口纳入：`application/failEnvironment.ts:30`、`runtimeInitialization.ts:22` 与 `reconcile.ts:21` 的周期/初始化最终父状态保护；锁后独立 `clock_timestamp()` 的 sweep 租约核验与真正最终写点；`workloadRender.ts:44` / `:64` 的最后 values/bind，以及同事务不允许失败降级的 `adapters/persistence/ledgerProjection.ts:46` 和 Resources真正 register/grant。仅设计修订，源码/迁移/正式采集未修改。v2仍需独立功能门才实施，不能把未来测试、私有设计或原business页面验收记作本片通过。

## v2 独立失败与 v3 修正回执

v2 候选与窄读补充保持不变，原 FAIL 回执 observability-cs-parent-retention-design-review-v2.json SHA256 943badaa2bf5fe82df43a3d6f6b2ed8e0b3053df4ebdd1e39c148bb6368866a5 保留。周期/初始化最终写点与锁后 wall clock 的 P2-01/P2-02 已在设计层关闭；剩余 P2-03-R 的共同父记录串行锁和 P2-04 的两代 child 证据已分别具体修正。v3 仍仅是精确设计，未修改源码、迁移、生产 producer、原会话或验证配置，待独立功能门后实施。

## v3 独立失败与 v4 修正回执

v3共同父行锁与两代成员修正已在独立设计层关闭，原 FAIL仅 P2-05：compensation 完成后删除Pod/旋转hash，下一合法保卷rebuild没有completed-ending承接分支。原回执 observability-cs-parent-retention-design-review-v3.json SHA256 d704489b19eda9b7d1c90be33ed106d6f0ec38f00f9e8a2ac7892565770f5940保持。v4把真实完成转换见证与原物理退出绑定，新的独立request在现有真实rebuild作业中承接；不另登记旧consumer、不复制旧物理索引、不回填历史proof，也不要求已经删除的旧Pod再次活着。仅设计修订，尚未实施。

## v4 独立失败与 v5 修正回执

v4 completed物理材料层已通过，但真实旧worker/ledger早退使前置publication不可达，且不同requestId无持久占位。原独立FAIL回执 observability-cs-parent-retention-design-review-v4.json SHA256 dc1d702b9e0029c62cf2a662d11271ae914f4e9507948416c4fbc99fea95c10d 保留。v5在实际rebuildJobHandler最早入口签真实job fence，为两种模式共用SQL publication，然后保留各自真正物理writer；独立claim在同项目受理事务CAS串行不同请求，并支持重启/ACK丢失/预算内重投。这里只修设计，尚未落源码或部署。


## 原 owner 父环境无 render 的兼容补充（v6）

实际 createEnvironment.ts 只在 creation=ledger 时持久 WorkloadRender，owner 原开发父环境合法没有 render，但有原 PodUID/Runner hash/真实 PVC。originalRenderStart 在 ending 原身份、严格资源投影、物理材料和 completionWitness 中统一为正整数或 null：仅原 render 真有 start 时写该值；原 render 严格缺失时写 null，并以原 namespace/Pod 名/实际 PodUID/Runner hash/PVC UID/profile/受理材料固守原 epoch。坏 render 或 present 却无有效 start 不降成 null，一律 waiting。null 不等于从未启动，也不生成 zero/start/stop proof。新 ending observer 的 consumer.revision 是自己的固定正整数 revision=1，与 originalRenderStart 完全分开；该 observer 仍必须读原活 Pod/Node、安装 UID/RV 受约束元数据、ACK 原 Pod/Node Start，然后 independent Stop proof ACK。所有 owner/ledger 判别、资源 register/grantStart、epoch/completion/source claim 对拍使用同一严格字段，不比较 consumer.revision 与 nullable 的旧 start，不补写原 env.render，也不变动原父 Runner/工作卷。旧 owner 测试须真实验证没有 render 的父也能退出与再次保卷恢复；原 Start/物理材料缺失仍等待。


## 2026-10-02 原父身份持久校验修正

纯领域身份底座首轮独立 FAIL（回执 SHA256 3578dcfaaf68b8a7d06c471df4a06450bdb3101a024860953c79a13d9e481ee1）：snapshot 严格校验原 render，但持久 epoch/schema/hash 可接受 present `{start:null}` 或缺少 image/workerUid/resources 的材料。直接 JSON 恢复反例在旧源码为 6 pass / 1 fail，修正后单文件 7 pass / 0 fail、75 断言；snapshot 与持久入口共用同一校验，完整原材料和扩展字段进入摘要，只有严格不存在 render 才可为 null，两种诊断期限继续排除。新增 pointer 夹具保持 version/phase 字面量类型，原类型失败回执保留。精确 ESLint 成功，后继类型检查及独立复核仍待回执。

这两个领域文件不生成 Start/Stop 证明，不签物理删除许可，也尚未接通 Task 表、正式 job/rebuild worker 或生产采集。全体原成员、真实父退出、恢复占位和重复保卷恢复继续按完整 v6 实施；完整门禁、上库、精确 CI 与本机部署未在本段提前关闭。


## 2026-10-02 正式维护 owner 接线与定向回归

v8 限定设计独立 PASS 后，正式平台和真实 Task 夹具均注册实际 owner 回调；没有安装无条件许可。全局 `maintenance_sweeps` 只登记为非项目内容控制表，删项目保留其完整租约/截止点/游标，未知表仍拒绝清理。显式选中记录即使已注册回调返回 unselected，也必须等待，不能回退到旧清理路径。Task 在原项目准入锁内使用完整 SQL EXISTS 判断受保护子成员，真实 27 行用例中第 27 项的 present false 标记仍阻止旧父回退；不只读取首 25 条。

原始 terminal Agent 的 compaction 对拍自己的数字回执、关闭准入、实际 Start 身份与独立全部容器 Stop proof；新 removal-v1 对拍原 seal，旧 usage-v1 不补造轮换前 token、历史 Secret UID 或新 seal。owner 询问与 Resources proof 读取不发生在资源/项目写事务内，最终资源 CAS 继续受原选择、版本与独立数据库时钟租约约束。新的父 ending/rebuild/retention 尚未接通，保持 waiting；全 v6 的固定全体成员、原父物理退出、最终作业租约、恢复占位与重复保卷重建仍待实施。

针对性覆盖运行使用已批准且未替换的 55334 验收 PG，实际 max_prepared_transactions=10：18 文件 100 pass / 0 fail、688 断言，候选源字节前后稳定。新增用例分别验证全局控制记录保留、显式选择不能回退、旧/新终态压缩与缺 proof/坏选择/错绑定拒绝、完整 27 行查询，以及实际注册能力缺失必须等待。原红例和两次因 UUIDv4 负例夹具不合法而失败的日志保留；负例已换合法 UUIDv7，没有削弱产品验证。当前 arch、37 个精确 TS 文件 lint 与后端类型通过。

本批独立实施门与一次联合完整 check 尚待最终回执。已与 RFC-037 会话协调：共享平台文件保留两方输出，共享迁移锁完整保留 0009 与 SCM 0005/0006；只有两方源码/迁移依赖全部提交后才推送完整快照。当前没有新增发布/CI/部署完成声明，生产开发 producer OFF，RFC-034 与 CS-R02/R13 均保持 In Progress。

## 2026-10-02 维护 owner 的真实历史兼容修订

正式接线 source v1 独立审查保留 FAIL 三项 P2：普通平台算力自测的资源不属于租户项目；truthiness mapper 把 present JSON false/null 等吞成缺省；历史预览维护投影遗漏正式限流中间件。v9 限定修订设计独立 PASS，不覆盖完整父 ending/rebuild/retention，0019 仍未应用，生产 producer 仍关闭。

真实 PostgreSQL 先复现 0 pass / 3 fail：坏 owner JSON 被错误允许、普通平台自测和含正式中间件的历史预览永久等待。修订引入 SQL presence 读取，按原 Task 实际项目（包括平台测试哨兵）锁内重读，严格缺省 runtimeValidation 与规范项目/owner/kind/id/specHash 对拍；完整原材料摘要包含 preview/rebuildId，正式预览解析在项目事务外。补充夹具的错误依赖注入与“新 render 已有 route 因而不查 Service”前提导致 20 pass / 2 fail 已保留；修正为真实旧 owner 后最终 22 pass / 0 fail / 207 assertions（6 文件）。原平台测试通过与失败回收走公开 runProfileTest，限流 route 涵盖旧移交和新 ledger；Service 阻塞期间独立 NOWAIT 证明 Task 项目锁空闲，labels/preview/rebuildId 三种材料变化都等待，严格拒绝坏 specHash 和选中用途验证。

定向 lint、arch、typecheck 通过；更早 18 文件 100/0 及组合根真实迁移 1/0 的成功回执保留。先前 coverage 仅复用于源指纹未变的文件，新修改行使用本轮真实执行 coverage。联合 full gate、当前源码独立实施门、远端 exact-SHA CI 与本机部署仍待完成；没有把任一历史失败或静态评审登记为生产验收。

## 2026-10-02 SQL 原 JSONB 类型补正

SOURCE v2 独立复核保留 FAIL 一项 P2：实际 jsonDocument.fromDriver 可将数据库 scalar string `{}` 解码成 JS object，原 reader 再次 parse 后仅查 typeof 不能证明 SQL 原类型。私有 probe v1 导入路径错误不能算功能红，v2 在真实 PG 确认原 jsonb_typeof='string'→reader present；随后公开创建的完整合法 render 编码成 SQL string 也真实获得错误 unselected 许可。v10 限定设计独立 PASS 后，同测试新增两条反例，旧 source 得到 5 pass / 2 fail，拒绝许可反例均真实复现。

只改同一 reader 的同 SELECT，保留 render/native 原 jsonb_typeof 与 IS NOT NULL。present 仅接受原 SQL object 且驱动值为非 null 非 array object；SQL NULL 要求 flag=false、kind=null、value=null；不二次 parse、不改共享 jsonDocument 或普通 Task mapper。`{}`/`[]`/`null`/`false`/对象样式字符串和精确原 render 字符串全部拒绝，复原真正 SQL object 后合法历史维护继续。最终 24 pass / 0 fail / 253 assertions（6 文件），lint、arch、typecheck 通过，源当前新增行 coverage 单独核对；联合完整门禁、SOURCE v3、远端CI和部署仍待完成。

正式 Mac 已可读；既有业务任务页面重新核对项目名称、算力名称、四类 Token、人民币估值、任务整体/单 Agent、真实泳道与紧凑返回控制。CS 系统已部署 c6860345 的验收范围总量 24423=5917+17728+0+778，¥0.026922；双 Agent 两轮28.0/29.4秒，累计/活跃并集57.4秒、任务起止1.6分钟。项目费用未开放仍显示说明而非零。截图为 native 实屏，只作视觉核对，不冒称 DOM 数值几何；本批维护兼容修订仍未部署，不开启生产开发采集。


## 2026-10-02 原父结束与实际重建联动候选

本批为在制源码，生产开发 producer OFF；task-runtime/0020 仅在原验收 PostgreSQL 的独立测试数据库执行，尚未应用到本机平台。当前正式平台为 `e40330cde9e337a4f1d0617a98bfb2ebd2357384`，[精确 CI36975154942](https://github.com/wangbinquan/CrewStation/actions/runs/36975154942) 六项成功，2026-10-02T06:59:37.926Z 八服务 Ready；本批 SOURCE、一次联合完整门禁、精确提交/CI和新部署分别等待，不复用旧完整门禁为新源码背书。

实际 API 受理冻结所有原 accepted 子执行（包含已 finished 的受保护执行），父任务保留原 state、connected、hash、Pod UID、PVC UID、nullable 原 render/start；新受理和在途配置/绑定提交在原 Project 事务重查封存身份。固定成员使用有界游标，单页等待不占住后续成员；恢复扫描在两类持久游标间轮换，共用总预算 25，耗尽作业以原键重新投递，不以队列等待伪造退出或消耗模型重试。

原父结束由真实队列驱动，独立 Controller 的原 Start ACK、全部 normal/init/ephemeral 容器 Stop ACK、原 Pod 与 owned Secret 的实际 UID 消失均先于完成；Task/固定成员/资源投影/事件 SQL 在真实作业最终提交 fence 后一起生效。释放、保留期和失败补偿使用同一来源；ReleasePending 完成后明确清除，Resources 的实际停止观察再释放配额，不用 Task 逻辑终态代替资源终态。

原父重建 queued 意图保持私有，实际 REBUILD worker 在 ledger/旧环境早返回之前核证原完成来源与恢复 claim。完成后才发布新 Task/render/hash/Pod 名称；新 Secret/Pod UID 和预览各 SQL 段重读原绑定，所有物理/凭据/heartbeat I/O 在 Project 事务之外。迟到准备不能把 ready 降回 starting；Runner 就绪严格核原 source/claim，显式坏绑定不降级为旧逻辑。新容器失败必须有自己新 epoch 的独立 Stop/UID 消失证明，旧父 proof 不能复用；完成补偿后另一个真实 REBUILD 作业才发布保卷恢复。

原 PostgreSQL 与真实 API/挂载 worker/Controller 的定向证据：原封存/最终租约/维护/存储 23 pass、285 断言；父独立物理结束 3 pass、33 断言；直接执行与 ledger 重建 2 pass、58 断言；恢复双族公平扫描 2 pass、57 断言；新 epoch 补偿与完成占位 2 pass、58 断言；迟到外部准备与非法就绪绑定 2 pass、23 断言。假 Kubernetes 仅模拟 API、调度、finalizer 和 ACK 丢失，独立 Controller 的 Start/Stop 凭据在真实 PG 写入；数字 child participant 是明确标记的受控回归，不能当成生产模型采集。早期超时、错误参数绑定、缺假调度节点与错误夹具断言日志保持，未削弱产品断言。整批当前内容的组合定向门禁与 SOURCE 复核尚待。

全 writer、未绑定容器与 unknown-tail 的剩余链路、开发 producer 真正启用及实际开发模型验收仍未完成；CS-R02/R03/R04/R13 与两个 RFC 不关闭。


### 2026-10-02 SOURCE v10 失败与四项修订设计

83 个实际源码/文档路径的当前候选合并定向验证为34 pass / 0 fail / 516断言、10文件，原55334 PostgreSQL容器与83指纹稳定；新的backend类型与架构检查通过。这些结果没有覆盖随后独立源码复核发现的边界。SOURCE v10为FAIL，回执 `observability-cs-parent-current-source-review-v10.json` SHA256 `988a470dae108719f09d8d4a1284cc263108208f80edf089ca01ecb09eb75b2c` 保留，不以窄测试绿代替实施门。

四项P2是：无render的owner重建丢失原SQL记录后Runner可误写running，以及初始化成功最后事务未重核原绑定；自然Stop proof先到会跳过原Pod DELETE而永久等待；owner新epoch的Resources投影失败被旧保存点兼容吞掉；已发布活跃selected rebuild的真实作业dead后缺持久补投来源。新增真实PG缺记录反例原0 pass / 2 fail保留，其中native实际返回true，ledger已严格抛错，不能混称两模式均错误放行。

限定v11修订设计覆盖所有最终就绪写点、独立Stop与DELETE推进、同Executor严格原来源投影以及总预算25的三家族持久恢复；复用已批准v6/v7，不为owner补造render，不改已发布0019迁移。设计独立门与实现/完整联合检查/精确上库CI/本机部署仍待完成，生产开发producer OFF，全writer、未绑定来源、unknown-tail和真实开发模型验收继续未完成。

### 2026-10-02 四项修订实现与真实回归接续

v11 限定 DESIGN 已 PASS，回执 `/private/tmp/observability-cs-parent-source-corrections-design-review-v11.json`，SHA256 `fdb510982a912b97ad688805a1f1016edfda66d5e048e7f842e56e205333924d`。原 v10 SOURCE FAIL／四项 P2 完整保留；本实现新增最终 Runner/初始化原 SQL 来源核对，自然停止后的原 UID 删除接续，同 Executor selected owner/ledger 严格投影，以及不改既有迁移的 v2 三家族持久恢复游标。completed claim 与 pending ending 先在同事务暂存发布来源，再受理额度／投影；任何失败使全部相关 Task/ending/claim/record/Resources 写回滚，不产生独立提前发布。

首轮 targeted-v11 的 16 pass／0 fail、298 断言，随后 targeted-v13 的 6 pass／0 fail、142 断言分别指纹稳定且原55334容器身份保持。新增真实 Runner 初始化反例、自然 Succeeded Controller proof 后继续 DELETE、selected Resources declare 失败回滚，以及两个原完成来源的实际 REBUILD job 五次最终租约失败至 dead 后、工厂重建与原 request 补投。合成81条扫描候选只算存储公平回归，不算物理／模型证据。targeted-v12 的4 pass／2 fail和旧架构／类型失败保留：旧故障注入被正常 heartbeat续约，已改到真实同 Executor flush 后最终时钟核验，未削弱断言。纯 domain 不再反向导入 ports，后端类型与架构现已通过。

这些是四项修订的针对性证据，全部新版候选合并回归、独立 SOURCE、与已交接 owner 候选的单次联合完整门禁仍继续；不复用e403旧完整门禁。尚未发布本源码波次／部署新迁移；producer继续OFF，完整 writer、unbound、unknown-tail、后续观测验收和两RFC整体仍未完成。


## 2026-10-02 旧失败工作区恢复受理的兼容回归

v15 的 89 路径完整独立 SOURCE 为 FAIL，原四项 P2 已针对原反例闭合，但发现新的旧未选中 failed 恢复回归：正式 Resources 投影在 quota.acquire(next) 时按新 rebuildId 读取原记录，该记录尚未 insert。回执 `observability-cs-parent-corrected-source-review-v15.json` SHA256 `35d9641db5bdbb8cc284cef90052010d288ca7d2e656cd4e0fa9a4b164de5483` 保留。现有四个重建套件在原 PostgreSQL 实例复现为 15 pass / 4 fail / 119 断言；4 个 ledgerRebuild 受理均被同一 missing-record 检查拒绝，源码与实例身份稳定。

v16 最小修复 DESIGN 独立 PASS，回执 `observability-cs-legacy-rebuild-admission-design-review-v16.json` SHA256 `e969858acaa817019142adb714ecd166a8a58d36370e4524c70c181289c519ad`。当前候选将同一原 Project 锁/UOW Executor 事务的 rebuilds.insert 放在 failed 配额重新受理前；仍由原事务回滚 record、Task、Resources 与作业，不放松 selected 的 missing-record、坏 binding 或来源核验。测试 fixture 另加 ownerWithLedger 选择，默认与原 ledger 选择不变；新回归覆盖 owner 创建实际接 Resources ledger、ledger 创建的成功受理、零额度拒绝、同 requestId 恢复及幂等。

这些回归已写入但本候选尚待执行，修正后完整 SOURCE、单次联合整仓门禁、精确上库 CI、本机部署仍继续。producer OFF，全 writer、unbound、unknown-tail 与真实开发模型验收未完成；不能把本设计门或旧 45 项窄回归写成完整 RFC 完工。


### 最终联合定向回归（v18）

当前 91 文件候选的原父结束、实际恢复接续、原四项 SOURCE 修订及旧 failed 两创建模式受理/回滚已合并通过：68 pass / 0 fail / 957 断言，19 文件，102.12 秒；91 个内容指纹与原55334 PostgreSQL 容器身份稳定。两模式验证真实 Resources occupancy=0 后的零额度拒绝、record/Task/hash/Resources/Jobs 回滚、原 Pod/PVC 不变及同 requestId 后续成功/重放只占一次。

首次新增回归有两处测试预期错误：持久 creation 默认值是 owner，队列列名是 state；v17 的 19 pass / 4 fail / 179 断言回执完整保留，随后按实际 schema 校正，未放松生产检查、额度或回滚断言。原 v15 的实际缺记录红测与独立 FAIL 也保留。正式 changed-line 保护判定当前为 1,314 / 1,393（94.3287867911%），violations 为空；限定 lint、backend 类型及架构检查通过。

最终完整 SOURCE、已交接 owner 的联合单次 check、精确远端 CI 与本机部署尚待完成。这些数字是实际模块/PG/Jobs/Resources/Controller 加受控 Kubernetes 与数字参与者的回归，不是实际开发模型或完整 RFC 验收；producer 仍 OFF，完整 writer/unbound/unknown-tail 继续。


### 2026-10-02 原父结束整仓回归的兼容修订

最终 v19 的完整 91 路径 SOURCE 独立 PASS（a703670027ce88ca0e9fbdad949ab08840b59fd63f3cce3a8b6094dccc872248）保留；第一次 root91 + 已交接 owner108 的 joint199 整仓 `check` 实际为 5,178 pass / 143 skip / 5 fail / 35,587 断言，候选和原 PostgreSQL ID 稳定。五个现有回归分别是普通 UID 替换错误分类、删除中的原 Pod 提前返回、异步父维护错误绕过 waiting catch、native 非所属 checkout Secret、父保卷重建后旧 CLI 回连。该完整失败不改写为通过。

v21 最小修订 DESIGN 独立 PASS（f99e2300e3020e9f630757a33e824276e4831d7486762acc36cf5586eed19e98）：保持原 UID/RV/query 和独立 Stop 校验，删除中的对象仍提交条件 DELETE；只 await 原父检查和精确过滤 native Secret 名。只有父 UID 实际换代后的已绑定 running 旧 CLI，经过原 Project 锁、原令牌和原 child/parent SQL maintenance 核验，才可诊断早返回，只写 connected/lastActivityAt/updatedAt。首握手、Agent、坏原始 JSON/显式选择、未绑定、expected witness 和所有默认物理 writer 保持严格检查；原 rejection、hash、render、UID、额度及 rebuild readiness 不改变。

25 个成功套件（含原五个失败套件）已通过 106 项；新旧 CLI 套件初次 16 项因测试夹具误从公开 EnvironmentDto 取 namespace 而提前失败，该红测保留。改为原父持久 namespace 后只重跑这一套，16 pass / 0 fail / 59 断言；全部生产源码与其他成功套件逐字不变，合成证据覆盖 26 文件的 122 个成功用例、共 1,370 断言，不能写成一次原始 122/0 运行。新增删除中原对象覆盖 retained finalizer、ACK 丢失、UID/RV 竞争及 protected waiting；CLI 覆盖诊断保留、原父未变的旧握手、首启动/Agent/未绑定、实际 PG 坏 render/selection 与默认 witness 拒绝。限定 lint、backend 类型和结构通过。

93 路径最终 SOURCE、root93+owner108 的新单次 joint201 全量门、精确远端 CI 与本机部署继续。producer OFF，完整 writer/inflight、unbound、unknown-tail 及真实开发/CLI/平台用途和后续观测验收仍未闭合；CS-R02 与两 RFC 保持 In Progress。

### 2026-10-02 joint201 完整候选门禁通过

v24 的 93 路径完整 SOURCE 独立 PASS（e8197b8451542d3b696819ab06b66e02f1bc396fb1c1948f01e3b01c63fcc3d5）。随后 root93 + 已协调交接 owner108 的 joint201，在原 PostgreSQL 验收容器、prepared transactions=10 下完成一次完整 `bun run check`：5,207 pass / 143 skip / 0 fail / 35,690 断言，5,350 用例、1,016 文件；总门禁 1,181.17 秒，测试 1,126.62 秒。201 路径首尾逐字稳定，原数据库 ID 未变；原 v19 完整失败与 v22 的失败夹具记录仍保留。

发布前 `git diff --cached --check` 只发现本人两个文件的三个空白问题：parentRebuildPublication.ts 的多余 EOF 空行，以及 developmentParentRebuildWorker.test.ts 两条调用语句后的空格。只修正这三处外部空白，并补入本记录；没有改语句、字面量、断言、测试输入或运行门槛。复核这些限定差异后复用已完成的功能门禁，不重新启动整仓测试。此前暂存区 201 路径是本次失败发布流程精确建立的快照，未收编其他暂存内容；再次发布前会校验完整路径、候选字节与独立审查。

这里只记录本机候选验证结果。精确远端 CI、基于已提交树的本机镜像构建与部署仍待完成；CS-R02 的完整 writer/inflight、unbound、unknown-tail、真实开发/CLI/平台用途及后续观测验收继续，producer OFF，两 RFC 保持 In Progress。
