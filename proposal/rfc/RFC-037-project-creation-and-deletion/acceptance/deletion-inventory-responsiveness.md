# 原项目盘点的响应与取消修复

## 实机状态

`4e26b38f4bde7b3f701723a20d8ee9fdcb11627f` 的六项 hosted CI 成功，八组件与原生来源安装完成，五个正式 Root 已启用删除来源。创建弹窗已实机核对；正式域名按标识渲染，模板说明包含初始页面、API 示例和发布配置。2026-10-06 新鲜页面再次核对 `team-assistant.cs.localhost` 与 `preview.team-assistant.cs.localhost`，仅输入预览并取消，不创建资源。

原专用项目 `01a0f30b-c652-7000-8d6f-553e3b5f6135` 尚未受理删除，原数据库、仓库与项目资源保持。2026-10-05T23:47Z 前后实际 API 只读检查确认全平台删除操作数仍为0，旧长期读取事务已结束。不能将安装、入口启用或专项通过写成项目全部资源回收完成。

## 原故障与修复

- 原三模块的 JSON 键分页每页重新排序整个关系；真实PG的10001行反例读取52次。`packages/persistence/transactionPages.ts:8` 保持原事务及完整字节排序，最多500行用一次读取，较大关系用完整服务器游标读至EOF，最多两次关系扫描；不能用OFFSET衔接两个不同快照。嵌套读、异常、游标关闭和晚页损坏均有实际PG防护。
- `modules/provisioning/application/infrastructureInventory.ts:31` 的阻塞去重改用集合，保持原code和resourceId。确认一页已有无法解析的原归属后及时拒绝，未访问范围明确保持EOF=false。其他有效通道仍独立读尽；成功计划仍必须完整EOF。原207任务与205错误记录在拒绝后实际全部保持。
- `apps/console/src/features/projects/components/ProjectDeletionDialog.tsx` 允许在初次只读盘点期间关闭并恢复焦点与列表上下文；受理删除期间仍锁定两层确认。新增回归真实红记录在 `/private/tmp/cs-rfc037-loading-close-red-v2.log`，此前v1因测试提示文案不准确失败也保留。
- Probe 同时被常规存储巡检使用。SDK 仅等待严格识别的409忙碌响应，复用同一请求和原截止时间，不将忙碌或畸形冲突转为空清单。节点消费者读取沿用其已有60秒总预算，各页共用截止时间，未完成、换来源及永久不可读仍阻断。Bun1.3.13 移除超时信号的最后一个监听器会使后续等待丢失该超时，独立对照原件为 `/private/tmp/cs-rfc037-probe-read-timeout-listeners-v1.log`；`probeRead.ts` 在整个读取及忙碌等待期间保持取消观察，挂起正文与迟到回执也不越过取消。

## 本机证据及发布边界

原完整检查6175 pass／157 skip／0 fail只适用于4e26基线，不能借给本修复候选。候选完整检查排队后才运行；各排队等待器都在实际check启动前退出，未取消正在运行的完整门禁，也未因移动HEAD重复检查未变候选；另一会话的完整检查保留。v5因类型错误自然失败后修正实际候选，v7终态见下文。

- 原5秒预算的实际PG STOP组合：5 pass／0 fail，42断言，日志 `cs-rfc037-stop-original-budget-v2.log`。曾尝试15秒测试预算的改动已全部撤除，不发布。
- 弹窗/工作流/生命周期及节点来源：18 pass／0 fail，144断言，`cs-rfc037-loading-close-green-v1.log`。
- Probe 原读取、忙碌、取消与真实协议/文件清单：29 pass／0 fail，159断言，`cs-rfc037-probe-read-final-targeted-v2.log`。旧挂起记录、仅停止的自有单文件测试以及独立复现均保留。
- 基础设施真实PG与分页：8 pass／0 fail，96断言，`cs-rfc037-incomplete-inventory-fast-reject-final-v3.log`。旧v2因错误沿用“拒绝后所有通道仍EOF”的断言失败，原记录保留；修正后未读错误尾页保持不完整，独立有效事件仍208条EOF，不删除任何记录。

实机仍有约15万条全平台巡检历史；0008之前的metrics/storage原请求已过期，现行原归属规则会阻断。严格全平台任务合同的范围调整见 [待批准方案](../platform-maintenance-boundary.md)。本候选不实施该调整、不回填原来源、不放宽项目归属未知时的拒绝，也不将不完整盘点变为成功。

## 原标识误判与读取截止时间复核

正式只读查询 `cs-rfc037-current-alias-conflicts-readonly-v1.json` 限定到注册校验实际使用的类型，确认 dev-session 有1条 cluster-operation、task-runtime 有6条 rebuild 和29条 runner 的合法UUIDv4迁移别名。旧校验将所有UUID都当成当前身份，错误要求别名与UUIDv7原ID相同。三模块现在只对合同规定的完整小写UUIDv7执行当前身份冲突校验；合法旧别名保持，真实当前身份冲突仍拒绝。真实PG三组反例先红，修正后29 pass／0 fail、164断言，日志 `cs-rfc037-legacy-uuid-alias-green-v1.log`。

SDK独立复查还确认HTTP成功后的挂起正文没有执行原超时，消费者的409识别未拒绝附加字段。新反例 `cs-rfc037-probe-success-cancellation-red-v1.log` 留存；三SDK在整个读取期间保持截止时间观察，节点与Registry正文取消读取，消费者复用严格忙碌应答识别。最终专项32 pass／0 fail、167断言、5文件，`cs-rfc037-probe-read-final-targeted-v4.log`，未改变正式Probe进程、服务端能力或容量。

实际独立原生before已于2026-10-05T23:51Z完成：155次HTTP读、正式Probe与实际BuildKit gRPC，原范围包括2 usage、3 cache元数据、1 history、53文件、2 snapshot、4 content、3 lease、39 Registry目录项、3专属blob、31 SCM目录项；全部节点旧inode消费者为0，SCM仍有3个实际请求。69个其他cache与49条history的原身份保护集保留。原件为 `cs-rfc037-4e26b38f4bde-native-host-v1/independent-native-before.json`，读取SDK明确标记冻结工作区v5，不能冒称新修复已部署；此证据也不是after归零证明。

v5完整门禁于2026-10-05T23:57Z实际启动，因读取流DOM/Bun类型不兼容失败，原日志和退出2回执保留；没有取消它。返回类型改为实际reader.read的返回类型。v6只是排队，复核SDK反例时在check启动前停止自有等待器。最终v7冻结23个功能文件，排在已有完整门禁之后；终态另记，不借用专项绿或旧SHA CI。

原项目还有真实历史缺口：网关历史Pod及41/42/43版放行文档缺少可核实归属；两个数据库台账有旧版本正文缺口，旧原生回调未记录独立身份。只读原件 `cs-rfc037-gateway-data-history-readonly-v1.json` 已保留，未修改原记录或补造历史。批准全平台巡检边界也不会自动消除这些缺口。

完整门禁、精确提交/hosted CI、修复部署与原专用项目真正回收分别追加实际终态；此文不是永久删除的最终验收回执。

## 最终候选完整门禁

v7于2026-10-06T00:32:06.850807Z开始，01:03:14.440042Z自然结束，退出0：6198 pass／157环境skip／0 fail，285225断言，1257文件；结构、lint、后端类型与控制台类型四层均通过。实际专用PostgreSQL配置保持，冻结23个功能路径首尾摘要及结束后复核全部一致。日志SHA256为`e847aef675f3764f95abccd9e443ec25c9f87b076c940fa25aab702bfc9ff9e2`，回执`/private/tmp/cs-rfc037-deletion-read-full-v7-receipt.json`。157环境skip不能算正式原生验收。

与23个功能路径直接对应的12文件专项覆盖实际78 pass／0 fail、497断言；127／127新增可执行行命中，作用范围为本批，不替代确切SHA hosted CI。原5秒STOP预算、未知归属拒绝和正式Probe容量保持。

门禁期间并行RFC-034独立提交`52c8eb74fd8354f15c9f1254106cb38d08b0949d`已在本地和远端同步，本批23个功能文件未变；不为该无关HEAD推进重启完整检查。精确发布允许清单为23功能路径及本验收文档、待批准平台边界方案、I35登记、共享STATE共27路径，批外Session和RFC-036在制品不纳入。实际提交、hosted CI及部署继续分别留证，原项目仍未删除。

## 响应修复的确切提交、部署及实机结果

27路径已精确发布为`ed95520f10403263d0a8da67707b8bf41e96fcef`；[CI37397276418](https://github.com/wangbinquan/CrewStation/actions/runs/37397276418)六项均终态成功。2026-10-06T01:39:10.646Z本机八组件就绪，实际Pod imageID及节点OCI revision与该提交一致；250项已安装迁移checksum保持，无迁移作业。API实际uid/gid1000完成报告目录独占创建、fsync、回读和删除本证明文件。原Namespace、项目Pod、PV/PVC、数据库和角色OID、GitLab及专用Registry/SCM原生配置身份均保持；默认Runner仍是52c8eb74原摘要，正式Probe仍为4e26b38f原Pod UID。回执`/private/tmp/cs-rfc037-ed95520f1040-deletion-read-v2-deployment-receipt.json`。第一次部署预检因错误的挂载检查在任何变更前失败，原失败回执保留；第二次核对既有批准的两个只读挂载后通过。

新鲜管理员实机读取证明最初只读盘点可以关闭；Esc恢复末行删除按钮焦点及原列表scrollTop 1163.5。重新打开会产生另一只读盘点，关闭界面没有宣称服务器盘点已经取消。两份实际计划分别为`01a10ee1-f4df-7000-880b-707cd8ca1175`和`01a10ee3-0dba-7000-bdbe-23e1e33b38e3`；第一份自首次打开到保存为215.391秒，不能把两次读取累计287.301秒写成一个请求的耗时。第二份包含22方、61项阻塞、complete=false，最终确认不可用；全部删除操作数仍为0。原件`/private/tmp/cs-rfc037-ed95520-live-plan-v1.json`，截图`/private/tmp/cs-rfc037-ed95520-blocked-plan-20261006.jpg`。dev-session和task-runtime本次盘点完整，但仍不构成项目全量清理成功。

## 正式原生读取的剩余故障与修复候选

2026-10-06T01:59:41Z至02:00:01Z，只读诊断直接装配实际部署的模块factory、原配置、Kubernetes和数据库，PG启动参数明确default_transaction_read_only=on；未启动服务器、后台工作或迁移，前后删除操作数均为0。原件`/private/tmp/cs-rfc037-ed95520-live-owner-diagnosis-v2.jsonl`。运行镜像的14个保护制品是完整的受管Registry拉取地址，旧适配器将它们直接当相对仓库路径校验；发布读取kubelet工作目录时，正式Probe的全局测量锁返回精确409忙碌应答，旧客户端立即拒绝。

本批14个功能路径修复上述已有合同的读取错误：运行镜像按实际settings.registryBase验证并转换制品地址，保留所有平台保护仓库，包含同项目物理前缀内的保护项；外部Registry、畸形路径、错误项目所有权仍拒绝。kubelet工作目录、进程归属、BuildKit平台输入和原生manifest复用原readProbeResponse，仅精确单字段忙碌应答在原截止时间内重试；认证、原对象范围、响应预算及完整EOF要求保持。HTTP成功后的挂起kubelet正文也由原截止时间取消。业务原归属不存在时显示中文对象与原因，严格拒绝不放宽。

红用例原件`cs-rfc037-native-read-red-v1.log`、`cs-rfc037-native-read-extra-red-v1.log`及`cs-rfc037-native-qualification-read-red-v1.log`保留。最终专项30 pass／4 Linux环境skip／0 fail、220断言、7文件；实际生产Root装配用例1 pass／0 fail、10断言。仅合并本批两份新鲜LCOV，7个生产文件40／40新增可执行行命中，无违规；原件`cs-rfc037-native-inventory-read-patch-preview-v1.json`。14个功能路径冻结于`cs-rfc037-native-inventory-read-candidate-v1.json`；完整门禁在02:09:22Z实际开始，按自然终态另记，未因HEAD推进重跑。

业务缺口另经原注册表及21个实际内容投影只读核实：缺失任务`01a0c12a-de2e-7015-b669-bf7cfb7caf6e`仅有业务迁移别名和旧子任务引用；原business task、accepted create-task intent、runtime environment、work_origins、content_origins，以及旧键对应的runtime沿革均不存在。子任务父业务任务实际属于另一项目`01a0c12a-de0c-700f-ac1a-b01ede8e33f4`，但当前严格来源合同不允许把父引用补造为缺失执行环境的归属证明；未修改任何业务历史或其他项目。原件`cs-rfc037-business-missing-original-readonly-v1.json`、`cs-rfc037-business-missing-original-links-readonly-v1.json`和`cs-rfc037-business-missing-original-parent-readonly-v1.json`。I35全平台巡检方案仍待作者批准，也不豁免该业务缺口、网关或数据库原生历史缺口；原专用项目尚未受理删除。


## 本批原生读取候选完整门禁终态

14路径候选单次完整门禁于2026-10-06T02:09:22.472006Z开始，02:43:32.588241Z自然结束，退出0；结构、lint、后端类型和控制台类型四层通过，6204 pass／157环境skip／0 fail、285278断言、1257文件。Bun用例耗时1962.46秒，完整检查首尾包含静态检查，未中途取消或重启。14个功能文件首尾指纹保持，真实PG原配置保持；原件`/private/tmp/cs-rfc037-native-inventory-read-full-v1-receipt.json`，日志SHA256 `8cc48a056a257f452c49f8183a59b09e2099e276db110a6031a61fb907e11b99`。环境skip不算正式原生清理验收。

本批允许清单仅14功能路径与本验收记录、STATE共16路径；精确提交、确切SHA六项hosted CI和本机部署分别记录终态。原专用项目仍存在且删除操作数0；I35等待作者裁定及真正历史缺口不由本次读取修复消除。

## 原生读取修复的确切发布、实际部署与原计划

16路径精确发布为`c597d7e60323b49a1c94ee97c82ab6fab568e4f6`；[CI37405641477](https://github.com/wangbinquan/CrewStation/actions/runs/37405641477)的static、unit、module、console、gate、e2e六项均终态成功。本机于2026-10-06T03:12:10.798Z完成八组件部署，实际Pod imageID及节点OCI revision与该提交一致；250项已安装迁移checksum保持，无迁移作业。API实际uid/gid1000的报告目录独占创建、fsync、回读和删除证明文件通过。原项目的Namespace、Pod、PV/PVC、PG数据库/角色OID、GitLab及专用Registry/SCM配置身份保持；Runner仍为52c8eb74原摘要，正式Probe仍为4e26b38f原Pod UID。回执`/private/tmp/cs-rfc037-c597d7e60323-native-inventory-read-v1-deployment-receipt.json`。

03:12:27.898Z至03:13:35.558Z的实际factory诊断使用部署镜像、原配置与Kubernetes，PG启动default_transaction_read_only=on，未启动后台、服务器或迁移。runtime-environment完整且无阻塞、6资源；release完整且无阻塞、15资源。业务目标服务来源一致，旧执行任务缺失则返回明确中文原因。前后删除操作数0；原件`/private/tmp/cs-rfc037-c597d7e60323-native-inventory-read-live-owner-diagnosis-v1.jsonl`。

管理员仅发起一次新盘点，原项目`01a0f30b-c652-7000-8d6f-553e3b5f6135`的计划`01a10f3a-1b2d-7000-abaa-c8056ae36ed2`于03:20:28.393Z保存，历时219.007秒。22方中18方完整；57项阻塞由business-task、data-control、gateway、provisioning产生，原运行镜像与发布读取故障已消除。最终确认不可用，全平台删除操作数仍为0；不能据此写成永久删除验收通过。原件`/private/tmp/cs-rfc037-c597d7e60323-native-inventory-read-live-plan-v1.json`及截图`/private/tmp/cs-rfc037-c597d7e6-blocked-plan-20261006.jpg`。

创建弹窗再次核对正式`team-assistant.cs.localhost`、预览`preview.team-assistant.cs.localhost`与模板初始代码/页面/API/发布配置说明，仅预览并取消，没有创建替代验收项目。1280×720时弹窗为880×688、底部操作可见；原390/320窄屏证明保持。截图`/private/tmp/cs-rfc037-c597d7e6-project-creation-live-20261006.jpg`。盘点弹窗关闭后dialogCount=0，焦点回到末行永久删除按钮，main scrollTop=1163.5，原项目仍存在；回执`/private/tmp/cs-rfc037-c597d7e6-browser-close-proof-v1.json`。

最终交接`/private/tmp/cs-rfc037-native-inventory-read-deployed-handoff-v1.json`绑定发布、六项CI、实际部署、原计划及关闭证明。后继`b0c7a52ee78f5700cec09715937197a97c26c394`仅增加观测验收文档；本批14功能文件指纹未变，本机main与origin/main同步，实际部署源码仍为c597d7e6。没有因此重跑未变候选的完整门禁。

## 原历史恢复路径的只读审计

接续审计读取平台登记备份元数据及当前PostgreSQL设置：object_backups无记录、archive_mode=off、WAL备份标记0。archiveCommandConfigured字段仅表示SHOW值非空，不能作为归档已启用的证明。缺失业务任务的当前ID与旧tsk键在business_task.recovery_requests、business_task.recovery_audit和task_runtime.development_parent_recovery_sweep中均未找到记录。只读启动参数和20秒statement_timeout均已固定，未修改任何历史或执行删除；操作数仍为0。原件`/private/tmp/cs-rfc037-original-history-recovery-audit-v1.json`与`/private/tmp/cs-rfc037-original-history-recovery-links-v1.json`。

该范围不包含外部持有的备份，不能推断它们不存在。I35仍待作者裁定，批准它也不会自动修复业务、网关及原生PostgreSQL的三类缺失原来源。已批准的原身份、未知归属拒绝和完整after合同保持；完整项目回收仍未完成。
