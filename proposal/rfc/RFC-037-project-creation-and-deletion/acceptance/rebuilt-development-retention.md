# I36：重建开发任务的当前保留基线

作者已批准 `legacy-recovery-options.md` 最后一节“允许按当前身份逐项保留”。本片实现已完成相关检查，确切提交／六项 CI／部署及原项目实际删除、独立 AFTER 继续；不记 RFC 完成。

仅补充缺少旧 UID 的外项目 dev-session 旧网关记录：当前公开原任务、环境、服务和持久 Pod UID 必须一致，原名字不存在。完整 Pod EOF、全部正规／init／临时容器、实际挂载 PVC、全量 PVC／PV 及 claimRef 必须核清；目标关联、其他消费者、共享实际卷、未知卷来源和任何读取缺口继续阻断。当前完整 Pod 及确认摘要来自同一分页快照；卷按实际路径或 driver／handle 核对，而非仅凭任务的 PVC 名推断。

gateway 的既有 ports／持久确认消费当前见证；platform 的 `ports/deletion/gatewayRetention.ts` 声明最小来源，`adapters/k8s/gatewayDevelopmentRetention.ts` 读取公开 TaskRuntime／Project API 和真实 K8s，由既有 wiring 注入。确认绑定旧完整原文、当前任务／服务、Pod／容器和卷摘要；保存前后及七个清理阶段重新读取，变化回滚或失效。没有新迁移、出生回填或物理回收许可，旧 UID、service_source、development_source 仍为 NULL。普通网关确认摘要保持兼容；原统一 FormDialog、最终双确认及 22 方七阶段保持。

部署后的完整确认列表读取又发现：合法旧 `release.registered` 的 driver／model 格式在筛选公开归属前被当前模板 schema 拒绝，整批 provisioning 候选读取失败。修复复用已批准的库存专用冻结历史 schema、完整原文／规范化双摘要、实际不可变迁移及原 aliases 重新推导；只支持严格历史发布信封，额外字段、摘要不符、无法重现、原来源变化仍阻断。完整未知归属记录只准逐项 retain，检查所有当前／历史引用、活跃消费者、目标／共享引用与私有原错误，原文／错误均不删、不重投，不改变当前执行契约。普通确认摘要不变，历史重现摘要在保存和阶段重读时绑定。

2026-10-06 检查：原十文件相关真实 PG／Root 27 pass／0 fail、432 断言、6 文件；最终摘要兼容两文件再验通过。新增旧事件回归先得到与部署相同的两处 ZodError，再修复读取器；一次测试断言误将主动新增的原错误计数与插入前比较，已改为比较原错误插入后的完整快照，失败日志保留。最终旧事件、完整保留来源、逐项保存及历史库存 9 pass／0 fail、105 断言、4 文件。十二功能文件冻结；结构、后端类型和精确 lint 通过。官方改动行含未追踪源码，103／104、99.04%，无违规。

唯一完整 `bun run check` 于 12:26:39Z～13:03:56Z 终态 exit1：6291 pass／157 原环境 skip／2 fail、341744 断言、1280 文件，原十文件字节保持。两失败只在未提交外部 `modules/observability/tests/completeCoverage/pointStorage.test.ts:97,129` 与 `completeCoverageWorkspace.ts:126`，没有修改或提交这些文件，不记整仓 PASS。按 `development-rules.md` §3 保留原完整日志，复用不变候选结果并对新增两文件精确验证，以干净确切 SHA 六 CI 判定提交树。私有回执 `cs-rfc037-i36-development-retention-shared-wip-exception-v1.json`、`development-retention-targeted-v3.json`、`development-retention-patch-v2.json`。

新增独立原始基线 `cs-rfc037-i36-foreign-development-independent-before-v1.json` 保存完整原网关行、公开持久当前任务 UID、实际 Pod 全配置／容器、PVC／PV 全配置及 UID／claimRef，核查完整且无目标或共享引用。它属于 BEFORE；原专用项目未执行最终永久删除，没有独立 AFTER。其他原始基线不覆盖。

bb5d88761ac9 的确切 SHA 六项 hosted CI 全成功。其首次迁移因 Docker 虚拟机仅余14MiB失败，原254项保持，失败 Job 留证。仅回收本任务原构建回执匹配的32旧镜像 tag、28 storage alias、52精确非共享不可变 Docker 缓存与17无容器引用的旧节点镜像，空间恢复约25GiB；未全量 prune、修改卷、清理原 Registry／BuildKit 数据或删除容器。

磁盘事故中平台 PostgreSQL 原 Pod 内进程自然重启，旧 containerID 保留作历史，不称其仍运行。正式当前物理来源连续两次一致，原 Pod／Node／Service／PVC／PV UID、mount／provider path 及独立原数据库／角色 OID 全保持。新唯一 Job `rfc037-i36-followup-migrate-bb5d88761ac9-r3` 成功安装第255项，原254 checksum保持；bb5八组件实际 OCI 与 Ready 验核，原 Runner13996451、Probe4e26及全部项目原资源保持。不可覆盖回执 `cs-rfc037-bb5d88761ac9-i36-followup-retry-v2-deployment-receipt.json`，此前失败证据保留。

部署后真实浏览器：创建弹窗显示标识决定且不可后改域名、正式 `rfc037-modal-preview.cs.localhost`／待验证 `preview.rfc037-modal-preview.cs.localhost` 与模板生成初始代码和发布配置的作用；未创建新资源，关闭草稿。截图 `cs-rfc037-i36-creation-modal-deployed-v2.png`。长驻完整预检后顶层归属弹窗 Esc 只关顶层，最终返回原删除按钮焦点及列表滚动1163.5保持，回执 `cs-rfc037-i36-bb5-long-dialog-close-v1.json`。原项目仍 active、删除 operation 为0；本片部署后重新读取完整候选并逐项确认，再执行原项目永久回收与全部独立 AFTER。
