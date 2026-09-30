# RFC-034 开发数字布局与工作负载保护的渲染兼容

状态：限定设计v2与实现v2独立门均PASS；设计首轮许可Secret认领P2、实现首轮Kubernetes默认字段P2均有稳定回归修复；生产开发采集OFF。渲染批次设计基线24d91bdc，当前本机b9508486；历史3480032c与d3acac1f回执保留。承接[完整清理接入规划](./development-cleanup.md)。本渲染候选仅负责共同对象构造、严格原选择解析与旧直接writer禁止降级；后续[实际准入批次](./development-workload-admission.md)已落地原开发消费者登记、Pod绑定和许可接续并部署，完整数字清理、所有物理入口和producer仍待接通，不能把渲染兼容或实际准入视为已完成保护链。

## 已有阻断与本候选边界

基线24d91bdc的cluster-control/workloadRenderOf和workloadPodObject拒绝developmentUsageStorage与consumer共存，而工作负载停止保护的init/finalizer已有真实PG消费者和UID许可合同。task-runtime的对象构造只渲染两个私有日志卷，原direct writer拒绝任何initContainer，也没有消费者register/grantStart的端口。本候选不向该旧writer偷偷补一个空保护或绕过许可；新保护选择在其第一次K8s读取、Secret/Pod写入及环境材料回调之前明确拒绝。旧无该选择的直接数字布局和其他用途保持原行为。

本候选不增加CreateNativeExecutionInput、HTTP字段、producer调用或新表/迁移，因此没有新活动环境被选中。两个创建通路的共同对象构造均可产生一致受保护规格；共同parser/对象构造可以解析这一渲染形状，但实际resources register/grantStart的guard目前只接受business-workspace及taskStorage工作卷，尚不接受开发父环境；ledger和direct的实际受理都需另一个冻结候选接通原开发归属、PVC确认、消费者准入及持久恢复。旧direct writer仍明确拒绝新选择。该差异必须留在后续清单，不宣称两条实际启动路径完成。

## 不可变形状与严格解析

task-runtime私有WorkloadRender新增显式developmentUsageProtection: {version:1}。它只表示新选择，不自动从developmentUsageStorage推断，缺省的旧记录不升级；version未知、null、额外字段、无数字布局、非独立开发Agent、terminalId、业务布局/completionPolicy、缺固定算力修订/原父Pod/PVC/节点/consumer身份或非正整数renderStart均拒绝。

domain/development/protection声明纯函数，只读取实际同一TaskEnvironment，解析已有TaskId/Profile/ConsumerIntent合同；返回原consumer id、原parent task、renderStart、purpose=agent、finalization=null及原native.pvcUid。它不导入ports、不读当前目录、不注册/授予许可、不证明数字排空/实际退出/Token零。由ledgerProjection和taskObjects调用同一纯函数，防止两端自行猜测原选择。

台账pod同时携带明确保护选择、同consumer、expectedVolumeUid=原native.pvcUid，以及已有workspace原Pod/PVC/节点和workspace-task归属标签。新选择同时将原`${podName}-admission` Secret列入children/claim，包括共同对象构造对应的两种投影分支；旧未选children不变。原父Pod/PVC采用既有工作负载合同的真实UUID身份，独立算力/Agent/任务采用现有规范资源ID，不接受缺字段或相互冲突。cluster-control解析必须核对consumer的agent用途、parent task与workspace-task标签、null finalization及expectedVolumeUid与workspace.pvcUid一致。旧数字布局夹带consumer而没有新明确选择仍拒绝；显式选择缺任一保护字段不渲染。developmentUsageStorage/journal/protocol及actual layout查询v1均不改，不用现有selected查询宣称完整保护。

## 共同对象构造

把现有workloadGate的纯protectWorkloadPod/assertWorkloadGate及相同递归子集比较下沉至@crewstation/k8s，不搬迁节点探测、实际启动许可或停止控制。cluster-control保留既有导出与inspect/activate语义，复用共享实现；已有business/archive保护保持同样输出和校验。

共享构造保留UID downward binding、无work挂载的第一workload-admission init、受原Pod UID的Secret、原consumer/PVC注解、WorkloadStop finalizer、关闭ServiceAccount自动挂载和两个disk emptyDir。taskObjects根据明确新选择和冻结native PVC提供构造数据，保护注解与原native intent可以共存。对象构造本身不证明register/grantStart已提交；writer端不能据此启动。

## 精确候选路径

候选源码/测试共16路径，不收编并行资源/项目删除WIP：

- packages/k8s/objects/coverage.ts（新）及workloadAdmission.ts（新）、workloadAdmission.test.ts（新），packages/k8s/index.ts。
- modules/cluster-control/adapters/k8s/coverage.ts、safety/workloadGate.ts、workloadObjects.ts及workloadObjects.test.ts。
- modules/cluster-control/domain/workloadRender.ts及workloadRender.test.ts。
- modules/task-runtime/domain/taskEnvironment.ts、development/protection.ts（新）、ledgerProjection.ts。
- modules/task-runtime/adapters/k8s/taskObjects.ts、nativeExecutions.ts。
- modules/task-runtime/tests/developmentUsageProtection.test.ts（新）。

源码开始前冻结各路径原字节指纹、新路径不存在与相关参考源码；设计门PASS后实现，独立实现门前重新冻结成品。函数80行、生产文件600行、目录20个源码文件的限制遵守，按概念归入已有objects及development组。不引入跨模块内部import。

## 有意义的反例与后续退出条件

相关回归覆盖真正的workloadRenderOf→workloadPodObject及taskObjects→共享assert路径：原字段和双私有卷都保留，唯一第一init不挂work，原parent/PVC/consumer/修订不漂移，欠缺/未知/冲突明确拒绝；共同比较沿用数组长度、API默认字段与NetworkPolicy严格比较既有语义。旧业务/archive/init金样和未选开发/CLI行为保持。

孤儿回归用task-runtime实际projectEnvironment的children，经resources真实隔离PG公开owner登记，并通过cluster-control公开createClusterControlModule/observer驱动真实sweep；过宽限的许可Secret仍被claim，旁边未登记的旧Secret按UID被删除。用例不跨模块私有import、不弱化既有孤儿规则；只因Pod引用而保留不足以通过本回归。

额外断言新选择进入旧direct prepare时K8s读写及values回调均为0，并证明旧direct数字布局仍真实创建及重读原Pod/Secret。不能删除或弱化既有invalid-consumer回归，也不能用测试直接grant或伪造零作为生产许可。

本候选没有实际cleanup许可；consumer估值不成为Pod回收前提的两级ACK规划继续遵守。接续候选必须同时完成实际受理固定选择、原消费者register/grantStart、direct持久恢复、清理期数字复制与所有删除入口，再装配producer。未绑定结束、事实/UI及获准的真实验收继续，CS-R02和两个RFC保持In Progress。

## 首轮设计门修订记录

首轮只读门23/23指纹未变、5新路径仍不存在，发现1项P2：新选择不带completionPolicy，原ledgerProjection仅该策略将启动许可Secret列入children，带task标签的许可Secret会被现有orphanSweep判断为未认领并按UID删除。现将新选择的许可Secret登记及实际投影→PG claim→公开observer孤儿回归列入同一16路径候选。首轮FAIL保留；未知Token、物理停止、清理与实际创建许可均未因本修订获得证明。

## 2026-10-01 限定实现与验证回执

实际16个源码/测试路径已落实：两个创建通路复用纯保护规格；新选择严格核对原任务/父任务/Agent/算力修订、PVC/父Pod UID/节点/启动修订，业务工作卷或重建混入也拒绝。两种投影都登记admission Secret；公开resources隔离PG登记和公开controller的实际孤儿删除回执证明原Secret保留、未认领旧Secret按UID删除。旧直接数字writer仍能创建及重读原实例，新保护选择在读写/values之前拒绝。

首次回归13pass/7fail稳定复现旧缺口。首轮实现复核指出真实API会给UID fieldRef补apiVersion=v1；新增回归在生产字节未变时4pass/1fail，保留原FAIL。共享校验现在仅规范化省略或合法v1，Runner与第一init均拒绝v2、错误path、字面值和混合来源；[Kubernetes字段合同](https://kubernetes.io/docs/reference/kubernetes-api/core/pod-v1/#ObjectFieldSelector)直接支持该默认行为。最终实现门28/28指纹一致、限定PASS。最终相关55pass/0fail/0skip、412断言/10文件（CS_TEST_REQUIRE=database），16路径lint与后端类型通过。

唯一完整候选检查已完成，完整2fail及结构14项外部违规原样保留，外部变化后的两文件30pass定向闭环见下节。本批尚未提交/推送/部署，当前本机仍3480032c。producer OFF，sourceScope=business-tasks；完整direct受理/原consumer持久准入、数字清理/复制、所有回收旁路和两级开发事实/UI继续。

现有真实Pod只读核对匹配1个UID引用，fieldRef.apiVersion=v1、fieldPath=metadata.uid；未创建开发资源或调用模型，该证据不代表新producer验收。

## 2026-10-01 单次完整检查与外部定向闭环

完整五组件于2026-09-30T20:06:11.436315Z结束，958.36秒；lint、后端及控制台类型通过，实际4640pass/143skip/2fail、30318断言、927文件。本批16路径首尾指纹一致。结构14项违规及两项用例失败均指向并行events的0006_project_deletion_fences.sql归属解析/迁移登记；完整aggregate=1原回执保留，不改写为全量绿色。

原开发随后修改迁移并完成登记；只定向运行原结构规则和平台真实隔离PG迁移清单两个文件，2026-09-30T20:08:37.676464Z得到30pass/0fail、45断言。本批源码16路径和外部4依据在定向检查前后均未变，没有重复完整门禁、提交或删改并行文件。依据开发规则§3与用户单次候选规则，限定设计/实现审阅及55相关回归仍有效，按自有20路径准备发布；候选自身hosted CI与本机部署另记，当前本机仍3480032c，生产OFF。

## 2026-10-01 精确发布、CI与本机部署

限定20路径已提交并推送`d3acac1fe0daab77e1ce741604f9e77131f943a4`，主干与origin同步、共享索引为空；[自身CI36771444783](https://github.com/wangbinquan/CrewStation/actions/runs/36771444783)的static/unit/module/console/e2e/gate六项全部completed/success。提交保留了完整门禁2项外部失败及后续定向闭环历史，没有将其改写为本地全量绿色。

已批准的本机部署于2026-09-30T20:33:55.504Z完成；先保存私有平台数据库备份，再按storage-contract=1预检和不可变摘要绑定逐个升级八组件。实际迁移Job `rfc034-development-protection-migrate-d3acac1f`（UID `e87928ac-2059-4d0e-9185-698fb0da42a0`）Complete，原日志`migrations done`确认applied=0。三镜像源码revision均为d3acac1f：console摘要`ca399561cdecbb87923ebd7e133b513634629c83de0d2192c28d2be07f3efa87`，control-plane摘要`2d9371e904de6157922e0af1e65d65b775542bac886d6ccc353ffa9b1277ace8`，task-runtime摘要`b229e919f43ea5d5e283f474dad1c5fa2b7792f264fa5986c90dad53c77454b0`；默认Runner核为最后一个摘要。

2026-09-30T20:37:32.936952Z只读复核：八组件Ready=1且generation=observedGeneration（console210、api204、auth102、controller169、events72、session121、mcp-capabilities68、mcp-operations68）；公开`console.cs.localhost/auth/login`为200，未登录根为401。没有切换真实身份、调用模型或创建/结束真实开发验证资源。

接续源码检查确认resources实际准入guard仍是business-workspace/taskStorage范围，不能由纯渲染PASS推出开发ledger启动已可用；上文边界已纠正。producer保持OFF、sourceScope=business-tasks；下一批接通开发实际归属/PVC消费者准入和direct持久恢复，再落实数字复制、全部清理入口、production消费和两级事实/UI。CS-R02及两个RFC保持In Progress。

### 2026-10-01 原消费者准入实现候选

[开发工作负载准入](./development-workload-admission.md)已在未发布候选中接通：实际resources消费者注册/许可、ledger与native原Pod绑定、原父所属PVC、事务内实际作业租约核验。64项相关回归通过；完整候选审查/门禁及发布部署待完成。这里不是已部署保护能力或生产采集开启的证据，完整数字清理屏障仍继续。

当前准入候选v2完整限定实现门PASS，公开controller清理保留也已有实际组合证据。唯一完整门禁原aggregate=1及并行18失败完整保留；30源码稳定、相关64项均通过，精确lint和参考兼容门通过。按共享在制规则继续自有精确发布，不把外部失败改为全量成功。生产OFF和完整数字清理/消费/UI未闭环边界保持。


## 2026-10-01 实际开发工作卷准入的精确发布与部署

- 精确源码：`b9508486d94fb3bbcaa460dc03dcc697d877b37d`，33条自有路径提交并推送；推前后main/origin均0/0、共享索引为空，未提交并行events/identity/gateway/platform/迁移/共享登记。独立最终实现与发布复核PASS，原绑定恢复和pinnedVolume owner反例失败历史保留。
- [精确CI36790207172](https://github.com/wangbinquan/CrewStation/actions/runs/36790207172)终态success：static、unit、module、console、gate、e2e六项全部成功。原单次本机全量4659pass/143skip/18外部fail、aggregate=1仍保留；同次10个相关文件64pass/0fail/0skip，30源码指纹一致。提交前精确lint通过，后续7条外部类型错误未收编或篡改，不将本机全量改写成绿色。
- 部署前逐个读取当前OCI实际源码：console/control-plane为333e631d、默认Runner为d3acac1f，均证实为本次源码祖先；升级保留另一会话已部署输出。完成时间`2026-09-30T23:33:28.986Z`（北京时间10-01 07:33:28.986）。八组件generation=observedGeneration且Ready=1：console 213、cs-api 207、cs-auth 105、cs-controller 172、cs-events 75、cs-session 124、mcp-capabilities 71、mcp-operations 71。storage-contract=1；原owner/Session数字表存在。
- 迁移Job `rfc034-development-workload-admission-migrate-b9508486`，UID `02d761f6-6102-40aa-902c-1014584cfe19`，Complete，实际日志applied=0、roles.initialized=0。部署前私有数据库备份42873542字节、SHA256 `fa8dfd53ce7a956d9c2f69187a6dcd1df3c1dc45a036e201be4b2651e5a7122c`；不将备份或启动材料提交入库。
- 实际镜像：console `90b63ef20114c9748b84a07eab168b776c1d1390c867b3082a2157497b1f2eb1`；control-plane `159a1469fedb96d92d22912833078a7c928f5fb1226733cfcdba9b6be07664fe`；默认Runner `e7b0153ee23280606b90f88f6cf198543f1fb8d467e13f904c089d0f2cdd6da4`。三镜像OCI revision及默认Runner内容源码均核对为完整b9508486提交，部署固定到摘要。
- 公开只读验收`2026-09-30T23:34:31.149611+00:00`：console.cs.localhost/auth/login HTTP200、未登录根HTTP401，八组件与三个摘要全部对拍。没有身份切换、真实模型/开发验证资源创建或结束、旧会话/固定算力Runner重建。
- 边界：实际ledger/native开发消费者注册、原Pod绑定与持久许可接续已部署；生产开发数字producer仍OFF。完整数字清理、全部物理入口、观测消费和项目/系统两级开发明细、真实身份/模型及AW联合验收继续，CS-R02和两RFC不关闭。下一批[数字清理实施细化](./development-cleanup.md#2026-10-01-实际数字清理候选的实施细化设计候选尚未实现)仅原bound出口设计PASS，不能当成源码实现或producer开启许可。
