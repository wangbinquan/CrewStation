# cluster-management（L6）

CrewStation 受管 Kubernetes 资源目录与持久化运维操作。设计和验收见 [RFC-010](../../proposal/rfc/RFC-010-cluster-management/proposal.md)。

- API 仅平台管理员使用，挂载 `/v1/admin/cluster`；六个视图共用带来源完整性与 10 分钟游标有效期的持久快照。
- project、task-runtime、release 提供批量元数据，组合根注入系统目录及领域动作。对象按 UID 判断归属和用途，Secret/环境变量正文不会写入快照。
- cs-controller 每 30 秒申请一次合并采集任务；四路有界读取。重启/扩缩/删除先检查，确认后原子写入日志与队列，通过租约和恢复代次执行、观察。
- Kubernetes 原生写入使用 UID/resourceVersion 条件和稳定 marker；任务、Agent、业务任务及发布槽回到所属模块。`needs-attention` 的继续核对复用原意图，不重复受理新操作。

安装须包含 `deploy/k8s/platform/00-rbac.yaml` 中资源读取及已声明运维权限。API 拒绝或来源缺失会明确显示，不能视为零资源或据此执行删除。
