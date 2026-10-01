# 独立原生存储来源候选与部署

2026-10-01 工作树候选，尚未提交或部署。它是已批准原生来源协议的只读部分，不代表完整 data-control owner、永久删除或 PD 实机回收已完成。

后续状态：该候选已精确发布为 `e9eb97b218d275f6c949513c82d8ca2413d22639`，该 SHA 的 [CI 36845033387](https://github.com/wangbinquan/CrewStation/actions/runs/36845033387) 六项终态成功，并在 2026-10-01T10:18:06.514Z 完成八组件和只读来源探针部署。实际 API 与控制器的公开内部来源端口已联合核验原 SQL/K8s/HTTP 来源；首次调用失败也保留在下方，不覆盖早期候选、门禁失败和旧协议 404 历史。完整正式 owner 和项目永久删除仍未完成。

## 已实现的行为

`packages/filesystem-metrics/source.ts` 和既有 server 新增经过同一独立 Bearer token 认证的 POST /source。请求限定已配置 root、一个直接卷子目录及最多 32 条受限相对路径；仅 stat，不读取文件内容。Linux 逐层原目录 descriptor 固定，禁止 symlink、跨设备、类型错误及缺失 inode/birth epoch；最后复核全部原 descriptor 和原路径。普通内容写入不使 epoch 改变，复制控制文件、替换目录/表空间和观测期间替换会被识别。协议保留既有 bounded body、忙时 409、取消/超时和 measure/absence 路径。

`modules/platform/adapters/k8s/nativePostgresSource.ts` 用原 NativeDdlConnection 读取真实 server address/port、控制版本、PGDATA 和完整 tablespace 清单；对完整 EndpointSlice 分页和实际 Service/Pod/PVC/PV、claimRef、容器挂载及新鲜节点/Lease逐一核对。local-path 来源通过当前原节点的只读探针固定 root/卷及所有数据位置 epoch；未知 external URL、CSI/provider、subPath 或不可观测 tablespace 阻断。前后核对 SQL 来源、端点和全部已读 K8s resourceVersion/UID。

独立身份绑定实际 Service、原卷/节点和所有数据目录；当前 server Pod/容器只作为观测者记录，正常 server 重启并仍挂同卷时可以重新证明相同原卷。组合根把该只读能力接入 data-control 内部 API，无 HTTP 删除入口；无探针配置时在 native SQL 前拒绝观测。既有 ClusterRole 的全 kind list 已覆盖 EndpointSlice，实际 can-i list 为 yes；没有扩张 RBAC。

实际 NetworkPolicy UID 7a06a3f8-e684-4856-93b0-48c15c2bdc05 只允许 cs-controller 到探针 8095，无法支持 cs-api 的删除预检。部署清单候选仅增加同 namespace 的 cs-api 精确 Pod 标签，保留 cs-controller、单端口及 Bearer 认证；没有公开 ingress 或 namespace/IP 通配。新策略回归先在旧清单失败、修订后通过，原规则只读回执保留，尚未变更实际集群规则。

data-control 当前 38 个生产 TS/1644 行，platform 59 个生产 TS/2268 行；这些是候选盘点，后者原有规模问题仍按 ADR-0012 的已提出边界处理。本批未增加模块/layer，不授予任何结构例外。

## 候选验证与实际边界

独立文件系统/来源组合先为 16 pass／0 fail、117 断言；Root 的真实隔离 PG 组合为 1 pass／0 fail，验证公开端口类型及缺失独立观测的拒绝。最终同一候选合跑上述用例与原生写入/库执行/角色/物理目录/data-control 回归为 **58 pass／0 fail、382 断言、10 文件、12.45 秒**。使用原独占 PostgreSQL 17 测试实例，prepared-transaction 用例实际运行；K8s/SQL 地址来源仍为端口替身，不称为实机清理。

官方 patch gate 按完整 14 个源码/测试/配置精确路径核对：改动可执行行 **168／168，100%，全部改动生产文件已加载**。精确 ESLint 通过；HEAD blob 与这 14 条当前候选内容的内存编译，后端与 console 均 0 diagnostics。普通工作树类型检查仍被并行开发准入测试阻断，结构检查仍被另一会话未入锁的 resources/0008 迁移阻断；不改动或代入锁这些在制品，没有把本批称为完整门禁通过。

2026-10-01T08:32:11.624Z，在原 cs-storage-probe-hsj7r/UID 48c40440-cdae-41c9-ae43-171ada9f9a35 上，通过 stdin 运行候选只读观测，得到原 PostgreSQL 卷、pgdata 和 pg_control 的独立 epoch。探针 root 文件系统只读，首次复制候选到 /tmp 被正常拒绝，随后 stdin 无落盘执行成功；没有更改只读配置、读取文件正文或写入共享卷。私有回执 `/private/tmp/cs-rfc037-native-source-live-candidate-1.jsonl`，它未经过已部署的 /source HTTP 端点，也没有绑定一次真正的原 NativeDdlConnection/K8s 全联合观测，因此不是最终部署验收。

日志：`cs-rfc037-native-source-combined-4.log`、coverage-audit-4.json、candidate-types-1.log、lint-5.log、arch-{1,2}.log。初次安装受默认 tempdir 权限阻断，用允许的 /private/tmp 与独立缓存重跑后仅变更本批一条 workspace 依赖和 lock；首轮 own 跨模块 type import 已改为组合根注入的结构端口，测试泛型类型断言已修正，失败日志保留。

## 后续

稳定候选的完整门禁、精确发布/CI、含实际只读探针的部署和真正原 SQL 连接/K8s/HTTP 联验继续。独立来源还没有持久固定到全部旧/新 DDL 事实，正式 owner 的全历史盘点、封闭、原名字排空和最小清理意图仍待接齐。管理员二次确认和其余内容 owner 继续；原专用项目保留，永久删除入口关闭。

第一次稳定候选完整 `bun run check` 于并行迁移入锁之后开始：全结构与全 ESLint 已通过，后端类型阶段 exit 2，四项均属于正在编辑的 development admission 测试（cluster-control/workloadGate、resources/developmentWorkloadSafety、task-runtime/developmentUsageProtection、contracts/developmentAdmission）。未执行 console 类型或完整用例，不当作完整门禁通过。18 条冻结候选内容未变；本批精确内存编译两侧已通过，未修正或提交他人的测试。日志 `cs-rfc037-native-source-full-check-1.log`；只有此前完整门禁不完整/无效时才进行后续修订检查，避免等价全量重复。

网络预检修订后的候选清单增为 16 个源码/测试/配置路径（再加 4 份自有文档）；前述 14 路径类型/覆盖与 18 条冻结回执是上一检查点，不能自动充作新策略的完整门禁。策略红/绿日志分别为 native-source-policy-{red,green}-1.log，精确 lint 已通过；修订候选继续门禁。

## 地址反例与修订候选

2026-10-01T09:16:03.792Z，真正原 native SELECT 返回的 server address 为 10.244.232.136/32，其余 port、PGDATA、system_identifier 和版本均完整；原候选错误地用 inet::text 当严格 IP。保留 sql-diagnostic-1.jsonl 和 live-preflight-1.jsonl 的失败。新增真实隔离 PG 回归先失败于同一地址校验，再以 host(inet_server_addr()) 转绿；不只在替身中修改字符串。红/绿日志 inet-{red,green}-1.log。

修订后的同一 16 路径专项合跑 **60 pass／0 fail、388 断言、11 文件、11.73 秒**，日志 combined-6.log；官方完整改动行检查仍为 **168／168，100%，所有改动生产文件加载**，coverage-audit-6.json。冻结回执 candidate-fingerprints-2.json 记录 16 个源码/测试/配置和 4 个文档，旧 18 条回执另存，不覆盖历史。

2026-10-01T09:19:33.984Z，在原 cs-controller Pod UID b1d84b97-58b0-4ea5-997b-2b6d9d710fca 上，以真正原 NativeDdlConnection 和实际 K8s EndpointSlice/Pod/PVC/PV/Node/Lease 执行候选映射，抵达原只读探针并按缺失 /source 返回 404，保留 live-preflight-2.jsonl。SQL 与 K8s 只读；只有既有独立 callback 在途/退出最小事实，不写数据库内容、口令、共享卷或实际网络规则。completeSourceProof=false；它不是已部署 HTTP 联验或完整删除。

并行迁移已由原 owner 入锁，四项类型错误也由其修正。随后本批新修订候选的完整 check 第二轮通过结构、全 lint、后端与 console 类型，完整用例已出现另一任务的 developmentWorkloadAdmission 断言失败（queued 实得 cleaning）；继续等这次完整运行结束，不取消、不修正对方文件、不因其或 HEAD 前进重跑相同候选。16 个源码指纹保持；精确候选检查和发布仍按本批清单执行，整仓失败不计为通过。完整日志 full-check-2.log。

完整第二轮已结束：**4861 pass／143 skip／6 fail，5010 tests、966 文件、32234 断言、1159.41 秒**。一项为上述 developmentWorkloadAdmission，另五项为并行原创建回放用例的超时；不把它们改掉或提交进本批。16 个源码/测试/配置指纹与冻结时完全相同，仅追加四份本任务文档的验证回执。以 HEAD 4e6b1a15 的全部原 blob 和本批精确 16 路径做内存候选编译，后端与 console 都为 0 diagnostics（candidate-types-3.log），未新建 checkout、alternate index 或裁掉共享树内容。按精确清单发布、等待精确 SHA 的 hosted CI 和正常探针部署，不为这些无关在制变化重跑等价全量。

## 精确发布与实际部署

20 个精确文件已提交、推送并核对署名、空索引和 main/origin 同步；没有收进开发准入、用量或观测界面的并行在制品。精确 SHA 的 static、unit、module、console、gate、e2e 全部成功，私有 CI 回执 `cs-rfc037-e9eb97b218d2-ci.json`。上面的本机六项失败仍是失败，hosted CI 的成功不改写本机历史。

仅以已提交归档构建镜像，不用额外开发 checkout。默认 buildx metadata 写入受限目录的首轮失败保留；用独立 `/private/tmp` BUILDX_CONFIG 后正常构建。control/console 的配置 ID 分别为 `9d932f99887d22d1d24f310c35c2c87140a7f4fa47d2ffa0631ca86f0616f7dc`／`1411d713f57675b7861e825dfaa73304df236bcda31eddca9e148a020fa5e489`；真正部署的 manifest digest 分别为 `04fed72557216ad2f12d23f0a0d0af4d975120afb22353917c2603e004b0aa46`／`43cdc6a91b2fe164de66b92015689abe2b8a51c3105d7b77eae8326cb5ff6cb9`，不将配置 ID 与部署 digest 混用。

首次部署在写入任何集群变更前，被 NetworkPolicy 的空 egress 数组序列化差异阻断；实际 API 省略 `egress: []`，UID、resourceVersion 和其余完整 spec 仍是原值。私有前置核验按空数组同义规范化后重试成功，未放宽 UID/CAS 或其余策略。8 个应用 Deployment 的 generation=observedGeneration、Ready=1，来源探针 DaemonSet UID `a1ff0009-3b4b-4df9-b79f-df8d884a6897` generation 8、Ready=1。原只读/security/mount 配置保持；新探针 UID `baa72ace-196a-4415-9b1c-cd1dcb74e04b` 在原节点，以同一 control digest 运行。

NetworkPolicy 保持原 UID `7a06a3f8-e684-4856-93b0-48c15c2bdc05`，实际 ingress 只允许本 namespace 中精确 cs-api/cs-controller 标签到 TCP 8095，Egress 隔离且无放行项。API 没有被任何出站 NetworkPolicy 选中，无须修改出站策略。部署前后的原 22 Namespace、48 Pod/PVC、19 PV 没有缺失，共享 PostgreSQL 的 Pod/容器/PVC/PV/Node/Service 身份全部保持，当前 Runner `587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928` 保持。备份、迁移、镜像及精简部署回执分别保存在私有 e9eb97b218d2 前缀目录和 JSON。

## 实际 SQL、独立 K8s 与 HTTP 联验

2026-10-01T10:22:07.049Z 的首次 cs-api 调用返回「独立原生卷来源探针暂不可用」，退出 1；原 `cs-api-source-live.jsonl` 保留。这次没有记录 HTTP 状态，不能将其断言为忙时 409，也不能将失败写成成功。随后在同一实际 API Pod 上，用已安装的真实适配器保留 fetch 响应并正常返回给原调用，三次独立 /source 均为 200／601 bytes；2026-10-01T10:30:38.721Z 完整来源核验成功，见 `source-http-diagnostic-1.jsonl`。首次失败的确切原因仍未证明；正式 owner 必须把临时不可用作为等待/重试，不能产生清理成功回执。

2026-10-01T10:35:30.022Z／10:35:32.190Z，实际 cs-api UID `9af51878-03ff-4e5f-87e3-465bf927d899` 与 cs-controller UID `93171770-a0b6-4221-8dee-e8f465b734b0` 各自通过真正 Root 的公开 `nativePostgresSource.capture/verify/capture`。原 NativeDdlConnection、完整 K8s 身份映射、认证后的已部署 HTTP 来源以及实际 callback 退出全部运行；两者得到同一独立身份 `37a5d248a52b478038a570883375b439cdb6a4829bc3648c284ef46e3b47095f`。原 PostgreSQL Pod `e1c096f1-223a-4a78-a67c-d5b66345bcb0`、PVC `1cefe909-de62-4307-b517-14aab56ac809`、PV `93d700f2-130d-4517-a8be-f031ec9409a5` 和 Node `1d907504-da49-4ad5-bcf1-05bf3de4139d` 一致。root/volume/pgdata/pg_control epoch 与 08:32 原只读探针观测也一致，未把仅 SQL 指纹当作独立存储身份。

私有回执：`cs-rfc037-e9eb97b218d2-{cs-api,cs-controller}-source-live-2.jsonl`、deployment-receipt.json、source-probe-receipt.json；初次失败原件另存，没有覆盖。验证只做来源/原目录/原凭据读取及既有 callback 最小在途/退出事实，没有 DROP、CREATE、口令变更或共享卷写入。创建弹窗源码未变；本批 Chrome 连接失败，没有记新的浏览器、窄屏或网络验收通过。先前 557cb50c 的实际统一弹窗和域名/模板/焦点证据保持。

2026-10-01T10:42:34.929Z，在原实际 API Pod 上再次运行既有原生 SELECT 回调：独立提交的原 PID/四键/SQL 来源在途事实由 running 转为 finished，原保护 finalizer 存在，旧生产凭据 SELECT 1 成功。10:42:35.118Z 原库 `cs_rfc037_creation_proof` 的原 OID `276598`、SQL 来源及物理目录仍 present；只读前后 48 个项目原生库清单完全一致。回执 `native-{admission,catalog}-preservation.jsonl`，不把这次保留验证称为任何资源回收。

下一批须提供 resources 的全部历史 native 记录端口；当前 listLive 有上限，压缩记录会清除子身份，不能据此证明无旧库。独立存储身份尚未持久绑定所有旧/新 DDL，完整 data-control owner、其余内容 owner、管理员二次确认和 PD 实际回收继续。原专用项目/数据库保留，永久删除入口关闭。
