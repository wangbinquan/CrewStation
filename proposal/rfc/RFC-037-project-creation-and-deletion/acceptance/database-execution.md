# 原数据库执行、全部写入与角色回收候选

2026-10-01 继续 T8。新增 data-control 自身的原生数据库删除原语；本批已精确发布 b6999edf 并本机部署，见[部署与实际调用](native-writers-deployment.md)。不登记 HTTP 或完整 deletionOwner，不把端口层用例称为正式 owner 或专用项目的实机删除。

## 当前行为

由真实 ProjectDeletionContext 的 data-control/purge 材料指定原数据库名字与物理身份摘要，逐次通过反转许可端口。缺少原资源、物理 sourceIdentity、正确阶段或 owner，以及不完整／阻断／有外部引用的确认材料均拒绝。

名字锁统一位于原服务器的 postgres 管理库，不能因为调用方 adminUrl 的数据库部分不同而分区。每次操作使用专属 reserved 连接，锁键只绑定原名字及本操作唯一隔离名，与当前 slug 查找无关；记录实际 backend PID，校验该连接仍持有名字锁。原连接关闭后不借新池连接继续副作用，查询等待通过原连接退出事件拒绝。

锁取得后重查正式许可。在短 pg_database catalog 事务中核对原 OID、名字、原服务器／目录来源，并检查 pg_stat_activity、pg_prepared_xacts、pg_replication_slots。仍有消费者时等待，原名、连接准入和注释保持。排空后关闭连接准入，原子改成操作专属隔离名，留下只含项目、操作及原身份摘要的标记；事务失败回滚。隔离后许可失效或真实 backend 退出，原 OID 和最小标记仍在，可由同操作的新世代核对后恢复；隔离名冲突、标记改写、准入重开及原名换 OID 均阻断。

事务外再次核对来源、许可和原锁，使用正常 DROP DATABASE。没有 FORCE，也不终止未知消费者；DROP 报错不会给出成功。随后调用已发布的原 OID／完整 tablespace 文件来源核实实际 gone，仍有普通文件或目录时等待，不手工删除孤儿路径。实际 DROP 成功但许可／回执失败，可在同操作恢复时重读原文件归零，不能仅凭 catalog absent 返回 done。

新旧供给、临时角色、轮换和连接串续发已接入同一原项目准入；全部原生 DDL 使用原服务器 postgres 管理库的名字锁。正式 owner 的全历史盘点、封闭、原生服务器／卷来源、排空和最小清理意图尚未完成装配；产品删除保持关闭。

## 真实用例与修订

仅使用一次性测试 PostgreSQL、唯一 cs_rfc037_removal_* 数据库和由其原 OID 观测得到的隔离对象；keeper 的原 OID 和目录每轮均保持。不改变 shared PostgreSQL 配置、不重启实际服务器，也不删除原专用验收项目。

首次定向 7 pass／2 fail／72 断言：真实 pg_terminate_backend 后 reserved 查询等待导致用例超时；原生 COPY 拒绝相对文件路径。前者修正为原连接关闭事件与查询竞速，后者仅修正夹具从实际 data_directory 拼出本夹具 OID 的绝对路径；清理命令同时用 shell 与 SQL 正确引用，只移除本夹具明确创建的单个文件。首次测试中两处超时参数误放于 withDatabase 调用，类型检查指出后已修正，未把超时尝试计作通过。

第二次 9 pass／0 fail／77 断言；类型检查仍发现原查询包装丢失泛型，显式保持 Rows 后通过。第三次修订候选 11 pass／0 fail／86 断言，7.05 秒，后端类型通过。额外覆盖不同 adminUrl 数据库部分的真实锁竞争、catalog 事务内失败回滚，以及真实 DROP 完成后失去许可的原文件恢复。实际原生 backend 被终止后，候选拒绝继续 DROP；同操作新连接再恢复通过。

首轮和后续日志分别位于 /private/tmp/cs-rfc037-database-removal-targeted-{1,2,3}.log 与 types-{1,2,3}.log；失败日志保留。精确 lint 与 arch 两轮通过。模块合并回归、改动行防护、单次稳定完整门禁及精确发布／CI 尚待接续；未借此前数据库只读候选的全量绿色证明新执行源码。

## 新旧写入、口令与原回调

data-control/0004_native_work 新增本 schema 最小原资源归属、项目屏障和回调事实。记录只含原 projectId/resourceId、名字集合、主库 backend PID、原生 PID/启动时间、服务器摘要及原 Pod/容器/节点四键，不保存口令、SQL 或业务内容。SQL 触发器核对真实共享 advisory lock；原归属和原在途来源不可替换。直接 SQL 不能删除 running 事实或冒充实际回调退出。

原资源归属与加密口令在外部 DDL 前独立提交。实际 DDL 成功而主事务／回执失败时，重试复用已提交口令。legacy PostgreSQL provider 与新 data-control plane 都通过内部原项目端口执行；按名字 dropDatabase 被拒绝，不开放 HTTP 捷径。每次取得原生锁后、每条外部语句前核对原准入；等待名字锁时项目关闭，迟到写入不再创建角色。连接串续发、已有任务凭据读取、临时角色重试和两段口令轮换都保持原项目归属与准入。

持久 running 事实先于取得原生锁和外部副作用提交。原生 reserved 连接位于实际 callback 内部；主库连接真实退出不提前释放原生锁，也不把失败返回当成回调退出。已关闭的主准入作用域在查询前拒绝，避免迟到回调访问已关闭主库连接。只有实际 finally 在原生连接释放后写入 finished；主库退出回执丢失时，原 Pod/容器/节点四键及停止摘要可恢复最小事实。K8s 适配器使用独立 data-control-native-stop 保护，不解除 gateway/events 或外部 finalizer。

真实旧库升级只应用 data_control/0004；旧密文及全部既有字段逐字保持，未知旧口令归属先阻断，经权威资源端口固定原 projectId 后才读取。缺少生产回调四键时拒绝外部 DDL。当前生产接线仍未提供独立原生卷/PV epoch 来源，SQL system_identifier、目录和 endpoint 不能单独证明恢复克隆或替换卷；此缺口须在正式 owner 开放前补齐。

## 原运行角色与全部依赖

新增原角色 capture/remove 内部原语，按原名/OID、服务器来源和已确认完整角色集合执行。等待活动连接及连接退出后仍存在的 pg_prepared_xacts；检查整个集群的 pg_shdepend 与角色成员关系，未知其他角色成员和外部对象依赖保持。只有已确认同项目角色集合及既有 pg_read_all_data 成员关系允许普通 DROP ROLE 自动撤销；不执行全局 DROP OWNED/REASSIGN，也不取消未知消费者。

catalog 短事务锁住角色、成员与依赖表，许可失效在提交前完整回滚；提交后实际成功而回执丢失可按同操作的新世代核对原身份恢复。首次 absent、同名新 OID、错误服务器或摘要、原角色集合缺失均阻断。真实 PostgreSQL 九项角色用例含预备事务正向环境、活动用户仍可查询、其他数据库的表原内容/owner 保持、外部继承关系保护和原生名字锁竞争。CI module 的 PostgreSQL 17 通过 POSTGRES_INITDB_ARGS 设置 max_prepared_transactions=10；能力经 testkit 的 database 闸门，CI 缺失时失败。

## 当前候选验证与失败保留

最终定向组合为 **222 pass／11 skip／0 fail，1596 断言、58 文件、43.61 秒**。11 skip 均为未启用的真实 Garage 环境，不能作为对象字节清理验收。补跑真正组合根的全迁移清单及修订后的原角色用例 **10 pass／0 fail，51 断言**，包含原连接退出后仍有预备事务的真实路径；数字不与重叠用例相加。合并覆盖按完整精确候选路径核对：改动可执行行 **391／391**，所有改动生产文件均加载。data-control 新迁移校验和 4664e3cc8651b06c911fca74597452e14114996f132b33889a33e2c873a2f635 已精确入锁，2026-10-01T08:03:42.356865Z 实际应用；部署后的运行镜像源码与平台 migrations 表校验和一致。

早期 native 协议用例复现关闭主库后迟到查询的 null socket 失败，修订后通过。两段轮换屏障首轮测试在独占封闭锁内部又调用共享口令发放，形成测试自身等待，结果 2 pass／2 fail（含清理 hook 超时）；改为封闭锁内核对已提交状态、锁外发放后 **3 pass／0 fail、19 断言**。失败夹具经原 UUID 时间、原数据库 OID、五条完整资源身份和两把测试密钥核对，只清理原 cs_test_01a0f63744317000bdf4/OID 13459285；普通 DROP 后 catalog/默认目录归零，测试服务器另两座原库 OID 保持，无 FORCE。该测试数据库并非专用产品验收项目。

完整门禁首次在 nativeWork 旧升级测试的 RowList/plain-array 断言类型处退出，尚未进入全量用例；断言规范化后后端类型通过。40 个源码/测试/配置候选指纹于 2026-10-01T07:25:12.036Z 重新冻结；修订候选的单次完整 bun run check **4829 pass／143 skip／0 fail，4972 tests、958 文件、32001 断言、852.07 秒，exit 0**，结构、全 lint 与前后端类型均通过。40 个冻结指纹全部保持；不重跑等价全量。143 skip 仅是未启用外部环境，不能算实际物理删除验收。精确提交 b6999edf 的六项 CI 36832635556 已全部成功，实际平台迁移及八组件部署完成；完整删除验收仍待正式 owner 和其余模块接齐。

日志：/private/tmp/cs-rfc037-native-writers-combined-2.log、composition-3.log、coverage-audit-3.json、full-check-{1,2}.log；轮换失败/通过分别为 native-rotation-admission-{1,2}.log，失败夹具的只读来源与清理回执为 rotation-failed-fixture-{readonly,cleanup}.json，均保留。
