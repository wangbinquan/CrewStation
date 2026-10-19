# RFC-043 计划

| 工作 | 依赖 | 产物与验收 |
| ---- | ---- | ---------- |
| RFC-043-T1 | — | 合同（请求 schema、DTO 当前快照、能力字段、原因码），迁移 0040 与两把锁 |
| RFC-043-T2 | T1 | task-runtime `repinPausedBusinessWorkspace`：暂停环境改钉、拒绝与重放；恢复后台账渲染新镜像 |
| RFC-043-T3 | T1、T2 | business-task 准入、调度与镜像读者（视图、材料证明、重建 / 重新执行、关闭释放、引用清理），平台版本查询端口 |
| RFC-043-T4 | T3 | 能力快照 `runtimeImageUpgrade` / `taskRuntimeImageVersionId` |
| RFC-043-T5 | T1–T4 | 设计 §6 列出的全部用例 |
| RFC-043-T6 | T5 | 集中验证：完整 `bun run check`、准确 SHA CI、本机部署 |
| RFC-043-T7 | T6、AW V21 | AW 正式实例 `development:shared` 升级后开发自动化新命令可用（RIU-07），验收记录与三件套 / 索引收口 |

单个 PR（主干直接提交）。作者 2026-10-19 已批准。
