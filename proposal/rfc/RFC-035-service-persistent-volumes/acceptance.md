# RFC-035｜验收与交付记录

> 2026-09-29。本记录区分真实集群、隔离 PG／Garage、故障夹具与浏览器夹具；历史失败不改写为通过。最终交付须同时具有精确提交 CI 与本机部署回执。

## 1. 交付边界

服务不挂 PVC：持久文件经平台对象接口进入 Garage，对象元数据、引用与幂等状态进入 PG。业务任务的 `/work` 仍使用任务所有的 PVC；环节 Pod 回收、暂停和恢复不删卷。整个任务显式 finalize 后，依次确认业务执行停止、只读归档、持久收据、所有消费者停止、原 UID 删除与供应器物理回收。对象空间、后端、传输、积压、归档及回收状态均可在工作台查看。

本批只改 CrewStation，未写 agent-workflow。AW 仍需按 [接入合同](./integration-contract.md) 改造服务文件访问、执行适配和任务终结。既有 legacy 任务保持原卷策略，未自动迁移或删除。

真实验收使用专用项目 `rfc035-objects-0929`（`01a0e955-7714-7000-8e27-16c2372b16a5`），服务 `01a0e955-7714-7001-90f0-301119790b31`；未用历史业务卷做删除实验。新增档位以固定 Runner digest 完成真实模型测试后启用。

## 2. 真实任务卷与产物链路

主任务 `01a0e96c-4ba2-7000-9a6b-e3d82bbc4f3d`，原 PVC UID `84547489-3f12-476c-be60-8fa9f5277b53`，PV UID `fdb96404-d665-45af-89b8-54a10e350245`。

| 阶段 | 实际观察 |
|---|---|
| Agent A | Pod UID `46108e0e-bbc0-4114-aae0-a487747f77fc` 写 `/work/proof.txt`，随后 Pod 实际回收。 |
| Agent B | 只在 A 消失后提交；Pod UID `5c33d6fc-aece-4298-b43b-b8acd0d84281` 挂原 PVC/PV，读到 A 的标记并生成 `proof-b.txt`，随后回收。 |
| 暂停／恢复 | 无业务 Pod 时原卷仍在；恢复 generation 3，读回 `proof-b.txt` 相同，第二次暂停 generation 4 仍保留原卷。 |
| 显式终结 | generation 5、原 operation `01a0e971-0cff-7000-a94a-69ec1f2b42bb`；没有重新启动业务 Runner。 |
| 归档助手 | 成功助手 UID `a2dcf605-9868-44e8-a9b6-fc953897911a`，只读挂原任务的 work subPath；只注入归档接口、短期令牌与本 Pod UID。 |
| 收据 | UTC `2026-09-28T19:35:46.775Z` 持久保存两项；每项 25 字节，SHA-256 `a0c0857d4dc8a00968e12cc44a24e4bb19171e1e9d077a29433492d250597bf1`。 |
| 清理 | 所有消费者停止后原 PVC/PV 删除，节点 `/var/local-path-provisioner/pvc-84547489-3f12-476c-be60-8fa9f5277b53_cs-rfc035-objects-0929_task-01a0e96c4ba270009a6be3d82bbc4f3d-work` 确认不存在；UTC `19:36:03.903` 终结完成，`storageReclaimed=true`。 |
| 卷后读取 | 服务接口与登录工作台都下载到相同字节和摘要。产物对象为 `01a0e984-2338-7001-b887-9cd8485dbe77`、`01a0e984-2338-7000-a692-17f04f66de6d`。 |
| 新任务输入 | `01a0e986-3de8-7000-894f-d2355420ae74` 将原产物物化为 `restored/proof.txt`，内容相同；显式空归档终结后，PVC UID `7a39bd2d-ba50-404b-b981-b5164712a59a`、PV UID `5a06410f-892b-4e12-a8d3-c7b6284a758b` 及其节点目录均清理；UTC `19:39:14.986` 完成。 |

证据：`/tmp/cs-rfc035-live-acceptance.json`、`/tmp/cs-rfc035-live-agents.log`、`/tmp/cs-rfc035-live-pod-watch.tsv`、`/tmp/cs-rfc035-live-mount-watch.tsv`、`/tmp/cs-rfc035-live-finalize-complete.log`、`/tmp/cs-rfc035-live-input.log`。Pod watch 只记录标识、阶段、卷和环境变量名，不记录凭据值。

实机发现并修复两组原本被夹具掩盖的错误：归档执行 ID 与卷所属 taskId 混淆（`6ae2aca0`）；真实 Kubernetes UUID 被误当平台 UUIDv7、恢复时过早放行归档 init gate、未绑定的终态助手不及时停止（`e083c77e`）。后者先红再绿，22 项／194 断言通过，类型、lint、结构检查通过。原失败助手没有取得收据或删卷权限，控制器升级后按同一个终结 operation 停止旧助手、退避、创建新助手并完成。脚本首次把正常“等待供应器物理回收”的 blocked 快照当作终态而退出；修正等待判据后确认实际完成，没有绕过保护或手工改库。

## 3. 服务持久化与可观测界面

服务对象 `01a0e96b-7466-7000-9063-458f452ba181` 已由两个真实副本读取，SHA-256 `6fddc59ae90fccdc3c6a9f5f21656284436a474a7917d5a85d5cf6e0b3ecba33`；Deployment 模板没有 PVC。删除本次服务的非执行权副本后，新 Pod UID `9853c695-3a76-4a11-9b43-64c4a8677915` 仍读到该对象。随后通过正式发布流程将 v0.1.4（`01a0e98f-da79-7000-9904-500ed16ec156`）部署到蓝槽，绿槽正式 v0.1.3 保持；两槽均 2/2 Ready，四 Pod 逐一读取同一对象并核对字节，各 Pod 无 PVC。证据 `/tmp/cs-rfc035-service-recreation.json`；共享调试端口失去响应后接续到自有 headless Chrome，未重启既有浏览器。

管理员入口 `/admin/object-storage`；项目入口 `/projects/01a0e955-7714-7000-8e27-16c2372b16a5/object-storage`。真实 Garage 后端与空间 API 对账：健康、已用／预留／待删、空间预算、底层磁盘采集时间、上传／校验／GC／未知传输队列、归档阻塞、归档收据与下载。传输后五项趋势可见；无样本与过期数据明确显示缺失，不伪造为零。

真实浏览器 1440px、390px 验证管理员观测和项目任务详情：统一 Dialog、窗口内无横向溢出、关闭焦点返回原行、完成状态、两条产物下载链接与归档历史；Network 记录的业务写请求为 0。首轮项目页脚本用“历史”匹配实际“归档与回收记录”失败，修正选择器后通过，未因此修改产品文案。截图 `/tmp/cs-rfc035-live-objects-{1440,390}.png`、`/tmp/cs-rfc035-project-task-{1440,390}.png`；数据与浏览器证据 `/tmp/cs-rfc035-live-ui.json`、`/tmp/cs-rfc035-live-project-ui.json`。

候选浏览器夹具另外覆盖 1440／390／320px × 中文／英文 × 明／暗共 12 组、55 行末行操作、嵌套 Esc、焦点与滚动上下文。此为布局与交互证据，不冒充 12 组真实集群数据。

真实拓扑在清理前逐项对账原 PVC UID、PV UID、只读归档挂载边、服务 Deployment 到对象空间的使用边，`complete=true`；无业务 Pod 时保留卷仍有节点。来源 `/tmp/cs-rfc035-live-topology.json`、`/tmp/cs-rfc035-live-graph.json`。图使用公共资源台账及完整盘点，不按当前 Pod 列表猜测存储是否存在。

清理后的项目图仍为 `complete=true`：原任务 PVC/PV 节点消失，对象空间仍在，蓝绿两个服务槽各有一条使用边，见 `/tmp/cs-rfc035-live-graph-after.json`。系统图按同一 snapshot 分页读完后核对 Garage 两个长期卷：数据 PVC `aa1b89a7-ab51-4a5d-86dc-bd872425fc84` → PV `9138e598-3f3c-44f5-a525-4000b9698ebb`，元数据 PVC `5ef91efa-a767-4a78-8cc3-b98985b9adf3` → PV `962df5eb-302e-46ef-8a13-66a7b741ab7c`，两组节点、绑定与实际挂载边齐全；UTC `19:57:05.150` 快照完整，见 `/tmp/cs-rfc035-live-system-graph.json`。这是实际 API 经正式图构建器生成的证据，界面布局另外由浏览器矩阵验证。

## 4. OS-01…54 证据索引

下表的测试文件是可复验的防护；集群主链见 §2–3。真实 PG 用例通过独立测试库运行；Kubernetes 故障用例使用受控观测／假客户端，除明确列出的真实动作外，不宣称已在生产集群注入所有故障。

| 编号 | 主要证据与范围 |
|---|---|
| OS-01 | contracts `business/finalization.test.ts`、`object-storage/storage.test.ts`；business-task `storageCapabilities.test.ts`、`finalizationIntake.test.ts`。 |
| OS-02 | data `objectStorage.test.ts`、`objectAdministration.test.ts`、`archiveHelpers.test.ts`；开发来源 HTTP／网关回归，真实服务签名调用。 |
| OS-03 | data-control `objectEndpoints.test.ts`、`objectGarage.test.ts`；data `objectCredentialRotation.test.ts`、`objectRotationGarage.test.ts` 实际撤销旧钥。 |
| OS-04 | 实际 TCP 背压／取消、分段 S3 读取；`objectServiceGarage.test.ts`、`objectSegmentReads.test.ts`；[性能记录](./performance.md) 1 GiB 限额运行。 |
| OS-05 | `objectUploads.test.ts`、`objectRecovery.test.ts` PG 竞争；真实 Garage 丢 PUT 回执后读回确认。 |
| OS-06 | `objectCatalog.test.ts`、`objectRecovery.test.ts` 配额／物理删除／暂存恢复。 |
| OS-07 | `objectContent.test.ts`、`objectConsoleDownload.test.ts`；实际 Range／已删卷后登录下载。 |
| OS-08 | §3 的真实双副本、Pod 重建、双槽及零 PVC 模板。 |
| OS-09 | §2 同任务暂停、恢复、原 UID／字节；storage lifecycle 回归。 |
| OS-10 | `finalizationIntake.test.ts`、`storageControl.test.ts` 真实 PG 受理竞态。 |
| OS-11 | resources `workloadSafety.test.ts`、session 终态证明回归、归档停止屏障；未知写者不因过期放行。 |
| OS-12 | `archiveExecution.test.ts` 实际 PG 额度；§2 暂停父任务与独立只读助手。 |
| OS-13 | 原生 Linux `secureFile.test.ts`、`execute.test.ts`；归档合同与分页上限。 |
| OS-14 | `archiveHelpers.test.ts`、`archivePlans.test.ts`、`archiveBindings.test.ts` 必需／可选／清单 CAS。 |
| OS-15 | 真实 Garage 错误凭据／重启／丢回执；配额 PG 竞争及失败助手保留原卷后实机恢复。 |
| OS-16 | `finalizationPreparation.test.ts` 跨模块丢回执、收据与清理许可重放；本次真实控制器升级接续。 |
| OS-17 | `taskVolumeReclaim.test.ts` 替代 UID／清理失败夹具；§2 原消费者停止后清理。 |
| OS-18 | §2 local-path Delete 与节点目录不存在；Retain、失联探针、CSI finalizer 均有拒绝／待确认夹具。 |
| OS-19 | §2 已删卷下载、输入引用物化、新任务；终结后 resume 拒绝。 |
| OS-20 | task storage／资源释放及 namespace 退休保护回归；旧 PVC 基线对账见 §5。 |
| OS-21 | `objectLedger.test.ts`、console `topologyStorage.test.ts`／`topologyAssembly.test.ts`；真实 graph/API 对账。 |
| OS-22 | §3 三宽／双语／双主题夹具和实际项目 Dialog。 |
| OS-23 | `taskStorageStatus.test.ts`、业务 finalization 领域矩阵、工作台完成与待物理回收状态。 |
| OS-24 | 合成旧库升级 1 项／12 断言；实际迁移 Job；合同／迁移锁及 §5 精确 SHA CI。未导出原库。 |
| OS-25 | 固定 Garage digest 重复安装前后 Secret 摘要、Pod/PVC/PV UID 相同；§3 实际系统图两组 PVC/PV 与绑定／挂载边完整，系统回收保护用例。 |
| OS-26 | `objectGarage.test.ts` 实际签名、流式、Range、空对象和确认删除；接口不依赖版本化／Object Lock／条件写。 |
| OS-27 | `objectBackupGarage.test.ts`、隔离 PG17 与两个 Garage 正式导出恢复；摘要／引用／收据相同，失败冻结。 |
| OS-28 | [完整性能矩阵与小文件接续](./performance.md)，保留历史失败及环境差异。 |
| OS-29 | 本机 RF1 明确 dev-only；生产等级必须验证三独立故障域。生产等级拒绝与 capability 有用例，本机不提供三节点故障耐久证据。 |
| OS-30 | `manifest/objectStorage.test.ts`、release/data 的空间声明／档位选择用例及真实 Manifest 供给。 |
| OS-31 | 合成升级保留两种 legacy 原策略与标识；业务创建／关闭兼容用例。 |
| OS-32 | session 独立终态与事件缺口、`finalizationIntake.test.ts` 过期日志／分页结果证明。 |
| OS-33 | 归档 renderer 及 `archiveExecution.test.ts`；§2 没有恢复业务父 Pod，只读 subPath 与最少凭据。 |
| OS-34 | `storageControl.test.ts`、`objectFreeze.test.ts`；过期 epoch／失序控制版本及后台终结独立身份。 |
| OS-35 | `objectRecovery.test.ts`、`objectUploads.test.ts`；真实唯一 key 丢回执恢复，404 保留占额。 |
| OS-36 | `archivePlans.test.ts`、`archiveBindings.test.ts`；万条单文件查询负载、输入引用 pin 与实机物化。 |
| OS-37 | `archiveExecution.test.ts` 实际 PG 额度／无 Pod 排队；系统 Garage 安装单写者用例。 |
| OS-38 | 用户／服务／助手 HTTP、真实网关传输、普通 API 与 1 GiB 并发时延。 |
| OS-39 | `storageOperator.test.ts`、`archiveAdministration.test.ts`、`archiveLoss.test.ts`；统一确认 Dialog 用例。 |
| OS-40 | `objectCredentialRotation.test.ts`、`objectRotationGarage.test.ts`；固定位置与在途操作配额／状态。 |
| OS-41 | `objectBackup.test.ts`、`objectBackupGarage.test.ts`；[备份手册](./backup-runbook.md) 明示 AW PG／活跃卷恢复边界。 |
| OS-42 | `objectServiceGarage.test.ts` 实际外部丢失降级、同 digest 修复；`archiveLoss.test.ts` 保留损失事实。 |
| OS-43 | `storageContract.test.ts`、官方 `compatibility.test.ts`／`targets.test.ts`、Runner／助手合同声明；本机实际启用。 |
| OS-44 | §2 两个真实顺序 Agent Pod、暂停／恢复 UID 和内容、最终物理回收。 |
| OS-45 | `finalizationRevisions.test.ts`、`archiveBindings.test.ts` 双模块 PG 交错、丢回执与旧修订竞争。 |
| OS-46 | archive 引用／guard、`archiveFinalization.test.ts`、收据后删除产物集的前置条件回归。 |
| OS-47 | workload safety／stop proof 各容器阶段夹具；真实助手失败仍保卷、绑定成功后正常停止回收。未对既有业务做节点失联故障注入。 |
| OS-48 | `objectFreeze.test.ts`、`storageControl.test.ts`、namespace retirement 保护；后台清理不借用旧槽执行权。 |
| OS-49 | `templates/business-execution-v3/tests/storage.test.ts` 游标导出／缺口；D7 预览未知路径不默认空计划。 |
| OS-50 | `archiveLoss.test.ts`、finalization 领域与 PG 矩阵；§2 普通／显式空清单实机，从未供给／loss 分支隔离回归。 |
| OS-51 | 官方安装／回退兼容及不可变目标绑定回归，本机部署先预检；不声称旧二进制具有新检查。 |
| OS-52 | `objectBlockers.test.ts`、data/data-control观测回归；§3 真实管理员／项目 API 与界面。 |
| OS-53 | objectMetrics、真实 TCP 与 S3 指标回归；实机传输后的五项趋势和时间、空值对账。 |
| OS-54 | 工作台对象组件及 12 组夹具的离线／容量／阻塞；§3 真实完成下钻与收据。 |

## 5. 验证、发布与部署

完整本地候选自然结束为 **4196 pass／20 skip／10 fail**，不记为全绿。九项共享导航／旧部署差异经相关会话修正，旧业务固定 50ms 等待经终态等待修正；核心 337 项、后续定向和最终 hosted CI 分别记录，不合并为一次总测试数。原候选改动行 6760／6982＝96.8%，零防护违规。

| 提交 | 内容 | 精确 SHA CI |
|---|---|---|
| `0f180d6a669dffac502a73aca3259c93adc97867` | 完整实现及 21 个完整共享文件，保留 RFC034 贡献 | `36465600928`：下载用例时序竞争导致 module 失败，其余层通过。 |
| `948404d3976369e9ee22d285bf1dd6f1e40953ad` | 下载夹具显式控制后端完成 | `36468495910` 六项通过。 |
| `0dc868c3ed4cea7a16bd20980accc85131e4e89b` | 样例每服务实例连接池限制 2，空闲 30 秒回收 | `36469374398` 六项通过。 |
| `6ae2aca054ff063dc4fcaa5ded7d98cd2e2a6625` | 归档卷以所属任务校验 | `36471547672` 六项通过。 |
| `e083c77e8cdf4f460a1a0056de752201970663e7` | Kubernetes UID、绑定前准入与终态助手恢复 | `36472884363`：归档修正用例通过；旧 PG 轮换测试因客户端退出与服务端连接消失的时序竞争失败，gate 随之失败。 |
| `f5a4196bc3bff491f8bdf7d83aeb641813aee642` | 轮换测试等待 PG 实际关闭连接；12 轮各 5 项／38 断言通过 | [36474805326](https://github.com/wangbinquan/CrewStation/actions/runs/36474805326) 六项通过，包括 gate 与独立集群 e2e。 |

本机初次整个平台使用 `0f180d6a` 三类固定 digest 构建，迁移 Job、应用与探针就绪后启用新合同。后续修正从原已核对镜像叠加**已提交的精确文件**构建并过正式兼容预检；不将共享工作树 RFC034 在制修改打入镜像。当前 API／controller 为 `docker.io/library/cs-control-plane@sha256:b2f654750273cc00e054b16d33c5beb447a88c95e3adf5a70399076bde50a768`（`e083c77e`），其它本次未改生产文件的角色保持 `0f180d6a`；console 为 `sha256:d41ac6a72987a7215255445e41fbc01e68d5326995a19fbbfc5a5f386f3eb755`，Runner 为 `sha256:83d00f1d7dd0718d40838f88c060665b697ac5775c9711647014f99381df5f66`。

部署证据 `/tmp/cs-rfc035-deployment-0f180d6a669dffac502a73aca3259c93adc97867.json`、`/tmp/cs-rfc035-controller-overlay.json`；最终文档提交的精确 SHA CI 另在交付回执确认，不能用实现的绿色运行代替文档提交的结论。

部署后对最初盘点的 **45 个既有业务 Pod/PVC（20 个 PVC）** 逐一比较 namespace／kind／name／UID，全部一致；新建两任务的 PVC 数为零。终结后对主任务 resume 返回 HTTP 409／`task_closed`。证据 `/tmp/cs-rfc035-final-resources.json`。共享主干期间 RFC034 的 `987b68dc` 独立发布，输出完整保留；后续测试修正不改变本批应用镜像。

验收结束时没有本次遗留的临时 Docker 容器；已停止自有 headless Chrome 与挂起诊断进程，既有浏览器不重启。专用服务与对象空间保留供作者查看，两项业务任务已完成并回收卷。

## 6. 已知边界

- 本机 Garage v2.4.1 是 RF1、dev-only；三独立故障域的生产耐久验收未执行，不能据此宣布生产多节点可用。
- 一万份 4 KiB 文件共 53.20 分钟、0.01224 MiB/s，经首次助手 40 分钟夹具期限退出后第二轮接续完成；小文件归档较慢，不称一次不中断运行或最高吞吐。
- 原平台整库快照的额外演练被自动审批拒绝，原因是部署授权未明确涵盖复制整库敏感数据；未执行、未绕过。使用合成旧库升级与实际正常迁移提供兼容证据。
- 专用服务最初触及本机 PG 100 连接上限；只收回本次测试服务旧副本连接，未关闭其他业务连接。样例两实例回归先红后绿后部署。该修正不代表共享 PG 总容量已扩容。
