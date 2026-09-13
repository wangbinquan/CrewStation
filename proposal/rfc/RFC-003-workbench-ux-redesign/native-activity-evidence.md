# RFC-003｜原生轮次事件实测记录

> 2026-09-13。T15 实施证据；不是后台动态已完成的验收结论。

## 边界

在一次性 `cs-task-runtime:rfc003-layout` 容器中，以 worker 10001 启动真实原生 TUI。容器 `--network none`，使用同容器内 Bun HTTP 服务返回脚本化 Anthropic Messages／SSE 响应，API key 为固定的无效测试字符串。没有读取个人模型凭据，没有调用外部模型，没有连接或更新共享集群。模型响应是夹具；CLI、PTY、原生钩子及其产生的结构化事件是真实执行结果。

本机可复验脚本为 `/private/tmp/crewstation-claude-events-probe.ts`、`/private/tmp/crewstation-claude-cancel-probe.ts`，输出分别为同名 `.log`。这些临时研究脚本尚未作为正式自动门禁，不以手工记录替代后续驱动回归。

## Claude Code 2.1.268

原生参数沿当前 `prepareNativeTerminal`，附加隔离的 HTTP 观察钩子；未使用 `-p`、JSON headless 或替代 TUI。观察钩子本身只回空对象。专门的第二个 Stop 测试钩子在一次指定场景返回 block，用于证明其他项目钩子会要求继续。

| 场景 | 实际观察 | 结论 |
|---|---|---|
| 正常响应 | UserPromptSubmit 带 prompt_id；MessageDisplay(final)；Stop；最后导出一个 interaction span，终端仍可接收新输入 | 可关联原生用户轮次；单个响应结束与整个 interaction 必须区分 |
| Stop 要求继续一次 | 第一个 Stop 后模型再次被调用，随后第二个 Stop；整个过程只有一个 interaction span，prompt_id 未变 | 第一次 Stop 不能直接发“本轮完成” |
| 等待模型时 Esc | interaction span 结束，主线程未发 Stop；CLI 仍在，返回输入界面 | interaction 结束证明轮次停止，不证明成功 |
| Stop 要求继续之后 Esc | 第一轮 Stop 已观察到，继续请求尚在等待时取消；interaction 结束，但没有最终 turn_duration | “曾观察到 Stop ＋ interaction 结束”仍不能判定正常完成 |

**不能使用的捷径**：在这个固定版本中，HTTP Stop 钩子明确返回 block、CLI 也实际继续，但 `hook_execution_complete` 的 `num_blocking` 仍为字符串 `0`，`num_success` 为 `2`。所以本轮实现不能只按该聚合计数排除 block；不能用来源文档中的字段描述替代实际验收。

观察到的本地结构化记录：正常完成和 block 后正常完成各自有 `system / turn_duration`；block 后取消产生带同一 `promptId` 和 `interruptedMessageId` 的用户记录，没有 turn_duration。这些是**版本相关的内部 transcript 形状**，尚未验证全部工具／权限／错误／并发场景，不直接承诺为稳定公共接口。若采用，必须固定版本、校验关联、限制读取与缓冲，并在未知形状时降级，不允许根据文案关键词识别。

OTLP 通过环回 HTTP JSON 收集，logs／traces 以 1 秒周期导出。只需要的生命周期字段应在 Runtime 内归一化；提示词、回答、工具参数和原始 API body 的日志开关保持关闭。用户提示日志的 prompt.id 和 traceId 可将 interaction span 关联回对应轮次；span 自身的 status 为 UNSET，不能拿来判断成功。后续还需验证请求被拒／撤回、工具完成但轮次继续、两轮快速衔接、进程退出和事件通道故障。

来源：[Claude Hooks](https://code.claude.com/docs/en/hooks)、[Claude Monitoring](https://code.claude.com/docs/en/monitoring-usage)。上述结论同时以固定版本的原生实跑核对；不从终端静默时长推断状态。

## OpenCode 1.18.29

已核对固定标签的 [插件接口](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/plugin/src/index.ts)、[插件装配](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/opencode/src/plugin/index.ts) 与 [会话状态](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/opencode/src/session/status.ts)。候选来源是 chat.message 的稳定用户消息 ID，加上 session.status、message.updated、permission／question 的成对事件。idle 同时另发兼容的 session.idle，不应重复通知；仅 idle 不能区分正常完成与取消／错误。

隔离插件探针正在排查初始化阶段，尚未取得本轮正常模型响应与完整事件序列。当前不能把其静态接口或 T13 的 TUI 启动证据当作 T15 通过。最终实现仍须给出两种 CLI 的真实开始、等待、解决、完成、取消及退出证据。

## 本批已修复的状态传输断点

- 浏览器先订阅、暂存实时帧再读取持久历史；合并排序并按 seq 去重，回放期间的临时 PTY 输出不会因小于持久高水位被丢弃。
- 实时暂存上限为 1024 帧／4 MiB。历史单次上限沿 session 配置（最多 5000），多查一条判断是否还有下一页；不完整或溢出明确给续接游标，不发送越过缺口的实时帧。
- 浏览器自动按游标补齐，握手完成前不派发命令；已超时的未发送命令被清理。旧 socket 的迟到消息／错误和重复 seq 不再影响当前状态。
- 新 Runner 首次握手把尚未发送的本进程事件接到服务端历史之后；同一 Runner 重连不再次基移。被替换的旧 Runner 连接不能再广播状态。
- 数据库读取失败关闭临时订阅并按服务不可用重试，不冒充权限拒绝。

自动回归分别在 `browserReplay.test.ts`、`taskStreamReplay.test.ts`、`sessionResume.test.ts`。T15 的领域投影、个人已读与顶部动态尚未接入；本批传输修复不能使 T15 直接完成。
