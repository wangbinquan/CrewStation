# RFC-039 实施与验收记录

2026-10-14。状态：实现已落入共享 main 工作树；CLI / Bot 双模式和满屏布局已实现，真实验收已开始；新版本部署与贪吃蛇完整发布仍开放。下文按各轮验收时点记录，最新情况见文末追加记录。

## 已实现行为

1. 创建表单根据名称建议可编辑的地址标识，中文和不足三位的英文名称均有合法建议。手工修改后不再覆盖，模板与资源高级选项保留。创建回执确认后直接进入 `/projects/:projectId/provisioning`，不再拦在未保存草稿提示或第二个开通弹窗。
2. 首次交付按真实项目、槽和发布摘要显示阶段；项目开通不等于应用上线。未知、过期、构建中和失败不显示正式应用就绪。项目列表和概览可继续交付；已有开通或发布故障保持恢复入口优先。
3. 首次交付入口进入 `view=guided` 的需求与预览页；左侧「开发」按作者后续反馈恢复为 `view=cli` 的原工作区，需求与预览保留为可选入口。引导页只在发送需求后启动默认 Agent，继续使用真实执行流和预览接口；CLI、文件与历史链接保留。初始失败直接展示保留原工作树的恢复入口；权限无法确认时禁止需求和预览控制写入。
4. 发布前通过统一弹窗确认文件、分支、HEAD、内容指纹和提交说明。后端重新授权并核对任务，Runner 生成 Git 提交，前端重读同一任务的实际干净 SHA 后才发构建。旧 Runner 明确拒绝新命令，保留高级工作区提交方式。
5. 验证需显式勾选，部署代次变化使勾选失效。确认上线前可以选择项目成员或全部登录用户，两者均要求登录；按修订保存访问范围后才请求既有切流流程。范围保存与上线失败分别显示，身份预览只解释策略，不切换登录身份。完成页展示实际读取的版本、地址和范围。
6. 普通用户可提交持久开发者权限申请；管理员在统一弹窗内批准或拒绝。重复待处理申请幂等，审批修订检查、申请记录与 developer 角色授予在原角色锁及同一数据库事务内完成，不可申请 admin 或自批。

## 定向验证

以下测试均执行成功，没有跳过；它们不代表整库门禁通过。

| 命令／范围 | 结果与证明边界 |
|---|---|
| `bun test apps/console/src/tests/firstDelivery.test.tsx apps/console/src/tests/developerAccessUi.test.tsx` | 16 pass / 0 fail / 96 断言；真实页面与 hooks，HTTP/WS 使用确定性夹具。创建接续、刷新、焦点、恢复、权限、验证代次、范围冲突及部分成功、提交后构建、默认 Agent、长列表审批与草稿保留。 |
| `bun test runtimes/task/tests/commitWorkspace.test.ts` | 6 pass；真实临时 Git 仓库验证重命名、Unicode／换行路径、删除、新文件、旧确认重放、并发编辑、已有 index.lock、合并及截断拒绝。 |
| `bun test modules/dev-session/tests/commitWorkspace.test.ts modules/identity/tests/developerAccess.test.ts` | 5 pass / 0 fail / 38 断言；真实 HTTP handler、开发权限检查、严格请求体、服务端身份；identity 使用隔离 PostgreSQL，覆盖重复申请、并发审批、拒绝重提、分页及事务回滚。 |
| `bun test modules/session/tests/workspaceCommitDispatch.test.ts` | 1 pass；旧 Runner 能力拒绝、支持命令预算、浏览器原始流不能伪造提交操作者。 |
| `bun test apps/console/src/tests/i18nParity.test.ts apps/console/src/tests/i18nKeysInCode.test.ts` | 19 pass / 0 fail；中英文键及代码引用检查。 |
| 精确任务文件 eslint | 通过。包括共享文件在当前工作树中的完整内容；未使用自动修复。 |

功能定向用例合计 **28 项**，文案检查另 **19 项**。最新前后端类型检查的本任务文件无报错；全仓仍有范围外类型错误，不能据此声称全仓 typecheck 成功。

原完整路由回归 `projectCreation.test.tsx`、`releaseDelivery.test.tsx` 在模块装载前失败，具体错误为 `Export named 'ExecutionCostVisibilityDtoSchema' not found`，来自并行观测／定价重构。新增 `renderDeliveryHarness.tsx` 只隔离其他 feature 的路由装配，仍加载实际生产页面、hooks 和 API 客户端；不能代替整站测试。既有创建、概览和发布测试的预期已按本次行为同步，待整站恢复后完整执行。

## 浏览器验证

Chrome 打开实际页面组件的独立验收壳，最初标示“实现验收 · 模拟接口数据”，按本次反馈改为“正式组件预览 · 模拟接口 · 未部署”。本机地址 `http://127.0.0.1:51423/`，代码与截图在忽略目录 `.local/first-delivery-implementation/`。

- 创建中文项目，核对自动标识、模板默认项及高级折叠；确认创建后进入独立交付页。
- 验证未勾选不能继续，勾选后进入访问范围确认；身份说明弹窗中未登录访客提示先登录。
- 桌面需求与预览同时展示，发送需求后出现一个 Agent 对话；导航高级分组可展开。
- 390×844 下发布确认及开发页均重排，DOM 实测 viewport/content width 都为 390，无横向溢出。已恢复默认浏览器尺寸。
- 截图：`.local/first-delivery-implementation/guided-desktop.jpg`。浏览器使用模拟 HTTP/WS 和预览页面，未调用真实模型或创建生产资源，不能用此证明端到端实机上线。

### 2026-10-14 导航反馈修正

- 移除常驻「首次交付」导航，保留创建后的独立流程和项目内接续入口。运行与管理放回项目页面列表内，标题使用小号灰字、明确折叠箭头，子项有缩进与竖线；不再复用项目名称标题和顶层列表样式。
- 新增 `projectNavSection.test.tsx`，修复前复现常驻入口和分组脱离列表的问题；修复后含双空间深链接、高亮与试用身份共 4 项通过。与创建／发布／开发者申请相关用例合跑 **20 pass / 0 fail / 114 断言**，日志 `nav-before.log`、`nav-after.log`。首次红测中试用入口文案误写为「预览」，已按既有「版本试用」修正，无生产行为变动。
- 浏览器预览改为直接装载生产 `WorkbenchNav`，桌面子项文字比标题右移 21px；390px 下右移 17px、仍纵向排列，文档宽度等于视口宽度 390px。鼠标和 Enter 均可展开／收起。截图为 `nav-corrected-desktop.jpg` 和 `nav-corrected-390.jpg`，浏览器尺寸已恢复。
- 本次两个 TypeScript 文件的精确 eslint 及改动文件 `git diff --check` 通过。控制台类型检查仍有 195 条范围外诊断，本次文件无报错；完整导航回归仍在装载时受 `ExecutionCostVisibilityDtoSchema` 缺失导出阻塞。日志 `nav-lint.log`、`nav-console-types.log`、`nav-integration.log`。没有重复运行已被并行重构阻塞的全量门禁，也没有提交、推送或部署。

## 完整门禁与阻塞

导航反馈之后，作者进一步指出日常开发页面应保留 CLI。已将工作台「开发」链接由 `view=guided` 改回 `view=cli`；回归从引导页实际点击导航，确认能退出引导且不产生写请求。红测准确复现原 guided 跳转；修复后导航、原生工作区布局及交付相关四个测试文件 **24 pass / 0 fail / 132 断言**，精确 eslint 通过，日志为 `cli-nav-before.log`、`cli-nav-after.log`、`cli-nav-lint.log`。Chrome 点击真实 WorkbenchNav 后显示 CLI 区、创建开发 Agent 会话入口和工具面板，截图 `cli-restored-desktop.jpg`。该验证仍使用模拟 HTTP/WS，不能视作真实 CLI 容器或模型执行验收；未重新执行范围外阻塞的整站门禁。

本轮 `bun run check` 已执行，停在架构检查，共 10 项范围外违规：

- `modules/observability/api/moduleApi.ts` 直接依赖同模块 application/ports，3 项。
- `modules/business-task/application/execution` 和 `modules/business-task/ports` 各有 21 个直接源码文件，2 项。
- resources、observability、dev-session、task-runtime、session 的 `runtime_observation_v2` 新迁移尚未入锁，5 项。

未改动这些并行产物，也未替其他任务锁迁移。identity 的 `0014_developer_access_requests.sql` 已按精确路径入锁并在隔离 PostgreSQL 用例中执行。业务契约金样只读比较发现一个并行 BusinessEventPage.snapshot 新增；本 RFC 的工作台契约不属于该业务面，没有改写金样。共享 `packages/contracts/index.ts` 尾部的并行空行仍会触发 `git diff --check`，未为清理本任务差异改写他人内容。

完整日志保留在 `.local/first-delivery-implementation/`：`full-check.log`、`ui-final-3.log`、`focused-final.log`、`http-final.log`、`i18n-final.log`、`console-types-delivery.log`、`backend-types-delivery.log`、`lint-last.log`、`lint-delivery.log`、`contracts-drift.log`。完整门禁失败后补充的恢复／入口兼容修正已定向回归，未反复执行同一个范围外阻塞的完整门禁。85 个任务 TypeScript 文件的 eslint 通过，最后补充的测试再经精确 eslint 验证；新接口名称没有出现在范围外类型诊断中。

## 后续关闭条件

- 并行重构完成后，通过整站类型、原完整路由回归和 `bun run check`；必要时核对任务候选内容后运行准确提交的托管 CI。
- 构建并更新后端、console 和支持 workspaceCommit 的开发镜像；确认身份迁移实际应用。
- 在隔离验收项目完成真实的创建、Agent 开发、Git 提交、构建、验证、切流及成员／非成员访问全链路，之后才能宣称新手实机交付验收完成。

本轮没有提交、推送、部署或操作共享平台的实际项目、成员权限。交付时本地 HEAD 与只读核对的远端 main 均为 `029a4008383d2d7678bd7c550015bc07578f6984`。共享暂存区已有其他任务大量内容，本轮没有运行暂存或 Git 历史变更命令。

## 追加：CLI / Bot 与空间利用（2026-10-14）

前述“没有操作实际项目”是上一轮结束时的记录。本轮按作者明确要求已创建实机验收项目，以下区分正式源代码、模拟边界浏览器与已部署旧版本。

### 正式实现与定向验证

- 开发页顶部同级 CLI / Bot 聊天切换，首次访问后面板保留挂载。切换保留 CLI 编辑器、布局与未提交内容、Bot 草稿与进行中的发送；离开开发路由仍触发原未保存保护。
- Bot 左侧对话、右侧预览，用户气泡／Bot 正文／执行记录分层；错误展开，连续工具记录收拢。输入支持 Enter、Shift+Enter 和中文输入法保护。首条需求来自持久受理记录，后续真实输入由 `user-message` 事件重放；前端不另存假对话。
- AppShell、模式容器、CLI 和 Bot 都按实际可用宽高伸展。桌面和窄屏工作区内部滚动，聊天输入留在视口中。
- 最新定向 7 文件 **54 pass / 0 fail / 264 断言**，涵盖双模式、Bot、首次交付、原生布局、导航、实际 driver 消息序列及首条输入投影。日志 `.local/cli-bot-acceptance/focused-latest.log`。
- 整站创建／发布／权限和文案 5 文件首次为 **47 pass / 1 fail**：原 `renderApp.click` 不支持 `<summary>`，创建用例点击不到“模板高级选项”。改为真正点击 summary 并新增闭合／展开断言，原创建文件 **14 pass / 0 fail / 113 断言**；其余四文件该次均通过。原失败保留在 `integration-latest.log`，修正见 `project-creation-after.log`。
- 前后端类型、正式 console 构建和 103 个候选 TS/TSX 文件 eslint 通过；后续创建测试小改另行定向检查。`contracts:lock` 报业务契约面未变，无新锁文件变动。
- 本轮完整检查最初因验收壳的未使用变量停在 lint；修正后再次执行，结构、lint、双类型通过，测试最终为 **4899 pass / 177 skip / 675 fail / 27 errors / 35415 断言**，5751 用例／1170 文件、2545.19 秒。失败中有本次导航与高度变更后的旧断言，也有原生 PTY 回显和 PostgreSQL 超时／`CONNECTION_ENDED`；未将全部失败归因于并行任务。该运行未取消、不因 HEAD 移动重启；完整结果保留在 `full-check-2.log`，不能视作整库绿。
- 随后修正 `workspaceHeight`、`adminNavigation`、`adminProjectSpace`、`roleHome` 四份既有回归：锁定一屏弹性高度、项目管理分组的真实展开操作，以及创建后的独立交付路由。四文件 **40 pass / 0 fail / 244 断言**，精确 lint 通过。导航失败后的重叠 act 可能影响后续用例，因此另行执行工作台层复验，不重复运行整库。
- 工作台层首次完整复验为 **1151 pass / 11 fail / 7793 断言**，1162 用例／180 文件。修正 Bot 按钮统一样式和其余旧导航／状态节点／API 分页选择器后，九文件 **73 pass / 0 fail / 574 断言**。首次剩余运行观测接口面失败的路由在当前工作树已存在，独立两项通过，未修改其接口或放宽门禁。日志 `console-tier-final.log`、`console-regressions-after.log`、`platform-surface-focused.log`。随后当前修正候选的完整工作台层终态为 **1162 pass / 0 fail / 7842 断言**、180 文件、109.88 秒，日志 `console-tier-after.log`；没有重跑整库检查，也未将旧整库失败改写成通过。
- 最后正式 console 构建通过。新增测试选择器引起的一条 `HTMLDetailsElement` 类型错误已补泛型，最新控制台类型检查通过；原诊断留在 `console-typecheck-final.log`，修正结果为 `console-typecheck-after.log`，不覆盖旧错误。共享 `packages/contracts/index.ts` 的尾部空行仍使任务路径 `git diff --check` 退出 2，未清理并行内容。
- Mac 原生 PTY 定向仍失败；真实 Runner 诊断观察到没有 setsid、登录 shell 报无作业控制且输入未执行，基础非交互 PTY 探针正常，原因尚未完全关闭。将同一工作树只读挂载到配套 Linux runtime，原「真实 shell 输入、resize、关闭回执」用例 **1 pass / 0 fail / 6 断言**。Linux 定向通过不覆盖 Mac 失败，也不替代实机 CLI Agent 启动验收。日志 `runner-lifecycle-focused.log`、`pty-probe.log`、`runner-pty-linux.log`。

### 浏览器量测（实际 AppShell，模拟接口）

桌面 1728×873：主区 1520×821，工作区 1496×805，预览 926×676；主区 scrollHeight 等于 clientHeight。390×844 初始红例中输入框底部 1012px、文档高 1052px；修正后输入框位于 683.5–803.5px、文档高 844px、宽 390px。窄屏聊天／预览往返后草稿保持。空态自动滚到底部的问题随后修正，待最终浏览器复核。

截图为 `.local/cli-bot-acceptance/bot-desktop.jpg`、`bot-narrow-before.jpg`、`bot-narrow-after.jpg`。预览装载正式组件、使用明确标记的模拟 HTTP／WS／预览，不能当作部署或模型执行证明。Chrome 受限连接中断；原生窗口替代因可能扩大读取其他私人标签页而被自动审批拒绝，未使用替代技术绕过。随后扩展重新出现在清单，但目标 tab 仍在 `Emulation.setFocusEmulationEnabled` 超时，后续实际 UI 复核保持开放。

### 实机开发与已确认断点

以现有 developer 身份从正式控制台创建「贪吃蛇 · Bot 全流程验收」，slug `snake-bot-20261014`，项目 `01a13e16-9a55-7000-be84-b890e02e9b0d`。父工作区 `01a13e1b-b8f7-7000-a8ae-b8b436f56b79` 已正常连接，使用原模板 `5dda08bd59`，新界面候选尚未部署。

1. CLI Agent `01a13e1c-a233-7000-8b71-5f8ef5685cc5` 在受理后 2529ms 失败：`CLI 数字意图不符合实际独立受理`。只读查询原任务并在实际部署内使用原 Schema 解析，证实所有身份、档位、cwd 与输入条件相同，`isDeepStrictEqual` 为 true，但 `JSON.stringify` 比较为 false：PostgreSQL jsonb 键顺序与 Schema 输出顺序不同，旧 `cliPreparation.ts` 使用字符串比较导致误拒绝。此文件已被共享暂存区另一批重构删除，本任务没有恢复或覆盖它。证据 `live-admission-read.json`。
2. 同一项目通过正常 API 请求真实 Bot 开发，Agent `01a13e28-1f85-7001-8d8c-866a4f2abbcd`／执行 `01a13e28-1f85-7000-9bbd-f87c2730056c` 在 `workload-admission` 退出 1，未调用模型。默认算力修订 8 仍指向 `replies-20260923`／`sha256:b46218…`；按 OCI manifest 核对其配置 ID 后直接运行原镜像 `storage-contract 1`，报 `缺少环境变量 CS_TASK_ID`，证明旧 Runner 不支持该启动协议。
3. 已备份默认算力并只修改镜像，原模型、凭据引用及其他内容逐项保持。修订 9 先固定到父工作区已有底座 `sha256:bdb328…`，存储协议通过且平台自测连上 Runner 协议 3；模型步骤前仍因 `Agent 执行参数摘要不匹配` 失败。原失败回执保留，未把连接成功冒充模型通过。
4. 当前后端 image label 的准确源码是 `029a4008383d2d7678bd7c550015bc07578f6984`，其 [GitHub CI 38533629043](https://github.com/wangbinquan/CrewStation/actions/runs/38533629043) 的全部 9 个作业（含 gate／e2e）成功。已按该已提交、已部署源码构建并发布配套 runtime：`snake-029a4008`，manifest `sha256:c9fa8b59a856868ff13c941c0b2e5d46144adb20fde4457f0d7c6138b5d74bdf`。构建上下文为仅用于镜像的 Git archive，未使用共享未提交源码，未切分支或创建 worktree。修订 10 固定该镜像后仍复现摘要错误，证明不能只归因于版本错配。
5. 摘要错误根因：平台自测构造原始 Agent 命令时没有可选 `businessSkills`，Runner 的 Schema 解析补入 `[]`，两侧摘要不同。`businessProbeTurns.ts` 已在受理／摘要／派发前统一调用 `StartAgentCommandSchema.parse`，保留并行 v2 回调。新增缺省字段回归后该文件 **5 pass / 0 fail / 43 断言**，精确 lint 和后端类型通过；新源码尚未部署，不能宣称新镜像模型链路通过。
6. 镜像诊断结束后，按 CAS 正常接口将原默认算力完整内容、原镜像和凭据状态恢复，修订为 11。真实测试 `01a13e3e-6e81-7000-9fd4-32ab07c4da9b` 成功创建 CLI 进程并由模型原样回显标记，最终 `passed`。独立 GET 复读确认 `availability.ready / available=true`，原镜像、内容和凭据状态逐项相等。证据 `profile-restored-verification.json`。这是原配置的平台自测恢复，不代表旧镜像已支持新 Bot workload-admission。

本轮暂未生成或发布贪吃蛇代码，新 UI／后端也未部署。最新 fetch 后本地 HEAD 与 origin/main 均为 `029a4008383d2d7678bd7c550015bc07578f6984`，ahead／behind 为 0／0。发布新界面仍受共享暂存区 696 条其他任务内容的边界限制，已按开发规则 §2 向作者请求明确归属／接管；未自行暂存、提交、推送或替换并行输出。浏览器受限连接恢复后仍需最终复核空态滚动与真正发布链路。

## 追加：Chrome 最终复核与精确提交边界（2026-10-15）

上述浏览器受限与提交授权待定是当时的事实。作者随后明确“允许你使用 chrome 验证”，并要求“重构的由原会话提交，你只提交你自己的，如果有重叠文件允许你一并提交”。本轮按该授权使用 Chrome 扩展重新打开正式组件预览，未使用原生窗口替代方式。

- 桌面 1728×873，主区为 1520×821，输入区底边 832.5px，文档尺寸等于视口尺寸。填写贪吃蛇需求草稿后实际点击 CLI，再回到 Bot，草稿保持，两个模式正常显示。
- 窄屏 390×844，输入区位于 683.5–803.5px，文档为 390×844，空态消息容器 `scrollTop=0`，最终空态滚动修正已复核。聊天／开发预览往返后同一草稿保持，验证后恢复默认视口。
- 点击发送后，实际页面显示用户消息、Bot 富文本段落／列表和折叠的执行记录；该回复明确标注为模拟回复。页面控制台未返回 error／warn。截图为 `.local/cli-bot-acceptance/bot-desktop-verified.jpg` 和 `bot-narrow-verified.jpg`，本机预览保持打开。
- 本轮没有修改生产代码；此前 129 路径候选内容与已验证指纹一致，只有交付文档补记本次结果。因此复用上述控制台 1162 项通过及类型／构建／定向结果，不因补记文档重跑整库检查。

提交使用 `.local/cli-bot-acceptance/publication-allowlist.json` 的 129 个精确文件路径。起点共享暂存区的 696 条路径均在该清单之外，完整保留；共享重叠文件不拆他人修改，独立重构新文件不代为提交。提交前检查发现四个直接引用的未提交依赖：

| 原会话未提交文件 | 本次共享文件的直接引用 |
|---|---|
| `packages/agent-drivers/drivers/usage/meter.ts` | `packages/agent-drivers/drivers/agentRunBase.ts` |
| `packages/contracts/taskrunner/usage.ts` | `packages/contracts/taskrunner/agentEvents.ts`、`packages/contracts/index.ts` |
| `modules/dev-session/ports/agentCalls.ts` | `modules/dev-session/wiring.ts` |
| `packages/contracts/api/observability/runtime.ts` | `packages/contracts/index.ts` |

因此本次精确本地提交不等于一个可独立部署的提交树。后续需在原会话提交其独立重构之后，检查组合版本的依赖、门禁与准确 SHA CI，再部署支持新协议的 console／后端／Runner，继续已有贪吃蛇项目的真实开发、预览、Git 提交、构建和切流。当前未推送、未部署、未发布游戏；旧整库失败及实际环境断点完整保留。

### 提交前并发主干更新

精确暂存脚本在任何索引写入之前检查 HEAD／origin/main，发现引用变化而退出，未暂存本候选。随后只读核对确认原会话已正常提交并推送 `3d7a680af4940daf9ae4aee8fc099ef28a3735c0`：此前 696 条暂存路径已处理，当前暂存区为空，上表四个依赖均存在于 HEAD。129 路径中的生产代码与测试内容指纹未变，只有 STATE 追加了原会话的接力段落，保留原样。此前的依赖阻塞已解除，本次精确提交改以该新主干为基线；继续检查准确候选 CI 与部署条件，不因 HEAD 移动重跑已验证且内容不变的层级。

### 精确提交、Linux 全量与当前发布条件（2026-10-15）

- 本批正式功能提交 `810b062bcc7e30ab6a82d09946943f0c8a843455`：129 个允许文件、2328 新增／120 删除行；路径、提交消息与 Codex co-author 核对通过，批外暂存区保持。独立观测重构及修复由原会话提交。其窄屏修复 `4d8cc2d9` 的 [CI 38699494497](https://github.com/wangbinquan/CrewStation/actions/runs/38699494497) 全部通过；这不是本批组合代码的 CI。当前组合代码 `31011a5c26c13aa03e12fdb08b549a47368d5f23` 另包含原会话日桶修复 `4990a699`，本批功能文件未变。
- Linux 第一轮验收环境缺少原用例所需工具、使用 root 及共享文件挂载，结果 5331 pass／153 skip／155 fail／2 errors；原日志 `full-check-linux.log` 保留，不计为有效环境通过。修正环境后八文件预检 87 pass／0 fail／331 断言。随后一轮遇 Docker/Kubernetes 无响应，未获得完整汇总；已保存不完整结果并停止自有测试容器，未重启 Docker Desktop。
- 最终一轮使用完整共享候选快照、Bun 1.3.13、非 root、UTF-8、独立 PostgreSQL，prepared transactions 开启且 `CS_TEST_REQUIRE=database`。静态检查通过，完整 `bun run check` 自然结束为 **5588 pass／158 skip／25 fail／40465 断言**，5771 用例、1170 文件、1643.48 秒，exit 1。候选对应 `df8fa0fd`，之后原会话仅合入新的观测修复。日志 `full-check-linux-final.log`、回执 `linux-final-receipt.json`。
- 25 项失败均报时限：本批“合并进行中不走快捷提交，清单截断也拒绝提交”超过 5000ms；末段业务／任务回收 24 项超过原 5／15／30 秒预算。没有放宽预算或修改断言。另观察到 Bun 进程 VmHWM 22284956 KiB、Docker VM 内存等待与交换，这只能说明环境压力，不能据此宣称每个失败的根因都已关闭。
- 先前 Ruby 中文路径问题在 UTF-8 下原 12 个独立案例通过；前一轮三个失败文件原测试 20 pass／0 fail／164 断言。实际 501 文件分段诊断全链约 909ms；快捷提交与接口表单原测试两文件 13 pass／0 fail／76 断言，其中快捷提交原用例 687ms。相关日志 `linux-failure-diagnostics.log`、`workspace-commit-timing.log`、`linux-two-seams.log`，不能替代失败的整库结果。
- 已从确切提交 `df8fa0fd` 构建 backend／console／runtime，检查持久存储合同 1、Runner storage-contract、镜像配置 ID 与导入 manifest，准备不可变目标和迁移／八服务材料。没有应用迁移或替换任何平台服务。本机当下观测 0045 已由原会话应用，identity 0014 尚未应用；新发布需刷新包含 `4990a699` 的镜像，不能把旧材料当作当前 HEAD 已部署。
- 真实贪吃蛇父工作区仍 running、preview ready，原模板与项目保留；默认档位仍为恢复后的 revision 11、原镜像与配置、自测 passed／available。新 Bot 未实际生成游戏、未提交或发布贪吃蛇。Chrome 对正式组件的桌面／窄屏及草稿保留验证已经通过；真实项目旧界面曾出现布局读取超时，须在新版部署与保留卷重建后复查。
- 当前没有推送本批。依据开发规则 §3“推之前请在本地把它跑绿”，已请求作者确认是否允许转由当前准确 SHA 的 GitHub gate/e2e 全绿裁定部署；尚无回复。RFC 保持 In Progress，完整真实交付尚未完成。并行 RFC-034、RFC-036 文档在制品保持，未发跨会话消息。

### 作者授权后的正式部署与实机断点修复（2026-10-15）

作者明确回复“允许”，授权按当前准确 SHA 的 GitHub `gate` / `e2e` 全绿裁定部署。已推送 `e3559f0d9b5cc6f547cfb64d53887723b194744a`；[CI 38709534866](https://github.com/wangbinquan/CrewStation/actions/runs/38709534866) 全部成功，unit 1520、console 1162、module 2924、e2e 87 项通过；e2e 条件跳过 65 项，差异行防护 1016/1016。此前本机整库失败记录仍保留。

- 从准确 e355 源码构建三类镜像，存储合同检查通过；数据库完整备份后应用 identity/0014，八个服务正常滚动至新镜像，其他 Pod 设置保持。默认算力修订 12、Runner manifest `sha256:469233f13c26c3871d61b4ac7c0c556d0824676503d01c2b0b9cc4bf09557823`，实际模型与业务探针测试 `01a13ede-3c7a-7000-b84b-307e65ba9512` passed。
- 原项目工作区确认 dirty/unpushed/ahead/behind 均为 0，分支与远端为 `5dda08bd5980cda31eaa02cf686c37ddd10d409c`。保留工作区重建会沿用原镜像，因此通过正式 UI 正常释放后重新打开，得到父任务 `01a13edf-f800-7000-a46d-e38c341e2a1f`。项目和 Git 仓库保留，新工作区连接及预览成功。
- Chrome 真实 Bot 输入游戏需求，CLI / Bot 往返保留同一草稿，随后实际发送。Agent `01a13ee2-6441-7000-a6e3-bea464a298bd` 成功调用模型与 read 工具。实测长工具回执超过 8 KiB，被 Runner 日志行截断后误当正文；现已改为完整协议行、1 Mi 字符有界上限，超限明确失败。真实 ProcessHost 的长 JSON、UTF-8 跨块及超限回归先红后绿。
- 重新打开会话时旧 release mutation 曾继续显示“会话已释放”；现仅无活动会话时展示旧结果，实际释放再创建的页面回归先红后绿。
- 该 Bot 后因原默认算力绑定早期 1 GiB 任务规格而 OOMKilled，未完成游戏。异常容器没有 Agent 结束事件，页面曾一直显示执行中；现每 5 秒对账名册，使用正式 QueryClient 配置验证回到页面恢复失败原因并可发新需求。该问题的回归先红后绿。
- 本次三处修复及相邻行为 6 文件 26 pass / 0 fail / 110 断言。下一步使用现有 2 GiB 开发规格，待本修复准确 SHA CI 通过后部署并继续真实开发、预览、提交、构建、验证、切流；当前不宣称贪吃蛇已经发布。

### 第二轮实机与 MCP 预览授权断点

`c55d1c25387f2bc5225d7fe0241ea73f4da207a1` 的 [CI 38714798459](https://github.com/wangbinquan/CrewStation/actions/runs/38714798459) 全部通过（unit 1523 / console 1164 / module 2924 / e2e 87，0 fail；差异行 10/10），八服务已滚动部署。默认算力先以 1 CPU / 2Gi 验证通过并启动游戏 Bot；同时启动 CLI 时本机 CPU 余量不足，已正常取消尚未调度的该验收 CLI，改用现有 400m CPU / 2Gi / 2Gi 临时存储档位。修订 14 自测 `01a13eff-7612-7000-8abe-df5c66a1c6bb` passed；未改动其他档位或清理其他项目资源。

第二轮 Bot `01a13efc-55c0-7000-86c8-545583181bb5` / 执行 `01a13efc-5590-7000-bbf3-43c34d53e0a6` 已真实写入游戏文件。完整工具输出观察到 35248 字符，保持为工具事件，未再出现截断 JSON 正文。它调用 `operations_read_preview_status` 时得到 403：开发会话令牌白名单缺少已由 MCP 提供的预览接口。此次仅补齐绑定本项目的 GET 预览状态 / 日志和 POST start / stop / restart；真实 HTTP 令牌中间件回归覆盖成功、本项目错误方法 / 未知动作拒绝、跨项目拒绝、无效令牌拒绝，先红后绿。与现有 MCP 工具测试合计 34 pass / 0 fail / 155 断言。修复尚待准确 SHA CI 与后端部署，游戏尚在开发验证中。

### 原生 CLI 实机回执与启动附着恢复

在同一项目通过正式 CLI 页面创建原生会话 `CLI 536db6`，使用修订 14、400m CPU / 2Gi 和 Runner `sha256:6e5bfa4581bf…`。OpenCode 1.18.29 的真实 PTY 输入 `Do not edit files. Reply exactly CLI_BOT_SWITCH_OK.` 后，模型约 9 秒回显 `CLI_BOT_SWITCH_OK`；切回 Bot 后原游戏开发继续，未重复启动 Bot 或中断 CLI。原生更新提示通过 Esc 跳过，没有变更容器内 CLI 版本。

首次附着先于 Runner 内终端创建，曾收到 `terminal … 不存在`，而启动流程就绪后页面不自动重试；点击“重新附着”立即恢复。现补充生命周期 / 启动阶段转变时，对已有附着错误重新请求一次屏幕，不重放输入、不重建终端。启动恢复回归先红后绿；启动、独立执行窗口、附着与模式切换共 28 pass / 0 fail / 160 断言，精确 lint 和控制台类型通过。此修复待准确 SHA CI 与 console 部署后再新建 CLI 验证自动恢复。

### CI 防护修正与新项目模板自测

`99fdda809b48fac296d4212e3dd28e43c9724752` 的 CI 38717264266 全部成功。随后 CLI 修复 `79ecba2ad1f40fdcc6a8be3dccc5fde838fbd93c` 的 console 作业被既有资源状态防护正确拦截：组件内 lifecycle 判断从 4 处增加到 5 处。现统一派生 `processRunning`，启动恢复、可交互性与控制状态共享同一判断，计数降至 2；防护基线同时从 4 收紧为 2，没有放宽规则。失败候选未部署。

真实 Bot 完成游戏时发现 minimal-sample 的 chat 测试硬编码模板 Agent UUID；新建项目分配独立 UUID 后断言失败并使请求返回 502。模板测试现与业务调用共用 `CHAT_AGENT_PROFILE`，新项目身份重映射后不会使用旧 UUID。CLI 启动 / 附着 / 执行窗口、资源状态防护与模板主入口共 38 pass / 0 fail / 194 断言，控制台类型检查通过。模板被仓库 eslint 明确排除，精确 lint 的其余候选无错误。

游戏第二轮 Bot 已完成布局收尾并报告 32 pass / 0 fail、类型检查通过；浏览器已实测计分、碰撞、重新开始、暂停、WASD 与刷新保留最高分。发布和最终修复部署仍待后续实机步骤，不据此提前宣称完成。

### 正式 Git 提交与受保护分支发布断点

游戏布局经真实 Chrome 二次复测：1728×817 文档与 main 高度为 817、标题完整；390×844 文档尺寸为 390×844，棋盘 356×356，方向按钮高 60px，实际点击方向键启动并暂停。游戏测试真实工具回执为 32 pass / 0 fail / 139 断言，类型检查退出 0。模板另外通过正式 materialize 分配独立 ID，再运行生成项目测试：13 pass / 0 fail / 63 断言。

经正式发布确认弹窗核对六项文件并提交，得到游戏 SHA `12450292b0e8438a066391a08f53bcfa511559ed`。GitLab 随后拒绝推送受保护 main；未创建标签，页面保留该 SHA 供重试。只读检查证实 main 的 push / merge access 均为 40、force push=false。根因是 platform 的 developmentSourceControl 把普通 developer 会话凭据接到了发布代推。修复采用上述 SCM 临时发布回调并即时撤销，未修改远端保护规则。

修复相邻 7 文件 48 pass / 0 fail / 324 断言，包含真实 PostgreSQL 写入沿革与封闭准入；发布授权 / 真实 Git 3 pass / 0 fail / 26 断言。真实 GitLab 六项全部通过：先验证普通令牌推 main 拒绝，再验证发布令牌推确认 SHA 成功，读取 GitLab 令牌为 revoked=true / active=false，实际 ls-remote 认证失败。第一轮末项只因 Git 返回 terminal prompts disabled 而非 Authentication failed 文本导致断言失败，补充实际认证拒绝形式并增加 API 撤销状态后第二轮 6 pass / 0 fail / 49 断言。专用 GitLab 测试项目已按测试清理，不影响游戏项目。

`58faaf11dec5fcf6cb29a7adfd1a31fcf1cde94b` 的 [CI 38719381453](https://github.com/wangbinquan/CrewStation/actions/runs/38719381453) 全部成功，但新发布身份修复尚待自己的准确 SHA CI 与部署，贪吃蛇尚未切流。

### 并发 Runner 回复导致开发接口停滞

`946658e7d58f1de9090b9f854adbafad1c13d88b` 的 [CI 38721282235](https://github.com/wangbinquan/CrewStation/actions/runs/38721282235) 全部九项成功，八服务已按不可变镜像部署。新 CLI `01a13f29-1659-7000-a99e-f34788f24773` 的容器实际就绪，但页面仍停留启动阶段，工作区接口出现 502；默认档位修订 15 自测真实模型阶段成功，后续 resume 因环境超时失败，不能宣称档位可用。

实机 PostgreSQL 未重启、没有查询锁阻塞；cs-session 的四条准入连接全部持有未完成命令，Runner 已发出回复。入口把全部帧串行处理，前面的事件等待同一准入池，后面的结果无法完成命令并释放连接；最终触发既有 60 秒事务内空闲超时。修复保持握手屏障和事件顺序，将已校验的命令回复单独处理，并仍纳入原连接关闭时的回调等待。没有扩大连接池、放宽事务超时或绕开项目封闭保护。

真实 PostgreSQL + WebSocket 回归覆盖四个命令并发、事件先到、重复事件去重、成功 / 错误回复及原回调全部退出：修复前超时，修复后 2 pass / 0 fail / 8 断言。整个 session 模块 37 文件 108 pass / 0 fail / 795 断言，包含旧 Runner 身份转换、重连、关闭与删除保护；类型、精确 lint 和结构检查通过。准确 SHA CI、修复部署、CLI 自动连接复验和游戏切流仍待完成。

### 并发恢复实测与发布回调上下文

`5beff15aef2ac681db6ba2150f1d12a58a8dab56` 的 [CI 38724267630](https://github.com/wangbinquan/CrewStation/actions/runs/38724267630) 全部成功。七个后台服务逐个滚动更新，控制台与任务镜像保留准确 946658e7 版本，其余配置未变。连续五轮并发读取会话、工作树、CLI、Bot 和预览，共 25 次真实请求全部 200，耗时 451–1755ms。默认档位修订 15 的重试 `01a13f42-90ea-7000-9904-e104b7bf1aad` 所有真实模型与业务阶段通过，available=true。

继续发布同一游戏 SHA 时，SCM 持有自己的原准入后调用开发回调，替换了 AsyncLocalStorage 中开发方仍然有效的上下文；Runner 推送前正确拒绝并返回 `Original database admission has exited`。组合根现捕获调用方上下文，在 SCM 回调里恢复它执行推送；SCM 自己的准入和即时撤销仍保持到整个回调退出。真实 PostgreSQL 回归同时证明两把锁在推送期间均持有、开发与 SCM 权限不互借、成功与失败都撤销；先红后绿。相邻六文件 36 pass / 0 fail / 278 断言，类型、精确 lint 和结构检查通过。此修复待准确 CI 与部署，游戏尚未上线。

### 未受理发布的恢复入口

`8f94ab22766f0f04388b9c4067906c7025f279d1` 的 [CI 38726249231](https://github.com/wangbinquan/CrewStation/actions/runs/38726249231) 全部九项成功，七后台更新成功。继续真实流程发现：此前 500 发生在打标签和受理之前，但浏览器的已发送意图永久锁住表单，只能反复只读查询，无法继续。

现保持原意图不可编辑，查询所有匹配标签的流程页并重新读取标签；没有记录且没有标签时，提供显式“重新发送相同发布请求”。点击时再次核对，迟到回执直接接回原流程；否则只发送原来完整的版本、SHA、来源、任务与说明。SCM 的固定标签唯一性阻止并发请求产生第二版本。已有记录／标签、读取失败、离线或权限不足均不重发，重发冲突仍保留原意图，刷新必须重新核对。不会自动重发或自动递增版本。

新增回归先得到四项失败，再修复并补充冲突／刷新覆盖；发布准备及交付相邻两文件 28 pass / 0 fail / 173 断言。精确 lint、控制台类型与结构通过；此恢复入口尚待自己的准确 CI、控制台部署与原发布请求实测，游戏仍未切流。
