# 当前执行状态

> 这份文件让新 session 能立刻接上进度。每完成一批工作就更新它，与提交一起推送。
> 规则见 `docs/engineering/development-rules.md` §9。

## 一句话

基线三件套（v0.3.3）的第一轮实现已在本机 kind 集群上跑通并推上 main；**RFC-001（算力归平台）与 RFC-002（管理空间与租户空间分离）已实现、实跑确认并推上 main；RFC-004 已被 RFC-006 取代（Superseded）；RFC-006（算力档位合并运行环境、每个 Agent 一个 Pod）已实现、实机验收完毕并推上 main，已 Done（P1–P8、ADR-0005 与 I17–I19 待作者复核）；RFC-003 工作台已按设计附件完成并整体部署到本机，52／52 项 UX-AT 全部实机通过、本地 gate 与精确 SHA CI 通过，已 Done；RFC-005（OIDC／OAuth 2.0 公司登录）代码、测试与 OA-01…OA-31 实机验收全部完成，已 Done；RFC-007（开发环境 OAuth 2.0 一键换角色）代码、四角色 Chrome 实机验收、本地 gate 与精确 SHA CI 全部完成，已 Done**。

## RFC-024 CLI 界面就绪：步骤条等到 CLI 画出界面再撤（2026-09-23）—— ✅ Done

作者反馈：新开 OpenCode 时步骤条在进程拉起那一刻就撤掉，之后终端黑屏十来秒，像卡死。根因是 RFC-022 把「已就绪」记在 PTY 进程拉起。

- **改了什么**（652677fa）：Runner 在无头终端上判定界面画出（视口出现可见文字且静止 500 ms，终端查询不落屏、不算；45 秒超时放行），
  记录新增可选 `ui`；启动进度增加「CLI 初始化（等待界面）」段（七段）；创建者窗口在该段内仍算「在用」。旧 Runner 不报 `ui`，该段跳过。
- **CI**：[35855602907](https://github.com/wangbinquan/CrewStation/actions/runs/35855602907) 六项成功。
- **本机部署**：11:49–11:54Z 七个控制面部署与 console 滚到 `iface-20260923`（cs-session 必须一起换，旧的会丢 `ui` 字段）；
  任务底座 `crewstation/task-runtime:iface-20260923`（`sha256:80d06ddd…`）；默认档位 `volc-glm-5-2` 另存**修订 6**，测试通过。
  这是 RFC-023 观察期内的计划内滚动（作者批准）。12:28Z 并行会话把 cs-api／cs-controller／console 滚到 `alerts-trim-20260923`，已含本 RFC。
- **实机**：OpenCode 进程拉起后 43.2 秒才画出界面，步骤条一直停在「CLI 初始化」，撤掉那一刻就是完整界面，见 acceptance.md。
- **待作者定**：43.2 秒贴近 45 秒超时，是否调长；无人持有控制时 OpenCode 不画界面（代答查询）另立 RFC。

## 删除项目级告警订阅，首版不做告警通知（2026-09-23，Design D61）

作者问「运行与诊断 → 告警与通知」里的「添加订阅」是干什么的。答复：订阅只存通知对象与渠道（工作台通知或 Webhook），通知渠道一直待定（Q20），告警触发时平台只在 cs-controller 日志里写一行、从未投递；五种告警类型里也只有两种会触发。
作者：「没用的话，就彻底删除这个功能和代码」。问答裁定：首版不做告警通知（Q20 关闭，E25 作废）；三种从未触发的类型一并删除；页签改名「告警」；流程「直接改＋回填」，提交、推送并部署本机。
版本号：原先留给 RFC-023 的 v0.3.13／D61 由 crewstation-51 让出，RFC-023 的 T8 回填到时取下一个号。

- **删了什么**（64bd5349）：
  - observability：订阅表（迁移 0004 删表）、订阅仓储、三条订阅接口（`GET`／`PUT`／`DELETE /v1/projects/:id/alert-subscriptions`）、通知器端口。组合根里只写日志的告警通知器、项目权限 `manage-alerts` 一并删除。
  - contracts／api-client：订阅 DTO 与三个客户端方法；`AlertType` 只留 `crash-loop`、`health-failing`。
  - console：通知订阅卡片、两个弹窗、hook 与 42 条文案；负责人角色说明去掉「告警订阅」；页签「告警与通知」改名「告警」（英文 Alerts）。
  - 保留：告警记录、每 30 秒的两槽健康巡检与自动恢复、告警详情跳到对应版本的日志。
- **用例**：订阅表不存在、三条订阅接口 404 而同前缀的告警列表仍是 401（module）；客户端没有订阅方法（unit）；负责人和管理员都看不到「添加订阅」、页面不请求订阅接口（console）；e2e 改为断言告警页没有「添加订阅」，两处页签数组改名。
- **顺手修**：RFC-013 升级用例模拟旧库时，把排在身份迁移之后的迁移也提前跑了。此前这些迁移都只加不删，所以一直没暴露；这次的删表迁移会让 0003 身份迁移去读一张已删掉的表。改为每个模块只跑到第一个 `resource_identity` 迁移为止，和真实的旧库一致。
- **回填**（b8845804，基线 v0.3.13）：Design D61、D44、Q20、§1.2、§2.1、§3.1、§3.2、§4.2、§4.3、§5.7、§7.3、§11.3；Proposal R51 与 §0.2；Plan T0.12、T5.9、门槛 G5、AT-49、延后项；tech-evaluation E25；CLAUDE.md、repository-structure；RFC-003 design §2.5、RFC-020 proposal §4.5 各一条修订注记。历史记录（RFC-003 的 implementation 与 acceptance-audit、RFC-020 的 audit 与 acceptance、设计门检视）保留原样。
- **门禁与 CI**：提交前在「60ef91b2＋本批」的干净导出上，check:static 通过，unit 484、module 1182（12 跳过）、console 796 条全过。
- **CI**：64bd5349 的 [CI 35859654268](https://github.com/wangbinquan/CrewStation/actions/runs/35859654268) 与 b8845804 的 [CI 35859724746](https://github.com/wangbinquan/CrewStation/actions/runs/35859724746) 各项全绿（含 e2e 与 gate）。
- **部署**（12:27–12:28Z）：镜像 `cs-control-plane:alerts-trim-20260923`、`cs-console:alerts-trim-20260923`，都用 `git archive b8845804` 构建，只含已提交代码。
  - 迁移 Job `crewstation-migrate-alerts` 在 12:27:39Z 只执行了 `observability/0004_drop_alert_subscriptions.sql`（applied 1）。
  - 随后滚 cs-api（12:28:02Z）、cs-controller（12:28:07Z）、console（12:28:44Z），都一次就绪，重启 0 次。
  - RFC-023 的 72 小时观察：cs-api、cs-controller 的 Pod 在 12:28Z 换新（cs-controller 此前 11:30Z 已换过一次）。
- **实机**：
  - 删除前：订阅表存在但 0 行（本机没人存过订阅，不丢数据）；告警 20 条，全是「健康检查失败／已恢复」。不带身份请求 cs-api，`alerts` 与 `alert-subscriptions` 都回 401，说明订阅路由还在。
  - 删除后：订阅表不存在；`alerts` 仍回 401，`alert-subscriptions` 的 GET 与 DELETE 都回 404；告警记录不变。
  - dev-admin 在无头 Chrome（CDP 9333）打开演示项目的告警页（包 `index-Ddf05WAJ.js`）：六个页签依次是部署与运行形态、健康状态、日志、告警、事件投递、调用链回放；没有「添加订阅」和「通知订阅」，告警记录照常显示；页面无报错，核对完已关页。
  - cs-controller 重启后一分钟内有 3 条 `task-runtime.native-execution` 重试（「Agent 执行环境操作尚未完成」），是执行环境的正常重试，第二次就完成，与本批无关。

## 运行与诊断拆回两个页签；重新部署 500、关掉的 CLI 又出现、概览 CLI 计数三处修复；RFC-025 统一资源管理中心在问答中（2026-09-23）

作者实机连报四件事：「部署健康态和部署拓扑分成两个页签，把拓扑显示放第一个」；「开发容器都已经关闭了，在拓扑显示上还有一个开发会话存在，为什么没清理掉」；「部署待验证版本的时候，报内部错误无法部署」；「刚关闭的 cli 会话，切出开发界面再切回去，还会出现在原处，只是提示不可用，然后我还可以再关闭一次」。随后要求「整个系统要有一个统一的资源管理中心，来管理资源分配、释放、流量等等与 pod、容器、服务相关的生命周期管理，界面回显信息也是基于这个系统标准输出来的」。

- **页签拆分**（70801d23）：问答裁定页签名沿用原名「部署与运行形态｜健康状态」，形态在最前、也是默认；流程「直接改＋回填，提交推送并部署本机」。`OPERATIONS_TABS` 为 topology、health、logs、alerts、deliveries、trace；RFC-020 合并期间的 `tab=status` 改写为 `tab=topology`；概览形态卡链到 topology，健康横幅链到 health。回填 RFC-020 proposal §4.5 与 §8 D3、design §7，RFC-019 design。
- **重新部署 500**（cc99553d）：demo 的 v0.1.2／v0.1.3 发于 RFC-001 之前，发布记录里的 Manifest 只有 `driver`／`model`、没有 `compute`，`computeProblem` 读 `f.name.kind` 抛 TypeError（`POST /v1/releases/…/redeploy` 10:56:12Z 500）。库里 44 份存量 Manifest 只有这 4 份（另有 gitlab-event-producer、reference-api-proxy 各一份 v0.1.0）不符合当前写法。`prepareSlotDeploy` 先按当前 `ManifestSchema` 校验；作者裁定这类版本照常列出，确认时 412 写明原因与出路。RFC-021 design §4 加修订。
- **拓扑里的「开发会话」不是漏清**：关掉的是 CLI（执行 Pod 10:52:28Z 已回收）；剩下的是 demo 会话工作区 `task-r-01a0cda7…`（09:44Z Calico 迁移时「重建开发环境」建的，作者正连着它），按不变量 2、14 与 D50 结束 CLI 不释放会话、空闲只提醒。界面分不清「关的是 CLI」与「会话容器还在」，归入 RFC-025。
- **关掉的 CLI 又出现**（8e5b022d）：「刚关掉」只记在 `NativeWorkspace` 内存里；结束是异步的（204 后约 1–2 秒才报 ended），前端名册缓存 30 秒；对账连已关闭列表里的在运行 CLI 也放回。改为以个人布局的已关闭列表为准（旧布局迁移时清空旧含义的收起列表、由对账重新归位）。同一批：布局读写各最多等 15 秒（当时一次 PUT 在旧驱动的 cs-api 里挂了 490 秒，后续保存全排在它后面）；顺手修概览开发卡「N 个 CLI」数的是全部记录（demo 0 个在跑却写 14 个）。RFC-003 development-workspace §5 加修订二。
- **门禁与 CI**：提交前在「HEAD＋本批」干净导出树上 check:static 通过，unit 482／module 1177（12 skip）／console 802 全过（console 第一次整跑偶发既有的 `agentExecutionStreams`，单跑 5／5 绿）；新用例都先在 HEAD 上确认为红。8e5b022d 的 CI 35857119774 六项全部成功。
- **部署**：12:04:33Z 只滚 cs-api 与 console → `cs-control-plane:ops-tabs-20260923`／`cs-console:ops-tabs-20260923`（`git archive 8e5b022d`，含 crewstation-d9 的 38931a7c 与 RFC-023 的 postgres.js；d9 先跑了 scm 迁移 0004），线上包 `index-BgECn4I6.js`，其余控制面未动。
- **实机**（Chrome 扩展新标签页，dev-admin）：`?tab=status` 改写为 `?tab=topology`，六个页签、形态默认；健康页签只有两槽健康卡。v0.1.2、v0.1.3 的重新部署探测返回 412 与原因（探测故意带错的待命槽 ID，状态不可能改变），列表里仍可选。rfc003-verify-workbench 新开一个 CLI、结束后名册仍报 running 时切出再切回，不再出现；布局 12:08:47.686Z 落库、进程 12:08:48.495Z 才报 ended，执行 Pod 已回收。概览 demo 与 workbench 均为「main · 0 个 CLI」。cs-api 部署后无 TypeError，页面无控制台错误。
- **协作**：crewstation-d9（概览页头与仓库链接）、f7（告警改名，等 70801d23）、78（调用链页签）、b2（项目设置）与 RFC-024 会话同时在改相邻文件；共用的 i18n、用例、RFC-020、apiClient 用例都用私有索引只提交了自己的 hunk。
- **RFC-025 统一资源管理中心（Draft，4a60a287）**：三件套、盘点底稿 `audit.md`（各资源的申请／状态／释放／对账、界面读法、17 套状态词汇、本机实查的不一致）与 ADR-0009 草案已落档，**待作者批准三件套，并确认提案 §11 的 Q1–Q8（模块与层级、八个阶段、SSE、限流初始默认值、历史保留期、说明页的接口行为、分期、旧接口）与 §12 的能力影响清单 C1–C8**。四轮裁定（D1–D13）：管理范围为任务类容器、服务槽与构建、路由与切流、网关限流，外加命名空间与额度、网络策略、数据资源；可以跨多个模块，但资源状态收口在 infra 层；声明式——各模块存期望、中心存实况并调和（D53 要改）；界面只读「一个资源视图＋推送流」，推送方案由我设计；遗留对象按种类处理（Pod、Secret、Service、路由自动删，PVC 标注后由管理员确认）；失败的开发会话保留 72 小时供诊断后回收；网关限流管平台接口、用户域访问数字人、服务域调用（不管开发预览），维度、超额行为与默认值由我设计；待命槽没有工作负载时摘除待验证路由并给说明页。
- **下一个 session 注意**：本机现有遗留对象（rfc006-verify 僵尸 Pod 与路由、09-21 批量失败的三个项目的 PVC 与路由、demo／workbench 各两条同 Host 的开发预览路由、重建后没删的旧 Runner Secret、3 个已释放业务任务的 PVC）原样留着，等 RFC-025 按「按种类处理」的规则实施时一并处理。

## 概览页头去掉仓库与应用地址，仓库链接移进项目信息卡，打开仓库改用 GitLab 的网页地址（2026-09-23）

作者：「在项目开发页面，顶部放了一个仓库链接和应用链接，应用链接就不要放了，仓库链接放到项目信息里面去」。所指是项目概览页头第二行（「仓库 crewstation/demo ↗」、正式／试用两个域名、「项目信息」按钮）；开发页页头没有仓库链接。两轮问答（含 ASCII 预览）裁定：项目信息卡加一行仓库外链、源码仓库卡不动（路径出现两次，作者选定）；页头只剩的「项目信息」按钮并到身份那一行末尾；流程「直接改＋回填 RFC-020，提交、推送并部署本机」。

- **第一批 `234e1e0`**：`ProjectOverviewPage` 删页头第二行与概览的仓库查询，应用仍由两张版本卡上的「打开正式应用」「打开试用」打开；`ProjectInfoCard` 末行「仓库」外链（新窗口，引用型文字链接），新增 `model/useRepositoryBinding` 与 `RepositoryCard` 共用一次读取，开通未完成为「—」、读取中或失败写「暂未读取到」；删 `projects.summary.repository`，加 `projects.info.repository`／`repositoryUnread`。用例 `projectSummaryPages` 两条改写、`projectResources` 两条改写一条新增，六条改前红。回填 RFC-020 proposal §4.2／§4.6／§4.8、design §4／§7／§9、plan §4。「全站按钮统一」一节「留给作者」里概览页头保留 ↗ 的那条随之不再适用。[CI 35854231290](https://github.com/wangbinquan/CrewStation/actions/runs/35854231290) 六项成功。11:26Z 只滚 console → `cs-console:overview-info-20260923`（`git archive 234e1e0`，包 `index-Cq3ou84I.js`）。CDP（dev-developer，演示数字人，只读）：页头元数据只剩一行「demo 数字人 已开通 开发者 · CrewStation Admin ［项目信息］」，无外链、无「仓库」字样，概览不请求 `/repository`；点「项目信息」到 `settings?tab=info`，项目信息卡四行、末行「crewstation/demo ↗」，整页只读一次仓库；1440 与 390 宽无横向溢出、无控制台错误。
- **实机发现并修（第二批 `38931a7c`）**：两处打开仓库的链接（以及原先页头那个）都指向由 `CS_GITLAB_URL` 拼出的克隆地址 `http://host.docker.internal:8929/crewstation/demo.git`，本机浏览器解析不了 `host.docker.internal`（`/etc/hosts` 只有 `kubernetes.docker.internal`）；GitLab 自报的 `web_url` 是 `http://127.0.0.1:8929/crewstation/demo`。作者裁定：改用 GitLab 的 `web_url`、旧绑定读取时补一次、取不到时退回克隆地址，直接修改＋回填（RFC-020 design §7 同日修订、plan §4）。`RepositoryBindingDto` 加可选 `webUrl`（不在业务契约金样范围内）；scm 建仓时记下 `web_url`，迁移 `scm/0004_repository_web_url.sql` 加可空列并入锁；`getBinding` 对已就绪、缺网页地址的绑定向 GitLab 查一次（远端项目 ID 须一致）并落库，查不到或不可达原样返回、下次再试；工作台 `repositoryWebUrl()`。用例：`scmUseCases` 三条、`scmModule`（真实 PostgreSQL）一条、新增 `gitLabGatewayAdapter.test.ts`、`projectResources` 一条新增两条改写，新用例对改前代码 6 条红；「HEAD＋本批」干净树 `check:static` 通过，模块级 1178 pass／12 skip，工作台 797 pass，方法级只有导出树里 `integrations/`、`templates/` 缺依赖的 3 条（与本批无关）。
- **第二批 CI 与部署**：[CI 35856918620](https://github.com/wangbinquan/CrewStation/actions/runs/35856918620) 六项成功。事先通知 crewstation-51／-78／-90／-b2／-f7（51 无异议并请求记下 cs-api 就绪时间；RFC-024 `652677fa` 随包上线，按其提交说明旧 Runner 不报 `ui` 时该段跳过）。迁移 Job `crewstation-migrate-weburl`（`cs-control-plane:repo-weburl-20260923`，`git archive 38931a7c`）11:59:06Z 完成，只应用 `scm/0004_repository_web_url.sql`；cs-api 11:59:20Z 就绪（此前已被别的会话换成 `iface-20260923`，新镜像包含它），console 12:00:06Z 换成 `cs-console:repo-weburl-20260923`（包 `index-BW4C-5ae.js`）；cs-controller 未动（新建仓库的网页地址同样由读取时补上）。中间镜像 `cs-console:overview-info-20260923` 已从节点与 docker 删除。
- **第二批实机**：滚动后 14 个仓库绑定 `web_url` 全为空；dev-developer 打开演示数字人「项目设置 → 项目信息」后，项目信息卡「crewstation/demo ↗」与源码仓库卡「在 GitLab 中打开」都指向 `http://127.0.0.1:8929/crewstation/demo`（新窗口），接口 `httpUrl` 仍是克隆地址、`webUrl` 为网页地址，库里演示仓库的 `web_url` 已补上（其余 13 个等被读到时补）；页面只读一次仓库、无控制台错误；本机 `curl` 该地址 302 到 GitLab 登录页（私有仓库，未登录 GitLab 时的正常表现），cs-api 五分钟内无 warn／error、重启 0 次。另在工作树对本机 GitLab 跑 `gitlabIntegration`（5 pass，临时仓库已永久清除），并补一条断言：建仓记下的 `webUrl` 等于 GitLab 自报的网页地址（随本节一起提交）。
- **提交方式**：两批都用私有索引只放本批文件；共享文件只放自己的部分——`projectSummaryPages.test.tsx` 第 138 行留给 crewstation-90（运行与诊断拆页签），RFC-020 design 里 crewstation-90 的 D3 修订与 `migrations.lock.json` 里 crewstation-f7 的 observability 0004 都由对方自己提交。

## 项目设置三处减法：删「生产配置与部署版本」卡、删「检查保存后的效果」卡连同检查接口，成员弹窗重排（2026-09-23）

作者先后问：生产变量页的「生产配置与部署版本」卡、应用展示页的「检查保存后的效果」卡有什么用，没用就删；又说「添加成员的那个弹窗排版也太丑了，你自己看看，优化一下」。逐项说明用途后，作者裁定：部署版本卡「整张删掉」；检查卡「删卡片，接口一起删」；成员弹窗由实现者直接优化；直接改＋回填，提交、推送并部署本机。

- **删掉的东西**：
  - 生产组的「生产配置与部署版本」卡（`ProductionConfigImpact`）。配置页不再读服务的两个槽和各槽当前的发布记录。
    - 代价：工作台从此不显示某个版本部署时用的是第几版生产配置；发布记录的 `configVersion` 照旧写入。
    - 生效条件仍写在生产变量卡的说明和保存提示里。
  - 应用展示的「检查保存后的效果」卡（`VisibilityCheck`），连同后端 `GET /v1/projects/:projectId/app-visibility/check`：`checkAppVisibility`、`appVisibilityBasis`、`AppVisibilityCheckDto` 和 api-client 方法一起删。
    - 控制台是这个接口唯一的调用方。
    - 业务契约面金样不含市场接口，不需要 `contracts:lock --breaking`。
- **成员弹窗**：
  - 布局：一栏，先选人，分隔线下选角色；三种查找方式用 `Segmented` 在一行里切换。
  - 账号卡片：查到的人与已选中的人共用新的 `shared/project/PersonCard`，名字、邮箱各一行，动作靠右。可见范围弹窗和正式版本维护弹窗的查找结果也跟着变。
  - 负责人转移规则：降为角色下方的说明，挂到角色选择的 `aria-describedby`。
  - 提交键：目标已是成员时叫「保存角色」，否则叫「添加成员」（原来是「添加或改角色」）。
  - 对齐：`MemberLookup` 的「查找账号」原来 `margin-top: 21px`，比输入框高 6px；改为按标签行高算的居中偏移，实量上下各差 2px。
- **回填**：
  - RFC-009：proposal §3.3／§3.4、design §3.1，plan 与 acceptance 里的 PS-06。
  - RFC-003：design §2.7；market-visibility.md 的说明段，§5 接口表那一行标「已删除」。
- **用例**：
  - `configImpact` 改为断言对照卡不在、不读槽与发布记录。
  - `visibilitySettings` 断言只有两张卡、不请求检查接口。
  - `projectMembers` 新增一条排版与提交键用例，其余改用新文案和 `selectedPerson()`。
  - 模块 `appVisibility` 断言负责人与管理员请求检查接口都是 404；真实 PostgreSQL 上 5 pass。
- **部署前的实机核对**：从 `git archive HEAD`＋本批文件构建工作台包，dev-admin 身份的无头 Chrome 里只换 `/assets/*`。
  - 成员弹窗：查找、候选、选中、用户 ID、管理员目录、修改角色都核对了；可见范围弹窗的查找也核对了。深浅两色、390 宽下都没有横向溢出、没有控制台错误。
  - 应用展示只剩两张卡；生产变量页只有「生产变量」一张卡，资源计时里没有 `/slots` 与 `/v1/releases/` 请求。
  - 全程只开弹窗、查账号，没有保存任何东西。
- **已推送并部署**：`1d7af589`，[CI 35858597265](https://github.com/wangbinquan/CrewStation/actions/runs/35858597265) 六项全部成功（含 `gate` 新增代码防护与 `e2e`）。
  - 本机从 `git archive 1d7af589` 构建 `cs-control-plane:settings-trim-20260923` 与 `cs-console:settings-trim-20260923` 并导入节点。滚前核对 `platform_infra.migrations`：108 个锁定迁移全部已执行（含 crewstation-d9 的 scm 0004）。
  - 12:11:49Z–12:12:28Z 只滚 cs-api 与 console（线上包 `index-CynD0weh.js`），滚前通知了各并行会话。
  - 部署后实机（dev-admin，不换资源）：检查接口 404，可见范围与账号查找 200；成员弹窗、应用展示两张卡、生产变量页一张卡与部署前一致；发布页「进入维护」弹窗的账号查找也换成了同样的卡片。无横向溢出、无控制台错误，全程没有提交任何表单。
  - 本机没跑 e2e：`capabilityDepth` 会以 dev-admin 打开开发页、改动作者的个人布局；以 CI 的 e2e 为准。
- **环境变量都不是实时生效**（作者同时问到，结论来自源码）：
  - 开发组在新建容器时注入（`modules/task-runtime/application/containerEnv.ts`）。新开的 CLI／Agent 执行 Pod 继承父环境的 kind（`nativeExecution.ts:67`），会拿到新值；开发容器本身和其中的预览进程要「重建开发环境」才拿到。
  - 生产组在部署时写进 Deployment 的 env（`modules/release/adapters/k8s/slotDeployer.ts:19`）。只有发布新版本或从发布记录重新部署才采用，重启 Pod 也不会。

## 升级时自动迁到 Calico；安装与升级预检实测 NetworkPolicy（2026-09-23，Design D60）

作者问「新部署集群或者升级，会不会自动升到目标网络架构」。
答复：本机新建集群会（bootstrap.sh 第一步就迁）；已有集群只跑 install-platform.sh 升级不会；产品安装器按设计不替换网络插件，而它的预检只查源 IP 保留，不查 NetworkPolicy 是否真的执行。
问答裁定：本机升级「自动迁移并重建全部 Pod」；产品预检「预检实测」。流程沿用「直接改＋回填」，取 D60／v0.3.12（crewstation-51 确认；RFC-023 以后的回填用 v0.3.13／D61）。

- **本机**：
  - `install-platform.sh` 开头先跑 `calico-cni.sh --check`：0 表示已迁完；10 表示要迁移，先迁移再安装；其他退出码表示检查本身出错，停止安装。
  - `calico-cni.sh` 第 3 步改为 `rebuild-old-range-pods.ts`，重建旧地址上的全部 Pod：
    - 有控制器的按依赖分四批删 Pod 重建：系统组件 → 平台底座 → 网关与平台服务 → 各项目。每批等工作负载的新 Pod 就绪。
    - 用删 Pod 而不是滚动重启：本机 CPU 请求占满时，滚动多出来的新 Pod 会一直 Pending。
    - 任务 Pod 以管理员身份走集群管理（RFC-010）的运维操作：
      - 开发会话按「管理员重启工作区」换新容器、保留工作卷，会话里的 CLI 随之结束，要重开；
      - 业务任务能重启就重启，否则删除；档位测试删除；
      - 处理不了的逐个列出，kindnet 的地址转换链保留。
  - 管理员登录（`platform-admin-session.ts`）先用口令（环境变量或 `.local/admin.env`）。本机口令登录已被关掉，这时走开发角色登录器（`as=dev-role-admin`）。
  - 旧网段只算 Running／Pending 且不在终止中的 Pod：CI 里 Completed 的迁移 Job Pod 状态里还留着地址，算上它每次安装都会以为要迁移。命名空间按整名匹配。
  - 用例：calicoCni 7 条、rebuildOldRangePods 15 条、platformAdminSession 8 条，installPlatform 新增 3 条。
  - 实机：
    - 本机集群已迁完，`calico-cni.sh --check` 返回 0（「network plugin: Calico; nothing on the old range」）；
    - 以当前 Calico 网段做 `--dry-run --prefix 10.244.`：以开发角色登录器取得管理员会话；38 个有控制器的 Pod 分四批
      （系统 4、底座 4、网关与平台服务 11、项目 21）；demo 与 rfc003-verify-workbench 两个开发会话经集群管理查到，动作为重启。未执行任何改动。
- **产品**（Design D60）：
  - CLI 的安装与升级预检新增「NetworkPolicy 实测（D60）」（`apps/cli/src/cluster/networkPolicyProbe.ts`）：
    - 临时命名空间里放一个应答端和两个探针 Pod，镜像取发行包里的控制面镜像；
    - 套了禁止出站策略的必须连不上，没套的必须连得上，测完删掉命名空间；
    - 发行包里没有控制面镜像时报「待配置」。
  - 预检有失败项时，后面的阶段一律不执行、记为跳过（`runPhases`）：升级既不迁移也不滚动。
  - kubectl 访问层支持经标准输入传清单。用例：networkPolicyProbe 7 条、kubectlAccess 2 条。
  - 实机：用本机的 `cs-control-plane:dev` 充当发行包镜像，在本机集群上跑 `install --only preflight`，这一项「成功：套了禁止出站策略的探针连不上，对照探针连得上」，临时命名空间随后删除。
    探针 Pod 的优雅退出期设为 1 秒：bun 作为 1 号进程不处理 SIGTERM，不设的话删命名空间要等满 30 秒。
  - 回填（基线 v0.3.12）：
    - Design §11.1、§11.4、§12.2 与 D60；顺带删掉 §11.3 配置示例里 RFC-018 已下线的 `egress` 段；
    - Proposal §0.2 变更表与风险表；
    - Plan T6.1、T6.4、AT-16、AT-17a，开头「本计划依据」一句跟上 v0.3.12／R01–R58／D01–D60。
  - dev-gotchas「本机集群的网络插件是 Calico」同步补上自动迁移与旧网段判定。
- **提交与 CI**：
  - 三笔提交：`dc3c7ab`（本机迁移）、`0d1aebf`（CLI 预检）、`5baa128`（基线 v0.3.12）。
  - 提交前在「e34bdeb＋本批」的干净导出上：`check:static` 通过；方法级 464 条、CLI 145 条全过；新文件行覆盖 97% 以上。
  - [CI 35854019083](https://github.com/wangbinquan/CrewStation/actions/runs/35854019083) 六项全绿。e2e 的日志：
    - bootstrap 在全新集群上由新工具重建第 1 批的 4 个系统 Pod，报「旧地址上已经没有 Pod」，同一次就删掉了地址转换链；
    - install-platform 开头的检查报「network plugin: Calico; nothing on the old range」，没有触发迁移。
- **没验证的**：
  - 真正从 kindnet 迁移、带开发会话的整条路径只在用例里跑过：本机已经迁完，CI 每次都是全新集群；
  - 产品探针在「网络插件不执行 NetworkPolicy」时判失败，这一支只在用例里验证过：本机集群造不出这种插件。

## RFC-023 数据库驱动换成 postgres.js：实施、部署与 72 小时观察（2026-09-23）

作者对 I16（Bun 内置 SQL 的连接池在并发突发下错位）裁定 (b) 换 postgres.js，随后批准 RFC-023。Q1 不保留切回开关，Q2 观察 72 小时，Q3 显式设置连接回收参数。**RFC-023 为 In Progress**：DB-01…DB-07 通过，DB-08 观察到 **09-26 11:16Z**。

- **改了什么**（e34bdeb）：
  - 连接层改用 postgres.js：上限 10，连接超时 10 秒，空闲 60 秒回收，连接寿命 30 分钟。会话默认值照旧经连接串的 options 生效。
  - 测试库与数据模块的建库适配器同步换驱动，依赖 postgres 3.4.9。
  - 原生 SQL 里直接传的 Date、对象改为先转文本；dev-gotchas 新增一条。
- **证据**：同一套突发脚本打一个隔离的 cs-api 副本。旧驱动 6 轮每轮都被探针重启，共 102 行 I16 特征报错；新驱动 6 轮 0 报错、0 重启，50,579 个请求全部 2xx。CI 35851282033 六项成功，e2e 用新驱动全新安装。
- **本机部署**：11:14Z 其余六个部署、11:15:56Z cs-api 换成 `cs-control-plane:pgjs-20260923`；迁移 Job 没有待应用的迁移。验收项目 `rfc023-verify` 保留。
- **顺手修**：数据模块的 `expireBindings` 一直没接后台任务，到期的只读／可写绑定显示生效中、临时角色不删。7d12f70 改为 cs-controller 每分钟收一次；11:30Z cs-controller 换成 `pgjs-20260923b`，实机核对 5 分钟绑定到期后 30 秒内收掉。
- **释放即收回**：作者裁定开发会话释放时直接收回它的数据绑定（「已经有了弹窗提示了」）。60ef91b2：数据模块订阅「任务已释放」事件，申请中、已批准、生效中的一律记为已收回并删掉临时角色；Design §9.8 补了一句。
- **下一个 session 注意**：
  - 09-26 11:16Z 之后，核对 cs-api、cs-session、cs-controller、cs-events 的重启次数与日志里的 I16 特征行（`ERR_POSTGRES`、`JSON Parse error`、`Failed to read data`、`INVALID_MESSAGE`、`UNSUPPORTED_INTEGER`）。都为 0 才能把 DB-08 记为通过。
  - 然后做 T8 回填：Design §3、tech-evaluation E04。基线版本与决策号取 T8 当时的下一个号：v0.3.13／D61 已由 crewstation-f7 用于删除告警订阅，v0.3.12／D60 是 crewstation-9c 的网络插件预检。I16 关闭，RFC 置 Done。
  - 原生 SQL 读时间列得到字符串、int8 得到字符串，写新代码时照 dev-gotchas 那条来。

## 本机集群的网络插件换成 Calico：Runner 反复掉线的根因（2026-09-23）

crewstation-51 报来一个现象：演示项目的两个旧 CLI 执行 Pod 和 rfc003 工作台会话的 Runner，每隔几分钟就 90 秒空闲断线，之后约 5 分钟连不上。
作者说「好」，交我接手；查明根因后，作者裁定「换成 Calico」「现在一起重建」「现在做」，删 Pod 被权限拦下时又说「你自己跑」。

- **根因**：Docker Desktop 自带的 kindnet 用 kube-network-policies 在用户态（NFQUEUE 101）执行 NetworkPolicy。
  - 「已放行」的 conntrack 标签 28 打不上：日志持续报 `failed to set verdict with label … netlink send: i/o timeout`，至少从 09-22 起每小时 30 到 100 次。
  - 于是任务 Pod 的每个包都进队列：同一条保持连接发 50 个请求，队列编号涨 108。
  - 每次 nftables 规则同步（一次 33 秒）还会丢掉队列里的包（kube-network-policies#402，修复 #403 未合并）。
  - 表现为：两个不同命名空间的 Runner 同时断、同时恢复，而 cs-session 一直健康。上游 kindnet 仓库已归档，升级大概率解决不了。
- **迁移**（09:13–09:44Z，事先通知了 crewstation-51／-db／-49、按钮统一会话等，各方确认暂停）：
  - 装 Calico v3.32.2：地址池 `10.244.128.0/17`，不封装，出站做地址转换；
  - 删 kindnet：DaemonSet、授权、节点上的 CNI 配置与策略表；
  - 44 个有控制器的 Pod 按依赖分四批重建：系统组件 → postgres／prometheus／镜像仓库 → 网关与平台服务 → 各项目服务槽；
  - 6 个无控制器的任务 Pod 直接删除：演示项目两个 CLI 与开发会话、rfc003 工作台开发会话、rfc022 两个失败任务；
  - 最后删掉 kindnet 的 `KIND-MASQ-AGENT`。
  - rfc006-verify 的僵尸任务 Pod `task-01a0bc96ee15`（3 天前起就是 Unknown、没有 IP）原样留着。
- **验证**：
  - `verify.sh` A–E 全过：C 项确认网关仍看到真实的源 Pod IP；新增的 E 项确认 kindnet 不在、Calico 挡住了禁止出站策略下的 Pod。
  - 演示服务槽实测能连 crewstation-system，连不上外网。
  - 网关 Pod 身份索引 26 条全是新地址。
  - 演示项目的开发会话用「重建开发环境」恢复（09:44:54Z 受理，工作卷保留，CLI 要自己重开）。
  - Runner 从 09:45:27Z 起观察 35 分钟：空闲断线 0 次、连不上 0 次，只有开头那一次连接；节点上没有 NFQUEUE 规则。迁移前同样的 Runner 每十几分钟断一次。
- **仓库**：
  - `439b61e`：
    - `deploy/local/calico-cni.sh`：幂等，bootstrap.sh 第一步调用，在迁移后的集群上完整重跑过一遍；
    - `deploy/local/calico-manifest.ts`：钉住版本与校验和，三处本机定制，附四条用例；
    - `verify.sh` 的 E 项和 `deploy/k8s/verify/30-deny-egress.yaml`；
    - dev-gotchas「本机集群的网络插件是 Calico」，并给「ClusterIP 不通」补注。
  - `cf5f325`：calico-cni.sh 第一次跑总会停在「还有旧网段的 Pod」，因为刚删掉、正在终止的系统 Pod 也被算进去了。现在跳过这些 Pod；命名空间过滤原来是子串匹配，改为整名匹配。附三条打桩用例，其中两条在旧脚本上失败。
    CI 每次新建集群都会撞上这个问题：ea9ef8d 那轮停在两个正在终止的 coredns 上，没删地址转换链；437bffe 那轮带上了修复，同一次运行里就删掉了。
  - `e334544`：CI 的 e2e 诊断补上 cs-controller／cs-session／cs-events 的日志（含被探针重启前那一轮）和系统命名空间事件。
- **CI**：
  - 439b61e 用临时文件改写 bootstrap.sh 与 verify.sh，丢了可执行位。此后五次 CI 的 e2e 都在 bootstrap 报 Permission denied（exit 126）。ea9ef8d 修回，dev-gotchas 记了「临时文件会丢掉可执行位」。
  - Calico 上的前五次 CI：f4fb68c、d70964b、1a43ee9 全绿。ea9ef8d、55f5cbd 的 e2e 挂在集群指标（CPU 60 秒内没到 fresh）和拓扑（cs-api 显示「没达到最低可用」）上，两次都是 cs-controller 启动约两分钟后被重启一次。
  - 判断是 I16（Bun SQL 连接池错位，RFC-023 要换掉的就是它），不是 Calico，依据有三：
    - 本机 Calico 下指标每 15–20 秒一条，都是 fresh；
    - 同样的 CI 集群有三次全绿；
    - Calico 之前的 e73d98e 也挂过同一条拓扑用例，当时 cs-controller 是 0/1。
  - 原来的诊断步骤不打印 cs-controller，所以两次失败都看不到报错特征，e334544 补上了。
  - 437bffe（含 cf5f325）与 e334544 两轮 CI 六项全绿。
- **事故**：查 kindnetd 的参数时，我在 kindnet 容器里跑了 `kindnetd --help`。它不认这个参数，直接又起了一个完整实例，并行跑了几分钟；我去结束它时被自动模式拦下，最后它因输出管道断开自行退出。这一条已写进 dev-gotchas。
- **下一个 session 注意**：
  - Docker Desktop 重置 Kubernetes 集群后 kindnet 会回来，届时重跑 `bootstrap.sh`（verify.sh E 会报出来）。
    Docker Desktop 重启或升级会不会把 kindnet 装回来，还没验证过。
  - 只跑 `install-platform.sh` 的升级不会动网络插件。别的机器上还在用 kindnet 的集群，要重跑一次 `bootstrap.sh`，再把脚本列出的旧网段 Pod 逐个重建。
    重建之前，这些 Pod 上的 NetworkPolicy 没有人执行：kindnet 已经删了，Calico 只给经它接入网络的 Pod 执行策略。
  - rfc003 工作台等验收项目的开发会话还没重建，要用时各自在工作台里「重建开发环境」。
  - dev-gotchas 里那条「ClusterIP 不通」很可能同源，换成 Calico 之后还没复现过。
  - CI 的 e2e 再挂在集群指标或拓扑上时，先看诊断里 cs-controller 上一轮的日志有没有 I16 的报错特征（`JSON Parse error`、`ERR_POSTGRES_INVALID_MESSAGE` 等）。

## 页内展开的表单与确认改为弹窗（2026-09-23）

作者反馈「现在有些功能点击配置之后，都是会在本页面扩展一个区域来渲染表单内容的，体验很差，统一都改成弹窗……并且把弹窗做成公共组件」。问答裁定：范围 A＋B＋C（点了才出现的表单；带核对材料或输入的确认面板；放弃／换对象／离开提示，含 `UnsavedChangesGuard`），一行式 `InlineConfirm` 与「释放会话」工作区干净时的确认留在页内，接口「试调」保持原样；关窗静默保留草稿，弹窗操作条最右「清空」，离开页面才丢、离开确认写明哪些草稿；每个弹窗标题栏有 ✕；流程「直接改＋回填，提交并部署本机」。

- **公共件**（`apps/console/src/shared/ui/dialog`）：`Dialog` 底座（页面内模态 `<dialog>`，经 `DialogHost` 画在应用根上；✕／Esc 关、点遮罩不关；焦点进出；进行中锁住；打开时锁滚动；复位区域按钮档位）、`FormDialog`、`ConfirmationDialog`、`DialogClearButton`、`DialogVisibility`（身份守卫或页签藏起的区域里弹窗不画，离开确认 `persistent` 除外）；`ConfirmDialog` 改搭在底座上；`shared/lib/useDraftTarget`（逐项编辑的「编辑对象＋草稿」）。
- **分批提交**：4ff7b3e（底座；发布四处；项目设置的成员与可见性）、4ef76a0（目录「申请定向开放」、集群重启／调整副本／恢复发布配置、通知订阅、试调与 Swagger 的放弃确认）、873adfd（管理区：身份提供方、项目规则、自动下线、复制档位、资源目录两个确认、用户角色）、74e849a（环境变量；`DialogVisibility`）、426036e（开发页：恢复原工作树、另建工作树、新建 Agent、数据访问审批、结束 CLI、编辑器放弃输入）、1a43ee9（浏览器核对中发现：FormField 里的复选框被拉成整行宽）。每批提交前都在「HEAD＋本批」干净导出树上 `check:static` 与 `test:console` 通过（最后一次 793 pass／0 fail）。
- **CI**：4ef76a0、873adfd、74e849a 六项全绿；4ff7b3e 的 e2e 红是按钮统一会话当时的既有问题（767aca6 修）；426036e 的 e2e 红在基础设施一步——439b61e 把 `deploy/local/bootstrap.sh` 的可执行位改丢（9c 在 ea9ef8d 恢复），不是弹窗改动。包含 426036e 全部代码的 f4fb68c，以及 1a43ee9、3556b1e 六项全绿（含 e2e）。
- **回填**：RFC-003 design §6 写通用规则，RFC-020 §6／§7、RFC-021 §9、RFC-009 §4、RFC-014 §3、RFC-010、RFC-008 §5、RFC-017 各加 2026-09-23 修订；`docs/engineering/development-rules.md` §7「表单与确认用弹窗」补 `useDraftTarget`、`DialogVisibility`、按钮档位复位与用例约定；dev-gotchas 补 happy-dom 下经 portal 的弹窗关闭后 React 丢 `focusin`。
- **部署与实机**：09:58Z 只滚 console → `cs-console:dialogs-20260923`（`git archive ea9ef8d`，线上包 `index-BU2qtyVc.js`）。dev-admin 在浏览器里逐个打开再取消，不提交任何改状态的操作：平台设置「修改自动下线时长」（关窗保留、清空、离开确认写明「待验证版本自动下线」）、用户角色（叠放确认、关窗保留、换人确认、清空）、身份提供方、项目规则、复制档位（行内按钮紧凑档）、「RFC-021 验收」项目的发布页四个弹窗（进入维护关窗保留与清空、准备发布、回退、重新部署）、环境变量（键名获得焦点、切换环境页签后草稿仍在）、添加成员、可见性两处、添加订阅、集群调整副本；390 宽（同源 iframe 量）下身份提供方与进入维护：两侧 16px、正文内部滚动、底部按钮一行、无横向溢出；控制台无报错。开发页的弹窗没有实机点（迁移后会话已删、9c 在观察 Runner），由用例覆盖。按钮统一会话在同一个包上量过：「准备发布」弹窗里的按钮是标准 32px。10:12:38Z 按钮统一会话把 console 滚到 `cs-console:buttons-20260923b`（`git archive 1a43ee9`，线上包 `index-CL5p28o6.js`），带上了复选框修复，这是现在线上的包。
- **判断**：编辑器的保存冲突提示是持续状态（保存被挡住、可以继续编辑），留在页内；资源目录与项目资源页的常驻编辑器、各类筛选、无会话时的开会话表单、数据访问申请表单都不是点了才展开的，保持原样。弹窗的 ✕ 是作者本轮选定的，不算「按钮上的符号」。
- **下一个 session 注意**：用例里有弹窗开着时只点得到最上层弹窗（`tests/interactiveScope.ts`）；弹窗关闭后要在页面输入框里继续键入的助手，先 `blur()` 再 `focus()`（见 dev-gotchas）。

## 全站按钮统一：两档高度、卡片按钮位置、危险与取消样式、不带符号、页面自动刷新不给刷新按钮（2026-09-23）

作者：「你做完之后，按钮位置、按钮大小都不一样，你要把系统整体样式统一下」。先在实机逐页量了一遍（23 个页面：动作按钮高度 22／23／25／29／31／34 六种，页面上 14 个刷新按钮，＋／↗／▾／↑↓ 散见），逐项问作者裁定，流程取「直接改＋回填」，不另立 RFC：

- **两档高度**：标准 32px（页头、卡片、表单、空态）与紧凑 26px（`size="small"`：表格／列表／时间线行内动作、复制这类小工具、开发页工具条），同一行不混用；尺寸只在 `Button.module.css`。开发页整片由新增的 `ButtonSizeContext` 给紧凑档（弹窗底座里复位，crewstation-db 的 426036e）。
- **位置**：对象卡片的动作放底部操作条（`Card` 的 `actions`），列表卡片「新增／添加」放标题行右侧，行内动作放行末；侧栏详情按同日 RFC-019 裁定仍在顶部。
- **样式**：主按钮最左；危险触发红字红框（`danger`），最终确认红底白字（`dangerPrimary`）；取消／关闭／收起／放弃无边框（`ghost`）。
- **文案**：不带＋、↗、▾、↑↓（「添加预置文件」「上移／下移」，外部链接不再自动加 ↗）；「＋ 创建开发Agent会话 ▾」拆成「创建开发Agent会话」＋「选择算力档位」（D59 起不再选权限）。
- **刷新**：作者：「页面应该有自动信息刷新能力，并且是局部刷新，不要提供刷新按钮」。`PageRefresh`（读取于 ↻）与各页「刷新／重新读取／重新查询」全部去掉：页面数据每 30 秒原位重读、回到前台补读（`AUTO_REFRESH`）；网络与 5xx 失败每 15 秒自动再读并写明；读不到项目（403／404）时每 30 秒再读；进度类按各自节奏。开发预览「刷新」保留改名「重新加载」；保存冲突后的「重新读取当前角色」「放弃修改，读取最新内容」、Swagger「重新加载文档」、释放会话确认里的「重新检查」是动作，保留。
- **提交**：2fa59ec（两档与危险样式）、777f285（发布与项目区）、c5e44b8（管理空间与环境变量）、767aca6（告警、集群、事件）、058b499（市场、资源说明、项目边界）、3190107（接口目录）、9462388（开发页收尾、守卫用例 `tests/buttonConventions.test.ts`、RFC-003 design §6 与 RFC-020 design §3 修订）、7a456ca（告警筛选间距）。每批都在只含本批的导出树上跑门禁（arch、lint、两套类型、console、unit），CI 六项全绿。
- **顺手修**：删除变量后成功提示显示成 UUID；集群「首次采集中，请稍后刷新」改为「首次采集尚未完成」（带单元用例）；接口目录调用方重读时接口列表每 30 秒卸载重建、申请审批按钮每 30 秒变灰（`useAdminPage` 新增 `poll` 与 `loading`，见 dev-gotchas 新条）；c5e44b8 让 e2e `layoutSpacing` 两条红（按钮移到底部操作条后按兄弟元素量出 0），767aca6 改量按钮与 Dockerfile 框的真实距离。
- **部署与实机**：09:47:30Z 只滚 console 到 `cs-console:buttons-20260923`（`git archive 1380fb8`，包 `index-CDQRsUPy.js`）。CDP 9344 以 dev-developer／dev-admin 只读量 25 个页面：带 `data-button` 的动作按钮 26px 127 个、32px 108 个，别无第三种高度（34／36／62px 分别是版本号标题按钮、页签、设置分区导航，守卫用例里注明的非动作控件）；页面上刷新类文案 0 个（之前 14 个）。发现告警筛选紧贴下方记录，7a456ca 修正。之后 crewstation-db 于 09:58Z 滚到 `cs-console:dialogs-20260923`（`git archive ea9ef8d`，含 7a456ca 与 426036e，包 `index-BU2qtyVc.js`）；在它上面复核：告警筛选与下方间距 12px，「准备发布」弹窗底部按钮标准 32px（弹窗不带开发页的紧凑档），没有会话的开发页「开始开发」32px、「打开参考」26px，但「打开参考」那一行贴着上面的卡片（约 2px，ec33c69 以来就有），d70964b 补上间距。10:12:38Z 再滚 console 到 `cs-console:buttons-20260923b`（`git archive 1a43ee9`，含 crewstation-db 的复选框修复，包 `index-CL5p28o6.js`）：该行间距 8px；25 个页面重量一遍，动作按钮仍只有 26px 127 个、32px 108 个，刷新类与带符号文案 0 个。弹窗标题栏的「✕」是作者在弹窗问答里选的关闭控件（crewstation-db），不算按钮文案里的符号。
- **留给作者**：项目概览页头的仓库与域名是文字链接，保留 ↗（只管按钮）；市场卡片的「试用」入口在卡片脚注里（RFC-011 的卡片形态，没改）；30 秒例行重读会增加一些读请求（I16 的 cs-api 积压另有 RFC-023）。

## Agent 不再分权限档（2026-09-23，Design D59）

作者问「创建开发对话的右侧下拉框，只读、可改文件、完全权限都是什么意思，用起来无法理解」。看过三档实际放行的工具后（可改文件不能跑任何命令；只读挡不住平台 MCP 的发布等动作；通用终端档位下完全不起作用），作者裁定「为什么要限制呢，都是开发容器。只有连生产库才有对生产库的权限控制才对」。追问后业务子任务也一律完全权限；Manifest 旧写法「没有存量，你直接接受并忽略就行了」；流程取「直接改＋回填，部署本机」。D58／v0.3.10 已由 crewstation-51 的 RFC-022 占用，本条取 D59、基线 v0.3.11。

- **行为**：平台派发给 Runner 的权限一律 `full`（`packages/contracts/manifest/tasks.ts` 的 `PLATFORM_AGENT_PERMISSION`）：开发会话 CLI（含旧路径与重启）、历史 Agent（含重启）、业务子任务、档位测试。「＋ 创建开发Agent会话 ▾」只选算力档位，历史 Agent 表单去掉权限；`POST …/agent-terminals` 带 `permission` 回 400（strict），`POST …/agents` 直接丢弃。Manifest `agentProfiles[].permission` 照收不用，金样破坏性 1 处（去掉 `default: "edit"`，依据 D59）；样例模板删掉这一行。名册与记录里的 `permission` 如实记派发值。TaskRunner 协议与 `packages/agent-drivers` 的三档映射不动（运行中的旧 Runner 照常），任务镜像不用重建。
- **回填**：基线 v0.3.11（Design D59；§13.4 新增一条接受的风险：业务子任务的 Agent 能直接读写生产库；Proposal §0.2 变更表；Plan T3.3 注记）；RFC-003 proposal §7、development-workspace §5／§8 同日修订（含作者逐项确认的去掉的能力）；I19 关闭，I17 的权限部分定下；dev-gotchas 的 FreeTierError 条补注。
- **提交／部署／实机**：faf5f99（代码、用例、金样、RFC-003 修订、I17／I19、本节）、6e8f5ff（基线 v0.3.11）、2bd703e（v0.3.11 的记录补上 RFC-022 同日修订 49b9971），三笔 CI 全绿（faf5f99 为 [CI 35840325745](https://github.com/wangbinquan/CrewStation/actions/runs/35840325745)，六项成功）。提交前从「d47185d＋本批」导出的干净树 `check:static` 通过，`bun test` 2368 pass／87 skip／0 fail。cs-api、cs-controller 09:47:51Z 滚到 `cs-control-plane:agent-full-20260923b`（git archive 1380fb8，含 49b9971、e73d98e）；console 由 crewstation-9e 滚到同一提交构建的 `buttons-20260923`；cs-session 未动（Calico 迁移后 demo 的观察期）。实机（dev-admin，rfc003-verify-workbench；迁移后先重建了开发环境）：页头是「创建开发Agent会话」＋「选择算力档位」，展开后只有「算力档位」一个选择；带 `permission` 调 `POST …/agent-terminals` 回 400「Unrecognized key: "permission"」；从主按钮新建的 CLI，名册里 `permission: full`，执行 Pod 里 OpenCode 进程的 `agent.crewstation.permission` 为 `{"*":"allow"}`。同一条「在 shell 里执行 `echo d59-$((6*7))`」的历史 Agent：部署前表单有权限（默认可改文件），派发 `edit`，Agent 答「我没有可用的 Bash/shell 工具，无法执行」；部署后表单只有算力档位，派发 `full`，转录为「调用 bash → d59-42」。验证用的 CLI 与两个历史 Agent 都已结束；中间镜像 `agent-full-20260923` 已从 docker 与节点删除。业务子任务没有实机跑（demo 观察期内不动它的负载），由 `businessTaskModule` 用例覆盖（Manifest 写 read-only，派发 full）。
- **补：cs-session 也要滚（10:22Z）**：作者要求补做业务子任务的实机核对，结果在旧 cs-session 上它仍按 Manifest 的 read-only 派发（rfc011-role-home 的 `/chat`，Runner 的 started 事件 `permission: read-only`，Agent 答「没有可用的 shell/Bash 工具」）。原因是 Runner 就绪后的派发跑在 cs-session 的 `onRunnerReady`（`modules/platform/wiring.ts`）；开发会话的 CLI／历史 Agent 当时显示 full，只是因为新 cs-api 写进记录的就是 full。等 crewstation-9c 的 demo 观察期结束，10:22:14Z 把 cs-session 也换成 `agent-full-20260923b`（demo 的 Runner 10:22:15Z 重连）。复测：`/chat` 让 Agent 执行 `echo d59-$CS_TASK_ID`，返回 `d59-01a0cdc9-bef5-7000-9bbe-7a83ebf4e672`，正是该业务任务的 ID；started 事件 `permission: full`，事件里有 `tool-start`。dev-gotchas「改了哪个模块，就要重启读它的那些进程」补了这一例。
- **另发现（与本批无关）**：demo、rfc003-ux、rfc003-verify-workbench／delivery／files 最新登记的 chat-v1 固定引用算力档位 `01a0c12a-de12-7004-a388-365f8b327fa4`，该档位已被删除；这些项目的 `/chat` 会在启动 Agent 前失败（rfc003-verify-workbench 实测：「算力档位 … 不存在」）。要恢复，需各项目把 chat-v1 改成 `compute: { kind: default }` 或现有档位后重新发版。
- **注意**：部署后已打开的工作台页要刷新一次，旧页面新开 CLI 时带着 `permission`，会被新 cs-api 以 400 拒绝。

## RFC-021 修订：提醒之后才能推迟、待验证版本可以选版本部署（2026-09-23）

作者实机反馈两条：「项目界面，推迟72小时按钮一直显示也一直可以点，不合理，应该是在下线前24小时才显示，并且文案应该是推迟72小时下线」（本机 demo 07:53 被连点 5 次，到期推到 15 天后）；「待验证版本，应该要可以选择版本部署吧，为什么现在只能部署上个下线版本」。两轮问答裁定，流程取「直接改＋回填 RFC-021，提交、推送并部署本机」（RFC-021 plan T14）：

- **推迟**：「下线前 24 小时」跟平台设置的「提前提醒」走——为当前到期时间发过提醒之后才能推迟；服务端一起限制（`SlotRetentionDto` 加必填 `postponable`，提醒之前推迟接口 412 并说明原因）；按钮「推迟 72 小时下线」／「推迟 14 天下线」。推迟后提醒清掉、到期后移，要等下一次提醒才能再推迟；M23「不限次数」仍成立。
- **选版本部署**：服务端本来就能重新部署任何可重新部署的版本，缺的是待验证卡的入口。待命槽空着（已下线或尚未部署）且有可重新部署的版本时，卡片主按钮「部署版本…」，打开重新部署确认弹窗，第一行是版本下拉（新到旧，默认刚下线的那个）；时间线与发布详情的「重新部署」打开同一个弹窗并预选；槽上有版本时卡片不给换版本。
- **提交**：cd80eac（推迟：领域 `canPostpone`、契约、模块与工作台用例、只读 e2e、RFC 回填）、8e51443（选版本：`model/redeployCandidates`、`StandbyActions`、`RedeployDialog`、用例、RFC 回填）。两笔提交前都在「HEAD＋本批」干净导出树上 `bun run check` 通过；i18n 与 README 里混着别人的改动，用私有索引只提交自己的 hunk。CI：cd80eac 的 35836810951 五项成功、e2e 只红 `layoutSpacing` 两条（c5e44b8 带入，crewstation-9e 在 767aca6 修好）；8e51443 的 35838303881 六项全部成功（含 gate 新增代码防护与 e2e）。
- **协作**：crewstation-db 同时把发布页的确认面板改成弹窗（4ff7b3e，`RedeployConfirm` → `RedeployDialog`）；按约定等它提交后我再在弹窗第一行加版本下拉（标题改为「部署到待验证版本」，删掉不再使用的 `release.redeploy.action`）。它的 `DeploymentVersions` 里重新部署失败时原因在弹窗和卡下各显示一份、弹窗关掉后卡下那条还留着，已告诉它，没改。
- **本机部署**：08:40Z cs-api → `cs-control-plane:postpone-20260923`，console → `cs-console:postpone-20260923`（`git archive 8e51443`，含 daf29d7、4ff7b3e、767aca6、59bed06）；其余控制面服务仍是 `startup-20260923f`。cs-api 起来后没有重启。
- **实机**（证据见 RFC-021 acceptance.md「2026-09-23 修订（T14）的实机核对」）：`rfc021-verify`（dev-developer）提醒前没有「推迟」、接口 412；只改待命槽计时的 `since`，真实巡检 08:41:58Z 发出提醒后出现「推迟 72 小时下线」，点一次到期后移到 09-27 07:41Z、按钮消失、再调 412。`demo`（dev-admin）：「部署版本…」、下拉默认 v0.1.2、改选 v0.1.3，请求用 CDP Fetch 在浏览器里拦下（demo 状态没变），1440／390 无溢出。e2e `slotLifecycle` 4／4。
- **下一个 session 注意**：`rfc021-verify` 的 v0.1.1 现在 09-27 07:41Z 到期（推迟过一次），09-26 07:41Z 前后再提醒。还没刷新的旧工作台页面上「推迟」仍一直显示，点了会得到 412 的说明，刷新即可。作者的 demo 待命槽仍是已下线的 v0.1.2，可以亲手试「部署版本…」。

## RFC-022 启动进度（公共能力）：实施、部署与实机验收（2026-09-23）

作者反馈「现在在启动新agent会话的时候，状态显示的无法理解，只有未连接、已连接这种」，要求显示容器未启动、启动中、Agent 启动中这类细粒度状态，并要求「这套状态机制，要做成公共能力，1、2都用，以后还会用在其他地方」。三轮裁定 D1–D8、Q1、Q2（Q3、Q4 没有回答，按不做处理），随后批准「实施、提交推送、部署本机、实机验收」。**RFC-022 已 Done**。基线回填到 v0.3.10：Proposal R58，Design §5.10、D58，Plan AT-59 与 R58 矩阵行；RFC-003／006／008 各加一段修订说明。

- **能力**：
  - 启动进度由后端统一产出并存库（`task_runtime.environments.startup`，迁移 `task_runtime/0009_environment_startup.sql`）。
  - 分段：CLI 六段（排队、容器、等待连接、准备环境 x/y、Agent 启动中、就绪）。开发会话五段，重建时以「替换旧容器」代替「检出代码」。档位测试迁到同一契约。
  - 调度不上、拉取镜像、检出分支等细节读自 Pod 与 Events；Kubernetes 自己还在重试的只记警告。
  - 工作台、CLI 与档位测试共用 `apps/console/src/shared/ui/progress` 的步骤条。CLI 的步骤条盖在终端区中间，开发会话的替换整个 CLI 区。
  - 失败停在出错的那一段，写明原因，给出重试和执行容器日志：开发会话按失败位置重试（Q1），CLI 原位替换（Q2）。
  - 点「＋ 创建开发Agent会话」的那个窗口自动取得该 CLI 的输入控制。新 Runner 在启动中就接受取得，协议号不变。
  - `crewstation session show` 也打印启动过程。
- **提交**：
  - 实现：cca9a37 后端底座、e56ae13 dev-session、0fd8d89 工作台。
  - 验收中发现 13 处缺陷，逐条见 acceptance.md §3：4a6788d、5cfc795、3b95126（e2e 登录失败不关页）、1d45592、ccb69d4、e73d98e、daf29d7、59bed06。
  - 精确 SHA CI 逐笔见 acceptance.md SP-14：红过的 e73d98e、daf29d7 都只红在 e2e，原因与本 RFC 无关。
- **本机部署**（逐步见 acceptance.md §1）：
  - 迁移 05:35Z 应用。
  - 现在运行的：cs-api 与 console 是 crewstation-50 从 8e51443 构建的 `postpone-20260923`，已含本 RFC 全部提交；其余六个控制面部署是 `startup-20260923f`（ccb69d4）。
  - 任务底座推为 `crewstation/task-runtime:startup-20260923`；默认档位 `volc-glm-5-2` 另存为修订 5。
  - 59bed06（Runner 在 CLI 起不来时写 warn）要等任务底座下次更新才生效，本次没有重存默认档位。
  - 本 RFC 构建、已不再使用的镜像已从节点与宿主删除。
- **实机验收**：
  - SP-01…SP-14 全部通过，SP-11 由用例覆盖；SP-02、SP-05、SP-08 的做法有偏差，见 acceptance.md §4。
  - 验收项目 `rfc022-verify` 保留，开发会话已释放；验收专用档位与临时镜像已删除。
  - SP-08 两个检出失败的会话留下了 Pod（Init:Error）和工作卷：首版「重试」漏了 Q1 的「释放」。作者 2026-09-23 裁定补上，重新开始时回收失败在检出或更早的会话（设计 §14.2，49b9971）；这两个是修订前留下的。
  - 修订 10:05Z 实机核对通过（acceptance §6）。核对中发现第 14 处缺陷：启动观测把「记录已提交、Pod 还没建」判成容器不存在，437bffe 修复；10:26Z cs-controller 滚到 `podgrace-20260923` 后复核 6／6 通过。
- **事故**：验收期间 cs-api 四次出现 I16（05:35、07:37、07:44、08:00Z）。
  - 第一次由共用 Chrome 上的 110 个孤儿页面放大，作者批准后关掉；3b95126 修了孤儿页面的来源。
  - 后三次没有孤儿页面，是并发请求集中到达所致，e73d98e 的节流只是减负。
  - I16 已补记第五至七次；**作者 2026-09-23 裁定 (b) 换 postgres.js 驱动**，按非平凡重构先写 RFC，批准后实施。
- **遗留**：
  - Claude Code 在本机仍停在登录，SP 只用 OpenCode 跑了真实轮次。
  - 本机仓库与节点在同一台机器上，没观察到「正在拉取镜像」这个中间态，由用例覆盖。
  - cs-demo 的两个旧 CLI 执行 Pod 和 rfc003 工作台会话的 Runner，每隔几分钟就 90 秒空闲超时，之后要重连失败约 5 分钟（07:40–08:05 连续看到）。这是别人的 CLI，只记录、没动，原因未查。
- **下一个 session 注意**：
  - 页面上的「启动中 x/y」来自名册每秒一次的读取，服务端只在有对象启动时才观测。
  - 调试启动慢时，先看名册里 `startup.stages` 各段的起止时间，再对照 `kubectl get events`。

## 不可撤销动作改为弹窗并输入确认词（2026-09-23）

作者提出「归档项目是个很高危险性操作，建议弹窗并且让使用者输入归档单词才能归档，防止点错」。两轮问答后裁定，流程取「直接改＋回填，提交并部署本机」：

- **范围**：归档项目；集群管理「删除／结束」；删除算力档位、登录接入方、配置项；释放会话只在工作区不干净时弹窗（有未提交文件或未推送提交，提问里写明编辑器里没保存的输入、工作区检查失败或结果不可用也算，作者没有反对；数据访问里没提交的输入按同一原则也算），工作区干净时保留页内确认。配置项其实在项目设置 → 环境变量，提问时我把它归进了「管理空间里的删除」，作者照这个选项选的。
- **确认词**：不分界面语言，一律用英文：归档 `archive`，删除 `delete`，释放会话 `discard`（作者没选 release，避开产品里「发布」的意思）；不分大小写，忽略首尾空格。
- **组件**（`fff4325`）：`shared/ui/dialog/ConfirmDialog` 是页面里的 `<dialog>`，用 `showModal()` 打开。确认键 `dangerPrimary` 排最左，取消用 `ghost`（按钮统一会话 `2fa59ec` 的规则）；Esc 关闭，点遮罩不关；打开时焦点进输入框，关闭后回到打开它的控件；进行中锁住。另加令牌 `--cs-color-backdrop`，开发规则 §7 改为「一般确认用行内，不可撤销动作用 ConfirmDialog，原生 alert／confirm／prompt 仍禁用」。测试驱动放在 `apps/console/src/tests/confirmDialogDriver.ts`。
- **接入**（`edcd09a`）：
  - 归档：弹窗列出后果；请求进行中锁住，结束后关闭，结果仍显示在卡片上。顺手修了身份未就绪时触发键显示「归档中…」。
  - 接入方：问句带名称和 slug。
  - 档位：先弹窗删除；被项目引用时返回 409，「仍然删除」再弹一次，弹窗里的引用清单在请求发出后保留。
  - 配置项：确认后弹窗即关，进行中的反馈在该行的删除键上。
  - 集群删除：点下去就弹窗，自动检查影响；检查结果只认当前动作最近一次的那份，取消或换动作后路上的旧结果不会挂上去。
  - 释放会话：页内确认之后，工作区不干净才叠弹窗。
  - ProvidersCard 的「重新加载」按 `777f285` 去掉，由读取失败自动重试接替。
  - 回填：RFC-003 design §6、RFC-009 design §4.3、RFC-010 design、RFC-005 proposal §6.2 各加同日修订说明。
- **验证**：两笔都先在导出的干净树（HEAD＋本批）上跑门禁。`fff4325`：`check:static` 通过，console 737、unit 420 全过，[CI 35831641341](https://github.com/wangbinquan/CrewStation/actions/runs/35831641341) 成功。`edcd09a`：`check:static` 通过，console 753、unit 421 全过，[CI 35833768096](https://github.com/wangbinquan/CrewStation/actions/runs/35833768096) 六项全部成功（含 e2e 与 gate 的新增代码防护）。
- **本机部署**：只滚 console，用 `git archive edcd09a` 构建 `cs-console:confirm-20260923`，线上包 `index-DEYH2jRH.js`，控制面没动。之后 crewstation-51 单独滚了 cs-api（`startup-20260923g`）。
- **实机核对**：私有无头 Chrome（9355 端口，核对完已关），dev-admin 身份，逐项都通过：
  - 归档：`:modal`、焦点、中文「归档」不算、「 ARCHIVE 」算、Esc 关闭并且焦点回到触发键；390 宽左右各留 16px，暗色主题正常。
  - 集群删除：自动预检，UID 与关联资源显示在弹窗里。
  - 档位：弹窗里按 Esc 不会收起操作面板。
  - 接入方：问句带名称与 slug，失败原因显示在编辑页。
  - 释放会话：demo 工作区干净，页内确认后直接发请求；在浏览器里把检查回执换成「有未提交文件」后，走弹窗，输入 discard 才发请求。
  - 会写数据的请求（归档、集群受理、删档位、删接入方、释放）都在浏览器里拦下、回 503，没有到服务端。事后直查库，档位 rfc010-cluster-qa、接入方 dev-roles、项目 rfc021-verify 都还在；demo 的 CLI Pod 仍在运行。
  - 唯一的真实写入：在 rfc021-verify 开发组里建了 `CS_CONFIRM_DIALOG_PROBE`，再用弹窗删掉，版本历史因此多了两条。
- **发现的缺陷**：配置项删除后，成功提示把变量名显示成 UUID（「已删除 开发 的 01a0cd43-…」）。原因是 ConfigEnvPanel 在重新读取后的列表里按 id 找名字，这是原来就有的问题；configForms 的测试桩在删除后仍返回该项，所以用例没拦住。这个文件按钮统一会话当时正在改，我把原因和修法发给了它，它在 `c5e44b8` 里修好了：remove 的入参带上 name，提示改用它；configForms 的桩在 DELETE 之后不再返回被删的项，那条断言在修复前是红的。
- **实机期间 cs-api 出现 I16**：cs-api 滚到 `startup-20260923g` 之后，08:00Z 报 `ERR_POSTGRES_INVALID_MESSAGE`，接着出现 native activity query unavailable（demo 的会话任务），存活探针失败后进程重启一次，约 08:01:30Z 恢复。证据交给了正在治这个问题的 crewstation-51，我没有对 cs-api 做任何操作。它的结论：这是 I16 在新进程上复发，我的核对页面不是主因。cs-api g 在 07:59:46 开始监听，第一批连接错位错误出在第一条 native activity 告警之前，原因是刚启动时积压的请求一起到达，和 05:35 那次一样。`e73d98e` 的节流只能减负；根治要换驱动或升级 Bun（I16 的 a／b 选项），需要作者裁定，crewstation-51 会提请。cs-api 08:01 被探针重启一次后，一直稳定在 1/1。
- **并行分工**：
  - 按钮统一会话（「下线待验证和正式版本」）负责：去掉刷新按钮、去掉按钮里的符号、统一按钮尺寸与摆放。作者当面给了它「页面自动局部刷新、不要刷新按钮」和「按钮文案里不放加号、箭头」两条裁定，这两条最初也发到了本会话。
  - crewstation-db 负责全站弹窗底座 `shared/ui/dialog/Dialog`：ConfirmDialog 已在工作树里搭到底座上（未提交，对外 props 不变，`confirmDialog.test.tsx` 是行为约定）。它还会把集群的重启／调整副本、档位复制、接入方与配置项表单改成弹窗，并按作者给它的新裁定给所有弹窗右上角加 ✕。
- **下一个 session 注意**：作者还没有亲手看过这些弹窗。crewstation-db 提交底座后，ConfirmDialog 的外观会随底座变化（加 ✕），需要再核对一次。

## RFC-021 待验证版本下线与正式版本维护：实施、部署与实机验收（2026-09-23）

作者问「现在是不是没能力下线待验证版本，下线正式版本？待验证版本长期开着pod也浪费资源、正式版本也需要临时进入维护装备不被非开发者调用」，七轮问答裁定 M1–M28，要求「实施＋部署＋实机验收」。**RFC-021 已 Done**，基线回填到 v0.3.9（Proposal R56、R57、改写 R19；Design §6.9、D56、D57，「暂停项目」作废；Plan AT-57、AT-58 与矩阵行）。

- **能力**：负责人与管理员下线待命槽（删 Deployment，留 Service 与发布记录，preview 显示「未部署」说明页）。回退目标 72 小时、待验证版本闲置 14 天自动下线，提前 24 小时提醒、可无限推迟；三个时长在管理空间「平台设置」（`/admin/settings`）统一调。从发布记录重新部署不重建、不重迁移。正式版本「进入维护」有用户流量、服务域调用、事件推送三个开关；成员、管理员与临时指定的人放行，项目自己的负载不拦，维护跟随切流。项目完整维护（三开关全拦）即破坏性迁移窗口，部署与切流都查。`CS_MAINTENANCE_WINDOW` 与项目状态 `paused` 已删除。
- **提交**：1c3586c 后端、1eeb576 工作台、3c4076e 修用例类型；验收中修 56ff345（改开放策略后立即重算放行表）、2e2600b（下线认 RFC-013 之前的旧 `rel_…` 标签）、635359d（用例库带事件表）、692207c（Pod 身份索引重列后清旧行）、80c4e1b（Traefik `allowEmptyServices`）；收尾时顺手修 b22b6d8（`runtimes/task` 预览日志用例在 `FORCE_COLOR` 下变红，与本 RFC 无关）。精确 SHA CI 逐笔见 acceptance.md：1eeb576、56ff345、2e2600b 红过，均由下一笔修复；最后一笔 80c4e1b 的 [CI 35825463850](https://github.com/wangbinquan/CrewStation/actions/runs/35825463850) 六项成功。
- **本机部署**：迁移 `events/0005`、`release/0007`、`gateway/0005` 05:12Z 应用。验收用的是 crewstation-51 从 692207c 构建的 `cs-control-plane:startup-20260923b` 与 `cs-console:ui-6a75f9a`；之后 crewstation-51 从 3b95126 重建滚动为 `cs-control-plane:startup-20260923c`（七个控制面部署）与 `cs-console:startup-20260923b`，06:36Z 只读复核（e2e `slotLifecycle` 4／4、验收项目的槽与维护、平台设置）没有变化。Traefik 线上已加 `allowEmptyServices`，与清单一致。本批构建的 `rfc021-20260923*` 三个镜像已从节点与宿主删除（只剩 0 副本的旧 ReplicaSet 引用它们，回滚到那几版会拉不到镜像）。
- **实机验收**：SM-01…SM-18 全部通过，身份为 dev-developer（负责人，兼 demo 的开发者）、dev-tester、dev-member、dev-admin；逐项证据在 `proposal/rfc/RFC-021-slot-offline-maintenance/acceptance.md`。会改状态的操作只在 `rfc021-verify` 上做，要推到期时间时只改它的一行 JSON，由真实巡检执行。
- **别的项目会被自动下线**：升级时已有的待命槽从 05:14:23Z 起算，分两类：
  - 回退目标：demo、gitlab-event-producer、reference-api-proxy、rfc003-verify-delivery、rfc003-verify-integration。**09-25 05:14Z 提醒，09-26 05:14Z 自动下线。**
  - 待验证版本：rfc003-verify-workbench、rfc006-verify、rfc011-role-home，10-07 到期，有人访问 preview 会后推。
  - 另外两个：`rfc021-verify` 的回退目标 09-26 06:14Z 到期；crewstation-51 的 RFC-022 验收项目的待验证版本 10-07 到期。

  要保留的，在发布页点「推迟」。
- **事故**：05:35–05:51Z cs-api 连环重启（Bun SQL 连接错位，I16 第四次）。诱因是无头浏览器里没关的页面：本会话的 9344 上有 26 个，共用的 9333 上有 109 个。页面已全部关掉，本会话的驱动改成结束即关页；crewstation-51 在 3b95126 修好了 e2e 登录失败时不关页的问题，并在 dev-gotchas 与 I16 记下这次重启循环。
- **遗留**：
  - `rfc021-verify` 保留作证据：正式版本 v0.2.1 声明了破坏性迁移；待命槽是回退目标 v0.1.1；`/api/hello` 默认开放；可见范围为所有登录用户。
  - 提醒目前只写记录与日志（Q20 没有通知渠道）。
  - 时间线把非成员管理员显示成「成员 01a0c12a…」，这是 RFC-020 既有的写法。
- **下一个 session 注意**：09-25 与 09-26 是自动下线第一次按真实时间触发，看一眼 cs-controller 日志里的 `slot offline notice` 与各槽的记录是否按期出现。不要为了测试调短平台设置的时长，那会作用于所有项目；要测就像本批一样只改验收项目自己那一行。

## 开发页「可使用资源」页签重做（2026-09-23）

作者反馈「可使用资源页签里的信息无法理解，表格超出页面还有横向滚动条，无效信息太多，比如那个 uuid 有什么用」，要求全面设计：分类合理、直观、信息密度高。两轮问答（含 ASCII 预览）裁定，流程取「直接改＋回填，提交并部署本机」：

- **四类**（按代码怎么用它）：调用接口（代理、其他数字人、平台业务子任务接口）／接收事件（已订阅、可订阅类型、推送请求头）／运行环境（环境变量、用户请求头、服务与链路头、约定路径、应用配置键）／Agent 工具（两个平台 MCP 与开发会话令牌头）。地址 `topic` 只增 `agent`，`guide` 仍是运行环境；旧链接 `guide=mcp`／`tasks` 落到 Agent 工具／调用接口。
- **接口**：平铺两行列表（首行方法＋路径，次行提供方·说明，右侧试调／申请），默认列全部，可调用的置顶、需申请的在分割线下；搜索＋提供方＋状态筛选；点路径展开可复制的调用地址 `${CS_INTERNAL_API_BASE}<代理><路径>`；侧栏里试调与申请在该行下原地展开（会话绑定压成一行，会话 ID 只进悬停提示）；放大形态同一套列表＋右侧详情栏。界面上不再出现操作 ID（申请记录与试调结果写「方法 路径」）。
- **事件**：与接口同一种两行样式；可订阅的按生产方分组、按族归并（`gitlab.issue` ▸ open close …），点子类型复制可粘进 `crewstation.yaml` 的订阅片段（按 ID 绑定、注释写类型——UUID 只出现在这里）。
- **运行环境／Agent 工具**：每项「名字＋中文用途」，点名字复制；原「平台接入」折叠块与 `devSessionToken` 这类内部键名去掉。

**实现**：通用部件 `shared/ui/resource/ResourceList`（`ResourceGroup`／`ResourceRow`／`MethodTag`／`BreakableText`，只在 `/ . -` 后折行）；`features/catalog/components/list/`（`OperationList`／`OperationRow`／`OperationToolbar`／纯函数 `operationSections`），`invocation/InlineBinding`，`OperationsPanel` 删除（`OperationsTable` 只留管理空间）；`features/events/components/eventFamilies`；`features/capabilities/components/reference/`（`RuntimeReference`／`AgentTools`／`EventHeaders`／`KeyMeaningList`／`ReferenceTopics`）与 `model/useCapabilityDescription`；放大形态列表／详情按面板宽度（容器查询）排布。回填 RFC-020 design §7「修订二」、plan §4。
**用例**：`referencePanel` 四条新增、`resourceListModel` 新增、`apiInvocationForm` 新增侧栏行内试调一条；`projectResources`、`catalogConsumption`、`catalogDetail`、`adminCapabilities`、`projectNavigation` 改写；e2e 新增 `referenceResources`（1440／1024／390，四类、面板内除页签条外无横向滚动、接口与事件无 UUID），`capabilityDepth`、`projectSettingsUx` 改为四类，`projectWorkspaceIa` WS-07 文档式面板在没有卡片时量长满的主题正文。
**提交与门禁**：`1b16607`，[CI 35832242390](https://github.com/wangbinquan/CrewStation/actions/runs/35832242390) 六项全部成功（含 `gate` 新增代码防护与 `e2e`）。工作树里混着并行会话未提交的 `app/i18n` hunk（`ui.refresh` 等），第一次「HEAD＋本批」导出时被一起带进去，概览用例因「刷新」键缺失红了 12 条——改为从 HEAD 取这两个文件、只放自己的 hunk，临时索引提交；干净树 `bun run check` 仅 3 条红，均为 `templates/`、`integrations/` 独立项目在导出树里没有 `node_modules`（与本批无关）。
**部署与实机**：`cs-console:resources-20260923`（`git archive 1b16607`）导入节点并只滚 console（首个带上 `2fa59ec`、`fff4325` 的包）。部署前用 CDP 换 `/assets/*` 在 dev-developer 下核对 1440／1024／390：无横向溢出、无控制台错误。部署后 e2e（dev-admin）`referenceResources`＋`capabilityDepth`＋`projectSettingsUx` 14 pass，`projectWorkspaceIa`＋`apiInvocation` 仅 WS-07「预览、代码与变更」的操作条贴顶检查红——原因是本批改变了打包后的样式顺序，CLI 区 `.workspace [role="tabpanel"] { padding-top: 4px }` 压过了工具面板的同特异性规则；按钮统一会话把该规则收窄到 `.main` 并补样式用例，随其下一批提交。期间 cs-api 因 crewstation-51 滚控制面发生 I16 连接错位重启两次，e2e 等它稳定后重跑。
**下一个 session 注意**：作者尚未亲手看新页签。crewstation-db 正按作者裁定把「申请开放」改成弹窗（行内展开的 `requesting` 分支在 `list/OperationRow.tsx`），试调保持行内展开。

## 开发页 CLI 区改为 Xshell 式标签组（2026-09-23）

作者反馈「开发界面的开发 cli 区的可操作性太差了，包括 cli 窗的排列，分 tab 页，那些按钮简直反直觉，能不能直接做成 xshell 那种窗口，然后拖动排列就行了，实际上就只有新开、排列两个功能」。两轮问答（含 ASCII 预览）裁定，流程取「直接改＋回填，提交并部署本机」：

- **模型**：每个 CLI 是一个标签，一组一次显示一个；拖标签到别组标签栏＝移过去，拖到画面左／右／上／下边＝分出新组，组空了就消失；拖分隔线调大小，双击均分。× ＝结束进程并关闭（在运行的先行内确认，别人开的写明是谁开的；已结束的直接关掉）；没有「收起」与「已启动」名册，任何人新开的在运行 CLI 都自动作为后台标签进自己的焦点组。
- **新开入口**只在页头「＋ 创建开发Agent会话 ▾」（沿用作者 2026-09-20 定的按钮名，问答里的「新开 CLI」只是描述），新 CLI 落在焦点组并成为当前标签；没有 CLI 时 CLI 区中间也有。
- **隐式操作**：双击标签放大／还原所在组；右键（Shift+F10）重命名（F2，只改自己看到的名字）、放大／还原、四向分屏、结束进程。每窗标题栏去掉，状态、档位、资源与「谁在输入」合成一条细信息条。区域放不下分屏树（每组至少 260×160）时只显示焦点组、标签栏列出全部 CLI。
- **去掉的能力**（作者逐项确认）：工作区页签、「布局 ▾」、「⋯」工作区设置与已启动名册、每窗「···」、↗ 放大按钮；RFC-003 §5「收起只断开显示」改为 × 即结束进程。

**实现**：契约 `WorkspaceLayout` 只增不删（可选 `dock` 分屏树、`terminalNames`，`WorkspaceTab.activeTerminalId`；服务端只校验树自身，旧工作台改页签不被拒）；`tabs[]` 每项就是一组，旧布局读入即迁移（并排的窗各成一组按原排布摆开，被收起而仍在运行的 CLI 回到标签）并保存一次。通用部件 `shared/ui/dock/`（分屏树、按树算成 `calc()` 绝对定位的 `DockLayout`——重新排列不改 DOM 父子关系，终端不因排列重挂——、可拖的 `DockTabs`、纯函数落点判定、拖动控制）与 `shared/ui/menu/ContextMenu`；`model/layout/terminalGroups.ts` 管迁移、对账与各项操作，布局存储在读入与每次改动后规整。`NativeToolbar`／`NativeWorkspaceTabs` 删除，改为 `CliDock`／`TerminalGroup`／`NewCliButton`，页头经 `NativeWorkspace` 的 `header` 渲染参数放入。建者名字查不到（如不是成员的平台管理员）时写「其他人」，不挂用户 ID 末六位（实机发现）。
**用例**：新增 `dockTree`（树、落位、落点）、`terminalGroups`（迁移、规整、对账、拖放、关闭、放大、改名，每个结果过契约）、`cliDock`（标签、×与确认、别人的 CLI、菜单分屏、双击放大、F2、页头新开、指针拖放与 Esc、窄区合并）、`contextMenu`、契约 `devSession.test.ts`、模块 `workspaceLayout` 新增一条（真实 PostgreSQL）；改写 `nativeWorkspace`、`newCliButton`（原 `devSessionToolbar`）、`developmentLocation`、`nativeExecutionView`（旧布局迁移成两组并排、放大只断开另一组的显示连接）、`agentActivityTarget`、`workspaceLayout`、`editorWorkspace`、`devSessionPanel`、`computeOnly`；新增 e2e `cliTabs`（只读）。工作台层 686 pass／0 fail；`check:static` 通过。
**回填**：RFC-003 development-workspace §2.1（主修订）、§2.2（契约）、§5（×）、§9（状态），RFC-003 proposal／design、RFC-008 design、RFC-020 proposal §4.3 与 design §5.1 各加同日修订说明。
**并行会话**：crewstation-14 同时在改「开发页撑满窗口高度」，与本批共用 `NativeWorkspace.module.css`（`.workspace`／`.stage`／窄屏块）与 `DevSessionWorkbench.tsx`（两处 `<Stack fill>`）。本批用临时索引只提交自己的 hunk，这两个文件里对方的改动留在工作树等对方提交。
**提交前的实机核对**（不动共享部署）：从「HEAD＋本批」导出的干净树构建工作台包，dev-developer 身份的无头 Chrome 里用 CDP 只换 `/assets/index-*`，并把布局 PUT 就地应答（线上 cs-api 仍是旧的 strict 契约）。1440／1280／1024：两个在运行的 CLI 自动成为标签，右键菜单向右分屏、拖到另一组下边（落点区与跟手名字）、双击放大与还原、拖分隔线与双击均分、F2 改名、Shift+F10 键盘菜单（分屏后焦点跟到移动的标签）全部按预期，无横向溢出、无控制台错误；390 宽两组放不下时合并为一条标签栏。只动标签、不点进终端（点进会自动取得输入控制），不结束任何在运行的 CLI。
**已推送并部署**：`7c0deb9`，[CI 35812358725](https://github.com/wangbinquan/CrewStation/actions/runs/35812358725) 六项全部成功（含 `gate` 新增代码防护与 `e2e`）。本机从提交内容（`git archive`）构建 `cs-control-plane:dock-20260923` 与 `cs-console:dock-20260923` 并导入节点；因为布局契约是 strict，先只滚 `cs-api`（其余控制面服务、`crewstation-dev-auth` 与 `cs-session` 未动），核对它收下带 `dock` 的布局（200）、拒绝一组出现两次的树（400），再滚 console（线上包 `index-DmlpCj-g.js`）。实机（dev-developer，不换资源、不拦请求）：旧布局读入即迁移并保存（revision 递增、带分屏树），两个在运行的 CLI 成为标签，右键向右分屏后刷新仍是两组，无错误；e2e `cliTabs`＋`projectWorkspaceIa` 以 `CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin CS_TEST_REQUIRE=e2e` 跑 13 pass／0 fail（作者的个人布局因此被迁移成标签组，这与作者下次进页自己迁移结果相同）。
**收尾**：`d8cdeec` 删除改动后已无使用方的 `shared/ui/split`（`SplitGrid`），`adjustSplit` 并入 `shared/ui/dock/dockTree`，原方向键调分隔线的用例改由 `cliDock` 覆盖（3%、双击均分、大小入布局）；运行时行为不变，本机未重新部署。`28f96d0` 的 [CI 35812864055](https://github.com/wangbinquan/CrewStation/actions/runs/35812864055) 与 `d8cdeec` 的 [CI 35813179706](https://github.com/wangbinquan/CrewStation/actions/runs/35813179706) 均六项成功。
**下一个 session 注意**：作者尚未亲手看新 CLI 区。圆点、信息条折行、窄区合并、「其他人」等细节以作者实机反馈为准；在 390 宽的手机上两组放不下时会合并成一条标签栏（布局里的分屏保留）。

## 开发页撑到窗口底边、文档式面板把最后一张卡拉到底（2026-09-23）

作者看完上一轮留下的两处留白后裁定「改」，并批准部署。直接修改、不另立 RFC：RFC-020 design §5.1／§5.3 加同日修订说明，plan §4 有记录。提交 `fa542b8`，[CI 35811586600](https://github.com/wangbinquan/CrewStation/actions/runs/35811586600) 六项全部成功。

- **撑到窗口底边**：开发页的 `main`（`.compact`）、`.content`、`NativeWorkspace` 的 `.workspace` 一路是纵向弹性列，`.stage` 由 `calc(100dvh - 210px)` 改为 `flex: 1 1 0`（下限 360px）。1280×720／1440×900／1920×1080 状态条贴着内容区底边、整页不滚动，主区分别高出 47／47／67px；有连接横幅时主区变矮，仍是一屏。手机宽度（≤600px）第一版实量主区被外壳挤到 360px、打开文件时编辑器只剩 0px，改为下限 `max(360px, 70dvh)`（即原定高），页面照旧滚动；601–800px 按桌面规则撑满、不再整页滚动。没有会话的项目页同样长满。
- **最后一张卡拉到底**：文档式面板（变更、数据、参考、会话）是 `.flow`，至少一屏高、最后一项长满；`Stack`、`Tabs` 加可选 `fill`，紧凑目录（`CatalogPage`／`CatalogContent`）加 `fill`，数据、会话、参考三处点名。`Tabs` 的 `fill` 用 `.tabs.fill > .panel` 写死 `flex: 1 0 auto; overflow: visible`，压住工具面板那条也会命中嵌套页签的 `.panel [role="tabpanel"]`，否则参考面板里会再套一层滚动。变更卡整页时代的 `margin-bottom` 删掉。
- **用例**：新增 `workspaceHeight`（样式链、四个文档式面板的结构、`fill` 只在点名时生效），改前四条全红；e2e `projectWorkspaceIa` 新增两条 WS-07（三个宽度下状态条贴底且整页不滚动；四个文档式面板最后一张卡离面板正文底边不超过 12px），对改前的线上包实跑为红（留白 47px、变更差 142px）。console 层 685 pass／1 fail——红的是已知偶发的 `pollingVisibility`（只渲染两个轮询 hook，单跑 3/3 绿，与本批无关）；「HEAD＋本批」的干净树 `tsc` 通过（工作树里并行会话未追踪的 `terminalGroups.test.ts` 有类型错，不是本批）。
- **部署与实机**：`cs-console:fill-height-20260923`（`git archive fa542b8`，与部署前换包核对的镜像 ID 相同 `c9735fa4…`）导入 `desktop-control-plane` 并滚动 console，同时带上了 `0a92896`、`ae7ee76`（crewstation-51 已在其上复核，见 `1198f57`）。部署前用 CDP 只换 `/assets/*` 在真实后端上核对四个宽度与没有会话的项目页：预览 iframe 1440 下 615px、1920 下 816px，编辑器在内部滚动，无控制台错误。部署后 e2e：`projectWorkspaceIa` 11/11（dev-developer）；`projectSettingsUx`／`capabilityDepth`／`apiInvocation`／`layoutSpacing`／`platformCapabilities` 用 dev-developer 跑出的 22 条红全是管理员／负责人专属断言，这些改用 dev-admin 重跑 30 pass／1 skip／0 fail，dev-admin 的个人布局前后一致（revision 162）。中间镜像已删，节点上只多了 `fill-height-20260923`。
- **并行协调**：与 crewstation-c3（CLI 区改 Xshell 式标签组，未提交）共用 `NativeWorkspace.module.css`、`DevSessionWorkbench.tsx`，事先发消息约定各提各的 hunk；这两个文件用临时索引写入「HEAD＋本批」，c3 的在制品仍在工作树里；结构用例放进新文件，没碰他们在改的 `devSessionPanel.test.tsx`。

## 开发页右侧面板：预览与代码占满面板高度（2026-09-23）

作者反馈「开发界面右侧栏，各个页签的内容没有把页面高度用满」。缺陷修复：RFC-003 development-workspace §2 要求独立预览占满工作内容区，RFC-020 design §5.3 写的是预览、代码「不变」；RFC-020 plan §4 记了实施记录，不涉及修订。提交 `c8c5b8d`，[CI 35809162288](https://github.com/wangbinquan/CrewStation/actions/runs/35809162288) 六项全部成功。

- **实量**（1440×900，dev-developer，演示项目）：面板正文 651px，预览只占 266px（iframe 停在 `min-height` 200px）、代码 241px；打开 `crewstation.yaml` 后编辑器反而按全文撑高到 736px，连「保存」一起在面板里滚走。放大形态同样。
- **根因**：RFC-020 T5／T6（`b8b64e2`）把两者从定高的整页（原 `.contentStage`）搬进面板，包每个面板的 `.pane` 没有高度，`DevelopmentPreview`／`EditorPane` 自己的 `height: 100%` 落了空。
- **修复**：`ToolPane.fill`（只给预览、代码）→ `.fill { height: 100% }`，内容占满面板正文、在自己内部滚动。变更、数据、参考、会话是文档式内容，仍从顶部排、长了由面板正文滚动（RFC-020 之前也是自然高度）。
- **用例**：`devSessionPanel` 新增一条（六个面板里只有预览与代码带 `fill`；`.fill`、`.preview`、`EditorPane` 的 `.pane` 三处 `height: 100%` 的样式链），改前红；e2e `projectWorkspaceIa` 新增 WS-07 一条（内容底边距面板正文底边不超过 12px、正文不滚动），对改前的线上包实跑红（差 377px）。console 层 649 pass／0 fail，`check:static` 绿。
- **实机核对（未部署）**：从 `ec33c69`＋本修复构建镜像，无头 Chrome 用 CDP 只换 `/assets/*` 的 JS／CSS（登录、接口、任务流走真实后端，不动共享 console；做法与两个坑写进 dev-gotchas）：1280×720／1440×900／1920×1080／1024×768／390×844 下预览与代码在旁、放大都占满（内容底边距正文底边 8px，即内边距；正文不滚动），预览 iframe 1440 下 569px（原 200px）、1920 下 749px，编辑器在 CodeMirror 里滚（954／354）；其余四个面板行为不变；无横向溢出、无控制台错误。**新 e2e 条还没对部署后的包跑过。**
- **部署**：作者批准后与下一批一起部署，见上一节（`cs-console:fill-height-20260923`）；当时构建的 `panel-fill-20260923b` 没有部署，已删。
- **提交时的并行写入**：`git add` 之后、`git commit -- <路径>` 之前，并行会话往 `dev-gotchas.md` 写了一段「终端程序的查询也会产生『输入』」，一度被一起提走；推送前用临时索引把它从本提交里拿掉，那段仍在工作树里，归原会话提交。
- **两处留白**（工作区定高下方的空白、文档式面板内容短时下方的空白）：作者裁定都改，见上一节。

## 开发页 CLI 操作即自动取得输入控制、占用人实时显示；动作型链接改为按钮样式（2026-09-23）

作者问「系统里还有多少跳转用超链接原始格式、能不能换成按钮」，并反馈「获取控制权的按钮一点都不显眼；没被别人占用时操作 CLI 就该自动获取，被占用就提示谁在占用」。先分析、再两轮提问裁定：**直接改＋回填 RFC-003（不另立 RFC）**，收尾「提交推送＋部署＋两身份实机验证」。

**链接现状**（生产代码 94 处 `<Link>`／`<a>`）：导航 12、已手写成按钮样子 9（四份各自的 CSS）、引用型（名字、标签、路径、地址）13、市场整卡 1、**动作型原始蓝字 59**。裁定「动作型全部改」：新增 `shared/ui/navigation/ButtonLink.tsx`（`ButtonLink`／`ExternalButtonLink`，仍是 `<a>`，↗ 由样式生成、不进文字），`Button` 加 `size="small"`；59＋9 处统一改用、四份手写样式删除、文案去掉 →／←／↗；`apps/console/src/tests/actionLinks.test.ts` 拦下文案取自 `t(...)` 的裸 `<Link>`／`<a>`（带 className／activeProps 的导航项与引用型不算）。

**输入控制裁定**：点进／Tab 进／按键／切回停着焦点的终端即自动取得，只打开页面不取；焦点在终端才续约，离开满 30 秒页面主动 detach；同一用户换窗口直接转移（占用只对别人成立）；每个 CLI 各一把；占用人常驻实时显示。实现是 **Runner 记持有人**：cs-session 按连接的网关身份（用户 ID＋显示名）注入取得命令（浏览器自带的丢弃），Runner 换人／释放／到期推 `terminalControl`（只实时转发、不落库、带单调 `revision`），`attachTerminal` 快照带当前状态；hello 能力位 `terminalControl: 1`，**协议号不变**。旧 Runner 没有这些字段时退回「其他窗口正在输入 · 只读」、不实时。状态条：你正在输入（绿，整窗绿框）／空闲 · 点击终端即可输入（蓝）／你在另一个窗口中输入（蓝）／某某 正在输入 · 只读（黄）。回填：RFC-003 `development-workspace.md` 第 5 节修订、`design.md` §6、开发规则 §7、dev-gotchas 两条（Runner 错误码到浏览器只剩 kind；终端自动应答会续租）。

**提交**（均按显式路径；共享暂存区里并行会话的条目未动）：
- `ec33c69` 功能主体，97 个文件。`topologyPages.test.tsx` 混着并行会话的在制品，只把「HEAD＋自己那一行」用 `update-index --cacheinfo` 放进暂存区再 `commit -i`。[CI 35807300617](https://github.com/wangbinquan/CrewStation/actions/runs/35807300617) 六项成功（含 e2e、gate）。提交前本机 `test:cover`（带 dev-oidc）2186 pass／9 skip／0 fail，`test:patch --worktree` 改动行 315／318（99.1%）。
- `6825ca7` 顺手修：RFC-020 `b927a15` 把「打开正式应用／打开试用」挪到 `slot.open.*` 后，项目列表的 SummaryFacts 还用已删的 `projects.summary.openProduction／openPreview`，按钮上直接显示键名（中英键集合一致，i18nParity 看不出）。改用 `slot.open.${name}`；新增 `i18nKeysInCode.test.ts`（`t(...)` 写死的 a.b.c 键必须在文案表里，全仓只命中这两处）。[CI 35808537879](https://github.com/wangbinquan/CrewStation/actions/runs/35808537879) 成功。
- `0a92896` 实机发现：离开终端后 OpenCode 查询终端能力、光标与配色，xterm 的自动应答走 `terminalInput`、每条都续租，释放拖到 39.5 秒（CDP 抓 WebSocket 帧确认）；改为离开满 `CONTROL_RELEASE_MS` 页面主动 detach。[CI 35809030255](https://github.com/wangbinquan/CrewStation/actions/runs/35809030255) 成功。
- `ae7ee76` 顺手修：概览底部 `.bottom` 的 `minmax(440px, 1fr)`（RFC-020 `3b7ec74`）在 390／320 宽下把主区撑到 456px、右侧被裁；同类六处统一 `minmax(min(100%, Npx), 1fr)`，新增 `responsiveGrid.test.ts`。

**本机部署**：cs-session 滚到 `cs-control-plane:terminal-control-20260923`（`git archive ec33c69` 构建）；console 先滚 `cs-console:terminal-control-20260923`，之后经并行会话的 `detail-top-20260923(b)`，现为 crewstation-14 从 `fa542b8` 构建的 `cs-console:fill-height-20260923`（含本节全部提交）。任务底座 `crewstation/task-runtime:terminal-control-20260923`（`sha256:669e3c94…`）推进集群仓库，`:dev` 底座未动；默认档位 `volc-glm-5-2` 换成新底座重新保存为**修订 4**，档位测试全部通过（拉镜像、Runner 握手、预置配置、起 CLI、真实模型轮次）。修订 4 之前起的 CLI 仍是旧 Runner。

**实机两身份核对**（无头 Chrome＋CDP，dev-admin＋dev-developer，演示数字人，新开一个修订 4 的 CLI）：两边空闲 → dev-developer 点进终端得「你正在输入」＋绿框、dev-admin 同时看到「dev-developer 正在输入 · 只读」→ dev-admin 点进被拒且不报错 → dev-developer 点到页面标题离开，两边回到空闲（当时 41 秒，即上面 `0a92896` 修的问题）→ dev-admin 点进取得、对方看到「dev-admin 正在输入」→ dev-admin 离开窗口后在第二个窗口点进，控制直接转过去、第一个窗口显示「你在另一个窗口中输入」。无控制台错误。作者的两个旧 Runner CLI 只读观察（均显示空闲），没有点。

**对环境的临时改动（都已还原）**：演示数字人并发额度 3→4→3 两次（被会话＋两个运行中的 CLI 占满；第一次起 CLI 被额度拒绝，名册里留一条 failed 启动记录）；两次各起一个验收 CLI，均已 stop；dev-admin／dev-developer 的个人布局按开始前整份 PUT 还原。

**并行会话的 console 宕机约 6 分钟（09:57–10:03）**：对方滚 `cs-console:detail-top-20260923` 时用 `NODE=$(… source deploy/local/lib.sh; echo $NODE)` 取节点名，但 lib.sh 只定义 `NODE_CONTAINER` 且开 `set -u`，导入静默失败、ImagePullBackOff，Recreate 策略下网关 404。我把对方已构建好的同一镜像导入节点、删掉卡住的 Pod，按对方的选择完成 rollout。

**复核（`fill-height-20260923` 上）**：离开终端后 **30.4 秒**释放（修复前 39.5–41 秒；页面在 30 秒时 detach，Runner 随即推「已空闲」）；概览在 390／320 宽下主区 `scrollWidth` 等于可视宽度，不再裁切。复核又临时把演示额度 3→4→3、起一个 CLI 后 stop、按原样还原 dev-developer 的布局。另补 `b23078e`：会话模块用例四处固定 sleep 改按条件轮询（CI 35809676244 的 module 红即此），[CI 35810497939](https://github.com/wangbinquan/CrewStation/actions/runs/35810497939) 六项成功。

**观察（非本次引入，待作者定）**：新开的 CLI 在有人取得输入之前一直是空白——OpenCode 启动要先等终端回答能力／配色查询，而只有持有控制的视图会回话（未持有的 `disableStdin`）；取得后十秒内即渲染出界面。原来要点「获取输入控制」按钮，现在点进终端即可。若希望新开即显示，可以讨论「谁点的 ＋ 就替谁自动取得」。

## 拓扑详情栏独立滚动、侧栏操作按钮移到顶部、图上方说明行改为时间标签（2026-09-23）

作者反馈集群拓扑 Pod 层点业务 Pod 后右侧详情很长、整页被拉长，底部四个操作按钮够不着；并要求排查其他侧栏的底部按钮、去掉图上方两行说明。提交 `da0b1f7`：

- **根因**：`AppShell` 的 `main` 带 `overflow: auto` 却不限高，是 sticky 的滚动容器却从不滚动，详情栏的 `position: sticky` 一直没生效（算力档位编辑页早就为此单独放开过）。现在 ≥1100px 时详情栏限高 `100dvh - 32px`、自己滚动，有详情时 `:global(main):has(.workspace.hasDetail)` 放开 overflow。
- **操作上移**：`ClusterDetail` 管理动作移到页签之上（页签「概览与操作」改名「概览」，资源清单里的详情同样生效）；集群项目层节点卡「展开 Pod 层」、项目侧 `TopologyDetail`「查看日志」、接口目录 `OperationDetail` 申请／试调都移到事实列表之前。算力档位编辑器的保存栏本来就在顶部，没动。
- **说明行**：集群拓扑三层提示与「快照完整 · 观测于 · 每 15 秒…」删除；观测时间做成图框右上角标签 `TopologyStamp`（完整度与刷新说明在悬停提示），`complete=false` 仍留失败来源警示条。RFC-019 design 已回填修订说明。
- **部署与实机**：从 `git archive` 的提交内容（不含工作树里并行会话的开发页在制品）构建 `cs-console:detail-top-20260923b` 并滚动 console。CDP 1440×900 演示项目 Pod 层点 `demo-blue-…`：详情栏 868px 高、内容 1361px 在栏内滚动，「重启」在 281px、页签条在 434px，图框右上「观测于 …」，无提示行；e2e `topology`＋`clusterLayout`＋`capabilityDepth` 17 pass／1 skip。本机 `check:static` 绿，unit 351／module 1106（7 skip）／console 652 全过；不带 `CS_E2E_AUTH=dev-oidc` 的整套 `bun run check` 在 e2e 层失败并以 bun trap 5 退出，与本改动无关。
- `79a3ede`（含 `da0b1f7`）的 [CI 35809220809](https://github.com/wangbinquan/CrewStation/actions/runs/35809220809) 六项全部成功。中间镜像 `cs-console:detail-top-20260923` 已从 docker 与节点删除。

## 「＋ 创建开发Agent会话」的展开箭头与主键一起置灰（2026-09-23）

作者实机：判断开发环境是否就绪的这段时间，主键是灰的，右侧展开箭头却是亮的。缺陷修复，RFC-020 没写禁用态，不涉及修订。

- `SplitButton` 的 `menuDisabled` 原来只改样式、仍能展开，工具行也没传它。现在置灰时箭头渲染为 disabled 的原生按钮（与主键一样点不了、不进 Tab 顺序，已展开的菜单随之收起），悬停不再变色。
- 工具行：环境未就绪、正在创建、档位读取中或失败、工作区已满时主键与箭头一起置灰；**只有所选档位被阻断**（不可用、已不在列表、没有默认档位）时箭头保持可用——换档位要靠它，否则就困住了。
- 用例：`devSessionToolbar` 新增两条（环境未就绪时一起置灰、点不开，改前红；档位被阻断时箭头仍能展开）。console 层 644 pass／0 fail。
- 只提交了本人的改动：`NativeToolbar.tsx` 工作树里还有并行会话把 `Link` 换成 `ButtonLink` 的在制品，它依赖未追踪的 `shared/ui/ButtonLink.tsx`，整文件提交会让干净检出编译失败。用临时索引（`GIT_INDEX_FILE`）只写入本人的两处改动，工作树与共享暂存区都没动。
- **部署与实机**：从 `463b67d` 的提交内容构建 `cs-console:caret-20260923`（线上包 `index-soc3bru4.js`，不含并行会话的 `ButtonLink` 在制品），导入节点并滚动 console。Chrome 扩展里临时把 `WebSocket` 换成连不上的桩、应用内离开再回开发页，页面停在「页面连接尚未就绪 · 正在自动连接」：主键与箭头都是 disabled、不透明度都是 0.55、高度都是 28px；恢复真实连接后回到「已连接」，两者一起亮起，点箭头展开档位与权限、再点收起。`463b67d` 的 [CI 35806328314](https://github.com/wangbinquan/CrewStation/actions/runs/35806328314) 六项全部成功。

## 开发页开着面板时左栏切不走：离开途中的地址被当成「无参数进入」（2026-09-23）

作者反馈「卡死了、切换不了页面」。实机查明页面没有卡死，是开发页把每次跳转拽了回来：

- **证据**：作者 Chrome 的会话文件（`Default/Sessions/Session_*`）里，08:27–08:28 同一标签页新建的历史条目 44–49，原始地址是 `/admin/projects?q=`、`/release`、`/dev-session`，最终地址却全是 `dev-session?view=reference`；渲染进程 CPU 在 3% 以下，不是死循环。扩展新开标签页挂钩 `history.pushState／replaceState` 复现：点「发布与上线」→ `pushState(/release)`，21 ms 后 `replaceState(dev-session?view=reference)`。
- **根因**：TanStack Router 在跳转一开始就把 `stores.location` 换成目标地址，目标页提交前开发页仍挂着。`useDevelopmentLocation` 读的是 `useLocation()`，`useWorkspaceLocation` 于是把离开途中没有 `view` 的 `/release` 当成「无参数进入」，把个人布局里的「参考」用 `replace` 写回开发页地址。自 `b8b64e2`（RFC-020 T5／T6 起无参数进入写回地址）起，只要个人布局里开着面板就会发生。
- **修复**：`useDevelopmentLocation` 新增 `usePageLocation`——路径不是本页时沿用本页最后一次的地址，离开途中也不发 `replace` 写回；离开途中按别的页参数改个人布局、主区闪一下的可能随之消除。同类排查：其余读 `useLocation()` 的组件（顶栏、空间切换、左栏、活动菜单）只做高亮或记住位置，`ProjectSpaceBoundary` 只在项目种类与空间不符时重定向，都不受影响。dev-gotchas「前端与测试」补了一条。
- **用例**：`devSessionPanel` 新增「开着面板从左栏去别的页，不被拽回开发页」（去发布页；回开发页仍按设计恢复在旁；再去运行与诊断），改前红、改后绿。本机 `check:static` 通过，console 层 630 pass／0 fail；完整 `bun run check` 里只有 `tests/e2e/` 六个文件红，都停在登录页（本机没带 `CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin`；没有补跑，因为 e2e 以作者身份运行会改掉作者的个人布局）。
- **部署**：从 `44c5717` 的提交内容加这处修复构建 `cs-console:nav-leave-20260923`（不含工作树里并行会话的拓扑与 `OperationDetail` 在制品），导入节点并滚动 console（原为同出自 `44c5717` 的 `unfold-20260923`），线上包 `index-BC2E1ukh.js`。
- **实机复验**（作者要求用 Chrome 扩展自己验；线上包 `index-BC2E1ukh.js`，演示项目 `?view=reference`）：点「发布与上线」只有一次 `pushState(/release)`，停在发布页；左栏回「开发」按设计 23 ms 后 `replace` 成 `?view=reference`；再点「运行与诊断」「← 项目开发」和顶栏「平台管理」（作者被拽回的正是去 `/admin/projects?q=` 这一下），都只有一次 `pushState` 并停在目标页。途中几次点击没反应，查明是扩展窗口被遮挡（`visibilityState: hidden`）时点击根本没进页面，先截图再点即正常，与应用无关（dev-gotchas 补了一条）。`87b6595` 的 [CI 35804444594](https://github.com/wangbinquan/CrewStation/actions/runs/35804444594) 六项全部成功。

## 项目工作台去掉整段折叠：标签表、项目信息、版本历史、部署版本对照、Swagger、可见性检查（2026-09-23）

作者看实机后当面裁定，直接修改、不另立 RFC（RFC-020 proposal §4.4／§4.6／§7、design §6／§7 加了同日修订说明，plan §4 有实施记录）：

- 发布与上线页最下方的「标签」卡直接展示，不再包在 `<details>` 里。
- 项目设置 → 项目信息：「技术详情就是项目信息」——新增 `ProjectInfoCard`，作为这一组第一张卡直接列出项目 ID、服务 ID（开通未完成时为「—」）、命名空间；三个标签改走 `projects.info.*` 中英文案（原为写死的英文）。仓库卡与服务身份、地址、配额各段顺序不变。
- 用例：`releaseTimelinePage` 新增「标签卡是最后一张、不在 `<details>` 里、列出全部标签」；`projectResources` 改写项目信息用例（前两张卡是「项目信息」「源码仓库」、三行标签与值），新增开通未完成一条（夹具加 `noService` 开关）。改前均为红。
- 第一批提交 `374cd64`，[CI 35801959757](https://github.com/wangbinquan/CrewStation/actions/runs/35801959757) 六项成功（`module` 作业各步骤均成功，GitHub 作业级状态停在 in_progress，`gate` 在它之后成功）；本机 console 从提交内容（`git archive`，不含工作树里并行会话的拓扑在制品）构建 `cs-console:tags-info-20260923` 并滚动，CDP 实机核对：发布页最后一张卡是「标签」、不在 `<details>` 里；项目信息页卡片顺序「项目信息／源码仓库／服务身份／域名与地址／配额与套餐」；1440 与 320 无横向溢出、无控制台错误；e2e `projectSettingsUx`＋`projectWorkspaceIa` 12/12。
- 第二批（同类排查后作者全选）：环境变量卡页脚「版本历史」恢复 `h3` 标题直接展示；生产「生产配置与部署版本」卡直接列两槽快照对照（删掉 `config.impact.snapshots`）；参考面板放大形态「内嵌 Swagger」直接展示，`proxy` 只作初始代理；应用展示「检查保存后的效果」改为一张卡（只对能配置的人）。RFC-009 proposal §3.3／§3.4、design §3.1 与 RFC-020 proposal §4.7、design §7 加同日修订说明。用例 `configImpact`、`visibilitySettings` 各新增一条，`catalogDetail` 两条改写，改前均为红。行级折叠（行详情、ID、响应头）与集群、管理空间里的折叠未动。
- 第二批提交 `44c5717`，[CI 35802957520](https://github.com/wangbinquan/CrewStation/actions/runs/35802957520) 六项成功。本机 console 滚到 `cs-console:unfold-20260923`（同样由 `git archive` 的提交内容构建），中间镜像 `cs-console:tags-info-20260923` 已从 docker 与节点删除。CDP 实机核对六处（版本历史、部署版本对照、检查保存后的效果、内嵌 Swagger、标签、项目信息）在 1440 与 320 下都直接展示、不在 `<details>` 里、无横向溢出、无控制台错误；e2e `projectSettingsUx`／`projectWorkspaceIa`／`capabilityDepth`／`apiInvocation` 21/21。
- 本机全量 `bun run check`：静态检查全绿；未带 `CS_E2E_AUTH=dev-oidc` 时 e2e 32 条因拿不到管理员会话失败（本机密码登录自 09-20 关闭），与改动无关；工作台层 627/627（一次并跑偶发 `agentExecutionStreams`，单跑与重跑均绿）。

## 开发页「卡住、自己在到处跳」的实机排查（2026-09-23）

作者反馈后用 CDP 在真实浏览器复现（从左栏点「开发」，1440／1200／1100／1040／1024／1000／980 各采样 6 秒），查到三件事：

1. **无参数进入把个人布局里的面板连「放大」一起写回地址**：先出终端，布局读到后（约 0.4–0.8 s）整页切成放大的预览把终端盖住。加上验收脚本一直以作者同一个 `dev-admin` 身份在演示项目上切换工具，作者每次进页都落到不同的面板。已改：无参数进入只恢复「在旁」；内容区窄于 800px 时连在旁也不恢复（否则等于放大），面板保持收起、终端可见；窄屏切换加迟滞（<800 放大、≥840 才回并排，避免 1040px 窗口滚动条一出现就来回切）。提交 `d65d186`＋`8430efc`（含 `devSessionPanel` 新旧用例、plan §4、dev-gotchas；`8430efc` 的 [CI 35797524040](https://github.com/wangbinquan/CrewStation/actions/runs/35797524040) 六项成功，其中 `console` 作业第一次红在已知偶发用例 `pollingVisibility`，按同一 SHA 重跑即绿；`d65d186` 的 e2e 作业红是 GitHub runner 起 postgres 容器时 Docker 网络失败，与用例无关），本机 console 已滚到 `cs-console:rfc020-20260923d` 并实机核对：1024 进页保持收起，1440 进页恢复在旁 `?view=code`，终端始终可见。跑完把作者的个人布局收起（`?view=cli`）。
2. **演示会话的 TaskRunner 在 23:13:41 因 90 s 无帧断链后，7 分钟内一直 `Failed to connect`（code 1006）**，而同一容器里新起一个 `bun -e` 进程 2 ms 就能开 WebSocket，cs-session 的 `/healthz`、`/runner` 升级（101）、`/internal/tasks/…/connection` 都正常且仍认为 Runner「已连接」（旧连接没收到关闭）。期间 cs-api 对该任务的 `workspaceStatus`／原生动态命令全部超时，网关对 `GET /v1/projects/{id}/dev-session` 返回 502（每次约 4 s，Traefik 自己的 Bad Gateway 正文），页面因此在错误提示与重试之间来回。23:20:58 Runner 自行重连成功（`resumeFromSeq 16960`），此后接口全部 200（dev-session 8 ms、version-comparison 120 ms）。**未定位到根因**：Runner 进程（Bun 1.3.13，`bun run --watch`）的 `ReconnectingWebSocketClient` 每次新建 `WebSocket` 都失败，与网络、cs-session、fd（82）、内存（128 MiB/1 GiB）都无关；cs-session 对半开的旧连接没有及时判定失联也是一处可疑点（`runnerStaleMs`）。留给下一个 session 排查：`packages/ws/reconnectingClient.ts`、`modules/session/application/runnerHub.ts`、以及 cs-api 读会话时哪一步会拖满 4 s 让网关回 502。
3. cs-session 启动后有 23 条未处理的 `DOMException TimeoutError`（`modules/session/adapters/http/fetchForwarder.ts` 的副本间转发在 Runner 尚未接入时超时），只是日志噪音，但应当兜住。

## RFC-020 项目工作台信息架构重构：Done，T3–T10 全部完成并实机验收（2026-09-23）

作者逐项裁定（D1 右侧工具面板、D2 取消「开发资源」全部并入面板与设置、D3 横向页签只合并状态、D4 概览一屏、D5 发布记录合并时间线、D6 随 D2 新增只读「项目信息」组、D7 保留「发布与上线」「运行与诊断」文案）并「批准实施并提交上库」。四批提交、全部按显式路径：

- `b927a15` T3／T4：左栏五项生命周期顺序、运行与诊断五页签、项目设置「项目信息」、页头统一刷新、概览一屏。
- `b8b64e2` T5／T6：开发工作区右侧工具面板（预览／代码／变更／数据／参考／会话；可拖 30%–60%、收起成右缘页签栏、放大；内容区窄于 800px 只有放大）、一条工具行（`SplitButton`「＋ 创建开发Agent会话 ▾」、布局菜单、「⋯」）、参考面板由 app 层装配、旧地址重定向；契约 `WorkspaceLayout.tool` 可选字段，旧字段读时推导写时回填。
- `8448a29` T7：待验证卡上直接「上线 vX」／「回退到 vX」，`switch=1` 进入即核对；`ReleaseTimeline` 合并发布与切流，人名与标签代替 UUID。
- `f1a19bc` T8：目录放大形态「表在前、详情在旁」，`operation` 参数改为选中；事件段投递摘要；清理 `resources.*` 文案。
- 本批 T9／T10：e2e 更新与新增 `projectWorkspaceIa`；概览形态卡与最近动态并排（实机 1440×900 叠放是 1050px，并排后 900px）；既有 RFC-003／008／009／019 加了 2026-09-23 修订说明；`acceptance.md` 逐项证据。

**顺手修掉的缺陷**：`useDevSession` 无数据查询每次重取被置回 pending（开会话表单每 10 秒卸载一次；404 改为数据 `null`）；`sessionAccess` 身份缺成员列表整页崩溃；无 `taskId` 的会话响应连流崩溃；`parseReleaseSearch` 不认路由解析成数字的 `switch=1`。

**用例基础设施两条教训**（已写进 plan §4）：`renderApp.click` 不再点到闭合 `<details>` 里的项并给目标多等几拍；一个失败的 `expect(<happy-dom 节点>).toBeNull()` 会让 bun 花几十秒序列化节点，看起来像卡死——断言 DOM 存在性只比较数量或文本。`configImpact` 的「槽读取失败不冒充未部署」整套并跑时偶发（发布记录查询未落地），单跑稳定，未改。

**行为变化，作者看实机时注意**：开发工作区按任务重建（`key=taskId`），会话被替换时参考面板里的试调／Swagger 输入随之清空，旧输入不可能发到新会话。1024 视口的内容区是 792px，按设计阈值只有放大形态。

本机 console 已部署 `cs-console:rfc020-20260923b` 并 Ready。本机 `check:static` 绿；`CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin bun run test:cover` **2152 pass／9 skip／0 fail**（365 个文件，含 e2e 全套与新增 8 条）；`test:patch --base origin/main` 判定本批无需用例防护的新增生产代码。CI：T5／T6 `b8b64e2` 六项成功（35768120059）；T7 `8448a29` 的 `module` 作业红在后端 `session module` 的一条库竞态用例（本 RFC 未触及后端），T8 `f1a19bc` 同一后端六项成功（35769593471）；验收批 `3b7ec74` 六项全部成功（[CI 35771402142](https://github.com/wangbinquan/CrewStation/actions/runs/35771402142)，含 `gate` 新增代码防护与 `e2e`）。

**本机整套已重新部署（2026-09-23，作者「部署到本机环境」）**：`./deploy/local/install-platform.sh`（`SKIP_TASK_RUNTIME_BUILD=1`，任务容器镜像自 09-21 未变）从 `3b7ec74` 重建 `cs-control-plane:dev`／`cs-builder:dev`／`cs-console:dev` 并导入节点，迁移 Job 成功，八个 Deployment 全部滚到 `:dev` 且 Ready；`verify.sh` A–D 全 PASS；e2e `projectWorkspaceIa`＋`capabilityDepth` 15/15。这次必须连控制面一起滚：`WorkspaceLayoutSchema` 是 `.strict()`，旧 cs-api 会把带 `tool` 的布局保存打回——重部署后实机核对 dev-admin 的个人布局 PUT 成功（revision 51，`tool: {changes, full, 0.5}`，页面「个人布局已保存」）。安装脚本最后一步以 `platform-admin` 密码登录播种套餐目录报 403（密码登录自 09-20 起关闭，目录早已播种），脚本因此退出 1，与部署无关。

**下一个 session 注意**：作者尚未亲手看实机，T2 裁定里的形态以本机 `cs-console:dev`（自 `3b7ec74` 构建）为准；概览形态卡与最近动态并排是实测后的偏差（设计稿叠放），作者不认可就改回并收窄两卡。`e2e/capabilityDepth` 等断言已按新结构改写，回退任何一批都要连用例一起退。

## RFC-020 项目工作台信息架构重构：Draft，等作者裁定（2026-09-23）

作者反馈「项目开发整体界面逻辑太乱了，上手都不知道要操作什么，各种页签也都是堆叠在那的，使用起来也没有逻辑，在需要一个功能的时候这个功能的切换也不在手边」，要求看完项目详情的整体元素、各页面与用户旅程后全面重构 UX。**按开发规则 §5／§8 只做了审查与三件套，没有改任何代码**；三件套与设计稿在 `proposal/rfc/RFC-020-project-workspace-ia/`，索引已登记为 Draft。

**审查怎么做的**：这台机器上已有一个开着 9333 调试端口的无头 Chrome（另一会话的草稿目录起的），Chrome 扩展未连接；于是复用 `tests/e2e/cdp.ts`＋`consoleSession.ts` 的 dev-oidc 登录，以 dev-admin 与 dev-developer 两个真实身份、1440 与 1024 两个宽度，走完演示数字人 `demo` 的 29 个地址（概览、开发六视图与历史对话、开发资源五主题、发布三态、运行与诊断六页签、设置四组、市场）和 `rfc006-verify` 的概览，每页留截图与结构清单（标题、页签、按钮、链接、页高、控制台错误），全部只读。dev-tester 在 `/v1/projects` 拿不到项目，只有市场入口，没纳入。截图在会话草稿目录，不入库；结论与 `文件:行号` 写进 `audit.md`。

**查出来的根因**（audit §3）：左栏六项平铺、「开发资源」资料页插在「开发」与「发布」之间；概览 1760px 里首屏之下四段都是别处已有的内容（当前开发、运行健康、最近发布活动、快捷入口＝左栏重复）；二级导航三种形态并存（开发／运行与诊断横向页签，开发资源／设置左侧分组，概览／发布没有）；开发页在终端上方叠四条控制行，「变更」里再嵌一层页签；预览／代码／变更整页替换终端；数据、事件、地址各拆在两个入口；切流记录两列 UUID；刷新按钮九处各异。

**提案骨架**（proposal §4）：左栏改生命周期顺序「概览／开发／发布与上线／运行与诊断／开发资源／项目设置」；概览一屏（页头链接行、横幅、三张状态卡、形态、最近动态）；开发页一条工具行＋右侧六页签工具面板（预览／代码／变更／数据／参考／会话，可拖宽、收起、放大），个人布局契约 `WorkspaceLayout` 加可选 `tool` 字段；发布页发布与切流合并成时间线、人名代替 UUID、上线按钮上待验证卡；运行与诊断改分组导航五段（健康与形态合并为「状态」）；开发资源缩为三主题（数据 → 开发面板、项目与仓库 → 设置「项目信息」）。全部旧地址 `replace` 重定向，无后端接口改动。

**等作者裁定的七项**（proposal §8）：D1 工具面板还是整页页签；D2 开发资源保留／并入／不动；D3 运行与诊断分组导航；D4 概览一屏；D5 时间线；D6 设置「项目信息」组；D7 左栏文案长短。草案按每项 (a) 写成，`prototype.html` 顶部有对应开关可以来回看。裁定后按 plan T2 改写三件套，再进 T3。

**下一个 session 注意**：`dev-gotchas.md` 在本会话期间被并行会话改过（未细看），提交前先 `git status` 看清哪些是别人的；本机 e2e 仍要 `CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin`。

## 本机 OAuth 2.0 跳转登录修复：开发登录器不再反过来依赖平台登录（2026-09-22）

作者问「为什么本机 oauth 2.0 的跳转登陆坏了」，查清后答复「修」，并在破窗口那一步答复「你来跑」。**登录已完全恢复，根因已治本。**

**根因不是一条，是三条耦合在一起。** `crewstation-dev-auth` 跑 `cs-control-plane` 同一个镜像，RFC-019 按标签批量滚镜像时把它一起滚了；随后：

1. 它启动要先用管理员**密码**登录平台播种，而库内策略自 2026-09-20 起关闭密码登录 → `403 /auth/login`；
2. `routePrefix` 与 client secret **每次进程启动现摇**，写回平台的 `ensureProvider` 排在密码登录之后 → 库里 `identity.oidc_providers` 那条 `dev-roles` 的 `issuer_url` 停在已死 Pod 的 `…/oidc/ed6450578657`（`updated_at` 2026-09-21 04:42），`/auth/oidc/dev-roles/start` 返回 503 `endpoints-unresolved`（新 Pod 内实测该前缀 404）；
3. `/readyz` 绑在播种结果上 → Pod 0/1。

第 3 条另带一坑：清单里 `publishNotReadyAddresses: true`（注释写着防 readiness 自锁）**在 Traefik 3.7 上本就不管用**——它只抬 EndpointSlice 的 `ready`，`serving` 仍为 false，而 Traefik 按 `serving` 过滤，日志 `no servers found for crewstation-system/crewstation-dev-auth`，整条 router 被丢，`dev-auth.cs.localhost` 是 **404 而不是 503**，连带那个「重新准备」按钮的页面都打不开。

**改了什么**（只动本机开发工具与部署清单，产品代码未动）：

- `tools/dev-auth/server.ts`：新增 `devAuthOidcIdentity()`，前缀与 client secret 改从 `CS_DEV_AUTH_ROUTE_ID`／`CS_DEV_AUTH_CLIENT_SECRET` 取，没配才退回临时值**并打降级日志**；`/readyz` 只看端口，播种状态移到 `/` 与 `/status.json`；播种失败自动重试 5 轮（`SEED_RETRIES`／`SEED_RETRY_DELAY_MS`，可注入）。
- `deploy/local/dev-auth.yaml`：删掉 `publishNotReadyAddresses`，`failureThreshold` 90→15。
- `deploy/local/install-dev-auth.sh`：那两个值一次生成、跨重装沿用（先读旧 Secret）；rollout 之后**单独**核对 `/status.json` 的播种结果，失败如实报原因并退出 1。
- `tools/dev-auth/devAuth.test.ts` +6 条；`docs/engineering/dev-gotchas.md` 原条目重写。

**重试是实机新发现的第二个竞态**：前缀固定之后 issuer 不再变，cs-auth 的 Provider／JWKS 缓存因此会**活过 dev-auth 重启**，而新进程换了签名 `kid` → 首轮播种撞 `/start` 503（旧 issuer）或 `/callback` 400（旧公钥），几十秒后自行收敛。实测同一 Pod 重放播种即 `ready`／8 个项目。

**破窗口与恢复（作者两次明确授权，窗口已收回）**：`CS_PASSWORD_LOGIN=force-on` 加到 cs-auth 与 cs-api → 跑改过的 `install-dev-auth.sh`（生成并固定 `8899cb0ced2d0765`，重新注册 Provider）→ 移除开关重启两个服务。核对：`/auth/status` 回到 `passwordLoginEnabled:false`，两个 Deployment 的 `CS_PASSWORD_LOGIN` 已移除。用的是 Secret 里那份管理员口令——`.local/admin.env`（9月18）那份指纹不同，可能已过期。

**实机证据**：Pod 1/1（播种失败也 Ready）、EndpointSlice `serving:true`、`publishNotReadyAddresses` 已空、`dev-auth.cs.localhost` 404→**200**；密码登录关闭下手工走完整跳转链 `/start`→302→`/authorize`→302→`/callback`→302，`/v1/me` 分别拿到 `dev-admin`（admin）与 `dev-developer`（developer）。**回归本身**：`rollout restart` 一次 dev-auth，**+3s 登录链即回到 302，全程没开密码登录**；日志无「未配置」警告、五轮重试如实记账。

**续作（同日，作者答复「改」）：管理员会话改为优先走 dev-auth 自己的 OIDC。** `seed()` 先用固定管理员 subject 走一次完整授权码登录并核对 `platformRole === "admin"`，只有这条路不通（首次安装、Provider 漂移、固定账户被降权）才回落 `loginAdmin()` 并重新注册 Provider，回落记日志。RFC-007 的 design.md 与 acceptance-audit.md 已按 2026-09-22 修订回填（§1 的 `/auth/login` 改为回落用途、§2 去掉 `publishNotReadyAddresses` 论证、§3 启动步骤重写、§5 的 `/readyz` 语义、并推翻原「issuer 每次变化所以缓存键随之变化」那条）。**实测**：`passwordLoginEnabled:false` 下冷启动，第 1 轮 OIDC 撞重启后的陈旧 JWKS（`/callback` 400）→ 回落密码被 403 → 6 秒后第 2 轮 OIDC 成功，播种 `ready`／8 个项目，dev-auth 页显示「已就绪」且角色按钮可用，登录链仍 302、`/v1/me` 为 dev-admin。自此日常重启与滚镜像都不再需要破窗口；只有换掉那两个 Secret 字段、全新安装或固定账户被降权才需要。

## 集群管理页改版：指标条＋「拓扑｜资源清单」两级页签（2026-09-23）

作者实机反馈「集群管理页面根本没办法用：上面的卡片占大半屏，中间一个不知道干什么的搜索栏，切页签滚动条乱跳；统计和拓扑要打开就看到，列表是高级功能」。
先用 e2e 的 CDP 驱动（无头 Chrome、dev-admin）量了原页：页签条距页顶 **1440×900 下 979px、1280×720 下 1174px**（总览卡 407／602px、计数卡 112、采集状态 38、筛选卡 223 叠在页签上，且默认页签是工作负载而非排在第一位的拓扑）；
筛选卡只作用于清单页签却放在计数卡与页签之间，拓扑／节点下整块消失让页签条上下跳 235px；切清单类型时新查询未回前面板塌成一行，浏览器把 `scrollY` 钳到新的最大值（实测 979 → 262，再切拓扑 → 7）。

作者两轮裁定（AskUserQuestion，含 ASCII 预览）：结构取「指标条下一条页签：拓扑｜资源清单」，统计取「一行十格，窄屏换行」，清单区命名「资源清单 / Resource inventory」；流程取「直接改＋回填」，收尾取「提交并推送，再部署本机 console」。

**改法**（全部在 `apps/console`，无契约、无迁移）：
- `ClusterPage` 只剩指标条＋顶层 `Tabs`（`拓扑`／`资源清单`，缺省拓扑：`parseClusterSearch` 的 `tab` 缺省改为 `topology`，只带 `resourceId` 的旧链接落在工作负载）；从拓扑切回清单回到上次看的视图。
- 新 `ClusterOverviewStrip`：集群容量五格（`CapacityTiles`，标题＋主数值＋两行副文字）＋受管资源计数五格（异常 Pod >0 用 danger 色），宽度 3:2，1280 仍并排、更窄两组各占一行；采集状态一行＋一个折叠「容量明细、受管分项与来源状态」（`CapacityDetails`：口径说明、来源问题、容量／申请／限制表、未调度申请、受管分项、各来源采集状态）。RFC-015 §2.1 的必须展示项一项不减。
- 新 `ClusterInventory`：视图切换（新共享控件 `shared/ui/Segmented`，形态图的层级切换也改用它）、带标题「筛选清单」的筛选卡（趋势与操作记录只留项目筛选）、表格、分页与详情。
- 新 `shared/lib/useHeldHeight(contentKey)`：内容键（视图＋筛选）变了而新内容未到时，**同一次提交**就用上一次量到的高度做 min-height——效应里再挂已晚，页签条量宽度的布局读取会先让浏览器按塌掉的高度钳滚动位置（第二次实机就是这样红的）；键没变而子组件自己载入靠 `QueryStatus` 新加的 `data-query-state="pending"` 观察兜底；面板不再有载入态时放开并记新高度。
- 中英文各 7 个新键；删掉不再用的 `cluster.resources`。

**实机复量**（`cs-console:cluster-layout-20260923c`，同一套 CDP 脚本）：页签条距页顶 **1440 下 348px、1280 下 386px、1024 下 461px**，形态图起点 593／631／706，指标条 185／223／298px，筛选卡 264 → 120px（一行七项），三种宽度无横向溢出、无 console 错误；把视图切换条滚到视口顶部后切 Pod，`scrollY` 不动（`tests/e2e/clusterLayout.test.ts` 同一断言）。节点视图内容比视口短，切过去后文档自然缩到一屏，这是真实终态。

**用例**：`clusterManagement.test.tsx` 改为断言两级结构、缺省拓扑、计数格进清单、视图顺序、筛选卡只在清单里、操作记录只留项目筛选；`clusterMetrics.test.tsx` 文案对齐；新 `useHeldHeight.test.tsx`（渲染期下限、效应兜底、缓存命中不撑、首次不撑；happy-dom 无排版，`offsetHeight` 读 `data-h`）；新 e2e `clusterLayout.test.ts`（1440／1280 首屏内有页签与图；切视图 `scrollY` 不动）。本机：check:static 通过；unit 349／module 1106（7 skip）／console 601，0 fail；e2e 63 pass／2 skip／0 fail（含新加的 `clusterLayout` 三项）。
**回填**：RFC-010 proposal §3、RFC-015 proposal §2.1、RFC-019 proposal §4 各加 2026-09-23 修订引文；`dev-gotchas.md` 前端一节记「换查询面板塌掉钳滚动」的判据与两件工具。
**已推送**：`d2c3e9f`（24 个文件；STATE.md 与 dev-gotchas.md 同时带上了并行 dev-auth 会话已在工作树的段落，原样提交）。[CI 35754806948](https://github.com/wangbinquan/CrewStation/actions/runs/35754806948) 六项全部成功（含 `gate` 新增代码防护与 `e2e`，新加的 `clusterLayout` 三项在 CI 空平台上也通过）。本机 console 停在 `cs-console:cluster-layout-20260923c`，其余部署未动；两个中间镜像标签已从 docker 与节点删除，节点根分区 37%。

## RFC-019 部署与运行形态图：Done（2026-09-22）

作者批准三件套并裁定提案 §7（成员看到与管理员相同的 Pod 投影，不含环境变量值／Secret／注解／YAML；管理动作只在集群管理）。T1–T10 全部做完：

- **契约与后端**：`ProjectClusterResourcesSchema`、`summary.projects[]` 计数、api-client `cluster.projectResources`。`cluster-management` 已到 40 文件上限，只扩既有文件：`queries.ts` 加 `projectCounts`／`projectResourcesIn`／`projectResources`（`kindRank` 排序、500 条截断、`availableActions` 恒空），`dependencies.ts` 加 `authorizeProject`，路由 `GET /v1/projects/:projectId/cluster-resources`（先取 actor 再解析参数），组合根注入 `project.api.authorize(actor, projectId, 'develop')`。模块用例 `tests/projectResources.test.ts`（真实 PostgreSQL：成员读取、计数、测试员／陌生人／未知项目／410、HTTP 401／400／403／200、截断）。
- **工作台**：`tokens.css` 九组 `--cs-topo-*` 语义色（明暗两套）；`shared/ui/topology/`（模型、确定性排布、`fitMetrics` 铺满、SVG 图、图例、筛选、窄屏列表、工作区）；`shared/topology/`（项目形态、横带汇总、系统层静态表、系统形态、项目层折叠、文案）；三处入口：概览 `DeploymentTopologyCard`、运行与诊断 `topology` 页签（`TopologyPage`＋只读 `TopologyDetail`）、集群管理「拓扑」页签（`ClusterTopology` 三层，复用 `ClusterDetail`）。中英文各 200 余键。
- **测试**：console 六个 topology 用例文件（排布、组装、图组件、三处页面、令牌回归、夹具），导航与集群页既有用例更新；`tests/e2e/topology.test.ts`（三层、Pod 层与运行诊断页签、1280／1024／390／320 宽度、浅色主题与键盘、PVC 事实显示、成员 200／非成员 404）。完整 `bun run check`（带本机测试库）**2060 pass／55 skip／0 fail**——55 个 skip 全是 e2e 层，原因见下；`test:cover` 三层全绿（e2e 层 28 项因登不进而超时失败，同一原因），`test:patch --base origin/main --worktree` 改动行 522／522（100%）。
- **本机部署与实机核对**（`cs-control-plane:rfc019-20260922`、`cs-console:rfc019-20260922`，dev-admin 真实 Chrome）：项目范围盘点接口返回演示数字人 3 Pod／2 Deployment／1 PVC、`availableActions` 全空、快照完整，摘要计数与 `kubectl -n cs-demo` 一致；系统层 21 节点／20 条静态线、1728 视口下 SVG 1467px 铺满 1470px 容器；项目层 11 个项目、2 个需要关注；Pod 层 11 节点按 UID 对上、面包屑可返回；运行与诊断页签点 Pod 出只读详情（镜像、发布、槽、UID，无副本／重启入口，「查看日志」进日志页）；概览卡「工作负载 2 · Pod 3，就绪 3，运行 0」三条横带，点卡进全图；无 console 错误。逐项见 [acceptance.md](proposal/rfc/RFC-019-deployment-topology/acceptance.md)。
- **基线回填 v0.3.8**：Proposal §0.2 变更表、§3 能力行、§6 R55；Design §2.3 指引、§14.6、D55；Plan AT-56 与矩阵行。
- **顺手修的**：PVC 的 facts 值是 JSON（`{"storage":"10Gi"}`）原样上图，加 `factText` 取量显示为 `capacity 10Gi`（已有用例；已重建并滚出 `cs-console:rfc019-20260922b`，e2e 断言卡片文本不含 JSON，本机通过）。

**原卡住的地方（2026-09-22 当天已解除）**：滚 `cs-control-plane` 新镜像时 `crewstation-dev-auth` 也被一起重建，它启动要先用管理员密码登录平台播种、而密码登录是关的，于是本机 dev-oidc 登不进、e2e 层整层 skip。根因已按上一节治本（前缀与 client secret 固定进 Secret、`/readyz` 与播种解绑、播种自动重试），破窗口已在作者授权下走完并收回，登录与 e2e 层均已恢复。TP-17 的键盘与浅色主题、`factText` 的显示随后由本机 e2e 闭合（见下）。

**已推送**：`44f5ac1`（实现）、`f087007`（基线 v0.3.8）、`2ce5ba0`（e2e 用例接受空平台＋dev-gotchas）。CI：[run 35743094030](https://github.com/wangbinquan/CrewStation/actions/runs/35743094030)（`f087007`）五项成功、新增代码防护 99.2%（1229 行中 1219 行），e2e 唯一失败是系统层用例在没有项目的 CI 平台上等项目卡片；[run 35744347320](https://github.com/wangbinquan/CrewStation/actions/runs/35744347320)（`2ce5ba0`）六项全部成功，e2e 40 pass／20 skip／0 fail，其中 RFC-019 的系统层与 1280／1024／390 宽度用例通过（TP-16 由此闭合），Pod 层与成员用例因 CI 无项目 skip。

**dev-auth 恢复后（本机）**：e2e 层 **57 pass／2 skip／1 fail**（唯一失败 `clusterMetrics.test.ts`「live node, pod and storage observations…」为既有用例、单跑通过，时序 flake）；`tests/e2e/topology.test.ts` 补了 320px、浅色主题令牌切换、Enter／Escape、PVC 事实显示与非成员 404（`project` 模块 `authorize` 对非成员按项目不存在处理，模块用例与 RFC 文案已同步），visitor 为 dev-tester 与 dev-developer 各跑 **8／8**；`fd7c09c` 的 [run 35749904351](https://github.com/wangbinquan/CrewStation/actions/runs/35749904351) 六项成功、e2e 41 pass／21 skip／0 fail（Pod 层、成员与浅色键盘用例因 CI 无项目 skip）。跑完后我移除了 cs-auth／cs-api 部署上的 `CS_PASSWORD_LOGIN`（当时两处仍是 `force-on`）并各自滚动重启，核对 `password_login_enabled` 仍为 `f`、两处环境变量为空、dev-auth 仍 Ready、登录页只有「公司身份」入口且没有密码输入框；关窗后拓扑 e2e 再跑一次 8／8。

**收口**：README 与三件套状态改 Done；acceptance.md 每项有证据，TP-05／06／15 只有用例覆盖（原因写在各行）。

## I23 已裁定并执行：两个内置接入项目的 manifest 迁到 v2（2026-09-22）

作者对 I23 裁定「就选方案 a，把两个接入项目的 manifest 迁到 v2」。已执行完毕，**只差切流**。

**更正根因**：RFC-013 其实带了 v1→v2 升级器（`legacyManifestUpgrade`，经 `POST /v1/services/:id/manifest-upgrade` 暴露），
也已经让新建项目在建仓时把模板槽位换成真实 UUID（`initializeTemplateResources`）。缺口只在两头都不覆盖的那一类：
RFC-013 之前建的仓库，且从没人在开发会话编辑器里打开过 `crewstation.yaml`——升级器挂在编辑器的 `ManifestUpgradeNotice` 上，要人打开才触发。
这两个平台自建项目从没开过开发会话，于是一直停在 v1。方案 (b) 对新项目其实已经成立。

**做法**：每个仓库只改三处（协议号、`plan` → `servicePlanId`、每个 env 项补 `configDefinitionId`），其余内容与注释不动；
UUID 取自各项目实际的 `project.service_plans` 与 `config.definitions`。推送前用平台自己的 `ManifestSchema` 校验，
推送后把迁移前的 v1 原文交给平台升级器做对照——两者给出的 UUID 与取值逐项一致（仅键顺序不同）。
提交：`reference-api-proxy` `1d88a7d2`，`gitlab-event-producer` `f24e880f`。

**结果**：两个项目各发 `v0.1.4` 并 `ready`，作者授权后切流成功，两个服务均 HTTP 200，路由与 `release.service_slots.active` 都翻到 blue。
**切流接口的 `toSlot` 传的是角色不是物理槽**：待命槽当前角色即 `preview`，切完变 `prod`；传 `prod` 会被 `physicalOf` 解析回当前线上槽并以「已经是当前线上槽」拒绝——第一次就错在这里。

**EG-04 已闭合**：从已登记的数字人 `cs-demo` 服务槽 Pod 经网关调默认开放操作
`GET /api/test-gitlab/v4/projects/29/repository/commits/{sha}`，得 **HTTP 200 与真实 GitLab 数据**，
返回的正是本次迁移提交 `1d88a7d2` 自身；代理日志 `forwarded … status 200`，最近 500 行不含 `/internal/egress/http`。
同轮对照：同一调用方请求未开放的操作得 403，网关放行判定照常生效。RFC-018 八项验收全部通过，三件套已标 Done。

**本机基础设施问题（与本次改动无关，但会绊住下一个 session）**：这台 kind 节点上 Pod 访问 Service ClusterIP 不通，
直连 Pod IP 正常——同一 Pod 内对照，Traefik 的 `10.96.199.52:80` 连不上，其 Pod IP `:8000` 返回 200。
它同样解释了此前 cs-api 连 Prometheus 失败、以及 e2e `clusterMetrics` 历史新鲜度时红时绿。
上面的真实调用因此用 Pod IP 加 `Host:` 头发起，绕过的只是 kube-proxy 的 VIP 转换。

本仓 `integrations/*/crewstation.yaml` 里的 UUID 仍是模板槽位，这是有意的（建仓时才分配），没有改动。

## 出站白名单整体下线（RFC-018，2026-09-22）

作者问「出站白名单页面是用来配置什么的」，看过答复后裁定「这个能力可以下掉，不需要有这个约束」，随后明确「批准，并且本次就把功能全部下掉，历史的数据也清理掉，不要残留」。
按能力收缩型 RFC 走完流程：[RFC-018](proposal/rfc/RFC-018-remove-egress-allowlist/proposal.md) 的八项能力影响清单获批，Q1 取方案 C、Q2 取方案 b。

**查清的前提**：这条约束此前基本是空的。出站代理（E23／Q23）从未落地，开发会话、业务任务与构建 Pod 的命名空间策略自开通起就是出向全放行（代码注释自己标着「临时」）。
清单唯一真实执行点是 cs-api 给 APIProxy 的 `/internal/egress/http` 通道（I9(a)），参考代理经它访问上游——因为接入容器的服务槽只能到 DNS 与系统命名空间。

**删除**：`egress` 模块整体（L3，38 个文件）、契约与 api-client 资源、九条路由、工作台出站白名单页与出站申请页签、管理总览出站待办、`egress-blocked` 告警类型、安装器 `egress` 配置与预检播种、参考代理的平台转发通道。
**新增**：`integrationEgressNetworkPolicy` 只对 `APIProxy`／`EventProducer` 项目下发，放开 `workload=service` 出向；provisioning 增加启动重下发，遍历未归档项目重跑 `ensureNamespace`——命名空间对象只在开通时下发过一次，没有这一步存量项目拿不到新策略。

**实机证据**（本机全部滚到 `:dev`，九个 Deployment Ready）：11 个项目命名空间逐个核对，3 个接入容器项目各 4 条策略含 `crewstation-integration-egress`、8 个数字人项目各 3 条且没有它；cs-controller 日志 `namespace reapply done total=11 applied=11 failed=0`。
cs-api Pod 内六条出站路由全部 404，同轮 `/v1/api-requests` 仍 401。在**旧**代理 Pod 内打已删除通道得 404、同一 Pod 直连 `host.docker.internal:8929` 得 **200**——新策略在网络层确已生效。

**历史数据已清理**：先升代码，再取整库一致性备份（Pod 内 `pg_restore -l` 校验 469 个对象、含 egress 四张表与数据；本机副本 31,304,900 字节），一个事务内 `DROP SCHEMA egress CASCADE`（entries／requests／blocked／resource_identity_aliases，共 5 行）＋删 4 行迁移记录。
复查：`egress` schema 0、该模块迁移记录 0、`egress-blocked` 告警 0、总 schema 20、总迁移 103；重启 cs-api／cs-controller 后迁移数仍 103、schema 未被重建。

**门禁**：完整 `bun run check`（带 `CS_TEST_DATABASE_URL=…@127.0.0.1:59561/…` 与 `CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin`）**2069 pass／8 skip／0 fail**，13034 断言、347 文件；改动行防护 **100／100（100%）**；`arch:check` 53 个单元（原 54）零违规。
实现提交 `5a51d38` 的 [CI 35710784089](https://github.com/wangbinquan/CrewStation/actions/runs/35710784089) 六项全部成功（含 `gate` 与 `e2e`）。
迁移锁按 `testing.md` §7 的手工例外删掉 egress 四条并在提交说明写明原因；结构后果见 ADR-0008，仓库结构升 v0.5（模块 19→18）；基线三件套回填 v0.3.7（R52／D47 出站部分／T4.12／AT-51 作废，新增 D54，Q23 与 E23 关闭，I9 关闭）。

**第一次推送五个作业全红**，原因与实现无关：删模块只改了 `package.json`，没重跑 `bun install`，
`bun.lock` 里还留着 `@crewstation/module-egress`，CI 的 `--frozen-lockfile` 在装依赖这一步就失败。
本机不带这个开关所以一路绿。修复在 `5a51d38`，判据已写进 `dev-gotchas.md` 工具链一节。

**两点如实记录**：

- **EG-04 未闭环**。以真实管理员身份对参考代理发起发布（202，v0.1.3，SHA `7dee80b`），平台校验拒绝：仓库里的 `crewstation.yaml` 还是 Manifest v1。本仓那份早已是 v2，但 10 天前建仓写进 GitLab 的没随 RFC-013 迁移，两个内置接入项目都发不出新版本。这是既有缺口，记为 **I23**，不在本 RFC 内顺手改（要填该项目实际的套餐与配置定义 UUID，是产品决定）。集群里跑的 v0.1.2 会一直打到 404，直到 I23 有结论。
- **三处既有 flake**，都在本次未改动的文件里、单跑均通过：`releaseDelivery.test.tsx`「并列真实部署与完整 SHA」、`agentExecutionStreams.test.tsx`「执行环境准备中写明排队或调度原因」，以及 e2e 的 `clusterMetrics` 历史新鲜度（RFC-015 范围，在本次部署之前的旧镜像上同样红过）。

## 开发会话页左栏与其他页签同宽（2026-09-22）

作者实机反馈「开发会话页面的左侧栏宽度和其他页签不一样了」。确有其事，而且写在设计里：RFC-003 设计附件 §6 定了「桌面全局导航约 208px，开发模式约 156px」，`AppShell` 于是在路径以 `/dev-session` 结尾时挂 `compactShell`，把 `--cs-nav-width` 改写成 156px，进出开发会话整条左栏跳一下。顺带查出同一判断的另一半：只有**精确** `/dev-session` 才窄，子页「历史对话」仍是 208px，开发区内部同样在跳。

作者裁定统一成 208px。`compactShell` 连同那条 CSS 规则删除，左栏宽度只剩 tokens 一个来源；开发页的密度只留在正文（`compact` 仍是 8–12px 内边距并去掉最大宽度），终端照旧占满内容区，只少 52px。开发会话内各面板都是 `min-width: 0` 的流式布局，少这 52px 不改变任何窗格的下限。RFC-003 §6 已按裁定改写并注明 2026-09-22。

回归写在 `projectNavigation.test.tsx`：概览 → 开发会话 → 历史对话三处外壳类名必须一致、正文仍带 `compact`，并断言全部 CSS 里 `--cs-nav-width` 只有 `app/theme/tokens.css` 一处声明（为此给 `sourceScan.ts` 加了 `consoleStyles()`）。两半都做了去掉修复即失败的验证：把 `compactShell` 加回去红在「`shell` 对 `shell compactShell`」，只留 CSS 规则则红在声明来源多出一处。

完整 `bun run check` 通过：**2081 pass／8 skip／0 fail**，13189 assertions、350 个文件；`test:patch --base origin/main` 判定本次没有需要用例防护的新增生产代码。本机 console 已部署 `cs-console:navwidth-20260922` 并 Ready，其余部署未动，无迁移。真实 dev-admin 浏览器核对：概览／开发会话／历史对话／发布与上线四页左栏都是 208px，开发会话正文仍是 `8px 12px`；1280／1024 无横向溢出，390／320 仍是横排导航条且无溢出，英文六项在 208px 内不换行。部署后 e2e 层复跑 **54 pass／1 skip／0 fail**。本机没有可用的运行中开发会话（三个 dev-session Pod 都是 I22 的 `Failed` 残留），终端工作区的实机外观这次没有新证据。

本机环境两点记在这里，省得下一个 session 再查：e2e 层必须带 `CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin`，否则会话停在登录页。~~默认测试库 `cs-dev-pg`（55432）仍是退出状态，模块层用例借运行中的 `cs-rfc013-test-pg`（59561）~~ **（2026-09-22 已订正）默认测试库 `cs-dev-pg` 已恢复，模块层直接用默认 URL，不必再传 `CS_TEST_DATABASE_URL`。** 它此前 exit 1 是 2026-09-20 Docker 磁盘满时崩溃恢复写不下 checkpoint（`No space left on device`）所致，空间回来后 `docker start` 即完成 WAL 重做，数据卷原样保留。实测 `CS_TEST_REQUIRE=database bun run test:module` **1106 pass／7 skip／0 fail**（189 文件，142s），7 个跳过全是 `prometheus` 能力，需 `CS_TEST_PROMETHEUS_BIN`／`CS_TEST_PROMTOOL_BIN`。本轮第一次 check 的 26 个红由缺 e2e 参数与测试库不可达造成，另一条 `pollingVisibility` 单跑通过，记为既有 flake。

## 新建项目的开发容器连内置 MCP 报 403，归档项目的路由删不掉（2026-09-22）

作者反馈开发容器调内置 MCP 报 403。本机复现：在 `cs-demo` 里起一个带 `crewstation.io/workload=dev-session` 标签、项目名未登记的 Pod，`POST http://mcp-capabilities.svc.cs.internal/mcp` 得到 403「不能调用平台端点 mcp-capabilities.svc.cs.internal」；同一个 Pod 换成已登记身份是 200。网络层没有问题：任务容器的 NetworkPolicy 出向全放行，CoreDNS 的 `*.svc.cs.internal` 改写也在。

根因是放行表的重建触发点漏了一整类：它是「当前在册服务」的投影，而只有授权变更、能力目录变更和管理员手动「重算」会触发重建，**建项目一个都不触发**，`project.created` 只重算了该服务的路由。新项目的服务于是根本不在表里，两个内置 MCP 与平台 API 全被拒，要等某次无关的授权／目录变更才顺带被带上。排查中翻出对称的另一半：组合根把网关要的三件事都接在已滤掉归档项目的 `listServices()` 上，而归档先于事件落库，消费者跑到时按 projectId 与按 serviceId 都查不到，`removeService` 一进门就 return——**归档项目的 IngressRoute 原样留在集群里继续对外服务**，而工作台上它已经「冻结访问」。

两处都已修：`project.created` / `project.archived` 补 `rebuildAllowlist()`；`ServiceDirectory` 的两个方法取值范围分开写进契约（`listServices` 不含归档，`getService` 解析任一服务并带 `archived` 标记），组合根改走 `resolveServiceById` / `resolveServiceOfProject`，`reconcileService` 见到归档服务不再规划路由。回归主力放在 `modules/platform/tests/gatewayCatalogRoutes.test.ts`：两个缺陷都长在组合根里，网关模块自己的用例用的是夹具目录，看不见。逐项确认过红——去掉全部修复红在「建项目后 MCP 仍不可达」，只把解析范围改回「在册服务」红在「归档后 IngressRoute 还在」。

完整 `bun run check` 通过：**2080 pass／8 skip／0 fail**，13177 assertions、350 个文件。（另有一次跑出现 2 红，都在 release 模块「其他发布进行中…阻止切换」那条时序用例上，单独跑 module 层与随后两次完整 check 均 0 fail，本次未改 release，记为既有 flake。）

本机集群已部署 `cs-control-plane:allowlist-20260922`，七个平台部署（cs-api／cs-auth／cs-controller／cs-session／cs-events／mcp-capabilities／mcp-operations）全部 Ready，本次没有迁移；`crewstation-dev-auth` 仍在 `:dev`，未动。实机验收用一次性项目 `mcp-403-verify` 走完整条链：建项目后 **2 秒内放行表 v40→v41**、新条目带 `mcpCapabilities`／`mcpOperations`，在 `cs-mcp-403-verify` 里起的 dev-session 标签 Pod 对两个 MCP 都是 **200**；归档后 **1 秒内 v43 条目消失**，命名空间里三条 IngressRoute 全部被删。部署后 e2e 层复跑 **54 pass／1 skip／0 fail**。三个探针 Pod 已删除、身份索引行均已标记删除；节点磁盘 35%。

验收项目 `mcp-403-verify` 随后整体清除：GitLab 仓库永久删除（延迟删除后再带 `permanently_remove=true`）、命名空间连同 Deployment／Job／Service／Secret／三条 NetworkPolicy／ResourceQuota／三条 IngressRoute 一起删除、生产与开发两个库及两个同名角色 DROP、仓库 manifest 与节点镜像清除、17 行平台元数据（17 张表）在一个事务内按 `projectId`／`serviceId` 精确删除，最后重算网关：放行表 v45 共 11 条、路由 43 条 11 个服务，库里与集群里都查不到 `mcp-403` 任何痕迹。**这一整套只能手工做**：平台没有「删除项目」这一操作，归档按设计只冻结访问、不回收任何资源——残留清理缺口现在有了一份完整的手工拆除清单为证。

两条判据记进 `dev-gotchas.md`：派生文档的重建触发点要覆盖输入集合的每一次增删，不只是格式升级；一个「已过滤」的清单不能同时当解析器用。实现见 `259f6c0`。

## 项目导航归属与概览快捷入口修正（2026-09-21）

作者实机反馈项目侧栏多了一套折叠的平台管理菜单、返回后选中能力接入，以及概览底部四个入口样式松散。已按裁定修订 RFC-003 §2.7：接入项目侧栏只保留项目页面和“返回项目管理”，返回统一进入 `/admin/projects` 并选中项目管理；管理员在数字人／接入项目点击顶栏“平台管理”也返回该目录，项目不存在时正文返回入口一致。能力接入自己的列表与旧链接继续可用。

概览底部集中为“项目快捷入口”卡片，四项均为整块可点击的原生链接，含简短用途与方向标识；桌面四列、中屏两列、窄屏单列，中英文齐全。复用项目作用域与原有分类参数，发布、成员、仓库和 API 资源均实际导航到当前项目对应页面。

本机 console 已部署 `cs-console:project-nav-20260921` 并 Ready。真实 dev-admin 浏览器验证了接入项目的侧栏／顶栏返回、数字人顶栏返回、四个快捷入口、键盘 Enter 与 2px 焦点环；1280／900／320px 与英文窄屏没有横向溢出，结束恢复中文与默认视口。相关 66 项前端回归、针对性 lint 与前端类型检查通过。

完整 `bun run check`（要求真实数据库与本机端到端环境）通过：**2077 pass／8 skip／0 fail**，13169 assertions、350 个文件；新增可执行行覆盖 **43／43（100%）**。跳过项来自既有环境闸门：非管理员前台、可选 Kubernetes 证书、原生 CLI／Linux 进程与隔离 Prometheus 专项；本次没有修改后端、契约或迁移。

## RFC-017 项目资源配置与共享规格模板已 Done（2026-09-21）

作者提出服务套餐和任务容器套餐属于项目资源管控，并在确认两层方案后要求“改”。已将两类套餐收进 **项目管理 → 资源规格模板**，原菜单地址保留跳转；项目目录的“资源配置”集中服务范围、Agent／开发容器、任务并发配额和读取时占用，各卡片独立保存、重读和保护草稿。

服务范围默认继承全部模板，可按项目分配或设为空；真实发布在数据库迁移前及部署前两次核对。服务政策按 revision 保存，配额按旧值比较更新；已有运行实例和旧版本切流行为保留。能力说明按项目过滤推荐规格。

本机 `docker-desktop` 已更新四项：cs-api／cs-controller／mcp-capabilities 为 `cs-control-plane:rfc017-20260921`，console 为 `cs-console:rfc017-20260921`，全部 Ready；05:12Z 的专用迁移 Job 仅应用 `project/0011_service_plan_policies.sql`。真实 dev-admin 页面、项目 API、1280／320px 和模板双语核对通过，没有修改已有项目的资源配置。

分层回归覆盖空清单、项目隔离、并发冲突、配额边界、读取错误和跨卡草稿。发布前两处校验均做去掉修复即失败的变异验证。完整门禁 **2072 pass／8 skip／0 fail**，13131 assertions；新增可执行行覆盖 391／391。实现 `38d1f3a` 与测试修复 `9d6ee70` 已上库；[CI 35564949555](https://github.com/wangbinquan/CrewStation/actions/runs/35564949555) 六项全部成功，T1–T6／PR-01…PR-10 已完成，见 [RFC-017 实施与验证](proposal/rfc/RFC-017-project-resource-management/plan.md)。本次另修一处网关重建测试的固定日期夹具，使新文档与评估时钟一致，避免两小时后自发变红。

## 扩盘、登录恢复与残留清理（2026-09-21 04:30–05:10Z）

作者问「为什么只有 5G 存储，能不能扩到 50G」。查清不是配额：kind 节点的 `/` 就是 Docker Desktop 那块虚拟盘（`DiskSizeMiB=122070`≈119GiB），107G 已用、剩 4.2G，被本机所有 Docker 内容共用。最大单项是**一个 34.39GB 的孤儿卷**：PG17 数据目录，`postmaster.pid` 停在 8-31 01:46、`pg_control` 最后写 9-3 15:32、无任何容器引用，按命名与时间推断是 agent-workflow 某个已删容器留下的。

作者逐项批准后执行：删孤儿卷、清构建缓存 2.585GB、删三个两年前的 kubeflow 大镜像与 20 个月前的 playwright、删 19 个 CrewStation 旧标签（每类留 `:dev` 加一个「上一步」回退源 `cs-control-plane:gateway-heal-20260921`／`cs-console:polling-20260921`，docker 侧标签是重新 `ctr import` 回节点的唯一来源）。**节点 `/` 从 4.2G 可用变成 49G**。随后按作者要求把 `DiskSizeMiB` 改到 204800 并重启 Docker Desktop（先退出再改，防止退出时覆盖设置；原文件备份为 `settings-store.json.bak-20260921-polling`）：**节点 `/` 现为 197G，可用 124G**；Mac 剩余空间同时从 176GiB 回到 220GiB。重启后 GitLab 三件套与 kind 相关容器自动回来，重启策略为 `no` 的四个（`cs-rfc013-test-pg`、`aw-pg-w57`、`aw-pg-ac6b`、`aw-rfc359-pg`）由我 `docker start` 拉回。

**Docker Desktop 重启把本机登录打断了，原因是个已知雷的第二次触发。** 开发登录器每次启动都要先用管理员**密码**登录平台才能注册 Provider 并播种，而库内策略 `identity.auth_login_policy.password_login_enabled` 自 2026-09-20 12:27Z 起是 `f`。它此前一直 Ready 只是因为它一直没重启。作者授权后按 STATE 既有流程恢复：`CS_PASSWORD_LOGIN=force-on` → 重启 cs-auth／cs-api → 让开发登录器重新播种 → 移除开关 → 再重启两个服务。恢复过程中发现两件事：

- 直接重启开发登录器**必失败**：新 Pod 起来时旧 Pod 还在 Service 端点里（`publishNotReadyAddresses: true`），而每个 Pod 的 OIDC 路由前缀是启动时随机生成的（`/oidc/<随机>`），cs-auth 的 discovery 打到旧 Pod 就是 404，于是 `自动发现失败且没有可用的手工端点`。改为对**当前唯一** Pod 打它自己的 `POST /reseed`（页面上那个「重新准备」按钮的接口）即刻成功。
- 收尾核对：`CS_PASSWORD_LOGIN` 已空、`password_login_enabled` 仍为 `f`、开发登录器 Ready，即并行会话设的策略没有被我改动。

**释放残留**：作者要求把 16 项未释放环境全部释放。实际只完成了三个 Pod（`rfc003-ux`、`rfc003-verify-files`、`rfc003-verify-delivery`，经 `/admin/cluster` 的 inspect→confirm 审计路径，操作记录 `succeeded`）。其余走不通，且不是权限或操作问题，而是产品缺口，已记为 **I22**：`failed` 状态的开发会话既不能被释放接口找到（七个项目全部 404），`/admin/cluster` 的删除又会路由回同一个领域拿到同样的 404，九个 `-work` PVC 的删除能力则被「平台保留此资源；必须通过所属业务流程清理」有意关掉。三个 `development-workspace` Pod 与九个工作卷因此仍在集群里，等作者对 I22 裁定后再动，我没有绕过产品路径直接删 Kubernetes 对象。

顺带修正上一节的一处说法：`crewstation-dev-auth` 现已滚到 `cs-control-plane:dev`（与其他服务一致），不再是 `rfc013-20260921-2`。

## 本机集群整体升到 main（2026-09-21 04:00Z）

作者要求「在本机环境部署最新代码」。此前集群是五个构建拼起来的：cs-api／cs-controller／cs-storage-probe 在 `rfc015-20260921-3`（不含 gateway 放行表自愈修复）、cs-auth 在 `gateway-heal-20260921`、cs-session／cs-events／mcp-\* 在 `rfc013-20260921-4`、console 在 `polling-20260921`，而 `runtimes/task` 今天 09:45（RFC-016 预览进程启停）改过之后没有任何镜像包含它。因此走整套 `./deploy/local/install-platform.sh`（含任务容器镜像重建），退出码 0。

结果：八个平台 Deployment 与 `cs-storage-probe` 全部是同一份 `cs-control-plane:dev`／`cs-console:dev`（源自 `13f3d42`），03:57–03:59Z 起全部 Ready；迁移 Job `crewstation-migrate-dzxtf` 用新镜像跑完；平台底座已推进集群内仓库 `…/crewstation/task-runtime:dev @ sha256:dfa2f246…`。`./deploy/local/verify.sh` 四项全 PASS（A 从集群内仓库拉取、B 两种 Host 路由、C 源 Pod IP 与 `X-Forwarded-For`／`X-Real-Ip` 一致、D ForwardAuth 200／401 分流）。节点根分区从 5.0GB 降到 4.3GB（97%），没有清理任何镜像。`crewstation-dev-auth` 仍留在 `rfc013-20260921-2`：它跑的 `tools/dev-auth` 最后一次改动是 2026-09-20 21:23，早于该镜像构建时间，重滚只会多一次登录中断，没有收益。

两点如实记录，都不是这次部署造成的：

- `seed-catalog.sh` 结尾报 `HTTP 403 用户名密码登录已被管理员关闭，请使用公司身份登录`。本机早已切到 dev-oidc，密码登录关闭，这一步在本机环境注定失败；目录本来就已配置，安装脚本仍以 0 退出。要么给它一条公司身份的路径，要么在本机跳过它。
- cs-session 重启后有 **7 个 taskId 在 `runner protocol mismatch`（`runnerProtocol: 1`）上死循环重连**，四分钟里每个约 430 次。这些是 9-13～9-15 遗留的 RFC-003／RFC-006 验收容器（镜像还是 `cs-task-runtime:rfc003-*`），早于 RFC-006 把 TaskRunner 协议提到 2。证据是它们在我 03:57 部署之前就在循环：`cs-rfc003-verify-workbench/cli-01a0a54a…` 的 runner 日志从 03:30:20Z 起就在反复「session link connected, hello sent」。同时有 5 个协议 2 的 runner 正常连上。处理办法是释放这些已完成的验收会话（会删容器，属于作者的决定，我没有动）。

轮询修复的实机证据见上一节；`cs-console:dev` 与当时核对过的 `polling-20260921` 出自同一份源码（`13f3d42`）。

## 界面定期闪一下、滚动条回顶：轮询改为部分更新（2026-09-21）

作者实机反馈「界面总是定期会闪一下，是不是有自动刷新，刷新了之后滚动条还回到了最上方……就算刷新也是部分更新啊，不能自动触发页面刷新」。
先核实**不是整页刷新**：console 源码里没有 `location.reload`，本机也没有 CrewStation 的 vite（唯一在跑的 vite 属于 agent-workflow），线上是构建产物。
真正的原因是四处轮询把「重取在途」当成「数据不可信」，把内容整块卸载或改写。内容一塌，浏览器就把滚动位置夹回 0，数据回来也没人恢复，于是看着像页面自己刷新了一遍。（滚动容器随视口而定：`AppShell` 用的是 `min-height: 100vh`，视口装不下时 `main` 会长到内容高度、它自己的 `overflow: auto` 不生效，实际滚动的是文档；1728×873 实测 `document.scrollingElement` 就是 `html`。）

- **`/admin/cluster`（30 秒一次，最明显）**：`cluster-management/wiring.ts` 的采集每 30 秒产生新快照，`snapshotId` 进了 `resources`／`detail` 的查询键；前台 15 秒的摘要轮询一拿到新 id，两个查询就都变成新键、`data` 变 undefined，表格和详情一起塌成「载入中」。详情面板还会在 `r?.uid` 重新出现时再次 `panel.focus()`，把滚动又拽到面板。
- **首页／市场（15 秒一次）**：`useMarketQuery` 的 `current` 判据里带 `!query.isFetching`，`MarketPage` 的载入态又是 `isPending || isFetching`，每一轮刷新都把整片卡片网格换成一行「载入中」。这是 RFC-003 implementation 第六批写下的「刷新期间不保留旧授权卡片」。
- **管理总览待办、`/projects` 列表、项目概览（30 秒一次）**：`busy = me.isFetching || query.isFetching` 被用来判断入口能不能点，于是每轮轮询把 `<Link>` 换成纯文本、抽走「下一步」横幅。
- **开发会话的版本比较面板（10 秒一次）**：`isFetching` 同时驱动「重新检查」按钮的文案和「旧结果可能已过期，请重新检查……」这句提示，于是每 10 秒整句提示进出一次、按钮文案在「重新检查」与「更新中…」之间跳。

作者逐项裁定（当面，直接修改并加带日期的修订说明，不另立 RFC）：集群页**自动采纳新快照但原地替换**；首页**保留卡片、原地替换**；三处列表**后台例行重读不改界面**，只有用户点的刷新才暂停入口。版本比较面板是同一轮排查里找到的第四处，按同一条裁定一并改掉（作者未逐项过目，若不同意只需回退这一处）。

实现：`useApiQuery` 新增 `keepPrevious(previousKey)`，除 `snapshotId` 外条件一致时用 `placeholderData` 留住上一份回执（判定在新文件 `features/cluster/model/clusterReads.ts`）；`ClusterPage`／`ClusterDetail` 用它，「下一页」的游标改为跟随该页回执自己的 `snapshotId`（原来跟摘要新读到的快照，翻页时会被服务端判游标不匹配）；`useMarketQuery` 去掉 `!query.isFetching`（失败与撤权仍立即撤下旧卡片，性质不变）；新增 `shared/lib/useManualRefresh.ts`，`useAdminRead` 与 `useProjectSummaries` 的轮询走静默路径、只有手动刷新抬 `refreshing`，`ProjectDirectory`／两张待办卡／`ProjectListPage`／`ProjectOverviewPage`／`TesterProjectPage` 改用它；`useVersionComparison` 同样只在用户点「重新检查」时抬 `refreshing`，过期提示只看 `isError` 与 `freshness === 'stale'`（这两条是真信号）。

用例：三条真实路由回归都做过变异验证（去掉修复即变红，红时页面正是「符合筛选的资源：—」＋「载入中…」）——`clusterManagement.test.tsx` 换快照在途保留列表与详情且是同一批 DOM 节点、`appMarket.test.tsx` 例行刷新在途保留卡片、`adminDirectory.test.tsx` 例行重读不改入口而手动刷新照旧暂停；`versionComparisonView.test.tsx` 例行核验在途不弹过期提示、按钮不跳文案而手动点照旧；另加纯判定用例 `clusterReads.test.ts`。两个 fixture 补了扣回执与换快照的开关。

验证：`arch:check`／lint／两个 typecheck 全过；unit 343、module 788／319 skip、console 556，全部 0 fail。完整 `bun run check` 的 24 个 e2e 红是本机缺 `CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin`（与左栏分组那轮同一批 24 个），带上后 `platformCapabilities` 18 pass／1 skip／0 fail。已提交 `68ac057`（按显式路径，含并行会话当时在 `ClusterPage.tsx`／`ClusterDetail.tsx` 里的在制品，作者同意）与 `9c874b7`。两笔随并行会话 03:44:34Z 的推送一起上了 main（`HEAD == origin/main == a912378`），**该 SHA 的 [CI 35558544351](https://github.com/wangbinquan/CrewStation/actions/runs/35558544351) 六个作业全部成功**——static、unit、module、console、gate（含新增代码防护）、e2e 都是 success；本机那 24 个 e2e 红确系缺环境变量，CI 里 e2e 是绿的。已构建 `cs-console:polling-20260921` 导入节点并 rollout（Recreate，console 短暂不可用）。

**实机证据（无头以外的真实 Chrome，dev-admin，1728×873）**：`/admin/cluster` 滚到 `document.scrollingElement.scrollTop = 900`，页面显示的采集时间从 `2026/9/21 11:38:11` 前进到 `11:42:41`（即确实换过好几轮快照），同时 scrollTop 仍是 900、文档高度 3374 不变、首行 `[data-cluster-resource]` 还是同一个 DOM 节点、全程没有出现「载入中」或「符合筛选的资源：—」。隐藏标签页按设计不轮询（RFC-010 §8），所以这次是用伪造 `visibilityState` ＋ `visibilitychange`／`focus` 事件触发的同一条采纳路径。

## 顺手发现的两个问题一并处理：服务域全被拒、页面崩溃拆掉整个工作台（2026-09-21）

做左栏分组时顺带发现的问题，作者回复「你发现问题就一并处理掉」。两笔修复都是先写能复现的红用例再改。

**服务域调用全部 403（RFC-013 的漏网缺陷，影响面最大）。** 从业务 Pod 里 `fetch('http://api.svc.cs.internal/healthz')` 实测得到 `403 放行表尚未生成`。原因：RFC-013 把放行表的 `identityVersion` 升到 2，读取侧（`modules/gateway/application/allowlist.ts`）把旧文档当作不存在；而重建只由授权／目录变更与手动「重算」触发，升级本身不触发任何一个。本机库里最新一份仍是升级前的 v39（无 `identityVersion`），于是业务调平台 API、开发容器里的 Agent 连 MCP 全部被拒；用户域的浏览器旅程不受影响，RFC-013 的验收因此没撞上。修法：评估侧发现没有当前身份版本的文档就地重建一次——同进程的并发请求合并成一次；推导期间别的进程已写出可用版本就直接用它；两边真的同时落库由主键冲突兜底改用赢家那份；重建彻底失败仍按原语义拒绝并记 error，下次评估再试。管理页的读取保持纯读取，不因为有人打开页面就写库。全新安装「一份都没有」走同一条路。用例：就近的方法级 UT 7 条（内存仓库，确定性覆盖抢占与失败路径），模块级 1 条（真实 PostgreSQL，两个新模块实例同时评估）。

**网关页遇到格式不合的响应会把整个工作台拆掉。** `GatewaySection` 直接 `allowlist.data?.entries.length`，响应缺 `entries` 就在渲染期抛错；工作台又没有任何路由级错误边界（TanStack Router 只给声明了 `errorComponent` 的路由装边界），顶栏、左栏连同页面一起被库自带的英文 “Something went wrong!” 顶掉。修了两层：网关页两个响应先过形状检查（`features/admin/model/gatewayStatus.ts`），同组件里另两处同类问题一并修掉（路由条目缺 `target` 同样会崩；放行表读取失败时不报错还显示伪造的「0 条」）；`router.ts` 配 `defaultErrorComponent: RouteErrorPanel`，一页出错只换掉那一页，`renderApp` 同步配了同一项。网关页此前一条专门用例都没有，补 8 条；错误边界 4 条，含一条「不配时整个外壳都没了」的对照。已用线上真实响应核过形状检查不会误伤：11 个服务 43 条路由全部通过。

**线上已用这笔修复本身恢复，并留了前后对照。** 只滚动做服务域判定的 `cs-auth` 一个部署到 `cs-control-plane:gateway-heal-20260921`（构建时工作树里后端没有任何未提交改动，镜像即 `a841e83` 的后端；上一版 `cs-control-plane:rfc013-20260921-4` 保留可回退），其余六个控制面部署没动。同一个业务 Pod（`cs-demo/demo-blue`）同一次调用：修复前 `403 放行表尚未生成`，修复后 `200 {"ok":true,"service":"cs-api"}`；库里多出 v40（`identityVersion` 2、11 个调用方，生成于重启后的第一个服务域请求），`cs-auth` 日志有一条 warn `allowlist rebuilt on demand`。判定没有因此变松：未登记的 `test-gitlab:GET:/v4/users` 仍被 403 并给出精确原因。节点磁盘导入后余 5.1GB（96%）。console 的两处修复没有单独部署——工作树里有另一个会话未提交的 console 在制品，不想替它带上集群；下一次 console 部署会自然带上。

**CI。** `a841e83` 的 [run 35557168622](https://github.com/wangbinquan/CrewStation/actions/runs/35557168622) 五层用例全绿，`gate` 红：新增代码防护报「`app/router/router.ts` 有可执行逻辑，但没有任何用例加载它」——我对它只做了源码文本断言，那不算加载。已把断言换成真正 import 生产路由器核对 `defaultErrorComponent`，并在本机按 `be60d47` 基线预跑 `test:patch` 通过（119／120 行，99.2%）。修正提交 `56a5a0a` 的 [run 35557939893](https://github.com/wangbinquan/CrewStation/actions/runs/35557939893) 六个作业全部成功；推送后 `HEAD == origin/main == 56a5a0a`。

两条教训已落进 `dev-gotchas.md`（契约变更、前端与测试两节）。模块用例本机借用正在运行的 `cs-rfc013-test-pg`（`CS_TEST_DATABASE_URL=…@127.0.0.1:63764/…`，每条用例自建自删独立库）：gateway／identity／platform／api-catalog 共 169 pass／0 fail；默认的 `cs-dev-pg`（55432）13 小时前已退出，没有去动它。

## 管理左栏分组树调整（2026-09-21）

作者反馈「平台管理界面左侧功能的树形归属：呈现类也在配置里，使用起来很别扭」。核对确认：RFC-003 proposal §4 的「平台设置」后来又挂进了认证（RFC-014）与集群管理（RFC-010），八项里有两项不是配置——集群管理是资源清单、容量与运行实例操作，网关（`GatewaySection.tsx`）只有推导出来的路由表／放行表和一个「重算」。

作者分两轮逐项裁定：新增「运行与观测」收集群管理、网关；「平台设置」拆成「身份与访问」（用户与权限、认证）与「资源与网络」（算力档位、两类套餐、出站白名单），该组名不再出现；组序为 待处理（无标题）→ 运行与观测 → 供给与接入 → 身份与访问 → 资源与网络；总览入口卡片按同样四组带标题显示并补上此前缺的认证、集群管理，去掉「申请审批」卡片（同页上方「待处理事项」已承担）；流程上**直接修改、在 RFC-003 proposal §4 加带日期的修订说明，不另立 RFC**。URL、权限与各页内容都不变。

分组树只有一份定义 `apps/console/src/shared/admin/adminNavigation.ts`，`AdminNav.tsx` 与 `AdminOverviewCards.tsx` 共用，不会再各自漂移。新增 `adminNavigation.test.tsx` 锁分组、组序、组内顺序、接入项目内折叠菜单同树、总览卡片分组与中英文文案键，并做过变异验证（把集群管理挪回配置组，三条变红）；`spaceSeparation.test.ts` 相应改为锁「入口只登记在这份定义里，且只有管理左栏与管理总览读它」。

验证：console 层 537 pass／0 fail；本机完整 `bun run check` 静态全过，非 e2e 三层 0 fail（模块层数据库用例因本机测试库不可达而跳过，以 CI 为准）。该轮 e2e 的 24 个红是我没带本机需要的 `CS_E2E_AUTH=dev-oidc CS_E2E_USERNAME=dev-admin`、会话停在登录页所致；部署后带参数重跑 e2e 层 **51 pass／3 skip／0 fail**（3 个跳过为 `apiInvocation` 需要的 55432 测试库）。真实浏览器（dev-admin）核对：1280px 与同源 iframe 的 390／320px 无整页横向溢出、12 个入口全部在视口内，中英文无裸键，逐项点击后当前页高亮正确，接入项目内折叠的「平台管理」菜单是同一棵树，控制台无报错。

**与并行 RFC-015 的交叉（接手者请看）**：我在 10:33 前后把 console 滚到从共享工作树构建的 `cs-console:admin-nav-20260921`（Recreate，console 短暂不可用；RFC-015 的最终 e2e 若恰在此刻变红，请以此为因重跑）；10:37 RFC-015 会话又滚到它 10:34 构建的 `cs-console:rfc015-20260921-2`，该镜像同样出自共享工作树、已包含本次左栏改动（线上 `index-CseL2141.js` 实测分组正确），所以我没有再覆盖它。部署前节点 `/` 只剩 748MB（100%，PostgreSQL 此前已因此重启过一次），按 dev-gotchas 的做法只删除了 24 个**无标签且未被任何容器引用**的悬空镜像与 `import-2026-09-15` 残留，未动任何带标签的回退镜像、卷、构建缓存和带仓库摘要名的镜像；回收后余 5.7GB（95%）。

**最终 CI：实现提交 `4d4414a` 的 [run 35554919408](https://github.com/wangbinquan/CrewStation/actions/runs/35554919408) 六个作业全部成功**——unit 319、module 1078／8 skip、console 532（较上一笔多出本次新增的 6 条）、e2e 32／18 skip，全部 0 fail；`gate` 的新增代码防护通过。推送后 `HEAD == origin/main == 4d4414a520f9757d92b958eed19f69c86e2370d4`。本机 console 层的 537 比 CI 多 5 条，是并行 RFC-015 未提交的 `clusterMetrics.test.tsx`。

## RFC-016 开发会话预览进程的自主启停与调试（2026-09-21）

意图 Agent 改坏预览后此前没有任何修复或诊断手段：Runner 早有 `restartPreview`、工作台经 WS 在用，但 cs-api 一条预览路由都没有，MCP 够不到；`previewStatus` 的 `restarts`／`lastError` 在 `sessionLifecycle.ts` 被丢弃，Agent 只看得到一个光秃秃的 `crashed`；预览输出只混在 Pod 日志里。

作者当面裁定三处取舍：重启之外**加停止／启动**、调试靠**预览输出环形缓冲**、控制统一走 cs-api 且**工作台一并迁过来**。三件套在 `proposal/rfc/RFC-016-preview-process-control/`。

T1–T9 已落地并推送：Runner 新增 `startPreview`／`stopPreview`／`previewLogs`，用 hello 的 `previewControl: 1` 能力位协商而**不升协议版本**（升版会让集群里正跑的旧镜像容器握手即被拒，等于强制所有人释放会话）；`previewOutputBuffer.ts` 双上限 2000 行／256 KiB、按字节截断单行、跨重启保留；三条 cs-api 路由（控制是参数化的一条）；操作 MCP 新增 `previewTools.ts` 三个工具；工作台命令迁 REST 而事件订阅不动，实时性不变。

实现中推翻了三处初版设计，已回填 design.md：`attempt` 不能复用 `restarts`（`restart()` 会清零，那样重启前后的行都标 1，缓冲跨重启保留就白做了，故另立永不清零的 `runs`）；缓冲**不做脱敏**（`CS_RUNNER_TOKEN`／`CS_SESSION_URL` 已由 `buildChildEnv` 从所有子进程环境剔除，余下是项目自己的配置，读者本就能在同容器终端读到）；`asPreviewStatusResult` 是死代码而非事件路径仍需要，已删。

**最终 CI：`55187d0` 的 [run 35552484798](https://github.com/wangbinquan/CrewStation/actions/runs/35552484798) 六个作业全部成功**——unit 319、module 1078／8 skip、console 526、e2e 32／18 skip，全部 0 fail。途中两次红都是本次改动自己的问题：`7e40104` 的 `gate` 报「`PreviewPane.tsx` 有可执行逻辑但没有任何用例加载它」（查证确认它自 `58ea7cd` 起全仓零引用，已删，并补了三条预览路由的 HTTP 用例；改动行覆盖 288／292＝98.6% 本身达标）；`0a3c169` 的 `static` 报删函数后遗留的未使用导入。两条教训都已落进 `development-rules.md`：目录级 pathspec 会让 `git commit` 扫进别人的工作树改动；并行在制品刷红本机门禁时要按改动文件单独 `eslint`。

实现中发现的设计缺口记为 **I21**：RFC-006 之后 Agent 跑在自己的执行 Pod 里，`127.0.0.1:<预览端口>` 到不了预览进程，用户域主机又有 ForwardAuth，于是 Agent 能把预览救活、能读它的输出，却没法验证「改完之后页面真的对了」。工具描述已按事实写明，三个选项待作者裁定。

**实机验收 PV-01…PV-18 未执行**，需要本机集群上的真实开发会话；而本机部署会把并行 RFC-015 未提交且编译不过的在制品一起推上集群，故本轮不做，等其落地后再补。同因并行在制品，本轮没有跑通完整 `bun run check`：`arch:check` 通过，`lint`／`typecheck` 的报错全部落在 `apps/console/src/features/cluster/`、`modules/cluster-management/`、`packages/filesystem-metrics/`、`apps/cs-storage-probe/`。

## RFC-015 集群容量、用量与七天趋势已 Done（2026-09-21）

作者追加三项要求：存储申请／实际使用、Pod 容器及对应资源申请／节点、全局节点与全部关键容量／实时 CPU／存储／网络等；随后明确选择“同时保留最近 7 天趋势”。三件套、audit 与 acceptance 位于 `proposal/rfc/RFC-015-cluster-resource-observability/`，T1–T12／RO-01…RO-29 已完成，索引 Done。现有 RFC-010 的 Done 状态不变；本轮容量、用量、七天趋势的实现、部署、本机验收与精确 SHA CI 均已完成。

实机 1 节点，Summary 可读 CPU／内存／网络／节点文件系统，cAdvisor 有设备 I/O 计数；12 个 local-path PVC 没有 pvcRef 卷统计。方案包含全集群只读容量＋受管分项、结构化容器／PVC 资源表、kubelet 采集、固定卷根只读 probe 及内部 Prometheus 的七天趋势。历史断档、同名新 UID、已删除对象、峰值和保留边界均列入 RO-01…RO-29 验收。观测时节点仅约 1.15GiB 可用，后续部署必须重新盘点指标卷的实际容量，不能因 PVC 申请成功就当已扩容。

作者已明确回复“批准实施、部署、提交上库”，RO-D1…D4、七天趋势、节点读取／proxy、只读卷采集器及内部指标存储部署均获批。下拉框与历史会话测试已由原任务提交；本任务保留其输出，按精确路径发布。

已部署 cs-api／controller／只读 probe `cs-control-plane:rfc015-20260921-3`、console `cs-console:rfc015-20260921-2` 和内部 Prometheus 3.13.3（8 天内部保留、对外最近 7 天；真实 CPU 数据起点 2026-09-21 10:12:14 Asia/Shanghai）。专用 PVC 的 2,101,248 字节与节点 du 一致，卸载后用量保持；三档宽度、双语／主题、键盘共 12 组实机检查通过。真实 TSDB 七天／清理／归属变化／重启用例通过。最终完整 check **2029 pass／5 skip／0 fail，12863 assertions，343 文件，343.84s**；候选代码哈希与开跑时一致，本地改动行防护 **1219／1232 = 98.9%**，所有新生产文件有用例加载。

实现 **`3266e75f1704f4c0bc5ab8950abd936e8a814b03`** 已上库；共享 main 随后包含管理导航状态记录，实际推送并验证的 SHA 为 **`f5f42adfdc3315e8de8b0583409fb636bebcd5fc`**，包含完整实现。[CI 35555330886](https://github.com/wangbinquan/CrewStation/actions/runs/35555330886) 六项全部成功：unit 336、module 1098／8 skip、console 538、e2e 36／18 skip，全部 0 fail；新增代码防护 1219／1233（98.9%）。新增实机四项与真实 Prometheus 三项均在 hosted 环境执行通过。推送后核实本地与远端同步；本次只做文档结项，详见 RFC-015 acceptance.md。

镜像导入期间节点物理盘短暂耗尽，PostgreSQL 重启后已恢复。仅删除本轮首个候选镜像、零副本控制器修订和精确构建缓存，保留全部既有回退镜像与业务卷；本轮精确清理后余量约 768MiB，随后共享环境释放空间，最终复核约 **5.6GiB** 可用。指标 PVC 申请 10Gi 不代表已扩充底层磁盘。

## 下拉框统一外观（2026-09-21）

按作者「所有下拉框统一修改」要求，在 `shared/ui/selection/Select.css` 集中覆盖工作台 31 个文件的 47 处下拉及嵌入 API 文档的单选下拉：主题边框、箭头、菜单圆角／阴影、选中勾选、禁用／错误／焦点状态、长列表滚动与视口边缘翻转。页面原生表单与键盘语义保留，开发工作台维持 28px、列表筛选维持 32px 的紧凑高度。支持 `appearance: base-select` 的浏览器同时定制展开面板；不支持时入口采用统一样式，选项面板仍由系统绘制。

新增 `tests/e2e/selectAppearance.test.ts`，在独立浏览器上下文装载生产样式，不依赖登录／业务数据；1280／390／320px、明暗主题、鼠标／键盘、必填与禁用、80 项滚动、底部翻转和渐进降级共 **8 pass／0 fail，86 assertions**。首次完整检查为 **1599 pass／331 skip／21 fail**：20 项部署登录／页面 E2E 失败、1 项历史链接异步断言失败；测试数据库不可用，相关模块用例跳过。该轮日志 `/private/tmp/crewstation-select-check.log`，未冒记完整通过。

作者随后要求「部署并提交上库」。控制台镜像 `cs-console:select-style-20260921` 已部署到本机 `docker-desktop`／`crewstation-system`，滚动更新完成、Ready **1／1**。真实管理员项目目录在 1280px 浅色、390px 深色及 320px 浅色下菜单正常、筛选控件保持 32px、无整页横向溢出或控制台异常；服务返回的 CSS 为 HTTP 200，SHA-256 与本次生产构建一致。截图与结果在 `/private/tmp/cs-select-evidence/`、`/private/tmp/cs-select-live-result.json`。

历史链接用例已用受控名册回执稳定复现原失败，改为等待实际名册加载完成后断言，不修改业务行为；相关 **10 pass／0 fail，98 assertions**。登录服务恢复后使用已有 `dev-admin` 的 OIDC 登录及独立测试 PostgreSQL 补齐完整检查，不改登录策略或用户角色。并行 RFC-013 文档提交已保留，代码候选哈希未变。

最终完整 `bun run check` 通过：**1946 pass／5 skip／0 fail，12263 assertions，327 文件，319.72s**；静态检查与工作台生产构建通过。5 项跳过为非管理员身份、显式集群能力与原生 CLI 环境相关用例。日志 `/private/tmp/cs-select-release-check.log`，代码／测试候选哈希 `/private/tmp/cs-select-candidate.json`；按 9 个相关文件精确提交，推送后继续核对最终 SHA 的 `gate` 与 `e2e`。

## RFC 状态

**RFC-003 工作台 UX 重设计已 Done（2026-09-16）：52／52 项 UX-AT 全部实机通过，本地 gate 与精确 SHA CI 通过。RFC-004（管理员定义 Agent 启动前 Hook）已按 RFC-006 的裁定 C8 置为 Superseded，其 AR 实机验收不再执行。** RFC-001 与 RFC-002 都已 Done，见 `proposal/rfc/README.md` 的索引表。**RFC-005（OIDC／OAuth 2.0 公司登录）于 2026-09-18 落档、同日按作者会话目标「完整实现整个RFC并提交上库」实施完毕并实机验收，已 Done。** **RFC-006（算力档位合并运行环境）2026-09-18 落档，同日作者设定会话目标「完整实现RFC并提交上库」，同日实施完成并 Done：CP-01…CP-22 实机核对完毕，基线三件套回填到 v0.3.4，见下方接力。** **RFC-007 于 2026-09-20 完成 T1–T8，本机 Chrome 四角色、旧页签恢复、本地 gate 与精确 SHA CI 全部通过，已 Done。**

## RFC-014 用户与权限、认证 UX 已 Done（2026-09-21）

T1–T8 完成：紧凑用户目录、按需角色编辑与冲突恢复、认证双标签、四组接入配置及逐字段验证、结构化连接诊断、身份字段与项目覆盖均已实现。真实 API、五档宽度、双语／主题及键盘证据见 `proposal/rfc/RFC-014-identity-admin-ux/acceptance.md`；角色权限写入等组件证据与本机实操的边界保持明确。

作者批准 RFC-013 与 RFC-014 一并上库，联合 650 个路径的实现为 `73aa132`，保留所有共享输出。最终定向 44 pass／0 fail，完整共享候选 1937 pass／5 skip／0 fail，生产改动行覆盖 2887／2965（97.4%）。首轮云端 e2e 发现旧布局断言，已实机复现并以 `a1b87a1` 修正，保留间距／尺寸／溢出防护并新增 320px。

最终 [CI 35543847392](https://github.com/wangbinquan/CrewStation/actions/runs/35543847392) 的六个作业全部成功；unit／module／console 为 1893 pass／8 skip／0 fail，e2e 为 24 pass／18 skip／0 fail。精确发布后 `main == origin/main == a1b87a12dd9ebe494e4af2a1a0b37b9641b83654`，工作树与 index 为空。随后仅回填本节与 RFC 文档，不改生产代码。本轮没有部署本机，RFC-013 的实际数据库切换及升级后验收仍未完成。

## 最新设计：资源统一 UUIDv7（2026-09-20）

作者要求所有资源索引统一为长 UUID，并在澄清后明确选择「标准 UUIDv7：36 字符、带连字符，名称只作展示属性」。已完成当前源码核对与 `proposal/rfc/RFC-013-resource-uuid/` 的 proposal／design／plan 和 audit，索引登记为 In Progress；**作者已批准实施、部署及提交上库**。UUIDv7 生成／校验、事务迁移、各资源目录、Runner 和业务协议兼容已实现，旧夹具、模板和两把锁已补齐；候选完整门禁与旧库副本升级通过。作者已授权本任务与 RFC-014 联合发布，实际部署仍未进行。T1–T12 完成，T13–T14 按下方验收记录继续收口。

已核实：多数实体是前缀加完整 32 hex UUID；套餐／算力／API／事件仍用名称或组合键，配置／凭据含名称复合键，模板按目录名，启动步骤有短 ID。还发现旧 CLI 重启使用相同哈希后缀拼不同类型 ID，不能简单去前缀。方案按类型建立旧到新映射，覆盖数据库／JSON／历史引用投影／API／前端／Runner，保留物理卷与外部协议标识。agent-workflow 的四类参照资源实际使用 ULID，已只读核对，没有写入该仓库。

2026-09-21：跨模块升级基准用例与协议 2 Runner、旧登录/MCP 令牌、并发重试定向通过；本机原库已只读备份并恢复到专用副本，正在演练真实历史迁移，原库未动。发现退役档位和历史刷新任务需保留独立身份，正在补映射。最终完整 gate、实际部署和精确 SHA 发布验收尚未开始；迁移／契约锁尚未更新。共享 RFC-014 的所有输出保留；配置 i18n 的本任务插入错误已修复。 升级演练曾耗尽 Docker 数据分区，导致 PostgreSQL 与依赖服务重启；已仅回收六个未使用的旧 CrewStation 构建镜像、删除本任务演练库，原库未执行 UUID 迁移，全部原服务恢复 Ready。后续演练与测试改用宿主机独立目录的专用 PostgreSQL，保留原备份；实际部署前必须检查数据库所在分区容量。

## 最新设计：三类平台角色与使用者首页（2026-09-20）

作者要求默认首页只面向应用使用，市场卡片不带项目编辑入口；系统划分用户／开发者／管理员。
已明确：管理员包含开发者能力；开发者自建后自动为负责人；试用成员在首页看到未发布应用并试用，卡片标 **Beta**。
作者另询问全局 Agent 动态用途，要求无用则删；方案删除全局入口和通知层，保留开发会话内已有 CLI 状态与待处理提示。

作者已于 2026-09-20 明确批准实施完整 RFC 并提交上库。三类平台角色、一次性旧账号回填、管理员角色编辑、最新角色与项目关系联合授权、开发者自建和默认资源校验、负责人失败恢复、市场 Beta 试用、三空间布局与守卫已实现；HTTP／CLI／WS 既有连接重新授权，权限失败期间保留已输入草稿但停止技术操作。全局 Agent 动态与跨空间后台轮询已移除。

真实验收：三类账号均默认市场；普通用户直达创建被拒；开发者只见获授权项目。`dev-developer` 自建专用项目 `prj_01a0be892ee2700090acb2428fab3c16`／`rfc011-role-home`，服务器已开通，创建者为 owner，首版 `v0.1.0` 预览就绪；owner 添加 `dev-tester` 成功，后者从首页 Beta 卡片打开真实应用，网关注入其本人身份。旧 tester 项目链接转应用详情。1280／390／320px、中英文、明暗配色与键盘主要路径已核对，未见页面横向溢出。

基线三件套已随共享回填至 v0.3.6。最终完整 check＋覆盖率通过：1864 pass／5 skip／0 fail，10304 assertions；历史 Agent 流测试已通过受控复现修正等待条件，测试库磁盘不足导致的无效轮次另行记录。新增代码防护为 2495／2526 行（98.77%），所有 251 个变更生产文件被用例加载；366 个共享生产／测试候选文件哈希与通过门禁的快照一致。console build 通过，实现提交 `b3d8d0e` 已推上 main；发布提交 `da4f437` 的 [CI 35509904421](https://github.com/wangbinquan/CrewStation/actions/runs/35509904421) 六个作业全部成功。远端 e2e 23 pass／18 skip／0 fail，跳过的项目与非管理员场景不代替本机真实证据。独立详细记录见 `proposal/rfc/RFC-011-role-based-home/acceptance.md`。

自动审批拒绝把专用测试账号 `dev-member` 从用户临时升为开发者，认为功能实施授权不包含具体账号授予；已向作者询问，尚未执行，也未从其他接口绕过。角色编辑的 CAS／最后管理员／负责人降级与竞态均有真实数据库和组件测试；不能将这项待授权的实机写操作记为通过。并行 RFC-010 的集群 RBAC 扩权也未代为执行，仍由该任务处理具体授权。

作者随后要求首页只自动刷新：已删除首页右上角“重新检查”，复用既有前台每 15 秒、重新进入和窗口聚焦时刷新，失败时保留重试；中英文空态说明列表自动更新。追加候选完整检查 1864 pass／5 skip／0 fail（254.66s），本次三个生产文件变更行覆盖 3／3；console 镜像 `rfc011-auto-refresh-20260920` 已部署，真实浏览器确认首页只有搜索操作，应用和 Beta 入口正常。

作者又要求优化语言切换外观：已改为地球图标＋当前语言＋下拉箭头的紧凑入口，保留原生键盘操作和中英文辅助名称；默认卡片图标样式保持兼容。镜像 `rfc011-locale-20260920` 已部署；桌面与 390／320px、中英文、明暗配色、方向键与 Enter 往返实机通过。完整检查的首轮失败定位为本机已关闭密码登录而 E2E 仍寻找密码表单，继续使用并行任务补齐的显式 OIDC 登录门禁，未更改平台登录策略。

持续停留又发现首页收到无列表的异常响应时直接崩溃，已补响应检查、双语错误提示与保留搜索输入的重试回归。上一候选镜像 `rfc011-locale-20260920-2` 已部署；定向 27 pass／0 fail，新增可执行行覆盖 13／13。该轮完整检查静态部分通过，1833 pass／4 skip／6 fail／4 errors，失败落在并行变更的 OIDC 测试登录与任务运行时恢复。作者已批准仅发布该候选 10 个文件的本地门禁例外，随后继续要求取消语言下拉框、删除项目列表左侧重复导航，因此尚未提交上一候选。

按追加要求，语言入口现为「中文／EN」两个直接切换按钮，选中状态可见；项目列表、新建与全局 404 不再显示重复全局侧栏，具体项目内保留六项菜单及返回列表。相关回归 57 pass／0 fail，287 assertions；最终 console 镜像 `rfc011-buttons-20260920` 已部署。实机已核对鼠标及 Enter／空格切换、2px 焦点提示、表单草稿保留、项目内外导航。最终完整检查 1874 pass／5 skip／1 fail（250.85s），唯一失败为既有原生状态通道用例预期 403、实得 503，单独复核 6 项通过但不冒记全量绿色；本次变更行覆盖 25／25。按作者已批准的精确发布与 GitHub CI 核验流程收口，其他任务改动保留。

作者继续要求能力市场改为业务卡片、点击直接打开 app 主页并移除应用详情页。已实施：整卡主入口直达正式／未发布 Beta 应用，已发布应用为成员保留独立新版 Beta 链接；删除详情页、负责人等展示，旧详情与 tester 项目链接返回市场。服务端复用同次部署结果投影试用地址，路由切换不再短暂请求 tester 项目摘要。console／cs-api 的 `rfc011-business-cards-20260920` 镜像已部署；真实桌面、320／390／1280px、明暗中文及桌面英文、键盘焦点与旧 URL 跳转已核对，工具不能捕获的外链新标签及 iframe 内英文点击边界如实记于 acceptance。首轮完整检查 1873 pass／5 skip／5 fail，均为旧详情测试夹具未接列表；三处夹具已修正，相关 37 项通过。最终 20 个代码／测试候选的完整检查通过：1878 pass／5 skip／0 fail，10427 assertions、303 文件、323.66s；候选哈希未变，变更行覆盖 37／37。先前语言按钮与导航提交 `71a45c7` 已上库，含它的 `7237ecc` 六项 CI 成功已复核。

## 并行接力：RFC-010 集群资源管理实现（2026-09-20）

作者已批准完整实现、提交上库，并在本次回复中明确批准本机 RBAC；`00-rbac.yaml` 已成功应用。范围仍为 CrewStation 项目和平台内置资源。主体 `b7fb3e5`／`73ad1a0`、共享接线 `b3d8d0e` 与基线 v0.3.6／`da4f437` 已发布，历史六项 CI 通过。

CM-01–24 已完成：248 个来源无错误，完整快照 450 项资源、32 个工作负载、43 个 Pod（39 Running／39 Ready），Kubernetes 实际工作负载及 Pod UID 集合与多页清单完全一致。普通用户 UI／HTTP 拒绝，系统目录和 owner 链正确；日志 current／无 previous／已删除 UID 原因可见。

专用 `rfc010-cluster-qa` 项目实跑发布槽重启、副本跨发布保持／恢复、试用删除后重建与正式槽保护；开发父工作区保卷重启、单 CLI／Agent 隔离、业务任务／子任务的调用方终态、档位测试停止、终态 Job 清理。内置 mcp-operations 重启经协调，新 Pod Ready；finalizer 操作超时后继续核对同一操作成功，同名替换 UID 保留。所有专用任务配额归零，隐藏临时档位停用，持久卷与历史按语义保留。

实机补正三项：档位测试 ID 读取持久化关联；采集独立 worker 避免长操作挡住刷新；业务恢复确认旧 Pod UID 消失后才占配额并重建。106 条生命周期回归和静态检查、生产构建通过。API／controller 已滚动至 `cs-control-plane:rfc010-20260920-4`。真实确认／结果的 1280／390／320px、中英文、主题、焦点与无整页溢出通过。

最终完整检查 **1875 pass／5 skip／0 fail，10393 assertions，303 文件，265.13s**，本次发布新增可执行行覆盖 **47／48（97.9%）**。期间修复了集群装配测试在 Pod 真正创建前模拟握手的竞态，完整等候队列操作后再关闭夹具；磁盘耗尽的无效轮次和仅清理未被使用构建缓存的恢复过程均如实留档。实现 `119bf59` 与测试修正 `7237ecc` 已随共享 main 推送，发布后 `HEAD == origin/main == 7237ecce628e4693d69127bea766e13fca0ff13e`、index 为空；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/35516088549) 六个作业全部成功，RFC-010 已 Done（T1–T11、CM-01–25）。逐项 ID、UID、HTTP／耗时／trace 与历史失败见 `proposal/rfc/RFC-010-cluster-management/acceptance.md`。

收口文档 `207cc4a` 的后续 CI 发现既有历史 Agent 测试在名册回执前向禁用输入框合成输入，导致快捷键断言失败；已用受控回执稳定复现并修正测试为等待实际可编辑，生产代码未变。两个相关文件 14 pass／0 fail／133 assertions；追加完整门禁与发布结果见同一验收记录。

## 并行接力：用例防护体系与 CI 用例执行体系（2026-09-20）

作者要求把用例防护体系与 GitHub 上的 CI 用例执行体系建立起来：新功能有防护用例的位置与编写要求，新增与重构不弄坏已有业务。
先核对现状（本机 266 个用例文件、1642 条用例、行覆盖率 95.9%）：用例不缺，缺的是让它们不会悄悄失效的机制，逐条证据在 `docs/engineering/testing.md` §0。
本批没有改任何产品行为；结构性规则记在 **ADR-0007**（状态「实施中」，P1–P6 六个取值待作者复核）。

- **规范**：新增 `docs/engineering/testing.md`——用例分层（沿用 Plan §10.1）、每种单元的用例放哪、每类改动必带哪些用例、编写要求、CI 执行体系、已知防护缺口。开发规则 §3／§4、结构文档 §1／§10（v0.4）、CLAUDE.md、AGENTS.md、README、`tests/e2e/README.md`、脚手架模板都已指向它。
- **绿必须等于跑过**：`@crewstation/testkit` 新增能力闸门与 `CS_TEST_REQUIRE`（`database`、`gitlab`、`e2e`）。CI 的 `check` 点名 `database`、`e2e` 点名 `e2e`；此前数据库连不上时约 60 组集成用例整层跳过、e2e 登录失败时整套跳过，两个作业都照绿。
- **`tools/arch` 由六条规则变八条**：`test-discipline`（禁 `.only`、无条件 `.skip`、`.todo`、`.failing`、恒真 `skipIf`、用例重试；仓库根 `tests/` 只允许约定的用例层目录）与 `migration-lock`（`tools/arch/migrations.lock.json` 锁住 62 个迁移；`bun run migrations:lock` 只追加）。规则清单收进 `ruleSet.ts`。
- **业务契约面金样**：`packages/contracts/tests/golden/contractSurface.json` 锁住约定表常量、事件推送头、TaskRunner 协议号与 Manifest、事件、业务任务的 Schema 形状；纯新增 `bun run contracts:lock`，破坏性变更必须 `--breaking "<作者批准的依据>"` 并永久留痕。另有三条对账用例：模板与接入容器手抄的约定名、业务任务服务域路由清单（让最小样例自己的客户端代码打真实路由）、能力说明里的 API 表。
- **`tools/testguard`（新工具单元）**：CI 作业摘要（用例汇总、逐条列出的跳过、覆盖率、本次推送删除或改名的用例），以及**阻断性的新增代码防护**——只看本次推送改动的行，改到的生产文件必须有用例加载、改动的可执行行 ≥80% 被执行到；无存量基线。CI 跑 `bun run check:ci`：与本机的 `check` 共用同一段静态检查与同一批用例，只多出 lcov 与 JUnit 两个报告参数（由用例锁住）。
- **顺带补的用例**：平台迁移清单完整性（漏挂一个模块的迁移会红，已做变异验证）、工作台中英文文案键对齐、脚手架产物。

两个实测结论写进了 `dev-gotchas.md`「用例与 CI」：全仓 `--randomize` 会有约 100 条因有意的文件内顺序依赖而失败，所以没有引入随机序巡检；`.only` 在本机静默吃掉同文件其余用例，只有 CI 才报错。
**最大的遗留缺口**：CI 里没有 GitLab，项目空间的实机用例与 scm 的真实 GitLab 用例在 CI 永远跳过，开通、发布、切流、开发会话在 CI 没有实机证明；三种做法登记为 `implementation-open-questions.md` **I20**，待作者裁定。

**验证**：功能提交 `ec4619469289081ac22704c76c6f179f1ca23243`，精确 SHA 的 [CI 35503794752](https://github.com/wangbinquan/CrewStation/actions/runs/35503794752) 两个作业均成功。
`check`（3 分 18 秒）：1708 pass／43 skip／0 fail，43 条跳过全部属于 `testing.md` §10 登记的几类（GitLab 5、真实集群 1、原生 CLI 2、由 `e2e` 作业承担的实机用例 35）；CI 行覆盖率 96.7%；新增代码防护判定本次改动 346／347 行被执行到（99.7%）。
`e2e`（5 分 40 秒）：在 `CS_TEST_REQUIRE=e2e` 下真实登录并通过 20 条，19 条跳过（项目空间 16、非管理员身份 1、该作业没有数据库的 2）。推送前本机完整门禁 1744 pass／5 skip／0 fail（含 PostgreSQL、GitLab 与实机浏览器）。
随后一笔补了 `bun run migrations:lock <迁移文件>`：共享工作树上不带路径会把别的会话未提交的新迁移一起锁进去，对方的文件不在自己的提交里，CI 上就是「已入锁的迁移被删除」。
**并行会话注意**：新迁移在入锁前 `arch:check` 会红，这是规则本意；只锁自己的那一个，别人的留给对方。

**CI 按层拆作业（同日追加）**：作者指出「GitHub 上不只要挂 e2e 用例，模块级 UT、方法 UT 也需要」。它们此前其实一直在跑（单个 `check` 作业里的 1708 条），但从 GitHub 上看不出来，也分不清哪一层红了。
现在每个用例文件按位置恰好属于四层之一（唯一事实源 `tools/testguard/testTiers.ts`）：`unit` 方法级 UT（就近放、不依赖环境）、`module` 模块级 UT（各单元 `tests/` 下，以及就近放却带 `skipIf` 的）、`console` 工作台、`e2e`。
CI 变成六个作业：`static`／`unit`／`module`／`console` 并行，`gate` 合并三层产物做按层汇总、**分层审计**（每个用例文件都必须真的跑过；方法级与工作台两层不允许任何跳过）与新增代码防护，`e2e` 独立并自带 PostgreSQL（`CS_TEST_REQUIRE=e2e,database`）。**看一次推送绿不绿，看 `gate` 与 `e2e`。**
本机 `bun run check` 不变；新增 `bun run test:unit`／`test:module`／`test:console`／`test:e2e` 可单跑一层。`check:ci` 已删除。用例文件只许用 `.test.ts(x)` 命名（`test-discipline` 新增的一条）。

**按层拆分的验证**：`9cedae486dd8d99dfe66b80e2718750e9307ff33` 经作者确认与 RFC-008 暂存的本地提交 `b69fef7` 一起推送。它的 [CI 35506624499](https://github.com/wangbinquan/CrewStation/actions/runs/35506624499) `static`／`unit`／`e2e` 绿，`module`／`console` 各红一条——都是 `b69fef7` 改了按钮文案与终端快照却漏改的旧断言（`rebuildSession.test.tsx`、`runnerProtocol.test.ts`），与分层无关；`gate` 如实汇总后按设计变红。
RFC-008 会话随即提交修正 `dc788b7c63b32d5963ddc1602fa7a0e3eae40af6`，其 [CI 35506895560](https://github.com/wangbinquan/CrewStation/actions/runs/35506895560) 六个作业全绿：方法级 UT 55 个文件 292 条、**0 跳过**；模块级 UT 152 个文件 978 条（970 pass／8 skip）；工作台 69 个文件 474 条全过；`gate` 合并 1744 条、行覆盖率 96.3%、分层审计通过；`e2e` 22 pass／17 skip（自带 PostgreSQL 后 `apiInvocation` 的 2 条不再跳过）。
**事故记录**：准备 `9cedae4` 时我用「先以写模式打开、再读取」的写法就地改写，把工作树里的 `STATE.md` 截成了 0 字节，其中有三个并行会话未提交的接力内容（RFC-011 新段、RFC-009 的 PS-11 结论、RFC-008 追加段）。已按各会话操作记录里的补丁原文在已提交版本上逐个重放恢复，并与对方一分钟前自己量到的 `git diff --numstat`（+20／−3）对上；期间 `STATE.md` 为空约 25 分钟（18:46–19:11），在此期间读过它的会话请重新读取。写法教训见 `dev-gotchas.md`「就地改写共享文件」。

## 最新接力：项目设置与开发资源分工（2026-09-20）

作者要求项目设置直观、简化，并明确批准「批准实施并批准代码提交上库」。生产实现已完成：
设置聚焦环境变量／应用展示／成员与角色／高级，默认开发变量；列表和摘要先显示，新增／修改才展开表单。
开发资源独立为 API／事件／数据与存储／项目与仓库／平台接入五主题；两空间的旧链接保留上下文迁移。
原角色判断、独立草稿、错误、确认与焦点保护保留；窄屏使用有标签的主题选择器。评审工具只留在设计稿的 `?review=1` 中。

已部署 `cs-console:rfc009-20260920-3` 并实机操作默认入口、变量草稿往返、错误聚焦、离开确认和五资源主题。
最终真实 E2E **11 pass／0 fail／274 assertions**；1280／390／320px 中文浅色、390px 英文深色九主题均无整页横向溢出。
配置／成员／应用／资源候选 46 项、API／边界 14 项回归通过，console 构建通过；与 RFC-008 共用最终完整 gate，
**1684 pass／5 skip／0 fail，9534 assertions，228.33 秒**，架构、lint、两套类型全部通过。实现提交
`c5e5f0ec7a6563183d64f5fedf8a166536d9a31c` 已上库，精确 SHA [CI 35503015065](https://github.com/wangbinquan/CrewStation/actions/runs/35503015065)
的 `check`／`e2e` 均成功。CI 的项目实机组因未提供 GitLab／项目而跳过，本批九主题布局证据来自本机 11 项实跑，未将 CI 绿色当作它们已执行。
没有实际修改演示项目配置、成员权限或归档。首次 API 试调超时已定位到仍运行 `v0.1.2` 的旧参考代理：
它没有已上库的出站适配与对应规则；该部署问题单独保留，不冒记修复。
作者另行授权后，已保留原 10Gi 工作卷恢复专用验收会话；在已有授权的 `rfc003-integration-qa:GET:/v4/projects` 上，
详情和 Swagger 分别实际返回 **HTTP 200／112 ms、HTTP 200／91 ms**，任务编号与两条 trace 均与代理日志吻合。
PS-11 已补齐，RFC-009 **Done**；完整证据见 `proposal/rfc/RFC-009-project-settings-ux/acceptance.md` §4–5。
保留并行 RFC-008 与其他任务的全部输出，Git 发布串行协调。

## 最新接力：开发会话操作闭环与界面重构（2026-09-20）

作者要求全面优化开发会话，重点解决未连接无法创建 CLI、右上角数据访问／会话展开混乱、操作路径不直观。
实施前已核对本机与源码：演示项目 `demo` 的 `tsk_01a0954107447000b7936485fb80d15d` 在旧协议 1 容器中运行，
平台要求协议 2，握手持续以 1008 拒绝。运行时只记录拒绝原因而保留任务为 running；既有恢复仅接受 failed 且 Pod 已结束，
因此 UI 禁用 CLI 后无可用恢复路径。未连接无需用户填写 Runner 地址。

新增 `proposal/rfc/RFC-008-development-session-ux/` 三件套与可操作设计附件，索引状态 **Done**。
方案为六个固定功能页签（CLI 工作区／预览／代码／变更／数据访问／会话与环境），CLI 内管理个人工作区；
异常原因与下一步直接可见，扩展已有保卷恢复以支持服务端确认协议不兼容的旧环境。
作者已于 2026-09-20 明确回复「批准实施并批准提交上库」。代码、实机验收、本地门禁与精确 SHA CI 已完成。
结构化连接故障与保卷恢复已贯通；兼容旧数据遗留 connected=true，活动心跳不再让恢复确认过期。
数据／环境为固定页签，编辑与申请草稿保留；明确 URL 优先于其他浏览器页写回的个人视图，避免同地址无法回到 CLI。

demo 实机恢复作业 `e4e5aa6e-256b-4d6d-8119-d3af576194bc` 已 ready，13.189 秒完成；同一任务、PVC UID、Git HEAD、源文件保留，
仅 Bun 缓存更新。实际创建独立 CLI 并得到 `RFC008_OK_e4e5aa6e`，代码编辑／保存／变更计数／还原与真实预览通过。
最终界面 1280×720 四窗各 547×222px、首窗 y≈199px；390×844 六页无整页横向溢出，英文、深色、键盘导航已核对。
工作区新建、命名、跨区移动和关闭实机通过；数据草稿往返保留，释放预检后取消；没有申请生产访问或发布业务版本。
前一候选完整 gate 1631 pass／5 skip／0 fail；真实验收增量的运行时 65 项、前端 25 项定向回归通过。
最终共同 gate **1684 pass／5 skip／0 fail，9534 assertions，228.33s**，结构、lint 与两套类型检查通过。
功能提交 `5252c4c43804bdfbd2a8beb92bc3c2f9289bb12d` 已上库；[CI 35502873316](https://github.com/wangbinquan/CrewStation/actions/runs/35502873316)
的 `check`（3 分 8 秒）与 `e2e`（5 分 29 秒）均成功，T1–T7／DS-01…DS-16 完成。
保留并行 RFC-009 与其他门禁在制品，双方协调串行 Git 发布；本轮只精确提交 RFC-008 相关文件。
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


## RFC-008 追加：会话历史滚动与创建入口（2026-09-20）

用户反馈 OpenCode 历史无法滚动，并要求「＋ CLI」改为「创建开发Agent会话」。功能提交 `b69fef7280d5edf6314161f2a052db085bea4119` 固化 19 个本任务路径：鼠标编码完整快照、旧 OpenCode 快照兼容、新会话默认显示历史滚动条、操作提示与统一入口命名。新默认算力档位修订 3 的镜像／Runner／CLI／真实模型回文已自动验证通过，控制台已部署。

47 条核心回归与 14 条整页回归曾全部通过；真实浏览器无后端夹具确认滚轮、拖动和只读边界。新增代码防护 67/67 行（100%）。共享全量测试自然结束：1814 pass / 5 skip / 17 fail（270.89s）；本任务的两条旧断言已修正并精确提交为 `dc788b7c63b32d5963ddc1602fa7a0e3eae40af6`，Runner 11/11、恢复页 6/6 定向通过。其余失败按 RFC-010/011/012 归属由原任务处理；两个旧部署缺少的新管理页在共享部署更新后真实定向验收 2/2 通过。

**本轮两笔提交已由并行发布者推送上库**。最终 fetch 确认本地 main 与 origin/main 同为 `dc788b7c63b32d5963ddc1602fa7a0e3eae40af6`；[精确 SHA CI 35506895560](https://github.com/wangbinquan/CrewStation/actions/runs/35506895560) 已于 2026-09-20 11:15:59Z 全部成功：static、unit、module、console、gate、e2e 均为 success（e2e 5分47秒）。这证明已发布候选，不代表 RFC-010/011/012 未提交工作树已通过完整验收。

作者随后明确回复「授权」，真实长历史验收已完成：仅创建 `CLI 45afe1`，执行任务 `tsk_01a0bf16644d7000bbeddca54490b791`，沿用 150m／1Gi／2Gi。OpenCode 1.18.29 生成带首尾标记的 80 行，实测滚轮、拖动、刷新与平台重连后回看历史均生效，输入区保持固定。已通过「结束进程」停止验证 Agent，页面显示已结束，独立 Pod 已回收；主开发会话保持连接、工作树未修改。细节见 `proposal/rfc/RFC-008-development-session-ux/acceptance.md`。

验收期间共享 Docker 虚拟磁盘满导致 PostgreSQL 与会话服务中断。已先完整备份六份无标签、无容器引用的旧构建镜像，再仅回收这些缓存，恢复 1.2G 可用空间；未删除业务卷或运行容器。数据库自动恢复，API／controller／session／console 均 1/1。备份为 `/private/tmp/cs-rfc008-unused-images-20260920.tar`，摘要与恢复办法见验收记录；磁盘仍接近满额，后续构建前需另行处理容量。


## 2026-09-20 RFC-012：项目算力授权与默认可见性（Done）

作者要求“实现该功能”，补充“默认可见和默认不可见，默认档位必须默认可见”。已实现档位 defaultVisible、平台默认不可隐藏／设默认自动可见，项目继承默认范围或显式允许清单／项目默认 Agent／开发资源套餐。新管理入口为项目目录的“算力授权”。CLI、历史 Agent、业务子任务、发布校验及能力说明使用可信 projectId；开发容器新建与恢复读取分配，已受理 Agent 保持固定修订。详情见 `proposal/rfc/RFC-012-project-compute-access/`。

本功能相关定向合计 **96 条通过**；生产构建与 1440／390／320px 浏览器夹具交互通过。共享候选 `rfc011-20260920-1` 已部署，项目算力管理页与两个真实查询接口 E2E **1 pass／0 fail／6 assertions**。该实机用例未修改真实项目授权或创建 Agent／开发 Pod，写入与运行链规则由真实 PostgreSQL 模块用例覆盖。

独占实现 `5fb7e6c`（74 files）与 20 个共享文件均已上库：`b7fb3e5` 收入 11 个，`b3d8d0e` 收入其余 9 个；本轮逐项核对提交清单，并确认三笔提交均在 `origin/main`。原有共享接线与迁移锁的发布依赖已全部解除，其他会话的贡献保持完整。

有效共享完整门禁 **1864 pass／5 skip／0 fail，10304 assertions**，日志 `/private/tmp/rfc011-recovered-full-gate.log` 已复核。包含完整功能的精确提交 `a6944659310e56b6cbcd16341a02b20b2d07b4da`，[CI 35513950300](https://github.com/wangbinquan/CrewStation/actions/runs/35513950300) 的 static／unit／module／console／gate／e2e 六项全部成功。T1–T6、PC-01…PC-12 及默认可见性要求均已落档，RFC 三件套与索引更新为 Done；历史失败、验收分层与 CI 跳过边界保留在 `proposal/rfc/RFC-012-project-compute-access/plan.md`。本次仅文档收尾，复用原候选验证，不重复启动全量门禁。


## RFC-013 UUID 候选收尾（2026-09-21）

用户已明确批准实施、部署和提交上库。资源身份与普通引用已改为 36 字符小写 UUIDv7；35 个迁移与契约锁已生成，旧库副本验证普通字段 181 组／行引用 309,172 条、JSON 引用 189,464 条、历史摘要 154,886 份全部通过，重跑无新迁移。基线文档和 Manifest v2 样例已同步，示例经真实 Schema 校验。

真实新旧 Runner 镜像分别验证读取标准 UUID 和兼容任务别名；别名在容器启动前持久绑定，不写回正常资源接口。控制面与任务最终候选标签为 `rfc013-20260921-2`，工作台为 `rfc013-20260921`，均已构建并导入本机节点；任务镜像已发布到本机集群内的新标签。活动部署、原数据库尚未升级，尚未 commit/push。

完整门禁正在收尾，当前基于完整覆盖率的工作树检查覆盖 379 个改动生产文件，2,887/2,965 个可执行改动行（97.4%），无未加载文件。精确结果与后续部署状态见 `proposal/rfc/RFC-013-resource-uuid/acceptance.md`。

共享目录另有 RFC-014 页面改造。已通过异步问题询问作者是否将其文件一并交由本任务验证、部署与提交，尚未收到答复；公共暂存区保持为空。不要删除、恢复或绕开这些并行输出。准备好的本机切换脚本 `/private/tmp/cs-rfc013-deploy.py` 分 `quiesce`（停 9 个控制面 Deployment、另存并校验新备份）、`migrate`（唯一新 Job）、`resume`（仅替换镜像及任务镜像配置，恢复原副本数）；尚未执行。既有 Pod/PVC 名称和 UID 已保存供切换后比较。

RFC-013 最终候选门禁现已通过：**1937 pass／5 skip／0 fail**，326 文件、12165 断言、369.25s；含新增文件的改动行防护 **2887/2965（97.4%）**、无违规。跳过项及实际部署未切换的边界见 acceptance.md。RFC-014 文件交接问题仍待回复，未 staging／commit／push。

2026-09-21 RFC-013 发布接力：最终候选完整门禁 1937 pass／5 skip／0 fail，旧库副本完成 35 个迁移，309172 条普通引用和 189464 条 JSON 引用均为 UUIDv7，154886 份历史摘要核对通过。作者授权 RFC-013 与 RFC-014 联合上库，保留两个任务的完整文件输出；本轮不执行原库升级或部署。上方关于夹具、迁移锁、完整门禁尚未完成的文字是早期过程记录，以本段与各 RFC acceptance 的最终候选记录为准。

2026-09-21 联合实现 `73aa132` 已上库；其 static、unit、module、console、gate 五项 hosted 作业成功，e2e 待终态。RFC-014 同时补正旧布局 E2E：新增接入方已移到标题栏，旧用例依赖的前一兄弟元素不存在；改测标题／动作／正文的实际间距并覆盖 320px，真实浏览器量测、lint 与根类型检查通过。产品代码未变，随后发布测试补正并核实最终 SHA。


## RFC-013 正式 UUID 升级接力（2026-09-21）

用户再次授权部署与提交。代码已联合发布在 `12e5b1b2bfce05f85eeb24b632565356aba14185`（含实现 `73aa132`），精确 SHA CI `35544271321` 六项成功。现已真正完成原库升级：停写备份 `/private/tmp/cs-rfc013-cutover.dump`（0600、7,648,049 字节）完整验证并恢复核验；35 项迁移 Job 成功。76 张旧表数量保持（仅迁移记录增加），181 组字段／309,982 条普通引用、190,275 条 JSON 引用与 155,697 份摘要全部通过；重复迁移为 0。26 个原项目 Pod、12 个 PVC 的名称和 UID 不变；原在线 4 个 Runner 均以 UUID 续接，7 个原离线协议 1 Runner 仍报原有版本不匹配。

8 个核心 Deployment 已就绪（控制面 `rfc013-20260921-2`，console `rfc013-20260921`），全局新任务镜像已切到集群仓库 `task-runtime:rfc013-20260921-2`。**本机登录入口尚未恢复**：开发登录器启动播种需要管理员密码，而原策略已关闭密码登录；`crewstation-dev-auth` 0/1，报 `403 /auth/login`。专用验收页当前请求 `/v1/me` 均 401；会话读取被自动审批拒绝，未执行。已异步请求作者允许内置 `CS_PASSWORD_LOGIN=force-on` 临时恢复流程，必须等具体答复；先恢复 cs-auth／cs-api，再重启开发登录器，成功后移除开关并验证密码登录保持关闭。不要伪造会话、修改账号角色或绕过审批。登录恢复后继续真实浏览器和新任务验收，RFC-013 T13／T14 仍 In Progress。

临时部署脚本 `/private/tmp/cs-rfc013-deploy.py` 的迁移阶段已完成；不要再次运行 quiesce 或重复创建迁移 Job。原始切换快照与完整证据见 RFC-013 acceptance.md。恢复服务后已产生新心跳，不用旧备份直接覆盖当前库。未发布的会话初始化替代方案只保存在 `/private/tmp/cs-rfc013-optional-session-recovery.patch`，不属于本次候选；工作树生产代码保持与已验证发布版本一致。


## RFC-013 登录恢复与实机验收（2026-09-21）

作者再次明确回复「授权」，已完成临时 `CS_PASSWORD_LOGIN=force-on` 恢复：开发登录器完成播种后恢复 cs-auth／cs-api 的原变量，正常 OIDC 登录成功；`passwordLoginEnabled=false`、`forcedOn=false`，九个应用 Deployment 全部 1/1。上方“登录恢复待授权”是历史过程记录，阻塞已解除。

本轮实机补齐升级后浏览器 41 pass／1 skip，以及档位创建、保持 ID 改名、复制独立步骤／凭据、新旧 Runner 镜像三次真实终端探测。配置定义与两环境取值按 UUID 写入、改名、旧版本 409、名称代替 ID 400、历史保留和按 ID 删除全部通过；专属临时档位／取值已清理、任务 released、Pod 已回收。原在线 Runner 与原卷的切换证据保持有效；原离线协议 1 Runner 仍为原有不兼容，不冒充恢复。

验收发现的早期 stub Manifest 无 compute 字段导致档位详情 500 已修复；只跳过不存在的算力引用，不改历史快照或自动补默认档位。`9a67e12d75e94ea150237470c5a61af91518b508` 已推送，七个控制面更新到 `rfc013-20260921-4`；console 与健康的开发登录器保持原镜像。最终本地门禁 **1946 pass／5 skip／0 fail，12261 assertions**，修复行防护 **3/3（100%）**，源码门禁前后相同。[精确 SHA CI 35547465024](https://github.com/wangbinquan/CrewStation/actions/runs/35547465024) 六项全部成功，T1–T14／ID-01…ID-12 已核对，RFC 三件套与索引均标记 Done。逐项结论和任务 ID 见 `proposal/rfc/RFC-013-resource-uuid/acceptance.md`。

本次 STATE 文件保留并包含并行下拉框任务已经写入的完整接力段落；该任务的产品源码和独立测试仍由原任务持有，不随 UUID 兼容补丁或收尾文档发布，也未部署到工作台。共享全量门禁包含其在制用例，不代表这些未发布文件已有远端 CI 证明。
