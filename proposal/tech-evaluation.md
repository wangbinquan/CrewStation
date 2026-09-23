# Tech Evaluation｜CrewStation 选型重评

> 状态：已确认（2026-09-11，E01–E22）；v1.1.0 依据设计门检视裁定修订 E06、E08、E10、E11、E12、E19 并新增 E23–E25 待定候选；待验证项由 M0 原型核实  
> 版本：1.1.0 · 日期：2026-09-11  
> 配套文档：[Proposal](./proposal.md) · [Design](./design.md) · [Plan](./plan.md)

## 0. 评估方法与约束

本评估按 Proposal v0.3.0 与 Design v0.3.0 确定的能力全集，对 v0.2.0 的每个候选组件重新审视。约束来自：R38 数百数字人并发、数百节点、单集群；R39 控制面高可用首版；R42 双驱动复制改造自 agent-workflow 且不修改其仓库；R40 与 R45 网关承担用户鉴权与操作级放行；R05 一任务一长驻容器、容器内常驻 TaskRunner；仅 Kubernetes，本机 kind 验证；接入只靠约定不提供 SDK；cs-events 事件中心；三种 Manifest。

评估维度：与约束的契合度；复制改造成本；在 Kubernetes 多副本下的运维成熟度；必须原型验证的风险。每项给出**建议**与**备选**，并列出**待验证**。所有结论在用户确认前都是建议；本文不断言任何第三方组件的具体版本、许可证状态或未经原型的兼容性，凡涉及都列为待验证。

来自本机 `agent-workflow` 仓库的可核实事实：后端依赖为 hono、drizzle-orm、zod、zod-to-json-schema、jose、@modelcontextprotocol/sdk、ulid、yaml、diff；前端依赖含 react、@tanstack/react-router 与 react-query、codemirror 系列、@xyflow/react、react-markdown、shiki、mermaid；运行时与进程层使用 Bun.spawn、Bun.Subprocess、Bun.sleep、Bun.write、Bun.which、Bun.file 等 Bun 专有 API 约 25 处；仓库内没有 PTY 或终端相关代码；驱动目录 33 个文件约 6955 行（统计时点早于设计门检视所核对的 HEAD c4965ab，后者为 34 个文件约 7157 行；T0.2 登记最终源 commit），runner.ts 2778 行为 DAG 节点编排而非事件泵，事件泵在 execution/managedProcess.pump 与 agentProcess.ts，进程管理 managedProcess.ts 989 行；数据库默认 SQLite 并有 PostgreSQL provider；测试用 bun test 与 vitest。

## 1. 结论汇总

| 编号 | 部分 | v0.2.0 候选 | 建议 | 备选 | 关键待验证 |
|---|---|---|---|---|---|
| E01 | 控制面语言与运行时 | TypeScript、Node.js LTS | **TypeScript、Bun** | Node.js LTS | Bun 长驻多副本服务成熟度；原生模块兼容 |
| E02 | 包管理与工作区 | pnpm workspace | **Bun workspaces** | pnpm | 随 E01 |
| E03 | 后端框架与契约 | Fastify、TypeBox、OpenAPI | **Hono、zod、由 zod 生成 OpenAPI** | Fastify、TypeBox | Hono 在 Bun 下的 WebSocket 与流式行为 |
| E04 | 元数据库与 ORM | PostgreSQL、Drizzle | **PostgreSQL 高可用、Drizzle** | 同 | Bun 下的 PostgreSQL 驱动选择 |
| E05 | 后台任务与多副本协调 | pg-boss | **PostgreSQL 表队列（SKIP LOCKED）＋租约表与 fencing token** | pg-boss（若 Bun 下验证通过） | 多副本控制器续接；吞吐 |
| E06 | 网关 | Traefik、Gateway API | **Traefik；用户域经 ForwardAuth 到 cs-auth 鉴权；服务域按源 Pod IP 反查身份并按网关本地放行表放行（G2）** | Envoy Gateway（ext_authz） | 放行表与 Pod 身份索引下发及缓存失效；数百 Host 路由 |
| E07 | 用户身份与令牌 | 公司体系适配；Keycloak 桥接候选 | **OIDC 对接公司 IdP；平台 JWT 由 jose 签发，JWKS 轮换** | SAML 适配 | 公司 IdP 协议（Q01）；令牌格式（Q16） |
| E08 | 服务身份 | K8s 工作负载身份（TokenReview） | **网关按源 Pod IP 反查工作负载身份，Pod 身份索引由控制面维护并下发；业务代码不携带凭据（G1）。Projected token 只用于 TaskRunner 连接 cs-session** | 业务携带投影令牌；出口 sidecar | 所选 CNI 保留源 IP；NAT 场景；索引更新与缓存失效（Q21） |
| E09 | 任务容器底座 | OpenSandbox | **Kubernetes 原生：Pod、PVC、NetworkPolicy、ResourceQuota，由 cs-controller 直接管理；Pod 与容器即隔离边界，不引入任何额外沙箱层** | 无 | Pod 与 PVC 供给时延；预热必要性 |
| E10 | TaskRunner 运行时 | TaskRunner 模块（未定运行时） | **TypeScript；运行时以 PTY 验证结果定：优先 Bun，不可用则 Node；独立系统用户运行，文件接口 realpath 校验（G25）；tini 作 PID 1** | Go 实现 PTY 侧车 | Bun 的 PTY 能力；node-pty 在容器内；孤儿进程收割 |
| E11 | TaskRunner 与控制面连接 | 未定 | **TaskRunner 出向 WebSocket 到 cs-session，携带绑定 cs-session audience 的 projected token；副本归属记入 PostgreSQL 并有租约；cs-controller 指令经 cs-session 转发；协议带版本** | cs-session 入向连接 Pod IP | 心跳、退避、缓冲上限定值；数百连接的副本迁移（Q17） |
| E12 | Agent 驱动 | 首个 OpenCode 适配器 | **复制单元为 agent-workflow 的 runtime 驱动、execution/agentInjection、agentProcess 与 managedProcess、shared 的 Agent、Mcp、AgentPermission Schema；编排层 runner.ts 不复制而新写；双驱动（G7）。两处登记偏差：开发会话走流式交互（G5），Claude Code 自带沙箱关闭（G6）** | 重写 | 逐文件依赖清单与源 commit；两 CLI 流式交互能力（Q22）；会话恢复并发保护 |
| E13 | 源码托管客户端 | SourceControlProvider | **复制 agent-workflow 的 code-host 连接与调用层；新增建仓、标签、保护标签 API** | 重写 | 公司 GitLab 兼容范围（Q11） |
| E14 | 构建 | BuildKit；Buildpacks 后置 | **BuildKit rootless 作 Kubernetes Job** | Buildpacks | 非特权构建在公司集群的允许方式（Q04） |
| E15 | 数据库供给 | CloudNativePG | **CloudNativePG；公司已有托管 PostgreSQL 优先接入** | 公司托管 PG | 高可用切换与单项目恢复 |
| E16 | 对象存储 | S3；内置候选 SeaweedFS | **优先公司已有 S3 兼容存储；内置候选待核实许可证与维护状态后定** | 其他 S3 兼容实现 | 许可证；预签名、跨桶拒绝、备份 |
| E17 | 事件中心 cs-events | 未定 | **PostgreSQL inbox／outbox 表＋SKIP LOCKED 投递 worker＋HTTP 推送** | Kafka（条件性） | 数百服务订阅下的投递吞吐 |
| E18 | 控制台 | React、Vite、shadcn/ui | **React、Vite、TanStack Router 与 Query、CodeMirror 编辑器、xterm.js 终端、嵌入 Swagger UI** | Monaco 编辑器 | 多 Agent 面板与终端并存的性能 |
| E19 | 平台 MCP | 未定 | **@modelcontextprotocol/sdk，Streamable HTTP 传输，两个独立服务；注入形状已知：OpenCode remote 类型 MCP 配置，Claude Code `--mcp-config` 文件** | 同 | 会话级短期凭据的轮换与清理；agentProfile 权限映射 |
| E20 | 观测与追溯 | OpenTelemetry；平台事件表 | **OpenTelemetry SDK＋Collector；execution_events 表承载任务链路** | 同 | OTel SDK 在 Bun 下的兼容 |
| E21 | 发行与安装 | Helm；安装器 | **Helm chart＋Bun 单文件二进制安装器** | 纯 Helm | 离线引导 |
| E22 | 本地验证 | Docker 与 K8s | **仅 kind；HA 逻辑存在但故障切换在多节点测试集群验证** | — | Q19 |
| E23 | 出站代理 | **已作废（2026-09-22，RFC-018）** | 出站 FQDN 白名单整体下线，不再需要按域名执行的出站代理；项目命名空间的出向由 NetworkPolicy 按负载标签决定 | — | — |
| E24 | 日志采集与存储 | 未定 | **集群日志采集与存储，供工作台日志页按服务、槽、任务、Job 查询（G9）；候选待定** | 对接公司日志平台 | 数百服务日志量；查询时延 |
| E25 | 告警通知渠道 | **已作废（2026-09-23，Design D61）** | 删除项目级告警订阅，首版不做告警通知；告警只在工作台查看，不再需要通知渠道 | — | — |

## 2. 逐项评估

### E01 控制面语言与运行时

约束：复制改造来源 agent-workflow 全部为 TypeScript on Bun，进程层直接使用 Bun.spawn 等 API；控制面五个服务多副本无状态。

分析：选择 Node.js LTS 意味着复制的驱动、事件泵与进程管理要把约 25 处 Bun 专有调用改为 child_process 与 fs 等等价实现，并更换测试框架；这些代码是首版最核心也最难重写的部分。选择 Bun 则复制成本最低，Hono 与 Drizzle 也同栈。风险在于 Bun 作为长驻多副本服务运行时的成熟度、内存行为与原生模块兼容，这些不能凭印象判断。

建议：TypeScript on Bun。备选：Node.js LTS，触发条件为 M0 原型发现 Bun 在 PostgreSQL 驱动、WebSocket、PTY 或长时间运行上有阻塞性问题。

待验证：T0.4 与 T0.2 中 Bun 运行 Hono 服务多副本 24 小时的稳定性；原生模块清单。

### E02 包管理与工作区

随 E01：Bun workspaces。若 E01 改为 Node，则 pnpm workspace。

### E03 后端框架与契约

约束：五个服务与两个 MCP 需要 HTTP、WebSocket、流式响应；契约要能生成 OpenAPI 供 CLI 与工作台共用（R03）；三种 Manifest 与放行表需要 Schema 校验（T0.3）。

分析：agent-workflow 用 Hono 加 zod，并已有 zod-to-json-schema；Fastify 与 TypeBox 是 v0.2.0 的候选，与 Bun 的兼容不如 Hono 直接。契约层用 zod 统一 Manifest、API 与事件 Schema，可从 zod 生成 OpenAPI 与 JSON Schema。

建议：Hono、zod、由 zod 生成 OpenAPI。备选：Fastify 与 TypeBox（随 E01 改为 Node 时）。

待验证：Hono 在 Bun 下的 WebSocket 升级与长连接排空行为，用于 cs-session。

### E04 元数据库与 ORM

约束：R39 高可用；数百任务容器与事件的元数据写入；单项目恢复。

分析：PostgreSQL 高可用是必需；Drizzle 是复制来源已用的 ORM，PostgreSQL provider 也已存在。Bun 下的 PostgreSQL 驱动有多种选择，需要以连接池、事务与迁移工具链一起验证。

建议：PostgreSQL 高可用加 Drizzle；迁移用 drizzle-kit 生成的 SQL 经带锁任务执行。

待验证：Bun 下驱动选择与连接池行为；故障切换时的连接恢复。

### E05 后台任务与多副本协调

约束：cs-controller 多副本续接（Design §10.7）；建仓、推送、标签、部署、迁移等副作用的幂等与 UnknownOutcome；事件投递重试。

分析：pg-boss 依赖 Node 的 pg 驱动，在 Bun 下是否可用需验证；agent-workflow 的进程内调度器不适合多副本。以 PostgreSQL 表实现队列（FOR UPDATE SKIP LOCKED）加租约表与 fencing token，是与元数据库同事务、无新组件的做法，agent-workflow 的执行所有权与 fence 概念可复制。首版不引入 Redis 或 Kafka。

建议：PostgreSQL 表队列加租约与 fencing token，作为 cs-controller 与 cs-events 共用的协调底座。备选：pg-boss，条件是 Bun 下验证通过且吞吐满足。

待验证：目标档位下的队列吞吐与锁竞争（T5.7）；多副本杀死一副本后的续接（T6.10）。

### E06 网关

约束：用户鉴权前置与身份注入（R40）；按服务环境的方法加路径放行（R45）；工作负载身份识别（R09）；数百 Host 路由、预览路由、WebSocket；Gateway API；kind 上可部署。

分析：把放行决策放在网关配置里会随服务数与操作数膨胀；把决策放在 cs-auth，由网关每请求 forward-auth 并按响应注入身份头，网关配置只随路由增长。Traefik 的 ForwardAuth 中间件可把认证服务的响应头复制到请求，满足身份注入；Envoy Gateway 的 ext_authz 走 gRPC，性能与可观测更强，但复杂度更高。两者都需在 T0.5 原型中验证工作负载身份的提取路径与每请求决策时延。

建议：Traefik 加 ForwardAuth 到 cs-auth，cs-auth 缓存放行表版本。备选：Envoy Gateway，触发条件为 T5.7 压测中 forward-auth 时延或连接数不达目标档位。

待验证：ForwardAuth 对 WebSocket 升级请求的处理；放行决策在数百服务下的 p99 时延；Gateway API 版本支持。

### E07 用户身份与令牌

约束：公司 IdP 协议未知（Q01）；业务服务读明文头或验签令牌（R40）；令牌轮换（Q16）。

分析：cs-auth 作为 OIDC 依赖方对接公司 IdP 是最常见路径，SAML 作为适配备选；平台令牌用 JWT，jose 库已在 agent-workflow 中使用；业务服务验签通过 JWKS 端点，密钥轮换保留重叠期。Keycloak 不再作为候选，避免多一层身份系统。

建议：OIDC 对接、jose 签发 JWT、JWKS 轮换。备选：SAML 适配器。

待验证：公司 IdP 实际协议与声明；令牌有效期与网关会话策略。

### E08 服务身份

约束：网关必须识别调用方是哪个数字人服务（R09、R45），不信任自报头。

分析：Kubernetes projected ServiceAccount token 绑定 audience，Pod 自动获得并可随请求携带；cs-auth 通过 TokenReview 或集群 OIDC 发现校验并映射到服务环境。mTLS 与 SPIFFE 需要服务网格或额外组件，后置。

建议：projected ServiceAccount token 方案。备选：mTLS／SPIFFE。

待验证：token 在网关侧的提取方式（请求头约定）；校验时延与缓存；开发会话容器与 preview 部署共用身份的实现。

### E09 任务容器底座

约束：一任务一长驻 Pod、常驻 TaskRunner、持久卷两种模式、配额准入、网络隔离；不需要容器内 exec，因为 TaskRunner 提供接口。

分析：这个模型与 Kubernetes 原生对象一一对应：Pod 承载容器，PVC 承载两种卷模式，NetworkPolicy 限制出站，ResourceQuota 与平台配额共同限流。OpenSandbox 这类沙箱产品提供的能力在此模型下大多重复，且其 CRD 与兼容性未验证。

建议与用户裁定：Kubernetes 原生对象由 cs-controller 直接管理；**Pod 与容器本身就是隔离边界，不引入任何额外沙箱层**，包括不引入 OpenSandbox，也不把 gVisor 或 Kata 等 RuntimeClass 列为条件性选项。

待验证：Pod 与 PVC 供给到 TaskRunner 就绪的时延；是否需要预热池；kind 上的 local-path 存储与真实 CSI 的差异。

### E10 TaskRunner 运行时

约束：TaskRunner 在容器内直接复用 TypeScript 驱动（E12），必须是 Node 或 Bun；需要 PTY 提供 Web 终端（R41）；容器镜像已含 Claude Code，其运行需要 Node。

分析：agent-workflow 没有 PTY 代码，这是新增能力。node-pty 是成熟的 Node 原生模块；Bun 是否能提供等价 PTY 能力不能凭印象判断。若 Bun 不可用，TaskRunner 用 Node 运行并不增加镜像负担，因为 Node 已经存在。

建议：TaskRunner 用 TypeScript 实现；运行时按 T0.4 的 PTY 验证结果决定，优先 Bun 以与控制面一致，不可用则 Node。备选：Go 实现 PTY 侧车，TaskRunner 仍用 TS 调用。

待验证：Bun 下的 PTY；node-pty 在容器基础镜像上的构建；同容器多 Agent 进程与终端的资源占用（Q13）。

### E11 TaskRunner 与控制面连接

约束：数百任务容器同时在线；cs-session 多副本；NetworkPolicy 尽量只允许出站。

分析：TaskRunner 主动向 cs-session 建立出向 WebSocket 并携带 projected token，网络策略最简单，容器不用暴露端口；cs-session 多副本把 runner 归属记入 PostgreSQL，浏览器请求到达其他副本时转发。入向连接 Pod IP 需要开放容器端口并处理 Pod IP 变化。

建议：出向连接。备选：入向连接。

待验证：副本被杀时数百连接的重连风暴与归属迁移（Q17、T6.10）。

### E12 Agent 驱动

约束：双驱动首版必需（R42）；不修改 agent-workflow；驱动在任务容器内运行。

分析（v1.1.0 按代码核对修订）：复制单元为 runtime 目录的驱动、execution/agentInjection、agentProcess 与 managedProcess，以及 shared 中的 Agent、Mcp、AgentPermission Schema；runner.ts 是 DAG 节点编排（46 字段的 RunNodeOptions，绑定持久化、WebSocket、记忆与信封），不复制而新写。实际依赖远超六处：agentInjection、readonlySqliteDatabase（bun:sqlite）、util/git、safePath、fileTrust、platformExec、sessionEventSink、resourcePolicy、embed.generated 以及 shared Schema，须在 T0.4 逐文件列清单并反转。两个 CLI 在 agent-workflow 中都是一次性无交互进程，开发会话所需的流式交互是登记偏差，T0.4 验证两 CLI 的实现方式，不可用时回退为每条消息以 resume 起新进程。Claude Code 的启动参数、会话恢复与权限映射与 agent-workflow 的驱动保持一致，不做单独处理；这是用户裁定。OpenCode 的插件文件随镜像分发。

建议：复制改造，双驱动，一个任务容器镜像同时含两个 CLI。备选：重写驱动，不建议。

待验证：依赖反转后的行为一致性（T0.4）；两个驱动在容器内的行为与来源一致；两个 CLI 的版本锁定与模型配置注入。

### E13 源码托管客户端

约束：建仓、受控推送、创建与保护 v 标签、标签事件（R32、R35）；agent-workflow 的客户端没有建仓与标签能力。

分析：复制其连接、调用执行、超时与脱敏层，新增 Projects、Tags、Protected Tags 相关 API；Git 推送经 HTTP 与短期 token。

建议：复制加新增。待验证：公司 GitLab 兼容服务是否提供这些管理 API（Q11、T0.9）。

### E14 构建

约束：从标签 SHA 干净构建；非特权；产物摘要可追溯。

分析：BuildKit rootless 作为 Kubernetes Job 是通用做法；Buildpacks 后置。构建缓存隔离与私有依赖访问需设计。

建议：BuildKit rootless。待验证：公司集群对 rootless 构建的允许方式（Q04）。

### E15 数据库供给

建议：CloudNativePG 管理平台元数据库与业务 PostgreSQL 池，公司已有托管 PostgreSQL 时优先接入。待验证：高可用切换时长、单项目时间点恢复流程。

### E16 对象存储

建议：优先公司已有 S3 兼容存储；内置候选在核实许可证与维护状态前不写入文档。待验证：预签名、跨桶拒绝、备份、离线安装。

### E17 事件中心 cs-events

约束：EventProducer 投递、去重、订阅、HTTP 推送、重试、死信、重放；首版不支持业务自定义事件与定时。

分析：事件量级由公司系统回调决定，首版不引入 Kafka；PostgreSQL inbox 与 outbox 表加 SKIP LOCKED worker 与 E05 共用底座。

建议：PostgreSQL 实现。备选：Kafka 作条件性选项。待验证：目标档位吞吐（T5.7）。

### E18 控制台

约束：多 Agent 面板、Web 终端、代码编辑器与文件树、预览 iframe、Swagger、能力页（R41）。

分析：agent-workflow 前端用 React、Vite、TanStack Router 与 Query、CodeMirror，可复用会话视图与编辑器组件；终端用 xterm.js 新增；Swagger UI 嵌入；组件库可选 shadcn/ui。

建议：如上组合。备选：Monaco 编辑器。待验证：多个流式面板与终端并存的渲染性能。

### E19 平台 MCP

建议：@modelcontextprotocol/sdk，Streamable HTTP 传输，能力说明 MCP 与操作 MCP 两个独立服务；容器内 Agent 以开发会话凭据连接。待验证：两个 CLI 对远程 MCP 的配置注入方式。

### E20 观测与追溯

建议：OpenTelemetry SDK 与 Collector 承担前台链路；execution_events 表承担 taskId、traceId、sessionId 链路；日志以 JSON 输出到 stdout。待验证：OTel SDK 在 Bun 下的兼容。

### E21 发行与安装

建议：Helm chart 管平台组件；安装器为 Bun 编译的单文件二进制，agent-workflow 的 build-binary 脚本可参照。待验证：离线引导路径。

### E22 本地验证

建议：仅 kind；HA 配置项存在，故障切换在多节点测试集群验证（Q19）。

## 3. 已完成的回填（v0.3.1）

- Proposal §8：候选表替换为确认后的选型，保留“必须验证”列。
- Design §3.1：同上；§2.1、§3.2、§9.2、§9.3、§15.1 措辞按 E06、E09、E11、E15、E16、E02 调整；新增 D38，Q02 改为版本锁定。
- Plan：T0.10 标记候选确认已完成；T0.2 承担版本锁定；T0.4 待验证项与本文第 4 节对齐。

## 4. 待验证清单与对应任务

| 待验证 | 任务 |
|---|---|
| Bun 长驻服务稳定性、PostgreSQL 驱动、WebSocket、OTel 兼容 | T0.2、T0.4 |
| Bun 的 PTY 或 node-pty 在容器内 | T0.4 |
| 驱动依赖反转与逐文件清单；两 CLI 流式交互模式；关闭 Claude Code 自带沙箱；MCP 注入与凭据轮换；会话恢复并发保护 | T0.4 |
| Bun 长驻多副本服务、PG 驱动、Hono WebSocket、OTel 兼容 | T0.11 |
| 源 Pod IP 反查在所选 CNI 下的可行性与索引失效时延 | T0.5 |
| 出站代理候选、日志采集候选、告警渠道（已作废，D61） | T0.8、T0.12 |
| 用户域 ForwardAuth 身份注入与 aud 绑定、服务域本地放行表与来源令牌 | T0.5 |
| Pod 与 PVC 供给时延；两种卷模式 | T0.6 |
| GitLab 建仓、标签、保护标签 API | T0.9 |
| 队列与事件吞吐、连接迁移 | T5.7、T6.10 |
| rootless 构建允许方式 | T0.8 |

## 5. 确认记录

| 编号 | 用户结论 | 日期 |
|---|---|---|
| E01–E03 | 采纳建议：TypeScript on Bun、Bun workspaces、Hono 加 zod 生成 OpenAPI | 2026-09-11 |
| E04、E05、E15、E17 | 采纳建议：PostgreSQL 高可用加 Drizzle；PostgreSQL 表队列加租约承载后台任务、协调与 cs-events；CloudNativePG；首版不引入 Kafka 或 Redis | 2026-09-11 |
| E06–E08 | 采纳建议：Traefik 加 ForwardAuth，决策在 cs-auth；OIDC 加 jose JWT 与 JWKS；projected ServiceAccount token（E06、E08 的服务身份与放行位置后由 G1、G2 修订，见下） | 2026-09-11 |
| E09 | 采纳并加强：Pod 与容器即隔离边界，不引入任何额外沙箱层 | 2026-09-11 |
| E10、E11 | 采纳建议：TaskRunner 用 TypeScript，运行时优先 Bun、PTY 不可用则 Node；出向 WebSocket 连接 cs-session | 2026-09-11 |
| E12 | 采纳并修正：复制 agent-workflow 驱动；Claude Code 不做单独处理，运行方式与 agent-workflow 运行时一致（用户原话写作 agent-space；沙箱与交互模式两点后由 G5、G6 修订为登记偏差，见下） | 2026-09-11 |
| E13、E14、E16 | 采纳建议：复制 code-host 客户端并新增建仓与标签 API；BuildKit rootless；对象存储优先公司已有 S3 兼容存储 | 2026-09-11 |
| E18–E22 | 采纳建议：React、Vite、TanStack、CodeMirror、xterm.js、Swagger UI；官方 MCP SDK 两个服务；OpenTelemetry 加 execution_events；Helm 加 Bun 安装器；本地仅 kind | 2026-09-11 |
| E06、E08、E10、E11、E12、E19 修订 | 依据设计门检视裁定 G1、G2、G5、G6、G7、G25 修订：源 Pod IP 身份、本地放行表、流式交互、关闭 Claude 沙箱、复制单元重划、TaskRunner 独立 UID | 2026-09-11 |
| E23–E25 | 新增待定候选：出站代理、日志采集、告警渠道；结论在 T0.8、T0.12 形成 | 2026-09-11 |
| E23 | 作废：RFC-018 下线出站白名单，出站代理不再选型 | 2026-09-22 |
| E25 | 作废：Design D61 删除项目级告警订阅，首版不做告警通知，告警渠道不再选型 | 2026-09-23 |
