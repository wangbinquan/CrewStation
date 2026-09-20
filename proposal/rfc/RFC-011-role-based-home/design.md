# RFC-011｜技术设计

> 状态：Approved / Implementing；产品来源和能力影响见 [proposal.md](./proposal.md)。实现与实际验证范围见 [acceptance.md](./acceptance.md)。

## 目录

- [1. 落位与依赖](#1-落位与依赖)
- [2. 角色契约与迁移](#2-角色契约与迁移)
- [3. 服务端授权](#3-服务端授权)
- [4. 自助创建](#4-自助创建)
- [5. 市场与试用投影](#5-市场与试用投影)
- [6. 前端与登录落点](#6-前端与登录落点)
- [7. 失败模式与验证](#7-失败模式与验证)

## 1. 落位与依赖

已读 `docs/engineering/repository-structure.md`；不新增模块、不改变 layer，不需要 ADR。

| 单元 | 层／职责 | 预期改动 |
|---|---|---|
| `packages/contracts/api` | 唯一跨进程契约 | 平台角色枚举、用户 DTO、角色变更、自建输入与应用试用 DTO |
| `modules/identity` | L1；拥有用户资料 | 角色持久化、迁移标记、角色变更用例；通过 ports 查负责人／成员关系，不读 project 表 |
| `modules/project` | L2；项目与对象级授权 | 开发资格与成员资格联合判断，开发列表过滤，自建项目，目标成员资格；项目关系公开查询 |
| `modules/capabilities` | L6；说明与展示聚合 | 面向使用者的市场信息及获授权的试用摘要；复用有界聚合，不在前端拉取全平台项目 |
| `modules/provisioning` | L6；开通编排 | 复用现有 project.created 流程；本人项目失败重试的明确权限 |
| `modules/session`／`dev-session`／`task-runtime` | 既有流与开发接口 | 确认所有访问经集中授权；现有连接与回放在角色撤销后停止访问 |
| `modules/platform` | L7；组合根 | 连接角色／成员端口；在既有 migrate 入口编排一次性数据回填；内部 SYSTEM_ACTOR 保留原服务职责 |
| `apps/console/src/app` | 路由与布局 | 用户、项目开发、平台管理三种布局与守卫；顶栏入口与默认落点 |
| `apps/console/src/features` | 各功能内聚 | capabilities 市场与试用、projects 自建与列表、admin 角色编辑；不得 feature 互相 import |
| `apps/console/src/shared` | 共享叶子 | 角色显示与路径纯函数、既有 UI 复用；不 import 后端模块或 app |
| `packages/api-client`、`apps/cli`、`tools/dev-auth` | API 消费者／开发工具 | 契约同步、三类平台角色、默认市场落点和 tester 验证视角 |

复用 `Card`、`Stack`、`ActionRow`、`Button`、`PageHeader`、`FormField`、`QueryStatus`、`EmptyState`、`ConfirmationPanel` 与主题变量。
本 RFC 承担把“管理员布尔值决定全局界面”收敛到统一平台角色判断；不重写项目内部菜单或新增并行权限系统。
新代码按职责放进已有目录；触及目录达到 20 个源文件时，按角色／创建主题拆子目录，不平铺万能 facade。

## 2. 角色契约与迁移

### 2.1 唯一角色源

新增 `PlatformRoleSchema = enum(user, developer, admin)`；`identity.users.platform_role` 为持久化的唯一平台角色源。
`UserDto`、`CurrentUserDto` 返回 `platformRole`；`isAdmin` 暂保留为 `platformRole === 'admin'` 的只读兼容投影，禁止独立写两份权限。
项目 `MemberRole` 的 owner／developer／tester 含义不变。内部授权输入携带可信平台角色，外部 body/query/header 不作为角色来源。
同步修订 Actor 工厂与必要的内部测试 fixture；SYSTEM_ACTOR 是内部编排身份，不能通过用户请求构造。

新增 `PUT /v1/users/:userId/platform-role`，请求 `{ platformRole, expectedRole }`，只接受管理员，返回新的 `UserDto`。
`expectedRole` 不匹配返回 409，页面保留目标选择并要求重读。旧 `/v1/users/:id/admin` 兼容入口映射为 admin／user，走同一用例、同样的前置校验；第一方页面与 dev-auth 全部改用新接口。
角色写入事务校验最后管理员；降级负责人需经 project 公开端口列出待转交项目，再给出可操作的阻塞原因。
负责人转交／添加开发成员／角色降级按同一目标 userId 采用共享数据库协调锁，角色变更的检查与写入期间持续持锁；不能用先查后写的一次预检查代替竞态保护。
锁的技术适配由 persistence 的通用按键锁承载，identity／project 经各自 ports 使用，platform 装配相同锁键；业务写入仍各自归本模块事务，不跨 schema SQL 事务。最后管理员校验、成员资格变更与创建统一串行短暂的全局角色协调键，并按固定顺序取得目标用户键；争用用非阻塞 advisory try-lock，失败后释放事务连接再重试，最多 1.5 秒返回冲突。这样不同创建者不会各持一条连接再同时等待业务事务而耗尽连接池。两连接池／四创建者回归与角色降级竞态均覆盖此约束。
平台身份由 identity 的最新角色计算；OIDC 再次登录仅更新个人资料，不覆盖管理员设置的角色。旧 admin-email 引导策略与首位管理员逻辑按现有语义保留。

### 2.2 既有数据迁移

按 C7 随 RFC 批准的迁移规则执行。建议规则：旧 `is_admin=true` → admin；其他有 owner／developer 项目关系的账号 → developer；其余 → user。
新账号直接存 user，不把以后新增的项目关系当作自动升级来源。

迁移 SQL 只操作 identity schema：增加角色与“已初始化”标志，用旧管理员标记初始化管理员；历史非管理员暂标为未初始化，新账号默认已初始化。
在现有平台 migrate Job 的 SQL 完成后，通过 L7 编排调用 identity 的内部回填用例；其经 `MembershipLookup` 端口查询 project 公开 API，再在 identity 本地事务以未初始化条件更新。
分批、有游标、可重试并汇报转换数量；全量完成后才能开放新版流量。显式角色写入同时标记已初始化，重跑不会把已降级账号再提升。
不在低层迁移里跨 schema join，不在每次登录时从成员关系重新赋予开发者角色，不通过删账号或重新播种迁移。
完成后旧 `is_admin` 仅作迁移历史资料，不再读取为权限源；未来物理删除可独立清理，不引入双写。

## 3. 服务端授权

### 3.1 两层资格

1. 市场与应用使用按既有应用可见性和业务域规则；不得因新增平台开发门槛破坏普通用户的应用访问。
2. `develop`／`publish`／项目 view／项目设置等先要求平台 developer 或 admin，再校验项目成员动作表；admin 保留现有全局权限。
3. `view-preview` 单独按试用资格判定。用户有 tester 关系可访问；普通 user 即使保留旧 developer 关系也不重新获得开发权限。
4. developer 全局身份不授予任何无成员关系的项目；非成员沿用 404，不改成暴露对象存在的错误。
5. 接入容器的开发、创建和管理仍限 admin；普通开发者的列表仅 DigitalWorker。

集中在 project 的授权用例和查询边界实现，不能只改 console。`listProjects`、分页列表、批量读取、项目摘要及过滤游标均纳入。
开发目录先按角色和项目关系过滤，再搜索／状态过滤／分页；游标包含平台角色和作用域版本，降级后旧游标失效。
为应用试用保留独立、最小投影，不通过开放原完整项目查询绕过新边界。
成员添加／负责人转交要求目标为 developer/admin；tester 可以是任一平台角色。原成员存量不被静默删除。

### 3.2 已打开页面和连接

HTTP、CLI、MCP 的用户路径均复用服务端授权；服务身份业务任务继续走既有 ServiceActor，不把业务运行误判成用户开发操作。
浏览器 WS 的连接建立、输入命令、回放／实时帧发送前核对最新身份与项目授权；允许同批帧共享一次校验，不跨批保留永久授权。
降级／移除关系后停止继续传送与派发并断开，返回可辨认的权限原因；不结束项目中的其他 Agent，也不删除共享开发卷。
由服务端决定下一次操作是否许可；前端身份刷新仅负责及时隐藏导航、暂停操作和展示恢复路径。
对已发出且成功接受的开通／发布后台作业，不伪造撤销；保留真实作业状态，后续新操作按新权限判断。

## 4. 自助创建

继续使用 `POST /v1/projects`，由服务端按角色选择输入校验，不新增另一套开通链。

- user：403，无项目／服务／成员／配额／事件写入。
- developer：仅 DigitalWorker；`ownerUserId` 可省略，存在则必须等于本人；服务端固定本人为 owner。
- developer 自建仅收 name、slug、template；`kind` 可省略或为 DigitalWorker；不接受 plan／maxConcurrentTasks 等资源覆盖。模板必须是数字人可用模板。
- admin：原代建契约保留；项目开发中的简洁创建采用本人和平台默认资源，管理中的代建可选负责人和既有资源字段。负责人须具备平台 developer/admin。

严格校验未知与禁止字段，返回明确字段错误；不要静默忽略伪造 owner／kind／资源值。
默认套餐、任务额度与模板资料来自平台已有配置；缺省配置不可用时在创建前说明原因，不伪造默认值。
开发者表单不读 `/v1/users`，仅获取当前用户和允许的模板／只读默认配置投影。必要时在 project 的既有目录接口增加有界自建目录响应，管理员配置字段不外泄到表单。
保留单事务创建项目、服务、owner、配额与 project.created；201 只代表创建已受理，开通进度单独读取。
创建返回 `/projects/:id/provisioning`，成功后进入本项目；同对象失败重试允许 owner/admin，普通 developer 成员不获得平台重新开通权。
客户端重复点击只发一次；网络回执未知时先按返回 ID 或本人 slug 查询确认，不无脑重发建仓。错误保留原输入。

## 5. 市场与试用投影

现有 market API 可继续返回版本信息供其他客户端使用；console 的用户卡片和详情不渲染 commit、部署槽及 canDevelop/canConfigure 对应动作。
正式应用打开动作由服务端已确认的正式 host 和当前状态决定；成员试用的 Beta 卡片使用获授权的试用 host。未知、暂停、未准备好、不可见分开处理。
市场列表增加面向使用的最小 `entry` 投影：`kind=production|trial`、状态与经过校验的 host；只有实际无正式版本且具有试用资格时 `kind=trial`，渲染 Beta。
不能把正式状态 unknown 推断成“未发布”并改开试用域。没有试用资格不返回试用 host；Beta 可见性与资格在响应前复核。
有正式版本时卡片保持 production，详情可另查已获授权的 Beta 试用版本。成员关系包括 owner／developer／tester，不改变平台开发门槛。
若某页聚合后只有不该展示的未发布项，保留合法 nextCursor，展示继续查询而非宣称“平台没有应用”；不得先拿全平台项目再在浏览器过滤。

新增专用 `GET /v1/market/apps/:projectId/trial`（与现有 marketRoutes 前缀一致）：
先判应用可见，再判 `view-preview`，只返回应用名、试用 host、版本、可用状态、检查时间和“共用业务数据”提示。
用户没有试用资格时不发该查询、不展示试用链接；绕过 UI 的请求仍拒绝。后端不借此返回项目设置／成员资料或开发任务。
可用资格由市场详情的最小 `canPreview` 字段表示；首页 Beta 卡片直接“试用应用”，在必要的数据提醒后打开试用域，不强制再进详情。聚合结束前复核可见性和权限，保持现有最多四并发、有界等待及明确 unknown 行为。
旧 tester 项目链接经身份／试用资格核对，replace 到 `/market/:projectId` 的试用区域；不挂载项目内部页面。

## 6. 前端与登录落点

| 地址 | 空间 | 门槛 |
|---|---|---|
| `/`、`/market`、`/market/:projectId` | 应用 | 已登录，并按应用可见性 |
| `/projects`、`/projects/new` | 项目开发 | developer/admin |
| `/projects/:id/*` | 项目开发 | 平台开发资格 ＋ 项目关系；旧 tester 链接先迁移 |
| `/admin/*` | 平台管理 | admin |

布局统一生成允许的空间入口，CurrentUserChip 显示用户／开发者／管理员。市场无项目侧栏、Agent 菜单或技术请求；项目内部保留 RFC-008／009 布局。
从 TopBar 移除 AgentActivityMenu 与全局 toast；开发空间外不因历史注册记录继续轮询活动。NativeWorkspace、NativeTerminalCard 的状态／待处理／完成定位仍使用原 store，身份变化时按新权限清理订阅，不删除底层运行事实。
新增 DeveloperGuard 覆盖列表、创建和项目路由；AdminGuard 沿用三态行为并按 platformRole。未知身份和读取错误不降级当 user 或回用过期的管理员入口。
品牌首页固定回市场；返回上次位置仅发生在用户主动切空间，并在跳转前验证仍有权限。无目标登录统一市场；显式合法深链接保留。
dev-auth 默认提供三类平台角色，测试者保留为 user ＋ tester 的附加测试视角；不再把它当第四类平台角色。
授权保存使 users 与 me 缓存失效；每次激活页面／提交／连接时重核身份。角色失效不抹掉草稿，停止写入并提供复制和返回市场。
中英文文案按 feature 分文件，语义与入口一致；320／390px 顶栏换行且导航可见，不以图标代替唯一标签。

## 7. 失败模式与验证

| 场景 | 预期行为／证据 |
|---|---|
| 用户伪造 URL／创建 body／WS 帧 | API 拒绝，无副作用；页面给返回市场动作 |
| 平台开发者没有项目关系 | 查不到项目，不能读摘要或开会话 |
| 角色保存 409／403／网络错误 | 保留角色选择、显示原因；核对最新身份后重试 |
| 负责人或最后管理员降级 | 清楚说明阻塞对象／原因，不写一半角色 |
| 迁移中断或重跑 | 已初始化账号不覆盖；无跨 schema SQL；未完成不得当作迁移成功 |
| 自建资源字段、他人 owner、接入 kind | 字段级拒绝，创建计数、outbox、仓库开通事件均不增加 |
| 创建已受理但开通失败 | 项目 ID、步骤、原因、状态保留；仅本人负责人／管理员可重试 |
| 降级现存会话 | 新 HTTP／CLI／WS 输入和后续帧停止，业务应用仍按原规则可访问 |
| 市场读取异常／应用被撤回 | 无技术子页面回退；unknown／空／无权限／错误明确区分 |
| 测试者旧链接 | 去应用侧试用，测试权限和数据提示保留，不执行开发查询 |

测试由 contracts、identity、project、capabilities、session 与真实 console 路由分层承担；与三角色实机路径、访问拒绝、创建开通和权限变更证据共同验收。
任何实现缺口不得以只隐藏按钮、原型演示或测试 mock 通过代替。
