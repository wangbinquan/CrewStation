# RFC-034 开发实际来源消费第一批设计

状态：限定v3设计门已PASS；第1项原选择接口已发布、精确CI成功并本机部署，完整持久消费者尚未接通，生产 OFF。承接已发布/CI成功/本机部署的 d01ba8223 实际来源底座；沿用已批准 RFC-034 和 development-headless/development-owner。先实现内部持久消费，不启用生产派发，不扩大业务统计 sourceScope，也不关闭 CS-R02。

## 实际断点

- Session 已在独立开发 journal/outbox 保存严格 DevelopmentUsagePage；nextDevelopmentUsageSource/readDevelopmentUsageMeasurement/acknowledgeDevelopmentUsageSource 是已有模块 API。
- dev-session owner.resolve 目前只返回原 registration 和冻结 CNY 受理，不包含 Hook 前是否选择 nativeSource 或 expected namespace。consumer 不能凭 Runner 帧自报或当前 hello 补选。
- observability 的 usageIngestion/UsageLedgerTransaction.capture 仍接受共享 RunnerUsageCapture；其 nativeRepairCandidate/nativeStepKey 只用 namespace、原生 root/record 和 snapshot order 证明历史归属。这不是实际文件身份；相同 IDs 的复制库不能据此连接。
- drizzleUsageLedger 的原生 proof、steps、baseline、修订及 source cursor 已共用事务。native_captures.document 是私有 JSONB，可增加独立开发来源状态，不另建 Token 加法账本。

源码锚点：modules/session/api/moduleApi.ts、modules/session/adapters/persistence/developmentUsageSources.ts；modules/dev-session/application/developmentUsage.ts、ports/developmentUsage.ts 与 api/developmentUsage.ts；modules/observability/application/usageIngestion.ts、domain/usageProjection.ts 与 adapters/persistence/drizzleUsageLedger.ts。

## 第一批边界与模块落位

1. dev-session 的独立 API/port resolve 值可选增加非敏感 nativeSelection，仅从原持久 intent 读取 version=1、expected namespace；不返回 prompt、Hook、digestNonce、令牌或完整启动材料。旧未选择的值省略该字段、原 JSON/摘要不变。registration 的原 key/Pod/完整开发身份和首次 CNY 受理继续原样返回。
2. observability 新建开发专用应用入口和来源 port，由 platform 通过各模块 API 装配。来源页先按 DevelopmentUsagePageSchema 校验。该页只有key/after/through/events，不能用owner自己的header和自己比较。platform另调用现有Session.getDevelopmentUsage(key.executionId,key)，取得Session独立持久registration，与owner.resolve的原registration逐项比较runtimeTaskId、完整key、Pod UID、完整project/workspace/Agent/execution/generation身份和profileId/revision，再核owner原价身份/修订及冻结选择；任一缺失或不符均不ingest、不ACK。比较后的Session registration与冻结选择共同组成内部source envelope，不扩展公共页。生产 wiring 不注入该来源、不启动新 worker；第一批通过真实 Session PG outbox 的限定集成验证。
3. 不扩展共享 RunnerUsageCaptureSchema、business v1 或普通 AgentEvent。开发 native 帧使用 DevelopmentRunnerUsageCaptureSchema；新增独立内部 native context，包含完整 registration 和冻结选择。generic 数字证据仍按既有 nullable 四桶及模型证据入账，来源元数据不成为第二份数字。
4. streamSourceId绑定完整原key/Pod/开发身份，用于固定页回执/来源cursor；页fingerprint覆盖独立核对的Session registration、冻结选择和原事件。数字/原生capture使用独立captureSourceId=hash(streamSourceId,scope.turn,scope.turnIndex)，同一固定页可跨多个turn，不能把复制IDs的不同turn合成一个数字meter。原recordId不改，迟到模型仍按measurement自己携带的原scope.turn/turnIndex找到原capture；没有scope的旧聚合数字保留原记录语义，不借此宣告原生归属。只接受原 Session 提供的连续固定页；事件、数字投影、私有来源状态、原生步骤/修订、页回执及来源游标同事务提交。重复页零增量；不同内容同水位冲突回滚，不能 ACK。

## 来源状态与阶段约束

- 为每个 private native capture 保存 selected、原 Pod UID、expected namespace、begin 与 finish。记录只来自严格 source 帧；begin/finish 的 turn、turnIndex、namespace、plannedPathDigest 和同帧 nativeProof 匹配。finish 里的 beginStore 必须逐字匹配已持久 begin，不能靠 finish 自报补造开始证明。
- 原生证据早于最终来源时可以持久保留数字和 baseline，但保持待证明；不提前建立跨 capture 的 owner 或完整采集结论。未选来源、缺 begin/finish、changed/unavailable/unsupported、读/sidecar 问题不得解释成完整零。
- sourceVerified与数字captureComplete是两个判据。sourceVerified只要求已持久begin和finish、精确阶段/同轮/计划匹配、finish finalStore observed、无来源问题、fresh的new/same或resume的same连续性；不以nativeProof.state=complete为前提。原proof的partial/native-prior-revision-gap仍可验证真实文件并进入既有修订规则，待历史10→15修复后才能按原规则恢复数字完整性；其他原生root/证据缺口不能被来源验证消除。sourceEpoch、actualPathDigest、fileIdentityDigest 三项共同绑定真实文件；snapshot_order.epoch 继续原排序含义，不能代替文件身份。
- unsupported 的 begin/finish 也必须可持久往返。开发来源的 stage 决定开始/结束；不能套用旧 persistProof 将 unsupported 开始立即视为不可更新终态。business proof 的原冻结规则不放宽。
- 第一批 scope 仍只有 execution-local/unverified。历史关联限同一个原 Pod UID 中的已验证同库；跨 Pod 即使摘要巧合相同也不宣告持久沿革。跨 Pod/PVC 恢复必须等 owner 固定挂载约束和 workspace 能力共同实现，不按路径名或当前配置猜。

## 去重分区与迟到证据

原步骤键不能直接沿用 namespace+root+record，否则复制库会污染 owners.limit(3) 与既有修订。开发捕获的 key 始终有独立前缀：未证明时是 capture 专属 pending 前缀，sourceVerified后是 hash(expected namespace、原 Pod UID、实际三项 store 身份) 的前缀；业务键的原字节不变。

数字/历史页到达时按该 capture 当前持久前缀写入步骤和 baseline。finish达到sourceVerified后（即使数字proof仍为partial），原事务内将该capture已保留的两类键从pending前缀转换为已验证前缀，并重核相关修订/summary；重放不会二次加前缀。转换用受 captureId 和旧前缀约束的两条 SQL UPDATE。既有baseline最多10,000条；不能把它冒充steps也已受限。新开发选择路径另外给原生归属索引施加每capture10,000个不同步骤的硬界限：超过时仍提交普通四桶数字、固定页/游标和实际来源元数据，保留私有overflow标记及native-evidence-incomplete，不扩大原生owner候选或宣告完整；普通数字不截断。重复步骤或同一步模型补全不消费新名额，business行为不变。这样最多更新两组各10,000行，不逐条发网络请求或在项目锁内调用Session。未验证捕获不进入跨 capture owner 候选。

因此相同 session/part IDs 的不同文件分属不同 key 分区，不能合并、消耗前三个 owner 名额或撤销另一库已证明的修订。同库同 Pod 健康重开、begin/final迟到和原库步骤10→15可以重新关联原请求；重复/乱序页不新建 owner，不把原请求改名为新执行。

已有数字投影保持自报告值；历史 correction 仍只替换原 owner 请求的有效贡献并增加 projection revision。每个普通数字measurement都在来源页同事务保存私有模型证据：完整meterKey（identity、captureSourceId、recordId）、raw revision、原stream/sequence/index、scope.turn/turnIndex（无scope则明确null）、原measurement fingerprint、actualModel及其hash。它覆盖无原生scope、未入原生索引和超过10k索引上限的数字，不以nativeSteps作为唯一后备。估值先读已提交current projection，按其选中的modelRevision与modelRef读取对应持久证据，逐项核meter/capture/turn和原修订；模型冲突、invalid-final或下降时不能把当前页被拒的模型套在保留的旧Token上。此前页已ACK也不删除这些证据；与usageEvidence同保留边界，在消费者修订仍可引用期间必须存在。nativeSteps.modelEvidence只可补充证明，并须同一原owner capture及所选modelRevision。每页估值去重使用完整meter身份，不按recordId单独建Map；原生repair补算同样读取所选原模型证据和原CNY受理。缺证据不把已知模型猜成null或覆盖既有估值，而保持待修订诊断；实际modelRef本来为null才记未定价。两个turn复用recordId/revision但provider/model不同不能互借，迟到模型只按原capture精化，不以配置模型补齐。不调用现有弱定位Session.measurement(key,recordId,revision)。估值始终调用原 owner identity 的首次 acceptedAt/priceBookRevision，涨价后10→15补差沿用原价，空目录不补套新价。


来源状态继续复用native_captures私有JSON；普通数字的已选模型证据另外落observability私表development_model_evidence（完整meter/revision唯一键、非敏感白名单model与原页定位/fingerprint），随usage evidence/page/cursor同事务写入。同key/revision不同证据必须冲突回滚；它不保存第二份Token、价格或启动材料。新增迁移与锁只登记自有文件，不扫入或改写并行资源迁移。正常数字证据不会先提交而缺这份原模型凭据；重试可直接定位此前已ACK页，不依赖Session当前offered页或原生10k索引。

## 消费与恢复

限定 reconciliation 使用现有单飞模式和每轮最多20页：next固定页 → getSession原registration并与resolve owner原绑定/选择独立对拍 → 原子ingest → 原价估值及pending repair补算 → acknowledge原key/through。每次重试仍取原页，ACK丢失不重计。数据库/来源/估值网络错误只留下可重试页，不标为永久丢失，不停止模型、不补起Hook或模型。

完整 metadata 与既有 native summary 在同一 usage 快照水位下提交；第一批缺实际来源仅以已有 native-evidence-incomplete 保持部分，不向 business v1/sync 或正式两级 DTO 塞入新字段。细粒度开发来源诊断与公开同快照事实/UI在后续一并接入；公开统计仍只声明 business-tasks。

## 必须验收

| 用例 | 必须结果 |
| --- | --- |
| 同key但Session登记Pod A、owner登记Pod B，以及原选择/namespace/身份/档位错配 | 不提交、不ACK、不泄露启动材料；当前hello不能提升旧intent |
| 首次库 pending → finish observed | 数字先保留；仅有持久begin+finish才认定该库，本轮完整性如实 |
| resume缺begin、finish自造begin、跨轮/计划摘要变更 | 保留待处理或明确冲突；无历史修订/完整零 |
| 相同ID的a.db/b.db及DB/sidecar一起复制 | 不同分区，旧owner/原价和已接受修订不被新库撤销 |
| 同库10→15先报partial/native-prior-revision-gap | sourceVerified先建立真实分区，找到原owner后修订，完整性不互相等待 |
| 两turn复用相同recordId/revision但模型不同；原模型晚到 | 原capture/turn/turnIndex及modelRevision精确定位，未定位不定价，不用配置补齐 |
| 同Pod同库健康重启，旧步骤10→15，后续涨价 | 归属原执行、原CNY受理；新增步骤仅归新请求；无二次加法 |
| 另一Pod声明相同store摘要 | 第一批不跨Pod归属；不能假称workspace来源 |
| begin/measurement/baseline/finish跨多固定页、finish迟到 | 每页原子持久；来源到齐后重核既有证据，重放零增量 |
| 页1 rev1/M/10已ACK，页2同meter rev2/N被模型冲突或invalid-final拒绝 | 读当前选中的rev1/M持久证据，按原价保留10的估值并完成页2ACK，不用N、不降null、不等永远不会出现的当前页rev1 |
| 无原生scope/超10k索引后同样的旧模型选中 | 普通数字模型证据仍存在，估值不依赖nativeSteps；同recordId的不同完整meter互不去重 |
| 同水位不同内容、来源事务故障、估值失败、ACK丢失 | 该阶段回滚/重试，不越过来源cursor或固定页ACK |
| unsupported开始/结束、unavailable/changed、缺模型 | 普通数值可保留，质量明确部分/未知；实际模型缺失CNY未定价 |
| business和未选择开发旧JSON/receipt | 原严格接受面/业务数字及冻结语义不被扩展；无能力自动启用 |
| 第10,000/10,001个不同原生步骤及重复/模型补全 | 数字与游标仍提交；超限只降级归属索引/完整性，不少记Token，不扩大有界键转换 |
| 快照建立后迟到来源/修订与费用撤回 | 固定快照不被改写，新快照见修订；撤回后无费用泄漏 |

先完成独立设计门，再写纯状态/键分区回归，真实 PG ledger/outbox、原价与 consumer 跨模块回归；保留原开发10→15/涨价/零目录数值断言，只为新选择路径补真实来源证据。接着限定实现门、相关检查及精确SHA hosted CI。共享资源在制品原样保留，完整本机check的并行阻断按既有规则如实记录。生产仍 OFF；owner派发/删除排空、CLI/平台算力采集、完整权限与两级事实/UI未完成前不启用，实际身份/模型验收仍待授权。


## 限定设计门 v1 与 v2 接续

v1独立只读设计门FAIL，三项P2全部保留记录：实际来源验证与完整数字proof互相等待；Session模型读取缺turn定位；来源页不含Pod/完整归属，不能与owner独立核对。v2按上述三项补正sourceVerified/captureComplete、精确原页及持久模型证据、Session.getDevelopmentUsage独立registration，并将stream cursor与每turn数字/capture来源分开。v2重新冻结和复核后才能开始代码；此记录不是实现PASS，不关闭生产OFF或CS-R02。


v2独立门仍FAIL：前三项P2已关闭，但仅取当前页模型不能给投影拒绝新模型后保留的旧数字定价。v3新增所有普通数字的私有持久模型证据、先读current所选modelRevision/modelRef、全meter估值去重，以及此前已ACK/无原生scope/超10k的反例。当时v3尚待重新复核；后续PASS回执见下节。未开始实现，生产继续OFF。


### v3 独立限定设计门回执

v3独立只读设计门PASS，首尾冻结hash一致，原四项P2全部关闭、没有新功能阻断。来源验证/数字完整性解耦，Session独立registration对拍，原turn与完整meter分离，普通数字所选模型证据随页/游标原子保存并覆盖此前ACK/无scope/超原生索引预算等反例。复核未改写文件、运行测试或调用集群；这是设计PASS，尚未开始消费实现，不启用生产、不关闭CS-R02或整个RFC。

前一发布回执文档b643e53196e2eea0d61a6160df7f543263c5a561的[CI 36685062165](https://github.com/wangbinquan/CrewStation/actions/runs/36685062165) 已终态success；它只记录已部署d01ba8223，不改变本机源码镜像。新设计的精确提交/CI另记，共享STATE/RFC索引仍留在工作树、并行资源改动完整保留。

## 原选择接口实现候选（2026-09-30）

第1项限定四路径实现门PASS：dev-session.resolve继续只接受精确原key；在原持久intent选择nativeSource时返回非敏感nativeSelection.version/expectedNamespace，未选择的legacy完整省略该字段。registration/首次人民币受理不变，不读取当前workspace、hello或价目配置；API与port各自独立类型同步，不返回prompt、digestNonce、launch或MCP启动材料。生产wiring、Session来源、账本和UI未变，这不是完整消费者完成。

真实PG回归先10pass/1fail，唯一失败为旧resolve缺nativeSelection；实现后11pass/0fail、96断言。新增覆盖关闭后重读、价目变化及丢失当前环境时仍取原选择，原选择/namespace替换冲突、精确原key、旧返回形状和启动材料不外泄；所有旧数值/人民币断言保留。四文件eslint与diff-check成功，冻结源码hash首尾匹配。

该候选仅启动一次本机完整check，arch阶段被并行工作阻断：data/application和data/ports各超目录上限，console拓扑两文件环，以及project/api-catalog/resource-access/agent-runtime/data/gateway/runtime-environment七份未入锁迁移，共10项；没有进入lint/type/test阶段，不能写作完整本机通过。均不在这四个源码文件内，按development-rules §3保留并行内容，限定文件检查有效，最终整仓判断交精确提交的clean hosted CI。未重跑全量、未补锁/修正他人资源或拓扑文件。

下一批仍须Session独立registration对拍、固定页/完整meter归属、实际文件分区、所有数字的持久所选模型证据及原子cursor/估值/ACK；原owner派发/清理屏障、两级事实/UI及真实运行验收继续。生产采集OFF、sourceScope business-tasks；本机仍为已验证d01ba8223，源码候选发布/CI与后续部署单独回执。

## 2026-09-30 原选择接口测试字面量类型补正

接口提交`54243196a23f8a5f65a5ca2ea5e6820e615dbc09`的[CI36692696016](https://github.com/wangbinquan/CrewStation/actions/runs/36692696016)终态failure：unit/module/console/e2e四项success；干净树arch/lint成功，static类型和gate失败。两个TS2769都在新回归的同一预期对象：nativeSelection.version被推断成number，严格接口要求字面量1。本批只给测试预期version加as const，保持全部原key/关闭后重读/原价/选择/隐私断言；三份生产文件字节未变、此前限定实现门仍适用，不把接口或合同放宽为number。

修正后真实PG同一11项/96断言全部成功，改单文件eslint成功。单独类型检查核对自有错误，精确新提交/六项托管CI另记；没有重复启动已被并行架构在制品阻断的全量check。失败版本未部署，本机仍为d01ba8223；只有新精确提交六项CI全部成功后才能部署。完整消费者/原owner清理/两级事实与真实运行尚未关闭，生产开发仍OFF。AW最新7886ac97b的CI36691067775也已50项全部成功，源码edd56ebe3的主CI与九种原默认定时配置10运行/75作业完整成功回执继续有效。

## 原选择接口精确发布、CI与本机部署回执（2026-09-30）

限定原选择接口/测试类型补正源码 `1d48fb1703744acfc06841e3a34e8f742e8c98bd` 已推送；[精确CI36694912441](https://github.com/wangbinquan/CrewStation/actions/runs/36694912441)已六项全部success：static、unit、module、console、e2e、gate。此前54243196的类型失败、单行as const修正与11项真实PG/96断言、文件lint及单独完整typecheck成功记录保留；三份生产文件内容未因测试类型补正改变。限定原选择接口实现门PASS不扩大为完整consumer PASS。

本机于2026-09-30T09:29:13.385Z完成该源码部署。迁移job `rfc034-consumer-owner-selection-types-migrate-1d48fb17` Complete=True，日志applied=0；原owner与Session数字表存在。八Deployment均generation=observedGeneration、Ready=1，storage-contract=1；默认Runner和三幅镜像OCI revision均严格指向同一完整源码SHA：

| 组件 | generation / observed | Ready |
| --- | --- | --- |
| console | 205 / 205 | 1 |
| cs-api | 199 / 199 | 1 |
| cs-auth | 97 / 97 | 1 |
| cs-controller | 164 / 164 | 1 |
| cs-events | 67 / 67 | 1 |
| cs-session | 116 / 116 | 1 |
| mcp-capabilities | 63 / 63 | 1 |
| mcp-operations | 63 / 63 | 1 |

| 镜像 | 不可变摘要 |
| --- | --- |
| cs-console:dev | `sha256:003194963bc8d1dab45df2384cdcadb03110a1385f034b33f59e52017551dbc3` |
| cs-control-plane:dev | `sha256:5fb9f79845e7b47bfea4e57ae1a817a21b87a00a664021bc867e36236641d026` |
| cs-task-runtime:dev | `sha256:91b61a26f0e573afa78dbdbccbea62d40c4eac3135e85a5d9cc93d31c4f2391f` |

默认Runner：`registry.crewstation-system.svc.cluster.local:5000/crewstation/task-runtime@sha256:91b61a26f0e573afa78dbdbccbea62d40c4eac3135e85a5d9cc93d31c4f2391f`。公开匿名路由核对：`/auth/login` HTTP200、`/` HTTP401符合现有forward-auth合同；没有切换真实身份、调用模型或创建/停止业务验证会话。构建使用git archive的该精确提交，未混入并行资源/拓扑工作；部署前验证原d01组件和默认镜像未变、更新时使用resourceVersion CAS。

生产开发采集仍OFF，sourceScope仍business-tasks；仅原选择接口底座已部署，Session独立registration对拍、按turn固定页/真实文件分区、全部数字所选模型证据的同事务持久、原价修订/ACK、owner派发/完整清理屏障与两级事实/UI继续。CS-R02与两个RFC不关闭。该回执后继只写三份观测文档，不改变已部署源码；后继文档精确CI另外验证，共享STATE/RFC索引与并行输出完整保留。
