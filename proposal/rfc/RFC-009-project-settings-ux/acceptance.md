# RFC-009｜实现与验收记录

> 2026-09-20。作者已批准实施及提交上库。生产实现完成；以下严格区分 HTTP 边界回归、真实工作台操作与尚未取得的外部 API 响应。

## 1. 已落地行为

项目导航新增开发资源；项目设置只含环境变量、应用展示、成员与角色、高级四组，默认开发变量。
桌面显示窄分组导航，900px 以下使用有标签的原生选择器；列表与摘要先显示，编辑表单按需打开。
保存／取消保留原角色判断、冲突处理、环境草稿、离开确认及焦点回到入口；生产部署对照在变量列表之后。
资料按 API、事件、数据与存储、项目与仓库、平台接入五个主题组织，技术详情按需展开。
两种空间与旧 settings／catalog／capabilities／config 路由保留定位上下文，以 replace 迁移；应用展示不出现在管理接入容器中。
原型的角色切换、失败模拟只在 `?review=1` 显示；正式应用没有评审工具。

## 2. 验收矩阵

下列前端测试通过真实路由、表单及请求边界驱动生产组件；受控 HTTP 响应不冒充真实集群写入。
配置写入、成员增删、授权与归档等业务变更在回归中验证，没有为了截图修改演示项目成员或生产配置。

| 编号 | 证据与结论 |
|---|---|
| PS-01 | 实际 demo 默认进入开发变量，新增表单、历史均收起；`configForms` 与真实 E2E 验证默认可见表单为零 |
| PS-02 | `configForms`、原配置 API 测试覆盖普通值、密钥不回填、空值、覆盖、删除和环境／键名／版本回执；本轮未在共享项目写配置 |
| PS-03 | 真实空表单提交后键名错误可见，焦点回到 `DATABASE_URL` 字段；回归覆盖读取／写入失败保留及重试 |
| PS-04 | 真实开发草稿切生产再返回保留，离开／取消具名确认、继续编辑保留，最后丢弃测试草稿；迟到开发回执不清生产输入有回归 |
| PS-05 | `configForms` 覆盖开发者生产只读、管理员可写、身份失败／撤销停写留草稿；本轮实机身份为管理员，未冒充全角色人工验收 |
| PS-06 | 实际生产 `GREETING` 与当前第 1 版可见，保存不自动发布的说明常显；`configImpact` 覆盖未知、缺槽、缺快照、不一致与错误恢复 |
| PS-07 | 实际两个应用摘要初始收起；`visibilitySettings` 覆盖独立编辑／保存／取消、名单、冲突、迟到结果和另一份草稿保留 |
| PS-08 | 实际成员列表及新增入口可用；`projectMembers` 覆盖精确查找、直接修改该行、ID、目录、移除、转移及失败草稿，未实际改成员权限 |
| PS-09 | 高级保留归档后果；`projectMembers` 覆盖管理员限定、状态约束、取消、失败与重试，未实际归档项目 |
| PS-10 | `projectResources` 核对五主题内容和空／错／未知配额；实际 demo 仓库为 `crewstation/demo`、分支 `main`，状态 ready，运行任务与配额可见 |
| PS-11 | 目录显示真实 22 个操作并打开详情试调；`catalogConsumption`、`apiInvocationForm`／`Draft` 覆盖授权、Swagger、请求、HTTP／耗时／trace及草稿；实际 GET 在原有容器网关通道超时，成功响应验收仍欠证，详见 §4 |
| PS-12 | `projectResources` 验证 Manifest 文件、订阅与投递 ID 往返，来源为代码声明；真实事件主题提供代码和投递入口 |
| PS-13 | `projectResources` 验证开发／生产数据、连接变量名、资源 ID 和同项目 data 深链接；真实数据主题保留对应入口 |
| PS-14 | `projectResources`、`projectNavigation`、`adminProjectSpace` 覆盖两空间旧地址、优先级、参数清理与后退，含 overview 携带过期 operation 的兼容情形 |
| PS-15 | `adminCapabilities`、`adminProjectSpace`、`appMarket`、`projectAccessBoundary` 保留管理员接入容器、测试者和普通使用者边界；本轮未重跑人工换角色 |
| PS-16 | 真实 E2E 1280px／390px／320px 中文浅色及 390px 英文深色，九主题无整页溢出；空表单、按需编辑、焦点与浏览器无异常通过。CUA 人工检视 1280×720、390×844、320×844，生产页签切换前后 y 均为 181.39px |

## 3. 候选与工程证据

- 定向原回归：8 文件 **89 pass／639 assertions**；新增资源与路由 **13 pass／57 assertions**。
- 配置／成员／应用／资源候选 **46 pass／383 assertions**；API／访问边界 **14 pass／95 assertions**。
- 视觉反馈修正后的配置／成员 **23 pass／240 assertions**。
- 最终真实浏览器 `projectSettingsUx`＋`capabilityDepth`：**11 pass／0 fail／274 assertions，42.70 秒**，日志 `/private/tmp/rfc009-e2e-final.log`。
- console Docker 构建完成；本机 Deployment `console` 为 `cs-console:rfc009-20260920-3`，镜像 `sha256:c3bc4f49916f727c7f831ce55c5a5ec0f0a6c32a04807d9dd67c36951087d3bb`，已滚动完成。
- 本批路径清单 `/private/tmp/rfc009-paths.json`；生产与测试内容指纹 `/private/tmp/rfc009-candidate-sha256.json`，用于复用同一候选门禁。
- 共同完整 gate 第一次停在新增 E2E 的两处 `Page.eval` 返回类型，未进入测试；仅补类型参数，根类型检查通过。
- 最终共同 `bun run check` **1684 pass／5 skip／0 fail，9534 assertions，272 文件，228.33 秒**。架构、全仓 lint、根与 console 类型均通过，日志 `/private/tmp/rfc008009-check-final-2.log`。59 个本批生产／测试文件内容指纹未变。
- 该本地门禁运行于共享工作树，包含 RFC-008 及其他任务未提交的门禁硬化；它们未混入本批范围。最终干净 checkout 结果单独以精确 SHA GitHub CI 核对，发布证据待回填。

测试夹具、真实浏览器 E2E 与 CUA 手工交互分别记录，以上计数有重叠，不相加为不同用例总数。
本次没有新增后端 DTO、迁移或持久化配置。保留 RFC-008 和其他任务的共享树输出；提交只包含明确范围。

## 4. 真实 API 试调限制

实际任务 `tsk_01a0954107447000b7936485fb80d15d`，操作
`test-gitlab:GET:/v4/projects/{id}/repository/commits/{sha}`，参数为 `crewstation/demo`、`main`。
容器命令 `api-9d828ca4-bf0b-405d-bf10-d128ceed0b93` 于 `2026-09-20T09:21:37.488Z` 返回
`api_invocation_timeout`。页面完整显示“API 试调超过 15 秒；请求可能已执行，请核对业务结果后再决定是否重试”，保留输入，离开前确认。
错误来自未修改的 TaskRunner `createApiInvoker`，调用的原有内部地址为 `http://api.svc.cs.internal/api/`；它未取得上游完整响应。
在同一容器直接执行一次相同目标的只读 GET（5 秒上限）也在 5001ms 返回 `TimeoutError`，可复现不经过本次 UI 的通道超时；尚未判定 DNS、网关或上游中的具体根因。
没有得到 HTTP 状态、成功耗时或 trace，不能以目录渲染或受控回归宣称本轮真实 API 成功。
RFC-009 保持 In Progress，后续补该真实响应验收；此限制不改变本次设置 UX 已完成实现与可独立发布的范围。
