# RFC-034 后续：旧 CLI 与旧 Agent 的父退出封口

目标是修复已确认的两个新执行入口，保持开发观测 producer OFF。此候选不声明全 writer/inflight 或未知尾部已闭合。

## 现有事实

37e1f5aaa8acfb64fec43d356ef35f1ed2c9e234 的父退出受理在原 Project 锁下固定所有成员并写 parentEnding，保留 parent.state=running/connected。assertDevelopmentParentAdmission 对 marker 的存在即拒绝新准入，包括非法和 complete 历史 epoch。当前旧 createNativeExecutionUseCase 仅验证 running/connected，未核验这个 marker；旧 queued 准备同样没有 guard。两条路径都已在同一个 Project 锁事务中执行外部材料读取/准备及写入，父退出正确路径使用同一锁。

已选中保护的独立 Agent 仍走 createDevelopmentWorkload/prepareDevelopmentWorkload。旧 CLI 诊断重连的单独 existing-legacy-connection 分支仍仅用于原运行 CLI 的 Runner 回调，不可用于此候选。

## 改动范围与顺序

1. application/nativeExecution.ts 复用 development/parent/admission.ts 的 assertDevelopmentWriter。旧新创建在读取 fresh parent 并验证现有 kind/state/connected 后、外部材料及额度/insert/enqueue 前捕获原父 witness；读取 workspace 后、额度与 insert 前按同一 witness 再验证。已有 ID 的一致请求依旧先返回历史记录，不补新 Job 或额度；不一致配置继续 conflict。business/subtask 的原流程保持，helper 对非开发父返回 undefined。
2. 同文件 prepareNativeExecution，在原 scope 已持有 Project 锁的前提下对 fresh queued child 捕获 witness，在 nativeCluster.prepare、后置 workspace/heartbeat 核验后、任何 token/UID/starting/startup 写入前再次核验。marker/原 epoch/parent UID 或 immutable render 变化均拒绝。保持原 physical workspace 前后检查，不能以 guard 替代原 Pod/PVC/node 证据。
3. 不增加诊断例外到 mutation 操作，不修改 cleanupNativeExecution、固定成员排水、worker 的持久错误恢复、额度释放或既有证据协议。prepare 的 precondition 会由原 worker 转入已受理 child 的 cleaning 排水；此操作不是新准入。SOURCE 和测试需验证该实际恢复不会新增物理对象、token/UID 或启动授权。
4. 此处现有 Project 锁覆盖整个旧 I/O，退出受理只能在该事务完成后取得锁，因此不额外引入 writer lease 表。首次父 createEnvironment 的跨锁 I/O、其迟到 ACK/失败写回、Controller/Session/DevSession 等其他写入的封口仍是后续工作，不从本候选推导全 inflight 已封存。

## 真实入口验证

新增 developmentLegacyWriterSeal.test.ts，复用已登记的真实 PostgreSQL developmentWorkloadFixture/rebuildFixture、实际 Task API 与 Resources/queue，而不伪造成功 stop/usage 证明。

- 对 native 与 ledger 准入模式，先由实际保护 child 使父退出选中，再通过 releaseEnvironment 取得真实 parentEnding。对新的旧 CLI/旧 Agent 请求，必须 precondition，Task/Resources/Job 数目、占用和集群 create 均不增加；原父与现有成员保存。
- 在退出前先受理旧 queued child，再创建保护 child 并受理父退出。实际 native worker 处理 queued child 必须不执行 prepare/materials、不发布 token/UID/starting，允许原 cleaning 阶段排水，但不释放尚未实际停止的占用。
- 历史一致 replay 在封口后仍只读取原记录，不增任务/作业/额度；不一致 replay 仍 conflict。
- 正常未退出父仍可按原流程受理与准备旧 CLI/Agent，原 hash/UID/workspace 规则保持。现有 nativeExecutions、agentExecutions、nativeExecutionFailures、legacyDevelopmentConnection 和 parentEnding 套件必须通过。
- 明确覆盖非法 marker presence、complete 旧 epoch、父 identity/maintenance malformed、准备前 workspace 改变、准备后 witness 漂移的拒绝边界；使用已有 guard 的领域套件证明，不为本变更添加复制实现的孤立单测。

## 门禁与发布

必须先独立 DESIGN PASS，然后落地正式 RFC 文档与代码，限定真实 DB 测试、类型/lint/结构和改动行覆盖通过，再独立 SOURCE 审查。新的完整仓库门禁只对这次变化后的联合候选执行一次；与 runtime owner 明确交接的 25 路径及仅追加一个条目的 215 项迁移锁一并冻结，保留全部当前内容，不把上一批 201 路径原始门禁改写成这批证据。

共享 main 只按明确路径提交，完整共享文件包含并行输出时写清交接；暂存区必须为空或全部条目明确属于同一提交。精确远端 CI 终态成功后才进行该提交的本机部署。当前已经发布的 37e1f5aa 和正在部署的镜像不包含后续新候选。

RFC-034 仍 In Progress；development producer 仍 OFF，真实 CLI/开发/自测以及剩余全景验收继续。

## 当前状态

2026-10-02：独立 DESIGN v27 审查通过，两个入口复用原父 witness 的代码已落地。实际 PostgreSQL/Public API/Resources/native queue 回归、SOURCE 和新联合候选门禁尚待完成；此记录不能视为已发布或 producer 开放。前一批 37e1f5aa 的六项精确远端 CI 成功和镜像构建属于前一批提交，不能替代本次代码的验证。

## 2026-10-02 清理占额的实际失败与 v28 修正

v27 的真实 PostgreSQL／Public API／Resources／native worker 六文件回归共 47 项，46 pass／1 fail／314 断言，候选与原数据库容器身份稳定。唯一失败是已封口父的旧 queued child 转入 cleaning 后，占额从 3 减至 2；原失败断言与日志完整保留，不能重复运行后改记为通过。

根因是旧 native cleaning 投影为 desired=absent，而既有 ReleasePending 只保护 developmentUsageProtection 或 businessStorage；子对象尚未观测时资源中心原规则据此判 stopped。新增 `domain/ledgerProjection.ts` 条件仅补没有上述选择的旧 native：cleaning 报 ReleasePending=true，其他 native 状态明确 false。既有 releaseOf／Controller 清理／UID 条件删除／工作卷停止证明／heartbeat／finished 写回均保持，未直接改阶段或额度。失败与重试保持 stopping 占额；原物理清理成功且已有对象消失观测完成后，按原阶段计数退额。

独立 DESIGN v28 已 PASS。原 47 项判据完整保留，并追加实际 worker 的读取失败与重试，以及实际 prepare／Runner 连接／已绑定对象的清理占额回归。后者即使 Task 已 finished，旧 Running／Present 台账观测仍占额；必须先读取实际 K8s 对象不存在，再通过原 Resources observe(gone=true) 逐项确认才能退额。该 fake K8s 故障夹具加真实 PG 的结果不代签生产集群验收。

修订代码已落地；新限定回归、静态、SOURCE 和 32 路径联合候选完整门禁仍待。32 项由本会话六路径、runtime owner 已明确交接的 25 路径与一个仅追加条目的共享迁移锁组成。37e1f5aa 的六项精确 CI 成功与 2026-10-02T14:54:18.280Z 本机八组件部署属于已发表前一批；实际 Pod 镜像来源和三项迁移已核，原数据库／任务运行器／项目资源身份保持。其镜像不包含本次新修订。

全 writer／inflight、未绑定／未知尾部、开发／CLI／自测 producer 接通和实际 Token 验收继续，producer OFF，RFC-034 保持 In Progress。

### v29 限定回归与静态结果

v28 新增已绑定用例首次运行因从公共 EnvironmentDto 读取私有 namespace 导致 Secret 查找失败；73 pass／1 fail／481 断言，类型检查也明确拒绝 DTO 的 namespace／runnerTokenHash 及 unknown parentEnding 的直接属性读取，原失败保留。夹具已改为公开受理后从原 Task owner 仓储读取真实行，指针用实际结构断言，不用类型强转或制造完成证明。

v29 八文件真实回归 74 pass／0 fail／501 断言，29.80 秒；三个生产／测试文件指纹与原 PostgreSQL 容器身份保持。原配额失败判据及全部旧用例保留；queued 和已绑定两项真实 worker 故障／重试与逐项消失观测均通过。限定 lint、后端类型及结构检查 exit=0，原占额条件和 guard 的代码已执行，源码复核／32 项联合候选完整门禁／新精确 CI／新 SHA 部署仍待。全 writer／inflight／unknown-tail 和 producer OFF 边界保持。

### 2026-10-03 联合 72 路径完整检查回执

独立 SOURCE v34 PASS 后，唯一新联合完整检查于 2026-10-02T19:50:02.806642Z 终态成功：结构、全仓 lint、后端/console 类型与测试均通过；5,325 pass、143 skip、0 fail、36,433 断言，5,468 测试/1,023 文件，测试 1,356.12 秒、完整命令 1,408.22 秒。72 候选和 105 引用首尾指纹相同，原授权 PostgreSQL 容器身份及 max_prepared_transactions=10 保持。原 v32 的平台镜像夹具两个 provenance 失败和 v31 固定页饥饿失败保留，分别经原修订/构建 fixture 与 handoff ID keyset 修正后验收，不删除断言或生产约束。

本批包括观测 12 路径、明确交接的 runtime-environment 25 路径、release 34 路径和最后提交的共享迁移锁 1 路径；platform 镜像来源 fixture 包含原 owner 的并行纠正，整份保留。两个新迁移 runtime-environment/0007 与 release/0009 的 SQL 和原 214 条锁记录保持，当前锁共 216 条。检查后只更新这四份观测回执文档，全部生产/测试/迁移内容不变，同内容不重复完整检查。

精确远端提交、该 SHA 的六项 CI、本机镜像/迁移/八组件部署待完成。开发 producer 保持 OFF；全 writer/inflight、未绑定/unknown-tail、真实开发/CLI/平台用途、AW 联合对拍、全部分析和规模验收继续，两个 RFC 保持 In Progress。143 跳过项不计为通过，本机仍为 37e1f5aa 的既有部署与原固定 Runner。
