# RFC-034 开发数字布局与工作负载保护的渲染兼容

状态：限定设计v2与实现v2独立门均PASS；设计首轮许可Secret认领P2、实现首轮Kubernetes默认字段P2均有稳定回归修复；生产开发采集OFF。基线24d91bdc，实际本机3480032c。承接[完整清理接入规划](./development-cleanup.md)，本候选只实现共同对象构造、严格原选择解析与旧直接writer禁止降级；完整实际受理、许可激活、所有清理和producer仍在后续接线，不能把渲染兼容视为已完成保护链。

## 已有阻断与本候选边界

基线24d91bdc的cluster-control/workloadRenderOf和workloadPodObject拒绝developmentUsageStorage与consumer共存，而工作负载停止保护的init/finalizer已有真实PG消费者和UID许可合同。task-runtime的对象构造只渲染两个私有日志卷，原direct writer拒绝任何initContainer，也没有消费者register/grantStart的端口。本候选不向该旧writer偷偷补一个空保护或绕过许可；新保护选择在其第一次K8s读取、Secret/Pod写入及环境材料回调之前明确拒绝。旧无该选择的直接数字布局和其他用途保持原行为。

本候选不增加CreateNativeExecutionInput、HTTP字段、producer调用或新表/迁移，因此没有新活动环境被选中。两个创建通路的共同对象构造均可产生一致受保护规格；当前ledger既有register→create→原Pod permit→activate链可以消费这一渲染形状，direct实际创建仍明确不可用，需另一个冻结候选接通原消费者准入及持久恢复后才可受理。该差异必须留在后续清单，不宣称两条实际启动路径完成。

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
