# RFC-034 开发采集的通用删除与未绑定退出屏障

状态：原准入回执第一片已发布部署；通用删除第二片实施 v2 / 测试修订 v3 独立 PASS，规范完整 `bun run check` 4,956 pass / 143 环境 skip / 0 fail，33,168 断言，候选与参考指纹稳定。原规范 v2 的 2 fail 保留，修订后新候选单次 gate 通过；已精确发布 c6860345，自身远端 CI 六项成功并于 2026-10-01T19:37:47.267Z 完成本机八组件升级。父操作、未绑定、全部 writer 封口、未知回执与真实开发采集仍待，生产 producer OFF；不关闭 CS-R02 或整体 RFC。

## 必须解决的问题

下表保留设计起点的入口盘点；通用 remove / Controller finalizer 第二片的当前实现与检查见 [实际守卫记录](./development-generic-removal.md)，其他入口仍按各自屏障推进。

Token 数值保存在执行容器内的独立日志中。取消或清理不能先删除唯一可读副本，再把无数据记成零。正常数字出口、显式缺口与物理停止是三类独立证据。

| 当前入口 | 现有事实与缺口 | 下一阶段约束 |
| --- | --- | --- |
| [原绑定 Task 清理](../../../modules/task-runtime/application/development/cleanup.ts) | 已持久原数字许可，真实 job fence 内两次确认；Session/Kubernetes I/O 在项目锁外 | 保留现有成功路径与原价/原身份，不拿它覆盖未绑定 |
| [通用删除](../../../modules/cluster-control/adapters/k8s/managedObjects.ts) | `remove` 带 UID 条件；尚无数字 owner 许可核对 | Pod/Runner Secret/准入 Secret 的实际 UID 与明确选择分别核对，缺数字许可等待 |
| [调和删除](../../../modules/cluster-control/application/reconcileObservations.ts) | Failed、Paused、absent 等分支调用同一删除能力 | 未排空不增加 removed 统计，不把等待写成删除成功 |
| [孤儿回收](../../../modules/cluster-control/application/orphanSweep.ts) | 按年龄、台账认领和旧任务状态判定 | 台账缺失、旧缓存及逻辑终态均不是数字清理许可；单个等待不饿死其他对象 |
| [保留期](../../../modules/resources/application/maintenance.ts) | 到期直接更新 desired=absent；结束记录随后可能压缩 | owner 在资源事务外持久请求结束；等待期间保持原物理期望及 owner 记录 |
| [父环境重建](../../../modules/task-runtime/application/requestRebuild.ts) | 管理员重启先调度 child 清理，但随后立即更换父 Runner/Pod/render | 固定 child 集合闭合之前保持父材料与工作卷；重建不能只等待逻辑 child 终态 |
| [未绑定 owner](../../../modules/dev-session/application/development/cleanup.ts) | 原 owner 无 binding 返回 waiting | 独立新出口；不虚构 Session receipt、binding、closure 或已知零 |
| [命令派发](../../../modules/session/application/commandDispatch.ts) | 当前 startAgent 屏障不承诺 exec/CLI 等所有入口 | 如证明从未启动，必须覆盖选中执行所有可创建 writer 的路径；没有证明则保留未知 |
| [物理准入](../../../modules/resources/api/workloadSafety.ts) | closed admission/no permit 有持久 no-writer tombstone；不能冒充 Pod 停止 proof | 与原选择、实际 job 和容器布局对拍；有 permit 必须走独立容器停止 |
| [namespace 退出](../../../modules/cluster-control/adapters/k8s/namespaceRetirement.ts) | 完整发现和 UID CAS 已存在 | 资源为空不能代替 owner/writer seal；项目删除参与者由 RFC-037 承接 |

## 证据与边界

每个原执行固定项目、父工作区、Agent、真实 execution ID/generation、算力修订、CNY 受理、consumer、renderStart、原 Pod/PVC/Node 与凭据 UID。当前绑定清理的准入 Secret 只核原四元许可及当次读取 UID，不能据此声称历史 UID 已保存。下一阶段先在新受理/实际创建回执中持久原准入 Secret UID；缺历史 UID 的旧记录继续按原批准路径，不能回填一个看起来相同的 UID。

数字证明与物理证明分开。正常完整和原已知 N/M 中断路径保留现有先数字出口、后 Pod 删除意图的顺序。整个日志头未知的路径另分两阶段：先持久保全原归属/原价、已知且实际已复制的前缀、明确不可取回的未知尾部原因，以及覆盖全部 writer/在途受理的 seal；该停止准入前缀只允许对原 Pod 发出停止/删除意图，不是最终数字 closure，也不许可 Secret 删除或额度释放。随后 Controller 持久原全部容器停止 proof，再完成最终未知出口与 owner 闭合，最后才清理凭据和占用。不得用需要该 Pod 删除动作才能产生的 stop proof 反过来阻止唯一停止动作。Controller 仅在自己的独立物理 proof 持久成功后移自己的 finalizer，Task 不移 finalizer。暂时的网络/Session/PG 故障、查询超时或 Session absent 不能充当不可取回证据；能够读取的原页必须先复制。消费估值失败保持 outbox/partial，原数字副本已安全保存时不扣留物理资源。

通用删除 guard 由 cluster-control 的中性端口声明，platform 只以 Task/Dev/Resources 的公开 owner 能力装配。observability 不授权删除，也不读其他 owner 私表。任何具有新明确数字保护选择的对象在端口缺失、格式冲突、owner 查询失败或 UID 替换时等待；业务、CLI 和旧未选开发保持原行为。新选择的识别标记须来自原受理/渲染，不能只靠一个可伪装的 task label 或现有通用 consumer 注解。

不可将 guard 的等待实现成返回成功的 no-op。调和器需要可重试的等待结果；孤儿回收逐对象保留等待原因并继续其他对象。直接管理员删除、Kubernetes rebuild 私有删除以及 native 清理也纳入入口清单，不能只包一层 `ClusterWriter.remove` 就声称全入口完成。

Resources 的到期/压缩过程先在锁外取得单调 owner 状态或请求结束，再在自己的行锁内对拍资源 id/generation/原选择；不得持资源行锁反取项目锁。Task/Dev 最终事务对拍真实 job fencingToken、固定 child 集合和原受理，不在锁内做 Session、定价或 Kubernetes I/O。

## 未绑定与不可取回

| 状态 | 可接受出口 | 不能采用的推论 |
| --- | --- | --- |
| 无 binding，原准入已关闭且从未 grant | 独立证明 Task 原作业与后续创建受理已封闭、选中实际 init/容器布局不能绕过保护、owner/AgentStart 已关闭，才允许相应物理回收；数值仍未知或不支持 | binding=null、Session absent、列表不见 Pod 不能单独证明没有 writer 或 Token=0 |
| 无 binding，但曾发放 permit/曾可执行命令 | 先取得实际原来源副本，或持久可读末尾与明确不可取回缺口，再取原全部容器停止 proof；保持无 binding 的事实 | 不为复用绑定成功分支伪造 registration 或 receipt，不因超时写 loss |
| 已复制 M、原日志头 N 已知 | 复用原显式 interrupted 出口，保留 M/N、缺口、原价和原归属 | 不把 M 当完整 N；不重跑模型来补账 |
| 整个日志头未知 | 先持久原已知数字前缀、实际不可取回原因与全 writer seal，取得仅原 Pod 停止意图准入；独立全部容器停止后才形成最终 unknown-tail 出口。前缀不授权凭据/额度回收 | 不填写 finalThrough=0、空页或从未启动的结果；不要求停止动作前先取得由该动作产生的最终 proof |
| 原 Pod/Node/凭据被替换，或原记录要求持久的历史 UID 缺失 | 等待或明确需处理，保持原记录和占用，不能授权新对象。旧批准准入 Secret 路径没有历史 UID 要求，仍保留原四元许可加当次读取 UID/CAS 的既有规则；不把它升级为历史 UID 证明 | 同名、相同许可内容或超时不是已要求持久的原实例证明；不以新增要求否定旧准入例外 |

全 writer seal 与 Session/Runner 在途命令的边界必须另行冻结：仅在发送前查一次数据库不能排除检查后迟到写入；取消 request/ACK 也不是封闭证明。设计门应明确各入口、持久 seal、在途集合、恢复和真正结束来源。未完成这个证明之前，新 producer 继续 OFF。

## 分批实施与退出条件

1. 原准入 Secret UID 与明确新选择的持久来源：列出 ledger/direct 两路的实际创建者、回执和失败恢复，不改旧 v1 协议的承诺。
2. 通用数字删除许可：中性端口、公开 owner 查询/持久请求、原 UID/CAS、逐对象等待；先覆盖通用 remove、Failed/Paused/absent 与孤儿，保留直接/管理员/rebuild 入口待办。
3. 到期与全部父操作：保留期/压缩、父释放/分支切换/worktree 重建/管理员重启，关闭新 child 受理并冻结真实集合，在所有 child 的数字与物理出口后推进父操作。
4. 未绑定、unknown tail 和全 writer seal：独立版本证据，保持旧绑定成功路径，禁止虚构零。实际 Pod 丢失或替换不自动终结。
5. 完整装配：只在上述全部出口、consumer 和两级事实已通过各自 CI/部署后选择新生产组合；CLI/算力测试仍按自己的能力矩阵独立启用。

每批实现之前读取现行模块原语并冻结精确文件/参考指纹，通过独立设计复核后动源码。当前草案尚不构成任何一批的冻结源码 allowlist；不凭这里的路径链接直接开始跨模块实现。共享 STATE/RFC 索引及 RFC-037 在制品不收编。

回归至少覆盖：数字未复制时所有物理材料保持；原 Pod/Secret UID 替换；无 grant/有 grant 的未绑定分别验证；迟到创建/迟到 Start/exec、seal ACK 丢失与实例重启；真实 job 过期接管；到期与 owner 同时请求结束；child 集合变化；重建期间原父令牌/Pod 保持；单个孤儿等待时其他旧对象仍清理；数字/CNY 消费重复与估值失败；原副本可恢复、M/N 缺口及完全 unknown tail。使用实际 PG/SQLite 和受控 Kubernetes/Runner 传输，夹具不得手写 grant/closure 绕过实际链路。

本草案是 CS-R02 后续依赖的落档，不关闭 CS-R02、真实身份/模型验收或完整 RFC。

## 原准入 Secret 回执第一步的精确设计

[原准入 UID 回执设计](./development-admission-receipts.md)明确 ledger/direct 都由 Controller 在实际准入创建后登记，提出独立新选择和 Resources 持久回执，保留旧批准四元许可/current UID 例外。缺失真实创建回执不得倒填历史 UID；生产 producer 仍 OFF。本批精确源码冻结和独立设计门尚待完成，后续通用删除/父操作/未绑定/全 writer seal 不因此关闭。

### 第一步 v1 失败与 v2 补交边界

第一步 v1 独立 FAIL 的真实 P2 是已知 create UID 在 PG 保存失败后被 closure/ReleasePending 早退跳过。v2 以同 creator 的 128 项有界原回执、成功 CAS 才 ACK、公共 reconcileRecord 在 ledger/关闭判断前的仅补交入口及有限 pending ID resync 覆盖此缺口；不重开准入，不凭同名对象倒填，不冒称跨进程 unknown 回执恢复。v2 独立设计门待验，所有源码仍未改，完整删除/全部 writer seal 与生产 producer OFF 边界保持。共享 migration lock 的并行条目由 owner 保留并准备发布依赖，观测文档继续独立提交。


### 原准入回执第一步 v2 设计门（2026-10-01）

[限定回执设计](./development-admission-receipts.md#v2-独立设计复核与共享前置条件2026-10-01)独立复核 PASS；原 v1 已知 UID 在 PG 失败后被关闭早退跳过的 P2 已在设计层闭合，原 FAIL 保留。共享 migration lock 已由并行 owner 随 `b6999edf` 发布；四份观测设计可独立提交，不收编共享登记或并行源码。43 路径实现、完整验证和部署仍未完成，producer OFF；全部 writer seal、通用删除、未绑定与跨进程 unknown receipt 继续，不能据此关闭 CS-R02。

## 原准入回执第一步已部署的状态补正（2026-10-01）

上文“43 路径尚未实现”属于设计阶段历史。[原准入回执实际发布与部署](./development-admission-receipts.md#原准入回执第一步的实际发布与部署2026-10-01)已核对：42 个源码 / 测试 / 迁移及登记随 `542d9882` 的 70 路径发布，两个独立实现门 PASS、自身六项 CI success、八组件部署完成；后继 `85ee9254` 平台自测投影修复已通过自身 CI / 实机部署，本批 42 文件未变。该步骤不包含本草案的通用删除、全部 writer seal、未绑定或跨进程 unknown receipt，下一实施批仍必须冻结精确 allowlist 并独立设计复核，producer OFF。

## 通用删除第二片的精确候选（2026-10-02）

[通用删除守卫设计](./development-generic-removal.md)已冻结物理名称定向查询、原终态 token hash 的私有 seal、Pod / 两类 Secret 数字及物理条件、通用 remove 与 Controller finalizer 两个实际边界，以及逐对象 waiting / CAS / 测试计划。下一片精确 allowlist 和参考指纹由私有候选清单记录；独立设计门尚待完成，没有本片源码变更。原准入回执第一片完成状态不变，父操作 / namespace / 全 writer seal / 未绑定 / unknown-tail 仍后续，producer OFF。

第二片设计 v1 独立 FAIL 的 marker 兼容 P2 已在 [v2 精确设计](./development-generic-removal.md#v1-设计失败与-v2-修订)限定实际创建渲染并补旧无标记回归；44 路径 v2 冻结待独立设计门，未据此开始源码或宣告通过。

## 2026-10-02 通用删除第二片实现候选

[精确设计](./development-generic-removal.md) v2 已独立 PASS，44 路径内实现只读原物理查询、数字与材料联合校验、原终态 seal 和默认／注入 writer 共同守卫。Failed／Paused／absent、orphan 及 Controller finalizer 的 waiting 均向上传递，既不计回收成功，也不阻塞其他对象。0018 非唯一物理名称索引使用官方生成器单路径登记，旧迁移与并行源码保持。

新增 finalizer 等待和真正 JSON Patch 版本竞争回归均先红后绿，16／0；改后 20／0 的真实 PG 物理查询包含两种创建模式、第一片历史无标记对象、坏选择、原材料冲突、实际压缩后查找和 token 旋转。既有实际 SQLite→Session PG→Dev owner→Task 作业→Controller 全链及新增四种选择组合在初轮全部成功，初轮唯一测试失败为非选择 Secret 的空 UID 夹具，原件保留并修正。原 job lease 接管两条启用新选择后2／0，没有生成终态 seal 或提前释放额度。类型、精确 lint 和无例外架构检查通过；没有把针对性通过冒充完整 check 或生产开发采集。

当前等待独立实现门和单次完整门禁，随后精确发布、CI、本机部署。生产 producer OFF，直接删除／父与 namespace／未绑定／全 writer seal／跨进程未知回执仍未完成，本片不关闭 CS-R02 或完整 RFC。上一批实际业务 24,423 Token／¥0.026922 与 AW 47,524 Token／¥0.096392 的分类核对继续保持，正式数字页面验收尚待当前锁屏解除。

## 2026-10-02 注入实际 writer 的实施复核失败

通用删除第二片实施 v1 独立 FAIL：注入未配置 query 的实际 Kubernetes factory 丢掉外层原许可 RV，旧无 marker 对象存在 UID-only 旁路，新 marker 正向则永久等待。原失败回执保留。修订限定已有 44 路径，使用 adapter 私有且按六元组绑定、调用期间有效的原 query scope，内层重新查原 Task owner并保留 DELETE / finalizer 的同一 RV；[v3 精确设计](./development-generic-removal.md#注入实际-factory-的修订设计-v3)待独立设计门，源码修订尚未开始。一次完整门禁、发布、精确 CI 和本机部署继续待做，生产 producer OFF。

## 2026-10-02 通用删除修订定向验证

注入实际 writer 的精确修订设计 v3 独立 PASS；原实施 v1 FAIL 保留。真实 nested factory 新反例修复前 2 pass / 11 fail，最终 Controller 36 pass / 0 fail、227 断言；真正隔离 PG / SQLite / 原 Task 数字链 23 pass / 0 fail、213 断言，精确 ESLint / 后端 types / arch 无违规。实施 v2 冻结待独立实现门和稳定候选一次规范完整 gate；尚未记发布、CI、本机升级或真实开发采集完成，producer OFF。详见 [修订证据](./development-generic-removal.md#修订设计-v3-与实施-v2-的定向证据)。

## 规范完整门禁 v2 的原始失败及小范围修订设计

实际 `bun run check` 已完整结束：结构、lint、后端与工作台类型通过；4,945 pass / 143 环境 skip / 2 fail，33,097 断言。全部 44 候选路径和 65 参考指纹前后稳定，生产 producer OFF。原失败回执与完整日志保留，不能用定向重跑替代其失败结论。

两个失败文件均与当时已提交 HEAD 相同，没有把它们归因于并行在制品：`projectReconfirmation.test.ts` 的全流程重新确认、全部 owner 清理和删根后重放用例超出默认 5 秒；`referencePanel.test.tsx` 的申请用例在目录读取完成前直接访问 `list().querySelectorAll`，列表为 null。真实删除夹具只装配 Project / Identity / EventBus 与有状态外部替身，不调用本批通用物理 writer；参考面板为真实工作台路由加 fetch 夹具，本片无 console 生产改动。一次定向诊断 7 / 0 和 6 / 0 只是缩小故障条件，原全量 FAIL 保持。

后续仅增加两个精确测试路径，原 44 变为 46：全流程真实 PG 重确认用例采用相邻 `projectDeletion.test.ts` 同类全部 owner 清理的 15 秒单用例时限，保留所有权限、原封闭证明、失效许可、终态和删根重放断言，不修改生产 deadline、不增加 retry / skip。参考面板申请用例等待既有 `listReady()` 的真实列表完成；该用例用可释放的目录读取 gate，确保渲染刚返回时尚无列表，再异步释放，锁定等待而非依赖固定睡眠。旧立即 DOM 读取必须在此 gate 下变红，修复后对原弹窗、取消、侧栏形态、行内不展开断言保持。

独立修订设计通过后改这两个测试；定向红绿及原 guard / PG 全链结果分别留存，再冻结新候选作独立实现复核。因为原规范 gate 已失败且该候选测试内容实际改变，新候选允许一次 `bun run check`；不因 unrelated main 推进重跑，也不删除或改名原 FAIL。发布仍须精确 allowlist / 独立实现 / 成功本机 gate / 自身远端 CI，之后才升级本机。该修订不改变 Task/Controller 产品语义，不关闭 CS-R02、producer 或完整 RFC。

### 测试修订实施与候选 v3

修订设计 v4 独立 PASS，原源码／迁移 41 路径保持实施 v2 指纹。受控目录场景进一步确认：平台 `/business-tasks` 可先显示，申请 `/invoices` 尚未返回，因此 `listReady` 在申请用例必须等待指定目标行，其他用例的默认平台行条件保持。反例不带目标行等待为 5 pass / 1 fail，实际 rowOf(undefined) 变红；补指定等待后两个文件 13 pass / 0 fail、117 断言，精确 ESLint 无输出。最初“目录未就绪意味着列表容器必为 null”的夹具假设被撤销，那个失败和被停止的递归 DOM 输出诊断留存，不作为有效红绿证据。

PG 仅完整重确认清理用例明确 15 秒，与相邻全部 owner 清理预算一致，所有功能断言保持；UI 的读 gate 通过 finally 释放，不增加固定睡眠、retry 或 skip。46 路径候选 v3 将复用已通过的 41 路径独立源审与真实 PG／Controller 回归，只新增复核两个测试与文档证据。原规范 gate v2 仍 FAIL，待新候选独立实现与一次规范 gate，未发布、未部署、producer OFF。

### 新候选规范 gate 与精确发布准备

测试修订的独立实现 v3 PASS；实际规范 `bun run check` 2026-10-01 18:59:53Z 至 19:15:57Z 完整完成，4,956 pass / 143 环境 skip / 0 fail、33,168 断言、5,099 用例／971 文件。结构、lint、后端／工作台类型及完整用例均成功，候选 46 路径与 72 参考的字节前后相同。143 skip 为本机缺少外部实机依赖，不能据此宣称这些路径已实采验收；远端六层自身 CI 仍待。原 4,945／143／2 fail 的规范 v2 和有效页面红例保持原结论。

检查期间其他会话正常提交与本片没有路径交集的数据控制修订，本片源内容和直接依赖未变；依共享候选验证规则复用本次成功门，不因为新 main 再跑全量。发布候选只包含 46 allowlist 中 44 个实际改动文件，三个文档在成功 gate 后只补当前证据；不收编并行 Data 或 RFC-036 架构设计输出。生产 producer OFF，父生命周期／全 writer seal／未绑定／unknown-tail／开发实采均不在这一步的完成声明中。

## 通用删除候选的精确发布、CI 与本机部署（2026-10-02）

第二片源码及两项实际门禁修订已精确发布为 `c68603457dc6ccc24b6ef8a023daf6b4e735d944`；44 个改动路径与审查 allowlist 一致，提交与远端相同，索引为空。原规范 gate v2 的 2 fail 与无效 fixture 尝试仍保留；修订源码 v3 的一次完整 `bun run check` 为 4,956 pass / 143 环境 skip / 0 fail、33,168 断言，候选与参考字节一致，未重复运行相同候选。

[自身精确 CI 36913569021](https://github.com/wangbinquan/CrewStation/actions/runs/36913569021) 已 completed/success，static、unit、module、console、实际 E2E 和汇总 gate 六项全部 success。构建只通过该提交的 Git archive 输入两张平台镜像，未包含共享 RFC-036 在制文件，也未重建或切换当前 Runner。

本机于 `2026-10-01T19:37:47.267Z` 完成迁移及八组件升级。`task_runtime/0018_physical_environment_lookup.sql` 实际应用一次；storage-contract=1，业务/开发数值表均存在。console、cs-api、cs-auth、cs-controller、cs-events、cs-session、mcp-capabilities、mcp-operations 均 generation=observedGeneration、Ready=1，镜像与本次冻结目标一致。部署前后默认 Task Runner 仍为 `sha256:587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928`；生产开发采集 OFF，原会话及专用验证档位未替换。

私有完整回执：`observability-cs-generic-removal-ci-receipt.json`、`observability-cs-generic-removal-deployment-receipt.json`。部署只证明本片已在本机生效，不代替实际父重建/保留期/全部 writer、未绑定/未知尾部或真实开发模型验收。实际统计页面的复验仍待浏览器会话可用；新内置浏览器请求正常进入登录页，未擅自切换角色。CS-R02、CS-R13 和整体 RFC 均保持未完成。
