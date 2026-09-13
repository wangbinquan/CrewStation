# RFC-003｜生产实现与验收证据

状态：In Progress。作者于 2026-09-13 要求完整实现并提交上库；本文件区分实现、自动验证与真实集群验收，交互附件不作为生产证据。

## 第一批：T4 工作树预检与释放确认

- `GET /v1/projects/:projectId/dev-session/workspace-status` 经 dev-session 授权与 Runner 端口读取容器事实，无 push／fetch／标签／文件写入。
- Runner 使用 `git --no-optional-locks status --porcelain=v2 -z --branch --untracked-files=all`，保留特殊路径、重命名、暂存和未暂存差异；实际 HEAD 与会话创建时分支独立。
- 指纹包含 index 信息与 dirty／untracked 文件内容，后续比较可识别同样行数的再次编辑。检查不是并发写入的原子快照。
- 单次命令 30 秒；命令输出沿既有 exec 每流 256 KiB 上限，超限给 unknown。返回最多 500 个文件、100 个未推送提交，并保留总数及截断标志。未推送针对所有本地分支和 HEAD 相对已知 remote refs，不假称远端已刷新或等同生产部署。
- 发布重新检查；Git 失败、无首次提交、工作树分支已改变均拒绝继续推送／打标签。此批尚未实现确认 SHA 贯穿远端打标，留在 T6。
- 释放前展示检查时间、实际分支／SHA、文件与提交；取消不调用 DELETE，重开会重新检查。断线／失败不显示安全；保留显式释放能力。`expectedTaskId` 拒绝释放期间被替换的会话。释放响应的 `unpushed: null` 明确未知，工作台与 CLI 同步处理。
- 新增通用 `shared/ui/ConfirmationPanel`，旧受控确认调用复用它。

自动验证：

| 证据 | 验证内容 |
|---|---|
| `runtimes/task/tests/workspaceStatus.test.ts` | 真实 Git：首次提交、HEAD、分支切换、detached、特殊路径、重命名、暂存／未暂存／未跟踪、删除／二进制、指纹、其他分支、上游、浅历史、失败、截断；只读检查不写 index |
| `runtimes/task/tests/runnerProtocol.test.ts` | 经真实 WebSocket 调用 workspaceStatus，失败和尚无提交状态符合协议 |
| `modules/dev-session/tests/workspacePreflight.test.ts` | 两条先红后绿的实际缺陷回归；只读／授权／无会话／旧 Runner／断线／dirty／分支变化／迟到释放 |
| `modules/dev-session/tests/devSessionModule.test.ts` | 已有 PostgreSQL 模块链、发布与强制释放回归 |
| `apps/console/src/tests/releaseInspection.test.tsx` | 真 React 控件＋假 HTTP：清单先于 DELETE，取消，重新检查，pending，未知，替换会话 |
| `packages/api-client/tests/apiClient.test.ts` | GET 检查与 DELETE expectedTaskId 的请求契约 |

本地全量：`bun run check` 661 pass／1 skip／0 fail，662 tests、98 files、3091 assertions、49.76s；console build 554ms。跳过 opt-in 真实 K8s 用例。构建保留原有大 bundle 提示。精确 SHA 的 GitHub Actions 在提交后单独核验。

本批尚未更新本机运行镜像；UX-AT-07／19 等真实集群旅程待 T12。T14 的部署比较、原生 CLI、市场及其他任务仍未完成，RFC 不标 Done。

发布记录：`ec97e290e2bf9f7a89de70eef3368d8bda23d1a7` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34728697239) 成功。下批本机镜像更新后，已实跑未跟踪文件的释放前清单与取消保留会话。

## 第二批：T14 实际工作树与部署版本比较

- 新增项目级 comparison／分页 details／显式 refresh-history 三个接口。比较目标来自实际 prod／preview Release 的 releaseId、tag、完整 SHA；读取前后核对目标，切流或会话替换使旧比较失效。
- Runner 实读 H 与 P 的双向提交数、共同历史和文件净差异。未部署、缺对象、浅历史、无共同历史及失败分别返回，不用零或上游分支冒充生产关系。
- 暂存、未暂存、未跟踪、重命名、空文件与二进制均保留；暂存与未暂存抵消仍能逐段查看。P 中存在但 H 已删除、工作区又以 untracked 恢复的文件按同一路径合并，避免重复相加。
- 内容指纹在比较与详情前后检查；32 个快照、5 分钟 TTL。相同有效指纹复用 comparisonId，不因前台每 10 秒重查而重置详情；未知的对象／文件结果不缓存成功。
- 文件／提交按最多 100 条分页，文本 patch 最多 64 KiB，截断明确；Git 流沿已有 256 KiB 上限，旧 blob 的临时文件最多 2 MiB；全操作共享期限，workspace 30 秒、comparison 60 秒、补历史 120 秒，控制面等待期限相应增加。
- 只有显式补历史才 fetch；使用临时配置与平台比较 refs，保留开发者 HEAD、index、工作文件、remote refs、Git 配置与 FETCH_HEAD。失败隐藏凭据 URL。只读查询不签发凭据；补历史仍要求 develop 权限。
- 控制台接入四类详情、实际 patch、未知和过期状态、显式补历史。共享 Tabs 支持键盘与窄屏滚动，Card 提供紧凑样式。未部署默认打开未提交改动，其他不可比较页签解释原因，不触发必然失败的请求。紧凑开发工作台整体布局仍属 T5。

自动验证：

| 证据 | 验证内容 |
|---|---|
| `runtimes/task/tests/workspaceComparison.test.ts` | 真实 Git 的双向关系、净差异抵消、特殊 untracked、暂存分段、二进制、同长内容变化、未首次提交、patch 截断、稳定快照 ID |
| `runtimes/task/tests/comparisonHistory.test.ts` | 真实浅克隆补齐历史且当前引用／文件／配置不变、失败凭据脱敏、TTL／容量 |
| `modules/dev-session/tests/versionComparison.test.ts` | 实际部署来源、未知、读取中切流、旧会话详情、查看与补历史角色边界 |
| `modules/session/tests/comparisonTimeout.test.ts` | workspace／comparison／history 的等待期限与其他命令回归 |
| `apps/console/src/tests/versionComparisonView.test.tsx` | React＋HTTP：四页签、patch、截断、明确 POST、未知、未部署、键盘关系 |
| `runtimes/task/tests/runnerProtocol.test.ts` | 真实 WS 的 compare／details 协议调用 |

本机验收环境：docker-desktop kind，admin（管理员兼负责人），专用项目 `prj_01a09859a1bc7000b8622726e24f34b2`／`rfc003-ux`，新开发会话 `tsk_01a0985a8624700090ea5b5ecd4fca86`，分支 main，HEAD `a10027cda8…`，初始 preview `v0.1.0`，prod 尚未部署。control-plane／console／task 镜像均已更新；没有释放旧 demo 会话或改其文件。

实际浏览器已确认：未部署状态不假称一致；容器新增 `ux-comparison.txt` 后未提交数从 0 变 1，详情显示 `untracked`、`+1 −0` 和真实文本 patch；释放前清单显示 `?? ux-comparison.txt`，取消后原会话保留。浏览器发现的“未部署默认请求提交详情并误提示过期”已修正并加回归。首次进入旧工作台时 session 元数据未随连接更新、预览长期显示 starting 的现象留待 T5 的实时状态接线排查。

专用项目首次切到 prod 被自动审批拦截，原因沿用了早前只读验收范围；尚未切流，已向作者请求该具体验收操作的授权。真实生产变化／完整角色与响应式旅程仍待后续 T12，不以自动测试或附件代替。

门禁同时发现并最小修复队列的既有时钟偏差：`enqueueJob` 的默认立即时间来自应用 `new Date()`，而领取以数据库 `now()` 判断，主机略快会漏领刚入队的第二条任务。新回归将调用进程时钟调快一分钟，旧代码稳定得到空领取；默认时间改为数据库 `now()` 后立即任务可领，显式未来 `runAt` 仍保持延时语义。只涉及 `packages/queue/jobs.ts` 与本包回归，不调整调度策略。

最终本地门禁：`bun run check` 684 pass／1 skip／0 fail，685 tests、103 files、3187 assertions、68.49s；console build 682ms。真实浅克隆用例执行多个 Git 子进程，默认 5 秒截止曾在 clone 阶段触发清理；该例单独设为 20 秒有界等待，保留全部真实操作与断言。浏览器复验未部署默认选中未提交改动，点击待上线提交只显示“尚无生产版本”；320／390px 差异页签可操作，整页宽度分别为 320／390px。原顶栏在窄屏挤压、整个开发页信息过多仍由 T3／T5 继续处理，未宣称完整响应式验收通过。

发布记录：队列修复 `0b070a6`、T14 `8b2560c9a10194d581160196cb2df53e955b7598` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34730928927) 成功（check 1m5s）。

## 第三批：T3 品牌资产与顶栏

协作舱原稿落在 `apps/console/public/brand/`，彩色／单色两份与设计稿一致。shared Brand 统一尺寸与可访问名称，顶栏 28px 字标入口可返回工作台，favicon 复用彩色原稿。登录提供者内嵌同一 SVG 的 data URI，避免尚未登录或业务域入口下图片再次跳转登录；部署副本有逐字节一致性测试。图标独立时读作 CrewStation，与字标相邻时为装饰，不承担运行状态语义。

顶栏在窄屏自动换行，操作按钮保持完整文字，长名称／项目标识省略；语言下拉始终有可访问名称。主布局为实际顶栏高度分配空间。两空间仍复用同一顶栏，已有空间返回记忆保留。T3 的项目名称、导航重组及其他入口尚待继续实现。

本机 cs-auth／console 已更新：真实顶栏图标加载完成，favicon 指向同一资源；320px 整页宽度为 320px，管理员空间切换、语言与登出正常换行；真实 `/auth/login` 图标与 favicon 内嵌且加载完成，图标尺寸 40px。品牌组件、无图文字重复播报、两空间字标导航、登录资源一致性均有自动回归。完整工作台密度仍归 T5，不用品牌替换代替该任务。

本地 `bun run check`：688 pass／1 skip／0 fail，689 tests、105 files、3198 assertions、71.35s；console build 695ms。跳过项仍为 opt-in 真实 K8s 用例。

发布记录：`18748285328f924b5ec2ca0b451a630b08d6ad44` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34731416147) 成功。

## 第四批：T13 原生 CLI 后端与恢复

- `POST／GET /v1/tasks/:taskId/agent-terminals` 与单窗 `/stop` 接入 dev-session。启动按调用者、taskId、clientRequestId 持久化，数据库事务串行同一任务的受理；同 ID 异配置冲突，Runner 端再次幂等。已受理而响应丢失返回 unknown，原请求可查询／重放；容器身份更换只标结束不可恢复。
- 平台仍解析档位与现签 MCP 凭据，不接收租户 driver／model／flags；凭据不写入启动记录。原生计划和既有 headless 计划并存，默认原生输入可空，所有 CLI 使用同一工作目录、同一降权出口。原生入口明确拒绝 stub 和不支持 resize 的回退 PTY。
- Runner 注册表保留 256 条启动记录、最多 32 个同时运行；控制租约 30 秒，只允许取得控制的视图发送输入和 resize。浏览器视图标识由 cs-session 生成；关闭视图只 detach，显式 stop 结束一窗，释放容器停止全部。原生创建／结束不能经浏览器流绕过名册接口。
- `@xterm/headless` 6.0.0 与 serialize 0.14.0 保存解析后的 ANSI 屏幕；正常／备用屏幕、颜色、光标可恢复，回放含 throughSeq。每窗保留 500 行滚动历史；超过 2 MiB 的序列化结果缩至当前屏幕并标截断。不是截断原始 ANSI 后直接回显。
- 进程状态和连接状态分别返回；离线运行状态为 unknown，已知退出事实仍保留。状态 revision 防止迟到响应覆盖已结束记录。轮次开始／等待／完成不从 PTY 猜测，仍属 T15。
- 修复原浏览器在 Runner 未连上时订阅、或 Runner 断线再连后丢失广播的问题。连接关闭释放其输入租约，保留进程。session-client 保留 Runner 错误 code，明确拒绝与通信超时可区分；WS 二进制共享缓冲按发送快照兼容 DOM 类型。

自动验证：`nativeTerminal.test.ts` 验证两种计划、权限／MCP／Git 环境；`nativeSupervisor.test.ts` 用真实 PTY 验证并行、幂等、输入、尺寸、detach、单窗／整体结束和失败保留；`terminalScreen.test.ts` 做屏幕恢复而非字符串自证；`nativeTerminals.test.ts` 与 PostgreSQL persistence 测试验证受理、跨实例并发、丢回包、旧状态及重启；`terminalStreams.test.ts`、Runner WS 与 API-client 测试验证协议和流恢复。

真实镜像探针：2026-09-13，独立 `cs-task-runtime:rfc003-native`，worker 10001，临时工作目录，实际 Claude Code **2.1.268**／OpenCode **1.18.29**。Claude 默认交互界面接受系统提示文件与独立 session UUID，resize 从 100×30 到 120×40 后 Ctrl+C 显示再次退出提示；显式 stop 的退出码 129。OpenCode 显示原生 TUI、平台 agent 与固定模型，Ctrl+C 退出码 0。未注入模型凭据，没有模型产出，因此不构成 UX-AT-29 或 T15 的完整验收。

探针首次发现 OpenCode 在配置模型不可用时自动选 Big Pickle；修复后原生配置含顶层 model／small_model、enabled_providers 和 provider.whitelist，复验显示所选 Claude Sonnet 4.5。配置依据 [OpenCode 官方配置](https://opencode.ai/docs/config/#enabled-providers) 及其 [JSON Schema](https://opencode.ai/config.json)，不是对终端输出做关键词判定。真实 Linux PTY 最终 **4 pass／0 fail、25 assertions**。macOS 无 setsid，Ctrl+C 的进程组用例只在 Linux 执行，其他 PTY 用例仍在本机执行。

本批只交付后端和协议，不把它标为 T5 工作台已完成。本地最终 `bun run check` **710 pass／2 skip／0 fail**，712 tests、112 files、3330 assertions、71.75s；console build 660ms。两项跳过为 opt-in K8s 与仅 Linux 的 Ctrl+C，后者已在实际 Linux 任务镜像单独实跑通过；CI 在 Linux 再验证。本机专用开发 Pod 未配置 `CS_AGENT_ENV_FILE`，也未挂载模型配置 Secret，不能把凭据缺失造成的未执行当作 T15 正常验收。
