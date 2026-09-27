# RFC-033 实施计划

状态：In Progress；用户已批准实施、上库远端与部署本机。

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

CE-01～CE-09 均待执行；按 proposal 的编号分别记自动化、集群协议注入和真实上游回调，不合并证明范围。代码完成、提交、CI、部署、上游配置为不同交付状态。

## 实施边界

预期修改：`integrations/gitlab-event-producer/`、新 `integrations/github-event-producer/`、`modules/scm` 的模板发现／测试及必要打包接线、`modules/events/tests/` 和必要测试夹具、基线与本 RFC 文档。

现有 EventDelivery／Produce DTO、数据库表与投递状态机预期不需要修改；实施中如发现确需变更，先回写具体合同差异。aw 不修改。第三方运行镜像／工作台／referenceResources 在制内容完整保留。

## 开始记录

2026-09-27：完成源码与官方协议核对，CS main fetch 后与 origin/main 0／0；存在其他会话的镜像／布局在制内容。已形成 RFC 三件套，待用户批准，不把此前“补齐能力”的目标指令冒充对尚未展示的具体 RFC 的批准。
