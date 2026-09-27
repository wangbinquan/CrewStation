# GitHub EventProducer

CrewStation 独立接入容器：验证 GitHub webhook 原始字节的 HMAC-SHA256 签名，保留完整 payload，以来源服务身份交给 cs-events 持久化、去重和分发。无需 GitHub API token 或 GitHub App。不是 GitHub 源码托管适配器。

## 上线

1. 管理员从 `github-event-producer` 模板创建 EventProducer 项目，选择服务套餐。
2. 在配置中心给 `GITHUB_WEBHOOK_SECRET` 填写生产值（开发环境另配）。密钥没有默认值，缺失时拒绝所有 webhook。
3. 标签发布并切换到正式槽。发布会将 Manifest 的 14 个类型登记到事件目录。
4. GitHub Repository Settings → Webhooks：设置可达的服务域 URL `https://<service-host>/hooks/github`，Content type 选 `application/json`，Secret 与配置中心相同。勾选 Push、Pull requests、Issue comments、Pull request review comments、Issues、Workflow runs。平台服务域须从 GitHub 可达，localhost 地址不能用于 GitHub 公网回调。
5. 业务方从事件目录取得 UUID，在自己的 Manifest 声明 `subscriptions: [{ eventTypeId: <UUID>, handlerPath: /events/github }]`，发布上线。消费者收到 EventDelivery，原 webhook 在 `payload`，须先持久化 inbox 再返回 2xx，并按 deliveryId 幂等。

| GitHub 事件／动作 | 平台类型（前缀 `github.`） |
|---|---|
| push / refs/heads、refs/tags | push、tag-push |
| pull_request / opened、reopened | pull-request.open、pull-request.reopen |
| synchronize、edited、ready_for_review、converted_to_draft | pull-request.update |
| closed / merged=false、true | pull-request.close、pull-request.merge |
| issue_comment / created，issue.pull_request 存在 | pull-request.comment |
| issue_comment / created，普通 issue | issue.comment |
| pull_request_review_comment / created | pull-request.review-comment |
| issues / labeled | issue.labeled |
| workflow_run / completed，success、failure、timed_out | workflow-run.success、workflow-run.failure、workflow-run.timed-out |

只处理该封闭集合；其他 action（包括评论编辑、删除和其余 workflow conclusion）返回 202/ignored，不产生事件。签名有效的 ping 返回 200/pong。已支持事件缺少对象身份返回 400。表单格式返回 415。

## 回执与故障处理

`X-Hub-Signature-256` 必须是正确的 `sha256=<hex>`。签名在 JSON 解码前校验，缺少、错误或正文被改写均为 401。日志不记录密钥和原始正文。

`X-GitHub-Delivery` + eventType 是首选去重键，同一 delivery 重送返回同一个平台 eventId。无 delivery 头时用递归排序键的 JSON 指纹（数组保序）；workflow 的 run_attempt 参与摘要。日志 `dedupSource=payload-fingerprint` 可识别此退化路径：完全相同的两次独立事件仍可能被合并，应保留 delivery 头。

只有 cs-events 返回有效持久化回执才返回 202/accepted。cs-events 拒收、超时或回执损坏返回 502/503；超时后可安全用原 delivery ID 重送。GitHub **不会自动重送失败 webhook**，需在 Recent deliveries 或通过 GitHub API 重送。平台接受后，消费者失败由 cs-events 重试，超限进入死信，可在投递记录重放；切槽后使用当前正式槽。

`GET /healthz` 是进程健康，`GET /` 展示部署身份和类型。无 CS_SERVICE_DOMAIN 时受支持 webhook 返回 503；`EVENTS_BASE_URL` 仅供本机开发覆盖。

## 本机开发

`bun install --frozen-lockfile`，设置 `GITHUB_WEBHOOK_SECRET`、`EVENTS_BASE_URL` 后 `bun run dev`。`bun test` 验证官方协议形状、签名、矩阵与失败语义。`docker build -t github-event-producer .` 可独立构建。

协议来源：[GitHub webhook payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)、[签名验证](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)、[失败投递](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)。
