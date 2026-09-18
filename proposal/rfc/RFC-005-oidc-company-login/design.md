# RFC-005｜设计

> Draft · 2026-09-18。落位先读 `docs/engineering/repository-structure.md`（开发规则 §5.4）；本文的每处现状断言都给出 `文件:行号`。

## 1. 现状与断点

| 现状 | 位置 | 断点 |
|---|---|---|
| 登录适配只有演示实现，端口只有 `loginPage`／`handleLogin` 两个方法 | [ports/identityProvider.ts](../../../modules/identity/ports/identityProvider.ts) | 没有「跳转到 IdP → 回调换码 → 取身份」这条两段式流程的位置 |
| 未配置适配器时 `/auth/*` 一律 503 | [http/authRoutes.ts:16](../../../modules/identity/http/authRoutes.ts#L16) | 登录方法不是数据，是进程启动参数；管理员改不了 |
| `users.external_id` 唯一，一人一条外部身份 | [migrations/0002_users.sql:3](../../../modules/identity/adapters/persistence/migrations/0002_users.sql#L3) | 多 Provider 需要一人多条身份 |
| 会话 JWT 只带 `cs_kind: 'session'` | [application/sessionTokens.ts](../../../modules/identity/application/sessionTokens.ts) | 无法判断「这次会话是密码还是 OIDC 建立的」 |
| ForwardAuth 注入四个身份头 | [http/forwardAuthRoutes.ts](../../../modules/identity/http/forwardAuthRoutes.ts)、[40-gateway.yaml:11](../../../deploy/k8s/platform/40-gateway.yaml#L11) | cs-api 看不到会话的认证方式 |
| 没有任何登录策略、引导状态、密码存储 | identity schema 只有 `users` 与 `signing_keys` | 本 RFC 全部新增 |
| e2e 登录靠演示表单 | [tests/e2e/consoleSession.ts:49](../../../tests/e2e/consoleSession.ts#L49) | 演示登录删除后必须改口 |
| CLI 用 `CS_TOKEN` 当 `cs_session` 值 | [runtime/platformAccess.ts:20](../../../apps/cli/src/runtime/platformAccess.ts#L20) | 不变，但取令牌的方式从演示登录改为密码或 OIDC 登录 |

好消息：网关侧不用动路由。`console.cs.localhost` 的 `/auth` 与 `/.well-known` 已整段免鉴权转给 cs-auth（[40-gateway.yaml:49](../../../deploy/k8s/platform/40-gateway.yaml#L49)），OIDC 的 start／callback 天然落在里面。

## 2. 落位与依赖

全部领域能力落 **`modules/identity`（L1）**，不新增模块，因此不需要 ADR。新增文件按模块模板分层：

| 层 | 新增 | 当前／上限 |
|---|---|---|
| `domain/` | `oidcProvider.ts`（字段规范化与不变量）、`endpointResolution.ts`（逐字段合并＋`loginViable`）、`idpClaims.ts`（字段读取／拼接／提取）、`provisioning.ts`（开通决策）、`loginMethods.ts`（四态与「能否关闭密码登录」）、`oidcFlow.ts`（state／PKCE／nonce 生成与校验）、`identityForwarding.ts`（转发集求解与头／声明投影） | 6 → 13／20 |
| `ports/` | `oidcProviderRepository.ts`、`userIdentityRepository.ts`、`loginPolicyRepository.ts`、`oidcFlowRepository.ts`、`idpClient.ts`、`passwordHasher.ts`、`identityForwardingRepository.ts` | 11 → 18／20 |
| `application/` | 新增子目录 `application/oidc/`：`login.ts`（start＋callback 编排）、`discovery.ts`、`providerAdmin.ts`（CRUD＋探针）、`forwardingAdmin.ts`；直接放 `application/` 的只有 `passwordLogin.ts`、`bootstrapAdmin.ts`、`loginPolicyAdmin.ts`。`demoLogin.ts` 删除，`ensureUser.ts` 改写为 `ensureIdentityUser.ts` | 根层 13 → 15／20，`oidc/` 4／20 |
| `adapters/` | `idp/httpIdpClient.ts`（discovery／token／userinfo／JWKS 取用）、`password/bunPasswordHasher.ts`、`pages/loginPage.ts`、`pages/bootstrapPage.ts`、`pages/loginErrorPage.ts`、`persistence/drizzle{OidcProvider,UserIdentity,LoginPolicy,OidcFlow,IdentityForwarding}Repository.ts`＋迁移。`provider/demo*.ts` 删除 | 各子目录 ≤7 |
| `http/` | `adminAuthRoutes.ts`（cs-api 管理面）；`authRoutes.ts` 扩写 | 4 → 5／20 |

`application/oidc/` 这一层子目录是规则允许的：层归属只看首段路径（[sourceFiles.ts:49](../../../tools/arch/sourceFiles.ts#L49)），而 20 个文件的上限按「目录直接包含的文件数」算（[rules/sizeAndNaming.ts:22](../../../tools/arch/rules/sizeAndNaming.ts#L22)）。`adapters/` 早已这么分组，本 RFC 把同一手法用到 `application/`。

包侧改动：

- **`packages/jwt` 增两个导出**：`createRemoteJwks(uri)`（jose `createRemoteJWKSet`，按 uri 缓存实例）与 `verifyIdToken({ idToken, jwks, issuer, audience, nonce, algorithms })`。理由：`verifyWithJwks` 锁定平台自己的 `ES256` 与 `requiredClaims`（[keyRing.ts:85](../../../packages/jwt/keyRing.ts#L85)、[signingKey.ts:5](../../../packages/jwt/signingKey.ts#L5)），验第三方 `id_token`（多为 RS256、要查 nonce）必须另开一条；jose 仍只在这一个包里。
- **`modules/identity` 依赖加 `@crewstation/secretbox`**：`client_secret` 用现有 `encryptString`／`decryptString`（AES-256-GCM，`CS_SECRET_KEY`）封存。只在 `adapters/` 使用，`PACKAGES_ALLOWED_BY_LAYER_DIR.adapters === 'any'`，不碰 arch 规则。
- **`packages/contracts` 新增 `api/oidc.ts`**：Provider、登录策略、探针结果、引导请求的 Schema；`api/auth.ts` 删 `DemoLoginRequestSchema` 与 `IdentityProviderKindSchema`，新增 `PasswordLoginRequestSchema`、`LoginDiscoveryDtoSchema`；`api/identity.ts` 的 `CurrentUserDto` 去掉 `demoIdentity`、加 `authMethod`；新增身份转发的 Schema（转发集、自定义字段映射、生效预览），`convention.ts` 的 `IDENTITY_HEADERS` 增加自定义字段的头名前缀常量与合法字符集，能力说明改为输出「实际生效的转发集」。
- **`packages/http/identity.ts`** 读新头 `x-cs-auth-method` 并放进 `c.get('identity')`。
- **`packages/api-client` 新增 `resources/auth.ts`**：管理面七个端点。
- **`packages/settings`**：删 `identityProvider`；新增 `bootstrapToken`（`CS_BOOTSTRAP_TOKEN`）、`passwordLoginForcedOn`（`CS_PASSWORD_LOGIN=force-on`）。

## 3. 数据模型（identity schema，迁移 0004–0009）

```sql
-- 0004_oidc_providers.sql
CREATE TABLE identity.oidc_providers (
  id text PRIMARY KEY, slug text NOT NULL UNIQUE, display_name text NOT NULL,
  issuer_url text NOT NULL, client_id text NOT NULL, client_secret_enc text NOT NULL,
  scopes text NOT NULL DEFAULT 'openid profile email',
  provisioning text NOT NULL DEFAULT 'allowlist' CHECK (provisioning IN ('auto','allowlist')),
  allowed_email_domains jsonb NOT NULL DEFAULT '[]'::jsonb,        -- 经 jsonDocument 读写
  authorization_endpoint text, token_endpoint text, userinfo_endpoint text, jwks_uri text,
  userinfo_request_style text NOT NULL DEFAULT 'get_bearer'
    CHECK (userinfo_request_style IN ('get_bearer','post_json')),
  trust_email_verified boolean NOT NULL DEFAULT false,
  username_claim text, git_name_claim text, email_claim text, subject_claim text,
  claim_mappings jsonb NOT NULL DEFAULT '[]'::jsonb,   -- A10：[{ key, claim }]，key 同时是转发头名
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
-- 0005_user_identities.sql：一人多条外部身份；(provider_id, subject) 唯一
-- 0006_auth_login_policy.sql：单行（id='global' CHECK），password_login_enabled、bootstrap_completed_at
-- 0007_oidc_flows.sql：state PK、provider_id、redirect_uri、code_verifier、nonce、return_to、expires_at、consumed_at
-- 0008_users_local_account.sql：users 加 username UNIQUE、password_hash、git_name
--   （external_id 保留为自然键 local:／oidc:，权威索引是 user_identities；见 proposal §8 B2 的实现调整）
-- 0009_identity_forwarding.sql：转发集。scope('global'|'project') + project_id（global 行为 NULL，
--   部分唯一索引保证 global 只有一行、每个 project 至多一行）、fields jsonb、updated_by、updated_at
```

- `allowed_email_domains` 一律走 `packages/persistence/jsonDocument.ts`，不直接用 `jsonb()`（dev-gotchas：drizzle＋Bun SQL 会把它存成 JSON 字符串）。
- `users.username` 只服务本地密码账户；OIDC 建档的行 `username` 取自 subject 派生值，`password_hash` 为 NULL。
- `user_identities` 记 `email`、`email_verified`、`preferred_snapshot`（最近一次 IdP 展示名快照，诊断用）、`linked_at`，并加 `profile jsonb`：每次登录写入解析出的标准字段与全部自定义映射字段的值（A8 的「先留在平台」就落在这里）。`profile` 只存字符串值，单条上限与字段数上限在域层校验，避免 IdP 回一大段文档把库撑大。
- `identity_forwarding.fields` 是允许外发的字段 key 列表：固定 key `name`、`email`、`git-name` 加自定义映射的 key；`user-id` 不出现在列表里，因为它恒定转发。
- 跨模块引用仍只有 `userId`，不加外键（结构文档 §7）。

## 4. 登录链路

cs-auth 上的公开路由（都在已免鉴权的 `/auth` 前缀内）：

| 方法 路径 | 作用 | 关键规则 |
|---|---|---|
| `GET /auth/status` | 登录方法发现（JSON） | 引导未完成只回 `{ mode: 'bootstrap' }`；就绪时回 `{ mode: 'ready', passwordLoginEnabled, providers: [{slug, displayName}] }` |
| `GET /auth/login` | 服务端渲染登录页 | 按上表渲染：引导态只给令牌框；就绪态给密码表单（若开启）＋每个启用 Provider 一个按钮 |
| `POST /auth/login` | 用户名＋密码 | 引导未完成 403 `bootstrap-admin-required`；策略关闭 403 `password-login-disabled`；用户不存在／无 hash 也走恒定时间比较 |
| `GET /auth/bootstrap` | 引导页 | 完成后 403 |
| `POST /auth/bootstrap/admin` | 建首位管理员 | 校验引导令牌（恒定时间比较）；一个事务：插入管理员＋置 `bootstrap_completed_at`＋`password_login_enabled=true`；并发只有一个成功 |
| `GET /auth/oidc/:slug/start` | 302 到 IdP | 引导未完成 403；Provider 不存在或未启用 404；端点解析不出授权端点 503 `oidc-endpoints-unresolved` |
| `GET /auth/oidc/:slug/callback` | 换码、取身份、建档、签会话 | 失败一律返回友好 HTML 页（与 agent-workflow 的 `friendly()` 同一组错误码），不是 JSON 500 |
| `GET\|POST /auth/logout` | 清 Cookie 并跳登录页 | 不做 RP-initiated logout |

回调地址固定为 `<scheme>://console.<userDomain>/auth/oidc/<slug>/callback`，由 `publicScheme`＋`userDomain` 推出（`domain/session.ts` 的 `consoleOrigin`），并在 start 与 callback 两侧一致；不读 `Host`，避免被伪造的 Host 改写 `redirect_uri`。

授权请求参数与 agent-workflow 同形：`response_type=code`、`client_id`、`redirect_uri`、`scope`、`state`、`code_challenge`＋`code_challenge_method=S256`、`nonce`。

**flow 落库而非进程内。** agent-workflow 的 `auth/oidc/flow.ts` 是进程内 `Map`；控制面 HA 是 v1 要求，因此 state 存 `identity.oidc_flows`，消费用一条原子语句：

```sql
UPDATE identity.oidc_flows SET consumed_at = now()
WHERE state = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING *;
```

TTL 5 分钟；`start` 时顺手删除已过期行（有上限），不新增后台 worker。discovery 文档缓存仍放进程内（正 1h／负 5min，且只在合并结果 `loginViable` 时才认缓存），多副本各自缓存不影响正确性。

`returnTo` 继续走现有 `resolveReturnTo`（只接受用户域内地址），存进 flow 行而不是放进 `state`。

## 5. 端点解析与身份取值（照搬语义）

- **逐字段合并**：discovery 文档的四个端点字段先经 http(s) 合法性过滤，缺失或非法则回落到管理员填的手工值；`issuer` 取文档里的值，没有则用配置的 `issuerUrl` 原样（不去尾斜杠）。
- **`loginViable`**：授权端点与令牌端点必须都有；配了 `subjectClaim`／`usernameClaim`／`emailClaim` 时 userinfo 端点必须有；否则 userinfo 或 JWKS 有一个即可。缓存命中只在结果 `loginViable` 时生效。
- **身份来源分支**：非 `subjectClaim` 模式且有 `id_token` 且解析出 JWKS → 验签（iss／aud／exp／nbf 由 jose 查，nonce 显式查）；配了 profile 选择器时，主体取自已验证 `id_token`，档案字段取自 userinfo，并要求 `userinfo.sub` 与已验证主体**严格相等**；`subjectClaim` 一配就强制走 userinfo。未验证的 `id_token` 在任何分支都不解析。
- **字段读取**：仅自有属性、非空字符串或安全整数；`__proto__`／`constructor`／`prototype` 在 Schema 与读取两处都拦；显示名与 Git 名是 1–8 个字段名的空格列表，按序拼接、缺的跳过；邮箱规范化为小写并校验形状；配了选择器却取不到值 → 明确失败，不回落标准字段。
- **邮箱可信**：`trustEmailVerified` 为真且有邮箱时视为已验证，在开通决策之前应用。
- **开通决策**（纯函数）：已有身份 → 登录；`auto` → 建档；`allowlist` → 邮箱已验证且域名命中则建档，否则拒绝并给出原因。
- **`subjectClaim` 锁**：已存在该 Provider 的关联身份时不允许修改 `subjectClaim`，同一事务内判定，返回 `subject-claim-locked-by-identities`。

## 6. 管理面 API（cs-api，管理员权限）

| 方法 路径 | 说明 |
|---|---|
| `GET /v1/admin/auth/login-policy` | `{ passwordLoginEnabled, bootstrapCompletedAt, forcedOn, enabledProviderCount, callerAuthMethod }` |
| `PUT /v1/admin/auth/login-policy` | `{ passwordLoginEnabled }`；关闭要求管理员＋`callerAuthMethod === 'oidc'`＋至少一个启用 Provider，缺哪条回哪条错误码 |
| `GET/POST /v1/admin/auth/providers` | 列表／新建；响应永不含 `client_secret`（以 `'***'` 哨兵表示已设置） |
| `GET/PATCH/DELETE /v1/admin/auth/providers/:id` | 单个读／改／删；`PATCH` 的空 `clientSecret` 表示保持原值 |
| `POST /v1/admin/auth/providers/:id/test` | 探针；**始终 200** 带诊断体（逐端点 URL＋来源、JWKS 可达性、`scopes_supported`、discovery 错误原文） |
| `GET /v1/admin/auth/forwarding` | 全局默认集、所有项目覆盖、候选字段清单（含各 Provider 的自定义映射 key） |
| `PUT /v1/admin/auth/forwarding` | 改全局默认集 |
| `PUT /v1/admin/auth/forwarding/projects/:projectId` | 设置某项目的覆盖；`DELETE` 同路径＝回到全局默认 |
| `GET /v1/projects/:projectId/identity-forwarding` | 项目负责人只读：本项目生效集与将注入的头名、令牌声明 |

密码登录关闭期间，`PATCH`（`enabled: false`）与 `DELETE` 对最后一个启用 Provider 返回 `last-enabled-oidc-required`。

## 7. 会话认证方式与身份转发

### 7.1 会话认证方式如何到达 cs-api

1. 签会话时写声明 `cs_auth: 'password' | 'oidc'`（`sessionTokens.issueSession` 增参）。
2. ForwardAuth 解析会话后，**仅当目标是工作台**（`ResolvedHost.kind === 'console'`）时追加响应头 `x-cs-auth-method`。业务服务收不到它，业务接入约定表 `IDENTITY_HEADERS` 不变（§11 待确认 2）。
3. `40-gateway.yaml`：`forward-auth-user` 的 `authResponseHeaders` 与 `drop-identity-headers` 各加一项，前者让网关复制进原请求，后者防止外部伪造。
4. `packages/http/identity.ts` 读它进 `c.get('identity')`；`/v1/me` 输出 `authMethod`，管理面登录策略接口也带 `callerAuthMethod`。

### 7.2 身份转发（A8–A11）

ForwardAuth 的 allow 分支今天固定注入四个头。改成：

1. **求解生效集**（`domain/identityForwarding.ts`，纯函数）：目标主机解析出项目后，取该项目的覆盖，没有则取全局默认；工作台目标不受它约束（工作台是平台自己的面，读 `/v1/me`）。
2. **注入**：`x-cs-user-id` 与 `x-cs-identity-token` 恒定注入；`name`／`email` 在集合里才注入 `x-cs-user-name`／`x-cs-user-email`；自定义字段合并成**一个 JSON 头** `x-cs-user-attrs`（如 `{"employee-no":"E-9"}`，值取当前登录身份 `profile` 里的对应值，经现有 `headerSafe` 编码）。**不在集合里的字段不出现**，而不是给空串——空串在业务侧与「有值但为空」无法区分。合并成一个头是实现期的调整，理由见 §11 偏离项 5。
3. **令牌同步裁剪**（A11）：`name`／`email` 声明按同一集合出现或消失；自定义字段进 `cs_attrs` 对象（`{ <key>: <string> }`），不平铺到顶层，避免与标准声明撞名。`IdentityTokenClaimsSchema` 相应把 `name`／`email` 改为可选并新增 `cs_attrs`。
4. **网关侧两处，都保持静态**。`forward-auth-user` 的 `authResponseHeaders` 加 `x-cs-user-attrs` 与 `x-cs-auth-method`；`drop-identity-headers` 同样加这两项。因为自定义字段合并成了一个固定头名，两张名单都不随管理员配置变化：不需要 `authResponseHeadersRegex`，也不需要把 `drop-identity-headers` 交给 cs-controller 动态生成，更不存在「映射刚加、删头名单还没下发」的可伪造窗口。
5. **能力说明一致**：`describeCapabilities` 从输出常量表改为输出「该项目当前实际会收到的头与声明」，能力页与 MCP 因此不会说谎（B10）。

两条硬规则：转发集只影响**外发**，平台侧 `profile` 始终存全量；转发集变更不回溯已签发的身份令牌（寿命 300 秒，见 `IDENTITY_TOKEN_TTL_SECONDS`），界面注明「最长 5 分钟内全部生效」。

## 8. 引导交接与破窗口

- **引导令牌**：安装期生成随机值写进 Secret，注入 cs-auth 为 `CS_BOOTSTRAP_TOKEN`，安装输出打印一次。只有 `/auth/bootstrap*` 认它，且只在 `bootstrap_completed_at IS NULL` 时有效——**事实源是数据库，不是文件**：删掉 Secret 不等于退役，重建 Secret 也不能复活权限。令牌永不换成会话。
- **非交互播种**：cs-auth 的入口已有 `migrate` 子命令（`apps/cs-auth/src/main.ts`），再加 `bootstrap-admin`，与 HTTP 路由共用同一事务用例。`deploy/local/install-platform.sh` 调它建出本机验收用的管理员（值来自 `CS_BOOTSTRAP_ADMIN_USERNAME/EMAIL/PASSWORD`），保持脚本幂等、不需要人开浏览器。
- **破窗口（A7）**：`CS_PASSWORD_LOGIN=force-on` 时，登录发现与 `POST /auth/login` 都无条件视密码登录为开启，库内策略暂不生效；管理面把开关显示为「由安装配置强制开启」并禁改。改完要重启 cs-auth 才生效，这是它作为「持有集群权限才能做的事」的边界。

## 9. 失败模式

| 场景 | 行为 |
|---|---|
| discovery 超时／非 JSON／非对象 | 视为失败，回落手工端点；`loginViable` 时才缓存失败 |
| 令牌端点 4xx／5xx／体不合形 | `token-exchange-failed` 友好页 |
| userinfo 超时、体超 256KiB、200 带错误对象 | 分别 `userinfo-fetch-failed`（带 IdP 原文）／`body-too-large`；`{errorCode: 0}` 这类成功包装不算错误 |
| `id_token` 验签失败／nonce 不符／空 sub | `id-token-verify-failed` |
| `userinfo.sub` 与已验证主体不符 | `userinfo-subject-mismatch` |
| 配了选择器但字段缺失或超长 | `oidc-{email,display-name,git-name}-claim-invalid` |
| state 未命中／过期／已消费 | `state-expired` |
| 回调时 Provider 已停用 | `provider-disabled` |
| 开通策略拒绝 | `email-not-verified`／`email-domain-not-allowed` |
| 引导未完成而走密码或 OIDC | 403 `bootstrap-admin-required` |
| 密码登录已关闭 | 403 `password-login-disabled` |
| 非 OIDC 会话要关闭密码登录 | 403 `password-login-requires-oidc-session` |
| 无启用 Provider 要关闭密码登录 | 409 `password-login-requires-enabled-oidc` |
| 并发两次引导提交 | 至多一个成功，另一个 409 `bootstrap-already-complete`，零半状态 |
| 自定义字段 key 非法或与固定 key 撞名 | 400 `forwarding-field-invalid`；头名注入前再校验一次，脏值宁可不注入 |
| 转发集里有已被删除的映射 key | 求解时忽略该 key 并在管理面标注「映射已不存在」，不注入空头 |
| 某项目覆盖引用了不存在的项目 | 400；删除项目时一并清理它的覆盖行 |

口令比较恒定时间：用户不存在／无 hash／已关联外部身份时也跑一次 dummy verify，不泄露账号存在性。不做登录限流（与 agent-workflow 一致，留给后续 RFC）。

## 10. 测试策略

- **纯函数单测**（domain）：端点合并与 `loginViable` 分支矩阵、字段读取与拼接（含原型污染键）、开通决策六条、四态登录发现、「能否关闭密码登录」三条前置。
- **模块集成**（`modules/identity/tests`，用 testkit 的临时库＋假 IdP `fetch`）：引导交接（含并发）、密码登录全部拒绝分支、OIDC start→callback 全链、flow 一次性消费（同一 state 第二次必败）、`subjectClaim` 锁、最后一个启用 Provider 的拒绝、探针三种形态、`client_secret` 不出现在任何响应。
- **契约测试**：`packages/contracts` 新 Schema 的 `.strict()` 与错误信息；`packages/api-client` 七个端点的路径与方法。
- **前端**（`apps/console/src/tests`）：Provider 表单逐项渲染与校验、自定义映射表、身份转发卡（全局与项目覆盖、生效预览）、关闭开关的三条禁用理由、探针结果渲染、删除确认走 `InlineConfirm`。
- **身份转发**：生效集求解（项目覆盖优先、缺失映射忽略、非法 key 拒绝）为纯函数单测；ForwardAuth 注入用例覆盖「关掉邮箱后头与声明同时消失」「自定义字段注入」「工作台目标不受集合约束」；能力说明输出与实际注入同源的一致性用例。
- **e2e／实机**：mock IdP 三形态（标准 OIDC／纯 OAuth 2.0 无 `id_token`／非标 `post_json` userinfo＋`subjectClaim`）各跑一次真实浏览器登录；关闭密码登录后旧登录页与脚本都拿不到会话；`force-on` 恢复路径实跑。
- **mock IdP 落位** `tools/mock-idp/`，随本机 Deployment 部署进 `crewstation-system`：discovery／token／userinfo／JWKS 用集群内 Service 地址（cs-auth 服务端调用），`authorizationEndpoint` 用手工端点填浏览器可达的 `http://mock-idp.cs.localhost/authorize`——顺带把「手工端点覆盖」这条路径也验了。

## 11. 与结构文档的对齐与偏离

对齐：全部落 `modules/identity`（L1）；一模块一 schema；跨模块只存 ID；模块内依赖方向不变；console 新组件放 `features/admin/components/auth/` 子目录（`components/` 现有 16 个 `.ts/.tsx`，上限 20，按 `runtime/` 的既有做法建子目录）。

逐条偏离与理由（请作者确认）：

1. **新增平台内部头 `x-cs-auth-method`**。不进 `IDENTITY_HEADERS`（那是业务接入约定表），只在工作台目标注入。替代方案是把策略写接口挪到 cs-auth，代价是同一个对象的读写分处两个进程、工作台要调两套 API。
2. **`packages/jwt` 长出第三方 `id_token` 验签能力**。它的职责本就是「jose 封装」，但此前只服务平台自签令牌；不这样做就得让 `modules/identity` 直接依赖 jose，jose 版本会出现两处。
3. **`users` 表去列（`external_id`）而不是加兼容列**，依据 A4「没有存量系统，断代开发」。
4. **业务接入约定表的语义从「固定四个头」变为「平台配置的转发集」**（`IDENTITY_HEADERS` 仍在，但 `x-cs-user-name`／`x-cs-user-email` 变成可能缺席，另加 `x-cs-user-attr-<key>` 一族）。这是本 RFC 对业务侧唯一的破坏性契约变更，已列为 B9／B10；替代方案是只裁剪令牌不裁剪明文头，但那等于没关。
5. **删除 `settings.identityProvider` 与 `CS_IDENTITY_PROVIDER`**：登录方法从启动参数变成库内数据，这个开关不再有意义。
6. **自定义身份字段合并成一个 JSON 头 `x-cs-user-attrs`**（实现期调整，原设计是每字段一个 `x-cs-user-attr-<key>`）。原设计要求网关的删头名单随管理员映射动态生成，而 Traefik 的 `headers` 中间件不支持前缀通配；那条路要么新增一条 cs-controller 下发链，要么留下「映射已加、删头名单未到」的可伪造窗口。合并成一个固定头名后两张名单都保持静态，且与令牌里的 `cs_attrs` 结构一一对应，业务只需读一处。
7. **`users.external_id` 保留为自然键**（见 proposal §8 B2）：权威索引仍是 `user_identities`。
8. **引导的非交互入口是 cs-auth 的 `bootstrap-admin` 子命令**（与浏览器向导同一事务用例），安装脚本调它播种首位管理员；`tools/mock-idp/` 提供本机 IdP，并有一条真 HTTP 的回归用例 `modules/identity/tests/mockIdpChain.test.ts` 覆盖它自己。
