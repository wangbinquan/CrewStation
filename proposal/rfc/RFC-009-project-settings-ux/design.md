# RFC-009｜技术与交互设计

> Done · 2026-09-20；与 [proposal.md](./proposal.md) 配套。只改变前端组织，不新增持久化或后端接口；实际验收见 [acceptance.md](./acceptance.md)。

## 目录

- [1. 落位与边界](#1-落位与边界)
- [2. 路由与兼容](#2-路由与兼容)
- [3. 数据与权限呈现](#3-数据与权限呈现)
- [4. 编辑状态](#4-编辑状态)
- [5. 布局与无障碍](#5-布局与无障碍)
- [6. 失败模式和测试](#6-失败模式和测试)
- [7. 并行范围](#7-并行范围)

## 1. 落位与边界

已阅读 `docs/engineering/repository-structure.md` §8–11。沿用 app → feature 公开入口 → shared 的现有前端依赖方向。

| 位置 | 职责 |
|---|---|
| `apps/console/src/app/project/ProjectSettingsPage.tsx` | 装配四个设置入口；不含业务写入规则 |
| `apps/console/src/app/project/ProjectResourcesPage.tsx`（新增） | 装配五个开发资源主题，复用各 feature 公开组件 |
| `apps/console/src/app/router/{projectSections,adminProjectRoutes,routeTree}.ts` | 两空间的新路由与兼容重定向 |
| `apps/console/src/app/layout/ProjectNavSection.tsx` | 新增开发资源导航；保持测试者入口限制 |

2026-09-23 修订说明（[RFC-020](../RFC-020-project-workspace-ia/design.md) D2／D6）：`ProjectResourcesPage.tsx` 与左栏「开发资源」已删除。五个主题各归其家：API 接口／事件／平台接入在开发页参考面板（`app/project/ReferencePanel.tsx` 装配），数据与存储在开发页数据面板，项目与仓库在项目设置新增的只读「项目信息」组；`resources?section=…` 与 `settings?tab=resources` 的旧地址一次 `replace` 重定向并保留定位参数。本表其余行不变。
| `apps/console/src/shared/project/{settingsSearch,projectPaths}.ts` 与 `resourceSearch.ts`（新增） | 类型化路径和参数纯解析，不调用业务 API |
| `apps/console/src/features/config/components/` | 列表和具名编辑区拆分、历史按需展开；既有 hooks 继续负责写入 |
| `apps/console/src/features/projects/components/visibility/` 与 `members/` | 先摘要／列表，再编辑；保留独立保存、确认与草稿 |
| `apps/console/src/features/projects/pages/` | 仓库公开页面入口、设置高级入口；feature 外不导入内部组件 |
| `apps/console/src/features/capabilities/pages/` | 将整页聚合展示拆为可选择主题的公开入口；只读同一 DTO |
| `apps/console/src/features/{catalog,events}/` | API 原行为与事件只读语义，更新深链接和说明 |
| `apps/console/src/shared/ui/` | 复用 Card、Stack、ActionRow、Button、FormField、Tabs、DefinitionList、QueryStatus、ConfirmationPanel；需要分组导航时增加可复用组件 |
| 各 feature 的 `i18n/` 与 `app/i18n/` | 中英文文案，按归属放置 |
| `apps/console/src/tests/`、`tests/e2e/` | 路由、草稿、权限表现和真实浏览器回归 |

承担的结构改进：消除设置页同时装配资源的职责；拆分 `CapabilitiesPage` 的整页渲染为主题入口；不复制数据获取或角色逻辑。
不新增后端模块、不改变 layer、不引入跨 feature 深 import，无 ADR 例外。
新增文件前复核目录数量；接近上限的表单组件放到现有语义子目录，禁止平铺到上限之外。

## 2. 路由与兼容

保留现有设置 URL 参数名 `tab`，降低迁移成本；新文案与参数值无须同名。

| URL | 内容与默认值 |
|---|---|
| `/projects/$projectId/settings` | 等价 `tab=config&env=development` |
| `settings?tab=config&env=development\|production` | 环境变量 |
| `settings?tab=visibility` | 应用展示 |
| `settings?tab=members` | 成员与角色 |
| `settings?tab=advanced` | 高级 |
| `/projects/$projectId/resources` | 默认 `section=api` |
| `resources?section=api` | 允许 `proxy`、`operation` |
| `resources?section=events` | 允许 `subscription` |
| `resources?section=data` | 数据与存储 |
| `resources?section=project` | 项目、仓库、配额与套餐 |
| `resources?section=guide` | 允许 `topic=identity\|environment\|mcp\|tasks`；默认 identity |

管理空间使用 `/admin/integrations/$projectId/…` 的同构地址；应用展示不可用时按既有行为回到成员组。
测试者与普通成员不能因为新路径绕过 `ProjectLayout` 的既有访问判断。

### 2.1 旧地址一次 replace 到新地址

| 旧地址 | 目标 |
|---|---|
| `settings?tab=resources&resource=api&proxy=…&operation=…` | `resources?section=api&proxy=…&operation=…` |
| `settings?tab=resources&resource=events&subscription=…` | `resources?section=events&subscription=…` |
| `settings?tab=resources&resource=overview` | `resources?section=project`，保留其余主题入口 |
| `settings?tab=repository` | `resources?section=project`，仓库位于首屏 |
| `settings?tab=lifecycle` | `settings?tab=advanced` |
| 旧 `/catalog` | 直接到 resources API；不经旧 settings 再跳一次 |
| 旧 `/capabilities` | 无具体资源参数时 project；有效 API／事件定位参数按旧解析含义转接 |
| 旧 `/config` | 保持 config 与 env，不丢生产组参数 |
| 旧 `/events` | 保持现有运行与诊断跳转；其“查看订阅”链接改到 resources events |

兼容解析须先处理旧参数，再做新 settings 参数裁剪，避免 `proxy`／`operation`／`subscription` 提前丢失。
继续沿用 `searchText` 的长度和控制字符约束；无效主题回该页默认，操作不存在显示原始定位和清除入口。
项目概览、市场详情、诊断、目录、后台申请等调用点通过 `PROJECT_PATHS[space]` 更新。
迁移须搜索全仓调用方，不能只更新导航。

## 3. 数据与权限呈现

### 3.1 接口保持原契约

配置继续复用 `useConfigEnv` 和客户端的 items／versions／set／remove；成员、应用范围与展示继续用原 hooks。
API 目录仍从项目解析 serviceId，再查询授权和当前会话。资源说明继续使用 `CapabilityDescriptionDtoSchema` 校验聚合响应。
只读仓库继续用 `api.services.getRepository`。没有 SQL、迁移、新的配置 DTO 或自动保存。

进入 settings 时只请求当前组及身份所需的数据；不为显示所有组的数字额外加载整套能力说明、成员或全部发布记录。
环境组独立数据和草稿；版本历史／生产快照按需展示，但生产“是否有未采用配置”的摘要保留未知和错误态。

> **2026-09-23 修订（作者当面裁定，直接修改，不另立 RFC）。** 版本历史与生产快照对照改为直接展示：`ConfigEnvPanel` 页脚恢复 `h3` 标题，`ProductionConfigImpact` 去掉折叠段；两者原本就在渲染时读取，查询、未知与错误态不变（`configImpact` 用例断言两处不在 `<details>` 里）。
资源五主题共享已有 queryKey 和缓存，但每次只呈现当前主题；目录 API 不依赖能力聚合成功。
聚合来源失败时，项目与仓库中的独立仓库查询仍可展示；不得把旧数据当作新鲜成功结果。

### 3.2 角色矩阵

| 操作 | 开发者 | 负责人 | 管理员 |
|---|---|---|---|
| 写开发变量／密钥 | 可 | 可 | 可 |
| 写生产变量／密钥 | 只读 | 可 | 可 |
| 成员增删、开发者与测试者角色 | 只读 | 可 | 可 |
| 转移负责人 | 不可 | 不可 | 可 |
| 应用资料与市场范围 | 只读 | 可 | 可 |
| 归档 | 查看说明 | 查看说明 | 依项目状态确认 |
| API 申请、试调 | 按现有条件 | 按现有条件 | 按现有条件 |
| 仓库／资源／订阅资料 | 可查看 | 可查看 | 可查看 |

以实时 `/me` 和服务端结果为准；不为简化 UX 放宽权限。身份 pending／error／refreshing 期间保留输入并暂停写入。
摘要用文字说明维护人；有草稿后权限改变，展示草稿但停止提交，不能隐藏并丢掉内容。

## 4. 编辑状态

### 4.1 配置

`list → create / edit(name) → saving → list + receipt`；失败回同一编辑区，保留输入与错误。
新增／编辑／删除单个动作使用既有写锁。成功只清请求所属草稿，不影响另一环境；密钥只驻留页面内存，成功后清空。

开发和生产各有草稿与打开状态，切环境不卸载。切组／离开仍经共享 `UnsavedChangesGuard`：
保留当前页继续编辑，或明确放弃后离开。换目标、取消编辑有输入时用行内确认，无输入直接收起并返回触发按钮。
浏览器返回／前进与刷新保持既有保护；地址不含变量值、申请理由或密钥。

新建同名变量显示覆盖对象和类型变化，沿用原 set API；不增加重命名语义。
非密钥可预填已有值；密钥字段为空且明确“留空会写入空值”，不可把占位符作为值送回。
记录显示服务端 name、env、version；状态不以仅仅关闭表单判定为成功。

### 4.2 应用展示与成员

先摘要后编辑只是呈现变化，原两个 editor、修订冲突检查和分别保存继续工作。
两表单可同时打开；保存／取消 A 不修改 B。409 提供采用新基线并保留草稿的原路径。
成员新增折叠不改变 `useMemberEditor` 目标选择协议，隐藏的 ID 不参与当前提交。
所有表单打开后约束一次给全，提交时每个无效字段有自己的错误；只禁按钮不算校验反馈。

### 4.3 来源与生效条件

- 平台自动提供的地址、身份、数据连接变量名、MCP 地址：只读文字＋必要复制。
- Manifest 的订阅、任务声明：跳 `dev-session?view=code&file=crewstation.yaml`；无会话则明确先开启，不承诺已打开文件。
- 开发数据授权：跳 `dev-session?view=data`，复用 RFC-008 已有路径。
- 生产变量保存：保留发布快照对照和发布入口，不能隐式发起部署。
- 归档：完整沿用现有行为与确认条件，不把归档包装为清理资源或可恢复停用。

## 5. 布局与无障碍

桌面全局左栏保留，设置内部约 160px 分组导航，余下是单个主内容区；内容自然向下，不在表单内再套滚动区。
窄屏全局导航折叠，分组选择器代替第二条横向导航，环境 Tabs 仍仅两个；按钮换行、长键／地址可断行。
适配 1280×720、390×844 和 320px；生产实现须覆盖中英文及明暗主题。
密集列表采用紧凑行，手机按名称／值／操作堆叠，行内按钮保持自然尺寸。

复用公共组件与主题变量，不加主题外颜色。卡片内容用 `Card stacked`，纵向组合 `Stack`，按钮组 `ActionRow`。
编辑展开聚焦第一个字段；取消回触发按钮；保存回对象行或“新增变量”；错误聚焦首个无效字段。
状态用 `ActionNote`／`role=status`，错误用 `role=alert`；来源不只靠颜色；分组当前项有 `aria-current`。
历史、技术详情用原生 details，关键影响说明不能藏在 details 中。

## 6. 失败模式和测试

| 情况 | 用户可见行为 | 证据要求 |
|---|---|---|
| 初次读取失败 | 原因＋就地重试，不显示空数据结论 | 错误夹具、恢复测试 |
| 编辑时重读失败 | 输入留存、暂停保存 | 原草稿与恢复后目标不变 |
| 保存 403／409／500 | 原始原因与对象保留，无成功提示 | 精确请求次数／目标／错误 |
| 切环境／设置组／项目 | 环境内保留；离开具名确认 | 草稿、URL、焦点断言 |
| 迟到结果 | 只影响原项目、原环境、原修订 | 延迟回执回归 |
| API 会话离线 | 文档仍可看；试调说明条件和恢复入口 | 不能只验证目录渲染 |
| 资源响应非法 | 明确读取失败，可重试 | Schema 失败用例 |
| 旧深链接 | 同项目同空间、完整上下文、单次 replace | 路由真实渲染与后退 |
| 归档失败／禁止 | 原因留存，状态不伪成功 | 已有行为回归 |

复用并扩展 `configForms`、`configImpact`、`visibilitySettings`、`projectMembers`、`projectNavigation`、`projectAccessBoundary`、API 试调的既有测试。
新行为不能只写 className 或快照断言。真实浏览器验证完整旅程及尺寸，API 试调保留 operationKey、taskId、HTTP、耗时、trace；模拟稿不得计入生产验收。

## 7. 并行范围

本次发现 RFC-008 在同一 main 中开发，会触及 `STATE.md`、RFC 索引、开发会话和 `developmentSearch.ts`。
设计阶段只新增 RFC-009 目录及给两个接力文件追加独立记录，保留他人原文。
实现时资源→代码／数据的链接遵循 RFC-008 参数，不改它的工作台内部实现。
作者批准后已完成生产实现并更新本机 console；与 RFC-008 共用一次冻结候选的完整 `bun run check`，Git 发布分短临界区串行执行，分别核对提交内容与精确 SHA CI。证据见 [acceptance.md](./acceptance.md)。
