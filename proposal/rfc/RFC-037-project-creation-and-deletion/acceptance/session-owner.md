# 会话 owner 与原连接退出

2026-10-03，基于 `75dd427227fc7e3f587015c37ca411904513c625`。本批源码未提交、未部署，永久删除入口保持关闭；原验收项目与资源没有执行删除。

Session 已实现 seal、stop、purge、prove、namespace、metadata、verify 七阶段。实际 Root 使用 TaskRuntime 的公开原归属和完整项目任务分页，以及 Project 的真实可用性与删除 grant。项目任务、旧标识、会话内容与连接沿革分别核对；缺失来源、共享归属、确认后新增或替换的内容均阻断。全量盘点覆盖会话的十张内容表，TaskRuntime 的 200 条游标分页包括仍无会话行的任务和项目归属验证容器。

新连接与原出生沿革在同一 shared 准入事务登记。删除先封写，再向记录的原副本关闭 WebSocket 和浏览器流，等待原连接的异步消息、命令准备、持久化及断线回调结束。正常断线、删除与服务 shutdown 共用同一个原连接退出过程。RPC 成功、连接行消失、副本不可达或新连接接管均不能代替私有退出证明。关闭后清除原连接中的 token、工作目录和旧协议桥；正常浏览器重连语义保留。

可用的原平台 Pod 身份在连接出生时固定并保护。服务重启后，仅原 Pod 的全部容器停止、原节点身份匹配且独立观察结果已持久化，才能恢复该出生记录的退出；旧容器的 lastState、单个容器停止、同名替换或错误节点均不足。没有出生时物理身份的旧记录不能后来借用别的 Pod。项目清理不强杀共享控制面 Pod。

Metadata 只有前五阶段证明齐全、所有原连接确已退出且范围重新核对后才能在一个事务删除。封写墓碑、最小任务归属目录与阶段回执保留，清理范围压缩为数量和摘要，其他项目与平台任务内容保持。`0011_project_deletion.sql` 和 `0012_original_pod_recovery.sql` 为追加迁移；已入锁字节未改写，共享迁移锁共 227 项，包含观测会话的 0016。

验证结果：

- 会话全模块及 TaskRuntime 原归属、实际来源组合、平台 Pod 保护组合为 **133 pass、0 fail、1102 断言、34 文件、22.10 秒**。使用真实隔离 PG 与两台真实 WebSocket 副本；Pod 停止事实来自受控物理端口，不能代替实机 Pod／CID／PID 验收。
- 实际 Project prepare／accept／claim 删除 grant 与实际 Session 组合用例通过。其余参与者使用编排替身，不能作为全部 22 owner 清理完成的证明。
- 真实 PG 新增反例首先证明出生 INSERT 可伪造已退出状态；修正未入锁的 0012 后转绿，随后才入锁。最初命令派发的异步时序回归也已修正，初始失败日志保留。
- 修复类型依赖环后，原连接与 lifetime 专项 **7 pass、0 fail、49 断言**；全仓架构检查和本批精确 lint 通过。初次共享树后端类型有 **74 个观测范围错误**，原日志保留；对方修订后，接续业务内容盘点的最新共享树后端类型已通过，见 `/private/tmp/cs-rfc037-business-content-types-v2.log`。尚未宣称完整 `bun run check` 通过。
- 官方改动防护使用精确 135 路径候选，并以修复类型环后的专项覆盖替换三份旧文件行映射，再合并本批及前轮成功覆盖，**1341／1348 可执行改动行，99.48%，无违规**，结果见 `/private/tmp/cs-rfc037-session-patch-v3.json`。仅反映已验证源码改动，不代表正式发布。

证据：`/private/tmp/cs-rfc037-session-batch-v3.log`、同名 XML 与 coverage、`/private/tmp/cs-rfc037-session-exit-insert-red-v1.log`、`/private/tmp/cs-rfc037-session-exit-insert-green-v1.log`、`/private/tmp/cs-rfc037-session-cycle-targeted-v1.log`、`/private/tmp/cs-rfc037-session-arch-v5.log`、`/private/tmp/cs-rfc037-session-types-v13.log`、`/private/tmp/cs-rfc037-session-lint-v9.log` 和 `/private/tmp/cs-rfc037-session-source-candidate-v2.json`。

后续仍需补齐 DevSession、BusinessTask、TaskRuntime owner、SCM 全物理范围及正式 Root 的全部 22 个参与者，完成全仓门禁、精确提交／CI、部署、管理员二次确认与真实回收对账。当前 Session 的实际来源接入不等于永久删除功能已经开放。

## 并发握手修订

首次 141 路径候选的完整门禁运行期间，自查发现同一任务两个握手可能在第一个出生登记尚未完成时提前关闭它，遗漏私有退出证明。新增反例实际为 0 pass／1 fail，见 `/private/tmp/cs-rfc037-session-concurrent-hello-red-v1.log`；顺序登记同一任务的连接后转绿，失败的握手不会阻塞后来者，其他任务仍能并行连接。续接 seq 在原连接消息真正排空后读取。

修订后的全 Session 及相同实际来源／Pod 组合为 **135 pass、0 fail、1117 断言、34 文件、21.16 秒**，见 `/private/tmp/cs-rfc037-session-batch-v4.log`、XML 和 coverage；架构、该修订精确 lint 与后端类型通过。首轮完整门禁未取消，但其运行中本任务三份源码／测试发生变化，不能把首轮结果当作最终候选的完整门禁。最终源码重新冻结后需要一次完整检查。初始错误和旧候选指纹均保留，不据这些专项结果开放永久删除。


首轮完整门禁终态为5485 pass／143 skip／14 fail、5642 tests、1069文件、135243断言、1321.54秒。9项新报告表与旧观测owner不兼容、2项开发统计新协议及1项租户模型静态约束由观测会话接续；该会话已明确接管三个观测删除owner文件及报告在途／工作目录清理，本任务不覆盖它的增量。其余本任务两项为检查进程缓存旧握手代码，以及前端global fetch替身影响双副本HTTP夹具。后者通过可注入请求端口与实际node:http回环请求隔离，保持真实端点、私有退出和跨项目断言，14项会话专项通过；Bun fetch.preconnect 的类型兼容修订仍由最新静态回执核对。首轮不是通过，也不是最终候选验证；完整修订门禁需在已知冲突实际解决后再执行。原14项失败日志保留。

HTTP 夹具最终修订后，全 Session 及原来源／Pod 组合为 **136 pass、0 fail、1120 断言、34 文件、20.25 秒**，见 `/private/tmp/cs-rfc037-session-batch-v5.log`、XML 与 coverage；14项专项129断言、最新后端类型0错误、精确lint和架构通过。官方142路径改动防护为1490／1496行、99.60%、无违规，见 `/private/tmp/cs-rfc037-session-business-patch-v3.json`。独立基线加自有候选仍有13项保留的并行观测公开导出／Root依赖，需双方就绪后共同串行交接，不能独立推送不完整依赖。当前没有启动第二次完整检查，也未提交、推送或部署；新报告owner接续期间继续保留原资源和关闭删除入口。


## 2026-10-03：Session／BusinessTask／开通 owner 与观测依赖联合门禁

Session 与业务／开通 owner 及必要观测依赖共同冻结 350 路径，一次完整 `bun run check` 终态 5541 pass／143 skip／0 fail、135946 断言、1085 文件；源码指纹首尾一致，精确联合提交树后端／console 类型均 0 错。回执 `/private/tmp/cs-rfc037-session-business-observability-full-v2.json`；原 136 项 Session 专项证据继续有效。观测依赖先本地提交 35ff8871，余下 owner、234 锁和登记接续提交后再联合发布；当前未把中间依赖提交单独 push。

上述检查不含下一批 DevSession 的 7 个新增文件，不替代原跨 Pod 完整退出或专用项目物理回收。其他 owner、完整 Root 装配与二次确认实机验收继续，删除入口关闭。
## 2026-10-04 原连接回调与停止依赖基础

新增原出生、原副本、当前持有连接及私有key约束的回调入口；外层请求先报错后，已经发出的内部回调仍保留到实际finally，不能提前持久退出原连接。受限命令只允许原开发/业务执行的停止、信息、分页与已持久水位ACK，拒绝启动、身份替换和未落库ACK。

Root停止依赖现在读取原操作持久回执：DevSession／BusinessTask／TaskRuntime未完成时不能关闭Session；全部前序消费者未完成时不能发起resources stop，cluster-control等待resources。只观测已终结原Pod保存物理停止摘要并释放本操作保护，不主动删除活动Pod、不生成Root stop回执。真实PG编排与资源许可、API Server替身验证见[本批证据](session-cleanup-lifetime.md)。正式跨进程数字通道和停止后快照/CAS尚未接线，本批不宣称实机完整删除。
