# RFC-020｜技术与交互设计

> Done · 2026-09-23（实施与实机证据见 [acceptance.md](./acceptance.md)；实施中的偏差记在 [plan.md](./plan.md) §4）；与 [proposal.md](./proposal.md) 配套，已按作者对 D1–D7 的裁定改写（D2 取 (b)：开发资源入口取消，三主题进开发页参考面板；D3 取 (b)：运行与诊断保留横向页签，合并为五个）。只改工作台组织与一个可选的契约字段，不新增后端接口。

## 目录

- [1. 落位与边界](#1-落位与边界)
- [2. 路由与兼容](#2-路由与兼容)
- [3. 外壳：左栏、页头、刷新](#3-外壳左栏页头刷新)
- [4. 概览](#4-概览)
- [5. 开发工作区与工具面板](#5-开发工作区与工具面板)
- [6. 发布与上线](#6-发布与上线)
- [7. 运行与诊断、开发资源、项目设置](#7-运行与诊断开发资源项目设置)
- [8. 名称、ID 与状态文案](#8-名称id-与状态文案)
- [9. 失败模式](#9-失败模式)
- [10. 测试策略](#10-测试策略)
- [11. 与既有 RFC 的关系](#11-与既有-rfc-的关系)

## 1. 落位与边界

已阅读 `docs/engineering/repository-structure.md` §8–§11。沿用 app → feature 公开入口 → shared 的依赖方向；feature 之间不互相 import。

| 位置 | 职责 |
|---|---|
| `apps/console/src/app/layout/ProjectNavSection.tsx` | 左栏改为五项生命周期顺序（去掉 `resources`）；顺序只定义这一处 |
| `apps/console/src/app/project/ProjectOperationsPage.tsx` | 仍用 `Tabs`，五个页签；`status` 页签装配健康卡＋形态图；`health`／`topology` 一次 `replace` 到 `status` |
| `apps/console/src/app/project/ProjectResourcesPage.tsx` | 只剩重定向：`section` 五个取值各自 `replace` 到新家（§2）；页面本体删除 |
| `apps/console/src/app/project/ProjectSettingsPage.tsx` | 新增 `info` 组，装配 `ProjectInfoSection`（projects feature 公开） |
| `apps/console/src/app/project/ProjectPageHeader.tsx`（新增） | 项目页统一页头：标题、说明、主动作、「读取于 ↻」 |
| `apps/console/src/shared/project/{developmentSearch,operationsSearch,resourceSearch,settingsSearch}.ts` | 参数解析：`panel`、`status`、`info`、三主题 |
| `apps/console/src/shared/ui/PageRefresh.tsx`（新增） | 「读取于 hh:mm ↻」；接收若干 query 的 `dataUpdatedAt` 与 refetch |
| `apps/console/src/shared/ui/SplitButton.tsx`（新增） | 「＋ CLI ▾」这类主键＋展开的按钮，初版即可复用 |
| `apps/console/src/shared/ui/Timeline.tsx`（新增） | 发布记录与最近动态共用的时间线列表 |
| `apps/console/src/features/projects/pages/ProjectOverviewPage.tsx` 与 `components/summary/` | 页头链接行、三张状态卡（`StatusCards.tsx`）、最近动态（合并发布与切流）；删除 `ProjectQuickLinks` |
| `apps/console/src/features/projects/pages/ProjectInfoSection.tsx`（新增） | 项目信息只读组；复用 `RepositoryCard`、`CapabilityIdentity`、`CapabilityQuota` 的数据 hook |
| `apps/console/src/features/release/components/` | `DeployedVersionCard` 承接上线／回退按钮；`ReleaseTimeline.tsx` 取代 `ReleaseHistoryCard`＋`TrafficSwitchCard` |
| `apps/console/src/features/release/model/releaseTimeline.ts`（新增） | 纯函数：发布与切流合并排序、人名解析、标签解析 |
| `apps/console/src/features/dev-session/components/panel/`（新增目录） | `ToolPanel.tsx`（页签、拖宽、收起、放大）、`ReferencePanel.tsx`（三段；侧栏紧凑、放大完整，承接原开发资源）、`DataPanel.tsx`（资源＋绑定）、`SessionPanel.tsx`（连接、恢复、内嵌日志、释放） |
| `apps/console/src/features/dev-session/components/native/NativeToolbar.tsx` | 合并为一条工具行：工作区页签＋「＋」、`SplitButton`、「布局 ▾」、「⋯」 |
| `apps/console/src/features/dev-session/model/layout/` | `WorkspaceLayout` 的 `tool` 字段读写与旧布局迁移（纯函数） |
| `packages/contracts/api/devSession.ts` | `WorkspaceLayoutSchema` 增加可选 `tool`（§5.2） |
| `apps/console/src/features/{catalog,events,capabilities}/` | 各自导出紧凑与完整两种公开组件供参考面板装配：`CatalogPage` 改为表在前、详情在旁（放大形态）；事件段顶部投递摘要；`CapabilitiesPage` 只保留 `guide` 与 `data` 两种嵌入形态 |
| 各 feature `i18n/` 与 `app/i18n/` | 中英文文案 |
| `apps/console/src/tests/`、`tests/e2e/` | §10 |

承担的结构改进：左栏顺序、二级导航形态、页头与刷新各只在一处定义；删除两份重复的版本卡之一（概览改用 release feature 公开的 `DeployedVersionCard`，需要把它导出为 feature 公开入口）；`app/project/` 少一个装配页（开发资源），`features/capabilities` 的整页聚合形态退役。
不新增后端模块、不改 layer、不引入跨 feature 深 import。`dev-session/components/` 当前 20 个文件已到目录上限，新组件按语义放进 `components/panel/` 子目录；`projects/components/summary/` 有 12 个文件，删 `ProjectQuickLinks` 后加 `StatusCards`。

## 2. 路由与兼容

路径段不变。参数：

| URL | 含义 |
|---|---|
| `/projects/$id/dev-session` | 主区终端；面板按个人布局（默认收起） |
| `dev-session?view=preview\|code\|changes\|data\|reference\|session` | 打开对应面板，形态取 `panel`；`view=reference` 另带 `topic=api\|events\|guide`（缺省 `api`）与 `proxy`／`operation`／`subscription` |
| `dev-session?panel=side\|full` | 面板在侧／放大；缺省 `side`。`panel=closed` 不写进 URL，收起就是去掉 `view` |
| `dev-session?view=split` | 等价 `view=preview&panel=side`，保留 |
| `dev-session?view=cli` | 面板收起 |
| `dev-session?view=diff` | 等价 `view=changes` |
| `dev-session?view=conversation` | 仍重定向到 `/dev-session/conversations` |
| `operations?tab=status\|logs\|alerts\|deliveries\|trace` | 五个页签；`tab=health`、`tab=topology` → `status`（`replace`），日志的 `source/slot/taskId/releaseId` 与 `traceId`、`subscription` 不变 |
| `resources?section=…` | 只剩重定向（`replace`）：`api\|events\|guide` → `dev-session?view=reference&topic=…&panel=full`（参数保留）；`data` → `dev-session?view=data`；`project` → `settings?tab=info`；缺省 → `topic=api` |
| `settings?tab=config\|visibility\|members\|info\|advanced` | 五组 |
| `release?source=…&release=…` | 不变 |

旧链接的意图映射：`view=preview` 等旧整页链接现在以侧面板打开（终端同时可见）。内容区窄于 800 时忽略 `panel=side`，按 `full` 渲染。
管理空间 `/admin/integrations/$id/…` 同规则；`projectPaths.ts` 不变。

## 3. 外壳：左栏、页头、刷新

- 左栏顺序：`overview`、`development`、`release`、`operations`、`settings`；`resources` 从 `PROJECT_PAGES` 删除但 `PROJECT_PATHS` 里保留路径供重定向；测试者仍只有 `overview`（版本试用）。
- `ProjectPageHeader`：标题（项目名或页面名）、一行说明（可选）、右侧主动作、`PageRefresh`。概览、发布与上线、运行与诊断、项目设置都用它；开发页保留自己的紧凑页头（终端优先）。
- `PageRefresh` 接收本页主要 query 的 `dataUpdatedAt` 与一个 `refetchAll`，显示「读取于 hh:mm」与图标按钮；卡片内不再放刷新按钮。轮询周期沿用现有 `usePolledRefresh`／`useManualRefresh` 与 `keepPrevious`，不新增轮询。
- 页面主体宽度沿用 2026-09-22 裁定（无 1200px 上限）。

> **2026-09-23 修订（作者裁定，直接修改，不另立 RFC；按钮统一）。** 页面不再提供刷新按钮：`PageRefresh`（「读取于 hh:mm ↻」）与各处「刷新／重新读取」按钮一并删除。页面数据每 30 秒在原位静默重读、回到前台补读一次，读取失败（网络中断、5xx）每 15 秒自动再读；`usePolledRefresh` 删除，`useManualRefresh` 只留给保存后的显式重读。规则全文见 RFC-003 design §6 同日修订。

## 4. 概览

数据全部来自现有 `ProjectSummaryDetail`（slots、health、development、releases、switches）与两个已有查询：仓库（`api.services.repository`）、版本比较摘要（当前会话存在时，`api.devSession.compare` 的紧凑结果）。

- 页头第二行：仓库路径（外链）、两槽域名（只在槽就绪时是外链，否则灰字）。
- 横幅：沿用 `nextStep()`；新增「待批准的数据访问申请 n 条 → 打开数据面板」（负责人；数据来自现有 `api.tasks.listDataBindings` 的 pending 计数）。
- 三张卡：`StatusCards.tsx` 渲染正式版本、待验证版本、开发会话。版本卡复用 release feature 公开的 `DeployedVersionCard`（一套组件、一套文案：标签、SHA 7 位并可复制完整值、就绪副本、健康角标、地址与打开按钮，负责人在待验证卡看到「上线 vX…」链接到 `release?switch=1`——发布页读到 `switch=1` 即自动执行「检查」）。开发会话卡显示会话状态、分支、CLI 数（`api.devSession.listNativeTerminals` 的数量）、待上线／未提交（比较摘要，未知显示「未检查」而不是 0）。
- 形态卡不变。
- 最近动态：`Timeline` 渲染 `releaseTimeline()` 的前 5 条（§6），页脚链接到发布页。
- 删除：`ProjectQuickLinks`、「当前开发」「运行健康」「需要关注」三张卡、「刷新概览」按钮、各卡的「读取于」。

> **2026-09-23 修订（作者当面裁定，直接修改，不另立 RFC）。** 页头第二行（仓库路径、两槽域名）去掉，概览不再读仓库：`ProjectOverviewPage` 删掉仓库查询与 `hostLink`，「项目信息」按钮（`ButtonLink` 紧凑档）并到身份那一行末尾，页头元数据只剩这一行。应用地址由 `DeployedVersionCard` 的打开按钮承担，仓库链接移到 `ProjectInfoCard`（§7 同日修订）；本节开头的「两个已有查询」只剩版本比较摘要。

## 5. 开发工作区与工具面板

### 5.1 布局

内容区分三行：紧凑页头、主区（左：工作区；右：面板）、状态条。主区用现有 `SplitGrid`（columns，两项）实现可拖分隔线；面板宽度比例存进布局（0.3–0.6）。面板放大时主区只渲染面板；收起时只渲染工作区。
工作区内部（工作区页签、终端排布、名册、已启动数）沿用 `NativeWorkspaceTabs`＋`SplitGrid`，只把工具行合并：

| 现在 | 之后 |
|---|---|
| 工作区页签行：`工作区 1 · 1｜＋ 工作区｜▸ 已启动 5` | 工具行左侧：页签＋「＋」；「已启动 n」并入「⋯」 |
| 工具行：算力档位 select、创建按钮、▸ 高级、横排／纵排／网格／均分／并排预览、▸ 工作区设置 | 工具行右侧：`SplitButton`「＋ CLI」（主键用 `preferredCompute` 与记住的权限；展开：档位 select、权限 select、阻断原因与管理员链接）、「布局 ▾」（横排／纵排／网格／均分）、「⋯」（重命名、关闭工作区、已启动名册与「放入当前页签」） |
| 「并排预览」按钮 | 面板页签「预览」 |

档位不可用、没有默认档位、名册加载失败等文案保留，显示在展开的菜单里与工具行下方一行（`blockReason` 现有逻辑）。

> **2026-09-23 修订（作者当面裁定，直接修改，不另立 RFC）。** 工作区内部不再沿用 `NativeWorkspaceTabs`＋`SplitGrid`，上表的工具行整条去掉：`NativeToolbar`／`NativeWorkspaceTabs` 删除，改为 `CliDock`（组装）＋`TerminalGroup`（一组的标签栏与画面）＋`NewCliButton`（页头的拆分按钮；`DevSessionWorkbench` 经 `NativeWorkspace` 的 `header` 渲染参数把它放进页头，没有页头时单独一行）。通用部件在 `shared/ui/dock/`（分屏树 `dockTree`、按树算成 calc 绝对定位的 `DockLayout`——重新排列不改 DOM 父子关系，终端不因排列重挂——、可拖的 `DockTabs`、纯函数落点判定 `dockDrop`、拖动控制 `dockDrag`）与 `shared/ui/menu/ContextMenu`；布局运算与旧布局迁移在 `model/layout/terminalGroups.ts`，存储在读入与每次改动后规整。档位不可用等说明改为 CLI 区上方一行（`NewCliNotice`）。契约见 [RFC-003 development-workspace.md §2.2](../RFC-003-workbench-ux-redesign/development-workspace.md#22-布局状态落位) 同日修订。

> **2026-09-23 修订（作者裁定，直接修改，不另立 RFC）。** 工作区撑到窗口底边：开发页的内容区、工作区、主区一路是纵向弹性列，主区长满页头与状态条之外的全部高度，取代原来按视口猜的 `calc(100dvh - 210px)`（1280×720／1440×900 状态条下方空 47px、1920×1080 空 67px）；有连接提示横幅时主区相应变矮，页面仍是一屏。主区下限 360px；手机宽度（≤600px）外壳占高，下限保持原来的 70dvh，外壳太高时页面照旧滚动。没有会话时开会话表单与参考面板那一层同样长满。

### 5.2 面板状态与契约

`WorkspaceLayoutSchema` 增加可选字段：

```ts
tool: z.object({ name: z.enum(['preview', 'code', 'changes', 'data', 'reference', 'session']), mode: z.enum(['side', 'full']), ratio: z.number().min(0.3).max(0.6) }).strict().optional()
```

- 只增不删：`view`、`previewAlongside`、`previewRatio` 保留（旧 Runner／旧工作台仍可读写）。读入时的迁移是纯函数 `migrateLayoutTool(layout)`：`tool` 缺席而 `previewAlongside` 为真 → `{ name: 'preview', mode: 'side', ratio: previewRatio }`；`view` 不是 `cli` → `{ name: view, mode: 'full', ratio: 0.45 }`。写出时同步回填 `view` 与 `previewAlongside`，让旧读者看到一致状态。
- 该 Schema 只由工作台消费，不在业务契约面金样内；`platformSurface.test.ts` 对账通过即可，新增可选字段不是破坏性变更。
- URL 优先于个人布局（RFC-008 已定）：`view`／`panel` 存在时以它们为准并写回布局；只有无参数进入时才用布局里的 `tool`。修掉 audit §3.2 末条「地址栏没参数、页面却打开上次的变更」：无参数时把布局里的 `tool` **写回 URL**（`replace`），地址与页面一致。

### 5.3 六个面板

| 面板 | 内容 | 来源组件 |
|---|---|---|
| 预览 | 不变 | `DevelopmentPreview` |
| 代码 | 不变；面板宽度不足 480px 时文件树可收起 | `EditorPane` |
| 变更 | 现有 `VersionComparisonPanel` 展开形态；四个内嵌页签改成同一列表上的分组标题（待上线提交、缺少的生产提交、文件差异、未提交），不再是页签 | `VersionComparisonPanel`、`ComparisonDetailsView` |
| 数据 | 上：数据资源表（原开发资源 → 数据与存储，`CapabilityData`）；下：绑定与申请（`DataBindingPane`） | 两者已有 |
| 参考 | 三段，由 `topic` 选中：**侧栏形态**——API（已授权操作列表＋「试调」，`ApiInvocationWorkspace`）、事件（本项目订阅＋事件类型）、平台接入（身份头与环境变量，可复制）；**放大形态**——API 段是原目录页的完整内容（操作全表带筛选、选中行详情栏：文档／授权／申请／试调，`RequestsPanel`，折叠的 `SwaggerPanel`，管理员页脚链接）、事件段全表＋投递摘要、平台接入四段。侧栏里每段末尾一个「放大查看全部」。没有会话时可打开，只有试调禁用并说明 | catalog、events、capabilities 各自导出的紧凑与完整公开组件 |
| 会话 | 连接与恢复（`ConnectionGuide` 详情、`StreamStatus`）、内嵌最近 200 行会话日志（`LogList` 复用，`source=dev-session&taskId`，带「完整日志 →」）、历史对话链接、`SessionCard`（技术详情折叠，释放在末尾） | 已有＋ logs feature 公开 `LogList` |

面板页签用现有 `Tabs`；标签后缀沿用现在的「· 未保存」「· n 待处理」。放大按钮 `aria-pressed`，收起按钮有可见文字标签（窄屏显示图标＋`aria-label`）。
草稿保护：编辑器与数据表单的 `UnsavedChangesGuard` 不变；切换面板页签不卸载已挂载的代码／数据面板（继续用 `hidden`）。

> **2026-09-23 修订（作者反馈与裁定，直接修改，不另立 RFC）。** 预览与代码占满面板正文、在自己内部滚动（此前外层没有高度，预览缩到 200px、编辑器按全文撑高）。变更、数据、参考、会话是文档式内容：面板至少一屏高，内容短时最后一张卡拉到面板底边，长了由面板正文滚动；`Stack`、`Tabs` 与紧凑目录各加可选 `fill` 把「最后一项长满」一路传到那张卡（数据：绑定与申请；会话：会话卡；参考 API：可调用的操作）。

> **2026-09-23 修订（作者当面裁定，直接修改，不另立 RFC）。** 预览、代码、变更三个页签直接铺满面板正文，不再内缩成带边框、带标题的嵌套卡片：面板正文对这三者不留内边距；`Pane` 加 `embedded`（不画卡片、不重复「编辑器」标题，只留工具栏）；预览去掉「开发预览」标题与说明段（说明收进状态徽标的悬停提示），变更去掉 `Card` 与「工作树与生产版本／待验证版本」标题（改作区域的无障碍名称）。三者的操作一律是按钮形态，排成顶端一条操作条，不随内容滚动——预览：状态、刷新、重启、停止／启动、日志、新窗口打开预览；变更：对比目标、重新检查、补齐历史并重算、查看／收起差异；滚动只发生在预览页、编辑器或变更正文内部。变更因此从上文的文档式内容改为铺满式。代码页签的文件树改为箭头＋文件夹／文件图标、24px 行高、逐层缩进线、当前文件左侧强调条，悬停显示完整路径。页签「参考」改名「可使用资源」（地址参数仍是 `view=reference`，组件名不变）；页头与预览里的「独立打开」改为「新窗口打开预览」。

### 5.4 没有会话、连接异常

- 没有会话：主区 `OpenSessionForm`（含失败会话的恢复入口，不变）；面板只显示「参考」（可放大，即原开发资源整页），其余页签禁用并说明「开始开发后可用」。
- 连接异常：`ConnectionGuide` 横幅仍在页头之下；工具行的「＋ CLI」禁用并给原因（现有 `blockedReason`）；面板可用（预览按连接世代显示不可用）。

## 6. 发布与上线

- 待验证卡：负责人看到「上线 vX…」或「回退到 vX…」（`slotCanOpen` 与 `rollback` 判定沿用 `useTrafficConfirmation`）；点击展开现有 `ConfirmationPanel`（检查 → 快照 → 原因 → 确认），面板挂在卡下方；无权限时卡上一行「由项目负责人上线」。`release?switch=1` 进入即触发检查。
- `releaseTimeline(releases, switches, members, me)`：把 `ReleaseDto[]` 与 `TrafficSwitchDto[]` 合并按 `createdAt` 倒序；切流条目解析 `releaseId → tag`（在 releases 内查找，找不到显示短 ID＋复制）、`actorUserId → 名字`（`api.projects.listMembers` 的 `name`；当前用户用 `me`；都找不到显示短 ID，负责人转移后离开项目的人就是这种情况）。纯函数，单元用例覆盖三种解析结果。
- `ReleaseTimeline`：一行一条；发布条目显示标签、状态角标、槽角色、SHA 7 位、分支、时间、「详情」（选中即现有 `SelectedRelease`）；失败条目显示原因与「日志」（`operations?tab=logs&source=build&releaseId=`）；切流条目显示「{人} 把 {标签} 切为正式版本／回退到 {标签}」与原因。镜像地址移到详情。
- 标签折叠段不变。

> **2026-09-23 修订（作者当面裁定，直接修改，不另立 RFC）。** 标签段不再折叠：`ReleasePage` 直接渲染 `TagCard`，仍在页面最下方（`releaseTimelinePage` 用例断言它是最后一张卡、不在 `<details>` 里）。

> **2026-09-23 修订（作者裁定，直接修改＋回填，不另立 RFC；表单与确认改弹窗）。** 上线／回退的核对（检查 → 快照 → 原因 → 确认）改为确认弹窗 `TrafficSwitchDialog`，不再挂在卡下方；切换说明是草稿，关窗保留、「清空」清掉，「重新核对」在弹窗里。「准备发布」改为 `PublishDialog`（来源 → 检查 → 版本三步在同一个弹窗里，关窗保留各步输入），进入／调整维护改为 `MaintenanceDialog`，重新部署改为 `RedeployDialog`。离开确认列出会丢的草稿（发布准备、切换说明、维护设置）。通用规则见 RFC-003 design §6 同日一条。

## 7. 运行与诊断、开发资源、项目设置

- 运行与诊断保留 `Tabs`，五个页签。`status` 页签：`HealthCards` 在上（保留「查看此版本日志」）、`TopologyPage` 在下；两者各自的查询与轮询不变。`TracePage` 空态文案改为说明 trace_id 的来源并给事件投递链接。

> **2026-09-23 修订（作者当面裁定，直接修改＋回填，不另立 RFC；Design §14.7、D62）。** `TracePage` 由 `features/traces` 的 `TracesPage` 取代：
> - **布局**：左 `TraceListCard`，右 `TraceDetail`，按页签内容宽度（容器查询 760px）并排或上下。
>   - `TraceListCard`：`TraceFilterBar` 放来源、状态、时间三个筛选，`TraceOpenForm` 粘贴 trace_id，列表用 `ResourceRow`，底部「加载更多」。
>   - `TraceDetail`：`TraceTaskBlock` → `TraceExecutionNode` → 展开 `TraceEvents`。
> - **地址参数**：新增 `traceSource`、`traceStatus`、`traceWindow`，缺省即全部；`traceId` 不变。
> - **接口**：旧的平铺回放 `TraceReplayDto` 删除，改为三条：
>   - `GET /v1/projects/{projectId}/traces`，参数 `source`、`status`、`window`、`cursor`、`limit`；
>   - `/traces/{traceId}`，分层回放，本项目没有这条链时 404；
>   - `/traces/{traceId}/executions/{taskId}/events`，`cursor` 是序号。
> - **服务端**：每次读取都按项目取数。task-runtime、events、business-task、session 各提供按项目的查询，observability 合并；两个来源合并翻页时，按「各来源都已完整扫描到的下界」截断，不丢不重。
> - **公共件**：`ResourceRow` 加可选 `plain`，首行用正文字体。
> - **用例**：
>   - 工作台：`traces` 新增 10 条，`projectNavigation` 的调用链两条改写；
>   - 模块：`traceChains`、`traceRoutes`，以及四个模块的 `traceQueries`、`traceTasks`、`eventSummary`；
>   - e2e：新增 `traceChains`；`projectWorkspaceIa`、`capabilityDepth`、`layoutSpacing` 跟着改名与新表单。

> **2026-09-23 修订二（作者反馈「左侧太长了，搞出来整页滚动条」，直接修改＋回填，不另立 RFC）。** 宽屏（页签内容宽于 760px）时两栏长满到窗口底边、各自滚动，整页不出纵向滚动条：`useViewportFill` 量出容器顶边到窗口底边的高度（扣主区下内边距，不低于 360px，窗口或主区尺寸变化时重量）；`TraceListCard` 的筛选与「按 trace_id 打开」固定在卡片上部，行与「加载更多」在卡片内的滚动区里；详情栏自己滚，换选一条时滚回顶部。窄屏上下排不变（选中后把详情滚进视野）。用例：`traces` 改写滚动一条、新增量高一条；e2e `traceChains` 在 1280px 断言整页不纵向滚、两栏底边在窗口内。

> **2026-09-23 修订（作者当面裁定，直接修改＋回填，不另立 RFC）。** `OPERATIONS_TABS` 改为 `topology`、`health`、`logs`、`alerts`、`deliveries`、`trace` 六个，缺省 `topology`；`TopologyPage` 与 `HealthCards` 各占一个页签，各自的查询与轮询不变。`hasLegacyOperationsTab` 只认 `tab=status`，路由把它改写为 `tab=topology`，`health`／`topology` 重新是正式页签名；概览 `DeploymentTopologyCard` 链到 `tab=topology`，`ProjectAttentionBanners` 的健康横幅链到 `tab=health`。

- 参考面板的三段内容见 §5.3；`CatalogPage` 的「表在前、详情在旁」（`OperationsTable` → 选中行右侧 `OperationDetail`：文档、授权状态、申请表单、试调；`SwaggerPanel` 折叠；管理员链接改页脚一行）只在放大形态渲染；事件段顶部一行「最近投递 n 条 · 死信 m 条 →」来自 `api.events.listDeliveries` 的一页计数。

> **2026-09-23 修订（作者当面裁定，直接修改，不另立 RFC）。** `SwaggerPanel` 不再包 `<details>`，直接渲染在 `RequestsPanel` 之下；`proxy` 参数只作为它的初始代理（`catalogDetail` 用例相应改写）。§5.3 表中「折叠的 `SwaggerPanel`」同此。

> **2026-09-23 修订二（作者反馈「信息无法理解、表格超出页面有横向滚动条、UUID 有什么用」，两轮问答裁定，直接修改＋回填，不另立 RFC）。** 「可使用资源」面板重做：
> - **按代码怎么用它分四类**（地址参数 `topic` 只增不改）：`api`「调用接口」（代理、其他数字人与平台业务子任务接口）、`events`「接收事件」（已订阅、可订阅类型、推送请求头）、`guide`「运行环境」（环境变量、用户请求头、服务与链路头、约定路径、应用配置键）、新增 `agent`「Agent 工具」（两个平台 MCP 与开发会话令牌头）。旧链接 `guide=mcp` 落到 `agent`、`guide=tasks` 落到 `api`；原「平台接入」的 `<details>` 折叠块与 `devSessionToken` 这类代码内部键名去掉，每项写中文用途（`capabilities.meaning.*`，没有说明的只显示名字）。
> - **统一的两行列表**（`shared/ui/resource/ResourceList`）取代宽表格：首行是写代码要用的值（方法＋路径、事件类型、变量名），次行是来源与说明，右侧是动作；只在 `/`、`.`、`-` 后折行，任何宽度面板内都没有横向滚动（主题页签条除外）。
> - **接口**：不再显示操作 ID；侧栏与放大都列全部，可调用的（含平台接口）置顶、需申请的在分割线下；搜索＋提供方＋状态筛选；点路径在行下展开调用地址（`${CS_INTERNAL_API_BASE}<代理><路径>`、平台接口为 `${CS_PLATFORM_API_URL}<路径>`，可复制）；侧栏里「试调」「申请」在该行下原地展开，会话绑定压成一行、会话 ID 只进悬停提示；放大形态仍是列表在前、`OperationDetail` 在旁（ID 行换成调用地址），申请记录用「代理 方法 路径」代替操作 ID，列表与详情按面板宽度（容器查询 680px）而非窗口宽度排布。`OperationsPanel` 删除，`OperationsTable` 只留给管理空间。
> - **事件**：已订阅一行一条（类型 → 处理路径、状态）；可订阅的按生产方分组、按「生产方.族.子类型」归族，子类型是按钮，点一下复制可粘进 `crewstation.yaml` 的订阅片段（按 ID 绑定、注释写类型，UUID 只出现在片段里）；下线的类型不列；推送请求头放在最后。
> 用例：`referencePanel`（四条新增）、`resourceListModel`（新增）、`projectResources`、`catalogConsumption`、`catalogDetail`、`apiInvocationForm`、`adminCapabilities`、`projectNavigation` 相应改写；e2e 新增 `referenceResources`（三个宽度、四类、无横向滚动、接口与事件里无 UUID），`capabilityDepth`、`projectSettingsUx` 改为四类。

> **2026-09-23 修订三（作者裁定，直接修改＋回填，不另立 RFC；表单与确认改弹窗）。** 「申请定向开放」不再在行下或详情栏展开：侧栏行按钮与放大形态详情栏都打开同一个 `AccessRequestDialog`，写清申请的是哪个操作；理由按操作各留一份草稿，关窗保留，受理成功才丢。「试调」仍在行下原地展开（作者裁定保持原样），它的「切换操作并丢弃输入」确认与 Swagger 的「切换或重新加载文档」确认改为确认弹窗。项目设置里成员、应用展示与可见范围、环境变量的新增与修改同日改为弹窗，见 RFC-009 design 同日修订。
- 项目设置 `info` 组：`ProjectInfoSection` 用 `DefinitionList`：仓库（路径、默认分支、状态、打开）、地址（两槽域名、开发预览域名）、服务身份（服务名、命名空间）、配额与套餐（`CapabilityQuota` 的数据）、折叠技术详情（项目 ID、服务 ID、命名空间，可复制）。只读，不画输入框。

> **2026-09-23 修订（作者当面裁定，直接修改，不另立 RFC）。** 技术详情就是项目信息：`ProjectInfoCard`（`features/projects/components`）作为 `info` 组第一张卡直接展示项目 ID、服务 ID、命名空间，不再折叠；三个标签改走 `projects.info.*` 文案（原为写死的英文）。其后的仓库卡与 `CapabilitiesPage section="project"` 不变（`projectResources` 用例断言卡片顺序与内容）。

> **2026-09-23 修订（作者当面裁定，直接修改，不另立 RFC）。** `ProjectInfoCard` 末行加「仓库」：`pathWithNamespace ↗` 外链（`target="_blank"`、`rel="noreferrer"`；引用型文字链接，不是按钮）。仓库绑定由新增的 `features/projects/model/useRepositoryBinding` 读取，`ProjectInfoCard` 与 `RepositoryCard` 共用同一个查询键与取数函数，只请求一次（原先概览带格式校验、源码仓库卡不带，两份取数函数挂在同一个查询键上，随概览不再读仓库一并归一）。没有 `serviceId`（开通未完成）时不读、该行为「—」；读取中或读取失败写「暂未读取到」（`projects.info.repositoryUnread`），失败原因仍由源码仓库卡的 `QueryStatus` 给出。文案键 `projects.summary.repository` 随概览页头删除。

> **2026-09-23 修订（作者当面裁定，直接修改＋回填，不另立 RFC；仓库打开地址）。** 两处打开仓库的链接（项目信息卡「仓库」一行、源码仓库卡「在 GitLab 中打开」）改用 GitLab 自报的网页地址。原因：本机 `CS_GITLAB_URL` 是只在容器里解析得了的 `http://host.docker.internal:8929`，由它拼出的克隆地址 `httpUrl` 在浏览器里打不开（GitLab 自报的是 `http://127.0.0.1:8929/<组>/<项目>`）。`RepositoryBindingDto` 加可选 `webUrl`；scm 模块建仓时记下 GitLab 项目的 `web_url`（迁移 `scm/0004` 加可空列 `web_url`），这一列之前建的绑定在第一次被 `getBinding` 读到时向 GitLab 查一次并存下——只补已就绪的、远端项目 ID 须一致，查不到或 GitLab 不可达就原样返回、下次读取再试；工作台 `repositoryWebUrl()` 取 `webUrl`，没有时退回 `httpUrl`。克隆、构建、推送仍用 `httpUrl`。

## 8. 名称、ID 与状态文案

- 36 位 ID 只出现在技术详情或 `title`＋复制；表格列显示名字、标签或短 ID（前 8 位）。
- 版本状态文案统一：槽状态用「就绪／部署中／失败／空」，发布状态沿用 `release.status.*`；概览与发布页共用 `DeployedVersionCard`。
- 时间用 `useDateText`；「读取于」只在 `PageRefresh`。

## 9. 失败模式

| 情形 | 表现 |
|---|---|
| 个人布局保存冲突（revision 不一致） | 沿用现有 `reapply`／`useRemote` 提示；面板状态随布局一起回退，不丢编辑器草稿 |
| 旧布局没有 `tool` | 迁移函数给出等价状态；写回后旧字段同步 |
| 成员列表读取失败 | 切流条目显示短 ID＋复制，并在时间线顶部一行「人名暂不可用」；不阻塞发布记录 |
| 发布列表与切流列表一个失败 | 时间线只显示成功的那一类并说明缺失的一类，不显示「没有记录」 |
| 概览的仓库或比较摘要读取失败 | 页头链接行只显示能读到的项；开发会话卡的待上线／未提交显示「未检查」 |
| 会话面板内嵌日志读取失败 | 面板内就地错误与重试，不影响连接信息 |
| 内容区窄于 800 | 面板只有放大形态；`panel=side` 被忽略但不改写 URL |
| 旧地址重定向 | 一次 `replace`，参数保留；`resources?section=data` 带 `proxy` 之类无关参数时丢弃 |

> 2026-09-23 修订：概览不再读仓库，「概览的仓库或比较摘要读取失败」一行只剩比较摘要；仓库读取失败改在项目设置 → 项目信息表现——项目信息卡的「仓库」一行写「暂未读取到」，源码仓库卡给出失败原因（§7 同日修订）。

## 10. 测试策略

工作台用例（`apps/console/src/tests/`，happy-dom，全部经 `fetch` 桩）：

| 用例文件 | 覆盖 |
|---|---|
| `projectNavigation.test.tsx`（改） | 左栏六项顺序与文案、测试者仅一项、管理空间同构、`--cs-nav-width` 单一来源不变 |
| `projectOverviewLayout.test.tsx`（新） | 页头链接行三种就绪状态、三张卡、横幅四类、最近动态 5 条、无快捷入口卡、无逐卡刷新按钮 |
| `overviewNextStep.test.tsx`（改） | 新增数据访问待批横幅 |
| `workspaceLayout.test.ts`（改） | `migrateLayoutTool` 三种输入；写出回填 `view`／`previewAlongside` |
| `devSessionPanel.test.tsx`（新） | 面板打开／收起／放大与 URL 往返；`view=split`、`view=diff`、无参数写回；宽度阈值；无会话时只有参考；页签后缀 |
| `devSessionToolbar.test.tsx`（新） | 一条工具行：拆分按钮主键与展开、布局菜单、「⋯」里的名册与关闭；阻断原因位置 |
| `sessionNavigation.test.tsx`（改） | 会话面板内嵌日志与「完整日志」链接参数 |
| `releaseTimeline.test.ts`（新） | 合并排序、标签与人名三种解析、失败条目日志参数 |
| `releaseDelivery.test.tsx`、`releaseInspection.test.tsx`（改） | 上线按钮在待验证卡；`switch=1` 自动检查；两张表被时间线取代 |
| `projectOperations.test.tsx`（新） | 五个页签、`health`／`topology` 重定向、状态页签两部分、调用链空态 |
| `projectResources.test.tsx`（改名 `referencePanel.test.tsx`） | 五条重定向与参数保留、三段在侧栏与放大两种形态的内容、无会话时可打开而试调禁用、API 表在前详情在旁、事件段投递摘要 |
| `projectSettingsInfo.test.tsx`（新） | 项目信息组内容、只读、技术详情折叠与复制 |
| `i18nParity.test.ts` | 中英文键对齐（现有） |

契约：`packages/contracts/api/devSession.ts` 的 `tool` 字段正向解析与 `strict` 拒绝未知键（就近用例）。
实机（`tests/e2e/`）：`platformCapabilities.test.ts` 的 `PROJECT_PAGES` 更新标记词并加一行「参考面板放大形态渲染 API 全表」；`projectSettingsUx.test.ts` 路由表改为设置五组＋参考面板三段；`layoutSpacing.test.ts` 加开发页面板在 1280／1024 的宽度与无溢出；`topology.test.ts` 的运行与诊断入口改为 `tab=status`；新增 `projectWorkspaceIa.test.ts`：概览一屏（1440×900 下主区不出现纵向滚动条）、面板打开后终端仍可见、旧地址重定向、时间线无 36 位 ID。
每个新增页面或组件按 `testing.md` §4 带载入、空、错、成功四态。

## 11. 与既有 RFC 的关系

批准后在以下 RFC 的对应节追加带日期的修订说明（不改其 Done 状态）：RFC-003 proposal §4（五个入口→六项顺序）、design §2.2（概览）、§2.3（工作区工具由页签改为面板）、§2.4（切流记录并入时间线、上线按钮上卡）、§2.5（运行与诊断分段）；RFC-008 proposal §3（六个页签→面板）；RFC-009 proposal §3.1（开发资源独立入口取消，内容进参考面板与设置）、§3.5（五主题各自去向）；RFC-019 proposal §2.2（入口改为 `tab=status`）。基线三件套需要回填的只有 Design §14.6／Plan AT 的入口名称，随实施提交。
