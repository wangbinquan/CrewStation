# RFC-034 开发数字执行的结束与资源清理接入

状态：原绑定数字与物理清理已实现，独立完整实现/发布复核PASS，稳定候选唯一完整本机检查4738pass/143skip/0fail；`2fb06f388fc3bfc10ae7c34b5603a8711a5d45af`已精确推送，六项CI全部成功并在本机部署。生产开发采集OFF；未绑定及所有通用入口、生产消费与两级开发事实继续。内部ending、Pod不存在或Session absent不单独代表删除许可或Token零。

## 当前真实断点

- task-runtime/application/nativeExecution.ts 的旧未选路径会在cleaning前旋转Runner令牌并connected=false。b9508486的新显式保护路径已保留原Token/连接/对象/额度并等待，尚无数字回收许可。开发日志与绑定分别是两个emptyDir，Pod被删除后不能假定可读。
- domain/ledgerProjection.ts的新选中cleaning保持present/ReleasePending；旧未选路径仍可投影absent。Failed、保留期或其他入口仍可能触发cluster-control删除，全入口清理尚未接通，不能只拦releaseEnvironment一个入口。
- 基线24d91bdc的cluster-control/adapters/k8s/workloadObjects.ts拒绝数字布局与consumer共存；task-runtime/adapters/k8s/nativeExecutions.ts的旧Pod匹配又拒绝任何initContainer。直接把business completionPolicy套给开发执行既不兼容，也会错误继承归档语义。
- 现有resources WorkloadSafety承诺原PVC、Pod、Node和全部容器的独立停止证明；它没有承诺数字日志已复制或CNY估值已入账。原数字stop/closure反向也不证明全部容器退出。

这些是运行正确性与数据完整性问题。本批复用既有拥有者和停止证明，不另建跨模块SQL连接或依赖跨实例进程内总线。

## 选择与兼容

新production producer只选择“独立数字Agent布局 + 显式持久工作负载保护”的完整组合。原DevelopmentUsageStorage version1、Runner journal/protocol1和旧hello继续保持既有合同；单有旧数字布局不能事后冒充完整保护。保护通过task-runtime私有render的新明确选择及既有workloadConsumerId保存，二者在同一受理快照中固定。新选择必须实际渲染匹配的consumer/Pod/PVC身份、启动许可与停止finalizer；旧未选开发/CLI/业务行为保留。

不设置开发父会话的archive-and-delete，不改变它的工作卷所属与保留规则。新增条件只代表数字清理阶段，不借business policy伪装。现有actual layout v1查询仍只证明它已有字段；完整保护与清理须用独立的严格拥有者查询核对实际持久render、consumerId、renderStart及原实例。缺字段、冲突、替换、未知版本或不可读一律等待，不补零。

ledger与直接K8s两种创建路径必须都验证同一选择。数字布局与consumer共存的渲染规则、initContainer匹配及实际volume/挂载检查要作为同一个候选改动和测试，不能只放宽一端。无法装配完整保护时不选择新producer；不宣告来源已支持。

## 状态与顺序

~~~mermaid
flowchart LR
  A[固定原意图与人民币受理] --> B[实际新布局与原Pod绑定]
  B --> C[逻辑结束请求持久化]
  C --> D[停止原Agent并封闭数字写入]
  D --> E[复制原日志及原归属/原价证据]
  E --> F[持久原Session排空证据]
  F --> G[容器退出及独立停止证明]
  G --> H[核对原实例与子集合后回收]
~~~

逻辑结束请求先关闭原owner准入、保持首次原因、原价/nonce/原key，并持久队列。它可以立即告诉用户正在结束，不能把请求时间、logical finished、stop ACK或最后活动时间写为实际结束时间。数字排空期间保留原Runner通道、令牌、Pod和emptyDir；禁止提前旋转凭据、投影absent、清理Secret、移除停止finalizer或释放占用。

先停止原Agent并封闭原数字键，由现有Session把原数字、归属和模型证据持久复制，并保留owner原registration、acceptedAt和priceBookRevision，取得匹配的持久排空closure。Runner→Session的复制ACK在PG ingest后；Session→观测消费者的source ACK另由ledger ingest及估值完成后推进。前一级原副本与原价证据已完整保留时，可继续关闭工作负载创建准入、终止全部容器、取得原Pod/Node停止证明并回收。后一级估值失败只保留outbox重试和费用partial，不阻塞物理清理；消费者ACK不删除原事件。不能先终止唯一读取日志的Runner，再等待它提供日志。

Task-runtime L4不能导入dev-session L5；由L4声明数字结束/排空端口，platform L6装配原owner/ending/Session/consumer。外部Runner、K8s和定价调用均在拥有者/项目/资源锁外。最终Task-runtime事务必须重读实际环境，并对拍原项目/父任务/Agent/算力修订、布局、Pod/PVC/consumer身份、renderStart和结束请求；被替换的任何字段均撤销候选回收。

跨模块结束证据只有在确认原owner关闭、原绑定不可替换、原Session闭合及原副本/归属/原价证据可持续重放时才能作为稳定前缀。金额估值不是不可变清理证明；历史原生修订可按原证据更新估值。没有这项单调性证明就不能用旧查询结果完成最终事务；不得在持锁的AgentStart循环中反调task-runtime形成等待环。具体端口及事务参与者须在实现设计门中按现有锁顺序核实，不以“重新查一下”代替边界。

## 全部清理入口

单个子执行的用户取消、自然结束、失败、初始化失败、Runner拒绝及重连恢复使用同一持久数字结束请求。parent release先关闭新增子执行的受理，再对固定子集合逐个排空，保持工作卷与父Pod直到原子最终核验。branch切换、worktree重建、管理员重启同样等待该子集合，不能先删除父环境使child读取失效。

台账投影/补投影、失败保留期、cluster-control条件删除/孤儿回收及cluster-management直接生命周期操作都要识别这个明确选择。等待数字阶段时不能发布absent或允许Pod/Secret/finalizer删除；资源maintenance只触发拥有者持久结束，在其事务外推进，不自行认定到期即排空。项目彻底删除由RFC-037拥有者seal/inspection/原操作确认协议承接同一证据；保留并行输出，不在本批收编其实现。

缺少数字清理端口的选中记录也等待；旧未选记录继续原路径。工作卷停止proof与数字closure必须分别存在并匹配，不能相互代用。父卷/namespace的删除还须所有拥有者和全部writer的证据，不由单个Agent成功授权。

## 未绑定、实际丢失及开启条件

原binding=null和Session显式absent本身不够。当前startAgent屏障只覆盖这一个入口；exec/CLI/其他执行入口不在它的承诺内，也不能据此断言整个Pod无模型或无Token。尚未绑定的取消/准备失败继续等待，直到独立设计补齐实际原选择、首次派发前关闭和不会再受理的持久证明；本批不写零或伪造receipt/closure。真正丢失也保留未知，不能只凭Pod列表中不见它来证明退出。

所以新producer在上述未绑定分支、所有删除入口和consumer/事实接入都完成以前保持OFF。强制数据丢失与实际时间来源按原headless设计另批闭环，不新造无依据的成功结果；模型/身份/真实验收仍在实现与审核完成后按既有授权边界执行。

## 验证与实施分解

| 候选 | 关键反例与退出证据 |
| --- | --- |
| 完整受理/渲染保护 | 原profile/布局/consumer固定；ledger与直接K8s匹配；旧布局不升级，新组合缺保护不可被接受 |
| 数字结束/清理屏障 | stop ACK丢失、consumer失败、Session重启、finalized记录恢复；排空前令牌/连接/Pod/Secret/额度均保持 |
| 所有旁路 | 失败、初始化、重建、保留期、投影/补投影、孤儿和项目删除不会绕过；事务外I/O，无锁等待环 |
| 独立物理停止 | init/main/ephemeral全部容器、原Pod/Node/PVC；缺证据、Pod替换及迟到创建不完成回收 |
| 原价与同快照事实 | Runner复制ACK前原日志持久；原价/归属可重放；消费者ACK前valuation提交，失败保持outbox/partial而不扣留已排空Pod；重复无双计，未知不变零 |
| production开启 | 未绑定终结可闭环、真实项目/系统两级明细、精确CI与部署、获准的真实身份/模型验收 |

每个稳定候选先独立设计/实现门与有意义的相关回归，完整check同内容只跑一次；共享在制外部失败保留并作具体比例核验，候选自身CI及实际部署分别记录。第一候选的精确文件清单必须在读现有渲染、native队列、资源删除和模块能力后冻结；本文件是接入顺序与不变量设计，不伪称已写代码或已关闭CS-R02。


## 限定设计门的实际修订

首轮13项指纹不变的只读复核发现1处P2：把观测估值成功当成Session closure及Pod回收前置，会在原日志已完整复制但定价失败时无限保留容器与额度。现已区分Runner复制ACK和消费者source ACK，保留原始副本、原归属、模型与原价证据供回收后重放；不以金额永久不变证明清理。

依据为Session `application/developmentUsageIngestion.ts`的PG ingest后复制ACK、`adapters/persistence/developmentUsageState.ts`的独立水位closure、`developmentUsageSources.ts`只推进source ACK而不删除events；dev-session `application/developmentUsage.ts`在owner关闭后仍解析原registration/price/selection；observability `application/developmentUsage.ts`在ledger ingest及value后才source ACK，`drizzleTokenPricing.ts`沿原acceptedAt/priceBookRevision读取冻结价目。具体源码候选仍需单独冻结和设计门，首轮FAIL没有改写为PASS。

## 渲染兼容的限定进展

[渲染保护候选](./development-protection.md)已通过独立设计和实现门，55项相关回归覆盖新选择、双disk、真实API默认字段、两分支许可Secret认领及公开孤儿清理。它只接通纯对象规格和旧direct的提前拒绝；没有新的活动环境选择、实际direct准入、数字回收许可或所有清理入口，不能关闭本规划。保留期、投影/补投影、父子重建及项目删除的实接仍按上述全部入口推进。当前本机3480032c，生产OFF。

## 2026-10-01 单次完整检查与外部定向闭环

完整五组件于2026-09-30T20:06:11.436315Z结束，958.36秒；lint、后端及控制台类型通过，实际4640pass/143skip/2fail、30318断言、927文件。本批16路径首尾指纹一致。结构14项违规及两项用例失败均指向并行events的0006_project_deletion_fences.sql归属解析/迁移登记；完整aggregate=1原回执保留，不改写为全量绿色。

原开发随后修改迁移并完成登记；只定向运行原结构规则和平台真实隔离PG迁移清单两个文件，2026-09-30T20:08:37.676464Z得到30pass/0fail、45断言。本批源码16路径和外部4依据在定向检查前后均未变，没有重复完整门禁、提交或删改并行文件。依据开发规则§3与用户单次候选规则，限定设计/实现审阅及55相关回归仍有效，按自有20路径准备发布；候选自身hosted CI与本机部署另记，当前本机仍3480032c，生产OFF。


## 2026-10-01 实际数字清理候选的实施细化（设计候选，尚未实现）

受理候选已以 `b9508486d94fb3bbcaa460dc03dcc697d877b37d` 精确发布；相关64项在同一完整检查内通过，18项外部在制失败保留，精确CI36790207172六项成功，2026-09-30T23:33:28.986Z实际本机部署完成。新选择在清理时保留Token、connected、Pod、Secret和额度，尚无回收许可；生产仍OFF。以下范围须独立设计复核后才能写代码，不把本节当实现、完整清理或真实模型验收回执。

### 源码断点和模块边界

- TaskRuntime `application/nativeExecution.ts` 已在选中cleaning入口提前等待；旧 `cleanupNativeExecution` 仍在项目事务内调用K8s，不能直接解除这一等待。新选择须走独立函数和实际native job身份，复用 `scope.nativeLease.requireCurrent` 的行锁后数据库时钟检查。
- DevSession `application/development/ending.ts` 和真实PG `adapters/persistence/ending` 已有原owner→AgentStart→ending固定锁顺序、关闭原owner与logicalEnding、原stop/closure合并及可接管租约。它们未在moduleApi/wiring暴露为清理参与者。`evidence-complete`只证明这份原数字结束证据，不能替代Resources停止证明。
- 原owner `developmentUsage.ts` 的bind在closeReason后拒绝首次绑定，已有绑定不可替换；prepare、价格、payloadDigest与nonce不重受理。Session查询使用公开 `getDevelopmentUsage`，不联查Session私表。复制完整与观测估值成功分别核验，后者不阻塞物理回收。
- ClusterControl `reconcileObservations.ts` 的removeChildren同时服务Failed、Paused和absent；Resources `maintenance.ts` 的失败保留期会自行改absent。OrphanSweep、管理操作与父重建也必须识别选中保护。仅在native worker中加屏障不足以打开producer。

### 第一候选：原绑定数字出口与Task清理许可

第一候选实现已绑定且原数字证据可持久查询的清理。未绑定、有startPermit但缺原journal、实际Pod丢失/不确定停止、强制数据丢失继续等待，分别留下一阶段实际证明；不造空registration、零Token或成功closure。Resources关闭准入且从未授予permit的未绑定分支将另有独立候选，不能用本候选的bound证据推断它已关闭。

TaskRuntime L4新增可选 `DevelopmentCleanupPort`，仅使用contracts里的身份、登记、停止及排空类型；不导入DevSession L5。其输入是Task自己固定的执行身份与选择摘要：项目、父任务、Agent、实际执行环境、原算力及修订、namespace/Pod名与UID、PVC UID、consumer、renderStart、固定原请求摘要。返回等待或可持续重放的原数字出口，包含原registration、原stop、Session closure、受理时间、原CNY目录修订及摘要，不包含提示词、凭据、模型启动材料。此值仅授权进入物理回收阶段，不叫Pod已停止或Token已入账。

DevSession在内部moduleApi公开一个限定清理参与者，由自身真实owner/store/ending和已注入Session公开端口实现。它先核对原实际AgentStart、owner身份、固定档位、原Pod、原binding及原价格；在原owner→AgentStart→ending短事务中持久结束请求和首次原因，禁止新派发。随后在锁外执行原键stop/Session drain；再查询持久ending与同一原Session registration。仅在原owner已关闭、绑定不可替换、stop为prevented/finished且数字closure匹配实际连续副本时返回原数字出口。原Session中断出口必须保留已复制量和明确缺口；stop unknown、损坏、断连、暂时PG失败、不同原键或替换Pod仍等待，不由超时转换成功。

已有ending stage若已evidence-complete，则不依赖再次取得claim：重启后直接按原owner、持久job和Session复核已有出口；lost ACK与再次request不重置firstReason、stop、closure、原价或水位。新api和Task port可显式注入；本候选不在production wiring调用、开定时器或选择新producer。

TaskEnvironment私有render新增版本化清理回执，记录完整原选择摘要、原数字出口摘要和固定registration/price身份。它不改变renderStart或原请求摘要，也不重用business archive状态。选中native cleaning的流程为：

1. 在短项目事务中核对实际native job kind/payload/id/fence/数据库lease和当前cleaning，固定清理选择摘要；事务外读取数字参与者并推进原owner持久结束/stop/drain。没有端口即继续持久等待。
2. 同一短项目事务按项目锁→实际job行锁顺序，再次核对当前完整身份、原consumer/renderStart/Pod/PVC/配置摘要与cleaning；在事务里写入单调数字出口回执及资源投影，事务结束前再次检查actual job有效。旧worker、已接管租约、release并发或任何选择变化不得提交。
3. 首次持久回执之前，desired保持present，ReleasePending保持true，Runner Token/connected/原对象及额度不改。回执持久以后才允许投影absent和停止新物理准入。保留期及其他拥有者入口仍必须核验同一回执，不能自行写一个同名布尔开关授权。
4. 后续物理I/O在项目/资源/owner锁外进行。原Pod/Secret必须以实际UID和原意图匹配，只用K8s UID前置条件；不能删除新实例。Resources原consumer关闭和独立全部容器/原Pod/Node停止proof另行取得，数字closure不能代替它。
5. 原对象不存在、全部原Secret回收且资源停止proof匹配后，实际job再在短项目事务重读固定回执/当前cleaning并完成native finished、connected=false、Runner凭据失效与额度释放。重复、lost delete ACK或另一个worker不能二次释放。没有真实执行结束时间时继续保留未知；清理时间不替代执行活动结束。

单调性来自原ownercloseReason永久保留、原binding/意图/价格不可替换、ending stop/closure冲突被拒、Session已闭合原副本持续重放。Task只在自己的环境事务消费这一不可撤销前缀；不在持锁时反查Task/Session/定价，不创建跨模块SQL事务或跨实例进程内锁。未来彻底删除须先封存上述回执/源事实并通过原拥有者检查，不能在本候选启用新的私表删除。

### 后续候选：全部物理入口的同一屏障

- ClusterControl每个选中Pod/Secret的删除入口重新查询当前拥有者许可及原UID。Malformed/未知版本、只有布局、只有consumer、Failed、absent或旧缓存都不能授权；native direct和资源中心两路使用相同原选择和可重放出口。正常旧业务/CLI/未选开发保持原规则。
- Resources失败保留期在资源行锁外触发Task持久结束请求，锁内只核对新资源代次；不能持资源行锁反取项目锁。等待数字出口的选中工作负载不改absent；compact也不丢掉仍等待的记录或消费者。
- 父释放、分支切换、worktree重建和管理员重启先在原项目事务封闭子受理，固定子集合并逐个请求相同清理。父Pod/PVC与原Runner材料在全部子执行完成前保持；child清理核对自己的原绑定，不要求已经releasing的父任务仍为running。
- OrphanSweep和cluster-management管理操作按原Task拥有者查询许可，台账缺失/正在补投影/环境已逻辑结束都不绕过。RFC-037项目删除只扩展该RFC自己的seal/inspection参与者，不收编当前并行WIP。
- 未绑定分支须分别证实原owner/AgentStart已封闭、Task实际job被隔离、Resources已关闭原准入且从未grant、原保护init屏障不可绕过和所有实际对象UID/停止状态；有permit却无journal不得按未启动回收。此证明用于允许物理回收，不自动把未采集数字写成零。

上述后续入口尚未完成以前，production producer保持OFF；第一候选即使限定实现/CI/部署通过，也不关闭本清理规划、CS-R02或RFC。

### 首候选冻结范围与验收

拟改动仅DevSession内部清理api/owner应用/真实PG验证、TaskRuntime私有cleanup port/render/应用/队列worker/投影及其fixture/test、platform显式清理adapter与原Session端口类型，外加本节和对应plan/remaining-work。既有platform/wiring并行WIP、本次没有所有者权限的events/identity/gateway/迁移/共享登记全部排除。读取实际实现后精确列文件及指纹，任何范围改变先修设计并复核；不增加业务HTTP字段、业务golden或迁移。

验收必须同时包含真实PG的owner+AgentStart+ending+Session副本、实际Task native worker/queue/Resources/公开Controller与受控K8s API：正常完整与显式中断出口、消费估值失败仍可复制出口、lost stop/drain/commit/delete ACK、bound原身份/Pod/价目替换、原Session恢复、cleaning期间Token/connected/对象/额度不变、数字回执后独立容器stop不全仍等待、真实项目锁与job租约过期接管、stale worker不能写回执/释放额度、缺端口/未绑定/unknown保持等待以及旧未选分支。首尾记录完整候选指纹；相关定向回归、独立实现门、单次完整本地检查、精确SHA hosted CI与部署各自记录，原失败保留，不用假closure、手工PGgrant或DTO样本替代实际链路。


### 首候选独立设计复核回执

2026-10-01限定设计v1 PASS，无新增P1/P2；37条冻结文档/源码与3条补充物理停止参考首尾指纹一致。明确旧storageStop helper在无business completionPolicy时直接返回，开发路径必须独立核原consumer/permit/stopProof；执行顺序为数字许可→原UID删除请求→Controller持久全部容器停止proof并移除原finalizer→最终释放，不先等Pod消失才触发停止。该PASS只允许按首候选继续实现；未绑定与全部删除入口完成前producer OFF。实现、真实PG组合回归、完整单次门禁、精确源码CI及部署仍须各自完成。


### 首候选v2：精确文件与物理执行选择（限定设计已复核）

沿用上述bound限定范围，选择Task专用持久native worker推进两种创建来源的原对象回收。选中cleaning始终保持资源desired=present与ReleasePending=true，直到Pod、原停止proof和两个Secret均确认回收后，最终事务才进入finished并投影absent。数字出口持久只是物理阶段准入，不把它直接当资源整体已停止；现有Controller负责原Pod finalizer/停止proof，不用generic Failed/absent删除完成本候选。全部通用物理入口仍是后续开启前置。

NativeExecutionCluster新增可选cleanupDevelopment方法，缺方法即在物理I/O前等待，原cleanup继续拒绝选中保护。此方法先严格核Task持久数字回执和原Pod UID/完整受理规格，调用UID条件Pod delete并等待；再通过锁外回调取得Resources的原closed consumer + startPermit + stopProof，三者必须核同一execution/parent/consumer/Pod/volume/node。仅该独立证明成立后删除原Runner Secret与原-admission Secret。Runner Secret核Task/原意图或资源认领、immutable、原token hash与已知UID；Admission Secret核immutable、任务与permit的podUid/nodeUid/consumerId/volumeUid。对象替换或内容不匹配等待，不按名字删除；Task和K8s adapter绝不移除finalizer，也不操作父Pod/PVC。

Task内部readonly inspectDevelopmentCleanupSelection仅为L6显式组合提供当前完整保护选择，在选中cleaning及原Pod已绑定时可返回。摘要覆盖全部Task持久原身份/render/资源/卷/Pod/节点/Runner/Secret/hash，不含current state、connected、activity、清理重试时钟或消费者金额水位；Task实际job事务在写回执和最终quota release时重新构造并对拍。摘要值之外的跨模块input只含version、完整UsageExecutionIdentity、compute profile/revision、原Pod UID、consumerId与renderStart。API/ports/domain分别保持自己允许的依赖，不从api导入ports/domain，也不跨模块import私有文件；结构一致性在L6真实组合测试编译/运行核对，不改共享contracts/index或business golden。

DevSession cleanup参与者按自己的原owner/AgentStart/真实Task环境核对上述实际身份与原profile/Pod，采用原ending存储顺序关闭派发，再在锁外stop/drain并以Session公开getDevelopmentUsage复核原登记和持久closure。输出只含不可撤销前缀：原selection、registration、ending持久stop/closure、首次关闭原因、owner payloadDigest、原acceptedAt/profile/CNY目录修订。消费者sourceAcknowledgedThrough/offeredThrough/金额或最新查询时间不进入清理摘要；消费者重试/ACK推进不能使已持久数字许可失效。原关闭后价格/原binding不可替换，不能借claim busy/evidence-complete跳过真实Session原副本复核。

Platform新增显式adapter，在锁外通过公开Task query确认input选择，再调用公开DevSession参与者；不改当前并行platform/wiring，也不在生产注入source、清理adapter或计时器。新Task/Dev可选deps缺省保持等待与生产OFF。新副本证明不能授权平台/项目其他用途。

冻结源码/测试29条、RFC文档3条如下。实施前对现有文件与新增路径做指纹登记；若需要别的文件/能力，先更新设计并独立复核，不能临时扫入并行在制品：

- `modules/task-runtime/api/developmentCleanup.ts`
- `modules/task-runtime/api/moduleApi.ts`
- `modules/task-runtime/index.ts`
- `modules/task-runtime/domain/development/cleanupEvidence.ts`
- `modules/task-runtime/domain/development/cleanupSelection.ts`
- `modules/task-runtime/domain/taskEnvironment.ts`
- `modules/task-runtime/ports/developmentCleanup.ts`
- `modules/task-runtime/ports/cluster.ts`
- `modules/task-runtime/application/dependencies.ts`
- `modules/task-runtime/application/development/cleanup.ts`
- `modules/task-runtime/application/development/workloadStop.ts`
- `modules/task-runtime/application/nativeExecution.ts`
- `modules/task-runtime/adapters/k8s/developmentCleanup.ts`
- `modules/task-runtime/adapters/k8s/developmentExecutions.ts`
- `modules/task-runtime/adapters/k8s/nativeExecutions.ts`
- `modules/task-runtime/wiring.ts`
- `modules/task-runtime/tests/developmentCleanupFixture.ts`
- `modules/task-runtime/tests/developmentCleanup.test.ts`
- `modules/dev-session/api/developmentCleanup.ts`
- `modules/dev-session/api/moduleApi.ts`
- `modules/dev-session/domain/development/cleanup.ts`
- `modules/dev-session/ports/developmentCleanup.ts`
- `modules/dev-session/application/development/cleanup.ts`
- `modules/dev-session/wiring.ts`
- `modules/dev-session/tests/developmentCleanupFixture.ts`
- `modules/dev-session/tests/developmentCleanup.test.ts`
- `modules/platform/application/developmentCleanupPorts.ts`
- `modules/platform/ports/developmentCleanup.ts`
- `modules/platform/tests/developmentCleanup.test.ts`
- `proposal/rfc/RFC-034-runtime-observability/development-cleanup.md`
- `proposal/rfc/RFC-034-runtime-observability/plan.md`
- `proposal/rfc/RFC-034-runtime-observability/remaining-work.md`


### 首候选v3：真实数值副本的跨模块回归落位

v2独立设计复核于2026-10-01 PASS，无新增P1/P2；43条参考、14条已有候选及4条补充参考首尾一致，18个新增路径未创建。删除中原Pod使用独立重试校验：保持原UID、原归属和完整受理规格，但不要求仍保留初始finalizer；finalizer消失不授权提前删Secret或释放额度。原Runner Secret UID在两种创建来源均已持久保存，必须核该UID与原令牌摘要。

为落实本节已经要求的真实PG＋Runner SQLite日志＋原owner/AgentStart/ending＋Task native job/Resources/公开Controller组合验证，精确新增`tests/e2e/developmentCleanupFixture.ts`和`tests/e2e/developmentCleanup.test.ts`两条测试路径。根级跨模块用例遵循既有`tests/e2e/developmentUsageJournalCopy.test.ts`落位，可组合实际模块私有适配器与Runner日志；模块内各自的测试仍只经其他模块根API。该调整只增加测试落位，生产源码范围仍29条，RFC文档仍3条；共34条候选。测试以受控传输与K8s模拟故障，不启动真实模型，不手工写Session closure或Resources grant。原source消费ACK、金额估值失败与重试必须不改变已许可摘要。生产producer/cleanup组合继续OFF，全部通用入口与未绑定分支仍未关闭。


## 2026-10-01 原绑定数字与物理清理实现候选

v3限定设计门PASS（53条参考、14条现有候选、20条新增路径及3条补充参考稳定）。34条批准路径内已实现内部Task/Dev/Platform清理参与者：Task只在真实作业事务fence内保存原数字出口及最终额度事务；Kubernetes操作和Session传输均在锁外。原Pod完整规格/UID、Runner Secret已知UID/原令牌、准入Secret任务归属/不可变四元许可以及删除前实际UID条件分别核验。Controller先持久全部原容器停止证明，再移自己的finalizer；Task不移finalizer，不删除父工作区Pod或PVC。生产装配仍未启用。

准入Secret的历史UID未在既有受理记录持久保存。本批核原permit四元值及当次读取UID，以API UID前置条件防止读取与删除之间替换；原Runner Secret则必须核已持久的历史UID。不能把前一种校验写成已检测“首次读取前、相同完整许可内容的另一UID”。该边界纳入实现复核，未批准范围之外不增加迁移或修改共享准入来源。

Task/Dev/Platform隔离模块首轮失败和修复保留：资源消失观测会通过对象认领返回record而不携带input.resourceId，等待现以真实record身份确认；替换Agent/项目夹具改用平台UUIDv7，不放宽身份规则。Task补充原Runner UID、错误准入卷、读取后Secret UID替换、错误Node/consumer/不完整容器证明及最终I/O期间作业接管的反例，16项/90断言通过；原三模块合计21项/105断言通过，新补反例后的组合回归另记。

根级10项/62断言真实组合全部通过：Runner SQLite→Session PostgreSQL副本/ACK→owner/AgentStart/ending→Task job→Resources/公开Controller→原Pod/两个Secret→额度。两种创建来源、数字未复制保持凭据/额度、stop/drain/Runner ACK/ending提交丢响应、Session实例重建、原日志关闭后数值重放、source ACK推进/新价格不改变原许可均有验证。首次中断场景失败日志保留：本候选要求独立停止与Session已知末尾对拍。已验证的中断为原日志头N=10仍可读取、实际数值页只复制M=5后明确不可读，最终真实PG closure保留missingAfter=5/missingThrough=10/tailUnknown，不手写closure或grant、不以超时判丢失。整个日志头未知或未绑定仍等待后续独立证明。

本地受控Kubernetes/Runner传输不等于已部署或真实模型验收。定向类型检查通过；首轮lint的一处import()类型注解已改为type import，复验待回执。独立完整实现复核、稳定候选唯一完整门禁、精确发布CI及本机升级尚未完成。未绑定、全部通用删除入口、消费者生产装配与两级事实/UI继续，两个RFC保持In Progress。


## 2026-10-01 原绑定清理的独立实现门与唯一完整验证

独立完整实现复核PASS，无本限定范围P1/P2，31源码/测试、3文档、50参考和8完成回执及补充依据首尾指纹一致；明确准入Secret只核原许可内容和当次读取UID，不冒称历史UID。稳定源码在2026-10-01T01:01:26.425013Z至01:20:05.198489Z仅运行一次完整五组件检查，耗时1118.804秒：架构、全仓lint、后端类型、工作台类型和测试全部exit=0，aggregate=0，源码31条首尾不变。

测试实际4738pass/143skip/0fail，31146断言、945文件（4881测试）。四个新增清理测试文件共36pass/0fail/0skip，同次12个相关文件83pass/0fail；跨模块10项实际SQLite/PG、公开Controller停止证明和物理回收成功。143跳过保留明确环境/真实身份模型条件，不算实际模型或部署验收。第一轮缺口夹具、观测等待、UUID和type-import失败与修复日志继续保留。

期间main由其他会话正常推进至602bd144（项目资源权限列表/文档）；冻结源、三个RFC文档和50参考均未变。按用户候选内容规则复用这次完整检查，不因HEAD推进取消或重跑。发布仅34条批准路径，共享STATE/RFC索引及外部在制品不纳入。待最终发布回执和本候选精确六项CI成功后升级本机；现行b9508486与生产OFF不变，未绑定/全部通用入口、consumer生产调用、两级开发明细和实际联合验收仍继续。


## 2026-10-01 原绑定清理精确发布与本机部署

- 源码34条批准路径已精确提交并推送 `2fb06f388fc3bfc10ae7c34b5603a8711a5d45af`；提交含 `Co-Authored-By: Codex <noreply@openai.com>`。发布后main/origin同步、共享索引为空，其他会话在制文件保留。独立实现/最终发布复核PASS，唯一稳定本地完整检查4738pass/143skip/0fail；未重跑完整检查。
- [本提交CI 36801111766](https://github.com/wangbinquan/CrewStation/actions/runs/36801111766) 的static、unit、module、console、e2e、gate六项全部completed/success。AW修复edd56ebe的主线/九种定时配置成功及最近实际调度八种全部成功仍保留，不以CS CI替代AW结果。
- 部署前按实际OCI镜像核对源码：console为602bd144、control-plane为25d0f545、默认Runner为b9508486，均是本提交祖先；升级保留并行已部署输出。完成时间 `2026-10-01T01:40:44.408Z`（北京时间10-01 09:40:44.408）。八组件均Ready=1、generation=observedGeneration：console 217、cs-api 209、cs-auth 107、cs-controller 174、cs-events 77、cs-session 126、mcp-capabilities 73、mcp-operations 73。storage-contract=1，原owner/Session数字表存在。
- 数据库custom备份0600，42804334字节，SHA256=`8d7665645c3c1fc7d3dfcd0aa2a4ca3fbdeb9a2941e975e9e70588049cc80dcf`。迁移Job `rfc034-development-digital-cleanup-migrate-2fb06f38`，UID=`e5df75e1-7ec7-49bd-a20f-076dd791d041`，Complete；实际applied=0、roles.initialized=0。
- console镜像摘要 `sha256:5521687c6d52d0b420fcf0ac9acc63bbd5f60c763ac1b8b197d3d2f6db69dcec`；control-plane `sha256:0af73210f463a7fa02f0bbe4f1b81255c9466227bc3c66a7f267dc8fcc16fb93`；task-runtime/默认Runner `sha256:587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928`，三镜像OCI源码label均为本提交。已有执行/固定档位Runner没有重建。
- 公开只读验收 `2026-10-01T01:41:20.842404+00:00`：console.cs.localhost/auth/login HTTP200、未登录根HTTP401，八组件和三个摘要全部对拍。没有身份切换、实际模型调用、真实开发验证资源创建或结束。
- 边界：内部原bound清理代码已部署；生产数字producer/cleanup组合尚未注入，仍OFF，sourceScope=business-tasks。143跳过项不算真实身份/模型验收。未绑定/整个日志头未知、全部通用删除/保留期/重建入口、生产消费/项目和系统开发明细与实际AW联合验收继续；CS-R02和两个RFC保持In Progress。
