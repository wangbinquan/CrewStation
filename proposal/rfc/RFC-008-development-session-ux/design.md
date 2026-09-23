# RFC-008｜技术设计

> 状态：Done · 2026-09-20；作者已批准实施并提交上库。
> 实现 `5252c4c` 已上库；本地门禁、真实恢复与交互、精确 SHA CI 均通过，详见 [验收记录](./acceptance.md)。

## 目录

- [1. 已核对的运行链](#1-已核对的运行链)
- [2. 状态与动作](#2-状态与动作)
- [3. 保卷恢复协议不兼容环境](#3-保卷恢复协议不兼容环境)
- [4. 前端结构](#4-前端结构)
- [5. 草稿与生命周期](#5-草稿与生命周期)
- [6. 测试与部署](#6-测试与部署)

## 1. 已核对的运行链

以下是改造前基线 `6ebd6c7b071d42e87a15f104f778843b66159595` 的定位，实际修复与验收见 acceptance.md。

1. `modules/session/domain/runtimeNegotiation.ts:31–38` 识别旧协议。
2. `modules/session/application/runnerHub.ts:102–108` 在令牌有效后回写拒绝原因，再拒绝 hello。
3. `modules/task-runtime/application/runnerLifecycle.ts:28–43` 将原因写入 `runnerRejection` 和 `message`，故意保留原任务状态、Pod、卷。
4. `modules/dev-session/application/sessionLifecycle.ts:11–15` 只把 message 带给前端，未公开结构化拒绝原因。
5. `apps/console/src/features/dev-session/pages/DevSessionPage.tsx:36–39` 只对 failed 或既有恢复记录显示恢复控件。
6. `modules/task-runtime/application/rebuildInspection.ts:10–12,24–26` 同时拒绝 running 任务和仍存活的 Pod。
7. `apps/console/src/features/dev-session/components/native/NativeWorkspace.tsx:70` 因 Runner 未连而禁用创建；未连原因没有配套动作。

实机旧容器握手持续以 1008 关闭；浏览器 WebSocket 可读历史，因此页面仍能打开。不能将浏览器重连当作运行时升级。

## 2. 状态与动作

新增前端纯状态解析，输入现有 session、浏览器流状态、结构化连接故障、身份和目录加载结果。
输出可读状态、说明、主操作、是否允许创建。显示优先级：恢复中 → 失败 → 释放 → 协议拒绝 → 准备中 → 浏览器连接 → Runner 连接 → 就绪。

- 创建 CLI 只在 running、页面与容器已连、Runner 未收尾、身份可开发、布局已读、档位可用时开放。
- 所有禁用都有可见原因；避免仅依赖 title、颜色、disabled。
- 加载错误与没有记录分开；页面、身份、分支、档位读取均可重试，失败不清草稿。
- `TaskStreamSocket` 增加显式重新连接，保留序号和订阅；关闭旧 socket、清理重连计时器，拒绝在途命令，继续历史读取；不重发已发送命令。
- 连接自动恢复后撤去异常提示；不自动切页签或聚焦，不创建新 task／CLI。
- 活动心跳仅更新 lastActivityAt，不更新恢复检查用的环境修订；状态、握手、套餐和容器变更仍使旧确认失效。
- 保留错误原文、taskId、requestId、阶段与时间。主标题用用户语言，诊断细节集中于环境页。

2026-09-23 修订说明（[RFC-022](../RFC-022-startup-progress/design.md) D7、Q1）：

- **启动中。** 开始开发与重建时，CLI 区整块换成五段步骤条：排队分配容器、容器启动中、检出代码（分支）或替换旧容器、容器已启动等待连接、已就绪。页头芯片显示当前段，此时不再叠连接说明。
- **启动失败。** 停在出错的那一段，「重试」按失败位置处理：检出代码及之前失败，按原分支重新开始开发；等待连接失败与重建失败，打开恢复。

## 3. 保卷恢复协议不兼容环境

复用现有 `GET/POST /v1/projects/:projectId/dev-session/rebuild`、持久队列、controller 和实例检查；不引入另一套恢复接口。

### 3.1 契约

- `DevSessionDto` 增加可选结构化 `connectionIssue`：`code: protocol_mismatch`、实际／要求的协议版本、原始原因、记录时间。
- runtime → dev-session 的现有 EnvironmentView 端口透传所需投影；同层模块继续通过 ports 接线，不深 import。
- rebuild inspection 增加恢复原因（failed／protocol_mismatch）、受影响容器及说明。提交固定该原因，并继续固定 expectedTaskId、updatedAt、Pod UID、PVC UID、套餐快照、requestId。
- 旧失败恢复请求保持兼容；服务端从当前环境核对资格，不接受前端自行宣称协议错误。

### 3.2 受理与执行

1. 检查仅接受原失败环境，或服务端记录了协议拒绝且当前仍未连接的开发环境。健康、仅临时断线、业务任务均不适用扩展条件。
2. 检查原工作卷为 Bound、UID 和归属未变；确认原 Pod 的 UID；执行删除时用 UID 与最新读取的资源版本作为 Kubernetes 前置条件。检查失败只读报错。
3. 用户确认明确说明：替换开发容器、终止其中旧进程；保留原工作文件与提交；不会自动重启 CLI。
4. 项目事务锁内重新核对状态与确认快照，同一 requestId 幂等返回；恢复受理后旧 Runner 不能重新接管。
5. 原 running/creating 环境已经占用的配额转用于恢复，不能重复扣额；原 failed 环境按既有规则申请。补偿只释放本次持有的名额。
6. 控制器只能删除被确认的原 Pod；删除前重新核对当前恢复记录、UID 和允许原因。不能将 `removeFailedPod` 泛化成任意运行 Pod 删除。
7. 使用当前平台任务镜像，以现有恢复方式挂同一个 PVC；不 clone、checkout、reset 或新建卷。保留队列租约和阶段幂等。
8. 新 Runner 握手成功才完成恢复并清除旧协议拒绝状态；失败保留卷与实际原因，允许再次检查。

这是对 RFC-003 保卷恢复资格的扩展，保留 RFC-006“协议拒绝本身不自动删 Pod”的规则。
当前容器升级属于明确操作，不能靠页面访问、轮询或一次断线触发。

## 4. 前端结构

落位遵循 `repository-structure.md` §8，不新增模块、facade 或例外。

| 位置 | 职责 |
|---|---|
| `features/dev-session/pages/DevSessionWorkbench.tsx` | 组合连接状态、固定功能导航与内容 |
| `features/dev-session/components/session/` 与 pages | 首屏状态指引、环境内容、初次开发说明 |
| `features/dev-session/components/native/` | CLI 内部工作区、创建、排布、窗口名册与终端 |
| `features/dev-session/model/` | 连接展示及可操作状态纯函数 |
| `features/dev-session/hooks/` | 生命周期与刷新；原 editor/data hooks 保持稳定 |
| `shared/project/developmentSearch.ts` | 新功能视图 URL 与既有深链兼容 |
| `packages/contracts`／`api-client` | 连接问题与恢复请求契约 |
| `modules/task-runtime` L4 | 恢复资格、配额、持久队列、原 Pod 替换与卷保留 |
| `modules/dev-session` L5／platform wiring | 既有 develop 检查与 runtime 投影接线 |

固定一级页签为 CLI 工作区／预览／代码／变更／数据访问／会话与环境。

2026-09-23 修订说明（[RFC-020](../RFC-020-project-workspace-ia/design.md) D1）：整页替换终端的功能页签改为终端旁的工具面板——预览／代码／变更／数据／参考／会话六个页签，可拖宽（30%–60%）、收起成右缘页签栏、放大到整个内容区，内容区窄于 800px 只有放大形态；地址仍以 `view` 表达当前工具并新增 `panel=full`，`split`／`diff` 保留为别名；个人布局 `WorkspaceLayout` 加可选 `tool`，旧 `view`／`previewAlongside` 读时推导、写时回填。本节其余约束（显式地址优先、草稿保护、个人工作区页签只在终端区）不变。
个人工作区页签只出现在 CLI 视图内；增加、命名、关闭、跨页移动继续用原布局持久化，不把功能页签写成 CLI 工作区。

> 2026-09-23 修订：个人工作区页签已取消，CLI 区改为 Xshell 式标签组（每个 CLI 一个标签，拖动排列与分屏），仍用原布局接口持久化，见 [RFC-003 development-workspace.md §2.1](../RFC-003-workbench-ux-redesign/development-workspace.md#21-页签与分屏规则) 同日修订。

数据访问表单不再处于浮层，按说明、现有记录、申请／审批顺序排列。会话详情分为连接与恢复、环境资料、历史记录、释放区域。

复用 Tabs、Card、Stack、ActionRow、Button、FormField、DefinitionList、ConfirmationPanel、QueryStatus；颜色取主题令牌。
健康态减少重复状态、回放计数和空工具栏；回放细节保留在环境页。排布工具在存在窗口后显示。
窄屏只有标签条和终端内容各自滚动，页面与表单不得横向溢出；桌面正常四窗保留 RFC-003 的可用面积要求。

## 5. 草稿与生命周期

- 切换功能页签保留数据申请／审批草稿和编辑器状态；离开项目、换任务、释放／另建前复用既有未保存保护。
- 内容可用隐藏挂载或提取稳定表单状态实现，不能因改为页签而丢失表单输入。
- NativeWorkspace 的布局、名册及活动订阅保持稳定；视图切换只分离终端显示连接，不 stop、不重复 start。
- 后台完成／待处理定位仍能转入 CLI 对应工作区，错误目标不误连其他任务。
- 比较、预览故障不阻断健康的 CLI；生产数据审批不代表进程已加载连接。

> **2026-09-23 修订（作者裁定，直接修改＋回填，不另立 RFC；表单与确认改弹窗）。** 恢复路径的两个入口都改为弹窗：「检查并恢复原工作树」的核对结果（任务、工作卷、资源套餐）与确认合成一个确认弹窗，选过的套餐关窗后下次核对仍沿用，「清空」回到当前套餐，确认后回执与重试留在卡片上；「从远端另建工作树」打开弹窗，离开失败会话的确认叠在上面。数据访问的批准、拒绝、撤销确认改为确认弹窗，审批意见是草稿、关窗保留、页面上不再提示。历史对话的「新建 Agent」改为弹窗（启动进行中也能关窗回到对话）。结束 CLI 与编辑器放弃输入的确认改为确认弹窗；编辑器保存冲突提示仍在页内。数据访问申请表单常驻面板，不变。

## 6. 测试与部署

先为旧协议环境无法检查恢复、禁用创建仍提示点击、页签草稿保留写回归；再实现。
覆盖暂时断线不允许替换 Pod、UID／快照变化、满配额恢复、重复请求、补偿、旧握手、新握手清故障、存量失败恢复。
路由交互覆盖每种状态的下一步、恢复确认、单次创建、功能导航／返回、工作区布局、编辑器与数据草稿、后台活动定位。
浏览器覆盖 1280×720、390×844，中英文及明暗主题；检查内容覆盖、工具栏、焦点与整页溢出。
本地执行定向测试、console build 和一次完整 `bun run check`；最终提交发布按精确 SHA 核对 CI。
真实恢复验收使用明确选定的本机对象，恢复前后比对 taskId、PVC UID、Git HEAD、文件摘要与未提交／未推送状态；创建 CLI 和预览分别验收。
