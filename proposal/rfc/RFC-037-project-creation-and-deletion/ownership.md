# RFC-037｜项目归属与清理参与者清单

> 2026-09-30 实施快照。使用当前组合根迁移在一次性真实 PostgreSQL 中建立全部表，再读取 information_schema；223 个表、21 个 schema。临时库已销毁，未读取业务数据或接触真实项目。下列是清理边界，逐 owner 的物理实现仍在进行。

## 1. 完整性与许可

22 个 owner 必须显式登记：`packages/contracts/api/projectDeletion/values.ts`。provisioning 在本 schema 保存原开通工作／准入事实，并拥有共享控制器／队列；cluster-control 拥有物理集群副作用，不能因没有持久业务内容表而省略。盘点报告必须包含完整性、来源修订、原身份与外部引用；未知表、未知对象、未走完分页或不可读来源都阻断销毁。开通原工作接线见 [provisioning-work.md](provisioning-work.md)。

盘点目标使用 project 单调 lifecycle_revision，资源集合用规范化摘要。受理会重读目标和盘点并核对原计划，原子落 deleting、操作和 outbox。每个 owner 仍须在本 schema 闭准入、排空已开始的副作用并取得停止证明；中央权限检查本身不能代替这个屏障。

阶段顺序是 seal → stop → purge → prove → namespace → metadata → verify；所有 owner 的前序回执齐全，才能进入下一阶段。project 的服务／成员等元数据在其他 owner 的元数据之后清理；根记录留到最终完整证明。

## 2. 当前 schema 的全部表

本表包含直接与间接归属以及需保留的全局目录，避免只搜 project_id 遗漏执行、配置、镜像和快照数据。清理实现必须依据各模块的所有权关系选择行，不整表删除。

| Owner schema | 表 |
|---|---|
| agent_runtime | `allocation_receipts`, `credential_versions`, `profile_credentials`, `profile_revisions`, `profile_tests`, `profiles`, `project_compute_policies`, `resource_identity_aliases`, `retired_profile_identities`, `retired_step_identities`, `retired_test_identities` |
| api_catalog | `allocation_receipts`, `grants`, `operations`, `proxies`, `requests`, `resource_identity_aliases` |
| business_task | `cluster_commands`, `contracts`, `execution_cancellations`, `execution_controls`, `execution_events`, `execution_lifecycles`, `execution_logs`, `execution_materials`, `execution_messages`, `execution_operations`, `execution_session_homes`, `execution_sessions`, `execution_subtasks`, `execution_task_states`, `finalization_execution_proofs`, `finalization_revisions`, `finalizations`, `legacy_mutations`, `recovery_audit`, `recovery_requests`, `resource_identity_aliases`, `storage_control_outbox`, `subtask_projections`, `subtasks`, `tasks` |
| cluster_management | `inspections`, `metric_collectors`, `metric_history`, `metric_observations`, `metric_storage`, `operations`, `refresh_history`, `refreshes`, `resource_identities`, `resource_identity_aliases`, `snapshots` |
| config | `definitions`, `items`, `resource_identity_aliases`, `value_sets`, `version_entries`, `versions` |
| data | `archive_binding_revisions`, `archive_file_results`, `archive_helper_closures`, `archive_helper_grants`, `archive_plans`, `finalization_bindings`, `object_backends`, `object_backups`, `object_credential_rotations`, `object_mutations`, `object_plans`, `object_project_policies`, `object_read_transfers`, `object_references`, `object_spaces`, `object_storage_freezes`, `object_transfer_stops`, `object_upload_attempts`, `object_uploads`, `object_write_control`, `objects`, `resource_allocations`, `resource_identity_aliases`, `resources`, `storage_contract`, `task_bindings`, `task_input_grants`, `task_object_inputs` |
| data_control | `credentials`, `object_endpoints` |
| dev_session | `agent_starts`, `cluster_agent_restarts`, `comparison_references`, `development_agent_usage`, `idle_reminders`, `native_activity_items`, `native_activity_progress`, `native_activity_reads`, `native_activity_sources`, `native_activity_states`, `native_terminal_starts`, `resource_identity_aliases`, `workspace_layouts` |
| events | `deliveries`, `event_types`, `inbox`, `producers`, `resource_identity_aliases`, `subscriptions` |
| gateway | `allowlists`, `maintenance_events`, `pod_identities`, `rate_limit_receipts`, `rate_limits`, `resource_identity_aliases`, `routes`, `service_maintenance` |
| identity | `auth_login_policy`, `identity_forwarding`, `oidc_flows`, `oidc_providers`, `resource_identity_aliases`, `signing_keys`, `user_identities`, `users` |
| observability | `accepted_execution_prices`, `alerts`, `cost_visibility`, `cost_visibility_receipts`, `execution_valuation_receipts`, `execution_valuations`, `native_baselines`, `native_capture_history`, `native_captures`, `native_repairs`, `native_steps`, `resource_identity_aliases`, `token_price_heads`, `token_prices`, `usage_changes`, `usage_events`, `usage_evidence`, `usage_heads`, `usage_pages`, `usage_projections`, `usage_snapshots`, `usage_sources` |
| project | `app_access_requests`, `app_icons`, `app_listings`, `deletion_operations`, `deletion_plans`, `memberships`, `namespace_quotas`, `projects`, `resource_identity_aliases`, `resource_policy_receipts`, `service_plan_policies`, `service_plans`, `services`, `task_profiles`, `task_quotas` |
| release | `execution_handoffs`, `offline_policy`, `releases`, `replica_overrides`, `resource_identity_aliases`, `service_slots`, `slot_events`, `slot_maintenance`, `traffic_switches` |
| resource_access | `catalog_policies`, `changes` |
| resources | `aliases`, `changes`, `children`, `leases`, `project_locks`, `records`, `task_storage_fences`, `task_volume_safety`, `workload_admission_closures`, `workload_consumers`, `workload_stop_proofs`, `workload_stop_scans` |
| runtime_environment | `allocation_receipts`, `build_logs`, `builds`, `creation_requests`, `development_policies`, `image_project_grants`, `images`, `project_image_policies`, `references`, `revisions`, `validations`, `versions` |
| scm | `repository_bindings`, `resource_identity_aliases`, `session_credentials` |
| session | `business_execution_events`, `business_executions`, `business_stopped_executions`, `business_usage_events`, `business_usage_sources`, `connections`, `development_usage_events`, `development_usage_streams`, `execution_completion_proofs`, `resource_identity_aliases`, `runner_events` |
| task_runtime | `admissions`, `archive_executions`, `blocked_admissions`, `environment_rebuilds`, `environments`, `resource_identity_aliases`, `unprovisioned_storage` |

## 3. 归属关系与外部资源

| Owner | 归属锚点与必须处理的内容 |
|---|---|
| project | projectId；服务、成员、使用申请、图标、目录、规格／额度与资源政策回执；根记录最后删除。平台 service_plans／task_profiles 保留。 |
| identity／gateway | identity_forwarding 的 project 作用域；服务 ID、项目 slug／namespace、Pod 原 UID；三类路由、限流、允许关系、维护、Pod 身份与项目凭据。平台用户、签名键与全局策略保留。 |
| config／scm | projectId → 版本、定义、配置项与密钥快照；serviceId → 绑定的原 remoteProjectId／路径、所有 Git 令牌与初始仓库。先远端清理并证明，再删绑定，不按同名路径接管对象。 |
| events／api-catalog | 项目或服务 → producers／proxies → event_types／operations；订阅、inbox、deliveries、grants、requests 和分配回执。其他项目的调用／订阅关系明确失效；不删除调用方内容。 |
| release | projectId／serviceId → releases、slots、maintenance、replicas、handoffs、slot_events、traffic_switches；冻结 Manifest／legacy_manifest、蓝绿资源、构建／迁移／私有镜像和缓存。先停止消费者、核对原资源与共享引用。 |
| runtime-environment／agent-runtime | 项目政策、分配、grants、references；通过 builds.payload.sourceProjectId、versions.payload.sourceProjectId／initializerProjectId、creation_requests.request_scope 核对来源。来源不等于平台目录所有权；平台 profiles／images／versions 与别的项目引用不能连带销毁。 |
| task-runtime | projectId → environments、rebuilds、admissions；taskId → archives、blocked/unprovisioned_storage、native/legacy_native 和 workspace；执行 Pod、暂停／失败／终态残留工作盘、PVC/PV 原 UID 与实际存储证明。 |
| dev-session／session | 原 taskId／executionTaskId → 终端／Agent starts、activity、比较、layout、数字采集、Runner 连接、原始事件、业务执行、完成／停止证据；通过 task-runtime／持久来源补全归属，不只查询活跃任务。 |
| business-task | projectId／serviceId → tasks、execution_operations、controls、materials、logs、lifecycles、recovery、finalizations；task/subtask/session key → 消息、事件、projection、homes、cancellations、proofs；停止调度与恢复，销毁原工作盘与执行内容。 |
| data／data-control | projectId／serviceId → resources、task_bindings、spaces、policies、allocations；space/object/task/binding ID → 上传尝试、文件、读写、引用、任务输入、归档、备份／恢复／传输和凭据；按数据库／角色 OID、对象 placementRevision／原 key 清理，实际完成后退额。全局 backend／plan／storage_contract 保留。 |
| resource-access | changes.project_id 的申请、确认、审批、快照与回执；全局 catalog_policies 保留。封审批的写路径与队列重放。 |
| observability | usage_heads.project_id → task_key → sources/pages/events/evidence/projections/snapshots/changes、native captures／steps／repairs、execution pricing／valuation；projectId 的 alerts／visibility。清原文与项目数值明细，平台价格目录保留。 |
| cluster-management | 操作、检查、snapshots 与指标 JSON 内的项目／namespace／UID／task/service 链路；混合平台快照只移除该项目内容，不能整份抹掉其他项目；无法分离的内容阻断。 |
| resources／cluster-control | projectId → records、changes、locks；原资源 ID／taskId → aliases、children、leases、consumers、admission closures、stop proofs／scans、storage fences、安全回执；包含 stopped／retired 残留。namespace 内 discovery 全量分页，未知对象／finalizer／替换 UID／存储未回收都阻断。 |
| provisioning／platform_infra | project.created／release 等迟到 outbox 与各 kind 的 jobs、dedup；按 project/service/task/operation 原身份消除项目内容，不能清其他 owner 的事件／任务。清理自己的 project.deletion-requested 与最小幂等事实须保留足以防重放的摘要。 |

每模块的 resource_identity_aliases 等身份表只允许保留防止旧键复活所需的最小 ID 墓碑／别名，不能保留原始业务材料。各表的 legacy_* 内容随项目归属记录一并销毁。外部引用并非全部可删：原数据库／仓库／卷／私有制品身份不符，或者独占资源仍被其他项目使用时，记录具体阻塞，不把读取失败或远端仅受理删除当作完成。

## 4. 本轮已取得与仍待取得的证据

- 当前全模块迁移可在真实 PG 新装；223 表清单包含 RFC-034 与在制 RFC-036 的 schema，未把并行代码认作已发布。
- project 底座 12 项定向用例通过；旧库升级、严格确认、权限、原子 outbox 回滚、四状态、并发、单调修订、内容触发器、租约接管、恢复和最后删根已有证据。其他 owner 的物理资源仍须分别实现并验证。
- config／identity 已新增本 schema 的 `deletion_fences`，封写后由原操作清除全部本项目内容；最小身份墓碑不含配置值、密钥或原始业务材料。config 的历史快照、identity 的令牌准入与跨实例屏障已有真实 PG 定向证明。
- resources 新增 `deletion_fences` 和 `deletion_identities`，最小记录／task／consumer 原 ID 防止根记录及台账清除后的旧键写入；12 个内容表全部聚合盘点，间接归属和历史不受既有 2000 条视图上限影响。实际 apply 使用跨实例共享咨询锁，seal 等全部在途退出后持排他锁关闭；普通台账停止和观测继续，退休后所有迟到内容写阻断。
- resources 的 `deletion_stop_receipts` 只保存操作、原 Pod／节点 UID、停止摘要与来源时间；在保存 ACK 前不释放项目停止保护。`deletion_volume_receipts` 只保存原 PVC/PV 与供应器位置、物理回收摘要和时间，不保存文件、容器配置、原生输出或凭据。原供应器位置供元数据清理后的实际目录复核使用，属于最小物理清理身份；不能用其存在代替 probe／CSI 来源证明。
- cluster-control 的项目 Pod 保护对普通、init 和临时容器逐项核对；需要原节点新鲜 Lease、终止状态和原 UID/resourceVersion CAS，未知／失联／同名替换均阻断，不强删其他 finalizer。卷清理固定原供应器后才删除原 PVC；Pending 原 PVC 首次供给属于已确认范围，已固定 PV 的替换 UID 或位置不被重新认领。全部消费者与数字排空须由所属 owner 先证明，相关平台组合尚未开启。
- 台账 seal 比较原记录归属和期望；其他 owner 关闭消费者或追加停止扫描仍在这些原记录范围内，不能把运行状态／时钟当作新资源。新增原记录、改变物理目标、外部项目引用和未登记表仍阻断。资源物理端口须另行确认原实例保护、停止、实际回收与复盘，当前尚未完成原 Pod／工作盘的实际组合。
- cluster-control 的命名空间 owner 已按 discovery 的真实复数名读取所有分页，追踪原 UID 认领链，同时盘点关联全量 PV；Namespace 只在前序证明和子对象清理完后带原 UID 正常删除，等待 API Server 原实例消失，不清未知 finalizer。当前全链路仍未开放，假 API Server 的用例不能替代实际供应器证明。
- 编排 HTTP／工作器底座已接入可选的完整参与者装配；平台尚未提供全部 owner，因此产品仍不暴露永久删除入口。其余 owner 的物理回收、全链路组合、删除 UI 和真实资源对账继续；不能以本清单或底座成功代替完整删除验收。

## 5. 后续 owner 候选（2026-10-01）

- api-catalog 的五个内容表全部由直接及代理／操作／服务间接归属盘点与清除。新 `deletion_entities` 保存最小原 ID 映射，`deletion_fences` 保存操作／世代／确认修订及是否验证完成。其他项目对本接口的授权失效、待审申请失效，但原理由、申请者与裁决历史仍归调用方。
- resource-access 清理 changes 的全部申请、审批、快照和领域回执；catalog_policies 保留。`deletion_identities` 固定旧申请所属项目；`deletion_work` 仅存原 changeId、projectId、backend PID、世代、退出状态及恢复摘要，防止实际回调仍在运行时误判排空。退出字段和清理受 SQL 触发器保护，不能凭 raw UPDATE／DELETE 清掉在途事实。
- 两个新 owner 的失败 seal 均持久化 scope_verified=false，重复调用或普通 retry 不会冒充成功。只有 project 验证的新确认材料和新世代可以重新比较尚未完成的范围。
- 明确标记本批内容盘点为 metadata。集群对象以 UID 为 sourceIdentity，当前 spec／内容摘要另保留于 identity。未分类旧项按物理来源保护，不允许把消失或替换的原来源重新认领；实际供给的物理清理仍由所属 owner 证明。

API／资源申请批已发布部署，详见 acceptance/api-resource-deployment.md；不表示剩余 22 方清理、平台装配或实机回收完成。

## 6. 事件和平台投递来源候选（2026-10-01）

- events 内容为 producers／event_types／subscriptions／inbox／deliveries，以及持久实际推送 deletion_work；直接和原 ID 关系同时确定生产方／消费方，清除本项目内容及本来源派生投递。其他项目订阅配置原文和其他来源内容保留，失效订阅由原 owner 暂停。
- deletion_entities／deletion_links 只保留原 ID、serviceId／slug 与项目关联；deletion_fences 保存原操作、世代、确认修订和 scope_verified。内容表新增未知种类或遗留关系不可识别时盘点失败。
- deletion_work 保存原 deliveryId／backend PID／世代及 Pod UID／containerID／Node UID／nodeName；deletion_process_stops 保存四项原身份和停止摘要。不保留事件载荷、handler 路径、trace、错误正文。队列租约或连接消失不代表实际工作退出。
- 项目 seal 排空所有原双端 shared 准入，并等待实际回调 finally 或完整原容器停止恢复。platform 保护实际平台投递 Pod、保留外部 finalizer；原容器已停摘要先持久化，全 Pod 停止且无待恢复事实后才能释放本 owner 保护。
- 实际投递运行在共享平台 Pod，其停止恢复由专用 process port 提供；events 不拥有独立项目物理存储。metadata 汇总不能冒充项目卷、数据库、仓库或镜像回收。其他 owner 和原资源回收必须各自证明。

最新定向结果和真实 PG／独立 Bun 子进程／假 API Server 的区别见 acceptance/events-owner.md。当前候选尚未发布部署，完整物理资源清理继续。

修订最终候选完整门禁 4643／143 skip／0 fail、30329 断言，37 个源码／测试／配置指纹一致；43 路径候选的前后端内存类型检查通过。精确发布和 Pod UID 源字段部署仍需接续，本内容 owner 回执不能替代其余物理 owner 的证明。

events 已发布部署，精确 SHA／六项 CI／运行时源字段和原资源身份保持见 acceptance/events-deployment.md。

## 7. 算力分配与项目构建凭据候选（2026-10-01）

- 本项目内容为 project_compute_policies 与 allocation_receipts，完整聚合包括全部历史回执。profiles／profile_revisions／profile_credentials／credential_versions／profile_tests 等共享目录和最小退休身份保留；未知新内容表阻断盘点。
- 两个内容表的数据库触发器按原 projectId 取事务 shared 咨询锁，seal 取排他锁等待实际提交；分配 operationId 原归属不可重写，根消失后仍由最小 deletion_identities 阻止借旧 ID 写到其他项目。该写入事务没有外部副作用，不拿连接中断替代原生消费者排空。
- deletion_fences 保存原项目、原操作、世代、完整确认修订与 scope_verified。确认变化持久封闭，旧重试不能变成功；新完整确认及原操作更高世代才能刷新。清理只由正式 project 许可端口授权，并在等待原写入后重新核实。
- 项目算力启动解析、开发套餐解析、新策略／分配及构建凭据签发核对 project 的真实可用性。Registry ForwardAuth 每个请求都核对原签名 push scope、请求目标和 blob mount 的来源，删除后未到期旧构建凭据不能继续用于平台底座或 /v2 探测；共享管理员凭据也不能写入已封闭的项目仓库。
- 签名口令不落库、不复制到删除材料。凭据关闭只证明未来请求的准入，不证明此前已放行的上传结束或 Registry 物理 blob 已回收；原构建、上传、镜像引用与共享底层 blob 的停止／回收仍由 runtime-environment 和存储 owner 提供真实来源。

算力批已精确发布 `333e631ddfaac5b34ec44ee8d7fcd2fa7de420c0`，六项 CI 36783829899 成功；2026-09-30T22:34:14.745Z 本机八组件部署完成，agent_runtime/0009 实际应用，原项目资源 UID 与 Runner 摘要保持。详见[部署回执](acceptance/compute-deployment.md)。正式全链路仍关闭。

算力候选完整用例运行 4663 pass／143 skip／5 fail（4811 tests、933 文件、30499 断言、959.04 秒）；五项失败落于并行修改的开发容器直接写入／准入检查，未作为全仓通过。22 个冻结源码／测试／配置指纹保持，算力全部新回归包括缺失许可的拒绝与回滚通过；改动覆盖 98／98、所有改动生产文件加载，精确候选后端与 console 类型无诊断。完整 check 的 lint 也被并行在制测试的未使用导入阻断；本批精确 lint／结构通过。按精确候选清单继续发布并等精确 SHA 的六项 hosted CI，不提交并行在制源码。永久删除全链路仍关闭。 详见[算力候选回执](acceptance/compute-owner.md)。

## 8. 同标识重建与原事件来源（2026-10-01）

events 不再以可复用 slug 推断项目归属，旧最小 slug 记录保留但不能拦截新 UUID 的生产方。原 producer/type/event/subscription/delivery 与 project/service ID 不可改写，未知归属拒绝；旧内容恢复和同名新根的合法生产分别验证。gateway 为全部已观测工作负载保存原 Pod UID，旧服务／开发无损回填，旧业务从实际 Pod 重列，原删除事件不能移除新 UID。identity/platform 在固定事件受众验签后核对原 release/task 及实际 Pod，再核对原项目准入；HTTP 读取正文前固定原调用者，v1 迟到正文不能重新按编码授权给新 UUID。

候选完整 check 4694 pass／143 skip／0 fail、46 内容指纹保持，原失败与修复、模块层／真实 PG／签名与 FakeK8s 证据边界见[来源验收](acceptance/original-event-source.md)。来源准入不能代替消费者停止、原卷与外部仓库／镜像回收，完整永久删除继续。

原事件来源批 `25d0f545` 已精确发布、六项 CI 成功并于 2026-10-01T00:26:27.670Z 实际部署；controller 原 Pod UID 索引先核对 35 项，再升级 auth/events，原 22 Namespace／48 Pod与PVC／19 PV 保持。真实服务域两版入口和缺失／伪造来源拒绝已核对，详见[部署回执](acceptance/original-source-deployment.md)。这是来源身份校验，不能据此退额或报告原生消费者、存储及项目永久删除完成。
