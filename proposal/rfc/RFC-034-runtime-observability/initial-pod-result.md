# 初始 Pod 延迟回执与失败回写

状态：独立 DESIGN、限定实现、真实 PostgreSQL 回归、联合 SOURCE、完整检查、精确远端六项 CI 与本机部署均通过；完整 RFC 仍 In Progress，开发采集 producer 保持 OFF。

原创建在 Project 锁内准入后，在锁外建卷和 Pod；Runner 可能在 createPod 回执之前已经连接，甚至已有受保护 Agent，父结束流程也已固定成员。旧 ACK 只比较名称与令牌，旧失败分支直接写回准入快照，可能覆盖当前身份、状态、结束材料或额度。

`environmentCreation/initialPodResult.ts` 保留原集群调用顺序，只在短事务内持有原 Project 锁并读取同一 Executor 的 `getMaintenanceView`。原身份包括任务、项目、服务、用途、卷模式、命名空间、Pod/PVC 名、档位、标签、令牌摘要、重建身份与不可变 render；仅排除既有连接/初始化 deadline。Pod UID 单独比较。普通 mapper 不参与判定：无行、缺 reader、读取失败或原 JSONB 类型非法均不写，不回退 `getById`。

ACK 仅更新同一身份、仍为 creating/running、当前 UID 等于原 UID 或本次实际 ACK UID 的当前行；保留真实 Runner 及当前 startup，只完成仍在运行的 queue 阶段。当前已完全相同则不重复写入或投影。开发父的 `parentEnding` 任意存在都拒绝，包括非法值和完整旧 epoch。失败仅从仍未连接、仍为 creating、UID 未换代的当前行转 failed 并按原业务语义退额；事务失败写固定警告，外层仍抛原集群错误。实际暂停恢复的新创建正常绑定新 UID，第三个 UID 或旧 epoch 不能被迟到结果替换。

真实 PostgreSQL 专项共 39 pass / 0 fail / 148 断言、2 文件、15.50 秒，包含平台根镜像引用的两项已交接夹具修正。37 项初始 Pod 用例使用正式 Task/Resources 入口、实际 Runner token 与 UID、真实受保护子执行和父结束成员，以及既有 Controller/结束 worker 的实际保卷恢复发布。Kubernetes 只控制 ACK 时序，不将此夹具写成实机模型验收。render/native 的 JSONB null、false、标量、看似对象的 JSON string 和 array 在 ACK/失败两条路径均保持原始 presence/type/text、Task、Resources、Jobs 与额度。合法 SQL NULL、开发/业务/PROFILE_TEST 创建、暂停恢复、缺 reader/读错、非法结束 marker 和第三个 UID 均有专项断言。

后端类型、精确 lint、结构检查通过；官方改动行保护对 createEnvironment 与新 helper 为 44/44、100%。源与门禁记录冻结在 `observability-cs-initial-pod-validation-v1.json`，独立审核仍需针对最终联合候选完成，不能代签完整检查。

范围边界：旧 unbound 创建丢 ACK 且尚未连接时的失败/退款语义沿用原实现，不证明集群没有执行；持久启动授权、unknown-tail、全部 writer/inflight、CLI/自测采集与其余观测退出条件仍待完成。没有改通用 mapper、维护视图 adapter、ledgerResync、迁移或保护约束；完整 RFC 与 CS-R02 继续 In Progress。

### 2026-10-03 联合 72 路径完整检查回执

独立 SOURCE v34 PASS 后，唯一新联合完整检查于 2026-10-02T19:50:02.806642Z 终态成功：结构、全仓 lint、后端/console 类型与测试均通过；5,325 pass、143 skip、0 fail、36,433 断言，5,468 测试/1,023 文件，测试 1,356.12 秒、完整命令 1,408.22 秒。72 候选和 105 引用首尾指纹相同，原授权 PostgreSQL 容器身份及 max_prepared_transactions=10 保持。原 v32 的平台镜像夹具两个 provenance 失败和 v31 固定页饥饿失败保留，分别经原修订/构建 fixture 与 handoff ID keyset 修正后验收，不删除断言或生产约束。

本批包括观测 12 路径、明确交接的 runtime-environment 25 路径、release 34 路径和最后提交的共享迁移锁 1 路径；platform 镜像来源 fixture 包含原 owner 的并行纠正，整份保留。两个新迁移 runtime-environment/0007 与 release/0009 的 SQL 和原 214 条锁记录保持，当前锁共 216 条。检查后只更新这四份观测回执文档，全部生产/测试/迁移内容不变，同内容不重复完整检查。

精确远端提交、该 SHA 的六项 CI、本机镜像/迁移/八组件部署待完成。开发 producer 保持 OFF；全 writer/inflight、未绑定/unknown-tail、真实开发/CLI/平台用途、AW 联合对拍、全部分析和规模验收继续，两个 RFC 保持 In Progress。143 跳过项不计为通过，本机仍为 37e1f5aa 的既有部署与原固定 Runner。


### 2026-10-03 联合发布、精确 CI 与本机部署回执

观测 11 路径提交 `a6021a8832b963e8fe0dfe367c9fefa1257b9b51` 已包含在联合远端提交 `463f24d85b0e6edfc8fbf984758be3f2c585d400`，本地 main/origin/main 已核为一致。依交接顺序，owner 提交另外 61 路径，包含完整共享迁移锁、runtime/release 输出与保留并行纠正的 platform 镜像来源 fixture；没有移除其他会话的在制品。72 路径联合完整检查 5,325 pass／143 skip／0 fail 与 SOURCE v35 PASS 的生产、测试、迁移内容保持，本文只补回执，不重跑同内容完整门。

[精确 CI37060038342](https://github.com/wangbinquan/CrewStation/actions/runs/37060038342) 于 2026-10-02T20:31:05Z 全部终态成功：static、unit、module、console、gate、e2e 六项均 success。本机于 2026-10-02T20:34:54.250Z 完成此 SHA 的部署，八组件保留原 Deployment UID、generation=observedGeneration、Ready=1。已只读复核节点实际 OCI manifest/config 字节及摘要：control-plane `sha256:495313d740dee1a76bbdd0adaec0b0aca8e81110bb188ac3d5b540487955301f`、console `sha256:9fcfd35062a78d2f4e75e812df5fceb7f732912c4925a289d4587a93d21eaec2` 的 revision 均为上述完整源码 SHA。

迁移 Job `rfc037-migrate-463f24d85b0e` 完成，release/0009 与 runtime-environment/0007 已安装且 SQL checksum 匹配。原固定 Runner `sha256:587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928` 保持，实际 OCI storage-contract=1；原 PostgreSQL Pod/PVC/PV、数据库/角色、项目 Namespace/PV/PVC/Task Pod 和本机 native 容器身份、PID、启动时间及重启数保持，缺失列表为空。

私有证据：`observability-cs-463f24d85b0e-joint-ci-receipt-v1.json`、`cs-rfc037-463f24d85b0e-runtime-release-v1-deployment-receipt.json`、`observability-cs-463f24d85b0e-joint-live-deployment-verification-v1.json`。此回执只关闭该片的发布/部署步骤：没有创建新模型任务、没有切换真实身份。开发 producer 保持 OFF；全 writer/inflight、unbound/unknown-tail、真实开发/CLI/平台用途、AW 联合对拍、调用片段及全部统计退出条件继续，两 RFC 仍 In Progress；143 skip 不计通过。
