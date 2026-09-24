# 参考 API 代理（reference-api-proxy）

平台首版交付的**参考 APIProxy 接入容器**：对接本机测试 GitLab 的纯转发代理（Design §8.1）。管理员要接一个新的公司系统时，复制本项目，改三处——`crewstation.yaml` 的 `proxy` 名与 `upstream.connection`、`openapi.yaml` 的操作清单、`src/proxy/catalog.ts` 的同名清单——转发逻辑照搬。

```text
调用方（数字人／开发会话） → 网关服务域 http://api.<serviceDomain>/api/test-gitlab/v4/projects
  网关：按源 Pod IP 认出调用方 → 查放行表 → 剥掉 /api/test-gitlab 前缀 → 转给本代理 prod 槽
  本代理：拼成 <上游>/api/v4/projects，带上平台注入的上游令牌 → 上游响应原样回传
```

## 它不做的事

**本代理不实现鉴权，这是刻意的。** 一次调用能到达这里，说明网关已经按放行表判过了（Design §8.3）：调用方的源 Pod IP 解析出了某个服务、目标操作在目录里、该操作对它默认开放或有已审批的 APIGrant。代理再判一遍，只会造出两份会不一致的规则。资源级范围由上游或业务把关——上游只看到“平台连接”这一个主体，这是记录在案的设计选择（Design §8.1、§13.4）。

同样不做的：不解析身份令牌、不读 cookie、不在代码里存任何长期凭据、不改写请求体与响应体。

## 它做的事

| 环节 | 位置 | 要点 |
|---|---|---|
| 拼上游请求 | `src/proxy/upstreamRequest.ts` | 方法、路径、查询串原样带过去；GitLab REST 挂在 `/api` 下，故 `/v4/projects` → `<上游>/api/v4/projects`。路径里的 `%2F` 编码原样保留 |
| 处理请求头 | 同上 | 剥掉逐跳头、`host`／`content-length`、调用方自带的凭据头与 `x-cs-*` 身份头；换上平台注入的 `PRIVATE-TOKEN`；`x-cs-trace-id` 透传 |
| 发出并回传 | `src/proxy/forward.ts` | 请求体作为流原样带过去；上游状态码与响应体原样回传，包括它的 4xx |
| 处理响应头 | `src/proxy/upstreamResponse.ts` | 上游的分页、限流等业务头保留；`content-encoding`／`content-length`／`set-cookie` 不回传；回显 `x-cs-trace-id` |

调用方自带的 `Authorization`／`Private-Token` 一律剥掉：凭据只能来自平台，不能由调用方指定，也顶不掉平台注入的令牌。

## 暴露的接口片段

**这片接口是刻意选小的。** 目标是当样板，不是把 GitLab API 抄全：项目、分支、标签、提交四类只读接口，加一个建分支的写操作用来证明请求体确实原样转发。要扩，就在 `openapi.yaml` 里加 `paths`、在 `src/proxy/catalog.ts` 同步补上，然后发布——目录只认发布登记过的操作，`src/proxy/catalog.test.ts` 会比对两份清单。

| 操作键 | 说明 |
|---|---|
| `test-gitlab:GET:/v4/projects` | 列出项目 |
| `test-gitlab:GET:/v4/projects/{id}` | 取单个项目 |
| `test-gitlab:GET:/v4/projects/{id}/repository/branches` | 列出分支 |
| `test-gitlab:POST:/v4/projects/{id}/repository/branches` | 建分支（唯一的写操作，建议设为定向开放） |
| `test-gitlab:GET:/v4/projects/{id}/repository/branches/{branch}` | 取单个分支 |
| `test-gitlab:GET:/v4/projects/{id}/repository/tags` | 列出标签 |
| `test-gitlab:GET:/v4/projects/{id}/repository/commits` | 列出提交 |
| `test-gitlab:GET:/v4/projects/{id}/repository/commits/{sha}` | 取单个提交 |

代理名用 `test-gitlab` 而不是 `gitlab`：代理名全平台唯一，别让参考实现占掉将来接真 GitLab 要用的名字。开放策略（默认开放／定向开放）由管理员在工作台逐操作设定，Manifest 里说了不算。

## 目录

```text
crewstation.yaml                Manifest（kind: APIProxy，proxy: test-gitlab）
openapi.yaml                    向目录登记的 8 个操作
src/main.ts                     Hono 路由与进程入口
src/proxy/catalog.ts            代理名与操作清单（与 openapi.yaml 比对）
src/proxy/upstreamRequest.ts    拼上游请求：URL、方法、请求头
src/proxy/upstreamResponse.ts   回传响应头与平台错误信封
src/proxy/forward.ts            发出请求、回传响应、超时与连接失败
src/platform/environment.ts     平台注入的环境变量与配置项
Dockerfile                      oven/bun 镜像，bun install --frozen-lockfile --production
CONTRIBUTING.md                 只指向平台的能力说明入口
```

## 配置

| 名字 | 来源 | 说明 |
|---|---|---|
| `GITLAB_BASE_URL` | Manifest `spec.env`，`from: config`，有 default | 上游地址。默认 `http://host.docker.internal:8929`（与 `deploy/k8s/platform/10-config.yaml` 的 `CS_GITLAB_URL` 同一套本机约定），首个标签即可发布；负责人随后在工作台按本环境的实际地址覆盖 |
| `GITLAB_TOKEN` | Manifest `spec.env`，`from: secret` | 上游访问令牌。**密钥不允许声明 default**，必须由项目负责人显式提供。没有它代理照样转发，由上游按匿名身份决定给什么——代理不代替上游做判断 |

## 本地运行（不经网关）

```bash
bun install
GITLAB_BASE_URL=http://127.0.0.1:8929 GITLAB_TOKEN=<本机测试 GitLab 的令牌> bun run dev
curl localhost:3000/                       # 自述状态：代理名、部署槽、上游配没配
curl 'localhost:3000/v4/projects?per_page=3'
curl localhost:3000/v4/projects/crewstation%2Fdemo/repository/branches
bun test
```

注意本地直连时**没有网关**，也就没有放行表：任何人都能调。真实链路上，调用方必须先在目录里拿到该操作的授权。

## 用 Docker 运行

```bash
docker build -t reference-api-proxy:dev .
docker run --rm -p 13002:3000 -e GITLAB_BASE_URL=http://host.docker.internal:8929 -e GITLAB_TOKEN=<令牌> reference-api-proxy:dev
```

## 在平台上

- **建项目**：管理员以 `kind: APIProxy` 代建并指定负责人；`deploy/local/bootstrap-integrations.sh` 在本机集群上做这件事。
- **发布**：只有平台创建的 `v<major>.<minor>.<patch>` 标签触发构建与发布。发布时平台读 `openapi.yaml`，按 `<proxy>:<METHOD>:<path>` 把操作登记进内部 API 目录；没发布过的操作调用方申请不到，也调不通。
- **调用方怎么用**：在自己的 `crewstation.yaml` `spec.apis.requested` 写 `{ proxy: test-gitlab, method, path }`，或在工作台申请；管理员批准后，调用方经服务域访问 `${CS_INTERNAL_API_BASE}test-gitlab/v4/projects`，请求不带任何凭据。工作台的 Swagger 页只会显示该服务当前可调的操作。

## 已知边界

- **上游凭据目前是平台注入的密钥，不是按需下发的短期凭据。** Design §8.1 的目标形态是“上游凭据由 cs-auth 的凭据服务按 `UpstreamConnection` 在调用时短期下发”；那条凭据服务接口还没有，所以本代理按 Manifest `spec.env` 的密钥取长期令牌。`spec.upstream.connection` 已按最终形态声明为 `test-gitlab`，凭据服务就绪后把 `GITLAB_TOKEN` 换成按需获取即可，转发逻辑不用动。
- **本代理直接请求上游**（RFC-018）。平台不再按域名限制出站，也不再有平台转发通道与被阻请求记录。2026-09-24 起（Design D64）项目命名空间的默认网络策略对所有 Pod 放开出向，数字人服务槽也能直连外部；接入容器项目另有的 `crewstation-integration-egress` 策略（给 `workload=service` 的 Pod 放开出向）照旧下发，但已不再起作用。数字人服务经接口目录调用本代理时，网关仍按放行表判定。
- 早于 RFC-018 的版本经 `/internal/egress/http` 转发。那条路由已删除，旧镜像在新平台上会拿到 404，**必须重新发布一版**才能恢复上游调用。
- 重定向按 `redirect: 'manual'` 原样回传，由调用方决定跟不跟——代理替调用方跟随重定向，等于替它决定去访问哪个地址。
- 上游超时 30 秒后回 `504`，连不上回 `502`，都用平台错误信封，说明里不带令牌与上游地址细节。`Bun.serve` 的 `idleTimeout` 显式设成 45 秒：它默认 10 秒就掐连接，那样上游一慢，调用方拿到的是连接被重置而不是这条 504。
- 日志只记方法、上游路径与状态码：查询串可能带业务参数，请求头里有凭据，都不进日志。
- 只转发 HTTP；WebSocket 升级不支持（`upgrade` 头在剥掉之列）。
- 平台能力的权威说明见 `CONTRIBUTING.md` 指向的入口，本文不复述。
