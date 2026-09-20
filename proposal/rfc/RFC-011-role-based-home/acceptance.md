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

## 待授权操作

自动审批拒绝临时授予 `dev-member` 开发者角色，理由为未明确授权该具体账号。已请求“临时设为开发者，验证保存后立即恢复用户”的许可；拒绝之后没有通过其他接口执行。此项不阻止已实现代码的门禁与授权发布准备，但真实改权验收仍待答复。并行 RFC-010 的 Kubernetes RBAC 扩权由其原任务处理，未在本 RFC 中绕过。
