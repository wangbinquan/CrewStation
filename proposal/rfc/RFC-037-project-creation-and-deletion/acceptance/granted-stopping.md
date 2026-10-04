# 原删除许可、作业选择与停止后内容快照

本批衔接原 TaskRuntime／DevSession 停止，使用真实 PostgreSQL 验证；Root 授权、外部停止、数字传输和物理来源在专项用例中受控。正式 TaskRuntime 停止端口、跨进程 Session 数字排空及全 22 owner 装配仍未完成，永久删除入口与 producer 保持 OFF，原专用项目保留。不得把本批数据库回归称为实机全回收。

## 原许可与作业

`modules/project/application/deletion/owner.ts` 验证实际当前阶段，不能在后续阶段重用 seal／stop 许可。先红复现见 `/private/tmp/cs-rfc037-original-job-context-phase-red-v1.log`。参与者派生上下文从原持久确认读取，不生成新操作、不增加世代或延长租约，且再次验证原 target 和完整确认摘要。

`packages/queue/claimOriginal.ts` 只认领给定 kind、dedupKey 与完整 JSONB payload 的原持久作业，沿用原队列租约、fencing token、attempts 和 SKIP LOCKED。不会抢其他项目、加速尚未到时的作业、复活 dead／done，或伪造清理租约。

## 停止后冻结与清理

TaskRuntime 私有七阶段 owner 保留最初确认的完整内容和原回调；真实 finally／原完整 Pod 证明及全部以前清理尝试退出后才调用停止端口。原停止证据与停止后完整内容快照在同一 PostgreSQL 更新中提交，续租／丢 ACK 后复用原证明。metadata 按停止后正文和整行摘要 CAS 原子删除全部登记表，允许同原操作、已退出的后续物理阶段回调；旧归属与删除墓碑保留，其他项目与全局恢复游标保持。

DevSession 的显式 `runGranted` 仅接受原 dev-session 确认与当前原世代，逐 I/O 前后核对来源和许可，已发起 I/O 持续到私有 finally；普通 API 和新准入继续关闭。原无 grant 的回调出生／退出摘要字节规则保持。停止后快照和 stop 证明原子提交，metadata 使用冻结正文摘要，不依据被修改的当前清理范围猜测原对象。`projectDeletionCleanup` 仅为停止阶段私有能力；正常 cleanup 能力继续由普通原回调保护，本批不接入正式生产 Root。

新增 0017 记录显式清理许可与原停止快照；0018 独立修正原回调 metadata 删除，只允许 namespace 证明、实际 exclusive 后端和全部原退出具备时清理。按官方路径锁新增两项到 241，原 239 项 checksum 保持，未改任何原已锁迁移。

## 验证与剩余

最终定向 `/private/tmp/cs-rfc037-granted-owners-target-v5.log`：53 pass、0 fail、490 断言、11 文件、32.42 秒。覆盖精确原作业、多 owner 原许可、错误阶段／参与者、许可撤回后的已发 I/O 保留、并发清理阻断、停止证据／快照原子提交、世代续接、metadata 晚失败整事务回滚、另项目保留和完整 EOF。新 grant 正向写入经实际 `db.transaction` 继承共享准入身份；旧直接 execute 夹具失败日志保留，生产 SQL 未放宽。

完整门禁、精确发布与自身 SHA CI／部署另追加实际终态。本批稳定功能 38 路径；RFC-036、观测原生读器与 `sessionLifecycle.ts` 的并行在制输出不在发布范围。下一步为实际原作业续接、Task／Dev／Session 数字停止与 finally、全 22 owner 的物理范围、专用项目原确认与完整资源回收。

首次完整门禁 v1 已自然终止：5636 pass、143 环境 skip、1 fail、189848 断言、1109 文件、1722.54 秒；38 功能路径首尾指纹未变，静态四层成功。唯一失败来自 events 的既有用例在 Root 完成 metadata 并推进 verify 后重用旧 metadata 许可；新当前阶段校验正确拒绝。保留 `/private/tmp/cs-rfc037-granted-stop-full-v1.json` 与原日志，未取消、未称为绿、未放宽生产校验。修订用例先在当前 metadata 阶段核对重复调用，再推进 Root 并明确断言旧许可失效；实际 PostgreSQL 的 events／project 定向 18 pass、0 fail、161 断言、13.90 秒，见 `/private/tmp/cs-rfc037-phase-replay-target-v1.log`。修订候选增为 39 功能／锁路径，完整 v2 独立记录，原失败结果保留。

## 实际接线约束

源代码核对确认两处必须补齐的依赖：`modules/session/application/commandDispatch.ts:28` 的正常命令经 connectionHistory.check，`modules/session/adapters/persistence/deletion/lifetime.ts:17` 的正常 check 在封写后拒绝。因此 Task／Dev 持有明确删除许可仍不能通过普通 Session 命令排空；需要同原操作的 Session 参与者许可，限定原确认出生、原 runtimeTaskId、停止／只读／原水位 ACK，不开放新 Agent／工作负载。Session 的外部 I/O 必须由原连接或独立持久 callback 的真实 finally 覆盖，不能由 HTTP 超时推断退出。

`modules/provisioning/application/deletion/advance.ts:8` 会在 stop 阶段启动全部 owner；Session 即使排在 Task 之后，也可能在 Task 返回 waiting 时关闭连接。正式装配要显式保留数字排空的连接依赖，确保原停止日志与尾水位持久落库后再关闭连接，不能仅靠列表顺序。Task 原队列认领需要新精确选择基元和实际队列 heartbeat／fence，再走原 cleanup／parent-ending 路径；禁止伪造 jobId 或等待已封写的普通 worker 自行执行。

项目销毁不新建归档副本，沿已批准设计 §6.1 的独立 project-deletion 原 UID 许可，在停止／排空证明齐全后清盘；普通业务 archive-and-delete 合同保持。正式组合应通过端口在 wiring.ts 反转连接这些能力，而非从 application 跨模块读表或调用私有实现。

停止接线还必须区分发起删除与观测既有终止：`modules/cluster-control/adapters/k8s/deletion/podProtection.ts` 的 stop 在没有 deletionTimestamp 时主动删原 Pod，而 Task 的原 cleanup 要等该 Pod 正常终结。因此不能仅在 Root 上等待完整 Task stop 后才启动保护观测，也不能在数字排空前主动删除 Pod；先观测由原任务许可开始的终止，保存原完整容器证明后释放自己的 finalizer，再在数字／消费者证明齐全后处理其余原 Pod。Session 的清理副作用要持续到原连接 command 的完整处理和私有 finally，普通握手、模型启动、替换连接继续拒绝。

metadata 的跨模块原来源也须按真实装配回归。`modules/business-task/adapters/persistence/infrastructureOrigins.ts` 当前只从本模块现存 tasks／execution_operations 读取受理任务，Business metadata 后缺少该根；TaskRuntime 后续盘点不能由服务或子记录猜测归属。下一批必须固定并暴露这类最小原身份，或按保留全部依赖的真实顺序收尾；原无来源和读取失败仍须阻断。Task 已有 `originalRuntimeWorkInfrastructure` 保存公开最小原归属，不能仅看底层 runtimeInfrastructureOrigin 就误判已无保留能力。

完整 v2 运行期间主干加入 `555061963e6408007ab8ab35e0ff718f02a93c5c` 的 8 路径原生读取器基础与共享 STATE；39 功能路径无重叠、指纹保持，fetch 后本地与远端同步。继续原完整进程，整合后的精确候选类型检查单独核对，未因不相关提交取消或重启门禁。

完整 v2 已自然结束：5635 pass、143 环境 skip、2 fail、189815 断言、1109 文件、1468.90 秒；39 功能路径首尾指纹保持。失败分别是未改动 Claude 本机 HTTP 用例期望 404 收到 503，以及观测真实受理日期跨过固定窗口后 201／202。保留 `/private/tmp/cs-rfc037-granted-stop-full-v2.json` 和原日志，不改低任何期望或宣称完整绿。

观测日期修正由原会话精确发布到 `90968db899aae63d1d620ab04958ab43aa3533b1`，保留 202 个 Task、各协议 1001 个 attempt、半开时间边界和原预算；本批不收走其测试／说明路径。本机继承的 HTTP_PROXY 指向环回代理，NO_PROXY 未排除环回。受控的两个新 Bun 子进程读取同一个真实接收器：继承代理明确得到诊断代理 503，启动前排除 127.0.0.1／localhost／::1 则得到接收器 404。记录 `/private/tmp/cs-rfc037-local-proxy-env-diagnostic-v1.log`；这能证明旧验证环境可把代理状态码当成接收器状态码，原失败请求没有服务器跟踪，不能补称已捕获其原响应体。原重现循环 20000 次无失败，不以单独重跑绿来抹去该红。

两个原失败文件在修正日期和明确启动环回排除的环境下定向 3／0、70 断言。v3 只启动一次，记录 39 本批功能指纹及已修正观测夹具的单独依赖指纹，原 v1／v2 结果保持；其重新检查针对实际改变的验证依赖与运输配置，不因 SHA 移动而重启。90968 上 43 路径本批精确候选后端类型 0 错，后续 Session 私有连接／命令基础在制文件不进入本批提交。
# 本批完整门禁终态

v3 在实际日期夹具和启动运输环境修正后自然终态成功：5643 pass、143 环境 skip、0 fail、216454 断言、1110 文件、1739.55 秒，静态四层成功。39 功能/锁路径及单独冻结的日期依赖首尾摘要保持，`/private/tmp/cs-rfc037-granted-stop-full-v3.json` 可核对。v1、v2 的失败日志和摘要未覆盖；不根据后继提交或单个定向绿判定旧失败消失。

精确 `90968db899aae63d1d620ab04958ab43aa3533b1` 提交树叠加本批 43 路径后，后端类型 0 错。发布内容仍限本批 39 功能/锁和 4 文档，后续 Session 清理命令、原连接回调与停止依赖改动留在工作树。本批 TaskRuntime stop 仍使用受控端口，正式跨进程数字排空、全部 22 方与 SCM 物理来源及原专用项目永久回收仍待实现与实机验收；删除入口保持 OFF。
