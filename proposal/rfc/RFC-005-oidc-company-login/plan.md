# RFC-005｜实施计划

> Done · 2026-09-18 T1–T11 全部完成：生产代码与测试已上 main，T9 实机验收在本机 kind 集群＋两个 mock IdP＋无头 Chrome 上逐项跑完，结果见 acceptance-audit.md。
> 每批自带测试（开发规则 §4），门禁绿了再按精确路径提交（§2、§3）。

## 任务

| 编号 | 工作 | 依赖 | 完成证据（预期） |
|---|---|---|---|
| T1 | 契约与数据模型：`packages/contracts/api/auth/*`、迁移 0004–0009、`ports/*`、`domain/*` 七个纯函数文件 | 作者批准 | 已完成：`packages/contracts/api/auth/{session,oidc}.ts`、`ids.ts`、`convention.ts`（`x-cs-user-attrs`／`cs_attrs`）、`gateway/identity.ts`（平台内部头）、迁移 0004–0009、`modules/identity/{domain,ports}/*`；域层单测 5 个文件，契约单测 `packages/contracts/tests/oidc.test.ts` |
| T2 | Provider 管理面：drizzle 仓储、`secretbox` 封存、`application/providerAdmin.ts`、`http/adminAuthRoutes.ts`、探针、`api-client/resources/auth.ts` | T1 | 已完成：`adapters/persistence/drizzleOidcRepositories.ts`、`adapters/crypto/secretBoxCipher.ts`、`application/oidc/providerAdmin.ts`、`http/adminAuthRoutes.ts`、`packages/api-client/resources/auth.ts`；`tests/authAdmin.test.ts` 覆盖 CRUD、slug 冲突、主体字段锁、密文不出响应、探针三形态 |
| T3 | 登录策略与引导：`loginPolicy` 仓储、`bootstrapAdmin.ts`、`passwordLogin.ts`、`bunPasswordHasher`、`force-on`、cs-auth 的 `bootstrap-admin` 子命令 | T1 | 已完成：`application/{loginDiscovery,passwordLogin,bootstrapAdmin,loginPolicyAdmin}.ts`、`adapters/password/bunPasswordHasher.ts`、`loginPolicyRepository.completeBootstrap`；`tests/authFlow.test.ts` 覆盖引导四态、令牌退役、三条 401 同话术 |
| T4 | OIDC 登录链：`packages/jwt` 增 `createRemoteJwks`／`verifyIdToken`、`adapters/idp/httpIdpClient.ts`、`oidcLogin.ts`、`oidc_flows` 一次性消费、登录页／引导页／错误页渲染 | T1、T3 | 已完成：`packages/jwt/idToken.ts`、`adapters/idp/{httpIdpClient,cachedEndpointResolver}.ts`、`application/oidc/{acquireClaims,login}.ts`、`application/loginPages.ts`；`tests/oidcLogin.test.ts`（假 IdP）与 `tests/mockIdpChain.test.ts`（真 HTTP＋真 RS256 验签） |
| T5 | 会话认证方式传递：会话声明 `cs_auth`、ForwardAuth 仅工作台注入 `x-cs-auth-method`、`40-gateway.yaml` 两处、`packages/http/identity.ts`、`/v1/me.authMethod` | T4 | 已完成：会话声明 `cs_auth`、ForwardAuth 仅工作台注入 `x-cs-auth-method`、`40-gateway.yaml` 两处、`packages/http/identity.ts`、`/v1/me.authMethod`；`tests/authAdmin.test.ts` 覆盖「业务目标没有这个头」 |
| T6 | 演示登录整条删除：契约、`modules/identity` 内引用、CLI 告警、`tests/e2e/consoleSession.ts` 改用密码登录、`10-config.yaml` 去 `CS_IDENTITY_PROVIDER` | T3 | 已完成：演示适配器、`DemoLoginRequestSchema`、`AuthStatusDto`、`demoIdentity`、`CS_IDENTITY_PROVIDER` 全部删除；CLI `whoami` 改显示登录方式，e2e `signIn` 改口令登录 |
| T7 | 工作台 `/admin/authentication`：登录方式卡、Provider 列表与表单（§6.3 逐项）、探针渲染、`InlineConfirm`、i18n 双语、`AdminNav` 分组 | T2、T5 | 已完成：`/admin/authentication` 三张卡（`features/admin/components/auth/*`）、中英文案、`AdminNav` 与路由；`apps/console/src/tests/adminAuthentication.test.tsx` 9 条。多分辨率、明暗与键盘已在 T9 实机核对（OA-24） |
| T8 | `tools/mock-idp/` 与本机部署清单、`install-platform.sh` 播种引导管理员 | T4 | 已完成：`tools/mock-idp/`（标准／纯 OAuth2／非标 userinfo 三形态）、`install-platform.sh` 生成引导令牌并调 `bootstrap-admin` 播种管理员并写 `.local/admin.env` |
| T9 | 实机验收：下表 OA 逐项，浏览器实跑 | T6、T7、T8 | 已完成：OA-01…OA-31 逐项有证据（实机项为无头 Chrome＋真网关＋两个 mock IdP 的往返，其余为自动化），逐条记在 [acceptance-audit.md](./acceptance-audit.md) |
| T10 | 本地完整门禁、按精确路径提交、推送后按自己的 SHA 盯 CI 到绿 | T9 | 已完成：本地 `bun run check` 全绿（唯一偶发红是 `modules/scm/tests/gitlabIntegration.test.ts`，单跑绿，见 dev-gotchas「刚签发的项目访问令牌…」）；末批 [`3c8cf6a` CI run 35314046341](https://github.com/wangbinquan/CrewStation/actions/runs/35314046341) 的 `check` 与 `e2e` 两个作业均成功，此前 `a0a5f6a`／`906f678`／`97c9e99` 亦全绿 |
| T11 | 身份转发（A8–A11）：`identity_forwarding` 表与自定义映射、生效集求解、ForwardAuth 注入与令牌同步裁剪、网关复制与删头名单、能力说明改为实际生效集、管理面转发卡与项目只读页 | T1、T5 | 已完成：`identity_forwarding` 表、候选与生效集求解、ForwardAuth 注入与令牌同步裁剪、能力说明改为实际生效集、管理面转发卡与项目只读接口。**名单没有交给 cs-controller 动态生成**：自定义字段合并成单个 `x-cs-user-attrs` 后，`40-gateway.yaml` 的复制与删头名单保持静态即可（见 §实施说明 1），`authResponseHeadersRegex` 因此也不需要 |

排期约束：T5 改的是网关与业务接入面，必须与 T4 同批部署，否则关闭密码登录的前置条件读不到认证方式。T6 一旦落地，本机任何未播种管理员的环境都登录不进去，因此 T6 与 T8 同批提交。**T11 与 T5 同批部署**：两者都改 `forward-auth-user` 与 `drop-identity-headers`，分两次上会让网关出现一次「注入了但没被复制」或「能被伪造」的窗口；T11 的前端部分跟 T7 一起做，避免认证页两次返工。实机验收（T9）在 T11 之后跑，OA 表含转发项。

## 实施说明（2026-09-18）

作者以会话目标「完整实现整个RFC并提交上库」要求实施，覆盖原「批准后启动」的排期。落地时对设计做了三处调整，均记在 design.md §11 与 proposal.md §8：

1. 自定义身份字段合并成一个 JSON 头 `x-cs-user-attrs`（原设计每字段一个头），网关的复制与删头名单因此保持静态，不再需要动态下发，也没有可伪造窗口；
2. `users.external_id` 保留为人可读的自然键，权威索引仍是 `user_identities`；
3. 引导的非交互入口是 cs-auth 的 `bootstrap-admin` 子命令，与浏览器向导共用同一事务用例。

自动化覆盖到的 OA 项：OA-01…OA-04（引导与常规登录，`authFlow.test.ts`）、OA-05…OA-08 的接口层（`oidcLogin.test.ts` 与真 HTTP 的 `mockIdpChain.test.ts`）、OA-09…OA-11、OA-13…OA-16、OA-18…OA-22（`authAdmin.test.ts`、`oidcLogin.test.ts`、域层单测）、OA-25（源码层断言）、OA-26…OA-29（`authAdmin.test.ts` 的转发用例）、OA-31（`capabilitiesModule.test.ts`）。
实机验收（2026-09-18，本机 kind 集群＋两个 mock IdP＋无头 Chrome）已全部执行完：服务端往返、破窗口、
最后一个 Provider 保护、两 Provider 并存与 A12 账户隔离、转发裁剪与伪造头被网关抹掉，浏览器往返与
OA-24 的多分辨率／明暗／键盘见下表各行的「实机」标注，证据（截图与接口回放）按 §证据 存放。

实机跑出来、自动化没能发现的两处问题，已在本批一并修掉：

1. **破窗口期间管理面报的是库内策略而不是正在生效的状态**：`CS_PASSWORD_LOGIN=force-on` 压着库内的「已关闭」时，
   认证页照库内值写「已关闭」，还给出一个按下去必然 409 的开关——恰好在唯一需要这块牌子的场合骗人。
   现在卡片写正在生效的「已开启」，另起一行列出被压着的库内策略，两个方向都不给按（`LoginMethodsCard`，
   `adminAuthentication.test.tsx` 加了对应用例）。
2. **这个开关被两个进程读**：登录页归 cs-auth，管理面归 cs-api；只重启 cs-auth 会让界面与实际各说各话。
   文案、design.md §8、OA-17 与 `10-config.yaml` 一律改成「重启 cs-auth 与 cs-api」。

## 验收案例

| 编号 | 场景 | 必须证明 |
|---|---|---|
| OA-01 | 全新安装首屏 | 登录页只有引导令牌一种方法；此时直接 POST 密码登录或访问 OIDC start 都 403 `bootstrap-admin-required` |
| OA-02 | 引导向导 | 令牌校验通过才进向导；用户名／显示名／邮箱／密码／确认校验齐全；成功后令牌立即失效（HTTP 与 WS 皆 401） |
| OA-03 | 引导并发 | 两个窗口同时提交，至多一个成功，另一个明确提示已完成；数据库里只有一个管理员且策略行完整 |
| OA-04 | 引导后的常规登录 | 管理员用刚建的用户名密码登录，拿到 `cs_session`，工作台与 CLI 都能用 |
| OA-05 | 标准 OIDC Provider | 只填 Issuer＋client 凭据，探针显示四个端点全部来自 discovery、JWKS 可达；启用后登录页出现按钮，浏览器完成一次真实登录 |
| OA-06 | 纯 OAuth 2.0 Provider | 无 discovery、无 `id_token`：四个端点手工填，身份取自 userinfo；登录成功，档案字段按选择器解析 |
| OA-07 | 非标 userinfo | `post_json` 风格＋`subjectClaim=id`：请求体确为 `{client_id, access_token, scope}` 且无 Authorization 头；登录成功 |
| OA-08 | 手工端点覆盖 | discovery 只给部分字段时，缺的字段按手工值生效，探针逐项标出来源；mock IdP 的授权端点用手工值指向浏览器可达地址 |
| OA-09 | 显示名／邮箱／Git 名选择器 | 多字段空格拼接按序生效；每次登录刷新用户档案；缺字段时明确失败而非静默回落 |
| OA-10 | `allowlist` 开通 | 邮箱域命中且已验证才建档；未验证回 `email-not-verified`，域名不符回 `email-domain-not-allowed`，都是可读原因页 |
| OA-11 | `auto` 开通 | 任何成功登录即建档；建档用户默认非管理员，除非邮箱命中 `CS_ADMIN_EMAILS` |
| OA-12 | 管理员标记 | 现任管理员把某 OIDC 用户标为管理员后，该用户重新加载即具备管理空间权限 |
| OA-13 | 关闭常规登录的三条前置 | 非管理员、密码会话的管理员、没有启用 Provider 三种情况下开关均禁用且给出各自理由；后端对应 403／403／409 |
| OA-14 | OIDC 管理员关闭常规登录 | 关闭后登录页不再渲染密码表单；直接 POST `/auth/login` 固定 403；已存在的密码会话不被吊销（本次不做强制下线） |
| OA-15 | 重新打开 | 同一位置由 OIDC 管理员重开后，密码登录立即可用，无需重启 |
| OA-16 | 最后一个启用 Provider | 密码登录关闭期间，停用或删除最后一个启用 Provider 被拒绝（`last-enabled-oidc-required`），界面按钮同时禁用 |
| OA-17 | 破窗口 | 改 ConfigMap 为 `CS_PASSWORD_LOGIN=force-on` 并重启 cs-auth 与 cs-api 后，密码登录可用、管理面把它显示为已开启并单列被压着的库内策略、两个方向都禁改；去掉后恢复库内策略 |
| OA-18 | state 一次性 | 同一 `state` 回放第二次被拒；过期 state 被拒；两个 cs-auth 副本轮询时仍然只成功一次 |
| OA-19 | 令牌／userinfo 故障 | 令牌端点 5xx、userinfo 超时、userinfo 200 带错误对象、体超限，四种都得到对应错误页且不落半截用户 |
| OA-20 | 验签与绑定 | 篡改 `id_token`、nonce 不符、空 `sub`、`userinfo.sub` 与已验证主体不符，四种都拒绝登录 |
| OA-21 | `subjectClaim` 锁 | 已有关联身份后修改该字段被拒；提示「删除并重建 Provider」 |
| OA-22 | 密钥与密文 | `client_secret` 明文不出现在任何 GET、日志、事件、前端与探针结果；编辑留空不清空原值 |
| OA-23 | 多 Provider 与账户隔离（A12） | 两个启用 Provider 同时出现在登录页；同一人在两边登录按 `(Provider, subject)` 各自建档，得到**两个账户**，互不合并、互不认领，用户目录里都能看到并能分别标记管理员 |
| OA-24 | 管理 UX | 1280／1024／768／390 宽度、明暗主题、全程键盘可用；错误与确认都在行内，无浏览器模态框 |
| OA-25 | 演示登录确已删除 | 源码层再无演示适配器与 `demoIdentity`；旧 `POST /auth/login` 的演示字段被当作普通密码登录失败处理，不产生任何用户 |
| OA-26 | 默认转发集 | 未做任何转发配置时，业务收到的头与令牌声明与本 RFC 之前一致（用户 ID、显示名、邮箱、身份令牌），最小样例页面正常显示当前用户 |
| OA-27 | 关掉一个字段 | 全局关掉邮箱后，业务请求里**没有** `x-cs-user-email` 这个头（不是空串），令牌声明里也没有 `email`；平台侧档案仍保留邮箱；最长 5 分钟内全部生效 |
| OA-28 | 按项目覆盖 | 给一个项目放宽、给另一个收紧，两个项目的业务同时观察到各自的集合；未设置覆盖的项目跟随全局默认；删除覆盖即回到默认 |
| OA-29 | 自定义映射字段 | 管理员映射 `employee-no ← empNo` 并允许转发后，业务收到的 `x-cs-user-attrs` JSON 里有 `employee-no`（落地改为单个 JSON 头，见 §实施说明 1）且令牌 `cs_attrs.employee-no` 一致；非法 key 与撞名 key 被拒 |
| OA-30 | 伪造与撤销 | 外部伪造 `x-cs-user-attrs` 一律被 `drop-identity-headers` 清掉；名单是静态的，删除一个映射前后都不存在可伪造窗口 |
| OA-31 | 能力说明一致 | 能力说明 MCP 与工作台能力页展示的身份头集合＝该项目实际收到的集合；改配置后页面随之变化，不再是静态常量表 |

A12 已裁定不同 Provider 之间只做账户不合并，因此 OA-23 的预期就是「两个账户」，本 RFC 不提供手工绑定入口。

## 证据

证据放 `/private/tmp/crewstation-rfc005-<批次>/`，与 `STATE.md` 的接力记录互相引用；实机项必须是真实浏览器与真实 IdP（mock 或公司）交互的产物，不接受接口自测代替。
