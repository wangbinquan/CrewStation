# RFC-041｜Bot 持续对话设计

> 状态：Draft · 2026-10-15 · 不改生产实现；批准后按 plan.md 分层实施。

## 1. 当前源码与实机事实

基线 `22d916e855d36168efcf3c78f8d1089e9383dc62`，以下均经当前源码核对。

| 位置 | 现有行为与影响 |
|---|---|
| `apps/console/src/features/dev-session/components/agents/GuidedConversation.tsx:22` | 选择 Agent 决定发送目标与全文；下拉框把每个 Agent 显示成独立对话；取消直接调用 cancelAgent |
| `apps/console/src/features/dev-session/hooks/useBotSelection.ts:13` | 同一页签记住 agentId，未保存逻辑对话身份；这只修选择恢复，不解决上下文持久化 |
| `packages/agent-drivers/drivers/chainedRun.ts:20` | OpenCode 每轮启动进程，后续使用捕获的 sessionId；成功 interactive 轮次只发 waiting，不结束 Agent |
| `modules/dev-session/application/agents.ts:33` | 新建 Agent 分配新的 agentId 与执行 taskId；发送拒绝已结束 Agent |
| `modules/dev-session/application/agentExecution.ts:16` | completed/error/cancelled 结束当前 Agent，交给 task-runtime 回收，已结束 Agent 不重启 |
| `runtimes/task/src/agents/agentSupervisor.ts:55` | 开发 Agent 未传 persistentHome；最终调用 beforeStart.release |
| `runtimes/task/src/beforeStart/beforeStartRunner.ts:58` | 默认 HOME 位于每 Agent 临时目录；release 递归删除该目录 |
| `runtimes/task/src/agents/managedAgent.ts:21` | 已有 persistentHome 接缝；目前明确固定 XDG 路径只用于 businessEvents |
| `modules/task-runtime/application/nativeExecution.ts:56` | businessSession 只允许业务子任务与隔离业务卷，开发会话不能直接借用该语义 |
| `packages/k8s/objects/businessStorage.ts:13` | 业务会话已有隔离原生目录挂载，可复用安全检查与构造思路，不能拿来把开发任务伪装成业务任务 |

贪吃蛇实机原事件：成功开发 Agent `01a13efc-55c0-7000-86c8-545583181bb5` 的三次输入均使用 `ses_ec10394e8ffeorUFUf9dHQD80L`，后来为 cancelled；旧 OOM Agent 与另开的只读验收 Agent 各自有不同 sessionId。此事实不支持“每次追问都会切 session”，但证明当前 UI 将执行身份直接当成了对话身份。最后一次读取只读验收 Agent 仍 awaiting-input。

RFC-039 design.md §5 的 CLI/Bot 独立语义继续有效。本 RFC 取代其“无新增对话持久身份”的限制，仅针对默认 Bot 入口增加连续对话与恢复归属。

## 2. 模块与身份

不新增领域模块、层级或架构例外。L5 `modules/dev-session` 拥有 Bot 对话、消息受理、执行映射及恢复决策，持久表属于 `dev_session` schema。L4 `task-runtime` 拥有运行环境与上下文卷期望，L2 `cluster-control` 通过资源台账调和物理对象；L1 `resources` 继续提供现有资源登记能力。跨模块仅走公开 API/端口，由 `modules/platform` 装配，禁止引用 business-task 的仓储。

`packages/contracts` 定义跨进程 DTO/命令/能力，`packages/api-client` 提供客户端；`runtimes/task/src/agents` 管理执行与上下文挂载；`packages/agent-drivers` 只负责协议级续接与进程停止。前端落在 `features/dev-session/{hooks,model,components/bot}`，不把领域状态机塞进页面。

区分三种身份：

- `conversationId`：服务端生成 UUIDv7，稳定的 Bot 对话身份，父开发 taskId 不变时始终存在。
- `contextEpoch` / `nativeSessionId`：当前原生上下文。普通轮次与环境恢复不改变；仅用户确认新的上下文时增加 epoch。
- `agentId` / `executionTaskId`：实际执行身份。新 Pod 必须用新身份，原结束记录保持，不违反 RFC-006 已结束 Agent 不重启。

每个父开发 task 仅有一个默认 Bot 对话。高级入口显式创建的独立 Agent 不自动占据或替换默认对话；旧独立会话继续通过历史入口访问。

## 3. 持久受理与接口

新 `bot_conversations` 保存 taskId、conversationId、revision、当前 epoch、固定协议/档位修订/运行镜像、nativeSessionId、原生存储引用与当前执行引用。`bot_messages` 保存客户端生成的 requestId、内容摘要、用户内容、受理/派发/结果未知状态与实际事件关联。执行关系记录只引用原 Agent/事件，不复制或改写工具及回答。

新增平台内接口：

- `GET /v2/dev-sessions/:taskId/bot`：读取默认对话、continuity（available/unknown/unavailable）、当前执行与可用动作；只读不创建模型进程。
- `POST /v2/dev-sessions/:taskId/bot/messages`：requestId、expectedRevision、content。首次发送原子创建默认对话并固定档位；后续发送命中原上下文。相同 requestId/摘要返回原回执，不同摘要冲突。
- `POST .../bot/interrupt`：expectedRevision、expectedExecutionId、requestId。只停止这次执行，不新建上下文。
- `POST .../bot/context`：明确的 fresh 请求与 expectedRevision；保留旧 epoch，先完成旧执行停止证明才创建新 epoch。没有用户确认不调用。
- `GET .../bot/history`：按稳定游标分页返回 epoch/执行/旧独立 Agent 关联；每个事件身份为 executionTaskId + seq，分页及重连去重。

权限仍用原项目 develop/view 与 canOpenStream；默认 Bot 不是新的权限边界。写操作与项目封闭/删除准入同锁集；conversation revision + 持久消息键跨页面/跨实例防重。Runner 消息命令增加持久 requestId 受理回执及内容摘要，不能只靠 HTTP 层幂等后再用随机 msg ID 重发。派发结果未知时只对账，未证明原请求没有执行前禁止自动重新发送。

## 4. 原生上下文保存与执行交接

为避免迁移/重排既有工作卷，首次 Bot 发送时为父开发会话惰性分配一个平台管理的原生上下文 PVC，提议初始容量 1 GiB，仅当前 Bot 执行 Pod 挂载其 conversation/epoch 子目录。该物理卷与原工作卷分离，不挂到项目文件浏览器、CLI、Git、预览或发布构建。资源中心显示归属、容量与保留状态；空间不足明确报错，不删除历史上下文来腾空间。此新增存储成本是本 RFC 的批准项。

卷引用由 task-runtime 生成并绑定父 taskId、PVC UID、conversationId、epoch；请求方不得提交任意路径/PVC。初始化只接受平台 ID 和 create/existing 模式，检查所有祖先/目录所有权与模式，拒绝符号链接及损坏目录。Runner 的托管上下文显式区分原生持久数据根和每次执行的启动配置根；协议适配器必须将会话所需的 HOME/XDG 数据路径绑定到稳定私有目录，并将临时配置与凭据注入留在本次执行目录，不能简单把整个含配置的临时 HOME 复制进 PVC。哪些原生文件属于会话数据按固定协议/版本验证，路径无法可靠分离的档位不得宣称支持持久续接。清理临时目录不能清理原生历史，临时凭据不得写入镜像、Git、事件或平台明文台账。

沿用当前真实 interactive 多轮路径，不为每个成功答复换 Pod。普通执行中断可先通过现有取消路径结束当前 Agent，再等待 task-runtime 提供精确旧 Pod/进程停止证明；之后新执行挂同一个原生目录并传原 sessionId。前端保持 conversationId 和消息时间线不变；每次执行仍独立可追踪。此实现不要求先给两种驱动都发明常驻进程“暂停”协议。

恢复条件是原生目录存在且通过检查、协议/固定档位/运行镜像兼容、nativeSessionId 确定，以及旧执行已停止。不能以租约超时、断线、HTTP 500 或 status=failed 代替物理停止证明。新执行受理前以 conversation 的跨实例锁固定一位写入者，task-runtime 使用 expectedPreviousExecutionId 与旧 UID 停止证明裁决；未知状态停在“正在确认执行状态”。

上下文兼容身份被冻结；管理员删除固定修订、镜像不再可用、原生 runtime 找不到 session 都返回可解释的恢复失败，不偷偷用新默认模型创建空 session。原生事件回报不同 sessionId 时将本次恢复标记不成立，不把它写成连续成功。

默认对话和上下文卷跟随父开发会话已有保留/删除政策：浏览器关闭、轮次停止、子执行回收不删除；父保卷恢复保持相同引用；父会话最终删除/项目永久删除纳入既有封闭、停止、资源清单与 UID 回执，不能产生孤立卷。历史已封闭后拒绝晚到事件重新激活。

## 5. 界面和兼容

主栏显示“Crew Bot”、当前状态和“历史与设置”，不再用每个 agentId 的下拉框作为默认入口。执行中只有“停止本轮”；等待输入时保留输入框和发送。正常完成不显示“新建对话可继续”。失败/停止的记录留在原消息位置，恢复只是其中一个状态变化；不把控制面提示渲染成 Bot 的自然语言回答。

历史、详情和上下文切换复用 Dialog/ConfirmationDialog，表单草稿在打开者保存，嵌套 Esc 只关最上层，返回保持列表位置。显式 fresh 不删除旧 epoch；确认说明“模型将不再沿用原对话上下文”，并在聊天中画出清晰边界。CLI/Bot 仍共享工作区、各自模型上下文；切换不发送、不触发恢复。

旧数据不按日期、任务或 prompt 相似度合并。优先采用用户明确选中的可用旧 Agent；未选择时只有唯一可用旧 Agent 才能建议接续，多个可用对象需在统一弹窗选择，不能静默换上下文。活跃旧 Agent 可继续原有 sendMessage；其临时 HOME 在迁入持久卷并验证前只标记 live-only，不宣称可冷续接，也不提供会销毁其上下文的“停止本轮”。迁入必须有 Runner 的明确能力：冻结新输入、排空当前轮、在仍保有 HOME 时导出校验原生数据、完成新目录持久收据，然后结束旧 Agent 并确认旧执行停止，最后才允许接管。不能先调用现有 cancelAgent 再去找已清理的 HOME。当前旧 Runner 不支持该迁入，保持旧模式并明确提示；升级前不假定可以给已运行进程补上新能力。

已结束且目录已被旧版本清理的 Agent 只能查看历史；“以新上下文继续”是显式 fresh，保留原上下文不可恢复的事实。当前贪吃蛇旧 cancelled Agent 不作为无损迁移成功样例。

## 6. 失败与验证

| 层级 | 重点防护 |
|---|---|
| 纯领域/契约 | stable conversation / epoch / execution 的身份约束；continuity unknown；错误码；旧 Runner 能力协商 |
| dev-session + 真实 PostgreSQL | 并发首次创建、同键/异键投递、revision 冲突、取消与恢复竞态、晚到事件、封闭/删除、分页去重 |
| task-runtime/cluster-control | 私有 PVC 归属、UID 变更拒绝、无双写挂载、旧执行真实停止后交接、配额/磁盘不足、最终回收 |
| Runtime/driver | HOME 与 XDG 一致、实际 resume 参数、取消不删除持久目录、session 不存在/返回错误 sessionId 拒绝冒充恢复、请求回执未知不重跑 |
| Console | 连续发送、状态/输入框、正文与执行分离、刷新/切换/草稿、旧记录兼容、共享弹窗焦点与窄屏布局 |
| 实机 | 在隔离项目用真实模型记住随机标记；追问、停止继续、换 Pod 冷续接、浏览器刷新后仍能回答标记；同时核对原生 sessionId、存储 UID、实际 Pod 身份与事件 |

先通过相应层级及准确 SHA gate/e2e 再部署。本 RFC 的原型只有本地模拟数据；没有将其截图或 sessionStorage 当成原生持久化证明。原源码回归、RFC-039 已部署工具详情及并行 RFC-040 工作均保持独立证据。
