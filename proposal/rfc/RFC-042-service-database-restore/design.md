# RFC-042 设计

> Approved / In Progress · 2026-10-16，作者明确“按推荐实现”。已核对 `docs/engineering/repository-structure.md` §3–5。

## 模块与所有权

| 范围 | 所有者与层次 |
|---|---|
| 数据库世代、当前生产绑定、空目标与保留事实 | L3 data 的 domain/application/ports/adapters；通过 L2 data-control 的现有供给机制创建真实库与角色 |
| 恢复操作、Job、候选版本和切换编排 | L4 release；复用发布准入、资源归属、维护及执行交接端口 |
| 执行权冻结与写入者停止证明 | L5 business-task，经既有 reverse port 注入 release；不从低层 import 高层 |
| 数据库资源期望与实况 | L1 resources；原 owner 写期望，data-control 写观察 |
| API schema/DTO 与客户端 | packages/contracts、api-client，不依赖业务模块 |
| UI | apps/console 的 service data feature 独立路由、统一 ConfirmationDialog；不增加另一套弹窗 |
| 跨模块装配 | platform/wiring，只调用公开根 API，不直接读写他模块表 |

不新增跨层 facade 或结构例外。原 `DataResource` 保持服务环境逻辑资源身份；新 `database_generations` 保存物理库／角色和供给身份，原有库登记为初始世代；新 `database_environment_bindings` 指向活动世代且含 revision。迁移只登记原身份，不更名、复制或重建原库。

## 对外合同

Manifest 增加可选 `spec.service.databaseRestore`，包含 `command: string[]` 和 `verifyCommand: string[]`，仅接受发布时已审核的固定命令；普通 migrationCommand 不变。命令从镜像启动，不接受用户脚本，恢复 Job 的对象读取身份限原服务对象空间。

管理员 API（服务下独立资源）：

- `POST /services/:serviceId/database-restores`：requestId(UUIDv7)、expectedActiveGenerationId、expectedActiveReleaseId、restoreReleaseId、backupReference。幂等键绑定整份请求摘要。
- `GET /services/:serviceId/database-restores/:id`：stage、revision、source/target 世代 ID、固定镜像摘要、脱敏 Job 观察、验证回执、可操作项及拒绝原因。
- `POST .../:id/retry`：expectedRevision，仅驱动原操作，不修改原输入。
- `POST .../:id/switch`：expectedRevision、confirmationDigest，复核 actor、服务／发布／当前世代和维护影响后持久受理。

不提供任意连接串或 env override API。平台只给恢复 Job 注入目标 `CS_DATABASE_URL`、固定备份引用 `CS_DATABASE_RESTORE_REFERENCE` 与只读原对象访问配置。AW 的 migration 入口显式映射该引用，业务程序校验安装身份／主密钥／备份摘要。业务 verifyCommand 输出版本化 JSON receipt，包含恢复引用摘要、应用 schema 摘要、完成状态与 auto-resume-suspended；平台通过独立 Job 观察绑定目标 UID／镜像／退出状态，应用自报不证明物理库身份。

## 持久流程与切换

`requested → provisioning → restoring → verifying → ready-to-switch → freezing → deploying → switching → completed`。每阶段保存原 operation/request 摘要、资源出生身份、Job UID／镜像、前后 revision 与观察回执；可恢复错误保持所在阶段与错误类别。某阶段未知先 observe，沿原 Job ID 核对，不按超时猜失败；独立观察确认原 Pod 已终态失败后，管理员可在同一恢复操作中明确重试该阶段，追加原 Job UID／退出回执后分配新 attempt ID。目标、镜像、备份和固定环境保持，旧 attempt 证据不覆盖。

1. data 使用恢复操作 ID 派生唯一物理对象名并持久保留，沿资源台账供给。空目标证明绑定真实服务器／数据库身份与原操作；不把同名视为同一目标。
2. release 在新目标运行固定恢复 Job，验证 Job 冷重入只使用原目标、原备份、原镜像；完成后执行独立 verify Job。整个准备期间旧服务及原生产绑定不变。
3. 管理员确认后维持维护闸门，复用现有 migration barrier 冻结执行权并观察所有旧写入者停止；未获得完整证明不得推进。普通发布、数据凭据轮换、生产数据临时授权与服务删除通过 owner 端口看到活动恢复保留。
4. 候选部署明确绑定目标 generationId。先验证候选探针和真实资源绑定，仍维持执行待命与维护。release 保存切换意图，再由 data 对原 generation/revision CAS 提交绑定，随后推进既有路由和执行权交接。没有跨模块事务；失回执沿操作 ID 读回绑定，直到数据、路由和执行权全部对账后才解除维护。
5. 旧槽不会自动重连旧数据库再成为 active。恢复后的回退要求新的明确操作及停写证明，不提供无条件一键旧槽切回。新写入后不能把回退解释为无损。

目标废弃和旧库删除不在第一版；均显示保留状态，沿资源中心明确管理。项目删除 owner 必须纳入新旧世代及未结束恢复，不能遗漏或把在用恢复资源当孤儿。

## 工作卷与业务边界

平台数据库恢复不变更已有业务 Task／Subtask 历史，也不重新产生 Agent 执行。AW 将快照中的 unfinished executions、恢复请求和工作区保留设为 hold，自动恢复暂停。工作卷缺失由 AW 从已验证备份恢复到独立保留卷供人工检查；原卷存在则不覆盖。工作流续跑仍使用 AW 普通业务命令与 ACL，平台不凭数据库恢复状态放行。

## 测试与上线

domain 边界／幂等／revision；真实 PG 多请求竞争、原操作冷恢复、旧资源迁移；resource owner 删除和授权互斥；release 故障注入覆盖每个外部调用前后；错误、秘密与权限用例；UI 深链／撤权／过期确认／返回列表；真实独立服务恢复与切换。先完成全量实现和用例，再集中验证。新增迁移及合同锁留基线；只使用 OpenCode 验证涉及 Agent 的真实流程。现有正式 AW 不作为数据库恢复试验目标。
