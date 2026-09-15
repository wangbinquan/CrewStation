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

本地提交：`4d15e8c6e08ca8e0670733ec769506c529efc688`。普通 `git push origin main` 被自动审批拒绝，理由是默认分支发布授权不足。只读核实当前任务原始 role=user 消息（目标“完整实现RFC并提交上库”）及 active goal 后，以相同推送操作重新请求审查，仍被拒绝，审查方不接受日志作为当前授权依据。已请求用户明确确认这笔推送；没有换分支、换工具或间接推送。该提交尚无远端 CI，最后已发布 SHA 仍为 `be8f4cc`。

## 第三十批：T10 创建草稿与套餐目录编辑

创建向导使用一份 shared 离开确认，覆盖返回管理页、浏览器历史与改变创建范围；空白表单直接离开，失败保留草稿。请求固定当次名称、标识、负责人、类型、模板与资源选择；有效匹配的 ProjectDto 才解除草稿保护并接续实际项目开通页。未知／错对象回执保留复核材料并提示先核对项目列表，不自动重试。正常成功只接续一次；用户确认离开后的迟到结果由组件生命周期隔离，既不返回旧页面，也不再次创建。创建目录刷新期间暂停提交，所有步骤输入保持页面内存。

服务套餐与任务容器套餐保留原目录端点，统一复用 admin 内部的资源编辑器；未把两类目录混为同一个资源。名称、CPU、内存、服务最大副本或任务存储以及说明全部保留，原来只有 disabled 按钮、直接 submit 仍可写空值的问题由字段校验修复。名称按原 Slug 契约，数量字符串非空并给既有示例，最大副本为正整数；未增加后端数量语法或资源上限。所有错误同时可见并聚焦首项。现有 AdminField 仅扩展可选 hint／error 与可访问关联，其他管理表单行为保留。

列表按名称进入编辑；新建或重新载入已编辑项前可保留未保存输入。准备保存先读实际目录，展示具名新增或整体覆盖、新旧资源值以及生效条件；最终确认再读，若同名项变化则只更新材料，明确未写入并等待再次确认。该链仍是原 upsert，读取与写入之间没有服务端 CAS 保证；不声称自动合并并发修改。查询、写入、取消与编辑在进行中互斥；离开后已经发出的保存仍可能完成，而尚在确认读取阶段的迟到查询不会启动新写入。目录或保存回执无效时保留输入，不显示空目录／假成功；已确认保存后读取失败则并列显示真实成功与查询失败。服务在下次发布采用资源值，运行中的任务容器保持原规格。

新增 5 项创建与 8 项套餐真实路由回归，覆盖原有开通接续、字段与原生 submit、目录／写入／回执失败、三步和类型切换、独立目标、对照变化、读写互斥、浏览器返回、离开与迟到结果。创建定向 **12 pass／0 fail、141 assertions**；套餐 **8 pass／0 fail、60 assertions**。最终 `bun run check` **1012 pass／4 skip／0 fail**，1016 tests、174 files、5343 assertions、97.94s；console build 483ms。四项跳过与前批相同，未改原生运行时；21 个候选源码路径的哈希与删除状态在门禁前后保持一致。此前 `4d15e8c` 的推送确认仍待用户回答，后续本地提交不视作已获远端发布授权。

管理待办与 T11 有界摘要、T12 完整视觉／共享集群旅程仍未完成。没有新的实浏览器尺寸测量、共享数据库迁移、服务更新、切流或 QA 会话变更。

本地提交：`7c046bf5b87bd6747de1bd775b13d1236b90305a`。未推送、无该 SHA 的远端 CI；此前推送确认仍待用户回答。

## 第三十一批：T11 基础分页与项目摘要后端

project L2 新增本模块 SQL 分页投影：授权范围、类型、名称／slug 文字搜索、开通状态、负责人筛选先于 LIMIT，默认 20 项、上限 50，项目／服务／当前角色一次联查；多取一项生成稳定 ID 游标。游标绑定当前账号、管理员身份与筛选，角色和成员变化不会沿用旧范围。负责人名字按当前页去重、每批最多四个读取，名称查询失败不影响基础项目。新增基础分页 HTTP 与 API 客户端；原全量列表兼容既有调用方。

capabilities L6 新增摘要列表与单项目详情，只经 platform 注入公开读接口。会话读 task-runtime 已有记录，不向 Runner 发命令，也不把 connected 当作 CLI 正在思考；两槽与实际健康独立响应，缺失／失败／非法回执各自 unknown。详情只含本服务最近五笔实际发布和五笔切流，分别保留来源失败。每页最多四个在途来源读取，2500ms 可选聚合预算后不再启动剩余读取；先做本页会话与版本，避免慢健康阻塞这些材料。未完成项保持 unknown，迟到回执不改已返回快照。基础分页和最后作用域复核不包含在此预算内，没有声明整个 HTTP 请求的绝对时限或取消已发出的调用。

最终批量复核当前页项目和角色，撤销则移除，降级或服务变更则清掉旧内部摘要；测试者只保留原列表已可见的基础信息。HTTP no-store，服务端无摘要缓存。platform 单项目服务解析改为公开定点读取，移除开发会话及摘要／诊断解析时的全平台 listServices.find；不修改集群或进程。project 现为 39 个生产源码文件，dev-session 仍为 40，未新增模块、层级例外或迁移。

新增 4 项真实 PostgreSQL 分页／HTTP、8 项聚合边界和 1 项客户端请求回归。覆盖翻页去重、文字筛选、作用域变更、源回执／超时、实际并发上限、部分结果、迟到结果、角色降级、错误作用域、历史所属服务、精确路径与筛选参数。分页定向 **4 pass／39 assertions**；capabilities 含既有市场／说明测试 **13 pass／80 assertions**；客户端新增用例通过。最终 `bun run check` **1025 pass／4 skip／0 fail**，1029 tests、176 files、5448 assertions、96.82s；console build 509ms。四项跳过与前批相同；27 个候选源码路径在完整门禁期间保持一致。

本批尚未接项目列表、概览主动作与管理待办界面，T11／T10／T12 仍未完成。重新载入 CUA 文档成功，但读取浏览器清单在 30s 后超时并重置内核，没有产生界面证据，未重复同一操作。无新实浏览器或共享集群证据，两个被拒绝的共享操作和 main 推送确认继续保留。

本地提交：`936f31aae30b63cba1816e1341eaa0c83531947d`。未推送、无精确 SHA CI；远端最后核实仍为 `be8f4cc`，这三笔本地提交都没有远端发布证据。

## 第三十二批：T11 紧凑项目列表与状态驱动概览

租户列表只请求当前页摘要，不逐项目取会话、服务、槽或健康；名称／slug、开通状态和负责人条件进 URL，变更条件回第一页，下一页与浏览器返回恢复对应范围。当前页负责人或自己可按可辨识名称选择，未扩展全平台人员浏览。项目基本资料、角色与开通状态并在一列，其余列显示开发、两版本、独立健康和下一步；原命名空间、创建时间、完整负责人 ID 仍可展开。旧列表与槽组件及未引用 CSS 已移除。表格用既有内部滚动容器，概览三列在窄屏变为纵排；没有以 CSS 源码替代实浏览器尺寸验收。

概览优先给管理员开通恢复、最新失败发布定位或当前开发入口，主动作只导航到真实操作页。会话的生命周期与连接分开，版本的实际就绪与健康分开；生产和试用入口只来自当前有效的就绪槽并提示共用生产数据。需要处理／确认区链接到具名发布或当前项目诊断，最近发布与切流各保留五笔真实记录，不再有第二套发布或切流表单。active 文案改为“已开通”，避免误当运行健康。测试者没有内部开发主动作。

每个来源以 checkedAt 判 30 秒有效期；身份错误、摘要错误、没有项目、筛选空结果与未知数量分别显示。先红测试复现初始身份失败时被 disabled query 遮成无限加载及本页 0 项，修复后显示真实错误且不请求摘要。复制开通需求只复制可人工补充的模板；复制失败展示可手动选取的文字，不声明已申请。读取失败可保留旧记录，禁用依赖这些状态的直接访问与主动作；旧回执、过期和部分未知均不冒充最新状态。

页面进入立即重读；前台每 30 秒及从后台返回时，先读取身份，再读取当前摘要，后台和卸载停止周期读取。未应用的搜索输入不因刷新丢失。查看身份组合根时发现它仍通过 listProjects 逐项取服务与角色；已改为 project 本模块一次成员联查，保留原完整成员关系、当前角色和撤销效果，不改变身份接口形状。

新增 10 项真实路由交互回归和 1 项真实 PostgreSQL 成员投影回归。界面含既有轮询回归 **11 pass／81 assertions**；项目页／成员定向 **5 pass／45 assertions**，类型检查通过。最后门禁与构建结果续记本节；当前没有新的实浏览器或共享集群证据，main 推送确认仍待回答。

最终 `bun run check` **1036 pass／4 skip／0 fail**，1040 tests、177 files、5533 assertions、98.37s；console build 505ms。首次完整门禁中的旧创建用例禁止列表存在任何 form，与新增搜索表单冲突；打印整个 DOM 又导致持续巨量错误输出，因此终止该次已失败的测试进程。断言改为没有创建字段、不发创建请求，并保留原管理入口接续；创建和列表定向 **22 pass／219 assertions** 后重新完成门禁。没有删除原业务断言或仅凭重跑掩盖失败。36 个候选源码路径的哈希与删除状态在最终门禁前后保持一致，构建后的唯一变更为测试断言。四项跳过与前批相同；本批仍无新浏览器、共享集群或远端 CI 证据。

本地提交：`a1a16107bed76891e089198e2bfc9cf1378944b7`。未推送、无精确 SHA CI；远端仍为 `be8f4cc`，先前 main 推送确认继续待答。

## 第三十三批：T10 管理待办的有界申请读取

API 与出站申请增加独立 `/page` HTTP 和客户端接口，保留原全量接口形状和原角色边界。项目、裁定状态先于 SQL LIMIT；默认 20、上限 50，多取一条判 nextCursor，按 createdAt／ID 倒序稳定翻页。游标固定账号、管理员身份、项目、状态和来源，锚点申请被裁定后仍可续页；新增申请在重新读第一页时出现。非法参数、跨范围游标和当前无权项目明确报错，两条读取均 no-store。

分页结果带真实 projectId 与可选的当前项目名称／slug／类型。project 新增最多 50 个 ID 的公开基础批量读取，不逐项取负责人，不改变原摘要的负责人补充；低层申请模块经注入端口取得当前页资料，不查别的模块表。名称读取失败或身份不匹配时保留申请与项目 ID，API 申请同时核对原 serviceId。为两张申请表增加四种过滤／排序组合的索引迁移，只在隔离测试数据库验证，未迁移共享集群。project 仍为 39 个生产源码文件，api-catalog 为 33、egress 为 24，无结构例外。

新增两类申请各 4 项真实 PostgreSQL／HTTP 回归、1 项基础关联查询和 1 项客户端回归。覆盖默认值、上限、同时间排序、跨账号／筛选／项目、角色变化、锚点裁定、新申请、名称读取失败及旧接口兼容。申请、项目和客户端定向 **36 pass／199 assertions**，类型与架构检查通过；最终完整门禁与构建续记本节。管理总览及申请、项目管理 UI 的接入继续，不能据本批后端就标记 T10 或 T11 完成。

最终 `bun run check` **1046 pass／4 skip／0 fail**，1050 tests、179 files、5608 assertions、98.85s；console build 496ms。26 个源码／迁移路径在完整门禁前后保持一致；跳过项与前批相同。没有迁移共享数据库、更新共享服务或取得本批实浏览器证据。

本地提交：`704f4ff3f7145ab4db07aa0ddf987d1ee98fcf45`。未推送、无精确 SHA CI；先前 main 发布确认继续待答。

## 第三十四批：T10 管理待办与项目目录

管理总览现有 API 待审批、出站待审批和项目开通失败三个独立来源，每类请求五条，分别展示加载、错误、空态、读取时间和还有更多；当前数量不冒充平台总数。申请项目名称来自本页后端资料，缺失时保留 ID；点击进入该项目的待审批范围。开通失败进入具名开通页。总览没有新增审批或重试开通的写按钮，原九类管理入口压缩间距。

新增 `/admin/projects`、侧栏与总览项目管理入口，承接全部类型。接入容器目录复用同一 admin 内部组件，通过服务端固定 APIProxy／EventProducer 范围。每页 20，名称／slug、类型、负责人和开通状态进入 URL，条件变化回第一页，下一页与浏览器历史恢复范围；负责人选择来自当前页与本人，不拉全平台人员目录。名称、类型、负责人、开通状态和管理动作并列，原 ID／命名空间／创建时间可展开。成员／生命周期链接去实际设置页，接入项目仍留在管理空间；开通状态独立于运行健康。

只读摘要按账号隔离缓存，进入重读，前台每 30 秒和恢复可见时先查身份再查来源，隐藏与卸载停止周期读取。查询失败保留材料并暂停具体管理动作，非法回执、未知数量、无匹配各自显示；未应用的搜索不因刷新丢失。管理身份查询失败新增实际重试入口，确认撤销后停止读取目录。页面明确拥有可见性刷新，禁用 Query 的额外默认焦点刷新；冒泡可见性事件回归保证本页只刷新一次。生产全局 Query 配置本已禁用默认焦点刷新，测试默认配置不同，本批没有把这点写成已发现的生产双请求故障。

新增 7 项实际路由回归，包含三源部分失败／恢复、先加载后失败、空态、分页与历史、筛选类型／状态、错误回执、管理动作、身份失败／撤销、前后台恢复、搜索保留和卸载清理。与既有管理、新建、空间分隔定向 **44 pass／334 assertions**；加入完整冒泡事件后与发布向导、项目摘要定向 **25 pass／243 assertions**。类型与架构检查通过，最终门禁与构建续记本节。没有新实浏览器尺寸测量，CSS 换行与内部滚动不作视觉验收证据。申请管理页与 API 调用方选择仍使用旧目录接口，接下来迁移；T10／T11／T12 和待授权操作继续保留。

最终 `bun run check` **1053 pass／4 skip／0 fail**，1057 tests、180 files、5671 assertions、98.46s；console build 494ms。第一轮完整门禁发现另一个旧管理项目导航夹具仅提供全量列表，导致新目录中点不到测试项目；补齐新分页回执后保留全部原导航断言，与目录定向 **16 pass／102 assertions**，再完成完整门禁。33 个源码候选在最终门禁前后保持一致，构建后的改动仅为旧夹具适配。没有新实浏览器、共享集群或远端 CI 证据。

本地提交：`3dbe02abdd93c702c7c6ee36574a2472cf56f75c`。未推送、无精确 SHA CI；远端仍为 `be8f4cc`，main 发布确认继续待答。

## 第三十五批：T10 API 调用方分页选择

管理 API 的调用方目录改为每页 20 项的名称／标识搜索，三种项目类型均可选，搜索和目录游标保存在 URL；不再拉全平台项目列表。当前选择通过实际项目详情独立读取，页外项目保留具名选项，翻页、搜索及返回不改变 serviceId。未知项目、资料错误或尚未确认时不挂载策略操作，也不自动切成平台全部接口。目录故障与已选资料故障分别展示，前者不抹掉另行确认的调用方；清除调用方是显式操作。

目录与当前资料按账号隔离查询，手动重读先核对身份，再分别读取；该编辑入口没有增加周期刷新。未应用搜索在重读和翻页时保留，清除搜索同时清掉输入与目录条件。既有策略确认、定向授权撤销和准确服务／操作目标保持。新增 3 项真实路由回归，与管理能力和目录定向 **21 pass／0 fail、175 assertions**；类型检查通过。最终完整门禁与构建续记本节。

两类申请页仍需迁移分页并处理审批意见的离开保护，T10／T11 与 T12 完整旅程继续。没有新实浏览器尺寸证据或共享集群操作，未重试被拒绝的 main 推送。

最终 `bun run check` **1056 pass／4 skip／0 fail**，1060 tests、181 files、5706 assertions、98.42s；console build 608ms。12 个候选源码路径在完整门禁前后保持一致，跳过项与前批相同；本批没有原生运行时改动。远端仍未包含这一候选，不能以本地门禁替代精确 SHA CI。

本地提交：`ef986db1dea760fab0ebff81759d543be827ecba`。未推送、无精确 SHA CI；main 发布确认继续待答。

## 第三十六批：T10 申请分页与审批意见保护

API 与出站审批接到各自真实分页客户端，只读活动页签的当前 20 项，状态及项目先由后端筛选。两种来源在 URL 保存独立 apiCursor／egressCursor，切页签保留范围，改变状态或项目清掉两种游标；无效游标可回第一页恢复。页面展示本页数、读取时间、真实错误和当前项目名称／slug，缺少名称保留实际 ID，不拉全平台项目目录。两类当前行均可进入相应项目申请范围。重复申请、错项目资料或不属于当前筛选的回执作为读取错误，未知数量不冒充零。

意见按申请 ID 留在页面内存，同一查询范围内两种表单常驻，切页签保留各自输入；页码、项目、状态变化或离开共享一份确认。输入为空但裁定仍在途时也受保护，确认离开不会撤销已发出的请求。读取失败保留意见和上次材料，暂停裁定；403 等拒绝后移除旧申请行，但输入副本仍可核对。刷新导致原申请不在当前待审批记录时，具名副本单独展示，可复制／清除，既不自动提交也不宣称服务端尚未执行。

裁定固定当次申请和意见；前端同轮重复点击只有一次 POST。回执须匹配申请 ID、服务／项目、操作／域名、决定及意见；不匹配提示结果未确认，保留输入且不自动重试。有效成功失效原授权／申请／出站规则缓存，只清除目标申请的原样意见，其他草稿保留；用户确认离开后的迟到结果不改变新页面。API 意见仍可选、最多 500 字；出站沿用既有首屏必填 1–500 字说明。编辑入口不增加定时或默认焦点刷新。

新增 9 项实际路由回归；与能力入口、管理目录、调用方和两空间路径定向 **47 pass／0 fail、358 assertions**。覆盖分页、两游标、双页签、过滤／返回确认、错误与拒绝、名称缺失、重复和错对象回执、原样清除、重复提交、空输入在途保护及迟到结果。返回键用仓库现有的浏览器历史适配器夹具验证；内存历史本身跳过 BACK blocker，未把那次测试配置失败记作生产导航缺陷。类型、架构、lint 通过；并把既有两个管理读取回调的依赖改为显式方法和账号，消除 lint 警告。最终完整门禁与构建续记本节。

当前管理页已不再使用旧全量项目／申请读取，原兼容端点仍保留。没有新实浏览器尺寸测量或共享集群旅程；T10／T11 的完整验证与 T12、main 推送及两个共享操作 blocker 继续保留。

最终 `bun run check` **1065 pass／4 skip／0 fail**，1069 tests、182 files、5815 assertions、128.19s；console build 627ms。24 个候选源码路径在门禁前后保持一致，lint 无错误和警告，四项跳过与前批相同。回看 T5／T14 接续时确认开发 URL 的 view 尚未驱动原生布局，file／target 未完整接入；这是下一批待修代码缺口，不能把余项全部归为外部验收。

本地提交：`3dadb0e7b72de0eeb319460dd610bdf21ee4e3f2`。未推送、无精确 SHA CI；main 发布确认继续待答。

## 第三十七批：T5／T14 开发地址、文件定位与比较目标

开发页的 cli／preview／split／code／diff 现在驱动原生工作区，显式地址优先于个人布局；changes 保留兼容。文件和 Agent 链接在视图省略时定位对应区域，target 单独存在时进入差异；旧会话或不存在的 CLI 不会在新对象上继续定位。普通 CLI 链接只恢复真实名册中的窗口，不启动、停止、输入、取得控制或标记已读；完整动态链接仍经原事件校验。新页签、名册恢复和并排预览同时更新实际地址，空 CLI 工作区也能显示并排预览。

文件树、发布预检、释放前清单和差异文件接到真实 readFile，携带作用域或原会话约束。删除项不提供文本打开入口，差异二进制仍保留自身展示。视图／文件变化写入浏览器历史，关闭文件只清当前地址；返回视图保留编辑器草稿，不重复读取同一已打开文件。不同文件的导航先具名确认，取消保留地址和输入；写入尚未结束时只能取消导航，收到保存回执后重新确认，保存期间的新输入保留。已经确认的读取失败或缺少文本不清掉旧草稿，也不把畸形结果当作空文件。

实际定位测试发现 Router 的 location 与 route search 分开订阅时可能先获得新导航标识、后获得新参数，使一次性定位消费了旧参数；改为从同一个 location 快照同时取地址与参数。此前 file／target 根本未解析且 view 未驱动布局，初始定向回归先红后绿。这些是实际交互修复，不将其描述为仅文案更新。

比较面板可选择生产或待验证，使用各自真实查询键、回执目标、标题、计数与详情文案；补历史也使用所选目标。错误目标或会话回执作为错误，顶部概况继续使用生产基准。进入和重新聚焦重查，保留既有 10 秒前台轮询与文件变更去抖。

新增 13 项回归，与编辑器、原生工作台、动态定位及共享配置／可见性／审批／创建／成员草稿定向 **82 pass／0 fail、741 assertions**；包含中文路径、无效参数、浏览器返回、关闭／失败／在途写入、原会话保护、只定位 CLI、预检入口和目标比较。架构检查通过，最终完整门禁和构建继续。没有新实浏览器尺寸测量、共享集群部署或完整角色旅程，T12 及三个外部操作 blocker 保留。

最终 `bun run check` **1078 pass／4 skip／0 fail**，1082 tests、183 files、5900 assertions、102.21s；console build 518ms。确认面板的渲染目标保存在 React state 后，lint 无错误或警告；该调整后文件导航与配置定向 **16 pass／139 assertions**，再完成完整门禁。26 个源码候选在门禁前后逐文件哈希一致。跳过项仍为 opt-in K8s、两个 Linux 原生 CLI 状态用例和 Linux Ctrl+C；本批未改动这些运行时。未部署、未推送，也没有该候选的远端 CI。

本地提交：`c8e4894a4843ec20656048a5aae6b15aaad84359`，未推送。当前已向用户列明从 `4d15e8c` 至 `c8e4894` 的九笔普通 main 推送范围，回答前不执行；这项确认不包含共享集群部署或生产切流。

## 第三十八批：T5 预览故障恢复与 T12 逐项证据核对

按验收清单回到实际源码，发现原生预览区缺少 UX-AT-05 要求的日志入口；原状态 hook 还存在较早查询覆盖后来事件、重连／换任务保留旧就绪、同轮双击重复重启、重启失败被随后的成功读取清掉，以及畸形状态变成“未启用”的问题。五项初始回归全部先红，分别观察到这些行为后再修复。

预览状态改为单个连接世代的可订阅快照，旧回执不能跨清理或覆盖新事件；任务／连接变化重查，断线与未确认状态移除可用预览地址。预览事件和读取结果均按实际契约检查，错误不渲染成正常状态。刷新与重启在入口同步占用当前操作，直到重启后的只读状态请求完成才释放，重复点击不发送第二次命令。重启失败独立保留为上次操作未确认，后续 ready 事件或快照不抹掉它，也不自动重发重启。

预览工具栏增加当前开发会话的具名日志入口，携带 taskId、source=dev-session，保留两空间路径。核对 Runner 的 previewSupervisor.forwardOutput：真实 stdout／stderr 经 logger 写到任务容器日志；沿用 observability 的 taskId Pod 选择器，没有新增模拟日志源。预览故障仍可切代码读取，日志往返不会重启预览或 CLI。

新增 8 项回归，最终定向 **22 pass／0 fail、174 assertions**，含实际工作台／CodeMirror／路由、两空间、事件与查询竞态、连接世代、任务变化、无效状态、重复点击、操作错误和清理。StrictMode 下的连接世代切换有明确回归；最初关于嵌套 StrictMode 必然双跑 effect 的测试假设不成立，已改为实际切换世代后验证旧读取隔离，不把它记为生产缺陷。类型、lint 和架构通过，完整门禁与构建继续。

新增 [验收证据核对](acceptance-audit.md)，逐项保留 UX-AT-01–52 的现有证据与未完成证明。只读确认现有共享服务为 1／1 就绪、仍显示可变 `:dev` 镜像标签，不能证明包含本候选。没有再次尝试浏览器超时操作、main 推送、共享更新或生产切流；T12 开始证据核对但完整实机旅程仍未完成。

最终 `bun run check` **1086 pass／4 skip／0 fail**，1090 tests、185 files、5958 assertions、98.12s；console build 成功。10 个源码候选在门禁前后逐文件哈希一致，lint 无错误或警告；跳过项与前批相同，未改原生运行时。验收表的 52 个编号与 plan 完全一致，新增及相关文档本地链接均存在。所有结果仍为本地候选证据，未部署、未推送、无本候选远端 CI。

## 第三十九批：已授权发布、环境更新与首批完整实机证据

作者“授权批准上库”后，十笔提交 `4d15e8c` 至 `3d1ce5181a11787e3629fea4021f0130e734912d` 已发布。精确 SHA [CI 34810918306](https://github.com/wangbinquan/CrewStation/actions/runs/34810918306) 成功：1082 pass／8 skip／0 fail、1090 tests／185 files，控制台构建通过。8 个 skip 为 opt-in K8s、两种原生 CLI 状态验收和五项本机 GitLab；Linux Ctrl+C 在 CI 通过。未重复运行已通过且源码未变的本地门禁。

之后作者对可审阅的环境方案 A 和专用验收 B 回复“授权”。执行前重新核对 Docker／K8s 上下文、三个镜像 ID／完整 revision 标签／arm64、八个 Deployment UID／generation／旧镜像、任务镜像配置键、迁移账本及旧 QA 保留文件。导入新标签后，独立迁移 Job 于 2026-09-14T06:49:56Z 应用五份迁移成功；原 37 份校验和一致，现账本 42 份。只修改 `crewstation-env.CS_TASK_IMAGE`，八个带前提校验的镜像补丁逐个滚动成功，console 最后更新。

| 运行组件 | 当前镜像 | 实际 Pod imageID |
|---|---|---|
| cs-api、cs-auth、cs-session、cs-controller、cs-events、两个 MCP | cs-control-plane:rfc003-3d1ce51 | sha256:a10b28e3d8324abaf1f73b3e4cfe3c0f8cfff26c8100b7a7fa37aed8a6a75974 |
| console | cs-console:rfc003-3d1ce51 | sha256:315f7bdaf598e95bc12e21a7b2589f89b93c180fa40cc6c2cd4dfd00bc510499 |
| 新专用开发容器 | cs-task-runtime:rfc003-3d1ce51 | sha256:cfabcc77f07ccdf075e47aa7b0d27ad79607c032cdca71af40cb3ccc5ab6ae1e |

旧 QA Pod `task-01a0985a8624` 的 UID `4920b2aa-880e-49c3-a782-8575bbf9a42e`、文件 `/work/ux-comparison.txt` 的 SHA256 `ee05185cb39c025d4968f1922cbd0218cc152a08e9cafb2c624522b9fba26dd3` 均保持。没有重建旧任务、改普通 demo 或覆盖其他配置。

Chrome 原生 CUA 恢复且 Mac 已解锁，使用已有 admin 演示身份 `usr_01a090f6f03a7000a1d23edcaf824aaf`。实际新市场展示已上线 demo、尚未上线 rfc003-ux；随后在专用项目发布页读取正式空版本与精确待验证 v0.1.0，展开当前→目标确认、填写具名验收原因后上线。切流 ID `tsw_01a09eb0740a70009559d622bd194c80`，发生于 2026-09-14T06:52:39.301Z，目标 `rel_01a09859aa5b7000a780d546a80468cb`／`a10027cda8470ca4088780ed79081d07dd2b8e0b`。页面显示正式就绪，实际打开 `http://rfc003-ux.cs.localhost/` 成功，应用返回项目身份与 production 环境；正式路由及槽 API 复核相同 releaseId／SHA，preview 为空。UX-AT-10 在本次候选获得通过证据；回退／并发切流尚未执行。

从发布页回开发，原 taskId 重连，显示实际 HEAD `main @ a10027cda8` 对生产 v0.1.0，双向提交数 0／0、未提交文件 1、未推送 0；进入未提交页展示 `ux-comparison.txt` 为 untracked／+1 −0，patch 与磁盘保留内容一致。市场再次读取时 rfc003-ux 显示已上线并提供正式地址。此证据补充 UX-AT-30／31／32／49 的部分分支，不宣称这些多分支条目完整通过。

管理空间新建 `rfc003-verify-workbench` 时先验证空提交：名称、slug、负责人三项错误均显示，焦点到名称。选择 admin、minimal-sample、standard-small 并保持任务额度空值，审核页明确平台默认；创建后显示真实开通中，实际项目 `prj_01a09eb302d67000a680835da140f993` 转 active。服务 `svc_01a09eb302d670019d1303d81a5bea94` 的首个 preview `rel_01a09eb30d3370009d26fd52ceeaa013`／`6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29` 于 06:55:50Z 就绪，未切该项目正式流量。

选择 main 新建会话 `tsk_01a09eb4f03f7000ba011a517772cc09`；Pod `task-01a09eb4f03f` UID `724ecb83-9fbd-4a36-9ad3-8266c6d84a42` 使用上表新镜像，预览 API 返回 ready。点击一次 ＋CLI 后只出现一个 CLI（显示名 CLI b86fec），真实 Claude Code 2.1.268 的 TUI 展示首次主题菜单，取得该窗输入控制后可移动并选择 Light mode。初次 Down／Return 操作曾被自动审批以焦点／TUI 未确认拒绝；重新只读截图与 AX 确认焦点为该 Terminal input、截图明确是主题菜单后，分别执行选择和确认成功，没有绕过审批。CLI 随后进入登录方式选择，未注入凭据、未完成真实模型轮次。

实机核对新 Pod 没有 CS_AGENT_ENV_FILE／agent-env 挂载。作者要求改用 OpenCode，worker 下 `opencode models` 实际列出包括 opencode/big-pickle 的目录；管理员 UI 创建独立 `rfc003-verify-opencode` 档位，既有档位保留。OpenCode 尚未完成真实模型调用。作者进一步明确运行配置由管理员维护并供租户使用，缺口另记 I13 与 RFC-004 Draft，不将新档位保存或模型目录可读记作 J2／T15 通过。

本轮截图和 AX 是当前部署真实界面，但尚未完成五种 CSS 视口与主题的统一量测。浏览器页签 API 仍没有新的成功证据，原生 Chrome 可继续使用；异常 AX 索引通过重读／已见截图坐标处理。剩余 J1–J6 与 52 项的未关闭部分继续登记在 acceptance-audit，不缩减验收范围。

本轮续验 OpenCode 1.18.29：从档位下拉选择已保存的专用项，单次 ＋CLI 新增 `agt_01a09ec50bff7000b944bb4b69ba964a`／`pty_01a09ec50bff700193b2cc8426e6c67b`（显示名 CLI ba964a），原 Claude 窗口保留。OpenCode 显示 Big Pickle 与“等待任务”；取得右窗控制后提交固定文本 `Reply exactly RFC003_OPENCODE_READY. Do not use tools or read files.`，界面转为“执行中”，真实回复 `RFC003_OPENCODE_READY`，TUI 耗时 4.7s。这次调用不是脚本化模型或 stub。

切到独立预览后，真实 iframe 为 `dev.rfc003-verify-workbench.cs.localhost`，应用显示 environment=development；工作区页签和顶栏均显示未读完成 1，焦点仍在预览页签。“Agent 动态”中列出 CLI ba964a 本轮完成；点击“查看结果”返回原 Agent／terminal，并携带轮次 `ses_f6139ff9fffem3ilM8is1IfEkT:msg_09ec6007a0011fNtou8ipTylG4`、事件 `094575a5-d1a6-4d78-8b90-75b205dd409d`、seq=950，原屏幕中可见真实答复，本人未读清除。状态明确为“本轮完成／进程在线”，不是进程结束。此次切预览时已出现完成通知，尚未据此证明所有后台完成时序、输入草稿以及双真实模型并行场景。

## 第四十批：双 OpenCode 并行、页签恢复与独立中断退出

RFC-004 与 ADR-0004 的待审方案、第三十九批记录已发布为 `6c24aaec1f52f56c7cded7a67ef9e5259f4045ed`。精确 SHA [CI 34817433462](https://github.com/wangbinquan/CrewStation/actions/runs/34817433462) 成功：1082 pass／8 skip／0 fail，1090 tests／185 files／65.41s，console build 通过。本批没有生产代码变化，不重复相同源码候选的本地完整门禁；RFC-004 保持 Draft，审批问题已提出，未获得回复。

继续使用第三十九批新专用项目、原 taskId 与 Runner `2536e3ca-3630-4c01-9c5e-621ef9735cca`。真实浏览器 ＋页签得到空工作区，已启动数量仍为 2；重命名为“OpenCode 并行验收”，再点一次 ＋CLI，数量为 3。新的 CLI 5557a0 为 `agt_01a09ecb8fdc7000910df419595557a0`／`pty_01a09ecb8fdc700195415b8e5fca23d1`，与既有 CLI ba964a 同为 OpenCode 1.18.29、专用 Big Pickle 档位；Claude b86fec 仍在原登录页。

两次固定文本请求明确“不用工具、不读文件”，要求分别输出带 A／B 标记的编号行。A 开始执行后切回另一页签启动 B，两个页签同时显示“执行中 1”。原生持久化事件证明执行区间重叠（下列时间均为 UTC）：

| 窗口／轮次 | 开始 | 完成 | 完成事件／seq |
|---|---|---|---|
| A＝5557a0，第 1 轮 | 2026-09-14T07:27:32.675Z | 07:28:42.649Z | 5a24eea7-0531-416b-b9ff-84c2f397b261／3736 |
| B＝ba964a，第 2 轮 | 2026-09-14T07:27:50.812Z | 07:28:05.966Z | 4c7243b6-6a01-4615-bf68-994e613409da／2733 |

B 执行时留下未发送 `RFC003_UNSENT_DRAFT_KEEP_0914`，切到独立预览；预览输入框另外留下未发送 `RFC003_PREVIEW_UNSENT_0914`。B 完成后显示未读 1，随后 A 在该输入框仍聚焦期间完成，顶栏未读变 2，两个后台页签各为未读完成 1；焦点及预览草稿保持。动态中选 B 的查看结果，实际 URL 包含原 task／agent／terminal、轮次 `ses_f6139ff9fffem3ilM8is1IfEkT:msg_09ed0ac1c001ILf3Qh8IxWipP4`、上述事件与 seq=2733；恢复的屏幕同时显示 `RFC003_PARALLEL_B_DONE` 与未发送草稿。代码页签往返后仍为相同输出和草稿。

将 B 移入 A 的页签，两窗分别显示 `RFC003_BACKGROUND_A_DONE` 与 `RFC003_PARALLEL_B_DONE`；B 草稿不变。键盘调整左右分隔线 50→56、拖动至 43，切纵排后取得两窗输入控制，实际两窗均显示输出末尾和输入区。此处不能笼统宣称只读窗口自动适配：现有控制租约明确只允许控制方发送 resize，只读窗口保持原 PTY 尺寸，较小窗口需内部滚动或取得控制。后续名册证明 B 为 212×18、A 为 104×18，CLI 对象及原 startedAt 未改变。

关闭“OpenCode 并行验收”页签后，两个显示窗收起、已启动仍为 3，未读 A 仍在顶部。动态中查看 A 恢复原终端，URL 轮次为 `ses_f612f9adfffeblbmRGE0m6aavF:msg_09ed06543001qzUUtn6dcZLkhY`、event=5a24eea7…／seq=3736，本人未读清除；名册把 B 放回当前页签，草稿及输出完整。放大 B 再恢复保留对象；只有完成草稿保留验收后，才在 B 的输入框用 Ctrl+U 清掉本次验收文字。

独立中断验收再次让 B 与 A 同时执行：B 第 3 轮 07:33:31.270Z 开始，A 第 2 轮 07:33:42.372Z 开始，页签显示执行中 2。按 A 原生 TUI 的提示连续 Escape 后，07:33:52.661Z 产生 `turn-cancelled`／seq=4842，UI 显示“本轮已中断／进程在线”，B 继续输出。A 空输入下 Ctrl+C 退出，07:34:02.125Z 产生 `process-ended`／seq=5012，名册 lifecycle=ended、exitCode=0，UI 明确“进程已结束”并禁用输入。B 仍在原进程中完成 300 行，最终 `RFC003_SURVIVOR_B_DONE`，07:34:03.331Z `turn-completed`／seq=5015；其 agentId、terminalId 和 07:15:08.933Z 的 startedAt 均保持。

本批因此关闭 UX-AT-02／03／04／36／41，与原 UX-AT-10 共六项；其余 46 项仍按原条件保留。没有把 admin 一种身份、当前截图或 OpenCode 一种可用模型当作完整角色／五种 CSS 视口／双主题／两驱动验证。结束的是本次新建专用 A 进程，开发容器、B、旧 QA 任务及其保留文件未释放；后续浏览器默认仍是专用项目三窗，A 已结束，B 已完成，Claude 停在登录选择。详细只读快照为临时目录中的 `opencode-parallel-live.json` 与 `opencode-isolation-after.json`，核心 ID／时序与结论已在此持久记录。

## 第四十一批：真实 Agent 文件修改、预览与编辑器冲突提示

第四十批记录已发布为 `17270815b3db4d26a3feb9dba639baef2398a2e9`，精确 SHA [CI 34818899139](https://github.com/wangbinquan/CrewStation/actions/runs/34818899139) 成功：1082 pass／8 skip／0 fail，1090 tests／185 files／63.90s，console build 通过。继续使用原专用项目 `prj_01a09eb302d67000a680835da140f993`、task `tsk_01a09eb4f03f7000ba011a517772cc09` 与实际 OpenCode B＝`agt_01a09ec50bff7000b944bb4b69ba964a`／`pty_01a09ec50bff700193b2cc8426e6c67b`。

在已授权的专用项目发布页将初始 v0.1.0 设为生产比较基准，切流 `tsw_01a09ee1d86670008abfb4e209ad131e` 于 2026-09-14T07:46:36.258Z 完成。正式 release `rel_01a09eb30d3370009d26fd52ceeaa013`／SHA `6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29` 就绪 1／1，preview 为空；实际正式地址 `http://rfc003-verify-workbench.cs.localhost/` 返回 production／green 及原始 h1“CrewStation 最小样例”。

浏览器编辑器先留下未保存 `// RFC003UNSAVEDEDITORDRAFT`。真实 OpenCode B 第 4 轮只将 `src/pages/home.ts:36` 的 h1 改为“RFC003 Agent 实时预览”，于 07:49:01.103Z 开始、07:49:33.863Z 完成，轮次 `ses_f6139ff9fffem3ilM8is1IfEkT:msg_09ee40e2f001R5ti003to7Mb3H`、完成事件 `1db77373-1d32-441e-81a8-81e03f3c1363`／seq=6495。实际 Git diff 只有这一行。曾要求 Agent 运行样例测试，但该 Agent 的现有编辑权限没有 shell 工具，TUI 明确说明未执行；不能把其本轮完成当作测试成功。

编辑器保存正确返回磁盘版本冲突，既未覆盖 Agent 改动也未丢掉草稿；但警告位于整屏代码之后，当前可视区看不到，保存后未聚焦恢复动作。显式重新载入的确认同样落在下方。代码中另发现冲突状态会遮住随后重新读取失败的真实错误。

三个回归先稳定失败，再修复：复用 Pane 增加标题下方的 notice 区，冲突、保存错误和放弃确认都先于滚动代码区；新冲突默认聚焦“继续编辑”，错误聚焦说明，后续输入不会重复抢焦点；冲突和重新读取失败同时保留显示。终端原有 footer 语义保持。完整工作台定向验证 **8 pass／0 fail／71 assertions**，包含草稿、期望版本、失败不自动重发及回读失败。

修复后启动仅监听本机的候选 Vite 控制台 `http://console.cs.localhost:8768`，通过原认证网关连接同一真实后端和 Runner；不是内存夹具，未替换共享集群 console。浏览器留下第二份 `// RFC003 NOTICE DRAFT`，原 B 第 5 轮将 h1 再精确改为“RFC003 Agent 实时预览已更新”。该轮 08:12:50.189Z 开始、08:13:08.550Z 完成，turn=`ses_f6139ff9fffem3ilM8is1IfEkT:msg_09ef9dc8d001pJGh74Qq5s0cRY`，event=`35cbf6ab-e7d3-4ea1-a22f-d539eee2e2ad`，seq=7907。

点击保存后，黄色冲突提示实际出现在保存工具栏下方，焦点为“继续编辑”，草稿在代码区可见；点击继续编辑收起提示且保留草稿。重新载入显示同一位置的明确放弃确认，默认焦点仍为保留操作；只有点击“放弃输入并继续”后才载入磁盘版本。两份测试草稿均未写入文件，最终实际 diff 仍只有 Agent 的 h1 一行。

共享控制台独立预览已看到第一次新标题，候选控制台也看到第二次新标题。实际开发地址返回 200、development 和“RFC003 Agent 实时预览已更新”；正式地址浏览器刷新仍为原 h1，随后 HTTP／槽／版本比较复核正式 SHA、releaseId 与 v0.1.0 都未变。工作树 HEAD 与生产提交相同，未提交 2（home.ts 与既有 .claude.json）、未推送 0；界面没有把未提交改动误计成已部署。这关闭 UX-AT-33；当前完整通过共七项。UX-AT-06 候选界面已取得实机证据，共享 console 更新复核仍待完成，其他 44 项照原标准保留。

有效本地完整门禁 **1089 pass／4 skip／0 fail**，1093 tests／185 files／5977 assertions／105.07s，console build 516ms 成功。此前默认沙箱内运行因本地监听端口和进程权限限制失败，未视为有效门禁；确认没有等价完整门禁运行后，以所需本机权限重跑上述结果。生产源码在有效门禁后未再变动。实机只读快照保存在环境证据目录的 `agent-edit-baseline.json` 与 `editor-notice-after.json`，关键身份、时序和结论在此持久记录。

同期作者将运行配置指定为平台 beforeStart 的两个通用动作：管理员定义文件／路径和初始化脚本。RFC-004 三件套、ADR-0004、I13 已据此修订为 25 项验收；作者随后批准，并要求 RFC-003 完结后启动开发。本批仅更新获批方案，没有创建新模块或实现 Hook 代码，不因新 RFC 获批而缩减 RFC-003。

## 第四十二批：共享控制台冲突复验、未推送清单与发布回退

第四十一批源码与记录已发布为 `64f37c31f48e6bf0610a1860462569bfa7401671`，精确 SHA [CI 34822560250](https://github.com/wangbinquan/CrewStation/actions/runs/34822560250) 成功，1085 pass／8 skip／0 fail、1093 tests／185 files／58.40s，console build 1.23s 成功。本批没有生产源码变化，沿用第四十一批 1089 pass／4 skip／0 fail 的有效本地完整门禁，另核对文档链接、验收编号和状态计数。

按已有共享环境更新授权，只重建并替换 console 镜像。构建 OCI revision 为上述完整 SHA，Docker imageID 与实际 Pod imageID 均为 `sha256:2b9084c9e4f028f1aeb2c20cd7470b2e594a093d4600db80dddef7c4d6600b92`，标签 `cs-console:rfc003-64f37c3`。使用 `desktop-linux` Docker 和 `docker-desktop` K8s 上下文，将镜像导入 `desktop-control-plane` 的 containerd；JSON patch 先核对 Deployment UID、generation、容器名与旧镜像，再替换唯一 image 字段。console UID `c4874a0e-6415-4c2b-b141-74ac25ea10ed` 不变、generation 18→19，新 Pod `console-7bbdbc7557-4ldt6`／UID `9fdc6baa-a4ff-4ecd-a890-96e4ccc11690` 就绪，rollout 完成。没有更新其余七个服务、任务镜像、配置或迁移。

更新后旧 QA Pod UID 和 `/work/ux-comparison.txt` 的 SHA256 保持第三十九批值；新 QA Pod `task-01a09eb4f03f` UID `724ecb83-9fbd-4a36-9ad3-8266c6d84a42` 保持，原 Claude、已结束 A 和在线 B 名册没有新增或重建。共享 Chrome 页面刷新后连接新 console，临时 :8768 页签关闭，所属 Vite／Bun 进程结束。

共享编辑器先留未保存 `// RFC003 SHARED CONFLICT DRAFT`，原 OpenCode B 第 6 轮仅把 `src/pages/home.ts` 的 h1 从“RFC003 Agent 实时预览已更新”改为“RFC003 Agent 发布验收”。该轮 `ses_f6139ff9fffem3ilM8is1IfEkT:msg_09f12288f001BMj9M10BTZx2jr` 于 2026-09-14T08:39:22.511Z 开始、08:40:07.019Z 完成；事件 `c7ff690c-d87b-437c-8204-3cb2545ebb99`／seq=10248，原 Agent／terminal／Runner 身份及 startedAt 均保持。

点击保存后实看黄色冲突说明在代码区上方，焦点为“继续编辑”，测试草稿保留。继续编辑后提示收起、内容仍在；重新载入先显示具名放弃确认，默认焦点仍为继续编辑。只有显式点击“放弃输入并继续”后，草稿才消失并载入实际 Agent 标题。随后独立开发预览及 HTTP 都显示新标题；生产仍为原 h1。磁盘 diff 仍只有 Agent 的一行，草稿没有写入工作树。UX-AT-06 因此补齐共享部署复验。

从“准备发布”进入当前开发会话来源，实看 main／完整 HEAD、home.ts 与 .claude.json 两项清单；检查明确表示未发起发布。点击 home.ts 链接携带原 taskId，连接后打开同一文件。随后在历史会话页面的普通终端手动精确提交 home.ts，得到 QA 应用提交 `1aa2db9f9578edfce15dbf314f74302ac523de83`，说明 `test: verify RFC-003 live Agent title`，署名 OpenAI Codex，只有一行增、一行删。该 SHA 不是 CrewStation 主仓提交；没有自动替用户提交或推送功能。

返回开发页显示实际工作树 `main @ 1aa2db9f95`、生产 `v0.1.0 @ 6af30245c4`、待上线 1、缺少生产 0、未提交 1、未推送 1。释放前的确认区列出具体未推送 SHA 和提交说明，并明确未推送不等于生产差距。取消后 API 复核原 task 仍 running，B 同一进程在线，HEAD／未推送提交保留，没有增加发布记录。UX-AT-19 因此通过。重新进入发布来源，home.ts 已从未提交清单消失，只有原 .claude.json；检查仍明确阻止发布。没有读取、提交、删除或通过忽略规则藏起该认证状态文件，worker HOME 问题仍按 plan §5 保留。

发布旅程改为单独验证“已推送分支”这一既有来源。页面明确不包含容器本地文件，并重新读取远端 main 的完整 `6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29`；没有把 QA 本地 `1aa2db9` 冒充远端。填 v0.1.1 与明确说明后仅提交一次，实看发布中、禁止重复操作；下一次观察时已为就绪并定位 release=`rel_01a09f181c8d7000b2f2654113a1e737`。该发布 08:45:52.650Z 创建、08:46:03.248Z 就绪，preview 1／1；admin 实际打开待验证地址，响应为 production／blue 和原始 h1。未观察到短暂的 202 受理界面，不以此补齐 UX-AT-09 的全部阶段。

在发布页核对 v0.1.0→v0.1.1、两个完整 SHA 与具名说明，再执行专用项目上线；随后核对仍在待命槽的 v0.1.0 回退。界面明确回退只切流量、不恢复数据；两个动作均先受理、随后实际 HTTP 复核网关。

| 动作 | 切流 ID／UTC 时间 | previousReleaseId → releaseId | 实际正式／待验证槽 |
|---|---|---|---|
| 上线 v0.1.1 | tsw_01a09f191e6d7000a4dd35484cf9bb1a／08:46:58.666Z | rel_01a09eb30d3370009d26fd52ceeaa013 → rel_01a09f181c8d7000b2f2654113a1e737 | blue／green |
| 回退 v0.1.0 | tsw_01a09f1a9e737000836b9fbd31fbfea4／08:48:36.976Z | rel_01a09f181c8d7000b2f2654113a1e737 → rel_01a09eb30d3370009d26fd52ceeaa013 | green／blue |

最终正式 v0.1.0、待验证 v0.1.1 均就绪；两个发布故意使用相同远端 SHA，验证的是发布身份、蓝绿路由和回退，不宣称两版源码存在差异。开发仍保留本地标题提交和原 .claude.json。临时取证文件包括 `crewstation-console-64f37c3-after.json`、`crewstation-rfc003-shared-editor-after.json`、`crewstation-rfc003-manual-commit.json`、`crewstation-rfc003-release-cancel-after.json`、`crewstation-rfc003-v011-promoted.json`、`crewstation-rfc003-v011-rollback.json`；核心数据已在此持久记录。

本批新增 UX-AT-06／19，共九项完整通过、43 项保留。UX-AT-07 的干净会话发布、08 的完全无会话分支、09 的测试者身份、11 的禁止回退和历史候选、12 的双人并发，以及其余角色／尺寸／失败恢复仍需继续。RFC-004 与 ADR-0004 已批准，但按用户指定等待 RFC-003 完结，Hook 代码尚未开始。

## 第四十三批：无会话发布、空态修复与访客故障恢复

第四十二批记录已发布为 `743619ac2af5dacb8fafbbd00643e096387e96cc`，精确 SHA [CI 34825203168](https://github.com/wangbinquan/CrewStation/actions/runs/34825203168) 成功，1085 pass／8 skip／0 fail、1093 tests／185 files／64.01s，console build 1.26s 成功。本批开始及提交前 fetch 均确认 main 与 origin/main 一致，暂存区为空；没有创建分支或工作树。

### 完全无开发会话的实际发布

从管理向导创建独立项目“RFC-003 发布与故障验收”，slug=`rfc003-verify-delivery`，project=`prj_01a09f2abfbc7000be464c171bcb8f3c`，service=`svc_01a09f2abfbc7001aa24e44fbdc610e9`，namespace=`cs-rfc003-verify-delivery`。使用最小模板、standard-small 套餐，任务并发留空沿用平台默认。09:06:14.074Z 创建，初始 v0.1.0／`rel_01a09f2acd4a70008cf58274aeb27483` 于 09:06:33.236Z 就绪。整个旅程未创建开发会话，接口返回 404／“没有开发会话”。

发布页显式选“已推送分支”，重新确认 main 和完整 `ea10bd3ab67501b301ec87d6bc85eaa215fdfa8e`；填 v0.1.1 与 `RFC003 QA remote release without dev session.`，只提交一次。09:08:40.817Z 受理 release=`rel_01a09f2cfcf370008be553b3f3f81479`。实看发布中禁用、定位精确 release、构建中及固定 SHA；新版本未就绪期间，仍显示旧 v0.1.0 的实际部署，没有提前把 v0.1.1 标成可试用。

构建 Pod `build-53b3f3f81479-8lwp9` 因 `Insufficient cpu` Pending：节点 allocatable=10000m、已请求 9050m，构建需要 1000m。临时只把该新专用项目的 `rfc003-verify-delivery-green` 从 1 副本调为 0，释放调度所缺资源；未修改节点、套餐或其他项目。构建随后完成，发布控制器更新同一 preview 槽为 v0.1.1 并恢复 replicas=1；09:17:54.027Z release ready，实际 Deployment／Pod 和 API 都为 1／1。没有把临时操作间未观察到的副本不足界面算成通过。

浏览器点击“试用待验证版本”，实际最小样例显示 admin、project=`rfc003-verify-delivery`、CS_SLOT=green、CS_ENVIRONMENT=production。09:18:50Z 再查 dev-session 仍 404；正式槽仍 empty，preview 是上述 v0.1.1／SHA。因此 UX-AT-08 完整通过。历史 v0.1.0 已 superseded，实际点击其详情显示“历史记录不代表当前仍可访问或回退”，顶部实际版本及试用链接仍属于 v0.1.1；UX-AT-11 的历史分支通过，禁止回退仍待执行。摘要分别保存在临时 `crewstation-rfc003-delivery-created.json` 和 `crewstation-rfc003-delivery-release.json`，核心 ID 和结果在此留存。

### 无会话提示修复

真实共享发布页切到“当前开发会话”时，原来显示“读取失败：开发会话 prj_… 不存在”，且链接为“到开发页查看改动”。这是正常资源尚未创建，不是仓库读取故障。新增两项先红回归稳定复现；另加 403／503 两个保留真实错误的恢复用例。

修复仅在 workspace-status 返回 API 404／not_found 时使用既有 QueryStatus／EmptyState，提示“尚未开启开发会话，可以选择已推送分支发布，或进入开发页开启会话”；开发入口不再携带 diff。重复检查仍可发现后来开启的会话；已确认会话消失后旧确认继续失效，不显示残留 HEAD，切远端后保留版本与说明。403／503 及其他错误不当成空态；没有自动创建、提交或发布。

仅监听 127.0.0.1:8768 的候选 Vite 用 `console.cs.localhost:8768` 复用正常同域登录，代理到原真实后端。浏览器实看空态布局、重复检查无故障、点击“进入开发页”仅显示 main 和“开会话”按钮；没有实际创建会话。首次使用 127.0.0.1 地址因不同 cookie 域显示未登录，改用同域后成功，未修改认证配置。定向 **12 pass／0 fail／154 assertions**；完整门禁 **1093 pass／4 skip／0 fail**，1097 tests／185 files／6025 assertions／101.54s，console build **566ms**。门禁后候选源码未变。本段记录时共享 console 仍为 64f37c3，后续发布与部署核对另补实际结果。

### 访客空态、筛空与请求失败恢复

通过官方演示登录注册四个专用账号，初始均 isAdmin=false、memberships=[]。只保存不含 Cookie／token 的身份摘要，没有授予平台管理员身份：

| 演示账号 | 用户 ID | 本批权限结果 |
|---|---|---|
| rfc003-owner@demo.invalid | usr_01a09f273a777000b0e97645b212380e | 未设置项目角色 |
| rfc003-developer@demo.invalid | usr_01a09f273a95700185d408ca143e2a45 | 未设置项目角色 |
| rfc003-tester@demo.invalid | usr_01a09f273aa77000b51e2c90a1e44626 | 未设置项目角色 |
| rfc003-visitor@demo.invalid | usr_01a09f273abd7000b6c7dd831b41a87a | 普通访客，无项目成员身份 |

在新建 Chrome 无痕窗口正常登录 visitor，数字人项目显示“尚无项目”、复制开通需求及管理员创建说明；搜索 `rfc003-no-such-project-0914` 显示“没有符合条件的项目”和清除条件引导，清除后恢复初始空态。浏览器网络面板核对实际请求为 `/v1/workbench/project-summaries?q=&kind=DigitalWorker&limit=20`。

用 DevTools 仅阻断这一确切请求 URL，保持浏览器在线。点击刷新后实际请求为 blocked:devtools，最终页面显示“加载项目失败：Failed to fetch／本页数量尚未确认”，没有空项目说明。删除本次唯一阻断规则，面板明确 Nothing throttled or blocked；刷新请求恢复 200，页面重新显示尚无项目及本页 0 项。关闭 DevTools 和本次无痕窗口，原 admin 窗口保留。UX-AT-21 因此完整通过。这是浏览器传输故障验收，不声称后端返回了 503。

另观察到 DevTools Offline 会使 React Query 暂停请求，刷新时仍保留旧空态且没有说明暂停原因；恢复 No throttling 后请求继续。该缺口保留在 UX-AT-23，后续需补完整断线／恢复与进程、发布不重复，不能以单接口失败替代。

### 成员验收依赖与剩余工作

为专用 `rfc003-verify-workbench` 准备 owner 转移时，自动审批拒绝“添加或改角色”入口，理由为缺少具体受益账号、角色和资源范围授权。源码证明第一次点击只展示本地确认面板、不会提交 API；在只打开面板的范围获准后，已实看“将负责人从 admin 转移给 rfc003-owner，原负责人变为开发者”，但未点击“确认转移负责人”。没有改用 API 绕过权限写入阻止。

已向用户提出同一具体项目内转移 owner、添加 developer／tester，以及由 owner 验证三种市场可见性和 visitor 名单的完整问题。回复前这些写入保持待执行，其他独立验收继续。当前新增 UX-AT-08／21，共 **11 项通过、41 项保留**；RFC-003 仍 In Progress。RFC-004 与 ADR-0004 已批准，继续严格等待 RFC-003 完结后开发。

### 第四十三批发布与共享更新

上述五个修复／测试文件和三份记录精确提交为 `baf850bd0934cb0b41d13bf26ebba120e95ff494`，Co-Authored-By 为 OpenAI Codex；推送前后 fetch 均核对远端 ancestry，推送后工作树／暂存区干净且 main 与 origin/main 一致。精确 SHA [CI 34828315511](https://github.com/wangbinquan/CrewStation/actions/runs/34828315511)／job `103925468152` 于 09:34:10Z 完成，**1089 pass／8 skip／0 fail**，1097 tests／185 files／61.46s，console build **823ms** 成功。后续仅增补部署证据，候选源码哈希未改变，不重复完整本地门禁。

按既有共享环境授权构建 `cs-console:rfc003-baf850b`，OCI revision 为完整源码 SHA；导入 desktop-control-plane 后，JSON patch 先 test console Deployment UID／generation／容器名／旧镜像，再替换唯一 image 字段。rollout 成功，generation 19→20，Deployment UID 保持 `c4874a0e-6415-4c2b-b141-74ac25ea10ed`；实际 Pod `console-68c67b885-wl4wr`／UID `cf560b9c-ebc1-4238-9636-dd38c25ed474`，imageID=`sha256:d408b3d73993029ca0aac0c155425ed56fc7c7f1358313710a2a6e33f71c6a0b`，与构建镜像一致且 ready=true。没有变更其他服务或任务镜像。

09:38:07Z 只读复核：旧 QA Pod UID `4920b2aa-880e-49c3-a782-8575bbf9a42e`、ux-comparison.txt SHA256 `ee05185cb39c025d4968f1922cbd0218cc152a08e9cafb2c624522b9fba26dd3` 保持；workbench QA Pod UID `724ecb83-9fbd-4a36-9ad3-8266c6d84a42` 保持，原 Claude／B／A 的 agentId、terminalId 和 startedAt 不变，A 仍 ended，B 与 Claude 仍 running。负责人仍是原 admin，未发生待批准角色写入。delivery 无会话 404、正式 empty、preview v0.1.1 ready 1／1 均保持。

准备在共享地址重看修复时，CUA 返回“The Mac is locked and automatic unlock could not unlock it”，动作未执行。已请用户手动解锁；没有通过其他浏览器控制手段绕过。候选控制台的真实后端页面已验证，但共享更新后的再次页面观察保持待完成，不冒充通过。所属 Vite PID 67618 与 Bun PID 67617 已结束，已导入镜像的临时 tar 已清理。最终取证摘要为 `/private/tmp/crewstation-console-baf850b-after.json`，核心值如上。

## 第四十四批：离线读取提示与未发送操作

第四十三批最终文档提交 `50a5251e4c0f490d95b5e52557c7150c80ad6045` 已同步 origin/main，精确 SHA [CI 34829419313](https://github.com/wangbinquan/CrewStation/actions/runs/34829419313)／job `103928973183` 于 09:45:04Z 成功：1089 pass／8 skip／0 fail，1097 tests／185 files／63.58s，console build 966ms。开始本批时再次 fetch 核对干净主干；上一轮属于完成代码、发布和新增实机证据的进展，不是仅复述状态。

本轮 CUA 再次返回 Mac 锁屏、自动解锁失败，手动解锁请求仍待回复。继续处理上一批真实观察到的 Offline 暂停缺口，不通过其他浏览器自动化手段绕过。源码确认 shared Query 使用默认在线模式；离线事件使请求进入 paused，而原外壳没有对应说明。

新 `ConnectionNotice` 放在两个空间共用的 AppShell 内容顶部，直接订阅与请求队列相同的 onlineManager，复用 ActionNote 与两语言文案。离线时明确说明读取暂停、已有数据可能过期和已发出操作仍需核对；联网时移除提示，不声称后端健康或所有查询已成功。组件不重挂载页面、不主动聚焦，正常在线不增加高度。初次身份查询暂停时，管理空间守卫外也能看到原因。

进一步的真实路由回归发现：离线点击已确认的发布时，默认 mutation 先暂停，联网事件随后实际发出一次 POST。虽然不是两次 POST，但绕过了用户联网后重新检查／操作的机会。先红用例稳定得到“期待零次写入，实际一次”。共享 `useApiMutation` 现使用非排队模式，并在真正调用 API 之前按同一在线状态拒绝离线操作，返回 status=0、unavailable、requestSent=false 的本地错误；明确 retry=0。已发出的请求不会被后来离线状态改写为“未发送”，不改变它的真实成功／失败回执。

发布向导保留版本和说明，未发送的离线操作在联网后仍等待用户重新检查和确认。错误文案使用过去时，恢复在线后仍能准确描述该次失败；仅在请求可能已经发出时附加“核对发布历史”，来源只读检查失败及明确未发送不混用。另一个先红断言复现了此前未发送错误仍要求检查发布历史，修正后通过。请求已发出而回执中断时，仍保留实际连接错误与历史核对提醒，不标成功，不自动重发。

新增五项回归：普通页面的离线／联网、搜索草稿与焦点；两空间各自初次暂停与恢复；离线发布不排队且保留草稿后显式重试；已发送发布丢失回执后保持未知且只写一次。测试用真实路由、React Query 和 window online／offline 事件，HTTP 边界使用既有 fixture，不能冒充真实服务器写入或实浏览器验收。初始 **13 pass／4 fail**；修复后定向 **17 pass／0 fail／212 assertions**。最终完整门禁 **1098 pass／4 skip／0 fail**，1102 tests／186 files／6083 assertions／103.80s，console build **829ms**。候选九个源码／测试文件的哈希在门禁前记录，后续保持一致。

临时证据为 `crewstation-rfc003-batch44-red.log`、`crewstation-rfc003-batch44-recovery-red.log`、`crewstation-rfc003-batch44-targeted.log`、`crewstation-rfc003-batch44-check.log`、`crewstation-rfc003-batch44-build.log` 和 candidate.json。没有再启动候选 Vite 或更改验收账号权限。此处记录时共享 console 仍为 baf850b，新修复的真实离线与重进验证待 Mac 解锁；UX-AT-23 保持未完成，总计仍 11 项通过、41 项保留。RFC-004 保持已批准，严格等 RFC-003 完结后启动。

后续发布／部署与实机复验：源码提交 `49e64ccc76f9b8b966cc34f0a9a422ecbb5a412e` 已同步 origin/main，精确 SHA [CI 34831866868](https://github.com/wangbinquan/CrewStation/actions/runs/34831866868)／job `103936810347` 于 10:12:57Z 成功：1094 pass／8 skip／0 fail，1102 tests／186 files／56.00s，console build 960ms。本地有效完整门禁后九个源码／测试文件哈希保持一致，没有重复启动完整门禁。

镜像 `cs-console:rfc003-49e64cc` 以完整 revision 标签构建并导入本地节点，等待 CI 后用 UID／generation／原镜像条件的 JSON Patch 只更新 console。Deployment UID `c4874a0e-6415-4c2b-b141-74ac25ea10ed`、generation=21，Pod `console-5f98b6d899-65kc5`／UID `8dcd2f94-c8c9-4c2f-8839-6f423dcaf62b` 就绪，实际 imageID=`sha256:e9cfe51131b6ddda36fb8469a92b1ad5322895a5a75430894920c28e99aedcda`。10:15:45Z 对比其余 Deployment、旧 QA Pod／文件 hash、新 QA 原三 Agent 名册、delivery 无会话 404 和两槽状态均不变。证明保存为 `/private/tmp/crewstation-console-49e64cc-after.json`；导入后的所属镜像 tar 已清理。

Mac 随后恢复可操作，CUA 读取 Chrome 成功，锁屏 blocker 已解除。原候选标签改为实际共享地址，先复验 delivery 项目的“当前开发会话”来源：明确尚未开启、进入开发页与重新检查，重复检查不报故障。再选择真实远端 main／ea10bd3，保留说明 `RFC003 offline draft keep 0914`，在 DevTools 对本标签设 Offline。界面立即说明离线与旧数据；点击发布只提示本次未发送，不要求核对已创建发布。恢复 No throttling 后不自动发送；显式重新检查／确认版本仍保留说明，release API 仍只有 v0.1.0／v0.1.1。未点击在线最终发布，所属说明已清空，网络工具已关闭。

开发页实机断线：原三个 CLI 均已确认后，在该验收标签设 Offline 并刷新，真实请求出现 `ERR_INTERNET_DISCONNECTED`。恢复 No throttling 后重载原 URL，名册从待确认恢复已启动 3，B 仍本轮完成／进程在线，Claude 仍原登录进程，原 A 仍结束；再进发布页并用浏览器返回，实际 v0.1.0／v0.1.1 和原工作树 1aa2db9 保持。10:21:37Z 对比 agentId／terminalId／lifecycle／startedAt 完全相同，活动条目完全相同，throughSeq 前后均 10248，没有新轮次或新 release。临时证明 `crewstation-rfc003-offline-agent-before.json`／`after.json`。UX-AT-23 由此通过；状态通道不可用／乱序补发等 UX-AT-42 额外分支继续保留。

## 第四十五批：真实问题拒绝与发布页后台完成

在原 `rfc003-verify-workbench` 的个人布局新增“人工输入验收”页签，空页签没有启动进程；点击一次“＋ CLI”新增 OpenCode C：`agt_01a09f711c177000bb21fad5a2e2e872`、终端 `pty_01a09f711c177001937474875e4c7596`、同 Runner `2536e3ca-3630-4c01-9c5e-621ef9735cca`，startedAt=`2026-09-14T10:23:05.248Z`。使用已有管理员档位 rfc003-verify-opencode／OpenCode 1.18.29／Big Pickle，等待任务后取得输入控制。原三 Agent 保留；每次输入均在真实 TUI 中，不使用脚本模型回复。

第一轮 `ses_f608e5cb8ffeUzfsiuy1zRnrEk:msg_09f71a3620011m69lDwhOoVF4z` 于 10:23:39.874Z 开始，要求交互询问 Blue／Green。切到预览后工作页签显示待处理 1、顶部待处理 1→2；提示短暂消息消失后，顶部动态与页签仍可定位。动态的“前往处理”跳到 C、原 terminal／turn／event `d7b8c762-4122-4935-8eee-483cd78176dc`／seq=14879，原生问题仍等待回答。只读 API 证明请求 `que_09f71bedc0010WG2ZlseaI1qmz` 的 pending 保留、unread=false，查看没有代答。取得输入控制后 Down＋Enter 显式选择 Green，10:24:59.032Z 产生 answered／seq=14950；10:25:01.725Z 同轮 completed／seq=15018。原生画面实际显示 `RFC003_QUESTION_Green_DONE`。

第二轮 `ses_f608e5cb8ffeUzfsiuy1zRnrEk:msg_09f73f2e1001ae4tpunTcm4moW` 于 10:26:11.297Z 开始，实际询问 Keep／Discard。后台页签和动态持续显示需处理；问题 `que_09f73fb94001pymc3n14O6Rnc1` 的 opened 为 seq=15130。再次定位后原问题保留。Escape 于 10:27:18.025Z 产生 request-resolved=rejected／seq=15175，原问题选项关闭，pending=[]，没有继续提交旧问题的入口。该 CLI 随后 idle 但没有确定轮次终态，平台于 10:27:18.273Z 发出 turn-unconfirmed／seq=15181，画面“本轮结果未确认”；不能记作正常完成。此边界与现有 `nativeActivityAcceptance.test.ts` 的 question-reject 判据相符，后续新输入开启第三轮。

第三轮 `ses_f608e5cb8ffeUzfsiuy1zRnrEk:msg_09f76d9e2001X3lI00fSz49YpM` 于 10:29:21.506Z 开始，请求不使用工具，输出编号清单用于观察后台流式完成。进入发布页选择已推送 main／6af30245c4，说明中输入 `RFC003 release background draft keep` 并保持焦点。10:30:03.573Z 真实完成，event=`5ec1fb4f-ced7-40a0-b626-cf405021f6f4`／seq=16539；顶部未读完成从 4→5，说明仍完整、焦点仍在同一文本框。查看该结果先出现发布未保存输入确认且默认聚焦“继续编辑”；取消跳转后原说明保留。清空所属验收说明后再次查看，携带精确第三轮标识回到原 C，真实画面显示清单末尾和 `RFC003_RELEASE_BACKGROUND_DONE`，仅这条完成标为已读（5→4）。没有创建发布。

最后重新取得 C 输入控制，真实 Ctrl+C 于 10:32:54.748Z 只结束 C，exitCode=0／reason=exited／processEnded=true；当前第三轮仍为 completed，退出没有改写轮次结果。结束时实际 PTY 为 212×41。10:33:41Z 核对原 Claude／B／A 的四个身份字段均不变；QA HEAD 仍 `1aa2db9f9578edfce15dbf314f74302ac523de83`，工作区仅原 `?? .claude.json`，没有读取或更改此文件。C 保留在新页签与原生名册供查看，没有释放／重建任务容器。

临时结构化证据为 `crewstation-rfc003-question-before-answer.json`、`question-after-answer.json`、`question-dismissed.json`、`release-background-before.json`（该次查询时第三轮已经完成）、`question-final.json`。实机文字／画面来自本轮 CUA 记录。预览内部业务表单在切回 CLI 后会随 iframe 重新挂载，本批不将其作为跨视图草稿持久化证明；后台完成期间保留当前草稿和 CLI 原生输入的判据仍分别使用 E13／本批证据。

结合第四十批受控 resize／中断，UX-AT-29 的真实 CLI 原定条件按作者明确选择的 OpenCode 完成；Claude 外部模型配置限制继续如实记录，不将登录页当作模型成功。UX-AT-39 三种后台位置已覆盖，UX-AT-40 的查看／回答／拒绝闭环完成。本批新增 29／39／40，加第四十四批 23，累计 15 项通过、37 项仍待验收。没有新增生产代码，沿用第四十四批有效本地完整门禁；角色／市场范围授权仍待此前具体问题的答复，RFC-004 保持已批准、等待 RFC-003 完结后开工。

## 第四十六批：四窗 OOM、工作树保全与失败会话展示

本批基线为已同步的 `ae6c1c7bce4f1c68b16c60a469145e7f6c9328c6`；精确 SHA [CI 34834410502](https://github.com/wangbinquan/CrewStation/actions/runs/34834410502) 于 10:45:05Z 成功，1094 pass／8 skip／0 fail、1102 tests／186 files，console build 991ms。共享 console 为 49e64cc，后端与任务镜像为 3d1ce51。

### 四窗启动与真实失败

将个人布局切回原“工作区 1”，用“＋ CLI”逐个新增 D、E；没有批量启动或发送模型任务：

| CLI | agentId／terminalId | startedAt |
|---|---|---|
| D | agt_01a09f8a7bdc70009938b5c204bcc0a5／pty_01a09f8a7bdc7001a7b47db1f33d5623 | 2026-09-14T10:50:48.162Z |
| E | agt_01a09f8a90b3700090e3d96fce232e40／pty_01a09f8a90b370018d2b94ec1a23628f | 2026-09-14T10:50:53.497Z |

两者 source-ready 分别为 seq=17432／17447，均未开始模型轮次。布局 revision=71，原工作区为 [B, Claude, D, E]；人工输入验收页签仍为已结束 C，原 A 仍收起。页面曾显示四个窗和六条名册，但尚未完成 1280×720 的实际尺寸量测。原生 AX 的工作页签点击最初未生效，按实际截图坐标点击后切换成功，此工具交互现象没有被当成产品缺陷修改。

任务 Pod `cs-rfc003-verify-workbench/task-01a09eb4f03f` 于 `2026-09-14T10:50:58Z` 终止：reason=OOMKilled、exitCode=137、restartCount=0；UID 仍 `724ecb83-9fbd-4a36-9ad3-8266c6d84a42`。requests／limits 都是 1 CPU、2Gi memory、10Gi ephemeral storage。原 B／Claude 与新增 D／E 随任务失联，名册 lifecycle=unknown；原 A／C 仍有正常 ended 历史。不能再沿用前批“原 B 在线”的当时结论。没有把四窗短暂出现算作 UX-AT-35 通过，也没有通过调高资源后忽略这次故障。

### 工作树与原环境保全

TaskEnvironment 已 failed／connected=false，原服务端 message 只有“容器 已Failed”；原 GET dev-session 为 404。PVC `task-01a09eb4f03f-work`／UID `31042273-699a-4888-912b-06d9babadc72` 仍 Bound。创建一次性 Job `rfc003-worktree-inspect-20260914`，只读挂载该卷，以 worker UID 10001 运行 Git 只读命令和指定首页的 sha256sum；不启动 Runner、不挂载凭据、不读取认证文件内容。实际结果：

- HEAD：`1aa2db9f9578edfce15dbf314f74302ac523de83`；
- status：只有原 `?? .claude.json`；
- `src/pages/home.ts` SHA256：`248034cbabdd0d319d2a6c5c0aaf08a2ca2a0bf754a3cf442f16a4413f8c18c6`。

Job 成功后已清理，失败 Pod 与工作卷保留；没有释放、重建、导出／提交认证文件或改写 QA 工作树。旧 `rfc003-ux` Pod 仍 Running，UID=`4920b2aa-880e-49c3-a782-8575bbf9a42e`；`ux-comparison.txt` 摘要仍 `ee05185cb39c025d4968f1922cbd0218cc152a08e9cafb2c624522b9fba26dd3`。workbench 正式 v0.1.0、待验证 v0.1.1 的 releaseId／SHA 保持第四十二批记录，均 ready／1／1。

### 已实现的故障展示修复

TaskCluster 在实际 Failed 时提取当前主容器与 init 容器的原因、退出码，保留 Pod 的 reason／message；不把 Running 的 lastState 旧故障或成功退出容器误报为当前 OOM，不编造缺失字段。对账保存可读的失败说明，仍不自动恢复任务。历史上已经写入的模糊 message 不通过数据库补写伪造成当时就采集完整。

只读 `findDevSession` 增加可选 includeLatestFailure，开发页、项目摘要、工作树预检与版本比较的读取采用；失败工作树明确 unavailable，不再被当成没有会话。单次 SQL 限定当前项目／开发 kind、活跃优先，再按实际时间和 ID 查询最近一条。后续会话已释放时不翻出更旧 failed。创建／发布／释放与配额逻辑继续使用原活跃查询；用户仍能显式创建新任务，旧卷不会因此删除。

页面首屏显示失败 taskId 与已记录原因，原工作区保持同一 key，编辑器草稿与焦点不因失败刷新消失；失败状态优先于过时的已连接帧，暂停原 CLI 启动。新建沿既有远端分支接口，必须明确确认新工作树、原 CLI 不自动重启及页面未保存输入将丢失，默认聚焦保留当前工作区；取消与创建失败保持旧输入，不调用释放。失败对象没有可成功执行的释放入口，因此菜单不展示那个原来必然 404 的动作。当前没有新增保卷重建能力。

新增九项回归：五项 Pod 状态、一个真实 PostgreSQL 查询／生命周期、一个 dev-session 用例、两个真实工作台路由／编辑器。修复前定向复现 6 fail；修复后补验发布预检与版本比较，发现同一失败记录仍被当成 404；增加先红断言并修复两处只读查询。最终定向 **33 pass／0 fail／224 assertions**；因候选代码改变而重新完成门禁，最终 **1107 pass／4 skip／0 fail**，1111 tests／188 files／6134 assertions／109.10s，console build **547ms**。源码在该有效门禁后未改。日志为临时 `crewstation-rfc003-batch46-{red,targeted,check,build}.log`，关键结果已在此持久记录。

### 尚未完成的条件

Chrome 仍在运行，CUA 此时只能返回“CrewStation 工作台”窗口标题而无页面或截图；getState 曾超时并重置工具内核。已向用户请求恢复可见窗口，未收到答复，未声称锁屏，也未把浏览器不可读取归因为 Pod OOM。没有取得本批候选的实浏览器视觉证据。此前成员／市场范围具体授权同样待答复，未绕过已拒绝的 UI 权限变更入口。

开发会话保卷重建在现有 lifecycle 中没有可调用路径；正常 release 会删除 follow-container 卷。已将实际证据及两种恢复方向登记为 [I14](../../../docs/engineering/implementation-open-questions.md#i14-失败开发容器的工作卷恢复)，建议显式保留工作树重建并让旧 CLI 保持不可恢复，等待作者选择后再补该生命周期方案。未执行恢复或扩容。

本批不新增完整 UX-AT 通过项：累计仍 15／52，剩余 37。UX-AT-28 的新增失败隔离、34 的容器失效后完整界面、35／37 的真实四窗与五尺寸均继续；已有正常旅程证据保留其当时条件。本批修复尚未部署，发布／共享更新的实际结果另记。RFC-004 与 ADR-0004 已批准，继续等待 RFC-003 完结，T2–T9 未开始。

### 发布、共享部署与实际接口复验

源码提交 `03d15721f3e6682d10480c1e65d26a163fc8191b` 已精确提交 28 个所属文件并推送；主干 fetch 后确认 0／0。精确 SHA [CI 34838535851](https://github.com/wangbinquan/CrewStation/actions/runs/34838535851)／job `103957866651` 于 11:32:32Z 成功：**1103 pass／8 skip／0 fail**，1111 tests／188 files／64.44s，console build **1.27s**。候选生产源码／测试未再变动，下面只是部署和证据记录，不重复完整本地门禁。

最初 cs-api 镜像补丁被自动审批拦截，理由是没有识别共享服务更新授权，补丁当时未执行。随后用当前任务的原始消息核对：此前明确列出 docker-desktop／crewstation-system 八个服务、短暂重连影响和保留 QA 工作树的确认之后，作者于 `01a09ea8-3b5e-73a0-95f7-df0ea3a79f12` 回复“授权”。附上该原始记录重试同一精确命令后通过，没有改用旁路或再次索要同一授权。本次仅在原范围内更新 cs-api、cs-controller、console，逐个 rollout 成功，补丁先 test 对象 UID／generation／容器名／旧镜像，再替换唯一 image 字段。

| Deployment | 新 generation／实际 Pod | 新镜像及实际 imageID |
|---|---|---|
| cs-api | 20／cs-api-6c79545844-c547x | cs-control-plane:rfc003-03d1572／sha256:5aafd53024c14373b0d0b623db869d9fd26d1ee29a5c44a10017647b6d6b5b0c |
| cs-controller | 18／cs-controller-5f44554cf5-ncplw | cs-control-plane:rfc003-03d1572／sha256:5aafd53024c14373b0d0b623db869d9fd26d1ee29a5c44a10017647b6d6b5b0c |
| console | 22／console-744c8d5757-h45dq | cs-console:rfc003-03d1572／sha256:d96e491272b2c3855caf6391688626039a21ce5c8efa48a613cc9354ccce5fae |

上述实际 Pod 均 Running／ready=true／restartCount=0，imageID 与带完整 revision 的本次构建一致。cs-auth／cs-session／cs-events／两 MCP 的 generation 和 3d1ce51 镜像保持；没有迁移、修改配置或更新任务镜像。

11:54:02Z 在数据库恢复后，实际 admin 登录并只读复验：

- workbench GET dev-session 从原 404 变为 200，返回原 `tsk_01a09eb4f03f7000ba011a517772cc09`／state=failed／message=“容器 已Failed”。历史 message 未伪造补写。
- workspace-status 为 200／unavailable，带原 taskId 和实际已记录原因；没有调用失败 Runner 得到虚假干净工作树。
- version-comparison 为 200，仍列出真实生产 `v0.1.0`／`6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29`，workspace／commits／files 分别 unavailable；不将工作树不可读混同为未部署。
- workbench 正式 `rel_01a09eb30d3370009d26fd52ceeaa013`、预览 `rel_01a09f181c8d7000b2f2654113a1e737` 均保持 ready／1／1。delivery 仍从未开会话，GET 404；preview 仍是 `rel_01a09f2cfcf370008be553b3f3f81479`／ea10bd3，ready／1／1，正式 empty。
- 旧 QA 仍返回原任务 running；原 Pod UID、比较文件 SHA256 和 failed PVC UID／Bound 状态均与本批前值一致。没有释放失败任务、新建容器或修改角色／可见性。

临时取证文件为 `crewstation-rfc003-batch46-deployments-before.json`、`deployments-after.json`、`api-after.json`、`disk-recovery.json` 和 image-ids.json；已导入且 imageID 核实完成的本批镜像 tar 已清理。CUA 仍只有窗口标题，未取得新页面或截图；这些 API 结果不替代实际界面、OOM 隔离或工作卷恢复通过，累计仍 15／52。

### 同期节点磁盘故障及恢复

服务更新后首次登录请求超时。只读检查发现原 PostgreSQL Pod `8af25faa-c488-4591-a37b-94f170063294` 自 11:35:33Z 起不就绪，早于本次三个服务补丁；启动日志明确 `FATAL: could not write lock file "postmaster.pid": No space left on device`。节点总量约 118GiB，可用空间为 0。这里只确认直接故障原因，不把发生时序推断成某个镜像或容器造成全部磁盘增长。

数据库卷约 160MiB，QA 工作卷均保留。处理仅针对本任务可重建产物，先查所有 Docker／Kubernetes 容器引用以及完整镜像 ID，再清理十个已经被新版取代的旧标签：console 的 baf850b／64f37c3／layout，control-plane 的 project-creation／layout，task-runtime 的 claude-activity／activity／events-probe／layout／native；均为 rfc003 前缀。当前 03d1572、立即回退 49e64cc、仍在使用的 3d1ce51／dev 及全部业务镜像保留。随后仅清理其中五个无任何 CRI 容器引用的节点副本（console 三个、control-plane layout、task-runtime layout），没有全局 image／volume prune。

镜像标签清理后实际可用仍为 0，因此进一步按描述 `crewstation-console-build`、本 RFC 执行时间、Reclaimable=true、Shared=false 筛出九份旧编译缓存，再用完整锚定 ID 过滤重读，核对精确集合一致后才清理：`0uoqiokttjrzyersirn94ywzy`、`5gmvtt5l30nkzxturt5wccku9`、`gpyj4oft4z7mc88k6mzsxle2n`、`gqa8om5davmmc13v5bm5mjonl`、`ixvtxepxm445mso62cj22qsqc`、`jd3it3isks6fr1e1qk1lwuo5o`、`meg1ialf8tj9g0h6ivtlbdj4c`、`ni0z5tcn4mwxdw6o5jhomosii`、`wo9r7vrnilwmw132wh2x4ry9e`。实际回收 **1.059GB**，更早和本次候选缓存未清理。

没有重启或删除数据库 Pod，没有改数据库、用户文件、卷或节点设置。Kubernetes 事件等待确认原 PostgreSQL 自行恢复：startedAt=11:52:44Z，restartCount=9，ready=true；恢复后才完成上面的实际登录及业务读取。11:55:43Z 最终节点可用 **1,165,242,368 bytes（约 1.09GiB）**，旧 QA 文件和失败工作卷再次核对一致。空间仍有限，后续构建前须核对容量；不把本次有限清理记作整机容量问题已经根治。跨 RFC 排查要点已补入 dev-gotchas。

## 第四十七批：会话连接状态与真实容器状态

### 实机复现与修复

Chrome 原生 CUA 已恢复页面与截图读取，第四十六批的浏览器阻塞解除。共享 `03d1572` 的失败工作台可看到原任务、六条原生 CLI 名册、个人四窗布局及独立生产 v0.1.0。会话菜单没有释放入口；从远端新建的内联确认说明新工作树、未保存输入和旧 CLI 不自动恢复，默认焦点在保留当前工作区。实际取消后仍留在原失败工作区，本批没有发送创建／释放任务或启动 Agent。

同时复现：失败提示存在，顶栏及会话摘要却仍显示绿色“已连接”，摘要内 TaskRunner 又是未连接。原因是 StreamStatus 只使用浏览器 WebSocket 的 open；失败 Runner 不妨碍服务端回放历史。现改为任务 lifecycle 优先，其次判断 Runner 失联／收尾／关闭，最后才采用通道状态；顶栏和摘要共用同一组件，不再叠加相互矛盾的状态。连接变化不改任务生命周期、不重建编辑器。

动态菜单“待处理 2”实际列出未读的中断 A 和结果未确认 C，并有实时状态未确认说明，不是仍可回答的两个 pending 问题。本批没有修改活动记录、未读计数或发送答案。

### 先红后绿与候选实看

两条既有失败会话回归先加断言，再新增真实协议断连／恢复路径。初始 **1 pass／2 fail**；最终四文件定向 **16 pass／0 fail／137 assertions／2.42s**。测试覆盖 WebSocket open 期间 Runner 失联、恢复、收尾／关闭，失败后迟到的 runnerReconnected，以及 CodeMirror 节点、草稿、焦点保持和没有创建／释放写入。HTTP／WebSocket 边界仍是夹具，不冒充容器真实断连旅程。

候选 Vite 仅监听 127.0.0.1:8768，以 `console.cs.localhost:8768` 使用正常同域认证代理到共享真实后端。失败项目顶栏与会话摘要实看都为红色“失败”，历史补齐至 560 条仍保持失败、Runner 未连接；六条名册与原布局保留。再打开旧 `rfc003-ux`，回放最终 1475 条后顶栏及摘要正确显示“已连接”，任务仍 `tsk_01a0985a8624700090ea5b5ecd4fca86`，TaskRunner 已连接 cs-session；工作树 main／生产 v0.1.0 都是 a10027cda8，未提交文件 1、未推送 0。仅做只读页面观察，没有修改旧 QA 工作文件。

完整本地门禁 **1108 pass／4 skip／0 fail**，1112 tests／188 files／6151 assertions／109.27s，console build **781ms**。七个源码／测试文件哈希在门禁前保存，门禁开始后未改。临时证据为 `crewstation-rfc003-batch47-{red,targeted,check,build}.log` 及 candidate.json；关键结果在此持久记录。上一笔文档 HEAD `f8f04b697edcdd0aabedb906b775b4e2cfb0f7a3` 的精确 SHA CI 34841092272 已成功；本批提交、精确 SHA CI 和共享 console 更新待实际完成后补记。

状态显示修复不等于四窗资源保护或失败容器保卷恢复通过。累计仍 **15／52**，UX-AT-28／34／35／37 保留未完成；I14 和具体角色／市场范围问题仍待答复。RFC-004／ADR-0004 保持已批准、等待 RFC-003 完结，未开始 Hook 实现。

### 第四十七批发布、部署与共享页面复验

源码与上述记录已发布为 `10455cc61faea17a88ca3216a7db27f2e813b5eb`，精确 SHA [CI 34843959775](https://github.com/wangbinquan/CrewStation/actions/runs/34843959775) 于 2026-09-14T12:34:29Z 成功：**1104 pass／8 skip／0 fail**，1112 tests／188 files／60.04s，console build **1.17s**。提交前七个源码／测试文件与完整门禁候选哈希一致，推后 main 与 origin/main 同步。

只更新共享 console：`cs-console:rfc003-10455cc`，OCI revision 为完整上述 SHA；构建及实际 Pod imageID 都为 `sha256:ed0ddb412d76b5b2931d223f1ca5d15660ffabd26ef2d49e9163397c01ad0bb1`。镜像流式导入 desktop-control-plane，没有遗留导出 tar。Deployment UID 保持 `c4874a0e-6415-4c2b-b141-74ac25ea10ed`、generation 22→23；Pod `console-6488b6b76d-wr4tn`／UID `76204c7c-36aa-4237-9d1b-5623805b9b46` Running／ready／restartCount=0。cs-api／cs-controller 仍 03d1572，其余后端与任务镜像仍 3d1ce51，没有迁移或改配置。

共享页面实看失败工作台顶栏及摘要均为“失败”，历史回放不再变绿；六条名册、个人布局与独立生产 v0.1.0 保留。新建确认默认聚焦保留原工作区，取消未创建／释放任务。旧 rfc003-ux 完成回放后正确“已连接”，原 taskId／Pod UID、main／生产 SHA、未提交文件 1 及 ux-comparison.txt 摘要不变。候选 :8768 Vite 已停止。本轮没有恢复 OOM 任务或把其旧进程标为在线。

## 第四十八批：搜索、预览故障恢复与当前工作树发布

### 实际名称和 slug 搜索

共享项目列表分别搜索 `rfc003-ux` 与中文名称 `RFC-003 验收`，均得到对应唯一结果。点击“继续开发”直接回到 `tsk_01a0985a8624700090ea5b5ecd4fca86`，Runner 连接就绪；未创建新任务。浏览器返回保留中文查询。这补齐 UX-AT-01 原定的名称／slug 与原会话接续；不替代 UX-AT-24 的全部旧链接／两空间历史验收。

### 专用文件与预览项目

按已授权的 rfc003-verify-* 验收范围，新建 `rfc003-verify-files`／`prj_01a09fecbba97000843701962d998a7a`，负责人仍为既有 admin；服务 `svc_01a09fecbbac7000905703a66e255046`，没有成员或可见性变更。minimal-sample 初始 HEAD `a643183db07916908c63254e8186d44c8b7445ce`，首个 preview v0.1.0=`rel_01a09fecc4d77000afd79cb1ac0dc206`，正式槽为空。

新开发任务 `tsk_01a09ff07aeb7000897fd0eda1e16cd2` 于 12:42:12.587Z 创建；Pod `cs-rfc003-verify-files/task-01a09ff07aeb`／UID `fa4dcc5e-3eb6-4557-a6bf-b6301dca4160`，原 3d1ce51 任务镜像、1 CPU／2Gi 内存。只新增一个真实 OpenCode：Agent `agt_01a09ff2f4f97000b13dde63dc4b96e7`、终端 `pty_01a09ff2f4f97001bb9f6208c42dc089`、Runner `9992bfd0-2491-49a3-81c1-39268cdb900d`，startedAt=12:44:54.922Z，使用已有 rfc003-verify-opencode 档位／OpenCode 1.18.29／Big Pickle。

### 预览崩溃、日志、编辑与重启

故障注入只作用该新项目 worker 的预览进程：核对 uid=10001、cwd=/work 和完整 argv `bun run --watch src/main.ts`，最多终止六个实际 PID、总时限 90 秒，覆盖 supervisor 的五次退避重启。TaskRunner 和 OpenCode 均未终止；12:48:13.979Z 预览达到 crashed／SIGKILL，UI 仅在预览区报错，开发连接与 CLI 保持可用。

实际点击“查看开发会话日志”进入精确 taskId 的运行与诊断页，preview 关键词定位到 attempt 5／16 秒退避、attempt 6 与 crashed 记录；返回 CLI 后原未发送 `RFC003_PREVIEW_DRAFT_KEEP` 仍在。清理本次验收草稿后要求 Agent 只回复 `RFC003_PREVIEW_ISOLATED`，不调用工具或修改文件。真实轮次于 12:49:32.110Z–12:50:41.871Z 完成，期间预览仍崩溃；完成事件 `cc09922b-8d66-48bb-935a-3db0ff05771e`／seq=2004，原进程保持在线。

预览崩溃期间，通过编辑器将 `src/pages/home.ts` 的 h1 从“CrewStation 最小样例”改为“RFC003 预览恢复验收”，保存成功；Git diff 只有该行 +1／−1，文件 SHA256=`3e6ba15db51c1ff971b0e762586bb38e10510e596acf01f1987ac390a8e74022`。实际点击一次重启，dispatch=`c15-3tkk1d`；12:51:50.617Z starting、50.657Z listening、51.125Z ready。iframe 显示新标题、development 环境，旧 SIGKILL 错误清除。taskId、Pod、Runner、Agent、terminalId 和 startedAt 均保持，UX-AT-05 完整通过。

### 未提交拦截、手动提交与真实发布

“当前开发工作区”来源显示 main／a643183／未提交文件 1。点击检查明确列出 home.ts 和定位入口，提示“尚未发起发布”，历史仍只有 v0.1.0。实际文件链接回到该任务、该文件和新标题。会话菜单进入独立的历史对话页面，再使用普通终端自行验证和提交；没有把历史对话等同于原生 CLI。

样例应用 `bun test` 返回 `No tests found!`，不算测试通过。首次 bundle 因 node_modules 缺 Hono 失败；`bun install --frozen-lockfile` 成功安装五包后，`bun build src/main.ts` 实际成功，33 modules／8ms／68,273 bytes。Git 仍只改 home.ts。首次提交明确报 `Author identity unknown`；随后仅本条命令指定 RFC003 QA／rfc003-qa@demo.invalid 的作者与 Codex co-author，未改全局 Git 身份。精确提交 home.ts 为 `a80dbc102e8b6db71e778d0092e5d78865330d4d`，一行改动、工作树干净；这是专用样例应用提交，不是 CrewStation 主仓提交。

重新检查来源通过。首次从该样例 main 发布被 GitLab 受保护分支拒绝，界面显示“推送失败，未打标签”，说明草稿保留、没有新 release；既有 Developer 会话凭据与 main 保护保持。这符合原设计推送失败停止的契约，不提权或绕过。随后仅在独立 QA 应用从同一 SHA 创建普通开发分支 `codex/rfc003-files`；CrewStation 主仓始终 main。界面重新确认真实分支／SHA 后发布 v0.1.1。

实际 release=`rel_01a0a006547c7000906f933ff49b6d96`，13:06:04.537Z 创建、13:06:25.364Z ready，build Job `build-933ff49b6d96` Succeeded。preview green 就绪 1／1，SHA 为 a80dbc102e8b6db71e778d0092e5d78865330d4d；v0.1.0 标为已被替代，正式槽仍为空。点击“试用待验证版本”实际打开 preview.rfc003-verify-files.cs.localhost，显示新标题、CS_SLOT=green、CS_ENVIRONMENT=production、正确项目 slug。UX-AT-07 的未提交拦截→定位→用户提交→重新确认→发布闭环通过；不声称受保护 main 推送成功。

### 资源恢复与发布后计数缺陷

节点请求 CPU 为 9550m／10 CPU，构建需要 1000m。只临时将 files-green 和原 workbench-blue 两个专用 QA 的非正式 preview 调为 0；main 推送失败后先全部恢复，再为普通开发分支发布作同样临时调整。每个补丁都核对 Deployment UID／generation／原副本数／release，未调整活动正式槽。13:12:29Z 最终两者均 generation=5、desired=ready=1：files-green 已由控制器换到上述新 v0.1.1，workbench-blue 仍原 rel_01a09f181c8d7000b2f2654113a1e737；workbench 正式 green 的 UID／generation=1／v0.1.0／1／1 未变。新开发 Pod UID 不变、Running／restartCount=0。节点仅余 893,884KiB，容量问题未根治。

13:12:57Z 最终读取发现工作树虽干净、v0.1.1 已实际部署，`unpushed.count` 仍为 1／a80dbc1；共享开发页面也实看“未推送提交 1”。原因是发布用临时 URL 直推，Git 不更新任何本地 remote ref，而工作树统计按已知 remote refs 计算；新分支没有上游不等于尚未推送。没有手动 fetch 或设 upstream 消除故障证据。

修复留在 dev-session L5 的原发布用例：通过仅本进程有效的 `GIT_CONFIG_COUNT` 配置具名 cs-publish remote，让 Git 成功回执更新 `refs/remotes/cs-publish/*`；不更改 origin、branch upstream 或持久 Git 配置，短期 URL 不写配置文件。工作树统计沿用现有 Runner，无需重建开发容器。配置方式见 [Git 官方文档](https://git-scm.com/docs/git-config#Documentation/git-config.txt-GITCONFIGCOUNT)。真实临时 Git 仓库回归先 **1 pass／1 fail**，稳定复现缺少 tracking ref；修复后验证只推确认 SHA、后来提交继续计为未推送、下次成功清为 0，以及 pre-receive 拒绝不更新记录、不打标签。定向四文件 **15 pass／4 skip／0 fail／60 assertions**，4 skip 为当前隔离连接条件下未执行的数据库用例；完整本地门禁和修复发布／实机复验继续。

新增 UX-AT-01／05／07，累计 **18／52 通过、34 项仍待完成**。UX-AT-32 等发布后版本提示保留本次缺陷及修复待部署状态，UX-AT-52 只实看历史入口，没有把普通终端提交算作历史 Agent 对话接续。临时证据为 `crewstation-rfc003-files-{preview-fault.log,preview-recovery-logs.json,release-after.json,final-runtime.json,final-session.json}` 与 batch48 回归日志。I14 与具体成员／市场范围问题仍待答复；RFC-004／ADR-0004 已批准，T2–T9 等待 RFC-003 完结后启动。

第四十八批完整本地门禁 **1108 pass／4 skip／0 fail**，1112 tests／188 files／6162 assertions／105.63s；console build **606ms**。完整门禁可访问隔离测试数据库和本机测试 GitLab，定向中跳过的 dev-session 四项在完整门禁中已执行；最后四项跳过仍是 opt-in K8s、两个原生 CLI 与 Linux Ctrl+C。三个源码／测试文件与门禁前 candidate.json 哈希一致。文档相对链接、52 个唯一验收编号和 18／34 计数通过检查，尚无本批精确 SHA CI 或部署证据。

### 第四十八批发布、API 部署与原会话复验

六个精确路径已发布为 `9642e23fb4ed0e033d32eeb9ae938ffb276380d2`，主干推后同步且工作树／索引干净。精确 SHA [CI 34849087951](https://github.com/wangbinquan/CrewStation/actions/runs/34849087951)／job 103992178602 于 13:27:13Z 成功：**1104 pass／8 skip／0 fail**，1112 tests／188 files／66.27s，console build **1.14s**。没有重跑未变的本地候选完整门禁。

官方 control-plane Dockerfile 构建 `cs-control-plane:rfc003-9642e23`，revision 为完整源码 SHA，镜像流式导入节点、没有 tar 留存。只更新 cs-api 唯一 image 字段，补丁先 test UID／generation／容器名／旧镜像；Deployment UID `b29a07a4-f251-46d4-8b67-d6c456c85749` 不变、generation 20→21，Pod `cs-api-645c665469-s8dtw`／UID `68888c03-cff4-478d-8a6b-bc67735e4019` Running／ready／restartCount=0。实际 imageID 与构建均为 `sha256:9b4eb107decd4eea51baf740fb90b03d26fe80e3581e6381cf65acdfe269ee22`；容器内 publishFromSession.ts 的 SHA256=`641b6cd5924f55adf511f1cf17d4389a2d593b3e995373fd3a65178d7c0617e1`，与门禁候选一致。console 仍 10455cc，cs-controller 仍 03d1572，其余服务／任务镜像／配置／迁移不变。

这时 CUA 明确报告 Mac 锁定且不能自动解锁，已请求用户手动解锁，没有把继续的接口取证描述成界面实看。先通过平台 SCM 只读确认远端 codex/rfc003-files 已为 a80dbc1、main 仍 a643183；不使用工作区已失效的克隆凭据反复重试，也不手动 fetch 或设置 upstream。现存新任务保持同一 taskId、干净工作树和确认 SHA，再通过正常 `POST /v1/projects/:id/publish` 发布明确版本 v0.1.2，仅验证该修复，未改源码或切正式流量。

实际 HTTP 202 返回 `rel_01a0a02027f67000ad506c35e7e40836`，创建于 13:34:17.076Z，build Job `build-6c35e7e40836` 于 13:34:27Z Complete／Succeeded=1，发布 13:34:32.654Z ready；preview green 为 v0.1.2／同一 a80dbc102e8b6db71e778d0092e5d78865330d4d，正式仍空。实际预览 HTTP 200 且新标题存在。这不补齐 UX-AT-09 的测试者／202 阶段界面条件。

13:34:45Z 与 13:35:54Z 原会话 workspace-status 都为未提交 0／未推送 0，upstream 仍 missing。Git 实际新增 `refs/remotes/cs-publish/codex/rfc003-files` 指向 a80dbc1；`.git/config` 摘要前后为 `43df3f42910e5957f451c451f1f516bb481f425490ca9939eb7876c41503f41c`，home.ts 摘要仍 3e6ba15d…。原 Pod UID／restartCount=0、OpenCode agentId／terminalId／Runner／startedAt、completed 轮次和 throughSeq=2004 都保持。本次未重建任务容器或创建额外 Agent。

构建前同样暂调零的 files-green／workbench-blue 已再次全部恢复，13:35:56Z 两者 generation=7、desired=ready=1；files 控制器部署 v0.1.2，workbench 蓝槽仍旧 v0.1.1。原 workbench 正式 green 的 UID／generation=1／release／1／1 均保持。PostgreSQL 原 Pod 仍 ready／restartCount=9，最终节点仅余 **401,764KiB**，未将容量描述为已根治。证据为 batch48 的 api-after、v012-started、workspace-after、final-api、final-runtime JSON 及构建／导入／CI／rollout 日志。界面计数和其余实机旅程待解锁继续，累计仍 **18／52**；RFC-004 继续排队，Hook 未开工。


## 第四十九批：迁移失败、恢复发布与日志事实

### 真实迁移失败与原版本保持

原 files QA 任务 `tsk_01a09ff07aeb7000897fd0eda1e16cd2` 保持一个 OpenCode，轮次 completed、无 pending。工作树 a80dbc1 干净。只在 crewstation.yaml 的 spec.release 下加入 `migrationCommand: ["bun", "-e", "console.error('RFC003_MIGRATION_FAILURE'); process.exit(42)"]`；通过实际 ManifestSchema 校验，仅输出标记和退出，不连接数据库。精确提交 `490c30d676a6e4d3908415df5c0117fb8501fd79` 只有该文件 +1 行；未改变持久 Git 配置。

正常平台 API 发布 v0.1.3=`rel_01a0a03773bf7000a6d00e16f132a40d`，13:59:43.805Z 受理、13:59:59.138Z failed，消息为“迁移失败，未切流：Job has reached the specified backoff limit”。Job `migrate-0e16f132a40d`／UID `9e4f8595-edc9-40d0-a0f5-adef65bf6bc5` 于 13:59:56Z Failed；Pod `migrate-0e16f132a40d-ckgkz`／UID `eeb58b0d-b924-43cb-86e7-b71c12dbc0ef` 真实 exitCode=42。Kubernetes 原始时间戳为 `2026-09-14T13:59:54.295718172Z RFC003_MIGRATION_FAILURE`。

14:02:36Z API 读取失败记录和相同 releaseId 的 migration 日志；v0.1.2 的迁移日志为空。实际预览仍 v0.1.2／a80dbc102e8b6db71e778d0092e5d78865330d4d、ready 1／1，正式槽空。工作树 490c30d 已推送、未提交 0／未推送 0，但对预览仍领先 1、差异文件 1，正确区分“已推送的失败发布”与“实际部署”。

### 恢复与保全核对

只移除本次验收命令，精确恢复提交 `e4741df56b440d776b7c25ff5a4978b3d5822f46` 只有 crewstation.yaml −1 行。完整 tree=`7ea392dae01a5a4e100d9ac4f413a8852293970e`，与故障前 a80dbc1 相同。通过正常 API 发布 v0.1.4=`rel_01a0a0426f4c7000b7ce58ff67c80bc8`，14:11:43.562Z 受理、14:11:54.631Z ready。14:13:18Z 实际预览 HTTP 200 且原标题存在；工作树与预览 SHA 相同、差异 0、未提交 0／未推送 0，新版本无迁移日志，v0.1.3 失败历史和标记保留。

两次构建均因 9550m／10 CPU 的资源请求，暂调零 files-green 和 workbench-blue 专用预览，所有补丁核对 UID／generation／副本数／release。失败周期恢复到 generation=9，恢复周期最终到 generation=11，均 desired=ready=1；workbench-blue 仍 v0.1.1。workbench 正式 green 的 UID `05b18ca7-b4e2-4116-b834-0ec5516cddb7`／generation=1／v0.1.0 不变。原 files Pod UID `fa4dcc5e-3eb6-4557-a6bf-b6301dca4160`、Running／restartCount=0，OpenCode agentId／terminalId／Runner／startedAt 及 throughSeq=2004 均保持。首页 SHA256=`3e6ba15db51c1ff971b0e762586bb38e10510e596acf01f1987ac390a8e74022`，Git 配置 SHA256=`43df3f42910e5957f451c451f1f516bb481f425490ca9939eb7876c41503f41c`，与故障前一致。

### 日志元数据缺陷与修复

同一固定标记在旧 API 中先返回 14:02:36.707Z、后返回 14:13:18.608Z，都标成 stdout；发生时间被查询时间替换，console.error 也没有真实来源信息。原因是 K8sClient 没有 timestamps 参数，clusterObserver 宽松 Date.parse 正文首词并以当前时间兜底，还吞掉单个 Pod 的读取错误。修复请求 `timestamps=true`，严格验证时间前缀并规范到毫秒，缺失或非法时 ts 缺省且保留完整正文；默认混合日志为 stream=combined。界面显示未知时间、保留完整时间提示，混合输出无明确级别时用中性 LOG；原 stdout／stderr 继续兼容。完整日志页不再对缺失 ts 调 localeCompare，按接口顺序过滤显示。读取失败如实报错，不返回假空记录或不完整的成功页。

依据为 [Kubernetes 日志时间戳选项](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) 与 [容器日志流说明](https://kubernetes.io/docs/concepts/cluster-administration/logging/#container-log-streams)。本批没有启用分流 feature gate、改节点日志配置或新增日志存储；来源选择、releaseId／taskId 约束和尾部上限保持原接口。

最初两文件七项回归结果为 2 pass／5 fail；补完整路由的缺失时间用例也先稳定失败，再修 useLogFeed。最终两文件九项加路由一项，共新增十项，定向五文件 27 pass／2 skip／0 fail、113 assertions／1.426s；两个 skip 是当前隔离连接下未执行的 observability 数据库用例和 opt-in K8s 用例。完整门禁先后在新代码的类型收窄／夹具默认命名空间、前端缺失时间排序处停止，均已修复，两类类型检查通过；最终完整门禁与发布结果待完成后补记。原始临时证据为 batch49 的 migration-failed、recovery、feed-red、targeted、candidate 与 check 系列文件。

### 未完成的实机与方案选择

只读核对当前单 CLI 容器的 cgroup：memory.max=2147483648、memory.oom.group=1、memory.current=899342336，oom 相关计数为 0，挂载只读；没有对当前任务施压。I15 已记录逐 CLI 独立 Pod 与委派子 cgroup 两个完整方向及模块影响，等待作者选择，不把容器资源调大视为故障隔离。I14 保卷恢复与具体测试成员／市场授权也仍待答复。

Mac 此时仍锁定；本批故障、恢复和日志结果来自实际 API／集群，不替代失败发布到日志的一跳界面旅程。UX-AT-13 保留未通过，累计仍 **18／52，34 项待完成**。RFC-004／ADR-0004 保持已批准，严格等待 RFC-003 完结后启动，Hook 代码未开始。


第四十九批最终完整本地门禁 **1118 pass／4 skip／0 fail**，1122 tests／190 files／6189 assertions／105.67s，console build **566ms**。定向中受连接条件跳过的 observability 集成用例在完整门禁已执行；最后四项为 opt-in K8s、两个原生 CLI 与 Linux Ctrl+C。十二个源码／测试文件的 SHA256 与最终门禁前 candidate.json 一致。此前两次类型阶段失败未被记作有效完整门禁。本段记录时尚未提交、部署新日志修复；源基线 293a7d0 与 origin/main 同步。


### 第四十九批上库、镜像和当前部署边界

17 个精确路径已发布为 `cbe28250607aa4084d74556c32aff650a9347783`，推后 main 与 origin/main 同步、工作树与索引干净。精确 SHA [CI 34856194400](https://github.com/wangbinquan/CrewStation/actions/runs/34856194400)／job `104016262371` 成功：**1114 pass／8 skip／0 fail**，1122 tests／190 files／61.71s，console build **1.24s**，终态时间 14:34:03Z。纯证据补记不重复未变的本地完整门禁。

节点仅余约 370MiB，因此本次镜像复用经过核对的已部署基底。控制面基于 `cs-control-plane:rfc003-9642e23`，仅覆盖 observability 模块、contracts 与 k8s 包；基底 revision、源锁文件、全部包清单及原构建配方与本次源依赖一致。原标准 Dockerfile 删除 console／task 两个 workspace 后的 bun install 会重写镜像内 lock，不能误要求其摘要等于源 lock。本次没有重新解析或安装依赖。console 基于 `cs-console:rfc003-10455cc`，继承同一 serve.ts 和启动命令，仅替换最终本地门禁生成的 dist，清除镜像层中的旧 dist 后复制六个当前产物；不删除主机或卷内容。临时构建目录为 `/private/tmp/crewstation-rfc003-batch49-images-t2evjh5v`，不是 Git checkout，没有改仓内 Dockerfile。

两镜像 revision 均为完整 cbe2825：控制面 imageID=`sha256:6afe80c20228060f26c7263527c2fea0416f704b25eda46dd78b2a047208dbed`，console imageID=`sha256:42715cdf7e4b89916547a96d9f478b3812d855cc7ac0f17c85b22a201ff62a2a`。无网络临时容器中，三个后端改动源码和全部六个 console 文件逐项 SHA256 与候选一致，未残留旧静态文件。

首次导入被自动审批按镜像总大小约 688MB／节点余量约 373MB 拒绝。随后仅只读扫描实际导出归档与节点 content digest：console 共 211,705,906 bytes，其中 208,006,144 已存在，仅缺 3,699,762；后端共 517,326,873 bytes，其中 517,030,912 已存在，仅缺 295,961。新增共 **3,995,723 bytes**。据此同一导入经复核获准，始终流式传输、无 tar 落盘，每步检查余量高于 300MiB；两镜像 import 都退出 0，导入后剩余 **368,848,896 bytes**。没有清理任何镜像、构建缓存或卷。

随后 console 滚动更新被自动审批拒绝。已从当前任务原始记录核对当时明确询问的八服务更新、专用 RFC 完整验收和用户“授权”回复，但复核仍不接受会话文件作为此次具体部署授权，要求重新确认。现已提出只更新 `console → cs-console:rfc003-cbe2825`、`cs-api → cs-control-plane:rfc003-cbe2825` 的具体问题，待答复；**两 Deployment 补丁均未执行**。14:39:29Z 实际 console 仍 generation=23／10455cc，cs-api 仍 generation=21／9642e23，均 1／1；PostgreSQL 原 UID 不变、ready=true／restartCount=9。镜像已导入不等于代码已部署，新的日志时间和中性级别尚无共享环境复验。

后续收到本次更新确认后，先 console 再 cs-api，分别验证原 UID／generation／唯一镜像和 rollout，再用保留的 v0.1.3 失败记录核对同一时间戳、来源及 releaseId 过滤。浏览器仍待解锁；具体成员授权、I14 与 I15 也待答复。当前没有临时调零的 QA 副本、运行中的候选 Vite 或未恢复的验收命令。RFC-003 仍 **18／52**，RFC-004 继续排队。

## 第五十批：全部部署槽日志筛选

日志界面的“全部部署槽”已经省略 slot，但 `modules/observability/application/logsAndHealth.ts` 仍以 `query.slot ?? 'prod'` 选择物理槽，实际结果被缩窄为正式槽。修复仅在明确传入 prod／preview 时按当前角色选择 blue／green；省略 slot 时在原项目命名空间内按服务名及 `crewstation.io/workload=service` 查询，避免混入同服务的开发任务。发布／迁移／任务日志来源和原有尾部上限保持。

新增模块 API 回归覆盖全部、正式与待验证三种选择，并检查全部槽记录不被标成某个查询角色。修复前 **3 pass／1 fail**，明确复现全部槽仍选 blue；最终与 Kubernetes 日志和完整日志页回归合跑 **22 pass／0 fail／102 assertions**（三文件、1097ms）。完整本地 `bun run check` **1119 pass／4 skip／0 fail**，1123 tests／190 files／6191 assertions／102.42s；两项候选源码／测试的 SHA256 与门禁前记录一致。console 源码和依赖没有变化，沿用第四十九批有效 build 566ms，不重复完整门禁。

只读查询 `cs-rfc003-verify-workbench` 中真实 Pod 标签：单用服务名匹配 blue、green 和原失败 `task-01a09eb4f03f`；增加 workload=service 后只匹配 blue UID=`0f0d1e02-e85a-4ba2-9f9b-104715c7dc58`、green UID=`eb118c64-96e6-4f8d-9594-d7e4ad97eab2`，两者 Running。任务 UID=`724ecb83-9fbd-4a36-9ad3-8266c6d84a42`／workload=dev-session 被排除。未修改任何 Pod、标签、部署或工作卷；这是实际选择器证据，不是已部署 API 或完整页面验收。

临时证据为 `crewstation-rfc003-batch50-{red,targeted,check}.log`、candidate.json 和 live-selector.json；关键结果已在此落档。此前纯证据提交 `6ecef0b3852425f34c1ef74f3796100d2adb85bb` 的精确 SHA [CI 34857895769](https://github.com/wangbinquan/CrewStation/actions/runs/34857895769) 已成功：1114 pass／8 skip／0 fail，1122 tests／190 files／6148 assertions／55.35s，console build 993ms，终态 14:49:37Z。本批提交后的精确 SHA CI 另行核验。

第四十九批 rfc003-cbe2825 两镜像的具体滚动更新授权仍待回复；其中不含本批全部槽修复，未重标镜像或重试被拒绝的部署。Mac 解锁、I14／I15 和成员范围问题也仍待答复。验收维持 **18／52**，RFC-003 In Progress；RFC-004／ADR-0004 已批准，T2–T9 严格等待 RFC-003 完结后启动。

### 第五十批上库、明确部署授权与实际复验

本批六个精确路径已发布为 `80d1020195f456ca010d43265926f0b1e7403f79`，推后 main 与 origin/main 同步、工作树与索引干净。精确 SHA [CI 34859748456](https://github.com/wangbinquan/CrewStation/actions/runs/34859748456)／job `104028517997` 成功：**1115 pass／8 skip／0 fail**，1123 tests／190 files／6150 assertions／67.38s，console build **1.32s**，终态 15:06:49Z。作者随后明确“你可以自由更新本机上部署的服务”，先前本机服务更新的待确认已解决；没有将这条服务更新授权扩大成成员角色变更或 I14／I15 的方案裁定。

console 使用此前已核对并导入的 `cs-console:rfc003-cbe2825`。API 新构建 `cs-control-plane:rfc003-80d1020`，基于实际 imageID=`sha256:6afe80c20228060f26c7263527c2fea0416f704b25eda46dd78b2a047208dbed` 的 cbe2825 基底，只覆盖本批两个源码／测试文件；源依赖和锁文件没有变化，没有重新安装依赖。临时增量上下文 `/private/tmp/crewstation-rfc003-batch50-image-rpb_cf_x` 不是 Git checkout。API 新 imageID=`sha256:7ceb696e459aaf821fd96ff92487e1d7627737a9cd4fdc3742f29b02c81a8413`，revision 为完整 80d1020，五个相关文件在无网络临时容器中逐项匹配。导出流与节点 content digest 对照确认仅新增 **39,925 bytes**；流式导入退出 0、无 tar 落盘，余量由 349,319,168 变为 349,196,288 bytes，没有清理镜像、缓存或卷。

按原 Deployment UID／generation／唯一容器名／旧镜像的 JSON Patch test 校验，先 console、后 cs-api，只替换镜像并等待 rollout 完成。console 15:07:01Z 就绪，generation=24、Pod `console-694d6b9dcb-sq4fj`／UID `1e91a44c-51bd-435c-a52d-d7e492164a19`，实际 imageID=`sha256:42715cdf7e4b89916547a96d9f478b3812d855cc7ac0f17c85b22a201ff62a2a`，六个静态文件摘要匹配。API 15:12:13Z 就绪，generation=22、Pod `cs-api-6b7d5b677c-mwsrc`／UID `a48eedd9-bcd9-49f0-b315-8fb3da2703cd`，实际 imageID 为上述 7ceb696e，五个文件再次在运行 Pod 内核对。均 1／1、restartCount=0。初次校验工具使用 app=console 及未规范化的容器镜像名称，未匹配到 Pod；改为真实 Deployment selector 和 imageID 后取得上述证明，没有把空匹配当作通过。

15:15:08Z 的真实工作台 API 查询：全部槽返回 blue／green 两 Pod，prod 只返回 green、preview 只返回 blue，没有包含原失败开发容器。两条记录时间分别为 `2026-09-14T06:55:45.390Z`、`2026-09-14T14:12:30.333Z`，两次查询完全相同，与直接 kubectl 容器日志规范到毫秒后的值逐条一致，source=slot／stream=combined。明确角色的记录带该查询角色，全部槽没有伪造角色。

原 v0.1.3 失败发布仍为 failed，但 migration 日志为空；直接读取确认其 Job 和 Pod 都已不存在。`modules/release/adapters/k8s/migrationJob.ts:11` 使用 `jobObject`，`packages/k8s/objects/workloads.ts:109` 默认 `ttlSecondsAfterFinished=3600`；故障发生于 13:59:54Z，到本次复验已经超过该保留期。未人为删除或重建这些对象，也没有把留存的历史日志文件冒充当前 API 返回。此次用仍在运行的蓝绿 Pod 验证实际时间与流元数据；UX-AT-13 仍需在新故障日志可查时完成页面旅程，不扩大现有日志保留承诺。

15:16:50Z 再次核对：files 任务／单个 OpenCode／Runner、旧 rfc003-ux Pod UID、首页及 Git 配置摘要保持；工作树 `e4741df56b440d776b7c25ff5a4978b3d5822f46`、未提交 0／未推送 0、preview v0.1.4／正式为空均不变。files-green 和 workbench-blue 仍 generation=11／1／1；workbench 正式 green 仍 generation=1／v0.1.0／1／1。PostgreSQL 原 UID 保持、ready=true／restartCount=9，节点余量 **334,888KiB**。当前没有临时调零副本或未恢复的故障命令。

临时证据为 batch50 的 source-ci、console-verified、image-build／content／import-budget／import、api-verified、api-logs-observed／verified、migration-log-resource、final-environment JSON 和相关日志，关键结果已在此持久记录。尝试继续浏览器验收时 CUA 再次明确报告 Mac 锁定、无法自动解锁。I14／I15、成员范围和解锁仍待答复；没有新增完整页面通过项，累计 **18／52**。RFC-004 仍按已批准的顺序等待 RFC-003 完结。此次只补部署与验收事实，沿用未变候选的本地完整门禁。

## 第五十一批：真实 API 试调与目录路由一致性

15:33:05Z 经普通 `api-invocations` API，从原 files QA 任务 `tsk_01a09ff07aeb7000897fd0eda1e16cd2` 调用默认开放的 `test-gitlab:GET:/v4/projects/{id}/repository/commits/{sha}`，只读取自己的 GitLab 项目 114／提交 `e4741df56b440d776b7c25ff5a4978b3d5822f46`。平台 HTTP 200，容器实测目标 HTTP 404／text/plain／7ms。源 Pod UID=`fa4dcc5e-3eb6-4557-a6bf-b6301dca4160`、IP=`10.244.0.248`，`CS_INTERNAL_API_BASE` 与裁剪 OpenAPI 都指向共享服务网关；没有启动 Agent、改调用授权或开放策略。

只读检查发现服务 `svc_01a0915af70b70018eeac75d94c708f4` 同时保留 removed 的 `reference-api-proxy` 和 active 的 `test-gitlab`。组合根原先从目录列表取该服务的首条记录，实际 IngressRoute 仍匹配 `/api/reference-api-proxy`，与请求 `/api/test-gitlab` 不一致。改为 api-catalog 的服务定点活动代理查询，不删除目录历史。另一个确定性回归证明：网关先消费发布事件会使用旧目录，目录随后更新而网关游标已推进，实际路由不会再次刷新。目录登记事务提交后，经组合根注入的回调执行既有 reconcileService／rebuildAllowlist，失败保留事件消费重试；没有模块反向依赖或新增 HTTP 接口。

新增 `modules/platform/tests/gatewayCatalogRoutes.test.ts`，使用隔离 PostgreSQL、真实组合根和事件消费者、Fake K8s 检查实际应用的 IngressRoute。首组修复前 0 pass／2 fail，顺序回归修复前 2 pass／1 fail；最终定向 **21 pass／0 fail／158 assertions**（四文件、1298ms）。完整门禁最初缺少测试 ReleaseId 的品牌类型，已补齐；随后一次沙箱执行无法绑定本机端口或连接测试库，出现 38 fail／143 skip，不作为有效验证。正常本机权限下的最终 `bun run check` 为 **1122 pass／4 skip／0 fail**，1126 tests／191 files／6202 assertions／107.29s；新增三项组合根回归均执行，五个候选文件摘要与门禁前一致。console 源码及依赖未变，沿用第四十九批有效 build 566ms；没有重复已通过候选的完整门禁。提交后的精确 SHA CI 与部署结果单独核验。

15:43:10Z 参考代理 `prj_01a0915af70b7000a571b0724160a057` 的正式槽为空；preview green 为 ready／1／1，v0.1.2=`rel_01a0915ec42a700096cd2e21d9d3e9d0`／`7dee80be75906e6265094bf852866a2ceb96bd0e`，当前内部路由仍指向不存在的 blue。后续先发布验证过的控制面修复、按作者本机更新授权更新实际读取代码的 cs-api 与 cs-controller，再通过普通上线动作及网关重算验证默认开放 GET。没有以直连预览替代正式服务路由。

临时证据为 batch51 的 invocation、catalog-preflight、operation-spec、route-preflight、proxy-runtime、proxy-delivery-preflight JSON 与 red、order-red、targeted、check 日志。Mac 解锁、I14／I15 与成员范围问题仍待答复；页面完整旅程不因 API 定位而记通过，累计仍 **18／52**。RFC-004 继续等待 RFC-003 完结。

### 第五十一批上库、部署与 I9 出站阻塞

十个精确路径已发布为 `e26515eb6dbb67fc5cf894bb9996b1885144e788`，推后 main 与 origin/main 同步、工作树和索引干净。精确 SHA [CI 34865123328](https://github.com/wangbinquan/CrewStation/actions/runs/34865123328)／job `104046908815` 成功：**1118 pass／8 skip／0 fail**，1126 tests／191 files／6161 assertions／68.43s，三个新增组合根回归实际执行，console build **1.10s**，终态 15:55:58Z。

新镜像 `cs-control-plane:rfc003-e26515e` 使用已验证的 80d1020 基底，只覆盖五个候选文件共 40,069 bytes，未重新安装依赖。实际 imageID=`sha256:18aaf0125899a350d3d6cecdb8eccfd0a059df40016bf9498fcd1770cb3cbfe4`，无网络容器内五个文件摘要匹配。逐 digest 计算导入仅新增 73,709 bytes，流式导入退出 0、未落盘 tar；余量由 326,750,208 变为 326,578,176 bytes，没有清理镜像、缓存或卷。

按作者明确的本机服务更新授权，UID／generation／唯一容器名／旧镜像经 JSON Patch test 核对后，仅依次更新读取本次代码的 cs-api 与 cs-controller。API 16:01:06Z 为 generation=23，Pod `cs-api-64b95ff4d5-94x44`／UID=`ade1cb6c-28ed-4dbc-82a7-6543c96d2f31`；controller 16:01:12Z 为 generation=19，Pod `cs-controller-6dfc9fdf76-5zcnp`／UID=`78fdc61d-434c-4f15-afa6-1ec07f5410ae`。两者 1／1、restartCount=0，实际 imageID 与五个源码摘要逐项一致；console 保持 cbe2825／generation=24。

参考代理预览的 healthz 与状态页均 HTTP 200，上游地址／令牌显示已配置。16:02:12Z 经普通负责人切流 API，指定 `expectedActiveRelease=null` 和精确目标 v0.1.2，取得 `tsw_01a0a0a7976c70009c3228353aec2dec`；该版本成为正式 green／1／1，原为空的 blue 成为预览。随后普通管理员网关重算成功，实际 IngressRoute 与存储路由均匹配 `/api/test-gitlab` 并指向 `reference-api-proxy-green`，保留原身份校验与前缀剥离。证据脚本曾把重算返回的数字当数组、把分组路由当平铺结果；通过只读 GET 及 Kubernetes 实体重新核对，没有重复切流或重算。

16:04:29Z 从原 files QA 任务只重试一次同一默认开放 GET，平台在 15 秒后 HTTP 412，不能记为调用成功。代理 Pod `reference-api-proxy-green-689c98dc64-kc5cq`／UID=`615ec717-f72e-4609-ab11-dcae43871f97` 于 16:04:59.982750341Z 记录完全匹配的上游路径 `/api/v4/projects/114/repository/commits/e4741df56b440d776b7c25ff5a4978b3d5822f46`、status=0，证明请求已到达正确代理，阻塞发生在继续访问上游。该请求没有自动重发。

16:08:40Z 同一 DNS／TCP 对照确认：系统 API Pod 和代理 Pod 均解析到 `192.168.65.254`／`fdc4:f303:9324::254`；前者连 GitLab 8929 端口 3ms 成功，后者 ETIMEDOUT。代理的 workload=service 不匹配额外任务／构建放行，现有默认 NetworkPolicy 只允许系统命名空间与 DNS，且仅配置 GitLab 地址，没有出口代理环境变量。这与已有 [I9](../../../docs/engineering/implementation-open-questions.md#i9-项目命名空间到公司系统的出站) 一致：接入容器到公司系统的出站模式尚待作者裁定。已呈同一份白名单／按上游连接定向开放／系统出口代理三种选择；没有借修改策略、绕过网关或改 grants 来冒充 J5 成功。

16:10:26Z 原 files 工作树仍 `e4741df56b440d776b7c25ff5a4978b3d5822f46`、未提交 0／未推送 0，原单个 OpenCode／Runner 身份与 throughSeq=2004、两份 QA Pod UID、首页及 Git 配置摘要均保持；files preview v0.1.4、workbench 两槽及数据库原 UID／restartCount=9 均保持，节点余量 324,152KiB。没有临时调零副本或新 Agent。证据为 batch51 的 source-ci、image-build／import-budget／import、cs-api／cs-controller-verified、proxy-readiness／promotion、route-verified、invocation-after、upstream-trace／connectivity、final-environment JSON 与相关日志。

本次只补部署与实机证据，源码候选与已通过完整门禁一致。Mac 解锁、I9／I14／I15 和具体成员范围仍待答复，UX-AT-15 与完整 J5 保留未通过，累计 **18／52**；RFC-004 继续严格等待 RFC-003 完结。

## 第五十二批：发布登记投影的并发迟到

继续核对上一批的顺序保证：`packages/eventbus/consumer.ts` 只串行相同 consumer 的游标，gateway 与 api-catalog 的处理可以重叠。新增组合根回归在旧代理 IngressRoute 应用前暂停 gateway，让 api-catalog 提交新目录并应用新路由，再恢复较早的 gateway 调用；旧计划确实覆盖了新 `/api/test-gitlab`。修复前 **3 pass／1 fail／12 assertions**（四测试、1118ms），不是用时间等待或随机网络延迟模拟概率。

发布登记后的投影统一由 api-catalog 完成登记后的组合根回调触发，gateway 移除对同一 `release.registered` 的重复消费，避免读旧目录的额外写入。项目创建／归档、切流和授权变化继续走既有 gateway 事件路径。新增失败恢复回归：目录事务已经提交而 K8s 首次应用失败，游标不推进；重试同一事件后路由恢复、操作只登记一份。没有新的表、锁、HTTP 接口或模块反向依赖。

最终定向 **23 pass／0 fail／165 assertions**，四文件、1440ms；完整本地 `bun run check` 为 **1124 pass／4 skip／0 fail**，1128 tests／191 files／6209 assertions／150.53s，两个候选文件摘要保持。console 源码和依赖未变化，沿用前批有效 build，提交后的精确 SHA CI 另行核验。实际启动 gateway 消费者的进程是 cs-controller，本次只需更新它；其他进程的 HTTP／任务协议未变。

本轮 CUA 已恢复可操作，不再把 Mac 锁定列为当前阻塞。原演示管理员重新登录到 files 工作区，实际看到 `codex/rfc003-files @ e4741df56b`、未提交 0／未推送 0、已启动 1、未读完成 1，确认已部署的发布计数修复在页面生效。会话元数据中的“分支 main”是创建时分支，仍需改为明确的来源标注。历史入口跳转到独立 conversations 页面，该项目旧版 Agent 列表为空，没有把普通终端当作历史 Agent 接续通过。I9／I14／I15、成员范围及其他页面验收继续，当前仍 **18／52**；RFC-004 未提前启动。

### 第五十二批上库与控制器部署

七个精确路径已发布为 `cc931041503cd2794c3145172b728ac24303a08a`，main 与 origin/main 同步、工作树和索引干净。该精确 SHA 的两个 push CI 均终态成功：[34869427269](https://github.com/wangbinquan/CrewStation/actions/runs/34869427269)／job `104061366311`（16:36:27Z）与 [34869427360](https://github.com/wangbinquan/CrewStation/actions/runs/34869427360)／job `104061367171`（16:36:35Z）。前者完整日志为 **1120 pass／8 skip／0 fail**，1128 tests／191 files／6168 assertions／61.35s，console build **1.21s**。两个新增组合根用例实际执行。

镜像 `cs-control-plane:rfc003-cc93104` 基于已核对的 e26515e，只覆盖两个候选文件共 13,567 bytes，依赖未变；实际 imageID=`sha256:daa019e509d0a215714c246eb1a0599b11786ae4e0a2e674365de7644034c25d`，两文件在无网络临时容器中核对一致。首次导入因余量 313,344,000 bytes 低于既有 300MiB 加新增内容的预算而没有执行。随后精确回收本 RFC 旧 console 构建的一项可回收、非共享缓存 `w497c9ve1xeaxeemage6yddfp`，创建时间 2026-09-14 11:30:58Z、命令包含 crewstation-console-build。采用锚定 ID filter，命令报告回收 118MB，执行前／后余量 519,168,000／663,851,008 bytes；执行前余量已自行恢复，不能将全部差额归因于该清理。没有删除镜像、其他项目缓存或数据卷。

16:48:41Z 重新核对镜像与节点 content digest，仅缺 **45,029 bytes**，流式导入 save／import 都退出 0，无 tar 落盘，余量由 658,300,928 变为 658,087,936 bytes。按原 UID／generation=19／唯一容器名／旧镜像的 JSON Patch test，仅更新 cs-controller。16:49:39Z rollout 完成，generation=20、1／1，Pod `cs-controller-55b497779d-r8wkj`／UID `dd14ec92-39e1-41c5-9078-74ba6d74c67b`，restartCount=0，实际 imageID 和两份源码摘要再次一致。cs-api 保持 e26515e／generation=23，console 保持 cbe2825／generation=24。

16:51:39Z 只读复查原 files 与旧 rfc003-ux 两任务：Pod UID 保持、Running／ready／restartCount=0。files 的单个原 OpenCode／Runner 和最后完成事件 seq=2004 保持，工作树 `e4741df56b440d776b7c25ff5a4978b3d5822f46`、未提交 0／未推送 0，首页与 Git 配置摘要一致。参考代理正式 green 仍 v0.1.2／1／1，实际网关路由仍为 `/api/test-gitlab → reference-api-proxy-green`。没有再次调用已知受 I9 阻断的上游，也没有改 grants。节点余量 **655,147,008 bytes**。临时证据为 batch52 的 source-ci、image-build／import-budget／import、cache-cleanup、controller-verified、final-environment JSON。

后续继续页面验收时 CUA 再次明确报告 Mac 已锁定、无法自动解锁，已请求手动解锁；此前恢复记录不再代表当前可操作。两份健康 QA 的历史结构化 Agent 名册均为空，未创建新 Agent 或发送新模型任务。第五十二批实际修复、发布与控制器更新已经完成，但没有增加完整 UX 通过项。

## 第五十三批：历史对话输入与发送回执

沿 UX-AT-52 检查历史入口发现：AgentComposer 的单一草稿跨对象复用，切换 Agent 会带入另一对象的输入；发送调用后立即清空，即使请求失败也没有原文或错误反馈；Ctrl／Cmd+Enter 又能绕过发送中按钮的禁用。返回 CLI 直接卸载输入，缺失的 agent 链接还会默默选择列表第一项。

现将消息草稿和发送状态放到 feature hook，按历史 AgentId 独立保留；同步拦截同一对象的重复派发，不限制其他对象并行发送。成功回执只清除发出时的草稿版本，失败显示原错误、保留输入且不自动重试；切换 Agent、暂时打开新建表单以及回执期间继续编辑均保留对应内容。历史页面复用共享离开确认，在途时不能确认放弃；同页对象链接保留各自草稿，缺失对象明确提示。会话摘要的 branch 改为中英“创建时分支／Initial branch”，当前工作树仍读取真实容器状态。

新增真实路由／mutation 测试，通过可控 HTTP 回执验证对象隔离、失败、同步快捷键、并行回执、迟到成功、返回确认和错误链接。修复前 **0 pass／5 fail**；修复后的定向四文件 **25 pass／0 fail／209 assertions／2.96s**。首次完整门禁停在测试夹具 TaskId 品牌类型，改用实际 AgentInstanceDtoSchema 校验夹具后，最终 `bun run check` **1129 pass／4 skip／0 fail**（1133 tests／192 files／6247 assertions／101.64s），console build **577ms**；七个源码／测试候选摘要保持。仅夹具类型修正没有改变已构建的生产内容，未重复 build。

使用当前生产彩色／单色 SVG 与 tokens 中真实明暗背景／文字色，以 rsvg-convert 按 16／24／32／64px 渲染并目视检查；C 形、平行轨道和箭头在四种尺寸可区分，单色在两主题均可见。产物 [brand-size-check.png](brand-size-check.png) 与原稿摘要、渲染方式记录在 [brand-design.md](brand-design.md)。这验证当前资产本身，不能冒充锁屏期间重新操作了顶栏、favicon 或登录页。

提交、精确 SHA CI 和本机 console 更新单独记录。此处的隔离路由测试不替代真实历史 Agent 继续及返回的浏览器旅程；Mac 解锁、I9／I14／I15 和具体成员范围仍待答复，累计仍 **18／52**，RFC-004 按批准顺序排队。

### 第五十三批上库与控制台部署

十四个精确路径已发布为 `7e8dc7f9a38fc6f88e00cfd21673ee680770a61b`，main 与 origin/main 同步、工作树与索引干净。精确 SHA [CI 34872812553](https://github.com/wangbinquan/CrewStation/actions/runs/34872812553)／job `104072616079` 成功，终态 17:11:24Z：**1125 pass／8 skip／0 fail**，1133 tests／192 files／6206 assertions／66.26s，五项新增历史页面回归实际执行，console build **1.19s**。

镜像 `cs-console:rfc003-7e8dc7f` 复用已验证 cbe2825 基底，源锁文件、包清单、标准配方与 serve.ts 均未变。本次仅替换已通过构建的六份 dist 文件，旧 dist 的清除只发生在临时镜像层内，没有删除主机或卷内容，也没有重新安装依赖。实际 imageID=`sha256:187f17881592968d6fa53090ff1d138f9ab2f99d083c6c0020150ed4649f9f13`，无网络临时容器中六份产物与 serve.ts 全部一致，未保留旧静态文件。逐 digest 扫描总内容 215,395,923 bytes，只需新增 **3,703,891 bytes**；流式 save／import 均退出 0，未落盘 tar，余量由 622,989,312 变为 615,464,960 bytes。

按既有 UID／generation=24／唯一容器名／旧镜像的 JSON Patch test 校验后，仅更新 console。17:12:03Z rollout 完成，generation=25、1／1，Pod `console-84cc49cd5c-qtlxs`／UID `89768689-497f-4604-85b8-1fc92aea3d06`，restartCount=0。运行 Pod 的 imageID 和全部七个文件摘要再次匹配。17:12:57Z 经正常已登录 HTTP 会话读取 console 首页、两个 JS、CSS 与两份品牌 SVG，全部 HTTP 200、字节数及 SHA256 与候选一致；index／brand 为 no-cache，带内容摘要的 assets 为 immutable。HTTP 产物验证不能替代当前浏览器渲染或输入旅程。

17:14:13Z 最终只读核对：cs-api e26515e／generation=23、cs-controller cc93104／generation=20 和 console 7e8dc7f／generation=25 均 1／1。files 与旧 rfc003-ux Pod UID 保持，ready／restartCount=0；files 的原单个 OpenCode／Runner、完成事件 seq=2004、工作树 e4741df／未提交 0／未推送 0 不变。首页、Git 配置和旧 QA 未跟踪文件摘要一致；files preview v0.1.4／正式空，workbench 正式 v0.1.0／preview v0.1.1 及参考代理正式 v0.1.2 均保持。实际 IngressRoute `reference-api-proxy-internal-api`／UID `e223957c-2632-4e92-8fdc-75b6292677ea` 匹配 `/api/test-gitlab`，指向 green:80，与目录一致。

原 OOM Pod 仍是 Failed／137，原工作卷 UID 保持 Bound／10Gi，未假称已恢复。PostgreSQL 原 UID 保持 ready／restartCount=9；节点余量 **631,484,416 bytes**。没有临时调零副本、在运行的候选 Vite 或尚未恢复的验收命令。本批没有新增真实 Agent、模型提示、发布版本、切流或 grants；受 I9 阻断的调用没有重复尝试。

临时证据为 batch53 的 candidate、red／targeted／check／console-build、source-ci、console-preflight／image-build／import-budget／import／verified／http-verified 和 final-environment；关键事实已在此落档。再次检查 CUA 仍明确报告 Mac 锁定，解锁问题保持待答复。完整真实旅程仍 **18／52**，I9／I14／I15 与成员范围继续待裁定；RFC-004 不提前启动。源码候选和部署内容未再修改，纯证据补记沿用有效本地门禁，最终文档提交的 CI 单独核对。

## 第五十四批：真实历史 OpenCode 与等待状态

在旧健康 rfc003-ux 项目 `prj_01a09859a1bc7000b8622726e24f34b2`／任务 `tsk_01a0985a8624700090ea5b5ecd4fca86`，经普通 API 使用已有 `rfc003-verify-opencode` 档位创建一个 permission=read-only 的历史结构化 Agent。该任务此前无历史 Agent、无原生 CLI；files QA 原单个原生 OpenCode 未再收到提示，也未启动重复 CLI。本次沿用户指定的 OpenCode 验收，未实现 RFC-004 Hook 或改模型接入配置。

实际 Agent `agt_01a0a0fe05327000bf97088b148de687`，OpenCode 1.18.29／opencode/big-pickle，原生会话 `ses_f5f01f2a4ffeK5bad0yVcuk6x5`。POST 启动返回 201；第一轮只请求回复 `RFC003_HISTORY_ONE`。第二轮仅要求回忆上一轮口令再接 `RFC003_HISTORY_TWO`，未在提示里重复第一轮口令，回执 204。真实持久流记录如下：

| seq | UTC 时间 | 事件 |
|---|---|---|
| 82198 | 17:36:37.684Z | started |
| 82199 | 17:36:47.633Z | session，原生会话 ID 如上 |
| 82200 | 17:36:47.782Z | text：RFC003_HISTORY_ONE |
| 82201 | 17:36:47.989Z | status：waiting |
| 82202 | 17:36:52.662Z | text：RFC003_HISTORY_ONE RFC003_HISTORY_TWO |
| 82203 | 17:36:53.026Z | status：waiting |

两轮等待后 `GET /v1/tasks/:taskId/agents` 都仍返回 state=running。定位到 `modules/dev-session/application/agents.ts` 的 stateOf 仅看事件 type，把所有 status 当作执行。现读取完整 AgentEvent：明确 waiting → awaiting-input，明确 running → running，其他说明性 status 保持已有状态；文本等实际执行事件继续恢复 running。等待不设置 endedAt，compute／permission／startedAt／sessionId 保持，真正 completed／error／cancelled 才写结束时间。该 HTTP 路由由 cs-api 装配，controller 不提供它，因此本批只需更新 cs-api。

新增模块 API 回归用两轮实机事件顺序验证等待、再次执行、身份保留、未知状态及真正结束；修复前 **4 pass／1 fail／40 assertions**，失败点恰为 waiting 被还原为 running。修复后与既有历史页面定向 **10 pass／0 fail／84 assertions／1.51s**。首次完整门禁在测试 identity.permission 的宽字符串类型停止，固定字面量后最终 `bun run check` **1130 pass／4 skip／0 fail**（1134 tests／192 files／6254 assertions／99.93s）。两份源码／测试候选摘要保持；console 源码和依赖未改，沿用第五十三批有效 build。

17:45:16Z 只读保全核对：旧 QA Pod UID `4920b2aa-880e-49c3-a782-8575bbf9a42e`、Running／ready／restartCount=0，HEAD `a10027cda8470ca4088780ed79081d07dd2b8e0b`，unpushed=0。原 `ux-comparison.txt` SHA256=`ee05185cb39c025d4968f1922cbd0218cc152a08e9cafb2c624522b9fba26dd3`，`.git/config` SHA256=`1006427aae9926b67a725f90e98efcf69325ad55275dd88c80f3a0e92afae500`，均与启动前相同。**工作树指纹没有保持**：旧镜像的 HOME=/work，实际新增 `.cache/opencode` 与 `.local/share/opencode` 缓存／快照，未提交由 1 增为 1395，接口返回 uncommittedTruncated=true；只读目录统计分别 4548／8804 KiB。没有读取、删除、忽略或提交缓存内容，也没有把 read-only Agent 解释为 CLI 不会写自身缓存。这个已知旧运行时问题见 dev-gotchas 的 HOME 记录，当前保留现场。

观察器结束只关闭订阅，没有取消历史 Agent，原会话保留供页面接续。临时证据为 batch54 的 history-preflight／compute／run／after-run、red／targeted／check 和 candidate。完整门禁通过后继续上库、精确 SHA CI 和 API 更新。Mac 仍锁定，真实页面继续／返回及 CLI 草稿旅程尚缺，累计仍 **18／52**；I9／I14／I15 与具体成员范围待裁定，RFC-004 仍排队。

### 第五十四批上库与 API 复验

六个精确路径已发布为 `c712aa77912e5f0dab2fb92ccec4bf17c6f6ef23`，17:54:35Z fetch 证明 main 与 origin/main 同步且工作树／索引干净。精确 SHA [CI 34877572645](https://github.com/wangbinquan/CrewStation/actions/runs/34877572645)／job `104088465996` 成功，终态 17:57:26Z：**1126 pass／8 skip／0 fail**，1134 tests／192 files／6213 assertions／67.05s，新增历史等待回归实际执行；console build **1.26s**。

镜像 `cs-control-plane:rfc003-c712aa7` 基于已验证 cc93104，控制面完整差异只有本批 agents.ts 与 devSessionModule.test.ts；console 与文档差异不在该进程执行。只覆盖这两份已验证文件，无依赖安装、迁移或任务镜像变化。实际 imageID=`sha256:7dd1c1c92acad59f15e03f99632f72b93ac2e390c2078be88c54f14e58d32c3c`，无网络临时容器内两份文件摘要一致。逐 digest 核对总内容 517,447,213 bytes，只新增 **58,925 bytes**；流式 save／import 均退出 0，导入前后余量 578,781,184／578,498,560 bytes，无落盘 tar 或清理操作。

用原 UID、generation=23、replicas=1、唯一容器名和旧镜像作为 JSON Patch test，仅替换 cs-api 镜像。17:59:00Z rollout 已完成，generation=24、1／1；Pod `cs-api-78b9c5f656-rdm4r`／UID `89634ec6-8757-4b7c-8103-df3560330e99`，restartCount=0。实际 imageID、两份候选源码以及沿用的 gateway/wiring.ts 摘要全部匹配。cs-controller cc93104／generation=20 和 console 7e8dc7f／generation=25 保持。

17:59:26Z 经正常已登录 API 再读原历史 Agent，只把 state 从 running 改为 awaiting-input，其余整个 DTO 与第二轮结束后的记录相同，没有 endedAt；未发送新提示或重新启动 Agent。18:01:05Z 原 files 单个原生 OpenCode／Runner／seq=2004、工作树 e4741df／未提交 0／未推送 0、文件摘要、files preview v0.1.4 和其他 QA／代理槽均与更新前一致。旧 rfc003-ux 保持模型结束后的指纹 c53f8b3／未提交 1395，没有进一步变化；原比较文件和 Git 配置摘要仍相同。三份 QA Pod、失败工作卷、PostgreSQL 身份及状态保持，节点余量 **573,718,528 bytes**。没有临时调零副本或未恢复的故障命令。

本批 source-ci、image-context／build／import-budget／import、api-verified、history-verified 与 final-environment 保存本机明细。上述 API／WS、运行镜像和完整门禁证明不替代浏览器输入／返回旅程，UX 通过数仍 **18／52**，RFC-004 不提前启动。源码和部署内容没有再改，纯证据补记复用有效本地门禁；最终文档提交 CI 独立核对。

## 第五十五批：历史页面实时名册刷新

第五十四批最终证据提交 `cbf9e1532b514ad14091e662c445fbf0a74f27ec` 的精确 SHA [CI 34878667789](https://github.com/wangbinquan/CrewStation/actions/runs/34878667789) 成功，18:09:21Z 终态：1126 pass／8 skip／0 fail，1134 tests／192 files／6213 assertions／65.06s，console build 1.04s。

沿真实历史页面继续核对刷新链：HistoricalConversationsPage 把 agents.refresh 交给 useAgentTranscripts，但 isLifecycleEvent 只包含 started／session／completed／cancelled／error。因此即使 API 已正确投影 waiting，打开的页面仍可能一直保留初次读取的运行中；permission 同样遗漏。旧 OpenCode 下一轮直接发 text，没有独立 started，单加 waiting 也无法刷新后续执行态。

现将明确 waiting／running、permission 纳入即时重读。每个 Agent 分别记录是否已经进入本轮输出；首条实际 text／thinking／tool-start／tool-end 触发一次重读，同轮连续输出不逐帧请求。等待、权限或结束重置对应标记，其他 Agent 的标记不受影响；说明性 status 不推测执行。标记只控制查询次数，状态和身份始终来自 API，刷新不选中后台对象、不改变消息草稿，也不发送模型输入。

在既有历史真实路由夹具上仅扩展 HTTP 名册回执和规范 WS 事件输入。新增五项回归：等待与后台权限事件后读回真实标签，当前选择／草稿／焦点保持；四种旧驱动输出分别恢复执行态，连续 30 段只读取一次，下一轮等待后可再次读取；完成态禁用输入并保留未发送内容。修复前 **5 pass／5 fail／43 assertions／1.046s**，修复后连同后端状态投影定向 **15 pass／0 fail／131 assertions／1.341s**。最终完整 `bun run check` **1135 pass／4 skip／0 fail**（1139 tests／192 files／6301 assertions／100.65s），console build **501ms**，四份候选摘要保持。

18:16:47Z console 仍是 7e8dc7f／generation=25，已只读核对基底 imageID、UID 和节点余量 554,688,512 bytes；本批只需更新 console，已修复的 API c712aa7 保持。没有新增模型轮次、CLI、发布版本、切流或权限变化。上库、精确 SHA CI、实际镜像／HTTP 产物核对继续。Mac 仍锁定，完整页面继续／返回旅程不以此次自动回归代替；累计 **18／52**，I9／I14／I15 与成员范围待裁定，RFC-004 仍排队。

### 第五十五批上库与控制台部署

八个精确路径已发布为 `c5d6eecf1398c145f6270a397c634782e1867ea0`，18:21:03Z fetch 证明 main 与 origin/main 同步，工作树／索引干净。精确 SHA [CI 34880255845](https://github.com/wangbinquan/CrewStation/actions/runs/34880255845)／job `104097504840` 成功，终态 18:23:14Z：**1131 pass／8 skip／0 fail**，1139 tests／192 files／6260 assertions／64.67s，五项新增状态／读取次数回归实际执行；console build **1.06s**。

镜像 `cs-console:rfc003-c5d6eec` 基于已验证 7e8dc7f；锁文件、包清单、标准镜像配方和 serve.ts 未变，只替换本批六份已构建产物。旧 dist 的移除仅发生在临时镜像层，主机和数据卷没有清理。实际 imageID=`sha256:6b9e673909dc46003f1c80474a43fc405ec0932c81bc48047b90d1713d47678a`；无网络临时容器内产物集合精确为六份，七份文件摘要均匹配。逐 digest 核对总内容 219,086,571 bytes，只新增 **3,706,603 bytes**；流式导入退出 0，余量由 557,838,336 变为 550,305,792 bytes，没有落盘 tar。

使用原 Deployment UID、generation=25、replicas=1、容器名与旧镜像的 JSON Patch test，仅更新 console。18:25:36Z 核对为 generation=26／1／1，Pod `console-5b45648b5d-59p68`／UID `7d9083cd-afa8-4b68-9850-3bd885f23ca2`，restartCount=0；实际 imageID 与七份运行文件摘要一致。18:25:40Z 经正常已登录 HTTP 逐份读取首页、两个 JS、CSS 与两份品牌 SVG，全部 200，字节数及 SHA256 一致；index／brand no-cache，assets immutable。CUA 随后仍明确报告 Mac 锁定，没有把 HTTP 产物核对当成浏览器交互。

18:27:09Z 最终只读核对：API c712aa7／generation=24、controller cc93104／generation=20 保持 1／1。原历史 Agent 的整个 awaiting-input DTO 与第五十四批部署后相同，files 原单个 OpenCode／Runner／seq=2004、工作树 e4741df／未提交 0／未推送 0、四份已核对文件摘要及所有原部署槽均保持。旧历史 QA 模型结束后的指纹和 1395 未提交项没有进一步变化；三份 QA Pod、失败工作卷和 PostgreSQL 身份／状态保持，节点余量 **546,484,224 bytes**。没有额外模型输入、重启任务容器、临时调零副本或未恢复的故障命令。

明细为 batch55 的 source-ci、console-preflight／image-build／import-budget／import／verified／http-verified 和 final-environment。源码与运行内容没有再改，纯证据补记沿用有效本地门禁；最终文档提交 CI 单独核对。完整实机验收仍 **18／52**，Mac 解锁和 I9／I14／I15／具体成员范围仍待答复，RFC-004 按批准顺序排队。

## 第五十六批：历史新建 Agent 输入保护

继续核对 UX-AT-52 的历史入口发现：StartAgentForm 持有本地 state，收起即卸载，因此首条指令、所选档位和权限全部丢失；既有离开保护只包含发给已有 Agent 的消息。启动按钮只依赖异步 pending，React 重渲染前连续点击会实际发送两个 POST；成功回调也不检查用户是否已返回其他对话，会把输入对象切到新 Agent。

新增真实历史路由／HTTP 边界回归先得到 **1 pass／3 fail／8 assertions**，三个失败分别锁住输入丢失、实际两个请求和迟到回执误选对象。现用 dev-session feature 下的 useHistoricalStart 持有当前会话的新建输入及可见状态，复用 AgentsPane 的既有离开确认。收起不丢输入，启动同步锁定当次参数，默认档位仍省略；在途禁止修改这些参数和确认离开，但可继续查看／输入已有对话。失败保留完整草稿，错误在表单收起后仍可见，不自动重发。成功清新建草稿；只在仍显示新建表单时接续新对象，否则保留用户的原选择、草稿与焦点。当前 taskId 更换或离开后的回执不再调整已卸载页面。

初次定向两文件 **14 pass／0 fail／121 assertions／1.61s**，随后补充回执前继续输入和焦点保持断言。最终完整 `bun run check` **1139 pass／4 skip／0 fail**（1143 tests／193 files／6338 assertions／104.87s），console build **502ms**。七份源码／测试摘要记录在 batch56-candidate.json，完整门禁后逐份核对未变；没有重复运行同一完整门禁。本批复用原表单／提示／离开确认，没有新增后端路由、模型配置或原生 CLI 启动步骤。

CUA 本轮仍报告 Mac 锁定，当前完整历史创建／继续／返回的浏览器旅程没有补齐。已有历史 OpenCode 和原生 CLI 保留，没有再次发模型提示。I9／I14／I15、具体成员范围及解锁问题保持待答复，累计仍 **18／52**；RFC-004 继续按已批准顺序等待 RFC-003 完结。源码发布、精确 SHA CI 与仅 console 更新继续核验。

### 第五十六批上库与控制台部署

十一份精确路径已发布 `4d1859a2a8f50bc1f05d7baf7fdf39c7798f775e`，19:00:29Z fetch 后 main 与 origin/main 一致，工作树／索引干净。精确 SHA [CI 34884257972](https://github.com/wangbinquan/CrewStation/actions/runs/34884257972)／job `104110846448` 于 19:03:00Z 成功：**1135 pass／8 skip／0 fail**，1143 tests／193 files／6297 assertions／69.90s，新增四项创建回归实际执行；console build **1.33s**。

控制台镜像 `cs-console:rfc003-4d1859a` 以已验证 c5d6eec 为基底，仅替换已构建的六份 dist。依赖清单、锁文件、标准镜像配方与 serve.ts 均无变化；构建使用 --network=none／--pull=false，没有重新安装依赖。实际 imageID=`sha256:1c67dd6a62f1bdce70f19a5a43a048a584ac2b35bf70d4ea217aa3623e9774a8`，无网络容器中七份文件摘要一致。逐 digest 扫描镜像总内容 222,778,241 bytes，实际只新增 **3,709,825 bytes**；流式 save／import 退出均为 0，没有 tar 或数据清理。导入瞬时可用空间为 1,771,974,656 bytes，完成后 1,754,218,496 bytes；此前读数较低，不将空间增长归因于本批操作。

部署补丁先校验 console 的原 UID、generation=26、replicas=1、容器名和旧镜像，再仅替换镜像。19:08:59Z 实际 generation=27、1／1，Pod `console-8d7cdfb59-rkspr`／UID `383ec166-8bdc-4a86-b5ef-bbcb88f556c7`、restartCount=0；运行 imageID 与全部七份文件一致。cs-api c712aa7／generation=24、cs-controller cc93104／generation=20 均保持 1／1。正常已登录 HTTP 逐份取得首页、CSS、两个 JS 与两份品牌 SVG，六份全部 200 且字节数／摘要匹配。

19:09:48Z 对部署前 19:03:01Z 的正常 API 快照复核：files 工作树 e4741df／未提交 0／未推送 0、旧历史 QA 的模型后指纹／未提交 1395 保持；原历史 Agent 完整 DTO 仍 awaiting-input，原单个原生 CLI／Runner 身份保持。本批没有新增模型请求、创建任务容器或变更角色／市场范围。CUA 在更新后仍报告 Mac 锁定；当前页面实际创建、继续和返回的完整旅程仍未执行，不增加 UX-AT-52 通过结论。

证据保存为 batch56 的 candidate、red／targeted／check／console-build、source-publication／ci、console-preflight、image-context／build／import-budget／import、console-patch／verified／http-verified、runtime-before／verified；关键结论已落此文。七份源码候选自完整门禁后未变，纯证据补记复用该有效门禁，最终文档 SHA 的 hosted CI 单独核对。累计 **18／52**；I9／I14／I15、成员范围及解锁问题仍待答复，RFC-004 继续等待 RFC-003 完结。

## 第五十七批：死信重放并发与队列收尾

本轮继续 UX-AT-14。19:24:09Z 经正常已登录 API 读取 history／files／workbench／delivery 四个既有 QA 项目，各有一个订阅，dead 记录均为 0。保留其现场，没有发送会向共享订阅扇出的事件；CUA 仍明确报告 Mac 锁定。以下均是隔离测试数据库和临时 HTTP 订阅者的实跑，不作为已完成真实项目页面旅程。

源码中 replayDelivery 在事务外读 dead，授权返回后直接写入旧快照。新增三项真实 PostgreSQL／HTTP 查询和队列回归，控制两个请求通过授权的顺序。初次 **0 pass／3 fail／10 assertions／875ms**：迟到请求仍返回 200；先到请求已送达时，实际订阅者收到三次请求（原始失败、第一次重放成功、错误的重复重放），应只有前两次；同时通过授权的两个请求也都被受理。

现授权之后在原 events UnitOfWork 中重新点查并锁行，使用当前状态执行转换，状态写入与入队同一事务提交。普通 uow.read 不加写锁；并发请求按实际 pending／delivered 返回 412，不覆盖真实送达结果。初次定向 **13 pass／0 fail／101 assertions／1.268s**，该候选完整门禁 **1142 pass／4 skip／0 fail**（1146 tests／194 files／6360 assertions／100.71s）。

随后核对实际入队语义，发现旧 worker 已把投递写为 dead、尚未完成 running 队列任务的窗口：enqueueJob 按活动 dedupKey 去重返回，适配器忽略该结果；重放返回成功并把投递改为 pending，但旧任务收尾后队列没有任何可执行任务。新增回归让真实 worker 停在两步之间，结果 **3 pass／1 fail／24 assertions／939ms**，明确观察到 pending 且 runOnce=0。

现 events 的入队适配器在该冲突时返回 precondition／412，事务回滚完整死信记录并说明稍后重试；旧任务结束后同一投递可正常重新入队并实际送达。没有修改公共 queue 包的去重／租约规则。最终定向三文件 **14 pass／0 fail／111 assertions／1.10s**，涵盖四项新增场景和原有模块／状态机。新增修复改变了候选，重新执行最终完整 `bun run check` **1143 pass／4 skip／0 fail**（1147 tests／194 files／6370 assertions／103.83s）；七份候选摘要保持。console 源码／依赖未变，沿用第五十六批有效 build，未重复构建。

落位限于 events application、persistence／queue adapters、两个端口说明和本模块测试，没有迁移或新跨模块依赖。用户域重放接口由 cs-api 提供，本批只更新该部署。临时证据为 events-preflight 和 batch57 的 red／targeted／check、queue-red／targeted-final／check-final、两版 candidate。

### 第五十七批上库与共享部署复核

已发布 `ebaa73014657692eafb32728feb3232dfcc8ebd3`，精确 SHA [CI 34888522477](https://github.com/wangbinquan/CrewStation/actions/runs/34888522477)／job 104125079111 于 19:47:24Z 成功：**1139 pass／8 skip／0 fail**（1147 tests／194 files／6329 assertions／66.17s），console build **910ms**。四项新并发／队列回归实际执行；八项环境专属跳过仍独立列示。

基于已核对的 c712aa7 镜像，只覆盖七份候选文件，以 `--network=none --pull=false` 构建 `cs-control-plane:rfc003-ebaa730`，imageID=`sha256:ad2335358fa15fcec09c31825fe7d877a627f9c1cc6e30b3d51f9f4ac68716a4`。没有重装依赖；517,475,482 bytes 内容仅新增 56,474 bytes，流式导入成功，不落 tar、不清理数据。19:45:58Z 节点剩余 1,623,515,136 bytes。

使用原 UID、generation=24、replicas=1、容器名和旧镜像的 JSON Patch test，只更新 cs-api。19:55:20Z 为 generation=25／1／1，Pod `cs-api-5cdc48c6b7-gx5wl`／UID `34036e0c-296d-4ac1-b2d3-05fc755d56b4`、restartCount=0；实际 imageID 与七份运行文件摘要全部一致。console rfc003-4d1859a／generation=27 与 controller rfc003-cc93104／generation=20 均保持 1／1。

19:55:22Z 正常 API 前后对比：files 工作树 e4741df／未提交 0／未推送 0，旧历史 QA 的模型后指纹／未提交 1395，原历史 Agent awaiting-input，以及原单个原生 CLI／Runner 身份均保持。CUA 内置浏览器随后成功以原 admin 登录并打开实际历史转录，继续页面验收；未宣称 Mac 已解锁。部署和 API 证据为 batch57 的 source-ci、api-patch／verified、runtime-before／after。死信页面旅程仍未执行，累计 **18／52**；I9／I14／I15 和具体成员范围仍待答复，RFC-004 等待 RFC-003 完结。源码未再改，纯证据补记复用有效门禁。

## 第五十八批：历史页面接续与故障摘要

内置浏览器已恢复实际页面操作，以原 admin／admin@demo.invalid 登录共享 console 4d1859a。会话菜单打开独立“历史对话会话”，明确 L-id 与 CLI 是不同对象，没有“对话模式”按钮。旧 rfc003-ux 中实际看到原 Agent L-8de687 的两轮口令、原生会话及“等待输入”；填写待发送消息后切换新建，选择 rfc003-verify-opencode／只读并写入临时首条指令，收起和重开时两份草稿及选择均保留。实际发送第三轮，页面返回 `RFC003_HISTORY_ONE 和 RFC003_HISTORY_TWO。RFC003_HISTORY_UI` 后恢复等待，发送成功清空该条输入。返回 CLI 前新写一条验收草稿，共享离开确认可继续编辑并保留原对象；随后显式放弃仅本次两份临时草稿，回到原“差异”页签。

旧任务工作树从模型后 1395 项变为接口 `unavailable`，原因是 `Git 结果超过读取上限，无法给出完整检查结果`；页面撤下旧计数和一致结论，显示未知／暂不可比较。但工作树、提交和文件分别透传相同原因，顶部条及详情摘要内各重复三次。已有实际页面截图与正常 API 事实，新增 compact=false／true 两条回归先得到 **8 pass／2 fail／36 assertions／737ms**，均为同文案出现 3 次而非 1 次。现在 ComparisonSummary 按原条件收集原因并按完整文本去重，不同失败仍逐条展示；未知和真实 v0.1.0 不变。新增独立原因回归同时保持通过，修复后 **10 pass／0 fail／44 assertions／735ms**。

为验证同一项目的正向往返，在原 files 单个 CLI 上取得输入控制，1280×720 画面实际可见本轮完成、进程在线及输入区；写入 `RFC003_CLI_RETURN_DRAFT`，没有按回车或发送模型任务。从该会话菜单打开历史页面，新建且仅新建一个只读 OpenCode：`agt_01a0a18645f770009e298c7f2f5e12b4`，原生会话 `ses_f5e79b124ffeVT9sLgT1Kg7ND4`，task 仍 `tsk_01a09ff07aeb7000897fd0eda1e16cd2`。20:05:26.660Z／seq26331 started；20:05:37.389Z／26718 session；20:05:37.465Z／26722 输出 `RFC003_FILES_HISTORY`；20:05:37.717Z／26731 waiting。页面继续时不重复首轮口令，20:06:05.532Z／27599 正确输出 `RFC003_FILES_HISTORY RFC003_FILES_CONTINUED`，20:06:05.681Z／27603 再次 waiting；页面明确显示同一 L-5e12b4／等待输入，两轮期间没有工具调用。

返回后原 CLI `agt_01a09ff2f4f97000b13dde63dc4b96e7`／terminal `pty_01a09ff2f4f97001bb9f6208c42dc089`／Runner `9992bfd0-2491-49a3-81c1-39268cdb900d`、数量 1、原工作区页签、网格、未读完成 1 和原未发送草稿均保留。可是只读重新附着的终端画面发生错位，等待回放完成后仍在；通过普通任务 WS 的 attachTerminal 取得 cols=150／rows=30／throughSeq=1647／9,880 bytes 的原屏幕快照，在隔离 headless 终端复原也出现错位。因此 UX-AT-52 仍未通过，后续须定位屏幕恢复；不以输入和身份仍在掩盖该缺陷。该只读取证没有发送 CLI 输入、claim、resize 或创建进程。

20:06:27Z files 的 HEAD 仍 e4741df、未推送 0，但 legacy CLI 增加两个 `.npm/_cacache/` 未跟踪文件，fingerprint=`6ca6c87f7b9df146267bc5838357789b78c8d941572f8d44e9367b5262d6bf8e`，不能描述为干净工作树。20:09:57Z 原两份 QA Pod UID、Running／ready／restartCount=0，以及旧比较文件、files 首页和各自 Git 配置四个摘要均保持；节点剩余 1,560,313,856 bytes。没有读取、清理或提交缓存内容，不再向旧 rfc003-ux 发模型轮次；新历史 Agent 与原 CLI 草稿均保留用于后续复验。

本批源码限于 ComparisonSummary 与其视图测试，完整本地门禁 **1146 pass／4 skip／0 fail**（1150 tests／194 files／6384 assertions／110.07s），console build **599ms**；两份候选摘要保持。实际旧任务故障可用于更新后的提示复验，源码提交、精确 SHA CI 与仅 console 更新继续；API ebaa730 和 controller cc93104 无需改动。临时证据为 batch58 的 red／targeted／check／console-build／candidate、files-ui-api／ui-runtime、terminal-snapshot，以及 batch57 的 history-ui-api。累计 **18／52**；I9／I14／I15 与成员范围保持待答复，RFC-004 不提前启动。

### 第五十八批上库、部署与页面复验

已发布 `927da4d212ecd643bee5529838e3d1f1bc3bceed`，精确 SHA [CI 34891820268](https://github.com/wangbinquan/CrewStation/actions/runs/34891820268)／job 104136121014 于 20:17:44Z 成功：**1142 pass／8 skip／0 fail**（1150 tests／194 files／6343 assertions／66.35s），console build **1.01s**，本批三项新视图用例实际执行。

在已核对的 4d1859a 基底上仅覆盖 console 编译产物，以断网、不拉取方式构建 rfc003-927da4d，imageID=`sha256:485eff945ba104a626690b32055135ae3f569f6921f662d81876cfa886332723`。七份运行文件（含未变的 serve.ts）在临时镜像逐份核对；226,469,909 bytes 内容仅新增 3,712,021 bytes，流式导入完成，20:18:10Z 节点剩余 1,584,771,072 bytes，无 tar、无数据清理。

在 UID／generation=27／replicas=1／容器名及旧镜像前置条件下仅更新 console。20:22:55Z 核对 generation=28／1／1，Pod `console-7d54894696-8pcd7`／UID `a4060566-367a-4a68-a485-704981b0faed`／restartCount=0，实际镜像与七份摘要一致；20:23:00Z 普通已登录 HTTP 六份产物均 200 且字节及 SHA256 一致。API ebaa730／generation=25、controller cc93104／generation=20 保持各 1／1。

真实 rfc003-ux “差异”页面 reload 后已实看新内容：顶部紧凑摘要和展开详情各一次 `Git 结果超过读取上限，无法给出完整检查结果`，精确文本 DOM 总数为 2；两处仍显示未知／暂不可比较及实际生产 v0.1.0 @ a10027cda8，没有零差距冒充结果。20:24:42Z 正常 API 复核，files 的两份 npm 缓存／模型后 fingerprint、HEAD e4741df／未推送 0、新历史 Agent awaiting-input 和原单个原生 CLI／活动状态均与 UI 后快照相同，旧任务仍如实 unavailable。

终端诊断另以只读任务 WS 查询尝试获取原始输出／resize 历史，该持久回放中数量为 0，不能据此重建完整屏幕；现有 snapshot 仍是有效复现。将其在同版本 headless 再次序列化，字符行不变、光标横坐标从 27 到 26，尚不足以确认为错位根因。后续需要受控现场输出或隔离最小复现，不能直接改快照尺寸或以强制获取输入控制掩盖只读恢复问题。

明细为 batch58 的 source-publication／source-ci、image-context／build／import-budget／import、console-patch／verified／http-verified 和 runtime-after-deploy。两份源码自有效门禁后没有再变化，纯证据补记沿用该结果；最终文档提交 CI 单独核对。累计仍 **18／52**；RFC-004 等待 RFC-003 正式完结。

## 第五十九批：终端缩窄快照边界

继续第五十八批的真实屏幕错位。源码检查发现 @xterm/addon-serialize 的 BaseSerializeHandler 在非末行按 line.length 读取；headless 的备用屏幕缩窄后行容量仍可保留旧宽度。最小实验不启动模型：40×8 的每行第 30 列写 OLDn，缩到 20×8，再在第 1 列写 rown／unsent draft。真实模拟器可见行正确，快照恢复却出现 LD3／row4 O／LD4 等错行，与实际 OpenCode 旧侧栏插入画面的形态一致。

新增回归修复前 **3 pass／1 fail／20 assertions／63ms**，七行被屏幕外文字挤乱，草稿仍在但位置不可信。现通过 terminalSnapshotView 给原 SerializeAddon 提供只读缓冲视图，line.length／getCell 不超过当前列数；没有修改第三方依赖、真实缓冲或协议。终端本体的方法和属性仍委托原对象，Addon 生命周期仍随模型关闭。第一版定向 **4 pass／0 fail／29 assertions／64ms**，验证颜色、光标、粘贴模式、throughSeq 和重新放宽后的旧内容，第一次完整门禁 **1147 pass／4 skip／0 fail**（1151 tests／194 files／6394 assertions／101.32s）。

门禁后针对中文边界继续做定点实验：当双宽字符从第 20 列开始、窗口缩至 20 列时，单纯限制列数仍会把它写到下一行，second 变成“界”，后续草稿下移。最终两条无色／有色红回归 **4 pass／2 fail／31 assertions／195ms**。现只有这一不完整边缘字符在快照中用同样式空格占位；整个原字符仍在原缓冲。占位使用独立 cell 视图，避免破坏序列化器交替复用 cell 的身份和后续颜色比较。最终定向 **6 pass／0 fail／41 assertions／198ms**，两个问题均得到真实解析器恢复断言。

新修复改变候选后重新执行最终完整 `bun run check`：**1149 pass／4 skip／0 fail**（1153 tests／194 files／6406 assertions／106.24s）。三份候选为 terminalScreen.ts、terminalSnapshotView.ts 和 terminalScreen.test.ts，摘要保存在 batch59-candidate；首版候选另存 candidate-first，没有因 HEAD 移动重跑。console 代码及依赖未变，沿用第五十八批有效 build。

新任务镜像基底 rfc003-3d1ce51 的实际 imageID 已核对为 `sha256:cfabcc77f07ccdf075e47aa7b0d27ad79607c032cdca71af40cb3ccc5ab6ae1e`；该运行子集相对当前已发布主干仅多一份已发布的 contracts/api/observability.ts 差异，后续镜像应一并覆盖以保持运行子集一致，无需重装依赖。20:41:43Z crewstation-env 的 CS_TASK_IMAGE 仍为旧基底，UID `11ccf270-ef66-474d-888f-f33351f1ee35`／resourceVersion 528946；API generation=25 与 controller=20 从该 ConfigMap 读取，新任务创建由 API 路径、恢复／业务任务由 controller 使用同一配置。

20:48:49Z 节点 allocatable CPU 10 核、内存 32810996Ki，已有请求 9550m／13602Mi，MemoryPressure／DiskPressure 均 False。现有任务套餐只有 coding-medium（1 核、2Gi、10Gi），再加同规格不可调度；计划用单独 250m／2Gi 验收规格保持原所有会话和预览，不做四窗压力实验。此时尚未写套餐、改任务镜像配置或新建验收任务。先完成上库、精确 SHA CI 和镜像核对，再用新任务验证。旧 files CLI／草稿、新历史 Agent、旧 rfc003-ux 和原失败工作卷均保留；不能将新镜像代码通过说成旧 Runner 已热更新。

### 发布、部署及实机复验

已发布 `fc0688e9c0bc5e4b444c4cad2c26f2e840615fca`，精确 SHA [CI 34895624526](https://github.com/wangbinquan/CrewStation/actions/runs/34895624526)／job 104148744595 于 20:55:50Z 成功：**1145 pass／8 skip／0 fail**（1153 tests／194 files／68.96s），console build 1.29s。三份源码候选在实机验收结束后仍匹配最终门禁记录。

基于已部署任务镜像覆盖四份必要文件，构建 `cs-task-runtime:rfc003-fc0688e`，imageID=`sha256:eaca018e3b2d01c366ede44363c6de6d3cc73196a52c25e502d6d74d58323657`。RootFS 旧层、入口和命令均保留，四份文件摘要／大小全部匹配。任务镜像没有 console 的 CSS 测试预加载文件，使用临时只读 bunfig 挂载去掉该测试专用依赖后，镜像内终端回归 **6 pass／0 fail／41 assertions／109ms**；挂载不进入部署镜像。逐 digest 预算为总内容 1,026,370,653 bytes、只新增 **56,413 bytes**，流式导入后剩余 1,539,403,776 bytes，没有 tar 落盘或数据清理。

21:06:46Z 已更新 crewstation-env 的 CS_TASK_IMAGE，并逐个滚动 API／controller 读取；它们的源码镜像仍 ebaa730／cc93104。管理员套餐 `rfc003-59-snapshot`（250m CPU、2Gi 内存、10Gi 存储）经正常目录接口创建，既有 coding-medium 不变。当前开发入口不支持每次选择资源套餐，因此仅临时覆盖 API 的 CS_DEFAULT_TASK_PROFILE，为现有 delivery QA 项目创建一个会话后恢复。滚动交接出现 502／504／连接超时：第一次写请求失败后正常接口与集群均确认未创建任务，后续未就绪时不提交写请求；一次恢复补丁被并发状态 resourceVersion 拦住，核对相同 spec 后以 UID／generation／目标值保护完成恢复。最终正常 POST 于 21:14:39.571Z 创建 `tsk_01a0a1c5a4537000b2f81b4324357c76`，API generation=32 且无临时默认值覆盖，全局默认仍 coding-medium。

新任务位于 cs-rfc003-verify-delivery，Pod `task-01a0a1c5a453`／UID `f6c62e09-80f4-4d3b-b43c-8229781cd488`。21:15:15Z Running／ready／restartCount=0，实际 imageID 与四份文件再次核对，requests／limits 均 250m／2Gi／10Gi。预览 ready，分支 main，HEAD=`ea10bd3ab67501b301ec87d6bc85eaa215fdfa8e`，生产尚未部署。本批没有发布 QA 新版本。

CUA 内置浏览器以 admin 在该项目逐个启动一个只读 rfc003-verify-opencode 原生 CLI：Agent `agt_01a0a1c7d9857000ab50c7cec01937fa`、terminal `pty_01a0a1c7d985700181bb81b6edc9248b`、Runner `f9aed72a-0582-4ef3-9f26-7b100351f7cc`，OpenCode 1.18.29／Big Pickle。首轮模型连接重试后正常返回 RFC003_SNAPSHOT_NATIVE_OK，21:18:22.883Z 开始、21:19:09.777Z 完成，activity throughSeq=1146；页面准确显示执行中→本轮完成／进程在线、未读完成 1。新旧任务出站规则／代理配置一致，对官方站点的只读连通检查有 DNS 超时但 HTTPS 200，没有改网络规则。

原生输入留下 `RFC003_SNAPSHOT_DRAFT 未发送草稿`，将浏览器从 1280×720 缩到 1024×720。通过“会话→历史对话会话”进入同项目独立历史路径，新建只读 Agent `agt_01a0a1cdcb1b7000aa880eb29e04060d`（L-04060d），原生 sessionId=`ses_f5e320e01ffeDeikdVPUKLaghT`。第一条口令式验收文本被模型拒绝，但 waiting 状态正常；随后页面发送普通算术题得到 42，再只要求上一答案加 1 得到 43。真实事件 seq=6528／21:25:00.248Z 与 seq=7484／21:25:45.536Z，三个回合末均 waiting，没有重建 Agent／sessionId，没有工具调用。

从页面“返回 CLI 工作区”返回：仍一个 CLI 1937fa，工作区 1／网格、原中文草稿、本轮完成／进程在线及未读完成 1 全部保留。1024 像素下实际画面无旧侧栏错行；切换前后的普通 WS attachTerminal 均返回 **114×30、throughSeq=947、4,277 bytes，data 逐字节完全相同**，原 native identity 与 activity 也逐项一致。再次取得输入控制并恢复正常 1280×720 后，侧栏、草稿和输出正常，viewport override 已撤销。这次完整旅程关闭 UX-AT-52，累计 **19／52 通过、33 项待完成**。

21:27:05Z 新任务 HEAD／未推送 0 保持，但历史驱动新增十个未跟踪 `.npm/_cacache/` 项，fingerprint=`dbb42f6e8d8f9a9e87d968ce34425c036e0183bb6bffe14314afd4af032ad6b2`；仅取得 Git 元数据，没有读取、忽略、提交或清理缓存内容。21:29:58Z console=927da4d／generation=28、API=ebaa730／32、controller=cc93104／21 均 1／1。旧 files／rfc003-ux Pod 身份、ready／restartCount=0，四份原业务文件与 Git 配置摘要均保持；失败 workbench Pod 与 Bound 工作卷 UID 也保持。节点剩余 1,451,814,912 bytes，未做四窗压力实验，旧 Runner 仍运行各自原镜像。

证据为 batch59 的 red、targeted、check、wide-red-final、targeted-final、check-final、两版 candidate、source-ci、image-build／image-import、task-image-rollout、qa-session-final-create、qa-pod-verified、native-before／native-after、两份 terminal snapshot 与 final-runtime。纯证据更新复用有效完整门禁；I9／I14／I15 和成员范围仍待答复，RFC-004 保持已批准、等待 RFC-003 完结，Hook 未开工。

## 第六十批：已有终端跟随系统主题

沿 UX-AT-26／51 检查主题接线：tokens.css 通过 prefers-color-scheme 的 CSS 媒体条件切换配色，切换本身不产生根元素属性变化。原生 NativeTerminalSurface 仅观察 data-theme／class／style；普通 openTerminalSession 只在创建时读取一次，因此已有 xterm 会保留旧配色。

新增回归挂载两条真实生产入口和实际 xterm DOM，不替换终端渲染器；用受控媒体 change 事件和产品色 token 验证已绘制背景。修复前 **1 pass／5 fail／9 assertions／304ms**，原生属性路径原本通过，系统切换两入口、普通终端属性路径以及监听清理均失败。复用 terminalTheme 的 watchTerminalTheme，同时监听系统媒体条件和根元素覆盖；回调仅赋值 terminal.options.theme，不重建实例、不发送输入／resize 等 PTY 命令。每个实例独立移除监听，关闭一个不影响另一份终端。

连同原有附着回归，最终定向 **9 pass／0 fail／34 assertions／372ms**；完整 `bun run check` **1156 pass／4 skip／0 fail**（1160 tests／195 files／6432 assertions／105.61s），console build **479ms**。四份源码／测试候选为 terminalTheme.ts、terminalSession.ts、nativeTerminalSurface.ts、terminalTheme.test.ts，门禁后摘要仍相同；没有新增模块或改变 PTY 协议。

本次 CUA 实际 delivery QA 仍为原 CLI 1937fa／OpenCode，未发新模型轮次。390、320、768×720 下 document.scrollWidth 分别等于对应视口宽；中文草稿 `RFC003_SNAPSHOT_DRAFT 未发送草稿`、本轮完成／进程在线、工作区 1 和未读完成 1 保留。三个尺寸均通过页面外缘滚动看见终端底部输入区；320 下工具栏换行，页签列在自身区域裁切，不让整页横向滚动。没有把闭合 details 内的布局测量当作可见元素溢出。初次视口切换后的 AX 附图出现旧尺寸缩略图，使用后续正常 tab.screenshot 与实际 DOM 尺寸核验，不采用错误缩略图作为证据。视口覆盖已撤销。

该浏览器没有提供系统主题模拟能力，因此媒体事件自动回归不等于真实系统明暗切换；也没有将单个开发页的三种尺寸视为全站五尺寸通过。UX-AT-25／26／37／51 继续保留，累计 **19／52**。22:08:43Z 部署前 console rfc003-927da4d／generation=28、API ebaa730／32、controller cc93104／21 均 1／1，节点剩余 1,421,168,640 bytes。本批仅需更新 console，旧任务运行时不变。

### 发布、部署及保留核对

已发布 `c9905a63decd7a2bdb5f34bfc981beaadcc45974`，精确 SHA [CI 34902926774](https://github.com/wangbinquan/CrewStation/actions/runs/34902926774)／job 104172854777 于 22:14:51Z 成功：**1152 pass／8 skip／0 fail**（1160 tests／195 files／69.25s），console build 1.02s。本地门禁后的四份源码／测试候选未变。

以已部署 rfc003-927da4d 为基底构建 console，只覆盖 dist／serve.ts。新 imageID=`sha256:a0a6312555d42597d36f7a0f2f9692989f02fa733ce887292ac7731b6268d73b`，七份文件逐份核对；总镜像内容 230,165,488 bytes，按已有 digest 只新增 **3,718,128 bytes**，流式导入，无 tar 落盘或数据清理。之后仅滚动 console：23:31:00Z generation=29、1／1，Pod `console-6b5888d97b-9l8xs`／UID `3ab28d7b-79d4-4a00-9561-8462224d83f5`、restartCount=0；实际 imageID 和七份文件再次核对。23:31:57Z 普通 HTTP 六份静态产物摘要／大小一致。

CUA 刷新真实 delivery 页面载入 `/assets/index-C2niefU7.js`，恢复连接与回放后仍一个 CLI 1937fa，原工作区／网格、`RFC003_SNAPSHOT_DRAFT 未发送草稿`、本轮完成／进程在线与未读完成 1 保持；取得输入控制后可输入，没有提交草稿或新模型请求。正常 1280×720 下画面无错位，整页 scrollWidth=1280，产品 surface 与终端默认背景均为白色。原生系统设置入口后来可读取，点击外观后再次读取仍在通用页，没有实际更改或验证系统明暗；不据此关闭主题验收。

23:33:31Z readonly 核对：三个原 QA 的 taskId、native DTO、历史 Agent、活动及工作树内容均保持；checkedAt 正常更新，另有会话闲置提醒／活跃时间推进，不称完整 session DTO 逐字节相同。delivery HEAD ea10bd3／未提交 10／未推送 0、files e4741df／未提交 2／未推送 0 及两份原指纹一致；旧 rfc003-ux 仍是 Git 输出超限，没有读取或清理缓存。四份原业务文件与 Git 配置摘要匹配，三个健康任务 UID／ready／restartCount=0、失败任务和 Bound 工作卷 UID 保留。API ebaa730／generation=32、controller cc93104／21 仍 1／1，节点剩余 1,360,252,928 bytes。

证据为临时目录 batch60-theme-red、theme-targeted、check、build、candidate、deploy-before、source-publication／source-ci、image-context／built／budget／import、console-rollout、http-assets、qa-before／qa-after／qa-comparison、final-runtime。最后仅补证据，复用有效完整门禁；I9／I14／I15 及成员范围仍待答复，RFC-004 不提前开工。

## 第六十一批：真实迁移日志隔离与恢复发布

继续 UX-AT-13 的当前部署页面旅程。第四十九批迁移 Job 已过一小时保留期，故使用既有专用 GitLab 项目 114／crewstation/rfc003-verify-files 的现有分支 codex/rfc003-files。通过正常文件 API 和 last_commit_id 条件逐次提交，只变更 crewstation.yaml，逐笔核对父提交、单文件差异与署名；没有新建分支或修改原任务 checkout。故障命令只输出固定文本后 exit 42，不使用数据库。原文件及两份候选均用实际 ManifestSchema／Bun.YAML.parse 校验，除 migrationCommand 外的结构一致。

三个实际发布如下；时间均为 UTC，三次在页面选择已有远端分支、重新核对完整 SHA、填写版本和说明后单次确认，没有自动重发：

| 版本 | 完整提交 | releaseId | 最终结果 |
| --- | --- | --- | --- |
| v0.1.5 | 23c909ffe3b68270243c7991667200f4683c1d8f | rel_01a0a25712ce7000ad4fb9f7d8ad6b91 | 2026-09-14T23:53:41.327Z failed |
| v0.1.6 | 5e96d930dc7c5b79e7c0d56396e9e67c9259ac9f | rel_01a0a25c21d57000a388dcc9502a683e | 2026-09-14T23:59:12.497Z failed |
| v0.1.7 | 5719c033e3ac781eb6e3efcdf1c8e6da02018f34 | rel_01a0a260df2b7000ba1fd5194233576c | 2026-09-15T00:04:23.466Z ready |

前两次均显示“迁移失败，未切流：Job has reached the specified backoff limit”；对应迁移 Pod exitCode=42、restartCount=0，原 v0.1.4 预览在故障期间保持就绪，正式槽仍空。首条原始记录为 `2026-09-14T23:53:36.474570259Z RFC003_BATCH61_MIGRATION_FAILURE`，第二条为 `2026-09-14T23:59:07.640345926Z RFC003_BATCH61_OTHER_MIGRATION_FAILURE`。API 分别返回 23:53:36.474Z／23:59:07.640Z，source=migration、stream=combined，与容器时间一致。

真实 admin 浏览器从首个失败详情点击一次“本次迁移日志”，直接进入 `/projects/prj_01a09fecbba97000843701962d998a7a/operations?tab=logs&source=migration&releaseId=rel_01a0a25712ce7000ad4fb9f7d8ad6b91&limit=200`。保留该页跟随，再发布第二个不同标记的故障版本，通过相同入口一次进入第二 releaseId 的日志页。两个失败记录同时存在时，两个页面均显示正确来源与完整版本筛选、1／1 日志，分别只有自己的标记；界面本地时间为 07:53:36／07:59:07。实际 1280×720 截图检查了筛选行、版本标签和日志行，未见错位。00:01:45Z 的普通 API 与 K8s 原始日志对照另存 batch61-log-isolation，不以 API 代替上述真实点击路径。

第三笔正常提交只移除故障命令：manifest 摘要恢复 `cf631b15062adf5b68bd3b27c4f3bf3b12ea8edade32db7ac437d78efc96263c`，GitLab 对故障前 e4741df56b440d776b7c25ff5a4978b3d5822f46 与 5719c033 的整树比较 diffs=[]。历史保留这三笔 QA 提交，没有改写历史。v0.1.7 就绪后，实际打开 preview.rfc003-verify-files.cs.localhost，仍为“RFC003 预览恢复验收”首页、admin 身份、green 槽；再从该发布详情点击迁移日志，准确带恢复 releaseId，显示 0／0／尚无日志，两次失败标记没有混入。

节点当时已有 CPU requests 9800m／10 核，构建 Job 需要 1 核。每次管线期间，仅将两个既有专用非正式 preview（workbench-blue、delivery-green）暂时由 1 调至 0，管线终态后立即恢复；补丁核对 UID／generation／原副本数／release 标签。00:12:56Z 两者原 Deployment UID、版本均保持，generation 分别 17／9，均 1／1。files-green 只在正常 v0.1.7 发布时更新，原 UID 保持、generation=12、1／1；workbench 正式 green 原 UID／generation=1／v0.1.0 不变。所有临时副本已恢复，没有遗留运行中的故障命令或改变正式切流。

00:06:17Z 对照发布前快照，delivery／files／旧 rfc003-ux 的 taskId、native DTO、历史 Agent、活动与工作树均保持，checkedAt 查询时间另计。原 files checkout 仍 e4741df／未提交 2／未推送 0，远端分支已是内容相同的恢复提交 5719c033，不能称其本地 HEAD 同步更新；delivery ea10bd3／未提交 10／未推送 0，旧 rfc003-ux 仍如实报告 Git 输出超限。既有缓存未读取、清理或提交，未发模型轮次，原 CLI 草稿保留。00:12:56Z 三个健康任务 UID／ready／restartCount=0、四份原业务文件／Git 配置摘要和失败工作卷 UID 全部保持。

平台源码与镜像未变，console c9905a6／generation=29、API ebaa730／32、controller cc93104／21 均 1／1，节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,447,006,208 bytes。前一批文档提交 10e9aed854287bd82ce641159044d6963d581d03 的精确 SHA [CI 34909648473](https://github.com/wangbinquan/CrewStation/actions/runs/34909648473) 于 2026-09-14T23:39:04Z 成功：1152 pass／8 skip／0 fail、console build 1.03s。本次主仓仅记录验收，复用第六十批有效完整门禁和 build，最终文档 SHA 的 CI 单独核对。

证据为 batch61 的 environment、remote-before、三份 manifest、failure／second-failure／recovery-commit、三轮 started／scaled／restored、first-failure-k8s、first-log-api、log-isolation、qa-before／qa-after／qa-comparison、final-runtime／final-slots。UX-AT-13 已完成，累计 **20／52 通过、32 项待完成**；I9／I14／I15 和具体成员范围仍待答复，RFC-004 继续等待 RFC-003 完结，Hook 未开工。

## 第六十二批：开发／生产配置与实际生效

继续 UX-AT-18，使用既有 files 专用项目／admin，不改成员或市场范围。上一批末已在实际页面验证空键提交的字段错误关联和焦点、两组不同草稿切换保留、离开确认默认聚焦“继续编辑”；撤销所有临时输入后，00:22:48Z 两组配置及版本历史仍为空。该预检查留在 batch61-config-preparation。本批 00:26:22Z 重新核对同样基线：现有预览 v0.1.7／5719c033／配置第 0 版，GREETING 为“你好，数字人工作站”；原开发任务的 GREETING 未设置。

页面初次即显示大写蛇形键名、空字符串覆盖语义、Secret 只写不读以及两组生效条件。生产组先保存 GREETING，再保存明确不用于认证的 RFC003_CONFIG_TEST_SECRET。开发组以 wrong-key 尝试保存，错误紧贴字段，aria-invalid／aria-errormessage 关联成立并聚焦该键，已输入值保留；改成 GREETING 后单次保存成功。实际持久结果如下，时间均为 2026-09-15 UTC：

| 取值组 | 键 | 配置项版本 | 保存时间 | 实际结果 |
| --- | --- | --- | --- | --- |
| production | GREETING | 1 | 00:27:12.962Z | RFC003 第62批生产配置验收 |
| production | RFC003_CONFIG_TEST_SECRET | 2 | 00:27:26.230Z | isSecret=true；HTTP DTO 无 value 字段 |
| development | GREETING | 1 | 00:28:02.464Z | RFC003 第62批开发配置验收 |

正常刷新配置后，开发普通值“填入表单”能读回正确内容；生产 Secret 行只显示占位符，填回表单后实际 password input 的 valueLength=0，页面文本不含测试值。开发第 1 版与生产第 2 版分别保留，Secret 没有出现在开发组。整页刷新后生产组仍显示同样两项和版本历史，新增表单为空，没有从缓存或历史重新填入旧 Secret。本批保留这些明确命名的专用 QA 取值供后续核验，没有改任何真实模型认证。

保存生产配置后，设置页立即准确显示“当前已保存第 2 版”，而待验证 v0.1.7 仍“记录为第 0 版／已有更新的配置；后续发布才会采用”。实际刷新 preview.rfc003-verify-files.cs.localhost 后，GREETING 仍是原默认值，不能把保存成功当作现有进程已加载。发布源仍为既有远端 codex/rfc003-files／5719c033e3ac781eb6e3efcdf1c8e6da02018f34，Manifest 摘要 cf631b15062adf5b68bd3b27c4f3bf3b12ea8edade32db7ac437d78efc96263c；本批没有 QA 源码提交。

实际发布准备逐步固定完整 SHA、填写 v0.1.8 和配置验收说明。第一次点击被自动审批按通用的“可能迁移／共用生产数据”警示拒绝，00:31:50Z 普通 API 确认没有创建 v0.1.8，临时暂停的两个预览立即恢复。随后读取固定提交的 Manifest、Dockerfile 和启动入口，确认没有 migrationCommand、compatibility=none／destructive=false、入口不执行数据库初始化；实际 cs-controller 中 pipelineBuild.ts／pipelineDeploy.ts 摘要与所查源码一致，缺迁移命令直接进入待命槽部署。基于这些实际影响证据，原页面点击获准并正常受理，没有另走写入接口。

唯一新发布为 `rel_01a0a27cc00e700090b5d576e6078408`／v0.1.8，同一源码 5719c033，00:34:39.755Z 创建，00:36:11.032Z ready、slot=preview、configVersion=2。初始构建 Pod `build-d576e6078408-mbb95` 因 Insufficient cpu 等待，按已核对 UID／generation／版本的补丁临时暂停 workbench-blue 与 delivery-green，构建随后完成。此次只有 build-d576e6078408 Job，没有对应迁移 Job；正式槽继续 empty，没有切流。

实际刷新试用页面显示“RFC003 第62批生产配置验收”，首页、admin 身份和 green 槽保持。设置页点击“刷新版本对照”后显示 v0.1.8／5719c033、记录为第 2 版、与当前保存版本一致；整页刷新后结论仍成立，1280×720 实际截图已检查。00:38:15Z files-green Deployment 原 UID 保持、generation=13、1／1；新 Pod `rfc003-verify-files-green-7668c7fdf7-8lvbm`／UID `4ea20b56-186f-47b1-a44a-bbece71fdd63`、restartCount=0，实际 imageID=`registry.crewstation-system.svc.cluster.local:5000/rfc003-verify-files@sha256:25586d773c4266c5e54938a112f35dd3a10e0a92a6841bfd93561dc4d021e3eb`。容器内只读 GREETING 与页面新值一致，CS_ENVIRONMENT=production；Manifest 只引用 GREETING，未引用的测试 Secret 没有注入。原开发容器仍 GREETING 未设置／development，与“新任务容器创建时注入”说明一致。

00:36:40Z 两个暂时暂停的预览已经全部恢复原 UID／版本、1／1：workbench-blue generation=21、delivery-green=13；它们包含初次拒绝后恢复和实际构建后恢复两轮。00:39:12Z 三个 QA 的 taskId、native DTO、历史 Agent、活动和工作树对照均保持，checkedAt 查询时间另计。00:40:05Z 健康任务 UID／ready／restartCount=0、四份原业务文件／Git 配置摘要、原失败 Pod 与 Bound 工作卷 UID 保留；原 workbench 正式版本仍 v0.1.0／generation=1。没有发模型轮次或清理缓存内容。

平台运行镜像及其 generation 仍 console c9905a6／29、API ebaa730／32、controller cc93104／21，均 1／1；节点 Ready=True、MemoryPressure／DiskPressure=False，余量 1,586,561,024 bytes。前一批 f22a2289b5d127d63797264e7755ea2c94e63e39 的精确 SHA [CI 34912548791](https://github.com/wangbinquan/CrewStation/actions/runs/34912548791) 于 00:21:30Z 成功：1152 pass／8 skip／0 fail，1160 tests／195 files／66.46s，console build 通过。本批主仓仅补实际验收证据，复用第六十批有效完整门禁和 build，最终文档 SHA 的 CI 单独核对。

证据为 batch62 的 baseline、environment、remote、qa-before／qa-after／qa-comparison、rejected-publish、pinned-startup-review、publish-scope-proof、两轮 scaled／restored、release-started／release-result、runtime-config、final-runtime。UX-AT-18 已完成，累计 **21／52 通过、31 项待完成**；I9／I14／I15 和具体成员范围仍待答复，RFC-004 保持已批准、等待 RFC-003 完结。

## 第六十三批：旧链接和两空间返回

继续 UX-AT-24，在现有 admin／files QA 和参考 API 代理上走真实旧链接。批前主仓为 `f93f420596ed611d7396d90aeb4d44aace27ccfd`、与 origin/main 一致，工作树和暂存区为空；该 SHA 的 [CI 34914479859](https://github.com/wangbinquan/CrewStation/actions/runs/34914479859) 于 00:51:04Z 成功，1152 pass／8 skip／0 fail、1160 tests／195 files／69.20s，console build 通过。本批没有启动模型轮次、提交发布表单、执行 API 试调或改变角色／配置。

### 实机缺陷与修复

从 files 的旧 catalog 链接打开既有 `test-gitlab:GET:/v4/projects/{id}/repository/commits/{sha}`，点击“管理接口开放策略”再点“回到工作台”，原页面误落到 settings 默认成员分类。SpaceSwitch 只记录 pathname，丢失 query 中的资源分类、操作和筛选；现记录完整 href，随同路径 query 变化更新，并用 href 返回。三个真实路由回归覆盖指定 API 操作、开发切生产配置和带 releaseId／since／limit 的迁移日志，修复前 **23 pass／3 fail／156 assertions**。文档夹具显式返回不可用，避免默认空对象被 Swagger 当成错误入口；没有以文档夹具替代实际 API 调用。

第二处是旧 `/admin/integrations?q=reference-api-proxy&kind=APIProxy&state=active` 只保留固定 tab，实际显示两项而不是唯一匹配项。旧路由现复用 parseCapabilitySearch 校验并传递 search。新增用例证明 q、kind、state、ownerUserId、cursor 到达 `/v1/projects/page`，以及替换式旧路由的浏览器返回；修复前 **12 pass／1 fail／91 assertions**。实机再加入 admin 的实际 ownerUserId，旧链接、筛选控件和唯一参考代理行均一致，进入详情后返回仍保留条件。

第三处在前两项修复部署后实机发现：旧租户参考代理日志地址正确进入管理接入项目，但“回到工作台”又回到同一管理页。TopBar 在项目类型确认前记住了中间租户地址，返回后被类型边界再次重定向。现复用 TopBar 已有项目查询，确认数字人项目后才允许 SpaceSwitch 记录；非项目位置保持原行为。三个回归覆盖先前列表筛选、直接打开旧接入链接、项目读取失败后恢复，修复前 **9 pass／3 fail／48 assertions**。既有空间往返夹具补为实际结构的 DigitalWorker，不以无项目种类的空对象作为成功读取。

### 真实页面接续

以下对象来自正常 API 和已有页面，经 CUA 实际导航／点击／返回及前进核对，没有伪造未存在的项目或发布：

| 入口／操作 | 页面结果 |
| --- | --- |
| files 旧 catalog、管理员旧 api-catalog | 原 proxy／operation 与调用项目保留，准确显示一项 GET；查看全部接口后才恢复 13 项，未点击 Execute |
| files 旧 events，subscriptionId=`sbs_01a09fecf16c7000a04f28815490793c` | 进入投递分类并保留订阅，明确近 50 条中的 0 条；“查看订阅”定位 gitlab.push／events/gitlab 生效行，返回／前进保持原订阅 |
| 旧 view=conversation 和 agent=`agt_01a0a18645f770009e298c7f2f5e12b4` | 独立 conversations 路径显示 L-5e12b4／rfc003-verify-opencode／等待输入，与原 sessionId 一致；返回／前进接续该对象 |
| 旧 config，再同路径选择生产取值组 | 管理往返恢复 production，仍显示预览 v0.1.8／配置第 2 版，没有落到默认成员页 |
| 旧 build 日志，v0.1.8／since=00:34:39.755Z／limit=700 | operations 的 logs 分类保留完整发布、来源、时间与条数；管理往返和浏览器返回／前进保持同一条件 |
| 旧开发会话日志，files taskId／since=00:00Z／limit=100 | 原任务筛选保留；通过控件改成部署槽和全部槽时清除不适用 taskId，保留时间／条数，slot=all |
| 历史发布 v0.1.6／`rel_01a0a25c21d57000a388dcc9502a683e`／source=repository | 管理往返仍选择该历史发布及 5e96d930 提交，没有跳到最新 v0.1.8；未提交发布 |
| 旧接入列表，名称／APIProxy／active／实际 admin 负责人 | 迁移后查询、控件及唯一参考代理行一致，进入详情再返回保留四项条件 |
| 旧租户参考代理日志，source=slot／slot=prod／limit=300 | 管理接入项目的日志筛选保留，最终修复后“回到工作台”正常进入 `/` 能力市场，不再循环 |

第六十二批末 navigation-preparation 另有配置分组返回／前进、精确发布日志、接入项目日志和返回接入容器入口证据。前两项修复部署后完成上表主要路径，第三项修复的最终部署再次核对 API 文档→管理→返回 resources/api 原操作、生产配置→管理→返回 production、旧接入列表四项筛选和旧租户接入日志返回市场，实际脚本为 index-CR5gHbTt.js。当前目录只有两个接入项目，未冒称真实第二页；cursor 保留另由路由与实际请求边界回归证明。

### 门禁、部署与原状态保留

最终四文件定向回归 **47 pass／0 fail／256 assertions**。首轮完整检查停在新增测试使 describe 超出行数限制，移出该组后通过；之后每次仅因新实机缺陷修复使候选改变才重跑。最终 `bun run check` **1163 pass／4 skip／0 fail**（1167 tests／195 files／6467 assertions／111.07s），console build **508ms**。七份源码／测试候选在 01:24:56Z 固定，此后未改变；不为纯文档更新重跑完整门禁，最终提交 SHA 托管 CI 单独核对。

最终 console 镜像 `cs-console:rfc003-b63-6e1f7d451f` 以已核对 c9905a6 为基底，仅覆盖 dist／serve.ts，imageID=`sha256:65986ad319e13f9f3146a660bb2f3bf6e91b6055a5dd53c8a7cacd6912b5afd7`。01:28:04Z Deployment UID 保持，generation=31、1／1；Pod `console-65b67d8588-zvglf`／UID `d13a255d-2a67-4dae-9859-fd4a5edcfd26`、restartCount=0，实际 imageID 和七份文件摘要／大小一致。01:34:50Z 正常 HTTP 六份静态资源匹配最终构建。三次小候选流式导入共新增 11,151,606 bytes 内容，最终候选 3,717,200 bytes；只有第二、第三候选实际滚动 console，没有清理数据或调零副本。

01:34:50Z 与 00:58:15Z 批前快照逐项比较，delivery／files／旧 rfc003-ux 的 taskId、native、历史 Agent、activity、workspace 全部相同，只排除 checkedAt 查询时间；会话活跃时间不计作逐字节不变。原 delivery 中文草稿和 files 草稿未发送，历史访问未启动新模型轮次。01:35:41Z 三个健康任务及原失败任务的 UID／容器状态／restartCount、四份原业务文件及 Git 配置摘要、失败 Bound 工作卷 UID 均保持；CLI 缓存未读取或清理。

API ebaa730／generation=32、controller cc93104／21 均 1／1，原任务运行时保持。workbench-blue／delivery-green／files-green 分别 generation=21／13／13，各自 releaseId、原 Deployment UID、1／1 均与上批一致；workbench 正式 green 保持 generation=1。节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,763,966,976 bytes。本批仅 console 发生部署更新。

证据为 batch63 的 navigation-before／navigation-final、navigation-objects／catalog-objects、三组 red、loop-targeted、check-navigation-final、build-navigation-final、source-candidate、image-context／built／budget／import、console-rollout、http-assets、qa-before／qa-after／qa-comparison、final-runtime；前两候选以 initial／pre-loop 前缀保留。UX-AT-24 已通过，累计 **22／52 通过、30 项待完成**。T12 仍进行中；I9／I14／I15 和具体成员范围仍待答复，RFC-004 已批准、继续等待 RFC-003 完结，Hook 未开工。

## 第六十四批：窄屏页签与错误字段焦点

继续 UX-AT-25／26。批前 main 与 origin/main 同为 `35c5067fe0c19c0eae83ea1f96ca6b0fe90bf244`，树和索引为空；其精确 SHA [CI 34918433770](https://github.com/wangbinquan/CrewStation/actions/runs/34918433770) 已成功，1159 pass／8 skip／0 fail、1167 tests／195 files／69.44s，console build 955ms。本批沿用既有 admin 与 QA 对象检查页面布局、键盘和字段反馈。

### 实机缺陷和回归

320px 的“运行与诊断”标签条实际边界为 [16, 304]，宽 288、内容宽 466。从“日志”按右方向键后内容和 aria-selected 已进入“事件投递”，但 scrollLeft 仍 0，目标 [284, 374] 被裁切；1280px 选中末尾“调用链回放”后缩到 320px，目标仍在 [378, 482]，完全隐藏。

初次回归模拟原生 focus 的滚动，发现 Router 会恢复导航前位置；把聚焦移到导航前后测试通过，但首个部署实看仍未显露目标，因此没有把这轮测试绿视为修复完成。随后回归使用实测边界，仅补 Happy DOM 缺少的布局；右键、Home、End、左右首尾循环五项正常失败，**14 pass／5 fail／97 assertions**。共享 Tabs 增加按边界调整自身 scrollLeft 的逻辑，焦点／键盘先显露再导航，避免路由恢复旧位置。另一项缩放回归先 **19 pass／1 fail／108 assertions**，补 useLayoutEffect 和 ResizeObserver 后，选中项在挂载、变化与缩窄时完整可见，同时保持正文焦点，卸载断开监听。

实际中文错误检查另发现：输入 invalid-trace 并点击查询，字段已经标错但焦点仍在按钮上，不能直接继续改输入。TracePage 增加输入 ref，校验失败后聚焦字段。测试显式先聚焦真实提交按钮，再点击提交，证明草稿、错误关联、无无效请求和有效查询路径。初次直接比较两个 DOM 节点的失败输出进程退出 133、未产生正常断言汇总，不作为正常红证据；将比较结果断言为布尔值后正常复现 **19 pass／1 fail／111 assertions**，修复后通过。最终四文件定向 **55 pass／0 fail／305 assertions／3.02s**。

### 浏览器量测和最终复验

使用 CUA 实际浏览器、既有对象和页面控件。市场、项目列表、files 项目概览、发布准备、带 v0.1.8 完整 releaseId／since／limit 的日志，分别检查 1280、1024、768、390、320px；接入列表和发布详情另有 320px 记录。27 次量测的 documentWidth 均等于视口，正常宽度正文为 1056／800px，窄屏正文随视口；中文控件、长筛选项和空结果可见。发布准备仅展开并收起，日志已超过保留期显示空，未把空日志当作新的业务日志验收。

修复后的真实 320px 标签条中，右键切“事件投递”为 scrollLeft=70、目标 [214, 304]；End／左键循环到“调用链回放”为 178、目标 [200, 304]；Home／右键循环回“健康状态”为 0、目标 [16, 106]。六项键盘／缩放记录均 selected=true、焦点蓝色 2px 轮廓可见、目标完整位于标签条。该轮脚本为 index-wkMMZQSB.js，共享 Tabs 的最终源码此后未变。

包含 TracePage 修复的最终部署载入 index-DN3puaAl.js。实际提交 invalid-trace 后显示“Trace ID 必须是 32 位小写十六进制。”，输入和焦点保留、aria-invalid=true、字段错误关联正确。保持这份输入连续切换五种宽度，焦点仍在输入框、文本和错误不丢、选中末尾标签完整可见；390／320px 标签条分别滚到 108／178。清空临时输入并刷新后字段为空、invalid=false，视口覆盖 reset 完成。这里补足已量测页面与实际键盘子集，不把它当作全部关键页面、完整键盘操作或实际系统明暗旅程通过。

### 门禁、部署与状态保留

最终四份源码／测试候选于 02:28:40Z 固定。受限沙箱检查的静态步骤通过，但临时监听端口和 PostgreSQL 不可访问，测试结果 985 pass／150 skip／38 fail，不属于有效完整门禁；正常本机权限下执行同一 `bun run check`，最终 **1169 pass／4 skip／0 fail**（1173 tests／195 files／6505 assertions／112.58s），console build **746ms**。此前检查仅在实际页面发现新问题并改变候选后重跑；最终有效候选不因文档变化再跑完整门禁。

最终镜像 `cs-console:rfc003-b64-6184b66141` 的 tag 取四份候选摘要，以已核对的 b63 镜像为基底覆盖 dist／serve.ts；imageID=`sha256:5a73faede3ab15279bf87cc27324310f79cd1fbb7e9ca6df950372130057b9e6`。02:32:38Z console Deployment 原 UID 保持、generation=34、1／1；Pod `console-58bd77f7ff-27mfq`／UID `6a17555a-3831-4740-9583-4216b1fb653f`、restartCount=0，实际 imageID 和七份文件摘要匹配。02:34:05Z 正常 HTTP 六份静态产物与最终构建一致。三轮小候选导入新增内容共 11,157,535 bytes，其中最终候选 3,719,349 bytes；只滚动 console，未调零其他副本或清理数据。

02:34:04Z 与 01:52:48Z 批前快照比较，delivery／files／旧 rfc003-ux 的 taskId、native、历史 Agent、activity、workspace 均保持，仅 checkedAt 查询时间另计；不声称整个 session DTO 逐字节不变。原 CLI 草稿保持未发送，本批没有模型轮次或 QA 发布／配置／授权写入。

02:34:29Z 三个健康任务及原失败任务 UID／容器状态／restartCount、四份业务文件及 Git 配置摘要、失败 Bound 工作卷 UID 保持。workbench-blue／delivery-green／files-green 仍为 generation=21／13／13、原 releaseId、1／1，workbench 正式 green 仍 generation=1。API ebaa730／generation=32、controller cc93104／21 均 1／1，任务运行时未更新。节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,765,412,864 bytes。

证据为 batch64 的 browser-subset／browser-final、tabs-geometry-red／tabs-resize-red／trace-focus-red-normal、final-targeted-complete、check-authorized、build-complete、source-candidate、image-context／built／budget／import、console-rollout、http-assets、qa-before／qa-after／qa-comparison、final-runtime。前两候选保存在 initial／pre-trace 前缀，沙箱失败和非正常测试进程输出分别留档。**累计仍 22／52 通过、30 项待完成**，T12 保持进行中；I9／I14／I15 与具体成员范围仍待答复，RFC-004 等待 RFC-003 完结，Hook 未开工。

## 第六十五批：创建时分支与窄屏表格密度

继续 UX-AT-25／26，批前 main 与 origin/main 同为 `0d56720699dfe34073174a00dcf0ec20887a2e4b`，树和索引为空；精确 SHA [CI 34921985145](https://github.com/wangbinquan/CrewStation/actions/runs/34921985145) 于 02:41:24Z 成功，1165 pass／8 skip／0 fail、1173 tests／195 files／71.28s，console build 1.19s。本批使用现有 admin 与 QA 对象，没有启动模型轮次或修改能力授权。

### 分支来源与真实回归

实际 files 概览在“当前开发”下显示 main，但 02:47:08Z 正常 workspace-status 为 codex/rfc003-files／HEAD e4741df56b440d776b7c25ff5a4978b3d5822f46；同次 summary 的 development.value.branch 是 main。来源追到 task-runtime 的 findDevSession／createEnvironment，它记录创建环境时的分支，不读取容器 Git。design §4 已明确该信息必须标为“创建时分支”，并要求摘要不额外查 Runner。

共享 DevelopmentFact 现为列表与概览显示“创建时分支：main”，英文为“Branch at creation: main”；缺失仍显示“创建时分支：分支未知”。两个真实路由回归初次 **10 pass／2 fail／78 assertions**，修复后同时证明缺失状态、不额外查询 workspace-status／version-comparison、不发生写入。列表也不额外读 dev-session／tasks；概览原 TopBar 的元数据读取保持。初版测试错误禁止了概览已有读取，修正测试边界后最终两文件定向 **32 pass／0 fail／200 assertions／2.34s**。

真实 UI 切换中英文均显示正确标签，随后恢复中文；列表四个匹配项目同样明确标注创建时分支。英文实机来自中间 index-CkFSlu82.js，最终 index-wC8asuB4.js 再次核对中文概览和列表；两次 SummaryFacts 与语言文件摘要一致。实际当前分支仍来自独立工作树状态，不将摘要读取时间新鲜等同于容器分支新鲜。

### 表格与页面量测

320px 的任务套餐表外层宽 262px，原表宽 347.20px，前五列只有约 52px；coding-medium 行高 128.99px，rfc003-59-snapshot 的说明逐字挤成 397.27px。共享 DataTable 增加单元格最小阅读宽度，继续使用原外层 overflow-x:auto。5rem 实机长行仍为 218.09px，因此依据新观察调整到最终 7rem；六列各 112px、表宽 672px，两行分别 **61.80px／128.49px**。

正常 Tab 能进入实际溢出容器，方向键可横向滚动，蓝色 2px 焦点可见；没有为浏览器已有行为新增监听器。生产版本对照最终宽 262px、内容宽 374px，方向键使 scrollLeft=112；套餐表右侧编辑按钮可由键盘到达，边界 [191, 253]，没有激活编辑。CSS 的低影响可逆改动以真实前后尺寸与交互验证，没有增加只复述样式字符串的测试。

最终部署覆盖以下 **30 个页面状态 × 5 个宽度 = 150 次量测**，宽度为 1280／1024／768／390／320，均高 720px。每次 documentWidth 等于视口，选中标签可见，脚本均为 index-wC8asuB4.js：

- 设置：成员、应用可见性、开发配置、生产配置、资源总览、API、事件、仓库、生命周期，共九项。
- 运行诊断：健康、全部告警、投递，共三项。
- 管理：总览、项目、用户、算力、服务套餐、任务套餐、接入、接口策略、事件源、API 申请、出站申请、出站规则、网关，共十三项。
- 新建数字人：必填错误、模板与资源、最终确认，共三种状态。
- files 项目概览、筛选 rfc003 的项目列表，共两项。

表格数字只统计可见表，配置页挂载的隐藏取值组不算可见结果。资源总览的能力表格也复用 DataTable，但 320px 部分行仍高 906／1194／1297px；尚须继续定位内容布局为何抵消了阅读宽度，已保留为下一批明确可读性缺陷。当前五尺寸无整页溢出只是几何证据，不代表全部关键页面或全部表格密度已经验收。

新建向导空提交显示三项就地错误并聚焦名称。临时名称“RFC003 第65批布局检查”、slug rfc003-layout-review-65、既有 admin 负责人只用于表单；选择 minimal-sample／standard-small 和默认任务套餐后查看最终确认，没有点击“创建项目”。返回时确认放弃输入，重开向导两个文本框为空；03:27:39Z 正常项目分页查询该 slug 返回 items=[]。没有保存角色／可见性／资源／网关配置，没有提交授权申请、API Execute 或事件订阅。最终语言为中文，viewport.reset 已完成。

### 候选门禁、部署与保全

最终五份源码／测试候选于 03:07:09Z 固定，此后保持。完整门禁 **1171 pass／4 skip／0 fail**（1175 tests／195 files／6514 assertions／110.85s），console build **521ms**。分支标签单独候选和 5rem 中间候选的有效检查分别留档；只有后续真实尺寸观察导致源码改变才重跑，最终候选不为文档补记重跑完整门禁。

最终 console 镜像 `cs-console:rfc003-b65-231ca0b09f`，imageID=`sha256:cea0758bd0137d72b3918344fd39fdea6862bd46cf256758ac07dd0eb0ed64da`。03:10:43Z 原 Deployment UID 保持、generation=36、1／1；Pod `console-77d7fcd9fb-8slx7`／UID `58288380-2655-44d0-8fca-153aa55f497a`、restartCount=0，实际 imageID 与七份运行文件摘要一致。03:27:39Z 正常 HTTP 六份静态资源与最终构建一致。本批导入两份小候选，共新增 7,439,722 bytes；最初仅含分支标签的镜像未导入或部署，没有清理数据或调零其他副本。

03:25:38Z 与 02:45:36Z 批前快照逐项比较，delivery／files／旧 rfc003-ux 的 taskId、native、历史 Agent、activity、workspace 均相同，仅排除 checkedAt；不声称整个 session DTO 逐字节不变。03:27:08Z 三个健康任务及原失败任务 UID／容器状态／restartCount、四份原业务文件及 Git 配置摘要、失败 Bound 工作卷 UID 保持。原 CLI 草稿未发送，历史会话没有新增模型轮次。

workbench-blue／delivery-green／files-green 保持 generation=21／13／13、原 releaseId、1／1，workbench 正式 green 保持 generation=1。API ebaa730／32、controller cc93104／21 均 1／1，原任务运行时没有更新。节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,861,398,528 bytes。

证据为 batch65 的 branch-source、summary-branch-red／summary-branch-targeted、browser-before／browser-final、check-readable／build-readable、source-candidate、image-context／built／budget／import、console-rollout、http-assets、wizard-not-created、qa-before／qa-after／qa-comparison、final-runtime；前期候选以 initial／five-rem 前缀保留。源码和三份证据文档精确提交，最终 SHA CI 独立核对。**累计仍 22／52 通过、30 项待完成**；T12 保持进行中，资源总览密度和其余尺寸／键盘／真实主题旅程继续，I9／I14／I15 与具体成员范围仍待答复，RFC-004 等待 RFC-003 完结。

## 第六十六批：资源长内容与复制反馈

继续 UX-AT-25／26，批前 main／origin/main 同为 `b13eaa47a18995daa3a911571ff230621d280cf6`，工作树和索引为空。该 SHA 的 [CI 34925412408](https://github.com/wangbinquan/CrewStation/actions/runs/34925412408) 于 03:35:23Z 成功，1167 pass／8 skip／0 fail、1175 tests／195 files／64.03s，console build 1.17s。原批准范围内继续现有 admin／files QA 的开发资源页面，未新建项目或模型会话。

### 实机原因与修复

第六十五批已量测到资源总览的异常长行。本批在同一 index-wC8asuB4.js／320px 页面直接量测，确认 CapabilityTable 复用 DataTable，并非另一种不受共享样式影响的表。问题在 [CopyValue.module.css](../../../apps/console/src/features/capabilities/components/CopyValue.module.css)：原 wrapper 不换行 inline-flex、max-width=100%，[CopyValue.tsx](../../../apps/console/src/features/capabilities/components/CopyValue.tsx) 的空 role=status 元素仍有 4em 最小宽度。实际复制单元格宽 145.76px，其中按钮 42px、空提示 48px，长 code 只有 15.76px，连一个词都放不下。

保留原组件、按钮、复制逻辑及 live region，只调整 CopyValue CSS：inline-grid 的两列分别是 minmax(16ch, 1fr) 和 auto，反馈跨两列放在下方，没有横向占位；空反馈高度为 0，不增加行间隙。文本继续允许断行，实际代码阅读宽度为 141.09px。320px 前后各表最大行高如下（px）：

| 表格 | 修复前 | 最终修复后 |
| --- | ---: | ---: |
| 数据资源 | 328.64 | 40.11 |
| 可调用的操作 | 1297.28 | 122.55 |
| 事件订阅 | 307.53 | 39.61 |
| 平台 MCP | 905.70 | 81.33 |
| 业务子任务接口 | 1194.23 | 151.39 |

比较的是同一张表的最大行高，业务子任务表修复后的最高行已是较长说明，而非旧的逐字路径；没有把不同最高行声称为同一行的逐项变化。多列仍由原 DataTable 外层横向滚动，320px 外层宽 254px，正文没有被表格撑宽。

### 真实浏览器验证

最终 index-DU8WKN7b.js 在中文、英文各检查 1280／1024／768／390／320×720，共十次页面量测；documentWidth 均等于视口。操作表最大行高按五种宽度为 81.33／101.94／101.94／122.55／122.55px，长 code 最小实测宽度始终 141.09px。英文量测在实际出现 Operation key／Method／Path／Open policy 后取得，切换语言后尚未完成加载的首轮记录未当作英文证据。

实际点击“复制 test-gitlab:GET:/v4/projects/{id}/repository/branches/{branch}”，正常剪贴板内容与完整操作键相同。反馈由空变“已复制”，code 宽／高保持 141.09／105.05px，按钮相对左边界 149.09px、宽 42px，wrapper 宽 191.09px，均未移动；反馈从 code 下方开始。英文同一操作显示 Copied，内容同样准确。两次均恢复原剪贴板；初次原剪贴板无 item，工具不接受空数组，随即用空文本恢复，没有遗留测试操作键。

Tab 从操作键复制进入右側路径复制时，表格 scrollLeft=382，按钮 [139.19, 181.19] 完整位于 [33, 287] 的滚动容器；Shift+Tab 返回原复制按钮，scrollLeft=55，按钮 [139.09, 181.09] 完整可见。两次均有蓝色 2px 焦点，不依赖颜色传递复制结果。实际截图已查看长操作表以及英文 Copied 状态。最后重新选中文并等到“项目设置”标题可见，viewport.reset 完成；没有读取或修改配置值、授权、订阅或发布。

### 门禁、部署与原状态

唯一源码候选为 CopyValue.module.css，03:39:54Z 固定摘要 `87dff41b6e4e07e9c7a78faddad41db3e4cf1f9d827f0526a04d8fd1bcc7e7db`，此后保持。这是可逆样式修复，以真实 DOM 的前后布局、实际复制和键盘交互验证，没有新增只复述 CSS 声明的测试。正常本机权限的一次完整 `bun run check` 为 **1171 pass／4 skip／0 fail**（1175 tests／195 files／6514 assertions／118.68s），console build **654ms**。纯文档补记复用该有效候选，不重复门禁。

镜像 `cs-console:rfc003-b66-b7f9840041`，imageID=`sha256:b9e5326debd21d9261189a0b400a1066e6cca570d43d136687efad66ced2bb9f`；按实际缺少的内容计算，导入新增 3,719,861 bytes。03:44:42Z 原 console Deployment UID 保持、generation=37、1／1；Pod `console-778bc8b4c9-fh2s5`／UID `672eadaf-9d93-4101-9fec-63b30b8f9aa9`、restartCount=0，实际 imageID／七份文件匹配。03:48:50Z 正常 HTTP 六份静态产物也与构建一致。

03:48:50Z 对照 03:39:53Z 批前快照，delivery／files／旧 rfc003-ux 的 taskId、native、历史 Agent、activity、workspace 均相同，仅排除 checkedAt；会话活跃时间另计。03:49:17Z 原三个健康任务及失败任务 UID／容器状态／restartCount、四份业务文件及 Git 配置摘要、失败 Bound 工作卷 UID 保持；工作树已有缓存不读取或清理，原 CLI 草稿未发送。

API ebaa730／generation=32、controller cc93104／21 均 1／1，任务运行时未变。workbench-blue／delivery-green／files-green 仍 generation=21／13／13、原 releaseId、1／1；workbench 正式 green 仍 generation=1。节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,838,116,864 bytes。本批仅滚动 console，没有临时调零其他副本或清理镜像／数据。

证据为 batch66 的 browser-before／browser-final、check、build、source-candidate、image-context／built／budget／import、deploy-before／console-rollout、http-assets、qa-before／qa-after／qa-comparison、final-runtime。源码与三份文档精确提交，最终 SHA 托管 CI 单独核对。资源总览已复现的密度缺陷关闭；**累计仍 22／52 通过、30 项待完成**，其余关键页面、角色和实际系统明暗旅程继续，I9／I14／I15 与具体成员范围仍待答复，RFC-004 等待 RFC-003 完结。

## 第六十七批：开发面板、菜单与只读滚动

继续 UX-AT-25／26／37，批前 main／origin/main 为 `67e8a70fa4dfbf9f279b5428695e4ec235f3850d`，工作树和索引为空。该 SHA 的 [CI 34926758620](https://github.com/wangbinquan/CrewStation/actions/runs/34926758620) 于 03:56:33Z 成功：1167 pass／8 skip／0 fail，1175 tests／195 files／6473 assertions／63.50s，console build 1.00s。沿用原 admin 和既有 QA，不启动新模型轮次。

### 实机缺陷与修复

- [EditorPane](../../../apps/console/src/features/dev-session/components/editor/EditorPane.tsx) 原先只有最小高度，文件树固定 220px。320px 的同一 README 编辑器仅 82px、文字区 57.14px，文档挤成长列且随内容撑高。现在面板使用工作区既定高度，内容区独立布局；容器小于 600px 时文件树置顶、最多 128px 并可滚动，编辑器占整行。最终五尺寸编辑器宽 878／622／530／372／302px、高 445／445／445／293／257px；320px 文字区 277.14px。键盘可到达文档尾部，保存始终禁用，没有修改 README。
- [NativeWorkspace.module.css](../../../apps/console/src/features/dev-session/components/native/NativeWorkspace.module.css) 的菜单以窄 summary 为定位基准，summary 换行到左边时弹出层向左跑出页面。真实 320px 页签设置边界 [-175.69, 80.31]、窗口操作 [-174.83, 81.17]；现相对整条工具栏／窗口标题定位，并限制容器宽度，最终分别 [52, 312]／[51, 311]。中文设置／窗口菜单、英文设置／高级菜单与名册分别完成五尺寸检查。Tab 可到达重命名按钮，[61, 303]、2px 焦点框可见，未执行关闭或结束进程。
- 只读 CLI 保留原 PTY 尺寸，外层 scrollWidth=1088、clientWidth=302，却在正文上无法滚动；改在 4px 边缘滚动可以到 786，证明 xterm 内层拦截是实际原因。[NativeTerminalSurface](../../../apps/console/src/features/dev-session/model/native/nativeTerminalSurface.ts) 现仅在只读且对应方向存在外层溢出时，于捕获阶段阻止事件进入 xterm，保留浏览器默认滚动；取得控制或没有外层溢出时仍由 xterm 处理，卸载移除监听。只读画面增加 region、Tab 入口和内侧焦点框。最终正文滚动至右下角 786／56.5，Tab 从“获取输入控制”进入画面、左方向键使 scrollLeft 786→746；没有点击控制按钮或向终端发键。
- 历史页面的 [TerminalPane](../../../apps/console/src/features/dev-session/components/terminal/TerminalPane.module.css) 只有 min-height，FitAddon 随父内容高度反复增大。五尺寸观察到 xterm 高 18990／19200／19485／19740／19890px。补上原设计的 420px 定高后，五尺寸画面均为 351.41px，320px 整页高 1416px，普通终端提示符与输入区可见。没有重开终端或执行 shell 命令。
- [I18nProvider](../../../apps/console/src/shared/lib/I18nProvider.tsx) 现在同步 html.lang，并在卸载恢复宿主声明。旧页面文案已是英文而语言仍中文；真实控件回归验证中英切换、输入／焦点保持及卸载，最终部署也核对 en-US→zh-CN 和同一 CLI 保留。

### 验收边界与证据

本批有 25 组五尺寸记录（1280／1024／768／390／320×720），包括修复前、中间候选和最终候选，不能把 125 次全部称作修复后的通过。新增范围为 CLI、会话／数据菜单、既有实时预览、代码、差异清单／提交、历史转录；管理接入的概览、无会话开发入口、发布及真实 v0.1.2 详情、健康、成员、无历史会话，以及已上线市场详情。所有记录的整页宽度等于请求视口，但历史终端高度及正文滚动正是在这个条件下发现的问题，因此不以无横向溢出代替可用性。

初期量测错误地把关闭 details 的子控件和可横向滚动的未选中标签列作越界，后续明确排除并实际打开两个问题菜单。另有一次复用 tab 22 的 viewport 句柄去检查 tab 17，五次实际都仍为 1280px；这组无效记录丢弃，后续每次断言实际宽度等于请求值。320px 英文原生页签（183.60px／169.19px 标签条）及历史长页签仍大于自身标签条，完整横向阅读路径尚未验收，没有声称所有标签均完全显露。

原 tab 17 在批初登录过期，reload 后通过原 demo admin 正常登录返回同一任务；原中文草稿存在。尺寸检查使用 tab 22 作为第二个只读查看者。最终 tab 22 返回 files 开发资源页、撤销 viewport，tab 17 加载最终脚本并通过正常按钮恢复原输入控制：CLI 1937fa、工作区 1／网格、未读完成 1、`RFC003_SNAPSHOT_DRAFT 未发送草稿` 均在实际截图中保持。

语言回归先 **0 pass／2 fail／6 assertions**；滚动回归先 **1 pass／3 fail／6 assertions**，真实 xterm 与外层几何共同验证事件归属，涵盖横／纵滚动、无溢出及控制权往返。最终定向为 **13 pass／0 fail／52 assertions**。样式尺寸采用真实浏览器前后与键盘验证，没有新增复述 CSS 的测试。

### 最终门禁、部署与保留状态

首个六文件候选完整检查 **1173 pass／4 skip／0 fail**、build 502ms，部署为 b67-2e27cec857／generation=38。随后正文滚动的新增修复改变候选，九文件候选检查 **1177 pass／4 skip／0 fail**、build 494ms；该检查执行期间又发现历史高度问题，等检查完成后补定高，没有中途改变候选。最终十文件候选完整 `bun run check` **1177 pass／4 skip／0 fail**（1181 tests／197 files／6540 assertions，测试阶段 107.09s，命令共 125.36s），console build **441ms**。三轮结果分别保留为 initial、scroll-only 和最终记录；最终摘要此后保持，纯文档不重复检查。

最终镜像 `cs-console:rfc003-b67-b5d4ba5f9d`，imageID=`sha256:1bd35c17b01f8e325bc964d5aa8d184880b63504180395bd6fed906a316b968c`，新增导入 3,720,885 bytes（中间部署另增 3,720,373 bytes）。04:33:29Z 原 Deployment UID 保持、generation=39、1／1；Pod `console-69df94cbb9-bgpgp`／UID `1cd31b06-b454-4459-9eeb-d965dcea29c4`、restartCount=0，实际 imageID 和七份文件匹配。04:37:48Z 正常 HTTP 六份资源一致，实际页面为 index-CroDSPeQ.js；最终再验原生只读、编辑器、历史页五尺寸及菜单 320px／语言往返。

04:37:48Z 普通 API 对比批前 04:02:44Z，delivery／files／旧 rfc003-ux 的 taskId、native、activity、历史 agents、workspace 相同，仅排除 checkedAt；session 单独比较，只有 delivery.lastActivityAt 更新。个人布局内容完全恢复，正常导航保存使 revision 3→10。没有读取 npm 缓存内容或发送原草稿。

04:38:05Z 原三个健康任务及失败任务 UID／容器状态／restartCount、四份原文件及 Git 配置摘要、失败 Bound 工作卷 UID 均保持；各预览／正式槽的 UID、generation、releaseId、1／1 与批前相同。API ebaa730／generation=32、controller cc93104／21 均 1／1；节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,785,839,616 bytes。本批仅更新 console，未清理数据或调零其他副本。

临时证据为 batch67 的 language-red、scroll-red、final-targeted、initial／scroll-only／最终 check 和 build、source-candidate、image-context／built／budget／import、deploy-before／console-rollout、http-assets、qa-before／after／comparison、layout-before／after、browser-final、final-runtime。源码与三份文档精确提交，最终 SHA 托管 CI 单独核对。**累计仍 22／52 通过、30 项待完成**；创建接入／开通页面、长标签阅读及完整键盘／实际系统主题等余项继续，角色及故障恢复不由这些尺寸证据替代。I9／I14／I15 与具体成员范围待答复，RFC-004 等待 RFC-003 完结。

## 第六十八批：长页签与响应式验收收口

批前 main／origin/main 同为 `d2ba2138186b21fe3b0933b475cdb1a2e0fb2de2`，树和索引为空。该 SHA 的 [CI 34929989314](https://github.com/wangbinquan/CrewStation/actions/runs/34929989314) 于 04:46:44Z 成功：1173 pass／8 skip／0 fail，1181 tests／197 files／6499 assertions／65.26s，console build 1.24s。本批继续既有 admin 与专用 QA 的正常界面验收。

### 长页签的实际缺陷和修复

历史 L-04060d 页签在 320px 的边界为 [29, 357.43]，标签条为 [17, 303]，内侧可用宽度 262px。按右键确实可以横向移动，scrollLeft 0→52，但左侧变为 -23px，名称开头与“等待输入”不能同时显示；没有把这项缺陷描述为完全不能滚动。英文原生工作区标签“工作区 1 · 1 · 1 unread results”宽 183.60px，标签条仅 169.19px，最后的 results 被截去。

[Tabs.module.css](../../../apps/console/src/shared/ui/Tabs.module.css) 限制单个标签不超过标签条，并允许内部换行；[AgentRoster.module.css](../../../apps/console/src/features/dev-session/components/agents/AgentRoster.module.css) 同样约束历史标签，允许名称和状态排列成两行，长算力名可断行。没有改变标签选择、会话、状态或横向浏览逻辑。

最终脚本 index-CbQU6d-3.js 下，两组长标签分别实测 1280／1024／768／390／320×720，整页宽度均等于视口。历史 320px 页签完整落在 [29, 291]，高 56.39px；其余四种尺寸仍高 29.20px、宽 328.43px。英文原生 320px 页签完整落在 [8, 177.19]，高 41.59px，宽屏仍高 28px。截图确认名称与状态同时可读，没有用仅有 aria 文本冒充视觉阅读。

真实键盘 End 转到“Changes”时标签条 scrollLeft=184、选中项 [111.47, 177.20]；Home 回到原工作区时 scrollLeft=0、选中项 [8, 177.19]，均有蓝色 2px 焦点框。历史页签方向键焦点同样可见。开发资源、诊断、管理员能力接入三类共享标签调用方重新完成五尺寸检查，普通短标签的阅读尺寸保持。

### 创建、确认和错误路径

两类接入创建在初始页直接显示名称／slug／负责人限制。空提交产生三个关联字段错误并聚焦名称；资源页缺少模板／套餐和并发值 101 时三个错误均可见并聚焦模板。一次工具 fill 空字符串未清掉受控数字框，实际仍停在 101 的错误步骤，该记录保留为错误状态；使用全选、Backspace 后值确认为空，才进入真正的确认页，没有将工具未清空视为产品故障。

临时名称为 78 字，slug 为 rfc003-layout-only-20260915；选择已有 admin、reference-api-proxy／standard-small 后，确认页完整显示长名称、平台默认并发及所需 GITLAB_TOKEN 键名。返回改成 EventProducer 时旧模板清空；选 gitlab-event-producer 后确认页显示相应 GITLAB_WEBHOOK_SECRET_TOKEN 键名。未读取或填写密钥值，未点击创建。离开保护默认聚焦“继续编辑”，明确放弃后重新打开表单，名称／slug／负责人均为空。05:05:01Z 普通项目 API 确认仍为 7 项（5 DigitalWorker、1 APIProxy、1 EventProducer），没有临时 slug。

现有参考代理的开通页明确显示已开通与发布就绪的区别，并提供管理空间内后续入口。实际登录页检查字段、说明、按钮与品牌，没有提交另一身份；未知地址的“返回项目列表”实际回到列表。两者都完成五尺寸，登录为静态认证页面，没有将它算作加载 console 模块脚本。

delivery 的上线预检确认区、远端来源检查与最终发布版本表单也完成五尺寸。320px 下 Shift+Tab 可达“确认上线 v0.1.1”，边界 [29, 157.75]、纵向 [343.41, 377]；Tab 可达“确认发布到待验证版本”，边界 [105, 279]、纵向 [343.08, 376.67]，2px 焦点框可见，长 SHA 和中文说明不重叠。没有激活提交按钮，检查后取消并离开。05:12:51Z 正常 API 仍只有原 v0.1.0／v0.1.1、0 条切流记录。

### UX-AT-25 的范围与结论

本轮共有 **20 个页面状态 × 5 种尺寸 = 100 次检查**，实际视口、整页宽度全部一致，可见控件越界为 0，显示错误均有对应字段关联。其中 12 个页面状态来自修复前 index-CroDSPeQ.js，另有静态登录页；最终镜像上的 7 个状态为中文 CLI、开发资源、健康、能力接入、上线确认、发布来源检查及最终版本表单。另有 16 次长标签／选中项量测。两份 CSS 修复影响的原生／历史标签已在最终部署重新验证，不把本轮所有记录都称作最终镜像记录。

结合当前路由树逐类核对已有实机证据：

| 页面与关键交互 | 已完成尺寸证据 |
|---|---|
| 市场、应用详情、项目列表与概览 | 第六十四、六十五、六十七批 |
| CLI、会话／数据菜单、预览、代码、差异、历史 | 第六十七批；本批补长标签和键盘显露 |
| 发布准备、版本详情、日志、上线确认与最终表单 | 第六十四、六十七批；本批补确认区 |
| 健康、告警、投递、调用链与字段错误 | 第六十四、六十五批；本批复验共享标签 |
| 成员、可见性、两组配置、开发资源、仓库、生命周期 | 第六十五批；第六十六批修复长内容密度，本批复验资源 |
| 管理总览、项目／用户、算力、两类套餐、能力、审批、出站、网关 | 第六十五批；第六十七批补管理接入项目内路径 |
| 数字人／APIProxy／EventProducer 创建、确认、放弃与开通 | 第六十五批与本批 |
| 登录、未知地址；旧路径的实际落地页 | 本批；第六十三批导航与后续目标页面尺寸 |

表格、只读 CLI 与代码内容已有真实滚动和键盘到达证据；长内容不会依靠整页横向滚动阅读。上述证据满足 plan 的关键动作可达、无整页横向溢出、长名称与中文错误不重叠，**UX-AT-25 已通过，累计 23／52，29 项待完成**。多角色、四窗密度、分屏完整交互与实际系统明暗分别仍属 UX-AT-22／35／37／26／51，保留其未完成状态。

### 门禁、部署与状态保留

两份 CSS 候选固定后，完整 `bun run check` **1177 pass／4 skip／0 fail**（1181 tests／197 files／6540 assertions，测试 108.17s，命令 127.24s），console build **489ms**。低影响样式修复使用真实前后尺寸与键盘验证，没有新增复述 CSS 字符串的测试；候选后续保持，纯证据文档不重复完整门禁。

仅更新 console 为 `cs-console:rfc003-b68-2048ebc047`，imageID=`sha256:abcb716bede8111af36491c6fec70e2647139fb157e35148ce1edc76f1d9cb69`。05:05:22Z 原 Deployment UID 保持、generation=40、1／1；Pod `console-6945595795-bg7ws`／UID `bc6a2123-c883-4507-8da5-299ee152f76d`、restartCount=0，实际 imageID 与七份文件一致。05:07:57Z HTTP 六份静态资源匹配。增量导入 3,721,394 bytes，没有清理数据或临时调零其他服务。

05:11:20Z 与 04:50:04Z 批前正常 API 比较，三个 QA 的 taskId／native／历史 Agent／activity／workspace 相同，仅排除 checkedAt；session 单独比较，只有 delivery.lastActivityAt 更新。个人布局内容完全恢复，正常 Home／End 导航使修订 10→12；原 tab 17 保持上一批已加载脚本，未重载、未夺取输入控制。实际截图仍见单 CLI 1937fa、工作区 1／网格、可输入、未读完成 1 和 `RFC003_SNAPSHOT_DRAFT 未发送草稿`。tab 22 返回 files 资源总览，语言 zh-CN、viewport.reset 后实际为 1100×908、整页宽 1100。

05:11:37Z 原任务 UID／容器状态／restartCount、四份原文件／Git 配置摘要、失败 Bound 工作卷和各 preview／正式槽均保持；API ebaa730／generation=32、controller cc93104／21 均 1／1。节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,760,190,464 bytes。

证据为 batch68 的 source-candidate、check／build、image-context／built／budget／import、deploy-before／console-rollout、http-assets、browser-final、project-list／release-preserved、qa-before／after／comparison、layout-before／after、final-runtime；CUA 记录保留逐项尺寸和截图。两份源码及三份文档精确提交，最终 SHA 托管 CI 单独核对。T12 继续；I9／I14／I15 与具体成员范围待答复，RFC-004 按批准顺序等待 RFC-003 完结，Hook 未开工。

## 第六十九批：文件差异状态、阅读位置与真实 Git 验收

本批完成 UX-AT-32，并修复真实验收遇到的三处界面问题：

- 列表原来直接显示 MM／MD，未跟踪行重复显示英文 untracked。现在用“暂存区：修改 · 工作区：修改／删除”解释两列 Git 状态，保留原始状态的 title；单项提交差异、重命名、冲突、未知状态和英文均有独立处理。
- 原生按钮的 nowrap 让长文件路径撑出 1356.40px 表格，宽屏也难以同时看到文件与状态。路径按钮现在在列内换行；最终 CSS 的中英文五尺寸实测表宽为 1074／818／726／348／336px（英文 320px 为 339.19px），前四尺寸与容器等宽，320px 使用原表格内滚动，整页均未溢出。
- 比较每 10 秒更新 comparisonId 时，详情以该 id 为 React key，正在看的页签和 Patch 被重置。现在按项目／任务／对比目标保留阅读位置，并对新快照清除旧分页游标、重新读取当前文件；文件已不在新差异中时仍可返回列表。换项目／任务／目标仍重置上下文。

状态回归先 10 pass／1 fail；刷新两条回归分别稳定复现页签退回首项，另补文件消失的返回路径。错误用例的 HTTP 信封按现有契约修正后，最终定向 **30 pass／0 fail／82 assertions**。八份最终源码／测试候选完整门禁 **1197 pass／4 skip／0 fail**（1201 tests／198 files／6578 assertions，测试 103.25s、命令 121.83s），console build **494ms**。此前两个候选分别通过后，实机发现路径排版和自动刷新问题，因候选改变才重跑；旧门禁和部署证据保留在 pre-path-wrap／pre-refresh 文件中。

### 专用 QA 的真实差异

使用 files 原任务 tsk_01a09ff07aeb7000897fd0eda1e16cd2 的正常 Runner exec 通道，以 uid 10001 操作。开始时 index 为空、HEAD 为 e4741df56b440d776b7c25ff5a4978b3d5822f46，只有两个原有 npm 缓存文件未跟踪。README 原文先在容器 /tmp 备份并记录 SHA256；只暂存本批标记，再追加未暂存标记，另建三个本批文本／二进制样例。未提交 QA 代码、未推送、未发布。

| 场景 | 实际界面证据 |
|---|---|
| 同一文件已暂存与未暂存修改 | README 的 739 字符 Patch 分为 Staged 与 Unstaged；各自增加不同标记，列表显示两种状态，净增三行 |
| 未跟踪文本 | 254 字符 Patch 从 /dev/null 新增一行，状态只显示“未跟踪” |
| 二进制 | 240 字符 Patch 显示 Binary files … differ，明确“二进制文件”，不提供文本编辑器入口 |
| 删除 | 校验本批工作区与 index 摘要后临时删除 README；状态为暂存修改／工作区删除，净减原文 75 行。4082 字符 Patch 包含独立暂存修改与工作区删除的 77 行，不提供不存在文件的编辑入口 |
| 大 Patch | 4096 行样例显示到 65536 字符、末行为第 1419 行的部分内容，同时明确“Patch 超过 64 KiB，仅展示前一部分”；不假称完整 |
| 自动更新 | 最终页面 05:58:35Z 至 05:59:27Z，检查时间由 13:58 更新到 13:59，仍选中未提交页签并保留同一 4082 字符删除 Patch |

同文件修改最初在 b68 和本批首个 console 验证；最终 index-Dk6dzdsp.js 再次核对删除、未跟踪、二进制、截断与刷新保持。十次路径尺寸量测来自本批第二个 console，其 CSS 与最终镜像相同。没有把载入中的空 Patch 算作成功或产品故障。

待验证 v0.1.8 的 Git 对象最初缺失，页面如实显示未知。通过“补齐历史并重算”正常补对象后，真实结果为工作树独有 0／缺少待验证 3 个提交、未提交文件 6、未推送提交 0；生产仍尚未部署。05:59:48Z 校验并恢复 README 原文、通过精确 git add -- README.md 清除本批暂存差异，只删除本批三个摘要匹配的样例。最终 index 为空、原始 porcelain 状态逐字一致，README SHA256 恢复为 0e54bf847caa7a68f24d50c63c112bf00edf3379c1cedba3e008793a98bbf209。容器 /tmp 原文备份保留。

06:00:24Z API 及随后真实页面确认未提交回到原有 2 项、未推送仍为 0，HEAD、部署 releaseId／SHA 和双向提交数 0／3 保持。补历史只新增比较所需 Git 对象与引用，没有 checkout／pull 或修改业务源码。未提交文件没有算进提交差距，未推送没有冒充未上线。

### 部署、保留与结论

最终仅更新 console 为 cs-console:rfc003-b69-eb9e06268c，generation=43／1／1，imageID=sha256:a5b3ae7f0a4eae00f6db8ce719c513d91cf07b8fab7b7e044134aaa420ea4f67。05:57:26Z 实际 Pod 七份文件、05:59:10Z 正常 HTTP 六份资源均匹配本批构建。每次导入新增 3,722,933 bytes，未清理数据或调零其他服务。

06:01:24Z 三个 QA 的 taskId、native、历史 Agent、活动和工作树与批前一致（仅 checkedAt 另计）。files 的 lastActivityAt／idleReminderSentAt 和 legacy 的 idleReminderSentAt 更新；原进程状态未改变。两份个人布局内容恢复，delivery 修订保持 12、files 正常导航 12→14。原 tab 17 未重载，中文未发送草稿、可输入、单 CLI、未读完成 1 保持；tab 22 返回 files 工作区，原草稿可见且未获取输入控制。语言和临时视口恢复。

06:01:57Z 原任务 UID／状态／四份受保护文件摘要、失败 Bound 工作卷及预览／正式槽保持；API ebaa730／32、controller cc93104／21 均 1／1。节点 Ready=True、无内存／磁盘压力，剩余 1,568,153,600 bytes。

另只读核对 UX-AT-27 的实际五个数字人摘要及 limit=20 范围。现有未知健康来自未部署槽，不能当作来源读取故障；该条仍待真实局部故障与恢复证据。**UX-AT-32 已通过，累计 24／52，28 项待完成**；I9／I14／I15 与具体成员范围待答复，RFC-004 继续按批准顺序等待 RFC-003 完结。

证据保存在 batch69 的 preflight、summaries-before、qa-before／after／comparison、layout-before／after、fixtures／deletion／restored、各 Runner intent／result、dirty-comparisons／dirty-history-ready／restored-comparison、status-red／refresh-red／refresh-targeted-final、source-candidate／check／build、三版镜像与部署记录、http-assets、browser-final 和 final-runtime。八份源码／测试及三份文档精确提交，最终 SHA 托管 CI 单独核对。

## 第七十批：管理接入全程与构建等待原因

本批完成 UX-AT-20，并修复管理员真实创建／首发流程中的两处误导。页面链路始终在 /admin 下，旧项目、授权和会话保持原状。

### 实际问题与修复

1. 创建确认原文让用户补齐配置后“重新开通”。[provisionProject.ts](../../../modules/provisioning/application/provisionProject.ts) 在开通步骤受理后设置 active；[platform/wiring.ts:284](../../../modules/platform/wiring.ts#L284) 的 ensureFirstRelease 只在尚无发布时首发。真实 06:26:48Z 发布受理后，项目已 active，随后发布才因缺配置失败。中英文现明确补齐生产配置后，使用新版本号重新发布。最终页面两种语言均核对，检查草稿已显式放弃，未创建 rfc003-copy-check。
2. 首次构建 Pod 为 Pending／PodScheduled=False／Unschedulable／Insufficient cpu，但日志返回 HTTP 200、items=[]，页面显示“尚无日志”。[clusterObserver.ts](../../../modules/observability/adapters/k8s/clusterObserver.ts) 现在保留真实调度 reason／message，返回 unavailable；原因尚未提供时明确等待原因，不推断资源不足或构建失败。已调度的 Pending、Running 仍正常读取日志，原始时间不伪造。实际同一构建在新 API 下 HTTP 503／页面 alert 给出 CPU 不足，恢复调度后正常显示 57／57 条构建日志。

回归先 **18 pass／3 fail／155 assertions**，最终定向 **21 pass／0 fail／164 assertions**。五份最终源码／测试候选的完整 `bun run check` **1200 pass／4 skip／0 fail**（1204 tests／198 files／6585 assertions，测试 110.19s、命令 129.94s），06:34:57Z 完成；console build **670ms**。候选随后未改变，纯证据文档复用该门禁。

### 专用接入项目的真实旅程

| 阶段 | 对象与结果 |
|---|---|
| 创建 | 06:26:46Z 管理页创建 APIProxy“RFC-003 管理接入验收”，slug rfc003-verify-integration，project prj_01a0a3bf1d2c700090f54cd03306dd6d，service svc_01a0a3bf1d2c700197334a7c63e347dc；负责人仍为已有 admin |
| 开通与首发 | GitLab 项目 147／crewstation/rfc003-verify-integration；main 初始 1bde5640d46469d557f69d88a507d2647734c426，v0.1.0 为 rel_01a0a3bf27af70008353e545958b1951。开通完成，构建从等待 CPU 恢复成功，发布明确因缺 GITLAB_TOKEN 失败 |
| 开发 | 从管理页开 main 会话 tsk_01a0a3cd169b7000b830f632b20cf694，实际代码编辑器保存 crewstation.yaml；正常 Runner 通道补齐唯一代理名、说明和回归。未启动原生 Agent CLI |
| 配置 | 实际设置页保存生产 GITLAB_BASE_URL=http://127.0.0.1:9 与空字符串 GITLAB_TOKEN，版本 1→2；密钥值不回显，没有注入真实上游凭据 |
| 源码验证 | 现有模板未带测试文件；正常安装锁定依赖后，新增的身份／健康、未配置上游和 Manifest 一致性回归 **3 pass／0 fail／9 assertions**，没有请求真实上游 |
| 提交 | GitLab 原 main 仍受保护，已有管理员正常 Commits API 精确提交六份 QA 源码为 018627a17889e219ae34ae7753bb8170796c3f2c，父提交为初始 SHA；没有改保护规则。平台正常“补齐历史”取得对象后，核对本地六份内容一致并在 main 快进；index／工作树均为空 |
| 发布 | 管理页选择当前开发会话，预检确认上述完整 SHA／main／未提交 0；07:07:16Z 一次提交 v0.1.1，受理 rel_01a0a3e433b47000a9ea3d814323e9b5。正常发布将已知远端同步为当前提交，未推送也为 0 |
| 就绪与返回 | 07:10:03Z v0.1.1 ready，生产配置第 2 版、待验证 green 槽 1／1；07:11:36Z 已登录的正常预览 HTTP 200 返回 rfc003-integration-qa 身份，环境 production／slot green。07:12:09Z 返回管理接入列表，可见新项目已开通；正式槽仍未部署、没有切流记录 |

六份 QA 提交路径为 .gitignore、README.md、crewstation.yaml、openapi.yaml、src/proxy/catalog.ts、src/integrationQa.test.ts，实际摘要在 integration-commit.json。它是本机 GitLab 验收仓库提交，与 CrewStation 主仓源码提交分开。一次新建分支命令被自动审批按 main-only 规则拒绝且未执行；后续仅在现有 main 上完成，未改历史。TaskRunner 没有拿到管理员 token。

### 资源调整与验收边界

节点原 CPU requests 已用 9800m／10000m。正常管理 API 新增独立 rfc003-integration-qa 服务套餐（100m／512Mi／最多 1 副本）和同名任务套餐（100m／2Gi／2Gi）；Manifest 实际使用服务套餐。当前开会话入口只选分支，仍使用平台默认任务资源，新增任务套餐没有被选用，不能称其已生效。

通过 Kubernetes 已提供的 pods/resize，只调整本批新建且尚未调度的 v0.1.0、v0.1.1 构建 Pod 和新开发 Pod CPU 1→100m，分别校验 UID、resourceVersion、原资源和 Pending／无节点；内存与存储未改。开发 Pod 的 checkout init 仍为 200m。发布受理后，真实释放确认显示 main@018627a／未提交 0／未推送 0／已启动 0，没有草稿或未保存编辑；正常“确认释放”结束该新会话，平台删除其临时容器与工作卷。腾出资源后第二个构建成功，最终服务采用 100m 套餐。没有缩容旧工作负载或清理旧卷。

APIProxy 开发预览自身 HTTP 200 返回 JSON；本机嵌入浏览器却为空／about:blank，尚未定位。最终预览响应无 Content-Disposition、CSP 或 X-Frame-Options，不能直接归因于这些头；没有把 HTTP 成功当作可视预览成功。当前已释放专用会话，源码完整在 GitLab，后续可正常重开继续诊断。此条不替代 UX-AT-15 的真实上游调用，也不关闭 UX-AT-44 的其余角色入口。

### 本机部署、保留与结论

API 镜像 cs-control-plane:rfc003-b70-6d1ae2d769 基于此前 ebaa730，仅覆盖 clusterObserver.ts；imageID=sha256:f787b8cfc4de1d89a43e1838d1bc00f9047e5eb9d29ebf1ffe2fecaf0c1c5650，generation=33，实际 Pod cs-api-c866b558b-l8hk7／UID 32fda0e7-67aa-47e4-8b02-469b2c3775ff。06:38:17Z 文件摘要与候选匹配。

Console 镜像 cs-console:rfc003-b70-6d6f89a540，imageID=sha256:700d2ddc2755863ac4a7fa9762e898f101dff224772642b531b4a5e158f34290，generation=44，Pod console-666d5d49c4-dfsg4／UID 580f8c5d-d9d8-47e9-aa5e-ab2ba0770331。06:38:18Z 七份文件、07:00:24Z HTTP 六份产物一致，实际页面 index-o1ul1hnN.js。增量导入 API 38,952 bytes／console 3,723,445 bytes；两者均 1／1、restartCount=0，controller cc93104／generation=21 保持。

07:13:42Z 相对上一批最终快照，三个旧 QA 的 taskId、native、历史 Agent、activity 和 workspace 保持，仅查询时间另计；delivery 的空闲提醒与 files 的活跃时间更新。两份个人布局内容和 revision 12／14 保持。原 tab 17 没有重载，截图仍有中文 RFC003_SNAPSHOT_DRAFT 未发送草稿、可输入、CLI 1937fa、工作区 1／网格／未读完成 1；xterm 草稿在截图可见，DOM 摘要不包含该正文。语言恢复中文，未设置新视口覆盖。

07:14:16Z 原任务 UID／状态／四份受保护文件摘要、失败 Bound 工作卷及旧预览／正式槽保持。新服务 Deployment rfc003-verify-integration-green／UID e6fb6e64-6649-4d2f-9659-c67080fde079／generation=1／1／1，旧服务未动。节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,480,384,512 bytes。

**UX-AT-20 已通过，累计 25／52，27 项待完成**。RFC-003 保持 In Progress；I9／I14／I15、具体成员范围和其余旅程继续，RFC-004 按批准顺序等待 RFC-003 完结，Hook 未开工。

证据位于 /private/tmp/crewstation-rfc003-batch70-*：runtime-before、capacity、created、build-log-before／fixed、两个 build-resize、dev-created／resized、profiles-created、Runner intent／result、integration-source／commit／history／main-sync／ready、source-candidate／targeted-red／check、API／console image-built／import／rollout、http-assets、browser-final、final-projects、qa-after／comparison、layout-after、final-runtime。五份源码／测试与三份文档精确提交，最终 SHA 托管 CI 独立核对。

## 第七十一批：禁止回退原因与拒绝后恢复

本批继续 UX-AT-11，完成专用管理接入的实际策略拒绝和非维护窗口发布失败，并修复误报原因。没有将声明破坏性迁移等同于实际执行迁移，也未将自动回归等同于完整浏览器旅程。

### 原因修复与回归

[migrationPolicy.ts](../../../modules/release/domain/migrationPolicy.ts) 的 rollbackBlockedBy 同时接受 destructive=true 和 rollback=blocked；[switchTraffic.ts](../../../modules/release/application/switchTraffic.ts) 却把两种拒绝都写成“含破坏性迁移”。现在仅修改原因选择：真实声明破坏性迁移时保留原提示，单独禁止回退时提示“的发布配置明确禁止回退”。目标版本、权限、迁移判定、事务及切流规则保持。

[trafficConfirmation.test.ts](../../../modules/release/tests/trafficConfirmation.test.ts) 新增四条隔离 PostgreSQL 回归：单独 blocked 原因准确、破坏性迁移原原因保持、兼容版本正常回退、blocked 不妨碍上线较新版本；逐项核对槽位、切流记录及 domain_events，拒绝不产生写入。稳定复现为 **5 pass／1 fail／32 assertions**；修复后连同既有 console 发布确认回归 **16 pass／0 fail／138 assertions**。

最终两份源码／测试候选的完整 `bun run check` **1204 pass／4 skip／0 fail**（1208 tests／198 files／6601 assertions，测试 154.76s、命令 177.59s），07:36:38Z 完成，源码之后保持。没有 console 源码变更；此次未重建或滚动 console，最终托管 CI 仍执行其构建。

### 专用发布与实际拒绝

使用第七十批的 APIProxy 项目 prj_01a0a3bf1d2c700090f54cd03306dd6d、服务 svc_01a0a3bf1d2c700197334a7c63e347dc、GitLab 项目 147／crewstation/rfc003-verify-integration。没有新建开发会话或 CLI。

| 版本／阶段 | 实际结果 |
|---|---|
| v0.1.1 基线 | 浏览器确认完整 SHA 018627a17889e219ae34ae7753bb8170796c3f2c 后首次上线，release rel_01a0a3e433b47000a9ea3d814323e9b5；正式 green／1／1，第一条切流记录指向该版本 |
| v0.1.2 声明 | 已有管理员通过正常 GitLab Commits API 仅提交 crewstation.yaml，SHA a01e2856a7f61254a5e33b31e128c766e5b4f745、父 018627a；仅改 migration 为 destructive／true／blocked，没有 migrationCommand。真实 Schema 校验通过，原 main 保护不变 |
| v0.1.2 拒绝 | 浏览器确认并发布 rel_01a0a40378447000b9dec06cf85ba651。构建完成后 07:42:22Z failed，“破坏性迁移只能在维护窗口内发布”。07:43:41Z 只有 build-c06cf85ba651，无迁移 Job；正式仍 v0.1.1，首页 HTTP 200／green |
| v0.1.3 策略 | 正常 Commits API 再仅改 migration 为 none／false／blocked，SHA 201fe8ef5cf05b707cb361a68f878b39090e8419、父 a01e285；仍无 migrationCommand。浏览器发布 rel_01a0a40714ec70009b52939fcf68cc4a，就绪后确认完整 SHA 并上线；采用生产配置第 2 版 |
| 旧 API 回退 | 07:53:33Z 浏览器确认 v0.1.3→v0.1.1，保留说明 RFC003_ROLLBACK_REASON_KEEP 禁止回退原因验收；点击一次后实际误报“含破坏性迁移”。说明仍在、确认按钮消失，页面给出重查及发布修复版本的恢复动作 |
| 新 API 回退 | 部署后 07:55:06Z 显式重新核对两个版本，原说明无需重填；点击一次后准确显示“当前版本 v0.1.3 的发布配置明确禁止回退，不能切回旧版本 v0.1.1”。说明仍保留、旧确认清除，最终截图可读 |

07:54:21Z 与 07:55:50Z 正常 API 分别核对两次已明确拒绝后的记录：发布、两槽及全部切流记录与 07:48:18Z 基线完全相同，始终仅两次正常上线，没有失败回退记录。最终正式为 v0.1.3／201fe8e／blue，待命为 v0.1.1／018627a／green，均 1／1；两个正常用户域首页均 HTTP 200，返回唯一 QA 代理身份及对应物理槽。没有请求真实上游。

07:40:28Z 只读核实运行中 controller 的 maintenanceWindow=false。该设置影响全平台，本批保持原值；v0.1.2 的声明没有产生实际破坏性命令。UX-AT-11 仍缺“含破坏性迁移的已上线版本在浏览器拒绝回退”分支，当前数据库回归及非维护窗口拒绝均单独记证，不提前关闭该项。

### 本机资源、部署与保留

专用 rfc003-integration-qa 服务套餐 CPU 100m→50m，memory=512Mi、maxReplicas=1 与说明保持，正常管理 API 验证其余套餐不变。验收 green Deployment UID e6fb6e64-6649-4d2f-9659-c67080fde079／generation 1→2，仅将 CPU 调到同一值；新 blue UID 6c7bb05b-092a-4f05-9363-60e0e8bf2a00／generation=1 自动采用 50m 套餐。两个槽合计 100m，旧业务资源未调整。前批新增的同名任务套餐仍未被选用。

两次新建 Pending 构建 Pod 分别为 build-c06cf85ba651-hm576／UID 4ef8914e-b92b-4338-826d-9a606daff78c，以及 build-939fcf68cc4a-jcqz8／UID 6665c1ff-eb06-457a-b711-1c58f263dcd1。只在各自未调度且资源／UID／resourceVersion 核对后，通过 pods/resize 把 CPU 1→100m；内存保持 2Gi，随后两个构建均完成。

API 镜像 cs-control-plane:rfc003-b71-72bbbd23ce 基于第七十批，只覆盖 /app/modules/release/application/switchTraffic.ts；imageID=sha256:4457520013c9c4920ae5ba6e733f0976cc6b41773e0448c9ba874cf975de936e，新增导入 38,308 bytes。07:54:37Z cs-api generation 33→34／1／1，Pod cs-api-8564bcc6d8-vp97w／UID b166df60-86a2-4b34-b4e2-1b32d11ce849／restartCount=0，实际镜像和文件 SHA-256 72bbbd23ceaaacf19f2e5d983217f50335282be9eebd85666abdcd31de57e840 与候选一致。部署资源及策略保持。

Console 第七十批／generation=44、controller cc93104／21 均保持 1／1。07:55:51Z 三个旧 QA 的 taskId、session、native、历史 Agent、activity 与 workspace 和前批相同（checkedAt 另计）；07:56:21Z 原任务 UID／状态、四份受保护文件摘要、失败 Bound 工作卷及旧业务发布槽保持。节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,464,143,872 bytes。原 tab 17 未重载，截图确认 CLI 1937fa、可输入、未读完成 1 与 RFC003_SNAPSHOT_DRAFT 未发送草稿保持；原有验收页签已保留，本批未调整个人布局、语言或视口。

**累计仍 25／52 通过、27 项待完成**。RFC-003 保持 In Progress；I9／I14／I15、具体成员范围及其余旅程继续。RFC-004 按批准顺序等待 RFC-003 完结，Hook 未开工。

证据在 /private/tmp/crewstation-rfc003-batch71-*：rollback-red／targeted／source-candidate／check、maintenance-before、qa-plan／qa-green-resources、两个 Manifest／commit 与 build-resize、v012-rejected、v013-before、rollback-before／old-rejected／fixed-rejected、API image-built／import／rollout、browser-final、qa-after／comparison、final-runtime。两份源码／测试与三份文档按精确路径提交，最终 SHA 托管 CI 独立核对。

## 第七十二批：真实 Git 分叉样例与待授权切流

本批继续 UX-AT-30 的完整版本关系验收，准备了可由现有页面读取的真实 Git 分叉，主仓没有生产源码或测试变更。初始 fetch 确认 main 与 origin/main 同为 63e5031028f6dfd085b7dd1745fddf58f8a239f5，工作树与暂存区为空；上一批该 SHA 的 CI 34944744674 已成功。

### 当前基线与被拒操作

files 项目 prj_01a09fecbba97000843701962d998a7a，实际 serviceId 从 release 读取为 svc_01a09fecbbac7000905703a66e255046。此前一次使用接力摘要中的错误 serviceId 得到 404，未发生写入；后续均使用实际返回的 ID。开发任务仍为 tsk_01a09ff07aeb7000897fd0eda1e16cd2，现有 codex/rfc003-files 分支 HEAD=e4741df56b440d776b7c25ff5a4978b3d5822f46。

待验证 v0.1.8 为 rel_01a0a27cc00e700090b5d576e6078408／5719c033e3ac781eb6e3efcdf1c8e6da02018f34／配置第 2 版／1／1；正式槽为空，切流记录为空。真实 Git rev-list 为 0／3，两个提交的文件树相同，三条目标独有提交是此前迁移日志故障及恢复样例。08:12:52Z 实际开发差异页明确“尚无生产版本”，未提交 2、未推送 0，没有拿远端分支冒充当前 HEAD。

08:13:25Z 在另一已有发布页签完成“尚未部署→v0.1.8”核对，完整 SHA 与说明可见，拟用于建立生产比较基准。点击“确认上线”被自动审批拒绝：认为上库与更新本机服务授权没有明确包含这一次生产切流。已通过待回答问题向作者说明具体项目、版本、SHA 与用途，未改用 API 或其他方式执行。随后一次只读 getAXState 又被拒，原因是审批服务 `Selected model is at capacity`；它不是页面报错，也不是已完成点击的证据。没有再次访问被拒页面；仅保存此前取得的记录和页签接力标记。

### 真实分叉准备及接口证据

正常 Runner 通道先校验固定 HEAD、现有分支、空 index 和 README 原摘要 0e54bf847caa7a68f24d50c63c112bf00edf3379c1cedba3e008793a98bbf209。仅在文件尾追加四行“RFC-003 工作树分叉验收”说明，原字节前缀保持，index 未变。08:18:38Z 正常 version-comparison?target=preview 返回 HEAD 不变、behind／0／3、未提交 3、未推送 0，证明未提交文件没有进入提交差。

随后精确暂存 README.md。第一次 commit 明确因 `Author identity unknown` 失败，没有生成提交；该普通 exec 没有 Agent 启动计划中的 Git 身份，不据此认定原生 Agent 提交失败。复核唯一暂存路径与 4／0 行差异后，只为本次命令使用已登录的 admin／admin@demo.invalid 作者，不改全局或仓库配置，正常提交成功：

- QA 提交 f04fd60af6f387cbd904be70fcace50fcfbb0622，父 e4741df56b440d776b7c25ff5a4978b3d5822f46；只含 README.md，带真实 Codex co-author；现有分支未变，index 为空。
- README 新摘要 50eff46078d21d75a4c2ced98c7e2b82a99e63e26d8287bbfb940c9a0b68727e，原内容前缀完整保留；应用代码与 Manifest 未改。
- 实际 Git 为 1／3；08:21:32Z 正常比较 API 为 diverged／ahead=1／behind=3，未推送 1，未提交恢复为原有两项 npm 缓存。
- 正常 ahead 详情只有 f04fd60；behind 详情精确为 5719c033、5e96d930dc7c5b79e7c0d56396e9e67c9259ac9f、23c909ffe3b68270243c7991667200f4683c1d8f，数量和实际 Git 一致。
- slots 和 traffic-switches 再次确认正式仍为空、待验证仍 v0.1.8、切流记录仍空。此 QA 提交尚未合并或推送，保留分叉以待真实页面验证；不要用覆盖工作树或改写历史将其消除。

以上来自真实工作树、运行中的 Runner 和普通平台接口；浏览器分叉画面未取得，生产目标关系、浅历史／无共同历史等分支也未关闭。**UX-AT-30 保持待验，累计仍 25／52 通过、27 项待完成。**

### 保留与接续

08:23:33Z 三个旧 QA 的 taskId、native、历史 Agent、activity 保持；delivery／legacy 工作树保持，files 只增加本批文档提交和未推送数，原两项缓存完全相同。files.lastActivityAt 与 legacy.idleReminderSentAt 按正常活动更新。08:25:32Z files 个人布局仅 view 从 cli 改为 changes、revision 14→15，原页签、窗口顺序、比例及 terminalId 保持；这是此前正常点击差异视图的结果，当前保留以便接续。原 tab 17 未操作、未重载；本批没有再次读取其截图，不把前批草稿截图标成本批新验收。

08:24:12Z 原任务 UID／状态、其余受保护文件、失败 Bound 工作卷和所有业务槽位保持，README 按上述新摘要核对。API 第七十一批／34、console 第七十批／44、controller cc93104／21 均 1／1，节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,431,932,928 bytes。本批未部署镜像、启动模型或调整资源。

主仓仅精确提交 STATE.md、本文件和 acceptance-audit.md。源码与已验证的 63e5031 相同，复用第七十一批完整门禁 1204 pass／4 skip／0 fail，不为纯证据文档重复全量；最终文档 SHA 的托管 CI 单独核对。RFC-003 保持 In Progress，RFC-004 继续排队。

证据在 /private/tmp/crewstation-rfc003-batch72-*：comparisons-before、files-before、git-before、readme-fixture、dirty-comparison、divergence-commit（失败）／divergence-commit-with-identity（成功）、diverged-comparison、browser-before／approval-blockers、layout、qa-after／comparison、final-runtime。恢复后先核对作者对具体切流的答复与浏览器可用性，再重读真实确认对象和当前分叉；不得把未执行的切流或旧的浏览器记录计为已通过。

## 第七十三批：动态历史翻页与关闭后的恢复

本批检查 UX-AT-42 周边的读取恢复，主仓从 db30123e296b9d103d85d9bee0bca5a7a25678d6 开始，main 与 origin/main 同步、初始工作树和暂存区为空。没有重试此前被拒的正式切流或浏览器页面读取，继续完成可独立验证的前端修复。

### 复现与修复

Agent 动态的“更早未读”请求在途时关闭面板，resetOlder 原来只清历史数据，没有清等待状态或使请求失效。迟到响应会重新装回旧页，再次打开直接显示历史；原请求未结束时还会锁住重新翻页。后台同时读取最新与历史页时，已离开的旧页失败也会覆盖最新页的成功结果，使其显示过期。

新增真实 React 菜单／正常客户端 HTTP 回归与两条状态存储回归，修复前 **9 pass／3 fail**。仅修改 shared/activity/agentActivityStore.ts：独立记录历史请求归属，关闭、移除任务和退出清除；响应仅更新仍选中的历史读取，关闭立即解除旧页等待，旧历史错误不污染最新页。另补同一游标重新打开时，旧轮询不能覆盖这次读取的回归。实际通知去重、原生进程状态、个人已读协议和身份切换沿用原实现。

最终三个文件候选的定向检查 **16 pass／0 fail／60 assertions**，完整 `bun run check` **1208 pass／4 skip／0 fail**（1212 tests／198 files／6608 assertions，测试 110.28s、命令 130.05s），08:49:58Z 完成；console build **592ms**。最初门禁尚未启动就被 sandbox 拒绝 ps 读取，在获准的正常权限下执行完整检查；没有重复完整门禁。最终候选摘要此后保持。

### 本机更新与证据边界

基于已有 b63 console 镜像，以 --pull=false／--network=none 构建 cs-console:rfc003-b73-b908c094f7，未重新安装依赖。Docker 配置摘要为 sha256:d9e619841ada3bcd32e80fa1d8c2479f62cbddc14b2b5df5db32fba36c471d43，流式导入只新增 **3,723,444 bytes**，save／import 均退出 0，没有 tar 落盘或数据清理。

仅一次 JSON Patch 更新 console，Deployment 原 UID c4874a0e-6415-4c2b-b141-74ac25ea10ed 保持、generation 44→45，1／1；Pod console-868b9469c8-5wx2r／UID f81417fe-7a19-4fd8-be92-e922482f6f97，restartCount=0。首次部署后断言把 containerd 的索引摘要与 Docker 配置摘要直接比较而失败，rollout 当时已经完成，没有重新补丁或回滚。08:53:10Z 只读确认运行索引 sha256:24b787c3035153a92a42596fd4785d3bf31e3e24e83b8918d7cb2063f36dcda6 包含清单 sha256:0bbfd127cb0eae65d3b845eeb7841ab7cf7fcb1576a47ea7eb239213ce9e331e，清单引用上述配置；七份实际运行文件摘要全部匹配。资源和策略保持。

普通匿名 HTTP 读取静态产物返回 401，正常使用既有 admin 演示登录后，08:55:05Z 六份静态产物摘要／大小全部匹配，入口 index-C60BdeDC.js。这是部署产物检查，不是浏览器交互验证。既有页签 6／16／17／18／19／20／21／22 只重设接力标记，没有读取页面、刷新、输入或更改布局；原 tab 17 草稿未操作，没有把前批截图当作本批证据。

08:53:45Z delivery／files／legacy 的 taskId、session、native、历史 Agent、activity 与 workspace 均和第七十二批相同（checkedAt 另计）；files 的 f04fd60 分叉样例保留。08:54:23Z 原任务 UID／状态、受保护文件摘要、失败 Bound 工作卷及业务槽位保持；API 第七十一批／34、controller cc93104／21 均 1／1，节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,657,032,704 bytes。

**累计仍 25／52 通过、27 项待完成**；本批不替代 UX-AT-42 的实机乱序／通道恢复条件。具体切流答复、此前浏览器审批阻断、I9／I14／I15 与具体成员范围均待处理；RFC-003 保持 In Progress，RFC-004 按已批准顺序等待完结，Hook 未开工。三份源码／测试与 STATE.md、本文件、acceptance-audit.md 精确提交，最终 SHA 托管 CI 独立核对。

证据在 /private/tmp/crewstation-rfc003-batch73-*：activity-red／activity-green、source-candidate／check、console-build、image-context／built／budget／import、console-before／rollout-intent／rollout、http-assets、runtime-before／final-runtime、qa-after／comparison。该批为已复现缺陷的修复和部署进展，连续无进展阻塞计数清零；完整 RFC 目标仍在执行。

## 第七十四批：真实角色、可见性冲突与测试者试用入口

主仓基线为 2f61a64f38ce62b52dd19162215ebfca0234e31f。作者在既有具体切流、角色和 I9／I14／I15 方案后明确“授权你所有动作，赶紧做”；原审批阻断解除，已执行以下真实动作，不能继续把这些项目写为待授权。

### 正式版本与成员、市场旅程

- files QA svc_01a09fecbbac7000905703a66e255046：在实际发布页重读并确认 rel_01a0a27cc00e700090b5d576e6078408／v0.1.8／5719c033e3ac781eb6e3efcdf1c8e6da02018f34 上线。正式 v0.1.8、preview 空，切流记录 1 条。tab 22 原比较页面自动更新到 **分叉 1／3、未提交 2、未推送 1、未设置上游**，当前 f04fd60 工作树及原两项缓存保持；实际正式应用显示“RFC003 预览恢复验收”、green／production 与第 62 批配置值。
- workbench QA prj_01a09eb302d67000a680835da140f993：管理员将负责人转给既有 rfc003-owner，admin 成为项目 developer，平台管理员身份保持。owner 在独立 Chrome 隐身窗口精确邮箱匹配并添加 rfc003-developer 为 developer、rfc003-tester 为 tester。二者实际登录并进入各自可用区域，developer 可准备发布但不能切流；tester 实际打开 preview.rfc003-verify-workbench.cs.localhost，页面身份、blue／production 与 v0.1.1 槽一致。
- owner 在默认 revision=0／项目成员下，空指定名单得到字段错误和焦点；选 visitor 后取消，确认放弃，保存结果不变。owner 保存全部登录用户为 revision=1；admin 旧 revision=0 的指定 visitor 草稿提交冲突，草稿保留且显示最新范围，使用“最新修订，保留本地草稿”后再提交成为 revision=2。visitor 实际市场可见且无进入项目入口。admin 恢复项目成员为 revision=3，visitor 旧详情“重新检查”清除旧材料并显示不可见，返回市场为空。

本批关闭 UX-AT-17 的实际负责人添加注册成员及成员访问条件；精确查找无匹配／目录故障／高级 ID 等回归沿用 E8。**累计 26／52 通过、26 项待完成**。没有把一次真实试用等同于 UX-AT-09 的全部发布阶段，也未把 admin 与 owner 的共同操作说成 owner 独立保存三种范围。

### 本次实际缺陷与修复

开发者生产配置页面一面写“负责人维护”，一面仍给编辑、保存、填入和删除入口。ConfigEnvPanel 现在用当前 /me 与环境分组裁定编辑状态，生产组仅 owner／admin 可写，开发者保留开发组；身份读取失败禁写并保留草稿。只读表格去掉动作列；服务端在途拒绝继续显示。配置新回归先 7 pass／2 fail，再 9 pass／0 fail；此前 Bun 打印失败 DOM 对象的 SIGTRAP 用布尔断言避免，未作为产品通过证据。

测试者原列表全部为受限，点击名称又得到“角色 tester 不能执行 view”，虽然直接预览域已有权限。release L4 新增内部 getPreviewSlot 查询，只按既有 view-preview 授权取实际待验证物理槽；capabilities L6 聚合 tester 专用 preview，内部开发／正式槽／发布记录仍 restricted。返回前重读成员与服务身份，权限撤销或对象变化清除旧结果；无部署、无效 SHA、错误槽与依赖失败均单独测试。隔离真实 PostgreSQL 的 previewQuery 用例 1 pass／20 assertions，验证正式切换后目标正确、撤销后拒绝。

控制台按角色提供试用页面和导航，旧开发、设置、发布深链接均给“测试者”说明、准确版本及完整 SHA；未就绪、读取失败和空槽无旧链接。曾打开的内部页面在同一路径暂时失权时隐藏而保留草稿；新路径重新核对，首次测试者不挂载内部工具。原 Swagger 角色恢复草稿回归继续通过，初始 tester 的旧测试夹具改为与真实基线一致的试用摘要，并断言没有内部目录或发布请求。

第一候选完整门禁为 1209 pass／4 skip／5 fail，定位到上述五条旧 tester 夹具与切换行为；随后候选的 lint 阶段指出 effect 内同步 setState，改为有条件记录首次打开，未放宽 lint。最终角色定向 48 pass／498 assertions，路径保留调整后定向 28 pass／267 assertions；最终完整 **1214 pass／4 skip／0 fail**（1218 tests／200 files／6690 assertions，测试 108.37s、命令 126.95s），09:58:37Z 通过，console build 609ms。最终 37 份源码／测试候选此后保持；先前失败候选、日志与镜像元数据均保留在临时证据中。

10:01:03Z 通过正常 /auth/login 分别读取既有 owner／developer／tester／visitor：前两者各自角色摘要 200；tester 专用 preview=rel_01a09f181c8d7000b2f2654113a1e737／v0.1.1／6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29／1 就绪，五项内部来源全部 restricted；visitor 项目摘要 404。没有借用平台管理员身份作角色结论，也没有记录会话 Cookie。

### 部署与后续

仅更新本机 cs-api 和 console。API 镜像 cs-control-plane:rfc003-b74-b5ff869b64，Docker 配置摘要 3448a3702dc4b67c110931fef9c984e97c83d62e491043e64b661495f118f1ff，generation 34→35；10:00:09Z 运行索引→清单→配置及七份实际文件均匹配，Pod UID c99d1510-9622-439d-8d2b-3f8de5c8958c，restartCount=0。API 导入新增 105,419 bytes；控制台导入新增 3,728,053 bytes，无数据清理。

控制台镜像 cs-console:rfc003-b74-29e0eb1c5b，generation 45→46／1／1，Pod UID 2c61702f-7a7f-4c5e-bc89-800c71f94759，restartCount=0。10:03:17Z 摘要链与七份文件一致；10:03:36Z 正常 HTTP 六份产物匹配。实际 IAB tab 24 刷新后管理设置可用，仍为 revision=3／项目成员，未修改草稿或旧终端。

10:03:38Z delivery／files／legacy 的 taskId、native、activity、历史 Agent 和 workspace 与第七十三批逐项一致；只变化空闲提醒时间或 files 活动时间。10:04:55Z 原 Pod UID／状态、受保护文件 hash、失败 Bound 卷、原业务槽和 integration 两槽均保持，controller cc93104／21 未变；节点 Ready=True、无内存或磁盘压力，剩余 1,573,146,624 bytes。这里的业务槽保持指实际 Deployment；files 逻辑正式切流已在前文单独登记。

本批后段 Mac 锁屏，已请求手动解锁，真实 Chrome 多账号新界面复验尚未完成；IAB 管理页面仍可读，未操作旧终端输入。此前 reviewer 容量和权限拒绝不再是当前 blocker。I9／I14／I15 按作者委托分别选择 (a)：管理员现有白名单扩展到代理出站、固定原任务／工作卷重建、独立 CLI Pod 共享工作卷；选择已写入 implementation-open-questions.md，尚未实施，不把扩大单容器内存当作隔离。

RFC-003 保持 In Progress，RFC-004 仍等待其完结，Hook 未开工。原失败 PVC 不释放，原 QA f04fd60 分叉提交不推送／合并。后续优先实现这三项实际能力，再补余下角色、发布、事件和多窗口旅程。

证据：/private/tmp/crewstation-rfc003-batch74-evidence.json、live-roles.json、config-red-readable／targeted3／role-targeted／role-final、initial-check／lint-candidate-check／check、source-candidate、console-build、api-image-*／image-* 与各 rollout 记录。浏览器事实与正常 HTTP、隔离测试、最终 Git SHA CI 分开登记。

## 第七十五批：保留原工作树恢复开发环境

本批实现 I14 已选方案 (a)：失败开发会话先检查原任务、Pod、Bound 工作卷及管理员任务套餐，再显式受理恢复。原 taskId、工作卷、分支、个人布局和历史 Agent 身份保持；旧 CLI 不自动重跑。原“从远端另建工作树”作为次要入口保留。恢复契约见 [workspace-recovery.md](workspace-recovery.md)。

task-runtime 持久化恢复记录和队列，项目行锁串行化准入／释放；相同 requestId 重放同一结果，确认对象或套餐变化须重新检查。新容器采用独立名称和新 Runner 凭据，不运行 checkout；Kubernetes 创建回执丢失后核对原实例接续，失败只补偿本次 Pod／Secret，保留工作卷、释放一次额度。旧 Runner 迟到握手不能污染当前连接；预览沿用原路由。新容器 5 分钟未连接时明确失败，不把受理或 Pod 创建当作就绪。

### 真实恢复与发现的缺陷

原任务 tsk_01a09eb4f03f7000ba011a517772cc09 的失败 Pod 曾为 OOMKilled／137。11:12:09Z 第一次恢复选择 coding-medium（1 CPU／2Gi），实际因节点 CPU 请求已占 9900m／10000m 无法调度。请求 91370dee-17be-4977-9bc0-056f907f28f1 在 11:17:23Z 超时补偿完成；新 Pod／Secret 清理，原 PVC UID 31042273-699a-4888-912b-06d9babadc72、10Gi／Bound 保持。这同时暴露了两处问题：创建即声称“已挂载”；已确认失败后页面仍锁在“未知回执／重试同一请求”。回归先 8 pass／2 fail，修复后定向 15 pass／0 fail；现显示等待调度，超时包含调度或镜像等待原因，确定失败可重新检查并换套餐。

11:21:07Z 正常界面重新检查后选择已有 rfc003-integration-qa（100m CPU／2Gi／2Gi 临时存储），请求 7939bf9d-209e-4f8a-8109-990e782a35f8 在 11:21:12Z 就绪。新 Pod task-01a09eb4f03f-r-7939bf9d209e／UID 7ee4b0ff-7bc3-448e-9471-7afa7b143bfc，Runner 93ed42e7-beec-479c-b52b-01a2f0a03db2。原工作卷 UID／10Gi、HEAD 1aa2db9f9578edfce15dbf314f74302ac523de83 以及七份源码／Git 元数据摘要全部匹配；无 init checkout。未推送提交 1 和原 .claude.json 保留，未读取该文件内容。

原六条 CLI 历史全部保留，四个被 OOM 中断的进程变为 ended／runner-restarted，两个原已退出的记录仍为 exited；恢复本身没有启动新 CLI，个人布局 revision=71 保持。实机明确提示原进程不可恢复。随后手动新建“工作区 3”，逐次按钮仅启动一个 OpenCode：agt_01a0a4cfd4867000b5be42e2d2a7130d／pty_01a0a4cfd4867001ae87c98b24d83bd6。Big Pickle 真实回复 RFC003_RECOVERY_OK_0915；独立预览显示原“RFC003 Agent 发布验收”应用和 development 环境；工作树对生产 v0.1.0／6af30245 的领先 1、未推送 1 正常显示。

新 CLI 的状态源实际报告 unsupported-version，页面如实显示轮次未确认，不能把该次模型回复计作完成通知通过。运行日志的版本探测到原生启动相隔约 5.15 秒，源码探针固定 5 秒、未知版本也映射 unsupported-version；尚需区分探测失败和实际版本不支持。低 CPU 下工作树读取也曾在检查期间变化／超时，未伪报一致。该问题继续随 I15／UX-AT-42 处理，不影响原卷恢复结论。

### 门禁、部署和边界

第一候选完整门禁 1238 pass／4 skip／0 fail 后进行了真实恢复；发现上述两个产品问题才修改并重验。实机修复的 69 份源码／测试候选完整门禁 **1240 pass／4 skip／0 fail**（1244 tests／208 files／6870 assertions，测试 124.87s、命令 148.88s）；console build **635ms**，候选摘要保持。新增真实数据库恢复、并发／重试／补偿／旧连接测试与界面草稿／未知回执／失败重查回归。跳过项仍为显式集群开关和隔离原生 CLI 测试，不冒称这些自动执行。

本机 task_runtime/0003_environment_rebuilds.sql 由专用迁移 Job 应用成功。cs-session 更新到首个本批镜像／generation=15；最终 controller／API／console 分别为 generation=24／38／49，全部 1／1。最终控制面与工作台标签分别为 cs-control-plane:rfc003-b75-final-19272ba002 和 cs-console:rfc003-b75-final-19272ba002，实际 Pod 文件摘要全部匹配；11:34:07Z 正常 HTTP 六份控制台产物一致。CPU 已满时逐个替换这三个自有服务，临时使用 maxSurge=0／maxUnavailable=1，完成后恢复各自原滚动策略。没有停止其他开发任务或业务应用。

增量镜像构建曾先缺 queue 工作区链接、后触及 Docker 层数上限，均在部署前修正构建方法；最终合并目录复制并通过容器内实际模块导入。不是源码门禁失败，也没有重装任务容器或覆盖其运行目录。11:34:07Z delivery／files／legacy 原 Pod UID、进程启动时间、受保护文件全部保持；节点 Ready，无内存、磁盘或 PID 压力。

结合 E17 的真实重新附着和单进程终止证据，本批补齐容器恢复后旧进程不可伪称在线，**UX-AT-34 通过，累计 27／52**。I15 独立 CLI Pod、四窗隔离、I9 出站及其他验收继续；RFC-003 仍 In Progress，RFC-004 按批准顺序排队。证据在 /private/tmp/crewstation-rfc003-batch75-*；最终提交和精确 SHA CI 另行核对。

发布前按模块上限将 dev-session 的恢复用例归入现有 sessionLifecycle，保持 40 个生产源码文件；task-runtime 为 38 个／1500 行。归并首检发现一处旧测试 import，修正后接口 2 pass／类型检查通过；最终 68 份源码候选完整门禁 **1240 pass／4 skip／0 fail**（1244 tests／208 files／6870 assertions，测试 120.91s、命令 144.38s），console build **544ms**。控制台七份产物与既有最终部署逐字节一致，复用 generation=49。实际刷新重新进入后，CLI a7130d 仍为同一进程，原模型输出保持，输入控制入口可用。

最终归并只追加更新 API：cs-control-plane:rfc003-b75-publish2-229a686b71／generation=40／1／1，Pod UID 8c290aa2-7415-4ec8-a4bc-e8d0a0e0da83；48 份实际运行文件摘要与最终候选一致，滚动策略恢复。controller／console／session 保持上述 24／49／15，归并没有改变恢复行为或重新启动开发容器。

第七十五批最终提交为 2f3647d5d0488593534ff7747dfdeefd7430f8ff，main 与 origin/main 同步；[精确 SHA CI 34965343584](https://github.com/wangbinquan/CrewStation/actions/runs/34965343584)／job 104368350710 已成功，终态 2026-09-15T11:51:36Z，1236 pass／8 skip／0 fail，console build 1.30s。

## 第七十六批：逐 CLI 独立执行环境底层

I15 按已经选定的独立 Pod 方案继续实现，契约见 [cli-isolation.md](cli-isolation.md)。本批交付 task-runtime 的完整执行生命周期和 Runner 身份配置，工作台启动入口与动态聚合在下一批接线。尚未把当前“＋ CLI”改成新路径，不以底层测试代替完整四窗体验。

每个子环境冻结 parentTaskId、原 Pod／PVC UID、节点、资源套餐、镜像和 agentId／terminalId／runnerId。登记、并发配额与队列在同一项目事务中提交；相同请求返回同一个环境，不重复占额，配置变更不能套用旧执行标识。子环境使用独立 Pod／Secret，沿用原工作卷，不克隆、不建卷、不启动预览。Kubernetes requests／limits 分别限制每个 CLI，单位规范化可接受，实质资源变化会拒绝。

准备作业核对原卷和父 Pod，创建回执丢失后采用同一实例；租约转移的旧执行不能提交就绪。等待期间呈现真实调度原因，五分钟未连接则进入清理。清理意图和凭据失效先持久化，确认 Pod 已消失才回收本次配额；清理失败即使耗尽队列重试，也由协调器接续。异主对象不覆盖或删除，清理未完成不能当作额度空闲。

父释放先阻止新 CLI，并等待所有子环境清理后才删除父 Pod／原策略下的卷；重复释放只减一次配额。父容器失败不结束仍在运行的子 CLI；I14 的保卷恢复保存活跃子环境所在节点，并将同一 RWO 卷的新父容器交由调度器安排到该节点。ReadWriteOncePod 在准入前明确拒绝共享。子 Runner 的连接身份通过 CS_RUNNER_TASK_ID／CS_RUNNER_NATIVE_ID 固定，Agent 的 CS_TASK_ID 和任务数据访问仍属于原工作区。

新增 15 条真实数据库／假集群回归与 2 条 Runner／真实 PTY 回归，覆盖正常、并发、OOM、超时、父释放／恢复、响应丢失、租约接管、卷替换和资源规范化。定向先 25 pass／1 skip／0 fail，后补单位／调度检查的故障组 9 pass／0 fail；Linux PTY 的平台专属分支不算本机已跑。首检曾发现未声明 zod、TaskId 标记类型和函数长度，均修正后类型、lint、结构通过；合并恢复集群端口后 task-runtime 为 40 个生产源码／1900 行，没有豁免模块上限。

首轮完整门禁为 **1256 pass／4 skip／1 fail**（1261 tests／210 files／6971 assertions，测试 134.65s、命令 163.00s）。唯一失败发生在本机 GitLab 新会话令牌的第一次普通分支推送，报 terminal prompts disabled；此前建仓、平台推送、标签与分支比较已通过。没有据此认定凭据配置错误或改写宿主机配置。同一源码下独立重跑该 GitLab 文件 **5 pass／0 fail／43 assertions，36.19s**，本次临时测试项目 id 157 已由测试清理；首轮项目 id 156 也已清理。控制台构建 564ms，产物名仍与第七十五批一致。

最终完整门禁于 12:31:26Z 通过：**1257 pass／4 skip／0 fail**（1261 tests／210 files／6977 assertions，测试 124.99s、命令 148.30s），console build **535ms**；37 份源码候选与首轮逐字节一致，原 GitLab 失败未复现，没有修改生产凭据逻辑或删掉用例。精确提交和 SHA CI 另行核对。原失败日志保留在 /private/tmp/crewstation-rfc003-batch76-check.log；候选、复验与最终记录采用 batch76、batch76-scm-recheck、batch76-final 前缀。本批尚未部署或更新任务镜像，未操作旧 CLI、未发送草稿、工作卷或业务切流。下一批接算力档位套餐、启动派发、多 Runner 终端／动态及末屏，随后完成实机隔离与四窗验收。**累计仍 27／52**，RFC-004 不提前开始。


## 第七十七批：管理员资源套餐与逐窗执行接线

第七十六批已发布 614e4a7f4987ed918edcf7f56b53fe15b9d58467；[精确 SHA CI 34970139732](https://github.com/wangbinquan/CrewStation/actions/runs/34970139732)／job 104384138940，2026-09-15T12:42:01Z 成功。

管理员可为算力档位选择每个 CLI 的任务资源套餐，省略沿用平台默认；不存在的套餐不能覆盖原配置，租户仍只选算力档位名。HTTP 先返回准备中的独立窗口，控制器从持久名册准入并派发，Runner 就绪另有事件触发。每次执行跨实例串行，单进程最多两项；同一请求保持冻结身份，创建或派发回执丢失均接续原执行。停止、明确失败和已结束不会自动重跑。

各窗按 execution.taskId 连接自己的 Runner，输入与尺寸不再发给父工作区；历史名册继续兼容原父 Runner。父断线、一窗失联和一窗 OOM 分别呈现，独立 CLI 的完成与待处理不被父连接覆盖。动态迁移保留旧父游标，随后按来源去重并分配统一投影序号；不同来源相同 seq／eventId 不冲突，已清理来源补齐后封存。

正常退出先保存有界末屏，暂时不可取重试至 30 秒，环境已丢失则明确不可用。末屏不进入名册轮询，界面另行按需读取并保持只读；清理回执丢失继续重试同一环境。数据库新增执行绑定、停止意图、末屏和来源游标，均为追加迁移；合并原生 API 声明后 dev-session 保持 40 个生产源码文件。

新增 17 条用例覆盖管理员资源绑定、独立派发、回执丢失、停止／创建竞争、父断线、OOM、末屏期限／持久化、跨实例串行、相同来源序号、历史迁移及真实 React 多窗连接。首轮后端定向 35 pass；新增持久化组首次 4 pass／1 fail，检出末屏状态被双重 JSON 编码，改用 to_jsonb(text) 后专项 16 pass（含关联 UI）；双窗 DOM 初检因 about:blank 不能解析 WS 相对地址失败，显式设置测试页面地址后 3 pass，未改生产 URL 逻辑。

唯一完整候选门禁于 13:15:22Z 通过：**1274 pass／4 skip／0 fail**，1278 tests／214 files／7076 assertions，测试 115.59s、命令 137.38s；console **644ms**。52 份源码候选保持，日志和摘要位于 /private/tmp/crewstation-rfc003-batch77-*。本批尚未部署或操作旧 CLI；真实四窗／OOM 与后续旅程继续，**累计仍 27／52**。RFC-004 仍未开工。
