# RFC-033 实施计划

状态：Done；用户已批准实施、上库远端与部署本机。T1～T8已完成，证据见 [验收](./acceptance.md)。

## 任务

| 任务 | 内容 | 依赖 |
|---|---|---|
| RFC-033-T1 | 固定官方协议夹具和完整类型矩阵；为 GitLab 缺评论写失败用例 | 批准 |
| RFC-033-T2 | GitLab 评论映射、类型登记、仅新增类型的指纹与文档 | T1 |
| RFC-033-T3 | 独立 GitHub producer：类型、签名、时间、去重、平台回执与 HTTP 用例 | T1 |
| RFC-033-T4 | GitHub 模板、镜像／目录接线，配置槽位与发布材料验证 | T3 |
| RFC-033-T5 | 两类 producer → 真实 PG events → 消费者的重投／死信／切槽测试 | T2、T4 |
| RFC-033-T6 | 定向检查、单次稳定候选完整 gate、改动行防护与功能复核 | T5 |
| RFC-033-T7 | 在明确授权范围精确发布，核对精确 SHA CI；隔离集群验证与清理回执 | T6、发布／运行授权 |
| RFC-033-T8 | 更新基线三件套、STATE、RFC 状态和逐项验收证据 | T7 |

## 验收跟踪

CE-01～CE-09已按本期范围验收。生产代码c072aef6和493bd47a的精确SHA CI均六项success；本机三类评论投递到独立持久消费者通过。真实上游公网回调未配置；人工协议注入与联网回调分开记证据。验收消费者保留50m／256Mi供复核；旧待命槽已下线，平台禁止直接删除承流正式槽，未绕过保护。

## 实施边界

实际修改：`integrations/gitlab-event-producer/`、新 `integrations/github-event-producer/`、`modules/scm` 的模板发现／测试及必要打包接线、`modules/events/tests/` 和必要测试夹具、基线与本 RFC 文档；实机暴露的网关缺口通过identity／release／platform精确入口策略修复，见design§8。

现有 EventDelivery／Produce DTO、数据库表与投递状态机均未修改。aw 不修改。第三方运行镜像／工作台／referenceResources 在制内容完整保留。

## 开始记录

2026-09-27：完成源码与官方协议核对，CS main fetch 后与 origin/main 0／0；存在其他会话的镜像／布局在制内容。已形成 RFC 三件套，待用户批准，不把此前“补齐能力”的目标指令冒充对尚未展示的具体 RFC 的批准。
