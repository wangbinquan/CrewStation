# RFC-034 开发 Agent 的实际工作卷准入与持久创建接续

状态：设计v2独立PASS，v3发现绑定恢复P2，v4补充精确等待与继续绑定；首轮及v3失败回执保留；承接 [保护渲染](./development-protection.md) 与 [完整清理规划](./development-cleanup.md)。基线 d3acac1f 已推送、六项 CI 全绿并实际本机部署。这个候选把实际消费者注册和原 Pod 许可链接通；不装配生产数字 producer，不宣称数字排空、全入口清理、零证明或两级事实完成。已批准的 RFC 总范围继续 In Progress。

## 当前源码缺口与组合边界

resources/safety/guards.ts:19 的 assertConsumerOwner 只接受 business-workspace 和带 taskStorage 的原工作卷，开发 Agent 即使纯对象合法仍不能登记。原 direct writer 先拒绝显式新选择；其旧 prepare 在整个项目事务里调用集群和材料。direct 投影没有完整 pod/consumer 规格，现有持久 controller 无法接续授予许可。ledger writer 已有 register → Secret/Pod → bind → inspect → PG grant → UID Secret；这些既有端口保持。

L4 task-runtime application 编排，L5 adapters 读写本模块 PG、K8s 或经已有端口调用 resources。resources 在自身原 parent/storageTask 锁下核本模块台账，不查询 task-runtime schema、不 import 私有代码。L6 task-runtime wiring 使用已经注入的 resources WorkloadSafety 注册方法；不改并行 platform/wiring 或业务删除实现。节点探测和许可激活仍在 cluster-control；不能用进程内临时状态或在 task-runtime 假发 grant。

## 明确新选择和受理事务

CreateNativeExecutionInput 新增内部 developmentUsageProtection:{version:1}，仅独立开发 Agent + strict 数字布局 v1；拒绝 CLI/subtask/terminal、业务会话、缺原 Agent/套餐/算力修订、非法或额外 flag。无该字段的旧记录/调用保持原路，不自动升级。新选择必须同时装配事务内资源台账与真实 register 端口；缺能力在读取集群、材料、占额和写入前拒绝。没有 HTTP、设置页或生产调用者接入。

新选择用真实原 parent、资源套餐、实际 workspace Pod/PVC/节点和原 computeProfile revision 构造不可变环境。外部 profiles/K8s inspect 与上层限额预读在项目事务外；进入项目锁后重读原 parent 的执行身份（id/project/service/kind/state/connected/pod/pvc/renderStart/rebuild/token），核对仍相同并未阻断，固定 consumerId/start=1 和输入选择摘要，再同事务占额、插入、完整投影与必要的持久准备作业。保存的选择摘要覆盖 id/parent/purpose/user/Agent/runner/fingerprint/profile/image/compute/runtimeImage/数字布局/保护/业务或 terminal 字段；同 id 重放仅原摘要一致返回原记录，不能随当前设置重选或重复扣额。所有 selected 环境的台账投影失败向上抛出，同事务回滚，不能像迁移时期旧开发记录一样吞错。现有 resources.owner.admit 仍在原资源项目锁内读取官方 limits.limitFor，明确作为保留原子占额语义的限定例外：实际 L6 注入的是 project.api.quotaLimit，它只读取本机 PostgreSQL 原项目配额，不是集群/网络材料调用；不宣称上层预读被 acquire 使用，也不更改当前限额或冻结新 quota 合同。新 direct prepare/最终绑定阶段没有这类限额调用。该例外需在实际回归中核明，不能泛称全部 I/O 都已移出事务。

新 selected direct 的 render.execution 保存原 workspacePod 和明确 creator=native；reconcilerCreates 只对这一组合返回 false。它仍投影完整 pod/consumer/expectedVolumeUid/workspace/节点/意图及三个子对象，Provisioning=false，因而 controller 不建它的 Pod，却可运行既有 reconcileWorkloadAdmission。ledger 新选择仍 Provisioning=true，由原 controller 创建。旧 direct 无新选择的 spec、children、队列和行为不变。

## resources 原开发归属验证

新增独立开发分支，只有 parent.kind=dev-workspace、record.kind=agent-execution、purpose=development-agent、consumer.purpose=agent/finalization=null、两者同非空项目、相同 task-runtime owner、parent/child/ref/namespace/Pod 三子对象属于原记录时才可接受。原 record.spec 的 strict flag/layout、workloadConsumerId、原 consumer tuple、expectedVolumeUid、pvc、workspace 原 Pod/PVC UID、原节点及 workspace-task/opaque intent 必须一致；不把任意 dev-workspace 或 CLI 变成受保护消费者。

在首次 register、已登记同 consumer 的 register 重放和每次 grantStart 都核 parent desired=present、未失败/暂停/释放，以及 child desired/条件；原 parent 已观测 Pod 必须同 namespace/name/UID 且 Running，原 volume 的 ownerRef=原parent/work、parent/project、期望及实际 PVC namespace/name/UID/Bound 必须匹配。同名替代、跨项目、错误修订、缺选择、业务/archive 夹带、已释放都拒绝；缺首次观测则返回明确 development_workload_pending，不能虚构 UID 或当成实际变化。原 business/archive 分支不改变。

## direct 实际 prepare 与持久接续

kubernetesNativeExecutions 可选注入 register，选用新路径时先纯解析完整保护和消费者，再提交原消费者注册；端口缺失、身份漂移、已关闭时不读写 K8s、不请求材料。登记确认后才创建或重读不可变原 Runner Secret，再创建或重读受 init/finalizer 保护的 Pod。创建时合并已有保护注解，不能用 cli-intent 覆盖它们。对读取 Pod 使用共享严格保护校验（允许真实 fieldRef.apiVersion=v1）核 init 顺序、原 consumer/PVC、私有卷、资源/镜像/节点/Secret/UID，不套用旧禁止 init 的规则。

新 direct prepare 的 K8s/服务/材料/register 和租约心跳不持有项目事务；最终只在短事务中核原 child 全快照、parent 不可变见证、仍 queued/creating 和与提交同事务锁住的作业 fence，保存实际同 Pod/Runner Secret UID、原 token hash 与 preparedAt。竞争释放、父重建、租约接管不能被旧结果覆盖。register 的初次观测等待仅 ACK 当前准备作业；queued 意图保留，由既有 pendingExecutions/reconcile 持久补投，不增加无限现场重试、不改旧作业规则。真实网络/写入失败仍按原持久 worker 接续，Secret/Pod 响应丢失保留原 token、UID、consumer 和配额。resources.repository 的 prior 短路对新开发原选择必须先再次核原归属及准入 fence；旧 business/archive 原幂等回执保留。

最终绑定及 selected worker 错误收尾使用同一作业身份：worker 从实际 ClaimedJob 传 jobId/fencingToken，L4 仅依赖 RepositoryScope.nativeLease.requireCurrent；L5 通过 @crewstation/queue 的新增公开 lockJobLease 原语在本次 Executor 事务锁住 platform_infra.jobs 原行，再第二次 SQL 以 clock_timestamp() 核仍 running、原 fencingToken、未过期及 kind/payload 精确属于本 task，直到提交/回滚持有此锁。必须先获项目行锁，再获 job 行锁，再核/写原 child；claimJobs 以 SKIP LOCKED 跳过锁住的作业。锁等待后及最终返回前都核当前租约，不能复用外部 heartbeat=true。heartbeat/材料/K8s 仍在外部；不直接跨 schema 查队列表，不伪造 job token，不改变普通 worker/旧 direct 的语义。真实 PG 反例包括等项目锁被接管、等 job 行锁期间 lease 过期、旧 fence 的失败收尾及新 worker 重读原 Secret/Pod 恢复。

新开发 grant 还必须晚于实际子 Pod 的持久绑定：selected 的完整投影在 native.podUid/bindWorkload 已落库后写 pod.expectedPodUid，resources.grantStart 将真实输入 permit 交开发归属 guard；当前原 record.spec 中该 UID 缺席时明确 pending（register 可先完成），与输入 podUid 不同则拒绝。这样 direct 在 K8s create 到短事务 CAS 间隙仍不能先获许可，已绑定同名替代 Pod 也不能借尚无 startPermit 的消费者获准。该字段是本 owner 已绑定物理实例的规格，不从 feed/current Pod 猜测，不新增跨模块查询/schema。旧 business/archive 不附加这一约束。真实 PG/公开 controller 用例同时覆盖绑定前 pending、绑定后原 UID、同名替代、原 PG grant 丢失响应后的恢复。

许可持久恢复继续用原 controller：即使 Provisioning=false 或 owner 已 bound，也从原 PG consumer 读取，按实际 Pod/PVC/新鲜 Ready Node/Lease 证据 grantStart，提交后才产生仅原 Pod UID 可用的不可变 admission Secret。新增开发实际启动检查在每次 inspect 前从 K8s 重读原父 Pod（相同 UID/节点/Running/原 task 标签及 work PVC）与 Bound 原 PVC。父/卷替换或销毁不能激活新许可；无调度/新鲜证据则等待。PG grant 后响应丢失和激活 Secret 响应丢失由新 controller 进程/实例从原记录重放，不生成第二个消费者或新许可。

## 清理与生产边界

本候选没有数字复制/结束证明，生产 producer 保持 OFF；任何新 selected direct cleanup 在第一读写前明确等待完整数字清理屏障。native 的普通清理意图仍持久，但新选择先保留原连接凭据、Pod/Runner Secret/consumer 声明与占额，ReleasePending=true、desired=present，直到后续同一 owner 完成原数字复制/闭准入/实际停止。不能把未实现清理当成成功或提前失效用于排空的连接。父环境、retention/rebuild/project/cluster/orphan 的完整屏障仍按 development-cleanup 下一候选接通；没有新 production caller，所以这些未闭环入口不获得新运行许可。旧 unselected 释放逻辑照旧。

## 精确候选与验证

源码/测试精确30路径（其中新增6项），先冻结原字节、参考源码及新路径不存在，再独立设计门；不收编任何并行项目删除、events、迁移锁或平台装配 WIP：

- modules/resources/adapters/persistence/safety/guards.ts、repository.ts、development.ts（新）；modules/resources/tests/developmentWorkloadSafety.test.ts（新）。
- modules/task-runtime/api/moduleApi.ts；domain/taskEnvironment.ts、domain/development/protection.ts、domain/ledgerProjection.ts；ports/workloadSafety.ts。
- modules/task-runtime/application/nativeExecution.ts、application/development/workloadAdmission.ts（新）。
- modules/task-runtime/adapters/k8s/nativeExecutions.ts、developmentExecutions.ts（新）；adapters/persistence/ledgerProjection.ts、drizzleUnitOfWork.ts；ports/unitOfWork.ts；workers/nativeExecutionWorker.ts；wiring.ts。
- packages/queue/jobs.ts、index.ts、queue.test.ts：公开事务内原作业行锁/有效租约及对应真实PG覆盖。
- modules/task-runtime/tests/developmentWorkloadFixture.ts（新）、developmentWorkloadAdmission.test.ts（新）、developmentUsageProtection.test.ts。
- modules/cluster-control/adapters/k8s/safety/workloadGate.ts、workloadGate.test.ts；application/workloadAdmission.ts、workloadAdmission.test.ts；adapters/k8s/pinnedVolume.ts、pinnedVolume.test.ts。

真实隔离 PG 正向 ledger/direct 受理和 resources 注册/授予，用公开 resources/task-runtime/controller 模块；controller 调和实际 K8s 许可 Secret，不能在集成验收里手工调用 grant。精确故障覆盖先稳定 RED 后修：开发注册旧拒绝、direct 未装配、丢失保护注解/旧禁止 init、选择漂移重复扣额、投影失败吞错、项目锁外 I/O（让一个实际并行项目事务能完成）、缺观测等待/补作业、两对象响应丢失、租约/释放/父替换 CAS、PG grant/Secret 激活响应丢失后新 controller 恢复、真实 API 默认字段、缺 Node/过期 Lease/替代原父或 PVC、尚未接通清理保持原 token/记录/额度。旧业务/archive、CLI/未选 Agent/ledger 执行和无保护直接布局回归保持，函数80/文件600/目录20限制不改变，无新 schema/migration/contract JSON。

独立实现门后只对稳定源码候选执行一次完整本地 check，不因并行 SHA 变化重复；实际失败及比例闭环保持，最终以候选自身六项 hosted CI 为准。已批准的本机部署可复用精确版本备份/迁移/八组件摘要核验；真实身份和模型/CLI 资源验收需具体授权，测试 PG/FakeK8s 不冒充该证据。生产消费、开发事实/两级 UI 和全 RFC 验收继续。

## 2026-10-01 首轮独立设计门修订

首轮39/39指纹一致、6新路径不存在，但发现4项P2，原FAIL回执保留：重复注册 prior 绕过归属、最终提交缺事务内 job fence、acquire 内官方限额读取与 I/O 声明不符、当前部署入口旧版本。v2扩入7条现有源码/测试，明确每次注册复核、同事务 jobId/token/kind/payload 与真实时钟行锁，以及原资源项目锁内仅官方 PostgreSQL 配额读的限定例外；顶部同步已核 d3acac1f 实际部署，历史348批次不删除。新设计未通过前仍不改源码。

2026-10-01 v2设计门48/48指纹一致、6新路径不存在、PASS。v3只补同27路径内的真实子Pod持久绑定后许可约束。期间并行platform/wiring增加算力测试项目删除检查，所用resources WorkloadSafety/ledger和quota注入未变；原源/其余参考保持，更新该参考指纹，未编辑其输出。

## 2026-10-01 v3绑定恢复P2修订

v3独立门48/48指纹一致，但发现1项P2：ledger创建Pod成功、owner绑定提交前失败时，下一轮applyWorkload先跑grant；缺持久expectedPodUid不能阻断其后重读和绑定。v4在resources开发grant专用缺绑定分支返回development_workload_binding_pending，cluster-control/application/workloadAdmission仅识别这个代码，跳过本轮许可激活并安排原持久重试，允许Provisioning=true继续原ensure/read和owner.bindWorkload；Provisioning=false保持等待。其他归属、关闭、网络和身份错误继续抛出，首次观测等待仍为另一代码development_workload_pending。新增这1条现有源码，合计28条；不修改workloadApply的既有顺序、不扩大错误吞并。真实隔离PG和公开controller新增创建成功、绑定失败、新controller重读同Pod并落原UID后才授予许可的回归；缺绑定轮不得产生admission Secret，恢复后只原UID、原consumer和原占额。

## 2026-10-01 实际 ledger 写入发现的原卷 owner 修订

公开模块真实 PG 组合已证明 native 路径的注册、短事务绑定和原 UID 许可。ledger 路径仍实际失败，原失败回执保留：cluster-control/pinnedVolume.ts 沿用普通任务 owner=pod.taskId，会把归原父工作区的开发工作卷错误归给子 Agent，报 workspace_volume_changed。v5只在显式 developmentUsageProtection 新选择里使用原 consumer.taskId 核 PVC owner；原 businessStorage/archive owner 和无保护的任务路径保持原判据。缺 consumer 不能获得 owner，原 UID/Bound/删除检查不放宽。候选扩入 pinnedVolume.ts 和 pinnedVolume.test.ts，共30条源码；新测试先复现同原父卷被拒绝，再验证原 owner、子任务冒领、同名替换与缺消费者。此修订未通过独立门前不改这两条源码。完整 Task/Resources/Controller、原 Pod绑定及丢响应恢复仍需回归通过，不以已有 native 正向替代 ledger 验收。

## 2026-10-01 实现候选与相关回归

v5限定设计门51/51指纹一致、PASS；原卷owner修正及全部准入候选已实现，但尚未发布或替换本机d3部署。实际公开Task/Resources/Controller和PostgreSQL相关64项/484断言通过（10文件，targeted-v3），包括双创建路径、缺观测持久补投、绑定失败后新controller恢复、PG许可/激活响应丢失、实际项目锁外I/O、实际作业租约接管、释放/父断连竞争、投影失败事务回滚、Secret/Pod原对象恢复以及原父/卷/子UID、缺节点/过期Lease拒绝许可。旧业务/CLI/无保护路径保持回归。

首轮项目锁反例测试因夹具重复关闭失败，已修为幂等关闭；类型检查发现事务端口和泛型读包装器问题，已按真实类型修复。所有原失败日志保留，不能写成首轮全绿。架构检查与精确lint已通过；最后类型复查、整个候选独立实现审查、唯一完整门禁、精确发布CI及部署回执待完成。生产开发producer仍OFF，完整清理/消费/两级事实UI继续，不关闭CS-R02。

整体准入候选v1独立实现门51项及5项证据首尾稳定、PASS，无可复现P1/P2；原回执明确完整清理/消费/UI不在本批关闭范围。根据其证据备注又补了公开controller清理组合：实际原许可/Secret已创建、原Runner已连接、主容器Running后释放；native worker和新controller均保留同Pod/Runner Secret/admission Secret、原token/连接与占额，准入关闭但没有删除（1项/14断言通过）。仅测试补充，生产实现未变；v2候选补审后再启动唯一完整门禁。

## 2026-10-01 唯一完整门禁与共享在制边界

完整五组件于2026-09-30T22:56:40.256882Z结束，1033.04秒：架构/lint/后端类型/控制台类型均0，测试4659pass/143skip/18fail、30488断言、933文件；aggregate=1原日志保留。30自有源码首尾一致，10相关文件的64项在同一全量中全部通过、无失败/跳过。18失败来自并行events来源改造及其结构/平台迁移/升级回归，未修改或收编该在制工作。

参考兼容独立门PASS：仅并行platform/wiring新增身份来源和events入口，不替换本批台账/WorkloadSafety/native worker/controller接线，生产OFF保持；当前已提交HEAD的17参考字节与原实现审阅完全一致。依开发规则§3，完成自有精确lint（0）和后续装配比例类型核验；后者7项错误均为并行ProjectServiceActor未导出或其测试类型，原失败也保留。没有重复完整门禁、清掉外部WIP或用替代checkout验证。最终只提交自有源码/文档，并由该精确提交的六项hosted CI裁定；CI/本机部署未完成前不写成功。
