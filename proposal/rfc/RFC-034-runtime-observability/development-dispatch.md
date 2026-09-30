# RFC-034 开发原键派发与排空屏障实施设计

状态：限定设计门 v2 PASS；原键派发 participant 在制，持久结束队列和删除许可未接，生产仍 OFF。承接已批准headless/owner/native-source和内部consumer；不引入新的运行用途，不恢复CSV、更多筛选或自动停止预算。私有消费者本地提交965b45e8710ccb1ec55b36b9429ba60a65541414尚待共享迁移锁引用齐备后的协调推送，当前本机源码仍1d48fb170。

## 已核实的接线断点

- AgentExecutionLifecycle.admit直接createNativeExecution，send直接签发MCP材料并发送普通startAgent；developmentUsageOwner.prepare/bind尚未被调用。AgentStart.finalized后后台不再tick。
- Session已有register/get/requestDrain/unavailable、数字轮询与复制后ACK。prepareDevelopmentCommand要求绑定登记先于数字start/stop，不能直接绕过去发送。StoredDevelopmentUsage.closure证明数字副本出口，未证明原模型进程退出；StopReceipt.finished/prevented才有独立停止判据。
- scheduleExecutionCleanup立即把子环境设为releasing/cleaning、换Runner令牌并断开；runnerLifecycle拒绝releasing或cleaning重连；releaseOf同步把删除期望投给资源中心。因此只在cleanupNativeExecution内加等待已经太晚。
- deferWorkspaceRelease先设父releasing，随后把全部子环境转cleaning。resources.expireRetention可独立把失败父记录设absent，task-runtime.followRetention再跟随为released；该旁路不会经过Agent派发。
- pendingExecutions/reconcile当前只补queued/cleaning与已有release环境，新增等待阶段必须同时可被持久队列恢复。正常结束、取消、父释放、三种重建和项目永久删除必须遵循同一许可。

源码锚点：modules/dev-session/application/agentExecution.ts、adapters/persistence/developmentUsage.ts；modules/session/application/developmentCommandReceipt.ts、developmentUsageIngestion.ts；modules/task-runtime/application/nativeExecution.ts、runnerLifecycle.ts、ledgerResync.ts、reconcile.ts，domain/ledgerProjection.ts；modules/resources/application/maintenance.ts；packages/contracts/taskrunner/developmentUsageStorage.ts。

## 首次受理与派发

1. 新执行先固定AgentStart中的项目/父工作区/Agent/实际执行UUID、generation=1、原算力修订与非敏感launchMetadata。intent只来自原请求和固定修订；价格prepare先于新环境创建。MCP仅冻结名称/URL，临时令牌和解密Hook材料不进入摘要。旧记录/旧render不被后台自动提升。
2. nativeUsageLineageKey由平台原项目/父工作区上下文明确选择，不把它当实际库证明；consumer仍通过原Pod、实际文件三项和两阶段根限制归属。选择developmentUsageStorage/nativeSource后必须保存在原意图/渲染快照，不能在重连时由当前hello修改。通过现有Session.connectionStatus（session-client已有同形状状态）明确判定原Runner能力缺失时，旧Runner走原流程并明确unsupported，不产生已知零。已宣告数字能力但info超时/损坏、断线或未知，不得自动降级后启动普通模型；保持原意图与待恢复状态。
3. 派发前先读owner原记录；已close的记录不得再发start。未绑定时读取新子Runner严格info，以task-runtime持久原子Pod UID核验；CAS保存原key，再成功register到Session，最后发送含原admission的startAgent。登记失败重试原绑定，禁止先发start。
4. 已绑定必须优先查询带原key的info及Session原registration。key/Pod/日志不符或unknown只保留待恢复，不建立新绑定、不读当前profile、不补起模型。原键匹配的registered/running receipt只恢复AgentStart派发状态，避免重新运行Hook/模型。原键匹配的持久finished receipt必须按其completed/error/cancelled结果幂等驱动AgentStart逻辑结束与持久结束作业，即使普通终态事件或Start ACK已丢失、同Pod Runner已重启也要接续；interrupted finished同样能证明逻辑结果，不能独自证明实际进程退出。已ended/finalized的旧普通状态也不得抑制该结束作业。receipt没有可证明的实际结束时刻时，另记恢复observedAt并保留actualEndedAt未知，不能把当前重放时间当实际运行耗时。phase=unknown或采集故障本身不触发模型自动停止。仅同一健康原日志明确没有受理且owner准入未关闭时，才取得本次临时材料并发送同一意图。
5. 价格失败、环境失败与取消并发均不得越过稳定受理；AgentStart普通整行写回不能清空意图、绑定或排空进度。采集/估值错误只重试，不触发模型停止。

## 独立持久等待阶段

使用独立、可恢复的结束请求/排空进度，保持原intent/nonce/price不变。每项包括实际executionTaskId、原key/Pod、单调清理version、首次reason、原停止证据与数字closure引用；不保存额外Token或完整启动材料。对父工作区另保存关闭新准入与原子执行集合的版本。具体存储落在owning module，跨模块仅独立port/API，不联查私表。

普通终态事件、原键持久finished回执或明确生命周期结束请求均以同一幂等路径初始化持久结束作业；不依赖只在内存重放的普通事件。请求结束先持久关闭owner的start/bind准入，再按原admission调用stopDevelopmentAgent，并requestDevelopmentUsageDrain。未绑定且从未发送数字start的路径必须凭持久owner/Session决定核实；普通pending、空receipt和stop not_found不能代替从未运行证明。已关闭记录复用首次reason，后续父释放/取消不因改写reason发生冲突；明确强制释放作为另有授权的loss理由保存，不能由重试自动选择。

等待期间保留旧Runner凭据和原数字通道。逻辑结束不立即进入现有cleaning/releasing，也不发布资源absent。停止/排空进度由持久队列与reconcile补队，AgentStart ended/finalized不终止它。重连只能接续原info/stop/数字复制；ready回调不能让结束中的执行重新派发start。父工作区关闭新Agent/CLI/重建准入，但保留已有原来源的读取能力。

## 许可、锁与删除

- 正常许可同时要求严格原registration匹配、原模型停止证据和Session complete/interrupted closure。closure必须使用PG实际M，不使用Runner N冒充：M8/N10且尾部可读先复制9/10；日志确证不可取回则保留(M,N]或未知末尾的中断。临时PG/网络失败不写永久loss。
- 原停止证据只接受匹配原key/Pod的prevented/finished，stopping/unknown继续等待。实际原Pod已消失可用UID一致的集群事实证明进程不再存活，并独立登记不可取回数字；不能由环境状态failed或同名新Pod推定原Pod消失。强制回收必须来自明确的既有force操作且先持久缺口，再按原UID终止，实际退出后才报告停止成功。
- 数字复制/closure是容器回收边界，CNY估值和outbox消费者落后不长期占Pod。清理元数据时仍须保留消费者需要的非敏感原归属、价格、来源与模型证据，直至其保留/确认条件满足；清理启动秘密材料与删除归属元数据是两个不同阶段。
- stop/info/Session恢复在项目事务与资源行锁外执行。事务内重新核execution、原Pod/key、清理version、父关闭状态及子集合，才提交cleanup/释放期望；不能在项目锁内回调获取Agent锁或递归release。准备结果过期则重新准备，不套到替换后的Pod。
- releaseOf、expireRetention、实际cluster-control删除、followRetention和重建回收都消费同一持久许可；不存在许可不能先发布absent。资源保留期先在锁外请求owner准备，再锁内核记录version/原owner/retention到期/许可版本。已有发布过的absent不能靠普通补投影撤回，升级与启用前必须检查并保留明确降级边界。
- 项目永久删除由RFC-037 owner持久关闭项目准入并枚举所有运行资源。headless数字路径须在实际资源回收前执行本屏障；源登记与非敏感消费归属不得先清除。两者生产接线必须一同复核，不把当前未选择数字能力的legacy删除结果冒充新能力验收。

## 逐路径与验收

| 路径/反例 | 必须证据 |
| --- | --- |
| 先价格受理再创建，涨价与空目录 | 原acceptedAt/revision保留，失败不创建/派发 |
| bind成功但Session register失败，start成功ACK丢失 | 原key重试，receipt优先，无二次Hook/模型 |
| Start ACK丢失＋普通终态丢失＋同Pod Runner重启，但持久finished仍可读 | 逻辑结束与作业只建立一次，实际停止仍另核；恢复时刻不冒充实际终态时刻 |
| start在途时cancel，重启后迟到start | 原持久停止先于新启动，not_found不伪造从未运行 |
| 结束排空M8/N10、断线重连、PG短故障 | 原通道保留，实际到10，ready不派发，错误可恢复 |
| journal/Pod替换，实际原Pod丢失 | 不接新空库，原已知数字保留、余量中断 |
| 停止unknown但数字closure已结束 | 仍不能宣告实际进程已停止 |
| Agent ended/finalized与controller重启 | 同一持久作业恢复，无永久悬空或重复结束 |
| 父释放、停止/重启、失败/协议/管理员三种重建 | 子集合闭合后父Pod/PVC才获许可 |
| 失败保留期、resources调和与项目永久删除 | owner屏障无旁路，原UID/version核对 |
| 价格/outbox慢、公开统计权限撤回 | Pod可按数字出口回收，消费元数据仍在；不泄露金额 |
| Agent→项目与资源→项目并发 | 网络在事务外，无反向取锁与重复派发 |
| 旧Agent/Runner/render与unsupported | 原成功行为、Strict JSON/receipt不变，统计保持不支持 |

先完成限定设计复核，按派发participant、持久结束队列、task-runtime/resources删除许可、production wiring与两级事实分小批落地。每批自带纯状态和真实PG/Runner存储回归，保持旧数字/费用/配额断言；只在全部旁路与同快照事实/UI齐备后开启headless生产能力。CLI、平台算力测试和两RFC其他剩余项继续独立推进。真实身份切换/模型验证资源仍待具体授权，不把传输桩或本机部署当实际模型验收。


## 设计门 v1 失败与 v2 修正记录

首轮独立只读设计门FAIL一项P2：原键持久finished存在、普通终态因断线/同Pod Runner重启丢失时，只有恢复dispatched会永久不进入结束排空。v2明确从持久终态幂等创建逻辑结束与持久作业；interrupted finished不提升实际停止证明，原停止/closure仍分别核验，未知采集故障不自动取消模型。新增丢ACK/丢普通终态/同Pod重启组合反例，并保留实际结束时间未知与恢复observedAt的区别。首次失败保留，v2当时须重新冻结复核，未开始实现、启用生产或宣称实机验收；后续回执见下节。

## 设计门 v2 回执与限定派发候选（2026-09-30）

v2独立只读设计门PASS，冻结设计SHA-256为2c6309e0eb8a7abf45d5797428bcf75365a28aaed0bc8cbf5ba724ce66c23b7d，首尾一致。v1的持久终态恢复P2已关闭，没有其他设计阻断；复核未写文件、跑测试或访问集群。设计PASS不等于持久结束队列、删除屏障或生产接线已完成。

限定第一批新增dev-session内部派发participant及独立Session port：原owner未选择保持legacy；仅首次未绑定且明确缺少原数字/停止/实际来源能力时登记unsupported。已宣告但断线/未知/损坏保持原键待恢复。原Pod/journal绑定先持久、Session登记再成功，才可能取得原固定材料；Session持久finished优先恢复逻辑终态，实际结束时间保持null，任何终态都不授予物理停止或资源删除许可。已受理/终态/unknown不重签启动材料；材料返回后再次核owner关闭状态、Session drain和原键info，防止迟到派发。传输ACK既不能代替持久受理，也不能因丢失而换键或降级普通start。

首轮相关检查5pass/9fail：合法StartAgent经协议默认生成空businessSkills数组，被候选误当非空业务材料拒绝；纯测试回执还带了严格合同不接受的runtimeTaskId。修正为空数组兼容与显式原回执字段，非空业务材料、不同原意图/修订/尝试仍拒绝。14项新增检查/140断言通过，owner使用真实PostgreSQL；Session/Runner传输是明确的测试替身，未执行真实Hook/模型或验证资源回收。六文件eslint通过，应用与领域新增可执行行LCOV均全覆盖；限定实现复核、单次完整check和干净精确SHA CI尚待回执。

该participant仅返回accepted/terminal/ending/waiting，尚未更新AgentStart、持久创建结束作业或注入production wiring。下一批必须让持久finished及已ended/finalized的Agent幂等建立同一结束作业，单独保留observedAt与实际终态未知，接通停止/排空及全部删除旁路后才能开启生产。该早期检查点共享锁有11份并行迁移引用待各owner提交；本机代码仍1d48fb170，不提前发布缺依赖的提交或关闭CS-R02/两RFC。

## 限定实现门首轮失败与原 Pod 能力修正（2026-09-30）

首轮限定实现门FAIL一项P2：prepare后的首次hello完整，但info超时；同Pod Runner重新连上时数字日志未打开、能力字段消失，候选会将unsupported固定并返回legacy，从而允许普通模型fallback。新两轮/延迟缺能力并发回归先稳定9pass/2fail，随后修正；不以第一次waiting当作完整恢复证明。

修正用owner-private可选capabilityPodUid和dev-session新增0013迁移，在读取首次info前经PG行锁CAS保存实际子Pod的能力选择。只从owner独立实际环境取Pod UID，后续读不到能力不能退回unsupported；迟到缺能力结果也不能覆盖已持久支持。原Pod不可替换、关闭或已选择legacy不可改写，绑定继续核实际Pod＋该原能力Pod。旧记录列为NULL、返回形状完整省略可选字段，稳定意图/nonce/CNY原价、业务严格合同和legacy成功行为不变。首次缺能力与观察支持的并发以持久选择串行收敛，不制造两个启动路径。

相关三文件最终28pass/0fail/0skip、260断言，实际owner PG均执行：两轮能力消失、迟到缺能力并发、原Pod替换、关闭/legacy拒绝升级、旧字段省略，以及所有旧11项原键/原价回归。领域规则与应用执行行均覆盖。首个完整check曾在arch阶段发现本批domain依赖ports的三项错误，已让纯领域规则持有自己的最小形状/决策类型，port仅引用领域类型；保留该失败，不列为并行阻断。修正后的文件lint、类型、限定复核及本次改变后的单次完整check回执另记，生产和持久结束/删除接线仍未开启。

## 限定派发 v3 功能与完整门禁回执（2026-09-30）

v3限定静态功能门PASS，18路径首尾指纹一致，自有dev-session/0013迁移实际SHA-256与锁值一致7b48d83a7fa771c6ac25b90586c5dd16f3c73f0bb5b9ca8e48d7809f0f245ac4。首轮能力消失P2已关闭，没有新的限定功能阻断；该复核未跑测试，也不涵盖持久结束队列、删除许可或production。12个自有TS文件eslint与单独后端typecheck通过，真实owner PG相关28pass/0fail/0skip、260断言及旧原价/原键断言保留。

自有结构/能力修正后该稳定候选仅启动一次完整check：arch、全仓lint、后端及console类型均成功；测试4480pass/143skip/25fail/1error，28,833断言、894文件、690.61秒。18路径未变；此前domain→ports三项自有架构失败及修正历史保留，不能把这次全量写成全绿。25失败在本批以外13份用例：资源升级新删除触发器缺resources.task_volume_safety、命名空间回收超时及其未处理错误、runtime-environment并发配置/镜像目录，以及角色主页/项目资源/限流/按钮/申请面板/导航/接口面。全部自有派发及既有开发owner相关用例通过；保留这些失败与日志，不修正或删除其他会话源码，也不因其后续提交重复全量。整仓最终结果仍需依赖齐备后的clean精确SHA hosted CI。

门禁期间RFC036三笔自有提交推进共享main到492a63d241c59ef3fc892702a30327285e6ddf14，origin/main仍2d4555323；该HEAD变化没有改本批候选。共享锁尚有五份项目删除迁移与本批dev-session/0013未入提交树；先精确本地提交自有源码/迁移/五份RFC文档，整个共享锁留在工作树。其他owner提交其五份迁移且所有引用齐备后才能在短时临界区同步并推送累计提交；不声称已远端发布或已部署。本机当前已验证源码仍1d48fb170，生产开发采集OFF。

[持久结束作业细化](./development-ending.md) v2独立设计门PASS，保留v1登记恢复P2；下一批实现原登记补全、目标行原子状态保护、结束队列/恢复，随后所有删除旁路与两级事实/UI。CS-R02和两个RFC继续In Progress。


提交前最新复核：并行owner随后新增resources/0005_project_pod_stop_receipts入锁，未提交锁引用从上述五份项目删除迁移增为六份，另加本批dev-session/0013。早期11份、门禁结束时五份均为当时检查点；以本次六份及实际提交树依赖为当前发布阻断，不剥离并行锁条目。仅本地精确提交自有18路径（13源码/测试/迁移＋5RFC文档），共享锁仍留工作树，依赖齐备前不push。源码限定PASS和28项回归有效，全量4480pass/143skip/25fail/1error并非全绿；生产OFF、ending仅设计PASS、完整RFC不关闭。
