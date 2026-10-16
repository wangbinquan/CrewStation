# RFC-041｜实施计划

> 状态：Done · 2026-10-16 · 已按作者批准完成正式实现、本机部署与真实验收；CLI/Bot 保持独立。

| 任务 | 依赖 | 产物与验收 | 状态 |
|---|---|---|---|
| RFC-041-T1 | 无 | 明确三段 Agent/session、独立边界、三件套和交互原型 | Done：原型已通过 Chrome 交互检查并获作者批准 |
| RFC-041-T2 | T1 | 稳定 conversation/epoch、迁移、消息受理与持久回执 | Done：真实 PG 并发回归与实机同键去重通过 |
| RFC-041-T3 | T2 | 原生私有卷、固定身份/UID、台账与父生命周期 | Done：实际 PVC 隔离、父重建保留、释放后两 PVC/两 PV 物理消失 |
| RFC-041-T4 | T2,T3 | Runner 能力协商、幂等、严格 session 恢复 | Done：同一原生 session 跨四个执行 Pod，停止/冷续接/父重建后均回忆首轮随机标记 |
| RFC-041-T5 | T2,T4 | 默认连续聊天、停止本轮、统一历史与工具弹窗、显式 fresh、旧记录兼容 | Done：Chrome 刷新/离页/独立 CLI 切换、工具参数和新上下文边界通过 |
| RFC-041-T6 | T3,T4,T5 | 分层测试、准确提交 GitHub gate/e2e | Done：ff948919 的 CI 38868457866、最终后端 32cf2d7e 的 CI 38870965711 均九项成功；本机全量失败如实保留 |
| RFC-041-T7 | T6 | 本机部署和真实模型/浏览器/集群验收 | Done：七后端与 Console Ready，Runner 固定镜像，桌面/390px 和 CB-01–CB-10 分层完成 |
| RFC-041-T8 | T7 | 可携带证据、已知边界、资源清理与 RFC 收口 | Done：[验收记录](acceptance.md)、[JSON 证据](continuous-bot-live-20261016.json)、索引与 STATE 已同步 |

原型不作为真实模型证据；夹具、完整本地失败、准确 CI、部署与实机结果分别记录。原版本已删除 HOME 的旧 Agent 不冒称可恢复；CLI 始终保持独立。停止本轮保留原生上下文，明确 fresh 才推进 epoch，释放 follow-container 父环境会回收私有上下文卷。
