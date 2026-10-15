# RFC-039｜首次交付技术设计

> 状态：In Progress · 2026-10-14 · 已批准原型的实现设计

## 1. 已核对的复用点

- `apps/console/src/features/projects/hooks/useProjectCreation.ts:16`：统一创建草稿、服务端字段错误与未知结果对账。
- `apps/console/src/features/projects/components/creation/SelfCreateProject.tsx:9`：原创建后打开开通弹窗，改为独立页面接续。
- `apps/console/src/features/projects/model/projectSummaryState.ts:7`：原下一步优先开发，需合并待验证版本和初次正式交付事实。
- `packages/contracts/api/workbench/projectSummary.ts:25`：分段 ready／unknown／restricted，继续作为事实投影，不另造项目生命周期。
- `apps/console/src/features/dev-session/pages/DevSessionPage.tsx:33`：会话、连接、恢复和高级工作区已有状态；简化入口复用相同服务与流。
- `modules/dev-session/application/workspaceStatus.ts:8`：真实工作区检查；`runtimes/task/src/workspace/workspaceFingerprint.ts:9` 包含 index 与未提交内容。
- `modules/dev-session/application/publishFromSession.ts:11`：发布固定任务与 HEAD，脏工作区仍拒绝发布；新提交动作不绕开此守卫。
- `apps/console/src/features/release/pages/ReleaseJourneyPage.tsx:25`：RFC-038 持久发布流程、事件、验证与切流；不新增竞争状态机。
- `modules/project/application/appVisibility.ts:33`：访问策略按 expectedRevision 保存，继续使用所属模块 API。

## 2. 落位与数据流

前端：创建及交付投影在 `features/projects`；简化开发工作台在 `features/dev-session`；提交确认、发布与访问确认在 `features/release`，访问确认复用既有项目策略 API。共享进度在 `shared/`，页面装配在 `app/`；feature 不跨 feature 深引用。样式使用共享组件与主题 token。

首次交付入口显式使用 `view=guided`；按作者对日常开发入口的反馈，工作台左栏「开发」使用 `view=cli`，直接进入原 CLI 工作区，需求与预览保留为可选入口。原有裸地址及文件、版本比较、Agent、参考面板书签继续进入原工作区，保留个人布局语义。引导页复用 SessionCover 和保卷恢复控件；首次连接失败直接给出恢复入口，已打开后的断线不卸载需求草稿。

2026-10-14 界面反馈修正：首次交付不设常驻导航项，只承接创建成功和项目内的「继续交付」。项目导航主入口为概览、开发、发布与上线；运行与管理以可折叠分组承载诊断、观测、资源中心和设置，子项以缩进、竖线和独立列表呈现。分组标题与项目名称使用不同样式；子页面深链接自动展开，窄屏子项仍纵向排列。

后端：开发工作区提交在 L5 `dev-session` 授权、核对 task 后调用 Runner 的明确提交命令；工作区读取与 Git 操作在 `runtimes/task/src/workspace`。开发权限申请归 L1 `identity`，只写 identity 自有表，通过持久申请和管理员角色变更流程完成审批。契约与客户端分别落在 `packages/contracts` 和 `packages/api-client`。不新增模块、层级或架构豁免。

交付状态是现有项目、槽、发布、会话事实的投影；读取失败／过期／受限不会推导成已完成。仅用户草稿和待核对请求键可保存在前端，不以 localStorage 作为真实上线状态。

## 3. 核心约束

- 创建沿用当前未知结果恢复；标识只建议，不承诺唯一，实际冲突由服务端裁决。
- 简化入口与高级工作区使用同一会话；Agent 启动请求固定请求身份，失败不重复启动不明执行；不加载页面即产生模型任务。
- Git 提交绑定任务、HEAD、分支与内容指纹，拒绝截断、合并冲突或不完整材料。确认范围只含已展示文件；重放返回原结果或要求重新读取，不自动重试产生第二次提交。发布仍只接受确认后的干净工作区和 SHA。
- Runner 使用标准 index.lock、独立候选 index 和 HEAD compare-and-swap；不改写工作文件。确认前后的内容变化拒绝提交，提交后的新编辑保留为未提交内容并阻止自动构建。此入口通过 commit-tree 生成提交，不执行项目 Git hooks；高级工作区仍可自行执行项目提交流程。没有持久提交回执日志：回执未知必须重读，旧 HEAD 确认不能重放生成第二个提交。旧 Runner 未声明 workspaceCommit 能力时在发送命令前拒绝，并说明高级工作区入口。
- 新手发布先明确保存访问范围，再发起既有上线流程。部分成功明确区分范围已保存、切流未完成；刷新读已保存范围并接续原上线请求，最终展示以真实路由和策略读取为准。已有正式版本的范围修改继续是明确的权限操作。
- 开发者权限申请不自动授予角色，管理员须明确批准；重复待处理申请幂等，审批在原用户角色锁和数据库事务内完成，不允许用户自批或申请管理员。
- 所有新详情、配置与申请表单使用共享 Dialog 系列；连续流程是路由页面。日志、配置和历史入口保留返回定位。

## 4. 失败与验证

覆盖标识输入与服务端冲突、创建回执不明、摘要 unknown、环境和分支读取失败、Agent 请求重放、Git 内容变化／任务替换／结果不明、未验证切流、访问 revision 冲突和部分失败、权限申请越权／并发／重复审批。工作台载入／空／错／成功及交互均写回归，中英文文案一致。

真实 Git 临时仓库验证提交内容及并发保护；identity 新持久路径使用隔离 PostgreSQL 验证。最后进行桌面和窄屏浏览器旅程。共享树并行观测 WIP 原样保留；门禁出现范围外失败单独留证，不混作本 RFC 成功。

## 5. 作者追加的 CLI / Bot 双模式与满屏工作区

作者明确要求正式实现、部署本机并以真实贪吃蛇项目走完开发发布，同时要求 CLI 与 Bot 自由切换、聊天视觉完善以及开发页用满空间。这些是既有批准范围的后续要求。

- `DevelopmentModes` 在开发页提供同级 CLI / Bot 分段入口。每个面板首次访问时挂载，此后隐藏而不卸载，并把共享 `DialogVisibility` 传给隐藏面板。切换保留 CLI 布局、编辑器对象、未保存文件、Bot 草稿与进行中请求；离开当前开发路由仍使用既有未保存确认。路由适配在读到 `view=guided` 时立即冻结隐藏 CLI 的地址投影，避免 Router 先发布 location 后提交父组件期间发生地址回写。
- 两种模式共享开发工作区和项目文件，各自保持原生 CLI 与流式 Agent 会话。当前实现不承诺 CLI 输入与 Bot 输入属于同一个模型会话，也不复制或拼接两种协议的对话历史。
- Bot 使用对话／实时预览左右布局。采用 [AI SDK Elements Prompt Input](https://elements.ai-sdk.dev/components/prompt-input) 的底部输入及工具区组织，以及 [Claude Artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them) 的对话与产物并排模式；复用本仓组件和主题，不引入对应 UI 库。
- 新建建议只填入草稿；发送才创建真实 Agent。用户气泡、Bot 正文和执行记录有不同视觉层级；连续工具／状态输出压成可展开记录，错误默认展开。React 渲染文本、段落、列表和代码，不解释 HTML。输入支持 Enter 发送、Shift+Enter 换行，并保护中文输入法组合键；请求同步上锁，失败保留内容。
- 接受的用户输入由实际 Agent 驱动以 `user-message` 持久事件记录，交互执行与输出使用同一序号源，业务／单次任务不产生新增输入事件。Agent DTO 额外投影已有持久 `AgentStart.request.prompt`，启动准备和失败时刷新仍可显示首条输入；执行事件到达后移除这条兜底，避免重复。不新增数据库或浏览器对话状态机。
- AppShell 在开发路由以可用主区高度构成 flex 布局；移除内层固定视口百分比和最小高度。桌面两栏各自内部滚动，底部输入固定在聊天列内；窄屏切换聊天／预览，两个面板状态保留，工作区不撑长文档。默认聊天空态不自动滚动到页尾。

新增回归覆盖模式切换、文件编辑器保留、进行中启动、刷新输入、事件去重、HTML 转义、工具错误、组合输入法、发送锁定与失败草稿。真实浏览器测量 AppShell 祖先、面板和输入框边界，使用模拟接口时明确标注；实际模型、镜像部署和正式发布分别验收。

## 实机发布补充：受保护分支的代推身份

真实首次发布暴露普通开发会话令牌不能推 GitLab 受保护 main。发布仍先验证项目 publish 权限、会话、工作树与确认 SHA；随后 SCM 在同一写入准入内签发只限当前项目、仅 read_repository / write_repository 的维护者级发布凭据，仅供本次推送命令使用。成功、命令失败和台账失败均撤销；命令异常退出的到期台账上限 10 分钟，由既有控制器补偿。撤销失败不得继续打标签。普通开发令牌仍为 developer，构建仍为 reporter，分支与 v* 标签保护不变，平台长期令牌不下发工作区。发布命令禁用仓库 hook 与凭据助手，不在命令行或持久 Git 配置写凭据。发布凭据的原生副作用与精确身份纳入已有 SCM 回收沿革。
