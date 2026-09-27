# RFC-033：补齐代码托管事件生产者

状态：Done · 2026-09-27。已按用户批准实施、上库远端并部署本机；自动化、精确SHA CI与本机协议链路通过，见 [验收](./acceptance.md)。真实公网GitHub回调未配置。

配套：[设计](./design.md) · [计划](./plan.md)

## 1. 问题与证据

aw 接入 CS 后需要保留 MR／PR 评论、Issue 评论、代码变更、标签和流水线触发。CS 已有持久事件分发、订阅、失败重试和死信；缺口在生产者覆盖，不需要另建事件引擎。

源码基线：CS `a2d019103197bb42bf2c7d2104fca6a07a30d196`，aw `a53425b87bc6fa124d74829c278f52059ca04c93`。aw 仅作只读需求对照。

- `integrations/gitlab-event-producer/src/gitlab/eventType.ts:31` 的钩子表没有 Note Hook。
- `integrations/` 目前只有 GitLab producer 与参考 APIProxy，没有 GitHub producer。
- aw 的 `packages/backend/src/modules/integration/public/events.ts:19` 包含 MR 评论、Issue 评论、Issue 标签、push、tag、MR 生命周期、流水线结果。
- `modules/events/application/deliverEvent.ts:9` 已支持 active 槽投递、失败退避与死信；`packages/contracts/events/delivery.ts:5` 已有稳定事件和投递身份。
- `packages/contracts/manifest/manifest.ts:46` 已支持 EventProducer 和 hmac-sha256；不需要为 GitHub 新增 Manifest 类型。

## 2. 本期范围

1. 现有 GitLab producer 增加 MR／Issue 评论；保留原事件类型、原 payload 和已有订阅。
2. 新增独立的 `integrations/github-event-producer`，作为管理员可创建的 EventProducer 模板，覆盖 aw 当前使用的 GitHub webhook 家族。
3. 保留原始业务 payload；CS 类型负责区分来源事件，aw 业务规则和归一化仍由 aw 自己实现。
4. 同一事件重复投递保持同一个平台事件，不同评论、编辑和不同 workflow run attempt 不互相吞掉；消费端仍需幂等处理投递。
5. 测试覆盖原始 webhook 经 producer 到真实 cs-events 持久化／投递的链路，验证重试、死信重放与切槽；不以 producer 的 HTTP mock 代替平台链路证据。

GitHub 模板按需创建，不在每次平台安装时强制创建空配置的 GitHub 项目。现有 GitLab 项目不会仅因仓库源码变化而自动升级；交付需记录新发布产物及升级方法。

## 3. 用户流程

管理员创建或升级 EventProducer 项目，配置 webhook secret，发布并上线；在 GitLab／GitHub 配置 JSON webhook 和所需事件。业务负责人在现有事件目录中选择类型，声明订阅及 handlerPath，发布后接收 EventDelivery 信封。在现有投递记录中查看失败、重试与死信；无需填写 aw 内部标识。

## 4. 能力影响

全部为新增能力。GitLab 原事件类型、已有订阅 ID、原 payload 结构、生产者投递协议和默认安装流程保持兼容。新 GitHub 类型拥有独立命名空间。未支持的事件明确返回 ignored，不伪造 accepted。先前不能处理的评论改为实际投递，是本次产品行为变化。

## 5. 非目标

不改 aw，不替 aw 实现事件接收器或工作流规则；不增加 GitHub 源码托管后端、GitHub App 安装管理、APIProxy 或评论回写；不声称覆盖 GitHub／GitLab 所有事件，不增加业务自定义事件、定时触发和全局 exactly-once 保证。

## 6. 验收标准

- CE-01：GitLab MR、Issue 评论都能投递，目标类型区分准确；不把 Commit／Snippet 评论误当 MR。
- CE-02：GitLab 评论新增与编辑携带完整原 payload、稳定去重身份和合理发生时间，原事件回归通过。
- CE-03：GitHub push／tag、PR 生命周期、PR 普通评论／行评论、Issue 评论／标签、workflow run 结果逐项可投递。
- CE-04：GitHub 原始字节签名、事件头、delivery ID 和 JSON 处理有协议回归，ping 可正常响应。
- CE-05：重复、超时后重送、下游不可用、无效回执均有明确结果，不在持久受理前报成功。
- CE-06：Manifest produces、映射输出和实际事件目录一致；模板可发现、物化、构建和发布。
- CE-07：真实 PG 的生产／订阅／投递链路证明一条源事件只有一份 inbox；失败重试和死信重放保持身份，切槽后路由到当前正式槽。
- CE-08：隔离集群业务完成至少一条 GitLab 评论与一条 GitHub 签名 webhook 到订阅者的端到端验证。真实外部平台回调和人工协议注入分开记证据，不能互相冒充。
- CE-09：原有 GitLab 事件与模板回归通过，新增代码纳入现有四层门禁和改动行防护。

## 7. 审批点

批准本稿即采用：新增独立 GitHub 模板、按需开通、保留原 payload、使用下述封闭类型矩阵和现有分发引擎。实际生产项目升级、真实上游 webhook 配置与集群资源操作按明确的发布／验收授权执行，不从“源码实现完成”推定已上线。
