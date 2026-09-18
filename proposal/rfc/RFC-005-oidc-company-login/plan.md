# RFC-005｜实施计划

> Draft · 2026-09-18 待作者批准。批准后按下表小批推进；每批自带测试（开发规则 §4），门禁绿了再按精确路径提交（§2、§3）。

## 任务

| 编号 | 工作 | 依赖 | 完成证据（预期） |
|---|---|---|---|
| T1 | 契约与数据模型：`packages/contracts/api/oidc.ts`、`api/auth.ts` 改写、迁移 0004–0008、`ports/*`、`domain/*` 六个纯函数文件 | 作者批准 | 域层单测：端点合并与 `loginViable` 矩阵、字段读取与拼接、开通决策、四态发现、关闭前置；契约 `.strict()` 用例 |
| T2 | Provider 管理面：drizzle 仓储、`secretbox` 封存、`application/providerAdmin.ts`、`http/adminAuthRoutes.ts`、探针、`api-client/resources/auth.ts` | T1 | 模块集成测试：CRUD、slug 冲突、`subjectClaim` 锁、密文不出响应、探针三形态；api-client 路径用例 |
| T3 | 登录策略与引导：`loginPolicy` 仓储、`bootstrapAdmin.ts`、`passwordLogin.ts`、`bunPasswordHasher`、`force-on`、cs-auth 的 `bootstrap-admin` 子命令 | T1 | 并发引导只成一个且零半状态；密码登录四条拒绝分支；恒定时间比较；`force-on` 覆盖库内策略 |
| T4 | OIDC 登录链：`packages/jwt` 增 `createRemoteJwks`／`verifyIdToken`、`adapters/idp/httpIdpClient.ts`、`oidcLogin.ts`、`oidc_flows` 一次性消费、登录页／引导页／错误页渲染 | T1、T3 | start→callback 全链（假 IdP fetch）；同一 state 第二次必败；§9 失败模式逐条一个用例 |
| T5 | 会话认证方式传递：会话声明 `cs_auth`、ForwardAuth 仅工作台注入 `x-cs-auth-method`、`40-gateway.yaml` 两处、`packages/http/identity.ts`、`/v1/me.authMethod` | T4 | ForwardAuth 决策用例（工作台注入／业务目标不注入）；伪造头被 drop 的用例；`/v1/me` 用例 |
| T6 | 演示登录整条删除：契约、`modules/identity` 内引用、CLI 告警、`tests/e2e/consoleSession.ts` 改用密码登录、`10-config.yaml` 去 `CS_IDENTITY_PROVIDER` | T3 | 全仓再无 `demo:`／`demoIdentity` 引用的源码层断言；e2e 可用新口登录 |
| T7 | 工作台 `/admin/authentication`：登录方式卡、Provider 列表与表单（§6.3 逐项）、探针渲染、`InlineConfirm`、i18n 双语、`AdminNav` 分组 | T2、T5 | 前端用例：表单逐项、三条禁用理由、探针渲染、删除确认；多分辨率与明暗主题在 T9 实机核对 |
| T8 | `tools/mock-idp/` 与本机部署清单、`install-platform.sh` 播种引导管理员 | T4 | 本机部署后三形态各能完成一次登录；脚本可重复执行 |
| T9 | 实机验收：下表 OA 逐项，浏览器实跑 | T6、T7、T8 | 每项一条证据（截图／接口回放／数据库快照），证据目录写进 `STATE.md` |
| T10 | 本地完整门禁、按精确路径提交、推送后按自己的 SHA 盯 CI 到绿 | T9 | `bun run check` 全绿＋CI run 链接 |
| T11 | 身份转发（A8–A11）：`identity_forwarding` 表与自定义映射、生效集求解、ForwardAuth 注入与令牌同步裁剪、`drop-identity-headers` 交给 cs-controller 生成、`authResponseHeadersRegex`、能力说明改为实际生效集、管理面转发卡与项目只读页 | T1、T5 | 求解纯函数单测；注入用例（关掉邮箱后头与声明同时消失、自定义字段注入、工作台目标不受约束）；能力说明与实际注入同源的一致性用例；前端转发卡用例 |

排期约束：T5 改的是网关与业务接入面，必须与 T4 同批部署，否则关闭密码登录的前置条件读不到认证方式。T6 一旦落地，本机任何未播种管理员的环境都登录不进去，因此 T6 与 T8 同批提交。**T11 与 T5 同批部署**：两者都改 `forward-auth-user` 与 `drop-identity-headers`，分两次上会让网关出现一次「注入了但没被复制」或「能被伪造」的窗口；T11 的前端部分跟 T7 一起做，避免认证页两次返工。实机验收（T9）在 T11 之后跑，OA 表含转发项。

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
| OA-17 | 破窗口 | 改 ConfigMap 为 `CS_PASSWORD_LOGIN=force-on` 并重启 cs-auth 后，密码登录可用、管理面显示「由安装配置强制开启」且开关禁改；去掉后恢复库内策略 |
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
| OA-29 | 自定义映射字段 | 管理员映射 `employee-no ← empNo` 并允许转发后，业务收到 `x-cs-user-attr-employee-no` 且令牌 `cs_attrs.employee-no` 一致；非法 key 与撞名 key 被拒 |
| OA-30 | 伪造与撤销 | 外部伪造 `x-cs-user-attr-*` 一律被 `drop-identity-headers` 清掉；删除一个映射后重下发完成前后都不存在可伪造窗口 |
| OA-31 | 能力说明一致 | 能力说明 MCP 与工作台能力页展示的身份头集合＝该项目实际收到的集合；改配置后页面随之变化，不再是静态常量表 |

A12 已裁定不同 Provider 之间只做账户不合并，因此 OA-23 的预期就是「两个账户」，本 RFC 不提供手工绑定入口。

## 证据

证据放 `/private/tmp/crewstation-rfc005-<批次>/`，与 `STATE.md` 的接力记录互相引用；实机项必须是真实浏览器与真实 IdP（mock 或公司）交互的产物，不接受接口自测代替。
