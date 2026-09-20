# RFC-014 技术与交互设计

状态：In Progress · 2026-09-20 作者已授权完整实现、验证与提交上库。

## 1. 依据与边界

核对基点：本地 `main` 的 `d99b16e13cba979d1aab88fa1936e9e286ee35fe` 与当前工作树，2026-09-20 已 fetch，初次比较本地领先远端 1 笔。共享树存在 RFC-011 首页、路由、测试及 RFC-013 文档在制品，均不属于本 RFC。

| 当前事实 | 当前源码 |
|---|---|
| 用户 DTO 只有 ID、姓名、邮箱、平台角色和管理员标记 | `packages/contracts/api/identity.ts:22` |
| 用户列表是完整 items，角色更新带 `expectedRole` | `packages/api-client/resources/users.ts:16`、`features/admin/components/roles/UserRoleEditor.tsx:14` |
| 认证页三个卡片同时挂载 | `apps/console/src/features/admin/pages/AdminAuthenticationPage.tsx:11` |
| 接入方编辑空密钥不发出，空可选字符串转换 null | `apps/console/src/features/admin/components/auth/ProviderForm.tsx:59` |
| 表单当前复用契约逐字段校验并聚焦首个错误 | `apps/console/src/features/admin/model/providerValidation.ts:17`、`components/auth/ProviderForm.tsx:167` |
| 探针返回结构化诊断，当前前端拼成一行 | `packages/contracts/api/auth/oidc.ts:97`、`components/auth/ProvidersCard.tsx:19` |
| 转发字段及每项目覆盖已有 API；管理员可读项目目录 | `packages/api-client/resources/auth.ts:30`、`packages/api-client/resources/projects.ts:16` |

上表中省略前缀的 `components/` 位于 `apps/console/src/features/admin/`，`features/` 位于 `apps/console/src/`，落地前复核当前行号。基线为 RFC-003 管理空间与 RFC-005、RFC-011 行为，不追加后端语义。

## 2. 信息与视觉层级

- 页面标题 22px，分组标题 15px，正文 14px，辅助信息 12px。产品实现引用 `app/theme/tokens.css`，不在业务 CSS 内写裸色值。
- 主内容保持现有 1200px 上限；标准行约 64–72px，列表内只有水平分隔线。卡片标题、描述、内容间距由父布局统一承担。
- 主动作使用现有蓝色按钮；普通查看与配置用次按钮或带文字的轻按钮。危险色只出现在确认／错误区域，正常列表不放红色删除按钮。
- 所有同类图标 16px，同一描边风格；仅头像使用姓名首字，不用 emoji、盾牌大插画或装饰性渐变。角色用文字区分，状态用文字＋小标记区分，不能只靠颜色。
- 长地址在目录里保留主机等可读摘要；配置／诊断允许换行展示完整值并提供复制。ID 仅在需消歧或查证的位置展示完整值，按不透明字符串处理，不参与 RFC-013 格式迁移。
- 两页均复用 `PageHeader`、`Card`、`Button`、`Badge`、`DataTable`、`FormField`、`Tabs`、`ActionRow`、`QueryStatus`、`ActionNote`、`ConfirmationPanel` 和 `UnsavedChangesGuard`。接入方编辑是页面内视图，不引入新的 Dialog 库。

## 3. 用户目录与角色编辑

`q` 和 `role` 作用于现有用户列表；空邮箱显示「未提供邮箱」。用 ID 作 React key，重名账号在编辑面板显示完整 ID。当前账号由 `me.id` 比较，不以姓名或邮箱判断。

点击管理角色后只挂载一个编辑器；其他行保持只读。桌面可在目录右侧展开，宽度不足时同位置纵向展开；焦点进入第一个角色选项，关闭后回到触发按钮。三个 radio 选项展示名字与说明，不把点击选择解释为提交。

状态为：浏览 → 编辑草稿 → 检查变更 → 提交中 → 成功或失败。成功后更新用户和当前身份查询；当前账号失去管理权限时按原守卫退出。提交中禁止重复提交。409 时保留用户选择，提供显式重读，展示最新旧值与待选新值，再次确认。最后管理员、负责人降级等失败按现有服务端原文展示，不给未经实现的禁用理由。

## 4. 登录方式与接入配置

页面标签映射为 `/admin/authentication?tab=methods|fields`，无参数和非法参数回到 `methods`。只有界面定位信息进入 URL，表单内容与密钥不能进 URL 或本地存储。返回列表保留当前页签；离开未保存编辑先用仓库具名行内确认。

登录方式列表每项包含：名称、标识、Issuer、账号创建规则、启用状态，及配置和连接测试。探针结果绑定 provider ID 与本次请求；失败不得继续显示旧成功。保存配置后将之前的探针置为过期。前端只记录本次检查时间，不虚构服务端历史、登录人数或最近登录时间。

接入方编辑的字段完整映射如下。每组在进入时显示所有字段标签、必填／选填标记、约束与默认语义。高级手工端点可折叠，但组入口明确列出其内容；新建的所有必填约束在基本信息区可见。

| 分组 | 现有请求字段 |
|---|---|
| 基本信息 | `slug`、`displayName`、`issuerUrl`、`clientId`、`clientSecret`、`scopes`、`enabled` |
| 连接设置 | `authorizationEndpoint`、`tokenEndpoint`、`userinfoEndpoint`、`jwksUri`、`userinfoRequestStyle` |
| 账号规则 | `provisioning`、`allowedEmailDomains`、`trustEmailVerified` |
| 字段映射 | `usernameClaim`、`gitNameClaim`、`emailClaim`、`subjectClaim`、`claimMappings` |

`iconUrl` 当前 UI 不支持配置且一直提交 null，本次不新增图标上传。`slug` 编辑时不可变。`clientSecretSet` 呈现「已设置」；空输入仍表示保留，不填入伪装的星号值。用户名和 Git 名允许按序多个字段；所有空值、范围与保留键限制沿用当前 Schema。

自定义映射由每行「平台字段名 ← 身份来源字段」组成；新增／删除映射行属于表单草稿，仍转成原 `claimMappings` 数组。保留最多 20 项与字段约束，非法字段逐行报错。

任何保存均校验完整 draft；跨组错误显示组内数量并切至第一个错误所在组，展开错误所在区域并聚焦。网络失败保留全部非密钥草稿；密钥仅留在当前组件内存中，离开编辑即销毁。错误信息不得包含输入密钥。

密码登录仍用显式开启／关闭按钮与原确认流程。生效值为 `forcedOn || passwordLoginEnabled`；强制配置、密码会话、无已启用提供方都显示现有原因。初始化完成显示「初始化已完成」，原引导令牌状态放进展开详情。

## 5. 身份字段

页面解释为「应用可以获取哪些用户信息」；固定 user ID 与身份令牌显示只读说明。默认字段表保留 name、email、git-name 及自定义候选、来源、状态与单项操作。停止某字段仍先确认，不将视觉开关直接绑定写 API。

「项目例外」默认是只读列表和添加按钮，添加后才挂载表单。项目候选来自现有管理员项目目录，以项目名为主、完整 ID 为副。项目读取失败提供重试；已经配置但目录不可读／已不在列表里的项目继续显示其完整 ID，不能悄悄丢掉覆盖。

候选字段以原生 checkbox 多选，提交仍为 `fields: string[]`；明确区分「使用全局默认」「自定义且为空」。选择空集合时显示「此项目不接收可选身份字段；用户 ID 与身份令牌仍会传递」，仍允许保存。删除覆盖文案为「恢复全局默认」，确认后执行原 DELETE。

最长 5 分钟生效的提示保留；先前文案中「立即停止」与该时效冲突，应统一为「设置将更新，最长 5 分钟生效」。未知或已移除的映射字段要显示原 key 并允许移除，不能在保存其他字段时无声丢弃。

## 6. 代码落位与契约

全部实现属于 `apps/console` 的 `features/admin`；不增业务模块、不扩大 import 权限。

| 位置 | 责任 |
|---|---|
| `pages/AdminUsersPage.tsx`、`components/UsersSection.tsx` | 页面装配、目录查询 |
| `components/roles/` | 目录工具栏、用户身份展示、单用户角色编辑与 CSS module |
| `pages/AdminAuthenticationPage.tsx`、`components/auth/` | 两标签装配、登录方式列表、状态摘要 |
| `components/auth/provider/` | 四组表单、映射编辑、诊断明细；提前分子目录避免单目录超过 20 个源码文件 |
| `components/auth/forwarding/` | 默认字段与项目覆盖表单，复用现有 auth 和 projects API |
| `model/` | 现有验证器、目录筛选和字段分组的纯逻辑 |
| `i18n/auth.zh-CN.ts`、`auth.en-US.ts` 与 admin 角色文案 | 业务文案与错误 |
| `shared/ui/` | 只在缺少通用表现时向后兼容扩展；若新增原生勾选行／radio 组，先独立建立复用组件及测试 |
| `src/tests/` | 两页的状态、草稿与交互回归 |

继续使用 `api.users`、`api.auth`、`api.projects` 与原 queryKeys；不增 HTTP 路由、不改 Schema／migration／contracts lock。不从其他 feature import。布局样式只属于页面／局部组件，不修改全局主题或全局侧栏。

## 7. 响应式与可访问性

1280／1024px 检查桌面目录密度；768px 下角色面板转为纵向；390／320px 用户行和接入方行纵向排列，操作换行，完整 URL 可断行。页面无横向溢出，复制／删除／取消不依赖 hover。

使用真实 label、radio、checkbox 和 tab 语义；标签可用方向键，焦点可见。切分组保持值，验证后 focus 首错，提交反馈用 aria-live。320px 不挤压文字至不可读；明暗与中英文都验。原型展示主流程，正式实现还需完成全部错误和辅助技术用例。
