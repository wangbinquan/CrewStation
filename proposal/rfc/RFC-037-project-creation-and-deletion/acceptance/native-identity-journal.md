# 原生身份持久记录候选验收

2026-10-01，已批准 RFC-037 的后续实施。此候选记录真实 PostgreSQL 回调前后事实，尚未接齐正式 data-control owner，也不开放管理员永久删除入口。

## 行为与持久边界

`data_control/0005_native_identity_journal.sql` 仅新增原表列与守卫，未改旧迁移。每个新回调持久标记 journalVersion=1，在原资源归属、实际项目共享准入和全部原生名字锁内执行。SQL before/after 读出原锁全部名字的数据库与角色真实 OID，独立来源包含实际 server、服务、卷与目录 epoch；副作用前单独提交 before，副作用后包括已提交 DDL 随后抛错仍提交 after。独立来源不可用或已替换不返回成功；后置来源读取失败仍保存已读到的 SQL OID，storage_after 保持 NULL。

来源持久化只收最小元数据，字段先核验并去掉额外业务内容。未配置独立来源的形态继续保留 SQL 历史，storage 为 NULL；这不能作完整回收证明。旧回调新增列均为 NULL，原字段逐项保持，不补造旧 OID、卷或完成证明。同名重建产生新 OID 时，旧回调的 before/after 保持不变；原历史不能覆盖，也不能在未经正式 verified purge 时删除。

`nativePostgresJournal.read(projectId)` 经模块公开内部端口提供全保留回调事实。一次只读 repeatable-read 快照按原 work_id 每页 500 续读，不用 OFFSET、listLive 或总量上限；旧记录和仍在途回调均保留。retainedRecordsComplete 仅证明保留表读完，NULL 仍是身份缺口；revision 包含回调进度，不能直接当永久固定的 purge scope 摘要。

实际来源端点的 409 明确分类为原探针采样忙碌。仅此错误在同一原锁、每次重新核对准入的条件下最多等待 60 秒；503、未知来源和来源更换均拒绝，不把忙碌当空来源，不变更探针或采样策略。

## 本机验证

使用已授权、经 ID／镜像／标签核对的隔离 PostgreSQL 容器 `d12386b3dccd7458ab86544934a982d03f82a6f8cbcd941f493a1c988d1d9c27`，不是共享平台数据库。

- 正常 CREATE 原库／角色、DROP 后保留 OID、同名重建、DDL 提交后抛错、后置来源失效、卷替换、SQL 绕改／删除历史、来源字段核验、明确忙碌重试均通过。
- 旧口令与旧回调真实迁移保留全部原字段；新增事实为 NULL。501 条分页与独立提交的退出／新增交错证明一致快照；其他项目不混入，数据库读取失败不返回空证明。
- 来源依赖在此 PG 用例中是明确的端口替身；实际 K8s 来源映射的用例使用真实文件系统与 K8s／SQL 替身。它们不计作已部署 HTTP 联验、真实管理员删除或全部资源回收。
- 精确专项 25 pass／0 fail、131 断言；较宽 data-control／轮换／来源组合 96 pass／3 Garage skip／0 fail，99 tests、21 文件、558 断言。日志分别为 `/private/tmp/cs-rfc037-native-identity-journal-targeted-4.log` 和 `...-wide-1.log`。
- 精确 ESLint、结构与后端类型通过。官方改动行算法在精确六个生产文件中核对 72／73（98.63%），所有改动生产文件被加载，未命中覆盖违规；未覆盖的是身份提交行数异常拒绝。

初始红记录保留：第一轮六项行为反例失败，旧升级夹具另因独立 SQL 未进入实际准入事务失败，修正夹具后真实升级通过；新增来源忙碌／额外字段反例也先红后绿。首次新增类型依赖形成类型文件环，迁至原 storageSource 入口后结构通过；不留结构例外。

## 尚待完成

此候选的稳定内容完整门禁、精确发布／CI、本机迁移部署和真实 Root 写入前后来源联验待执行。旧保留资源正文和旧 OID／独立来源仍有缺口，不能由新 journal 追溯填补。正式 owner、原生 drain／purge／verify、平台存储变更协议、对象／源码等剩余 owner、管理员二次确认和 PD01–23 实际回收继续；原专用项目与共享卷保持。

## 自查后的兼容性修订

首个冻结候选完整 `bun run check` 4905 pass／143 skip／0 fail、5048 tests、968 文件、32761 断言、970.26 秒，11 个源码／测试／锁指纹保持。之后功能自查确定不能以来源记录静默关闭已支持的外部／非适配器原生供给；先加入真实 PG 的 CREATE 反例，再将明确“没有来源适配器”与受支持来源读取故障分开。前者保留 SQL before/after、storage 为 NULL 并保留原能力，后者仍拒绝；已取得原独立来源后，其后置来源失效也拒绝，不能降级到成功。首次未知、后置可观测分别记录真实两侧，不倒填前置来源。完整回收对任何 NULL 来源继续阻断。

最终修订精确 29 pass／0 fail、141 断言；较宽 100 pass／3 Garage skip／0 fail、103 tests、21 文件、568 断言。精确 lint／结构／后端类型通过，改动覆盖见 `...-coverage-audit-2.json`。因为任务源码发生上述行为变化，重新冻结同一 11 路径的候选 2 并执行其单次完整门禁，不能拿首个候选的结果替代最终源码。

0005 是本任务尚未提交／发布的新迁移，仅隔离测试库执行过初版，没有已发布 HEAD 或平台安装包含它。最终发版前在同一未发行迁移中允许后置独立来源单独保留，手工只更新该迁移新锁值并在提交说明声明；`migrations:lock` 复核 203 项通过，历史迁移与全部其他锁值保持。原锁工具拒绝修改初版的输出与未发行校验回执保存为 `...-unpublished-migration-finalization.json`，不把此过程用于改写已发行迁移。

最终候选 2 完整检查静态四层通过、4908 pass／143 skip／1 fail／1 error、5052 tests、968 文件、32769 断言、968.10 秒，11 指纹保持。唯一失败是 provisioning 的完整 HTTP 编排默认 5 秒超时；随后 afterAll 关闭夹具连接导致迟到请求 CONNECTION_ENDED 和附带断言错误。该文件独立原预算重跑 8／0、157 断言，HTTP 3071ms，所有原断言保持。将这一条包含 22 参与者全阶段及多路权限请求的真实 PG 用例预算设为 15 秒，不改断言或产品时限；候选 3 冻结 12 个源码／测试／锁路径并执行其一次全量。不能把候选 2 称为通过。main 的无关 85ee9254 前进没有中断门禁，也不是重跑原因。

候选 3 完整静态四层通过、4908／143 skip／1 fail、5052 tests、968 文件、32772 断言、1184.91 秒。HTTP 原断言在 15 秒预算内全部完成；另一条同名 UID／物理存储两项目完整编排命中默认 5 秒超时。首次只调整 HTTP 预算不完整，现统一四条同样走全部阶段的 PG 编排用例为 15 秒，原断言全部保留；快速盘点拒绝保持默认、101 操作恢复保留原 30 秒。生产代码与候选 2 完全一致；仅同一测试文件的预算变化。候选 4 冻结 12 路径并继续其一次完整门禁，前两次超时结果不称通过。

最终候选 4 完整 `bun run check` 已通过：静态四层成功，4909 pass／143 环境 skip／0 fail、5052 tests、968 文件、32770 断言、1077.53 秒。12 个冻结源码／测试／锁指纹全部保持，生产候选与修订 2 一致。精确改动行 81／82（98.78%）、无未加载生产文件；后续仅回填本回执，不重复同内容全量。精确提交／CI／本机迁移部署与真实 Root 联验继续，完整永久删除入口仍关闭。


## 2026-10-02 精确发布、实际部署与准入内快照回归

身份 journal 已精确发布为 `66556eecaf8ecf37ed396ba3c86a1d4a6832b342`；[CI 36885290493](https://github.com/wangbinquan/CrewStation/actions/runs/36885290493) 六项终态 success。2026-10-01T15:59:42.373Z 八组件 Ready=1 且 generation=observedGeneration，控制面 manifest `sha256:dd7f25790c06ce6045a33be92dc5f25829ed9c488a15879f47510f5bbf5d4c1f`、console `sha256:54566480c4e93ed7a9a66d89253c92f3b7d1402552c1c63890f929f62f051c25`。实际安装 0005 校验和等于已发布迁移；203 项锁中的其他迁移未改。初次临时部署脚本将不相关的 Agent 用量包纳入探针差异检查，故在任何部署写入前拒绝；核对实际入口 apps/cs-storage-probe、filesystem-metrics、Zod 依赖锁与部署配置均不变后，修正脚本校验范围。原拒绝日志保留。

实际 API Pod `8b0f5bf2-bde5-4512-b7d6-a536fb1ddc5d` 的镜像／containerID 已独立核对；使用安装代码和真实组合根运行原专用项目的 native SELECT。两次实际 `/source` HTTP 200，已独立保留真实前后原卷摘要 `37a5d248a52b478038a570883375b439cdb6a4829bc3648c284ef46e3b47095f` 和原库 OID，失败回调实际退出为 finished。公开 journal 在该回调内部读取失败：准入上下文先向独立 UOW 注入 SELECT，随后 SET TRANSACTION ISOLATION LEVEL 被 PostgreSQL 以 25001 拒绝。这个真实 Root 验收没有通过，不能用原始表记录或另一次适配器成功替代。原探针 UID／generation=8／策略、共享 PG 原四键／PVC／PV、原项目对象与 Runner 摘要保持；原 48 库／48 角色全名字及 OID 前后完全相同。

在两个真实 PG 端口加入同上下文反例：journal 的原 native 回调内读取，以及 resources 原保留历史的共享准入内读取。先确认 21 pass／2 fail，两个错误均是原 SET TRANSACTION 时序；改为通过事务配置在 BEGIN 时固定 repeatable read/read only，保留原一致快照及只读语义。两个已有跨页并发测试的事务代理同步透传配置，继续核对真实独立提交，而不放宽原断言。修订后 23 pass／0 fail、105 断言。稳定修复候选完整门禁、精确发布／CI／部署和同一实际 Root 复验继续。

私有回执均位于 `/private/tmp/cs-rfc037-66556eecaf8e-` 前缀：deployment-receipt、source-probe-receipt、applied-journal-migration、cs-api-observer-before、cs-api-native-journal-live、failed-callback-retained-facts、native-catalog-before/after。反例与修订定向日志为 `/private/tmp/cs-rfc037-admitted-snapshot-red.log` 和 `...-targeted.log`。原专用项目仍保留，永久删除入口继续关闭；正式 owner 和 PD01–23 的全回收范围没有完成。


准入内快照修复的单次稳定完整 `bun run check` 通过：结构/lint/两侧类型成功，4911 pass／143 环境 skip／0 fail、5054 tests、968 文件、32780 断言、893.21 秒；四个冻结源码/测试指纹全部保持。官方改动行核对 2／2（100%）、两个生产文件加载、无违规。只补本回执后精确发布，同内容不重复全量；日志 `...-admitted-snapshot-full-check.log`、`...-admitted-snapshot-coverage-audit.json`。精确 CI、部署和真实 Root 复验尚待执行。

正式 owner 接线的隔离 PG 核对另发现需要处理的边界：同一真实 native 回调先 CREATE 角色、随后项目准入关闭，下一条调用方查询正确拒绝，但后置只读 catalog 采集也被同一业务准入拒绝，故实际已提交 OID没有 after 记录。原回调仍 finished，不能据此称完整物理排空；证据 `...-native-closing-observation-proof.json`，只使用原隔离测试实例并清理自建角色。后续应将实际持锁的只读后置观测和调用方写入许可分开，主准入连接失效时仍保留缺口并走正式 drain，不补造旧事实。这不属于本次 BEGIN 时序修复，不将该边界称为通过。
