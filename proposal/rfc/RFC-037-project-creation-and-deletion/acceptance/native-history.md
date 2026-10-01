# 保留原生台账的完整读取与收尾竞争修正

以下保留 2026-10-01 发布前候选及失败回放；当前发布、部署与实际复核见文末。这是正式 native owner 的输入基础，不代表所有旧 OID/来源历史已补齐或永久删除已开通。

## 保留台账端口

resources 的公开 `projectDeletion.nativePostgresHistory` 在一个只读 repeatable-read 事务中，用原主键每页 500 条读尽保留记录及其原生子对象。包含停止、失败、压缩和在途记录，以及其他资源种类中意外出现的原生子对象；只读自己的 schema，不用 capped listLive、OFFSET 或一个 slug 推断归属。retainedRecordsComplete 只表示保留记录没有截断，不能替代原生物理完整证明。

返回当前完整 spec、声明名字、原观测 UID/expected、版本及原所属模块；当前版本之前的正文没有保存在 changes 中。压缩身份、旧版本正文缺失、不可解读 JSON/原名字/OID 和未知所有者分别作为 gaps 返回。正式 owner 必须用原独立持久事实覆盖这些缺口，不能把缺失旧 OID 当作已回收；当前快照 revision 也不能直接充作排除停止进展后的原物理范围摘要。data-control 正式 owner/全写入事实的独立来源仍未装配。

真实 PostgreSQL 的红回归先证明端口缺失，随后完整读取 **2003 条**（普通列表只返回 2000）；停止/失败与最后一条均保留，其他项目排除。**501 条跨页**且交错独立改名/观测 OID/新增提交时，原快照记录、子对象和摘要保持一致，下次核验才看到变化。不可读版本、连接关闭拒绝核验，异常材料保留明确缺口。最初两项红日志 native-history-red-1.log、一次用例语法失败 green-2.log 都保留。

resources 仍为 55 个生产 TS，原有规模的拆分提议补在 ADR-0012；本次复用既有 inventory，不增加生产文件、module、layer 或结构例外。

## 文档提交 CI 暴露的实际竞争

来源部署文档 `35cf5a475979cbf74fb324230173f55b4e1a0a75` 的 CI **36851251309 失败**：static、unit、console、e2e 成功，module 的 businessTaskModule 用例在 succeeded 后立即读到空命令输出，gate 随模块失败。该提交只有四份文档、源码与已成功的 e9eb97b2 相同；不称这笔文档的 CI 六项成功，也不把重新跑绿作为修复。完整日志通过 jobs/logs API 保存在私有目录；gh run 的默认 cache 写入受限目录失败不用于判断网络或凭据。

新增真实 PG 回放先确定实际漏洞：保存旧 running 快照，待实际后台结果提交 done 输出后再用旧快照按退出事件收尾。旧代码返回/落库输出均 undefined，终结事件从一条变两条；两份红日志 command-output-red-{1,2}.log 保留。它复现了与 hosted CI 空输出相符的收尾竞争，不假称已观测那次 hosted 调度的每一步。

修正以事务内 SELECT FOR UPDATE 重读原子任务再收尾；已终态保留原状态/输出且不重复终结。同退出码的迟到实际结果仍可补齐输出，通过相同锁保护；执行环境回收后的标记合并最新原记录，避免另一条旧快照覆盖已提交内容。原输出断言保持。两个真实事务并发按同一原退出事件收尾只有一次终结，迟到结果补齐，返回的原 endedAt 一致。首个并发夹具没有等实际退出事件开始而返回 running，失败原件保留；随后改为等待同一 execId 的实际事件，没有固定 sleep 或删掉断言。这些是应用/真实 PG 证明，环境端口仍为夹具，不证明真实集群停止或资源回收。

## 候选验证

历史/资源删除组合 **13 pass／0 fail、104 断言**；全部 business-task 加这两文件的较宽检查 **224 pass／0 fail、2037 断言、57 文件、68.83 秒**。加入并发收尾用例后的最终精确组合为 **26 pass／0 fail、199 断言、3 文件、7.41 秒**；不将不同轮次相加。官方 patch gate 按本批精确 10 个源码/测试路径检查：**75／75，100%，所有改动生产文件加载**。精确 lint 和结构检查通过；提交基线 35cf5a47 加本批路径的内存编译后端/console 均 0 diagnostics，未另建 checkout 或剥离共享 WIP。

首轮历史端口的完整 check 静态结构/lint 成功，后端类型停在其他任务的四项在制错误；未运行完整用例，日志 native-history-full-check-1.log，不当作全量通过。原 5 个历史端口指纹不变。随后修正命令收尾并增加并发用例，当前 10 路径新候选冻结，工作树后端类型已通过；修订候选完整 check 第二轮继续，不取消或因无关 HEAD/WIP 变化重跑。新/旧候选分别保留指纹与日志。

修订候选完整第二轮已结束：静态四层通过，**4886 pass／143 skip／0 fail、5029 tests、967 文件、32692 断言、1107.00 秒**。10 个源码/测试内容指纹保持原冻结值；并行任务在制内容完整留在工作树，不纳入本次清单。最新精确候选内存编译两侧仍 0 diagnostics。接续精确发布、精确 SHA hosted CI 及实际部署，不重跑相同候选全量。

原实际项目、数据库、凭据与共享 PG 保留。实际部署仍为 e9eb97b2；创建弹窗没有改动，本批新的 Chrome 验收没有完成。全历史独立原生事实、正式 owner、其余内容清理、管理员二次确认和 PD 全链路实际回收继续，永久删除入口关闭。


## 精确发布、部署与实际读取

15 个源码/测试/文档路径已精确发布 `bcc04b1ae5950d156ab799d433ec396ecbd53336`，共享 index、提交路径/署名与 main/origin 同步均核对；并行在制内容保留。[精确 CI 36859221730](https://github.com/wangbinquan/CrewStation/actions/runs/36859221730) 的 static、unit、module、console、gate、e2e 六项终态 success。它包含真实 PG 的命令输出竞争修正，不把先前文档提交 35cf5a47 的失败改记为通过。

从该 SHA 的 Git archive 构建，两个镜像 revision 相符、storage-contract=1。真实平台库先保存 0600 custom dump，迁移 Job `rfc037-migrate-bcc04b1ae595` Complete；本批没有新增迁移。2026-10-01T12:26:25.999Z 八组件均 Ready=1、generation=observedGeneration；控制器先核对 35 个原 Pod 的来源索引，再升级认证/事件。

| 实际产物 | 结果 |
|---|---|
| 控制面 manifest | `sha256:fa74b1c94a19914d3870f9ec9d8c6875377bd8a7a38fd4456718b63cf52620f7` |
| 工作台 manifest | `sha256:65d1e52bb3373336bdfa1d0cc7c072acd1f3ae9f64f812249cc6bdb1fc3698ea` |
| 八组件代数 | controller 180、session 133、api 214、auth 112、events 82、两 MCP 78、console 223 |
| 原项目身份/镜像快照 | 22 Namespace、48 Pod与PVC、19 PV，部署前后全量快照相同 |
| 原共享 PostgreSQL | 原 Pod/容器、PVC/PV、Node、Service及挂载快照相同 |
| 原只读来源探针 | 原 DaemonSet UID、generation=8、原 Pod UID/镜像、只读挂载与精确 NetworkPolicy 均保持；未为本批重复升级 |
| 当前 Runner | 原 manifest `587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928` 保持 |

实际 API Pod `676f81ed-5743-4b59-afd5-ab11b3825560` 和控制器 Pod `379972cc-576f-41ee-b1f5-e8dfff624d14` 的公开 Root 历史端口各自读到 **2 条**本项目保留原生记录，与独立 resources schema 只读核对相同，revision 均 `32aa428f7c70c79cfa7a22ef9374a961339ea87a5cd81290e3ece75f24da7672`。原库声明/观测 OID 276598 相符；两条均明确返回 `native-revisions-unavailable`，没有将当前保留内容当作旧版本/OID物理历史完整证明。

API 在历史读取后的两个未插桩来源请求被拒绝，原件保留，未记录其具体 HTTP 状态。单独适配器诊断三次 HTTP 200、原独立来源 identity `37a5d248a52b478038a570883375b439cdb6a4829bc3648c284ef46e3b47095f` 保持；不拿该诊断替代未通过的组合根请求。随后对真正公开 Root 的实际 HTTP 边界只加状态记录，捕获 **409 / A measurement is already running**：探针与另一项测量互斥，来源核验拒绝并发。本次状态记录不证明此前两次也都是 409；正式 owner 后续必须保留拒绝/等待重试语义，未通过的请求不得写成物理验收成功。

API 的原 native SELECT 回调在途事实、实际 finished 退出、原 Pod 保护与旧生产凭据 SELECT 均通过；原库 `cs_rfc037_creation_proof` / OID 276598 的原目录仍 present。部署前后 **48 个项目库与48个角色的名字/OID全量清单相同**，未 CREATE/DROP、改口令或删除专用项目。私有原始回执使用 `/private/tmp/cs-rfc037-bcc04b1ae595-` 前缀；数据库备份、凭据和完整 spec 不进入仓库。

本批未改创建界面。当前源代码仍为统一 FormDialog 与域名/模板用途说明、旧书签回列表开窗；既有桌面/390/320px实浏览器证据保持。本次浏览器连接超时，没有增加新的界面复测通过记录。全历史独立事实、正式 native owner、其他内容回收、管理员二次确认及 PD 全链路真实回收仍未完成，永久删除入口关闭。
