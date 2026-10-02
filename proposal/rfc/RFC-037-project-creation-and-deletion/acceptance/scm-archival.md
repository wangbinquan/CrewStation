# SCM 原生归档协议候选

接续实际生产者盘点与 [线程读取证明](scm-consumers.md)。此批补齐 GitLab 写入封闭所需的原生归档协议，不把归档当作消费者排空、独立物理来源或永久清理完成。

## 行为

纯 GitLab 协议客户端读取明确的 `archived` 布尔值，缺失／错误类型拒绝。归档必须固定原数字 ID、创建时间与完整路径；GET 核对后只向这个数字 ID 的 `/archive` POST，再核对原身份和 `archived=true` 回执。已归档的原实例不重复 POST，原生受理后失回执可沿原身份读取恢复。ID／创建时间／路径替换、API403／404／503、错误回执均不计成功，不返回额外原始字段或令牌。

SCM 既有 GitLab 适配器提供可选 `removal.archive`，保持原普通能力与外部适配器兼容；同名路径不承担不可复用身份。尚未从正式 physics／Root 调用此能力，没有归档原验证项目或改变原消费者状态。

## 验证

新五项客户端回归先红，未实现时 0 pass／5 fail。实现后与原删除、普通客户端和两组 SCM 适配器回归合跑 **35 pass／0 fail、210 断言、5 文件**；全部既有断言保留。新增两项 SCM 适配器回归覆盖原身份／重复受理／无 DELETE、替换／非法数字 ID／权限故障。

改动可执行行 **24／24**，无保护例外；精确七路径 ESLint 通过，HEAD 提交树仅叠加这七路径的后端与 console 类型各 0 诊断。未运行本批完整 `bun run check`，七路径未纳入正在进行的双方 63 路径共同门禁，后者指纹保持。此前任何发布 SHA 的 CI 不能代替本候选门禁。

原 19.2.4 安装 `lib/api/projects.rb:719` 实际定义 `POST :id/archive`，要求原生 archive 权限并返回 `Entities::Project`。本轮只读检查该安装源码和原生产者元数据，没有向原项目发 POST。尚未发布／部署新归档协议，没有取得“新 SDK 已安装”或“原消费者已停止”的实机证明。

私有七路径清单与 SHA-256 为 `cs-rfc037-gitlab-archival-owned.json`、`...-candidate.json`；回归、coverage、覆盖审计、lint 和候选类型日志均在 `/private/tmp/cs-rfc037-gitlab-archival-*`。实际原项目及共享 GitLab／Runner 保持；永久删除入口继续关闭。
