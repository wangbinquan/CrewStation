# 独立原生存储来源候选

2026-10-01 工作树候选，尚未提交或部署。它是已批准原生来源协议的只读部分，不代表完整 data-control owner、永久删除或 PD 实机回收已完成。

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
