# RFC-005｜验收证据核对

> 2026-09-18。OA-01…OA-31 逐项核对完毕。环境：本机 docker-desktop kind 集群（namespace `crewstation-system`）、真 Traefik 网关（`http://console.cs.localhost`）、
> 两个由 `tools/mock-idp/` 起的真 IdP（9001 标准 OIDC＋RS256 真签名；9002 无 discovery、无 `id_token`、`post_json` 风格 userinfo、`subjectClaim=id`）、
> 无头 Chrome＋CDP（浏览器上下文各自独立 Cookie，即各自独立身份）。

## 1. 判据

- **实机**：在当前部署上，由真浏览器或真 HTTP 客户端经真网关走完，结果来自平台自己的响应与数据库，不是桩。
- **自动化**：`bun test` 里的用例覆盖了同一条判定；用例绿不等于当前部署跑通，所以凡是能实机的都实机跑了一遍。
- 一条验收项里若两者各占一半（例如「放行侧实机、拒绝侧自动化」），下表按半条写清楚，不含糊成「通过」。

验收期间集群被临时改动过（两个 mock Provider、破窗口开关、转发集、mock 账户），**结束时已逐项还原**：
Provider 0 个、`user_identities` 0 行、OIDC 用户 0 个、`CS_PASSWORD_LOGIN` 从 ConfigMap 去掉并重启 cs-auth 与 cs-api、
全局转发集回到安装默认 `["name","email"]`、用户名密码登录开启。

## 2. 逐项

| 编号 | 方式 | 证据 |
|---|---|---|
| OA-01 | 自动化 | 全新库的首屏只给引导入口、密码与 OIDC 一律 403 `bootstrap-admin-required`：`modules/identity/tests/authFlow.test.ts`。当前部署早已交接完成，无法在不清库的前提下实机复现 |
| OA-02 | 实机＋自动化 | 实机：从 `crewstation-secrets` 取出**真**引导令牌再提交一次，得 409 `bootstrap-already-complete`，库里没有多出账户；`GET /auth/bootstrap` 302 回登录页。令牌校验、五项字段校验与「成功后立即失效」的完整链路见 `authFlow.test.ts` |
| OA-03 | 自动化 | 并发提交至多一个成功、策略行完整：`authFlow.test.ts` 与 `bootstrapAdmin` 的单事务用例 |
| OA-04 | 实机 | `install-platform.sh` 以 `bootstrap-admin` 子命令播种管理员并写 `.local/admin.env`；`deploy/local/admin-credentials.sh` 用这份口令登录网关得 200 且 `isAdmin=true`，`seed-catalog.sh`／`bootstrap-integrations.sh` 与 `tests/e2e` 全部走这条路 |
| OA-05 | 实机 | 只填 Issuer＋client 凭据建 `mock-corp`，探针显示四个端点全部来自 discovery、JWKS 可达；启用后登录页出现按钮，浏览器点按钮 → IdP → 回跳，`/v1/me` 得 `authMethod: "oidc"`；`id_token` 为 RS256、用 IdP 真 JWKS 验签 |
| OA-06 | 实机 | `mock-lab`（`--no-discovery --no-id-token`）四个端点手工填，身份取自 userinfo，浏览器登录成功并建档 |
| OA-07 | 实机 | 同一 `mock-lab` 用 `--userinfo-style post_json --subject-field id`：mock IdP 端确认请求体为 `{client_id, access_token, scope}` 且无 Authorization 头；`subjectClaim=id` 生效，主体为 `1001`／`1002` |
| OA-08 | 实机 | discovery 只给部分字段时缺的字段按手工值生效、探针逐项标出来源；mock IdP 的 `--browser-origin` 让 discovery 通告浏览器可达的授权地址，浏览器往返因此成立 |
| OA-09 | 实机＋自动化 | 实机：`mock-corp` 下显示名落为 `mock-alice`（`preferred_username` 先于 `name`，与 agent-workflow 的顺序一致），`mock-lab` 下落为 `Alice（mock）`；多字段拼接、缺字段明确失败见 `modules/identity/domain/idpClaims.test.ts` |
| OA-10 | 实机＋自动化 | 实机放行侧：`allowlist`＋`@corp.example` 放行 alice；实机拒绝侧：以 `outsider@other.example` 登录得到中文错误页「你的邮箱域名不在允许列表内」＋错误码 `email-domain-not-allowed`，没有会话、库里没有半截用户。`email-not-verified` 分支见 `oidcLogin.test.ts` |
| OA-11 | 实机 | `mock-lab` 为 `auto`：Alice 与 Bob 一登即建档，默认非管理员 |
| OA-12 | 实机 | 非管理员的 OIDC 用户打开管理空间被挡（「仅平台管理员可见」）；管理员在用户与权限里两段式确认标记后，该用户重新加载即进入管理空间，`/v1/me.isAdmin` 为真 |
| OA-13 | 实机＋自动化 | 实机：密码会话的管理员在认证页看不到关闭按钮，只看到「请先用公司身份登录一次」；后端对应 403 `password-login-requires-oidc-session`。非管理员 403、无启用 Provider 409 见 `authAdmin.test.ts` |
| OA-14 | 实机 | 关闭后登录页不再渲染密码表单（只剩公司身份入口）；直接 `POST /auth/login` 固定 403 `password-login-disabled`；已存在的密码会话不被吊销 |
| OA-15 | 实机 | 同一位置由 OIDC 管理员按「开启用户名密码登录」，卡片与 `/auth/status` 立即变为开启，未重启任何进程 |
| OA-16 | 实机 | 密码登录关闭期间停用／删除最后一个启用 Provider 被拒（`last-enabled-oidc-required`），界面按钮同时禁用。另观察到相邻保护：仍有用户关联时删 Provider 得 409 `provider-still-linked` |
| OA-17 | 实机 | `CS_PASSWORD_LOGIN=force-on` 写进 `crewstation-env` 并重启 cs-auth 与 cs-api 后：密码登录可用；认证页把「用户名密码登录」写成正在生效的**已开启**、另起一行列出被压着的库内策略「已关闭」、两个方向都不给按，并说明开关来自安装配置。去掉开关并重启两者后回到库内策略。**只重启 cs-auth 会让界面与实际各说各话**（cs-api 才是认证页的应答方），这一条是本次实机发现并修掉的，见 plan.md §实施说明 |
| OA-18 | 自动化 | `state` 回放、过期、并发只成功一次：`oidcLogin.test.ts` 与 `drizzleOidcRepositories` 的原子 `consume`（`UPDATE … RETURNING`） |
| OA-19 | 自动化 | 令牌端点 5xx、userinfo 超时、userinfo 200 带错误对象、体超 256 KiB：`oidcLogin.test.ts`／`fakeIdp.test.ts`，四种都得到对应错误页且不落半截用户 |
| OA-20 | 自动化 | 篡改 `id_token`、nonce 不符、空 `sub`、`userinfo.sub` 与已验证主体不符：`oidcLogin.test.ts` 的三条不变式用例 |
| OA-21 | 自动化 | 已有关联身份后改 `subjectClaim` 被拒并提示删除重建：`authAdmin.test.ts` |
| OA-22 | 实机＋自动化 | 实机：建档与编辑后 `GET` 一律只回 `clientSecretSet: true`，明文不出现在任何响应、日志与探针结果里；密钥以 AES-256-GCM 封存在库。编辑留空保持原值见 `authAdmin.test.ts` |
| OA-23 | 实机 | 两个启用 Provider 同时出现在登录页（两个入口按钮）；同一个 `alice@corp.example` 从两边进来得到**两个账户**（不同用户 ID、各自的 `(Provider, subject)`），用户目录里两行并存、可分别标记管理员——A12 成立 |
| OA-24 | 实机 | 1440／1280／1024／768／390 五档：页面无横向滚动，390 下表格在自己的容器里横滚而不撑宽页面；明暗主题跟随 `prefers-color-scheme`（暗色下 `#11151c` 底、浅色字）；全程键盘可用：登录页 Tab 走遍两个公司身份入口与用户名／密码／登录，回车提交并在页面上显示失败原因，管理页 Tab 到行内按钮有可见焦点环、回车展开编辑表单 |
| OA-25 | 自动化 | 源码层断言：演示适配器、`DemoLoginRequestSchema`、`AuthStatusDto`、`demoIdentity`、`CS_IDENTITY_PROVIDER` 全部不存在；旧演示字段按普通密码登录失败处理 |
| OA-26 | 实机 | 未做任何转发配置时业务收到的头与声明与本 RFC 之前一致（用户 ID、显示名、邮箱、身份令牌），最小样例页面正常显示当前用户 |
| OA-27 | 实机 | 全局关掉邮箱后业务请求里**没有** `x-cs-user-email` 这个头（不是空串），身份令牌里也没有 `email`；平台侧 `profile` 仍保留邮箱；注入缓存 5 秒、写入即失效 |
| OA-28 | 自动化 | 按项目覆盖放宽与收紧、未设置跟随全局、删除覆盖回默认：`authAdmin.test.ts` 与 `identityForwarding.test.ts` |
| OA-29 | 实机 | 映射 `employee-no ← empNo` 并允许转发后，业务收到的 `x-cs-user-attrs` JSON 里有 `employee-no`，身份令牌 `cs_attrs.employee-no` 与之逐字段一致（落地为单个 JSON 头，见 plan.md §实施说明 1）；非法 key 与撞名 key 被拒（自动化） |
| OA-30 | 实机 | 从集群外伪造 `x-cs-user-attrs`／`x-cs-user-id`／`x-cs-auth-method` 请求业务域，头被 `drop-identity-headers` 清掉，业务看到的是网关重新注入的那一份；名单是静态的，改映射前后都没有可伪造窗口 |
| OA-31 | 自动化 | 能力说明 MCP 与工作台能力页读的是「该项目实际生效的转发集」而非常量表：`modules/capabilities/tests/capabilitiesModule.test.ts` |

## 3. 实机跑出来、自动化没发现的两处

1. **破窗口期间管理面报的是库内策略而不是正在生效的状态。** `forcedOn` 为真、库内为「关」时，认证页照库内值写「已关闭」，
   还给出一个按下去必然 409 的「开启」按钮——恰好在唯一需要这块牌子的场合骗人。已改为写正在生效的状态、单列被压着的库内策略、两个方向都不给按
   （`LoginMethodsCard`，`apps/console/src/tests/adminAuthentication.test.tsx` 加了对应用例，并确认去掉修复后它会红）。
2. **这个开关被两个进程读。** 登录页归 cs-auth、认证页归 cs-api，只重启一个就会让界面与实际各说各话。
   文案、design.md §8、OA-17 与 `10-config.yaml` 一律改成「重启 cs-auth 与 cs-api」，并记进 `docs/engineering/dev-gotchas.md`。

## 4. 没有实机、也不打算在本机实机的

- OA-01（全新安装首屏）要清库才能复现，本机集群上有真实项目与数据，不做；`authFlow.test.ts` 用独立测试库覆盖同一判定。
- OA-03（引导并发）依赖同一毫秒的两次提交，自动化用例在同一事务边界上判定更可靠。
- 公司真实 IdP 的对接（`trustEmailVerified`、非标 scope、企业代理）要等实际接入材料，属于基线 Q01 的退出条件，不在本 RFC 的验收范围内。
