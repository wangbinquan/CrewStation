# RFC-039 实施与验收记录

> 最新状态：Done · 2026-10-15。正式代码与本机部署、真实贪吃蛇创建至上线链路已验收完成。最终版本 v0.1.1 / 12450292，正式地址 `http://snake-bot-20261014.cs.localhost/`，范围为全部登录用户。文末有完整发布身份与访问验收；以下旧轮次的失败及等待按当时事实保留。

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

### 新部署后的真实 CLI、Bot 与布局复验

后台 8f94ab22、控制台与任务底座 946658e7 的组合上，新建 CLI Agent `01a13f48-1a1e-7000-88ad-c32c2b50f957` / terminal `01a13f48-1a1e-7001-929f-5bda99bdb2c7` / execution `01a13f48-19f6-7000-b2a8-bc2d681a5cc4` 自动附着 OpenCode 1.18.29，无需点击重新附着。通过真实终端输入 `Do not edit any files or run tools. Reply exactly CLI_AUTO_ATTACH_OK.`，模型约 11.3 秒回复 `CLI_AUTO_ATTACH_OK`。CLI → Bot → CLI 后终端历史保留；Bot 未发送草稿往返保留，验收后已清空。

新 Bot `01a13f4b-a087-7000-937a-b7dd1e34370d` / execution `01a13f4b-a05b-7000-afa7-b53d48f76ef7` 使用默认算力修订 15。只读 MCP `operations_read_preview_status` 与 `operations_read_preview_logs` 均实际 completed，不再返回 403；前者 ready / port 3000 / restarts 0，后者 10 条 listening 日志、dropped 0，模型回复 `MCP_PREVIEW_OK`。游戏源码仍为确认 SHA，没有在此只读验收修改文件。证据为 `.local/cli-bot-acceptance/actual-bot-mcp-snapshot.json`、`final-native-evidence.json`、`cli-auto-attached-final.png` 与 `bot-mcp-final.png`。

开发页实际文档 1728×817，main 1520×765，无水平溢出，聊天输入保持在面板底部；桌面双栏与手机聊天／预览切换的先前真实组件证据保持。后台滚动部署期间已打开的预览曾变空白，使用原有“重新加载”后游戏恢复，不能把过程描述为完全无感更新。CLI 原生轮次事件有 `unmatched-event` 时标题保守显示“轮次状态未确认”；连接 connected / sync ready，真实输入与模型回复成功。该观测降级明确记录，不以猜测轮次冒充成功状态。

### 推送完成后的发布准入交接

恢复入口 `507d832d86173e26581eeb2f10746976ab543b54` 的 [CI 38728738482](https://github.com/wangbinquan/CrewStation/actions/runs/38728738482) 全部成功，控制台镜像 `sha256:f46fce95d5fd137bba0411f9cbba5704b1dc959dd9cd3e480435435f8b608759` 已部署。原开发者的 v0.1.1 草稿完整恢复，点击核对后出现手动重发按钮，精确原意图再次发送。

本次 Git 推送后，开发入口仍包住整个发布调用；Release 在开发 shared admission 内取得自己完整的三把锁，被 `Cannot expand an active shared admission` 正确拒绝。现把开发检查／推送与 Release 受理顺序交接，开发方实际回调与锁全部退出后才调用 Release 公共 API；不放宽 persistence 守卫。真实开发模块 + PostgreSQL 回归原实现两项红，修复后 3 pass / 0 fail / 21 断言，证明推送期间原开发锁有效、Release 开始时全部开发回调已退出、发布持有自己的三把锁、封闭来源零命令／零发布，以及发布拒绝如实返回。后续准确 CI、后台部署与实际切流继续验收。

该交接修复与开发删除生命周期、Git 发布、工作区预检、SCM 回调上下文相邻 11 文件合计 38 pass / 0 fail / 915 断言；类型、结构和精确 lint 通过。真实失败尝试的两枚临时发布令牌 683、684 均已 revoked=true / active=false。正式 Bot 手机视口 390×844 时文档同为 390×844，输入框 top 684.5 / bottom 764.5；聊天／预览往返保留真实 MCP 消息，截图 `bot-production-mobile.png`。

### 发布受理成功与本机磁盘恢复

`dd85c40c324fa4a576524c794af75e7c3cc4fcf3` 的 [CI 38730803101](https://github.com/wangbinquan/CrewStation/actions/runs/38730803101) 全部九项成功，七个后台部署到 manifest `sha256:533923ac94a3b763959bca0707b20d285113c807d2bdfee41392513b754e8709`，均 Ready=1。控制台保持 507d832d、任务底座保持 946658e7。实际 v0.1.1 原意图恢复后受理为流程 `01a13f7d-52ea-7000-a386-008b0aba56ba`；等待构建约 3 秒、镜像构建约 11 秒，无迁移命令而明确跳过，候选部署正常就绪。

Chrome 打开实际候选地址 `http://preview.snake-bot-20261014.cs.localhost`，显示贪吃蛇；操作开始、计分到 10、暂停、重开及方向控制通过，最高分保持 10。正式 UI 的人工验证勾选与说明提交成功，流程进入“待确认上线”，确认 SHA 始终为 `12450292b0e8438a066391a08f53bcfa511559ed`。实际发布令牌 685 与此前 683、684 均 revoked=true / active=false。工作区未提交数 0、未推送数 0；本地 origin/main 追踪引用仍为旧模板 SHA，`upstream.ahead=1` 是该缓存引用的比较，不能写成已刷新远端追踪引用。实际发布目标及推送判断均使用确认 SHA 与真实远端。

期间 Docker 虚拟机磁盘耗尽（229G 总量、可用 0），PostgreSQL 因 No space left on device 退出。按准确清单清理本会话五个已停止验收容器、五个无其他引用的测试卷、十一项未部署候选标签、九个自有验证缓存，以及二十三个 8–14 天未用且 unshared/reclaimable 的依赖构建缓存。保留日志与对象元数据；未删除业务卷、活跃容器、正式平台 Pod，未请求重启 Docker 或数据库。可用恢复为约 5.1G，PostgreSQL 自动 Ready，存储合同为 1，随后七后台正常滚动。剩余容量仍低，不能据此宣称容量问题永久解决。证据 `platform-disk-recovery.json`、`post-recovery-platform-ready.json` 及各精确清理清单。

数据库恢复后 Bot 仍 awaiting-input，真实 MCP 历史保留。1728×817 下文档同尺寸，main 1520×765、输入框底边 737.5，正式截图 `bot-production-final.png`。旧预览在恢复后需点击原有“重新加载”才能重新显示，此局限保留。候选截图 `snake-candidate-verified.png`。

上线确认时，自动审批拒绝把“项目成员”扩大到“全部登录用户”并切流，认为此前授权未具体覆盖受众范围。已向作者明确呈现目标版本、访问范围和未登录者仍被阻止的后果，并请求选择；没有通过 API 或其他方式绕过。此段记录时尚未正式切流，页面和原流程保留，后续结果另记。

### 作者批准后正式上线与 RFC Done（2026-10-15）

作者随后明确回复“批准你的动作”，覆盖上一轮具体提出的“将贪吃蛇开放给全部登录用户并正式上线”。本轮在原 Chrome 发布页选择全部登录用户并提交一次上线确认，继续原 v0.1.1 / 原 SHA / 原流程，没有新建版本或绕过验证门。访问策略由 members revision 0 正常保存为 authenticated revision 1；切流于 2026-10-15T12:41:48.524Z 受理，2026-10-15T12:42:01.205Z 正式确认，耗时 12681ms。此前自动审批阻塞已由本次具体授权解除。

| 对象 | 实际身份与终态 |
|---|---|
| 项目 | `01a13e16-9a55-7000-be84-b890e02e9b0d` / `snake-bot-20261014` |
| 服务 | `01a13e16-9a55-7001-a192-f554cdb3301b` |
| 游戏提交 | `12450292b0e8438a066391a08f53bcfa511559ed`，main，v0.1.1 |
| 发布 | `01a13f7d-526c-7000-bff7-15f1eae541bb`，ready / prod |
| 发布流程 | `01a13f7d-52ea-7000-a386-008b0aba56ba`，succeeded，revision 15，15 条事件保留 |
| 正式切流 | `01a13f95-445a-7000-bc68-960cc463ca9c`，route observed / launch complete |
| 目标代次 | `4ed75bc5fe3b00c663a9b793b86a33e32417b715b69514ad878e977331e883db` |
| 正式镜像 | `registry.crewstation-system.svc.cluster.local:5000/snake-bot-20261014@sha256:46f2bb97f53382baafe407c178b17e2e1b6f5eacfe454891fad4920cfb99f360` |
| 正式地址 | `http://snake-bot-20261014.cs.localhost/` |
| 部署与物理实例 | `snake-bot-20261014-green` 1/1 ready；Pod `snake-bot-20261014-green-dc5494fcd-82h4w`，UID `c46b9412-3f4b-4b7e-bc42-439b03f372a5`，Running / ready，0 次重启，实际 imageID 与发布镜像一致 |

正式 Chrome 发布页显示“已完成”“这次发布已确认正式生效”，范围为全部登录用户 / 配置版本 1。正式游戏实际操作开始、计分到 10、暂停、重新开始及方向控制通过；首次交付独立路由按真实槽事实显示创建、环境、开发预览、验证上线已完成，以及“正式应用已就绪”，版本与 SHA 一致。没有新增常驻首次交付导航。

使用正常 OIDC 登录分别取得 dev-developer 与 dev-member 会话，先核对身份，并读取项目成员列表确认后者不是项目成员。负责人和非成员 GET 正式根页均 200，真实返回贪吃蛇标题与棋盘；非成员应用 access.granted=true。未登录浏览器导航（Accept: text/html）得到 302 到正式登录地址，未登录 API（Accept: application/json）得到 401，均不返回游戏。第一次验收脚本未声明 HTML Accept，却期待跳转；实际 401 符合 identity/forwardedRequest 的既有契约，随后明确分别检查 HTML / API 两种语义，生产代码没有为测试改变。

真实工作区复读仍为确认 SHA，未提交数 0、未推送数 0。本地 origin/main 缓存引用滞后的边界保留，不宣称所有 Git 追踪引用都已同步。GitLab main 的 push/merge access=40、force push=false 保持；三次实际发布临时令牌 683/684/685 均 revoked=true / active=false。旧模板 v0.1.0 为 superseded，旧流程 interrupted 的原历史保留；唯一游戏 v0.1.1 流程为 succeeded。

证据为 `.local/cli-bot-acceptance/snake-production-proof.json`、`snake-production-kubernetes.json`、`snake-publish-credential-receipts.json`、`snake-production-final.png`、`snake-release-completed.png` 和 `first-delivery-completed.png`。后台源码仍为 dd85c40c、控制台 507d832d、任务底座 946658e7，各自准确 SHA CI 全绿后部署；本轮只是已部署功能的真实上线与文档收口，没有再次改动或部署代码。验收文档 `2c3093fb81832e8c751207052c691632099d61f4` 的 [CI 38734259928](https://github.com/wangbinquan/CrewStation/actions/runs/38734259928) 九项全部成功。Done 文档本身的准确提交与 CI 另在最终交付中记录。

RFC-039 的 T1–T10 与 FD-01–FD-09 在上述实现、相应层级回归和完整真实发布证据下收口为 Done。原 Linux 全量 25 项超时失败没有改写，沿用作者批准的准确 GitHub gate/e2e 部署门槛。CLI 原生轮次观测降级、升级后预览手动重载以及本机磁盘容量仍是明确保留的运行边界，不等同于此轮已全部修复。

### Bot 旧工具记录重放与回答气泡修复（2026-10-15）

作者指出贪吃蛇 Bot 把 `tool_use` 展示为回答，并要求回答放在浅绿色气泡内。Chrome 在旧 Agent `01a13ee2-6441-7000-a6e3-bea464a298bd` 复现；正常 OIDC 读取原执行 `01a13ee2-63f5-7000-a915-ecb32e67a3ed` 事件，确认 seq 9、20、21、23 的工具信封各被旧 Runner 截成 8192 字符，JSON 解析失败后保存为不含 `raw` 的 `text`。实际自然语言 seq 5、16 均保留原生 `raw`。前轮长行修复 c55d1c25 已阻止新的截断，但验收只覆盖新对话，遗漏了旧历史的展示兼容。

转录投影在合并正文前，仅识别这种旧长度、缺失原生 `raw`、带完整 OpenCode 工具身份头的记录，归入折叠执行记录并保留原文；不改写持久事件，不对普通 JSON、讨论 `tool_use` 的正文或有效原生文本帧做关键词过滤。回答正文、列表和代码统一放入气泡，采用既有浅绿 `--cs-tone-success-bg`；执行记录独立呈现。实现仍属于 RFC-039 已批准的正式 Bot 对话界面修复。

新增回归先红（旧工具污染正文、回答未包入气泡），修复后 Bot、原生 OpenCode 与长行协议三文件 21 pass / 0 fail / 80 断言；相邻历史、执行订阅、开发面板三文件 17 pass / 0 fail / 147 断言。精确 lint、console 类型和结构检查通过。实际旧事件回放得到两条正常回答，四条工具原文完整保留在执行记录。此处记录源码验收，准确 SHA CI、部署及 Chrome 最终结果在后续条目补记。原始证据位于 `.local/cli-bot-acceptance/bot-protocol-*`。

### Bot 修复的准确 CI、本机部署与 Chrome 验收

源码 `dfe67386bc8b5c19d4dff4b639b0e84fa4b54cc3` 的 [CI 38752016566](https://github.com/wangbinquan/CrewStation/actions/runs/38752016566) 九项全部成功，包含 gate 与真实部署 e2e。由准确提交归档构建并核对存储合同 1 后，仅更新 console：generation 309、Ready 1，镜像 manifest `sha256:cac1ed3ad5ba7874c36344d000a62f8baf5ba6fd8da9792aea83f2c32260c1a3`。其余 11 个系统 Deployment 的 UID、generation、镜像保持一致；正式贪吃蛇 Pod 仍为 UID `c46b9412-3f4b-4b7e-bc42-439b03f372a5`，Running / Ready。

正式 Chrome 刷新后，旧 Bot 只显示两条自然语言回答，四条 8192 字符工具原文位于关闭的执行记录内；成功开发 Bot 的八条回答全部使用 `rgb(234, 246, 239)` 气泡，无原始工具信封混入回答。1728×817 下文档宽 1728，聊天容器 clientWidth/scrollWidth 均为 567；390×844 下文档同尺寸，聊天容器 clientWidth/scrollWidth 均为 372，气泡最大宽 340，输入框 bottom 764.5，长回复和 90 处行内代码不撑宽页面。手机检查后已恢复桌面视口，浏览器保留现有 MCP 验收对话；截图中的回复是该历史回合当时的状态，不是重新查询发布状态。

代码围栏包入气泡、普通 JSON 与原生正文不被误分类由本轮渲染回归覆盖。原计划补发一条只读 Bot 测试消息被自动审批拒绝，理由是启动新一轮 Agent 执行需要更具体的发送授权；未发送、未留草稿、未重试或改通道。实际验收改用已存在的三段真实历史，未创建新 Agent。刷新后预览曾空白，点击既有“重新加载”恢复；此前已记录的预览重载边界未在本次扩大修复。

最终证据：`.local/cli-bot-acceptance/ci-bot-bubbles-deployment-gate.json`、`bot-bubbles-deployment-proof.json`、`bot-bubbles-desktop-proof.json`、`bot-bubbles-mobile-proof.json`、`bot-protocol-legacy-after.png`、`bot-bubbles-final.png`、`bot-bubbles-mobile-after.png`。本轮局部回归合计 38 pass / 0 fail / 227 断言；未重跑此前失败的本机整库测试，沿用作者批准的准确 GitHub gate/e2e 门槛。并行 RFC-040 文档在制品保持原样。本条与 STATE 是纯验收收尾，文档提交的准确 CI 另在最终交付记录。

### Bot 重开后回复变化：对话选择恢复修复（2026-10-15）

Chrome 在真实贪吃蛇项目复现：手动选择只读验收 Agent `01a13f4b-a087-7000-937a-b7dd1e34370d` 后，刷新页面自动回到最初失败的 `01a13ee2-6441-7000-a6e3-bea464a298bd`；重新选回验收 Agent，其回复全文与刷新前一致。`GuidedDevelopment` 原先把 `undefined` 传给 `useAgentSelection`，当前身份只有 React state，重挂载或未手动选择时名册重排都会回到第一项。这次证据支持选择丢失，不是模型重新作答或同一条回答被随机改写。

正式 Bot 用 `useBotSelection` 按用户、项目及开发任务在 sessionStorage 记住所选 Agent 身份，空串表示明确选择新对话；默认第一项也锁定身份，轮询重排不换对象。只存身份，不缓存回答或执行事实；刷新仍读取原持久事件。浏览器禁止存储时仍可正常在当前页面切换；已记住的对象不可用时不擅自跳到另一条历史。CLI/Bot 常驻切换及在隐藏 Bot 中完成的启动继续沿用原行为。记忆范围是同一浏览器页签的会话，不承诺跨设备同步。

三个故障回归先红，修复后七文件 46 pass / 0 fail / 293 断言，覆盖刷新、离开再进入、CLI/Bot 切换、新对话、默认名册重排、名册延迟与已结束执行流重放、用户/项目/任务隔离、存储失败和无效值，以及已有工具记录与气泡行为。console 类型、精确 lint、结构检查通过；未重复原本机整库失败轮次，沿用作者批准的准确 GitHub gate/e2e 门槛。准确源码 CI、本机部署和修复后 Chrome 结果在后续条目补记。

### Bot 选择恢复的准确 CI、部署与实机复验

源码 `ab26394a78de75e3550ca852fdcaaca253b9716d` 的 [CI 38839403851](https://github.com/wangbinquan/CrewStation/actions/runs/38839403851) 九项全部成功。由准确提交归档构建 console 镜像，核对存储合同 1 后，使用 resourceVersion CAS 仅替换 console 容器 image；generation 310、Ready 1，运行 Pod `console-6bfcc59db-9qrrr`，UID `8afdf80c-9fbc-42ef-9d1f-0fcbd20375c9`，实际镜像 manifest 为 `sha256:cde5e9c51e1bcfcdcd10a2919992fb2c0fd042b0bb91eb5ec0b1b4084a3abbfb`。同一验收时间窗还观察到七个后台 Deployment 镜像改变；本脚本的前后容器 spec 比对证明自身只修改 console，不将并行变化归入本修复或声称其他系统均未变。

Chrome 正式项目中选中成功开发 Agent `01a13efc-55c0-7000-86c8-545583181bb5`，完整八条回答与部署前逐条对比全文相等。刷新、CLI → Bot、项目概览 → 开发 → Bot 三条实际路径均恢复同一 Agent，八条正文及顺序保持一致；选择新对话后刷新，选择仍为空且没有 Bot 回答。再次选回成功开发对话后，八条浅绿气泡均为 `rgb(234, 246, 239)`，名册仍为原三条 Agent，没有发送或创建新请求。刷新前独立确认输入草稿为空；预览空白时点既有“重新加载”恢复，原预览重载边界未纳入这次修复。

证据保存在 `.local/cli-bot-acceptance/bot-history-before-proof.json`、`bot-history-development-before.json`、`bot-history-after-proof.json`、`ci-bot-history-deployment-gate.json`、`bot-history-deployment-proof.json` 与 `bot-history-fixed.png`。浏览器保留成功开发对话和贪吃蛇预览。本条与 STATE 为纯验收文档提交，准确 CI 在最终交付记录。

### Bot 工具参数与结果详情修复（2026-10-15）

作者反馈执行记录只显示二进制/工具名，实际命令不可见。Chrome 展开成功开发历史的「执行遇到问题 19」复现只显示「调用 bash」。正常 OIDC 只读重放原执行 `01a13efc-5590-7000-bbf3-43c34d53e0a6`，`streamReady.replayComplete=true`，共 203 帧、195 个 Agent 事件；86 次工具调用全部带 input，39 次为 bash。首条真实命令是 `pwd && ls -la && git status && git log --oneline -10 2>/dev/null`，其 output 长 1014。事件保存在 `.local/cli-bot-acceptance/actual-bot-tools-before.json`。本次没有发送消息、创建 Agent 或执行这些历史命令。

根因是 `agentTranscript.lineOf` 投影只保留 `tool.name`，未带入结构化 input/output。正式投影现在保留原 tool；Bot 执行行显示工具名与命令（`input.command`）或参数预览，预览超过 600 字符截为摘要；完整命令、全部输入、返回结果和调用 ID 在既有统一 Dialog 展示，支持原样复制，长内容只限制视口高度、不截断数据。返回 false、0、null 均保留，缺少字段明确写明该记录未保存。工具内容作为纯文本转义，仍不进入 Bot 回答；旧截断兼容及浅绿气泡不变。

三个故障回归先红，修复后 Bot/历史/模式切换/执行订阅七文件 36 pass / 0 fail / 238 断言；文案两文件 19 pass / 0 fail / 37 断言；console 类型、精确 lint、架构检查通过。新增用例包含 80 条记录的末行打开统一弹窗、完整多行命令和长输出、Esc 返回焦点与列表滚动、字段缺失及 false/0/null。未重复原本机全量超时轮次，继续采用作者批准的准确 GitHub gate/e2e 门槛。源码提交 CI、镜像和实机结果随后补记；并行 RFC-040 文档不纳入本提交。

首次源码 `f3d146f2ba231f97997906cee748e672cdef44cb` 的 CI 38843086761 中，static、console、unit、e2e 和三个 module 分片通过；module 1/4 的 RFC-040 `nativeMaterialAdmission.test.ts:25` 在三请求并发重放时读到 ready，而测试预期 preparing，导致该片及 gate 失败。同 SHA 只重试失败作业后 module 1/4 成功，但 gate 下载到了同名的旧失败产物（artifact 12022481279）与新成功产物（12021839801），仍报“分片有失败用例或执行错误”。两次回执和失败原日志保留于 `.local/cli-bot-acceptance/bot-tools-ci-*`，没有删除历史产物或放宽断言。

GitHub 拒绝以历史 SHA 直接 workflow_dispatch（HTTP 422 No ref found）。核对当前 main `8e8bc0724828fc71a381be79159f4f7dab5655ec` 仅多出 RFC-040 四份文档，八个本任务提交文件 blob 全部一致后，启动独立 CI 38844486779，并用该准确提交构建配套 console 镜像；其结果及部署随后记录。独立 run 避免重试产物重名，不将旧 run 宣称为成功。

### Bot 工具详情的准确 CI、部署与实机复验

部署来源 `8e8bc0724828fc71a381be79159f4f7dab5655ec` 的独立 [CI 38844486779](https://github.com/wangbinquan/CrewStation/actions/runs/38844486779) 九项全部成功，包含 gate 和 e2e。第一次失败进一步定位到 `nativeMaterialAdmission.test.ts:25` 的测试替身：并发请求可以先把共享材料发布为 ready，另一个 pin 回调才读取状态，替身无条件要求 preparing 而抛错。这不是 Bot 文件引入的改动；没有修改该用例、放宽断言或将两次失败记录改写为绿色，也不宣称这个并发防护问题已经修复。独立 run 使用独立产物，八个已通过定向验证的候选文件与 f3d146f2 逐 blob 相同。

准确提交归档构建的 `cs-console:rfc039-bot-tools-release-8e8bc072` 导入本机后，核对存储合同 1，以 resourceVersion CAS 仅更新 console 镜像。Deployment generation 311、Ready 1；Pod `console-5897c9498-2vhzm` / UID `5b35601a-c6a2-48b2-91f6-39d055289344` Running / containerReady=true，实际 imageID 为 `sha256:78aa9c68f6e19e0d3c9c0b8129c99ed27633b33bb6be60aa4a86cec5d2b00f61`。同一时间窗的十二个系统 Deployment 比对仅 console 变化，其余十一项 UID、generation、镜像保持。早期部署证明脚本误用 app=console 标签得到空 Pod 列表，随后按 Deployment 的实际 selector 定位 Pod，单独保存运行证明；不将空列表当就绪依据。

正式 Chrome 重放成功开发 Agent，86 条工具详情按钮中有 39 条 bash。短命令 `cd /work && bun test src/game/snake.test.ts 2>&1 | tail -40`、完整输入及 16 pass / 0 fail 输出，与原持久事件逐字一致；另一个 2161 字符多行命令、全部输入 JSON 与输出同样完全相等。弹窗位于聊天日志之外，命令及返回内容仍为纯文本；八条回答与部署前逐条全文相等，八个气泡均为 `rgb(234, 246, 239)`。

独立验收页签用 Enter 打开指定末段工具行，Esc 关闭后焦点回原“查看 bash 执行详情”按钮，聊天 scrollTop 前后均为 2145。390×844 下文档宽 390，弹窗 left=16 / right=374 / top=16 / bottom=828，正文 clientWidth 与 scrollWidth 均为 356，2161 字符命令完整保留；恢复桌面后保存短命令、参数、结果及游戏预览的最终截图。预览仍按既有按钮手动重新加载；未把这个既有边界记为已修复。全程未发送新的模型消息、创建 Agent 或执行历史命令，原用户页签和草稿未被覆盖。

证据在 `.local/cli-bot-acceptance/`：`ci-bot-tools-release-deployment-gate.json`、`bot-tools-deployment-proof.json`、`bot-tools-running-pod-proof.json`、`bot-tools-replay-proof.json`、`bot-tools-browser-equality.json`、`bot-tools-focus-proof.json`、`bot-tools-mobile-proof.json`、`bot-tools-final.png` 与 `bot-tools-detail-mobile.png`。本次纯文档收尾不再次部署；后续文档 SHA 的 CI 与以上已部署来源的 CI 分开记录。
