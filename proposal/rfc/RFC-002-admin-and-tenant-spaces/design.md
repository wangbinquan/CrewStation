# RFC-002 · 管理空间与租户空间分离｜Design

- 状态：Done
- 日期：2026-09-12

## 1. 落位

| 模块／包 | 层 | 改什么 |
|---|---|---|
| `apps/console/src/app/**` | — | 路由树分成两棵、顶栏空间切换、两套左栏、管理路由守卫 |
| `apps/console/src/features/admin/**` | — | 现在的单页 `AdminPage` 拆成管理空间的多个页面 |
| `apps/console/src/features/projects/**` | — | 项目列表过滤掉接入容器 |
| `packages/api-client` | — | `projects.list` 增加 `kind` 过滤参数（若走服务端过滤） |
| `modules/project` | L2 | `GET /v1/projects` 接受 `kind` 过滤（可选） |

**零改动**：全部后端权限判定。`listProjects` 的作用域逻辑、各路由的 `isAdmin` 校验保持原样。

**不新增模块**，不需要 ADR。`apps/console` 内部的目录结构仍遵守 `repository-structure.md` §8：`features/*` 互不 import，公共件只走 `shared/`。

## 2. 空间模型

两个空间，同一份构建产物、同一个域名，靠路由前缀区分：

| 空间 | 路由前缀 | 谁能进 | 左栏 |
|---|---|---|---|
| 工作台（租户） | `/`、`/projects/*` | 所有登录用户 | 我的项目 ＋ 当前项目的八个页面 |
| 平台管理 | `/admin/*` | 仅管理员 | 用户与权限、算力档位、服务套餐、任务容器套餐、接入容器、出站白名单、网关 |

顶栏的空间切换只对管理员渲染。**这是导航，不是权限边界**——权限边界在后端，每个管理路由本来就有 `isAdmin` 校验。

### 2.1 路由树

```
rootRoute
├─ workbenchRoute            （无路径）      布局：租户左栏
│  ├─ projectListRoute       '/'
│  └─ projectRoute           'projects/$projectId'
│     └─ （八个页面，不变）
└─ adminRoute                '/admin'       布局：管理左栏 ＋ 守卫
   ├─ adminOverviewRoute     '/admin'
   ├─ adminUsersRoute        '/admin/users'
   ├─ adminComputeRoute      '/admin/compute'        ← RFC-001 先落，这里直接是真页面，不是占位
   ├─ adminServicePlansRoute '/admin/service-plans'
   ├─ adminTaskProfilesRoute '/admin/task-profiles'
   ├─ adminIntegrationsRoute '/admin/integrations'   ← 接入容器
   ├─ adminEgressRoute       '/admin/egress'
   └─ adminGatewayRoute      '/admin/gateway'
```

现有 `AdminPage` 是一个页面里堆六个分区（用户、服务套餐、任务容器套餐、出站条目、出站申请、网关）。拆成上面这些路由，每个分区一页，组件基本原样搬过去。

**为什么拆页而不是保留单页**：单页时每个分区各自 `useApiQuery`，进一次管理页发六个请求；拆页后按需加载。更要紧的是左栏要能表达「平台管理有哪些事」，一个入口表达不出来。

### 2.2 守卫

管理路由的父级 `adminRoute` 挂一个组件级守卫：读 `/v1/me`，`isAdmin !== true` 时渲染拒绝页。

**不做路由级 `beforeLoad` 重定向**：`/v1/me` 是异步的，`beforeLoad` 里等它会让整个管理空间在首屏阻塞；而重定向到 `/` 会让「我明明有权限但网络慢」表现为神秘跳转。组件级守卫的三态（pending / 拒绝 / 放行）对用户更诚实。

拒绝页要说清三件事：这是平台管理空间、需要管理员、回工作台的链接。**不是 404**——假装不存在会让真管理员在排查权限时无从下手。

### 2.3 空间切换与上下文保持

顶栏切换控件的行为：

- 工作台 → 平台管理：跳 `/admin`，并把离开时的租户路径记在内存里。
- 平台管理 → 工作台：回到记住的路径；没有记录时回 `/`。

「记在内存里」指一个模块级变量或 context，**不进 `localStorage`**：这是一次会话内的便利，不是需要跨设备持久的偏好。

## 3. 接入容器移出租户列表

`ProjectDto` 已有 `kind`（`DigitalWorker` / `APIProxy` / `EventProducer`）。两种做法：

| 做法 | 取舍 |
|---|---|
| **服务端过滤**：`GET /v1/projects?kind=DigitalWorker` | 列表天然不含接入容器；管理空间用 `?kind=APIProxy,EventProducer` 取。多一个查询参数。 |
| 前端过滤 | 后端零改动，但接入容器仍会传到租户浏览器里 |

**选服务端过滤**。理由：接入容器对普通租户不该出现在任何响应里，前端过滤只是不显示、数据仍然发了。代价只是一个可选查询参数。

```ts
// GET /v1/projects?kind=DigitalWorker
// 省略 kind 时行为不变（返回作用域内全部），保证现有调用方不破
kind: z.array(ManifestKindSchema).optional()
```

作用域判定保持不变：管理员看全部、成员看自己的，`kind` 只是在那之后再筛一层。

## 4. 失败模式

| 情形 | 行为 |
|---|---|
| 非管理员访问 `/admin/*` | 拒绝页，含回工作台的链接。不是 404、不是空白、不是静默重定向。 |
| `/v1/me` 加载中 | 管理空间显示 pending 态，不闪现拒绝页也不闪现内容 |
| `/v1/me` 请求失败 | 显示错误与重试，**不当成「非管理员」**——把网络错误渲染成权限不足会误导排查 |
| 管理员在管理空间刷新页面 | 直接停在当前管理路由；切回工作台时因无记录而回 `/` |
| 项目列表按 `kind` 过滤后为空 | 空状态文案区分「你还没有项目」与「过滤后无结果」 |

## 5. 测试策略

**apps/console**

- 非管理员：顶栏不渲染空间切换控件；左栏无任何管理入口（源码层 ＋ 渲染断言）
- 非管理员访问管理路由 → 拒绝页，且页面里有回工作台的链接
- `/v1/me` pending → 既不显示内容也不显示拒绝
- `/v1/me` 报错 → 显示错误而非拒绝
- 空间往返保持项目上下文：`/projects/X/release` → `/admin` → 切回 → 回到 `/projects/X/release`
- 项目列表请求带 `kind=DigitalWorker`

**modules/project**

- `GET /v1/projects?kind=` 过滤生效，且**先作用域后过滤**：普通成员带 `kind=APIProxy` 拿不到别人的接入容器
- 省略 `kind` 时行为与改动前一致

## 6. 与 RFC-001 的关系

两个 RFC 独立，可各自落地。**实际顺序**：RFC-001 先落，它的算力档位分区先挂在当时的单页 `AdminPage` 上；本 RFC 拆页时把它搬进 `/admin/compute`，所以该路由是真页面而不是占位。

## 6.1 实现与本文的差异（落地后回填）

- `workbenchRoute` 是**无路径布局路由**（`createRoute({ id: 'workbench' })`），不占路径段。副作用：项目内页面的**路由 id** 变成 `/workbench/projects/$projectId`，`useParams({ from: '…' })` 写死字符串的三个页面改用 `projectRoute.useParams()`——这个写法本来就更好，不必知道 id 长什么样。
- 管理空间实际是**八个**路由：§2.1 的七项之外多一个 `/admin` 总览页。左栏能列出「平台管理有哪些事」，但进管理空间的落地页总得有内容，总览页给每项一张卡片说明它管什么。
- 原 `AdminPage` 的六个分区在 RFC-001 之后是七个；拆页时出站条目与出站申请合并在 `/admin/egress` 一页——批一条申请紧接着就要看它落成了哪条条目。

## 7. 偏离与债

- **拒绝页而不是路由级重定向**：见 §2.2。代价是管理路由的组件都会被加载一次才发现无权限；这些是纯前端组件、无副作用，可以接受。
- **空间切换记忆只在内存**：刷新后丢失。真需要持久化时再说，不预先加 `localStorage`。
- **管理员在租户空间仍看到全部项目**：这是既有行为，本 RFC 不改。若将来要「管理员默认只看自己的、需显式切到全部」，另立 RFC。
