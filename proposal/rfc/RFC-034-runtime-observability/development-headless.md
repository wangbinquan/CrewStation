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

开发卷现有根目录直接作为 /work 挂给 worker；不迁移其布局，不套用业务卷初始化器。新建独立开发 Agent Pod 的 render 快照选择 developmentUsageStorage v1，增加独立磁盘 emptyDir 挂载到 /run/crewstation/development-usage；Runner 创建 root 所有的 0700 私有子目录。现有 Pod 和旧 render 不追加验证条件，不重建正在运行的执行。

明确持久边界：本地 journal 跨 Runner/容器重启、Session PostgreSQL 跨 Pod 丢失。emptyDir 不跨 Pod 删除；若 Pod 在提交数值前丢失，已提交贡献保留，余量标记未知/中断。不得把新 Pod 的空日志当成旧执行完成，也不得因观测补偿自动重启模型。Pod UID、持久 marker 和 journal incarnation 绑定；同 Pod 日志/marker 丢失时拒绝声称采集能力，禁止重新造零值。

Runner 仅在日志可打开且平台显式请求时提供 developmentUsageV1；不借用 businessExecutionV3 的受理状态或输出。协议版本不升级，新增可选能力和专用 info/read/ack 命令。控制面先查询能力，再向 startAgent 发送带完整数值受理键的可选配置；不向不支持的 Runner 发送新命令。旧 Runner 的 startAgent、sendMessage、cancelAgent 与流式语义保持。

## 4. 数值协议与启动去重

- info 返回受理键、journal incarnation、持久末水位、已确认水位与 running/finished/unknown 状态；未受理与能力不支持分别表示。
- dev-session 首次受理时保存不可变 StartIntent、随机 digestNonce 与 SHA256 启动意图摘要。StartIntent 的版本、项目/父工作区/执行 UUID/代次/Agent、固定算力修订、实际权限、prompt/cwd/resume/systemPrompt 与 MCP 目标名称/URL 构成规范 JSON；prompt 等已有 owner 请求保留在 owner 中，journal 仅存摘要与数字。算力修订固定 launch/启动前模板；重签 MCP 令牌、解密凭据和当次传输材料不进入摘要，不改变同一次受理。
- 每次派发先按执行键查询 Session/Runner 原 receipt。已有相同意图 receipt 时直接恢复状态/数字游标，不再重签材料、运行 Hook 或创建模型；未知/超时不能当作未受理。只有健康原日志明确未受理时才准备当次材料。Runner 对首次命令核对稳定字段与 StartIntent，reserve 先持久摘要和身份，再调用 ManagedAgentProcess；并发重复由 reserve 返回原 receipt，不第二次 spawn。修改稳定意图必须新执行 UUID，不能借替换凭据改变 launch。旧 incarnation 的历史 active receipt 变 unknown，不能猜测成功或再次 spawn。
- capture 复用 RunnerUsageCapture 数字及原生证明合同，独立 sequence 从 1 连续；不存 prompt、文本输出或模型凭据。真实轮次的成对边界另存为受限枚举数字帧，不用进程驻留时长推算活跃时长。
- SQLite WAL + synchronous FULL；每次追加先落盘，才让 usage 事件的 writeProcessed 返回。普通文字不占数值队列、不影响数值水位。
- 每页最多 5 个 capture（每 capture 仍最多 100 条 measurement），总页上限 1 MiB；单事件和总 spool 有硬上限。保留终态/缺口控制帧空间，溢出或写入失败使采集进入 partial/unknown，不能静默丢记录后报告 complete。
- 观测故障不自动重启或结束用户模型：启动前日志不可用按未支持路径显式登记；启动后失败保留已有数值及错误质量，普通执行生命周期继续。若连续水位无法继续，冻结最后可信水位 N，info 通过独立有界控制回执声明 interrupted、原因、受理键/incarnation/Pod UID 和 N；这不是 sequence=N+1 的帧，也不能作为数字 complete 或新的 ACK。Session 在自己的 PG 中持久中断事实及水位，Runner 磁盘失败不妨碍该回执传递。
- 若日志/marker 丢失或 Runner 重启后无法读原状态，Session 按既有 receipt、同一 owner 环境及 Pod UID 绑定中断，可信水位只能取已有 PG persistedThrough；不从新空日志提高水位。身份无法核对时标 source-unavailable，等待重连或 owner 的明确结束/释放事实，禁止声称已排空。数值中断本身不结束正在运行的模型。
- 进程退出后完成原生末次采集，持久 finalThrough，才发出普通终态通知。取消也遵守同一顺序；无法证明末采集时发布 unknown，不发布完整零值。

## 5. 驱动与原生基线

usageObservationsV1 的采集开关与 businessEvents 的业务事件映射分离。只要显式启用数字能力便创建 usageObserver，并在 ManagedAgent 和驱动两层启用有界、可处理确认的数值传递；旧路径仍无新增 usage 事件。

OpenCode 每轮沿用已有实际环境原生数据库适配器：模型创建前持久 begin/baseline，退出后分页读取真实根和子会话。lineage 按受理的真实存储来源固定；resume 缺历史源则报告缺口，不把已有历史当新消耗。旧步骤校正继续复用原归属及冻结价格。Claude 常驻流只使用真实原生数值证据，没有 provider 的数值可以展示，人民币未定价；不能把配置 model 充作实际 model。

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

本批实现功能门必须覆盖实际数据链，不能仅以 schema/DTO 测试或页面夹具判定完成。CLI 与算力测试、完整 RFC 的其他既定范围继续保留，不因本批完成而关闭。2026-09-30 首轮设计门 FAIL 指出易变材料导致重发冲突及日志失败卡住回收，现补稳定意图与独立 PG 中断出口；第二轮补齐 reportedThrough 与数字 persistedThrough 分离、可读末尾先排空、不可取回区间登记，仍待最终复审，不写成 PASS。


最终复审回执（2026-09-30）：独立只读功能设计门 PASS。稳定受理摘要、receipt 优先恢复、Runner/PG 水位分离、可读数字排空及不可取回缺口两个反例均已关闭。该结论仅确认可实施，未运行测试，不替代实现功能门、精确 CI 或真实开发采集验收。
