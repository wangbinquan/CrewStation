# 基础设施原归属读取与历史保留

2026-10-03，基于 `75dd427227fc7e3f587015c37ca411904513c625`，补齐此前缺少的九类后台任务来源。当前代码候选未提交、未部署，永久删除入口保持关闭。

| 来源 | 所属模块与依据 |
| --- | --- |
| task、subtask | business-task 的原任务／子任务关系及 v3 受理意图；task-runtime 的实际环境记录；两端存在时必须一致 |
| rebuild | task-runtime 的重建记录与原父环境项目关系 |
| parent-ending | task-runtime 已固定的原父结束 epoch、父 ID、项目 ID 与摘要 |
| profile-test | agent-runtime 中明确声明平台命名空间的测试上下文；缺失或退休记录保持未知 |
| cluster-refresh | cluster-management 的实际全局刷新请求 |
| cluster-operation | cluster-management 受理操作的明确项目／系统归属及原资源 ID／UID |
| cluster-metrics、cluster-storage | cluster-management 的实际全局采集请求，历史 ID 在采集器替换后继续保留 |

各模块经内部公开能力返回最小 ID、项目范围和摘要，在自己的只读一致快照内解析当前与历史别名。读取内容不包含任务输出、密封请求、Runner 令牌、数据库连接串、档位启动材料或集群操作正文。缺失来源、冲突别名、子任务父关系冲突、平台与项目范围冲突均阻断。

平台组合通过自己的 ports 接收各模块能力。保留的档位测试项目／服务 ID 必须由实际运行环境证明；项目镜像验证虽然在平台命名空间运行，仍返回实际项目归属。未知旧键需要原身份目录，不能仅凭保留 ID 或空项目字段推断平台范围。

新迁移 `cluster-management/0008_infrastructure_origins.sql` 从已有明确归属行保留最小信息，并在新请求实际落库后捕获原范围。最小目录拒绝 UPDATE、DELETE、TRUNCATE，以及没有实际所属行的伪造 INSERT；操作的原资源身份与归属不能在进度更新时替换。旧操作正文保持原样，旧采集请求缺少历史记录时仍未知。新增表已登记在集群内容清理目录，完整七阶段模块用例继续通过。

本候选共享迁移锁为 223 项，原有 220 项保持，另包含前轮资源申请 0003、API 目录 0008 与本轮集群 0008。最终源码候选及哈希记录在 `/private/tmp/cs-rfc037-infrastructure-content-source-candidate-v5.json`。

验证结果：

- 全部本候选专项：71 pass、0 fail、937 断言、20 文件，32.34 秒。
- 相邻模块回归：55 pass、0 fail、484 断言、11 文件，41.34 秒。
- 精确候选后端类型：0 诊断；精确 67 个 TS 路径 lint 通过。
- 官方改动防护评估：619／621 可执行改动行，99.68%，没有违规或未加载生产文件。
- 架构检查已修正本批分层问题；全共享树仍有 3 处并行输出的 index 导出层违规，保留原文件，未将全仓检查写成通过。

证据：`/private/tmp/cs-rfc037-infrastructure-content-targeted-v5.log`、`/private/tmp/cs-rfc037-infrastructure-origins-targeted-v5.log`、`/private/tmp/cs-rfc037-infrastructure-content-exact-types-v5.json`、`/private/tmp/cs-rfc037-infrastructure-content-exact-lint-v5.log`、`/private/tmp/cs-rfc037-infrastructure-content-patch-v5.json` 与 `/private/tmp/cs-rfc037-infrastructure-content-arch-v5.log`。74 个候选文件在专项结束后指纹一致，索引为空，main 与 origin/main 为 0／0。

继续实施基础设施 owner 的阶段动作及实际组合根装配、任务与会话等剩余 owner、原物理资源回收和管理员二次确认。当前来源读取及模块回归尚未建立完整 22 owner 的实机删除证明，原验证项目和资源保留。
