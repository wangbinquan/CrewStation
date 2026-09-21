# RFC-013 验证与部署记录

状态：Done · 2026-09-21。原库 UUID 升级、登录恢复、浏览器与新旧运行链验收完成；兼容修复 `9a67e12d75e94ea150237470c5a61af91518b508` 已部署并上库，精确 SHA CI `35547465024` 六项全部成功。原始切换和早期阻塞按时间保留，当前结果见最后两节。

## 数据升级

旧库压缩备份已成功恢复到独立 PostgreSQL 数据库 `cs_rfc013_upgrade_20260921`。35 个新增迁移全部成功；再次执行没有待应用迁移。原部署数据库未改动。

- 181 组普通实体／引用字段、309,172 条行引用：非法 UUIDv7 为 0。
- 189,464 条 JSON 引用：非法 UUIDv7 为 0。
- 154,886 份历史快照：原始与规范投影的来源摘要全部通过，失败为 0。
- 真实数据库回归包含事务失败回退、重复执行、类型与作用域隔离、退役定义、相同旧后缀的独立实体，以及保持原始历史 JSON。

本机完整演练日志：`/private/tmp/cs-rfc013-upgrade-rehearsal-final.log`、`/private/tmp/cs-rfc013-upgrade-columns-final.log`、`/private/tmp/cs-rfc013-upgrade-json-final.log`。这些是本机证据，不作为仓库中的永久数据备份。

## 兼容边界

| 边界 | 使用范围 | 规范身份与保留事实 |
|---|---|---|
| 业务 `/v1/business-tasks` | 已部署旧业务调用，按服务和发布解析 | 固定到 UUID，v2 与管理 API 不按名称查询 |
| Runner 协议 2 | 已认证旧 Runner、固定旧档位镜像 | 启动别名预先持久绑定；接收帧规范化；发送命令映射回原进程；保存原始事件 |
| 旧浏览器／MCP 令牌 | 验签后解析旧资源 claim | 得到当前 UUID，并继续检查当前成员／权限 |
| 旧比较引用 | 原有带作用域的比较链接 | 经明确适配器解析，新的比较记录使用 UUID 与有效期 |
| Manifest v1 | 原始发布事实和编辑器升级预览 | 保留原文与旧摘要；运行读取规范投影；应用升级只改草稿，正常保存 CAS 继续生效 |
| 旧物理资源标签 | 已存在 Pod/PVC/Secret 的恢复与检查 | name、UID 和原标签保持，平台关联按 UUID；新建物理名称使用完整 UUID |

项目 slug、API method/path、事件 code、环境变量 bindingName、Git SHA、Trace ID、Kubernetes UID、IdP subject 等遵循各自协议，不属于名称主键。上游 connection 等尚未建立资源目录的声明符号保持原协议，不能据此声称目录已实现。

## 镜像和启动验证

控制面候选 `cs-control-plane:rfc013-20260921-2`，任务候选 `cs-task-runtime:rfc013-20260921-2`，工作台候选 `cs-console:rfc013-20260921` 已构建；镜像构建包含共享目录中已完成的 RFC-014 页面输出，其提交归属已询问作者，未擅自提交其他任务文件。

旧任务镜像实际读取 `CS_RUNNER_TASK_ID` 的前缀别名，新镜像实际读取 `CS_CANONICAL_RUNNER_TASK_ID` 的标准 UUIDv7，二者都通过无网络容器验证。新容器的别名在创建前绑定到同一任务，数据库内不另建旧格式任务。新档位在协议 2 中获得独立兼容符号，重连后仍映射到同一 UUID。

## 完整门禁与发布

最终候选 `bun run check` 通过：**1,937 pass／5 skip／0 fail**，326 个文件、1,942 条用例、12,165 个断言，369.25s。日志 `/private/tmp/cs-rfc013-check-final.log`。静态部分包含结构检查、ESLint、根和工作台两次 TypeScript 检查。

完整覆盖率对当前工作树（含未跟踪新文件）进行防护审计：379 个生产文件，2,887/2,965 行（**97.4%**），未加载文件和门槛违规均为 0。标准工作树防护与 `git diff --check` 同样通过。数据库测试使用专用 PostgreSQL 端口 63764，没有对当前部署数据库运行测试建库或清空。

5 个跳过项：开发 OIDC 模式下独立的非管理员登录用例、未启用的 kubeconfig 真实集群用例、OpenCode 原生模型状态验收、Claude 原生模型状态验收、仅 Linux 任务镜像可用的 Ctrl+C 用例。新旧 Runner 镜像的配置读取和真实 WebSocket/跨副本命令链分别已运行，不能以它们代替上述原生模型验收。

本轮浏览器用例连接的是切换前的活动部署；新工作台候选通过了组件与路由回归和镜像构建。实际 UUID 升级后的浏览器与运行态验收、提交 SHA、远端同步和精确 SHA CI 尚待完成。RFC-014 并行文件的交接问题尚未收到作者答复，公共暂存区为空，不擅自提交该任务文件。


2026-09-21 发布交接：作者明确授权由 RFC-014 任务将两个 RFC 一并提交上库；联合清单为 650 个文件，共享输出完整保留。本次仅发布代码，不部署本机，因此 T13 的实际数据库切换及升级后的运行态验收仍未完成。候选代码与已通过完整门禁的源码一致；提交和精确 SHA CI 记录在联合发布后回填。

2026-09-21 代码发布完成：联合实现 73aa132、端到端布局测试补正 a1b87a1 已上库；[CI 35543847392](https://github.com/wangbinquan/CrewStation/actions/runs/35543847392) 六个作业全部成功。共享文件包含两个任务的完整输出。T13 的本机实际升级与运行态验收仍未执行，RFC-013 保持 In Progress，不把代码发布等同于数据库部署完成。


## 正式切换记录（2026-09-21，Asia/Shanghai）

用户再次明确授权部署、提交。重新 fetch 后，本地与远端同为 `12e5b1b2bfce05f85eeb24b632565356aba14185`，其 [CI 35544271321](https://github.com/wangbinquan/CrewStation/actions/runs/35544271321) 六项全部成功。与已构建候选比较，生产源码只有历史 Manifest 文件的空行差异；其余后续变化为文档和布局验收用例。

切换先暂停 9 个控制面 Deployment，保持所有项目 Pod／PVC 原位；停写后备份 `/private/tmp/cs-rfc013-cutover.dump`，7,648,049 字节，权限 0600，SHA-256 `ab43d3eecdc0596e7a422717ead5db73f953c659418fab80b1160f8912e06abf`。`kubectl exec -i` 的目录校验流未正常退出，改用独立 PostgreSQL 17 容器完成目录检查、完整归档读取及恢复到专用核验库，三步均成功。备份及本机日志须保留，不能用旧库回退覆盖恢复服务后产生的新写入。

正式迁移 Job `crewstation-migrate-rfc013` 成功，35 项迁移在同一升级流程完成。恢复写入前的实测结果：

| 核验 | 正式库结果 |
|---|---|
| 原有数据数量 | 76 张表逐一对照最终备份；仅迁移记录表从 70 增至 105，其他表数量不变 |
| 普通身份与引用 | 181 组字段、309,982 条行引用，非法 UUIDv7 为 0 |
| JSON 引用 | 190,275 条，非法 UUIDv7 为 0 |
| 历史来源及规范投影 | 155,697 份摘要全部通过 |
| 重复迁移 | 待执行迁移为 0 |
| 原物理资源 | 26 个项目 Pod、12 个 PVC 的名称与 UID 全部保持 |
| 原在线 Runner | 4 个全部重新连接，平台关联为 UUID；持续心跳和原序号恢复成功 |

原来已有 7 个离线的协议 1 Runner；备份与升级后环境状态计数相同。它们仍明确报协议不匹配，不属于本次新回归，也不能计为已恢复。协议 2 旧镜像继续按显式兼容入口连接，移除兼容入口前应先完成其正常更新。

8 个核心 Deployment（console、cs-api、cs-auth、cs-controller、cs-session、cs-events、两个 MCP）均已恢复原副本数。控制面为 `cs-control-plane:rfc013-20260921-2`，工作台为 `cs-console:rfc013-20260921`；后续新任务使用集群仓库的 `crewstation/task-runtime:rfc013-20260921-2`。当前数据迁移已生效，不能把它描述为仅在副本演练。

### 登录恢复前的阻塞（历史记录）

开发登录器 `crewstation-dev-auth` 启动时用已有管理员密码播种本机 OIDC，但数据库原有策略已关闭密码登录，因此收到 `403 /auth/login：用户名密码登录已被管理员关闭，请使用公司身份登录`，尚未 Ready。核心服务健康不代表用户登录旅程可用。专用验收浏览器的现有可见页面正常请求 `/v1/me` 均为 401。

读取并暂存专用浏览器管理员会话的操作被自动审批以“缺少特定会话凭据读取授权”为由拒绝，未执行。作者已被询问是否授权使用仓库内置 `CS_PASSWORD_LOGIN=force-on` 临时恢复：启动读此配置的 cs-auth 与 cs-api、让开发登录器完成初始化，随后移除开关并再次确认密码登录关闭。授权尚待回复，不自行修改该策略或签发替代会话。

T13 仍缺登录恢复后的浏览器与新建运行实例验收，T14 不作 Done 收尾。正式核验日志为 `/private/tmp/cs-rfc013-live-columns.log`、`/private/tmp/cs-rfc013-live-json.log`、`/private/tmp/cs-rfc013-live-counts.log` 和 `/private/tmp/cs-rfc013-physical-verified.json`。


## 登录恢复与运行验收（2026-09-21）

作者明确回复「授权」后，临时启用仓库内置 `CS_PASSWORD_LOGIN=force-on`，让开发登录器完成播种；随后将 cs-auth／cs-api 的该环境变量恢复为切换前状态。九个应用 Deployment 均为 1/1，开发登录器 `/readyz` 返回 200。正常浏览器 OIDC 登录返回用户 UUID `01a0c12a-de09-7005-b0f9-d55a8676540b`；登录策略再次确认 `passwordLoginEnabled=false`、`forcedOn=false`。没有读取或持久保存浏览器会话凭据。证据：`/private/tmp/cs-rfc013-login-recovery-verified.json`。

升级后真实浏览器用例 **41 pass／1 skip／0 fail，393 assertions**，覆盖工作台与管理页、中文／英文、明暗主题和 1280／390／320px；跳过的是未配置的独立非管理员登录。日志 `/private/tmp/cs-rfc013-live-e2e.log`。

### 历史快照引用兼容修复

创建档位时，数据库写入成功，但详情查询遍历上线版本遇到早于 RFC-001 的 `stub/echo` 快照（没有 `compute` 字段）而返回 500。仅修复 `releaseQueries.deployedComputeReferences`，只收集显式 `{ kind: 'profile', profileId }` 引用；保留原始快照，不给早期 stub 自动指定默认算力。新增真实 PostgreSQL 回归先复现同一 TypeError，再验证查询结果及原快照不变。发布模块 7／7、连同档位身份用例 9／9 通过，修复可执行改动行 3／3 覆盖（100%）。

七个控制面服务已更新至 `cs-control-plane:rfc013-20260921-4`（Docker SHA-256 `7c9097095b6f7a0d08ade162211fd225fffb4fc6c66aa7bb34e6ff189910d99a`）。工作台仍为 `cs-console:rfc013-20260921`，开发登录器保留健康的 `rfc013-20260921-2` 进程；后者不使用此次发布查询。所有应用均为 1/1。

### 档位创建、改名、复制与实际运行

通过正常 OIDC 浏览器调用真实 API：创建／复制均返回 201，改名返回 200；资源和子资源均为 36 字符小写 UUIDv7。默认的 1 核／2 GiB 套餐因本机 CPU／内存余量不足而无法调度，记录失败并清理专属临时档位；最终改用现有 UUID `01a0c12a-de0c-7004-98d6-74e668d7e755` 的 100m／512Mi／1Gi 套餐，未更改全局默认或现有业务实例。

| 实际运行 | testId | taskId | 结果 |
|---|---|---|---|
| 新档位、新 Runner 镜像 | `01a0c153-7193-7001-a8b6-2e11a6216127` | `01a0c153-753e-7000-b27d-a7a6258f2c5f` | passed；步骤 34ms、终端命令 1ms |
| 复制档位、新 Runner 镜像 | `01a0c153-951a-7001-be0d-6cedffb9a69d` | `01a0c153-98de-7000-ba9e-5537cf82d60b` | passed；步骤 86ms、终端命令 2ms |
| 复制档位改用固定旧镜像 | `01a0c153-acc2-7000-bd52-036a359cf1de` | `01a0c153-b09e-7000-92ff-6065ac1d5005` | passed；步骤 78ms、终端命令 20ms |

新镜像摘要 `c27f51e281f0ec0c9006362bb4d05f849f22e7e4bd249c53dbf75349df2a2b7e`；旧 `rfc008-scroll-20260920` 镜像摘要 `1afe7bbad507de9aa23f36e7a2be07049e2da4de4d98a335ef4173a3357147b9`。每次均完成拉取镜像、握手、UUID 步骤和终端探测，得到 `UUID_STEP_OK` 与 `UUID_RUNTIME_OK`。旧镜像经兼容入口运行，不能用测试 DTO 中的规范协议号代替镜像本身的旧协议版本证据。

原档位 `01a0c153-7193-7000-bb40-214845d0d50d` 改名后保持 ID、修订 1 及步骤 ID；副本 `01a0c153-951a-7000-a4a3-9ea0ad192dd8` 的档位、步骤和凭据 ID 均独立，复制凭据仍已配置。两个档位最后 DELETE 返回 204，测试环境全部为 released，临时 Pod 已由任务生命周期回收。失败试跑的本任务档位同样已删除。完整回执在 `/private/tmp/cs-rfc013-live-smoke-results.json`，容量不足试跑单独保留在 `/private/tmp/cs-rfc013-live-smoke-capacity-results.json`。

### 配置按 ID 的真实写入与删除

在既有专用验收项目 `01a0c12a-de0c-7011-9767-361603923342` 创建唯一测试绑定，定义 UUID `01a0c152-9168-7000-bc43-094ef111d373`，开发／生产取值 UUID 分别为 `01a0c152-9168-7001-b008-809c77a5f982`、`01a0c152-917a-7000-a828-d30c4a513204`。改展示名保持定义／取值 ID 和变量绑定不变；开发值更新不改变生产值，旧版本记录保留原名称及引用。过期版本返回 409，名称代替资源 ID 返回 400；两个临时取值最后按 UUID 删除并返回 204。定义及版本历史按产品规则保留。证据：`/private/tmp/cs-rfc013-live-config-results.json`。


### 最终本地候选与逐项结论

历史快照补丁的最终完整门禁：**1946 pass／5 skip／0 fail，1951 tests、327 files、12261 assertions、302.05s**；结构检查、ESLint、根／工作台类型检查全部通过，修复行防护 3/3（100%）。日志 `/private/tmp/cs-rfc013-final-recovery-check.log`，独立覆盖率产物 `coverage/rfc013-final/`。源码校验和在门禁前后相同。此轮含共享工作树中下拉样式任务的 8 项用例；该任务源码不随本次兼容补丁提交，也未部署到工作台。此前未配置数据库和正确管理员身份的共享门禁失败仍保留，不能替代本轮结果。

| 编号 | 结论与证据 |
|---|---|
| ID-01 | 完整 UUIDv7 生成和严格 Schema 通过；跨模块旧库全量映射核验、线上目录与本次新建／复制对象均符合格式。`packages/kernel/ids.test.ts`、`packages/contracts/ids.test.ts`。 |
| ID-02 | 套餐同名独立、改名沿用 ID；算力改名不变修订／步骤／凭据，复制子资源独立。`modules/project/tests/catalogIdentity.test.ts`、`modules/agent-runtime/tests/profileIdentity.test.ts`，另有上述实机链。 |
| ID-03 | 套餐、模板及项目副本声明使用 UUID，重试不改变指向；模块创建／开通回归与本次按任务套餐 UUID 启动通过。`modules/scm/tests/templateIdentity.test.ts`、项目及 provisioning 用例。 |
| ID-04 | 固定修订、凭据、步骤、测试、授权及默认引用迁移通过；复制凭据配置保留，旧／新镜像实测执行同一规范资源引用。档位身份及项目授权模块用例通过。 |
| ID-05 | 目录、发布、改名、退役不破坏 operationId 或 Grant；路由与网关模块用例通过。`modules/api-catalog/tests/catalogIdentity.test.ts`、`apiCatalogModule.test.ts`。 |
| ID-06 | 生产方、事件类型、订阅、收件、投递迁移通过；新旧业务输入去重投递到相同 UUID，事件及投递模块回归通过。`modules/events/tests/eventIdentity.test.ts`。 |
| ID-07 | 定义与两环境取值分离、改名／删后重建／并发声明／历史快照回归通过；上述实机配置 CRUD、409 与 400 均符合契约。`modules/config/tests/configIdentity.test.ts`。 |
| ID-08 | 全模块旧库事务升级、失败回滚、重跑、类型与作用域隔离通过；正式库 35 迁移、原数量／关系／摘要与备份对应。`modules/platform/tests/resourceIdentityUpgrade.test.ts`、`packages/persistence/identity/identityMigration.test.ts`。 |
| ID-09 | 历史 Manifest、旧业务 v1、比较链接、令牌、Runner 2 有显式适配并通过回归；原在线 4 Runner 续接及固定旧镜像运行通过；早期 stub 快照读取补丁保留原含义。兼容入口与剩余旧进程见上表。 |
| ID-10 | 原 26 Pod／12 PVC 的 name、UID 保持；原在线 Runner 续接成功。保卷复用、旧标签、已受理恢复指纹由 `modules/task-runtime/tests/legacyPhysicalIdentity.test.ts` 回归，正式切换未重建原卷。新任务物理名称含完整 UUID 的无连字符表示。 |
| ID-11 | console／CLI／MCP 按 ID 传参、路由和缓存；可读标签、长 UUID 与窄屏由组件／协议／实浏览器用例通过，旧比较链接失效不会跳到别的 Agent。 |
| ID-12 | 本地完整门禁和变更行防护通过；本机迁移、登录、浏览器、真实运行与清理证据分别记录。兼容修复 `9a67e12` 的精确 SHA hosted CI 六项全部成功，见下节。 |

本次没有重复执行 Claude Code／OpenCode 的真实模型交互、Linux Ctrl+C 专用场景或破坏性重建原业务工作卷；这不应被上述终端探测或数据库核验冒充。原来离线的协议 1 Runner 仍保持原有不兼容状态；当前支持的旧协议 2 有明确适配与通过证据。


## 最终发布结论

兼容修复 `9a67e12d75e94ea150237470c5a61af91518b508` 已正常推送到 main；[CI 35547465024](https://github.com/wangbinquan/CrewStation/actions/runs/35547465024) 的 static、unit、module、console、gate、e2e 六个作业全部成功。发布后 fetch 确认本地与远端一致。修复提交只含 `modules/release/application/queries.ts` 和其回归用例；本机实际控制面镜像包含此相同源码。

T1–T14 和 ID-01…ID-12 已逐项核对，RFC 三件套与索引标记 Done。最终文档提交包含共享 STATE 中已有的并行下拉框任务接力，完整保留原输出；该任务的产品和测试文件不在本次提交范围。文档收尾未改变通过门禁的生产候选，不重复运行本地完整门禁；最终文档 SHA 的远端 CI 在交付时单独核实。
