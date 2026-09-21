# RFC-011｜实施与验收记录

> 日期：2026-09-20；作者已批准实施并提交上库。此记录区分自动化、真实部署与待授权操作，不以设计附件代替生产证据。

## 部署与真实使用链路

- 角色迁移 Job：`crewstation-migrate-rfc011-20260920`，实际执行 `identity/0010_platform_roles.sql`，初始化 10 个旧账号；重复回填与中断恢复另由独立数据库测试覆盖。
- 控制服务镜像：`cs-control-plane:rfc011-20260920-1`，摘要 `d96f8ea4caf7b368dd45a191af0468d41c96c31640d39cf653d0cc21e575fb25`；API、认证、控制器、会话、事件与两个 MCP 均 rollout 成功。
- 最终控制服务镜像：`cs-control-plane:rfc011-20260920-2`，摘要 `c099f349e6a115f0d5448ea3ac18cd18309f255ed98f53c13684d83027f95f74`，已导入 `desktop-control-plane` 并完成上述七个服务 rollout，全部 1／1 ready。该轮没有重启无代码变化的 dev-auth。
- 首次实机 console 镜像：`cs-console:rfc011-20260920-1`，摘要 `8fa99b7f753165811d91e1d1ff2005f196c59f0d950f95481378e579c8fa98de`。随后仅有重试按钮文案与并行集群操作面板修正，最终构建另记录。
- 最终 console：`cs-console:rfc010-20260920-2`，摘要 `b6e0e989886038c87cc8727eef84a35ded4d4ba568de8aabec548dc0ba6d0a31`；沿用共享构建标签，包含本 RFC 已通过门禁的页面。实际 deployment 1／1 ready，浏览器重载后首页应用、Beta 入口和三角色目录正常，console error 为空，`dev-member` 仍为用户。
- 测试登录器首次初始化遇到 OIDC discovery 的 503；经其既有 `/reseed` 恢复为 ready，没有修改集群 RBAC。
- CUA 浏览器分别以 `dev-member`、`dev-developer`、`dev-tester`、`dev-admin` 的真实 OIDC 会话验收。四个测试视角对应三类平台角色，均无目标登录落在 `/` 能力市场。
- 专用项目：`prj_01a0be892ee2700090acb2428fab3c16`，名称“首页角色验收”，slug `rfc011-role-home`。创建约 19:17（Asia/Shanghai），19:19 前确认项目 `active`，owner 为 `dev-developer`，首版 `v0.1.0` 已部署就绪，SHA `a077638d104040875351808ea6fc5b14c20af386`。没有把创建响应当成开通成功。
- owner 通过成员界面精确查找 `dev-tester@roles.localhost`：自动选择试用成员，开发者选项禁用，保存成功。该用户首页仅有应用入口和本项目 Beta 卡片，点击可达 `http://preview.rfc011-role-home.cs.localhost/`。真实样例显示用户 `dev-tester`／`usr_01a0bd7eb2007000a07e65c0744bfde0`，证明应用鉴权链路可用。
- 浏览器未执行业务 Agent 请求，也没有上线或修改任何既有业务应用。

## 验收矩阵

| 项目 | 已获得的证据 |
|---|---|
| RH-01–03 默认首页、角色入口、无技术编辑与全局动态 | 四个真实登录视角；普通用户仅“应用”，开发者增加“项目开发”，管理员再增加“平台管理”。`roleHome`、`appMarket`、`agentActivityMenu`、`spaceSeparation` 路由测试覆盖技术查询不挂载、卡片详情无编辑链接。 |
| RH-04 市场状态与查询 | `marketApps`、`appMarket`、`testerPreview` 覆盖空态、分页过滤、失败／未知状态和撤销后不泄露入口；实机覆盖普通用户空态、搜索、详情与 Beta 打开。 |
| RH-05–07 开发／管理边界 | `platformDevelopment`、`platform/roleHome`、`projectAccessBoundary`、`adminDirectory` 真实 DB／HTTP 和路由测试；实机开发者只列获授权 demo 项目，普通用户 `/projects/new` 明确拒绝，tester 旧开发深链接替换到对应应用详情。 |
| RH-08–11 自建流程 | 实机空提交同时显示名称／slug／模板错误并将焦点置于名称；选模板后创建成功、本人负责人、平台默认资源。`roleHome` 与 `platformDevelopment` 测试覆盖无项目可建、越权字段、目录失败、slug 冲突、重复提交、回执未知和输入保留。 |
| RH-12 开通恢复 | `modules/platform/tests/roleHome.test.ts` 对真实 DB 和完整 HTTP 装配验证：provisioning 返回 412、失败后普通开发成员／tester 返回 403、owner／admin 返回 202；UI 检查错误与项目标识及恢复入口。未在共享集群破坏外部依赖来制造开通失败。 |
| RH-13 管理角色 | 真实管理员目录显示三类角色且确认区显示目标和影响；`platformRoles`、`userRoutes`、console `roleHome` 覆盖成功写入、非管理员拒绝、409 保留选择、最后管理员与在任负责人限制。实际 `dev-member` 角色写入被自动审批拦截，待具体授权，不计实机通过。 |
| RH-14 迁移 | 本机实际初始化 10 个账号；`platformRoles` 独立数据库覆盖旧管理员／开发成员／owner／tester、部分迁移中断与重跑、新账号默认用户、不因登录重刷角色。 |
| RH-15 成员资格 | 真实 owner 添加普通用户为 tester 成功、开发选项禁用；自动化覆盖非法开发／owner 目标、管理员转交与平台角色不被项目接口提升。 |
| RH-16 权限撤销 | `browserReplay`、`authorizedSink`、`terminalStreams`、`devSessionToken`、`platformDevelopment` 覆盖已有两客户端连接、排队数据与命令、CLI旧令牌、共享任务不被停止、权限查询失败、连接异常和角色恢复。 |
| RH-17 Beta | 真实未发布应用 Beta 卡片、试用数据提示、用户鉴权打开、旧 tester 项目链接迁移全部验证；已发布应用详情试用与正式卡片不误标由 API／路由测试覆盖。 |
| RH-18 身份兼容 | 真实 OIDC 四测试视角保持预期角色；`platformRoles`／identity／platform 集成覆盖新登录、旧 isAdmin 接口、SYSTEM actor 与 Service actor 路径。 |
| RH-19 尺寸／语言／键盘／草稿 | 实际部署应用在 1280／390／320px 下 `scrollWidth == clientWidth`；320px 顶栏子元素右边界均为 308px；中英文、浅色 `#f5f7fa`、深色 `#11151c` 确认。真实首页 Tab 顺序为搜索框→搜索按钮→应用详情，Enter 打开详情；创建错误焦点确认。草稿与身份刷新失败由路由测试覆盖。 |
| RH-20 门禁与发布 | 见下节；精确 SHA CI 完成前不宣称发布门禁通过。 |

响应式验证使用临时本机页面 `http://console.cs.localhost:5202/` 将真实部署的应用嵌入指定宽度与配色的 iframe，数据与登录仍来自实际集群，不使用模拟数据。原因是浏览器 viewport 工具返回成功后顶层页面仍报告 1280px，因而按实际 DOM 宽度重新核实；工具的 iframe 键盘操作也失败过，键盘验收改在真实顶层页面通过。此前 `prototype-review.md` 仅为批准前设计稿。

## 自动化与发布证据

- 定向完整装配／授权／流回归：36 pass，0 fail，278 assertions，8 files，日志 `/private/tmp/rfc011-integration-final.log`。
- 角色首页／试用／角色目录／空间分离与登录器回归：47 pass，0 fail，291 assertions，日志 `/private/tmp/rfc011-ui-cover.log`。
- 登录器 HTTP 客户端与 OIDC 回归：10 pass，0 fail，42 assertions，日志 `/private/tmp/rfc011-dev-auth-client.log`。
- 首轮完整 `CS_TEST_REQUIRE=database bun run check --coverage --coverage-reporter=lcov --coverage-dir=coverage --reporter=junit --reporter-outfile=coverage/junit.xml`：结构、lint、双类型检查通过；1861 pass／5 skip／1 fail，1867 tests／302 files，234.70s。唯一失败为历史流测试在名册标签出现前点击，修正与后续结果继续记录；日志 `/private/tmp/rfc011-shared-full-gate.log`。
- 最终新增代码防护（含未跟踪生产候选和已协调 RFC-010／012 提交）：251 个变更生产文件全部加载，2495／2526 行被执行，98.77%，无违规；报告 `/private/tmp/rfc011-patch-audit.json`。
- 并发创建补充：两连接池、四个不同创建者、延迟模板目录，旧实现全部被数据库 idle timeout 中断；统一短角色协调键后四个创建全部成功，相关真实 DB／HTTP 10 pass／0 fail，62 assertions。红／绿日志 `/private/tmp/rfc011-role-pool-red.log`、`/private/tmp/rfc011-role-pool-green.log`。
- 历史流测试已由原任务以受控阻塞 `/agents` 重现失败，改为等待实际标签出现并保留超时诊断；4 pass／0 fail，26 assertions，日志 `/tmp/cs-rfc008-finished-agent-green.log`。没有以偶然重跑通过作为修复。
- 中间完整检查遇到 Docker VM 磁盘用满，PostgreSQL 无法创建测试数据库，该轮 109 fail 不作为有效验收（`/private/tmp/rfc011-final-full-gate.log`）。只清理未使用、可重建的 BuildKit 缓存后恢复 1.4GB 可用空间，未删除容器、镜像、数据库或卷。另修正登录器隔离断言：仅允许既有安装目录和其测试引用真实服务名，固定身份与角色注入禁令保持不变，定向 8 项通过。
- 恢复后的同一完整命令最终通过：1864 pass／5 skip／0 fail，10304 assertions，1869 tests／302 files，228.56s；架构、lint、根目录与 console 类型检查均通过。日志 `/private/tmp/rfc011-recovered-full-gate.log`，当前 `coverage/lcov.info`／`coverage/junit.xml` 均来自这一有效运行。提交前核对 366 个共享生产／测试候选文件哈希无变化，不重复运行完整门禁。
- `bun run build`（console）成功，日志 `/private/tmp/rfc011-console-final-build.log`。
- 5 个环境条件跳过：未提供 E2E 非管理员口令、未启用 `CS_TEST_K8S`、OpenCode 原生 TUI、Claude 原生状态、Linux 镜像控制终端。角色拒绝边界有本轮真实普通用户浏览器及真实数据库／HTTP证据；其他跳过不作为本 RFC 通过证据。
- `contracts:lock` 核对业务契约金样无变化；新增 identity 迁移已纳入共享迁移锁。

## 代码发布

- 实现提交：`b3d8d0ed5e964aa7f7f71fc47bdabf1ced62f1e5`，185 个明确路径；共享文件完整保留 RFC-010／012 装配和 RFC-008 历史流回归交接，未提交未交接的 RFC-010 独立文档。
- 首次统一推送：`da4f4373f70ccf5305614b0cf4ddb6bb900b4718`，包含本实现和并行任务的 v0.3.6 文档回填；推送后 `HEAD == origin/main`，工作树与暂存区干净。
- 精确提交 [CI 35509904421](https://github.com/wangbinquan/CrewStation/actions/runs/35509904421) 的 `static`、`unit`、`module`、`console`、`gate`、`e2e` 六个作业全部成功。分层审计通过，生产代码行覆盖率 96.6%（40954／42401），新增代码防护 2495／2526（98.77%）。端到端 23 pass／18 skip／0 fail；其中 17 个项目场景因 CI 未提供 GitLab／项目而跳过，另 1 项缺少非管理员账号，不以 CI 绿色替代前述本机四视角、真实创建和 Beta 试用证据。

## 首页自动更新追加

作者在验收页面时要求去掉首页常驻“重新检查”按钮，由系统例行刷新。首页已移除该操作，继续使用既有前台 15 秒刷新、重新进入和窗口聚焦更新；查询失败时仍有重试入口。中英文空态改为说明“列表会自动更新”。

> **2026-09-21 修订（作者当面裁定，直接修改，不另立 RFC）。** 15 秒例行刷新保留，但刷新方式改为部分更新：在途不再清空卡片，数据到达后原地替换。
> 原实现每一轮都把列表换成「载入中」，滚动位置随之回到顶部；作者实机发现后裁定「不能自动触发页面刷新，就算刷新也是部分更新」。
> 撤权与读取失败仍立即移除旧卡片和打开链接（本节上文与 design §121 的性质不变）。同一裁定覆盖 `/projects`、项目概览与管理总览待办：
> 后台例行重读不再把入口链接换成纯文本、不再抽走「下一步」横幅，只有用户点的刷新才暂停入口（`useManualRefresh`）。

- 新候选完整检查：1864 pass／5 skip／0 fail，10304 assertions，254.66s；日志 `/private/tmp/rfc011-auto-refresh-full-gate.log`。三个本任务生产文件的变更行覆盖率为 3／3（100%），其余并行改动不计入本次补丁报告。
- console 生产构建成功，最终镜像 `cs-console:rfc011-auto-refresh-20260920`，摘要 `42bc74fe5246b5d410b7745bf7226c310143c5297d0cc4d034fbca7d23eb3b05`，本机 rollout 成功。
- 真实首页重载确认：右上角无“重新检查”，搜索、应用列表和 Beta 试用入口正常。自动更新继续由 `useMarketQuery` 承担。
- 提交 `b9e99180ab131009ea56c4e752ae522b45b8a355` 已推上 main；[CI 35511170152](https://github.com/wangbinquan/CrewStation/actions/runs/35511170152) 的六个作业全部成功。

## 语言切换外观追加

作者认为右上角语言切换外观不协调。入口改为地球图标、当前语言与下拉箭头，取消常驻文字标签与外框；统一为 32px 高度，悬停或键盘聚焦显示淡底。扩展既有 `GlyphIcon` 的可选行内样式，应用卡片继续使用默认图标样式。保留原生选择器和中英文辅助名称，语言切换逻辑与草稿保留行为不变。

- 既有语言与品牌回归：4 pass／0 fail，19 assertions，覆盖文档语言、辅助名称、切换时未提交输入和焦点保留。
- console 生产构建成功；镜像 `cs-console:rfc011-locale-20260920`，摘要 `8ebed0804ed9e292ac8df3c791b9c8dd1799e25156d6324c7e3db9e899bd6bb0`，本机 rollout 成功。
- 实际部署的 1100px 桌面、390px 中文浅色、320px 中文浅色与英文深色均无页面横向溢出；控件实际尺寸 100×32px。真实顶层页面用方向键与 Enter 往返中英文，焦点保持在控件，2px 焦点边框可见，`html.lang` 随之切换。
- 首轮完整检查的静态检查、模块和组件通过；本机已关闭密码登录，旧 E2E 前置登录仍寻找密码表单，19 项随之停在登录页失败（1831 pass／22 skip／19 fail，日志 `/private/tmp/rfc011-locale-full-gate.log`）。未修改平台登录策略；并行 RFC-010 的测试助手随后增加显式 OIDC 登录，本批使用该模式继续门禁，不将旧轮次记为通过。
- 长时间停留实机于 13:02 UTC 再次出现 `Cannot read properties of undefined (reading 'length')`，落在首页读取列表处；触发时的原始响应未保存，未将上游原因归于登录服务或并行集群操作。新增无 `items` 响应的回归用例，旧页面稳定报同类错误；首页查询现在先核对列表结构，异常时使用中英文提示与既有重试，保留搜索输入。修正后角色首页、语言、品牌与文案键回归 27 pass／0 fail，110 assertions，日志 `/private/tmp/rfc011-market-invalid-red.log` 与 `/private/tmp/rfc011-locale-regression.log`。
- 显式 OIDC 的中间轮实机用例通过，完整结果为 1866 pass／5 skip／2 fail／1 error（351.52s）。失败在并行变更的集群业务工作区重启与长操作刷新测试，分别为 Pod 尚不存在、测试数据库连接关闭；日志 `/private/tmp/rfc011-locale-oidc-full-gate.log`。同两文件单独复核为 9 pass／0 fail，62 assertions，但不以该局部结果替代完整门禁。
- 首页异常恢复修正后，最终 console 镜像为 `cs-console:rfc011-locale-20260920-2`，摘要 `79598baceac2f85952fd68cec3d56873d937c8c3e4ff1cb471fad216fb782d9e`；构建与 rollout 成功，真实首页重载后语言控件、应用和 Beta 列表正常。
- 最终八个 console 代码／测试文件内容已冻结，五个变更生产 TS 文件的可执行变更行覆盖为 13／13（100%），无违规。本轮完整检查静态部分通过，1833 pass／4 skip／6 fail／4 errors（259.89s）：四个 E2E 模块因并行更新的 OIDC 页面不再匹配身份链接而无法登录，两条任务运行时恢复用例失败。本批首页与语言回归均通过；日志 `/private/tmp/rfc011-locale-final-full-gate.log`，补丁报告 `/private/tmp/rfc011-locale-patch-audit.json`。未将这些失败或未执行的 E2E 计为成功，发布需满足仓库门禁或得到作者对本次精确提交的例外授权。


## 直接语言按钮与项目导航去重追加

作者在上一候选的精确发布例外问题上回复「批准」，随后明确要求语言切换使用按钮、不使用下拉，并指出项目开发页左侧重复出现“应用／项目开发”。本次实现遵从追加裁定：

- 语言控件为「中文／EN」两个原生按钮，使用 `aria-pressed` 表达当前选择；保留中英文辅助名称、键盘焦点和文档语言同步，去掉下拉框与箭头。
- 项目列表、新建项目及全局 404 使用无侧栏布局；只在具体项目中显示六项项目菜单和返回列表，空间切换统一由顶部导航承担。窄屏无侧栏页面同步取消空导航行。
- `documentLanguage` 与 `roleHome` 的四个新行为断言先在旧实现上失败，再随修正通过；连同项目导航与文案键共 49 pass／0 fail，258 assertions，日志 `/private/tmp/rfc011-buttons-nav-red.log`、`/private/tmp/rfc011-buttons-nav-targeted.log`。既有项目设置实机用例同步改为点击语言按钮。
- 生产构建完成；复用同版本 Bun 运行层封装主机 Vite 产物，以免在剩余约 200MB 的 Docker VM 上重复安装构建依赖。未清理其他镜像、容器、卷或数据。镜像 `cs-console:rfc011-buttons-20260920`，摘要 `319b4c7df3e5e41c133ab462b4e4b8c2315071e69b9df9d082f0194fd50e0a90`，rollout 成功。
- 真实 1100px 页面确认顶部只有语言按钮、没有语言选择框；点击及 Enter／空格可往返切换，焦点边框 2px，未提交的项目名称保留。项目列表与新建页无重复侧栏，进入“首页角色验收”后六项菜单正常，返回列表时侧栏消失。390px 浅色与 320px 深色中文页面 `scrollWidth == clientWidth`，两个按钮各 40px 宽。
- 全量检查发现两个历史断言仍强制旧下拉框与左侧市场入口（1873 pass／5 skip／2 fail）；按新界面语义更新后，相关六文件 57 pass／0 fail，287 assertions。最终 14 个代码／测试文件哈希已冻结；本次七个生产 TS 文件的变更可执行行覆盖 25／25（100%），无违规。未将上一候选的例外授权或历史绿色当作新候选的测试结果。
- 最终完整门禁静态通过，1874 pass／5 skip／1 fail，10386 assertions，250.85s；唯一失败为 `runtimes/task/tests/nativeActivityChannel.test.ts:40` 的未授权 HTTP 状态预期 403、实际 503。本文件未被本次修改，单独复核 6 pass／0 fail，19 assertions，但不足以将全量结果记绿或证明 503 的来源。日志 `/private/tmp/rfc011-buttons-full-check-final.log` 与 `/private/tmp/rfc011-native-channel-recheck.log`。所有工作台与本机实机用例通过，包括 390px 英文深色的项目设置九个主题。
- 遵从作者已批准的精确发布及按提交 CI 核验流程，本次提交范围为 14 个代码／测试文件及 2 份记录；新增文件范围均对应作者随后要求的按钮交互、导航去重及其回归。GitHub 最终提交的门禁另行核验，不把本机全量失败隐去。

## 业务卡片与详情页移除追加

作者明确要求能力市场采用业务卡片，点击直接打开 app 主页，并下掉应用详情页面。本轮沿用此前实施与上库授权，先更新设计和 B10 能力影响清单，再实现和验证。

- 卡片复用 Card、GlyphIcon 和 Badge：保留名称、用途与必要状态，名称原生链接覆盖整卡区域；删除负责人、无用途占位、详情入口以及独立详情页面。旧 `/market/:projectId` 与试用成员旧项目地址 replace 到 `/market`。
- 未发布应用仍为 Beta 卡片。已发布应用的正式链接和成员 Beta 新版链接独立，保留共用数据提示；不可用／未知／无效地址没有打开动作。后端在已取得的同份部署结果上增加可选 `trial` 投影，不增加逐卡查询，返回前复核试用资格；原 HTTP 接口继续兼容其他客户端。
- 回归先复现旧标题进入详情等五项失败。替换后发现市场跳回旧项目时，路由切换的一帧仍会触发项目摘要；身份名称查询现同时核对平台开发资格和 tester-only 关系，回归确认零项目技术请求。
- 定向 66 pass／0 fail、345 assertions；覆盖核对为 44 pass／0 fail、222 assertions。本次 10 个受防护的生产 TS 文件被加载，可执行变更行 37／37（100%）。契约面金样检查无变化，新增可选响应字段不破坏旧调用方。生产构建成功。
- 本地 console 镜像 `cs-console:rfc011-business-cards-20260920`，摘要 `8de94d40c7a8acb360617ceb0a974ec752514a11ffcddcdba2ffa5b52fe416de`；cs-api 镜像 `cs-control-plane:rfc011-business-cards-20260920`，摘要 `12b3f1d35cf77a448326c57ea3727b603506f35a467cd2dd180855040283c5c4`。后者在当时部署的 RFC-010 镜像上只覆入本轮两处源文件，两项 rollout 均成功。
- 真实首页显示八张卡片，零 `/market/…` 详情链接；点击首卡空白区域命中正式应用链接，Tab 可从搜索按钮进入该链接（2px 焦点），再进入独立 Beta 链接。直接打开该链接目标确认真实应用首页和当前用户 `dev-admin`。旧详情书签实测返回 `/market`。
- 真实页面 1280／390／320px 的 `scrollWidth == clientWidth`，中文浅色／深色和桌面英文检查通过。验收框架通过同站点端口加载真实页面，无模拟应用数据。内嵌浏览器未回传外链新标签，iframe 内英文点击接口报 `Click target is no longer available`；没有将外链弹窗或窄屏英文点击记为实机通过，原生 href／target 与两种入口由路由用例覆盖。
- 首轮完整检查静态通过，1873 pass／5 skip／5 fail（262.45s）；五项失败均为发布／API 试调测试的旧夹具只提供详情响应，迁移后市场列表为空。补齐三处列表响应，原断言保持，相关 37 pass／0 fail、388 assertions；最终 20 个代码／测试候选冻结后重新完整检查。日志 `/private/tmp/rfc011-business-cards-full.log`、`/private/tmp/rfc011-business-cards-fixtures.log`。
- 最终完整 `bun run check` 通过：1878 pass／5 skip／0 fail，10427 assertions、303 文件、323.66s，静态四项均通过。显式使用本机已有 `dev-admin` OIDC 和真实数据库，环境跳过仍为非管理员自动化、集群客户端标志与三类原生 CLI 场景；未把跳过算成通过。20 个候选文件哈希与门禁开始前完全一致，生产内容未因夹具修正改变。日志 `/private/tmp/rfc011-business-cards-full-final.log`；发布范围精确限定本轮代码、回归和记录，共享 STATE 的其他任务记录保持原样。

上一轮语言按钮与导航去重提交 `71a45c7` 已随共享主干发布；包含该提交的 `7237ecc` [CI 35516088549](https://github.com/wangbinquan/CrewStation/actions/runs/35516088549) 六项成功，本轮已重新核对远端祖先关系与终态。

## 待授权操作

自动审批拒绝临时授予 `dev-member` 开发者角色，理由为未明确授权该具体账号。已请求“临时设为开发者，验证保存后立即恢复用户”的许可；拒绝之后没有通过其他接口执行。此项不阻止已实现代码的门禁与授权发布准备，但真实改权验收仍待答复。并行 RFC-010 的 Kubernetes RBAC 扩权由其原任务处理，未在本 RFC 中绕过。
