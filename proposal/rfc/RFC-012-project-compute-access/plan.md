# RFC-012｜实施与验证

状态：Done · 2026-09-20。功能、共享接线、部署验收与发布验证已完成；历史失败保留在下文，最终结论以“完成核对”为准。

| 编号 | 工作 | 状态 |
|---|---|---|
| T1 | 现状、规则、并行改动、RFC | 完成；只在现有 main 开发，保留所有并行输出 |
| T2 | 契约、迁移、CAS 策略和项目目录 | 完成；含默认可见性与平台默认可见约束 |
| T3 | CLI／headless／业务／发布／能力说明接线 | 完成；可信项目 ID、项目目录与默认解析 |
| T4 | 开发容器套餐及恢复校验 | 完成；新建读项目套餐，恢复受理重查 |
| T5 | 管理员配置入口、项目下拉、中英文 | 完成；草稿、字段错误、CAS 冲突与重读确认 |
| T6 | 定向回归、浏览器、完整门禁 | 完成；96 条相关回归、三尺寸构建预览、部署后真实页面/API 验收通过；共享完整门禁 1864 pass／5 skip／0 fail，包含完整功能的 `a694465` 六项 CI 成功 |

本任务实施授权来自当前会话“实现该功能”。提交、部署、实机验收与 CI 的实际结果在完成时逐项记录，不把本地代码通过称为线上已生效。


## 2026-09-20 本地候选验证（历史过程）

- 后端和契约定向：`projectComputePolicy.test.ts`、`computeProfileModule.test.ts`、`profileLaunch.test.ts`、`projectDevProfile.test.ts`、`businessTaskModule.test.ts`、`releaseModule.test.ts`、`projectCompute.test.ts`，合计 46 条；真实 PostgreSQL，以 `CS_TEST_REQUIRE=database` 运行。首次两条断言问题（Drizzle thenable 与既有错误种类）修正后相关 10 条复验通过，新增可见性 Schema 验证通过。
- 工作台定向：项目配置、档位选择器、两类 NativeWorkspace、历史 Agent 创建、sessionNavigation，合计 27 条通过；包含项目空清单提示。
- 生产构建通过；浏览器使用该构建与 HTTP 测试夹具，真实操作授予 `private-large`、设为项目默认并保存 `coding-large`。实际 PUT 携带 revision=0，回执 revision=1。1440／390／320px 下 document.scrollWidth 等于 viewport，表单无溢出、控制台零错误。**此记录只证明构建与界面交互，不是部署验收。**
- 本机临时记录：`/private/tmp/crewstation-project-compute-backend.log`、`-backend-recheck.log`、`-ui.log`、`-final-focused.log`、`-browser.log`、`-build.log`；浏览器截图同前缀 `-1440.png`／`-390.png`／`-320.png`。
- 新增迁移 `0004_project_compute_policies.sql` 包含策略表与可见性字段；仅在本任务尚未提交、尚未应用阶段补齐可见性 ALTER 后更新自身锁条目，没有改写已发布迁移或其他会话的锁条目。旧库升级与数据库默认可见约束已有真实数据库用例。
- 没有改业务请求／Manifest／Runner 协议契约面；因此没有更新业务契约金样。
- 与 RFC-008 会话合用一个完整候选门禁，避免重复整仓执行；已通过 arch、lint、console typecheck。根类型检查先修复本任务测试字面量类型，随后被并行 RFC-010 新测试类型阻塞，已交给其所有者；全量测试自然完成为 1814 pass／5 skip／17 fail（1836 tests、295 files、270.89s），日志为 `/private/tmp/cs-rfc008-scroll-tests-final.log`。本任务相关三个既有断言（删除引用文案、创建体新增 defaultVisible、项目目录参数）已同步后定向 23 条通过（含新建表单实际选择默认不可见），本任务相关定向合计 96 条；其余并行故障由各会话处理，不把该次全量结果称为绿色。
- `tests/e2e/platformCapabilities.test.ts` 新增项目算力页及真实 API 验收；当时共享集群尚未部署本候选，该条和并行新增集群管理页在旧部署上失败，不能把本地回归称作线上通过；后续部署与复验结果如下。
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

## 2026-09-20 完成核对

### 共享接线与发布

- 本功能独占实现提交为 `5fb7e6c64458993d55d99475ab0139763506fc81`（74 个文件）。上列 20 个共享文件已全部交接完成：`b7fb3e52b585bafc08bac8dd16d15a57007eee5b` 收入 11 个，`b3d8d0ed5e964aa7f7f71fc47bdabf1ced62f1e5` 收入其余 9 个；逐项对照提交文件清单，没有遗漏。
- 收尾时重新 fetch 并核实上述三笔提交均为 `origin/main` 的祖先。它们共同包含项目路由、模块装配、运行链、契约导出、API 客户端、迁移锁、文案及实机用例；原来的“共享接线待完成”已解除。
- 共享完整候选的有效本地门禁为 **1864 pass／5 skip／0 fail，10304 assertions，1869 tests／302 files，228.56s**；结构、lint、两次类型检查通过。原始日志 `/private/tmp/rfc011-recovered-full-gate.log` 已重新核对；共享候选与内容校验记录见 [RFC-011 验收记录](../RFC-011-role-based-home/acceptance.md)。早先的 17 fail 轮次不计为成功，也不删除其记录。
- 包含完整功能的发布提交 **`a6944659310e56b6cbcd16341a02b20b2d07b4da`**，[GitHub CI 35513950300](https://github.com/wangbinquan/CrewStation/actions/runs/35513950300) 已完成：`static`、`unit`、`module`、`console`、`gate`、`e2e` **六项全部 success**。这项证据对应精确发布 SHA，不代表其他会话之后的未发布改动。
- 本次收尾只更新文档，复用功能候选已通过的本地门禁与部署验收；不重复运行完整门禁。文档提交发布后仍单独核对其精确 SHA 的 CI。

### 逐项验收

| 编号 | 结果与证据 |
|---|---|
| PC-01 管理员写、成员读、非成员拒绝 | 通过；[项目策略模块用例](../../../modules/agent-runtime/tests/projectComputePolicy.test.ts) 实测 HTTP 200／401／403／400／409，工作台用例验证保存前身份变化不提交。 |
| PC-02 两项目不同目录 | 通过；同一模块用例中继承项目只见 `public`／`terminal`，显式授权项目只见隐藏的 `private`，项目之间不串用。 |
| PC-03 默认解析与非法默认拒绝 | 通过；项目默认解析、空清单／无默认、终端默认拒绝、未知档位／套餐与重复清单均有模块及 [契约用例](../../../packages/contracts/api/compute/projectCompute.test.ts)。 |
| PC-04 CLI／headless／业务启动拒绝未授权档位 | 通过；项目策略对三类 usage 均拒绝隐藏未授权档位；[开发启动](../../../modules/dev-session/tests/profileLaunch.test.ts) 与 [业务模块](../../../modules/business-task/tests/businessTaskModule.test.ts) 验证可信项目 ID 及拒绝后不创建环境／下发命令。 |
| PC-05 业务重试重新授权 | 通过；业务模块的项目拒绝场景先受理失败，再更新授权并 retry，验证重试重新使用原任务项目解析；固定修订用例验证旧 attempt 不换修订、新 attempt 重新解析。 |
| PC-06 发布检查 | 通过；[发布模块用例](../../../modules/release/tests/releaseModule.test.ts) 验证项目 ID、未授权引用被拒、原因保留且不进入部署；项目策略模块覆盖隐藏档位与项目默认发布解析。 |
| PC-07 开发新建／恢复套餐 | 通过；[项目开发套餐用例](../../../modules/task-runtime/tests/projectDevProfile.test.ts) 验证新建 CPU／内存／存储、恢复候选过滤、检查后改授权／手填套餐拒绝及已删除套餐不回退。 |
| PC-08 CAS 冲突保留草稿 | 通过；真实 PostgreSQL 验证首写和更新的并发 CAS，[工作台用例](../../../apps/console/src/tests/projectCompute.test.tsx) 验证 409 后保留输入，确认放弃后才重读。 |
| PC-09 删除／停用档位的可读错误 | 通过；项目授权进入删除引用检查；[档位模块用例](../../../modules/agent-runtime/tests/computeProfileModule.test.ts) 与开发启动用例验证停用不可用原因、删除后的固定修订缺失错误。 |
| PC-10 未配置兼容与默认可见约束 | 通过；旧库升级保持默认可见，新项目继承平台范围；模块、HTTP 与数据库约束均拒绝隐藏平台默认，把隐藏档位设为平台默认时自动可见且不生成执行修订。 |
| PC-11 中英文、窄屏与表单错误 | 通过；工作台保存／冲突／空／载入／失败状态、可见性切换及实际新建提交均有回归；中英文键对齐用例通过。构建预览在 1440／390／320px 实际操作保存，无横向溢出、控制台零错误。 |
| PC-12 完整本地门禁 | 通过；上节记录的共享完整候选为 1864 pass／5 skip／0 fail，已发布候选六项 CI 成功。 |

验证范围：本机部署后的实机用例确实打开项目算力管理页，并读取真实 `compute-policy`／`compute-profiles`；它没有修改真实项目授权或新建 Agent／开发 Pod。写入规则与运行链分支由真实 PostgreSQL 模块用例覆盖，界面保存由 HTTP 夹具上的构建浏览器验证。CI 缺少 GitLab／任务镜像等环境的项目场景仍有跳过，边界见 [用例防护体系](../../../docs/engineering/testing.md#10-已知的防护缺口)，不把六项绿色等同于所有实机分支均执行。
