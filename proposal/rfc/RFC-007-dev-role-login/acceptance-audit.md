# RFC-007｜实机验收记录

> 2026-09-20，本机 `docker-desktop` Kubernetes、真实 Traefik／cs-auth／cs-api、Google Chrome。

## 自动验证

- `bun test tools/dev-auth/devAuth.test.ts`：8 pass／0 fail／32 assertions。
- 覆盖四角色且无 owner、无项目／错误态、只选未归档数字人项目、表单令牌、旧页面令牌失效后的可恢复提示、站内回跳、discovery、PKCE S256、授权码一次性消费、RS256 ID token 与 JWKS 验签、生产源码隔离；2026-09-22 起改为「就绪只看端口」「身份跨重启固定」「播种失败自动重试」「管理员会话优先走 OIDC」四条回归。
- `bunx tsc -p tsconfig.json --noEmit` 与 `bunx eslint tools/dev-auth --no-warn-ignored` 通过。
- 统一冻结候选的最终 `bun run check`：1614 pass／5 skip／0 fail，8995 assertions；`arch:check`、全仓 ESLint、根 TypeScript 与 console TypeScript 全部通过。
- 缺少或过期表单令牌的真实 `POST /login/developer` 返回 HTTP 403，同时返回带新令牌的完整角色页；地址清回 `/`，用户可直接重新点击，不再暴露原始错误文本。

## 部署链

- `crewstation-dev-auth` Deployment 为 1／1 Ready，镜像 `cs-control-plane:dev`，只执行 `tools/dev-auth/main.ts`。
- `http://dev-auth.cs.localhost/status.json` 返回 `status=ready`，项目清单只含 6 个未归档 `DigitalWorker`；两个接入容器没有进入下拉。
- 首次部署发现 Service 只发布 Ready Endpoint，导致 cs-auth 无法在播种阶段访问 discovery，readiness 自锁。当时修正为 `publishNotReadyAddresses: true`。
- **2026-09-22 推翻上一条**：该字段在 Traefik 3.7 上并不生效（只抬 EndpointSlice 的 `ready`，Traefik 按 `serving` 过滤，router 被整条丢掉，网关返回 404 而不是 503），而且 readiness 本就不该等播种。现在 `/readyz` 只看端口、字段已删除，回归用例改为固定这条新约束。同批把身份固定进 Secret、播种失败自动重试、管理员会话优先走自己的 OIDC——实测密码登录关闭时冷启动仍能播种到 `ready`。
- 安装器连续运行并重启 dev-auth 后仍就绪；Provider 按 slug 原位更新，固定 subject 命中既有账户。日志只含页面地址与监听端口，没有管理员口令、Cookie、授权码、token 或 client secret。
- 最终重启后 Provider 仍为 `idp_01a0bd7cba6b7000804a1ede41f9c22a`；四个固定账户 ID 均未变化，证明随机 issuer／密钥／client secret 轮换没有重复建号。

## Chrome 角色旅程

目标项目为 `RFC-006 实机验收`（`prj_01a0b3546ef570009ee4c590852cca21`）。四次点击都经 dev-auth authorization endpoint、CrewStation callback 和 `cs_session` 完成，`/v1/me` 的 `authMethod` 均为 `oidc`。

| 入口 | `/v1/me` | 页面证据 |
|---|---|---|
| 平台管理员 | `dev-admin@roles.localhost`，`isAdmin=true`，无项目成员关系 | 落到 `/admin`，管理空间完整导航可见 |
| 项目开发者 | `dev-developer@roles.localhost`，`isAdmin=false`，唯一成员关系为目标项目 `developer` | 直接落到 `/projects/prj_01a0b3546ef570009ee4c590852cca21/dev-session`，开发、发布、诊断、设置均可见 |
| 项目测试者 | `dev-tester@roles.localhost`，`isAdmin=false`，唯一成员关系为目标项目 `tester` | 只显示“版本试用”；页面明确开发、发布、配置和诊断由开发者或负责人操作 |
| 普通成员 | `dev-member@roles.localhost`，`isAdmin=false`，成员关系为空 | 落到能力市场，当前无可见应用；没有管理空间或项目入口 |

最终先保留重启前页面，再滚动 dev-auth：第一次点击得到“页面已更新／此前页面的安全令牌已失效”提示和完整角色页，第二次点击以新令牌完成真实 OIDC 并落到开发会话页。随后恢复平台管理员。项目下拉只剩数字人项目，选择 RFC-006 后刷新仍保持该选项。Chrome 最终停在 `http://dev-auth.cs.localhost/`，浏览器中的 CrewStation 会话恢复为开发环境平台管理员。

## 发布证据

- 功能与首次管理员链随提交 `fd1418fd78a1601fbae81860ecaf12dc3213a1f2` 推上 `main`；该提交包含 dev-auth、安装编排、OIDC 配置、首次访问创建管理员及对应测试与文档。
- 首轮托管 `check` 唯一失败是测试调用了 CI 镜像没有安装的外部 `rg`。提交 `35452d504eb827cbb858e78a42b59369adad6b5b` 改用 `Bun.Glob` 读取相同生产目录，仍断言扫描文件数大于 0 且开发标记零命中，不降低隔离标准。
- 推送后重新 fetch，`HEAD` 与 `origin/main` 同为 `35452d504eb827cbb858e78a42b59369adad6b5b`，左右提交数 `0／0`；`fd1418fd78a1601fbae81860ecaf12dc3213a1f2` 是该远端提交祖先。
- 精确 SHA [GitHub Actions 35496732781](https://github.com/wangbinquan/CrewStation/actions/runs/35496732781) 成功：`check`（job `106040960057`）3 分 7 秒，`e2e`（job `106040960190`）5 分 39 秒；真实 Kind 集群安装、调试浏览器启动与前端验收全部通过。
