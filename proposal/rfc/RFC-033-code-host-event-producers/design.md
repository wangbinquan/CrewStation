# RFC-033：代码托管事件生产者设计

状态：Done。[proposal](./proposal.md) 已批准并实施，实机入口补充见§8，证据见 [验收](./acceptance.md)。

## 1. 架构与归属

链路：上游 webhook → 对应 EventProducer → cs-events 持久受理 → 当前 active 服务槽 handler → 业务自身事件中心。

- GitLab 改动落在现有 `integrations/gitlab-event-producer/src/gitlab/` 和入口、Manifest、用例。
- GitHub 新项目按 `src/github/`（映射／签名／去重／时间）、`src/events/`（平台客户端）、`src/platform/`（环境）和轻量入口分组。
- 两个 integration 都是可独立构建的业务项目，不跨目录 import 另一项目源码，不依赖 aw。小型平台客户端按现有独立模板方式实现并用合同用例约束；本期不建立未要求的通用连接器 SDK。
- `modules/events` 继续拥有注册、inbox、订阅和投递；`modules/scm` 继续拥有模板发现与物化。只有必要的模板注册、测试与打包接线进入平台；不新增模块或修改分层规则。
- `EventDelivery` 和 Produce API 保持当前版本；沿用现有 GitLab 的代码式 produce 兼容入口，平台负责解析为稳定 eventTypeId，业务订阅仍引用 UUID。

## 2. 类型矩阵

GitLab 保留原表，新增：

| 上游 | 条件 | 平台类型 |
|---|---|---|
| Note Hook | noteable_type=MergeRequest | gitlab.merge-request.comment |
| Note Hook | noteable_type=Issue | gitlab.issue.comment |

GitLab 评论创建／编辑保持上游 action、note ID、时间和正文；同一类型不额外再发布一次通用 note，避免双触发。旧版没有 action 时按评论事实受理；已知 Comment 类型缺少必需对象或 ID 时返回 400。其他 noteable_type 明确 ignored。保留 confidential 等原 payload 字段，不据此创建重复类型；实际上游使用的钩子名以官方合同和样例固定。

GitHub 首期封闭矩阵：

| 上游 | 条件 | 平台类型 |
|---|---|---|
| push | refs/heads/* | github.push |
| push | refs/tags/* | github.tag-push |
| pull_request | opened | github.pull-request.open |
| pull_request | reopened | github.pull-request.reopen |
| pull_request | synchronize／edited／ready_for_review／converted_to_draft | github.pull-request.update |
| pull_request | closed 且 merged=false | github.pull-request.close |
| pull_request | closed 且 merged=true | github.pull-request.merge |
| issue_comment | created 且 issue.pull_request 存在 | github.pull-request.comment |
| issue_comment | created 且 issue.pull_request 不存在 | github.issue.comment |
| pull_request_review_comment | created | github.pull-request.review-comment |
| issues | labeled | github.issue.labeled |
| workflow_run | completed，conclusion=success | github.workflow-run.success |
| workflow_run | completed，conclusion=failure | github.workflow-run.failure |
| workflow_run | completed，conclusion=timed_out | github.workflow-run.timed-out |

CS 保留 GitHub 原始结论；aw 后续可将 timed_out 归并为失败。ping 成功响应但不产生业务事件。其他事件／动作返回明确 ignored。每个受理 webhook 仅产生矩阵中的一个类型。

## 3. payload 与来源

payload 保留原始 JSON 对象，不替换成 aw CodeHostEvent，也不丢 repository／project、PR／MR、issue、comment、changes、sender、workflow_run 等字段。事件类型保存不在 payload 中的上游事件种类所需信息；trace 使用既有 x-cs-trace-id 规则。平台信封保留 producer、eventId、deliveryId、attempt 与 traceId。

MR／PR 普通评论和行评论必须能区分；GitHub issue_comment 用 issue.pull_request 区分对象，不能按事件名全部认作 Issue。PR closed 用 merged 区分关闭与合并。workflow_run 不要求一定带 pull_requests，不能丢弃分支运行或 fork 情形。

## 4. 受理与幂等

GitLab 沿用已有 idempotency-key → x-gitlab-event-uuid → 指纹顺序。仅为新增评论定义指纹：project、noteable_type、目标对象 ID、note ID、action、updated_at／created_at 与 note 正文摘要；旧事件指纹逐字兼容。这样无头重投稳定，而评论编辑与同目标的另一条评论不会合并。

GitHub 使用 X-GitHub-Delivery，加事件类型形成长度受控去重键。缺 ID 的人工／兼容输入用规范化 JSON 摘要：对象键递归排序、数组保持次序；事件名和 action 进入摘要。workflow_run 的 run_attempt 保留；不同运行次数不能因 run ID 相同而去重。无 delivery ID 时只能保证相同业务内容的幂等，不承诺从相同 payload 识别两个不同真实事件；响应／日志标出指纹来源。

接收 GitHub application/json；按原始字节验证 X-Hub-Signature-256 后解析，使用项目 Secret `GITHUB_WEBHOOK_SECRET`。沿用现有 Manifest hmac-sha256 标记。无配置、错误签名、错误 JSON、缺必需业务字段按协议返回明确错误；未知事件按 ignored 返回，不进入 produce。

producer 只有取得并验证 cs-events 成功回执才返回 202 accepted。超时、网络错误、非成功状态和损坏回执返回 5xx，保留同键重送能力。不宣称 GitHub／GitLab 会自动重投所有失败；文档说明上游失败投递的查看和手工重送。

CS 到消费者仍为至少一次交付：重试和死信重放使用原 deliveryId；消费者可靠落库后返回 2xx，eventId 去重业务事实，deliveryId 去重接收记录。传输 attempt 变化不是新业务事件，平台 delivered 不等于 aw 工作流成功。无需修改当前 cs-events 状态机。

## 5. 模板、目录与部署

新增 GitHub 的 Dockerfile、独立 package/lock、crewstation.yaml、template.json、OpenAPI 和 README／CONTRIBUTING；模板、Secret 槽位使用仓库现行 UUIDv7 分配规范。通过现有模板目录按管理员项目流程开通，不自动创建真实上游 webhook。

Manifest 的 produces 与运行时 allEventTypes 双向对拍；类型在平台发布注册，订阅者使用查询到的稳定 UUID，不把模板占位 UUID 写死到生产。更新模板发现／物化用例、独立项目静态检查和镜像打包清单，确保新模板能随发行镜像使用。

原 GitLab 项目的仓库不会自动同步 integration 源码。本期文档给出保留现有配置与订阅的版本升级步骤；实际发布列出源码 SHA、镜像／release 和订阅者回执。

## 6. 测试与交付边界

- 方法级：完整类型矩阵、必需字段、目标区分、发生时间、签名字节、无 ID 指纹、不同评论／编辑／run_attempt。
- producer HTTP：真实请求到可观测 produce 客户端，校验 payload、键、trace、状态及坏回执；签名用固定测试 secret。
- 合同／模板：Manifest 有且仅有支持类型，模板 ID 与 Secret 重映射、发现／物化、生产构建可用。
- 真实 PG 模块链路：producer 接入真实 events API，注册两类 producer 与消费者；重复源事件一份 inbox，消费者先失败再成功、dead 后重放、active 槽切换，身份和 payload 不变。
- 集群：专用验证项目，真实发布、网关入口、事件目录与订阅者持久回执。至少一条 GitLab 评论和一条 GitHub 协议请求。上游真实 GitHub 回调若没有可用仓库／入口，明确未验证，不用手工签名请求冒充。
- 完整本地 gate 只对稳定候选运行一次，先检查是否已有等价 gate；并发无关失败按文件归因。发布后以精确 SHA 的 CI 为最终整仓证据。

## 7. 外部协议来源

2026-09-27 核对官方文档：
- [GitLab webhook events](https://docs.gitlab.com/user/project/integrations/webhook_events/)：评论对象与事件字段。
- [GitHub webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)：事件族、delivery headers、PR／Issue 评论区分。

aw 只读参考：`packages/backend/src/services/webhook/{gitlabAdapter,githubAdapter}.ts`；不复制其整个调度／权限／归一化层到 CS。

## 8. 实机发现的基线缺口修复

外部协议验收实际返回 `403 unknown-workload`：服务域 ForwardAuth 在 producer 验签前一律要求源 Pod，违背基线 §8.5 的“公司系统 → 网关 → EventProducer”。本 RFC 的端到端接入范围包含修复此缺口。

保留现有网关路由和身份头清理链，在 ForwardAuth 增加独立的 webhook 判定：仅 POST、在册 EventProducer 的服务域、当前已就绪正式发布 Manifest 的精确 ingress.path、gitlab-token／hmac-sha256 验证方式可到达容器。未上线、待命、归档、verification=none、其他路径／方法不能借此入口。来源不获平台调用方身份或来源令牌，只分配追踪ID；producer 继续验证真实原始 token／签名。正式服务维护的 services 开关仍返回503。release 模块只暴露当前正式入口的内部只读查询；platform 组合端口，identity 负责 ForwardAuth 响应，不新增数据表／路由合同或伪造平台工作负载。
