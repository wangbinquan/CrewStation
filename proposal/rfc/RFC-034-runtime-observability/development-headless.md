# RFC-034 开发 Agent 数值链路实施细化

状态：2026-09-30 独立只读功能设计门 PASS；实现与生产采集尚未完成。属于已批准的开发观测范围，不恢复 CSV、额外筛选折叠、预算自动停止或通知。

## 1. 本批闭环

开发 Agent 的受理、数值摄取、结束排空、项目与系统明细一起交付。每条记录按真实执行环境 UUID 下钻，显示父工作区、Agent、受理算力名称及修订、四桶 Token、人民币、采集质量与真实轮次。旧 Runner 保持现有开发流程且显示不支持；CLI 与算力测试必须另行接入，不能因 headless 已支持而整体显示完整。

当前源码的断点：`AgentExecutionLifecycle.observe` 从普通事件判断结束，`tick` 随即释放环境；`AgentSupervisor` 只向内存 replay 推事件；驱动的 usageObserver 同时依赖 businessEvents；平台统计只注入 readBusinessObservationFacts。因此新增 DTO 或读取普通 completed 事件不足以证明开发数值完整。

## 2. 受理与身份

- dev-session 保存实际 projectId、父工作区 taskId、agentId、独立 executionTaskId、executionGeneration=1、受理时刻和固定算力修订。新一次重启有新环境 UUID，不在同一身份下复活。
- 使用已落地的 development-agent 内部身份；不构造 subtaskId，也不扩展 AW 的业务 observations HTTP 合同。
- 创建环境前调用 observability 价格受理端口，冻结人民币目录水位。首次受理与重试一致，价格受理失败不能先启动模型。旧记录缺快照保持未定价，不套当前价格。
- owner 解析只接受真实受理表记录：runtimeTaskId、executionId、代次、agentId、journal incarnation 和启动摘要均对应同一执行。普通事件中的项目/算力名称不参与归属判断。

## 3. Runner 存储与兼容

开发卷现有根目录直接作为 /work 挂给 worker；不迁移其布局，不套用业务卷初始化器。新建独立开发 Agent Pod 的 render 快照选择 developmentUsageStorage v1，增加两个分别独立的磁盘 emptyDir：数字库挂到 /run/crewstation/development-usage，持久归属绑定挂到 /run/crewstation/development-usage-binding；Runner 在两处创建 root 所有的 0700 私有子目录。现有 Pod 和旧 render 不追加验证条件，不重建正在运行的执行。

明确持久边界：本地 journal 跨 Runner/容器重启、Session PostgreSQL 跨 Pod 丢失。emptyDir 不跨 Pod 删除；若 Pod 在提交数值前丢失，已提交贡献保留，余量标记未知/中断。不得把新 Pod 的空日志当成旧执行完成，也不得因观测补偿自动重启模型。Pod UID、持久 marker 和 journal incarnation 绑定；同 Pod 日志/marker 丢失时拒绝声称采集能力，禁止重新造零值。 独立绑定包含版本、Pod UID、项目、父工作区、实际执行 UUID 与 journalId；启动先读绑定，再验证数据库及原本地标记，缺失或替换时不创建新库，也不声明能力。数字库存在而独立绑定缺失同样拒绝。两个独立卷同时完全丢失时，本地不能证明首次运行；是否已有受理必须由 Session/owner 的持久原键判定。

Runner 仅在日志可打开且平台显式请求时提供 developmentUsageV1；不借用 businessExecutionV3 的受理状态或输出。协议版本不升级，新增可选能力和专用 info/read/ack 命令。控制面先查询能力，再向 startAgent 发送带完整数值受理键的可选配置；不向不支持的 Runner 发送新命令。旧 Runner 的 startAgent、sendMessage、cancelAgent 与流式语义保持。

## 4. 数值协议与启动去重

- info 返回受理键、journal incarnation、持久末水位、已确认水位与 running/finished/unknown 状态；未受理与能力不支持分别表示。
- dev-session 首次受理时保存不可变 StartIntent、随机 digestNonce 与 SHA256 启动意图摘要。StartIntent 的版本、项目/父工作区/执行 UUID/代次/Agent、固定算力修订、实际权限、prompt/cwd/resume/systemPrompt 与 MCP 目标名称/URL 构成规范 JSON；prompt 等已有 owner 请求保留在 owner 中，journal 仅存摘要与数字。算力修订固定 launch/启动前模板；重签 MCP 令牌、解密凭据和当次传输材料不进入摘要，不改变同一次受理。
- 首次发送 startAgent 前，owner 必须先持久固定原 journalId、incarnation、payloadDigest、Pod UID 和执行 UUID；之后重连、超时及重试只查询这组原键，禁止从新的无键 info 采用另一组键重新受理同一执行。两卷共同丢失后的新空库无法匹配原键，只登记来源不可用/未知，不再次调用模型。
- 每次派发先按执行键查询 Session/Runner 原 receipt。已有相同意图 receipt 时直接恢复状态/数字游标，不再重签材料、运行 Hook 或创建模型；未知/超时不能当作未受理。只有健康原日志明确未受理时才准备当次材料。Runner 对首次命令核对稳定字段与 StartIntent，reserve 先持久摘要和身份，再调用 ManagedAgentProcess；并发重复由 reserve 返回原 receipt，不第二次 spawn。修改稳定意图必须新执行 UUID，不能借替换凭据改变 launch。旧 incarnation 的历史 active receipt 变 unknown，不能猜测成功或再次 spawn。
- capture 复用 RunnerUsageCapture 数字及原生证明合同，独立 sequence 从 1 连续；不存 prompt、文本输出或模型凭据。真实轮次的成对边界另存为受限枚举数字帧，不用进程驻留时长推算活跃时长。
- SQLite WAL + synchronous FULL；驱动调用独立同步 usageSink，追加先落盘再返回；业务路径保留原 writeProcessed 顺序，开发普通文字不占数值队列、不影响数值水位。
- 每页最多 5 个 capture（每 capture 仍最多 100 条 measurement），总页上限 1 MiB；单事件和总 spool 有硬上限。保留终态/缺口控制帧空间，溢出或写入失败使采集进入 partial/unknown，不能静默丢记录后报告 complete。
- 观测故障不自动重启或结束用户模型：启动前日志不可用按未支持路径显式登记；启动后失败保留已有数值及错误质量，普通执行生命周期继续。若连续水位无法继续，冻结最后可信水位 N，info 通过独立有界控制回执声明 interrupted、原因、受理键/incarnation/Pod UID 和 N；这不是 sequence=N+1 的帧，也不能作为数字 complete 或新的 ACK。Session 在自己的 PG 中持久中断事实及水位，Runner 磁盘失败不妨碍该回执传递。
- 若日志/marker 丢失或 Runner 重启后无法读原状态，Session 按既有 receipt、同一 owner 环境及 Pod UID 绑定中断，可信水位只能取已有 PG persistedThrough；不从新空日志提高水位。身份无法核对时标 source-unavailable，等待重连或 owner 的明确结束/释放事实，禁止声称已排空。数值中断本身不结束正在运行的模型。
- 进程退出后完成原生末次采集，持久 finalThrough，才发出普通终态通知。取消也遵守同一顺序；无法证明末采集时发布 unknown，不发布完整零值。

## 5. 驱动与原生基线

usageObservationsV1 的采集开关与 businessEvents 的业务事件映射分离。只要显式启用数字能力便创建 usageObserver，并在 ManagedAgent 和驱动两层启用有界、可处理确认的数值传递；旧路径仍无新增 usage 事件。

OpenCode 每轮沿用已有实际环境原生数据库适配器：模型创建前持久 begin/baseline，退出后分页读取真实根和子会话。受理先冻结预期来源约束，Hook后的最终进程环境另作实际来源证明；当前字符串lineage不替代该证明，普通headless默认临时HOME也不能当持久PVC来源（见[下一阶段来源/停止合同](./development-owner.md#下一阶段必须补齐实际原生来源与持久停止)）；resume 缺历史源则报告缺口，不把已有历史当新消耗。旧步骤校正继续复用原归属及冻结价格。Claude 常驻流只使用真实原生数值证据，没有 provider 的数值可以展示，人民币未定价；不能把配置 model 充作实际 model。

## 6. Session outbox 与清理屏障

Session 在 PostgreSQL 事务中验证 receipt、连续 sequence、重复内容及已提供页边界，保存独立数字帧和 persistedThrough 后才能 ACK Runner。事务失败、连接中断、丢 ACK 均重放原页；冲突不覆盖旧证据。数值保存不依赖普通 replay buffer。

Session 的 development usage outbox 采用持久公平轮询，未确认页固定 offeredThrough，之后到达的新数据不改变重放页。观测消费者按 dev-session owner 解析身份，账本、原生证明和估值写入成功且历史修订排空后才确认该页。业务与开发分别调度，不让一个坏来源饿死另一类来源。

AgentExecutionLifecycle 仍由原执行终态、取消或环境释放判定何时可结束；数值中断不能单独触发用户执行结束。对已受理支持的执行，清理屏障有两个 PG 持久出口：（a）Session persistedThrough 到达持久 finalThrough，完成已知末尾；（b）Session 已确认身份绑定的 interrupted/source-unavailable 中断回执，且已完成可取回数字排空或不可取回区间登记，余量保持未知/部分。两者都只在原生命周期已允许结束时交给 task-runtime 回收。估值可在 Session 存储上继续，不让消费者暂慢永久占 Pod。

中断回执的 Runner reportedThrough=N 与 Session 实际数字 persistedThrough=M 分开存储，不因保存回执提高 M。若旧数字仍可读，先按连续页把 M 排空到 N，再关闭中断清理屏障；其中任何一页 PG 未提交都不能 ACK 或回收。若日志已丢失/损坏、数字本体经身份绑定的明确不可读证据无法取回，则持久实际 M、已知缺口 (M,N] 和尾部完整性未知；N 本身未知时记录开放缺口 (M,unknown]。只对已复制水位 M ACK，不能 ACK 缺失区间。网络超时、临时 PG 失败不是不可取回证据，继续重试；明确强制释放仍按下文登记中断。

反例必须回归：Runner 数字 seq=10 后磁盘无法追加，模型正常退出且 Pod 仍在；Session 只到8、旧9/10可读时必须先持久到10才回收。若数字本体损坏，只能登记实际 M=8、不可取回 (8,10] 和中断后回收；Token 保留已提交贡献、采集不完整，不等待永不存在的 finalThrough，也不把回执 N 当已复制。断连而没有可信中断/结束事实时等恢复；Pod 已丢失或 owner 明确释放时用已有持久水位关闭中断屏障。没有任何数值能力的旧执行沿用原清理流程。

主动释放整个工作区与管理员强制清理必须能进入同一排空/中断路径；不能只保护普通完成，而在取消或父任务释放时直接丢弃观测。原用户操作仍可完成，中断原因进入观测质量，不阻止资源终结。

## 7. owner 查询与正式两级界面

dev-session 提供按 acceptedAt 时间窗和 projectId 有界分页的执行事实，task-runtime 提供同范围环境事实；组合根在同一 repeatable-read 事务中调用 owner 查询。观测模块不读取其他模块私表。开发详情 ID 是 executionTaskId，账本范围仍是父工作区，投影再按完整身份过滤。

业务成功率和开发进程结果分别汇总；总 Token 与 CNY 只相加互斥贡献。当前来源能力明确分别声明业务、开发 Agent、CLI、算力测试。项目和系统页的明细与算力弹窗展示名称、来源、工作区和具体执行，未知数值不补零；原生证明完备才显示真实零。仍复用 Card、Stack、ActionRow、DataTable、Dialog 和既有间距，不增加 CSV 或“更多筛选”。

## 8. 实施顺序与门禁

1. 协议、Pod render 私有日志布局和 Runner 日志/幂等受理；通过结构与协议测试，生产能力仍关闭。
2. Session 连续持久副本与 outbox、dev-session 价格受理/归属/结束屏障及 platform 组合；通过真实 PostgreSQL 的重放、冲突、丢 ACK、重启、分页及清理测试。
3. 驱动真实数值采集、owner 查询、两级界面一起开启。验证两个同算力 Agent、不同修订、100→130 增量、旧步骤 10→15 修订、0 与未知、费用隐藏、部分桶、旧 Runner。
4. 正式构建的中文/英文、390/1280px、长列表末行 Dialog、Escape 焦点与返回上下文验收；完整候选仅一次本地 check，精确 SHA CI，本机先 Session/控制面后新 Runner/控制台。实机任务使用需遵守既有资源授权。

本批实现功能门必须覆盖实际数据链，不能仅以 schema/DTO 测试或页面夹具判定完成。CLI 与算力测试、完整 RFC 的其他既定范围继续保留，不因本批完成而关闭。复核历史：2026-09-30 首轮设计门 FAIL 指出易变材料导致重发冲突及日志失败卡住回收，随后补稳定意图与独立 PG 中断出口；第二轮补齐 reportedThrough 与数字 persistedThrough 分离、可读末尾先排空、不可取回区间登记。修正后的最终设计结论见下一条 PASS 回执，实际实现仍未完成。


最终复审回执（2026-09-30）：独立只读功能设计门 PASS。稳定受理摘要、receipt 优先恢复、Runner/PG 水位分离、可读数字排空及不可取回缺口两个反例均已关闭。该结论仅确认可实施，未运行测试，不替代实现功能门、精确 CI 或真实开发采集验收。

## 9. Stage 1 实现检查点（2026-09-30，底座已发布）

当前实现限定为协议/Runner/Pod 底座：可选 developmentUsageV1、严格稳定受理与 FULL/WAL 数字日志、独立双卷绑定、分页/确认/重放、原生采集 sink 和旧 Runner/浏览器协商保护。没有任何生产准入路径选择 developmentUsageStorage；Session PG 副本/outbox、owner 固定原键及价格受理、排空清理屏障、来源事实与正式界面均在下一阶段。因此实际开发来源继续关闭，不能将此底座当成 CS-R02 完成。

初次实现只读复核 FAIL 的两个恢复反例已补实现与回归：整个数字目录丢失后不能用新空库重新提供能力；SQL 终态写入失败时当前进程保留真实终态和中断，ACK/info 不退回运行中，而重启只读持久证据保持 unknown。额外覆盖普通驱动流异常包装前的 missing-terminal 标记，避免将异常流退出计为完整。79 相关用例/412 断言通过，契约金样不变、3338 源文件结构检查与 36 本批源文件 lint 通过；独立 Stage 1 静态实现功能门 PASS（只读，未运行测试）；完整候选门禁待回执。


Stage 1 首次完整候选门禁回执：2026-09-29T22:12:32Z，4225 pass／142 skip／1 fail、26,792断言、845文件，635.93秒，40路径指纹未变化。唯一失败是旧 tasks 参考链接正确迁移后，测试未等能力目录结束“读取中”就断言 /business-tasks。只在 projectResources.test.tsx 增加最多40次 settle 的条件等待，保留两条原链接、主题及内容断言；23项导航回归/107断言和单文件lint通过，独立只读复核 PASS（未运行测试）。初次失败不算通过；因测试候选改变，冻结37源码/测试+4文档后重跑一次完整门禁。本机本轮真实登录/模型/资源 E2E 不可用，hosted精确CI和真实验收另记。


Stage 1 修正候选完整门禁回执：2026-09-29T22:29:20Z，结构/lint/两侧类型全部通过；4226 pass／142 skip／0 fail、26,792断言、845文件，830.04秒。37源码/测试+4文档共41路径指纹全部一致。独立Stage 1实现功能门及旧导航有界等待修复复核均PASS（复核未运行测试）。只补回执后精确发布；同源代码不再重跑完整本地门禁。数字协议/Runner底座通过不代表生产来源已接通；Session PG/outbox、owner原键/CNY受理/排空与两级正式明细仍继续。该本机门禁未运行真实登录/模型/平台资源E2E，hosted精确CI及实机验收单独记录。

Stage 1 精确发布与 hosted 回执：`fc491a4d6b31c6476d3222209ced880810936c3e` 已推送；[CI 36640100860](https://github.com/wangbinquan/CrewStation/actions/runs/36640100860) 终态 success，static/unit/module/console/gate/e2e 六项全部成功。没有将新 render 选入生产准入，也没有部署本批或创建真实开发验证资源。本机仍94aabd6d；Session/owner/价格/排空及两级正式明细继续，不以本回执关闭CS-R02。

## 10. Stage 2 Session 数字副本检查点（2026-09-30，在制）

本批仅落地 Session 独立 PostgreSQL 数字副本、原来源登记、复制后 ACK、固定 offeredThrough 的公平 outbox、完整/中断排空回执，以及 owner 内部 API/严格客户端。实际执行 UUID、journal/incarnation/摘要、Pod UID、项目/工作区/Agent、算力修订不可替换；未登记原来源不得发送带数字受理的 startAgent。Runner reportedThrough=N、PG 连续 persistedThrough=M 与两种 ACK 分开，网络超时或 PG 临时失败不构成永久丢失证明。0010 只追加 Session 迁移并登记精确锁路径，既有业务契约金样未变化。

首轮独立静态实现门 FAIL 的两个 P2 已修：迟到的同来源 receipt:null 不再把后提交的正常受理标为丢失；PG 已存 6～10 后补 1～5，连续水位会推进到真实 M=10，不在 Pod 丢失后把已存数字写成缺口。真实 PG 回归覆盖迟到响应顺序及两页全部消费。最终独立只读 Session 范围实现门 PASS（未运行测试）；54 相关用例/335断言、结构3358源文件、29 TS路径lint、后端类型及7项业务金样回归通过，新数字实现可执行行均在相关覆盖中实际执行。

六项跨单元回归使用实际 Runner SQLite 和实际 PG、传输桩；模块层另保留真实 PG 与假 numeric peer。覆盖 ACK 回执丢失后重启副本、M=8/N=10可读尾部排空、PG失败、日志/Pod替换和未知受理；这些是存储/协议证据，不能代替真实登录、集群模型或部署验收。单次冻结完整候选门禁、精确提交及 hosted CI 尚待回执。

生产开发采集继续关闭。本批尚未部署，当前平台仍94aabd6d；dev-session owner 尚未固定原键/稳定意图/nonce并接入 CNY 受理和实际生命周期清理屏障，platform 尚未消费新 outbox，事实查询及正式两级界面未接通。后续按 §8.2～4 与 CS-R02～05推进；Session 基础能力通过不关闭整个 Stage 2、CS-R02或两RFC。


Stage 2 Session 冻结候选完整门禁回执：2026-09-29T23:43:16Z，结构、全仓lint、后端/console类型全部通过；4263 pass／142 skip／0 fail、27,020断言、852文件，测试591.90秒（完整命令637.67秒）。31源码/测试/迁移/锁+4文档共35路径指纹全部未变；独立Session实现功能门及文档复核PASS。只追加本回执后精确发布，同源代码不重跑完整本地门禁。142跳过项与真实身份/模型/集群验收不计为通过；本机仍94aabd6d、生产开发来源关闭，owner/CNY/实际释放屏障、platform消费及两级明细继续。


Stage 2 Session 精确发布与本机部署回执（2026-09-30）：`1326fdd1ac3a0fdd0205bc0e4857a4423cc7df9d` 已推送，[CI36647054054](https://github.com/wangbinquan/CrewStation/actions/runs/36647054054) 终态六项 success。本机于 2026-09-30T00:04:59Z 完成 Session 先行的八组件 rollout，generation=observedGeneration、Ready=1；新增0010迁移 Job 完成，两张独立数字表存在，持久 storage-contract=1。实际镜像摘要：console `5b24dfe085612e539dd73e0d0c2ba1b42cf657edb5d6149b13529ea40f986b67`，control-plane `636479bb06e831aa7504f8ae9ccdf2f3e02e74fc6b24968edb3ccab476ed3e61`，默认 Runner `c019467571a59d8cfc4a7910453b9bb963ca8055b3393c1ef88bf7d551296121`；三个 OCI revision 均为本提交。工作台 /auth/login 只读HTTP200。没有登录、创建真实模型资源或重建旧会话/固定档位，生产开发采集仍关闭；这不是开发采集/两级真实身份验收。


修正后的冻结候选完整门禁回执：2026-09-30T01:03:12Z，结构、全仓lint、后端/console类型全部通过；4277 pass／142 skip／0 fail、27,123断言、854文件，测试801.28秒（完整命令849.29秒）。21源码/测试/迁移/锁＋5文档共26路径指纹未变，限定owner preparation独立实现功能门PASS。本机仍1326fdd1；生产仍未调用本批participant。142跳过项和真实身份/模型/集群验收不计为通过。只补本回执与后续删除屏障规划后精确发布，同源代码不重跑完整本地门禁；精确CI及部署另外记录，CS-R02和两RFC不关闭。

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

### 双路径 render/固定元数据完整候选门禁回执（2026-09-30）

2026-09-30T01:55:33Z，冻结23路径的一次完整本地门禁结束：结构、全仓lint、后端/console类型通过；4288 pass／142 skip／0 fail、27227断言、857文件，测试976.92秒，完整命令1035.26秒。18源码/测试与5文档在检查期间全部指纹一致；独立限定实现功能门PASS，24项相关回归通过。仅补本回执及下一阶段规划，不重复运行同内容完整门禁。精确发布/hosted CI/本机部署另记；生产开发采集仍关闭，真实身份/模型验收未执行，142跳过项不计通过。

### CS-R02 render/固定元数据发布与本机部署回执（2026-09-30）

精确源码bc8522cb7c98a6ef308065a5b5821ce181775ad9已推送，23路径独立限定功能门PASS，完整4288 pass/142 skip/0 fail且指纹未变。[精确CI36657789922](https://github.com/wangbinquan/CrewStation/actions/runs/36657789922)六项success。2026-09-30T02:18:01Z本机八组件generation=observedGeneration、Ready=1：console202、API196、auth94、controller161、events64、Session113、两个MCP60；storage-contract=1，迁移Job rfc034-render-migrate-bc8522cb完成，数字表存在，公开/auth/login只读HTTP200。

实际镜像摘要：console sha256:7b530e71a889fe12c0c20d0b16c55a461aad65d6ba23cb561dd2e9e2e628c494；control-plane sha256:becb085ec393e49755e6de24d71a27da256c44ca35e84bafd74e5c3665e06cb4；默认Runner sha256:f8543bd2dfe21ee3efd8f18f2076762283c0321987e6bd90a3fe0b63c707eb60。固定摘要及OCI revision核对完整源码SHA。未登录、未运行真实模型或重建既有会话/档位；生产开发采集仍关闭。实际原生来源、原键停止、完整派发/清理/消费/两级事实UI继续，142skip不冒充通过。


### 原键持久停止限定实现检查点（2026-09-30）

原数字受理和 stopRequested/launchPermitted/prevented 已在同一 FULL/WAL SQLite 即时事务中持久化；Hook 后、driver.start 前同步申请许可，停止可先于迟到 Start。Supervisor 覆盖等待 CWD、Hook 与已启动进程；Session 校验原登记、能力、key、Pod，停止回执复制到 PostgreSQL 后才返回，drain 后拒绝新数字 Start。初始化等待仍允许数字 stop/info/read/ACK。旧普通命令及 v1 receipt 保持兼容；任何无独立退出证明的 interrupted finished 都为 unknown；已有独立从未许可证明的 prevented 除外。旧控制缺失不补造从未启动证明。

17 个源码/测试文件冻结 hash 的独立限定实现功能门 PASS；复核仅为静态。相关回归使用真实 SQLite、临时 PostgreSQL 与假驱动：47 pass、0 fail、224 断言、8 文件；后端类型、本批 lint、架构检查（58 单元/3372 源码）通过。首轮相关测试 38 pass/7 fail，7 项均因新夹具缺 numeric 目录而在行为前失败，已修正目录权限并重跑；首轮测试类型检查的协议数组字面量也已修正。独立复核发现 Stop 可能覆盖缓存失败终态、丢失原 interruption，已修复并新增两条真实 SQLite 重开回归；真实驱动取消委托疑点经退出等待链静态核对排除，不作为缺陷或实机验收。

一次完整冻结候选门禁、精确提交/CI及本机部署仍待回执。生产数字准入继续 OFF；本批只完成原键持久停止底座，不包含完整 owner 派发、实际原生来源证明、清理删除屏障、consumer、同快照事实或两级 UI。Session 数字副本 closure 仅证明传输终结，不替代实际进程退出；owner 必须同时核停止状态和数字排空后才能清理。CS-R02 与两 RFC 不关闭，实际身份/模型验收没有执行。


### 原键持久停止完整候选门禁回执（2026-09-30）

2026-09-30T03:15:42.642302+00:00，冻结17源码/测试及6文档共23路径的一次完整本地门禁结束：结构、全仓lint、后端/console类型通过；4307 pass／142 skip／0 fail、27307断言、860文件，完整命令957.71秒。全部候选指纹未变，独立限定实现门PASS，相关47/0与224断言通过。只修正文档当前状态及prevented例外、标注设计阶段历史并补本回执，不重复同内容完整门禁。精确提交/CI/本机部署另记；生产仍OFF，实际身份/模型验收及上述剩余依赖未完成，跳过项不计通过。


### 原键停止精确发布与本机部署回执（2026-09-30）

源码 `bebb3d9b3b2a879a8e8ecf9b56b818fc912b15b7` 已精确推送，[CI 36665601664](https://github.com/wangbinquan/CrewStation/actions/runs/36665601664) 六项全部success。已完成2026-09-30T04:11:33.945Z本机升级：storage-contract=1、迁移Job `rfc034-stop-migrate-bebb3d9b` Complete、八组件generation=observedGeneration且Ready=1，公开登录页HTTP200。Runner默认镜像为 `registry.crewstation-system.svc.cluster.local:5000/crewstation/task-runtime@sha256:a5308d4a17749c03afa0fe53c24a5c64fb1cfb8f977b8662ce7560156ee2d88c`；不替换旧执行固定镜像或现有会话。

这只完成持久停止底座，生产开发数字准入仍OFF；实际原生来源证明、owner派发/完整清理屏障、consumer及两级事实/UI继续，CS-R02与两个RFC不关闭。没有进行真实身份/模型验收。下一批限定设计见 [development-native-source.md](./development-native-source.md)，当前仍为设计候选，不声称已采集。

### 实际来源第一批实现检查点（2026-09-30）

[development-native-source](./development-native-source.md) v2限定设计与30路径最终静态实现门PASS。最终plan.env、实际文件/sidecar身份、开发专用严格begin/finish帧、同轮模型补采和原受理journal接线已通过相关回归；真实Runner CLI适配漏传已用红→绿回归修正。尚待冻结完整门禁/精确CI/部署。此能力是可选内部底座，生产owner没有选择；Stage 2及完整开发来源尚未关闭，owner清理/consumer/两级事实UI继续。


最终限定来源候选已再次独立门PASS，相关77/0、合同族34/0及精确lint通过。本机最终完整check被4条并行资源迁移未入锁阻断，类型仅余并行resourceAccessModule fixture错误；按共享在制品规则精确发布36自有源码/测试/RFC文档、由干净提交的hosted CI裁决，不宣称本机全量通过。共享STATE/RFC索引以及并行资源/导航输出保持原样后续登记。详见development-native-source最终回执；生产OFF、两RFC仍未完成。
