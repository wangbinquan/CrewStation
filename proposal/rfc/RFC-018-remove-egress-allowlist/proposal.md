# RFC-018｜下线出站 FQDN 白名单

状态：Done · 2026-09-22 · EG-01…EG-08 全部通过。作者先裁定「这个能力可以下掉，不需要有这个约束」，在看过 §5 能力影响清单与 §4 两个问题后答复：「批准，并且本次就把功能全部下掉，历史的数据也清理掉，不要残留」。据此：§5 八项全部确认，Q1 取方案 C，Q2 改取方案 b（本次即清理 `egress` schema 与迁移记录）。本 RFC 属于开发规则 §5.5 的能力收缩型 RFC。

## 目录

- [1. 来源与确认](#1-来源与确认)
- [2. 这个能力今天是什么](#2-这个能力今天是什么)
- [3. 目标与非目标](#3-目标与非目标)
- [4. 作者裁定](#4-作者裁定)
- [5. 能力影响清单](#5-能力影响清单)
- [6. 验收标准](#6-验收标准)

## 1. 来源与确认

| 编号 | 来源 | 要求与状态 |
|---|---|---|
| E1 | 作者 2026-09-22 裁定 | 出站白名单能力下掉；平台不再以域名约束出站 |
| E2 | 作者 2026-09-22 批准 | §4 Q1 取方案 C：只给 `APIProxy`／`EventProducer` 项目的服务槽放开出向，数字人服务槽维持现状 |
| E3 | 作者 2026-09-22「历史的数据也清理掉，不要残留」 | §4 Q2 取方案 b：本次部署即删除 `egress` schema 与四行迁移记录，先做停写备份 |
| E4 | 本 RFC 建议，作者可改 | 旧地址 `/admin/egress` 重定向到管理总览，`/admin/requests?tab=egress` 归一到 API 页签；安装配置里的 `egress` 键被忽略而不是报错 |

本 RFC 作废基线的 R52、D47（G23 落文）、T4.12、AT-51 与候选 E23／Q23，改写 R15、AT-07 中「出站受白名单约束」的措辞，取代 RFC-003 附件 `proxy-egress.md`（I9(a) 的受控出站通道）。RFC-002 与 RFC-003 中关于该页面的导航描述属于历史记录，不回改。

## 2. 这个能力今天是什么

- 管理空间「资源与网络 → 出站白名单」（`/admin/egress`）维护全局／项目级 FQDN 条目；「申请审批 → 出站申请」裁定项目成员的追加申请；管理总览有一张「待审批出站申请」卡片；日志页有「出站请求受阻」告警类型。
- 设计上（R52、D47、G23）这份清单由出站代理（E23／Q23，候选待定）对任务容器、构建与服务槽按域名执行。实际情况：出站代理从未落地；开发会话、业务任务与构建 Pod 的 NetworkPolicy 自项目开通起就是出向全放行（`crewstation-task-egress`、`crewstation-build-egress`，代码注释标为「临时」）；唯一真实执行点是 cs-api 提供给 APIProxy 的受控 HTTP 出站通道 `POST /internal/egress/http`（RFC-003 附件 proxy-egress，I9(a)），参考代理经它访问上游 GitLab，因为服务槽 Pod 的出向只到平台系统命名空间与 DNS。
- 因此这条约束对开发会话、业务任务和构建从未生效；对接入容器，它只是穿过封闭网络策略的一条转发通道。

## 3. 目标与非目标

目标：

- 平台不再提供、也不再承诺按域名限制出站：管理员没有清单要维护，项目成员没有申请要提，工作台没有被阻记录要看。
- 接入容器（`APIProxy`／`EventProducer`）直接访问上游，不再经 cs-api 转发。
- 删干净：模块、契约、客户端、页面、安装器配置、文档中的承诺，不留「为白名单而生」的通道、限额与模块。

非目标：

- 不改网关放行表、API 目录、定向开放与 APIGrant 模型；内部 API 仍经 `/api/<proxy>/`。
- 不改项目命名空间的入向规则，不改开发会话、业务任务与构建 Pod 的现有出向。
- 不实现 I10（上游凭据按需下发）；不新增出站代理的替代品。

## 4. 作者裁定

**Q1 服务槽 Pod 的出向范围 —— 取 C。** 今天数字人与接入容器的服务槽 Pod 只能到平台系统命名空间与 DNS。

| 选项 | 内容 | 影响 |
|---|---|---|
| **C（已采纳）** | 只给接入容器（项目 `kind` 为 `APIProxy`／`EventProducer`）的服务槽放开出向；数字人服务槽维持现状 | 接入容器本来就是「代公司系统转发」的平台项目，放开与其职责一致；业务服务访问公司系统仍须经目录与放行表，R15「不能绕过网关放行」对内部 API 继续成立 |
| A（未采纳） | 项目命名空间内所有 Pod 出向全放行 | 最简单；但业务服务可绕过 API 目录直连公司系统，R15 对内部 API 只剩约定 |
| B（未采纳） | 保留 `/internal/egress/http` 通道，只去掉白名单判定 | 约束没了，却留着为它而生的通道、限额与模块 |

**Q2 遗留数据 —— 取 b。** 作者要求「历史的数据也清理掉，不要残留」。`egress` schema 里有条目、申请、被阻记录与资源身份别名四张表，`platform_infra.migrations` 里有该模块的四行记录。

| 选项 | 内容 |
|---|---|
| **b（已采纳）** | 本次本机部署时就删除：停写备份 → `DROP SCHEMA egress CASCADE` → 删除四行迁移记录；生产升级说明写明同一步骤 |
| a（未采纳） | 保留 schema 与四行记录，记为已知残留，日后手工清理 |

## 5. 能力影响清单

每一项都是 breaking change。作者 2026-09-22 答复「批准，并且本次就把功能全部下掉，历史的数据也清理掉，不要残留」，八项全部确认。

| # | 被关闭的能力 | 受影响的形态 | 处理 |
|---|---|---|---|
| 1 | 管理员维护全局／项目级出站 FQDN 条目 | 页面 `/admin/egress`；`GET`／`POST /v1/egress/entries`、`DELETE /v1/egress/entries/:id`；`api-client` 的 `egress` 资源；管理导航、总览入口卡、管理搜索 | 删除；旧地址重定向到 `/admin` |
| 2 | 项目成员申请追加域名与管理员裁定 | `/admin/requests?tab=egress` 页签与草稿保护；总览「待审批出站申请」卡；`/v1/projects/:id/egress/requests`、`/v1/egress/requests`、`/v1/egress/requests/page`、`/v1/egress/requests/:id/decision` | 删除；`tab=egress` 归一到 `api` |
| 3 | 被阻出站请求记录与可见性 | `/v1/projects/:id/egress/blocked`、`/internal/egress/blocked`；告警类型 `egress-blocked`（全仓无生产者）；能力页与三份 CONTRIBUTING 中「出站白名单与被阻请求」的说法 | 删除；`AlertTypeSchema` 去掉该值 |
| 4 | APIProxy 受控 HTTP 出站通道（I9(a)） | `POST /internal/egress/http`；`ForwardEgressHttpRequestSchema` 与 1 MiB／4 MiB／8 s 限额；参考代理的 `platformEgressFetch`；**已部署的参考代理版本在通道删除后上游调用失败，须重新发布** | 删除通道；参考代理直接请求上游；本机按标签发布新版参考代理 |
| 5 | 安装器出站配置、预检与初始化 | `egress.mode`、`egress.allowlist`；预检行「出站白名单」「出站代理可达性」；初始化「播种全局条目」 | 删除；旧配置文件中的 `egress` 键被忽略 |
| 6 | 「任务容器与业务服务出站只经代理白名单」的安全承诺 | R15 措辞、R52、D47、AT-07、AT-51、E23／Q23；Design §13.4 对 G13（模型凭据以环境变量进任务容器）的缓解措施少了「出站白名单限制目标」 | 基线 v0.3.7 回填：R52／D47／T4.12／AT-51 标 已作废（RFC-018），新增 D54；残余风险改为「不限制出站目标，靠审计与用量统计」，由作者接受 |
| 7 | `egress` 模块（L3）及其 PostgreSQL schema | `modules/egress` 全部 38 个文件（含 README、package.json 与 `.gitkeep`）；`task-runtime`／`platform` 的依赖声明；`tools/arch/migrations.lock.json` 四条；`platform_infra.migrations` 四行；仓库结构 §5 清单与分层图 | 删模块；锁条目按 testing.md §7 手工退出并在提交说明写明原因；schema 与迁移记录按 Q2(b) 在本次部署中删除；ADR-0008 记录模块退役 |
| 8 | 服务槽网络范围 | 每个项目命名空间的 NetworkPolicy；现有项目的策略要重新下发 | 按 Q1(C) 改策略；cs-controller 启动时对全部未归档项目重跑命名空间步骤 |

## 6. 验收标准

| 编号 | 内容 |
|---|---|
| EG-01 | 管理导航、总览入口卡、待办、搜索不再出现出站相关项；`/admin/egress` 重定向到 `/admin`；`/admin/requests?tab=egress` 打开 API 页签且草稿保护仍有效 |
| EG-02 | `/v1/egress/*`、`/v1/projects/:id/egress/*`、`/internal/egress/*` 全部 404（真实路由表用例） |
| EG-03 | 新开通项目的 NetworkPolicy 符合 Q1(C)；控制面启动重下发后，本机全部现有项目命名空间一致（`kubectl` 逐个核对） |
| EG-04 | 参考代理新版本在本机集群直接到达 GitLab：经网关的真实 `GET` 200，代理日志无 `/internal/egress/http` |
| EG-05 | 安装器：含 `egress` 键的旧配置照常解析；`install` 计划与初始化输出没有出站行 |
| EG-06 | `bun run check` 与精确 SHA CI 六项通过；`migrationCoverage` 用例与锁文件一致；改动行覆盖不低于门限 |
| EG-07 | 基线三件套 v0.3.7、tech-evaluation、仓库结构 v0.5＋ADR-0008、I9 关闭、集成 README／CONTRIBUTING、e2e 页面清单全部更新，`dev-gotchas` 的网络策略条目按 Q1(C) 改写 |
| EG-08 | 历史数据清理：停写备份已生成并校验；`egress` schema 与 `platform_infra.migrations` 中 `module = 'egress'` 的四行均已删除；删除后平台照常启动、迁移不再应用、`\dn` 查不到 `egress` |
