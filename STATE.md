# 当前执行状态

> 这份文件让新 session 能立刻接上进度。每完成一批工作就更新它，与提交一起推送。
> 规则见 `docs/engineering/development-rules.md` §9。

## 一句话

基线三件套（v0.3.3）的第一轮实现已在本机 kind 集群上跑通并推上 main；**RFC-001（算力归平台）与 RFC-002（管理空间与租户空间分离）已实现、实跑确认并推上 main；RFC-004 已被 RFC-006 取代（Superseded）；RFC-006（算力档位合并运行环境、每个 Agent 一个 Pod）已实现、实机验收完毕并推上 main，已 Done（P1–P8、ADR-0005 与 I17–I19 待作者复核）；RFC-003 工作台已按设计附件完成并整体部署到本机，52／52 项 UX-AT 全部实机通过、本地 gate 与精确 SHA CI 通过，已 Done；RFC-005（OIDC／OAuth 2.0 公司登录）代码、测试与 OA-01…OA-31 实机验收全部完成，已 Done；RFC-007（开发环境 OAuth 2.0 一键换角色）代码、四角色 Chrome 实机验收、本地 gate 与精确 SHA CI 全部完成，已 Done**。

## RFC 状态

**RFC-003 工作台 UX 重设计已 Done（2026-09-16）：52／52 项 UX-AT 全部实机通过，本地 gate 与精确 SHA CI 通过。RFC-004（管理员定义 Agent 启动前 Hook）已按 RFC-006 的裁定 C8 置为 Superseded，其 AR 实机验收不再执行。** RFC-001 与 RFC-002 都已 Done，见 `proposal/rfc/README.md` 的索引表。**RFC-005（OIDC／OAuth 2.0 公司登录）于 2026-09-18 落档、同日按作者会话目标「完整实现整个RFC并提交上库」实施完毕并实机验收，已 Done。** **RFC-006（算力档位合并运行环境）2026-09-18 落档，同日作者设定会话目标「完整实现RFC并提交上库」，同日实施完成并 Done：CP-01…CP-22 实机核对完毕，基线三件套回填到 v0.3.4，见下方接力。** **RFC-007 于 2026-09-20 完成 T1–T8，本机 Chrome 四角色、旧页签恢复、本地 gate 与精确 SHA CI 全部通过，已 Done。**

## 最新接力：项目设置与开发资源分工（2026-09-20）

作者要求项目设置直观、简化，并明确批准「批准实施并批准代码提交上库」。生产实现已完成：
设置聚焦环境变量／应用展示／成员与角色／高级，默认开发变量；列表和摘要先显示，新增／修改才展开表单。
开发资源独立为 API／事件／数据与存储／项目与仓库／平台接入五主题；两空间的旧链接保留上下文迁移。
原角色判断、独立草稿、错误、确认与焦点保护保留；窄屏使用有标签的主题选择器。评审工具只留在设计稿的 `?review=1` 中。

已部署 `cs-console:rfc009-20260920-3` 并实机操作默认入口、变量草稿往返、错误聚焦、离开确认和五资源主题。
最终真实 E2E **11 pass／0 fail／274 assertions**；1280／390／320px 中文浅色、390px 英文深色九主题均无整页横向溢出。
配置／成员／应用／资源候选 46 项、API／边界 14 项回归通过，console 构建通过；与 RFC-008 共用最终完整 gate，结果与上库 CI 待回填。
没有实际修改演示项目配置、成员权限或归档。真实只读 API 试调在原有容器网关通道超时，页面原因与输入保留；
未得到 HTTP／trace，PS-11 的真实成功响应欠证，因此 RFC-009 仍 **In Progress**。实现、自动化与实机证据分别见
`proposal/rfc/RFC-009-project-settings-ux/acceptance.md`。保留并行 RFC-008 的全部输出，Git 发布串行协调。

## 最新接力：开发会话操作闭环与界面重构（2026-09-20）

作者要求全面优化开发会话，重点解决未连接无法创建 CLI、右上角数据访问／会话展开混乱、操作路径不直观。
实施前已核对本机与源码：演示项目 `demo` 的 `tsk_01a0954107447000b7936485fb80d15d` 在旧协议 1 容器中运行，
平台要求协议 2，握手持续以 1008 拒绝。运行时只记录拒绝原因而保留任务为 running；既有恢复仅接受 failed 且 Pod 已结束，
因此 UI 禁用 CLI 后无可用恢复路径。未连接无需用户填写 Runner 地址。

新增 `proposal/rfc/RFC-008-development-session-ux/` 三件套与可操作设计附件，索引状态 **In Progress**。
方案为六个固定功能页签（CLI 工作区／预览／代码／变更／数据访问／会话与环境），CLI 内管理个人工作区；
异常原因与下一步直接可见，扩展已有保卷恢复以支持服务端确认协议不兼容的旧环境。
作者已于 2026-09-20 明确回复「批准实施并批准提交上库」。代码与本地门禁已完成，正在精确提交与 CI 收口。
结构化连接故障与保卷恢复已贯通；兼容旧数据遗留 connected=true，活动心跳不再让恢复确认过期。
数据／环境为固定页签，编辑与申请草稿保留；明确 URL 优先于其他浏览器页写回的个人视图，避免同地址无法回到 CLI。

demo 实机恢复作业 `e4e5aa6e-256b-4d6d-8119-d3af576194bc` 已 ready，13.189 秒完成；同一任务、PVC UID、Git HEAD、源文件保留，
仅 Bun 缓存更新。实际创建独立 CLI 并得到 `RFC008_OK_e4e5aa6e`，代码编辑／保存／变更计数／还原与真实预览通过。
最终界面 1280×720 四窗各 547×222px、首窗 y≈199px；390×844 六页无整页横向溢出，英文、深色、键盘导航已核对。
工作区新建、命名、跨区移动和关闭实机通过；数据草稿往返保留，释放预检后取消；没有申请生产访问或发布业务版本。
前一候选完整 gate 1631 pass／5 skip／0 fail；真实验收增量的运行时 65 项、前端 25 项定向回归通过。
最终共同 gate **1684 pass／5 skip／0 fail，9534 assertions，228.33s**，结构、lint 与两套类型检查通过。
正在发布与核验精确 SHA CI；保留并行 RFC-009 与其他门禁在制品，双方协调串行 Git 发布。
实机证据见 `proposal/rfc/RFC-008-development-session-ux/acceptance.md`；设计附件与实际验收不混用。

## 上一轮接力：按钮与内容框贴边修复（2026-09-20）

作者反馈多处按钮紧贴上下内容框。实机定位：卡片只有外框内边距，内部块没有统一间隔；工具栏的 gap 只分隔组内元素。
新增公共 `Stack`／`ActionRow`，`Card stacked` 按需启用；认证、镜像说明、发布准备、告警订阅、调用链、项目生命周期／开通、
开发恢复和 API 试调共 11 处卡片接入。纵向内容统一 12px，同组操作 8px 并可换行；独立按钮保持自然宽度。
发布最后一步与恢复检查表单也使用同一布局；移除已由父布局承担的重复 margin，既有独立布局的卡片保持默认行为。

新增 `tests/e2e/layoutSpacing.test.ts` 的 7 项真实浏览器回归，旧部署全部因 0px 间距失败；新版全部通过。
覆盖 1280px／390px 的镜像示例、身份提供方、发布准备，以及告警订阅和调用链查询；验证间距、按钮自然尺寸、横向溢出与浏览器异常。
另以浏览器核对发布最后一步：提示框到操作区 12px，按钮之间 8px，按钮高约 33.6px，390px 页面无横向溢出；未提交发布或业务配置。
定向交互 **68 pass／0 fail／575 assertions**；完整 `bun run check` **1621 pass／5 skip／0 fail，9033 assertions，182.16s**，
含本机 PostgreSQL、GitLab 和浏览器集成；console build、架构、全仓 lint、根类型与 console 类型通过。GitHub CI 由本批提交触发，按该精确 SHA 核对。

本机工作台已更新为 `cs-console:button-spacing-20260920`，Deployment 1／1 Available；镜像清单摘要
`sha256:6410fc6ff96bb019e887784f8fe0e6fb340c27c9400424847862270a3026e856`。
本批精确路径、候选校验和与完整门禁日志保存在 `/private/tmp/crewstation-button-spacing-20260920/`。

## 上一轮接力：RFC-007 开发环境 OAuth 2.0 一键换角色（2026-09-20）

作者要求把 `agent-workflow` 的 dev OAuth 2.0 能力迁入并适配 CrewStation。现已新增本机专用 `crewstation-dev-auth`
Deployment／Service／Traefik IngressRoute；它复用 `cs-control-plane:dev`，只执行 `tools/dev-auth/main.ts`，生产清单与生产源码不引用。
入口 `http://dev-auth.cs.localhost/` 当前 1／1 Ready，提供平台管理员、项目开发者、项目测试者和普通成员四个固定视角，不提供会改变项目所有权的 owner。

角色点击走真实 discovery、授权码、PKCE、token、JWKS、userinfo、CrewStation callback 与 `cs_session`；开发者默认进入所选项目 `/dev-session`，
测试者只见版本试用，普通成员无项目关系，管理员进入管理空间。项目只列未归档 `DigitalWorker`，接入容器不暴露给开发者；启动和“同步项目”都幂等播种。
每次进程启动轮换 issuer 路径、RSA 密钥、client secret 和表单令牌，Provider 与四个账户 ID 保持不变。

真实 Chrome 连续验证四角色并核对 `/v1/me`。最终滚动重启前保留旧页签，第一次点击得到 HTTP 403 及“页面已更新”完整可重试页面，
第二次以新令牌登录并直接落到 RFC-006 实机验收项目开发页；随后恢复管理员，Chrome 留在角色入口。
定向验证 **8 pass／0 fail／32 assertions**，部署 1／1 Ready；统一冻结候选的最终 `bun run check`
**1614 pass／5 skip／0 fail，8995 assertions**，架构、全仓 lint、根类型与 console 类型全部通过。功能提交
`fd1418fd78a1601fbae81860ecaf12dc3213a1f2` 与 CI 可移植性修复 `35452d504eb827cbb858e78a42b59369adad6b5b` 已推上 `main`；
精确 SHA [CI 35496732781](https://github.com/wangbinquan/CrewStation/actions/runs/35496732781) 的 `check`（3 分 7 秒）与 `e2e`（5 分 39 秒）均成功，RFC-007 已 Done。完整证据见
`proposal/rfc/RFC-007-dev-role-login/acceptance-audit.md`。

## 并行接力：首次访问直接创建管理员（2026-09-20）

作者要求直接沿用 agent-workflow 的首位管理员交接，避免首次打开找不到初始用户名密码。已修复根因：
`install-platform.sh` 默认不再自动生成随机管理员，安装输出初始化链接；登录发现处于 bootstrap 时直接显示创建表单。
链接自动带入一次性引导令牌并清除 URL，创建后令牌永久退役，再用自选账号密码登录并回原访问目标。
每个字段都有初始规则与逐字段反馈；服务端错误保留非口令资料。已有账号保持正常登录。

CI／无人值守安装须显式 `CS_BOOTSTRAP_ADMIN=1`；需要管理员权限的套餐播种与 RFC-007 开发角色登录器等待建号与凭据就绪，
不再通过暗中建号满足依赖。安装脚本、部署文档、CI 与 lockfile 包含并发 RFC-007 输出，保持完整；发布需与其所有者协调。

真实 Chrome＋独立 PostgreSQL 临时数据库的创建／登录／原路径返回／令牌退役链已通过，1280×900 与 390×844 浅／深色无横向溢出，
浏览器无异常；console 构建通过。初版 DOM 测试的全局注册干扰已改为独立窗口并通过跨文件定向复验；最终 `bun run check`
**1610 pass／5 skip／0 fail，8967 assertions，184.39s**（含本机 PostgreSQL、GitLab 和当时可用的网关浏览器集成）。
本批已随 `fd1418fd78a1601fbae81860ecaf12dc3213a1f2` 发布，精确后继 `35452d504eb827cbb858e78a42b59369adad6b5b` 的 GitHub `check`／`e2e` 均成功。本批设计与详细证据见
`proposal/rfc/RFC-005-oidc-company-login/initial-admin-correction.md`，本机浏览器证据 `/tmp/crewstation-first-admin-20260920/`；临时服务、数据库和浏览器已清理。

## 并行接力：算力档位列表与编辑页交互整理（2026-09-20）

作者反馈表格难看，展开「更多操作」后按钮样式错乱。实机复现：操作列的 flex 默认拉伸把「编辑」从 33.6px 拉到 200.8px。
已将次要操作移到档位下方跨四列的独立区域，统一按钮尺寸，复制表单与确认说明按可用宽度排列；收起保留复制草稿，Esc 收起并返回触发按钮。
列表统一名称／说明、执行配置与状态的层次，详细配置归入档位信息，最近测试合成一行，失败原因仍可见；窄屏按单个档位纵向排列。

作者随后追加编辑页交互与视觉修复。编辑器按基础配置、启动流程、变量与凭据、测试结果分组；切换保留草稿与测试轮询，
保存配置后直接显示测试结果，跨分组校验自动选中出错步骤并聚焦字段，测试阶段的定位按钮真正跳转并聚焦。
固定名称与协议放进标题摘要；常用字段和高级启动参数分组，启动步骤改为可选择的导航列表与独立编辑区，凭据统一表单排版。
保存栏保持可见；修复壳层未限高 overflow 容器阻止 sticky 生效的问题，仅作用于算力编辑页。测试 ID、任务 ID、阶段原因与日志保留，环境详情可展开。

最终定向测试 **21 pass／0 fail／240 assertions**，覆盖复制与确认、分组保留草稿、保存后测试、错误定位与跨分组测试跟踪；
`typecheck:console`、定向 eslint、`arch:check` 与 console build 均通过。此前完整门禁遇到的并行登录测试依赖／全局 DOM 污染已由所属任务修复。
本批 23 个源码与测试文件已冻结；统一冻结候选的最终 `bun run check` **1614 pass／5 skip／0 fail，8995 assertions**，
架构、全仓 lint、根类型与 console 类型全部通过。

本机工作台已更新为 `cs-console:compute-editor-20260920`，镜像清单摘要
`sha256:b0cdf0923491518abbc64e4aea9709f2b0e626d1fd33a1c29213b03a0eb4b0da`，Deployment 1／1 Available，并已从原工作台地址复验。
1280px 中英文与 390px 窄屏实测：展开操作、复制表单与确认提示正常，编辑按钮始终约 33.6px；390px 页面宽度同为 390px，无横向溢出。
新版编辑页在 1280px 与 390px 实机验证：页面宽度与视口一致，保存错误聚焦「步骤名称」，测试定位聚焦「步骤 ID」，长表单滚动时保存按钮仍在顶部。
本批浏览器验证未提交任何档位配置或删除请求。本批提交完整保留并行 RFC-007 与首次管理员任务的接力记录；
精确文件清单 `/private/tmp/crewstation-compute-ui/editor-paths.txt`，冻结校验和 `editor-candidate.sha256`，测试与构建日志在同目录。

## 上一轮接力：GLM-5.2 接通与 OpenCode 冷启动状态修复（2026-09-20）

作者要求用本机 `opencode.json` 接通「火山AI网关/glm-5.2」，并授权将发现的 bug 修复上库。已建立管理员算力档位
`volc-glm-5-2`：启动前文件步骤写入 Agent 独立 HOME 的 `.config/opencode/opencode.json`，本机配置中的真实 API Key
改为平台加密凭据模板引用。原始配置与密钥没有进入仓库；平台默认档位仍为 `oc-base`。

实机发现并修复：OpenCode 在 150m CPU 下尚未加载状态插件，20 秒心跳计时就把状态源永久降级，导致模型正常回复后仍显示
「轮次状态未确认」。首次插件握手改为独立的 120 秒等待上限，握手后保持 20 秒心跳；真实超时或缺帧仍永久降级。
回归先红后绿，覆盖慢启动、连接后的心跳到期、首次握手上限和迟到 `ready` 不恢复。

本地 `bun run check` **1588 pass／5 skip／0 fail**（环回地址经 `NO_PROXY` 排除代理）；Linux 任务镜像内的真实 OpenCode
原生 TUI 验收 **1 pass／21 assertions**，覆盖完成、中断、提问／撤回、权限等待、模型失败和进程退出。
任务运行时已构建并发布到本机仓库，摘要 `sha256:44cc1081ad618a9423f18676997be69af1478768c163103a357d97fd4a5b40c6`；
GLM 档位修订 2 的自动测试 `pft_01a0bce0d0467000a4b1ef5c3a9a9610` 已通过，其他档位的固定镜像修订未变。

浏览器实测：项目 `rfc006-verify`，父任务 `tsk_01a0bc96ee157000972f7b1427ba89e4`，新 CLI
`agt_01a0bce443927001a02e2f0223fbd074`（修订 2，CPU 仍为 150m）依次显示「等待任务 → 执行中 → 本轮完成」，
GLM-5.2 原样返回 `CS_GLM52_ACTIVITY_OK_5e81b7`（32.4 秒）。切到工作区 2 后，工作区 1 与全局 Agent 动态均显示
「未读完成 1」；点「查看结果」回到该 CLI 并消除未读。API 记录 `source=ready`、`currentTurn.status=completed`、
完成时间 `2026-09-20T03:39:31.132Z`。旧修订 1 的测试 CLI 已正常结束，新 CLI 保留可继续使用。
工作树仍为 `rfc006-accept@e9339be065`，未提交／未推送均 0。本机证据保留在
`/tmp/crewstation-glm52-20260920/activity-startup-fix.json`；发布与最终 CI 以本批精确提交的 Actions 结果为准。

## 上一轮接力：逐页 UX 复查与修复（2026-09-20）

作者要求原剩余工作由另一 session 接手，本轮只做已实现工作台的实际使用复查。市场、管理端各入口、数字人项目的开发／发布／诊断／设置均实际打开并操作，详细范围、结果和未通过项见 `proposal/reviews/ux-review-2026-09-20.md`。

本轮修复：算力目录四列布局、搜索与展开操作；镜像地址逐行展示；认证字段校验／取消／草稿保护和密钥输入；生产方 slug 跳转；开发页不挤走终端的互斥浮层；断线编辑器反馈与操作限制；通用终端不显示 Agent 轮次未知；资源错误重试与结构校验；并发配额等中英文说明。最终复验又修复了全局 Agent 动态、API、发布、告警与应用可见性页面对缺失用户成员列表的空值访问，API 页可重新读取用户资料；实机已恢复显示 22 条操作。没有修改账号权限、现有算力档位或发布业务版本。

最终本地 `bun run check` **1586 pass／5 skip／0 fail**（含本机 PostgreSQL 与 GitLab 集成；环回地址经 `NO_PROXY` 排除本机代理，避免测试端口被代理返回 503）；console 镜像构建通过，已部署 `cs-console:ux-review-20260920-user-read`（`sha256:82727ed48190473b754e4df089ac06058358493eebd424f9128a364ce2c72853`）。首批 `80b600f` 的 GitHub 检查和 E2E 已通过（run `35485005088`）；包含最后补修的精确提交 CI 以该提交 Actions 结果为准。

实机保留：`rfc006-verify` 的新验收任务 `tsk_01a0bc96ee157000972f7b1427ba89e4`，分支 `rfc006-accept@e9339be065`，未提交／未推送均 0；仅本轮新父 Pod 为解决本机 CPU 预约不足调为 150m。两个本轮 CLI 已从 UI 正常结束，父工作树保留可预览，未销毁。旧 RFC-003 的协议 1 会话未改动。

仍需区分的运行问题：资源聚合 API 实测 500，Bun SQL `ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE`，重启 cs-api 后仍可复现（已留日志，I16）；OpenCode 的 edit 档位仍遇免费模型限制（I19），不能计作模型轮次通过；已有最小样例未解码中文姓名头。上述不是本轮已修复的底层能力，复查文档保留了证据与边界。

## 上一轮接力：RFC-006 Done——实机验收全部核对，基线回填 v0.3.4（2026-09-18）

作者会话目标「完整实现RFC并提交上库」。作者五轮裁定 C1–C20 在 proposal.md §2；**待作者复核**：§13 的 P1–P8、ADR-0005（仍为「实施中」）、`docs/engineering/implementation-open-questions.md` 的 I17（档位测试轮次的权限档位）、I18（构建资源是否可配置）、I19（read-only／edit 去掉 bash 与免费模型相冲）。RFC-004 已按 C8 置为 Superseded。

提交（都已推上 main，CI 按 SHA 见各提交）：2635e27（统一档位与 Runner 协议 2）、7cbe22f（每个 Agent 一个 Pod）、b2cf79a、4a1b274；实机修复 2e743a6（档位测试的权限、原文分类与打码摘录、`driver_not_installed`、`{{mcp.*}}` 上下文、终端测试收尾、跳过阶段、保存不清空说明、编辑器错误焦点）、8083552（任务父容器改从集群内仓库拉底座）、b0a526c（构建 Pod 按 `git clone`＋`buildctl` 客户端的负载改为 250m／512Mi）、67c343d（opencode 的 error 行带厂商原文）；文档 5c3fbf5、ef5050d（基线 v0.3.4）与本批收尾。

实机（逐项证据 `/private/tmp/crewstation-rfc006-20260918/README.md`）：design.md §13 四项与 CP-01…CP-22 全部核对。验收项目 `rfc006-verify`（`prj_01a0b3546ef570009ee4c590852cca21`）：首次发布在构建 Pod 右尺寸后成功；`/chat` 经默认档位得到真实模型输出；额度满时子任务立即 failed；暂停结束 Agent Pod、恢复不重起；被引用档位删除先列项目；引用通用终端档位的发布在部署阶段被拒。本机做不到、以自动化用例为准的两处：CP-03 的 Claude Code 真实轮次（无登录态）、CP-11 的「没有默认档位」（默认设过就不能停用或删除）。模板原样的 read-only `chat-v1` 被 OpenCode Zen 免费档以 403 拒绝（I19），验收项目的 `chat-v1` 改用 full（分支 `rfc006-accept`；受保护的 main 不接受会话推送，发布走分支）。

环境现状：06:45Z Docker Desktop 磁盘写满过一次（postgres 自愈，见 dev-gotchas），之后只重建控制面并清理被取代的镜像；**不要在本机连续跑整套 `install-platform.sh`**。任务镜像没有为 67c343d 重建（实机子任务的错误文案仍是旧的「运行时报告错误」，原文在事件 raw 里）。档位：oc-base（默认）、fork-oc、demo-term、oc-fields 可用，oc-steps 已按 CP-12 删除，其余是失败分类样例。临时降配的 coding-medium／standard-small 已恢复；rfc006-agent（150m／1Gi／2Gi）留给档位用；验收项目预览槽 v0.1.2 在跑（25m）。RFC-003 QA 会话没有动。

## 最新接力：RFC-005 实机验收跑完，RFC-005 Done（2026-09-18）

OA-01…OA-31 逐项核对完毕，能实机的都在当前部署上实机跑了一遍：真网关、真 Traefik、两个 `tools/mock-idp/` 起的真 IdP
（9001 标准 OIDC＋RS256 真签名；9002 无 discovery／无 id_token／`post_json` userinfo／`subjectClaim=id`）、无头 Chrome＋CDP。
逐条证据在 `proposal/rfc/RFC-005-oidc-company-login/acceptance-audit.md`，RFC-005 三件套状态改 **Done**。

实机走通的整链路：登录页两个公司身份入口 → 点按钮 → IdP → 回跳 → `/v1/me` 拿到 `authMethod: "oidc"`；`allowlist` 放行与
`email-domain-not-allowed` 的中文错误页（不留半截用户）；`auto` 开通；管理员在用户目录标记 OIDC 用户后对方重载即进管理空间；
同一邮箱从两个 Provider 进来得到两个账户（A12）；关闭常规登录后登录页无密码表单、直 POST 403，OIDC 管理员原位重开立即生效；
破窗口开关；最后一个 Provider 与「仍有用户关联」的删除保护；默认转发集下业务页面照常显示当前用户，伪造身份头被网关抹掉；
1440／1280／1024／768／390 五档、明暗主题、全程键盘。

实机跑出来、自动化没能发现并已修掉的两处：

1. **破窗口期间管理面报的是库内策略而不是正在生效的状态**：`CS_PASSWORD_LOGIN=force-on` 压着库内的「关」时，认证页照库内值写「已关闭」，
   还给出一个按下去必然 409 的开关。改为写正在生效的状态、单列被压着的库内策略、两个方向都不给按（`LoginMethodsCard`＋一条会红的用例）。
2. **这个开关被两个进程读**：登录页归 cs-auth、认证页归 cs-api，只重启一个界面与实际就各说各话。文案、design.md §8、OA-17 与
   `10-config.yaml` 一律改成「重启 cs-auth 与 cs-api」，并记进 `docs/engineering/dev-gotchas.md`。

另外补上的两条 gotcha：整文件批量替换会把助手函数的**定义处**也换掉（`body` 助手调用自己，所有读 body 的管理路由稳定 400），
以及「只测失败分支等于没测」——补了每条 body 路由的成功路径用例，并把 bug 种回去确认它们会红。

集群已还原到验收前：Provider 0 个、OIDC 用户 0 个、`CS_PASSWORD_LOGIN` 已从 ConfigMap 去掉并重启 cs-auth 与 cs-api、
全局转发集回到 `["name","email"]`、用户名密码登录开启（`.local/admin.env` 那套仍可用）。

## 最新接力：RFC-005 全量实现（OIDC 公司登录、引导交接、身份转发）（2026-09-18）

作者会话目标「完整实现整个RFC并提交上库」，据此实施 RFC-005，状态改 In Progress；T1–T8 与 T11 的生产代码与测试已落地，**实机验收（T9）未做**。

落地面（都在 `modules/identity`，未新增模块、不需要 ADR）：

- **契约**：`packages/contracts/api/auth/{session,oidc}.ts`（`api/` 撞 20 文件上限，auth 两件挪进子目录）；`x-cs-user-attrs` 与 `cs_attrs` 进业务约定表；`x-cs-auth-method` 登记为平台内部头（只在工作台目标注入）。
- **数据**：identity 迁移 0004–0009 —— `oidc_providers`、`user_identities`（`(provider,subject)` 唯一＝账户不合并）、`auth_login_policy` 单行、`oidc_flows`（PKCE／state **落库**，多副本一次性消费）、users 加 `username`／`password_hash`／`git_name`、`identity_forwarding`（全局一行＋每项目一行，默认集 `["name","email"]` 与本 RFC 之前行为一致）。
- **登录链**：`/auth/status`、`/auth/login`（服务端渲染，方法由登录发现决定）、`/auth/bootstrap`(+POST)、`/auth/oidc/:slug/{start,callback}`、`/auth/logout`；端点解析逐字段合并＋正负缓存＋`loginViable` 门；身份取值三条不变量（未验证 id_token 不解析、验签只看配置状态、`subjectClaim` 是模式开关）。
- **管理面**（cs-api）：`/v1/admin/auth/{login-policy,providers,forwarding}` 与 `/v1/projects/:id/identity-forwarding`；工作台 `/admin/authentication` 三张卡（登录方式、身份提供方、身份转发），配置项与 agent-workflow 逐项一致（少 invite 一档，多自定义映射一块）。
- **演示登录整条删除**：适配器、契约、`demoIdentity`、`CS_IDENTITY_PROVIDER` 全下线；CLI `whoami` 改显示登录方式；e2e `signIn` 改口令登录，口令由 `install-platform.sh` 写进 `.local/admin.env`（也可用 `CS_E2E_PASSWORD`）。
- **本机 IdP**：`tools/mock-idp/` 支持标准 OIDC、纯 OAuth 2.0（无 discovery／无 id_token）、非标 userinfo（`post_json`＋`subjectClaim`）三形态；`modules/identity/tests/mockIdpChain.test.ts` 用真 HTTP＋真 RS256 验签覆盖它自己。

三处实施期调整（已写进 RFC design §11 与 proposal §8，请作者过目）：自定义字段合并成**一个 JSON 头** `x-cs-user-attrs`（原设计每字段一个头，会迫使网关删头名单动态下发并留出可伪造窗口）；`users.external_id` 保留为自然键（权威索引仍是 `user_identities`）；引导的非交互入口是 cs-auth 的 `bootstrap-admin` 子命令。

T9 实机已在下一批（本文件最上方那条接力）跑完，逐项证据见该 RFC 的 `acceptance-audit.md`。

## 最新接力：RFC-005（OIDC 公司登录）三件套落档，待作者批准（2026-09-18）

> 这条是当日更早的一批，保留原文。其中两处已被后来的实现推翻，以上方两条接力与 RFC 文档为准：
> 作者当天即设定会话目标要求实施，RFC-005 已 Done；自定义身份字段最终合并成**一个** `x-cs-user-attrs` 头，
> `drop-identity-headers` 保持静态 YAML，没有交给 cs-controller 动态生成。

本批只写文档，**无任何生产代码改动**。作者指示：把 agent-workflow 的 OIDC／OAuth 2.0 认证能力搬进来，配置界面的配置项与它完全一致，接入后原登录方式失效，系统初始化逻辑与它一致；并明确「没有存量系统，直接断代开发」。

已把 agent-workflow 的实现面逐处读过并对照本仓现状，落成 `proposal/rfc/RFC-005-oidc-company-login/` 三件套并登记进 RFC 索引。作者当日七项裁定写在该 RFC 的 proposal.md §2：

1. 初始化完全照搬 agent-workflow，**含本地用户名＋密码账户**与引导令牌交接；
2. 常规（密码）登录**由经 OIDC 登录的管理员手动关闭**（取代本轮早先一次「自动失效、无开关」的答复，后者会把首位管理员锁在门外）；
3. 开通策略只做 `auto`／`allowlist`，不做 `invite`；
4. 没有存量系统，断代开发（不写迁移兼容、不做按邮箱认领）；
5. 演示登录整条删除（`demoIdentityProvider`、`demoIdentity`、`CS_IDENTITY_PROVIDER` 全下线，e2e 与 CLI 改用密码登录）；
6. 多 Provider 并存，与 agent-workflow 同形；
7. IdP 全不可达时的破窗口是安装配置强制开关（`CS_PASSWORD_LOGIN=force-on`）＋重启 cs-auth 与 cs-api（登录页读前者，管理面读后者）。

开工前要知道的三条落地约束（都写进了 design.md）：PKCE／state **必须落库**（agent-workflow 是进程内 Map，本仓控制面 HA 是 v1 要求）；关闭密码登录的前置条件需要 cs-api 知道「当前会话是密码还是 OIDC 建立的」，因此新增平台内部头 `x-cs-auth-method`（只在工作台目标注入，不进业务接入约定表）；删掉演示登录会同时切断 e2e 的 `signIn()` 与 CLI 取 `CS_TOKEN` 的路，所以 T6 必须与 T8（`install-platform.sh` 播种引导管理员）同批。

同日第二轮裁定已并入（A8–A12）：IdP 带回的身份信息**先全部留在平台**，不注入容器 git 身份；改为由平台配置**哪些字段转发给业务**，粒度是全局默认＋按项目覆盖；可转发字段集可扩展（管理员把 userinfo 任意字段映射成转发项）；身份令牌声明与明文头**同步裁剪**；不同 Provider 之间只做账户不合并（用户唯一键＝Provider＋subject，不做手工绑定），不做 realm 级隔离。`x-cs-auth-method` 确认登记为平台内部头。

由此新增任务 T11（身份转发）与 OA-26…OA-31，并带来本 RFC 对业务侧唯一的破坏性契约变更：`x-cs-user-name`／`x-cs-user-email` 变成**可能缺席**，另加 `x-cs-user-attr-<key>` 一族；`drop-identity-headers` 从静态 YAML 移交 cs-controller 按当前映射生成，复制侧用 Traefik v3 的 `authResponseHeadersRegex`。能力说明从静态常量表改为「实际生效的转发集」。

**RFC-005 尚未批准，未进入实现阶段（开发规则 §5.3）。** 推迟到后续 RFC 的两件事写在 proposal.md §11：开发容器的 git 身份注入、realm 级隔离。

## 最新接力：UX-AT-42 乱序补发实机，52／52 收官（2026-09-16）

本批开工时 main 为 **f58132b19d9e92c1f869c65b52874a17feb5cc9d**（第九十四批记录已上库，CI 成功）。最后一项 UX-AT-42“乱序补发”以**可回滚的真实故障注入**走通,无生产代码改动:

- 把开发会话所有 `native_activity_*` 投影行与游标快照成可回滚 SQL;向一个**已连接、未结束的真实 CLI**（`agt_01a0a54b81ff…`,事件来自执行子任务）的事件日志插入一条源序号跳号（5 跳过 4,真实乱序）的原生动态事件。
- 经真实 cs-session→dev-session 同步管线:注入前接口与 DB 均 `connected/ready/sourceSeq=3`;注入后均变为 `source=unavailable, sourceReason=channel-gap`（子游标 232→233）,控制台 `activityStatus` 据此渲染“轮次状态未确认”、不显示成功;套用快照+复位游标+删除注入事件后**逐字节还原**（残留注入事件 0、无控制台错误）。
- 这与 E57“状态源不可用”同一可观察结果:未知不展示成功、工具完成不等同整轮完成。领域规则另有精确单测 `nativeActivityProjection.test.ts`。

**至此 RFC-003 全部 52／52 项 UX-AT 实机通过,RFC-003 置为 Done。** 证据 `/private/tmp/crewstation-rfc003-batch95/`。门禁:`bun run check` 2026-09-16T15:12:30Z **1344 pass／4 skip／0 fail（1348 tests／233 files）**。本批提交 **b2f147885a022baf343a66e486e1d991bc5ee56e**,[CI 35113904469](https://github.com/wangbinquan/CrewStation/actions/runs/35113904469) 2026-09-16T15:16:51Z 成功。

## 最新接力：失败分支的完整浏览器实机（2026-09-16）

本批开工时 main 为 **127f169203fae85c6bb0138c2704ff041127909a**（第九十三批记录已上库，CI 成功）。用无头 Chrome 在当前部署走完 6 个失败分支的完整实机，均真实故障、真实恢复、真实数据，**无生产代码改动**：

- **UX-AT-11**：admin 对 delivery 项目 v0.1.2（含破坏性迁移）在浏览器回退到 v0.1.1 被准确拒绝（“含破坏性迁移，不能切回……不会自动重发”），面板关闭、槽位与卡片不变、可再次打开并取消、刷新一致。
- **UX-AT-14**：内置 GitLab producer 先由 admin 上线到 v0.1.3；POST 真实 Push Hook（202、扇出 7 条），把 workbench 生产槽缩到 0 使其投递持续 HTTP 404，owner 事件投递页实时看到 attempts 4→5 推进，退避重试至第 8 次成死信，从死信开 trace，恢复生产槽后“重新入队”→已投递（attempts 归 1）。
- **UX-AT-27／49**：注入 files 项目单个服务槽记录不可读，列表／市场／概览均“状态暂不可用／正式状态未知”而其余四项目正常、market 不跳 preview、openLink 为空；恢复后逐字节还原为“已上线 · v0.1.8”。
- **UX-AT-30**：真实 `.git/shallow` 显示“暂不可比较／浅克隆历史不足”、未推送与上游如实未知、给出补齐入口；孤儿分支显示“无共同历史”；三态分开、不用远端分支冒充 HEAD。补齐历史的实际拉取需验收容器不具备的远端凭据。
- **UX-AT-48**：可见性 GET 被拦截失败显示“读取失败”而非伪装成功或无应用，页内“读取最新设置”仍失败时不谎报，恢复后经窗口聚焦重查还原完整表单。

累计 **51／52**。唯一未做完整独立实机的是 **UX-AT-42 乱序补发**：去重、断线补发、状态源不可用已实证，乱序缺口对账为纯领域规则且有精确单测（`nativeActivityProjection.test.ts`），可观察结果与已实证的“状态源不可用”一致；在当前活跃验收会话（13 agent、4 CLI）注入并回滚整段动态投影风险不成比例，故不做。

环境处置：workbench 生产恢复 1／1、两槽 ready；工作树回 `main`／`1aa2db9`／非浅、无孤儿分支；files 服务槽逐字节还原；producer 正式首次上线 v0.1.3 保留。门禁：`bun run check` 2026-09-16T10:19:00Z **1344 pass／4 skip／0 fail（1348 tests／233 files）**。本批提交 **594f864ef09f2536472807047015b9f6a22e0afc**，[CI 35084376297](https://github.com/wangbinquan/CrewStation/actions/runs/35084376297) 2026-09-16T10:24:08Z 成功。

## 最新接力：申请人与审批人显示名字（2026-09-16）

本批开工时 main 为 **c0feef8fe499f87fe81d6a35ff439d05eace29e3**（第九十二批已上库，CI 成功）。`ApiRequestDto`／`TaskDataBindingDto` 增加可选 `requestedByName`／`decidedByName`，api-catalog 与 data 各自声明 `UserDirectory` 端口由 platform 用 identity 实现；工作台申请列表与数据访问记录显示名字、ID 留在 title。实看：developer 看到“申请人 rfc003-developer · 审批人 admin”。四处回归。累计仍 **45／52**。

环境：重建后 cs-api／console 的 Recreate 新 Pod 因 v0.1.2 的 preview Deployment 请求 500m 而 Pending 约 10 分钟，四个 QA CLI Pod 再缩到 150m 后就绪并保持 150m（节点请求 9450m／10）；演示登录会用 `displayName ?? username` 覆盖名字，管理员显示名已改回“CrewStation Admin”。

未做：其余 7 项 UX-AT 需故障注入或专门历史构造（见上一节）。门禁：`bun run check` 2026-09-16T09:08:32Z **1344 pass／4 skip／0 fail**（1348 tests／233 files），arch 六项通过。本批提交 **57870d8d80dbd73f7a0fd4ab7153bc74d3ae5726**（25 files，+129／−21），[CI 35077764589](https://github.com/wangbinquan/CrewStation/actions/runs/35077764589) 于 2026-09-16T09:12:03Z 成功。

## 最新接力：浏览器发布补丁版本到就绪（2026-09-16）

本批开工时 main 为 **85534646535fe5330d90fdee40a23d0dd1cce227**（第九十一批已上库，CI 成功）。owner 从已推送分支 main（6af30245c4）发布 v0.1.2：向导三步、候选标签 v0.1.2、受理（08:30:18Z）→构建→部署→就绪（701 秒），其中构建 Pod 因节点 CPU 请求 10／10 满额 Pending 11 分钟，四个 QA CLI Pod 原地缩到 150m 后 20 秒内完成，事后恢复 400m（UID、重启数不变）。现在 preview 为 v0.1.2、v0.1.1 superseded、正式仍 v0.1.0；tester 在列表、详情与 preview 主机看到新版本。UX-AT-09 通过，累计 **45／52**。无生产代码改动。

未做：其余 7 项 UX-AT（11 破坏性拒绝／14 死信／27 局部来源故障／30 浅历史等分支／42 乱序补发／48 查询失败恢复／49 状态未知），都需要故障注入或专门的历史构造。门禁：`bun run check` 2026-09-16T08:46:34Z **1344 pass／4 skip／0 fail**（1348 tests／233 files），arch 六项通过。本批提交 **c0feef8fe499f87fe81d6a35ff439d05eace29e3**（6 files，+33／−11），[CI 35075691178](https://github.com/wangbinquan/CrewStation/actions/runs/35075691178) 于 2026-09-16T08:50:13Z 成功。

## 最新接力：浏览器里的 API 试调（2026-09-16）

本批开工时 main 为 **4e1a69ae8001c1ef4af213e30b25c46ba497606b**（第九十批已上库）。开发者在开发资源目录对已授权的 `rfc003-integration-qa:GET:/v4/projects` 点“试调”，卡片绑定运行中的开发会话，填查询参数发送，得到 HTTP 200、容器内实测 142 ms、所属会话与响应正文 `[]`。UX-AT-15 通过，累计 **44／52**。无生产代码改动。

未做：其余 8 项 UX-AT（09 新版本 202 受理阶段／11 破坏性拒绝／14 死信／27 局部来源故障／30 浅历史等分支／42 乱序补发／48 查询失败恢复／49 状态未知）——多数需要故障注入或新的真实发布。门禁：`bun run check` 2026-09-16T08:27:52Z **1344 pass／4 skip／0 fail**（1348 tests／233 files），arch 六项通过。本批提交 **85534646535fe5330d90fdee40a23d0dd1cce227**（5 files，+23／−6），[CI 35073978962](https://github.com/wangbinquan/CrewStation/actions/runs/35073978962) 于 2026-09-16T08:32:48Z 成功。

## 最新接力：切流时的过期确认与另一使用者页面（2026-09-16）

本批开工时 main 为 **cb0df4e6f721c2747482fee248a68fc0b987e1d6**（第八十九批已上库，CI 成功）。owner 与 admin 三个真实页面：owner 上线 v0.1.1、回退 v0.1.0 各两次（页面控件），admin 停留的确认面板在 owner 先上线后自行标记过期并禁用确认，重新核对得到反向目标；admin 开发页“生产部署”在上线后 7.6 秒、回退后 7.0 秒刷新（首轮 90 秒不刷新是无头浏览器后台页面不轮询的测试现象）。UX-AT-12／31 通过，累计 **43／52**；UX-AT-11 正常回退在浏览器完成。正式版本仍为 v0.1.0。无生产代码改动。

未做：其余 9 项 UX-AT（09／11 破坏性拒绝／14／15／27／30／42 乱序补发／48 查询失败恢复／49）。门禁：`bun run check` 2026-09-16T08:23:11Z **1344 pass／4 skip／0 fail**（1348 tests／233 files），arch 六项通过。本批提交 **4e1a69ae8001c1ef4af213e30b25c46ba497606b**（5 files，+34／−11），[CI 35073544523](https://github.com/wangbinquan/CrewStation/actions/runs/35073544523) 于 2026-09-16T08:29:33Z 成功。

## 最新接力：定向开放申请的浏览器往返（2026-09-16）

本批开工时 main 为 **b70a92f0fcbcbb59c9213aef8bf77cb3b3cb4b38**（第八十八批已上库，CI 成功）。开发者与管理员两个真实上下文：申请 `test-gitlab` 标签列表操作→管理员拒绝并写意见→开发者原行读到意见重申→管理员批准→目录“已可调 · 试调”→管理员在能力接入页撤销授权→开发者回到“未授权”，申请历史保留。UX-AT-16／50 通过，累计 **41／52**。无生产代码改动。观察：申请人／审批人显示为原始用户 ID；开发资源目录页 `h1` 为“项目设置”。

未做：其余 11 项 UX-AT（09／11／12／14／15／27／30／31／42 乱序补发／48 查询失败恢复／49）。门禁：`bun run check` 2026-09-16T08:13:17Z **1344 pass／4 skip／0 fail**（1348 tests／233 files），arch 六项通过。本批提交 **cb0df4e6f721c2747482fee248a68fc0b987e1d6**（5 files，+32／−9），[CI 35072636758](https://github.com/wangbinquan/CrewStation/actions/runs/35072636758) 于 2026-09-16T08:16:25Z 成功。

## 最新接力：成员角色撤销旅程与用户域 403 页面（2026-09-16）

本批开工时 main 为 **a9cc419825a923ebc2e8944991a226ec0e89bbb5**。owner 移除 preview 测试者后，tester 的项目列表与市场为空、试用入口消失、preview 主机 403（原因写明需要成员或测试者）、正式主机仍 200；加回后全部恢复。UX-AT-47 通过，累计 **39／52**。撤销后 tester 看到的是网关原样 JSON，现改为给人看的 403 页面（原因原话＋“返回工作台”，双主题），程序调用仍是 JSON；品牌原稿移到 identity 的 `domain/`。

未做：其余 13 项 UX-AT（09／11／12／14／15／16／27／30／31／42 乱序补发／48 查询失败恢复／49／50）。门禁：`bun run check` 2026-09-16T08:04:20Z **1344 pass／4 skip／0 fail**（1348 tests／233 files），arch 六项通过。本批提交 **b70a92f0fcbcbb59c9213aef8bf77cb3b3cb4b38**（15 files，+130／−13，含两处品牌原稿改名），[CI 35071877706](https://github.com/wangbinquan/CrewStation/actions/runs/35071877706) 于 2026-09-16T08:08:39Z 成功。

## 最新接力：数据访问申请与审批的浏览器旅程（2026-09-16）

本批开工时 main 为 **ed65e23d2005bba1b0188a38ad7b9def4066a02f**（第八十六批已上库，CI 成功）。开发者与负责人两个真实上下文完成数据访问申请→批准→撤销：开发者申请“生产数据只读”5 分钟，负责人在确认面板批准（焦点进面板、到期时间为批准后 5 分钟），开发者刷新看到“访问凭据已供给 · 接入待确认”，负责人撤销后两侧一致；开发者侧无审批按钮，可见范围页只读。UX-AT-38 通过，累计 **38／52**。无生产代码改动。

未做：其余 14 项 UX-AT（09／11／12／14／15／16／27／30／31／42 乱序补发／47 成员角色撤销／48 查询失败恢复／49／50）。门禁：`bun run check` 2026-09-16T07:51:49Z **1342 pass／4 skip／0 fail**（1346 tests／232 files），arch 六项通过。本批提交 **a9cc419825a923ebc2e8944991a226ec0e89bbb5**（5 files，+31／−9），[CI 35070751617](https://github.com/wangbinquan/CrewStation/actions/runs/35070751617) 于 2026-09-16T07:55:06Z 成功。

## 最新接力：分屏页签实机、第三次 API 卡死与走连接池的健康检查（2026-09-16）

本批开工时 main 为 **95ad85a75bb20a9bc73febc60306c5f022dde9fd**。

- UX-AT-37 通过（累计 **37／52**）：owner 真实会话三种排布切换与接口同步，键盘调整分隔线 1／1→0.65／0.35 跨刷新保持，均分复位，连点只落最后一次，页签新建／移入／移回／关闭并保留，1280／1024／768／390／320 无横向溢出。390／320 下页头占半屏记为移动端观察。
- 07:25Z cs-api 第三次卡死：进程活着、数据库十条连接全 idle、CPU 近零，但所有查库请求挂到 10s 被网关 502；`rollout restart` 恢复。本机八种事务形态压测复现不出来；Bun 1.4.x 发布摘要无 SQL 修复说明。运行时／驱动取舍写入 `implementation-open-questions.md` I16 待作者裁定。
- 自愈：`/healthz` 走同一连接池 `select 1`（3s 为界，503 带原因），五个服务的探针补 `timeoutSeconds: 5`；`cs-control-plane:dev` 重建并重启五个服务。回归 `http.test.ts`、`connection.test.ts`。

未做：其余 15 项 UX-AT（09／11／12／14／15／16／27／30／31／38／42 乱序补发／47 成员角色撤销／48／49／50）；卡死根因；重启前应先保存旧 Pod 日志（本次现场已丢）。门禁：`bun run check` 2026-09-16T07:42:52Z **1342 pass／4 skip／0 fail**（1346 tests／232 files），arch 六项通过。本批提交 **ed65e23d2005bba1b0188a38ad7b9def4066a02f**（22 files，+128／−29），[CI 35069981665](https://github.com/wangbinquan/CrewStation/actions/runs/35069981665) 于 2026-09-16T07:46:06Z 成功。

## 最新接力：市场三身份旅程、未读隔离与两处状态修复（2026-09-16）

本批开工时 main 为 **c621675a0acaf48e33f1225f0ff571bee35ba7d5**。继续用无头 Chrome 多身份上下文做真实集群旅程：

- 能力市场：owner 全部登录用户→指定用户（名单去重）→项目成员，admin 指定用户→项目成员；visitor 市场随之 0→1→2 项，搜索筛选与无匹配空态正确，撤销后旧详情“重新检查”得到明确不可见状态并回到空列表；两个项目范围已恢复为“项目成员”。UX-AT-45／46 通过，47 的两种撤销实看。
- 两位成员同看一会话：owner 定位一条结果后本人未读 12→11，developer 仍 12。UX-AT-43 通过。累计 **36／52**。
- 修复：被撤销的市场详情把 404 写成“读取失败”→独立不可见状态并保留返回；保存可见范围成功时短暂误报“暂不能保存”→后台重读只暂停提交不再提示。回归各 1 项。console `cs-console:rfc003-b85`。

未做：其余 16 项 UX-AT（09／11／12／14／15／16／27／30／31／37／38／42 乱序补发／47 成员角色撤销／48／49／50）；console Recreate 后一分钟内两条接口 10.3s→502 的偶发停顿仍未解释（cs-api 内存 152MB／1GiB、无节流）。门禁：`bun run check` 2026-09-16T07:22:46Z **1341 pass／4 skip／0 fail**（1345 tests／232 files），arch 六项通过。本批提交与 CI 见本节末尾。

## 最新接力：五身份逐页核对、暗色与键盘、cs-api 连接池卡死修复（2026-09-16）

本批开工时 main 为 **afc454bbc22d61bf5da40edc1990e532c6e937d6**（第八十三批及其记录已上库）。剩余 UX-AT 多数要求多身份并行、系统暗色与全程键盘，Chrome 扩展给不了，改用本机无头 Chrome＋CDP 浏览器上下文（脚本与 81 张截图副本在 `/private/tmp/crewstation-rfc003-batch84/`）：

- admin／owner／developer／tester／visitor 五个真实身份各 10 页（admin／owner 另有暗色）0 console error，角色边界同设计；修复非成员打开项目地址的“读取失败＋五个空入口”（改为“找不到该项目”空态、只留返回与 ID）与非管理员在 `/admin/*` 看到完整管理左栏（只留回工作台）。
- 键盘与主题：Agent 动态在按钮上按 Escape 不关闭、确认面板打开不移焦点／取消后失焦、演示登录页不跟随暗色且配色与令牌不同源，均已修复并有回归；概览 26 站 Tab 全部有轮廓，项目列表→概览→发布→检查上线→取消切换全程键盘可达且回焦。UX-AT-22／26／44／51 通过，累计 **33／52**。
- 实机故障：cs-api 一条事务持有 `dev_session.native_activity` 咨询锁后 idle in transaction 8 分钟，其余 9 条连接排队，`/v1/me` 502、工作台整体“载入中”。三层处理：写事务 try 锁轮询 1.5s 后以 precondition 失败、读取改只读快照；`connectDatabase` 补 `idle_in_transaction_session_timeout=60s`；七个平台部署清单改 Recreate（新 Pod 曾因 CPU 占满 Pending 6 分钟）。本机四模式连接池压测无残留；集群持锁 12s 下 26 并发全部 2.5s 内返回。连接带事务回池的触发条件未复现，记入 dev-gotchas。
- 镜像：`cs-control-plane:dev` 两次重建，只重启 cs-api／cs-auth；console 最终 `cs-console:rfc003-b84-final`。四个 QA CLI Pod 未受影响。

未做：其余 19 项 UX-AT（09／11／12／14／15／16／27／30／31／37／38／42 乱序补发／43／45–50）的角色与失败旅程；`release.createdAt` 为 null 的两次 TypeError 与冷启动一轮 502 未完全解释。门禁：`bun run check` 2026-09-16T07:04:16Z **1340 pass／4 skip／0 fail**（1344 tests／232 files），arch 六项通过。本批提交 **c621675a0acaf48e33f1225f0ff571bee35ba7d5**（32 files，+442／−33），[CI 35066748980](https://github.com/wangbinquan/CrewStation/actions/runs/35066748980) 于 2026-09-16T07:07:49Z 成功。

## 最新接力：RFC-003 视觉对齐、有界首次回放与整体部署（2026-09-16）

作者以 `/goal 接手RFC003并完整实现，首要考虑的就是UX体验，遵循目标设计风格和体验，并提交上库` 接续。本批开工时 main 为 **9fda01fe80755c5e6093076a8c3cadda6bd664ea**（RFC-004 落地已上库）。先在 Chrome 并排比对已部署工作台与设计附件 prototype.html，再按附件重做外壳与关键页面：

- 令牌改用附件的明暗两套配色与 6／8 圆角；左栏改浅色面＋淡蓝当前项，项目内只留返回、项目名与五个入口；顶栏承载“能力市场／数字人项目”两枚全局入口，管理左栏按待处理／供给与接入／平台设置分组；共享页签改下划线式。
- 概览新增只依据有效事实的“下一步”横幅与以标签为标题的两张版本卡；发布页版本卡同样以标签为标题、保留完整 SHA；诊断槽名改为产品名称。
- 开发页页头改为一行标题＋状态＋右侧“数据访问／会话／准备发布”，`＋ CLI` 为主按钮、布局按钮合成分段控件、终端状态做成色块；1280×720 真实四窗首窗 205px、四标题与 12 行可见（UX-AT-35 通过，累计 29／52）。
- 修复真实缺陷：开发页首次打开从 seq 0 起按 2000 条逐页重连回放 77,105 条历史，长时间停在“连接中”；新增 `replay=tail`，工作区首次只回放最近一页并注明起点，历史对话页仍从头回放；session 与 console 各加回归。
- 本机平台整体部署到当前树（API／session／controller／console／任务镜像；`agent_runtime` 迁移已应用）；期间节点磁盘用满致 PostgreSQL 崩溃，只清理可再生的构建缓存、悬空镜像与旧 `cs-*` 标签后恢复；四个 QA CLI Pod 临时调至 150m 以让滚动更新调度，完成后恢复 400m，UID 与重启数不变。console 部署改为 Recreate 并写回清单。

门禁：`bun run check` 2026-09-16T05:44:28Z **1329 pass／4 skip／0 fail**（1333 tests／228 files／7478 assertions），arch 六项通过；console build 505ms。未做：暗色主题实看、全程键盘、其余 23 项 UX-AT 的角色与失败旅程；RFC-004 实机验收另见其 plan.md。本批提交 **b85930dfb922d3e8e07dbdaf55c226d930ef7bac**（59 files，+661／−215），[CI 35061013350](https://github.com/wangbinquan/CrewStation/actions/runs/35061013350) 于 2026-09-16T05:54:40Z 成功（job `check`）。下一步：暗色主题与全程键盘实看（UX-AT-26），再按角色（测试者、管理员、开发者）与失败旅程逐项补其余 23 项 UX-AT 的实机证据。

## 最新接力：RFC-004 代码落地（2026-09-16）

本批开工时 main 为 **d494ac870bfa3af79573553082b7f6027906da5e**（与 origin/main 同步，工作树干净）。作者以 `/goal 完整落地RFC-004并提交上库` 覆盖原“RFC-003 完结后启动”的排期，本批只做生产代码、自动化测试与文档，没有部署或实机验收。

落地范围（均随测试）：
- **契约**：`packages/contracts/taskrunner/beforeStart.ts`／`beforeStartTemplate.ts`（两类步骤、模板语法、`CS_HOOK_ENV_OUT` 输出协议、启动材料、执行记录、限额）；Runner 协议 hello `agentRuntimeConfig`／`interpreters`、`startAgent.runtime`／`processAttemptId`、`beforeStart` 事件；管理员 API `api/agentRuntime/*`；档位 `runtimeConfigId`／`revision`／`expectedRevision` 与租户投影 `{mode, available, reason}`；`AgentInstanceState` 新增 `preparing`；`TaskKind` 新增 `runtime-check`。
- **新模块 `modules/agent-runtime`（L3，ADR-0004）**：运行环境、不可变版本、凭据（SecretBox 加密，keep／replace／clear，GET 不含原值）、检查记录、草稿 CAS、启用只接受同版本同内容哈希的通过检查、停用保留启用版本；管理员路由 `/v1/admin/agent-runtime-configs…`；检查作业经 `packages/queue` 工作器执行。
- **档位与统一解析**：`modules/project` 档位绑定与 CAS、`RuntimeConfigDirectory` 端口；`modules/platform/wiring.ts` 的 `computeCatalogFor` 在受理时固定已启用版本，dev-session／business-task 只在下发命令时按固定版本取材料；驱动不一致报 `runtime_driver_mismatch`。
- **Runner**：`runtimes/task/src/beforeStart/*`（原子写、共享路径登记、bash／python3／bun／自定义解释器、进程组终止、输出协议、按 `processAttemptId` 幂等、每容器串行）；托管 Agent 私有 HOME；`Dockerfile` 加 `python3`（镜像未重建）。
- **CLI 合成**：`packages/agent-drivers` Claude `CLAUDE_CONFIG_DIR`＋唯一 `--settings` 合成、OpenCode `OPENCODE_CONFIG` 合成保留 provider options。
- **检查执行**：`modules/task-runtime` 的 `runtime-check` 任务（平台命名空间、哨兵项目准入上限 4、oneshot Agent、固定回文标记、镜像 digest／CLI 版本／解释器上下文、容器或 Runner 丢失记 unknown 不自动重跑）；`modules/session` 在写入前拒绝不支持的 Runner。
- **控制台**：`/admin/compute` 双页签（算力档位｜运行环境，查询串直达 `tab`／`config`）、运行环境列表与建档、步骤表与文件／脚本编辑器（路径预览、示例脚本、排序／复制）、变量与凭据、配置绑定与模型、检查时间线与启用／停用确认、草稿冲突保留；档位表单可绑定运行环境并显示就绪；租户面不可用档位禁选并给出原因，`preparing`／准备失败状态可见。

门禁与构建：`bun run check` 于 2026-09-16T03:54:20Z 通过，**1325 pass／4 skip／0 fail**（1329 tests／227 files／7455 assertions）；`tools/arch` 六项规则通过、无新增例外；console `bun run build` **494ms** 成功。提交与 CI 见本节末尾。

未完成（不据自动化结果宣称已可用）：任务镜像重建与平台重新部署（含 `agent_runtime` 迁移）、真实运行环境检查、两类 CLI 经 Hook 的真实模型轮次、管理 UX 多分辨率／主题／键盘验收，以及 RFC-004 plan.md 中全部 AR 的实机证据。RFC-003 的剩余验收不受本批影响，继续按其 implementation 记录推进。

本批提交 **1562ccc16af579feffd12ed5fa0c07d67c2d6eef**（191 files，+5660／−239），[CI 35053685096](https://github.com/wangbinquan/CrewStation/actions/runs/35053685096)／job 104659252779 于 2026-09-16T03:59:05Z 成功。下一步：重建任务镜像并重新部署本机平台（跑 `agent_runtime` 迁移），在管理空间建一份 OpenCode 运行环境并执行真实检查，再按 plan.md 实施说明逐项补 AR 实机证据。


## 最新接力：破坏性迁移与生产版本差距（2026-09-16）

第八十一批已发布 **2b26eff50e00f26759d4ec5c260af4955f09a49c**，[CI 34994499199](https://github.com/wangbinquan/CrewStation/actions/runs/34994499199) 成功；本批开工 fetch 后 main／origin/main 同步、工作树干净。继续完成专用 delivery QA 的真实迁移分支，无平台生产源码变化。

GitLab 108 精确提交两份验收文件，SHA **cb58ea979235b68b9160f46a5650aebdeb46a9f5**。先将原 v0.1.1 上线建立待命候选，再临时开启本机 controller 维护窗口，经正常发布得到 v0.1.2／**rel_01a0a5f4bd34700086684156f43c0f3b**。16:44:49Z 迁移 Job 成功：仅在 cs_rfc003_verify_delivery 创建专用空表 rfc003_migration_probe_0916_b82 并删除 obsolete 列，行数始终 0；未触碰应用表。16:46:15Z 新版本正式上线，切回 v0.1.1 返回 **412／当前版本 v0.1.2 含破坏性迁移，不能切回旧版本 v0.1.1**，拒绝前后槽位和两条切流记录保持，两个地址均健康。

controller 原 spec 已完整恢复、generation=34、镜像仍为第八十批；四 CLI CPU 全部恢复 400m、原进程和重启数保持。专用两槽各预约 25m，合计仍为原先的 50m，其他服务套餐保持；新套餐 rfc003-delivery-qa 只用于本验收。16:48:14Z 原五任务、四 CLI 和七份受保护文件摘要保持。空表和新正式／旧待命槽保留供浏览器验收，不再重复切流。

delivery 原工作树仍为 ea10bd3／main，十项未跟踪缓存和未推送 0 保持。新目标 Git 对象初次缺失，正常“补齐历史”接口后明确 **落后生产 1 个提交（0／1）**，没有替换工作树。浏览器连接再次超时并重置控制内核，手动解锁／恢复连接的询问仍待回复；tab 16／17 草稿没有发送或清除。**完整界面累计仍 28／52，RFC-004 继续按约定等待 RFC-003 完结。**

## 最新接力：真实角色切流与数据访问（2026-09-16）

第八十批已发布 **fc10d203eef13bd532f03276021262d522f55b4c**，main 与 origin/main 同步，[CI 34991673665](https://github.com/wangbinquan/CrewStation/actions/runs/34991673665)／job 104457603375 于 2026-09-15 15:58:04Z 成功。本机仍为已核对的第八十批 API／controller 和专用代理 v0.1.5；本批无生产源码或部署变更。

真实代理禁止回退返回 412，原因明确，槽位和历史保持。workbench 的 rfc003-owner 临时切至 v0.1.1，admin 的旧确认被 412 拒绝，原开发会话的比较目标随即采用新 releaseId／tag；随后负责人恢复 v0.1.0。两次相同源码版本切换没有改工作树。首轮验收脚本把该前置条件误写为 409，已按既有契约纠正，初始证据保留；没有据此改产品行为。

实际 developer 分别申请五分钟生产只读和生产读写，本人审批均 403，owner 批准后均 active、期限准确；原容器没有载入这两组连接变量，显式默认连接实查仍为 cs_rfc003_verify_workbench_dev。两项授权均已撤销，临时角色回收，原进程保持。这是实际授权／凭据载入／数据源选用的区别，不将 active 当作应用已切生产。

**界面实机验收仍等待手动解锁 Mac 并恢复浏览器连接。** CUA 曾短暂完成代理筛选和会话绑定，但随后原生与浏览器连接均不可用；工具明确报告 Mac 锁定、自动解锁失败及浏览器 fetch 失败，已向用户询问恢复状态。临时视口已 reset；没有继续猜测控件或绕过锁屏。累计保持 **28／52**；RFC-004 按用户约定等待 RFC-003 完结。保护对象和续接地址见前批；原 tab 16／17 的 CLI 草稿没有发送或清除。

## 最新接力：代理出站与真实消费者调用（2026-09-15）

第七十九批已发布 0738692ac8c7f650cd56d98096b549046552e744，[CI 34985845854](https://github.com/wangbinquan/CrewStation/actions/runs/34985845854) 于 15:05:55Z 成功。第八十批完成 I9(a) 的代理 HTTP 出站：按真实代理服务身份读取管理员全局／项目域名规则，拒绝记录归属代理项目；批准和撤销在下一次请求生效。参考代理自动使用平台服务域通道，保持上游状态、分页头和响应体，不新增网络策略放行。

14 份源码候选完整门禁 **1287 pass／4 skip／0 fail**（1291 tests／216 files／7163 assertions，15:21:30Z），console build **540ms**，摘要保持。API／controller 已部署 cs-control-plane:rfc003-b80-415023304a60，generation=48／32，实际 14 份源码匹配；session 与 console 保持此前版本。专用代理正常发布 v0.1.4，再以同 SHA 8d1d05e、生产配置第 3 版发布 v0.1.5，15:41:30Z 正式切至后者。

真实调用完成未批准 403→批准 200→撤销 403→重新放行 200，GitLab 匿名读取没有使用密钥。实际 QA developer 收到拒绝理由后补充申请，由 admin 批准单个 GET；裁剪 Swagger 只含该操作，原开发容器经共享网关返回 HTTP 200／真实 trace／分页头，既有 OpenCode MCP 连接返回同一 granted 操作。审批到网关下发有短暂延迟，首个 403 留档，没有冒称立即成功。

两次构建临时调整四个闲置 CLI 的 CPU requests／limits 400m→150m，均已恢复 400m；15:49:48Z 核对原五任务、四 CLI UID／进程／重启数及七份文件摘要保持。IAB 可读页面、可选择筛选项，但点击仍在工具派发前超时，实际浏览器提交和试调尚未补齐，**累计仍 28／52**。RFC-004 继续等待 RFC-003 完结，不提前实施 Hook。下一步完成浏览器试调及其余角色／布局旅程；本批已准备精确发布与 SHA CI 核对。

## 最新接力：版本比较、活动超时与单窗恢复（2026-09-15）

第七十八批已发布 89c9f5b7017a71a2933c5af870f9d5876472cac6，[CI 34980482125](https://github.com/wangbinquan/CrewStation/actions/runs/34980482125) 于 14:23:17Z 成功。第七十九批修正 Kubernetes 自动注入的端口变量污染 session 地址、内部 HTTP 无期限等待，以及活动同步卡住后长期占住任务的问题。活动存储等待不再阻止健康 CLI 列表，超时后可重新同步；迟到补齐不继续发起投影写入。

最终 10 份源码候选门禁 **1282 pass／4 skip／0 fail**（1286 tests／215 files／7111 assertions，14:53:32Z），console build **492ms**，摘要保持。真实数据库锁等待／解锁恢复回归通过。三个控制服务已更新 cs-control-plane:rfc003-b79-final-43caf7d73d62，session／API／controller generation=21／46／30，各十份运行文件匹配；console 保持第七十八批。14:57:03Z 普通 API 名册 26ms、活动 21ms，均 ready，原 CLI 身份保持；完整版本比较 6.127 秒返回工作树领先 1、未提交 143、未推送 1。

真实页面完成 OOM 窗手动重开、配额已满时双击只登记一次失败、正常结束另一窗并保存末屏、释放额度后手动重开；同一失败请求重复 POST 两次仍返回原失败身份，没有额外进程。15:00:51Z 四个子 Pod 正常、原五任务和七份文件摘要保持。**UX-AT-28 通过，累计 28／52，剩余 24 项。** 四窗输入与最终密度、布局、多角色等继续；RFC-004 等 RFC-003 完结，不提前实施 Hook。

本机 QA 父 Pod 已原地把 CPU 100m 调为 300m，原 UID／容器／进程及内存保持；这是已授权的本机调优，目录中的冻结套餐仍为原值，不冒称动态资源产品能力。滚动时旧 Runner 约两分钟重连，期间短暂 502 未作为成功证据。完整过程、初始与最终候选区别见 implementation 第七十九批；提交与精确 SHA CI 随发布核对。

## 最新接力：独立四窗实跑与紧凑界面（2026-09-15）

第七十七批已发布 4b9bf0001b8ff08d2f9ed79b354b617a69b93e5f，[CI 34974881386](https://github.com/wangbinquan/CrewStation/actions/runs/34974881386) 于 13:28:24Z 成功。三项追加迁移已应用；session／controller／API／console 顺序更新为第七十七批，实际源码摘要匹配，原五个任务和工作卷保持。

管理员将 OpenCode 档位绑定 400m CPU／2Gi 独立套餐。真实页面新建空页签后逐次启动四个独立 Pod，共享原工作树；两个 Big Pickle 实际模型轮次重叠 14.406 秒，第三窗在独立预览打开时完成，全局／页签未读同步增加。第四窗注入 OOM，内核记录 OOMKilled／137，该 Pod 单独回收、配额 5→4，其余三窗继续在线。14:12:05Z 原五任务 UID／重启数和七份业务／Git 摘要保持。失败窗没有自动重跑。

第七十八批修复实机发现的密度及错误文案：恢复成功收进工具栏，比较错误可展开、直接重新检查，长档位名不再挤成双行；OOM 显示“CLI 运行失败”，不再称为模型轮次失败或启动失败。完整门禁 **1277 pass／4 skip／0 fail**（1281 tests／214 files／7094 assertions，14:07:21Z），console build **531ms**，16 份源码候选保持。本机 console 已更新 cs-console:rfc003-b78-d5774d13901f／generation=53／1／1，实际七份文件一致，真实页面已读到新文案。

继续处理版本比较：原 100m CPU 工作树被约 97 MB npm 缓存拖慢，直接检查耗时 18.657 秒；普通 API 请求另有超时。14:13Z 只读连接表定位到 session 副本地址错误拼成 http://PodIP:tcp://ServiceIP:8083，CS_SESSION_PORT 与 Kubernetes 注入变量冲突；下一步修正并验证转发、回放与工作树比较。四窗密度／新增失败恢复完整条件仍未关闭，**累计保持 27／52**；RFC-004 按批准顺序等待 RFC-003 完结，Hook 未开工。

## 最新接力：独立 CLI 已接入工作台（2026-09-15）

第七十七批完成管理员算力档位到 CLI 资源套餐的绑定、逐窗持久受理／派发、每窗独立 WebSocket、跨 Runner 动态聚合及退出末屏。父断线不掩盖仍在线子 CLI；关闭页签只撤销显示连接，正常退出先保存末屏再回收。旧名册继续走原父 Runner，不迁移已有进程。

新增 17 条回归，完整门禁于 13:15:22Z 通过：**1274 pass／4 skip／0 fail**（1278 tests／214 files／7076 assertions，测试 115.59s、命令 137.38s）；console build **644ms**，52 份候选源码保持。真实数据库先检出末屏状态双重引号，改为文本到 JSON 转换后复验通过；React 双窗、切页签、只读末屏和管理员选择均通过。

第七十六批已发布为 614e4a7f4987ed918edcf7f56b53fe15b9d58467，[CI 34970139732](https://github.com/wangbinquan/CrewStation/actions/runs/34970139732)／job 104384138940 于 12:42:01Z 成功。当前第七十七批正在发布、部署和实机验收；本机目前仍是第七十五批。节点 CPU 预约已满、容器节点磁盘余量约 1Gi，采用增量镜像与顺序替换；开发容器、工作树和原 CLI 保持。真实四窗／OOM 尚未通过，累计仍 **27／52**，RFC-004 等待。

## 最新接力：逐 CLI 独立执行环境底层（2026-09-15）

第七十六批继续 I15 已选方案 (a)，实现 task-runtime 独立执行容器、冻结资源、原工作卷引用、项目原子准入、持久准备／清理和父子生命周期。每次执行独立占额，创建响应丢失、控制器租约转移、延迟删除和清理重试都接续原实例；子 OOM 只清理该实例，父释放等待子 Pod 全部退出，父保卷恢复保留仍运行的子 CLI 并约束到原节点。Runner 的内部执行身份与 Agent 使用的父工作区身份分开。

15 条新增数据库／假集群回归与 2 条 Runner／真实 PTY 回归已执行通过。首轮完整门禁 1256 pass／4 skip／1 fail，唯一失败为现有本机 GitLab 新会话凭据首次推送；源码未改的 GitLab 专项复验为 5 pass／0 fail。最终完整门禁 **1257 pass／4 skip／0 fail**（1261 tests／210 files／6977 assertions，测试 124.99s、命令 148.30s），12:31:26Z 通过，console build **535ms**，37 份源码候选保持。首次失败日志保留，不跳过该测试。task-runtime 归并同一恢复集群端口后为 40 份生产源码／1900 行，结构检查通过。

**当前“＋ CLI”尚未切换到新环境。** 下一批接管理员算力档位的任务套餐、dev-session 启动派发、各窗独立连接、按来源聚合动态和退出末屏，再更新本机服务与任务镜像并完成真实四窗／OOM 旅程。本批尚未部署、未重启现有 QA 容器；本机仍是第七十五批。验收保持 27／52，RFC-003 仍 In Progress；I9 继续，RFC-004 按顺序等待。隔离契约与实施边界见 cli-isolation.md。

## 最新接力：原工作树保卷恢复已实现（2026-09-15）

第七十五批完成 I14：失败会话可检查原工作卷、选择管理员套餐、保留 taskId／文件／未推送提交／个人布局重建容器。持久队列、准入锁、重复受理、UID 核对、创建回执丢失接续、超时和失败补偿、旧 Runner 拒绝均已落地。

原 workbench QA 首次 1 CPU 恢复因本机调度不足而超时，原 10Gi 工作卷保持。重新检查后选择已有 100m／2Gi 套餐，11:21:12Z 实际就绪；原 HEAD 1aa2db9f9578edfce15dbf314f74302ac523de83 与七份文件摘要、PVC UID 全部一致，旧六个 CLI 均明确结束且没有自动重跑。新“工作区 3”手动启动一个 OpenCode，真实返回 RFC003_RECOVERY_OK_0915；独立预览正常、工作树领先生产 1 个提交。新 CLI 状态源仍报告 unsupported-version，不能算后台完成通知通过，继续追查五秒版本探测及 I15。

实机发现的挂载提示过早、确定失败仍锁定旧请求已先红后绿修复。最终 68 份源码候选完整门禁 **1240 pass／4 skip／0 fail**，console build **544ms**，候选摘要保持。迁移已应用；controller／console 为本批 final-19272ba002、generation=24／49；API 为归并后的 publish2-229a686b71／40，session 为本批首镜像／15，均 1／1。运行文件和正常 HTTP 产物一致，其他三个 QA 原进程与受保护文件保持，节点无压力。

**UX-AT-34 通过，累计 27／52，剩余 25 项。** RFC-003 仍 In Progress，下一步 I15 独立 CLI Pod、I9 出站及其余完整旅程；RFC-004 等待 RFC-003 完结，Hook 未开工。授权已明确，不再因常规开发、部署或上库索要确认。细节和验收边界见 implementation 第七十五批。

## 最新接力：真实角色旅程与测试者试用入口（2026-09-15）

作者已明确“授权你所有动作，赶紧做”，第七十四批已继续执行原具体方案：files QA 正式切至 v0.1.8，工作树页面实际显示 f04fd60 对生产 5719c03 **分叉 1／3、未提交 2、未推送 1**；正式应用正常。rfc003-verify-workbench 已由 rfc003-owner 负责，其本人通过精确邮箱添加 rfc003-developer／developer 和 rfc003-tester／tester，两账号实际访问已核对，测试者打开真实 v0.1.1 预览。**UX-AT-17 已通过，累计 26／52，剩余 26 项**。

本批真实发现开发者生产配置仍有编辑表单、测试者项目入口被 view 权限拒绝。现生产配置仅负责人／管理员可编辑，开发者只读；测试者列表和所有项目深链接显示准确试用版本、完整 SHA、共享生产数据说明。后端按既有 view-preview 权限只读取待验证槽。角色暂时变化保留此前草稿，初次测试者访问不挂载内部工具；首次访问、失败／空槽／部署中／就绪及恢复均有回归。

最终 37 份源码／测试候选完整门禁 **1214 pass／4 skip／0 fail**（1218 tests／200 files／6690 assertions，测试 108.37s、命令 126.95s），09:58:37Z 通过；console build **609ms**。前一候选曾有五条旧测试者夹具失败及一处 lint 错误，均已修正后重验；候选此后保持。10:01:03Z 正常登录四个既有 QA 账号，新 API 返回 owner／developer 各自摘要、tester 精确 preview v0.1.1；visitor 返回 404。

市场真实完成空指定名单字段错误、取消保留、owner 保存全部登录用户、admin 旧修订冲突保留指定名单、显式采用新修订后保存；visitor 实际见到应用，再撤回范围后旧详情与列表清除。当前可见性 revision=3／项目成员。I9／I14／I15 已按本次全权委托选择各方案 (a) 并落档，下一步实现管理员白名单出站、保卷重建、独立 CLI Pod，共享工作卷保留；不再以授权问题阻塞。

本机 API 已更新第七十四批／generation=35、console 同批／46，均 1／1；运行摘要链和全部文件匹配，正常 HTTP 六份产物一致。10:04:55Z 原任务、受保护文件、失败 Bound 工作卷和业务部署保留，节点无压力；只有 files 活动时间和 delivery／legacy 空闲提醒时间变化。Mac 在本批后段锁屏，多账号新界面复验仍待手动解锁；IAB 管理页面可继续读取，原终端页签与未发送草稿保持。此限制只影响相应浏览器分支。RFC-003 保持 In Progress，RFC-004 按批准顺序等待其完结。

## 最新接力：动态历史翻页与关闭后的恢复（2026-09-15）

第七十三批修复 Agent 动态的迟到历史响应：加载“更早未读”时关闭面板，旧响应原来会重新装回历史页、旧请求仍锁住翻页；已离开的历史页读取失败还会把成功刷新的最新动态标为过期。现关闭即清除历史请求归属与等待，同一游标重新打开也只接收本次读取。三项新增回归先 **9 pass／3 fail**，最终连同新补的同游标轮询回归，定向 **16 pass／0 fail／60 assertions**；完整门禁 **1208 pass／4 skip／0 fail**（1212 tests／198 files／6608 assertions，测试 110.28s、命令 130.05s），console build **592ms**，三份候选文件保持。

仅更新本机 console 为 **cs-console:rfc003-b73-b908c094f7／generation=45／1／1**。08:53:10Z 七份运行文件匹配；containerd 报告索引摘要，已核对索引→清单→Docker 配置摘要关系，没有因首次摘要类型断言失败重复部署。08:55:05Z 正常已登录 HTTP 六份静态产物匹配，构建入口 index-C60BdeDC.js；本批没有读取浏览器页面，不计实机交互通过。

08:53:45Z 三个 QA 的 taskId／session／native／历史 Agent／activity／workspace 均与第七十二批一致；files 分叉 f04fd60／1／3 保留。08:54:23Z 原任务、受保护文件、失败 Bound 工作卷及业务槽位保持；API 第七十一批／34、controller cc93104／21 均 1／1，节点无压力，剩余 1,657,032,704 bytes。导入仅新增 3,723,444 bytes，未改变个人布局或操作原 CLI 草稿，八个既有页签仅续留接力标记。

**累计仍 25／52 通过、27 项待完成**。具体正式切流授权和此前浏览器审批阻断尚未解决；I9／I14／I15、成员范围及其余旅程继续待处理。RFC-003 保持 In Progress，RFC-004 排队、Hook 未开工。本批三份源码／测试和三份证据文档精确上库，最终 SHA CI 独立核对。

## 最新接力：真实 Git 分叉样例与待授权切流（2026-09-15）

第七十二批继续 UX-AT-30。files QA 原 HEAD e4741df56b440d776b7c25ff5a4978b3d5822f46 相对待验证 v0.1.8／5719c033e3ac781eb6e3efcdf1c8e6da02018f34 为 **0／3**，双方文件树相同。仅向 README 追加四行验收说明时，未提交 2→3、提交差与未推送 0 不变；正常精确提交后 HEAD 为 **f04fd60af6f387cbd904be70fcace50fcfbb0622**，真实 Git 和正常比较 API 均为 **分叉 1／3、未推送 1、未提交 2**，双方提交详情准确。该 QA 提交留在已有 codex/rfc003-files 分支，尚未推送，供后续实机验收；原 README 前缀完整保留，index 为空，原两项缓存保持。

浏览器已实看“尚无生产版本”并准备好 v0.1.8 的正式切流确认，但点击被自动审批拒绝，理由是现有授权未明确涵盖该次正式切流；已向作者发出精确范围确认，**没有执行切流**。随后只读浏览器检查又因审批服务“Selected model is at capacity”被拒，未换浏览器或其他路径重试被拒操作。实际页面分叉及生产目标关系尚未验收；不能用 Git／API 结果代替。tab 19 保留待确认面板，tab 22 保留差异页；files 个人布局只从 cli 改为 changes，revision 14→15，其余内容保持。

08:23:33Z 原三个 QA 的 native／历史 Agent／activity 保持；仅 files 工作树包含上述文档提交。08:24:12Z 原任务、其他受保护文件、失败 Bound 工作卷和全部业务槽保持；API 第七十一批／34、console 第七十批／44、controller cc93104／21 均 1／1，节点无压力。README 当前摘要为 50eff46078d21d75a4c2ced98c7e2b82a99e63e26d8287bbfb940c9a0b68727e。主仓本批仅更新三份证据文档，源码与 63e5031 一致，复用第七十一批有效门禁，文档提交的精确 SHA CI 另核对。

**累计仍 25／52 通过、27 项待完成**。RFC-003 保持 In Progress，RFC-004 等待其完结。下一步待具体切流答复与浏览器审批恢复后，先重读确认对象，再在实际页面核对当前分叉样例；不要合并、覆盖或释放该 QA 工作树来制造一致状态。

## 最新接力：禁止回退原因与拒绝后恢复（2026-09-15）

第七十一批修复回退错误原因：仅声明 `rollback: blocked` 的版本原来被误报为“含破坏性迁移”，现明确为“发布配置禁止回退”；既有迁移判定和切流行为保持。真实数据库回归先 **5 pass／1 fail**，最终定向 **16 pass／0 fail／138 assertions**，完整门禁 **1204 pass／4 skip／0 fail**（1208 tests／198 files／6601 assertions，测试 154.76s、命令 177.59s）。两份最终源码／测试候选此后保持。

专用管理接入先上线 v0.1.1；v0.1.2 仅声明破坏性迁移、没有迁移命令，实际因非维护窗口被拒，没有迁移 Job，原正式应用仍正常。随后正常发布并上线仅禁止回退的 v0.1.3；旧 API 复现误报，新 API 实机给出准确原因。两次拒绝均保留原说明、清除旧确认，正式 v0.1.3／201fe8ef5cf05b707cb361a68f878b39090e8419 与待命 v0.1.1／018627a17889e219ae34ae7753bb8170796c3f2c 保持，切流记录仍 2 条，实际两个地址均 HTTP 200。

本机只更新 cs-api 为 cs-control-plane:rfc003-b71-72bbbd23ce／generation=34／1／1，07:54:37Z 实际 Pod 镜像和文件摘要匹配；console 第七十批／44、controller cc93104／21 保持。专用服务套餐 CPU 100m→50m，旧验收 green 按相同值滚动更新，新 blue 使用该套餐；两次新 Pending 构建仅调整 CPU 1→100m，内存保持。07:56:21Z 原任务、四份受保护文件、失败 Bound 工作卷及旧业务槽位保持，节点无压力，剩余 1,464,143,872 bytes；旧 Agent／工作树及 tab 17 未发送草稿保持。

**累计仍 25／52 通过、27 项待完成**。UX-AT-11 已补真实策略拒绝和非维护窗口失败，仍缺含破坏性迁移的已上线版本在浏览器拒绝回退的完整分支；未开启全局维护窗口或执行破坏性命令。RFC-003 保持 In Progress，RFC-004 继续等待其完结，Hook 未开工。两份源码／测试和三份文档精确上库，最终 SHA CI 独立核对；详细证据见 implementation 第七十一批。

## 最新接力：管理接入全程与构建等待原因（2026-09-15）

第七十批完成 **UX-AT-20**。管理员在管理空间创建 rfc003-verify-integration，开通后修改并保存 Manifest、提交六份验收源码，再从当前开发会话发布 v0.1.1，实际就绪 1／1，最后返回接入列表。发布固定 SHA 018627a17889e219ae34ae7753bb8170796c3f2c，采用生产配置第 2 版；正常预览 HTTP 200 返回唯一代理身份。未切正式流量，也未完成上游 API 调用。

真实首次构建因 CPU 不足等待，但日志原来显示“尚无日志”；现在给出 PodScheduled=False 的调度原因，恢复调度后可正常读到日志。创建确认中“补齐配置，再重新开通”也改为首个发布失败后使用新版本号重新发布，与实际异步发布链路一致。中英文最终页面均已核对，文案检查草稿已放弃，没有额外创建项目。

最终五份源码／测试候选的定向检查 **21 pass／0 fail／164 assertions**，完整门禁 **1200 pass／4 skip／0 fail**（1204 tests／198 files／6585 assertions，测试 110.19s、命令 129.94s），console build **670ms**；源码此后保持。API 为 cs-control-plane:rfc003-b70-6d1ae2d769／generation=33，console 为 cs-console:rfc003-b70-6d6f89a540／generation=44，均 1／1；实际 Pod 文件和正常 HTTP 资源已匹配，controller cc93104／21 保持。

本次新增验收服务套餐和任务套餐均为 rfc003-integration-qa；服务使用前者，后者未被当前开会话入口选用。仅本次新建的两个 Pending 构建及开发 Pod 经 resize 调整 CPU，内存保持；新会话确认未提交／未推送均 0、没有 CLI 后正常释放。07:14:16Z 原任务、四份受保护文件摘要、失败 Bound 工作卷及旧发布槽均保留，节点 Ready、无压力，剩余 1,480,384,512 bytes。旧 Agent／工作树、两份个人布局及 tab 17 未发送草稿保持。

**累计 25／52 通过、27 项待完成**。APIProxy 的开发预览 HTTP 返回 JSON，但本机嵌入浏览器画面为空，尚未定位，不计可视预览通过；I9／I14／I15、具体角色范围及其余旅程仍待处理。RFC-003 保持 In Progress，RFC-004 继续等待其完结，Hook 未开工。源码和三份文档精确上库，最终 SHA 托管 CI 独立核对；详细证据见 implementation 第七十批。

## 最新接力：文件差异与阅读位置收口（2026-09-15）

第六十九批完成 **UX-AT-32**。状态列用“暂存区／工作区”解释 MM／MD；长路径在列内换行，表格由固定 1356px 恢复为随容器排版；10 秒重查现在保留当前页签和文件，只清除旧分页游标。文件从新差异中消失后仍能返回列表。

专用 files QA 真实核对暂存、未暂存、未跟踪、删除、二进制和 64 KiB 截断。最终页面跨 52 秒自动更新，原页签与删除 Patch 保持。通过正常按钮补齐缺失 Git 对象后，工作树独有 0／缺少待验证 3 个提交；临时文件只影响未提交数量，未推送为 0。样例已恢复：HEAD 和原文摘要保持、index 为空、只剩原有两项缓存，未提交 6→2，部署和提交差距不变。

回归先红后绿，最终定向 **30 pass／0 fail／82 assertions**；最终八份源码／测试完整门禁 **1197 pass／4 skip／0 fail**（1201 tests／198 files／6578 assertions，测试 103.25s、命令 121.83s），console build **494ms**。此前两个候选在实机发现新问题后才修改并重验，证据保留。

本机 console 为 cs-console:rfc003-b69-eb9e06268c／generation=43／1／1，imageID=sha256:a5b3ae7f0a4eae00f6db8ce719c513d91cf07b8fab7b7e044134aaa420ea4f67。05:57:26Z 实际 Pod 七份文件、05:59:10Z HTTP 六份资源匹配，页面 index-Dk6dzdsp.js。06:01:57Z 原任务／受保护文件／失败 Bound 工作卷／业务槽位保持；API ebaa730／32、controller cc93104／21 均 1／1，节点无压力，剩余 1,568,153,600 bytes。

三个 QA 的 Agent、活动与工作树保持；个人布局内容恢复，原 tab 17 草稿和可输入未动，tab 22 回到 files 工作区且未取得输入控制。仅 files 活动时间及 files／legacy 空闲提醒时间更新；语言和视口恢复。源码及三份文档精确上库，最终 SHA CI 单独核对。**累计 24／52 通过、28 项待完成**；摘要部分故障不能以“未部署”代替，UX-AT-27 仍待验。I9／I14／I15 与具体成员范围待答复，RFC-004 等待 RFC-003 完结。

## 最新接力：长页签与响应式验收收口（2026-09-15）

第六十八批完成 **UX-AT-25**。历史长页签在 320px 原本宽 328.43px、标签条可用内容仅 262px，横向移动会让名称和状态分离；现在限制单项宽度并内部换行，两者同时可见。英文 CLI 的“未读结果”标签也由超出标签条改为完整换行，宽屏和普通短标签保持原尺寸。实机五尺寸、键盘 Home／End 与焦点框均已核对。

本轮 20 个页面状态、100 次五尺寸量测均无整页横向溢出或可见控件越界；另有 16 次长标签与选中项记录。补齐 APIProxy／EventProducer 创建的约束、中文错误、资源、78 字名称确认与放弃保护，以及开通状态、登录、未知地址、发布来源／版本表单和上线确认区。7 个页面状态在最终镜像复验，前 12 个页面状态与静态登录页来自本轮修复前部署。结合第六十四至六十七批覆盖的主路由、表格、开发面板和菜单证据，响应式条件已满足；完整键盘／实际系统主题、四窗与多角色仍按各自条目继续。

两份 CSS 候选完整门禁 **1177 pass／4 skip／0 fail**（1181 tests／197 files／6540 assertions；测试 108.17s、命令 127.24s），console build **489ms**。仅更新本机 console 为 `cs-console:rfc003-b68-2048ebc047`／generation=40／1／1，imageID=`sha256:abcb716bede8111af36491c6fec70e2647139fb157e35148ce1edc76f1d9cb69`；05:05:22Z 实际 Pod 七份文件、05:07:57Z 正常 HTTP 六份资源匹配，页面 index-CbQU6d-3.js。新增导入 3,721,394 bytes，未清理数据或调零其他服务。

05:11:20Z 三个 QA 的 taskId／native／历史 Agent／活动／工作树保持（仅 checkedAt 另计），只有 delivery.lastActivityAt 更新；个人布局内容恢复，正常导航使修订 10→12。原 tab 17 未重载，中文草稿、可输入、单 CLI／工作区／未读完成 1 保持；tab 22 返回 files 资源页，语言和临时视口已恢复。正常 API 确认没有创建临时项目、新增发布或切流。

05:11:37Z 原任务 UID／容器状态／四份文件摘要、失败 Bound 工作卷及各预览／正式槽保持；API ebaa730／32、controller cc93104／21 均 1／1，节点 Ready=True、无内存／磁盘压力，剩余 1,760,190,464 bytes。源码及三份文档精确上库，最终 SHA CI 单独核对。**累计 23／52 通过、29 项待完成**；I9／I14／I15 与具体成员范围待答复，RFC-004 按批准顺序等待 RFC-003 完结，Hook 未开工。

## 最新接力：开发面板、菜单与只读滚动（2026-09-15）

第六十七批继续真实开发页面验收，修复四处布局／交互缺陷：320px 代码区被固定文件树挤到 82px，现窄屏上下排列、代码区 302px，编辑内容在面板内滚动；页签与窗口菜单原来向左越界约 175px，现完整位于视口内；只读 CLI 正文滚轮被 xterm 吞掉，现允许外层滚动并提供带焦点框的键盘入口；历史页普通终端反复自适应长到约两万像素，现稳定为 420px 面板。另修复语言切换后 html 仍声明中文的问题。

语言回归先 0 pass／2 fail，只读滚动回归先 1 pass／3 fail；最终定向 **13 pass／0 fail／52 assertions**。实机右下滚动到 scrollLeft=786／scrollTop=56.5，Tab 到达只读画面、左键滚至 746，未取得控制或发送模型输入。最终编辑器五尺寸宽 878／622／530／372／302px，历史终端画面均为 351.41px。最终菜单与中英声明复验通过。另补差异、历史转录、管理接入六条主路由与发布详情、市场详情的尺寸记录；长页签的完整横向阅读、创建接入／开通状态、全程键盘和实际系统明暗旅程仍待补齐。

首个候选检查后，实机继续发现只读滚动和历史终端高度问题，分别修复并重验，旧结果保留；最终十份源码／测试候选完整门禁 **1177 pass／4 skip／0 fail**（1181 tests／197 files／6540 assertions；测试 107.09s、命令 125.36s），console build **441ms**。本机最终 console 为 `cs-console:rfc003-b67-b5d4ba5f9d`／generation=39／1／1，imageID=`sha256:1bd35c17b01f8e325bc964d5aa8d184880b63504180395bd6fed906a316b968c`；04:33:29Z 实际 Pod 七份文件、04:37:48Z HTTP 六份资源匹配，页面 index-CroDSPeQ.js。

04:37:48Z 三个 QA 的 taskId／native／历史 Agent／活动／工作树保持（仅 checkedAt 另计），delivery 的 lastActivityAt 更新。个人布局内容与批前完全一致，正常导航使修订 3→10；原 tab 17 恢复可输入、单 CLI／工作区／中文草稿／未读完成 1。语言和视口已恢复。04:38:05Z 原任务 UID／状态／四份文件摘要、失败 Bound 工作卷及各预览／正式槽保持；API ebaa730／32、controller cc93104／21 均 1／1，节点 Ready=True、无内存／磁盘压力，剩余 1,785,839,616 bytes。本批只更新 console，未清理数据或临时调零其他服务。

源码及三份文档精确上库，最终 SHA CI 单独核对。**累计仍 22／52 通过、30 项待完成**；I9／I14／I15 与具体成员范围待答复，RFC-004 按批准顺序等待 RFC-003 完结，Hook 未开工。

## 最新接力：资源长内容与复制反馈（2026-09-15）

第六十六批修复上批实测的资源总览可读性问题。CopyValue 的空提示固定占 48px、按钮占 42px，长操作键只剩 15.76px 宽，最坏行高 1297.28px。现在文本与按钮用两列网格，文本保留阅读宽度，反馈独占下方一行；实机代码宽 141.09px，操作表最坏行降至 122.55px，MCP 表由 905.70px 降至 81.33px。

最终本机页面在中英文、五种宽度下均无整页横向溢出；两次真实复制内容正确，已复制／Copied 提示不改变文本宽度及按钮位置，剪贴板已恢复。Tab／Shift+Tab 到达横向滚动后的复制按钮，蓝色 2px 焦点可见。语言恢复中文、视口覆盖撤销。此次只修改一份 CSS，原复制逻辑和状态区域保持；完整门禁 **1171 pass／4 skip／0 fail**（1175 tests／195 files／6514 assertions／118.68s），console build **654ms**，没有为纯文档再跑门禁。

本机 console 已更新为 `cs-console:rfc003-b66-b7f9840041`／generation=37／1／1，imageID=`sha256:b9e5326debd21d9261189a0b400a1066e6cca570d43d136687efad66ced2bb9f`，03:44:42Z 实际 Pod 七份文件、03:48:50Z HTTP 六份资源与构建相符，页面为 index-DU8WKN7b.js。仅新增 3,719,861 bytes 镜像内容，没有清理数据或调零其他副本。

03:48:50Z 三个 QA 的 taskId／native／历史 Agent／活动／工作树与批前一致（仅 checkedAt 另计）；03:49:17Z 原任务身份／容器状态／四份文件摘要、失败 Bound 工作卷及预览／正式槽保持。API ebaa730／32、controller cc93104／21 均 1／1，节点 Ready=True、无内存／磁盘压力，剩余 1,838,116,864 bytes。源码及三份文档精确上库，最终 SHA CI 单独核对。

**累计仍 22／52 通过、30 项待完成**；本次关闭资源总览已复现的密度缺陷，尚不能替代全部页面、角色、键盘和实际系统主题旅程。I9／I14／I15 与具体成员范围仍待答复；RFC-004 按批准顺序等待 RFC-003 完结。

## 最新接力：创建时分支与窄屏表格密度（2026-09-15）

第六十五批继续 UX-AT-25／26。真实 files 项目工作树已在 codex/rfc003-files，列表／概览摘要却把创建时 main 裸露在“当前开发”下；现明确标注“创建时分支”，缺失仍为未知，保持摘要不额外查询 Runner 的原设计。两个真实路由回归先红后绿，最终定向 **32 pass／0 fail／200 assertions**，中英文实际页面已核对。

320px 套餐表原来把说明压成逐字长列；共享 DataTable 保留 7rem 阅读宽度、使用原外层横向滚动，长说明行由 397.27px 降至 128.49px。最终部署的 30 个页面状态共 150 次五尺寸量测均无整页横向溢出，页签选中项可见；表格方向键滚动与右侧操作焦点可达。新建数字人向导的错误、资源、确认步骤均已检查，临时输入放弃后清空，普通 API 确认未创建项目。资源总览的能力表格仍有最高 1297px 的行，后续须继续修复，不能将无整页溢出等同于可读性通过。

最终五份源码／测试候选保持，完整门禁 **1171 pass／4 skip／0 fail**（1175 tests／195 files／6514 assertions／110.85s），console build **521ms**。本机 console 已更新为 `cs-console:rfc003-b65-231ca0b09f`／generation=36／1／1，实际 imageID=`sha256:cea0758bd0137d72b3918344fd39fdea6862bd46cf256758ac07dd0eb0ed64da`。03:10:43Z 运行 Pod 七份文件、03:27:39Z 正常 HTTP 六份静态产物与构建一致；实际页面载入 index-wC8asuB4.js，语言恢复中文、视口覆盖已撤销。

03:25:38Z 三个 QA 的 taskId、native、历史 Agent、活动及工作树与批前相同（仅 checkedAt 另计）；03:27:08Z 原任务 UID／容器状态／四份文件摘要、失败 Bound 工作卷及各预览／正式槽保持。API ebaa730／32、controller cc93104／21 均 1／1，节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,861,398,528 bytes。本批仅更新 console；源码及三份文档精确上库，最终 SHA CI 单独核对。

**累计仍 22／52 通过、30 项待完成**。全部关键页面、完整键盘与实际系统明暗旅程尚未完成；I9／I14／I15 与具体成员范围仍待答复，RFC-004 等待 RFC-003 完结，Hook 未开工。

## 最新接力：窄屏页签与错误字段焦点（2026-09-15）

第六十四批继续 UX-AT-25／26，真实 320px 页面复现方向键已切内容但标签被裁切，以及宽屏选中末尾标签后缩窄整项隐藏。共享 Tabs 现按实际边界滚动自己的标签条，先聚焦和显露再导航，并在挂载、选中项变化及尺寸变化时显露当前项；缩放保持正文焦点。调用链表单另修复无效 ID 提交后焦点留在按钮的问题，现保留草稿和字段错误并聚焦输入框。

几组新增回归均有正常先红后绿证据，最终定向 **55 pass／0 fail／305 assertions**。最终完整门禁 **1169 pass／4 skip／0 fail**（1173 tests／195 files／6505 assertions／112.58s），console build **746ms**；四份源码／测试候选固定后保持。一次受限沙箱检查无法监听测试端口／访问测试库，未作为有效门禁；正常本机权限的完整检查通过。真实方向键、Home／End、首尾循环及缩窄均使选中标签完整可见；最终部署中的错误 ID 在五种宽度下保持输入焦点、错误文字和选中页签，临时输入与视口覆盖已撤销。

console 已更新为 `cs-console:rfc003-b64-6184b66141`／generation=34／1／1，实际 imageID=`sha256:5a73faede3ab15279bf87cc27324310f79cd1fbb7e9ca6df950372130057b9e6`。02:32:38Z 运行 Pod 七份文件、02:34:05Z 正常 HTTP 六份静态产物均匹配，真实页面加载 index-DN3puaAl.js。02:34:04Z 三个 QA 的 taskId、native、历史 Agent、活动和工作树与批前保持（仅 checkedAt 另计）；02:34:29Z 原任务／文件摘要／失败 Bound 工作卷及各预览、正式槽保持。API ebaa730／32、controller cc93104／21 均 1／1，节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,765,412,864 bytes。

尺寸证据新增市场、项目列表、项目概览、发布准备、日志和调用链五种宽度，以及接入列表／发布详情 320px；这是当前已量测的页面子集，全部关键页面与实际系统明暗旅程仍待完成。**累计仍 22／52 通过、30 项待完成**。I9／I14／I15 与具体成员范围仍待答复，RFC-004 等待 RFC-003 完结。源码及三份证据文档精确提交，最终 SHA 托管 CI 单独核对。

## 最新接力：旧链接和两空间返回（2026-09-15）

第六十三批完成 UX-AT-24。真实浏览器发现三处缺陷：API 文档进入管理后返回落到默认成员页；旧接入列表丢掉查询条件；旧租户接入项目地址污染返回位置，点“回到工作台”又被重定向到管理空间。现保存包含 query 的完整位置、兼容路由传递已校验筛选，且只在项目确认属于数字人时记录租户项目位置，读取失败／待识别的接入地址不覆盖原工作台位置。

三组新增回归分别先失败，最终定向 **47 pass／0 fail／256 assertions**；完整门禁 **1163 pass／4 skip／0 fail**（1167 tests／195 files／6467 assertions／111.07s），console build **508ms**。七份源码／测试候选未再改变。真实 API／订阅／历史 Agent／发布／配置／日志旧链接、列表筛选与浏览器返回／前进均有现有对象证据，最终部署再次核对 API 和生产配置往返、接入列表筛选及返回循环消失。游标传递由真实路由／HTTP 回归证明，当前只有两个接入项目，未冒称真实第二页。

console 已更新 `cs-console:rfc003-b63-6e1f7d451f`／generation=31／1／1，实际 imageID 为 `sha256:65986ad319e13f9f3146a660bb2f3bf6e91b6055a5dd53c8a7cacd6912b5afd7`。运行 Pod 七份文件、正常 HTTP 六份静态产物均与最终构建一致，浏览器载入 index-CR5gHbTt.js。API ebaa730／generation=32、controller cc93104／21 均 1／1，任务运行时未更新。

01:34:50Z 三个 QA 的 taskId、native、历史 Agent、活动及工作树均与批前一致（checkedAt 另计）；01:35:41Z 原任务 UID／状态／restartCount、四份业务文件及 Git 配置摘要、失败 Bound 工作卷和各预览／正式槽均保持。节点 Ready=True、MemoryPressure／DiskPressure=False，剩余 1,763,966,976 bytes。本批未发模型轮次、发布 QA 版本或改配置／授权；没有临时调零副本。源码、三份接力文档精确上库，最终 SHA CI 另行核对。**累计 22／52 通过、30 项待完成**；I9／I14／I15 与具体成员范围仍待答复，RFC-004 继续等待 RFC-003 完结。

## 最新接力：开发／生产配置与实际生效（2026-09-15）

第六十二批完成 UX-AT-18。真实页面从两组空配置开始，分别保存开发与生产 GREETING，并在生产组新增不用于认证的 RFC003_CONFIG_TEST_SECRET；键名错误就地提示并聚焦，失败输入保留。普通值重读后可填回，Secret 列表只显示占位符，填回后密码框为空，正常 API 不含 value 字段。两组分别为开发第 1 版、生产第 2 版，整页刷新后仍保持各自结果。

保存后页面准确显示预览 v0.1.7 仍用配置第 0 版，实际访问也是旧问候语。随后用完全相同的远端源码 5719c033 发布 v0.1.8=`rel_01a0a27cc00e700090b5d576e6078408`，00:36:11.032Z ready／configVersion=2；实际预览显示新生产值，配置页刷新为“记录为第 2 版／与当前保存版本一致”。旧开发容器没有自动加载新值，原任务继续运行。两组测试配置留在专用 files QA 中供后续核验。

初次发布被自动审批按通用迁移警示拦截，未产生 release，临时预览已恢复。补查固定 Manifest 无迁移命令、启动入口无数据库初始化，并核对运行控制器源码后，原页面操作正常受理；实际只产生构建 Job，没有迁移 Job。00:36:40Z 所有临时副本已恢复，workbench-blue generation=21／delivery-green=13 均 1／1，files-green 更新为 generation=13／v0.1.8。正式槽没有切流。

00:39:12Z 三个 QA 的 taskId、原生 CLI、历史 Agent、活动与工作树均保持（查询时间另计）；00:40:05Z 健康任务 UID／ready／restartCount=0、四份原业务文件／Git 配置摘要及失败工作卷均保留。平台镜像仍 console c9905a6／API ebaa730／controller cc93104，全部 1／1；节点余量 1,586,561,024 bytes。主仓仅补验收证据，复用第六十批有效门禁与 build，最终文档 CI 单独核对。**累计 21／52 通过、31 项待完成**；I9／I14／I15 与具体成员范围仍待答复，RFC-004 继续等待 RFC-003 完结。

## 最新接力：迁移失败日志的真实页面旅程（2026-09-15）

第六十一批完成 UX-AT-13。专用 files QA 从已有远端分支逐次发布 v0.1.5、v0.1.6；两次迁移各输出不同标记后 exit 42，均明确失败、未切流，原 v0.1.4 预览保持就绪。实际浏览器分别从失败详情点击一次“本次迁移日志”，URL 自动带 source=migration 与各自完整 releaseId；两条记录同时存在时，每页仍只显示本版本的一条标记，时间与原始容器日志一致。

随后正常提交移除唯一的故障命令，远端 `5719c033e3ac781eb6e3efcdf1c8e6da02018f34` 与故障前 e4741df 的整棵源码比较无差异；通过页面发布 v0.1.7=`rel_01a0a260df2b7000ba1fd5194233576c`，00:04:23.466Z ready。真实试用页面显示原首页和 green 槽；该版本迁移日志为 0／0，没有混入两次失败标记。三个发布均由现有分支、完整 SHA 确认和单次提交完成，没有修改原开发任务的 checkout。

00:06:17Z 三个 QA 的 taskId、原生 CLI、历史 Agent、活动与工作树均保持（查询时间另计）。00:12:56Z 原健康任务 UID／ready／restartCount=0、四份业务文件／Git 配置摘要及原失败工作卷均保留。为构建临时调零的两个专用 preview 已全部恢复 1／1，workbench-blue generation=17、delivery-green=9；files-green 的正常恢复发布为 generation=12。原 workbench 正式 v0.1.0／generation=1 未变，files 和 delivery 正式槽仍空。

平台源码及镜像没有改动：console c9905a6／generation=29、API ebaa730／32、controller cc93104／21 均 1／1；节点余量 1,447,006,208 bytes，没有清理数据或启动模型轮次。纯验收证据复用第六十批有效完整门禁与 build，最终文档提交 CI 单独核对。**累计 20／52 通过、32 项待完成**。I9／I14／I15 和具体成员范围仍待答复；RFC-004 保持已批准、等待 RFC-003 完结。

## 最新接力：已有终端跟随系统主题（2026-09-15）

第六十批核对 UX-AT-26／51：产品主题由 CSS prefers-color-scheme 切换，不会修改根元素属性；原生 CLI 只观察属性，普通终端只在创建时取色，因此已打开的终端留在旧配色。真实 xterm DOM 回归先 **1 pass／5 fail**，现两个入口复用主题监听，同时保留根元素覆盖路径；只刷新颜色，不重建终端、不发 PTY 命令，卸载时移除各自监听。

定向 **9 pass／0 fail／34 assertions**，最终完整门禁 **1156 pass／4 skip／0 fail**（1160 tests／195 files／6432 assertions／105.61s），console build **479ms**，四份源码／测试候选保持。实际 delivery QA 在 390／320／768 像素下均无整页横向溢出，页面可滚动到原中文草稿与输入区；原 CLI、完成状态、未读提示保持，视口覆盖已撤销。这是单个开发页面和自动主题回归，不能替代全部页面／实际系统明暗切换的完整验收，累计仍 **19／52**。

已发布 `c9905a63decd7a2bdb5f34bfc981beaadcc45974`，精确 SHA [CI 34902926774](https://github.com/wangbinquan/CrewStation/actions/runs/34902926774) 成功：1152 pass／8 skip／0 fail，console build 1.02s。本机 console 已更新 rfc003-c9905a6／generation=29／1／1，23:31:00Z 实际 imageID 与七份文件匹配，正常 HTTP 六份产物一致。浏览器刷新载入 index-C2niefU7.js，原单 CLI、中文草稿、完成／未读状态保持，已恢复输入控制。

23:33:31Z 三个 QA 的 taskId、原生 CLI、历史 Agent、活动状态与工作树结果均保持（查询时间另计）；原业务文件／Git 配置摘要及失败工作卷 UID 保留。API ebaa730／generation=32、controller cc93104／21 均 1／1，未改变运行镜像。增量导入新增 3,718,128 bytes，无数据清理，节点剩余 1,360,252,928 bytes。原生系统设置一度可读，但没有完成真实主题切换；仍以自动回归和已完成单页尺寸证据为限。源码候选未再改变，纯证据补记复用有效门禁；I9／I14／I15 与成员范围仍待答复，RFC-004 等待 RFC-003 完结。

## 最新接力：终端缩窄快照边界（2026-09-15）

第五十九批将实机错位缩减为纯终端复现：备用屏幕从 40 列缩到 20 列后，xterm 行容量仍为 40，SerializeAddon 把第 30 列的旧侧栏也写出，恢复到 20 列便多换行并挤乱草稿。回归先 **3 pass／1 fail**。现用只读缓冲投影限制可见列，不改原模拟器或协议；颜色、光标、粘贴模式、序号和再次放宽后的原内容保持。

首次完整门禁后补查又复现中文右边界：半个宽字符会挤走下一行，最终红回归 **4 pass／2 fail**。现以同样式空格显示该不完整字符的边缘，原字符保留在原缓冲；定向 **6 pass／0 fail／41 assertions**，最终完整门禁 **1149 pass／4 skip／0 fail**（1153 tests／194 files／6406 assertions／106.24s），三份候选文件保持。console 未变，沿用第五十八批有效 build。

已发布 `fc0688e9c0bc5e4b444c4cad2c26f2e840615fca`，精确 SHA [CI 34895624526](https://github.com/wangbinquan/CrewStation/actions/runs/34895624526) 成功：1145 pass／8 skip／0 fail，console build 1.29s。新任务镜像 rfc003-fc0688e 的实际 imageID 为 `sha256:eaca018e3b2d01c366ede44363c6de6d3cc73196a52c25e502d6d74d58323657`，四份文件匹配；Linux 容器内六项终端回归也通过。只新增 56,413 bytes 镜像内容，CS_TASK_IMAGE 已更新，旧 Runner 未热更新。

管理员专用套餐 rfc003-59-snapshot（250m／2Gi／10Gi）已创建。开发入口只能用平台默认套餐，因此短暂覆盖 API 默认值，通过正常接口创建 delivery QA 会话后恢复 coding-medium；网关滚动交接的 502／504／超时均未当作成功或重复提交，恢复补丁的状态版本冲突也已处理。新任务 `tsk_01a0a1c5a4537000b2f81b4324357c76`／Pod UID `f6c62e09-80f4-4d3b-b43c-8229781cd488` 实际使用新镜像与专用规格，Running／ready／restartCount=0。21:29:58Z API generation=32／controller=21／console=28 均 1／1；源码镜像仍分别 ebaa730／cc93104／927da4d，默认套餐已恢复。

真实浏览器中逐个启动一个只读 OpenCode，完成一轮后保留中文草稿，并从 1280×720 缩到 1024×720。通过会话菜单新建并接续同项目历史 Agent，后两轮回答 42／43，原生 sessionId 不变；返回原 CLI 后数量 1、工作区 1、网格、草稿、完成状态及未读提示完整保留，画面无错位。返回前后 114×30、throughSeq=947、4,277 bytes 的快照逐字节一致；恢复宽屏后原侧栏与草稿正常。**UX-AT-52 已通过，累计 19／52，33 项待完成。**

新 QA 的 HEAD ea10bd3／未推送 0 保持，历史驱动新增十个 npm 缓存项，未读取或清理内容。旧两份健康任务／原业务文件与 Git 配置摘要、原 files CLI 草稿和失败工作卷保留；节点剩余 1,451,814,912 bytes。源码候选未再变化，纯证据提交沿用有效门禁。I9／I14／I15 与成员范围待答复，RFC-004 继续等待 RFC-003 完结。

## 最新接力：页面历史续聊与重复故障提示（2026-09-15）

第五十八批已用 CUA 内置浏览器完成真实历史 OpenCode 的页面启动／继续、等待提示和返回操作。旧 rfc003-ux 原历史 Agent 接续第三轮；新 files QA 历史 Agent `agt_01a0a18645f770009e298c7f2f5e12b4` 在只读档位完成两轮口令接续，返回后原单个 CLI／页签／未发送草稿／未读完成状态保持。但原 CLI 重新附着画面错位，正常 API 取得的屏幕快照也复现，UX-AT-52 保持未完成，继续定位；不能把对象与输入保留当作完整通过。

旧任务继续运行后 Git 输出超过读取上限，页面真实显示未知，但同一原因在每份摘要重复三次。已去重相同原因并保留不同原因、未知状态及实际部署；回归先 **8 pass／2 fail**，修复后 **10 pass／0 fail／44 assertions**。最终完整门禁 **1146 pass／4 skip／0 fail**（1150 tests／194 files／6384 assertions／110.07s），console build **599ms**，两份候选文件保持。已发布 `927da4d212ecd643bee5529838e3d1f1bc3bceed`，精确 SHA [CI 34891820268](https://github.com/wangbinquan/CrewStation/actions/runs/34891820268) 成功：1142 pass／8 skip／0 fail，console build 1.01s。

console 已更新 rfc003-927da4d／generation=28／1／1，20:22:55Z 实际镜像与七份文件、20:23:00Z 正常 HTTP 六份产物均匹配。真实旧任务故障页面已刷新复验：顶部与详情各一次相同原因，仍显示未知与实际生产 v0.1.0。20:24:42Z 原单个 CLI／新历史 Agent awaiting-input／files 模型后工作树均保持；API ebaa730、controller cc93104 不变。新增镜像内容 3,712,021 bytes，无数据清理。下一步继续已复现的原生终端屏幕恢复问题；当前源码未再变化，纯证据补记复用有效门禁。

20:09:57Z 原两份 QA Pod 均 Running／ready／restartCount=0，原业务文件及 Git 配置摘要保持。files 新增两个未跟踪 npm 缓存文件，HEAD e4741df／未推送 0，不能称工作树仍干净；未读取或清理缓存内容。旧 QA 也不再继续发模型轮次。节点剩余 1,560,313,856 bytes。累计仍 **18／52**；I9／I14／I15 与成员范围待答复，RFC-004 等待 RFC-003 完结。

## 最新接力：事件死信重放与队列衔接（2026-09-15）

第五十七批检查 UX-AT-14，四个既有 QA 项目的死信均为 0；没有向共享订阅扇出验收事件。隔离的真实 PostgreSQL／HTTP／队列回归复现并发重放旧快照覆盖 pending／delivered，导致订阅者再次收到同一事件，初次 **0 pass／3 fail**。重放改为授权后在同一事务中锁行重读、改状态和入队；已被另一请求处理则返回 412。随后又复现旧 worker 已写 dead、队列任务尚未结束时，去重吞掉重放而 HTTP 仍成功、记录永久 pending。现入队冲突回滚并明确稍后重试，旧任务收尾后能正常送达。

新队列回归 **3 pass／1 fail**，最终定向 **14 pass／0 fail／111 assertions**。此前候选门禁已绿，新增实际修复改变候选后才再跑；最终完整门禁 **1143 pass／4 skip／0 fail**（1147 tests／194 files／6370 assertions／103.83s），七份候选摘要保持。console 源码和依赖未改，沿用第五十六批有效 build。已发布 `ebaa73014657692eafb32728feb3232dfcc8ebd3`，精确 SHA [CI 34888522477](https://github.com/wangbinquan/CrewStation/actions/runs/34888522477) 成功：1139 pass／8 skip／0 fail，console build 910ms。

仅 cs-api 更新为 rfc003-ebaa730／generation=25／1／1，19:55:20Z 实际镜像与七份源码摘要一致，console 4d1859a／controller cc93104 保持。增量导入只新增 56,474 bytes；原两份 QA 工作树、历史 Agent awaiting-input 与原单个原生 CLI 身份均保留。CUA 内置浏览器已能正常登录并打开历史转录，页面验收恢复进行；原生 Mac 锁定不再是该通道的阻碍。本次隔离运行不替代真实项目的死信到日志页面旅程，累计 **18／52**。I9／I14／I15 与成员范围待答复，RFC-004 继续排队。

## 最新接力：历史新建 Agent 输入保护（2026-09-15）

第五十六批核对历史新建表单，复现返回后丢首条指令／档位、同次渲染连续点击启动两个 Agent，以及返回旧对话后迟到成功切走输入对象。新增四项真实路由／HTTP 回归，修复前 **1 pass／3 fail**。草稿移到当前会话的 feature hook，收起保留，启动时同步锁定并固定输入；失败保留且不自动重发，离开复用同一份草稿确认，在途不能确认放弃。成功只清新建草稿，用户已回到原对话时保留其选择与焦点。

初次定向 **14 pass／0 fail／121 assertions**；补充焦点断言后最终完整门禁 **1139 pass／4 skip／0 fail**（1143 tests／193 files／6338 assertions／104.87s），console build **502ms**，七份候选摘要保持。已发布 `4d1859a2a8f50bc1f05d7baf7fdf39c7798f775e`，精确 SHA [CI 34884257972](https://github.com/wangbinquan/CrewStation/actions/runs/34884257972) 成功：1135 pass／8 skip／0 fail、console build 1.33s，四项新回归实际执行。

console 已更新 rfc003-4d1859a／generation=27／1／1，实际镜像和七份文件、正常 HTTP 的六份产物全部匹配。19:09:48Z 两个 QA 工作树、原历史 Agent awaiting-input 与原单个原生 CLI 身份保持；API c712aa7／controller cc93104 版本保持。增量导入只新增 3,709,825 bytes，没有清理数据。Mac 仍锁定，I9／I14／I15 与具体成员范围仍待答复；累计 **18／52**，RFC-004 不提前启动，最后纯证据补记沿用有效门禁。

## 最新接力：历史页面实时名册刷新（2026-09-15）

第五十五批继续核对实际页面接线，发现历史转录订阅只在启动／结束时刷新名册，漏掉 waiting、权限请求，以及旧驱动下一轮的首次文本／思考／工具输出。已补显式状态刷新，并按 Agent 分别记录本轮是否已开始输出；同轮后续片段不逐帧查询，状态仍取平台 DTO。新增五项真实路由／HTTP／WS 回归修复前 **5 pass／5 fail**，修复后连同后端定向 **15 pass／0 fail／131 assertions**；后台变化保持当前选择、草稿和焦点，连续 30 段不额外读取。

最终完整门禁 **1135 pass／4 skip／0 fail**（1139 tests／192 files／6301 assertions／100.65s），console build **501ms**，四份候选摘要保持。已发布 `c5d6eecf1398c145f6270a397c634782e1867ea0`，精确 SHA [CI 34880255845](https://github.com/wangbinquan/CrewStation/actions/runs/34880255845) 成功：1131 pass／8 skip／0 fail、console build 1.06s，五项新增页面回归实际执行。上一批最终证据 cbf9e15 的 CI 34878667789 同样成功。

console 已更新为 rfc003-c5d6eec／generation=26／1／1，实际 Pod 镜像及七份文件摘要一致，六份静态产物经正常 HTTP 逐份匹配。只新增 3,706,603 bytes 并流式导入，无清理数据。18:27:09Z API c712aa7、controller cc93104、原历史 Agent awaiting-input、files 原单个 OpenCode／工作树／文件摘要及发布槽保持，旧历史 QA 未提交 1395 的模型后指纹未再变化；原失败工作卷、Pod 与数据库保持，节点余量 546,484,224 bytes。没有再启动模型轮次或任务容器。CUA 再次确认 Mac 锁定，解锁及 I9／I14／I15／成员范围仍待答复，累计 **18／52**，RFC-004 不提前启动；最后纯证据补记沿用有效门禁。

## 最新接力：真实历史 OpenCode 与等待状态（2026-09-15）

第五十四批在旧健康 rfc003-ux 专用任务里，用已有 rfc003-verify-opencode 档位创建一个只读历史 Agent，真实 OpenCode 完成两轮口令对话；第二轮没有重给第一轮口令，仍正确接续。Agent `agt_01a0a0fe05327000bf97088b148de687`、原生会话 `ses_f5f01f2a4ffeK5bad0yVcuk6x5` 保持。两轮均有明确 waiting 事件，API 名册却仍为 running，已修复这段持久事件投影；等待不记结束时间，实际继续执行保留身份，说明性状态不推测执行。

新增回归修复前 **4 pass／1 fail**，修复后连同历史页面定向 **10 pass／0 fail／84 assertions**。首次完整门禁停在新增测试的字面量类型，修正后最终 **1130 pass／4 skip／0 fail**（1134 tests／192 files／6254 assertions／99.93s），两份候选摘要保持。已发布 `c712aa77912e5f0dab2fb92ccec4bf17c6f6ef23`，精确 SHA [CI 34877572645](https://github.com/wangbinquan/CrewStation/actions/runs/34877572645) 成功：1126 pass／8 skip／0 fail、console build 1.26s。仅 cs-api 更新至 rfc003-c712aa7／generation=24／1／1，实际 imageID 与三份源码摘要一致；17:59:26Z 原历史 Agent 已返回 awaiting-input，身份、档位及权限保持，无 endedAt。

17:45:16Z 原 Pod UID／ready／restartCount=0、HEAD a10027c 和旧比较文件／Git 配置摘要保持，但旧任务镜像把 OpenCode 缓存与快照写进 /work，未提交项由 1 增为 1395，接口明确截断；不能称工作树未变。没有删除、读取或提交这些缓存内容，保留该历史会话供后续页面验收。Mac 仍锁定，I9／I14／I15 与成员范围仍待答复；累计仍 **18／52**，RFC-004 不提前启动。具体事件和保全边界见 implementation 第五十四批。

18:01:05Z 更新后核对：files 原单个 OpenCode／Runner、工作树 e4741df／未提交 0／未推送 0、文件摘要和原部署槽均保持；旧历史 QA 的工作树指纹与模型运行后相同，未再增加更改。原失败 Pod／工作卷和 PostgreSQL 身份、状态保持。增量镜像仅新增 58,925 bytes，流式导入成功，节点余量 573,718,528 bytes；没有清理数据或重启任务容器。最后的纯证据补记沿用有效门禁，文档提交 CI 单独核验。

## 最新接力：历史对话输入与控制器更新（2026-09-15）

第五十二批已发布 `cc931041503cd2794c3145172b728ac24303a08a`，两个精确 SHA CI 34869427269／34869427360 均成功。只更新 cs-controller 至 rfc003-cc93104，generation=20、1／1、restartCount=0，实际 imageID 和两份源码摘要一致。精确回收本 RFC 的一项旧 console 编译缓存 118MB 后，按 digest 核对仅新增 45,029 bytes 并流式导入；没有清理镜像或数据卷。16:51:39Z 两份健康 QA Pod、原单个 OpenCode、e4741df／未提交 0／未推送 0 和文件摘要保持，参考代理路由仍指向正式 green，节点余量 655,147,008 bytes。

第五十三批修复历史消息的跨 Agent 草稿串用、失败即清空、快捷键重复发送和离开丢输入。按 AgentId 独立保存，成功回执只清当时版本；失败保留且不重试，返回 CLI 复用输入确认，缺失链接不误选另一对象。会话元数据标为“创建时分支／Initial branch”。新增五项回归修复前 0 pass／5 fail；定向 **25 pass／0 fail／209 assertions**。最终完整门禁 **1129 pass／4 skip／0 fail**（1133 tests／192 files／6247 assertions／101.64s），console build **577ms**，七个候选文件摘要保持。当前 SVG 原稿还完成四种尺寸／双主题／单色的渲染复核，图见 brand-design.md；不是新一轮浏览器检查。

该批已发布 `7e8dc7f9a38fc6f88e00cfd21673ee680770a61b`，精确 SHA [CI 34872812553](https://github.com/wangbinquan/CrewStation/actions/runs/34872812553) 成功：1125 pass／8 skip／0 fail，console build 1.19s。console 已更新至 rfc003-7e8dc7f／generation=25／1／1，实际 imageID、六份静态产物与 serve.ts 在运行 Pod 内一致，外部正常 HTTP 也逐份匹配六个产物。17:14:13Z 原 OpenCode／Runner、工作树和 QA 文件摘要保持，files preview v0.1.4、workbench 正式 v0.1.0／preview v0.1.1、参考代理 v0.1.2 均保持；失败 Pod／工作卷和 PostgreSQL 原 UID 保留。节点余量 631,484,416 bytes，无临时调零副本或未恢复的故障命令。源码及运行内容未再变化，本次证据补记沿用有效门禁。

本轮浏览器短暂恢复后，CUA 再次报告 Mac 锁定，已请求解锁；下文此前“已恢复”是当时事实。files 和旧健康 QA 均无历史结构化 Agent，本批没有另启模型任务。I9／I14／I15 和具体成员范围仍待答复，累计 **18／52**，不将自动回归当作页面旅程完成；RFC-004 继续等待 RFC-003 完结。

## 最新接力：发布投影的并发迟到与浏览器恢复（2026-09-15）

第五十二批通过可控交错复现了上一批仍有的缺口：网关读取旧目录后暂停，目录提交并应用新路由，旧网关请求恢复后把新路由覆盖。新增回归修复前 3 pass／1 fail；现将发布登记后的路由／放行表刷新统一归目录消费者，移除 gateway 对同一 release.registered 的重复处理，项目／切流事件保持原路径。另验证目录已提交、K8s 首次失败时游标不推进，重试恢复路由且不重复操作。定向 **23 pass／0 fail／165 assertions**，完整本地门禁 **1124 pass／4 skip／0 fail**（1128 tests／191 files／6209 assertions／150.53s）；两个候选文件保持一致。console 源码／依赖未变，沿用有效 build。提交、精确 SHA CI 和仅 controller 更新继续。

CUA 现在已能操作浏览器，Mac 锁定不再阻塞。以原 admin／admin@demo.invalid 登录回 files 工作区，实看 e4741df、未提交 0／未推送 0、已启动 1 与未读完成 1；打开历史入口仍是独立页面，该项目还没有旧版结构化 Agent。页面另显示会话“分支 main”，而实际工作树是 codex/rfc003-files；该元数据是创建时分支，文案仍需明确。I9／I14／I15 和具体成员范围仍待答复；累计 **18／52**，页面旅程继续，RFC-004 等待 RFC-003 完结。

## 最新接力：活动代理与目录路由一致性（2026-09-15）

第五十一批继续真实 API 试调：原 files QA 任务读取已默认开放的 GitLab 项目 114／当前提交，容器返回 HTTP 404。定位为网关取到了已退役模板代理名，并复现网关先消费发布事件、目录随后更新导致路由不刷新的顺序问题。已改为服务定点活动代理查询，目录提交后经组合根刷新路由和放行表；新增组合根回归先红后绿，定向 **21 pass／0 fail／158 assertions**。最终完整本地门禁 **1122 pass／4 skip／0 fail**（1126 tests／191 files／6202 assertions／107.29s），五个候选文件摘要保持。console 源码与依赖未变，沿用有效 build；前一次沙箱无法绑定本机端口、连接测试库的失败不作为有效验证。精确 SHA CI 与部署结果见下文。

修复已发布 `e26515eb6dbb67fc5cf894bb9996b1885144e788`，精确 SHA [CI 34865123328](https://github.com/wangbinquan/CrewStation/actions/runs/34865123328) 成功：1118 pass／8 skip／0 fail，console build 1.10s。本机 cs-api／cs-controller 已依授权更新至 rfc003-e26515e，generation=23／19、各 1／1，实际 imageID 与五个源码摘要核对一致。console 保持 cbe2825／generation=24。参考代理 v0.1.2 经普通负责人切流成为正式 green，重算后的实际路由与目录一致。

真实 GET 已从原开发容器到达参考代理，但 15 秒后平台 HTTP 412，代理在 30 秒处记录上游未响应。系统 API Pod 与代理 Pod DNS 相同，连 GitLab 8929 前者 3ms 成功、后者 ETIMEDOUT；代理 workload=service 的现有规则没有到上游的出站路径。已将已有 [I9](docs/engineering/implementation-open-questions.md#i9-项目命名空间到公司系统的出站) 的三种设计选择呈作者，未修改策略或 grants。16:10:26Z 原单个 OpenCode／Runner、两份 QA Pod 与文件摘要、工作树 e4741df／未提交 0／未推送 0、QA 各槽和数据库均保持，节点余量 324,152KiB。

本次实际推进不替代页面验收。Mac 解锁、I9／I14／I15 与具体成员范围仍待答复，验收仍 **18／52**，RFC-004 继续等待 RFC-003 完结。详细镜像／Pod／路由／连接及 CI 证据见 implementation 第五十一批。

## 最新接力：全部部署槽日志筛选（2026-09-14）

第五十批修复“全部部署槽”在界面省略 slot 后，后端仍默认只读正式槽的问题。未指定槽时，按当前项目命名空间、服务名和 workload=service 读取部署日志；明确 prod／preview 时继续按当前角色映射 blue／green。只读集群核对显示，单用服务标签还会匹配原失败开发容器，新增工作负载条件后仅保留真实蓝绿两槽。新增模块 API 回归先红后绿，定向 **22 pass／0 fail／102 assertions**；完整本地门禁 **1119 pass／4 skip／0 fail**（1123 tests／190 files／6191 assertions／102.42s），两个源码／测试候选摘要未变。console 源码和依赖未改，沿用上一批有效 build。提交后的精确 SHA CI 单独核验。

本批已发布 `80d1020195f456ca010d43265926f0b1e7403f79`，精确 SHA [CI 34859748456](https://github.com/wangbinquan/CrewStation/actions/runs/34859748456) 成功：1115 pass／8 skip／0 fail、console build 1.32s。作者随后明确“你可以自由更新本机上部署的服务”，此前服务更新确认已解决，后续同类更新直接按授权推进。

console 已更新至 rfc003-cbe2825／generation=24，cs-api 已更新至 rfc003-80d1020／generation=22，均 1／1；实际 Pod imageID、六个控制台产物及五个 API 相关文件摘要核对通过。API 镜像在已核对 cbe2825 基底上只覆盖两个候选文件，新增导入内容 39,925 bytes，没有重新安装依赖或清理数据。真实 API 的全部槽返回蓝绿两 Pod，prod／preview 分别只返回 green／blue；两次查询时间相同，逐行匹配实际容器时间且 stream=combined。原迁移 Job／Pod 已不存在，默认一小时保留期已过，失败发布历史仍保留；不能再用它复验原固定标记，UX-AT-13 的新故障页面旅程仍待执行。

15:16:50Z 原单个 OpenCode、两份 QA Pod UID、工作树 `e4741df`、首页／Git 配置摘要、预览 v0.1.4 和正式槽状态均保持；未提交／未推送 0。节点余量 334,888KiB。再次尝试页面验收时 CUA 明确报告 Mac 仍锁定；I14／I15 与成员范围问题仍待答复。本批真实部署／API 验证不替代页面旅程，验收仍 **18／52**；RFC-004 已批准，继续等待 RFC-003 完结。下文服务更新“待授权”均为本次明确授权前的历史记录。

## 最新接力：迁移失败、恢复发布与日志事实（2026-09-14）

第四十九批在原 files QA 的单个 OpenCode 空闲时，只给 crewstation.yaml 加一次输出固定标记并 exit 42 的 migrationCommand，不访问数据库。正常发布 v0.1.3=`rel_01a0a03773bf7000a6d00e16f132a40d`／`490c30d676a6e4d3908415df5c0117fb8501fd79`，实际迁移 Job 失败，预览保持 v0.1.2，正式仍空。随后只移除该命令，恢复提交 `e4741df56b440d776b7c25ff5a4978b3d5822f46` 的整棵树与故障前一致；正常发布 v0.1.4=`rel_01a0a0426f4c7000b7ce58ff67c80bc8`，14:11:54.631Z ready、预览 HTTP 200。失败记录和标记保留；原 Pod／OpenCode 身份、首页和 Git 配置摘要保持，未提交 0／未推送 0，工作树与预览相同。两轮临时调零的 QA preview 全恢复 1／1、generation=11；原 workbench 正式 green 仍 generation=1／v0.1.0。

真实标记发生于 13:59:54.295718172Z，旧 API 却返回每次查询时间并标成 stdout。本批修复请求实际时间戳、严格解析和未知时间、混合输出的中性级别、读取失败不伪装为空；完整日志页保留接口顺序，避免缺失时间导致崩溃。新增十项回归，完整本地门禁 **1118 pass／4 skip／0 fail**（1122 tests／190 files／6189 assertions／105.67s），console build **566ms**，12 个源码／测试候选保持一致。已发布 `cbe28250607aa4084d74556c32aff650a9347783`，精确 SHA [CI 34856194400](https://github.com/wangbinquan/CrewStation/actions/runs/34856194400) 成功：1114 pass／8 skip／0 fail、console build 1.24s。

两镜像以已部署基底和已验证源码／dist 构建，实际镜像内容逐项匹配；流式导入已完成。首次容量审批拒绝后，逐 digest 证明只新增 3,995,723 bytes，复核允许，导入后余量 368,848,896 bytes，无 tar 或数据清理。console 更新随后仍被自动审批拒绝；即使核对原八服务和专用验收的明确“授权”，复核也不接受会话文件作为此次部署依据。已请求具体批准 console／cs-api 更新为 rfc003-cbe2825，待回复。两个 Deployment 补丁都未执行，仍 API 9642e23／console 10455cc，不把镜像准备算作已部署；详情和镜像 ID 见 implementation 第四十九批。

当前单 CLI 容器的只读资源检查确认 memory.oom.group=1 且 cgroup 挂载只读，逐 CLI 没有硬隔离。[I15](docs/engineering/implementation-open-questions.md#i15-同一工作树中多个-cli-的资源隔离) 已列独立 Pod／委派子 cgroup 两种方向并请求作者选择，未实施；I14 保卷恢复和具体角色范围问题仍待答复。Mac 仍锁定，以上为真实 API／集群取证，不计 UX-AT-13 的完整页面旅程，累计仍 **18／52，34 项待完成**。RFC-004 保持已批准、等待 RFC-003 完结，Hook 未开工。

## 最新接力：预览恢复与工作树发布（2026-09-14）

第四十七批 `10455cc61faea17a88ca3216a7db27f2e813b5eb` 已推 main，精确 SHA [CI 34843959775](https://github.com/wangbinquan/CrewStation/actions/runs/34843959775) 成功（1104 pass／8 skip／0 fail；console build 1.17s）。共享 console 已单独更新为 rfc003-10455cc，generation=23，实际 imageID=`sha256:ed0ddb412d76b5b2931d223f1ca5d15660ffabd26ef2d49e9163397c01ad0bb1`。失败和正常会话的连接状态、原布局保留、取消新建均在共享页面复验；候选 :8768 已停止。

第四十八批新增三项完整实机证明：实际名称／slug 搜索继续旧 rfc003-ux；新专用 rfc003-verify-files 预览崩溃后定位日志、保持原 OpenCode 草稿和真实模型轮次、保存文件并一次重启恢复；dirty 来源拦截后只提交 QA 首页，重检并发布至真实 v0.1.1。新项目 `prj_01a09fecbba97000843701962d998a7a`、任务 `tsk_01a09ff07aeb7000897fd0eda1e16cd2`、Pod UID `fa4dcc5e-3eb6-4557-a6bf-b6301dca4160` 保持 Running／restartCount=0，原单个 OpenCode 身份保持。

QA 应用提交为 `a80dbc102e8b6db71e778d0092e5d78865330d4d`，只改 home.ts 一行。其 main 被 GitLab 保护拒绝后，没有提权或改保护；从普通应用开发分支 codex/rfc003-files 正常发布 `rel_01a0a006547c7000906f933ff49b6d96`／v0.1.1，实际预览显示新标题，正式槽仍空。CrewStation 主仓一直 main。两次构建前临时调零的 QA preview 全部恢复 1／1；workbench 正式 v0.1.0 未动，节点剩余约 873MiB，后续构建仍需核对容量。

最终复查发现 URL 代推成功没有更新本地 remote refs，界面仍显示“未推送提交 1”。已在原发布用例修复：临时 cs-publish remote 按成功回执更新独立跟踪引用，既有 Runner 即可正确统计，不改 origin／upstream／持久配置。真实 Git 回归先红后绿，覆盖后来提交和远端拒绝；完整本地门禁 **1108 pass／4 skip／0 fail**（1112 tests／188 files／6162 assertions／105.63s），console build **606ms**，三个源码／测试候选哈希未变。修复已发布 `9642e23fb4ed0e033d32eeb9ae938ffb276380d2`，精确 SHA [CI 34849087951](https://github.com/wangbinquan/CrewStation/actions/runs/34849087951) 成功：1104 pass／8 skip／0 fail、console build 1.14s。

仅 cs-api 更新至 rfc003-9642e23，generation=21，Pod `cs-api-645c665469-s8dtw`／UID `68888c03-cff4-478d-8a6b-bc67735e4019` 就绪，实际 imageID=`sha256:9b4eb107decd4eea51baf740fb90b03d26fe80e3581e6381cf65acdfe269ee22`，源码摘要与候选一致。原 QA 会话通过正常发布 API 从同一 SHA 发布 v0.1.2=`rel_01a0a02027f67000ad506c35e7e40836`，真实构建／preview ready／HTTP 200；未提交 0、未推送从 1 变 0，原任务／OpenCode／文件及 Git 配置摘要保持。该次构建临时调零的两个 QA preview 最终 generation=7、均 1／1，原正式槽不变；节点仅余 401,764KiB，继续构建前须复核空间。

CUA 随后明确报告 Mac 锁定且无法自动解锁，已请求手动解锁；该次 v0.1.2 使用正常 API 验证，未冒充界面验收。解锁后先复验共享开发页未推送计数与原工作区，再继续其他界面旅程。下文此前“浏览器已恢复”是故障前记录。

累计 **18／52 项实机验收通过，34 项待完成**；详见 acceptance-audit 与 implementation 第四十八批。四窗资源保护、I14 保卷恢复方案、具体成员／市场范围授权和其余角色／尺寸／失败路径仍未完成。RFC-004／ADR-0004 已批准，继续等待 RFC-003 完结后启动，T2–T9 未开始。

## 最新接力：会话连接状态与真实容器状态（2026-09-14）

浏览器已恢复可读。共享 `03d1572` 页面实看失败任务、六条 CLI 名册、原个人布局和独立生产版本；从远端新建的确认默认聚焦保留当前工作区，取消未创建或释放任何任务。发现顶栏与会话摘要仍显示绿色“已连接”：浏览器 WebSocket 可以回放历史，不代表失败开发容器仍可连接。

第四十七批已将任务生命周期置于通道状态之前；running 但 Runner 失联显示“开发容器未连接”，收尾／关闭也有独立提示。任务失败后迟到的重连事件不会覆盖失败状态，不重挂载编辑器或清空草稿。候选控制台接真实后端实看：失败项目的顶栏和摘要保持“失败”；旧 `rfc003-ux` 在完成回放后仍正确显示“已连接”，原 taskId、main／生产 SHA 与未提交文件 1 保留。动态“待处理 2”核对为未读的中断／未确认历史结果，不是两个仍待输入的问题，未改其计数。

初始回归 1 pass／2 fail；修复后定向 **16 pass／0 fail／137 assertions**。完整本地门禁 **1108 pass／4 skip／0 fail**（1112 tests、188 files、6151 assertions、109.27s），console build **781ms**；七个源码／测试文件自门禁前哈希记录后未变。本段记录时尚未提交／部署第四十七批，共享 console 仍为 03d1572。此前最新记录提交 `f8f04b697edcdd0aabedb906b775b4e2cfb0f7a3` 的精确 SHA CI 34841092272 已成功。

本批没有修复四窗 OOM 或恢复失败工作卷，仍为 **15／52 项通过、37 项待完成**。I14 保卷重建方案和具体成员／市场范围授权仍待答复；其余验收继续。RFC-004／ADR-0004 已批准，仍等待 RFC-003 完结后启动，未实施 Hook。

## 最新接力：四窗 OOM 与故障会话展示（2026-09-14）

已在原工作区逐个新增 OpenCode D／E，四个在线 CLI 使用 1 CPU／2Gi 任务套餐；专用 Pod `task-01a09eb4f03f` 于 `2026-09-14T10:50:58Z` OOMKilled／137。原 B／Claude 与新增 D／E 都已不可连接，不能沿用下文故障前的“原进程在线”。失败工作卷仍 Bound，一次只读挂载确认 HEAD=`1aa2db9f9578edfce15dbf314f74302ac523de83`、仅原 `?? .claude.json`，首页 SHA256=`248034cbabdd0d319d2a6c5c0aaf08a2ca2a0bf754a3cf442f16a4413f8c18c6`。只读检查 Job 已清理，原 Pod／卷保留。旧 `rfc003-ux` Pod UID 与 ux-comparison.txt 摘要不变，workbench 两生产槽均就绪。

实机链路暴露两处缺陷：平台仅记录“容器 已Failed”，开发会话查询把 failed 过滤成 404。本批修复容器／init 容器原因与退出码保存；只读查询可返回最近失败记录，活跃会话优先，后续会话已释放不重新翻出旧失败。创建、释放和准入原语保持既有行为。页面首屏显示失败任务和原因，保留原工作区及草稿；显式从远端新建先说明新工作树与未保存输入，取消／失败保留，旧卷不因新建被删除。新增九项回归，定向 33 pass／224 assertions；最终完整门禁 **1107 pass／4 skip／0 fail**（1111 tests、188 files、6134 assertions、109.10s），console build **547ms**。

修复已发布 `03d15721f3e6682d10480c1e65d26a163fc8191b`，精确 SHA [CI 34838535851](https://github.com/wangbinquan/CrewStation/actions/runs/34838535851) 成功：1103 pass／8 skip／0 fail，1111 tests／188 files，console build 1.27s。核实原始共享环境授权后，cs-api／cs-controller／console 已逐个更新至 `rfc003-03d1572`，实际 Pod imageID 与构建一致；其余服务及任务镜像仍 3d1ce51。真实 HTTP 已复验失败会话 200／failed、工作树 unavailable，以及生产 v0.1.0 仍独立可查；未把旧 message 补写成新采集的原因。

部署后接口检查另发现数据库因节点磁盘满而 CrashLoop，错误为 `No space left on device`；11:35 起不就绪，早于本次服务更新。只精确清理本 RFC 十个无引用旧镜像、其中五个节点副本和九份不共享的旧 console 编译缓存，没有全局清理、修改或删除数据卷。原 PostgreSQL Pod 于 11:52:44Z 自行恢复并重新就绪；11:55:43Z 节点可用空间为 1,165,242,368 bytes（约 1.09GiB），后续构建前仍需先核对容量。workbench 两槽、delivery 无会话与预览、旧 QA Pod／文件和失败工作卷均复核保留。

Chrome 仍在运行，但 CUA 仅返回窗口标题且无截图，用户恢复窗口的问题待答复；没有将其推断为 Mac 锁屏。15／52 项历史实机通过记录保留，剩余仍 37 项；UX-AT-28／34／35／37 的 OOM 保护、恢复与尺寸验收未完成。保留工作树重建失败开发容器的生命周期方案登记为 [I14](docs/engineering/implementation-open-questions.md#i14-失败开发容器的工作卷恢复)，方案选择待作者答复，未执行恢复、释放或资源扩容。此前成员／市场范围的具体授权问题仍待答复。RFC-004 保持已批准且等待 RFC-003 完结，未实施 Hook。详见 implementation 第四十六批。

## 最新接力：离线实机复验与原生问题闭环（2026-09-14）

离线修复已发布 `49e64ccc76f9b8b966cc34f0a9a422ecbb5a412e`，精确 SHA [CI 34831866868](https://github.com/wangbinquan/CrewStation/actions/runs/34831866868) 成功：1094 pass／8 skip／0 fail，1102 tests／186 files，console build 960ms。共享 console 已单独更新为 `cs-console:rfc003-49e64cc`，Pod `console-5f98b6d899-65kc5` 就绪，实际 imageID=`sha256:e9cfe51131b6ddda36fb8469a92b1ad5322895a5a75430894920c28e99aedcda`；原 QA Pod、文件和三个 Agent 身份保留。

Mac 已恢复可操作，锁屏不再阻塞。本批在共享页面复验无开发会话提示、离线发布未发送与联网后保留说明；真实断网刷新出现 `ERR_INTERNET_DISCONNECTED`，恢复后原三个 CLI 重新附着，轮次事件和 throughSeq=10248 不变，发布仍只有原两条，未自动创建或重发。UX-AT-23 通过。

新建个人页签“人工输入验收”，只新增一个真实 OpenCode C：`agt_01a09f711c177000bb21fad5a2e2e872`／`pty_01a09f711c177001937474875e4c7596`。三轮分别验证问题选择、问题拒绝、发布页后台完成：查看不代答，Green 的明确回答恢复执行；Escape 使问题失效，缺少确定轮次结果时如实未确认；发布说明的焦点与草稿在后台完成后保留，点击结果先保护草稿，再精确定位第三轮。C 于 10:32:54.748Z 经真实 Ctrl+C 退出（exitCode=0），原 B／Claude／A 不变，QA HEAD 和原 `.claude.json` 未改。UX-AT-29／39／40 通过；按作者指定使用 OpenCode 完成原定真实 CLI 条件，未把 Claude 登录页当成外部模型成功。

累计 **15／52 项实机验收通过，剩余 37 项**，详见 acceptance-audit 和 implementation 第四十四至四十五批。本批只补实机证据和文档，生产源码未变，沿用第四十四批有效完整本地门禁。具体成员角色／市场范围写入仍待此前自动审批要求的具体授权；未执行这些写入。RFC-004 与 ADR-0004 已批准，仍等 RFC-003 完结后启动，T2–T9 未开始。

## 最新接力：离线读取提示与未发送操作（2026-09-14）

第四十三批最终记录已发布 `50a5251e4c0f490d95b5e52557c7150c80ad6045`，精确 SHA CI 34829419313 成功，1089 pass／8 skip／0 fail、console build 966ms。本轮修复上一批真实 Offline 复现的缺口：两空间外壳用同一请求在线状态解释读取暂停与旧数据；网络状态变化不重挂载页面、不抢焦点。正常在线不增加常驻提示。

另外，回归确认默认 HTTP mutation 会把离线点击的发布排队，联网后才实际发送。共享写入现明确拒绝本次尚未发出的离线操作，保留草稿供联网后重新检查；已经发出的请求继续按真实回执处理，失败不自动重发。发布错误仅在请求可能已经发出时提示核对历史，前检失败与明确未发送不混用。新增五项回归，定向 17 pass／212 assertions；完整门禁 **1098 pass／4 skip／0 fail**（1102 tests、186 files、6083 assertions、103.80s），console build 829ms。

本轮 CUA 再次确认 Mac 仍锁屏，手动解锁与具体测试成员角色授权两个问题均未收到回复。新修复尚无新增实机界面证据；UX-AT-23 保持未完成，总计仍为 11／52。共享 console 此刻仍为 baf850b。RFC-004 与 ADR-0004 保持已批准、等待 RFC-003 完结后启动，未实施 Hook。详见 implementation 第四十四批。

## 最新接力：无会话发布与空态恢复（2026-09-14）

新专用项目 `rfc003-verify-delivery`（`prj_01a09f2abfbc7000be464c171bcb8f3c`）完全未创建开发会话，已从远端 main 发布 v0.1.1：`rel_01a09f2cfcf370008be553b3f3f81479`／`ea10bd3ab67501b301ec87d6bc85eaa215fdfa8e`，实际预览就绪 1／1 并打开成功，正式槽仍为空。构建曾因节点只余 950m CPU 而 Pending；只将该专用项目的旧预览暂调至 0，随后发布控制器部署新版本并恢复 1／1，没有遗留停用副本。UX-AT-08 通过。

实机发现无会话来源把正常 404 报成读取失败，且跳去查看不存在的工作树改动。本批已改为明确空态和开发入口，保留重新检查、403／503 真错误、陈旧确认阻止及发布草稿；候选 :8768 连接真实后端实看通过。新增四项回归，定向 12 pass／154 assertions；完整门禁 1093 pass／4 skip／0 fail（1097 tests、185 files、6025 assertions、101.54s），console build 566ms 成功。源码已发布 `baf850bd0934cb0b41d13bf26ebba120e95ff494`，[精确 SHA CI 34828315511](https://github.com/wangbinquan/CrewStation/actions/runs/34828315511) 成功，1089 pass／8 skip／0 fail、console build 823ms。

共享 console 已更新为 `cs-console:rfc003-baf850b`，实际 imageID=`sha256:d408b3d73993029ca0aac0c155425ed56fc7c7f1358313710a2a6e33f71c6a0b`，Pod=`console-68c67b885-wl4wr`，就绪 1／1。只改唯一 console 镜像，旧 QA Pod／比较文件、新 QA Pod／原三 Agent 身份及 delivery 无会话状态均复核保留。随后 CUA 报告 Mac 锁屏且不能自动解锁，已请求用户手动解锁；更新后共享页面复验待该动作，候选页面实看证据仍有效。临时 :8768 Vite 已结束，不保留候选后台服务。

新注册的专用访客 `rfc003-visitor@demo.invalid` 在独立无痕窗口实看无项目、筛空、真实请求失败及恢复。DevTools 仅阻断该页项目摘要请求，页面显示加载失败／本页数量未确认；移除规则并刷新后恢复，窗口已关闭。UX-AT-21 通过，累计 11 项，剩余 41 项。浏览器 Offline 模式会暂停查询且未解释暂停原因，已记入 UX-AT-23 待续；不能将单接口失败恢复当作完整断线旅程。

四个专用演示账号已注册，但未写任何项目成员角色。自动审批拒绝了新负责人权限变更入口，要求具体受益账号、角色与项目范围；实际转移确认面板已准备，具体补充授权问题待回复。负责人／开发者／测试者和市场范围验收继续等待该项；其余工作正常推进。RFC-004 与 ADR-0004 保持已批准、待 RFC-003 完结后启动，Hook 代码未开始。详见 implementation 第四十三批。

## 最新接力：共享编辑器复验、未推送提醒与发布回退（2026-09-14）

第四十一批编辑器修复已发布 `64f37c31f48e6bf0610a1860462569bfa7401671`，精确 SHA [CI 34822560250](https://github.com/wangbinquan/CrewStation/actions/runs/34822560250) 成功，1085 pass／8 skip／0 fail，console build 通过。共享 console 已单独更新至 `cs-console:rfc003-64f37c3`，实际 Pod imageID 为 `sha256:2b9084c9e4f028f1aeb2c20cd7470b2e594a093d4600db80dddef7c4d6600b92`；其余服务和任务容器仍用第三十九批镜像。旧 QA Pod／比较文件及新 QA 原 Agent 进程均保留。本机候选 Vite 已结束。

共享控制台经原 OpenCode B 第 6 轮实际改同一文件后，冲突提示置顶、默认聚焦继续编辑、草稿保留及显式放弃后重载均复验通过。专用项目 `rfc003-verify-workbench` 的首页改动随后通过普通终端精确提交为 `1aa2db9f9578edfce15dbf314f74302ac523de83`，只含 home.ts 一行；这是 QA 应用提交，不是 CrewStation 主仓提交。工作树领先生产 1、未推送 1；释放前显示具体提交，取消后原会话和进程完整。原 `.claude.json` 仍未跟踪，未读取、提交或删除，当前会话发布如实被这一个文件挡住。

从已推送 main／`6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29` 实际发布 `v0.1.1`，release=`rel_01a09f181c8d7000b2f2654113a1e737`；试用、上线、回退及 HTTP／槽记录核对完成。当前正式仍为 v0.1.0，待验证 v0.1.1，两者同 SHA、均就绪；开发预览为本地提交的“RFC003 Agent 发布验收”。UX-AT-06／19 新增完整通过，累计九项，剩余 43 项保持；无会话发布、测试者试用、禁止回退和双人冲突等未执行分支继续登记，不能将这次 admin 旅程算作全部通过。详见 implementation 第四十二批及 acceptance-audit。

本批仅补实机证据和文档，生产源码未变，沿用第四十一批有效本地完整门禁。RFC-004 已批准且仍等待 RFC-003 完结，未启动 Hook 实现；下文此前“待批准／共享 console 未更新”的记录保留为历史，不代表当前状态。

## 最新接力：启动前 Hook 方案与编辑器冲突复验（2026-09-14）

作者指定两个管理员注入点：配置文件内容与容器存放路径、Shell／Python／JS 等初始化脚本，统一属于 Agent 启动前 Hook。[RFC-004](proposal/rfc/RFC-004-admin-agent-runtime/proposal.md)、design／plan、ADR-0004 与 I13 已按此修订：步骤可排序，每次实际启动 Agent 进程前执行；明确环境输出传递、解释器、路径占用、失败／超时／取消与未知结果不自动重跑。验收扩为 25 项。供应方连接以原生模板或脚本产物表达，管理 UI 不再另拆重复表单。作者随后明确“批准RFC-004，在RFC-003完结后启动开发”；方案及关联 ADR 已批准，保持 Draft 表示待开工，T1 完成、T2–T9 未开始。RFC-003 完整收口后按本批准直接实施，无需重复确认；此前历史记录中的 RFC-004 待审状态已被此批准取代。

RFC-003 第四十批已发布 `17270815b3db4d26a3feb9dba639baef2398a2e9`，精确 SHA CI 34818899139 成功，1082 pass／8 skip／0 fail。续验中，专用项目 rfc003-verify-workbench 初始 v0.1.0 已作为生产基准；真实 OpenCode 在原 B 进程修改 src/pages/home.ts，开发预览显示新标题，正式应用及生产 SHA 保持原值。原编辑器保存冲突正确阻止覆盖，但说明在代码区域下方难以看到。

已修复冲突／保存错误／放弃确认的位置与焦点，并补三个先红后绿回归；重新载入失败时保留冲突及真实错误。候选控制台通过本机 :8768 连接同一真实后端／Runner，第二次实际 OpenCode 修改后实看提示置顶、继续编辑保留草稿和显式放弃后载入。共享集群 console 仍是 3d1ce51，候选修复尚未替换该 Deployment。UX-AT-33 新增完整实机证据，共七项通过；UX-AT-06 候选已通过，待共享控制台更新复核，其余 44 项也继续保留。详见 implementation 第四十一批及 acceptance-audit。

最终有效本地完整门禁 1089 pass／4 skip／0 fail（1093 tests、185 files、5977 assertions、105.07s），console build 516ms 成功；此前沙箱内运行因本地监听／进程限制失败，不计有效门禁。源码在有效门禁后未修改。RFC-004 方案与批准记录单独提交为 `529fd106669b9696327146cc2f2ba8c6786c4c4a`。旧 QA 容器和 ux-comparison.txt 未改；新 QA 保留 B 进程与单行未提交标题改动，另有原 Claude .claude.json，未提交这些 QA 工作树文件。

## 最新接力：实机环境更新与管理员运行配置（2026-09-14）

此前十笔提交 `4d15e8c` 至 `3d1ce5181a11787e3629fea4021f0130e734912d` 已获明确授权并全部推上 main；精确 SHA [CI 34810918306](https://github.com/wangbinquan/CrewStation/actions/runs/34810918306) 成功，1082 pass／8 skip／0 fail，console build 通过。当前记录前 fetch 确认本地与 origin/main 为 0／0。下文历史批次的“未推送／待授权”不再代表这些提交的当前状态。

作者再次授权具体共享环境方案与专用项目验收。三个 `rfc003-3d1ce51` 镜像已导入 docker-desktop 节点，独立 Job `crewstation-rfc003-3d1ce51-migrate` 成功应用五份追加式迁移，账本 37 → 42；仅更新任务镜像配置键和八个 Deployment 镜像，逐个 rollout 成功。实际 Pod imageID 均核对一致，console 最后更新。旧 QA Pod UID 与 `/work/ux-comparison.txt` SHA256 保持原值，未释放／重建。

Chrome 原生通道恢复，已实看新市场、五个项目入口、管理空间与新建向导。`rfc003-ux` 已在发布页首次上线 `v0.1.0`／`a10027cda8470ca4088780ed79081d07dd2b8e0b`，切流 `tsw_01a09eb0740a70009559d622bd194c80`；实际正式地址打开成功。原开发会话显示与生产提交一致、未提交文件 1，并能查看保留文件的真实 diff。UX-AT-10 获得完整本次实机证据，其余项目按 acceptance-audit 继续，不能宣称 52 项完成。

新建专用项目 `rfc003-verify-workbench`／`prj_01a09eb302d67000a680835da140f993` 已 active，服务 `svc_01a09eb302d670019d1303d81a5bea94`，首个 preview `rel_01a09eb30d3370009d26fd52ceeaa013`／`6af30245c4f5dc0537bdae2c3a44aa2b3fd62d29` 就绪。新会话 `tsk_01a09eb4f03f7000ba011a517772cc09`、Pod `task-01a09eb4f03f` 使用新 runtime imageID；原生 Claude Code 已显示 TUI、取得输入控制并完成主题选择，但未挂载模型配置，停在登录选择页，未完成模型轮次。

作者要求“你用 opencode”，已在实际容器读取模型目录，并经管理 UI 新增独立档位 `rfc003-verify-opencode`（opencode／opencode/big-pickle）。未改 balanced／deep／sample-stub；模型调用的真实证据见下文。紧接着作者明确运行配置应由管理员维护、租户使用；已完成 [RFC-004 三件套](proposal/rfc/RFC-004-admin-agent-runtime/proposal.md) 与 [ADR-0004](docs/adr/0004-agent-runtime-module.md) Draft，待方案批准，尚未修改生产代码。方案及首批记录已发布为 `6c24aaec1f52f56c7cded7a67ef9e5259f4045ed`，[精确 SHA CI 34817433462](https://github.com/wangbinquan/CrewStation/actions/runs/34817433462) 成功，1082 pass／8 skip／0 fail，console build 通过。审批问题已提出，未获回复前继续既有 RFC-003 独立验收。

本机环境方案和详细快照保存在 `/private/tmp/crewstation-rfc003-3d1ce51-environment/`（临时证据，不作为唯一持久记录）；持久验收摘要见 RFC-003 implementation 第三十九批及 acceptance-audit。此前共享部署／首次切流审批 blocker 已解除，不再重复申请同一授权。

续验：OpenCode 1.18.29 已经真实完成模型调用，原生 Agent `agt_01a09ec50bff7000b944bb4b69ba964a`／终端 `pty_01a09ec50bff700193b2cc8426e6c67b` 返回固定文本 `RFC003_OPENCODE_READY`，显示“本轮完成／进程在线”。切至独立预览可访问真实 development 应用，顶部和工作页签显示未读完成 1；动态中的“查看结果”携带 task／agent／terminal／turn／event／seq 定位原 OpenCode 窗口并清除本人未读。Claude 原窗口仍停在登录选择，未受第二个 CLI 启动影响。此项只证明一次 OpenCode 真实轮次与对应通知／定位，不替代双 Agent 并行执行等剩余验收。

最新续验已补双真实 OpenCode：A＝`agt_01a09ecb8fdc7000910df419595557a0` 与 B＝上述 ba964a 的实际执行时间重叠，预览后台完成时未读 1→2，输入草稿和焦点不变；动态定位、CLI 草稿经代码／预览／跨页签／关闭恢复均实看。取得控制后 PTY 可按纵排和分隔线适配；只读窗保持原 PTY 尺寸，此边界和未验证尺寸继续保留。再次并行执行时，A 经 Escape 中断，再 Ctrl+C 于 07:34:02.125Z 退出（exitCode=0）；B 保持原对象，于 07:34:03.331Z 正常完成。浏览器现为专用项目三窗：Claude 登录选择、A 已结束、B 本轮完成。没有释放容器／B／旧 QA。完整时序与 ID 见 implementation 第四十批；UX-AT-02／03／04／10／36／41 共六项通过，其余 46 项和 RFC-003 整体保持未完成。

## 正在实施：RFC-003（2026-09-13）

设计基线 `1f40fa8` 已获批准。T4 第一批代码与自动测试完成：TaskRunner 只读 `workspaceStatus` 读取实际 HEAD、分支、暂存／未暂存／未跟踪路径、全本地分支未推送与上游关系；Git 错误／浅历史保留 unknown。释放面板先查清单再确认，取消不释放；确认附带会话 ID 防止释放已替换的对象。发布重新做权威检查，Git 失败与分支变化不会继续推送。受控确认面板收进 shared。

本地 `bun run check`：661 pass／1 skip／0 fail（662 tests、98 files、3091 assertions），console build 成功；跳过的是 opt-in 真实 K8s 用例。真实 Git 临时仓库、Runner WebSocket 协议、开发会话用例与工作台释放交互均有自动验证。尚未把此批部署进本机集群，未宣称 UX-AT 真实旅程验收通过。实现证据见 RFC 的 `implementation.md`。

T4 已推送 `ec97e29`，精确 SHA CI 成功（run `34728697239`）。第二批 T14 已实现实际工作树对部署版本比较、四种详情、只读检查与显式补历史；真实 Git、模块、WS 和界面自动测试已通过。已更新本机 control-plane／console／task 镜像并创建专用 `rfc003-ux` 验收项目：`prj_01a09859a1bc7000b8622726e24f34b2`，会话 `tsk_01a0985a8624700090ea5b5ecd4fca86`。实看未部署、未提交计数、untracked patch、释放前清单与取消保留。该项目首次切到 prod 被自动审批拦截，具体授权问题待回复；没有切流或释放旧 demo 会话。浏览器发现的未部署详情误提示过期已修正；T14 最终全量门禁与提交证据续记在 implementation.md。

下一步接 T13／T15 原生 CLI 与轮次事件、T3／T5 紧凑开发工作台。首次进入旧工作台时连接元数据与预览状态不同步也在 T5 修复。其余任务与 UX-AT-01–52 全部保留；下面设计阶段的记录保留为历史证据，不代表当前实现仍待批准。

T14 最终本地门禁 684 pass／1 skip／0 fail（685 tests、103 files、3187 assertions），console build 成功；另修队列立即任务使用应用时间造成时钟偏差漏领的问题，含先红后绿回归。未部署详情已在更新后的浏览器复验，320／390px 无整页横向溢出，完整工作台密度与顶栏仍待 T3／T5。

T14 `8b2560c` 与队列修复 `0b070a6` 已推上 main；精确 SHA CI `34730928927` 成功。T3 品牌小批 `18748285328f924b5ec2ca0b451a630b08d6ad44` 已推送，精确 SHA CI `34731416147` 成功：协作舱已在真实顶栏、favicon 和登录页显示，320px 顶栏可正常换行；自动验证包含资源一致性、可访问名称和两空间返回。

T13 后端小批：原生启动计划、PTY 名册、数据库幂等受理、控制租约、屏幕快照、显式停止及浏览器流重连已接通；旧 headless Agent 保留。真实 Claude Code 2.1.268 与 OpenCode 1.18.29 在一次性 Linux 验收镜像显示原生 TUI，resize／Ctrl+C／退出可观测；没有注入模型凭据，不宣称模型输出或 T15 轮次事件通过。实跑发现并修复 OpenCode 所选模型不可用时自动回退到其他模型，原生配置现在固定平台模型范围。Linux 真实 PTY 四项定向验证通过；本批全量门禁与提交见 implementation.md。接下来仍需 T15 可靠事件与个人动态、T5 真正的紧凑多 CLI／页签界面。

T13 后端已推送 `7290679dadc5315eae15e11b6f8a4576032779d7`，精确 SHA CI `34733116499` 成功。T5 工作台首批接入原生 CLI、个人页签 CAS、横排／纵排／网格与键盘／拖动分隔线、名册收起恢复、独立／并排预览、代码与差异视图；历史对话移至独立 `/dev-session/conversations`，旧 `view=conversation` 保留 agent 参数接续。原生轮次状态仍如实未确认，T15 尚未实施。普通 shell 保留在旧版会话工具中。

本机 `cs-control-plane:rfc003-layout`、`cs-console:rfc003-layout`、`cs-task-runtime:rfc003-layout` 已构建并导入节点，新表迁移 Job `crewstation-rfc003-layout` 已完成。**尚未滚动更新服务**：自动审批拦截 ConfigMap 与 API／会话／控制器／控制台更新，理由为共享集群范围授权不足，具体授权问题待回复。此 blocker 与之前专用项目首次 prod 切流是两个独立问题；原 QA 会话、未提交文件和 demo 没有被重启／释放。可继续其余实现与自动验证，不能把镜像准备或组件测试当作真实工作台验收完成。

T5 首批 `897c3037de03b75b58b26a07cbc7f0eb5b940e4f` 已推送，精确 SHA CI `34735101403` 成功。继续完成 T16 首批：全局市场／详情、project L2 的展示资料和三种可见范围、负责人 CAS 保存与效果检查、精确邮箱／UserId 候选；capabilities L6 有界聚合实际 prod 部署记录，不能当即时健康。默认仅成员，不改生产访问／APIGrant；测试者能查看市场但不获得开发权。

市场与设置已用真实源码加隔离内存验收数据做浏览器检查：1280×720 六张卡片可见，390／320px 无整页溢出；指定名单错误、查找、保存实点通过。真实 DB／HTTP／路由组件覆盖三种范围、权限、分页、名单、并发、撤销、失败和草稿保留；还修了重复邮箱查询任意选人及设置读取失败卸载草稿的问题。完整门禁与发布见 implementation.md。本批没有部署进共享集群，两个待授权操作和 T15／其他 RFC 任务仍未解决。

T16 首批 `6b2325dedb0b202811e43039c2fdbd2e2d8b2807` 已推送，精确 SHA CI `34737114376` 成功。T15 继续实施：已实测 Claude 正常、Stop 要求继续、取消和继续后取消的原生结构化事件；发现单独 Stop／interaction end 不能判定正常完成，HTTP Stop block 的聚合计数在固定版本也不可靠。具体记录在 `native-activity-evidence.md`。同时修复历史／实时交界丢帧、有界分页补齐、新 Runner 序号被旧历史吞掉和旧连接污染状态；完整门禁 750 pass／2 skip／0 fail，console build 成功。OpenCode 插件初始化、轮次归一化、领域投影和个人后台动态仍未完成。

续传修复 `b4ba3265b8dfd22abacb9abfca4042c637600e25` 已推送，精确 SHA CI `34738267327` 成功。T15 OpenCode 后续批已接通实际原生插件／严格事件协议／Runner 收集与 session 持久化，补充能力协商及独立状态重放缓冲。正式仓内原生验收在隔离任务镜像通过：1 pass、21 assertions，涵盖完成、中断、提问／撤回、许可和模型错误。源版本或通道不可靠时保留 CLI 并如实降级；撤回后无最终回答显示结果未确认。完整门禁和发布结果续记 implementation.md。**Claude 完整事件归一化、dev-session 投影／个人已读和顶部动态仍需继续，T15 不算完成。** 两个待授权集群操作未执行，没有更新旧 QA Pod 或生产切流。

OpenCode 状态批 `4b2a40901b5b5de05947656fec1a2a91ad65cd03` 已推送，精确 SHA CI `34740556509` 成功。随后 Claude 固定版本状态通道已接入：原生 hooks、OTLP 轮次关联与有界 transcript 证据联合确认，首次中断无确定结果不误报成功，提问／撤回、许可、Stop 继续／继续后取消及 API 错误有正式原生回归。首轮源码挂载验收 1 pass／29 assertions，后续最终镜像与全量门禁记录在 implementation.md。**下一步继续 dev-session 状态投影、个人已读、页签和顶部 Agent 动态；T15 与 RFC-003 整体仍未完成。** 没有执行两个被拦截的集群操作。

Claude 状态批最终门禁 **795 pass／4 skip／0 fail**，console build 成功；最终任务镜像中的两个原生 CLI 与 Linux PTY **7 pass／77 assertions**。三个运行时跳过项已在该 Linux 镜像实际验证，opt-in K8s 仍未运行。本批镜像只在本地构建和验收，没有绕过共享服务更新或 prod 切流的自动审批拒绝。

Claude 状态批 `3a438766a8e40e1f04f85398089872fa1f981e6d` 已推送，精确 SHA CI `34742233061` 成功。T15 的 dev-session 投影与个人已读继续接通：按持久事件序号补齐，进程／连接／轮次分离；旧轮次、迟到的未知结果及重复事件不会重发完成提醒。待处理按请求保留，查看只更新当前用户；长历史清理仍保留活跃问题的个人已读。名册附带最新状态，动态来源或存储失败不拖垮 CLI 名册，权限错误仍按原规则返回。全量门禁与发布续记 implementation.md；下一步是窗口、页签和全局动态 UI。新迁移只在隔离测试数据库运行，没有更新共享服务或 QA Pod。

投影批最终本地门禁 **813 pass／4 skip／0 fail**，817 tests、140 files、3790 assertions，console build 成功。跳过项与上一批相同；本批没有改动原生运行时，不重复执行已通过的镜像验收。窗口状态和顶部动态仍待接线。

状态投影批 `0e658a7d89d647ff1bb46c2f16d15361a06bfb43` 已推送，精确 SHA CI `34743902755` 成功。随后 T15 UI 已接入窗口／名册／页签状态与顶部动态：按当前身份关注最多 16 个已进入项目的会话，跨页保留，5 秒有界刷新与结构化事件触发刷新；页面不可见时暂停轮询，回来补查。全局待处理、未读完成与个人已读分离，源未确认不显示当前成功。动态支持未读结果及更早页，点击按完整身份恢复原 CLI、核对事件后标记本人，查看不取得输入控制或答复请求。

该 UI 已在真实源码加隔离内存／终端夹具中实看 1280×720 四窗，以及 390／320px 无整页横向溢出；后台完成保留代码视图／输入，收起窗口定位恢复，已读 1 次、停止命令 0 次，关闭动态返回入口焦点。真实 Provider 的 StrictMode、迟到响应、旧会话、已读竞态和菜单定位有自动回归。完整门禁与发布见 implementation.md；这仍不替代共享集群双 CLI／多角色旅程。两个待授权操作未执行，其余 RFC 任务继续。

动态 UI 最终本地门禁 **824 pass／4 skip／0 fail**，828 tests、143 files、3847 assertions，console build 成功。下一批回到 T3 的五个项目入口与管理／开发资源归位，并继续后续 T5–T12；不将局部功能提交视作 RFC 全部完成。

动态 UI 批 `3e9bd2889679f718109a71a2c98f3345b25f8505` 已推送，精确 SHA CI `34745541790` 成功。T3 下一批已收拢为五个项目入口，顶栏／左栏取实际名称和 slug，开发页侧栏为 156px；项目页由 app 注入作用域，便于管理空间复用。项目设置承接成员、可见性、开发／生产配置、开发资源与仓库，概览去掉重复成员／仓库请求。旧配置、能力、目录、日志、事件地址保留有效参数并 replace 跳转。

T7 已接日志任务／发布／时间／条数的真实查询与可清除上下文、按槽到日志、投递到订阅／trace，以及项目作用域的真实 trace 客户端。投递按指定订阅筛选最近 50 条时明确范围，未冒充全历史。配置切换保留两组草稿，跨项目不带入。1280／320／390px 隔离源码界面已实看；完整门禁与发布见 implementation.md。管理接入复用、管理 API 策略迁移、成员定位／配置完整表单、告警及真实旅程仍待继续，不能将五入口提交视作 T3／T7／T9 或整个 RFC 完成。没有执行两个待授权集群操作。

导航与诊断首批最终本地门禁 **836 pass／4 skip／0 fail**，840 tests、144 files、3910 assertions，console build 成功；隔离页面与服务已清理。

导航与诊断首批 `b70846149f659bc7953de012acaa7a1e77ea0f41` 已推送，精确 SHA CI `34746898824` 成功。接入项目现已复用五个项目页面并保持 `/admin/integrations/:projectId` 上下文；旧租户地址按实际类型接续，保留有效定位参数。项目元数据或管理身份未确认时不挂载业务页面，失败可重读；数字人误入管理项目地址则回到正确工作台。

管理项目侧栏保留五个项目操作并折叠全局管理菜单，顶栏、历史对话、诊断跳转与后台 Agent 动态均保持所属空间。接入项目设置不显示数字人市场可见性。真实路由回归包含跨空间兼容、身份／元数据失败、拒绝与重试、后台动态返回；隔离源码页面已实看 1280／390／320px，开发侧栏 156px，无整页横向溢出。最终门禁 **846 pass／4 skip／0 fail**，850 tests、145 files、3954 assertions，console build 成功；临时页面与服务已清理。能力管理／审批入口、新建项目完整流程和其余 RFC 任务仍继续，没有执行两个待授权集群操作。

管理项目批 `90d14c47052f0984cb60da4a8a354af424002abc` 已推送，精确 SHA CI `34747830391` 成功。T8 管理入口首批已完成：能力接入分接入容器／API 策略／事件来源，申请审批分 API／出站；旧管理目录 replace 接续。项目消费页移除平台写动作，管理员可带项目／接口定位进入管理。全局接口未选择调用方时不显示虚假服务授权，撤销明确目标；审批结果走现有真实接口和缓存失效。

申请失败保留理由，API 与出站意见切页签分别保留；刷新失败保留旧记录与草稿但禁止审批，恢复后继续。字数及出站必填约束首屏展示；已展开的共享确认在 busy 时同样禁用。隔离真实源码浏览器实看 1280／390／320px，表格独立滚动、无整页横向溢出；完整门禁 **861 pass／4 skip／0 fail**，865 tests、148 files、4049 assertions，console build 成功。临时服务和页面已清理；本批不包含结构化 API 试调、完整新建向导或共享集群部署，T8／T10 及其余 RFC 工作仍继续。

能力管理批 `6c86d8f4a892be38800706c58722e836bea17232` 已推送并同步 main；精确 SHA 的 Actions／check-suites 暂无记录，工作流 active 且仓库 Actions enabled。尚无终态 CI，后续需继续追踪，不作通过声明。

T10 底层已接通创建选择：新项目保存校验过的初始套餐，单项目开通查询读取真实模板／名称／套餐；首次模板副本采用该套餐，已有远端分支重试不覆盖。旧项目初始套餐未知则保持 NULL。管理员模板目录来自实际 `templates/`／`integrations/`，带真实类型、原套餐和必需配置键；控制面镜像已包含两类源码，未裁定发行包 I8。完整门禁 **868 pass／4 skip／0 fail**，872 tests、149 files、4085 assertions、87.95s；console build 739ms。无网络临时镜像验证了三种模板及接入模板套餐写入，未导入共享集群、未迁移或滚动重启。接下来落实管理空间三步新建向导与真实开通状态，RFC 仍在实施。

创建底层批 `c0b0c89ed5c7ff06dcf358078fc2d44ed7a4276f` 已推送并同步，精确 SHA CI `34749454609` 成功；它包含 `6c86d8f` 能力管理提交，祖先关系已核实。`6c86d8f` 自身没有单独 CI 记录，其内容由此后继完整 CI 覆盖。

T10 三步向导已落地：工作台仅留管理入口，管理总览和能力接入可分别新建数字人／接入容器；基本信息、真实模板／套餐／可选配额、检查创建，返回与失败保留输入。服务器字段错误定位回相应步骤，目录失效暂停提交，在途阻止重复创建。创建成功进入真实开通页，失败可补生产配置／重新排队，并按实际类型进入开发或发布；202、项目 active 均不冒充首发已部署／上线。工作台失败项目也转管理状态页处理。

最终门禁 **875 pass／4 skip／0 fail**，879 tests、150 files、4168 assertions、70.97s；console build 585ms。整页路由新增 7 项回归，覆盖约束、双向步骤、类型模板、准确请求、默认配额、字段错误、目录失败／恢复、空目录、在途锁、管理守卫与开通路径。隔离浏览器已显示桌面／390px 基本信息及填写状态，但 CDP 多次超时，未完成窄屏尺寸度量和完整点击旅程；不能写成完整视觉验收通过。临时页面已关闭、视口已恢复，服务已清理。T10 完整旅程和 T5–T9／T11–T12 等剩余 RFC 内容仍继续，两个共享集群操作未执行。

向导批 `e798f5ad70a6f8c1e33e6230617253e12cfb65cb` 已推送并同步，精确 SHA CI `34750215916` 成功。T9 配置表单已修复请求发出即清空值的故障，失败保留、成功显示真实版本与生效条件；统一字段组件、普通值预填／密钥不读回、可访问键名错误、空值说明、同环境写入锁和目录失败恢复已接入。4 项真实路由回归通过，完整门禁 **879 pass／4 skip／0 fail**，883 tests、151 files、4211 assertions、75.96s；console build 632ms。成员查找、生命周期、生产版本影响明细及跨设置／选键的草稿确认仍待继续；本批没有执行共享集群操作。

配置表单批 `0f942826417debce3d6589a64900d7b131e02552` 已推送并同步，精确 SHA CI `34750838656` 成功。T9 成员设置现已接精确账号／邮箱匹配，保留高级用户 ID 和管理员目录；角色说明、当前负责人限制、具名移除确认、负责人转移确认、失败保留及同项目写入锁均已接入。生命周期承接既有管理员归档接口，说明异步路由移除和资源保留，不冒充已释放会话／容器。

成员／生命周期新增 8 项真实路由回归通过。首轮全量受沙箱 socket 限制，且一个 `model` 局部变量误中既有源码扫描；改用语义更准确命名，正常本机权限下最终门禁 **887 pass／4 skip／0 fail**，891 tests、152 files、4285 assertions、68.23s；console build 626ms。隔离页面导航与可访问接口超时，没有取得本批可用视觉证据；8777 服务已停，浏览器内核重置后未确认临时页签清理。没有变更共享集群，两个原待授权操作仍保留。T9 的实际配置版本影响和草稿导航确认、其余 RFC 工作继续。

成员／生命周期批 `71338776f45c88e725f6722eb3fb70b7c849251b` 已推送并同步，精确 SHA CI `34751732636` 成功。T9 配置现已增加生产两槽实际 Release 配置快照对照：分别呈现保存版本、发布记录和槽状态，查询失败、缺失或不一致保留未确认；只读取当前两个发布，不拉全历史。保存新配置不会被呈现为现有进程已经加载。

选择其他键、清空草稿、离开设置、切项目和浏览器返回均需先确认未保存输入；切换两个常驻配置环境保留草稿，失败保留，成功清除脏标记。新增共享应用内导航确认，不使用原生模态框；刷新／关闭页面的草稿生命周期明确说明。7 项新增回归通过，配置与导航定向共 22 项；浏览器历史用正式适配器加底层事件夹具验证，不冒充真实浏览器验收。完整门禁 **894 pass／4 skip／0 fail**，898 tests、153 files、4349 assertions、70.92s；console build 715ms。没有更新共享集群或取得新的视觉证据，代码编辑和其他设置表单的草稿保护、剩余 RFC 内容继续。

配置版本／导航批 `42b40d66ed013af6c518a873ffb5a0a09cb04d90` 已推送并同步，精确 SHA CI `34752711479` 成功。T5 编辑器草稿现已保护换文件／重载／关闭、离开开发页和返回键；代码隐藏在预览或 CLI 后仍提示未保存，取消后原内容保留。保存按任务通道及请求隔离、同步阻止重复写入，保存期间继续输入只更新已发送内容的基线。原文件 expectedVersion 冲突仍保留草稿；失败重读也保留旧输入。释放确认区分别说明编辑器输入与 Git 清单，文件读写进行中先等待结果。

新增 9 项回归，包含真实路由、任务流、CodeMirror 和 StrictMode，HTTP／WS 仅在边界使用夹具；定向 15 pass／115 assertions。完整门禁 **903 pass／4 skip／0 fail**，907 tests、155 files、4437 assertions、71.68s；console build 616ms。没有获得新的实浏览器证据或更新共享集群，T5 数据访问完整表单、T6 发布统一及其余任务继续。

编辑器批 `4687a49144f6156b38e61fd7d8bc1804fb5aa0ae` 已推送并同步，精确 SHA CI `34753432392` 成功。T5 数据访问已补申请期限、全部字段错误、负责人具名批准／拒绝／撤销、同会话写入锁与草稿保护。开发数据、生产数据只读、生产数据读写可以分别存在，授权和凭据就绪不冒充运行容器已加载或应用正在选用；默认开发连接与额外绑定的撤销后果分别说明。

记录按任务隔离，刷新失败显示未确认并暂停写入；过期凭据不再显示有效授权。实际申请期限由既有存储返回，旧服务缺字段保持未知，不能拿默认时长替负责人确认。详情默认收起，申请／意见草稿和编辑器共用一个离开确认，释放等待数据操作结果。新增 9 项回归，定向 **12 pass／102 assertions**；完整门禁 **912 pass／4 skip／0 fail**，916 tests、156 files、4508 assertions、75.75s；console build 689ms。未新增实浏览器证据，没有共享集群变更；运行中凭据加载／应用数据源仍未确认，T5 完整旅程、T6 发布统一和其余 RFC 工作继续。

数据访问批 `b28272ce295d772ee04118e5a5dfc81052be57a8` 已推送并同步，精确 SHA CI `34754481575` 成功。T6 发布来源底层现已冻结确认 SHA：开发入口核对会话 ID 与 HEAD，按固定 SHA 推送；远端打标核对分支并使用相同 SHA，确认后发生的新提交不会被夹带发布。契约字段可选以兼容旧 CLI／MCP，旧开发请求也固定服务端实际检查到的 SHA。

三个先红回归复现了原入口接受陈旧 SHA、真实 git push 夹带后来提交以及远端忽略确认值；修正后通过。新增 5 项测试并扩展真实 PostgreSQL／GitLab 链路；定向 35 pass／156 assertions，完整门禁 **917 pass／4 skip／0 fail**，921 tests、158 files、4540 assertions、96.53s；console build 608ms。底层发布来源修复已验证，统一来源向导、发布详情、上线／回退界面与完整旅程仍属 T6 待续；未更改共享集群。

来源确认批 `09cef2d555197e9b4af4e85c8248565f8c5e30fe` 已推送并同步，精确 SHA CI `34754984474` 成功。T6 统一发布准备已接入：开发页只保留带 session 来源的跳转；发布页三步确认来源／检查／版本，远端来源无需会话。实际 taskId、分支和完整 SHA 始终可核对，dirty、未知和陈旧来源阻止发布。版本／说明在返回、切来源和失败后保留；目录故障、重复标签、字段错误与离开确认均可恢复。

202 后进入实际 releaseId，未知或错项目记录不回退到最新发布；构建／迁移日志保持精确 ID 和所属空间。重复点击只发一次，离开后的回执不把用户拉回；从开发页准备发布不关闭 CLI。新增 9 项回归，定向 **13 pass／154 assertions**；完整门禁 **926 pass／4 skip／0 fail**，930 tests、159 files、4654 assertions、76.01s，console build 成功。未取得新的实浏览器证据，未变更共享集群；正式／待验证版本并列区、具名上线／回退与完整 T6 旅程仍继续。

统一发布准备批 `0a2d3ca67f6be80720f1488c73e5d51f36779099` 已推送并同步，精确 SHA CI `34755994609` 成功。T6 上线确认底层已补明确的空正式版本和固定待命目标；过期确认不再应用到后来上线／替换的版本。同服务槽的事务读取加更新锁，确认和写入之间不会被第二个请求穿过，普通只读查询不加此锁。

三个先红回归复现空值被忽略、目标替换仍接受以及并发越过旧快照；真实 PostgreSQL 验证第二个请求等待锁，最终一成功一拒绝、只写一条切换和一个事件。定向 **8 pass／71 assertions**，完整门禁 **930 pass／4 skip／0 fail**，934 tests、161 files、4670 assertions、75.08s；console build 621ms。旧客户端省略字段兼容，权限与迁移策略保持既有规则。待继续将该确认接入两版本并列区和具名上线／回退界面；共享集群与 QA 会话未改动。

上线确认底层批 `765d36fe1e1dfa40b6ba446a85d08f964a54189c` 已推送并同步，精确 SHA CI `34756543952` 成功。T6 现已接入正式／待验证版本并列、实际就绪访问入口、具名上线／回退与两个固定 SHA；概览中的第二处切流已移除。切换说明与发布说明共用一份离开确认和写入互斥，取消／失败保留；版本变化需重新检查，错误回执不显示成功，切换后刷新实际部署、历史和工作树差异。

同时补齐发布与切流的事务交叉检查：正在发布时拒绝切流，首次槽初始化不覆盖已有内容，打标后的并发复查只登记一条流水线；冲突明确说明已创建标签但本次未启动。共享轮询修正为后台暂停、回前台补查。新增 13 项回归，前端定向 **24 pass／262 assertions**，后端 **6 pass／68 assertions**；完整门禁 **943 pass／4 skip／0 fail**，947 tests、164 files、4797 assertions、73.60s；console build 603ms。未新增实浏览器或共享集群旅程证据，两个被拦截操作未执行；T6 完整 J3 与其余 RFC 工作继续，下一项补 T7 告警与订阅入口。

发布页批 `7d561808b3ea8c16d5f1d31980b9c4295629cec1` 已同步 main，精确 SHA CI `34757872066` 成功。T7 告警与订阅入口已补齐：最近 100 条的触发／恢复筛选、指定告警详情及结构化槽日志定位；未知记录不换最新，错误不显示为零。通知对象按成员名称选择或填完整 ID，保留原 PUT／DELETE 语义；具名确认、字段错误、失败草稿、收起／离开保护和重复写入锁均接通。

当前 platform 告警通知器只记录日志，未按订阅投递个人消息或 Webhook；页面明确配置保存与通知送达不同，本批没有擅自增加通知投递基础设施或发送真实通知。新增 10 项回归，界面 **8 pass／101 assertions**，客户端与模块定向 **22 pass／84 assertions**；完整门禁 **953 pass／4 skip／0 fail**，957 tests、165 files、4904 assertions、76.93s；console build 618ms。未新增实浏览器与共享集群证据，完整 J4／T12 仍待验收。下一项继续 T8 结构化 API 试调；两个共享操作 blocker 与其他未完任务保留。

告警批 `61b3c1d30ac3a22b83eadc3a699d32e79624e835` 已同步 main，精确 SHA CI `34758815651` 成功。T8 结构化试调的后端、客户端、Runner 与跨副本通道已接通：固定会话、当前可调目录解析、15 秒及大小限制、真实状态码／截断、旧容器明确拒绝；接口参数不拼入 shell。实际 TCP 回归发现并阻止 Bun 在读流中断后重复 POST，不能把未取得结果解释为业务未执行。

新增 18 项回归；后端／客户端定向 **33 pass／145 assertions**，真实 Runner HTTP／WS **5 pass／29 assertions**；两个跨进程用例包含实际 PostgreSQL 连接注册表和两个 session 副本。完整门禁 **971 pass／4 skip／0 fail**，975 tests、169 files、5012 assertions、92.79s；console build 613ms。已有 Linux 镜像只读挂载候选源码、无外网，新增 HTTP 回归 **5 pass／29 assertions、15.22s**，并未部署到共享集群。dev-session 现为 40 个生产源码文件，后续增长先按结构规则 §11 处理。下一批接 API 详情表单与 Swagger；当前没有这两处 UI 或共享集群 J5 验收证据，两个共享操作 blocker 保留。

结构化试调通道批 `435019fcc6afbc8378e846e35e59ed7e02df45fe` 已同步 main，精确 SHA CI `34760440343` 成功。T8 详情表单和 Swagger Execute 已接上同一固定会话通道，显示真实 HTTP／容器耗时／截断；角色、会话、目录和文档变化均有明确处理。输入仅存页面内存，收起／失败保留，换操作／代理／文档／离开前确认；在途修改不会被旧响应清掉，其他操作草稿独立保留。

新增 16 项回归，实际路由与安装的 Swagger bundle 定向 **19 pass／0 fail、119 assertions**；修复了 React 版本混用、响应展示与防抖输入生命周期问题。完整门禁 **987 pass／4 skip／0 fail**，991 tests、172 files、5118 assertions、97.83s，console build 521ms。尚无新的实浏览器／共享集群证据，没有执行两个被拦截的共享操作，J5／T12 与其余 RFC 内容继续。

试调界面批 `be8f4cc8923657f354a26ea890857b79faa4d323` 已同步 main，精确 SHA CI `34763312138` 成功。T9 设置草稿已补齐：可见范围与展示资料分别保存、共同保护离开，取消只清当前表单；修订冲突、设置或身份读取失败保留输入并暂停写入。成员查找／高级 ID 切换保留输入，隐藏 ID 不作为当前目标；角色变化及转移确认保留材料并重新核对当前身份。

新增 12 项真实路由回归，定向 **27 pass／0 fail、216 assertions**；包括重复 submit、错误焦点、独立草稿、浏览器返回、读取恢复和迟到回执。最终全量门禁 **999 pass／4 skip／0 fail**，1003 tests、173 files、5225 assertions、89.42s；console build 471ms。本批没有新实浏览器或共享集群证据，两个被拦截操作保持未执行。下一项继续 T10 创建草稿、套餐表单与管理待办，以及 T11 摘要和 T12 完整旅程。

设置草稿批已本地提交 `4d15e8c6e08ca8e0670733ec769506c529efc688`，**尚未推送、没有该 SHA 的 CI**。自动审批两次拒绝普通 `git push origin main`：先认为缺默认分支发布授权，随后仍不接受已核实的原始用户目标“完整实现RFC并提交上库”作为本次授权依据。已向当前对话提出具体推送确认；回答前不再重试，不改分支或执行方式绕过。远端最后核实为 `be8f4cc`，本地领先这一笔。

本地继续 T10：创建向导的离开／返回／切范围保护与精确回执接续已补齐，迟到结果不拉回；服务和任务两类套餐新增具名编辑、新旧值对照、重读恢复、字段错误与草稿保护，仍使用原整体覆盖接口。新增 13 项回归，创建 **12 pass／141 assertions**、套餐 **8 pass／60 assertions**；最终完整门禁 **1012 pass／4 skip／0 fail**，1016 tests、174 files、5343 assertions、97.94s，console build 483ms。代码在门禁期间保持一致。管理待办、T11 与 T12 仍未完成。本批没有共享集群操作，推送确认仍待回答。

创建／套餐批已本地提交 `7c046bf5b87bd6747de1bd775b13d1236b90305a`，未推送、无精确 SHA CI。本地另继续 T11：项目授权分页、当前页会话／部署／健康的独立摘要、单项目最近发布／切流及客户端方法已接通；默认 20、上限 50 项，最多四个来源同时读取，可选聚合截止后保留未知，迟到结果不改变快照。单项目服务解析改为定点查询。新增 13 项回归，最终完整门禁 **1025 pass／4 skip／0 fail**，1029 tests、176 files、5448 assertions、96.82s；console build 509ms，候选源码保持一致。列表／概览和管理待办界面仍待继续。project 现为 39 个生产源码文件，dev-session 仍为 40。三个自动审批 blocker 未解除，未重试推送或共享操作。CUA 清单读取再次在 30s 后超时，仍无新的实浏览器证据。

摘要后端已本地提交 `936f31aae30b63cba1816e1341eaa0c83531947d`，未推送、无该 SHA 的 CI。后续 T11 界面接入已补齐租户分页、URL 筛选、紧凑六列表格、角色／状态主动作、三种环境事实、健康／待办与具名最近活动。来源有各自过期与错误，未知数量不显示零；进入、前台轮询和恢复时先刷新身份，搜索输入保留。身份成员关系改为一次查询，保持旧形状。新增 10 项界面及 1 项 PostgreSQL 回归，最终门禁续记 implementation.md。管理待办／管理有界入口及 T12 仍待继续，所有自动审批 blocker 与浏览器工具超时保留。

## 最新设计工作：工作台 UX 重设计（2026-09-13）

作者要求依据原始理念全面重设计第一版原型的功能组织、UX 与使用逻辑。已对照两篇理念文章、基线与 RFC-001／002，检查本机界面与源码，完成 `proposal/rfc/RFC-003-workbench-ux-redesign/`：三件套、26 项可追溯审查／意见、开发工作台专项设计、交互附件与其验证记录。

方案：能力市场与数字人项目两个全局入口、五个项目入口（概览、开发、发布与上线、运行与诊断、项目设置）；统一两种源码来源的发布、试用、上线、回退；平台新建与能力接入职责收回管理空间；应用负责人配置市场可见范围，开发者文档／申请／试调在开发资源中保留。保留现有能力，列明工作区预检、成员定位、真实 API 试调、有界项目摘要等接口缺口。

**作者对开发界面的最新澄清**：CLI 逐个启动，取消批量数量；新建／命名工作页签，单页签横排／纵排／网格及可调比例，跨页签移动。界面紧凑，正常桌面一屏四窗；每个 CLI 区分执行中、需人工处理、本轮完成和已结束，后台页签与顶部动态给明确提示并可定位，关闭页签不结束进程。共享工作树、独立／并排预览、实际工作树对生产部署差异继续保留。数据入口改为开发数据／生产数据只读／生产数据读写；开发库会保留，不用“临时”误导生命周期；Agent 操作权限收到高级选项。

专项设计已补个人布局、数据访问语义和轮次状态来源；T13 原生 CLI／PTY、T14 版本比较之外新增 T15 原生轮次状态与后台动态，补 T16 市场与可见性，验收扩至 UX-AT-52。现有 Agent 是 headless JSON，终端卸载会 close，分支数来自远端；原生 PTY 的状态不能由“已连接”或输出静默推断。这些仍是生产实现依赖。

**发现的实际断点**：开发页让用户去发布页切流，但真正按钮在概览；接入容器在管理空间展示却要回租户列表创建；Swagger 只看文档、试调需用户去终端；未推送清单在释放响应后才呈现。具体源码行号与实跑范围见 RFC 的 `audit.md`。

交互附件已验证逐个新增、页签命名／关闭／移入、布局与草稿保留、键盘调整比例、后台待处理定位、完成提示不抢当前输入焦点。历史发布、预览和版本比较记录仍保留并分稿说明。新增能力市场、负责人可见性、独立历史对话入口与“协作舱”品牌 SVG；去掉易混淆的对话模式切换。数据与执行全部为演示，**生产代码尚未修改，不代表真实接口验收通过**。RFC 整体仍待批准，实施任务为 `plan.md` 的 T3–T16；最新设计约束已纳入，未宣称生产能力完成。

设计稿提交前 `bun run check` 为 643 pass／1 skip／0 fail（真实集群用例未启用），console build 通过。GitHub Actions 仍按本次提交的精确 SHA 单独核对；不能把文档门禁替代 RFC 的生产验收。

## 最近一轮：两个 RFC 落地（2026-09-12）

**RFC-001 算力由平台统一提供**（`447e374` ＋ 实跑修补 `39c8e36`）：`AgentProfile` 去掉 `driver` / `model`，只留 `compute` 并 `.strict()`；`project` 模块新增算力档位目录（管理面给驱动与模型，租户面只给档位名与说明）；dev-session、business-task 起 Agent 前在平台侧解析档位，release 在发布时校验档位存在；工作台新建 Agent 只剩档位下拉，平台管理新增算力档位页；安装器从发行包 `profiles/compute-profiles.yaml` 种档位，本机由新的 `deploy/local/seed-catalog.sh` 种 `sample-stub` / `balanced` / `deep`。

**RFC-002 管理空间与租户空间分离**（`72a3e93`）：路由树拆成 `workbenchRoute`（无路径布局）与 `adminRoute` 两棵；原管理单页拆成八页（含总览），守卫三态（pending / 错误 / 拒绝）挂在 `adminRoute`；顶栏空间切换只对管理员渲染，往返记住离开租户空间前的位置（内存，不进 localStorage）；`GET /v1/projects` 接受 `kind` 过滤，**先作用域后过滤**，接入容器因此不再进租户的响应。工作台第一次有渲染测试（happy-dom ＋ 真实路由树，只假 fetch）。

**本机端到端实跑确认**（`console.cs.localhost`，docker-desktop kind）：

- 管理员：左栏八项齐全，算力档位页可增删改，接入容器页列出两个平台项目；租户项目列表只剩 `demo`
- 普通成员（`tenant-user`）：顶栏无空间切换，左栏无管理入口，直接访问 `/admin/users` 得到拒绝页（非 404），带回工作台链接
- 接口层：`?full=true` 对非管理员降级成租户投影而不是报错；非管理员写档位 403；非管理员带 `kind=APIProxy` 拿到空列表
- 发布链：`demo` 仓库的 Manifest 迁到 `compute: sample-stub` 后发布 `v0.1.4`，构建 → 迁移 → 部署到 preview 槽全部走通
- 开发会话：档位下拉选 `sample-stub` 起 Agent，Agent 名册显示的是**档位名**而不是驱动名；`/chat` 业务子任务链回显正常

**实跑发现并已修的三件**（`39c8e36`，细节见 RFC-001 design §9 与 `dev-gotchas.md` 的「契约变更」一节）：开发会话不再因 Manifest 非法而拒绝开启（否则修 Manifest 的唯一路径也被堵死）；Manifest 校验错误现在直接给出改法；`install-platform.sh` 默认重建任务容器镜像。

**尚未处理、需要另议的两件**：

1. **平台推不动受保护分支。** 平台为推送签发的是 Developer(30) 的项目访问令牌，而 GitLab 默认把 `main` 保护在 Maintainer(40)。只要开发会话里产生了新提交，发布就会因推不上分支而失败（本轮改用 GitLab API 直接提交绕过）。提到 Maintainer 意味着开发容器里的人也拿到了 Maintainer，是权限设计问题，不该顺手改。
2. **开发容器里 worker 的 `HOME` 就是 `/work`**，CLI 缓存落进 git 工作区，发布前置检查把平台自己产生的文件当成「未提交的更改」。模板 `.gitignore` 先挡住，治本要给 worker 一个不在仓库里的家目录。

顺带记一笔：`crewstation/demo` 项目下已累积 13 个 `project_*_bot_*` 访问令牌，像是每次签发后没有回收干净，值得查。

## 上一轮（2026-09-12）

**做完的事**：按 `docs/engineering/repository-structure.md` 落下全部代码——18 个模块、17 个包、9 个应用、任务容器运行时、两个接入容器、`tools/arch` 与脚手架。约 46000 行，最大源码文件 299 行（上限 600），`arch:check` 零违规。

**本机集群实跑通过的链路**（`crewstation-system`，docker-desktop kind 节点）：

- 项目开通 → 命名空间／配额／网络策略 → 建仓（最小示例模板）→ 生产数据 → 路由 → 首个标签发布到 preview 槽
- 晋级到 prod 与回滚，两个域名都在服务，切流记录带上一个发布
- 演示登录经网关注入身份，样例页读到当前用户
- 开发会话：init 容器按分支克隆源码、TaskRunner 连上 cs-session、Web 终端有真正的控制终端与作业控制、开发预览域名可访问
- 业务子任务契约：样例 `/chat` 建业务任务、子任务等容器就绪后补发、Agent 回显
- 事件链：内置 EventProducer 投递 → cs-events 去重扇出 → 样例页列出投递
- 两个 Agent CLI 装进任务镜像并以降权身份启动，报出各自的原生会话 id
- 两个平台 MCP 从开发容器内可达，会话级短期令牌鉴权，越权路由如实 403

**没做到的**：本机没有配模型凭据，两个 CLI 都停在「未登录」，**没有任何 Agent 产出过模型输出**；日志没有游标（首版读 Pod 日志尾部，Kubernetes 接口本就没有游标）；M6 的安装器、HA、规模验证未动，CLI 的 `install` / `upgrade` 对依赖发布包的阶段如实报「未实现」。

**留给作者裁定的**：`docs/engineering/implementation-open-questions.md` 的 12 条。其中 **I5 必须先裁**——实现时给 Manifest 的 `env` 项加了可选 `default`，否则模板仓库的首个标签必然发布失败、M1 门禁过不去；这是对契约的扩展，需要追认或否决。

## 下一个 session 从哪里接

1. 读 `CLAUDE.md` 与本文。
2. 要改产品行为或做非平凡重构，先按 `docs/engineering/development-rules.md` §5 立 RFC，登记进 `proposal/rfc/README.md`。
3. 动手前扫一眼 `docs/engineering/dev-gotchas.md`。
4. 本机拉起平台：`./deploy/local/bootstrap.sh`（一次性）→ `./deploy/local/install-platform.sh` → `./deploy/local/verify.sh`；工作台在 `http://console.cs.localhost/`。

T11 列表／概览批最终门禁 **1036 pass／4 skip／0 fail**，1040 tests、177 files、5533 assertions；console build 505ms。已更新与搜索表单冲突的旧创建断言并完成定向和完整验证，36 个源码路径在最终门禁前后保持一致。下一步继续管理员待办与有界管理列表，T12 和先前待授权操作仍保留。

T11 列表／概览本地提交为 `a1a16107bed76891e089198e2bfc9cf1378944b7`，未推送。下一批 T10 申请有界读取已接通 API／出站各自的分页、状态过滤、稳定游标与当前页项目名称；旧全量接口兼容，项目基础查询不逐项取负责人。新增索引只在隔离数据库执行。定向 36 项通过，完整门禁与 UI 接入继续；先前推送和两个共享集群操作的待授权状态未变化。

申请分页底层批最终门禁 **1046 pass／4 skip／0 fail**，1050 tests、179 files、5608 assertions；console build 496ms，26 个源码／迁移候选保持一致。管理总览／项目目录与两类申请列表接线继续。

申请分页底层本地提交为 `704f4ff3f7145ab4db07aa0ddf987d1ee98fcf45`，未推送。T10 管理总览已显示三类独立真实待办，每类最多五条；新增全类型项目管理页，接入容器与它复用 admin 内部的分页／筛选目录，保留类型与管理路径。读取错误、空态、未知数量与身份错误分开，来源恢复和前后台刷新有实际路由回归；本批最终门禁继续。API 申请页、出站申请页与调用方选择的旧全量项目读取仍待迁移，不能宣称 T10／T11 或 RFC 已完成。

管理总览／目录批最终门禁 **1053 pass／4 skip／0 fail**，1057 tests、180 files、5671 assertions；console build 494ms。补齐遗漏的旧管理项目导航分页夹具后完成全量验证，33 个源码候选保持一致。下一步迁移两类申请页与 API 调用方选择，避免继续读取全量项目目录。

管理总览／目录已本地提交 `3dbe02abdd93c702c7c6ee36574a2472cf56f75c`，未推送。API 调用方已改为每页 20 项的目录搜索，独立读取所选项目，翻页／搜索不改变调用服务，资料错误不退回平台操作；未应用输入在重读和翻页保留。新增 3 项回归，与既有管理能力和目录定向 **21 pass／175 assertions**；完整门禁继续。两类申请页与 T12 仍待继续，远端最后核实为 `be8f4cc`，本地六笔提交未推送、没有精确 SHA CI。

调用方分页批最终门禁 **1056 pass／4 skip／0 fail**，1060 tests、181 files、5706 assertions；console build 608ms。12 个源码路径在门禁前后保持一致；接下来迁移 API 与出站审批分页和意见草稿。没有重试推送、更新共享集群或新增实浏览器验收。

调用方分页本地提交为 `ef986db1dea760fab0ebff81759d543be827ecba`，未推送。本地继续完成两类申请页的当前页读取和独立游标，意见按申请保存，切页签保留、换范围／离开前确认，刷新移走申请仍保留输入副本。裁定核对实际回执，同轮只发一次，成功只清原样目标意见，失败与迟到结果有回归。新增 9 项，与管理入口和空间路径定向 **47 pass／358 assertions**；类型、架构、lint 通过，完整门禁继续。管理页的旧全量项目／申请读取已移除，T12 与先前三个外部操作 blocker 保留。

审批分页批最终门禁 **1065 pass／4 skip／0 fail**，1069 tests、182 files、5815 assertions；console build 627ms，24 个源码路径保持一致，lint 无警告。回看剩余 RFC 时发现开发页 view 参数未驱动原生布局、file／target 未完整接入；下一批补齐这些实际链接，不将剩余工作全部归为外部验收。推送与共享操作授权仍未得到新回复。

审批分页本地提交为 `3dadb0e7b72de0eeb319460dd610bdf21ee4e3f2`，未推送。本地继续补齐开发页 view／file／agent／target 定位、浏览器返回、关闭文件地址、未保存及在途写入保护；发布预检、释放前清单与差异文件可直接打开代码。比较面板接到实际待验证目标，核对回执并在聚焦时重读。新增 13 项，连同共享草稿回归定向 **82 pass／741 assertions**；完整门禁继续。没有新的实浏览器或共享集群证据，三个外部操作 blocker 不变。

开发地址批最终门禁 **1078 pass／4 skip／0 fail**，1082 tests、183 files、5900 assertions；console build 518ms，26 个源码候选保持一致。lint 无警告，跳过项与前批相同。当前代码改动已通过本地验证，RFC 仍为 In Progress；完整实机旅程、main 同步和最终远端 CI 尚未完成，不能以这次门禁宣称 T12 完成。

开发地址本地提交为 `c8e4894a4843ec20656048a5aae6b15aaad84359`，九笔普通 main 推送的具体确认待答。后续逐项核对发现预览故障缺日志入口和状态竞态；已补 taskId 日志跳转、事件／旧读取隔离、重连与换任务、单次重启以及操作错误保留。新增 8 项，定向 **22 pass／174 assertions**；最终门禁继续。`acceptance-audit.md` 保留全部 52 项缺证和六条实机旅程，T12 仅进入证据核对。现有共享服务 1／1 且镜像标为 `:dev`，不能当本次部署证明；未重试任何被拦截操作。

预览恢复批最终门禁 **1086 pass／4 skip／0 fail**，1090 tests、185 files、5958 assertions；console build 成功，10 个源码候选保持一致。52 项验收编号完整、文档链接通过，lint 无警告；原生运行时未改。推送及共享操作待授权状态未改变，完整角色／尺寸／实机旅程和最终精确 SHA CI 尚缺，RFC 继续 In Progress。
