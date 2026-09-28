# RFC-034 原生子树采集实施增量

状态：设计门与独立静态实现门 PASS，完整候选门禁通过；属于已批准 RFC-034 T1–T3/T6，不是全部 RFC 的完成记录。

## 现状与本批边界

`packages/agent-drivers/drivers/usage/capture.ts` 按 stdout 原生记录维护修订；`chainedRun.ts` 每轮一个进程，交互模式继续同一原生会话；`usage/opencodeModel.ts` 只关联已见 step 的模型。`modules/session/adapters/persistence/businessUsageSources.ts` 在业务日志事务中保留独立数值副本，`modules/observability/application/usageIngestion.ts` 在计量持久化、估值后才 ACK。本批沿用这些所有者，不建第二条摄取通道。

目标为 OpenCode 根和后代 step 的最终增量采集、恢复去重、可持久的采集完成证明和正式页面状态。历史原生修订只保存证据并明确缺口，不未经归属证明重新计入当前执行；跨执行自动补正是紧接的后续批次，RFC 不能因此记 Done。Claude 原生树、开发/档位测试来源与实时调用段也仍按总计划推进。

## 协商、轮次与数值身份

增加独立可选 `nativeUsageTreeV1: 1` 能力；必须同时协商 `usageObservationsV1: 1`。新平台探测双能力，旧 Runner 仅对明确 unsupported_capability 降级至已支持的用量版本，其他错误继续抛出。新 Runner 只在请求该能力时产生扩展；仅 OpenCode prepared adapter 提供子树读取，其他协议给 unsupported，绝不静默套用 OpenCode。原有业务事件/结果和旧 BusinessUsage 不变。

同一个接受的 Agent 保持递增 revision；每次链式 runTurn 在 spawn 前分配 turnIndex/turnId、读取恢复基线并持久发出 pending 证明。pending 通过运行策略、CLI 装配门面和 ManagedAgent 三层队列的处理回执，等待 BusinessAgentSupervisor 同步 journal 事务完成后才 spawn；日志失败先设置取消，回执后再次核对取消/关闭。队列提前 return/throw（含首次 next 之前）拒绝待确认和等待容量的写入，最终有界证据帧按消费速度背压，不改变业务结果。最终在进程 reap 和输出排空后读取当前根的子树，数字帧每页最多 100 条，final 证明排在全部数字帧后面；失败/取消仍采集，输出未排空增加不完整原因。每个 turn 单独证明，下一轮不能覆盖上一轮缺口。

根 step 使用现有 recordId 算法和同一 revision allocator，使最终数据替换 stdout 记录；子 step 带完整 root/session/parent/ancestors/request 范围。恢复基线中存在的 part 主键在 stdout 和最终帧都排除，不把旧步当新回合。恢复基线不完整时不声明新 step 的可靠归属；记录 baseline-unavailable。树仅沿 parent_id 递归，不搜索不相关会话。

## 原生证据与预算

官方固定 v1.18.29 `packages/core/src/session/sql.ts` 定义 session.parent_id、message.session_id、part.message_id/session_id；`packages/opencode/src/session/message-v2.ts` 的水合保留表主键。数据库路径由实际子进程最终环境解析，读事务固定快照，busy_timeout=0，只查询身份、时间、四桶和精确 assistant provider/model。仅输出数值与标识，不输出 prompt/tool 正文。

默认 128 session、32 深度、5000 step、20000 part、400ms；参数硬上限 1024/64/10000/50000。这是原生遍历预算，不限制 stdout 已收到的数值记录总数；receivedSteps 使用安全整数计数，第 10001 步仍推进来源游标，超扫描预算的最终证明保持 partial。最终归属重查仅查询已有历史基线关联的步骤，避免对万条普通步骤逐个执行空查询。超限、缺库、根变化、祖先环、未结束 step、时间/模型/桶缺失分别保留原因；未知不转零。步身份或遍历覆盖不足时 fingerprint=null，不能用作下一次完整基线；只有元数据缺失仍可证明遍历范围。空树只有实际读到根且遍历完整时可表示明确零。

证明包含 contract、turn、root、baseline/final fingerprint、计数、状态 pending/complete/partial/unsupported、有限诊断与 priorRevisionGap。每个历史 step 的前/后数值与模型证据按最多 100 条独立数值证据帧保留，未访问 after 标记 unobserved，不能当删除；summary 不内嵌全量历史。原生来源定位仅作为当前执行证据，不凭同一路径推断跨 Pod 数据库为同一个来源。

恢复完整性还必须对照已提交证据，而非仅比较本轮前后：每个恢复基线 step 在平台摄取时按原生 root/session/part 身份、原执行来源及完整祖先路径定位已保留的贡献。比较 baseline 的四桶、实际模型与范围和原 owner 已提交状态；例如 turn 0 S=10，turn 1 baseline/final S=15、T=3，必须标记原 S 所属轮次 priorRevisionGap，当前合计 13 明确为下限。跨轮间改变与本轮内改变使用同一历史证据比较，不能因 before=after 跳过。唯一 owner 且相同来源沿革已证明时才给原轮次增加缺口；不能仅凭 DB 路径合并不同 Pod 来源。归属不明保存 unresolved-owner，当前轮次保持 partial，并保留全量有界 baseline 给后续重试。未找到历史 owner 不凭空创建旧用量；owner 迟到后重新比较并投影缺口。每次缺口变更与任务水位/冻结快照序列一起持久化；最终数字自动补正继续留到后续批次，不把缺口清除当作修复。

## 持久化与正式读面

RunnerUsageCapture v1 新增可选 nativeProof/nativeBaseline 数值字段，受新能力协商控制；所有扩展与测量一样进入 Session 数值 outbox，不受原始日志过期影响。observability 在原 task/source 事务和游标内投影 nativeProof 至新增表；原始 baseline 保留在 owner outbox，后续归属修订从该证据读取。final 不能先于数字页面提交；丢 ACK 重放必须严格幂等，冲突不得覆盖先前证明。

任务统计为每个 attempt 返回精简采集列表（不含内部模型或完整 baseline），项目与系统详情使用共享 Card/Stack/DataTable/Dialog 展示状态、时间、范围与原因。采集 pending/partial/unsupported 导致汇总下限；未协商或旧来源显示未观测，不能写成子树完整。执行观测增量和冻结快照保留 capture-incomplete 缺口；缺口与对应冻结水位一起固定，不能在分页中改变。Token 数字、估值版本与 CNY 口径不改变。

## 验收与交付顺序

1. 协商新旧 Runner、无相关能力/其他错误、每轮能力传播。
2. 真实临时原生 SQLite 根/子/孙和兄弟隔离、空树、actual model、元数据缺失、各预算与未结束步。
3. stdout/final 同 ID 修订、恢复旧步过滤、交互多轮、spawn 失败/取消/泵故障后终态。
4. 数值副本保留、分页 final 屏障、原生证明同事务、丢 ACK、重放冲突、冻结快照缺口。
5. 正式详情/聚合/CSV 下限一致、未知与零、宽窄屏 Dialog 与标准间距、双语。
6. 独立功能复核、本机一次完整候选门禁、精确路径提交推送、该 SHA CI、按当前存储合同的固定镜像本机部署。原任务与会话资源保持，不把合成数据验收称为真实模型验收。

设计功能 gate：2026-09-29 复审 PASS；前一轮发现的轮次间修订遗漏已在上文补齐。实现沿用 sealed ExecutionAgentPlan.sessionKey 作为平台分配的原生卷沿革标识，由新能力命令单独传给驱动并固定进证明；跨 Pod 不凭路径比较。现有 ensureAgentEnvironment 已以同一个 sessionKey 创建/续接 businessSession，来源为既有 owner 合同。


## 5. 当前实施证据与剩余边界

已接通 Runner 可选能力、OpenCode 启动前基线/进程回收后采集、背压、同事务数值和证明、证明历史水位、原归属迟到重查。公共分页缺口按各自冻结水位重建，后续完成不能清掉旧快照中的 pending；相反，历史修订不能倒灌为旧快照已知的缺口。单轮未覆盖的旧步骤不推断删除，重复基线位置拒绝且整页回滚。对不存在或代次不匹配的执行证据不作归属猜测。

正式统计与现有泳道详情弹窗读取相同采集摘要，按轮次选择而不铺开长列表。完整空树及完整恢复后没有新增步骤时，CS 正式统计显示真实零；未知/unsupported/pending 保持未知或已知下限。当前平台同步 v1 仍传递数值与冻结缺口，纯空树零证明尚不单独下发给 AW，因此 AW 托管空树在扩展协议前仍显示未观测，不能把两端此项验收写为完成。自动数字修订/人民币补算仍是下一增量，本批只保留证据、原归属和明确缺口。

定向验证：账本与统计/来源路由、驱动 reader 边界及协商 45/0；合同/正式页面 Dialog 23/0；真实 Runner WS 命令到 Driver 接线、业务协商与驱动生命周期 35/0；补充账本重复位置/错根/多原归属后 9/0。中间静态检查两次定位到测试品牌类型和字面量类型，已修为 schema.parse/字面量；当前 arch/lint/backend type/console type 通过。迁移新增 0011 入锁，业务合同金样无差异。完整候选门禁、实现门、发布 CI 和部署仍待收口。

实现门首轮发现并修正三项功能阻断：pending 未等日志落盘、CLI/ManagedAgent 外层同步队列未传导背压、10001 receivedSteps 上限阻断整页。新增真实三层链路/业务工厂/SQLite 日志回归先红后绿，覆盖两轮 spawn 屏障、日志失败/取消、5 MiB 以上恢复证据慢消费后正常退出、队列提前返回；驱动/监督器 39/0、含10001记录账本10/0、最新结构/lint/双类型通过。最终独立复审与完整候选门禁待完成。

最终证明也等待三层处理回执，避免队列临界容量下业务终态溢出；暂停最终证明消费的真实流水线回归先红后绿。当前组合40/0、165断言；最终独立静态功能门 PASS。本结论不等于全部 RFC 或真实 OpenCode 实机验收完成。

完整候选门禁（2026-09-29）：`bun run check` 通过，4150 pass、142 skip、0 fail、26362 断言，835 文件，651.36 秒；需要已授权真实环境的用例保持 skip，不作为实机证据。候选53路径哈希与门禁开始时一致。正式代码只读预览已验证中英文、3轮选择、Esc回到泳道按钮、390px弹窗无横向溢出及1280px标准16px卡片间距；预览为合成数值，正式登录/真实模型验收另行记录。发布与本机升级继续。

## 6. 本批发布和本机部署

实现提交 `6b5a7355e899fe5ca7b1eb8b2c2cf2f9434cdc7e` 已推送，推后 main/origin 0/0。精确 CI [36496556715](https://github.com/wangbinquan/CrewStation/actions/runs/36496556715) 六项全部 success（含 gate 和实机 e2e）。在主 checkout 对这个已提交 SHA 使用 git archive 提供构建上下文，三个镜像均带相同 OCI revision，未包含之后的在制品。

已通过存储合同1预检，`rfc034-native-migrate-6b5a7355` 成功执行唯一新增迁移 `observability/0011_native_captures.sql`。2026-09-28T23:22:45.779Z 八个平台 Deployment 全部 rollout 成功，随后核对 observedGeneration==generation 且 readyReplicas==replicas==1。console digest `sha256:02df9889599ec074c2dafde9bfa9d5aeeeeb50b61ba68b5bd077e678e2fb86d4`，控制面 digest `sha256:3bd9be51374c320c4de2902ffc56e9947374ee402e46933ef10a0d99e1f47c61`；新任务底座为 `registry.crewstation-system.svc.cluster.local:5000/crewstation/task-runtime@sha256:7b56494dc379e0de8a18aba1ae0e3d7cc16dd398eda9f162fdff3067e8419380`。

部署只更改上述八服务的容器镜像和 CS_TASK_IMAGE；已固定 digest 的既有算力档位仍使用其原镜像，旧 Runner 保持显式能力降级，不将底座发布称为所有既有执行已启用新采集。登录入口 HTTP 200；正式管理员浏览器身份授权仍待回复，没有自动登录。正式代码只读夹具新增项目详情验收：键盘进入统一泳道弹窗，费用未开放时保持隐藏，采集详情可见，Esc 返回原按钮；临时预览进程均已停止。这些预览不替代真实任务运行验收。
