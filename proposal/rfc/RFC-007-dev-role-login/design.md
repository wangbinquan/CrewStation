# RFC-007｜设计

## 1. 边界

实现位于 `tools/dev-auth/` 与 `deploy/local/`。应用、领域模块、契约和生产 Kubernetes 清单不依赖它。dev-auth 使用 RFC-005 已有端点：

- `/auth/login`：取得本机管理员 Cookie；
- `/v1/admin/auth/providers`：创建或更新固定 Provider；
- `/auth/oidc/:slug/start` 与 callback：真实登录；
- `/v1/me`、`/v1/users/:id/admin`：识别固定用户并设置管理员标记；
- `/v1/projects` 与 `/v1/projects/:id/members`：只调整固定开发账号的成员关系。

## 2. 部署与地址

`deploy/local/install-dev-auth.sh` 从显式环境变量或无人值守安装产生的 `.local/admin.env` 读管理员凭据，写入本机集群专用 Secret，并应用 `deploy/local/dev-auth.yaml`。首次交互安装尚未创建管理员、或没有提供凭据时，`install-platform.sh` 明确提示后续命令而不部署 dev-auth。Pod 复用本机 `cs-control-plane:dev` 镜像，仅执行 `tools/dev-auth/main.ts`。

- 浏览器入口与授权端点：`http://dev-auth.cs.localhost`
- IdP 内部 issuer：`http://crewstation-dev-auth.crewstation-system.svc.cluster.local:7460/oidc/<随机前缀>`
- 产品调用：经集群内 Traefik，显式发送 `Host: console.cs.localhost`

discovery 同时给出浏览器可达的 authorization endpoint 与集群内 token、userinfo、JWKS 端点。readiness 必须等真实播种完成，但播种中的 cs-auth 已经需要访问 discovery 与 token；Service 因此设置 `publishNotReadyAddresses: true`，只让唯一 Pod 在准备期可被 cs-auth 访问，`/readyz` 本身仍不放宽。

## 3. 启动与播种

1. 生成本进程 RSA 密钥、随机 issuer 路径、client secret 与表单令牌。
2. 用本机管理员密码登录；Cookie 只驻留 Pod 内存。
3. 按 slug `dev-roles` 创建或原位更新 Provider。
4. 四个固定 subject 各走一次完整授权码登录，取得自己的 Cookie，再由 `/v1/me` 得到 UserId。
5. 管理员身份设为 `isAdmin=true`，其余身份设为 false；播种产生的角色 Cookie 随即丢弃。
6. 页面进入 ready，只列出未归档的 `DigitalWorker` 项目；接入容器属于管理员能力，不进入开发者／测试者快捷选择。

Provider 重启后 issuer 路径变化，端点缓存键随之变化；Provider 行不变，因此 `(provider, subject)` 仍命中同一账户。

## 4. 点击角色

角色按钮是带进程级随机表单令牌的 POST。平台管理员只校准管理员标记；普通成员清除自身非负责人项目关系；开发者与测试者先验证目标数字人项目，再把自身关系收敛为仅该项目的目标角色。随后服务端发起产品 OIDC flow，把固定 subject 附到授权请求并 303 跳转；浏览器在 CrewStation callback 得到正常 `cs_session` Cookie。开发者落到开发页，测试者落到项目的版本试用页，普通成员落到能力市场。项目选择只存在 dev-auth 域的 `localStorage`，刷新与连续换角色时保持；新建项目后可点“同步项目”重新播种并刷新清单。

若固定账号被人工提升为项目负责人，服务拒绝自动清除或转移，页面显示明确原因，避免隐式改变项目所有权。

## 5. 失败与隔离

- 管理员密码失效、平台未就绪、Provider 配置失败、回调失败、成员关系冲突都保留 HTTP 状态和响应摘要。
- 页面与状态文档一律 `no-store`。
- 角色切换与重新播种拒绝缺少／不匹配表单令牌的请求，避免其他本机页面跨站触发权限收敛；若用户点击的是 dev-auth 重启前的旧页签，403 响应仍返回带新令牌的完整页面和明确重试提示，并清理 POST 地址。
- `/healthz` 只表示进程存活；`/readyz` 只在播种完成时成功。
- Secret、Cookie、授权码和 token 不写日志、不进入状态文档。
- `CS_SKIP_DEV_AUTH=1` 让自动化或不需要角色验收的本机安装跳过部署。

## 6. 测试

- 单元：角色映射、跳转白名单、页面状态、项目角色要求。
- 协议：discovery、PKCE、code 一次性、ID token/JWKS、userinfo。
- HTTP／实机：管理员登录、Provider 幂等、四账户播种、管理员标记与成员关系收敛。
- 隔离：生产源码不出现 Provider slug 或固定 subject。
- 实机：本机 kind 集群、Chrome 四角色连续切换并核对各自可见页面。

实机证据见 [acceptance-audit.md](./acceptance-audit.md)。
