# RFC-003｜原型 UX 审查证据

> 日期：2026-09-13 · 源码：`4268c2b2e374b0e9fa65f9fde707d44ba3315e3f`\
> 本机：`http://console.cs.localhost` · 示例项目 `prj_01a090f72dea7000b5ff6d3841cbaf7b`。\
> 这是设计检查与界面走查，不是量化可用性研究，不声称测过效率提升。

## 1. 验证范围与方法

按顺序读 STATE、CLAUDE、开发规则、结构规则、踩坑记录；对照两篇理念文章、基线 Proposal／Design／Plan 和两个已完成 RFC。读路由、页面、组件、客户端契约及关键发布／释放用例。

浏览器查看普通成员首页，随后经作者明确授权使用已有 `admin` 演示身份，查看数字人列表、项目概览、开发会话、Agent 创建表单、发布、接口目录、管理总览与接入容器。没有启动 Agent、提交发布、切流、删除会话或修改业务配置。开发页面自身会挂接现有终端和会话流，不能将页面访问描述为完全没有连接副作用。

普通 `tenant-user` 当前无项目，不能用这次空列表证明项目成员视角完整通过。管理员同时是示例项目负责人；不能把其可见按钮当成普通开发者／测试者的权限证据。角色差异另由源码核验，未来需独立测试账号验收。

## 2. 问题与证据

| 编号 | 观察与源码证据 | 判断与影响 | 对应旅程 |
|---|---|---|---|
| UX-01 | `app/layout/ProjectNavSection.tsx:23–42` 平铺八项，以 projectId 标示项目；浏览器左栏、顶栏都显示长 ID | 用户必须记住技术标识；项目上下文不易辨识 | 全局 |
| UX-02 | `features/projects/pages/ProjectListPage.tsx:28–37` 在列表前常驻创建表单；`CreateProjectForm.tsx:16–17,56–63` 包含三种 kind；浏览器确认 | 首页高频“找项目”被低频创建挤占；管理边界未走到底 | J1、J6 |
| UX-03 | `features/projects/pages/ProjectOverviewPage.tsx:24–59` 按说明、身份、槽、成员、配额、仓库呈现；唯一页首动作前往发布 | 缺少当前会话与继续开发；主线与当前任务脱节 | J1、J2 |
| UX-04 | `features/dev-session/pages/DevSessionWorkbench.tsx:50–57` 六类面板；同目录 `.module.css:4–12` 排列 Agent／终端 → 编辑器 → 预览／发布 → 数据；1280×720 实看预览不在首屏 | 描述需求与观察结果之间需要反复滚动；工具与目标同权重 | J2 |
| UX-05 | `features/dev-session/components/SessionCard.tsx:28–43,57–59` 常驻 TaskRunner、任务 ID、创建者 ID；浏览器首屏大量说明、技术元数据 | 管理内部结构占据真正工作的空间 | J2 |
| UX-06 | 开发页实看文字“晋级与回退在发布页”；`features/release/pages/ReleasePage.tsx:24–28` 仅发布、历史、切流记录与标签；实际动作在 `features/projects/components/SlotsSection.tsx:30` | 明确的路径断裂，按照提示到达后无法完成目标 | J3 |
| UX-07 | `features/release/components/PublishForm.tsx:39–47` 调用 `services.publish`；`modules/release/application/publish.ts:16–25` 直接远端打标签；`modules/dev-session/application/publishFromSession.ts:19–28` 先检查容器再推送 | 两处“发布”的源码来源不同，界面未明确承诺范围；需保留两种能力并区分 | J3 |
| UX-08 | `features/release/components/ReleaseRow.tsx:14–34` 行不可钻取，失败仅 message；`features/logs/hooks/useLogFeed.ts:42–46` 不送 releaseId／taskId；契约 `packages/contracts/api/observability.ts:7–15` 已支持 | 发布失败不能带上下文进入日志，用户自行寻找对象 | J4 |
| UX-09 | `features/projects/components/TrafficSwitchAction.tsx:28–35` 主要按槽名确认；实看按钮“切流到 preview”；`modules/release/domain/slots.ts:4–5,34–39` 的 prod／preview 为角色 | 用户要理解底层槽模型才知道操作结果；改为确认版本间的流量转移 | J3 |
| UX-10 | `features/dev-session/components/ReleaseControl.tsx:19–21,35–37` 确认后释放；`modules/dev-session/application/sessionLifecycle.ts:74–90` 计算 unpushed 后释放，再返回；查询失败置空 | 决策时看不到实际未推送提交；检查失败不应被当成已安全推送 | J2 |
| UX-11 | `features/catalog/components/CatalogContent.tsx:22–31` 将管理操作、本服务申请、Swagger 叠放；浏览器租户导航下出现“改为默认开放” | 供给方与消费方混杂，管理员在租户空间容易失去操作范围感 | J5、J6 |
| UX-12 | `features/catalog/components/SwaggerPanel.tsx:24–26` 提示关闭试调；浏览器提示“请在开发会话的终端里调用” | 基线 Design §8.4 期待的发现→试调链未完成，不能只改文案说已可试调 | J5 |
| UX-13 | `features/projects/components/MemberForm.tsx:17–18,44–53` 非管理员负责人只能填写 UserId | 负责人无法自然地按人的身份邀请已注册成员 | J1 |
| UX-14 | `features/events/pages/EventsPage.tsx:17–21` 类型、订阅、投递共页；`features/capabilities/pages/CapabilitiesPage.tsx:44–56` 九段依序铺开 | 声明接入与排障查询混在一起；能力页更像输出报表，需要按意图组织 | J4、J5 |
| UX-15 | `features/admin/pages/AdminOverviewPage.tsx:6–11` 仅导航卡；`features/admin/components/IntegrationProjectsSection.tsx:39` 跳 `/projects/$projectId`；浏览器页脚让管理员回工作台创建 | 管理空间缺少连续的管理旅程 | J6 |
| UX-16 | `modules/observability/http/observabilityRoutes.ts:21–25` 已有告警、订阅和 trace；`packages/api-client/resources/observability.ts:10–15` 仅封装日志／健康 | 前端未承接的现有能力会让“运行诊断”缺最后一段；应补客户端接线而非假装不存在 | J4 |

上述 `app/` 与 `features/` 相对路径均从 `apps/console/src/` 起算。行号固定于本页基线，后续实现会变化；复核时用 Git 中的该 SHA。

## 3. 实跑中需保留的事实

- 示例项目 prod 为 `v0.1.2`，preview 为 `v0.1.4`；二者都有真实可访问地址。历史有构建失败与生产配置缺键失败，应以它们验证故障恢复入口。
- 开发会话存在并已连接，空闲提示没有自动释放；打开 Agent 创建仅需档位、权限、首条指令，已遵守 RFC-001。不能退回选择驱动／模型。
- 发布分支选择在数据返回前暂时显示“没有可选分支”，随后出现 `main`。这是观察到的瞬时加载表现，未判定分支接口损坏。
- 管理空间八个入口已存在；重设计须接续 RFC-002，不能把“已经分离”误报为“完全没做”。
- 后端已有物理 blue／green 与 prod／preview 角色转换，不需要为了换页面再造一套发布领域模型。

## 4. 不是纯前端重排就能解决的缺口

| 缺口 | 已有基础 | 本 RFC 要补的最小内容 |
|---|---|---|
| 释放／发布前可靠的工作区事实 | TaskRunner exec，发布时 git status，释放时 git log | 无写入预检查询；明确读取失败，释放前实际损失确认；不新增自动提交 |
| 非管理员负责人定位成员 | 设置成员的 UserId 命令 | 项目内精确匹配已注册身份的查询；只返回设置成员所需信息，不开放全局目录 |
| 内嵌 API 试调 | 当前服务授权、OpenAPI、开发会话命令通道 | 结构化请求经现有开发容器执行的受控适配；响应限制与错误契约 |
| 项目列表的版本／会话／健康摘要 | 各项目已有多个独立查询；ProjectDto 无这些字段 | 首屏分页聚合或可见项有界加载；不要每次打开列表对所有项目发多路请求 |
| 独立准备状态 | SessionDto 只有总体状态和 preview；基线要求更多独立状态 | 先使用真实已暴露信号，未知即未知；完整分项须相应服务端状态契约，不能画假绿勾 |

## 5. 评审限制

本轮未创建新的业务发布或运行真实模型任务；没有模型效果、耗时、成功率或跨角色端到端结果。交互附件是设计示例，不是当前集群状态。生产实现与完整用户旅程的验收在 RFC 获批之后执行。
