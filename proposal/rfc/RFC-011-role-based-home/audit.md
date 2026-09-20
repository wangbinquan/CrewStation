# RFC-011｜现状核对

> 2026-09-20；主干工作树含并行会话输出；基线读取时从 `5252c4c` 前进至 `c5e5f0e`。下列均由本轮源码或实机观察获得。

| 发现 | 证据 | 本次设计含义 |
|---|---|---|
| 平台账号只有 `isAdmin`，项目成员另有 owner／developer／tester | `packages/contracts/api/identity.ts:5`、`:11`、`:17`；`modules/identity/adapters/persistence/tables.ts:16` | 增加独立的三选一平台角色，不把项目负责人当成第四类平台角色 |
| 所有工作台用户都看到两个全局入口；顶栏和左栏重复 | `apps/console/src/app/layout/TopBar.tsx:28`；`WorkbenchNav.tsx:30`；`WorkbenchLayout.tsx:5` | 使用者首页采用无技术侧栏的布局，入口按平台角色显示 |
| 根路径已是市场页面，并非项目列表 | `apps/console/src/features/capabilities/routes.ts` 的 `marketHomeRoute`；`apps/console/src/app/router/routeTree.ts` | 重点是简化首页与统一登录落点，避免错误描述成“从项目首页迁到市场” |
| 市场卡片／详情共用开发和设置动作，详情显示 commit SHA | `apps/console/src/features/capabilities/components/market/MarketAppCard.tsx:27`、`:28`、`:43` | 两处都移除开发动作，详情也不再展示技术发布资料 |
| 创建项目仅接受管理员，负责人是必填请求字段 | `modules/project/application/createProject.ts:14`、`:16`、`:25`；`packages/contracts/api/project.ts:39` | 开放受约束的数字人自建路径，服务端决定本人负责人 |
| 创建表单必须先读管理员用户目录 | `apps/console/src/features/projects/hooks/useProjectCreation.ts:21`、`:26` | 开发者新建不能照搬原表单后只隐藏负责人选择框 |
| 项目列表按成员关系过滤，分页包含 tester | `modules/project/application/queryProjects.ts:36`；`modules/project/adapters/persistence/drizzleProjectPages.ts:13` | 开发列表先限定开发资格与项目范围再搜索／分页，试用查询独立 |
| 后端项目授权以管理员标记和成员关系为依据 | `modules/project/application/authorization.ts:8`；`modules/project/domain/authorization.ts:14` | 集中加入平台开发资格，HTTP／CLI／WS 等共同执行 |
| 测试者已经有独立试用渲染分支 | `apps/console/src/app/project/ProjectSpaceBoundary.tsx:31`；`apps/console/src/features/projects/pages/TesterProjectPage.tsx:14` | 迁移到应用侧，不能删入口后丢失试用能力 |
| 成员添加校验存在性，尚未校验目标平台开发资格 | `modules/project/application/manageMembers.ts:20` | 新的三类角色不能被添加成员绕过 |
| 管理员目录只提供管理员开关 | `apps/console/src/features/admin/components/UsersSection.tsx:27` | 新增具名角色编辑与具体影响确认 |
| 预览网关按 roleOf 是否存在判定资格 | `modules/platform/wiring.ts:95` | 平台角色门槛不能误伤 tester；必须区分试用与开发授权 |
| 浏览器会话只在打开时校验 taskAccess，消息直接派发 | `modules/session/application/browserStreams.ts:24`、`:32`、`:41` | 降级已有连接时必须重新判定，不只在页面上藏按钮 |
| 开发登录器是四个视角，developer／tester／admin 各有技术默认落点 | `tools/dev-auth/roles.ts:17`；`tools/dev-auth/page.ts:33` | 改为三类平台角色，并保留用户下的 tester 验证视角 |
| 全局 Agent 动态汇总待处理和完成数，但 CLI 工作区已有内部状态 | `apps/console/src/app/layout/activity/AgentActivityMenu.tsx:39`；`apps/console/src/features/dev-session/components/native/NativeWorkspace.tsx:67` | 按作者追加要求移除全局入口；内部有用状态继续保留 |

## 实机观察

本轮在已有管理员登录态下只读打开 `http://console.cs.localhost/`。没有切换真实账号、修改角色或创建项目。
页面同时显示：左侧“工作台／能力市场／数字人项目”、顶部同样两个导航、Agent 动态、进入平台管理。
“演示数字人”等卡片同时有“打开正式应用”“进入项目”“配置可见性”，状态包含 `v0.1.2` 和“部署已就绪”。
与用户所说“首页太技术化”一致。当前只实看了管理员视角，不把它写成普通用户角色实机验收。

## 共享工作树边界

本 RFC 使用 `RFC-011`，因为并行集群管理已占用 `RFC-010`。保留 RFC-008／009 的已实现输出及测试纪律工作的未提交文件。
本轮自有范围为本 RFC 目录、索引新增行与 `STATE.md` 接力；不暂存或提交其他会话文件。
源码证据行号指本次读取版本；进入实施前重查相关文件和远端，特别是路由、角色契约与迁移锁。
