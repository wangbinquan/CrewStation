# RFC-044 实施计划

> In Progress · 2026-10-28：作者批准「按推荐实现」。先完成 T1–T7 的全部生产代码与用例，再执行 T8 集中验证；本机正式 AW 的迁移（T10）另按实例批准。

| 工作 | 依赖 | 产物与验收 |
|---|---|---|
| RFC-044-T1 | 作者批准 | 合同：Manifest `databaseMigration`、管理员 API 与 DTO、回调接口请求 / 响应、Job 环境变量名常量、错误码；合同锁更新 |
| RFC-044-T2 | T1 | data：迁移来源的世代与 scratch 世代、`commitMigration` / `revertMigration`、`envFor` 不追加世代变量、进行中前置检查；真实 PostgreSQL 并发与幂等用例 |
| RFC-044-T3 | T1 | release：操作表与产物表、阶段机、候选构建（只构建）、plan / run / verify / rollback / complete Job 及日志标记解析、尝试与重试、冷恢复；故障注入用例 |
| RFC-044-T4 | T2、T3 | 冻结与切换：复用维护保留、migration barrier、停写观察与冻结引用；激活核对、候选绑定目标世代、回退、开放时的执行交接与切流；每个外部调用前后的中断用例 |
| RFC-044-T5 | T3 | 回调接口：`/internal/database-migrations/<jobId>/<token>/v1/operations/<op>/…` 七个端点，以及迁移 Job 的只读对象读取；按 AW 实际请求形状写的用例 |
| RFC-044-T6 | T1 | 页面：迁移页（阶段、计划、批准、确认、回退 / 放弃、重试、证据）与发布页入口；组件用例 |
| RFC-044-T7 | T1 | AW 侧：`deploy/crewstation/crewstation.template.yaml` 与 Manifest 渲染增加 `databaseMigration`（在 agent-workflow 仓库提交，作为 AW RFC-395 T19 的一部分） |
| RFC-044-T8 | T1–T7 全部完成 | 集中验证：完整门禁、真实 PostgreSQL、准确 SHA CI；修复本人缺陷后只复验相关范围 |
| RFC-044-T9 | T8 | 部署本机平台；独立验收服务从 epoch 1 迁到 epoch 2，覆盖重新批准、回退、完成三条路径（DBM-01–08 逐条证据） |
| RFC-044-T10 | T9 + 实例批准 | 本机正式 AW（`agent-workflow`）迁移：plan 无阻断即切换（用户 2026-10-28 已批准该方式），记录计划、回执与验收（DBM-09），同步 AW RFC-395 T19 记录 |
| RFC-044-T11 | T10 | 三件套状态、RFC 索引与 STATE 更新 |

## 验收清单

T9 验收后新增「取消失败的撤回，回到待开放」，保留重试并补齐 API、页面与回归用例（2026-10-29，作者批准）。

- [ ] DBM-01 目标 / scratch 库独立出生、旧库不变、请求幂等
- [ ] DBM-02 plan 只读、计划与 approvalDigest 持久并展示、阻断与旧批准作废
- [ ] DBM-03 维护、冻结、停写证明齐全后才运行 run；中断续跑不重复
- [ ] DBM-04 激活回执核对后才切世代与部署候选；verify 通过前不开放
- [ ] DBM-05 首写前回退到原世代、原版本与原执行权；开放后拒绝回退
- [ ] DBM-06 开放后交接、切流、完成回执；旧库保留
- [ ] DBM-07 断线、Job 丢失、平台重启的冷恢复；失败尝试与重试；冻结前放弃
- [ ] DBM-08 七个回调端点按 AW 合同对接，AW 真实迁移镜像跑通
- [ ] DBM-09 独立验收服务端到端；本机正式 AW 实际迁移
