# RFC-018｜设计

状态：Draft · 2026-09-22。落位依据 `docs/engineering/repository-structure.md` v0.4。本 RFC 只删代码、改网络策略、加一处启动重下发；不新增模块，不新增跨模块 import。

## 目录

- [1. 现状证据](#1-现状证据)
- [2. 删除清单](#2-删除清单)
- [3. 网络策略](#3-网络策略)
- [4. 数据](#4-数据)
- [5. 接口与契约变化](#5-接口与契约变化)
- [6. 失败模式](#6-失败模式)
- [7. 测试策略](#7-测试策略)
- [8. 落位对齐与偏离](#8-落位对齐与偏离)
- [9. 文档回填](#9-文档回填)

## 1. 现状证据

2026-09-22 在工作树核对：

| 事实 | 位置 |
|---|---|
| `egress` 模块：条目、申请、被阻记录、`policyFor`、`forwardHttp`；38 个文件 | `modules/egress`（L3，依赖 project） |
| `policyFor`（下发给出站代理的有效清单）在模块外没有消费者；`task-runtime` 的 package.json 声明依赖 egress，代码里不用 | `modules/task-runtime/package.json` |
| 组合根装配模块、挂 HTTP 路由与迁移集，导出 `egress` | `modules/platform/wiring.ts` |
| 三条项目命名空间策略：默认策略出向仅 DNS＋系统命名空间；任务策略对 `dev-session`／`business-task` 出向全放行；构建策略对 `component=build` 出向全放行；开通步骤 `ensureNamespace` 下发三者；三者名字登记为平台保留资源 | `packages/k8s/objects/cluster.ts`、`modules/platform/wiring.ts` |
| 参考代理注入 `CS_PLATFORM_API_URL` 时经 `/internal/egress/http` 请求上游，否则直连；内置 GitLab EventProducer 与最小样例不用该通道 | `integrations/reference-api-proxy/src/main.ts`、`src/platform/egressTransport.ts` |
| 契约金样不含任何 egress 契约，删除不触发 `--breaking` | `packages/contracts/tests/golden/contractSurface.json` |
| 迁移运行器只校验磁盘上存在的迁移，库里多出的模块记录被忽略；`migrationCoverage` 用例以锁文件为准 | `packages/persistence/migrations.ts`、`modules/platform/tests/migrationCoverage.test.ts` |
| 开通事实带项目 `kind` | `modules/provisioning/api/steps.ts` |
| 告警类型持久化为文本列，`egress-blocked` 无生产者 | `modules/observability/adapters/persistence` |

## 2. 删除清单

| 单元 | 删除 | 改动 |
|---|---|---|
| `modules/egress` | 整个目录 | — |
| `modules/platform` | `createEgressModule` 装配、`m.egress.http`、`m.egress.migrations`、`egress` 导出、package.json 依赖 | 保留资源清单中的策略名按 §3 |
| `modules/task-runtime` | package.json 依赖 | — |
| `packages/contracts` | `api/egress.ts`、`api/egressHttp.ts`、`api/requests/page.ts` 中 `EgressRequestPage*`、`index.ts` 导出 | `AlertTypeSchema` 去掉 `egress-blocked` |
| `packages/api-client` | `resources/egress.ts`、`createApiClient` 装配与导出 | — |
| `packages/k8s` | 按 §3 | `projectNetworkPolicy` 注释与（方案 A 时）出向规则 |
| `apps/console` | `features/admin` 下 `EgressEntriesSection`、`EgressEntryForm`、`EgressRequestRow`、`EgressRequestsSection`、`useEgressRequestReview`、`AdminEgressPage`、路由与导出；`AdminRequestPanels` 出站页签；`AdminTodos` 出站卡；`adminNavigation`／`managementSearch`／`requestPageState`／`queryKeys` 的出站项；`admin.egress*`、`admin.egressRequests*`、`admin.requests.egress`、`admin.todo.egress`、`nav.admin.egress`、`logs.alerts.type.egress-blocked` 等 i18n 键；相关用例与夹具 | `/admin/egress` 重定向到 `/admin`；`RequestSearch.tab` 只剩 `api`；`admin.line2`／`admin.denied.description`／`topBar.toAdminHint`／`admin.profile.test.outcome.network-blocked` 去掉「出站白名单」 |
| `apps/cli` | `installConfig` 的 `egressMode`／`egressAllowlist`、`installPlan.egressCheck`、`installInitialize.seedEgress`、`operatorSetup` 默认值及用例 | 解析器对 `egress` 键保持忽略 |
| `integrations/reference-api-proxy` | `src/platform/egressTransport.ts`、`main.ts` 的通道分支、README「出站白名单」段落、对应用例 | `platformApiUrl` 仍读取，不再用于上游 |
| `tests/e2e/platformCapabilities.test.ts` | `/admin/egress` 行 | 申请审批一行的能力说明 |
| `tools/arch/migrations.lock.json` | 四条 `modules/egress/...` 条目（手工删除；testing.md §7 允许，提交说明写明） | — |

## 3. 网络策略

按 proposal §4 Q1 的裁定二选一。

方案 C（建议）：

- `packages/k8s/objects/cluster.ts` 新增 `integrationEgressNetworkPolicy({ namespace })`：`podSelector` 为 `crewstation.io/workload=service`，`policyTypes: [Egress]`，`egress: [{}]`，名称 `crewstation-integration-egress`。
- `ensureNamespace` 只在 `facts.kind !== 'DigitalWorker'` 时下发它；数字人项目不下发。`projectNetworkPolicy`、任务与构建两条策略不变，只改注释（去掉「临时、待出站代理」）。
- 保留资源清单新增该策略名（只对接入容器项目登记）。

方案 A：`projectNetworkPolicy` 的 `egress` 改为 `[{}]`；删除任务与构建两条策略；重下发时同时删除现有命名空间里的两条旧策略。

两种方案共同部分：

- **启动重下发**：`modules/provisioning`（L6）新增一个启动工作器，遍历未归档项目、对每个项目调用现有 `ensureNamespace` 步骤（`k8s.apply` 幂等）；单个项目失败只记日志，不阻塞其他项目与进程启动。组合根把它挂在 `controller` 角色（provisioning 的 workers 已在 cs-controller）。这一步也补上「策略形状变化不能触达存量命名空间」的缺口。
- 网关放行表、身份索引、路由不变。

## 4. 数据

按 proposal §4 Q2 的裁定：

- a：不动库。RFC plan 与 dev-gotchas 记录残留：schema `egress`（三张表＋身份迁移记录）与 `platform_infra.migrations` 中 `module = 'egress'` 的四行。
- b：本机部署后、参考代理重新发布前，停写备份 → `DROP SCHEMA egress CASCADE` → `DELETE FROM platform_infra.migrations WHERE module = 'egress'`；记录行数与备份位置。
- 两种情况下，本机库里若存在 `type = 'egress-blocked'` 的告警行（预期为 0，无生产者），实现时先核对再处理。

## 5. 接口与契约变化

- 删除的路由：`/v1/egress/entries`（GET／POST）、`/v1/egress/entries/:id`（DELETE）、`/v1/egress/requests`、`/v1/egress/requests/page`、`/v1/egress/requests/:id/decision`、`/v1/projects/:projectId/egress/requests`（GET／POST）、`/v1/projects/:projectId/egress/blocked`、`/internal/egress/http`、`/internal/egress/blocked`。全部由 Hono 默认 404 处理，不做兼容。
- `AlertTypeSchema` 去掉 `egress-blocked`（工作台与 CLI 消费的契约，不在业务契约面）。
- 参考代理：无论是否注入平台地址，都直接请求 `GITLAB_BASE_URL`；这是接入容器自己的发布，不改约定表。
- `CS_PLATFORM_API_URL` 约定保留（最小样例的 Agent 对话仍用它）。

## 6. 失败模式

| 情形 | 行为 |
|---|---|
| 平台升级后、参考代理重新发布前 | 旧代理请求 `/internal/egress/http` 得 404，返回 `unavailable`；窗口以分钟计。生产升级说明写明先升平台、再发代理 |
| 启动重下发某个命名空间失败 | 记日志并继续；下次启动重试；开通失败的项目仍可用「重新开通」 |
| 旧链接 `/admin/egress`、`?tab=egress` | 重定向／归一，不 404 |
| 旧安装配置含 `egress` 键 | 忽略，不报错、不输出预检行 |
| 本机库残留 `egress` schema（Q2 a） | 平台不读它；`migrationCoverage` 只看锁文件与空库 |

## 7. 测试策略

开发规则 §5.5：每条禁用／拒绝分支都有用例。

| 位置 | 用例 |
|---|---|
| `modules/platform/tests` | 真实 Hono 路由表：§5 列出的路由全部 404；`migrationCoverage` 现有用例继续通过 |
| `modules/provisioning/tests` | `ensureNamespace`：接入容器项目下发 integration 策略、数字人项目不下发（方案 C）；启动重下发遍历全部未归档项目、单项目失败不影响其余 |
| `packages/k8s` | 策略对象形状（selector、policyTypes、egress） |
| `packages/contracts` | `AlertTypeSchema` 拒绝 `egress-blocked` |
| `apps/console/src/tests` | 导航／搜索／总览／待办无出站项；`/admin/egress` 重定向；`tab=egress` 归一；申请页只剩 API 页签且草稿保护仍有效；日志页告警类型清单 |
| `apps/cli/src/tests` | 含 `egress` 键的配置解析；计划与初始化输出无出站行 |
| `integrations/reference-api-proxy` | 注入平台地址时仍直连上游 |
| `tests/e2e` | 管理页面清单更新；部署后实机复跑 |

删除的用例（`modules/egress/tests`、console 出站用例）随代码一起删；被修改的生产文件按新增代码防护要求达到覆盖门限。

## 8. 落位对齐与偏离

无偏离。启动重下发放在 provisioning（它已拥有开通步骤与 workers）；k8s 对象在 `packages/k8s`；组合根只做装配。不新增 facade，不新增同层 import。

## 9. 文档回填

| 文档 | 改动 |
|---|---|
| `proposal/proposal.md` v0.3.7 | §0.2 新增修订表；R15 去掉「出站受白名单约束」；R52 标 已作废（RFC-018）；§3 全景表「出站白名单」行；§4／§5／§9／§10 中的出站措辞；§8 选型表「出站白名单执行」行标 已作废 |
| `proposal/design.md` v0.3.7 | 不变量 21；§1.2 对象表 `EgressAllowlistEntry`；§2 组件表「出站代理」与部署图；§3 选型表；§4 `EgressPolicy`；§8 出站段；日志页、能力页；§11–12 安装预检／基础组件／初始化／升级表；§13.4 残余风险表；D47 标 已作废，新增 D54「不设出站域名约束（作者 2026-09-22 裁定，RFC-018）」；Q23 标 已关闭 |
| `proposal/plan.md` v0.3.7 | §4 M4 描述；T0.8、T1.2、T1.13、T6.1、T6.2、T6.5、T6.11 文本去掉出站代理；T4.12 标 已作废；AT-07 改写为「无法访问平台管理 API、其他命名空间或宿主资源」；AT-51 标 已作废；AT-16／AT-41／AT-43 文本；§11 矩阵 R52 行；§12 发行状态清单 |
| `proposal/tech-evaluation.md` | E23 行标 已作废（RFC-018） |
| `docs/engineering/repository-structure.md` v0.5 | §1 示意、§5 清单删 `egress` 行与 `task-runtime` 依赖、§5 分层图、§6 cs-controller 行、§13 决策记录；指向 ADR-0008 |
| `docs/adr/0008-retire-egress-module.md` | 模块退役：删目录、手工退出锁条目、schema 处理、依赖边删除 |
| `docs/engineering/implementation-open-questions.md` | I9 标记「2026-09-22 由 RFC-018 关闭」 |
| `docs/engineering/dev-gotchas.md` | 「项目命名空间到宿主机的出站是被网络策略挡住的」按 Q1 改写 |
| `proposal/rfc/RFC-003-workbench-ux-redesign/proxy-egress.md` | 文首加一行「2026-09-22 起由 RFC-018 取代」，其余不改 |
| 集成与模板文档 | `integrations/reference-api-proxy/README.md`、两份接入容器 `CONTRIBUTING.md`、`templates/minimal-sample/CONTRIBUTING.md` 删「出站白名单与被阻请求」 |
| `STATE.md` | 接力段 |
