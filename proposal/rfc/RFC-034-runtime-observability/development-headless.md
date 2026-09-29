# RFC-034 开发 Agent 数值链路实施细化

状态：设计候选，待独立功能门；尚未开启生产采集。属于已批准的开发观测范围，不恢复 CSV、额外筛选折叠、预算自动停止或通知。

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
- reserve 先持久启动摘要和身份，再调用 ManagedAgentProcess；重复相同受理键返回原 receipt，不重新创建模型。不同摘要冲突。Runner 崩溃后的历史 active receipt 变 unknown，不能猜测已成功或再次 spawn。
- capture 复用 RunnerUsageCapture 数字及原生证明合同，独立 sequence 从 1 连续；不存 prompt、文本输出或模型凭据。真实轮次的成对边界另存为受限枚举数字帧，不用进程驻留时长推算活跃时长。
- SQLite WAL + synchronous FULL；每次追加先落盘，才让 usage 事件的 writeProcessed 返回。普通文字不占数值队列、不影响数值水位。
- 每页最多 5 个 capture（每 capture 仍最多 100 条 measurement），总页上限 1 MiB；单事件和总 spool 有硬上限。保留终态/缺口控制帧空间，溢出或写入失败使采集进入 partial/unknown，不能静默丢记录后报告 complete。
- 观测故障不自动重启或结束用户模型：启动前日志不可用按未支持路径显式登记；启动后失败保留已有数值及错误质量，普通执行生命周期继续。若连续水位无法继续，冻结该日志的最后持久水位并记录独立中断事实，不伪造可 ACK 的新尾部。
- 进程退出后完成原生末次采集，持久 finalThrough，才发出普通终态通知。取消也遵守同一顺序；无法证明末采集时发布 unknown，不发布完整零值。

## 5. 驱动与原生基线

usageObservationsV1 的采集开关与 businessEvents 的业务事件映射分离。只要显式启用数字能力便创建 usageObserver，并在 ManagedAgent 和驱动两层启用有界、可处理确认的数值传递；旧路径仍无新增 usage 事件。

OpenCode 每轮沿用已有实际环境原生数据库适配器：模型创建前持久 begin/baseline，退出后分页读取真实根和子会话。lineage 按受理的真实存储来源固定；resume 缺历史源则报告缺口，不把已有历史当新消耗。旧步骤校正继续复用原归属及冻结价格。Claude 常驻流只使用真实原生数值证据，没有 provider 的数值可以展示，人民币未定价；不能把配置 model 充作实际 model。

## 6. Session outbox 与清理屏障

Session 在 PostgreSQL 事务中验证 receipt、连续 sequence、重复内容及已提供页边界，保存独立数字帧和 persistedThrough 后才能 ACK Runner。事务失败、连接中断、丢 ACK 均重放原页；冲突不覆盖旧证据。数值保存不依赖普通 replay buffer。

Session 的 development usage outbox 采用持久公平轮询，未确认页固定 offeredThrough，之后到达的新数据不改变重放页。观测消费者按 dev-session owner 解析身份，账本、原生证明和估值写入成功且历史修订排空后才确认该页。业务与开发分别调度，不让一个坏来源饿死另一类来源。

AgentExecutionLifecycle 看到终态后先读取数值 completion 状态：对于已受理支持的执行，只有 Session 已持久到 finalThrough 后才能回收仍存在的 Pod；估值可在 Session 存储上继续，不能因为消费者暂慢而永久占 Pod。断连时等待恢复；Pod 已丢失或明确释放时以中断质量关闭屏障，保留已持久贡献。没有任何数值能力的旧执行沿用旧清理流程。

主动释放整个工作区与管理员强制清理必须能进入同一排空/中断路径；不能只保护普通完成，而在取消或父任务释放时直接丢弃观测。原用户操作仍可完成，中断原因进入观测质量，不阻止资源终结。

## 7. owner 查询与正式两级界面

dev-session 提供按 acceptedAt 时间窗和 projectId 有界分页的执行事实，task-runtime 提供同范围环境事实；组合根在同一 repeatable-read 事务中调用 owner 查询。观测模块不读取其他模块私表。开发详情 ID 是 executionTaskId，账本范围仍是父工作区，投影再按完整身份过滤。

业务成功率和开发进程结果分别汇总；总 Token 与 CNY 只相加互斥贡献。当前来源能力明确分别声明业务、开发 Agent、CLI、算力测试。项目和系统页的明细与算力弹窗展示名称、来源、工作区和具体执行，未知数值不补零；原生证明完备才显示真实零。仍复用 Card、Stack、ActionRow、DataTable、Dialog 和既有间距，不增加 CSV 或“更多筛选”。

## 8. 实施顺序与门禁

1. 协议、Pod render 私有日志布局和 Runner 日志/幂等受理；通过结构与协议测试，生产能力仍关闭。
2. Session 连续持久副本与 outbox、dev-session 价格受理/归属/结束屏障及 platform 组合；通过真实 PostgreSQL 的重放、冲突、丢 ACK、重启、分页及清理测试。
3. 驱动真实数值采集、owner 查询、两级界面一起开启。验证两个同算力 Agent、不同修订、100→130 增量、旧步骤 10→15 修订、0 与未知、费用隐藏、部分桶、旧 Runner。
4. 正式构建的中文/英文、390/1280px、长列表末行 Dialog、Escape 焦点与返回上下文验收；完整候选仅一次本地 check，精确 SHA CI，本机先 Session/控制面后新 Runner/控制台。实机任务使用需遵守既有资源授权。

本批实现功能门必须覆盖实际数据链，不能仅以 schema/DTO 测试或页面夹具判定完成。CLI 与算力测试、完整 RFC 的其他既定范围继续保留，不因本批完成而关闭。
