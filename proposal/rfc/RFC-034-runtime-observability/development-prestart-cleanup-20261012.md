# RFC-034｜原开发执行未获准启动的清理分支

状态：有限设计候选，尚未改生产源码。承接 `development-removal-barriers.md` 的“无 binding、准入关闭且从未 grant”出口，只实现这一支；数字仍未知，不伪造 registration、Session closure 或 Token=0。基线与当前来源已冻结在同目录 `manifest.json`，共享 `sessionLifecycle.ts` 和 RFC-036 不在范围内。

## 真实故障与已有原语

原验收 B `01a11899-d396-7000-9315-07742ab95009` 的原 Pod UID 为 `5e560268-cd02-49af-ae55-b58d88198896`。它已调度，准入 init 正在运行，主容器尚未启动；原 Resources consumer 已关闭，`startPermit=null`；原 Dev owner 仍 `binding=null`，Session 没有数字流。它不是 `never-scheduled`，也没有可用于绑定成功分支的数字停止回执。A 的实际停止、复制与清理不受本片改变。

当前 Dev `cleanup.ts` 在读取 owner 时因无 binding 提前返回 waiting，尚未关闭原 owner/AgentStart。Task 的 `workloadStop.ts` 又把 startPermit 作为任何停止证明的前提。两项条件使这支永远不能前进。现有公开原语足够组成一个独立出口：Dev 的 `requestDevelopmentEnding` 接受原 binding=null，并在原事务内关闭 admission、把原 AgentStart 置为 logical ending；owner 的 bind CAS 在关闭后拒绝新绑定；Resources 的 `closeAdmission` 与 `grantStart` 在原消费者锁下串行，closed/no-permit 是持久 tombstone；Session 的 `lookupDevelopmentUsage` 只有真实查询成功才返回 absent；Controller 能读取原 init 与主容器的实际停止状态，再持久原全部容器 proof。

所有实际 `registerDevelopmentUsage` 的生产调用都先要求原 owner 持久 binding，原 selected start 命令也只从同一 binding 派发。本片必须以正反例锁定这个顺序和 close/bind 的实际竞争。Session absent 自身不是封闭证明；它只能在 owner 已关闭、原 binding 仍 null、原 AgentStart 已结束、Task 真实 cleanup job 与原 Resources no-grant 都齐备后，作为附加一致性检查。

## 独立证据，两个阶段

原 `DevelopmentCleanupEvidence` v1 的所有字段、校验与顺序保留。内部公开类型和两个 owner 自己的解析器新增 v2 分支，显式 `kind: 'unbound-no-grant'`，阶段为 `stopping`／`closed`，保留同一原 selection 与原 owner 的 payload digest、firstReason、受理时间、档位修订、protocol、人民币价格版本。v2 不含 registration、usage stop receipt、数字 closure 或虚构实际结束时间；`numericState: 'unknown'` 固定，不能转换为 v1。`stopping` 只允许原 Pod 停止意图；`closed` 还必须包含原 Resources 的独立实际停止 proof 及其摘要。

Dev `advance` 先核对实际原 owner 与原 Task 清理环境、档位、原 selection、Pod、非 terminal 的 Agent 归属。绑定存在时继续原 v1；无 binding 且非 unsupported 时才考虑本片。通过原 `requestDevelopmentEnding(..., cancelled/原 firstReason)` 关闭原 owner 与 AgentStart，随后重新读取两者并真实 lookup Session；原 binding 仍 null、close reason 与原 ending job 一致、Session absent 时返回 v2 stopping。查询故障、冲突、登记存在或者 unsupported 均 waiting，不能降级、补零或创建数字流。对原 bound 路径仍调用原 ending/drain，不采用本片。

Task 在原 cleanup job 的项目／作业 fence 内核对不可变原 selection；在锁外关闭并重新读取原 Resources consumer，要求完整原身份一致、closed 且 startPermit=null。这一份真实读取必须早于保存 stopping 证据和任何 Kubernetes I/O，并在每个破坏动作前重做。原 no-grant 不能由客户端传入的布尔值替代。真实 job 只接受当前 cleaning/releasing 的原 execution，原 creator 后续创建回执与 UID 更新不能越过该状态及 job fence。迟到同名 Pod 或凭据仍按原 UID/CAS 冲突等待。

Kubernetes adapter 仍先以原 UID 和完整 admission init／容器／挂载／镜像规格校验原 Pod，然后只发该原 Pod 的 DELETE（保留原宽限期）。等待原 Pod 消失以及 Controller 持久的全部原容器 proof；不提前移 finalizer、删凭据或释放额度。未调度和已调度分别采用既有 actual proof 类型；已调度必须是原 Pod／实际原 Node 的 kubelet-terminated，并包含所有原容器。原主容器未启动可使用 Controller 的实际 never-started 容器项，init 必须有自己的实际停止证据，不能把整个 Pod 说成未启动。

guard 的新 `beforeCredentials` 回调在取得上述 proof 后、任何凭据删除前调用原 Dev `completePrestart`。该方法从自己装配的 Resources 公开 get/admissionClosed 重新取得并校验原 no-grant 与同一实际 stop proof，再真实 lookup Session absent，并在原 Dev owner／AgentStart／ending job 事务内验证原 owner 仍 closed/null-binding、原选择和 reason 未变，持久 `prestart-closed` 与实际物理证明。禁止仅信 Task 传入的 proof。Task 随后在原 job fence 下只允许相同 stopping→closed 进展，保存 v2 closed；任何故障保持原材料与占用，重放继续原证据。

Dev ending 新 nullable JSON 字段 `prestartClosure` 保存这份独立 proof；新增迁移 `0019_prestart_development_ending.sql`，旧行读取缺省 null。新 stage `prestart-closed` 要求 stop/数字 closure/虚构 logical result 均 null，且有匹配的 prestartClosure；旧三个 stage 的既有数字条件原样保留。原 request/claim/retry/recovery 不得重新打开该终态，也不重复创建 closed admission。旧 schema、回执、预算和迁移均不改。生成器仅登记这个新迁移。

凭据回收阶段：Runner Secret 继续验证真实历史 UID、原 intent 和原 token。无 grant 原则上没有 admission Secret；真实 GET 证实 absent 才可继续。若发现任意 admission Secret，保留并 waiting，不能从当前 UID 回填历史，也不能用 null permit 构造四元许可去删除它。新 selection 的历史 UID 要求仅对真实 grant 分支生效；旧批准的 bound legacy 四元许可/current UID 规则保持。最终原 Task job 事务仍在 fence 与已闭合 v2、原 physical proof 都一致后旋转令牌、写 finished/released、释放占用。

## 通用删除、父退出与用量呈现

通用原物理查询接受 v2 stopping 时，仅允许同一原 Pod 的停止意图。Secret 与 stop-finalizer 仍要求独立完整物理 proof，Secret 还要求 closed v2，未知 admission Secret 永不取得许可；Controller 自己先保存 proof 再移自己 finalizer，Task 不代移。保留原 resourceVersion CAS、替换冲突和等待向上传递。原 v1 与未选择对象行为保持。

父成员退出新增独立 `protected-prestart-closed` kind，保留 v2 unknown、原 selection 与真实 stop proof 摘要；不伪装 complete/interrupted 数字 closure。原已绑定成员继续 protected-closed。父持久集合的 liveUnfinished 对两种 protected kind 都对拍原 evidence，单个 v2 不能绕过其他 child、原父停机或集合冻结。此处仅适配新增 child 出口，不修改父操作选择策略和并行 sessionLifecycle。

观测的原 owner 仍保持 admission、原价、原 Agent/项目/算力修订和无 binding 的事实。四桶与人民币维持 unknown／未估值，known partial 仍可显示；不发假 meter、不制造费用、不把未获启动许可的数量当模型调用。原观察事实读取无需换查询或回填实际时间。本片不能关闭整头未知、有 grant 未绑定、全 writer seal、生产 producer 的剩余设计。

## 精确实施和验证

精确生产路径、新文件、原测试扩展及新真实 PG／Kubernetes 传输用例见 manifest。范围只覆盖 Dev 原 owner/ending 与 cleanup、Task 内部 evidence/cleanup/通用查询/父 child 适配和 platform 公开装配，不直接读其他 owner 私表，不改业务 API 或 Runner 协议。Resources/Session/Controller 既有原语作为参考保持字节稳定；若验证发现它们不具备这里声明的能力，停留在具体设计缺口，不能临时放宽原证明。

必需用例：原 B 形态（已调度、init running、main waiting、closed/no-permit、null-binding、Session absent）在旧源码稳定等待；修后经实际 Dev request、真实 Resources 锁、实际 Task job 与 controlled Kubernetes／Controller proof 正常推进。数字状态始终 unknown，前缀阶段全部凭据和额度保留，proof 前 finalizer/凭据拒绝。覆盖 no-grant 与 grant 的真正竞争、close 与 bind 竞争、迟到 start 与 creator 回执、lookup 失败/已登记、owner 不匹配、Pod/Node/Secret UID 替换、完整容器集合缺失、真实 job lease 接管、中途故障重放、新 marker 与 legacy bound、父成员 unknown 出口与其他 child 等待。各故障注入使用原生产端口与原 PG 事务，不手写 stop/closure/grant 绕过实际链路。

设计功能门通过才改源码，先保留有效红例，再跑对应定向用例、静态检查与稳定候选一次完整 check；独立源码检视、精确提交、当前 SHA 六项 CI 全绿后再本机部署。上一片 fe0c 的本地发布例外不复用。部署后通过原 B 的正常调和验证，最后按原授权恢复本会话临时项目额度，不手动删除 B 或父 Pod。

# RFC-034 未获准启动清理｜v342 的有限装配补充

本片与 v342 9507 字节设计共同组成同一有限设计。原 design/manifest/41 份原件原样保留。只补检视者提出的真实 ending 入口、共享锁、公开装配与父 closure port，并把实际包装层所需转交明确列入实施清单；没有生产源码或运行状态变更。

Dev 原 ending 的 request 对 cancelled/null binding 走既有 store.request；completed/error 没有真实 receipt 仍等待。新 prestart-closed 是独立终态，所有原 claim/retry/recovery/request 重放必须保留终态而不重新激活。Resources closeAdmission 与 grantStart 都使用原 task-storage 事务锁；真实 consumer/get 与 tombstone 查询是完整原身份核对，不能以独立的 boolean 代替身份。

装配新增 Dev 中立 ports/developmentCleanup 内的 `DevelopmentCleanupWorkloadSafety`，仅描述 get 和 admissionClosed 所需的 contracts 类型，不 import Resources 私有文件。DevSessionModuleDeps 增加可选 `developmentCleanupWorkloadSafety`；平台 composeRuntime 在原 createDevSessionModule 注入同一个 `resources.api.workloadSafety`，structural superset 不创造第二 ledger 或 consumer。makeCleanup 将该真实端口传入正常与 project deletion 的 participant。缺少端口时旧 bound v1 保持原行为，新 v2 必须 waiting，不能绕过独立 proof。平台 599 行的既有 wiring 只在现有 createDevSessionModule 参数行追加输入，不增加第 601 行或重构无关装配。

DevelopmentCleanupSession 增加可选 `lookupDevelopmentUsage` 类型（contracts 的实际 DevelopmentUsageLookup）。当前正式 SessionClient 与 project deletion 私有 Session port 都已实现此方法，均只使用既有真实查询，全部原客户端/HTTP/Session 实现保持；测试旧 port 缺省时 v2 等待，旧 v1 不受影响。普通 guardedDevelopmentPort 原样转交全部方法，维持真实 receiver 与原 project-work lifetime。新 Resources 只读端口在普通 continuation 内同样按原 work.whenActive 受理，不跨 owner 私表。

`completePrestart(selection)` 是与 advance 相同原 selection 的第二内部动作，Dev 从独立 Resources 端口读取真实 stopProof，输入不接受调用者制造的 proof。它返回原等待／permitted 结果，permitted 仅为匹配的 v2 closed。平台 developmentCleanupPort 与 forwardDevelopmentCleanup 在 advance 和 completePrestart 两个动作前都重新读取 Task 原 selection、核对全部 hash，返回后再核对 evidence.selection；缺失 completePrestart 能力时 waiting，不把它当普通 advance。

当前 developmentCleanupWork 只包装 advance，故将该文件明确增加进精确清单：同一原 runOrigin(kind=ending) 包装 completePrestart，原入参 identity/inputDigest 与真实 effects lifetime 保持。不得用 spread 暴露未经包装的新写动作。

项目删除也不能漏掉第二阶段：Dev 公开内部 API 增加 projectDeletionCompletePrestart(context,selection)，保持与原 projectDeletionCleanup 相同的 stop 阶段校验、原 runGranted、原 task identity、独立 reference/inputDigest 与由 coordinator 提供的同一私有 Session continuation；它只调用 makeCleanup(session,true).completePrestart，不沿普通 continuation 绕过删除 fence。平台 runtimeCleanup 与 runtimeProjectStops 的 development(context) 同时转交这两个动作，每次重新取得 dev-session participant 的原 context；缺少第二动作等待。RuntimeOriginalStopSources 引用原 DevelopmentCleanupParticipant 类型，随它扩展，端口文件本身无须改。原 digital／originalPodUid／stopped 与项目确认集保持。新增内部接口仅为该清理分支，没有 business HTTP 或 Runner 协议变更。

父 child port 的 closure 是既有 Readonly<Record<string,unknown>>，新 protected-prestart-closed 可用，无须修改父端口。所有旧 bound closure 条件、budget 与其他 child 等待保持。

v342 的原生产 planned-edit 加上本片五条：modules/platform/wiring.ts、modules/dev-session/application/deletion/internalWork.ts、modules/dev-session/api/moduleApi.ts、modules/platform/application/deletion/runtimeCleanup.ts、modules/platform/application/deletion/runtimeStops.ts。v342 原测试扩展清单另补 modules/platform/application/deletion/runtimeStops.test.ts 与 modules/dev-session/tests/deletion/internalWork.test.ts；原文件全文冻结。新增断言覆盖两个动作的 selection revalidation、真实 work receiver/lifetime、删除 stop-context 与 fence、缺少第二动作等待和实际公开 root 注入。所有原断言与 timeout 保留，真实 PG no-grant/grant、close/bind 竞争与实际完整容器证明仍为 v342 必需项。

本片不处理有 grant 未绑定、数字整头未知、全 writer seal 或 producer OFF，也不修改并行 sessionLifecycle。有限设计功能检视完整消费 PASS 后才进入源码；原 fe0c 发布例外已经用于该旧片，本片仍需自身一次稳定候选完整检查、源码门、确切六项 CI 后部署。

设计门：v342 + v343 已完整消费 VALID / PASS（19 项检查、5 项上下文缺口闭合、P0/P1/P2=0），2026-10-12 进入实施。该结论仅批准上述两片设计，源码、实际停止、额度恢复、完整检查、CI 和部署尚需分别验收。

实施时的精确补充：原 AgentStart 普通投影不包含 logicalEnding，因此在已登记的 ending/prestart.ts 与原 ending port/store 增加 inspectPrestart，在原 owner/AgentStart/job 同事务读取实际关闭位；没有新增 AgentStart 公共字段。Dev 的 deletion/api.ts 既有 lifetime 分类还需将新增 projectDeletionCompletePrestart 按原 projectDeletionCleanup 排除，写动作仍由原 runGranted 包装。Task 既有 domain/development/removalEvidence.test.ts 与 tests/developmentCleanup.test.ts 加显式 version=1 断言后访问旧数字字段，保留全部原断言和预算。这些实施必需路径与类型补充纳入后继源码门，不扩大功能范围。

验证层级补充：Task 的两个新用例使用新 tests/developmentPrestartCleanupFixture.ts 及原 developmentCleanupFixture.ts 的受控 kubelet 输出来检验真实 Task/Resources/Controller。跨 owner 完整链路按原仓库层级规则放入根 tests/e2e/developmentPrestartCleanupFixture.ts 与 developmentPrestartCleanup.test.ts；原根 developmentCleanupFixture.ts 仅导出并缩窄 originalOwner 所需字段以复用实际 PG 初始受理，原绑定链路不变。跨 owner 用例从实际 Dev factory 与 Session API 查询，Controller 生成 stopProof，没有手写 grant、stop/数字 closure。全部路径进入后继源码门。


## 实施候选与原始失败记录（2026-10-12）

本片为 48 个明确文件的候选，尚未提交、部署或作为 RFC 完工依据。旧绑定数值出口、原条件与断言预算保持，新增独立的未绑定且无启动许可出口；平台普通与项目删除装配保留 receiver、原 Task 选择和删除授权。

真实独立 PostgreSQL 的 Dev、Session、Task、Resources 与 Controller 链路验证通过。18 项定向回归／133 次断言／零失败覆盖正向闭合、真实 Session 已存在及读失败、原 owner 关闭与迟到绑定竞争、真实 Controller 发放许可与 Resources 关闭竞争、init 仍运行、原 Pod UID 被替换、闭合失败后的接续、两个公开动作和项目删除授权。后端类型检查通过；结构检查通过。另六项 Task 新回归此前通过，但这些定向结果不代表完整检查、hosted CI、本机原资源释放或页面验收完成。

保留首轮红例及原失败日志。普通 AgentStart 查询投影不含逻辑结束字段，因此闭合只读取 owner 自己的事务内原行；没有扩展该公开投影或依靠推断。跨模块首轮在真实数据库中发现旧 0014 的阶段 CHECK 不允许新终态，修复只在新增 0019 中扩展约束，旧锁定迁移原字节不改。测试中控制的 kubelet 终态曾不完整，原 Controller 正确拒绝证明；补充实际容器／sandbox 状态后，仍由 Controller 判断并写入证明，不伪造 proof 或启动许可。

原 B 尚未释放，临时额度尚未恢复；仅在这批候选独立源码复核、唯一完整本地检查及对应 hosted CI 通过并部署之后，重放产品自身正常清理并核对原身份与额度。原数值流仍未存在，应显示未知，不能回填零。


## 新终态的两项接续防护

在已冻结的生产候选之外，仅给同一新测试文件追加两项防护，生产源码、旧用例和预算不变。真实 Task/Resources/Controller 的泛型删除查询在 stopping 阶段保留 Runner 凭据，closed 后才允许同一原凭据；同名其他 UID、凭空出现的 admission Secret 仍拒绝。真实父任务 API 在原成员仍活动时冻结成员，经原有持久游标到 EOF 并接续后，保存 `protected-prestart-closed` 与实际停止摘要、unknown 和 tailUnknown，原未完成计数为零并继续原父 epoch 的物理退出。没有为数字未知补造数值闭合。

这两项均有实际通过记录，累计 20 个不同回归案例已通过；不是完整检查或 CI 结论。新父用例初始误把“已释放子任务”列入新成员、把未完成页当作已闭合行读取，并误要求子成员已闭合后继续阻塞父 Pod，失败日志全部留存。正确用例先经原 API 冻结活动成员、按实际 EOF 接续、读取 Task 自己的闭合行并断言原 epoch 与退出推进；未改生产行为、旧断言或时间预算来获得通过。

补充用例首次最终类型核对保留 `typecheck-terminal-boundaries-final.log` 的原始失败：父 Pod UID 在夹具类型中为可选值，不能直接作为必选字符串传入断言。候选只在新增父成员用例中显式核验原 Pod UID 非空，并保留原 epoch 相等断言；`typecheck-terminal-boundaries-r6.log`、限定 `terminal-boundaries-eslint-r6.log` 的独立退出码均为 0。生产文件、此前四项物理边界用例和全部时间预算未改；这仍不代表当前候选的完整检查或 CI 已通过。


## 完整检查反馈与旧库接续修复

48 文件候选的唯一一次完整 `bun run check` 已结束：结构、lint、两次类型检查通过，6,594 项通过、177 项按原条件跳过、2 项失败；原完整日志与退出码保留，不能作为本地全绿依据，也不复用 fe0c 的旧发布例外。

本次增加原 `developmentEndingUpgrade.test.ts`，形成 49 文件候选。旧用例只迁移到 0014，却调用需要 0019 新列的当前 ending reader，实际报 PostgreSQL 42703。修复保留旧 0014 精确迁移结果、全部原业务值、逻辑标记、幂等与 ending 缺省断言及原预算：先直接核验 0014 历史 ending 表为空，再在同一原旧库依次运行五个真实后续迁移；之后再次比较原 AgentStart 和 accepted owner 全值，使用与最新 schema 匹配的当前 reader 核验 ending 仍不存在，并验证最新迁移幂等。旧迁移文件不改，生产读取器不增加旧 schema 回退。

另一项为既有 nativeProjectDeletion 用例的 PostgreSQL 55000：本机旧测试库未启用预备事务，而原 CI module 用 PostgreSQL 17.11、`max_prepared_transactions=10` 实际验证这条路径。原用例、断言、准入协议和预算保持；后续验证使用同一已存在的 17.11 镜像、独立 loopback 端口和自己的临时内存数据目录，通过原 `CS_TEST_DATABASE_URL` 选择测试库。在用平台数据库、测试旧库的配置与容器、PV/PVC 和原项目资源不改。新的定向检查、49 文件候选的一次完整检查、独立源码补充门与对应六项 hosted CI 仍需各自通过，之后才部署并重放原 B 的正常清理、恢复额度。
