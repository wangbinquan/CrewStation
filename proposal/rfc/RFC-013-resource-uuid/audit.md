# RFC-013｜资源身份现状核对

> 日期：2026-09-20。CrewStation 源码基线 `207cc4af777e4c5dee22439a7b8ba4793485b4b0`；开工 fetch 后 `main == origin/main`。
> agent-workflow 只读参照基线：本地 HEAD `908922c4d3e2c7f582dc987fdb8e174600259c41`；未 fetch、未修改该仓库。
> 范围：表定义、ID 生成／Schema、相关用例层、API／客户端、Manifest、Runner 及命名派生。未查询运行数据库内容，未宣称实机迁移通过。

## 1. 已有完整随机 ID 的资源

`packages/kernel/ids.ts:1-13` 的 `newId(prefix)` 返回 `<prefix>_<32 hex>`；随机部分来自 `Bun.randomUUIDv7()`，没有截短。`packages/contracts/ids.ts:3-22` 按前缀与长度校验，并未校验 UUID 的版本和 variant 位。

| 资源 | 当前形式与证据 | 目标处理 |
|---|---|---|
| 项目／服务 | `newId('prj'/'svc')`；`modules/project/application/createProject.ts:25-28` | 统一完整 UUID 序列化；slug、namespace 和 service identity 独立保留 |
| 用户／OIDC 提供方 | `usr_`／`idp_`；`modules/identity/application/bootstrapAdmin.ts:39`、`modules/identity/application/oidc/providerAdmin.ts:47` | UUID；登录名与 IdP subject 保留为业务／外部键 |
| OIDC 外部身份关联 | `uid_` 加 UUIDv4 的 hex；`modules/identity/adapters/persistence/drizzleOidcRepositories.ts:40-48` | 纳入生成器与迁移，不能误称当前都是 UUIDv7 |
| 发布／切流 | `rel_`／`tsw_`；`modules/release/application/publish.ts:28`、`modules/release/application/switchTraffic.ts:36` | 发布身份及引用迁移，tag／commitSha 保留 |
| 任务／子任务 | `tsk_`／`sub_`；`modules/task-runtime/application/createEnvironment.ts:58`、`modules/business-task/application/subtaskLaunch.ts:71-80` | 覆盖任务环境、业务任务、父子引用、runnerRef、历史及队列载荷 |
| Agent／终端 | `agt_`／`pty_`；`modules/dev-session/application/nativeTerminals.ts:27-28`、`modules/dev-session/application/agents.ts:35-37` | 持久 ID 和运行帧按 ID 迁移；原生 CLI sessionId 不重新分配 |
| 数据资源／任务数据绑定 | `dat_`／`tdb_`；`modules/data/application/serviceData.ts:18`、`modules/data/application/taskBindings.ts:31` | 标识与引用迁移；真实数据库对象名保留 |
| 出站条目／申请、API 申请 | `egr_`／`egq_`／`req_`；`modules/egress/application/requestEntries.ts:22-37`、`modules/api-catalog/application/requestAccess.ts:25` | UUID；域名是属性；API 申请的 operationKey 还需迁移 |
| 事件实例／投递／订阅 | `evt_`／`dlv_`／`sbs_`；`modules/events/application/produceEvent.ts:21-32`、`modules/events/application/registerRelease.ts:35` | ID 自身和仍按名称保存的 producer／eventType 一起迁移 |
| 算力测试／告警／源码会话凭据 | `pft_`／`alr_`／`cred_`；`modules/agent-runtime/application/profileWrites.ts:30`、`modules/observability/application/alerting.ts:15`、`modules/scm/application/sessionCredentials.ts:15` | 完整 UUID；不改变告警去重键与凭据内容 |
| 集群快照／检查／运维操作 | 已调用标准 `randomUUID()`；`modules/cluster-management/application/collection.ts:35`、`modules/cluster-management/application/operations.ts:27-52` | 已是完整 UUIDv4；按作者后续确认的 UUIDv7 目标，平台自有 ID 仍纳入迁移 |

## 2. 仍用名称、短键或复合名称定位

| 资源 | 当前主键／定位 | 已核对的实际消费链 |
|---|---|---|
| 服务套餐 | `project.service_plans.name` | `modules/project/adapters/persistence/tables.ts:41-47`；`packages/contracts/api/project.ts:58`；`modules/project/http/catalogRoutes.ts:11-12`；Manifest `service.plan` 为 Slug（`packages/contracts/manifest/serviceSpec.ts:8-15`） |
| 任务／开发资源套餐 | `project.task_profiles.name` | `modules/project/adapters/persistence/tables.ts:49-55`；`packages/contracts/api/project.ts:59`；`packages/contracts/manifest/tasks.ts:31-38`；`modules/task-runtime/ports/platform.ts:15` |
| 算力档位 | `agent_runtime.profiles.name` | `modules/agent-runtime/adapters/persistence/tables.ts:7-20`；`modules/agent-runtime/http/adminRoutes.ts:13-38`；`packages/api-client/resources/computeProfiles.ts:14-50` |
| 档位修订／项目算力引用 | `(profile, revision)` 中 profile 是名称；JSON 策略也是名称数组 | `modules/agent-runtime/adapters/persistence/tables.ts:22-30`；`packages/contracts/api/compute/projectCompute.ts:5-20`；`packages/contracts/taskrunner/beforeStart.ts:80-96` |
| 档位凭据 | `(profile, name)` | `modules/agent-runtime/adapters/persistence/tables.ts:32-38`；`modules/agent-runtime/application/profileWrites.ts:42-53`；写入请求以变量名作 record key（`packages/contracts/api/compute/computeProfile.ts:55-70`） |
| API 代理 | `api_catalog.proxies.proxy` | `modules/api-catalog/adapters/persistence/tables.ts:6-15`；发布按 `getByName` 更新（`modules/api-catalog/application/registerRelease.ts:51-68`）；OpenAPI URL 参数仍是 proxy slug（`modules/api-catalog/http/catalogRoutes.ts:23-26`） |
| API 操作 | `api_catalog.operations.key = <proxy>:<METHOD>:<path>` | `modules/api-catalog/adapters/persistence/tables.ts:17-49`；`packages/contracts/manifest/manifest.ts:71-74`；`modules/api-catalog/domain/apiOperation.ts:34-59`；Grant 与申请共用该键 |
| 事件生产方 | `events.producers.producer` | `modules/events/adapters/persistence/tables.ts:6-13`；`modules/events/application/registerRelease.ts:22-29,42-55` |
| 事件类型 | `events.event_types.event_type` | `modules/events/adapters/persistence/tables.ts:15-58`；定义、订阅、inbox 与 delivery 都存名称；Manifest 订阅按点分字符串（`packages/contracts/manifest/serviceSpec.ts:49-52`） |
| 配置／Secret 项 | `(project_id, env, name)`；版本条目也用 name | `modules/config/adapters/persistence/tables.ts:12-38`；删除路径 `:env/:name`（`modules/config/http/configRoutes.ts:21-29`）；Manifest 按 key 或变量名绑定（`packages/contracts/manifest/serviceSpec.ts:26-36`） |
| 项目模板 | 源码目录名，无独立 ID | `packages/contracts/api/scm.ts:6-11`；`modules/scm/adapters/fs/directoryTemplateSource.ts:16-35`；创建项目的 template 为 Slug（`packages/contracts/api/project.ts:39-49`） |
| 启动前步骤 | `stepId` 接受 1–64 位任意标识，UI 生成 `file-1` 等 | `packages/contracts/taskrunner/beforeStart.ts:25,34-68`；`apps/console/src/features/admin/model/stepDraft.ts:55-56,74-75`；预置步骤写死名称式 ID（`apps/console/src/features/admin/model/profilePresets.ts:30,38`） |
| 服务路由投影 | `gateway.routes.service_name` | `modules/gateway/adapters/persistence/tables.ts:25-28`；应按 serviceId 保存，域名／路由名作为属性 |
| Manifest 内 Agent 档案／输出契约 | name 唯一，未定义资源 ID | `packages/contracts/manifest/tasks.ts:14-38`；须区分源码符号与发布后的执行身份，不能遗漏业务子任务按符号查找的入口 |

## 3. 不能简单去前缀的证据

1. CLI 运维重启对同一 operationId 取 SHA-256 的前 32 hex，再分别拼 `tsk_`、`agt_`、`pty_`。这些不是 UUIDv7，三个类型的后缀还完全相同。证据：`modules/dev-session/application/nativeTerminals.ts:110-119`。迁移必须以类型与完整旧键区分，重启幂等必须改为首次分配并持久保存一组 ID。
2. 平台测试使用 `prj_...0001`、`svc_...0001`，系统执行者使用 `usr_...0000`。证据：`modules/task-runtime/domain/profileTestEnvironment.ts:9-10`、`modules/platform/wiring.ts:70`。不得直接断言它们是合法 UUIDv7，也不得用严格 UUID 校验挡住内部任务。
3. Pod 与 PVC 名称截取 `taskId.slice(4, 16)`；独立 Agent Pod 截 `slice(4)`。证据：`modules/task-runtime/domain/taskEnvironment.ts:100-105`、`modules/task-runtime/application/requestRebuild.ts:32`、`modules/task-runtime/application/nativeExecution.ts:67`。格式变更必须修改新对象派生命名，同时保留已持久化的真实对象名和 UID。

## 4. 有名称或数字，但不是待替换的平台资源身份

| 项 | 证据／含义 | 边界 |
|---|---|---|
| 用户名、IdP subject、GitLab remoteProjectId | `modules/identity/adapters/persistence/tables.ts:8-10,62-70`；`packages/contracts/api/scm.ts:15-24` | 外部登录／远程系统标识保留，平台关系使用自己的 UUID |
| HTTP method／path、环境变量名、事件编码 | `packages/contracts/manifest/serviceSpec.ts:26-51` | 原业务符号保留；资源本身另有 UUID |
| Pod namespace／name／UID、Git ref／SHA、镜像摘要 | 外部系统规定的定位值与内容标识 | 不对 Kubernetes 或 Git 对象做全局名称替换；平台归属关系用 UUID |
| traceId | `packages/kernel/ids.ts:6-12`、`packages/contracts/ids.ts:22` | 32 hex 的追踪协议值；本 RFC 不因实体 ID 格式改变它 |
| seq／revision／version、队列序号、复合关系键 | `modules/session/adapters/persistence/tables.ts:12`、`packages/queue/migrations/0001_jobs.sql:3` | 排序、并发控制或内部关系，不要求给每一行另造资源 ID；成员等关联中的实体引用须是 UUID |
| 单例配置键 | `identity.signing_keys.name`、`auth_login_policy.id='global'`；`modules/identity/adapters/persistence/tables.ts:24-29,73-78` | 不是可按用户名称新建的资源集合；单例可保留稳定内部键，不暴露成资源 ID |
| `db-small` 数据 plan | `modules/platform/wiring.ts:137`、`modules/data/application/serviceData.ts:18` | 当前是固定供给配置标签，未见可选目录的实现；不要伪造一个已存在的数据套餐 CRUD。若作为可选资源对外发布，必须在该模块建稳定 ID |
| 上游 connection、MCP server 名称 | `packages/contracts/manifest/manifest.ts:37-40`、`modules/platform/wiring.ts:301` | 当前声明／协议配置符号；不能据此声称连接目录已实现。后续若成为平台资源，按本 RFC 分配 ID |

## 5. agent-workflow 对照

以下路径均相对只读参照仓库 `/Users/wangbinquan/dev/proj/agent-workflow`：

- Agent：`packages/backend/src/modules/resource-catalog/infrastructure/legacy/agent.ts:15,267`，导入 `ulid` 并分配 `id`。
- Skill：`packages/backend/src/modules/resource-catalog/infrastructure/legacy/skill.ts:35,216`，独立生成 `id`。
- Workflow：`packages/backend/src/modules/resource-catalog/infrastructure/legacy/workflow.ts:39,148,196`，用 `id` 查询，创建由 `ulid()` 分配。
- 工作组：`packages/backend/src/modules/resource-catalog/infrastructure/legacy/workgroups.ts:30,130,164`，按 `id` 查询／分配。

只证明上面四类资源的实现方式，不宣称参照仓库所有资源都已统一，也不将 ULID 称为 UUID。
