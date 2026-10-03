# TaskRuntime 内容盘点与后台迭代保留

2026-10-04 首批源码候选，未提交、未部署。首批补齐 TaskRuntime 的只读完整盘点和实际后台迭代保留；后续原回调与准入接续见下文。专用停止、数字排空与七阶段 owner、全部 22 方和完整物理回收仍在实施。永久删除入口保持关闭，原专用项目保留。

## 盘点范围

真实 PostgreSQL 的 `REPEATABLE READ READ ONLY` 快照按完整键的 `COLLATE "C"` 游标，每页 200 项遍历到实际 EOF。枚举全部当前表及全部列，新增／缺失表或未登记列阻断完整性。

项目内容包括 10 个表：`environments`、`admissions`、`environment_rebuilds`、`blocked_admissions`、`archive_executions`、`unprovisioned_storage`、`development_parent_endings`、`development_parent_ending_children`、`development_parent_ending_objects`、`development_parent_rebuild_claims`。所有当前及 legacy JSON、原生执行、恢复／结束指针、原冻结成员、凭据摘要和历史正文纳入整行摘要。`resource_identity_aliases` 最小标识目录和 `development_parent_recovery_sweep` 全局游标单独登记并保留，不将全局状态认领为项目内容。

项目／服务原根和未供给业务任务由公开的原归属端口提供。已经落库的任务、父环境、恢复和原结束 epoch 在本模块一致快照中解析；不能由 serviceId 或正文中的 projectId 猜出不存在的任务。暂停／释放等逻辑状态不替代实际消费者退出证明。平台共享档位测试保留；明确绑定项目的镜像验证纳入对应项目。显式 JSON null、不同项目的父执行、原成员数与完整集合不符、当前／legacy 别名冲突及恢复完成摘要不符均阻断。

原生端口合法接受 Runner／Agent 协议标识，包括现有工厂实际接受的 UUIDv4 Runner ID；这些符号不被强制解释为 UUIDv7 资源。归属由原实际父任务及服务根确定，历史符号必须与当前原标识相同或由原目录映射到同一资源。任务、项目、服务和恢复资源 ID 仍遵守原 UUIDv7 合同。

返回材料只包含表、原键、数量和摘要，不返回 Runner token、DSN、请求、原文、恢复输入、render 或数字尾部。快照内复用已读取行及原成员计数，避免对每个历史子执行重复读取完整父集合。该材料为正式 owner 的下一阶段输入，目前没有作为 HTTP 删除成功或物理清空证明。

## 后台迭代

实际 `createTaskRuntimeModule` 改用保留 Promise 的两个工作器：对账维持 15 秒、启动观测维持 1 秒的首次及后续节奏；同一工作器不重叠迭代。`stop()` 清除时钟后等待已发起的真实迭代退出，两个迭代各自保留，错误仍进入原日志通道。这只证明已返回 Promise 的迭代结束，不代表持久原回调、Runner、Pod 或数字排空完成。

## 本轮验证与限制

- 首轮 3 pass／4 fail，夹具卷类型错用 `pvc`，已改为现有 `persistent` 合同；原日志保留为 `/private/tmp/cs-rfc037-runtime-content-targeted-v1.log`。
- 接入既有真实模块夹具时，首次 12 pass／1 fail，暴露将合法 UUIDv4 Runner 协议符号错误限制为资源 UUIDv7；修订生产解析后 13／0。测试数组可空下标造成的类型错误已修正，未放宽类型门禁。
- 最终当前候选定向 **17 pass／0 fail，79 断言，3 文件，6.61 秒**：完整 205 追加页、10 家族、外项目保留、源不可用／缺失、共享测试／项目验证、显式无效 JSON、未知 schema、当前和 legacy 归属、冻结成员、恢复指针和完成摘要、既有工厂创建的真实成员／恢复，以及实际定时器关停。
- 后端类型、14 路径精确 lint 和架构均通过，结构检查为 59 单元／4124 源码文件。日志依次为 `/private/tmp/cs-rfc037-runtime-content-types-v3.log`、`runtime-content-lint-v3.log`、`runtime-content-arch-v2.log`；完整前缀均为 `/private/tmp/cs-rfc037-`。
- 14 功能路径冻结于 `/private/tmp/cs-rfc037-runtime-content-candidate-v1.json`。较宽 TaskRuntime 模块检查终态 **383 pass／0 fail，4161 断言，70 文件，288.62 秒**，日志 `/private/tmp/cs-rfc037-runtime-content-module-v1.log`；全部 14 路径首尾指纹保持。本批尚未执行完整全仓门禁、提交、精确 SHA CI 或部署。

本轮真实数据库只覆盖本模块数据面；公开原来源为受控事实端口。原生／开发／业务数字排空的专用删除许可、所有写路径与后台回调的跨进程封闭、正式 Root 和实际物理回收继续实施，不能用这些盘点用例关闭 RFC。

## 2026-10-04：原回调准入、实际工厂与外部请求保留

追加 `0022_project_work.sql`，不修改任何旧迁移。共享锁由 237 项变为 238 项，只追加本任务这一迁移；全部原条目，包括并行观测的 0018，校验和保持。回执 `/private/tmp/cs-rfc037-runtime-work-migration-lock-v1.json`。

原回调在真实项目 shared 准入内、外部 I/O 前持久登记。完整关联原项目／服务／任务／恢复／父结束 epoch、消费者、原后台 PID、Pod／Node／容器／PID namespace／boot／startTicks 和私有 finally；回调独立事务记录出生，私有 nonce 才能登记退出。HTTP 超时只结束调用方等待，已发出的外部请求继续保留到真实 finally。数据库连接断开也不生成假退出，迟到的 scope 不再发出新的请求。项目 exclusive 封写会等已有 shared 请求退出，另一项目可继续；完整 Pod 的独立停止事实才能恢复缺失 finally，单一容器的停止不具备该能力。

当前阶段显式删除许可绑定原项目、操作、世代和阶段，在 I/O 前后检查；私有复制确认材料，防止调用方修改对象重定向范围。最小原标识目录在内容清理后保持身份，不存凭据、正文或数字尾部。项目回调不能借用共享平台档位测试范围。内容盘点扩展为 11 个表，含 `original_callbacks`；五个保留目录／全局游标／封写与整 Pod 最小事实另行登记。

`createTaskRuntimeModule` 的项目写 API、原生执行／恢复／父结束队列、对账／启动观测、归档／存储嵌套 API 和台账补投影接入真实回调。异步窄端口和事务保留已发起的 Promise，模块关闭等待原工作。普通历史、原来源与任务详情读取仍可用；封写只阻止新工作和副作用。Root 接入公开 Project／BusinessTask 原来源及真实进程保护；源码检出适配器移至 platform 的 k8s adapter，保持原服务 Secret、30 分钟凭据与现有接收者。

实际 shared 数据库上下文会先注入准入 GUC，原来源读取曾在事务中迟到设置隔离级别，真实 PG 返回 25001。TaskRuntime／Project／BusinessTask／ClusterManagement 的公开原来源及运行内容快照改为在 BEGIN 配置 `REPEATABLE READ READ ONLY`；四模块原有直接读取和 shared 上下文用例均保留。

验证分阶段记录，不把旧候选门禁复用给新内容：

- 原回调首轮 SQL 保留词错误造成 0／17；修正为 `deletion_grant` 后 11／6，真实 shared 原读取暴露上述 25001；BEGIN 时序修复后 17／0。原失败日志保留，完整前缀均为 `/private/tmp/cs-rfc037-runtime-work-`。
- API、后台、公开来源、完整 Pod 与检出专项最终 54／0、595 断言、11 文件、13.85 秒（`targeted-v7.log`）。后端类型 `types-v6.log` 为 0 错。
- 新实际工厂归档／存储验证首轮缺不存在的 Schema 导出，次轮缺业务台账准入；修正夹具后 2／0、30 断言、5.88 秒（`storage-v3.log`）。覆盖原凭据／绑定、原卷许可与证明／完成、调用方截止后真实 finally、封写后嵌套 API 无写入以及另一项目继续。凭据与停止事实为受控端口，不能称实际物理回收。失败夹具的两个新库按原 UUID 时间窗、数据库 OID、原请求摘要与零资源事实逐一核对后清理，keeper OID650023 保持（`failed-fixture-cleanup-v1.json`）。
- 较宽模块检查 464／0、4803 断言、87 文件、277.64 秒（`module-v2.log`）；随后检出源码只调整 adapter 落位，完整新候选另行验证。
- 结构检查最终 59 单元／4144 源码文件无违规（`arch-v4.log`）；57 个功能／锁路径精确 lint 通过（`lint-v3.log`）。后端类型 `types-v8.log` 为 0 错。原始错误的 process finalizer 联合、夹具 UID 参数、函数行数与 adapter 落位已修正，未增加结构例外。

当前 `/private/tmp/cs-rfc037-runtime-work-candidate-v3.json` 冻结 57 个功能／锁路径；单次完整 `bun run check --coverage --coverage-reporter=lcov --coverage-dir=…` 已启动，日志 `full-v1.log`，尚等终态、原指纹、精确发布／CI。全量结论和部署另记。

本批仍缺所有内容表的完整 SQL 写屏障／metadata 例外、全局父恢复扫描按项目准入、原业务／开发／原生的停止与数字排空、TaskRuntime 七阶段 owner 及其完整物理来源。删除阶段不得拿普通 API 取代明确许可。全部 22 方、SCM／制品等原物理范围和原专用项目二次确认永久回收继续；入口 OFF、producer OFF，原验证项目保持。

## 2026-10-04：删除工作器 CI 续租开销修复

并行观测精确 SHA `7a18725e9dc3e3dab3cb23f832aab8dfae9fed04` 的 CI37150242311 已终止，4 success／2 failure。原观测 10001 完整归约为 18.129 秒 PASS，新增批量原归属 PASS；module 唯一失败是本任务 `provisioning/tests/deletionWorker.test.ts` 在原 5000ms 预算内超时，迟到的作业断言仍为 pending，gate 因而失败。保留 `/private/tmp/observability-cs-0018-module-failed-v1.log`，不将此失败改写为观测性能回归，也未部署该失败 SHA。

原每次续租会读、解析并重新写入逐渐增长的整份操作正文。增加本模块原子租约更新，只更新截止时间，WHERE 同时要求原操作、持有者、世代、running 和未过期；健康心跳不再读回或重新发布正文，失效诊断保留。真实 PG 回归用例通过数据库 UPDATE OF body 观察器先红，修复后保留原回执与所有错误持有者／世代／到期拒绝。两模块专项 16／0、138 断言、6.17 秒；原队列用例 2245.58ms，保留原 5 秒预算。`renewal-red-v1.log`、`renewal-green-v1.log` 和覆盖目录均以相同 tmp 前缀保存。自身完整精确 SHA CI 仍待发布，不能拿本机速度作为 hosted 通过。

## 稳定候选完整门禁

`candidate-v3` 的唯一完整门禁终态 **5603 pass／143 环境 skip／0 fail，136421 断言，1103 文件，1610.07 秒**；静态四层全部通过，57 个功能／锁路径首尾指纹保持。原日志 `/private/tmp/cs-rfc037-runtime-work-full-v1.log`，结构化回执同名 `.json`。143 项跳过不计对应环境或实际模型／物理验收。

同一路完整覆盖报告核对包括全部未追踪新文件的精确改动：**801／806 可执行行，99.38%，无违规**，回执 `runtime-work-patch-v1.json`，未为此占用共享索引。精确候选提交树的后端类型 0 错（`runtime-work-exact-types-v1.json`），排除 RFC-036 在制源码与原型，不新建 checkout 或改 Git ref。控制台精确树辅助检查首次漏设 configFilePath，无法定位 vite/client 并引发 317 个派生 CSS／ImportMeta 错误；只修检查器的原配置路径，不改生产源码、不放宽类型，修订终态另记。完整门禁的原 `tsc -p apps/console/tsconfig.json` 已通过。

精确发布清单 61 文件，包含57功能／锁、STATE与3份本任务文档；25 个非本任务文件按当前指纹单独保留。共享index为空，main/origin当时均为7a18725。提交／自身六项精确CI／部署尚未完成；原后台恢复生产请求必须拆开全局游标事务和按项目入队事务，不能在 shared 回调退出之后才提交原多项目批次。其余明确删除许可、TaskRuntime七阶段及全部22方／原物理范围继续，入口OFF。

控制台辅助检查 v2 已终止 **0 错**，回执 `/private/tmp/cs-rfc037-runtime-work-exact-console-types-v2.json`。仅补齐原 TypeScript 配置文件路径，未改源码或放宽类型；57功能／锁指纹保持。精确后端与控制台提交树均已核对，61路径发布就绪，完整永久删除仍未完成。
