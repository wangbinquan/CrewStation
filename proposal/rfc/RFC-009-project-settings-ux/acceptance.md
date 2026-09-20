# RFC-009｜实现与验收记录

> Done · 2026-09-20。作者已批准实施及提交上库。生产实现、原有验收与 PS-11 真实 API 成功响应均完成；HTTP 边界回归、真实工作台操作和旧部署问题分别记录。

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
| PS-11 | 目录显示真实 22 个操作；`catalogConsumption`、`apiInvocationForm`／`Draft` 覆盖授权、Swagger、请求、HTTP／耗时／trace及草稿；专用验收项目的详情和 Swagger 分别实际返回 HTTP 200、112／91 ms，任务、操作键和 trace 完整，见 §5。旧演示代理超时仍保留在 §4 |
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
- 该本地门禁运行于共享工作树，包含 RFC-008 及其他任务未提交的门禁硬化；它们的代码未混入本批范围。最终干净 checkout 结果单独以精确 SHA GitHub CI 核对。
- 实现提交 `c5e5f0ec7a6563183d64f5fedf8a166536d9a31c` 按 74 个精确路径上库，提交后核对署名、路径与远端一致；RFC-008 的两份共享文档输出保持完整。
- 精确 SHA [CI 35503015065](https://github.com/wangbinquan/CrewStation/actions/runs/35503015065) 于 `2026-09-20T09:47:55Z` 完成，`check` **success（2分56秒）**、`e2e` **success（6分16秒）**。
- 已读取 hosted e2e 原始日志：**18 pass／19 skip／0 fail／67 assertions**。该工作流没有 GitLab 与可验收项目，新增四个项目布局场景及五个项目能力场景在 CI 跳过；它们的实际执行证据是本机 11 项／274 assertions，不能把 CI 成功解读成托管环境覆盖了项目实机路径。

测试夹具、真实浏览器 E2E 与 CUA 手工交互分别记录，以上计数有重叠，不相加为不同用例总数。
本次没有新增后端 DTO、迁移或持久化配置。保留 RFC-008 和其他任务的共享树输出；提交只包含明确范围。

## 4. 旧演示代理的独立部署问题

实际任务 `tsk_01a0954107447000b7936485fb80d15d`，操作
`test-gitlab:GET:/v4/projects/{id}/repository/commits/{sha}`，参数为 `crewstation/demo`、`main`。
容器命令 `api-9d828ca4-bf0b-405d-bf10-d128ceed0b93` 于 `2026-09-20T09:21:37.488Z` 返回
`api_invocation_timeout`。页面完整显示“API 试调超过 15 秒；请求可能已执行，请核对业务结果后再决定是否重试”，保留输入，离开前确认。
错误来自未修改的 TaskRunner `createApiInvoker`，调用的原有内部地址为 `http://api.svc.cs.internal/api/`；它未取得上游完整响应。
在同一容器直接执行一次相同目标的只读 GET（5 秒上限）也在 5001ms 返回 `TimeoutError`，可复现不经过本次 UI 的通道超时；尚未判定 DNS、网关或上游中的具体根因。
这一次调用没有得到 HTTP 状态、成功耗时或 trace，不能以目录渲染或受控回归宣称成功。

后续定位：DNS 在 63ms 内解析到 Traefik `10.96.199.52`；同容器读取 JWKS 返回 200，未授权健康路径返回明确 403。
实际 GET 已经通过网关并到达 `reference-api-proxy-green`，代理在转发上游阶段超时。
运行镜像与 GitLab main 均停在 `v0.1.2`／`7dee80be75906e6265094bf852866a2ceb96bd0e`，没有
2026-09-15 已上库的 `fc10d203eef13bd532f03276021262d522f55b4c` 出站适配；直接读取部署源码确认
`src/platform/egressTransport.ts` 不存在，入口也没有调用 `platformEgressFetch`。
该项目没有 `host.docker.internal` 出站条目，原 Pod 直连上游健康路径也在 5000ms 超时。
上述证据把故障定位到旧代理的上游转发段；本轮没有替它增加权限、更新业务仓库或改动部署。
后续如要恢复演示项目的 `test-gitlab`，需按既有接入流程更新代理并配置其上游出站规则，不能把本 RFC 关闭解读为旧代理已修好。

## 5. PS-11 真实成功响应补验与收口

复用已配置的专用验收项目 `prj_01a09eb302d67000a680835da140f993`（`rfc003-verify-workbench`），
其既有 APIGrant 允许 `rfc003-integration-qa:GET:/v4/projects`；目标代理已部署出站适配，且该代理项目已有对应域名规则。
没有新增 APIGrant、白名单或凭据。调用匿名只读项目列表，响应 `[]` 是上游 GitLab 的真实 200 结果。

旧验收会话因 Runner 协议 1 与平台要求 2 不兼容而断开。作者在本轮明确回复「授权」后，使用真实工作台的
「检查并恢复原工作树 → 确认保留工作树重建」，沿用原资源套餐恢复任务 `tsk_01a09eb4f03f7000ba011a517772cc09`。
新 Pod 为 `task-01a09eb4f03f-r-54f96eb4bb45`，页面显示「原工作树已恢复」「已连接 cs-session」。
工作卷 `task-01a09eb4f03f-work` 的 UID 仍是 `31042273-699a-4888-912b-06d9babadc72`，容量 10Gi、状态 Bound。

| 真实操作 | UTC 时间 | HTTP／容器内耗时 | trace |
|---|---|---|---|
| 开发资源 → API → 操作详情 → 发送请求 | `2026-09-20T10:31:33.203Z` | **200／112 ms** | `01a0be5f041070009dc7f7fc5d404cd4` |
| 同页 Swagger → Try it out → Execute | `2026-09-20T10:32:16.700Z` | **200／91 ms** | `01a0be5fadfb70008bbb106035f140e5` |

两次页面均显示任务 `tsk_01a09eb4f03f7000ba011a517772cc09`、操作键 `rfc003-integration-qa:GET:/v4/projects`、
响应正文、HTTP、实测耗时和完整请求；响应头包含对应 trace，且与目标代理的 `forwarded` 日志逐条吻合。
详情查询为 `search=rfc003-verify-workbench&per_page=1`，Swagger 同此并带 `page=1`。
Swagger 仅显示该代理获授权的 GET 操作；历史批准／拒绝申请仍可查看。两次试调期间浏览器无 error／warn。

本轮无需改生产代码。补跑参考代理回归 **33 pass／0 fail／108 assertions**，其余实现沿用 §3 的已通过候选及精确 SHA CI。
PS-11 的真实成功响应缺口已关闭，T1–T8 完成，RFC-009 标记 Done。§4 的旧代理部署问题仍单独记录，不冒充已修复。
