# RFC-034 开发来源与项目、系统消耗明细

状态：35路径实现候选独立完整复核PASS；其中34个独立源码/测试及本RFC三文档已精确发布为 `50dbd7a7464bbdd7ca304eb82dc2c47146f068fa`，[CI 36812019676](https://github.com/wangbinquan/CrewStation/actions/runs/36812019676)六项成功，并于2026-10-01T04:03:20.895Z完成本机八服务升级。共享platform装配仍原样暂留，依赖并行RFC-037代码发布；开发事实/consumer正式装配未接通。生产开发producer及全入口清理OFF，未绑定和通用回收入口未完成。

## 要解决的实际问题

本批实现前，RuntimeStatistics 合同的 sourceScope 仅为 business-tasks，统计账本读取使用业务 identity/capture schema。本批已发布合同和查询实现支持 project-executions 与开发完整身份；每个开发数字记录的 taskId 实际是父工作区，明细读取据此再核对真实独立 execution/Agent/generation。内部 consumer 已能核原 Session registration、owner 原受理/人民币目录、实际原生来源并将数值和估值持久落账；当前已提交与部署的组合根仍只注入 readBusinessObservationFacts，开发事实与数值来源尚待共享装配发布。

用户需在同一个项目中看到业务任务、开发 Agent 分别用了哪个算力、各消耗多少，并能进入具体执行；系统页能按项目和用途对账。不能由页面增加几行模拟值宣告采集已完成。

## 身份、时间与版本合同

1. 保留业务任务事实、任务/subtask/execution/generation身份及现有v1/v2业务服务观测合同。RuntimeTaskFact 新增可选严格source描述；省略表示旧业务事实。开发source.kind=development-agent，identity保存原DevelopmentAgentIdentity（父工作区taskId、真实agentId、独立executionId和generation=1），workspaceName可空。开发行id是独立executionId，protocol明确为development；不制造business task/subtask，也不把agentId重命名为subtaskId。
2. 领域identity选择器严格核开发行project/id/唯一Agent尝试及profile修订、原workspace归属；业务分支继续核真实subtask。跨项目同trace、同父工作区多个Agent或不同算力不串账。一条叶记录只进入一个对象/尝试的指标。错误拥有者事实或两来源对象ID冲突拒绝查询，不返回可误加的总数。
3. 开发按owner冻结price.acceptedAt进入started cohort，不能按父工作区创建时间筛选。acceptedAt只表示受理；AgentStart dispatchedAt/endedAt和closeReason都是逻辑/观测事实，不补作实际活动开始、退出或模型耗时。没有独立时间证明的attempt startedAt/endedAt保持null，duration和关键路径不伪造；页面显示明确的活动时间未采集。
4. sourceScope增量支持project-executions；旧business-tasks仍合法。查询增加sourceKind=business-task或development-agent可选范围；URL、详情返回和缓存键保存该范围。sources分组给出各用途对象数、四桶/人民币/质量及采集状态，业务组和开发组不能以不同时间样本凑同一总数。开发生产OFF明确显示production-disabled；CLI和算力测试尚不支持，不伪造空零或完成状态。
5. 开发attempt/nativeCaptures采用既有UsageObservation/UsageNativeCapture联合身份与BigInt字符串数值；业务服务专用响应schema不改。模型分布仅从实际modelRef/原生证据归因，配置model不进入实际模型指标。

## 拥有者事实与同一快照

Dev-session新增readDevelopmentObservationFacts(Executor, RuntimeFactQuery)，由模块根导出。只查询自己的development_agent_usage和agent_starts；按项目、独立executionId或acceptedAt SQL过滤后有界读取201条，返回最多200条及partial。安全列选择不取prompt、cwd、环境、launch材料、nonce、凭据或完整prepared blob；只读原identity、受理时刻、profile修订、context.serviceId/traceId、逻辑state/close与已受理computeName。必须核AgentStart的原workspace/Agent/execution/profile与owner一致，不把错误记录包装成未知却仍计费。

开发行的受理档位名优先用AgentStart固定computeName；当前目录只是显示元数据，不能改变原id/revision/价格。父工作区名缺失明确未知，仍显示稳定工作区ID。既有项目名来自公开项目目录。没有已准备数字owner的旧执行不补历史数字零；其旧CLI/开发入口仍由既有名册展示，来源能力提示解释当前覆盖。

Platform新增结构端口与runtimeFactSources组合器，经两模块根导出的查询将同一个Executor传给两个拥有者。来源筛选在SQL/调用前，不能先截200再过滤。合并后按accepted/created时间与稳定ID有界取200；任何拥有者或合并截断都显式partial。独立详情不因200概览上限不可读。固定快照仍由observability一次repeatable-read事务读取拥有者事实、usage/valuation/captures与费用策略；显示目录在锁外，名称查询失败不虚构名称。

账本键开发使用原projectId+source.identity.taskId（父工作区），业务仍用真实taskId；读取后按完整identity筛出被选开发execution/generation/agent，不能让该工作区其他执行消耗造成identity-unmatched或扩大本行金额。重复workspace键先去重，页预算不因多个Agent重复读取账本。四桶和费用分组复用同一canonical选择/估值修订，不新建计费表。

## 数字消费的生产接线边界

使用现有developmentObservationSource(owner, Session)在platform装配developmentUsageSource；每页仍先核Session独立登记、owner原价格及actual namespace，再持久数字/模型和估值后source ACK。只启动已有Session副本的公平消费，不创建Agent、不派发模型、不变更Pod、旧Runner、价格或清理。consumer OFF/失败/金额尚未完成时页面保留未知/partial；绝不回退当前价目表。

Observability worker需支持仅开发来源的显式装配，不以usageSource业务参数存在作为开发worker启动条件；两个来源都有时各自有界轮转且不因一个异常饿死另一来源。旧业务消费者与停止行为保持。

modules/platform/wiring.ts目前有其他会话在制的RFC037 gateway/删除装配；仅追加本批事实与consumer glue，原输出完整保留。发布前确认其所有依赖已正常提交且提交树可编译；未齐备时不提交/剥离该文件或制造clean tree。可继续独立开发和定向检查；短Git临界区按用户共享主干规则执行。

## 两级正式页面

项目/系统页增加直接可见的用途切换和用途消耗分组；全部、业务任务、开发Agent不收进更多筛选。source卡显示各组对象数、已知四桶/总Token、人民币和采集质量/production-disabled说明；点击进入同一URL保存的source范围。概览总量、项目/算力/Agent贡献和柱图来自同一被选样本。混合模式的数量标签明确任务/开发执行，避免把开发对象算成业务完成率样本。业务完成时间分布继续只统计业务完整样本，开发未知活动不进入分位数。

任务/执行列表、算力贡献Dialog和独立详情都显示用途、项目名、原算力名/修订；开发详情显示真实独立执行与父工作区名字/ID。全部Token数保持字符串精确，不转Number；人民币沿用现有价格入口。详情使用共享Dialog或独立路由，关闭/返回保留source、时间、筛选、滚动和触发焦点。组件用共享Stack/Card/ActionRow和既有间距；中英文、明暗/窄屏及键盘同时验证。不增加CSV、关注任务卡片、顶部工作流输入。

## 需要的验证

| 层次 | 真实数据与负例 |
| --- | --- |
| Dev owner事实 | 真实PG prepare/frozen price与AgentStart；旧父工作区/今日受理、取消/失败、错项目、错Agent/profile、跨界/201条、私密字段不出DTO |
| 身份/指标 | 两开发Agent同workspace不同/同算力、业务与开发同trace、同源多模型/父子覆盖、BigInt、无数字未知、实际模型缺失及不跨代 |
| consumer/快照 | 实际Session PG数字页、原owner/价格、观测ledger和CNY；重放/丢ACK/估值失败/Session重建不重加；同Executor、源范围与有界合并 |
| 两级权限 | 管理员系统可见；管理员进入项目仍用项目费用策略，隐藏/撤回/非成员/其他项目不泄漏金额；保留固定快照语义，任何新的费用可见性行为另需设计 |
| 正式UI | 真实接口形状夹具及hosted实际页面；source URL来回、清除、最后一行Dialog、准确贡献/柱数字、范围内搜索、production OFF/未知、名称缺失、390/768/1440及双语 |

相关定向检查和独立实现复核完成后，只跑稳定候选一次完整本机gate。精确SHA六项CI、镜像构建、本机升级和匿名检查分别记回执。真实身份/模型和实际CS→AW联动仍按既有授权边界，不能用夹具关闭CS-R13或AW-R02。

## 精确候选路径

设计通过前不修改源码。下面列本批候选；implementation若需新增路径、额外身份/生命周期权限或改变费用快照行为，先修订设计并独立复核。观测cleanup部署回执三文档与本设计文档随自有文档记录；共享STATE/RFC索引不收编。

- `packages/contracts/api/observability/runtimeStatistics.ts`
- `packages/contracts/api/observability/runtimeStatistics.test.ts`
- `modules/dev-session/adapters/persistence/developmentObservationFacts.ts`（新增）
- `modules/dev-session/tests/developmentObservationFacts.test.ts`（新增）
- `modules/dev-session/wiring.ts`
- `modules/dev-session/index.ts`
- `modules/observability/domain/runtimeIdentity.ts`（新增）
- `modules/observability/domain/runtimeIdentity.test.ts`（新增）
- `modules/observability/ports/usageLedger.ts`
- `modules/observability/domain/tokenUsage.ts`
- `modules/observability/domain/cnyPricing.ts`
- `modules/observability/application/executionObservations.ts`
- `modules/observability/adapters/persistence/drizzleUsageLedger.ts`
- `modules/observability/wiring.ts`
- `modules/observability/tests/developmentStatistics.test.ts`（新增）
- `modules/observability/tests/developmentStatisticsFixture.ts`（新增）
- `modules/platform/application/runtimeFactSources.ts`（新增）
- `modules/platform/ports/runtimeFactSources.ts`（新增）
- `modules/platform/tests/runtimeFactSources.test.ts`（新增）
- `modules/platform/wiring.ts`
- `tests/e2e/developmentStatistics.test.ts`（新增）
- `tests/e2e/developmentStatisticsFixture.ts`（新增）
- `apps/console/src/features/observability/model/runtimeSearch.ts`
- `apps/console/src/features/observability/pages/RuntimeStatisticsPage.tsx`
- `apps/console/src/features/observability/components/RuntimeAnalysis.tsx`
- `apps/console/src/features/observability/components/RuntimeTaskView.tsx`
- `apps/console/src/features/observability/components/RuntimeSources.tsx`（新增）
- `apps/console/src/features/observability/components/RuntimeMetrics.tsx`
- `apps/console/src/features/observability/i18n/zh-CN.ts`
- `apps/console/src/features/observability/i18n/en-US.ts`
- `apps/console/src/tests/runtimeSourceStatistics.test.tsx`（新增）
- `apps/console/src/tests/runtimeSourceStatisticsFixture.ts`（新增）


## v2 实施配套与源预算（2026-10-01）

v1独立设计复核FAIL，一项P2：现有RuntimeTimeline.tsx的NativeCaptureSummary仍接受业务RuntimeNativeCapture[]，无法在原32条路径内接受开发联合identity。本修订在上述清单明确再纳入下列三条现有文件，总候选35条源码/测试。v1失败回执保留，不计实现或设计通过。

- `apps/console/src/features/observability/components/RuntimeTimeline.tsx`：纯展示summary接受既有UsageNativeCapture，不能把开发identity强转成业务identity或补假subtaskId；详情仍用统一Dialog。全部区间均未知时，累计/并集显示未知而非把空区间数组的0解释成已知活动零。
- `apps/console/src/features/observability/hooks/useRuntimeListReturn.ts`：runtimeReturnKey加入sourceKind，避免不同来源筛选复用滚动/焦点；API缓存键、URL和详情back同时保留sourceKind。
- `apps/console/src/features/observability/model/runtimeFormat.ts`：集中给开发执行显示双语用途及已受理computeName，缺固定名时可显示当前目录名作为元数据，不显示假Agent人名或借prompt命名；各列表/贡献/详情采用同一函数。

具体安全列：Dev owner查询只投影原identity、profileId/revision/protocol、price.acceptedAt、context.serviceId/traceId、binding有无、closeReason、AgentStart computeName/profile/workspace/execution/agent与逻辑状态；不SELECT完整prepared/request/execution JSON后删字段。每条事实核owner与AgentStart同原项目/工作区/Agent/执行/算力修订。没有独立时间来源的开发closedAt/attempt.startedAt/endedAt与wallMs/durationMs保持null；逻辑关闭只供状态展示，开发样本不进入业务完成耗时分布。

当前Task公开EnvironmentDto未公开labels/工作区名字，本批不扩大Task API或联查它的私表来补名；workspaceName=null时正式详情明确未知并显示稳定父工作区ID。受理computeName非空时必须优先于当前目录；目录删除也不能抹掉原名字和修订。混合Agent汇总键区分业务/开发命名空间，算力贡献可以按同一profile修订汇总但保留逐对象用途和精确贡献；旧业务key保持兼容。

SQL账本选择必须在记录/捕获预算前隔离已选开发execution、generation、sourceKind和project/workspace；同父工作区其他执行不消耗本次预算，也不产生本行identity-unmatched。加载后仍核完整agent/attempt归属，错身份不计金额或Token。业务分支保留当前匹配与未知质量。workspace账本键去重后只查一次，不能按父工作区对每个Agent重复读取并加总。

sourceKind范围在组合器调用/各owner SQL限额前应用；overview合并最多200对象且任一源/合并截断显式partial，detail按真实独立执行ID读取不受概览上限。页面sources与profiles/projects/agents/tasks/trend全部从同一已筛选对象集生成，来源组数字不能来自另一个快照。producer未开启时sources明确production-disabled；这只表明实际采集状态，不能阻断已有PG数字证据的幂等消费，不能把状态改为已知零。

不改变当前费用策略固定快照行为或现有业务服务v1/v2观测形状；费用安全负测必须覆盖项目隐藏/撤回后的后续读取与管理员项目视角。若需要更改快照撤回合同、添加Task名字API或扩大生命周期权限，另修订设计并独立复核，不在实现中临时扩大35条清单。


## 2026-10-01 实现复核、完整检查与页面验证

- 两项独立P2均已修复：没有已知证据的四桶显示未知，原生证明的零保持零；同一快照的每个对象提供acceptedProfiles，列表直接显示所有原算力名称和修订，业务任务的多个档位不合并成一个全局档位。合并预算保留独立开发尝试、总计最多2000，业务裁剪显式partial；类型夹具使用完整严格事实，业务详情标注实际任务ID。
- 独立完整实现复核v2 PASS，35源码、1文档、37参考和2证据首尾指纹一致，回执SHA256 `125f040a7c33c7e307be5a2d2119661f90b23bb1ed71900efade1e14dcf7007e`。真实隔离PG/临时SQLite/HTTP形状定向55pass/0fail、402断言、10文件；四项结构/lint/后端类型/工作台类型均成功。
- 同源码唯一完整检查于2026-10-01T03:22:44.569322Z结束，1146.12秒，4789pass/143skip/1fail、31738断言、954文件；35源码首尾指纹一致。唯一失败是运行中新增的并行data-control/api/moduleApi.ts和index.ts从ports导出类型的两处结构违规，完整aggregate=1保留。原作者随后将类型放回api层，定向结构守卫29pass/0fail、43断言；没有修改其文件，也没有重复完整门禁。
- 使用候选正式Vite页面、隔离Chrome及严格只读HTTP夹具验证两级24组合：1440/768/390px、中英文、明暗主题，source与trend卡片间距均为标准12px，文档/内容区横向溢出为0；24个柱保留精确大整数Token，时间范围对齐，未出现CSV/更多筛选。48行开发列表末行下钻后恢复5403px原滚动、来源范围和触发焦点；Enter打开原算力贡献Dialog、168Token（24×7）与Esc焦点恢复通过，网络失败为空、无写请求，源码指纹保持。
- 早期浏览器夹具失败保留：v1遗漏Enter字符，v2/v3快速重复页面验证未完整结束；最终v4使用完整页面加载事件、每视图独立上下文和有截止时间的CDP命令后通过。仅夹具改变，未修改产品源码。该证据不代表真实身份、模型采集或CS→AW联合验收；原生产采集仍OFF。
- 34源码批的精确SHA CI与后续共享装配发布、实际镜像部署另记。共享文件包含的并行网关产物及其未追踪依赖保持原样；不会将未提交依赖缺失的装配纳入发布，也不将此批当成CS-R02/03/04/13或RFC整体关闭。

## 2026-10-01 精确发布、CI与本机升级

- 精确发布：`50dbd7a7464bbdd7ca304eb82dc2c47146f068fa`，34个独立源码/测试加3份自有RFC文档；完整共享platform/wiring.ts及其RFC-037依赖未收编，main/origin发布后0/0，暂存区空。独立发布复核v2 PASS；原完整本机4789pass/143skip/1fail及外部29/0闭环保留，不改记全绿。
- 精确远端：[CI 36812019676](https://github.com/wangbinquan/CrewStation/actions/runs/36812019676)六项全部success，含static/unit/module/console/gate/e2e。该CI验证已提交旧组合根兼容，不表示暂留的新组合已上线。
- 实际部署：2026-10-01T04:03:20.895Z（北京时间2026-10-01 12:03:20.895）八服务Ready=1、generation=observedGeneration；storage-contract=1，数字表存在。控制与console镜像使用该精确源码git archive，未包含共享WIP。
- 控制镜像：`docker.io/library/cs-control-plane@sha256:f358f52646043d3ea24fa06c081f293c5dde3831924507f1e75eacf68b5e0a99`；页面镜像：`docker.io/library/cs-console@sha256:08071878a04026282ad6b27dc68f94527f418c8722126d39d542f973e5d9e11d`。Runner代码未变，实际默认值保留`registry.crewstation-system.svc.cluster.local:5000/crewstation/task-runtime@sha256:587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928`，源版本仍2fb06f38；没有替换现有Task环境。
- 数据库：升级前0600私有备份43029911字节，SHA256 `c65b4a76c0bb978805964820dd032a9b2a567e8ead71c92578ad86ccc8270b31`；实际迁移Job UID `5819c27c-19d7-403f-af5e-89452446cb38`，Complete、applied=0、roles.initialized=0。
- 匿名检查：2026-10-01T04:04:26.407775+00:00，console.cs.localhost/auth/login为200，未登录根为401，八服务实际镜像与保留Runner值对拍。正式候选24组合几何和system 48行返回/键盘证据仍为只读HTTP形状夹具；没有真实身份/模型或CS→AW联动验收。
- 继续：[通用删除与未绑定屏障草案](./development-removal-barriers.md)仅经草案复核，未冻结实现allowlist。共享事实/consumer装配及生产producer仍OFF，CS-R02/03/04/13和完整RFC保持开放。
