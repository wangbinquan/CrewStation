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

发布记录：`7290679dadc5315eae15e11b6f8a4576032779d7` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34733116499) 成功（check 1m3s）。

## 第五批：T5 原生工作台与个人布局

- 原生工作台替代同时展开六个功能面板的首屏：会话／数据／发布折叠到上下文行，实际版本关系用紧凑摘要，CLI、预览、代码和差异在工作视图中切换。真实预览 iframe 使用现有 previewHost，支持独立打开、刷新和重启；不把预览当成生产部署。
- 每次新增固定一个 clientRequestId，不要求任务输入。双击锁住同一次调用；明确受理前拒绝允许更改档位，通信结果未确认时重试原请求。真实名册轮询和 nativeTerminal 事件触发核对，某窗失败不清空其余窗口。
- dev-session 本模块持有个人布局表，GET／PUT 按当前 actor＋taskId 定位，revision 原子 CAS；16 个页签、每页签最多 32 窗、总引用最多 256。校验所属会话、唯一位置和有效页签，不持久化输出或赋予执行状态。保存串行化，迟到回执不覆盖后续编辑，冲突／网络失败保留草稿并提供重新应用或采用远端布局。
- 新建空页签不启动进程；支持命名、关闭、调整顺序、移动、收起、恢复和放大。Shared SplitGrid 提供横排／纵排／网格、可用宽度换行、最小高度、拖动／方向键调整与均分。布局偏好不会被窄屏自动改写。
- 终端先订阅再取有界 ANSI 屏幕快照，按 terminalSeq 去重并补接，序号缺口重新附着；输入不自动排队重发。显式取得控制后才接受输入／resize，关闭 UI 只 detach。新增 terminalResized 顺序事件让其他查看者保持真实尺寸；生命周期与本轮状态分离，T15 事件尚未接入时明确显示“进程在线 · 轮次未确认”。
- 修复前端忽略 Runner 断线／重连帧；Runner 可用代次驱动终端、文件树和预览重新查快照，会话元数据进行有界前台轮询。历史结构化会话独立路由带 L-id，保留消息、新建、取消及旧 shell，原有 `view=conversation` 接续原 agent 参数。
- 数据名称改为开发数据、生产数据只读、生产数据读写；批准与进程载入／应用选用不再混为一谈。完整 TTL、字段错误、撤销与现有配置接入待后续 T5 继续，未宣称这一分项已完成。

自动验证覆盖真实 PostgreSQL 跨实例 CAS／用户隔离／旧 revision、组件新建关闭页签／双击启动／拒绝恢复／原 UUID 重试、保存中继续编辑／迟到读取／回执丢失／显式冲突恢复、分屏键盘操作、终端附着缓冲／重复／尺寸／断线／缺口与 detach。真实浏览器四窗、两 CLI 模型输出、后台动态和全角色旅程仍待 T12／T15。

本机三个验收镜像已构建并导入 kind，新表迁移 Job `crewstation-rfc003-layout` 成功；滚动更新 API／session／controller／console 及新任务镜像 ConfigMap 被自动审批拒绝，理由为可能影响其他项目与活动会话、缺少集群范围的明确授权。更新尚未执行，已向作者请求该具体操作授权；没有绕过此拒绝，也没有切流或重启旧开发容器。本批浏览器生产实现验收尚未开始，不能以组件测试或设计附件代替。

本地完整门禁 `bun run check`：**723 pass／2 skip／0 fail**，725 tests、117 files、3389 assertions、61.57s；console build 746ms。跳过项仍为 opt-in K8s 与 Linux 专用 Ctrl+C；没有把跳过项目算作已验证。精确提交与 CI 证据在发布后另记。

发布记录：`897c3037de03b75b58b26a07cbc7f0eb5b940e4f` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34735101403) 成功。

## 第六批：T16 能力市场与应用可见性

- project L2 持有 `app_listings` 展示记录；老应用迁移和新应用缺省都是仅成员，0 版在首次修改时原子推进。用途／固定本地图标和可见范围共用 revision；数据库 CAS 拒绝并发覆盖，单独修改一种资料不丢另一种。只有负责人／管理员写，测试者沿现有 preview 查看角色读取范围，未获得开发或完整项目 view。
- 市场列表先在本模块 SQL 里按管理员、成员、全部登录或指定名单过滤，再做名称／用途搜索和稳定 ID 分页。不混入 APIProxy／EventProducer，不提供隐藏应用计数。游标绑定用户和查询；每页默认 20、最多 50。详情与列表使用同一可见性查询，后端没有授权缓存。
- capabilities L6 在已裁定范围后聚合真实 prod 部署记录，每次最多 4 个并发、单来源 2.5 秒截止。未上线不用 preview 地址代替；错误／不完整记录返回 unknown。聚合完成前再查一次范围；响应移除内部 serviceId，只有使用应用所需元数据。部署 ready 是保存的部署记录，不宣称实时健康。
- 全局 `/` 与 `/market` 是市场，开发项目保留在 `/projects`。市场详情不出现项目内部导航；开发者／负责人快捷入口按后端投影显示。负责人从 `/projects/:projectId/settings?tab=visibility` 配置范围、用途与图标，并检查指定账号在已保存修订中是否可见。其他项目设置与五项导航重组仍待 T3／T9，管理员供给入口待 T8／T10。
- 每次进入／聚焦／手动检查重新获取当前用户的数据，页面离开即回收市场缓存；前台 15 秒补查，查询失败与刷新期间不保留旧授权卡片。成功保存使市场查询失效。表单选择与保存分离，冲突保留本地草稿、展示服务器修订和范围，显式采用最新修订后才允许再次提交。查最新失败保留现有草稿，不卸载清空。
- 人员查找走项目内 `member-candidates`，不开放全局用户目录。邮箱或 UserId 精确查找最多一个注册身份；名单去重并验证存在、空指定名单有字段提示。真实库回归复现 identity 非唯一邮箱任意返回第一人，适配器同一行改为最多两条并要求唯一，稳定 UserId 查询仍可用。

自动验证包括真实 PostgreSQL 三种范围／角色／候选／跨实例 CAS／成员移除与分页，HTTP 登录／限额／no-store，正式版本投影、部分失败与聚合期间撤销，实际路由下首页／项目导航边界／正式链接／暂停状态、名单去重与取消、409 保留草稿、最新设置失败先红后绿回归。identity 重复邮箱同样先红后绿。

隔离浏览器排版验收：用实际 React／路由／样式与 `/private/tmp/crewstation-market-visual.mjs` 的内存夹具在 `127.0.0.1:8768` 实点；不访问共享集群。1280×720 六张应用卡片完整可见；390px 市场、390／320px 设置的 document scrollWidth 与 clientWidth 相等。指定名单空提交提示、精确查找、添加与保存第 1 版反馈已实点确认，浏览器无 error 日志。修正暂停应用同时显示“已上线”的误导，保留正式版本记录并隐藏打开入口。**这些只验证界面和排版，不能替代真实登录角色、prod 地址与配置持久化的集群旅程**；该旅程仍受已报告的服务更新授权阻塞。

最终本地门禁 `bun run check`：**740 pass／2 skip／0 fail**，742 tests、120 files、3491 assertions、63.21s；console build 628ms。首轮唯一失败是 RFC-002 的旧“我的项目”文案结构断言，已更新为 RFC-003 的两个全局入口；实际空间守卫与完整路由旅程继续通过。两项跳过仍是 opt-in K8s 和 Linux 专用 Ctrl+C。隔离视觉服务及临时页签已关闭，默认视口已恢复。本批尚未构建／部署到共享集群；不能与上一批 `rfc003-layout` 镜像混称已发布运行。


发布记录：`6b2325dedb0b202811e43039c2fdbd2e2d8b2807` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34737114376) 成功。

## 第七批：T15 状态来源实测与会话续传

修复历史回放与实时订阅之间的丢帧窗口，分页续接不再跳过未读取的历史；暂存溢出、读取失败均有明确恢复路径。浏览器命令等待完整握手，过期未发命令不会晚到执行；旧连接和重复帧不污染当前状态。新 Runner 启动时衔接原有事件序号，同一进程重连保持原序号。详见 [原生轮次事件实测记录](native-activity-evidence.md)。

真实 Claude 2.1.268 在无外网的一次性容器中接受脚本化模型响应，已验证正常、Stop 要求继续、直接取消、继续后取消。观察到 Stop 和 interaction end 各自不足以判定正常完成；HTTP Stop 的 block 计数还与实际继续行为不一致。没有把上述不可靠信号接成完成通知。OpenCode 观察插件初始化仍在排查，领域投影、个人已读与后台动态待继续，T15 不算完成。

本批最终 `bun run check`：**750 pass／2 skip／0 fail**，752 tests、123 files、3525 assertions、60.05s；console build 621ms。定向回归覆盖历史读取中真实事件到达、重复／临时帧排序、分页、缓冲溢出、失败释放订阅、迟到旧连接、握手前命令与过期命令，以及真实 WS 的新 Runner／同进程重连序号。跳过项仍为 opt-in K8s 与 Linux 专用 Ctrl+C；本批未更新共享集群。

发布记录：`b4ba3265b8dfd22abacb9abfca4042c637600e25` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34738267327) 成功（check 1m13s）。

## 第八批：T15 OpenCode 原生状态通道

OpenCode 1.18.29 的原生插件、严格观察协议、Runner 环回收集与序号归一化已接通，状态作为持久事件传到 session。正常完成以最终消息和 idle 联合确认；工具结束不会直接发完成，中断、模型失败、问题／许可的打开与解决分别呈现。撤回问题后没有最终回答时保留“结果未确认”，后续轮次的 busy 不会把旧轮次重新标成执行。父子会话、旧消息与重复帧有独立回归。

未知版本和通道失败只降级来源，原生进程仍可使用；模型与操作权限维持既有计划。镜像预装固定 SDK 与 npm lock，准备空私有／全局依赖目录时不覆盖已有用户配置；修正 recursive mkdir 新父目录仍归 root 造成 worker 无法访问的问题。新增 welcome 能力协商保留与旧 cs-session 的基本交互。状态帧有独立有界重放保留量，真实 WS 测试先红后绿复现并修复 PTY 输出挤掉开始事件。

真实镜像验收已使用正式仓内测试，**1 pass／0 fail、21 assertions**，覆盖普通回答、双 Esc 中断、问题答复／撤回、许可确认、模型 HTTP 400 和进程退出。模型为同容器内脚本化 Anthropic SSE 夹具，网络关闭；不是外部模型调用，也不等于后台工作台完成。细节、命令和边界见 [原生事件证据](native-activity-evidence.md)。Claude 的完整归一化、dev-session 投影／个人未读、顶部和页签动态仍未完成；共享集群没有部署本批代码。

最终本地门禁 `bun run check`：**772 pass／3 skip／0 fail**，775 tests、128 files、3599 assertions、64.22s；console build 570ms。跳过项是 opt-in K8s、opt-in 原生 CLI 和 Linux 专用 Ctrl+C；原生 CLI 已在隔离 Linux 镜像显式运行通过。普通门禁包含真实 PostgreSQL 的 nativeActivity 按 agentId／游标查询、真实 HTTP 收集／队列重试、协议兼容、WS 状态保留与真实 PTY 故障降级。最终任务镜像 `cs-task-runtime:rfc003-activity` 为 `sha256:6d6dbf82305b1fb62bb028d5a5f94681b0971c5fa7f3da014a59654182fb0906`，未导入或部署共享集群。

发布记录：`4b2a40901b5b5de05947656fec1a2a91ad65cd03` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34740556509) 成功（check 1m16s）。

## 第九批：T15 Claude 原生状态通道

Claude Code 2.1.268 已通过独立原生 hooks／OTLP 接收器、轮次证据归一化及有界 transcript 读取接入既有 nativeActivity 传输。逐 CLI 的随机通道、seq、turnOrdinal 与进程状态分离；旧轮次迟到结果保持原身份。正常完成要求实际交互结束与本轮最终记录相符，Stop 本身不触发成功，保留其他项目 hooks 的继续执行能力。后台投影与通知 UI 不在本批宣称完成。

实跑修正 SessionStart 的 HTTP hook 不受支持问题，改用私有 command，包含带引号路径的真实执行回归。真实许可通过项目自身要求确认的 Read hook 验证；保留正常原生审批方式。问题撤回由已结束轮次撤销待处理，首次模型请求被中断时只显示结果未确认；API 错误和继续后取消分别有对应状态。来源、上限和固定版本内部记录边界见 [原生状态证据](native-activity-evidence.md)。

自动回归覆盖最小字段解析、版本漂移、相同并行工具的关联歧义、主／子会话、旧轮次、trace 乱序／去重／保留边界、半行 UTF-8、文件截断／超大行、真实 HTTP 和心跳失效。已指定的用户 OTEL 目的地或策略不被覆盖，观察不兼容时 CLI 仍可启动。此前真实 `nativeSupervisor`／OpenCode 通道继续沿用，并共享状态编号逻辑。

最终本地 `bun run check`：**795 pass／4 skip／0 fail**，799 tests、136 files、3678 assertions、66.73s；console build 625ms。跳过项是 opt-in K8s、两个 opt-in 原生 CLI 和 Linux 专用 Ctrl+C。最终镜像 `cs-task-runtime:rfc003-claude-activity` 为 `sha256:341fa1b05abfaf5f15824fff89f374ecc7c98cb7f0cbdc4b4f0e75636274f665`，只挂载测试文件而不替换生产源码的镜像验收 **7 pass／0 fail、77 assertions、21.10s**，其中 OpenCode 六场景、Claude 八场景及 Linux PTY 全部通过。镜像未导入或更新共享集群，原有 QA Pod 和生产切流保持待授权；T15 领域投影、个人已读和后台 UI 继续实施。

发布记录：`3a438766a8e40e1f04f85398089872fa1f981e6d` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34742233061) 成功。

## 第十批：T15 状态投影与个人已读接口

dev-session 持有原生活动投影、历史和每位用户的已读位置。通过既有 Runner 端口按需补齐 session 持久事件，不跨同层导入。每次最多四批、每批 500 条、每次源查询 2.5 秒；跨实例按任务事务锁推进游标，重复区间可重放，不能跳过未读取区间。每个 CLI 最多保留 128 个轮次和 128 个待处理请求；动态保留最近 2000 条，截断明确返回，活跃问题及其个人已读不因历史清理消失。

最新轮次按独立 ordinal 选择，旧轮次仍能补齐自己的历史；重复完成、确定结果后迟到的未确认及过期问题不新增动态。结果冲突或源缺口保留状态未知，不制造完成；进程退出独立收拢待处理。实际 Runner 只读往返核对连接与代次，注册表的连接标记不单独当作在线证据。

GET `agent-activity` 提供有界页、最新状态、个人未读计数、截断及同步可信度；POST `agent-activity/read` 严格限定当前用户和指定 CLI／轮次的已有事件。查看不答复或批准原生请求，不清除别人的未读。名册返回状态附加字段；动态查询失败仍保留 CLI 名册，访问拒绝继续返回错误。HTTP 两个活动路径都验证了 no-store。

自动验证涵盖纯状态迁移、真实独立 PostgreSQL 的跨实例去重与 JSON、分页／保留边界、个人已读与未来游标拒绝、真实 Hono 装配／权限／故障隔离、客户端请求形状，以及源挂起后迟到结果不继续写入。第一轮完整门禁 812 pass／4 skip／0 fail 后补充长期待处理的清理边界；最终候选结果续记下面。本批还没有通知 UI 或共享集群部署，T15 整体继续实施。

最终本地 `bun run check`：**813 pass／4 skip／0 fail**，817 tests、140 files、3790 assertions、68.45s；console build 534ms。四项跳过仍为 opt-in K8s、两个原生 CLI 及 Linux Ctrl+C；运行时未改，上一批实际镜像证据仍有效。迁移 `dev_session/0005_native_activity.sql` 只随隔离测试建库应用，未更新共享集群。

发布记录：`0e658a7d89d647ff1bb46c2f16d15361a06bfb43` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34743902755) 成功。

## 第十一批：T15 窗口状态、页签与顶部动态

窗口区分执行中、需人工处理、本轮完成、中断、失败、进程结束与未确认，同时显示进程在线事实。页签按需处理、未读完成和执行数聚合；隐藏的 CLI 继续在全局动态中可见。顶栏 Provider 按身份隔离，进入项目后持续关注其开发会话，跨项目页面保留本次浏览期间的关注清单，最多 16 个；刷新整页从当前项目重新登记，未读本身仍在服务端保存。没有全项目枚举或后台无限订阅。市场使用者不会因此请求项目内部数据。

每 5 秒刷新一次，每次查询 12 秒上限；同任务合并在途请求，页面隐藏时暂停，重新聚焦补查，原生结构化事件另触发去抖刷新。较早未读页同样更新个人状态；已读返回后先收完旧查询，再重新取数，防止旧响应最终恢复未读。任务移除、身份变化和 StrictMode 清理后的迟到请求不写回。持续执行不重复通知；新动态不抢焦点或切页签。

活动查询补充 `unread=true` 与 `before`，和断线补齐的 `cursor` 互斥；返回 `previousCursor` 向前翻阅。最新状态与个人总计独立于当前结果页，仍遵守先授权、每页上限、历史保留和 no-store。顶部显示待处理问题、启动失败及未读轮次结果，列表按 50 条分段；来源不可用明确提示上次记录。查看不等于处理问题。

点击携带 projectId／taskId／agentId／terminalId／turnId／eventId／seq，恢复原页签或收起的窗口，保持已有排序，满窗时放进其他可用页签。核对目标事件或保留中的请求后才标记本人已读；旧会话／错误窗口不覆盖当前布局。焦点只随用户显式定位，后续代码或预览切换不会被保留的 URL 拉回；再次点击同条动态也能重新定位。

自动回归覆盖状态聚合与降级、一次性通知、查看不回答、旧请求／StrictMode、同用户已读竞态、更早结果页、完整菜单参数和焦点返回、隐藏窗口恢复与旧会话保留；市场路由的现有回归先发现并修正了市场详情参数误触发内部查询。隔离源码浏览器实看：1280×720 四窗可见，390／320px 文档宽度等于视口；后台完成后代码仍选中且文本可继续输入，隐藏的第 5 个 CLI 恢复，已读 1 次／停止命令 0 次。临时浏览器页和 127.0.0.1:8772 服务已清理。数据与 PTY 屏幕为界面夹具，不冒充共享集群验收。

最终本地 `bun run check`：**824 pass／4 skip／0 fail**，828 tests、143 files、3847 assertions、68.09s；console build 642ms。跳过项与上一批相同，运行时未改，不重复镜像验收。没有滚动更新共享集群、重启 QA Pod 或生产切流；T15 真实端到端旅程和 RFC 其余工作仍保留。

发布记录：`3e9bd2889679f718109a71a2c98f3345b25f8505` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34745541790) 成功。

## 第十二批：T3 五个项目入口与诊断上下文

项目左栏收为概览、开发、发布与上线、运行与诊断、项目设置；顶栏和左栏按实际项目查询显示名称／slug，市场页面不查询项目内部数据。开发页侧栏宽 156px，保留主工作区空间。app 装配 ProjectScope，业务页面不再要求租户父路由；管理空间路由复用尚待下一批。

设置由 app 组合 feature 根入口，保留 feature 间无导入：成员、可见性、配置、资源、仓库、生命周期。概览移出成员／仓库详情，入口仍可达；生命周期本批提供实际状态与技术关联，归档等动作留 T9。开发资源保留 API 文档／申请与事件订阅；原管理策略尚未迁出，T8 不算完成。配置默认开发组，环境与返回切换保持两组各自输入，项目 ID 改变则独立挂载。成员查找及配置校验／生效反馈仍待 T9。

旧 `/config`、`/catalog`、`/capabilities`、`/logs`、`/events` 使用 replace 到新分类，校验并保留适用参数，返回不在新旧地址间循环。API 的 proxy／operation 定位实际筛选且可清除，找不到目标不显示其他接口冒充；事件订阅带到对应清单。活动目标与历史对话参数保持既有逻辑。

运行诊断提供健康、日志、投递与 trace。日志把 source／slot／taskId／releaseId／since／limit 接入真实客户端请求，切来源清除无关条件，全部槽独立于 prod，支持单独清除固定上下文。健康可到对应槽日志；投递可到订阅或项目作用域 trace HTTP。订阅过滤如实说明仅在当前最近 50 条内，不能当作全历史搜索。Trace ID 格式首屏提示，非法值不请求，查询失败保留错误；告警／订阅、诊断完整交互和真实旅程待 T7／T12。

自动验证：真实路由树覆盖五入口、可读名称、停止概览多余查询、旧链接参数和返回、日志失败与清除／全部槽、API 定位与未知操作、订阅与 trace、配置双草稿／跨项目隔离和格式约束；客户端验证 trace 的项目路径与编码。浏览器使用真实源码加隔离内存数据，实看 1280×720 日志页面、320px 的筛选／成员表格／配置，以及 390px 环境返回恢复草稿；文档宽度分别等于视口。没有共享集群部署、迁移或生产切流。完整门禁结果续记下面。

最终本地 `bun run check`：**836 pass／4 skip／0 fail**，840 tests、144 files、3910 assertions、68.39s；console build 610ms。四项跳过与上一批相同，运行时未改，不重复镜像验收。临时 127.0.0.1:8773 服务与本批浏览器页已清理，视口已恢复。本批没有更新共享集群，T3 管理空间及 T7／T9 的剩余内容继续推进。

发布记录：`b70846149f659bc7953de012acaa7a1e77ea0f41` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34746898824) 成功。

## 第十三批：T3 管理接入项目复用

app 为 `/admin/integrations/:projectId` 装配概览、开发、历史对话、发布、诊断和设置，复用各 feature 的公开页面，不引入 feature 互相依赖。shared 定义空间路径与已有开发定位参数校验。接入列表直接进入管理项目，历史会话返回、发布／日志／订阅跳转和全局 Agent 动态都携带正确空间；数字人设置专用的市场可见性不出现在接入项目中。

项目边界根据实际项目类型选择空间。旧租户接入项目链接以 replace 转入对应管理页面并保留有效参数；数字人误入管理项目路径时转回工作台。等待项目元数据和适用的管理身份时不挂载业务页，访问拒绝不发起内部工作台查询；元数据失败提供重读入口，暂时读取失败且有有效原数据时保留当前表单。未知页面继续保持 404，不借兼容跳转吞掉错误。

管理员进入接入项目后，侧栏保留五项项目操作与返回接入列表，全局八项工具折叠在“平台管理”内，避免窄屏整页都被导航占满；全局管理页仍展开。开发侧栏 156px。后台动态记录项目空间，离开接入项目后仍能直接定位原管理 CLI；查看不回复请求，也不取得终端控制。

自动验证覆盖实际路由树下的管理列表／项目页、两方向兼容跳转、历史 agent 参数、无效可见性参数、非管理员直接访问、身份及项目元数据等待／错误／重试、未知范围拒绝，以及离开管理项目后的动态定位。隔离真实源码浏览器在 1280×720 实点接入列表到开发与管理菜单；390px 和 320px 检查折叠菜单与设置，document scrollWidth 等于 clientWidth。没有连接共享集群或写入项目数据。

最终本地 `bun run check`：**846 pass／4 skip／0 fail**，850 tests、145 files、3954 assertions、66.56s；console build 620ms。四项跳过与上一批相同，运行时未改。临时 127.0.0.1:8774 服务和本批浏览器页已清理、视口已恢复。管理全局能力／审批归位和新建仍待 T8／T10，两个集群操作仍待授权，不据此宣称 T3 或 RFC 已全部完成。

发布记录：`90d14c47052f0984cb60da4a8a354af424002abc` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34747830391) 成功。

## 第十四批：T8 管理能力目录与两类审批

管理空间新增 `/admin/capabilities`，包含接入容器、API 开放策略和事件来源；新增 `/admin/requests`，按 API／出站分栏，状态与可选项目范围进 URL。旧 `/admin/integrations`、`/admin/api-catalog` 使用 replace 到对应分类并保留适用上下文；接入项目返回新列表，事件来源可打开管理项目。app 组合各 feature 根导出入口，管理守卫仍在原布局，不由兼容跳转替代。

项目消费页保留 API 文档、申请及处理事实，移出平台策略、撤销和审批。管理员的上下文链接带 projectId／proxy／operation 到管理目录。全局目录未选调用方时只显示平台策略，不把缺失的 granted 当未授权；选定项目从实际 serviceId 取服务投影。所选项目未知、元数据失败或尚无服务时不降级成平台全部操作。变更策略明确对所有服务的影响，撤销确认带准确项目和操作；默认开放时明确撤销定向记录仍可调用。

API 申请由成功回执收起表单，失败保留理由；500 字约束首次可见，超限本地字段提示且不发请求。管理 API／出站意见在切换页签后各自保留，写入目标随本次命令传递，重复审批受进行中锁约束。刷新失败可保留上次记录与草稿，但暂停审批；恢复成功后继续。访问拒绝不保留旧列表。两来源独立读取与重试，某类失败不冒充空列表；管理员可以查看各状态历史。出站规则仍在 `/admin/egress`，有明确的审批往返入口，申请行显示真实项目名称及技术 ID。

新增真实路由回归覆盖新旧入口、参数、守卫待定／失败／拒绝、全局与服务投影、准确策略／撤销命令、审批失败／成功／缓存刷新、双草稿、字段约束及刷新恢复。申请失败丢理由和共享 InlineConfirm 在展开后忽略 busy 都先红后绿，后者补共享回归；两个首次路由测试失败源于测试误选了顶栏语言下拉，修正为目标控件后通过。未把重跑本身当成产品修复。

隔离真实源码浏览器使用内存管理数据，1280×720 检查接口策略／明确撤销目标，390／320px 检查审批草稿恢复及表格可达。修复确认说明挤破 GET／路径列，以及旧输入 flex-basis 在新字段容器中变成 180px 高度；复验输入高约 36px。接口和出站宽表只在自身区域横滚，document scrollWidth 等于视口。没有发出共享平台的策略或审批写入；临时 127.0.0.1:8775 服务和页面已清理，视口已恢复。

最终本地 `bun run check`：**861 pass／4 skip／0 fail**，865 tests、148 files、4049 assertions、66.09s；console build 652ms。四项跳过与上一批相同，原生运行时未改。结构化 API 试调、完整新建向导及共享集群旅程仍待继续，T8／T10 与 RFC 不标完成；两个已报告的待授权集群操作未执行。

发布记录：`6c86d8f4a892be38800706c58722e836bea17232` 已同步 main。截至下一批准备时，按精确 SHA 查询 Actions 与 check-suites 均为空；工作流仍 active、Actions enabled。没有据此宣称 CI 通过，继续核对后续调度证据。

## 第十五批：T10 创建选择与实际开通输入

修复两个界面选择不生效的断点：project 原来校验套餐后丢弃，platform 原来忽略项目模板、固定传 minimal-sample。新增可空 `project.projects.initial_plan`，新建时保存已校验套餐，旧行保持 NULL；单项目内部查询返回实际名称、模板和初始套餐，归档／不存在则不再开通。现有并发任务配额继续按真实请求落库，创建失败提供字段定位。

SCM 只在首次初始化的模板副本中改 `spec.service.plan`，校验 Manifest 后保留其他原始字段；模板源不动。同名套餐无需重写，改套餐时 YAML 注释不进入重写结果。旧调用未提供初始套餐时保持原有复制行为；远端已有默认分支的失败重试只补标签保护，不重新铺模板。非法 Manifest／套餐在首次推送前失败。

管理员模板目录来自当前控制面实际可复制的源码，返回名称、Manifest kind、原套餐和无默认值的配置／密钥键。两个现有接入源码按仓库原位置进入控制面镜像；未搬动源目录、未裁定发行包布局 I8，也未更改既有 bootstrap-integrations 脚本。模板读取失败与空目录分别返回失败／空列表，重复名称和非法 Manifest 明确报错；自定义模板根不会暗中混入仓内模板。

套餐落库与首次提交内容先写回归并观察到红，再修到绿；覆盖默认值、旧 NULL 行重试、名称／模板保持、配额、非法输入、复制源不变、远端已有分支不覆写。目录验证覆盖三类真实源码、缺失／非法／重复根、空目录、HTTP 身份边界与 api-client 请求形状。第一次目录测试把复制目标也放在被扫描根内，返回多一个真实模板是正确行为；测试改为复制前检查自定义根，未改产品迎合断言。最终门禁和镜像证据续记下面。

最终本地 `bun run check`：**868 pass／4 skip／0 fail**，872 tests、149 files、4085 assertions、87.95s；console build 739ms。跳过项与上一批相同。本地构建 `cs-control-plane:rfc003-project-creation`，镜像 `sha256:9db3dcb611a4f75a5e41219a0edf8ecfee7efd2c8648fb1b83d94f87e7036272`；以 `--network none --rm` 实际读出三种模板、复制 reference-api-proxy 后 Manifest 套餐为 standard-large，临时容器自动清理。未导入共享集群、未执行数据库迁移或滚动更新。前端向导、开通完整路径及其余 RFC 任务继续实施，本批不标 T10 完成。

发布记录：`c0b0c89ed5c7ff06dcf358078fc2d44ed7a4276f` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34749454609) 成功。`git merge-base --is-ancestor` 已确认它包含 `6c86d8f`；后者没有独立运行记录，不将后继结果称作后者的精确 SHA 运行。

## 第十六批：T10 管理空间新建向导与开通恢复

工作台项目列表移除平台创建表单，保留新建数字人的管理链接；管理总览分数字人／接入容器两个入口，能力接入列表直接新建接入容器。app 路由装配 projects 的公开表单与开通页，仍由既有 AdminGuard 统一守卫，不新增 feature 互相导入。数字人固定 DigitalWorker，接入容器只允许 APIProxy／EventProducer；切类型清掉前一种模板。

向导按基本信息、模板与资源、检查并创建三步呈现。负责人、模板和套餐均来自真实目录；模板按类型过滤，服务套餐显示 CPU／内存，复核显示副本上限；可选任务配额空值省略，保留平台默认语义。名称、slug／保留名、负责人职责、模板、套餐生效及配额约束在首次出现该字段时说明。每个无效字段有错误和可访问关联，提交时聚焦当前步骤首个错误，不依赖 HTML 原生提示或仅禁用按钮。

前后步骤、创建失败和目录刷新失败均保留输入。服务端 field／issues 返回对应步骤；未知错误留在表单级，不猜字段。目录不可用时暂停下一步／提交，恢复后继续原选择。在途创建禁用输入／返回并有 ref 锁防重发。确认页说明真实模板所需配置／密钥，成功后 replace 到新项目开通页，不因创建返回就显示链路全绿。

开通页读取项目实际状态与原因：provisioning 仅称开通中，active 只称项目资源已开通，首发构建／部署必须去发布查看；排队 202 不冒充状态变更。失败可到生产配置、重排、开发和发布；接入项目保持管理路径，数字人转自己的工作台页面。开通中按现有 5 秒机制重读；失败重排后的观察最多 60 秒，转为 active／paused／archived 即停止。刷新失败停止写入入口，保留可重读的错误。列表中的管理员开通操作统一进入管理状态页。

原工作台内嵌创建表单的回归先红后绿。新增 7 项真实路由测试覆盖类型范围、全部必填错误／配额越界、步骤草稿、准确创建请求、空配额默认、服务端字段错误、目录失败／恢复与空目录、单次在途提交、非管理员守卫、非法项目、真实 failed／202／active 和管理项目恢复路径。整页测试加类型与 lint 通过；完整 `bun run check` **875 pass／4 skip／0 fail**，879 tests、150 files、4168 assertions、70.97s；console build 585ms。跳过项与前批相同，原生运行时未修改。

浏览器使用 127.0.0.1:8776 隔离源码与内存数据，已显示桌面基本信息、实际填写的名称／负责人，以及设为 390px 后的纵向表单。服务器实际返回 200；浏览器导航／CDP 交互多次超时，未完成资源／复核／状态的完整实点、320px 验证或 DOM 尺寸度量，因此本批视觉验收仍未完成。临时页面关闭、视口复原、服务清理；没有共享集群写入。T10 全链路、其余 RFC 任务与待授权集群操作仍保留。

发布记录：`e798f5ad70a6f8c1e33e6230617253e12cfb65cb` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34750215916) 成功。

## 第十七批：T9 配置输入保留与生效反馈

配置表单的值原来在发起保存后立即清空，服务端返回 503 时已经无法恢复。真实路由回归先观察到该故障，改为等待实际保存成功再清值；失败、目录暂不可用和开发／生产页签切换保留输入。字段统一使用 FormField，删除重复输入样式，键名规则首屏可见，非法值有字段错误、可访问关联与焦点。空字符串保持现有有效写入能力，明确空值覆盖含义。

填入普通配置时预填 API 返回的值，密钥不预填旧值；密钥输入和空值含义独立说明。覆盖提示按当前真实键清单与输入名计算，改名不会继续显示旧键的覆盖说明。保存或删除进行中统一锁住同环境的编辑、清空和其他变更，ref 锁阻止重复命令；每个请求仍携带确定的项目和环境。目录读取失败保留草稿但暂停写入，重读恢复后继续；版本历史失败单独显示，不能冒充没有版本，也不阻断已有配置列表的使用。

成功回执显示实际取值组、键和返回版本，删除显示实际目标；说明现有进程不会自动加载，新任务容器在创建时注入开发配置、后续发布注入生产配置。源码依据为 `modules/task-runtime/application/containerEnv.ts`、`modules/release/application/pipelineEnv.ts` 和 platform 的 config 端口装配；保存未冒充部署或上线。尚未新增当前两槽版本的配置影响明细、离开设置／选择其他键时的草稿导航确认，也未完成成员定位和生命周期，T9 继续实施。

新增 4 项整页回归覆盖 503 保留／成功清空与实际版本、键名错误／焦点／有效空字符串、普通值与密钥、双环境失败草稿、准确生产路径、在途锁、目录失败恢复和版本历史独立失败。沿用前一批浏览器故障的明确边界，本批没有宣称新增完整视觉验收或共享集群旅程。

最终本地 `bun run check`：**879 pass／4 skip／0 fail**，883 tests、151 files、4211 assertions、75.96s；console build 632ms。四项跳过与前批相同，没有改动原生运行时。现有真实 PostgreSQL／GitLab 路径在本轮执行，两个待授权共享集群操作未执行。

发布记录：`0f942826417debce3d6589a64900d7b131e02552` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34750838656) 成功。

## 第十八批：T9 成员定位、角色说明与生命周期

成员设置默认复用已有精确账号／邮箱匹配接口，失败保留查询，目录故障和无唯一匹配分别显示。先选择具名用户，再赋已有角色；保留高级完整 UserId 输入与管理员用户目录，未新增身份查找或成员写入后端。所有格式及角色职责首屏可见，目标错误有字段关联与焦点。当前负责人不能直接移除或降级，只有管理员可以转移；转移确认明确新旧负责人、旧负责人降为开发者的既有后果。

原移除按钮直接发送 DELETE，先写路由回归观察到实际发出请求，再改具名两步确认，取消不写入。成员保存和移除共用单项目在途锁；失败保留目标和角色，成员清单刷新失败保留输入但暂停变更，恢复后继续。成功按实际返回身份与角色提示，刷新成员、项目、当前身份及市场查询；普通开发者仍只读，表单按 projectId 隔离。共享的 MemberLookup 增加可选选择错误与禁用状态检查，市场原有使用方式兼容。

生命周期页接既有管理员 POST archive，只在 active／paused／failed 可操作；开通中、已归档和非管理员分别说明。确认写实际项目名称与 slug，失败可重试。源码核对 `modules/project/application/archiveProject.ts`、`modules/project/domain/project.ts`、`modules/gateway/wiring.ts`：归档更新状态并异步移除路由，仓库与数据保留，未接开发会话释放或容器清理，当前没有恢复接口。页面明确这些后果，不把状态归档称为运行资源已删除。

新增 8 项真实路由回归覆盖精确查询／无匹配／目录失败、角色含义与保存失败保留、高级 ID 校验与跨项目隔离、管理员目录和负责人转移确认、具名移除取消、已展开确认的写入锁、清单失败恢复、普通开发者只读、归档对象／取消／失败／成功及状态限制。与导航定向合计 19 pass，随后完整门禁包含市场既有回归。

首次全量在受限沙箱执行，本地 socket 和测试数据库不可用，另有 `model` 局部变量误中 RFC-001 既有源码扫描；改名为 management 后，在正常本机权限下执行有效完整门禁。最终 **887 pass／4 skip／0 fail**，891 tests、152 files、4285 assertions、68.23s；console build 626ms。跳过项与前批相同，没有修改原生运行时。

隔离 8777 真实源码页面在页签清单中加载出成员设置标题，但导航和可访问接口超时；本批未取得可用截图或完整交互证据，不称视觉验收完成。服务已停止；浏览器内核重置后标识变化，未确认临时页签清理。没有实际平台成员／归档变更，也没有执行两个已拦截的共享集群操作。实际生产配置版本影响、草稿导航确认及其余 RFC 内容继续实施。

发布记录：`71338776f45c88e725f6722eb3fb70b7c849251b` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34751732636) 成功。

## 第十九批：T9 配置版本影响与草稿导航保护

生产配置页读取实际项目、两个槽及各自当前 Release，不拉无界发布列表；对照取值组的最新保存版本与 Release 的 configVersion。分别显示正式／待验证版本、槽状态和配置快照，说明 Manifest 决定实际注入键、保存不会加载到已有进程。空槽、缺失记录、读取失败、Release 身份／服务／SHA 不一致和历史早于部署记录均明确呈现，不将未知显示成未部署或版本一致。刷新只重读项目、槽、生产版本历史和当前 Release；两条发布记录独立失败，失败后不沿用旧比较结论。

原配置表单选择其他键立即重挂载，先红用例观察到草稿被旧保存值覆盖。现在换键与清空必须确认，取消保留输入；成功保存才更新基线，不留下虚假的未保存提示。两环境继续常驻独立保留，隐藏环境有草稿也会在离开时提醒。共享 UnsavedChangesGuard 处理设置页签、项目、其他路由及返回；一次只确认第一个目的地，取消不导航，确认才离开，不使用会冻结调试工具的浏览器模态框。刷新与关闭会丢失尚未保存输入，在页面明确说明；已经发出的请求仍可能完成，返回需刷新核对。

7 项新增回归覆盖换键／清空取消和确认、失败草稿、保存基线、隐藏环境、重复导航、跨项目和返回键，以及实际两个配置快照、版本乱序、记录不一致、数据失败／恢复和未开通服务。初始返回测试使用的 createMemoryHistory 不处理 BACK 阻断；核对已安装源码后，改用正式 createBrowserHistory，夹具仅替代底层 History 存储与 popstate 调度，取消／确认返回均通过。这是适配器自动验证，不是实浏览器验收。

配置与导航定向 **22 pass／0 fail、169 assertions**；最终 `bun run check` **894 pass／4 skip／0 fail**，898 tests、153 files、4349 assertions、70.92s；console build 715ms。跳过项与前批相同，真实本机 PostgreSQL／GitLab 用例已执行。本批没有新的视觉证据，没有共享集群变更；代码编辑和其他设置草稿保护、其余 RFC 内容继续。

发布记录：`42b40d66ed013af6c518a873ffb5a0a09cb04d90` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34752711479) 成功。

## 第二十批：T5 编辑器草稿、读写回执与离开确认

先红回归确认原 useFileEditor 在换文件时直接请求覆盖草稿、同轮快捷键重复发送 writeFile、换任务通道时仍展示旧文件。现在每个通道的编辑状态归入 FileEditorStore，命令发出前同步登记操作和序号；迟到读取、旧保存及卸载后的回执不污染后来状态。保存期间不能换文件／重载／关闭或重复保存，但可以继续输入；回执只更新已发送内容的基线和对应文件版本，新输入仍标未保存，成功保存不重置 CodeMirror 文档和光标。

文件树选另一文件、重载与关闭使用具名应用内确认，默认焦点在继续编辑，取消不更换内容。确认读入失败仍保留原草稿；缺少版本或错文件回执显示结果未确认。冲突继续使用原文件 expectedVersion；收起提示不会变成无版本覆盖，重新载入成功才更新基线。连续读取只接受最后请求；读取期间继续编辑会取消这次读入，避免新的输入被迟到内容覆盖。

工作台持有草稿，代码、预览和 CLI 切换不卸载它；代码页签与底栏显示未保存及页面刷新／关闭的生命周期。路由离开、浏览器返回以及旧 view=conversation 跳转都先确认；同工作页内正常定位参数可继续。释放确认单列本页面未保存编辑器文件，说明不在 Git 预检清单中；文件读写在途禁用确认，返回结果后再由用户决定。没有把草稿、Git 未提交与未推送混成同一个状态，也不改变其他 CLI 的生命期。

新增 6 项 hook／提示组件和 3 项完整路由回归；整页使用真正 TaskStreamSocket 和 CodeMirror，只在 HTTP／WS 边界替换确定性服务响应。覆盖 StrictMode、保存中继续输入、冲突、读取失败、重复操作、通道变化、卸载、畸形回执、隐藏代码草稿、取消／确认路由和返回、旧链接、释放前材料与等待。整页验证发现并修复 FileTree 根节点漏传 disabled；测试还修正 happy-dom 默认 about:blank 的 URL 基址和“保存”误匹配“未保存”页签的问题，不改生产行为掩盖夹具故障。

定向 **15 pass／0 fail、115 assertions**；最终 `bun run check` **903 pass／4 skip／0 fail**，907 tests、155 files、4437 assertions、71.68s；console build 616ms。跳过项与前批一致，未改原生运行时。本批没有新增实浏览器证据，也没有更改共享集群；T5 数据访问完整表单、T6 发布统一及其余 RFC 工作继续。

发布记录：`4687a49144f6156b38e61fd7d8bc1804fb5aa0ae` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34753432392) 成功。

## 第二十一批：T5 数据访问申请、审批、撤销与草稿

原申请缺少期限输入及字段错误，先红用例确认缺口后接入共享 FormField。理由／意见最多 500 字，生产访问期限整数 5–1440 分钟、空白沿用现有 120 分钟且从批准起计；开发绑定不发送生产期限。全部约束首屏可见，多个错误同时定位，失败保留输入，成功以真实回执更新基线。申请、批准、拒绝、撤销共用会话写入锁，读取失败保留材料但暂停写入；切到新任务使用独立查询键和组件状态，不闪回旧记录或草稿。

负责人在实际绑定详情中具名确认，列出申请人、理由、保存的申请期限、决定及到期时间；取消和失败保留意见，状态已变不能沿用旧确认。DTO 新增可选 ttlMinutes 并返回既有存储值，旧服务未返回时明确未知，批准暂不可用；不是猜一个默认值让负责人确认。记录默认收起详情；开发者可申请但无管理动作，缺服务与只读身份有具体说明。生产只读和读写可同时存在，撤销一个绑定不声称撤销全部其他授权。

界面严格区分授权、凭据和应用使用。`modules/data/application/taskBindings.ts` 的 approved／active 代表审批／角色凭据配置；`envForTask` 返回有效绑定，装配到 `modules/task-runtime/application/containerEnv.ts` 的容器创建注入流程。本批未增加运行中环境热更新或应用数据源探测，因此所有相关 UI 仍明确“容器加载／应用连接未确认”，不把批准变成预览已选生产。开发默认连接独立于额外绑定记录，撤销记录不删除开发库或默认连接；到期角色按本次读取时间先显示过期，不等待后台清理才失效。

申请和每条审批意见汇总成页面草稿，收起仍保留；与编辑器一起形成一个离开确认，取消后两个区域都保持原输入。释放前提示未发送表单且等待在途数据操作，避免把这些输入混进 Git 清单。查询每 5 秒按已有机制刷新，页面不可见暂停；失败时旧记录显示未确认，不继续显示当前有效生产授权。

新增 8 项表单及 1 项真实工作台路由回归：期限边界／默认值、全部错误、准确请求、在途锁、失败保留／恢复、实际期限审批、拒绝、具名撤销、共存授权、过期、权限／服务缺失、旧 DTO、确认期间状态变化、同项目换会话隔离以及数据与编辑器合并导航。既有真实 PostgreSQL 数据用例增加申请与批准时长断言。定向 **12 pass／0 fail、102 assertions**；最终 `bun run check` **912 pass／4 skip／0 fail**，916 tests、156 files、4508 assertions、75.75s；console build 689ms。跳过项与前批相同。本批没有新的实浏览器证据、共享集群变更或运行中数据源完整旅程验收，T5／T9 和整个 RFC 仍在实施。

发布记录：`b28272ce295d772ee04118e5a5dfc81052be57a8` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34754481575) 成功。

## 第二十二批：T6 确认 SHA 贯穿发布来源

真实 Git 回归复现了检查与推送之间其他 Agent 提交的问题：原入口用 HEAD refspec 推送，会把后来提交发布。现在实际检查结果固定为 CS_PUSH_SHA，执行时只推这个提交；旧调用方不传确认字段也使用服务端检查值。新的开发发布请求另带 expectedTaskId 和 expectedCommitSha，HTTP 解析保留字段，任务替换或检查时 HEAD 已变化则拒绝，不对新对象执行推送。

release 的既有 tagger 端口经 platform 装配将确认 SHA 传给 scm。scm 先核对远端分支 HEAD；已变化时返回 conflict，未创建标签。核对之后分支继续前进时，创建标签仍使用刚确认的完整 SHA。字段可选兼容已有 CLI／MCP；新确认 SHA 只接受完整 40／64 位十六进制，不能拿缩写或分支名作为已确认对象。设计 §2.4 已记录这项具体落位，没有新增模块、迁移或改动层级。

新增 5 项回归：会话／HEAD 陈旧拒绝、真实临时仓库在检查后前进且远端只收到确认提交、远端打标竞争、契约字段保留／格式边界、两个客户端路径的准确请求；原真实 PostgreSQL 发布链和真实 GitLab 打标用例验证确认 SHA 的存储与拒绝后无标签副作用。首轮客户端测试误写 services 发布路径为 /publish，按既有 /releases 路由修正夹具，不改业务路径。定向 **35 pass／0 fail、156 assertions**；完整 `bun run check` **917 pass／4 skip／0 fail**，921 tests、158 files、4540 assertions、96.53s；console build 608ms。跳过项与前批相同。

本批只完成发布来源底层，不把它标为统一发布界面、上线／回退或 J3 旅程完成。没有新的实浏览器证据，没有操作共享集群、生产槽或 QA 会话；后续继续唯一来源向导及实际发布状态页面。

发布记录：`09cef2d555197e9b4af4e85c8248565f8c5e30fe` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34754984474) 成功。

## 第二十三批：T6 唯一发布准备与实际发布定位

开发页移除第二套发布表单及其逻辑，准备发布只跳转对应空间的 release?source=session。发布页默认可按需打开 repository 来源，远端发布不读取容器工作树；两个来源都经确认来源、检查结果、版本与发布三步。开发来源展示实际任务、分支、HEAD 和 dirty 文件，不提供替换分支的下拉；无会话、分支未附着、没有完整 SHA、Git 不可用和 dirty 均有明确原因。远端来源重读所选分支；首次目录故障恢复后可直接确认默认分支，不要求重复点击。

确认页记录实际检查时间、完整 SHA 和任务身份，说明构建／配置／迁移尚由发布流程验证；生产数据及迁移后果在最终动作旁明确呈现。工作台总是发送上一批接通的 expectedCommitSha，开发来源另带 expectedTaskId。回来后发现来源变化或读取失效，旧确认立即禁用；请求期间的变化仍由服务端重新检查。版本候选按真实标签计算，既有显式标签阻止提交，实际受理 tag／SHA 为准，不自动另选版本。

版本与说明的约束首次可见，多个错误同时显示、聚焦首个错误；返回步骤、切来源、失败和重读不清草稿。关准备、离开或返回均使用共享应用内确认；同页来源切换保留输入。检查与提交共用同步锁，连续表单提交只发送一次。已发送请求在离开后仍可能完成，但旧回执不会把用户拉回原页；错误服务或 SHA 回执显示未确认并指向历史核对，不冒充成功。服务端 dirty 清单也保留显示。

受理后定位到真实 releaseId，详情单独读该发布并在进行中刷新。未知 ID、读取失败或错服务记录不选择最新发布替代；状态文案区分受理／构建／迁移／部署／历史就绪，没有计时器模拟进度。历史标签可重新选择，构建与迁移日志携带精确 releaseId，接入项目始终保持管理路径。两槽并列、就绪试用入口与具名上线／回退仍在下一批，不把当前详情当成 J3 完成。

新增 8 项向导／详情路由回归及 1 项真实工作台入口回归，后者使用 TaskStreamSocket 与 CodeMirror，验证草稿确认、session 来源接续和零停止／零推送命令。目录恢复、全部字段错误、重复标签、实际请求、失败保留、迟到回执、角色、管理空间、未知记录和焦点刷新后陈旧来源均覆盖。定向 **13 pass／0 fail、154 assertions**；最终 `bun run check` **926 pass／4 skip／0 fail**，930 tests、159 files、4654 assertions、76.01s；console build 成功。跳过项与前批相同。本批没有新的实浏览器证据或共享集群变更，RFC 保持实施中。

发布记录：`0a2d3ca67f6be80720f1488c73e5d51f36779099` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34755994609) 成功。该批 console build 727ms。

## 第二十四批：T6 上线确认的两个版本与并发一致性

原 expectedActiveRelease 只检查 truthy 值，不能表达首次上线时“仍无正式版本”；请求也没有锁定待命槽里的具体发布。现在 null 明确表示确认过空正式版本，expectedTargetRelease 固定目标，两者都在领域函数中核对；省略字段仍兼容旧 CLI／MCP。确认已失效时先返回 precondition，不进入迁移兼容性判断或写入，界面可刷新后重新让用户确认。权限、物理槽角色和破坏性迁移策略没有修改。

实际 PostgreSQL 回归还复现了两个事务同时读到旧槽状态、第二个请求越过确认的问题。UnitOfWork 的事务 scope 读取 service_slots 时使用 FOR UPDATE；普通 read scope 仍是无更新锁查询。同一行的确认、更新、切换记录和领域事件处于原事务中，第二次请求等前一个提交后再读取事实。已有发布、部署、失败处理的槽更新均从事务 scope 先读再写，继续使用当前状态。

新增两个领域边界、一个契约和一个真实数据库并发用例。并发用例只在测试库暂停第一事务，直接观察 PostgreSQL 锁等待后继续，验证普通查询仍可读、最终一成功一 precondition、仅一条切换记录和一个事件；没有用重跑或概率断言掩盖并发结果。原完整发布→部署→上线→回退模块用例也验证首次空值和固定目标。定向 **8 pass／0 fail、71 assertions**；最终 `bun run check` **930 pass／4 skip／0 fail**，934 tests、161 files、4670 assertions、75.08s；console build 621ms。跳过项与前批相同。

本批只完善既有切流接口的确认保证，尚未完成两槽并列、具名上线／回退 UI 或真实 J3 旅程。没有新的实浏览器证据、共享集群写入、生产切流或 QA 会话变更；后续接入统一发布页。

发布记录：`765d36fe1e1dfa40b6ba446a85d08f964a54189c` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34756543952) 成功。

## 第二十五批：T6 实际部署、具名上线／回退与交叉并发

发布页顶部并列正式／待验证版本，读取实际槽记录并显示完整 SHA、标签、地址与就绪副本；错误或身份缺失显示未确认，旧缓存不继续提供访问入口。只有实际槽就绪、有副本且身份完整才可试用；历史 ready 记录只定位详情，不能任意回退。确认重新读取两槽及两个发布，校验服务、ID、标签与 SHA，再冻结来源与目标。较早创建且仍在待命位置的目标显示回退；显式说明不恢复生产数据、最终兼容性由服务端判定。首次上线发送 expectedActiveRelease:null，目标总带 expectedTargetRelease；错误、变化或未知状态需重新确认，不自动重发。切换受理仅显示已登记及网关异步生效，不冒充实际访问通过。

概览的旧切流按钮和独立实现已移除，所有上线操作进入发布页。发布说明与切换说明共用项目级同步写入锁和一份离开确认；各自草稿在取消、失败、内部选历史及收起另一表单后保留。500 字约束与字段错误可见并聚焦；两种写入相互排斥，重复点击只发送一次，离开后的回执不导航回旧项目。受理发布后保留切换草稿并按真实 releaseId 展示详情。切流后重查槽、发布／切换历史、工作树对正式版本比较和差异详情。版本与历史按当前项目有界查询；共享 usePollingRefetch 的先红回归发现原来隐藏页仍刷新，现后台暂停、恢复前台立即补查，停用与卸载清理监听。

后台先红用例复现了旧待命槽仍 ready 时允许在另一发布 pending／building／migrating／deploying 阶段切流。切流现于槽锁中检查进行中的发布，阻止后续流水线覆盖已变为线上的位置；失败后可以重新确认原就绪目标，未产生多余切换或事件。另一真实 PostgreSQL 回归让两个发布同时完成外部打标，原实现登记两条流水线；现在槽 initialize 仅插入缺失行，不覆盖已有 active／版本，加锁后复查，仅一条发布、一个入队与一个事件。另一标签已在外部创建，冲突明确返回 createdTag 和正在进行的 releaseId，不删除标签或改版本重发。正常已上线后继续发布的既有完整模块回归也通过。

新增 10 项发布页路由／真实查询回归、1 项后台轮询回归、2 项 PostgreSQL 回归。覆盖首次空版本、固定双 SHA、迁移拒绝、陈旧确认、缺副本／错身份／错回执、草稿和角色、管理路径、在途双操作、比较失效以及进行中发布定位。前端定向 **24 pass／0 fail、262 assertions**；后端定向 **6 pass／0 fail、68 assertions**。最终 `bun run check` **943 pass／4 skip／0 fail**，947 tests、164 files、4797 assertions、73.60s；console build 603ms。跳过项与前批相同，本批未改原生运行时。

上述界面证据是实际路由与 React 组件、HTTP 边界夹具，不是实浏览器或共享集群 J3 验收。没有执行被拦截的共享服务更新和 QA 首次 prod 切流，没有变更 QA 会话。T6 完整旅程及其他 RFC 项继续，下一批补 T7 告警／订阅入口。

发布记录：`7d561808b3ea8c16d5f1d31980b9c4295629cec1` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34757872066) 成功。

## 第二十六批：T7 告警、通知订阅与诊断接续

运行与诊断新增告警页签，调用既有项目级 alerts 与 alert-subscriptions 端点。最近 100 条明确限定范围，触发中／已恢复筛选和 alertId 进入 URL；查询失败、错项目和未知记录不伪装空态或改成最新告警。详情只显示真实触发／恢复时间。健康告警从本模块已写入的标准 key 导出可选 slot，未识别的 key 或其他告警类型不从 detail 文字猜关联；对应入口打开该角色当前日志并说明没有当时 releaseId。接入项目保留管理空间。

通知订阅按成员姓名／邮箱选择并显示完整 User ID，旧手填 ID 能力保留；编辑已存在订阅固定对象，每用户／项目仍是一份配置。工作台／Webhook 渠道、地址和完整 ID 的要求可见，全部错误同时显示并定位；保存前重读并显示原配置与新配置，移除具名确认当前用户与渠道。取消、失败、收起、内部筛选和放弃换编辑对象都保留草稿；离开诊断页签或项目先确认。读取失败保留表单并停写，双击检查／写入使用同步锁；保存后再读取失败与保存失败分别呈现。已发出请求离开后仍可能完成，但回执不会改变当前页面。

现场源码核对 `modules/platform/wiring.ts` 的 composeAggregates：Notifier 只有 logger.warn，没有按订阅发个人消息或 Webhook。页面据此明确通知投递尚未接通，204 只说明订阅配置保存，不提供假发送／送达状态。T7 沿用已有接口而未新增通知传输基础设施；新请求 Schema 只是把原 HTTP 请求体形状收进 contracts，路径与授权动作不变。生产资料和现有订阅没有被实际修改，也未通过工具发送任何通知。

新增 8 项完整路由回归、1 项客户端请求回归、1 项领域上下文回归；既有真实 PostgreSQL 模块测试验证返回实际 slot。界面定向 **8 pass／0 fail、101 assertions**，客户端／模块定向 **22 pass／0 fail、84 assertions**。最终 `bun run check` **953 pass／4 skip／0 fail**，957 tests、165 files、4904 assertions、76.93s；console build 618ms。跳过项与前批相同，没有原生运行时修改。

本批未取得新的实浏览器或共享集群 J4 证据，两个被拦截共享操作仍未执行。完整 T7／T12 旅程与其余 RFC 项继续，下一项实施 T8 从开发容器发出的结构化 API 试调。

发布记录：`61b3c1d30ac3a22b83eadc3a699d32e79624e835` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34758815651) 成功。

## 第二十七批：T8 结构化试调后端与跨副本通道

新增项目开发会话的 api-invocations POST、对应客户端与 Runner invokeApi 命令。开发授权先于环境／目录查询；expectedTaskId 固定会话，方法／代理／路径取当前可调用操作，路径参数逐项匹配，查询允许重复值。目录查询后再次检查会话和服务，实际请求只发给固定任务。新 hello 能力在 socket 派发前核对；未配置或旧容器明确拒绝，普通 CLI 不受影响。跨副本转发保留结构化错误码，响应固定 taskId／operationKey；无效回执或传输失败明确结果未知，不自动重发。

TaskRunner 从既有 CS_INTERNAL_API_BASE 发出原生 HTTP 请求，沿服务网关使用所在 Pod 身份；没有命令行拼接、任意目的 URL 或浏览器直调。契约明确请求／响应体各 64 KiB、头各 16 KiB、URL 8 KiB、15 秒包含读流；3xx 不跟随、4xx／5xx 原样返回，文本视图和头分别标注截断，耗时由实际请求测量。响应与参数不写入运行日志。Bun 1.3.13 的真实 TCP 先红用例复现中途断线重复 POST（writes=2）；关闭连接复用后 writes=1，工作台客户端、API 到 session、跨副本转发及 Runner 上游四段均为试调设置有界且不复用的请求。问题与 [Bun 官方仓库报告](https://github.com/oven-sh/bun/issues/28706) 一致，以本仓 TCP 回归为当前版本证据。

新增 18 项回归：输入边界、目录／授权变化、固定会话／服务身份、旧容器无 socket 写入、跨副本拒绝码、响应截断与 15 秒超时、同期 CLI 可读、TCP 断线不重发及客户端准确路径。后端／客户端定向 **33 pass／145 assertions**；真实 Runner HTTP／WS **5 pass／29 assertions**。结构文档预留的 tests/e2e 首次纳入根 typecheck，两个跨进程用例使用隔离 PostgreSQL、两个 session 副本、真实 HTTP 客户端与 TaskRunner；等待断开回调后再删测试库，避免清理与注销争用。

最终 `bun run check` **971 pass／4 skip／0 fail**，975 tests、169 files、5012 assertions、92.79s；console build 613ms。跳过项与前批相同。另以已有 Linux 任务镜像 `sha256:341fa1b05abfaf5f15824fff89f374ecc7c98cb7f0cbdc4b4f0e75636274f665` 只读挂载本批源码、network none，HTTP／WS 回归 **5 pass／29 assertions、15.22s**；包含原生 Bun 的截断、超时与断线不重发。首次镜像验收因只挂载部分新契约缺少 activity 入口失败；补全只读契约挂载后通过，没有把缺模块当作代码成功或部署证据。

本批尚未接详情表单与 Swagger Execute，不宣称 T8 已完成。跨进程自动测试中的目录与目标 HTTP 是夹具；共享集群中的真实源 Pod 身份／放行表、J5／T12 仍待验收。两个被拒绝的共享操作未执行，原 QA 会话保留。

发布记录：`435019fcc6afbc8378e846e35e59ed7e02df45fe` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34760440343) 成功。

## 第二十八批：T8 详情试调、Swagger Execute 与输入生命周期

项目开发资源中的已授权操作新增试调表单：原始路径值、JSON 查询／请求头、可选文本正文；全部约束与字段错误在表单显示，打开或恢复后聚焦输入。开始编辑时核对当前项目的运行中会话并固定 taskId；会话替换、读取失败、目录变化或失去开发权均保留输入并暂停发送，重新检查和绑定是明确动作。响应严格匹配 taskId／operationKey，展示真实 HTTP 状态、容器耗时、文本视图及独立截断标记；失败不清空输入，未知回执不冒充业务未执行。请求进行中防止重复发送，离开时说明业务请求不会撤销，迟到结果不把用户带回原页。

实际 Swagger 5.32.15 的 Try it out 先绑定会话，Execute 使用自身参数序列化后调用同一后端接口。目标地址、路径和方法与当前可调操作核对，拒绝无法表达的文件／form／高级路径输入；目标服务没有浏览器直连。响应在当前 Swagger 操作内也明确会话、容器耗时与截断。Bundle 按需加载，扩展使用它注入的 React 18.3.1，避免工作台 React 19 元素导致真实操作区渲染失败；使用原始生成请求展示，避免缺少浏览器拦截器结果造成响应区崩溃。扩展点对照 [Swagger 源码](https://github.com/swagger-api/swagger-ui/tree/v5.32.15/src/core) 并用实际安装 bundle 验证。

详情和各 Swagger 操作分别记录草稿版本，共用一份离开确认。成功响应只清除该操作已发送的版本；其他操作、详情、在途继续输入都保留保护。先红回归复现了参数防抖未提交时，旧响应清除新输入标记并允许直接离开的故障；改为捕获原生输入事件后通过。收起保留，换操作／代理／重新加载前可取消；后台文档变化或读取失败保留旧文档与输入并暂停 Execute。身份更新调整 Swagger 写入口，恢复后不丢输入。目录卡片和文档收紧间距，文档与长响应使用内部滚动；本批未取得新的实浏览器尺寸测量。

新增 16 项回归：3 项转换／输入边界、6 项真实路由表单、7 项实际 Swagger 组件交互。含真实序列化、业务 422、截断、旧会话、目录错误、错回执、测试者、权限刷新、文档／代理切换、跨操作输入、在途修改与重复 Execute。定向 **19 pass／0 fail、119 assertions**（含既有申请回归）。happy-dom 为 Location 增加与浏览器一致的可枚举字段，点击夹具补实际 focus／blur 过程；未替换 Swagger 序列化器或 Execute。最终 `bun run check` **987 pass／4 skip／0 fail**，991 tests、172 files、5118 assertions、97.83s；console build 521ms。跳过项与前批相同，本批没有改运行时，不重复 Linux 原生验收。构建的 Swagger 独立 chunk 按需加载；Node 专用 absolutePath 导出产生外置 path 提示，调用界面未使用它，输出的 CommonJS 互操作已核对。

本批仍不是实浏览器或共享集群 J5／T12 验收。没有更新共享服务、迁移共享数据库、首次 prod 切流或重启／释放 QA 会话；两个被拦截操作和其他 RFC 任务仍保留。

发布记录：`be8f4cc8923657f354a26ea890857b79faa4d323` 已同步 main；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/34763312138) 成功。

## 第二十九批：T9 应用设置与成员表单的草稿保护

先红回归复现了可见性／展示资料切分区丢输入、读取失败仍能保存、取消直接清空和连续 submit 重复写入。两张表单现在由同一页面容器管理独立编辑器，共用一份离开确认；成功仅清除所属草稿，取消显示具体表单，确认后只还原这一份。保存中保留字段且不重复提交，导航确认说明已发送请求仍可能完成；迟到回执不导航回原项目。字段错误可定位，后台设置修订变化保留本地输入与服务器材料，必须明确采用最新修订；读取失败时保存和采用修订都暂停，重读成功不会自动保存。

身份或设置查询失效不卸载已有编辑器；确认失去负责人角色后，保留已输入内容供核对并停止写入。只读用户初次进入仍为说明视图。指定名单切到其他范围再回来保留查找文字。成员表单同样将查找文字、ID、角色和已选目标放在稳定的编辑器中，离开前可取消；只使用当前选择方式的目标，避免保留了隐藏 ID 后误提交它。刷新成员同时重查身份与成员清单；身份读取失败、角色撤销、管理员转移确认期间失去管理员身份均暂停对应操作并保留材料。旧成员写入锁、具名移除、三种角色和管理员目录能力继续保留，后端接口未改动。

新增 7 项应用设置与 5 项成员真实路由回归。独立保存、取消范围、字段错误／焦点、全部读取失败、修订冲突、模式切换、角色变化、转移确认、重复提交、浏览器返回与迟到结果均覆盖；仅 HTTP 边界用夹具，不替换路由、Query、Mutation 或共享确认组件。现有取消与跨项目用例更新为先确认再清空／离开，保留原断言。定向 **27 pass／0 fail、216 assertions**；最终 `bun run check` **999 pass／4 skip／0 fail**，1003 tests、173 files、5225 assertions、89.42s；console build 471ms。四项跳过与前批相同，未改原生运行时；候选源码在门禁期间保持一致。

本批没有新实浏览器尺寸测量或共享集群验收，没有更新共享服务、迁移共享数据库、切流或重启／释放 QA 会话。T9 完整视觉与真实旅程仍待 T12；继续 T10 与 T11，RFC 未完成。
