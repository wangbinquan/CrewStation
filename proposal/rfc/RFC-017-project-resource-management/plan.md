# RFC-017｜实施与验证

状态：Done · 2026-09-21。

| 任务 | 内容 | 状态 |
|---|---|---|
| T1 | 服务政策契约、仓储与接口 | 完成 |
| T2 | 发布校验与配额比较保存 | 完成 |
| T3 | 项目管理导航与模板归属 | 完成 |
| T4 | 统一资源页与独立草稿 | 完成 |
| T5 | 分层测试及浏览器验证 | 完成 |
| T6 | 门禁、接力文档与发布证据 | 完成 |

## 验收证据

| 编号 | 结果与证据 |
|---|---|
| PR-01 | 导航渲染、空间结构和真实 E2E：移除两项独立左栏入口；项目目录提供模板子入口。两个旧套餐地址和旧 compute 地址跳转到新地址。 |
| PR-02 | 本机实际项目 `01a0c12a-de0c-7009-83f4-d05f95c9a0a2` 的资源页同时显示服务范围、Agent 与开发容器、任务配额；当前继承 4 个服务规格、配额 3、占用 0。 |
| PR-03 | `modules/project/tests/servicePolicies.test.ts` 在真实 PostgreSQL 验证默认继承、限制、空清单、恢复继承；工作台保存相同政策后显示服务端回执。 |
| PR-04 | 同一数据库内两个项目的政策隔离；`releaseModule.test.ts` 验证未分配时不启动迁移、迁移期间撤回时不部署。分别去掉迁移前／部署前的项目上下文，两条回归均变红；原代码已恢复。发布测试使用真实数据库和假的 Kubernetes 客户端，不冒充线上发布。 |
| PR-05 | 项目模块 HTTP 验证 200／401／403／404／400／409、未知项目和规格、响应不缓存。 |
| PR-06 | 首次插入及已有修订并发保存各只有一笔成功；配额同时比较旧值也只有一笔成功。 |
| PR-07 | 配额 1–100 边界、真实占用、降低上限不伪造占用及旧调用方兼容均通过；本机实际 API 读取通过。 |
| PR-08 | `adminProjectResources.test.tsx` 的 9 条路由交互覆盖错误／缺失目录、重试、冲突、错误回执、身份变化、保存中重复提交、离开保护；独立保存／重读保持另两卡草稿。 |
| PR-09 | 构建预览在 1280／390／320px、中英文通过；本机部署后再次核对 1280／320px，文档宽度分别为 1280／320，无整页横向溢出；任务模板英文完整，最终恢复中文，浏览器控制台无错误。 |
| PR-10 | 本地完整门禁 2072 pass／8 skip／0 fail，新增代码防护 391／391；实现提交的 CI 35564949555 六项全部成功。 |

能力说明也按项目过滤规格：撤回全局默认规格后不再推荐它，`capabilitiesModule.test.ts` 与项目模块回归通过。保留既有实例维护与旧版本切流行为。

## 本机部署

2026-09-21 05:12Z 在 `docker-desktop`／`crewstation-system` 完成：

- `cs-api`、`cs-controller`、`mcp-capabilities` 使用 `cs-control-plane:rfc017-20260921`；`console` 使用 `cs-console:rfc017-20260921`，四项均 Ready。
- Job `crewstation-migrate-rfc017-20260921-0511` 成功，仅应用 `project/0011_service_plan_policies.sql`，角色初始化数为 0。
- 保留原 `:dev` 镜像；未重播目录或登录器，未更改任何已有项目的分配、模板或配额。保存及拒绝路径用隔离的真实测试数据库验证。

临时证据：`/private/tmp/cs-rfc017-migration.log`、`cs-rfc017-deployment-before.json`、`cs-rfc017-candidate.json`、`cs-rfc017-final-targeted.log`、`cs-rfc017-release-tests.log` 与 `cs-rfc017-mutation-pipelineBuild.ts.log`／`cs-rfc017-mutation-pipelineDeploy.ts.log`。

## 门禁收尾记录

首轮完整候选为 2069 pass／8 skip／3 fail，三条失败分别是遗漏更新的管理总览旧套餐入口断言、固定生成时间在当天 05:00Z 后触发陈旧日志的网关重建用例、API 试调的 401 请求收到 503。前两项已修正测试；第三项无产品代码改动，发现本机继承 HTTP_PROXY 且代理会把已关闭本地端口转为无正文 503，最终门禁对 localhost 显式直连。单条重跑通过不作为完整门禁通过的依据。最终完整 `bun run check` 通过：2072 pass／8 skip／0 fail，13131 assertions，350 个文件，364.88s；包含真实数据库与本机部署 E2E。8 项跳过为另一个非管理员身份、显式原生集群／CLI 环境和本机未安装的 Prometheus 三项；CI 会提供 Prometheus 并强制执行。日志 `/private/tmp/cs-rfc017-check.log`，覆盖产物 `coverage/rfc017-final/`，候选哈希 `/private/tmp/cs-rfc017-candidate-final.json`。

网关用例只调整新文档的时间夹具，保留旧身份文档、并发重建次数、告警和拒绝断言。导航断言新增检查两个旧套餐入口不再出现在管理总览。

## 发布

实现提交 `38d1f3af785fa3d1a52905c2ae85cdae75e816a2` 与测试日期修复 `9d6ee70` 已推送 main，推送后本地／远端精确同步且工作树为空。该实现的 [CI 35564949555](https://github.com/wangbinquan/CrewStation/actions/runs/35564949555) 已终态通过全部六项：static、unit、module、console、gate 和 e2e。PR-01…PR-10 与 T1–T6 完成，RFC-017 已 Done。
