# 发布准入、原范围与清理候选

2026-10-03 页满交接修正。独立 SOURCE v31 复现一个 P2：最旧二十条 pending 都属于已封闭项目时，claim 前拒绝使更新时间不变，后页健康项目永久饥饿。真实 PG 红用例记录第二轮应推进 1 条而实际为 0；保留 `/private/tmp/cs-rfc037-release-handoff-fairness-red-v1.log`，不认领、伪完成或改写被拒绝项。

交接现在每轮最多扫描二十条，按不可变原 ID 作 keyset 后页定位，到尾部重新轮转；扫描位置只在该控制器实例内，不写业务内容。重入调用共用同一次扫描，读源失败保留位置；进程重启从首轮恢复后仍持续前进。原阶段、租约、claim／settle 和已封闭项目保护保持。页满、轮转、并发重入、读源失败以及前页更新时间改变不重复／遗漏下一项均由真实隔离 PG 覆盖。

修正后的相关四文件 42 pass／0 fail、295 断言，12.92 秒；精确四源 lint、全工作树后端与 console 类型、arch 全通过。用修正后 LCOV 覆盖两个变动运行文件，其他未变动候选复用此前模块 LCOV，累计改动行 671／673（99.70%），未加载代码零；不向已改文件合并旧行号。此前 127／0 是修正前模块回执，新候选完整门与新的独立 SOURCE 尚待观测会话唯一执行。本次新增 ports/executionHandoff.ts 入候选，其余 runtime 二十五源与 216 项共享迁移锁保持；尚无 Git 发布、部署、完整 Root／HTTP 或原项目回收。

2026-10-03。接续下方内容来源，已实现 release 内部 owner 的持久七阶段、真实共享准入与原回调退出记录。需要 Root 明确提供当前原进程出生、项目可用性、清理许可和完整独立物理端口才装配 owner；本批没有提供实际物理适配器，没有装配完整 22 owner 的 Root／HTTP，没有开放管理员删除入口，也没有删除原验收项目。受控物理端口的用例不能作为原资源或容量回收证明。

完整内容现在包含原七类表与 deletion_callbacks；13 个已知表／列均需核对，offline_policy、最小别名和三类永久护栏保留。一个 repeatable-read 快照包含所有历史与旧键；callback 元数据保存原 Pod／容器／节点／Linux PID／namespace／boot／start ticks、实际共享锁 backend、原输入和私有退出键摘要，没有明文退出键。原回调实际 finally 使用自己的私有键独立落退出事实；连接关闭、PG backend 消失和租约结束都不等价于回调实际退出。受控断线用例通过 PostgreSQL 通知等到真正退出提交。

公开发布、流水线、凭据、槽运维、preview 访问以及后台交接／下线／台账巡检均进入原项目准入，外部 IO 两侧重新核对原范围。队列后续入队也核对同一原发布。全局巡检逐个项目处理，一个项目封闭不阻止其他项目。历史上名为 read 的仓储写方法全部走真实独立 UOW，向 SQL 传入仍实际持有的共享锁身份，排他 seal 等待不会堵住该原回调结束自己的 UOW。

封闭、世代、原范围和阶段回执不可重绑定；stop 恢复只能用独立证明中的原出生，metadata 删除与回执同事务，verify 重放仍重新证明。只清除固定原行，其他项目、平台策略和最小身份保持。旧输入与历史维护／交接出生不可改写，清理后不能通过旧服务、发布、回调、别名或 TRUNCATE 重建内容。正常恢复和新增业务保持。

迁移只新增 `release/0009_project_deletion.sql`，共享锁由 215 增至 216，全部原条目（包括 runtime 0007）保持。归并 schema、handoff 表和两个只读查询后，release 生产文件为 63，application 直接生产文件为 19；没有提高结构上限。锁定前后仅本条尚未发布的迁移改过 SQL 写法：将架构扫描误判为跨 schema 的 CTE／子查询限定字段改为等价的行 JSON／唯一列引用，并更新此未发布条目的校验和；未改任何既有已发布迁移。

验证保留失败原件并接续：

- 真实隔离 PG 原型最终 8／0；增加许可回滚、缺失存储面和回调恢复后，正式专项 34／0、227 断言。普通 SQL 重绑定、擦护栏、假退出、迟到续接均拒绝。
- 原大历史量用例第一次新 guard 超时；去除逐行规范化导致的二次扫描，先按索引归并原服务和 DISTINCT 项目后，同一 2,002 条原用例约 2 秒通过，原 15 秒时限保持。
- 发布模块 127／0、849 断言、24 文件。SQL 等价调整后，正式专项再次通过；最终全模块结果以候选回执为准。
- 精确 lint、工作树两侧类型及架构均通过；可执行改动行 654／656，99.70%，未加载代码为零。两条未覆盖行是既有下线修复分支经准入归并后的位置。
- 两个旧数据用例先在 0009 前的真实 schema 建原数据，再执行官方升级后验行为，保护旧项目兼容，没有关闭触发器或放宽身份保护。
- 自建测试库正常回收；只读复核没有发现符合本次独占迁移指纹且无连接的遗留库，既有基库、keeper、其他候选库和原平台资源保持。runtime 冻结 25 路径全部指纹保持，暂存区为空。

原始回执使用本机 `/private/tmp/cs-rfc037-release-deletion-*` 前缀：原型、初次超时、模块／专项、类型、lint、LCOV、架构及精确候选指纹均保留。共同完整门由观测会话唯一执行；本批尚未提交、推送、部署，不借用旧 CI 作为本批通过。原实际物理来源、其他 owner、完整 Root／API／两次确认及原项目资源／容量回收继续。

---

# 发布内容来源接续

2026-10-02。本批是 release owner 的完整保留内容来源，尚未实现该 owner 的封写、停止与清理，也未挂载项目永久删除入口。原验收项目未执行删除，原生消费者和制品回收没有因此获得证明。

`ReleaseModuleApi.deletionContent` 读取自己 schema 的同一 repeatable-read 快照，盘点 releases、service_slots、traffic_switches、replica_overrides、slot_maintenance、slot_events、execution_handoffs 七类内容。读取不复用工作台的 50／500 行分页或状态过滤，失败、下线、被替换发布均包含。平台 offline_policy 和最小 resource_identity_aliases 保留；未知表、列、策略作用域或坏别名阻断完整性。仅输出行摘要、原消费者 ID／状态／输入摘要及身份元组，不输出 Manifest、配置、日志或秘密原文。

项目与服务按原 UUID／显式旧标识核对；当前和 legacy_body 的项目、服务、发布引用均纳入，旧原文不作为覆盖当前归属的理由。缺失原发布、服务来源不可读、未知归属及跨项目引用阻断。旧标识目录不能以读取顺序覆盖已保留身份，复合元组纳入范围摘要，外项目别名的新增不改变本项目确认范围。source 的 complete 只表示保留内容盘点完整，不能用它报告 Pod、回调、构建、迁移、镜像或字节已经退出／回收。

发布镜像历史查询归入已有 drizzleRepositories，旧查询行为保持。生产 TypeScript 文件保持 65，没有新增模块、schema 或结构规则例外。本批未新增迁移或修改共享迁移锁；runtime-environment 的既有 25 路径冻结候选保持，后续发布仍按已有共享门禁与短提交窗口交接。

验证结果：

- 初次真实 PG 回归 10 pass／1 fail，复现外部目录覆盖本地旧映射而掩盖冲突，失败日志保留；修复后该反例通过。
- 发布模块 108 pass／0 fail、694 断言、22 文件；同概念抽函数后最终专项 16 pass／0 fail、78 断言，包含 2,002 条历史发布、空当前／旧快照、跨项目引用、复合别名和上游不可读。
- 最终精确 lint、arch 与改动行防护通过，181／181 可执行改动行加载并执行。现有镜像历史用例仍通过。
- 全工作树后端类型检查仍被并行 `task-runtime/tests/developmentLegacyWriterSeal.test.ts` 的三项在制类型诊断阻断。本批以固定已发布 HEAD `37e1f5aaa8acfb64fec43d356ef35f1ed2c9e234` 加自己的八路径，在只读 TypeScript CompilerHost 中核对，0 诊断；没有创建分支／worktree／checkout，也没有替换并行工作树文件。不能据此把全工作树检查称为通过。

本机原始回执位于 `/private/tmp/cs-rfc037-release-content-*`，包括原失败、模块／专项日志、LCOV、精确改动行报告和固定提交树的类型结果。该候选尚未跑自己的共同完整门禁、提交、推送或部署，不能借用旧 SHA 的 CI 宣称本批发布完成。剩余 release 原回调持久准入、独立物理来源、七阶段清理、全部 owner 的 Root／API／管理员两次确认及原项目容量回收继续按 PD-01…PD-23 完成。

## 2026-10-03 精确发布与本机部署回执

本批与观测会话的就绪内容已串行提交并统一发布：本任务 61 路径为 `463f24d85b0e6edfc8fbf984758be3f2c585d400`，包含其前序 `a6021a88` 和完整 216 项迁移锁；共享 STATE 与平台来源夹具的并行输出完整保留。[该 SHA 的 CI](https://github.com/wangbinquan/CrewStation/actions/runs/37060038342) 六项均终态成功。2026-10-02T20:34:54.250Z 八个本机组件完成部署，实际 Pod imageID 和节点 OCI 的 source revision 都对应该 SHA。控制面 digest 为 `495313d740dee1a76bbdd0adaec0b0aca8e81110bb188ac3d5b540487955301f`，工作台为 `9fcfd35062a78d2f4e75e812df5fceb7f732912c4925a289d4587a93d21eaec2`。

release/0009 与 runtime-environment/0007 的安装校验和分别为 `9fb0caab1f7a578102d521f778a0b19103eb7c58a5e4ad7142d2f656f0c81a92`、`c55ec5f13818fba2f02bd928dde884f3a6c6618811db9df28165a8b542ea51d7`。原固定 Runner、GitLab 容器、平台 PG/PVC/PV、所有项目 Namespace/Pod/卷及 52 库/64 角色的身份保持；发布后 main/origin 为 0/0、index 为空，其他在制路径保持。私有终态回执为 `cs-rfc037-runtime-release-publication-receipt-v1.json`、`cs-rfc037-463f24d85b0e-exact-ci-v1.json` 和 `cs-rfc037-463f24d85b0e-runtime-release-v1-deployment-receipt.json`。

此回执证明本批发布、迁移和部署，不证明完整 22 owner 或独立物理来源已装配。删除 HTTP 尚未开放，原专用项目未删除，全资源回收继续验收。后续 SCM 当前归属接续是另一份在制候选，不属于上述 SHA。
