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


## 2026-10-02 准入快照精确发布、部署与同路实机复验

BEGIN 时序修复已精确发布 `1c17f893f644c6ec08f70e5350f94fe327177a7a`，八路径清单与署名及发布前后 main/origin 同步已核对；[CI 36892472830](https://github.com/wangbinquan/CrewStation/actions/runs/36892472830) 六项终态 success。首个监视器因 GitHub jobs 请求 unexpected EOF 退出，API 当时仍 in_progress，未误报 CI 失败、未重跑 CI；续接同一 run 后正常成功。2026-10-01T16:58:57.279Z 八组件 Ready=1，控制面 manifest `sha256:98c3b6b04fc77943b83804160d7e4abdb00130f63801f9c10d421a7d1b1dde1e`、console `sha256:647dc2b1fb8bd57404ad7fb299e292b64caf93c506cdc462de9c60c1e8c96135`；源自提交归档，非当前工作树。探针/策略/原共享 PG/PVC/PV/项目对象/Runner 原身份保持。

实际 API Pod `a935e97e-4ab2-42a4-af8b-8bc95d571558` 安装代码的同一真实组合路径复验通过。原 native 回调内公开 journal 可读 running、SQL 原 OID 和独立来源；真实 SELECT 完成后 finished，前后原来源均为 `37a5d248a52b478038a570883375b439cdb6a4829bc3648c284ef46e3b47095f`，实际来源端点两次 HTTP200。公开端口与独立持久表逐字段语义相等、原 Pod 保护和旧生产凭据 SELECT 通过。最小 workId `01a0f86c-1450-7000-9732-260a14bb7860`；原48库/48角色全名字/OID前后完全相同。未执行真实 CREATE/DROP、口令改写或原项目删除。私有 `...-1c17f893f644-native-journal-live-receipt.json` 及前后 catalog 保留。JSONB 键顺序和端口字段顺序在比对时使用完整语义规范化，不删字段；首个失败回执继续保留。

本复验仅关闭准入内快照与实际前后 journal 链路。旧原生历史缺口、正式 owner 的 all-name drain/purge/verify、平台存储变更、对象/源码等其余 owner、管理员二次确认及 PD 全回收仍未完成，删除入口继续关闭。创建仍为已发布、部署和浏览器核对的统一弹窗；本批未新增界面源码或浏览器验收。

## 停止时后置身份候选

上述独占 PG 关闭反例已转为仓库回归：真实 CREATE ROLE 后关闭项目准入，后续 DROP 必须拒绝且原角色仍存在，后置实际 OID/独立来源仍保存。首轮16／1确认丢失 after；实现后24 pass／0、115断言（journal/nativeWork两文件），原主准入断线与实际名字锁/回调恢复反例仍通过。来源在此使用明确端口替身，不冒称真实共享集群关闭了项目。

调用方连接继续逐语句核对业务准入；后置观测使用同一原生连接/原名字锁，并核对原 shared 准入仍实际有效，以只读 SELECT 1 维持原 metadata backend 活性，不续建或替换准入。回归独立读取 pg_stat_activity，确认后置来源采集期间原 backend 的实际只读查询及 idle-in-transaction 状态。主准入/原锁已失效时仍拒绝，不通过当前新连接补造事实。仅拆分观测与写入许可；新增迁移/正式 owner/产品入口没有由本候选完成。精确lint通过，稳定单次完整检查及发布/CI/部署继续。


停止时后置身份稳定候选的单次完整 `bun run check` 在 arch 阶段被并行在制源码阻断：task-runtime/ports/cluster.ts 的 ports→api 引用、task-runtime 四文件环和 cluster-control 两文件环，共3项；本批两源码/测试指纹保持，未动这些外来路径，也不把这次完整检查称通过。按开发规则§3处理共享树在制阻断：本批精确lint、完整后端类型通过；较宽 data-control/实际来源组合95 pass／3 Garage环境skip／0、98 tests、17文件、540断言，数据供给/HTTP口令轮换4／0、23断言，精确24／0、115断言保持。官方改动行8／8、无未加载生产文件或违规。完整日志、类型、覆盖与指纹均为 `/private/tmp/cs-rfc037-native-closing-observation-` 前缀；本候选无新迁移/契约变更。精确发布后须等该提交树六项CI，不以旧1c17f893的成功替代；正式owner与全部回收继续。


## 2026-10-02 停止观测精确发布与同路实机回执

修订已精确发布 `45753bb8dadf2fce49c47ed9ca853d7e4f252a5f`，六路径、真实署名、空共享索引与发布后 main/origin 0/0 已核对；[CI 36900606880](https://github.com/wangbinquan/CrewStation/actions/runs/36900606880) 六项全部 success。2026-10-01T17:52:20.918Z 八组件 Ready=1、generation 与 observedGeneration 一致；控制面 manifest `sha256:5107b0d85d224cc902f55cd2c6cfe528aa5f52d8f8444d0a95a253ca188e3e40`，console `sha256:1e90bd307466b3bdb72914bf16d9e691acc49d5de3f2e2d0e3f1ae2fd6fc8bbe`，来自精确提交归档。原只读探针、策略、共享 PG/PVC/PV、专用项目对象和 Runner 保持。

实际 API Pod `4e3b1506-ea87-47ad-9792-5956af1fbcac` 的安装代码经真实组合根核验通过：原 native SELECT 内公开端口返回 running，前后原 OID/独立来源保留；原回调实际退出为 finished，公开事实与独立持久表完整语义相等，原 Pod 保护和旧生产凭据 SELECT 通过。workId `01a0f89b-d962-7000-ae87-6582acfcf0ad`。真实来源采样先 16 次明确 HTTP409，再两次 HTTP200；这是同一原连接中的有界忙碌等待，不是替身或改造探针。前后来源保持 `37a5d248a52b478038a570883375b439cdb6a4829bc3648c284ef46e3b47095f`；48 库/48 角色全名字和 OID 前后相等。实际链路未执行 CREATE/DROP、密码改写或项目删除。

私有证据 `/private/tmp/cs-rfc037-45753bb8dadf-native-journal-live-receipt.json`、同前缀 CI/image-build/deployment receipts 和 native-catalog-before/after 保留。停止场景的 CREATE/关闭/拒绝后续 DROP 回归由隔离实际 PG 证明，本次平台 Root 联验没有人为改变项目生命周期。正式 owner、全历史 scope 与物理 drain/purge/verify、其余资源 owner、管理员二次确认和 PD 全回收仍在实施，永久删除入口继续关闭。
