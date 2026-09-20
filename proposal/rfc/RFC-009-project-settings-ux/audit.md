# RFC-009｜现状审查

> 2026-09-20；源码基线 HEAD／origin/main 均为 `6ebd6c7b071d42e87a15f104f778843b66159595`。
> 工作树包含并行 RFC-008 未提交改动，不把它们算作本批产出。浏览器仅查看既有管理员会话，没有提交配置、成员、授权或归档。

## 1. 实机所见

工作台 `http://console.cs.localhost`，演示项目 `prj_01a090f72dea7000b5ff6d3841cbaf7b`。

- 设置默认跳到 `?tab=members`，六个同层页签；成员列表后直接出现账号／高级 ID／管理员目录切换与角色表单。
- 配置页默认开发组为空，但仍展示多段规则、新建表单、两个操作按钮和空的版本历史。
- 开发资源默认“约定与资源”，先展示服务身份、域名，再完整展开集成约定、配置键、数据、22 条操作、事件、配额、MCP 和业务任务接口。首屏只够看到前两个信息块。
- 应用可见性同时展开范围编辑、用途／图标编辑和账号可见性检查，日常查看也要面对三组表单。
- 本轮资源聚合页面能成功读取。旧记录中的 500 不作为当前故障结论。

## 2. 源码证据

路径从仓库根起；行号为本轮核对时位置，后续实施可能移动。

| 现状 | 证据 |
|---|---|
| 六页签＋资源嵌套，默认成员 | `apps/console/src/app/project/ProjectSettingsPage.tsx:17–40`；`shared/project/settingsSearch.ts:1–25` |
| 聚合资料一次展开九类内容 | `apps/console/src/features/capabilities/pages/CapabilitiesPage.tsx:50–63` |
| 配置默认展开写入和历史 | `apps/console/src/features/config/components/ConfigEnvPanel.tsx:55–100` |
| 开发者仅可写开发组 | 同文件 `:30–44` |
| 两环境挂载保留、离开保护 | `apps/console/src/features/config/pages/ConfigPage.tsx:10–23` |
| 键名、空值、密钥与生效条件 | `apps/console/src/features/config/components/ConfigItemForm.tsx:26–58`；`features/config/i18n/zh-CN.ts:61–67` |
| 两个独立编辑器与共用离开保护 | `apps/console/src/features/projects/components/visibility/AppVisibilitySettings.tsx:26–56` |
| 成员高级选择与转移确认 | `apps/console/src/features/projects/components/MemberForm.tsx:13–35` |
| 仓库只有读取和外链 | `apps/console/src/features/projects/components/RepositoryCard.tsx:19–40` |
| 归档仅管理员，状态与技术详情混排 | `apps/console/src/features/projects/components/ProjectLifecycleCard.tsx:14–35` |
| 归档实际影响的现有文案 | `apps/console/src/features/projects/i18n/zh-CN.ts:360–362` |
| 事件订阅来自 Manifest 发布，无编辑动作 | `apps/console/src/features/events/components/SubscriptionsCard.tsx:11–42` |
| API 是本服务消费目录，不是设置 | `apps/console/src/features/catalog/pages/CatalogPage.tsx:13–32` |
| 当前接入身份是实际配置、环境键不含值 | `apps/console/src/features/capabilities/components/CapabilityConventions.tsx:18–35`；`CapabilityConfigKeys.tsx:12–31` |
| 五个项目入口、测试者仅试用 | `apps/console/src/app/layout/ProjectNavSection.tsx:17–43` |

表中缩写路径继承前一个完整路径的 `apps/console/src/` 前缀。

## 3. 原设计的职责依据

`proposal/proposal.md` §1–2 强调业务团队使用平台供给的身份、资源和 API 开发自己的业务应用；开发者无需承担平台基础设施配置。
`proposal/design.md` §7.3 区分平台管理员、负责人、开发者与试用者。
RFC-003 design §2.6–2.7 把这些内容收到了设置；本次细化这一边界，保留既有业务流程和权限。

## 4. 改版判据

- 查看内容不使用可编辑表单样式；读资料不必进入设置。
- 能在界面修改的对象有明确动作与保存边界；代码声明的对象提供文件入口和生效说明。
- 展开按用户意图，不同时铺开全部表单和历史；核心影响说明仍在当前动作附近可见。
- 不删功能来减少页面内容；完整迁移清单在 proposal §5。
