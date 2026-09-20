# RFC-012｜实施与验证

| 编号 | 工作 | 状态 |
|---|---|---|
| T1 | 现状、规则、并行改动、RFC | 完成；只在现有 main 开发，保留所有并行输出 |
| T2 | 契约、迁移、CAS 策略和项目目录 | 完成；含默认可见性与平台默认可见约束 |
| T3 | CLI／headless／业务／发布／能力说明接线 | 完成；可信项目 ID、项目目录与默认解析 |
| T4 | 开发容器套餐及恢复校验 | 完成；新建读项目套餐，恢复受理重查 |
| T5 | 管理员配置入口、项目下拉、中英文 | 完成；草稿、字段错误、CAS 冲突与重读确认 |
| T6 | 定向回归、浏览器、完整门禁 | 定向与构建预览通过；96 条相关回归、构建预览与部署后真实页面/API 验收通过；共享门禁收口与远端 CI 待完成 |

本任务实施授权来自当前会话“实现该功能”。提交、部署、实机验收与 CI 的实际结果在完成时逐项记录，不把本地代码通过称为线上已生效。


## 2026-09-20 本地候选验证

- 后端和契约定向：`projectComputePolicy.test.ts`、`computeProfileModule.test.ts`、`profileLaunch.test.ts`、`projectDevProfile.test.ts`、`businessTaskModule.test.ts`、`releaseModule.test.ts`、`projectCompute.test.ts`，合计 46 条；真实 PostgreSQL，以 `CS_TEST_REQUIRE=database` 运行。首次两条断言问题（Drizzle thenable 与既有错误种类）修正后相关 10 条复验通过，新增可见性 Schema 验证通过。
- 工作台定向：项目配置、档位选择器、两类 NativeWorkspace、历史 Agent 创建、sessionNavigation，合计 27 条通过；包含项目空清单提示。
- 生产构建通过；浏览器使用该构建与 HTTP 测试夹具，真实操作授予 `private-large`、设为项目默认并保存 `coding-large`。实际 PUT 携带 revision=0，回执 revision=1。1440／390／320px 下 document.scrollWidth 等于 viewport，表单无溢出、控制台零错误。**此记录只证明构建与界面交互，不是部署验收。**
- 本机临时记录：`/private/tmp/crewstation-project-compute-backend.log`、`-backend-recheck.log`、`-ui.log`、`-final-focused.log`、`-browser.log`、`-build.log`；浏览器截图同前缀 `-1440.png`／`-390.png`／`-320.png`。
- 新增迁移 `0004_project_compute_policies.sql` 包含策略表与可见性字段；仅在本任务尚未提交、尚未应用阶段补齐可见性 ALTER 后更新自身锁条目，没有改写已发布迁移或其他会话的锁条目。旧库升级与数据库默认可见约束已有真实数据库用例。
- 没有改业务请求／Manifest／Runner 协议契约面；因此没有更新业务契约金样。
- 与 RFC-008 会话合用一个完整候选门禁，避免重复整仓执行；已通过 arch、lint、console typecheck。根类型检查先修复本任务测试字面量类型，随后被并行 RFC-010 新测试类型阻塞，已交给其所有者；全量测试自然完成为 1814 pass／5 skip／17 fail（1836 tests、295 files、270.89s），日志为 `/private/tmp/cs-rfc008-scroll-tests-final.log`。本任务相关三个既有断言（删除引用文案、创建体新增 defaultVisible、项目目录参数）已同步后定向 23 条通过（含新建表单实际选择默认不可见），本任务相关定向合计 96 条；其余并行故障由各会话处理，不把该次全量结果称为绿色。
- `tests/e2e/platformCapabilities.test.ts` 新增项目算力页及真实 API 验收；当前共享集群未部署本候选，该条和并行新增集群管理页在旧部署上失败，不能把本地回归称作线上通过。
- 随 RFC-011 共享候选部署，control-plane 镜像 `rfc011-20260920-1` 的摘要为 `d96f8ea4caf7b368dd45a191af0468d41c96c31640d39cf653d0cc21e575fb25`，console 同 tag 的摘要为 `8fa99b7f753165811d91e1d1ff2005f196c59f0d950f95481378e579c8fa98de`；cs-api 与 console 均 ready=1。
- 部署后真实 E2E：`CS_TEST_REQUIRE=e2e,database bun test tests/e2e/platformCapabilities.test.ts --test-name-pattern '管理员能打开指定项目的算力授权页'`，1 pass／0 fail／6 assertions。验证真实管理页面与 compute-policy、compute-profiles 两个 GET；未修改任何真实项目配置。日志 `/private/tmp/crewstation-project-compute-e2e.log`。此证据补齐旧部署的本任务失败项，不能代替整仓最终门禁。
- 按 RFC-011 会话协调，本批精确提交 74 个本任务独占源码／测试／三件套文件，不独立推送。以下 20 个含并行贡献的完整共享文件交接给 RFC-010／011，必须保留全部内容后一同收口，不能只推本提交：

```text
STATE.md
apps/console/src/app/router/routeTree.ts
apps/console/src/features/admin/i18n/en-US.ts
apps/console/src/features/admin/i18n/zh-CN.ts
apps/console/src/shared/api/queryKeys.ts
apps/console/src/tests/computeProfileFixture.ts
modules/agent-runtime/api/moduleApi.ts
modules/agent-runtime/tests/computeProfileModule.test.ts
modules/agent-runtime/wiring.ts
modules/dev-session/application/agents.ts
modules/dev-session/application/nativeTerminals.ts
modules/platform/wiring.ts
modules/release/application/pipelineDeploy.ts
modules/task-runtime/application/createEnvironment.ts
modules/task-runtime/application/rebuildInspection.ts
packages/api-client/resources/catalog.ts
packages/contracts/index.ts
proposal/rfc/README.md
tests/e2e/platformCapabilities.test.ts
tools/arch/migrations.lock.json
```

RFC 保持 In Progress；完整共享候选收口和精确 SHA CI 证据仍未完成。
