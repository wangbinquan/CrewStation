# RFC-034 新选择的原准入 Secret UID 回执

状态：CS-R02 原准入 Secret UID 回执第一步已实现、推送、精确 CI 通过并部署，完整回执见本文末节。v1 设计 FAIL 的 P2 与后续修正历史保留；生产开发 producer 继续 OFF。本步骤不完成跨进程 unknown receipt、通用删除、全 writer seal、未绑定或 unknown-tail 出口。

## 要求与当前基线

要求来自原 RFC 的原执行归属及清理屏障：数字许可、原物理材料和全部容器停止分别验证；不删除同名替换物，不凭未知补零。当前 Task 已持久原 Pod 与 Runner Secret UID；准入 Secret 只按四元许可（Pod UID、Node UID、consumer ID、PVC UID）及当前读取 UID/CAS 验证。这是旧批准路径，不改写为历史 UID 已保存，也不追加新要求使旧成功分支失败。

基线：两条 Pod 创建路径都先在 Resources 注册原 consumer。ledger 路由由 Controller 创建 Pod 并由 Task.bindWorkload 持久 Pod/Runner UID；direct 路由由 Task native creator 创建并持久这两类 UID。两路准入 Secret 均由 Controller 在 grantStart 提交后创建，Task.prepare 和初次 bindWorkload 此时尚不知道准入 Secret UID，不能虚构或提前绑定。

## 本阶段建议及精确行为

1. 新私有显式选择为 `developmentRemovalProtection: {version: 1}`。它只允许与原 developmentUsageStorage/protection 一起受理独立开发 Agent，不能用于 CLI、算力测试、业务任务或已有执行升级。新标记只有实际提交时才进入 CreateNative request hash；缺字段的旧请求保持原 JSON 键集合和 hash，不新增 null 键。选择保存在原 Task render，随后经既有 protection 投影进入 Resources 原工作负载期望。旧保存的 render 没有该字段，保持旧行为；没有生产 caller 在本阶段选择它。
2. Resources 在首次 register 成功的同一存储任务事务中，依据自身原 owner/parent/volume 已验证记录，固定 `developmentAdmission = {version: 1, intentHash, secretUid: null}`。intentHash 是原生执行的 canonical intent。新增 nullable JSON 列；旧行 null，注册重放不得把当前目录或当前对象回填为新选择。新状态只在已选行返回，不改变旧 get/list 的对象形状。
3. Controller 将持久的原选择交给 activateWorkload。新选分支在首次 create 返回后，验证实际 Secret 的 UUID、name/namespace、immutable、归属与全部四元许可，才返回真实创建 UID。Controller 在 Kubernetes I/O 结束后以公开 WorkloadSafety.bindDevelopmentAdmission 持久它。外部 API 调用者不能签发回执。Resources 在自己的事务锁内只绑定原已选 consumer/permit 的第一个 UID；同 UID 重放相等，不同 UID 冲突；关闭准入后的原创建回执可补交，但不重开 admission 或改变 startPermit。
4. 重试已有持久 UID 时，只接受实际 Secret 的原 UID 和原完整材料。原 UID 对象缺失时不能 recreate；同名、相同内容的新 UID 不可借原回执。显式已选但 owner capability/state/实际创建 UID 缺失时等待。旧分支保留当前四元许可及当前 UID/CAS 规则。
5. Task 新选清理在每次原 job fence 外核对 Resources 的原 consumer、permit、intent 和持久 Secret UID，未取得回执之前不发 Pod 删除意图，也不删任一 Secret、不转 Runner token、不释放额度。全部独立容器停止后，准入 Secret 删除额外核对该历史 UID，仍用 UID precondition 并等待实际缺失。原清理选择哈希自然包含新 render 标记；所有 Session/Resources/Kubernetes I/O 留在项目事务外。

## 创建回执丢失与失败恢复

若原 create 成功且实际响应已知，但 PG 提交/ACK 失败，同一个 kubernetesClusterWriter 实例必须保留完整原回执，只有 Resources 的原 receipt CAS 成功确认后才清除；已提交同值幂等，关闭 admission 不抹掉原证据。不能只把 UID 放在 activation 的栈局部变量，然后期待重新 activation 恢复它。若实际创建响应彻底丢失，重试只发现同名对象且没有任何原 UID 回执，本步骤保持 pending，保存原对象、材料和占用，禁止按相同四元许可倒填历史 UID。只有持有实际创建响应的可信重投才能完成本步骤；跨进程不可取回的创建回执恢复、通用删除和全 writer seal 由后续屏障批次处理，不能以查询超时/对象存在宣称恢复或完成。

Controller 在首次创建到回执落盘之间发生准入关闭，仍保存原实际 UID 作为证据，不重开许可；未来全部 writer/在途创建 seal 另行覆盖迟到创建窗口。这个字段不是无 writer 或停止证明。当前生产 producer OFF，不把本阶段的新选择投放生产。

## v1 P2 的同 creator 回执恢复

原 v1 FAIL 保留，不把跨进程回执彻底丢失与同进程已收到的真实 UID 混为一类。恢复步骤限定如下：

1. 每个 `kubernetesClusterWriter` 在适配器中持有自己的有界待交回执容器，容量 128，包含未完成的首次创建 reservation 与已验证实际响应。新选 create 前先预留，满额在 Kubernetes create 之前拒绝；不能挤掉、过期清掉或改写仍未确认的原回执。同一原 consumer/permit/intent/material 身份的并发调用合并 in-flight，身份不同不能覆盖。仅保存原 record ID、consumer、permit、canonical intent、name/namespace 与真实创建 UID 等回执元数据，不保存 Runner token 或 Secret 内容。新响应通过全部原材料校验后，必须先进入该容器，再返回调用方。
2. `ClusterWriter` 提供可选的 `pendingDevelopmentAdmissionReceipts()` 与精确 `acknowledgeDevelopmentAdmissionReceipt(receipt)`，用于新选择；旧 writer 没有此能力仍保持旧行为。列表返回不可变的原回执快照；ACK 只匹配该原身份与 UID。`reconcileWorkloadAdmission` 首次提交成功后确认，同 UID 的提交结果丢失则保留并重放；无可信实际创建 UID 的 reservation 不得伪装成待交成功回执。
3. 在公共 `reconcileRecord` 的第一步、读取 ledger 及所有 Failed/Paused/ReleasePending/desired-absent 早退之前，调用独立 replay helper，按原 record ID 仅补交这个 creator 已保留的实际回执。它只调用原 Resources `bindDevelopmentAdmission` 与成功 ACK，不执行 get/create Secret、inspect/grant、重新启动或 reopen。即使 ledger 记录已缺失、原 Pod/父工作区正在退出，也先保存仍可核验的原 evidence；缺 Resources capability、PG 失败或 CAS 冲突时保留待交项并抛出，不能假成功或继续清除它。
4. 现有工作队列对失败按 1 秒起步、最多 5 分钟退避重试；补交在公共入口，下一轮不因已关闭而跳过。为同 writer 的 stop/start 和已不在 listLive 的 record，ledgerReconciler 的启动/原 resync 再把有限 pending record IDs 排进相同去重队列。只增加可选 IDs supplier，由 cluster-control 自己的 wiring 接入该实例；不需要修改并行的根 platform/wiring，也不新增轮询计时器。
5. PG 成功确认前回执不可回收；确认丢失时下一次 same-UID CAS 仍幂等。新 writer/进程没有原实际响应，只看到同名同内容对象仍 pending，不从对象列表或目录采用当前 UID。跨进程不可恢复的 unknown receipt、全 writer/在途创建 seal 与通用清理出口仍由后续完整屏障批次覆盖。本步骤未接入生产 caller，不能据此宣称所有删除入口已经受保护。

适配器的有界容器单独放在 `adapters/k8s/safety/developmentAdmissionReceipts.ts`，原真实创建/UID 检验留在 `developmentAdmission.ts`；application 的纯补交编排放在 `application/development/admissionReceipts.ts`。扩展公共调和入口、worker 可选 supplier 和该模块 wiring，并补对应专用测试；所有新增文件遵循 600/1000 行、80 行函数及每目录 20 项上限。

真实回归须经过原 Controller/Kubernetes 及公开 Resources 调用链：create(U) 后 PG 提交前失败，随后 closure/ReleasePending/记录缺失时同实例仅重交 U、create 次数仍 1、准入保持关闭；PG 已提交但确认丢失时重复 CAS 同值；queue 失败退避与同 writer stop/start 的 pending ID resync；第 129 项在 create 前拒绝且前 128 项没有被挤掉；新 writer 无原响应时同名克隆不可回填。回执重投不能依赖重新 inspect/grant 成功。全部既有未选择路径的准入及 Task 清理断言保留。

共享迁移锁已被并行会话修改，当前输出保留。设计只登记本模块新 migration 的精确路径；实现时通过官方精确路径命令登记，保持全部并行条目。源码发布前须由对应 owner 提交锁中依赖的并行 migration，或确认完整关联快照已可发布；不能为本批扫入 RFC-036/037 未提交依赖，也不能删掉其锁记录。这个共享发布前提不阻止四份观测文档及独立的本阶段源码开发。

## 验证及发布边界

真实隔离 PostgreSQL 验证首次选择、旧 null shape、重启读取、同 UID 幂等、异 UID 冲突、准入关闭后的实际回执保存和异常事务回滚。Controller/Kubernetes fixture 验证新实际 create 返回材料、原 UID 重放、同名克隆/缺回执/对象缺失不借用，以及 ledger/direct 的同一真实 creator 链。Task 持久 job fixture 验证回执缺失时数字许可存在也不删 Pod、不轮换令牌或释放额度；停止后同名准入 Secret 克隆保持，原 Secret 以原 UID 回收。旧准入例外所有回归继续。

每批冻结精确候选和必要公开参考后独立设计/实施复核，不吸收 RFC-036/037、data-control 或共享 STATE 的在制品。一次全本机 gate 仅覆盖稳定候选，并以该提交的全 hosted CI 和本机部署回执分别证明发布。本步不能关闭 CS-R02 或两个 RFC。


## v2 独立设计复核与共享前置条件（2026-10-01）

独立设计 v2 结论 PASS，无新增功能阻断；原 v1 唯一 P2 及 FAIL 回执保留。设计 manifest SHA256 `f81517850654f84957876bca52564a7b97af28950ce2c37c64c7b1742bcd9aea`，复核回执 SHA256 `8c8c1b715bd03973314c67c3c584ad68aedadc26ce6e77d02348c77573af690f`。4 份自有文档、42 个实现路径基线及 22 份必要参考首尾稳定；10 个新增源码路径尚不存在。复核期间并行提交推进 main 至 `b6999edf15ec81a43d42bd59c3fb80218b204af8`，3 份 foreign 文档指纹变化已记录，未读取或修改其内容。

共享迁移锁现已随该并行提交发布，工作树字节与 HEAD 相等（SHA256 `0b043aeb87d0e08ba9cfbd70c0f25e5a42e166f1f040971bc809676d68d98c2c`），原 owner 发布前提已满足。后续只用官方精确路径登记本步骤的 migration，并保留已有条目；本次文档提交不包含锁、共享 STATE/RFC 索引或其他 RFC 在制品。

PASS 仅准入限定 43 路径的下一步实现。它不代表实现门、定向回归、稳定候选完整检查、精确 SHA CI、本机部署或生产开启；开发 producer 仍 OFF，CS-R02 与两个 RFC 保持 In Progress。


## 原准入回执第一步的实际发布与部署（2026-10-01）

此前“尚无源码改动”属于设计阶段历史，现按实际源码、提交和部署补正，不重新实施已发布部分。42 个源码 / 测试 / 迁移路径及迁移登记已随分类 Token 组合提交 `542d98820606c4dbecbe07fe40aa9758c8d74c99` 的 70 路径发布；本批 42 文件当前字节与该提交一致，原 `0008_development_admission_receipts.sql` 在该提交的迁移锁中。并行 data-control 新迁移由其作者管理，不随本回执收编。

原准入实现最终独立 PASS（回执 `observability-cs-admission-implementation-review-final.json`，SHA256 `10d8bede8e5a7eb99327f461c8411e2182e8cb7ef811805a2578151090ad7637`）；70 路径组合修订独立 PASS（SHA256 `a949ce909f5a77317a3e28794b4f18693bab0cf3f1cf83e5de07be06f7c62047`）。同候选规范完整检查 4,886 pass / 143 skip / 0 fail / 0 error、32,692 断言、967 文件，70 路径和四个参考首尾一致；类型与原始失败历史详见 [分类验证回执](./token-classification.md#首轮完整门禁与修正)。不重复运行已经通过且未改变的源码完整门禁。

[该提交自身 CI 36861417182](https://github.com/wangbinquan/CrewStation/actions/runs/36861417182) 的 static、unit、module、console、e2e、gate 六项均正常 completed / success。2026-10-01T12:42:37.894Z 已本机部署，八组件 Ready=1、generation=observedGeneration，storage-contract=1；该次部署的节点镜像 OCI revision 独立核对为完整 `542d9882` 提交；后续平台自测修复已于 14:42:26.034Z 升级至 `85ee9254`，本批 42 个源码 / 测试字节保持。迁移完成、数字表存在，原平台默认 Runner 与现存工作负载保持。

已落实本步骤的新显式选择、Resources 首次原意图/nullable UID 固定、Controller 同 creator 有界实际回执与原 record 补交、CAS 后 ACK / pending IDs resync，以及 Task 新选清理的原 UID 核对。它们没有生产 caller 开启许可。跨进程原响应未知、全 writer/在途创建 seal、全部删除/重建/未绑定出口和真实开发生产采集仍待后续屏障；生产 producer OFF，CS-R02 和两个 RFC 不关闭。实际业务模型分类及人民币复验分别留回执，不能代替本步骤或完整开发矩阵的真实验收。
