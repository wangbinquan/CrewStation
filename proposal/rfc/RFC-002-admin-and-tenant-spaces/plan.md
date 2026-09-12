# RFC-002 · 管理空间与租户空间分离｜Plan

- 状态：Done
- 日期：2026-09-12

## 任务分解

| 编号 | 任务 | 依赖 | 产物 |
|---|---|---|---|
| **RFC-002-T1** | `modules/project`：`GET /v1/projects` 接受可选 `kind` 过滤，先作用域后过滤；省略时行为不变 | — | `modules/project/**` ＋ 两条用例 |
| **RFC-002-T2** | `packages/api-client`：`projects.list` 支持 `kind` | T1 | `packages/api-client/resources/projects.ts` ＋ 用例 |
| **RFC-002-T3** | 工作台路由树拆成 `workbenchRoute` 与 `adminRoute` 两棵，管理路由按 §2.1 建齐（内容先搬现有分区） | — | `apps/console/src/app/router/**` |
| **RFC-002-T4** | `adminRoute` 守卫：pending / 拒绝 / 错误 三态，拒绝页含回工作台链接 | T3 | `apps/console/src/app/**` ＋ 三条用例 |
| **RFC-002-T5** | 顶栏空间切换控件：仅管理员渲染；往返保持租户侧路径 | T3 T4 | `apps/console/src/app/layout/**` ＋ 往返用例 |
| **RFC-002-T6** | 两套左栏：租户左栏去掉管理入口；管理左栏按 §2.1 列出七项 | T3 | `apps/console/src/app/layout/**` ＋ 源码层断言 |
| **RFC-002-T7** | 现有 `AdminPage` 的六个分区拆成独立页，组件搬迁不改逻辑 | T3 | `apps/console/src/features/admin/**` |
| **RFC-002-T8** | 接入容器页：列出 `APIProxy` 与 `EventProducer` 两类项目，可进入其项目页 | T2 T7 | `apps/console/src/features/admin/**` |
| **RFC-002-T9** | 租户项目列表带 `kind=DigitalWorker`；空状态区分「还没有项目」与「过滤后为空」 | T2 | `apps/console/src/features/projects/**` ＋ 用例 |
| **RFC-002-T10** | 浏览器实跑：管理员与普通成员各走一遍，确认两个空间的可见性与往返 | 全部 | 实跑证据写回 `STATE.md` |

## 提交拆分建议

不开分支（开发规则 §1），按三段提交：

1. **T1–T2**：后端过滤参数与客户端。可独立推，不影响现有界面。
2. **T3–T7**：路由分裂、守卫、切换、两套左栏、管理页拆分。这一段中途会红，做完一起推。
3. **T8–T9**：接入容器页与租户列表过滤。第三次推。
4. **T10**：实跑与 `STATE.md`。

## 验收清单

- [x] 非管理员：顶栏无空间切换控件，左栏无任何管理入口
- [x] 非管理员访问 `/admin/*` → 拒绝页（非 404、非空白、非静默跳转），含回工作台链接
- [x] `/v1/me` pending 时不闪现内容也不闪现拒绝；请求失败时显示错误而非拒绝
- [x] 管理左栏含总览、用户与权限、算力档位（RFC-001 已填真内容）、服务套餐、任务容器套餐、接入容器、出站白名单、网关
- [x] 租户项目列表不含接入容器；管理空间的接入容器页列出它们
- [x] 普通成员带 `kind=APIProxy` 请求也拿不到别人的接入容器
- [x] 空间往返保持项目上下文
- [x] 十个既有页面的功能与路径不变
- [x] `bun run check` 全绿，CI 绿
- [x] `proposal/rfc/README.md` 状态改 Done 并附 commit
- [x] `STATE.md` 更新
