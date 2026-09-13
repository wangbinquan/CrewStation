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

补充实测 `/private/tmp/crewstation-claude-requests-probe.ts`：AskUserQuestion 的 PreToolUse／PermissionRequest／PostToolUse 均带同一 prompt_id，Pre／Post 带 tool_use_id，而 PermissionRequest 不带。正常回答有 PostToolUse 和后续 end_turn 消息；Esc 撤回问题没有 PostToolUseFailure，transcript 中出现 tool_result/is_error，**仍然有 turn_duration**。因此单独 turn_duration 也不能证明成功，必须结合对应轮次的最终 assistant 和图关系；不能把 tool_result/is_error 任意解释为整轮失败。新会话首次请求在模型返回前直接 Esc 没有 interruptedMessageId 或 turn_duration，只观察到 interaction 结束。尚无可靠分类字段时只能报告已停止但结果未确认。

OTLP 通过环回 HTTP JSON 收集，logs／traces 以 1 秒周期导出。只需要的生命周期字段应在 Runtime 内归一化；提示词、回答、工具参数和原始 API body 的日志开关保持关闭。用户提示日志的 prompt.id 和 traceId 可将 interaction span 关联回对应轮次；span 自身的 status 为 UNSET，不能拿来判断成功。后续还需验证请求被拒／撤回、工具完成但轮次继续、两轮快速衔接、进程退出和事件通道故障。

来源：[Claude Hooks](https://code.claude.com/docs/en/hooks)、[Claude Monitoring](https://code.claude.com/docs/en/monitoring-usage)。上述结论同时以固定版本的原生实跑核对；不从终端静默时长推断状态。

## OpenCode 1.18.29

已核对固定标签的 [插件接口](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/plugin/src/index.ts)、[插件装配](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/opencode/src/plugin/index.ts) 与 [会话状态](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/opencode/src/session/status.ts)。候选来源是 chat.message 的稳定用户消息 ID，加上 session.status、message.updated、permission／question 的成对事件。idle 同时另发兼容的 session.idle，不应重复通知；仅 idle 不能区分正常完成与取消／错误。

初始化已解决并接入生产代码。该版本会等待插件依赖安装；仅有 node_modules 和 bun.lock 仍会进入 npm 安装。其 [Npm.install](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/core/src/npm.ts) 还读取 package-lock.json 的根依赖。任务镜像现预装固定 SDK 与 npm lock，首次准备只填充空目录，已有用户依赖保持原样。

真实 CLI、PTY、生成的观察插件与 Runner 状态通道已经连在一起验证：

| 场景 | 归一化后的实际结果 |
|---|---|
| 普通回答 | turn-started → 最终 assistant 的 finish=stop／time.completed ＋ session.status idle → turn-completed；进程仍运行 |
| 等待模型时双 Esc | 原生 MessageAbortedError；idle 可能先于错误消息，最终为 turn-cancelled，没有成功通知 |
| question 工具并回答 | request-opened 与 request-resolved 使用相同 requestId；模型继续后才 turn-completed |
| 撤回 question | 明确 request-resolved/rejected；原生回到 idle 且没有最终回答，保留 turn-unconfirmed/no-outcome，不算成功 |
| 工作目录外的夹具文件读取 | 原生 permission.asked → 用户在 TUI 确认 → permission.replied；读取和模型后续完成，不把许可本身当成完成 |
| 模型 HTTP 400 | turn-failed；进程保留，可以继续输入 |
| 显式 stop | 独立 process-ended，与本轮完成分离 |

正式可复验用例为 `runtimes/task/tests/nativeActivityAcceptance.test.ts`，模型夹具在同目录 `nativeActivityModel.ts`。2026-09-13 在 `cs-task-runtime:rfc003-activity` 实跑 **1 pass／0 fail、21 assertions、8.29s**。常规门禁不安装或调用真实 CLI，该例显式启用；上述仍是脚本化模型响应，不宣称外部模型或共享集群旅程通过。

```sh
docker build -f runtimes/task/Dockerfile -t cs-task-runtime:rfc003-activity .
# 生产镜像不包含 tests；运行时验收也不加载前端 CSS preload。
printf '[test]\n' > /tmp/crewstation-native-test.toml
docker run --rm --network none -e CS_NATIVE_ACTIVITY_ACCEPTANCE=1 \
  --mount type=bind,source=/tmp/crewstation-native-test.toml,target=/app/bunfig.toml,readonly \
  --mount type=bind,source="$PWD/runtimes/task/tests",target=/app/runtimes/task/tests,readonly \
  cs-task-runtime:rfc003-activity bun test ./runtimes/task/tests/nativeActivityAcceptance.test.ts
```

插件只发送状态字段，不传提示词、回答、工具参数和问题内容；先按原生会话父子关系过滤子 Agent，再用用户消息 ID／assistant.parentID／请求工具 messageID 关联。重复兼容事件、旧 assistant、重复消息和旧轮次不能覆盖当前轮次。128 个会话、128 个轮次、单轮 64 个请求、2048 个去重 ID／4096 个消息关联均有界，超限降级。插件串行发送，队列 256 条；每 5 秒心跳，20 秒失联或序号缺口标记 source-unavailable。未知版本、监听或准备失败保留原生 CLI，只降级状态来源。

状态事件经既有 session 存储持久化，包含 agentId 索引；新增 welcome 能力协商使旧 cs-session 不收到不认识的帧。Runner 为原生状态独立保留 256–5000 条事件，终端输出不能挤掉它们；总保留量仍有限，不能承诺无限离线历史。真实 WS 回归先复现开始事件被 PTY 挤掉，再验证按外层 seq 排序、去重和首次基移。

T15 的 Claude 归一化、dev-session 领域投影、个人已读与工作台动态仍待继续，不能把单驱动运行时完成等同于 T15 整体验收通过。

## 本批已修复的状态传输断点

- 浏览器先订阅、暂存实时帧再读取持久历史；合并排序并按 seq 去重，回放期间的临时 PTY 输出不会因小于持久高水位被丢弃。
- 实时暂存上限为 1024 帧／4 MiB。历史单次上限沿 session 配置（最多 5000），多查一条判断是否还有下一页；不完整或溢出明确给续接游标，不发送越过缺口的实时帧。
- 浏览器自动按游标补齐，握手完成前不派发命令；已超时的未发送命令被清理。旧 socket 的迟到消息／错误和重复 seq 不再影响当前状态。
- 新 Runner 首次握手把尚未发送的本进程事件接到服务端历史之后；同一 Runner 重连不再次基移。被替换的旧 Runner 连接不能再广播状态。
- 数据库读取失败关闭临时订阅并按服务不可用重试，不冒充权限拒绝。

自动回归分别在 `browserReplay.test.ts`、`taskStreamReplay.test.ts`、`sessionResume.test.ts`。T15 的领域投影、个人已读与顶部动态尚未接入；本批传输修复不能使 T15 直接完成。
