# CrewStation｜数字人能力平台

CrewStation 是面向全公司各团队的数字人构建、发布与运行平台。团队在平台提供的开发容器里借助编码 Agent（OpenCode、Claude Code）开发自己的业务应用；平台统一提供身份、公司接口、计算、数据与发布条件，页面、流程、产品知识和 Agent 的用法由业务团队自己决定。

**数字人**是一个可部署的业务服务：有页面、API、事件处理、数据库、文件和自己的身份。平台按全公司规模设计：数百个数字人服务并发运行在数百节点的 Kubernetes 集群上（设计目标，不是测量结果）。

> **现状（2026-09-24）**：本仓同时放着设计文档与第一轮实现。主要链路已在本机 docker-desktop kind 集群上端到端跑通并实际观察过，但它是设计契约的第一个实现，**不是已发行的产品**：一键安装器、控制面高可用、规模验证与分层升级（M6）都还没开始。详见 [§2](#2-当前状态)。

## 目录

- [1. 平台提供什么](#1-平台提供什么)
- [2. 当前状态](#2-当前状态)
- [3. 架构一览](#3-架构一览)
- [4. 仓库结构](#4-仓库结构)
- [5. 快速开始](#5-快速开始)
- [6. 命令速查](#6-命令速查)
- [7. 参与开发](#7-参与开发)
- [8. 文档地图](#8-文档地图)
- [9. 术语](#9-术语)

## 1. 平台提供什么

业务团队已经能用 AI 写出页面和服务，卡住他们的是三样自己拿不到的公司级条件（[Proposal](proposal/proposal.md) §1.1）：

| 痛点 | 平台给出的结果 |
|---|---|
| 认证鉴权难接入 | 网关统一完成登录鉴权，把可信身份请求头与绑定目标服务的平台签名令牌随请求注入，业务不写登录代码；服务之间的调用由网关按源 Pod IP 认出调用方，业务不携带任何凭据 |
| 部署与运行资源难获得 | 在 Manifest（`crewstation.yaml`）里声明需求，取得平台调度的服务容器、任务容器与数据资源（PostgreSQL、对象存储、持久卷），能发布、运行、扩缩并保留数据 |
| 公司接口难访问 | 管理员把公司系统接成 API 代理项目并登记进接口目录，按默认开放／定向开放由网关本地放行；公司 Webhook 经事件生产者项目进入事件中心，再推送给订阅方 |

接入只靠约定——环境变量、请求头、处理路径、网关地址与 Manifest 字段——不提供 SDK，与实现语言无关。每个新项目从 [`templates/minimal-sample`](templates/minimal-sample/README.md) 起步：它用零登录代码演示读取当前用户、配置注入、以服务身份运行 Agent 子任务、接收事件与开放 API。

**谁在用**

- **平台角色**三类：使用者、开发者、管理员，登录后都先到能力市场。开发者可以用默认资源自建数字人项目并成为负责人，只能开发自己被授权的项目；管理员另有「平台管理」：用户与权限、接入容器、接口开放审批、服务套餐与算力档位、集群管理，也可以替符合条件的负责人代建项目。
- **项目成员**另分三级：负责人（成员、切流、恢复、生产配置）、开发者（开发与待命发布）、测试者（只能试用）。测试者会在能力市场看到带 Beta 标记的未上线应用。

**Agent 只按用途分两类**，没有角色维度（没有主 Agent，也没有分析／编码／审核之分）：

- **意图创建与修改 Agent**：在开发会话的容器里开发数字人应用本身，开发者可以并行开多个流式交互的 Agent。
- **业务执行 Agent**：由数字人的业务服务经子任务契约层按需调用，只带 `agentProfile` 与输入输出契约，下一步做什么由业务程序决定。

两类 Agent 的镜像、命令、模型与资源都来自管理员定义的**算力档位**；每个 Agent 跑在自己的 Pod 里，占一个并发额度（RFC-006）。

## 2. 当前状态

截至 2026-09-24。基线三件套（Proposal／Design／Plan）为 v0.3.14，是权威契约；代码是它的第一个实现。

**在本机集群上端到端跑通并实际观察过的链路**（docker-desktop kind 单节点，命名空间 `crewstation-system`）：

- 创建项目 → 命名空间、配额与网络策略 → 从最小样例模板建 GitLab 仓库 → 生产数据资源 → 网关路由 → 首个标签构建并部署到 preview 槽。
- 切流到 prod 与回退：两个域名同时在服务，切流记录写明来自哪个版本。
- 经网关登录后注入身份请求头，样例页读出当前用户。
- 开发会话：init 容器按所选分支克隆仓库，TaskRunner 连上 cs-session，Web 终端有真正的控制终端与作业控制。
- 业务子任务契约：样例的 `/chat` 建业务任务，子任务等容器就绪后运行 Agent 并返回输出。
- 事件链：内置事件生产者投递 → cs-events 去重扇出 → 样例页列出这次投递及其 trace id。
- 两个 Agent CLI 装进任务镜像，以降权用户启动并报出各自的原生会话 id；OpenCode 1.18.29 已产出真实模型输出、并行跑过两个原生会话、在验证项目里改过文件。
- 两个平台 MCP 从开发容器内可达，用会话级令牌鉴权，返回真实平台数据。

**RFC 进度**：共 26 个，状态以 [`proposal/rfc/README.md`](proposal/rfc/README.md) 的索引表为准。

| 状态 | RFC |
|---|---|
| Done（21） | 001 算力归平台 · 002 管理空间与租户空间 · 003 工作台 UX · 005 OIDC 公司登录 · 006 算力档位与每个 Agent 一个 Pod · 007 开发环境一键换角色 · 008 开发会话 UX · 009 项目设置 UX · 010 集群资源管理 · 012 项目算力授权 · 013 资源 ID 统一为 UUIDv7 · 014 用户与认证 UX · 015 集群容量与用量 · 017 项目资源配置 · 018 下线出站白名单 · 019 部署与运行形态图 · 020 项目工作台信息架构 · 021 待验证版本下线与正式版本维护 · 022 启动进度 · 024 CLI 界面就绪 · 026 终端查询由 Runner 应答 |
| In Progress（4） | **025 统一资源管理中心**（当前主线，分六期：各模块写期望、中心存实况的声明式台账，加上按种类回收的调和器；任务类容器已接入，服务槽与构建、路由、网关限流在做）· 011 三类平台角色与使用者首页（剩具体测试账号改权的实机验收）· 016 开发会话预览进程（实机验收未执行）· 023 数据库驱动换成 postgres.js（已上线，观察期中） |
| Superseded（1） | 004 管理员定义 Agent 启动前 Hook（被 RFC-006 取代） |

**还没有的与已知限制**

- M6 未开始：一键发行安装器、控制面高可用、规模验证、分层升级与恢复。`crewstation install`／`upgrade` 对依赖发行包的阶段如实报「未实现」。
- 只在本机单节点集群上验证过；规模与高可用按计划只在 M6 验证一次（已接受的风险）。
- Claude Code 在本机停在登录（没有登录态），它的真实模型轮次只有自动化用例覆盖。
- 本机测试 GitLab 用的是现存的 `aw-local-gitlab` 容器（gitlab-ce 19.2.4，HTTP `127.0.0.1:8929`），它的 compose 定义已丢失，仓库里没有可复现的搭建方式。CI 里也没有 GitLab，项目空间相关的实机用例在 CI 里跳过（[`testing.md`](docs/engineering/testing.md) §10）。
- 日志页读的是有界的 Pod 日志尾部。
- 实现期发现、等作者裁定的设计问题记在 [`implementation-open-questions.md`](docs/engineering/implementation-open-questions.md)。

## 3. 架构一览

控制面——五个常驻服务、两个平台 MCP 与工作台——都在命名空间 `crewstation-system`，共用一个 PostgreSQL（一个模块一个 schema）。每个数字人另有自己的项目命名空间，放它的部署槽、开发会话容器与 Agent 执行 Pod。

**请求怎么走**：网关有两类主机。用户域（`*.cs.localhost`）走 ForwardAuth 登录，注入身份请求头与绑定目标服务的令牌；服务域（`*.svc.cs.internal`）不跳登录，网关按源 Pod IP 认出调用方、本地查放行表、注入平台签名的来源令牌，承载内部 API（`/api/<proxy>/…`）、平台 API、MCP、事件与服务间调用。

```mermaid
flowchart LR
  user["使用者<br/>浏览器 ／ crewstation CLI"]
  caller["数字人槽 ／ 开发会话容器<br/>／ Agent 执行 Pod<br/>不带任何凭据"]

  ugw["Traefik · 用户域<br/>*.cs.localhost"]
  sgw["Traefik · 服务域<br/>*.svc.cs.internal"]
  auth["cs-auth · ForwardAuth<br/>登录与调用方识别"]

  con["console 工作台"]
  api["cs-api 平台 API"]
  slots["数字人 prod ／ preview 槽"]
  proxy["API 代理项目 → 公司接口"]
  mcp["能力说明 MCP ／ 操作 MCP"]
  evt["cs-events 事件中心"]

  user -->|登录后注入身份| ugw
  caller -->|按源 Pod IP 认出调用方| sgw
  ugw & sgw -.-> auth
  ugw --> con & api & slots
  sgw --> api & proxy & mcp & evt & slots
```

**任务与 Agent 怎么跑**：cs-api 受理请求后把作业与期望写进 PostgreSQL，cs-controller 的后台工作器与调和器负责建仓、构建，以及在项目命名空间里建与调和工作负载。开发会话容器里的 TaskRunner 与每个 Agent Pod 里的子 Runner 都主动连出到 cs-session，浏览器里的终端与 Agent 视图也连到那里。

```mermaid
flowchart LR
  api["cs-api<br/>受理请求"]
  ctl["cs-controller<br/>后台工作器与调和器"]
  git[("GitLab 兼容代码托管")]
  bk["BuildKit → 镜像仓库"]
  subgraph ns["项目命名空间 · 每个数字人一个"]
    slots["部署槽 prod ／ preview"]
    dev["开发会话容器<br/>＋ TaskRunner"]
    agents["Agent 执行 Pod<br/>＋ 子 Runner"]
  end
  ses["cs-session"]
  browser["浏览器里的终端<br/>与 Agent 视图"]

  api -->|经 PostgreSQL 队列与台账| ctl
  ctl -->|建仓 · 代推 · 打标签| git
  ctl -->|按固定提交构建| bk
  ctl -->|建与调和| slots & dev & agents
  agents -.->|挂载父容器工作卷| dev
  dev & agents -->|出向 WebSocket| ses
  browser -->|WebSocket| ses
```

| 进程 | 职责 | 挂载的模块入口 |
|---|---|---|
| `cs-api` | 平台 API | 全部模块的 HTTP 路由，能力说明、观测与集群管理的查询，资源推送流 |
| `cs-auth` | 网关处的公司登录与身份注入、ForwardAuth（用户域与服务域）、JWKS、按需下发上游凭据 | `identity` 运行面，`gateway` 的放行表评估 |
| `cs-controller` | 任务容器、构建、发布、路由、数据供给、GitLab 管理操作 | `release`、`task-runtime`、`data`、`scm`、`gateway`、`project`、`provisioning`、`cluster-management` 的后台工作器，`cluster-control` 的观测与调和，`resources` 的维护 |
| `cs-session` | TaskRunner 出向连接与浏览器终端／事件流的中枢 | `session` |
| `cs-events` | 事件中心：inbox 去重、持久化、投递、死信 | `events` |
| `mcp-capabilities`、`mcp-operations` | 能力说明 MCP（只读）与操作 MCP（发布、调内部 API 等动作），供开发容器里的 Agent 使用 | 不挂模块，经 `api-client` 调 `cs-api` |
| `console`、`cli` | 工作台 SPA 与 `crewstation` 命令行，用同一套平台 API | 同上 |

几条贯穿全局的机制：

- **执行模型**：一项任务＝项目命名空间里一个长驻 Pod，常驻 TaskRunner（独立 UID，tini 为 1 号进程）。每个 Agent——「＋ CLI」终端、headless Agent、业务子任务——各跑一个执行 Pod，挂父容器的工作卷，镜像、命令与资源取自算力档位。开发会话只有运行与释放两种状态，空闲只提醒；业务任务可选持久卷＋可重建容器，这是唯一能暂停与恢复的模式。唯一的预算是每个数字人的并发任务额度，超额一律拒绝。
- **发布与切流**：只有平台创建的 `v<major>.<minor>.<patch>` 标签触发发布——检查未提交改动 → 代推当前分支 → 打标签 → 按固定提交构建 → 对生产库跑必须与在服务槽兼容的迁移 → 部署到待命（preview）槽。负责人切流晋级，回退就是切回。preview 与 prod 是同一个生产服务的两个蓝绿槽，共用生产数据；隔离在开发会话（默认连开发库）与生产之间。
- **事件**：公司 Webhook 经服务域进入事件生产者项目，cs-events 去重、持久化，再经服务域带来源令牌与 trace_id 推到订阅方 prod 活动槽声明的处理路径。
- **追溯**：每个任务创建时生成 traceId（或继承触发它的事件投递），一条 taskId 对应一条执行链，每次 Agent 执行以 sessionId 记录、可由 traceId 索引。
- **资源中心（RFC-025，进行中）**：各模块把期望写进 `resources` 台账，`cluster-control` 调和器观测集群、写回实况，并逐期接管 Kubernetes 对象的写入；工作台读「快照＋推送」。

**技术栈**（选型依据见 [`tech-evaluation.md`](proposal/tech-evaluation.md)）：

| 层 | 选型 |
|---|---|
| 运行时与语言 | Bun 1.3.13、TypeScript 6，Bun workspaces monorepo |
| 服务端 | Hono、Drizzle ORM ＋ postgres.js、zod（跨进程契约）、jose（JWT／JWKS）、MCP 官方 SDK |
| 工作台 | React 19、Vite、TanStack Router／Query、xterm.js、CodeMirror、Swagger UI |
| 集群与基础设施 | Kubernetes（本机 docker-desktop kind 节点）、Traefik v3、PostgreSQL 17、CNCF Distribution 镜像仓库、BuildKit（rootless）、Calico、Prometheus |
| Agent CLI | OpenCode、Claude Code，装在任务镜像里；驱动复制改造自 `agent-workflow` |

## 4. 仓库结构

```text
apps/            可部署单元：一个进程一个目录，只做装配与启动
  cs-api  cs-auth  cs-controller  cs-session  cs-events    五个常驻服务
  mcp-capabilities  mcp-operations                         两个平台 MCP
  console                                                  工作台 SPA
  cli                                                      crewstation 命令行
  cs-storage-probe                                         节点卷用量只读探针（RFC-015）
modules/         21 个领域模块，按层依赖；platform 是组合根
packages/        19 个与领域无关的技术库
runtimes/task/   任务容器镜像与 TaskRunner
integrations/    两个内置接入容器项目：gitlab-event-producer、reference-api-proxy
templates/       业务项目模板：minimal-sample
deploy/          本机集群的清单与脚本：local/、k8s/、docker/
tests/           跨单元的用例层，目前是 e2e/（实机验收）
tools/           仓内工程工具：arch（结构规则）、testguard（用例门禁与报告）、scaffold（模块脚手架）、
                 dev-auth（本机一键换角色登录）、mock-idp（验收用的最小 IdP）
docs/            工程文档 engineering/ 与架构决策记录 adr/
proposal/        基线三件套、技术评估、检视记录与 RFC
```

`integrations/*` 与 `templates/*` 是独立项目（各自有 `package.json` 与 `bun.lock`），不是根工作区成员：平台把它们原样推进项目仓库，要能独立安装。

**模块与层**：模块只能依赖 layer 严格更小的模块，同层互不依赖。

| 层 | 模块 | 拥有的对象与职责 |
|---|---|---|
| L1 | `resources` | 资源中心台账：期望与实况、种类与阶段规则、按台账推导的额度、保留期、标准视图与推送流（RFC-025） |
| L1 | `identity` | 用户、登录适配、用户令牌与 JWKS、源 Pod IP → 服务身份、来源令牌、上游凭据 |
| L2 | `cluster-control` | 调和器：观测受管 Kubernetes 对象写回台账、逐期接管对象写入、孤儿回收 |
| L2 | `project` | 项目、服务、成员三级角色、测试者、命名空间登记、并发额度、套餐 |
| L3 | `scm` | 仓库绑定、建仓、代推、标签与保护标签、会话级短期 Git 凭据 |
| L3 | `config` | 配置项与 Secret、开发／生产两组值、版本快照、注入渲染 |
| L3 | `data` | 数据资源与绑定、开发会话的三种数据访问模式与审批、Provider（postgres、s3、pvc） |
| L3 | `api-catalog` | API 代理登记、操作键（proxy＋method＋path）、开放策略、授权与申请、Swagger 裁剪 |
| L3 | `events` | 事件生产者登记、事件类型、inbox 去重、订阅、投递状态机、死信、推送 |
| L3 | `agent-runtime` | 算力档位：协议、镜像、二进制、启动前步骤、凭据、修订与测试记录（RFC-006） |
| L4 | `release` | Manifest 校验、Release、构建、迁移、部署槽、切流、发布并发控制 |
| L4 | `task-runtime` | 任务环境生命周期、Pod 与持久卷、额度准入、每个 Agent 一个执行环境、TaskRunner 协议服务端 |
| L5 | `dev-session` | 一项目一会话、分支与落后提交数、空闲提醒、强制释放、发布入口 |
| L5 | `business-task` | 业务任务、子任务契约层、`oneshot`／`interactive`、契约校验、文件与结果读取 |
| L5 | `session` | TaskRunner 出向连接与浏览器流的中枢：租约、游标、重连、帧路由 |
| L5 | `gateway` | 用户域与服务域路由表、放行表、Pod 身份索引的生成与下发 |
| L6 | `cluster-management` | 受管资源快照、归属与 Pod 用途、管理员运维操作与记录 |
| L6 | `observability` | 日志查询、部署健康与告警记录、执行事件、traceId 索引 |
| L6 | `capabilities` | 能力说明聚合：授权、绑定、订阅、额度、套餐、约定表 |
| L6 | `provisioning` | 项目开通编排：命名空间 → 仓库 → 数据 → 路由 → 首个标签发布，失败留原因可重跑 |
| L7 | `platform` | 组合根：按端口装配全部模块，按进程角色挑选 HTTP 路由、后台工作器与事件订阅 |

**技术库**（`packages/*`，删掉所有业务概念后仍成立）：

- 契约与基础：`contracts`（Manifest、平台 API、事件、放行表、TaskRunner 协议的 zod Schema，跨进程的唯一事实源）、`kernel`（Result／错误、ID、时钟、日志接口，零 IO）、`settings`（`CS_` 环境变量读取）。
- 持久化与异步：`persistence`（连接、事务、迁移运行器、outbox）、`queue`（PostgreSQL 表队列）、`eventbus`（进程内事件总线＋outbox 发布）。
- 协议与客户端：`http`、`ws`、`k8s`、`gitlab-client`、`jwt`、`secretbox`（静态密文）、`session-client`、`api-client`（console、cli 与 MCP 共用的平台 API 客户端）、`mcp-server`（两个平台 MCP 的协议骨架）。
- 专用：`agent-drivers`（OpenCode／Claude Code 驱动，只供任务容器）、`resource-runtime`（调和循环骨架）、`filesystem-metrics`（卷用量测量）、`testkit`（临时数据库、假时钟、假 k8s、能力闸门）。

**机械执行的硬规则**（`tools/arch`，无基线、无例外清单；要例外只能写带过期日期的 ADR）：

- 依赖方向 `apps → modules → packages`；模块之间只经对方根 `index.ts`；需要高层信息时声明端口，由组合根 `modules/platform/wiring.ts` 注入。`apps/console` 与 `apps/cli` 只依赖 `contracts` 与 `api-client`；`runtimes/task` 只依赖 `contracts`、`kernel`、`ws`、`agent-drivers`。
- 每个模块同一套模板：`api/ domain/ application/ ports/ adapters/ http/ workers/ tests/` ＋ `wiring.ts`、`index.ts`。新模块只能用 `bun run scaffold:module` 生成，并要有 ADR。
- 一个模块一个 PostgreSQL schema；跨模块只存 ID，不建外键，不 join 别人的表。
- 尺寸：源码文件 600 行（测试 1000 行）、一个目录 20 个源码文件、函数 80 行。禁用文件名 `utils.ts`、`helpers.ts`、`common.ts`、`misc.ts`、`shared.ts`；`types.ts` 只许出现在模块的 `api/` 里；只用命名导出（唯一例外见 ADR-0002）。

完整规则与理由见 [`repository-structure.md`](docs/engineering/repository-structure.md)。

## 5. 快速开始

### 5.1 装依赖、跑门禁（不需要集群）

需要 Bun 1.3.13。所有命令都在仓库根运行。

```bash
bun install
# 模板与两个接入容器是独立项目，但它们的用例由根 bun test 收进来，要各自装一次依赖
for dir in templates/minimal-sample integrations/gitlab-event-producer integrations/reference-api-proxy; do
  (cd "$dir" && bun install)
done
bun run check     # 门禁：arch:check → lint → typecheck → typecheck:console → 全部用例
```

依赖外部环境的用例在环境缺席时会跳过并打一行告警，所以裸机上全绿**不等于**集成路径跑过：

- **PostgreSQL**：模块级用例默认连 `postgres://crewstation:crewstation-dev@127.0.0.1:55432/crewstation`（与 CI 相同），可以用 `CS_TEST_DATABASE_URL` 改。本机起一个一次性的：

  ```bash
  docker run -d --name cs-dev-pg -p 127.0.0.1:55432:5432 \
    -e POSTGRES_USER=crewstation -e POSTGRES_PASSWORD=crewstation-dev -e POSTGRES_DB=crewstation postgres:17.11
  ```

  用 `CS_TEST_REQUIRE=database bun test` 让数据库缺席变成失败而不是跳过。
- **实机验收**（`tests/e2e`）只在本机集群已装好、并开着一个带调试端口的 Chrome 时才跑，否则整套跳过；做法见 [`tests/e2e/README.md`](tests/e2e/README.md)。
- 真实 GitLab、真实集群、Prometheus 时序库与两个原生 Agent CLI 的用例各有自己的开关，见 [`testing.md`](docs/engineering/testing.md) §5、§10、§11。

### 5.2 在本机集群上拉起平台

本机部署只面向 macOS 上 Docker Desktop 自带的 Kubernetes：`kubectl` 上下文 `docker-desktop`、节点容器 `desktop-control-plane`。脚本认不出这组名字就拒绝运行，不会碰到别的集群。

前置条件：

- Docker Desktop 开启 Kubernetes；宿主机 80、443 端口空闲。
- `kubectl`、`docker`、`jq`、`curl`、`openssl` 与 bash（macOS 自带的 3.2 即可）；不需要 helm 与 kind 命令行。
- 一个集群里访问得到的 GitLab 兼容代码托管：默认地址 `http://host.docker.internal:8929`、组 `crewstation`（[`deploy/k8s/platform/10-config.yaml`](deploy/k8s/platform/10-config.yaml)）。宿主机上的地址与令牌写进 `.local/gitlab.env`（已被 git 忽略）：

  ```bash
  CS_TEST_GITLAB_URL=http://127.0.0.1:8929
  CS_TEST_GITLAB_TOKEN=<对该组有权限的令牌>
  ```

  没有它平台照样装得上，但建仓与发布不可用，`bootstrap-integrations.sh` 会直接报错。
- 构建任务容器镜像要联网安装两个 Agent CLI。

步骤（脚本都幂等，可以重跑）：

1. **基础设施与平台**：

   ```bash
   ./deploy/local/bootstrap.sh          # 一次性基础设施：Calico、PostgreSQL、镜像仓库、Traefik、BuildKit、CoreDNS 改写、节点 containerd 配置，最后跑检查 A–E
   ./deploy/local/install-platform.sh   # 构建并导入镜像 → 写机密 → 应用清单 → 迁移 → 等待就绪；首次安装打印创建管理员的链接
   ```

2. **创建首位管理员**：打开 `install-platform.sh` 打印的初始化链接，自己填用户名、显示名、邮箱与密码——**没有默认账号，也没有初始密码**。链接里的引导令牌只能用一次。拿不到安装输出时，运维可以从 Secret 取出它：

   ```bash
   kubectl -n crewstation-system get secret crewstation-secrets -o jsonpath='{.data.CS_BOOTSTRAP_TOKEN}' | base64 -d
   ```

3. **种目录、装本机登录入口**（需要管理员凭据）：

   ```bash
   export CS_ADMIN_USERNAME=<管理员用户名> CS_ADMIN_PASSWORD=<密码>
   ./deploy/local/seed-catalog.sh       # 初始服务套餐与任务容器规格
   ./deploy/local/install-dev-auth.sh   # 可选：本机一键换角色登录（RFC-007）
   ```

4. **建算力档位**：管理员在工作台「平台管理 → 算力档位」里创建 Agent 用的档位：镜像基于平台底座 `crewstation/task-runtime`（安装时已推进集群内仓库），再指定二进制、模型与凭据。档位保存即在真实容器里测试，通过前不可选；没有可用档位，开发会话与业务子任务起不了 Agent。
5. **两个内置接入项目**：`./deploy/local/bootstrap-integrations.sh` 建 GitLab 事件生产者与参考 API 代理，推源码并发布到 preview 槽。

`./deploy/local/verify.sh` 随时重跑基础设施检查。`install-platform.sh` 的常用开关：`SKIP_BUILD=1` 不重建镜像；`SKIP_TASK_RUNTIME_BUILD=1` 保留已有的任务容器镜像；`CS_SKIP_TASK_RUNTIME=1` 整个跳过任务容器镜像（这样的环境起不了开发会话）；`CS_SKIP_DEV_AUTH=1` 不装本机登录入口。组件清单、网络与名称约定、已知限制和卸载步骤见 [`deploy/README.md`](deploy/README.md)。

### 5.3 访问入口

`*.localhost` 在 macOS 与 Chrome 上自动解析到本机，不需要改 hosts。

| 地址 | 是什么 |
|---|---|
| `http://console.cs.localhost/` | 工作台：能力市场、项目开发、平台管理 |
| `http://dev-auth.cs.localhost/` | 本机一键换角色登录（只在本机安装） |
| `http://<slug>.cs.localhost/` | 数字人的 prod 槽 |
| `http://preview.<slug>.cs.localhost/` | 数字人的 preview（待命）槽 |
| `http://dev.<slug>.cs.localhost/` | 开发会话里的预览进程 |
| `http://<name>.svc.cs.internal/` | 服务域，只在集群内可达：`api`（平台 API）、`events`、`mcp-capabilities`、`mcp-operations` 与各数字人 |

## 6. 命令速查

仓库工程命令（在仓库根运行）：

```bash
bun run check                          # 门禁：arch:check → lint → typecheck → typecheck:console → 全部用例；提交前必须绿
bun run arch:check                     # 八条结构规则：依赖方向、模块模板、持久化归属、尺寸与命名、依赖声明、无环、用例纪律、迁移锁
bun test path/to/file.test.ts          # 单个用例文件
bun run test:unit                      # 只跑一层：test:unit（方法级）、test:module（模块级）、test:console（工作台）、test:e2e（实机）
bun run test:unit --cover              # 同上，并把 lcov.info 与 junit.xml 写到 coverage/<层>/、做该层审计
bun run test:report --tiers unit,module,console                     # 合并各层结果，渲染成 CI 摘要同款的报告
bun run test:patch --base origin/main --tiers unit,module,console   # 本机预演新增代码防护（先跑完三层各自的 --cover）
bun run migrations:lock <迁移文件>…    # 新迁移入锁（只追加）；共享工作树上只锁自己的
bun run contracts:lock                 # 业务契约面金样入锁；破坏性变更要 --breaking "<批准依据>"
bun run scaffold:module <name> <layer> [--deps a,b] [--desc "职责"] [--no-persistence]   # 新建模块的唯一方式
```

本机预演新增代码防护时用三层各自的 `--cover`，不要用 `bun run test:cover`：它跑全部用例文件，本机集群与调试 Chrome 都在时会连共用集群跑实机用例（[`dev-gotchas.md`](docs/engineering/dev-gotchas.md)）。

产品命令行 `crewstation`（[`apps/cli`](apps/cli)，与工作台、MCP 用同一套平台 API；`bun run apps/cli/src/main.ts --help` 看完整帮助）：

| 分组 | 命令 |
|---|---|
| 项目与发布 | `whoami` · `projects list／show／branches` · `publish <project>` · `releases list／show` · `traffic show／switch／history` · `config list` |
| 开发会话 | `session open／show／release <project>` |
| 运维（Design §11–12） | `install` · `upgrade` · `status` · `verify`；依赖发行包的阶段目前如实报「未实现」 |

平台地址与令牌按「命令行标志 → 环境变量 `CS_API_URL`／`CS_TOKEN` → `~/.config/crewstation/config.json` → 默认值」解析，默认地址 `http://console.cs.localhost`。

## 7. 参与开发

人写的改动与 Agent 写的改动遵守同一套规则，全文见 [`development-rules.md`](docs/engineering/development-rules.md)。最常被违反的三条：

1. **只在 `main` 上开发**：不建分支、不用 worktree、不用 stash。改完直接在 `main` 上提交并推送；工作树脏时先提交自己的改动，再 `git merge` 同步，不用 rebase。
2. **按路径精确提交**：`git add <文件>`、`git commit -- <文件…>`，pathspec 给到文件而不是目录；不要 `git add .`／`git add -A`。本仓常有多个会话共用一棵工作树，暂存区是公用的，提交后用 `git show --name-only HEAD` 核对清单。
3. **改动自带测试**：推之前 `bun run check` 跑绿；bug 修复先写能稳定复现的红用例。推完按自己的 SHA 盯 CI 到绿，红了立刻修或 revert 自己那笔。

改什么走什么流程：

| 改动 | 流程 |
|---|---|
| 新功能、非平凡重构、产品行为变更 | 先立 RFC：`proposal/rfc/RFC-NNN-{slug}/` 下 `proposal.md`、`design.md`、`plan.md` 三件套，登记进 RFC 索引，作者批准后才写代码 |
| 仓库结构规则本身：新增或删除模块、调整 layer 或尺寸上限、任何规则例外 | 写 ADR：`docs/adr/NNNN-{slug}.md` |
| 拼写、单行 bug、重命名、依赖升级、文档、补用例、CI 微调 | 直接改、直接提交 |
| 实现中发现的设计缺口 | 不当场拍板，记进 [`implementation-open-questions.md`](docs/engineering/implementation-open-questions.md) 等作者裁定 |

**测试与 CI**：每个用例文件恰好属于一个执行层，分层只在 `tools/testguard/testTiers.ts` 一处决定——`unit`（方法级，就近放在源码旁，不依赖任何环境）、`module`（模块级，各单元 `tests/` 下，真实 PostgreSQL）、`console`（工作台渲染）、`e2e`（`tests/e2e`，对部署好的平台跑真浏览器）。GitHub Actions 一层一个作业，另有 `static`（结构规则、lint、类型）与汇总的 `gate`；**看一次推送绿不绿，看 `gate` 与 `e2e`**。`gate` 还执行新增代码防护：本次推送改到的生产文件必须有用例加载，改动的可执行行至少 80% 被执行到。新迁移要入迁移锁，改业务契约面要入契约金样。细节见 [`testing.md`](docs/engineering/testing.md)。

**工作台界面**优先复用 `apps/console/src/shared/` 的组件与样式；表单与确认用页面内弹窗，不用浏览器原生的 `alert`／`confirm`／`prompt`（开发规则 §7）。

**只读的外部仓库**：`~/dev/proj/agent-workflow` 是 Agent 驱动等代码的借鉴来源，任何情况下都不写入。

**提交署名**：AI 编码 Agent 对一次提交有实质贡献时，追加它自己真实名字的 `Co-Authored-By` trailer，见 [`AGENTS.md`](AGENTS.md)。

## 8. 文档地图

新会话（人或 Agent）开工前按这个顺序读：

1. [`STATE.md`](STATE.md)：会话之间的接力记录——做完了什么、下一步、当前注意事项。
2. [`CLAUDE.md`](CLAUDE.md)／[`AGENTS.md`](AGENTS.md)：仓库现状、命令、架构概览与术语，以及面向编码 Agent 的开工须知。
3. [`docs/engineering/development-rules.md`](docs/engineering/development-rules.md)：怎么改。
4. [`docs/engineering/repository-structure.md`](docs/engineering/repository-structure.md)：改成什么形状。
5. [`docs/engineering/testing.md`](docs/engineering/testing.md)：用例防护体系。
6. [`docs/engineering/dev-gotchas.md`](docs/engineering/dev-gotchas.md)：撞过的坑，动手前扫一遍。

| 文档 | 回答什么 |
|---|---|
| [`proposal/proposal.md`](proposal/proposal.md) | 为什么做、做什么、不做什么：来源 S1–S9、定位、能力全景与接入约定、产品原则、场景、需求基线 R01–R58、范围与风险 |
| [`proposal/design.md`](proposal/design.md) | 对象、接口、运行时与数据机制：不变量、核心对象、Manifest、开发会话与 TaskRunner、标签发布与蓝绿切流、身份、API 代理与事件、数据、任务容器与子任务契约、安装与升级、决策 D01–D62、待决问题 Q01–Q24 |
| [`proposal/plan.md`](proposal/plan.md) | 需求怎么变成任务与证据：里程碑 M0–M6 与门禁 G0–G6、任务 `Tn.m`、验收测试 AT-01–AT-59、追踪矩阵 |
| [`proposal/tech-evaluation.md`](proposal/tech-evaluation.md) | 选哪些组件、为什么：E01–E25 |
| [`proposal/reviews/`](proposal/reviews/) | 设计门检视及作者的 25 项裁定、工作台 UX 检视 |
| [`proposal/rfc/`](proposal/rfc/README.md) | 基线之后的每一项变更 |
| [`docs/adr/`](docs/adr/README.md) | 仓库结构规则的决策记录（ADR-0001–0009） |
| [`docs/engineering/implementation-open-questions.md`](docs/engineering/implementation-open-questions.md) | 实现期发现、待作者裁定的设计问题 |
| [`docs/engineering/agent-drivers-copy-manifest.md`](docs/engineering/agent-drivers-copy-manifest.md) | 自 agent-workflow 复制的 Agent 驱动：源提交与逐文件对照 |
| [`deploy/README.md`](deploy/README.md) | 本机集群基础设施：组件、网络、名称约定、验证与卸载 |
| [`tests/e2e/README.md`](tests/e2e/README.md) | 实机验收用例怎么跑、怎么写 |
| [`templates/minimal-sample/README.md`](templates/minimal-sample/README.md) | 最小样例证明了哪些接入约定 |

## 9. 术语

| 术语 | 含义 |
|---|---|
| 数字人 | 可部署的业务服务：页面、API、事件、数据库、文件与自己的身份。首版一个项目只有一个数字人服务 |
| 开发会话 | 一个长驻开发容器，常驻 TaskRunner；多个并行的流式 Agent、Web 终端、编辑器、预览、日志与发布入口。一个项目同时至多一个，空闲只提醒 |
| 部署槽 | 同一个生产服务的两个蓝绿槽 preview 与 prod，共用生产数据、配置与身份，区别只在网关把流量导向哪一个。晋级就是负责人切流，回退就是切回 |
| 用户域／服务域 | 网关的两类主机：用户域登录后注入身份；服务域不跳登录，按源 Pod IP 认出调用方并注入来源令牌 |
| 接入容器 | 管理员建的平台项目，Manifest 类型为 `APIProxy`（纯转发公司接口）或 `EventProducer`（把公司 Webhook 转成平台事件）；与数字人一样建仓、发布、切流 |
| 算力档位 | 管理员定义的完整 Agent 执行配置：协议、按摘要固定的镜像、二进制与参数、启动前步骤、变量与凭据、模型、资源；保存即实测 |
| TaskRunner | 任务容器里的常驻进程（独立 UID），主动连出到 cs-session，负责启动 Agent、执行命令、读写文件 |
| 业务子任务 | 业务服务经子任务契约层交给业务执行 Agent 的一次执行，`oneshot` 或 `interactive`，只带 `agentProfile` 与输出契约 |
| 能力说明 | 工作台的能力页与能力说明 MCP：实时列出本服务已获授权的接口、数据绑定、订阅、额度与环境 |

已作废、不要再引入的概念（主 Agent、Agent 角色、Checkpoint、ZIP 导入、出站白名单等）列在 [`CLAUDE.md`](CLAUDE.md) 的「Terminology」一节。
