# RFC-005｜OIDC／OAuth 2.0 公司登录：管理员配置身份提供方，引导管理员接管，常规登录由 OIDC 管理员关闭

> Draft · 2026-09-18 待作者批准。产品规则全部来自作者 2026-09-18 会话裁定（§2）；按开发规则 §5.3，批准前不写代码。

## 1. 背景与依据

基线把「公司 SSO 与网关鉴权前置的接入模式」列为待决项 Q01，退出条件是「获得实际接入材料并跑通；否则仅演示身份」（[design.md §15.3](../../design.md)）；技术栈表里用户身份一栏已写定「OIDC 对接公司 IdP」（同文件 §3）。

代码侧留了位置，但一步没走：

- 登录适配是端口 `IdentityProvider`（[ports/identityProvider.ts](../../../modules/identity/ports/identityProvider.ts)），唯一实现是演示适配器，它自己的注释就写着「正式环境由 OIDC 适配器替代」（[demoIdentityProvider.ts:12](../../../modules/identity/adapters/provider/demoIdentityProvider.ts#L12)）。
- 契约里 `IdentityProviderKindSchema` 已含 `'oidc'`（[api/auth.ts:15](../../../packages/contracts/api/auth.ts#L15)），安装配置里有 `identityProvider: 'demo' | 'oidc'`（[platformSettings.ts:65](../../../packages/settings/platformSettings.ts#L65)），但**没有任何代码读它**：组合根写死了演示适配器（[platform/wiring.ts:86](../../../modules/platform/wiring.ts#L86)）。
- 首位管理员靠「首个登录者或 `CS_ADMIN_EMAILS` 命中」产生（[domain/user.ts:14](../../../modules/identity/domain/user.ts#L14)）。演示登录不校验任何口令，填任意用户名即成为该用户，公司环境里不可用。

作者 2026-09-18 指示：把 `~/dev/proj/agent-workflow` 的 OIDC／OAuth 2.0 认证能力搬进来，**配置界面的配置项与它完全一致**，以便接入公司内部系统；接入后原登录方式失效；**整个系统初始化逻辑与 agent-workflow 一致**；并明确「没有存量系统，直接断代开发」。

被借鉴的实现（该仓库只读，任何情况下不写入）：`packages/backend/src/auth/oidc/{discovery,endpoints,tokens,identity,flow}.ts`、`routes/{oidc,oidc-auth}.ts`、`services/oidcProviders.ts`、`services/oidc/provisioning.ts`、`shared/src/schemas/oidcProvider.ts`、`frontend/src/routes/settings.tsx` 的 `AuthenticationTab` 与 `OidcProviderDialog`，对应它的 RFC-036、RFC-220、RFC-221（D5／D6）、RFC-320、RFC-335。

## 2. 作者裁定（2026-09-18）

| # | 裁定项 | 结论 |
|---|---|---|
| A1 | 初始化逻辑 | 完全照搬 agent-workflow，含本地用户名＋密码账户：引导令牌 → 创建首位管理员 → 令牌永久退役 → 再配置 Provider |
| A2 | 原登录方式失效 | 常规（用户名＋密码）登录**由经 OIDC 登录的管理员手动关闭**；不做「存在启用 Provider 即自动失效」 |
| A3 | 开通策略 | 只做 `auto` 与 `allowlist`，不做 `invite` |
| A4 | 存量数据 | 没有存量系统，断代开发：不写迁移兼容、不做按邮箱认领 |
| A5 | 演示登录 | 整条删除 |
| A6 | 多 Provider | 并存，与 agent-workflow 同形：各自 slug，登录页列出全部启用项 |
| A7 | IdP 全不可达时的破窗口 | 安装配置强制开关（ConfigMap）＋ 重启 cs-auth |
| A8 | IdP 带回的身份信息 | **先全部留在平台**；不注入开发容器的 git 身份。平台可配置**哪些字段转发给业务** |
| A9 | 转发配置粒度 | 全局默认一份，**可按项目覆盖** |
| A10 | 可转发字段集 | 可扩展：除四个固定字段外，管理员可把 userinfo 的任意字段映射成转发项 |
| A11 | 身份令牌声明 | 与明文头**同步裁剪**：关掉的字段在令牌声明里也没有 |
| A12 | 不同 Provider 之间的隔离 | 只是**账户不合并**：用户唯一键为（Provider, subject），不做手工绑定、不做认领；项目与可见性不按 Provider 分区 |

A2 取代本轮早先一次「自动失效、无开关」的答复：作者随后明确「常规登陆方式需要由 OIDC 的管理员手动关闭」，本 RFC 以后者为准。它同时关掉一个死锁——只有已经证明能经 OIDC 进来的管理员才能关掉密码登录，因此该动作不可能把所有人锁在门外。

## 3. 目标

- **G1** 管理员在工作台管理空间配置任意多个 OIDC／OAuth 2.0 身份提供方，配置项与 agent-workflow 的 Provider 表单逐项一致（§6.3），含「测试连接」诊断。
- **G2** 用户在登录页点 Provider 按钮完成 Authorization Code＋PKCE 登录，回来即持有平台会话，后续与今天完全一样（`cs_session` Cookie → 网关 ForwardAuth → 注入身份头与身份令牌）。
- **G3** 支持纯 OAuth 2.0（无 `id_token`、无 discovery、非标 userinfo）的公司平台：手工端点、`userinfo` 请求风格、`subjectClaim`／`usernameClaim`／`emailClaim`／`gitNameClaim` 选择器、邮箱可信开关。
- **G4** 全新安装的初始化与 agent-workflow 一致：引导令牌只能创建首位管理员，创建成功即在同一事务里置完成态并让令牌永久退役。
- **G5** 常规登录可由经 OIDC 登录的管理员关闭，后端强制，旧页面或脚本绕不过。
- **G6** 开通策略 `auto`／`allowlist` 落库并在回调时裁决；被拒绝的登录给出确定原因页。
- **G7** 平台侧无任何长期明文凭据：`client_secret` 以现有 `packages/secretbox`（AES-256-GCM）封存，API 只写不读。
- **G8** 本机可做实机验收：自带最小 mock IdP，覆盖标准 OIDC、纯 OAuth 2.0 与非标 userinfo 三种形态。
- **G9** 身份信息的外发由平台管控：IdP 档案全量留在平台，网关只注入被明确允许的字段（全局默认＋按项目覆盖），明文头与令牌声明同步裁剪，能力说明页展示的是**实际生效**的转发集而不是静态常量表。

## 4. 非目标

- 不做单点登出（RP-initiated logout）。与 agent-workflow 一致，`/auth/logout` 只清会话 Cookie。
- 不做 `invite` 开通档、不做用户邀请／停用／改资料（A3）。
- 不做自助解绑外部身份，也不做管理员解绑入口。
- 不做个人访问令牌、不改项目角色模型、不改服务域身份（源 Pod IP 反查）。
- 不做 SCIM、不做组同步、不把 IdP 的组映射成平台角色。
- 不引入 `oidcDefaultRole`（guest／user）：本仓没有这个角色维度，只有平台管理员标记与项目级角色。
- 不做迁移兼容与数据认领（A4）。
- 不把 IdP 档案注入开发容器的 git 身份（A8）。本轮只把 Git 名存进平台并作为可转发字段之一；容器内 git 身份留给后续 RFC。
- 不做 realm 级隔离（A12）：不按 Provider 分区项目、成员与能力市场的可见性。

## 5. 登录生命周期

```text
① 安装完成                     登录页只有「引导令牌」
   bootstrapCompletedAt = NULL  密码登录与 OIDC 一律 403 bootstrap-admin-required
        ↓ 令牌校验通过 → 创建首位管理员向导（用户名／显示名／密码／确认，邮箱必填）
        ↓ 单一事务：插入管理员 + 置 bootstrapCompletedAt + 强制 passwordLoginEnabled=true
② 仅常规登录                   登录页只有用户名＋密码；引导令牌永久失效（HTTP 与 WS 同时 401）
        ↓ 管理员配置并启用 ≥1 个 Provider
③ 常规登录 ＋ OIDC 并存         登录页同时给出密码表单与每个启用 Provider 的按钮
        ↓ 某人经 OIDC 登录建档 → 现任管理员在用户目录标记其为管理员（或邮箱命中 CS_ADMIN_EMAILS 直接是管理员）
        ↓ 该 OIDC 管理员在「管理空间 → 认证」关闭常规登录
④ 仅 OIDC                      密码表单不渲染，POST /auth/login 固定 403 password-login-disabled
        ↓ 需要回退时：同一位置重新打开（仍要求 OIDC 管理员）；IdP 全挂时用 A7 的安装配置强制开关
```

②→③→④ 每一步都可逆（④→③ 由 OIDC 管理员重开），①→② 不可逆。

## 6. 管理界面

落位 `/admin/authentication`，进管理空间「平台设置」分组（`AdminNav` 的 `ADMIN_GROUPS`），复用 `apps/console/src/shared/ui`；禁 `alert`／`confirm`，确认一律 `InlineConfirm`（开发规则 §7）。

### 6.1 登录方式卡

| 项 | 形态 | 规则 |
|---|---|---|
| 用户名与密码登录 | 开关 | 默认开。关闭要求三条同时成立：调用者是平台管理员、**当前会话由 OIDC 建立**、至少一个启用的 Provider。任一不成立，开关禁用并说明缺哪一条 |
| 引导令牌 | 只读状态 | 「待接管」或「已退役」，与 agent-workflow 的 bootstrap 状态行同义 |
| 当前会话认证方式 | 只读 | 密码／OIDC(provider 显示名)；这是「为什么现在不能关」的直接解释 |

关闭是 breaking 动作，用 `InlineConfirm` 二次确认，文案写明「关闭后只能经 <Provider 列表> 登录；恢复需要一位经 OIDC 登录的管理员，或由运维改安装配置重启 cs-auth」。

### 6.2 身份提供方列表

列：slug（等宽）、显示名、Issuer、开通策略、启用状态、操作（编辑／删除）。空态引导新建。删除有 `InlineConfirm`；常规登录已关闭时，最后一个启用 Provider 不可停用、不可删除（后端同样拒绝）。

### 6.3 Provider 表单：与 agent-workflow 的配置项对齐

四组分区与 agent-workflow 的 `OidcProviderDialog` 同序同组，字段逐项对齐：

| 分区 | 配置项 | agent-workflow 字段 | 本仓 | 说明 |
|---|---|---|---|---|
| 提供方 | 标识 slug | `slug` | 保留 | `^[a-z0-9][a-z0-9-]{0,63}$`；出现在回调地址里 |
| 提供方 | 显示名 | `displayName` | 保留 | 登录页按钮文字 |
| 提供方 | Issuer 地址 | `issuerUrl` | 保留 | discovery 取 `<issuer>/.well-known/openid-configuration` |
| 手工端点 | 授权端点 | `authorizationEndpoint` | 保留 | 可空；与 discovery 逐字段合并 |
| 手工端点 | 令牌端点 | `tokenEndpoint` | 保留 | 同上 |
| 手工端点 | userinfo 端点 | `userinfoEndpoint` | 保留 | 同上 |
| 手工端点 | JWKS 地址 | `jwksUri` | 保留 | 同上 |
| 手工端点 | userinfo 请求风格 | `userinfoRequestStyle` | 保留 | `get_bearer`（标准）／`post_json`（体固定 `{client_id, access_token, scope}`、不带 Authorization 头） |
| 凭据 | Client ID | `clientId` | 保留 | |
| 凭据 | Client Secret | `clientSecret` | 保留 | 新建必填；编辑留空＝保持原值；API 只写不读 |
| 凭据 | Scopes | `scopes` | 保留 | 空格分隔，默认 `openid profile email` |
| 行为 | 开通策略 | `provisioning` | **两档** | `auto`／`allowlist`；`invite` 按 A3 不做 |
| 行为 | 允许的邮箱域 | `allowedEmailDomains` | 保留 | 逗号分隔、每项以 `@` 开头；仅 `allowlist` 时出现 |
| 行为 | 邮箱视为已验证 | `trustEmailVerified` | 保留 | 纯 OAuth 2.0 IdP 通常不给 `email_verified` |
| 行为 | 显示名字段 | `usernameClaim` | 保留 | 1–8 个字段名、空格分隔按序拼接；空＝标准 `preferred_username` |
| 行为 | Git 名字段 | `gitNameClaim` | 保留 | 同上；空＝跟随显示名。消费方见 §11 待确认 1 |
| 行为 | 邮箱字段 | `emailClaim` | 保留 | 单字段名；空＝标准 `email` |
| 行为 | 主体字段 | `subjectClaim` | 保留 | 单字段名；一经配置即切成「身份只来自 userinfo」模式，且已有关联身份后不可再改 |
| 行为 | 启用 | `enabled` | 保留 | 关闭即从登录页消失 |
| 底部 | 测试连接 | `POST /:id/test` | 保留 | 逐端点显示取自 discovery 还是手工、JWKS 是否可达、`scopes_supported`；始终 200 带诊断体 |

不做输入项、但保留在线上形状为 `null` 的字段：`iconUrl`（agent-workflow 的表单同样没有这个输入，固定发 `null`）。

表单另加一块 agent-workflow 没有的**自定义字段映射**（A10）：一张 `平台字段名 ← userinfo 字段名` 的小表，例如 `employee-no ← empNo`、`department ← deptName`。平台字段名受 `^[a-z][a-z0-9-]{0,30}$` 约束，因为它同时决定转发时的头名。映射只决定「平台记什么」，转发与否由 §6.4 决定。

### 6.4 身份转发卡（A8／A9／A10／A11）

同一页第三张卡，回答「业务能读到我的哪些信息」：

| 项 | 形态 | 规则 |
|---|---|---|
| 全局默认转发集 | 复选清单 | 候选＝用户 ID（固定必转，不可取消）、显示名、邮箱、Git 名，加上所有自定义映射字段 |
| 按项目覆盖 | 项目列表＋每项一份复选清单 | 未设置覆盖的项目用全局默认；覆盖可放宽也可收紧，逐项记录修改人与时间 |
| 生效预览 | 只读 | 对选定项目显示「网关实际会注入的头与令牌声明」，与能力说明页同一份数据 |

转发集只由管理员维护（身份数据外发属于平台治理，与「定向 API 开放由管理员批」同一分工）；项目负责人在项目页只读看到本项目的生效集。关掉一个字段不删平台侧的值，只是不再外发。

## 7. 用户开通与管理员

- **建档**：回调成功后按 `(provider, subject)` 查外部身份；命中即登录，未命中按策略裁决：`auto` 直接建档；`allowlist` 要求邮箱已验证（或 Provider 开了「邮箱视为已验证」）且域名命中，否则拒绝并给出 `email-not-verified`／`email-domain-not-allowed` 原因页。
- **管理员**：`CS_ADMIN_EMAILS` 命中的邮箱一建档即管理员（沿用现有规则）；其余由现任管理员在 `/admin/users` 标记。首位管理员由引导向导产生，**取消**「库里没有用户时首个登录者即管理员」这条（它在有密码引导之后既多余又危险）。
- **资料刷新**：每次成功登录按选择器重新解析显示名、邮箱与 Git 名并回写用户档案（与 agent-workflow 的 RFC-335 行为一致）。
- **本地账户**：只有引导管理员这一条本地密码账户来源；不提供新建本地用户的界面或接口。已关联外部身份的账户不能改密（`oidc-password-managed`）。
- **用户唯一键与隔离**（A12）：外部身份的唯一键是（Provider, subject）。同一个人在两个 Provider 登录得到两个账户，互不合并、互不认领；平台不提供手工绑定入口。除此之外不做任何按 Provider 的分区。
- **平台侧档案**（A8）：每次登录把解析出的标准字段（显示名、邮箱、邮箱是否已验证、Git 名）与全部自定义映射字段的值存进该条外部身份的档案，供管理面查看与转发使用。档案里的值不因某字段停止转发而删除。

## 8. 能力影响清单（breaking change，请逐项确认）

按开发规则 §5.5，本 RFC 关闭既有能力，逐条列出，每条都要有拒绝分支的测试：

| # | 被关闭的能力 | 影响面 | 替代 |
|---|---|---|---|
| B1 | 演示登录整条删除：`demoIdentityProvider`、`DemoLoginRequestSchema`、`demo:` 外部标识、`/v1/me.demoIdentity`、CLI 的「演示身份」告警 | 契约、identity 模块、api-client、CLI、`CS_IDENTITY_PROVIDER=demo` 安装项 | 本地开发与 e2e 改用引导管理员的用户名＋密码登录 |
| B2 | `identity.users.external_id` 取消，外部身份移到 `user_identities`（一个用户可有多条） | identity 模块内部（引用面只在该模块，已核） | 断代重建表，不写迁移（A4） |
| B3 | 「库里没有用户时首个登录者即管理员」取消 | `shouldBootstrapAdmin` | 引导向导产生首位管理员；`CS_ADMIN_EMAILS` 继续有效 |
| B4 | 未完成引导时，密码登录与 OIDC 登录一律 403 | 全新安装的所有登录入口 | 先过引导向导 |
| B5 | 常规登录关闭后 `POST /auth/login` 固定 403，登录页不渲染密码表单 | 旧页面、脚本、CLI 取会话的方式 | OIDC 登录；或 A7 的安装配置强制开关 |
| B6 | 已关联外部身份的账户不能改密／不能被重置密码 | 本地密码面（当前只有引导管理员） | 凭据归 IdP |
| B7 | `invite` 开通档不提供 | Provider 表单少一档，与 agent-workflow 不完全一致 | 作者已裁定（A3） |
| B8 | 不提供 `oidcDefaultRole` | 登录方式卡少一项 | 本仓无 guest／user 维度 |
| B9 | 业务不再保证收到 `x-cs-user-name` 与 `x-cs-user-email`：未被允许转发的字段**不注入该头**，令牌声明里也不出现 | 所有业务服务、两个槽与开发预览；最小样例页面读当前用户的那段 | 默认转发集包含显示名与邮箱，行为与今天一致；关掉是管理员的显式动作，界面写明影响 |
| B10 | 能力说明里的身份头不再是静态常量表 | 能力说明 MCP 与工作台能力页（`describeCapabilities`） | 改为展示当前生效的转发集；按项目查看时给该项目的有效集 |

## 9. 用户故事

1. **首次安装的运维**：装完拿到引导令牌（安装输出与 Secret 各一份），打开登录页只有一个令牌输入框；填入后进入向导，建出自己的管理员账户，令牌当场作废。
2. **平台管理员接入公司 IdP**：在「管理空间 → 认证」新建 Provider，只填 Issuer 与 client 凭据即可（标准 OIDC）；公司平台不给 discovery 时补四个端点、把 userinfo 改成 `POST JSON`、把主体字段设为 `id`；点「测试连接」看逐端点来源与可达性，再启用。
3. **公司员工登录**：在登录页点「公司统一身份」，跳到公司页面认证后回到工作台，直接看到自己的名字；他的账户按 `allowlist` 自动建档。
4. **管理员收口**：确认自己经 OIDC 能进来并且是管理员后，关闭用户名密码登录；登录页从此只剩公司入口。
5. **IdP 故障**：IdP 不可达时无人能登录；持有集群权限的运维改 ConfigMap 强制开关并重启 cs-auth，用引导管理员的密码进来停用 Provider，恢复后再关掉强制开关。

## 10. 验收标准

见 [plan.md](plan.md) 的验收案例表（`OA-01`…）。硬性要求：

- 每条拒绝分支（未完成引导、策略关闭、邮箱域不匹配、邮箱未验证、state 过期、nonce 不符、`userinfo.sub` 与已验证 `id_token` 不符、主体字段缺失、最后一个启用 Provider 不可停用、非 OIDC 会话不可关闭密码登录）都有自动化用例。
- `client_secret` 明文不出现在任何 GET 响应、日志、事件与前端；探针与错误页不回显。
- 本机实机：mock IdP 三种形态各跑通一次真实浏览器登录；关闭常规登录后旧登录页与脚本都拿不到会话；强制开关恢复路径实跑一次。

## 11. 明确推迟到后续 RFC 的两件事

1. **开发容器的 git 身份**：本轮按 A8 只把 Git 名存进平台并列为可转发字段；容器内 `GIT_AUTHOR_*`／`GIT_COMMITTER_*` 的注入不在本 RFC。
2. **realm 级隔离**：按 A12 只做账户不合并；若将来要按 Provider 分区项目与可见性，需要动项目与成员模型，另立 RFC。
