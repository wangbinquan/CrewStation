# GitLab 事件生产者（gitlab-event-producer）

平台内置的 **EventProducer 接入容器**：公司 GitLab 的 webhook 经服务域进来，验密钥、归一化成平台事件类型、算出稳定的去重键，再以本服务的身份投给 `cs-events`（Design §8.5）。它是管理员建的平台项目，但走的是和任何数字人一样的建仓、开发会话、标签发布与两槽切流流程——**它是业务项目，不是平台服务**。

```text
公司 GitLab → 网关服务域 → 本接入容器（验签、归一化、以自身身份投递）
            → cs-events：去重、持久化、生成或延续 trace_id
            → 网关服务域（注入平台来源令牌）→ 订阅方 prod 活动槽在 Manifest 声明的处理路径
```

## 它做的四件事

| 步骤 | 位置 | 要点 |
|---|---|---|
| 验 webhook 密钥 | `src/gitlab/webhookToken.ts` | 只认 `X-Gitlab-Token`。对不上、没带、或服务根本没配密钥，一律 401，任何解析都不做。两侧各取 SHA-256 再定长比较，比较耗时与输入无关 |
| 归一化事件类型 | `src/gitlab/eventType.ts` | `X-Gitlab-Event` 加 payload → `gitlab.push`／`gitlab.pipeline.success` 这样的点分类型 |
| 算去重键 | `src/gitlab/dedupKey.ts` | 同一次事件重投多少次都算出同一个键，交给 `cs-events` 的 inbox 按 `(producer, dedupKey)` 去重 |
| 投给 cs-events | `src/events/eventsClient.ts` | `POST http://events.<CS_SERVICE_DOMAIN>/v1/events/produce`，**不带任何凭据**：网关按源 Pod IP 认出本服务 |

没有登录代码、没有 cookie、不解析身份令牌。本接入容器只住在服务域上。

## 事件类型映射

类型是**封闭集合**：`cs-events` 对未在 `crewstation.yaml` `spec.produces` 登记的类型返回 404，所以代码里的映射用白名单，白名单外的动作一律退回两段式基础类型，绝不即兴拼出没登记过的类型。`src/gitlab/eventType.test.ts` 会把代码里的集合与 Manifest 的 `produces` 逐项比对，改一处就必须改另一处。

| `X-Gitlab-Event` | 事件类型 | 细分依据 |
|---|---|---|
| `Push Hook` | `gitlab.push` | 无 |
| `Tag Push Hook` | `gitlab.tag-push` | 无 |
| `Merge Request Hook` | `gitlab.merge-request`＋`.open`／`.close`／`.reopen`／`.update`／`.merge`／`.approved`／`.unapproved` | `object_attributes.action` |
| `Pipeline Hook` | `gitlab.pipeline`＋`.created`／`.pending`／`.running`／`.success`／`.failed`／`.canceled`／`.skipped`／`.manual` | `object_attributes.status` |
| `Issue Hook` | `gitlab.issue`＋`.open`／`.close`／`.reopen`／`.update` | `object_attributes.action` |

其他钩子（wiki、note、job、release 等）本接入容器不产生事件：返回 `202` 加 `ignored: true`，让 GitLab 别再重投。要支持它们，在 `HOOK_RULES` 加一条规则、在 `spec.produces` 补上对应类型，然后发布。

## 去重键怎么来

投递体的 `dedupKey` 按下面的顺序取第一条命中的来源，前面再拼上事件类型：

1. `Idempotency-Key` 请求头——GitLab 16.x 起为重投保持不变的幂等键，语义最准；
2. `X-Gitlab-Event-UUID` 请求头——同一次触发的事件 UUID，重投保持不变；
3. payload 指纹——两个头都没有时（老版本 GitLab、手工重放），对 `object_kind`、`ref`、`before`、`after`、`checkout_sha`、`project.id` 与 `object_attributes` 的身份／时刻字段取 SHA-256。

得到的键形如 `gitlab.push|uuid:01936f…`。三条来源各有前缀，同一次投递派生出的不同类型也不会互相顶掉。超过平台上限 200 字符时整体压成摘要而**不是截断**——截断会让两个不同事件撞成同一个键。指纹只取标量字段：GitLab payload 里的嵌套结构顺序不稳，整体哈希会让同一事件每次算出不同的键。

## 回应 GitLab 的约定

| 状态码 | 含义 | GitLab 的反应 |
|---|---|---|
| `202 accepted:true` | 已受理（`deduplicated:true` 表示去重命中，未产生新投递） | 完成 |
| `202 ignored:true` | 本接入容器不产生该钩子的事件 | 完成，不重投 |
| `400` | 请求体不是 JSON 对象 | 不重投 |
| `401` | 密钥缺失或不符 | 不重投 |
| `502` | `cs-events` 拒收（多为事件类型尚未随发布登记） | 按自己的策略重投 |
| `503` | `cs-events` 暂时不可用，或还没注入 `CS_SERVICE_DOMAIN` | 按自己的策略重投（Design §8.5） |

`cs-events` 拒收时回 5xx 而不是吞成 2xx，是刻意的：受理不了就让上游知道，别把事件悄悄丢掉。

## 目录

```text
crewstation.yaml              Manifest（kind: EventProducer，producer: gitlab，24 条 produces）
openapi.yaml                  HTTP 接口说明（EventProducer 不进 API 目录，见“已知边界”）
src/main.ts                   Hono 路由与进程入口
src/gitlab/eventType.ts       X-Gitlab-Event ＋ payload → 平台事件类型
src/gitlab/dedupKey.ts        稳定去重键
src/gitlab/webhookToken.ts    X-Gitlab-Token 定长比较
src/gitlab/occurredAt.ts      事件发生时刻归一化成 RFC 3339
src/events/eventsClient.ts    投递 cs-events
src/platform/environment.ts   平台注入的环境变量与配置项
src/platform/identity.ts      traceId 请求头
Dockerfile                    oven/bun 镜像，bun install --frozen-lockfile --production
CONTRIBUTING.md               只指向平台的能力说明入口
```

## 配置

| 名字 | 来源 | 说明 |
|---|---|---|
| `GITLAB_WEBHOOK_SECRET_TOKEN` | Manifest `spec.env`，`from: secret` | GitLab webhook 上配置的 Secret token。**密钥不允许声明 default**（`EnvEntrySchema` 会拒绝），必须由项目负责人在工作台显式提供；没有它本服务拒绝一切 webhook |
| `CS_SERVICE_DOMAIN` | 平台注入 | `cs-events` 的地址由它推导为 `http://events.<域>`；Manifest 里不写死任何一套环境的域名 |
| `EVENTS_BASE_URL` | **只在本机开发时有效** | 故意不在 `spec.env` 声明，因此平台部署时不会注入它 |

## 本地运行（不经网关）

```bash
bun install
GITLAB_WEBHOOK_SECRET_TOKEN=local-secret EVENTS_BASE_URL=http://localhost:8084 bun run dev
curl localhost:3000/                       # 自述状态：生产方、投递目标、已登记的事件类型
curl -i -X POST localhost:3000/hooks/gitlab \
  -H 'content-type: application/json' -H 'x-gitlab-event: Push Hook' \
  -H 'x-gitlab-token: local-secret' -H 'x-gitlab-event-uuid: uuid-1' \
  -d '{"object_kind":"push","ref":"refs/heads/main","project":{"id":7},"commits":[{"timestamp":"2026-09-11T07:05:00Z"}]}'
# 密钥不符 → 401，且完全不去碰 cs-events：
curl -i -X POST localhost:3000/hooks/gitlab -H 'content-type: application/json' \
  -H 'x-gitlab-event: Push Hook' -H 'x-gitlab-token: wrong' -d '{}'
bun test
```

## 用 Docker 运行

```bash
docker build -t gitlab-event-producer:dev .
docker run --rm -p 13001:3000 -e GITLAB_WEBHOOK_SECRET_TOKEN=local-secret -e CS_SERVICE_DOMAIN=svc.cs.internal gitlab-event-producer:dev
```

## 在平台上

- **建项目**：管理员以 `kind: EventProducer` 代建并指定负责人；`deploy/local/bootstrap-integrations.sh` 在本机集群上做这件事。
- **配 webhook**：在 GitLab 项目或群组的 Webhooks 页填服务域上的 `http://<service>.<serviceDomain>/hooks/gitlab`，Secret token 填与 `GITLAB_WEBHOOK_SECRET_TOKEN` 相同的值，勾上 Push／Tag push／Merge request／Pipeline／Issues 事件。
- **发布**：只有平台创建的 `v<major>.<minor>.<patch>` 标签触发构建与发布；构建结果先到待命（preview）槽，负责人切流后上线。事件类型在**发布登记**时才进目录——没发布过，订阅方订阅它也不会有投递。
- **订阅方**：在自己的 `crewstation.yaml` `spec.subscriptions` 写 `eventType` 与 `handlerPath`；`templates/minimal-sample` 订阅的就是这里产生的 `gitlab.push`。

## 已知边界

- `kind: EventProducer` 的发布**不进内部 API 目录**（`modules/api-catalog/application/registerRelease.ts` 对 EventProducer 直接返回），所以 `openapi.yaml` 是给配 webhook 的管理员和排查链路的人看的说明，不是可申请调用的操作清单，Manifest 也没有 `apis` 段可声明。
- `cs-events` 的主机名按 `events.<CS_SERVICE_DOMAIN>` 推导，前缀镜像 `packages/contracts/convention.ts` 的 `PLATFORM_SERVICE_HOSTS.events`。接入容器是独立项目，不 import 工作区包，所以这份字面值是抄来的——平台哪天改了名，这里要跟着改。
- Manifest 的 `spec.ingress.verification: gitlab-token` 只是**声明**当前用的验签方式，平台并不代为校验；真正的校验在 `src/gitlab/webhookToken.ts` 里，两处必须一致。
- 投递 `cs-events` 的超时是 8 秒，刻意小于 `Bun.serve` 默认的 10 秒空闲超时：卡住的投递要来得及收口成一条 5xx，否则 GitLab 看到的是连接被重置而不是可重试的失败。
- 本服务不留任何状态：投递成功与否只进 stdout 日志（密钥与 webhook 正文都不进日志），排查靠工作台的日志页与投递记录页。
- 平台能力的权威说明见 `CONTRIBUTING.md` 指向的入口，本文不复述。
