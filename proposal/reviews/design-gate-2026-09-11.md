# 设计门检视报告｜CrewStation v0.3.1

> 检视对象：proposal.md、design.md、plan.md v0.3.1 与 tech-evaluation.md 1.0.0，对应 origin/main `ccb737b`  
> 检视日期：2026-09-11  
> 方式：七个互不共享上下文的独立评审员，各自完整阅读四篇文档后按单一视角出具报告；视角 6 另核对 agent-workflow 仓库 HEAD `c4965ab` 的代码。本报告为合并去重后的结果，原始报告见附录。  
> 状态：25 项裁定已于 2026-09-11 完成（见 §6），并落入 Proposal、Design、Plan v0.3.2 与 tech-evaluation 1.1.0。

## 0. 结论

七个视角一致认为：建仓、开发会话、标签发布、网关身份、操作级放行、事件中心、任务容器与控制面 HA 的主链在三篇文档间已经闭合，编号与章节引用基本正确，里程碑无环。但七个视角中六个给出阻断级发现，**按当前文本不能判定最终目标可达成**。缺口集中在六处：

1. 业务服务如何向网关呈现工作负载身份，三处文本互相矛盾，且在“无 SDK、无 sidecar、业务代码不携带”的前提下没有可行机制；调用内部 API、以服务身份创建业务任务、最小样例的 Agent 对话框、Swagger 与操作 MCP 以 preview 身份试调，全部依赖它。
2. 放行决策的位置矛盾：一处说放行表下发网关本地执行，一处说每请求 ForwardAuth 到 cs-auth；按后者 cs-auth 成为全部数据面的同步单点。
3. 非用户流量的入向与来源鉴别未定义：事件推送、EventProducer 入口、数字人互调，与“未登录一律跳转登录”“业务服务只接受网关流量”矛盾；处理路径暴露在用户入口可被伪造。
4. 业务子任务契约层没有载体：agentProfile 与 outputContract 在 Manifest、表、API 中都未定义；同时两个 CLI 都是一次性无交互进程，文档中的 sendMessage 与 AwaitingInput 不能由复制的驱动产生。
5. 复制改造范围被低估，且 Claude Code 自带沙箱在 agent-workflow 中默认开启，与“Pod 即隔离边界、不加沙箱”不可兼得。
6. 运营元素缺失：业务服务的配置与 Secret、运行日志与健康状态、规模与 HA 的验证环境。

最短补齐路径：先做出第 1、2、3、4、5 项的裁定并写入 Design §7、§8、§10 与 T0.3、T0.4、T0.5，再补第 6 项的对象与任务。

## 1. 阻断级发现

| 编号 | 发现 | 位置 | 来源视角 | 处理方向（供选择） |
|---|---|---|---|---|
| B1 | 服务身份呈现方式矛盾：§7.2 称网关依据 Pod 的 ServiceAccount 令牌且业务代码不携带；E08 称 token 随请求携带、请求头约定待验证；SA token 是 Pod 内文件，无进程置入请求则网关拿不到；用户会话换取 preview 服务身份的路径未定义；TokenReview 每请求打 apiserver 无缓存 | Design §7.2、§8.4；Proposal §3、§4.7；E08 | 1、3、4 | a) 约定业务代码读取投影令牌并置入指定请求头，改 §7.2；b) 出口 sidecar 自动附头；c) 网关侧按源 Pod IP 反查 SA，业务零改动。preview 试调另需 cs-auth 代会话签发短期 preview 身份 |
| B2 | 放行决策位置矛盾：§2.4 与 §8.3 为放行表下发网关本地执行、不逐请求查询；§3.1、D02、E06 为每请求 ForwardAuth 到 cs-auth。后者使 cs-auth 处于页面、内部 API、平台 API、预览、事件推送的同步路径，失联即拒（§13.2） | Design §2.4、§8.3 对 §3.1、D02；E06；§13.2 | 4、2 | a) 用户鉴权走 ForwardAuth，服务放行表由网关本地执行；b) 全部走 ForwardAuth 但规定 cs-auth 本地缓存与有界降级，并在 AT-40 增加 cs-auth 不可用用例；c) 启用 E06 备选 |
| B3 | 非用户流量入向与来源鉴别未定义：EventProducer 的 ingress、cs-events 推送到 handlerPath、数字人互调，与 §7.1“未登录一律跳转”和 §13.1“只接受网关流量”矛盾；EventDelivery 的载荷、事件 ID、traceId、签名、确认语义未定义；处理路径暴露在用户入口，登录用户可伪造事件；跨服务转发的用户令牌无 aud 绑定 | Design §2.4、§7.1、§8.5、§13.1、Q16 | 1、2、3 | a) 非用户流量也经网关，按 Host 分用户域与服务域，网关注入签名来源令牌，用户令牌 aud＝目标服务；b) cs-events 直连但定义 HMAC 头与 NetworkPolicy 例外；c) 处理路径限定前缀并由网关拒绝用户流量 |
| B4 | 契约层无载体：agentProfile（驱动、模型、工具、权限）与 outputContract（Verifying 校验依据）在对象表、持久化表、Manifest、API 中均无定义与登记途径，TaskRunner 无法校验，G5 与 AT-26 不可执行 | Design §1.3、§4.1、§4.4、§10.3 | 2、1 | a) Manifest 增 tasks.agentProfiles 与 outputContracts 段，随发布登记落表；b) 提交子任务时内联完整定义，平台存摘要；c) 平台级目录 API |
| B5 | Agent 交互模型与 CLI 不符：claude 为 `-p --output-format stream-json` 加 stdin 一次性进程，opencode 为 `run --format json --auto` 一次性进程，追问只能起新进程 `--resume`；§5.6 的 sendMessage 与 §10.3 的 AwaitingInput 不能由复制驱动产生 | Design §5.5、§5.6、§10.3；E12；agent-workflow runtime/claudeCode/spawn.ts:58-63、opencode/spawn.ts:101-132 | 6 | a) 定义 sendMessage＝以 resume 起新进程，业务子任务删除 AwaitingInput；b) 改用 CLI 流式输入模式，登记为对“一致运行”的偏差并在 T0.4 验证 |
| B6 | Claude Code 自带沙箱与“不加沙箱”冲突：agent-workflow 业务 spawn 默认写 per-run settings 开启 Claude 沙箱，Linux 需 bwrap 与 socat，缺失只告警继续，容器内还需非特权 userns 与 seccomp 放行；来源 CI 未验证 Linux 路径 | E09、E12；agent-workflow claudeCode/spawn.ts:166-194、boundary.ts:198-209 | 6 | a) 走不传 taskMounts 的路径关闭该沙箱并记录偏差；b) 镜像装 bwrap 与 socat 并在 T0.4 验证 securityContext；c) 接受告警降级并写入验收 |
| B7 | 复制范围被低估：runtime/ 的依赖远超六处，含 execution/agentInjection、readonlySqliteDatabase（bun:sqlite）、util/git（3538 行）、safePath、fileTrust、platformExec、sessionEventSink、resourcePolicy、embed.generated，及 shared 的 Agent、Mcp、AgentPermission schema；runner.ts 是 DAG 节点编排（46 字段的 RunNodeOptions），真正的事件泵在 managedProcess.pump 与 agentProcess.ts；Bun API 清单遗漏 bun:sqlite、以 process.execPath 自再入的 launcher、embed.generated | E12、E01、E10；tech-evaluation §0 | 6 | a) 复制单元改为 drivers＋agentInjection＋agentProcess/managedProcess＋shared 子集，编排新写；b) T0.4 产出逐文件依赖清单并登记源 commit |
| B8 | 业务服务的配置与 Secret 管理缺失：只提“配置与 Secret 引用”“配置版本”，无对象、表、API、界面、角色、分环境注入约定、任务与 AT；真实服务必有第三方密钥与 preview/prod 差异配置 | Proposal §3；Design §4.1、§12.5、§13.1 | 5、1、3 | a) 增 Config/Secret 对象与 Manifest env 段，prod 值由负责人维护；b) 仅支持管理员代录的 Kubernetes Secret 引用；c) 明示首版不支持并入限制清单 |
| B9 | 运行日志与指标无查看入口：日志仅“JSON 到 stdout”，部署实体无日志存储，§14.4 用户可见项无日志与指标；preview/prod 部署、构建 Job、迁移 Job 无任何日志入口，线上无法排障 | Proposal §3；Design §2.1、§14.4；E20 | 5 | a) 日志聚合并加工作台日志页；b) 只读日志拉取 API 供 CLI；c) 对接公司日志平台并写入约定 |
| B10 | 规模与 HA 不可验证：“数百”未落为负载参数，AT-41 无判定依据；多节点测试集群无供给任务；M5 进入条件无环境项；HA 到 M6 才首次验证 | R38；Design §13.3；Plan §1.2、§2、T5.7、T6.10、AT-41 | 4、7 | a) M0 增“目标档位负载模型”与“测试集群供给”任务并写入 M5/M6 进入条件；b) 控制面副本故障验证前移到 M2/M3；c) T5.7 移 M6 |
| B11 | 接入容器无交付主体：无任务交付任何 APIProxy 或模拟上游；EventProducer kind 的 ingress 验签、produces 登记、投递身份无任务无 AT；最小样例未声明事件处理路径，G4、AT-09、§10.3 步骤 4 与 9 无验收主体；R44 本身无任务 | Plan G4、AT-04/06/09/42、T1.3、T5.2、§2 依赖 | 7、1 | a) 新增参考 APIProxy 任务与接入容器 kind 登记控制器任务，样例加事件处理路径；b) 内置 GitLab EventProducer 改走项目流程并兼作验收样本；c) 首版限内置并收窄 R44 |

## 2. 重要级发现

### 2.1 身份与安全

| 编号 | 发现 | 位置 | 来源 | 处理方向 |
|---|---|---|---|---|
| I1 | 模型凭据以平台 Secret 文件注入每个任务容器，可被 Agent 读取外带，与“不访问平台凭据”矛盾，且无用量预算 | Design §10.8、§11.3、§13.1 | 3 | a) 模型访问经平台代理按工作负载身份限流；b) 按会话签发短期令牌；c) 接受并标注残余风险 |
| I2 | 任务容器凭据面未定义：业务任务容器的身份、可调平台与内部 API 子集、MCP 凭据；同 UID 下 TaskRunner 的契约校验与凭据可被 Agent 篡改读取，符号链接可绕路径边界；AT-21 无断言 | Design §1.3、§4.3、§5.6、§7.3、§13.1 | 3 | a) TaskRunner 独立 UID 加 realpath；b) 任务级短期身份并裁剪放行表；c) 列服务身份端点白名单并补 AT-21 断言 |
| I3 | 接入容器 preview 环境及共用其身份的开发会话可取真实上游凭据；凭据按连接而非调用方下发，上游只见单一主体；preview EventProducer 事件是否投给 prod 订阅者未写 | Design §8.1、§8.3、§8.5 | 3、5 | a) 连接只绑 prod，每 APIGrant 独立凭据；b) 传调用方标识，投递按生产者环境隔离；c) 接入容器不开开发会话 |
| I4 | production-change 数据绑定进入会话容器后全部 Agent 可见，与“Agent 不获得生产迁移身份”冲突；三模式的执行点（库账号、网络策略、工具）未写 | Design §5.4、§9.6、§9.8 | 3 | a) 该模式不注入容器，只经独立 Job；b) 写明执行点；c) prod 库独享实例 |
| I5 | Cookie 与 CSRF：apps 与 preview 同注册域，业务应用可设父域 Cookie 篡改网关会话；iframe 预览需 SameSite=None；业务不写登录，CSRF 无平台控制点 | Design §5.7、§7.1、§11.3 | 3 | a) 会话 Cookie 按 Host，应用域与控制台分注册域；b) 网关校验 Sec-Fetch-Site；c) 接入约定写明 CSRF 归业务并给样例 |
| I6 | 命名空间模型未定，网络策略、配额、Secret 范围无法落地；任务 Pod 的 SA token automount、空 RBAC、apiserver 出站阻断未写 | Design §4.1、§4.3、§13.1；E09 | 3 | a) 每项目命名空间；b) 禁 automount，仅投影自定义 audience；c) 写入 §13.1 |
| I7 | 会话级 Git 凭据范围、期限、署名未定义；出站白名单缺 GitLab、JWKS、cs-session、MCP；域名白名单在 L3/4 NetworkPolicy 不可执行；出站白名单无管理入口与被阻提示 | Design §5.1、§13.1；E11、E19 | 3、5 | a) 单 Project 短期 token，推送署名开发者；b) 补全清单并选 FQDN egress 代理；c) 管理员维护源清单并按项目开放 |

### 2.2 领域模型与接口

| 编号 | 发现 | 位置 | 来源 | 处理方向 |
|---|---|---|---|---|
| I8 | DevSession 与 TaskEnvironment(intent) 重复建模：两表都持 container_ref 与 volume_ref，trace_id 与 quota_slot 仅在后者，而 §10.4 配额与 §14.1 追溯都含开发会话 | Design §0.1、§1.2、§4.2、§10.4、§14.1 | 2 | a) dev_sessions 外键指向 task_environments；b) 删 dev_sessions，改为 purpose=intent 行加分支字段 |
| I9 | 授权与订阅缺环境维度：api_grants 与 subscriptions 按 service_env，但 Manifest 与申请 API 不带环境；晋级后是否生效、preview 是否接收真实事件、接入容器有无 preview/prod、放行表指向哪个实例、task_environments 无 service_env | Design §4.1、§4.2、§6.7、§8.3 | 2、5、3 | a) 申请默认覆盖双环境，管理员可分环境；b) 仅 prod 生效；c) Release 固化每环境授权与订阅快照 |
| I10 | 接口目录键冲突：§8.1 键为方法加路径，Manifest apis.requested 用 issues.v1.getIssue；operation_key 全局唯一，两个 proxy 暴露同路径即冲突，放行表无法路由 | Design §4.1、§4.2、§8.1、§8.3 | 2 | a) 键＝proxy 名加方法加路径并按前缀路由；b) 用 operationId 映射方法路径；c) 每 proxy 独立 Host |
| I11 | 分支选择时序：§4.3 建会话即指定分支，§5.2 先建会话再选分支；会话前无分支列表与落后提交数 API | Design §4.3、§5.2；Proposal §4.4 | 2、1 | a) 增 GET /v1/services/:id/branches；b) 会话两阶段；c) 并入 GET /v1/projects/:id |
| I12 | 管理与治理 API 缺失：建项目与首任负责人、成员、配额、审批（批准、拒绝、理由）、撤销 Grant、停用上游连接、项目暂停删除归档、审计查看、恢复；审批无队列界面与通知；团队如何建立、成员来自 IdP 组还是手加、Group 是否按团队分 Subgroup 未定 | Design §4.3、§7.3、§1.2 | 2、1、5 | a) 补 API 与角色行、管理控制台任务；b) 声明为控制台内部接口；c) 首版收窄为管理员代办 |
| I13 | 业务任务如何取得产品仓库与 Git 凭据无机制：TaskWorkspaceBinding 删除后无替代；场景 C 的定位缺陷与提 MR 无法落地 | Design §1.2、§5.3、§4.3；Proposal 场景 C | 1 | a) 新增 TaskRepositoryBinding 并注入短期 token；b) 业务经命令子任务自行 clone，凭据经凭据服务下发；c) 场景 C 标后置 |
| I14 | 数字人互调细节：目标环境、调用方头名、被调方 NetworkPolicy 未定；T4.9 无 AT，G4 未提 | Design §8.2、§8.3；Plan T4.9 | 1 | a) exposes 目标定为 prod 并定头名；b) 限同项目 preview 互调；c) 增 AT |
| I15 | 业务子任务 AwaitingInput 无输入端点（与 B5 合并处理） | Design §4.3、§10.3 | 2 | 随 B5 裁定 |

### 2.3 执行、连接与复制改造

| 编号 | 发现 | 位置 | 来源 | 处理方向 |
|---|---|---|---|---|
| I16 | TaskRunner 连接方向三处不一致：§2.1 与 §5.6 为接受连接，§3.1 与 E11 为出向，§5.8 为 cs-session 重连 TaskRunner；cs-controller 下发发布检查与 exec 的通道未定；缺副本归属租约与过期、重连退避抖动、心跳与失联时限、events(cursor) 缓冲位置与上限 | Design §2.1、§5.6、§5.8、§3.1、§10.7；E11；Q17 | 2、4 | a) 统一出向并规定 controller 经 cs-session 转发；b) 补租约、退避、缓冲参数；c) T6.10 明确数百连接同时迁移 |
| I17 | 恢复会话无并发保护：单写者保护在 runner 与 persistence port 而非驱动；多 Agent 并行且显式 resumeSessionId 时两进程可同时恢复同一会话 | Design §10.3、§10.4；Q03；agent-workflow runner.ts:951-1080 | 6 | a) TaskRunner 内做会话租约；b) cs-session 按 agentSessionId 串行；c) 记录风险 |
| I18 | 凭据与会话目录依赖 HOME 与 XDG：两 CLI 不注入凭据而靠 env 透传，Claude 转写在 $HOME/.claude/projects，opencode 会话在 $XDG_DATA_HOME，每次运行覆盖 OPENCODE_CONFIG_DIR；§10.8“配置目录注入引用”与事实不符；persistent 模式 Pod 重建后 --resume 必失败 | Design §9.4、§10.6、§10.8 | 6 | a) Secret 到 env 作凭据通道，HOME 与 XDG 落持久卷；b) 显式设 CLAUDE_CONFIG_DIR 与 XDG_DATA_HOME 指向卷；c) 声明恢复后不支持 resume |
| I19 | 远程 MCP 注入形状已存在（opencode remote、claude --mcp-config http），E19 待验证项可直接回答；但 headers 凭据落 per-run 文件，无 agent.permission 时 claude 走 bypassPermissions | E19；Design §5.9；agent-workflow execution/agentInjection.ts:135-165 | 6 | a) 写明注入形状、凭据轮换与清理；b) 定义 agentProfile 到 permission 的映射；c) 明示默认 bypassPermissions |
| I20 | TaskRunner 需新写且无参照：PTY、出向 WebSocket 客户端、预览守护、契约校验；文件接口只有 list 与 read；managedProcess 用 detached 使孤儿进程重挂 PID 1，TaskRunner 作容器主进程须收割僵尸 | Design §5.6；E10、E11 | 6 | a) 镜像用 tini；b) TaskRunner 处理 SIGCHLD |
| I21 | code-host 复制边界：动作仅 comment、mr、pipeline、read、custom；call 与 connections 依赖 secretBox、RepositoryTransport、taskExecutionParticipants；webhookDispatch 与 deliveryStore 绑定任务模型不可复用；事件枚举需映射 | E13、E17；Design §5.1、§8.5 | 6 | a) 只复制 url、call 纪律与 gitlabAdapter，新写 Projects、Tags、ProtectedTags 与投递；b) 先用 custom 动作跑 T0.9 |
| I22 | TaskRunner 协议无版本协商与兼容窗口；两个 MCP 的副本数与会话亲和未定 | Design §2.1、§11.4、§12.4；E19 | 4 | a) 协议加版本字段与 N-1 承诺；b) 规定 MCP 多副本形态 |

### 2.4 规模与可靠性

| 编号 | 发现 | 位置 | 来源 | 处理方向 |
|---|---|---|---|---|
| I23 | PostgreSQL 共库容量：元数据、表队列、租约、inbox、outbox、deliveries、execution_events、连接归属共用一库；租约 TTL 与故障切换时长关系、队列表膨胀清理、连接池、轮询节流未定；T5.7 缺锁竞争维度 | Design §3.1、§4.2、§10.7；E04、E05、E17 | 4 | a) §10.7 写明租约参数与切换时序；b) 分区与保留任务；c) T5.7 加队列维度 |
| I24 | 配额：超额“拒绝”与“排队或拒绝由业务选择”三处不一致；多副本准入无原子化；Failed、Suspended、Pending 是否占槽未定；无配额查看、申请、调整 API；任务时长与模型用量不可见；默认 3 含开发会话易饱和 | R43；Design §10.2、§10.4；AT-19、AT-39；Plan §13 | 2、4、5、7 | a) 统一为拒绝并同事务行锁准入；b) 增 Queued 态与参数；c) 配额申请流与用量视图 |
| I25 | 集群与租户级总量限制、请求限流缺失；Q15 空闲释放未定使长驻 Pod 累积并永久占一项目一会话；Pod Pending、PVC 供给失败、镜像拉取超时的时限与状态未定；无镜像预拉 | Design §10.4、§10.8、§13.3；Q15；E09 | 4、7 | a) 集群与租户上限，Pending 超时转 Failed；b) 网关按工作负载身份限流；c) Q15 提为首版必需 |
| I26 | 节点维护：开发会话不可重建，drain、升级、宕机即会话丢失，无 PDB、驱逐策略与提醒；Pod 被外部删除时 follow-container 卷回收责任未定；persistent 卷拓扑未提 | Design §9.4、§9.7、§10.6、§12.2 | 4 | a) 节点维护流程；b) generic ephemeral volume 或 controller 回收孤儿卷；c) T5.8 加节点失联用例 |
| I27 | 事件推送缺退避抖动、按订阅并发上限与熔断、推送超时、重放节流；EventProducer 在 cs-events 或库不可用时行为未定 | Design §8.5、§3.2；T4.6 | 4 | a) 写明参数；b) EventProducer 契约加背压与确认语义；c) AT-09 加订阅方不可用用例 |
| I28 | Kubernetes 对象数量模型：每任务逐会话 HTTPRoute 高频变更、NetworkPolicy 控制器压力、命名空间策略未描述 | Design §2.2、§5.2、§6.6、§13.1 | 4 | a) 对象数量模型；b) 预览用通配 Host 加网关内映射；c) T5.7 加路由变更速率 |
| I29 | 构建无全局并发上限、资源规格、超时与缓存策略 | Design §6.4、§6.7；E14 | 4 | a) 并发配置入表队列；b) T5.7 加并发构建 |

### 2.5 运营与体验

| 编号 | 发现 | 位置 | 来源 | 处理方向 |
|---|---|---|---|---|
| I30 | 运行中服务无健康态与告警：崩溃循环、健康检查持续失败、死信、任务 Failed、配额耗尽均无通知 | Design §5.5、§6.5、§14.4 | 5 | a) 部署健康状态与项目级告警订阅；b) 状态页加死信计数；c) 告警交公司监控 |
| I31 | 服务资源套餐、副本数与任务容器规格未定，谁可调副本未定 | Proposal §1.1；Design §4.1、§9.4、§13.3 | 5 | a) Manifest 加 service.plan 与 replicas；b) 固定单套餐单副本；c) 支持 HPA 声明 |
| I32 | 迁移声明字段缺失（兼容范围、破坏性、回退方式）；迁移半途失败后的状态、日志、修复路径未定义 | Design §9.6、§4.1、§6.8；Q07 | 5 | a) 加 release.migration 字段与 Failed 修复流程；b) 只允许向前兼容迁移 |
| I33 | 具名接入约定表缺失：身份头名、令牌头、JWKS 地址、网关地址、数据库环境变量名、EventDelivery 协议、服务令牌携带方式；T0.3 不含运行时约定；AT-43 弱；“开发说明”排 M6 | Proposal §3、R48；Design §7.1、§8.5、§9.2；Plan T0.3、AT-43 | 1、5 | a) Design 增“业务接入约定表”并纳入 T0.3 与契约测试；b) 以样例模板为事实来源；c) 以能力说明 MCP 的 resource Schema 为唯一来源 |
| I34 | preview 环境语义：访问者与测试者角色、与开发会话是否共用一库、并发迁移冲突、副作用关闭的环境标识约定、是否接收订阅事件、种子数据 | Design §5.2、§5.4、§9.8、§6.5 | 5、3 | a) 环境变量约定，preview 默认不订阅，加观察者角色；b) preview 仅成员且与开发会话分库；c) Manifest 加 seed 命令 |
| I35 | 内置 GitLab EventProducer 由安装器直接部署，无项目、仓库与 Release，与不变量 18“接入容器走项目流程”及 T6.5 不一致；APIProxy 单一 upstream 无分环境；上游凭据录入方式与轮换、自研 EventProducer 验签密钥来源未定 | Design §11.2、§11.4、§1.1；Plan T6.5 | 1、5、7 | a) 安装器为其建系统项目与 Release；b) 列为平台组件并在不变量 18 加例外；c) 安装器只导入镜像，管理员从模板一键创建 |

### 2.6 计划与验收

| 编号 | 发现 | 位置 | 来源 | 处理方向 |
|---|---|---|---|---|
| I36 | M1 样例部署依赖 M2：G1 要求样例到 preview，T1.10 以首个标签部署，但标签构建与 Release 在 M2 | Plan §2、T1.10、G1；Design §5.1 | 1 | a) M1 用预构建样例镜像；b) T2.5、T2.6 最小路径前移；c) G1 改为仓库与地址就绪 |
| I37 | 追溯不可验证：无 traceId 回放 AT；execution_events 缺 §14.2 要求的 OTel trace_id 字段；traceId 生成点未定；事件是否携带 traceId 未定；R24 矩阵错挂 AT-27；无证据目录 | Design §4.2、§14；Plan §11、§12 | 2、1、7 | a) 新增 AT-44 并改矩阵；b) §14.1 明确生成点与字段；c) §12 加 trace 目录 |
| I38 | CLI 与操作 MCP 无 AT：Agent 经 MCP 发布与调 API、会话授权校验、释放后拒绝均无验收；E19 无 M0 任务 | R03；Plan AT-02、AT-43、T3.6、G3；E19 | 7、1 | a) 新增 MCP 发布与越权 AT；b) T0.4 增 MCP 连接鉴权原型；c) CLI 延后并修 R03 |
| I39 | M0 未原型化控制面运行时：Bun 长驻稳定性、PG 驱动、Hono WebSocket、OTel 兼容归 T0.2、T0.4 但两任务未提及；E01 回退 Node 的触发无载体；G0 未断言契约冻结 | tech-evaluation §4；Plan T0.2、T0.4、T0.5、T0.6、G0 | 7 | a) 新增 T0.11 控制面运行时原型入 G0；b) 扩写四任务完成条件 |
| I40 | 门槛与任务错位：G1 断言晋级权限但晋级在 M2；G2 断言撤权但撤权在 M4；T3.5、T3.6 与 T4.5 重复承载 Swagger 调试与调 API 工具，M3 与 M4 双向依赖未声明；G3 桩驱动无任务 | Plan G1、G2、G3、T4.5、§2 | 7 | a) G1 改授权表测试，G2 限已存在对象；b) 删 T4.5 并入 T3.5、T3.6；c) T3.3 增桩驱动 |
| I41 | Q07、Q08、Q09、Q14、Q15 无关闭任务；模板语言决策无任务而 T0.3 冻结 build profile 依赖它 | Design §15.3；Plan §3 | 7 | a) 各任务完成条件写明关闭对应 Q，T0.1 加模板语言决策；b) 新增空闲提醒与释放任务 |

## 3. 建议级发现

| 编号 | 发现 | 来源 | 处理方向 |
|---|---|---|---|
| S1 | 编号与引用小错：Plan 写 D01–D37 而 Design 有 D38；Plan 依据仍写 v0.3.0；Proposal R12 写由 R44、R47 替代而 §0.2 写 R44–R46；Plan 依赖 T4.6→T5.2 指向错；“所有任务初始未执行”与 T0.10 已结项矛盾，R38 挂已结项 T0.10；Plan §10.2 步骤以“分析、编码、审核 Agent”命名；SandboxLease 有名无定义；APIProxy Manifest 的 openPolicy 由项目包设定与不变量 9 有张力 | 2、7 | 逐条修正 |
| S2 | TaskVolume、Build、rollback 无表；Release 缺 Superseded 态；首个 v 标签无来源会话 | 2 | 补表与状态，或注明内嵌 |
| S3 | AT 措辞不可断言：AT-02、08、13、15、17、21、24 含模糊词；AT-17 五项合一；仅两条脚本规范 | 7 | 逐条改为可枚举用例；补安全类与 M6 类脚本 |
| S4 | 风险到任务缺口：手工标签界面标注无任务；资源语义标注未进 T4.2；§9 时长指标无任务与目录 | 7 | 补任务与 metrics 目录 |
| S5 | 证据目录缺 capabilities、quota、trace 与对应状态行 | 7 | 补目录与状态行 |
| S6 | §13 延后项缺更多模板与语言、Kafka、Longhorn、缩容到零；“与 v0.2.0 相同的触发条件”悬空引用 | 7 | 补行并写触发条件 |
| S7 | tech-evaluation 的代码统计与 HEAD 漂移且未记源 commit；113 个相关测试与 system-mocks 是否随复制未说明 | 6 | T0.2 登记源 commit 与复制清单 |
| S8 | 一团队多数字人即多项目、多成员表、多配额；同团队互调需管理员审批 | 5 | 团队内互调负责人自批，或团队级成员继承 |

## 4. 需要作者裁定的事项

以下不是编辑性修正，改哪一个方向都会改变设计意图，须由作者选择：

1. 服务身份呈现方式（B1）。
2. 放行决策位置：网关本地放行表还是每请求 ForwardAuth（B2）。
3. 非用户流量的入向路径与来源鉴别（B3）。
4. 契约层载体：Manifest 段、请求内联还是平台目录（B4）。
5. Agent 交互模型：一次性进程加 resume，还是 CLI 流式输入（B5）。
6. Claude Code 自带沙箱在 Pod 内开还是关（B6）。
7. 复制单元重新划定为 drivers 加 agentInjection 加 agentProcess/managedProcess（B7）。
8. 配置与 Secret 管理做还是首版声明不支持（B8）。
9. 日志与指标入口的形态（B9）。
10. 规模与 HA 验证环境的供给与时点（B10）。
11. 接入容器的交付主体与内置 EventProducer 的部署方式（B11、I35）。
12. 配额超额语义：拒绝还是可排队（I24）。
13. 模型凭据进入任务容器的方式（I1）。
14. production-change 是否进入会话容器（I4）。
15. preview 环境的访问者、数据与事件语义（I34）。
16. 团队与项目的建立方式与首任负责人（I12）。
17. 授权与订阅的环境维度（I9）。

## 5. 处置建议

- 第一批（v0.3.2，Design §7、§8、§10、§5、§3；T0.3、T0.4、T0.5）：裁定 1 到 7 并写入，消除三篇之间的矛盾，重划复制单元。
- 第二批（v0.3.3，Proposal §3、Design 新增章节、Plan 新任务与 AT）：配置与 Secret、日志与健康、接入约定表、接入容器交付主体、规模验证环境、配额语义。
- 第三批（编辑性）：S1 到 S8 与各重要级中不需裁定的补写。

## 6. 处置决策（2026-09-11，作者裁定 G1–G25，已写入 v0.3.2）

| 编号 | 事项 | 裁定 |
|---|---|---|
| G1 | 服务身份呈现（B1） | 网关按源 Pod IP 反查工作负载身份，业务代码不携带凭据 |
| G2 | 放行决策位置（B2） | 用户鉴权走 ForwardAuth 到 cs-auth；服务放行表由网关本地执行 |
| G3 | 非用户流量入向（B3） | 全部经网关，按 Host 分用户域与服务域；服务域注入平台签名来源令牌；用户令牌绑定目标服务 |
| G4 | 契约载体（B4） | agentProfile 与 outputContract 在 Manifest `tasks` 段声明，随发布登记 |
| G5 | Agent 交互模型（B5） | 开发会话走流式交互；业务子任务提供 oneshot 与 interactive 两种模式 |
| G6 | Claude 自带沙箱（B6） | 在任务容器内关闭，走不传 taskMounts 的路径 |
| G7 | 复制单元（B7） | 驱动、agentInjection、agentProcess/managedProcess、shared 子集；编排新写；T0.4 出逐文件依赖清单并登记源 commit |
| G8 | 配置与 Secret（B8） | 平台对象加 Manifest env 段，分开发与生产两组，负责人维护生产组 |
| G9 | 日志与指标（B9） | 平台日志聚合加工作台日志页 |
| G10 | 规模与 HA 验证（B10） | 维持 M6 一次验证，接受风险；负载参数在 T5.7 定义 |
| G11 | 接入容器交付（B11、I35） | 内置 GitLab EventProducer 走项目流程作验收样本；新增参考 APIProxy；最小样例加事件订阅 |
| G12 | 配额超额（I24） | 统一为拒绝，准入原子 |
| G13 | 模型凭据（I1） | 进容器，接受并标注残余风险 |
| G14 | production-change（I4） | 进容器，接受风险 |
| G15 | preview 与 prod（I34） | 蓝绿两个部署槽，共用生产数据；晋级即切流；五条推论全部成立 |
| G16 | 团队与项目（I12） | 管理员代建项目并指定负责人 |
| G17 | 接口目录键（I10） | proxy 名加方法加路径，按 proxy 前缀路由 |
| G18 | 命名空间（I6） | 每项目一个命名空间 |
| G19 | 空闲会话（Q15） | 只提醒不自动释放，负责人可强制释放 |
| G20 | M1 样例部署（I36） | 标签构建与 Release 最小路径前移到 M1 |
| G21 | CLI（I38） | 首版含 CLI，补任务与 AT |
| G22 | 健康与告警（I30） | 部署健康态加项目级告警订阅，渠道待定 |
| G23 | 出站白名单（I7） | 管理员维护全局清单，可按项目开放，工作台显示被阻请求 |
| G24 | 套餐与副本（I31） | Manifest 声明套餐与副本，套餐由管理员定义 |
| G25 | TaskRunner 隔离（I2） | 独立 UID，文件接口 realpath 校验 |

另：preview 域访问者为项目成员加负责人指定的测试者（随 G15 裁定）。编辑性发现（S1–S8 及各重要级中不需裁定者）在 v0.3.2 中一并修正或落为任务与待决项。

## 附录：各视角原始报告


---

# 视角 1 端到端闭环追踪（原始报告）

F01｜阻断｜矛盾｜design §7.2、§2.4；tech-eval E08；proposal §3 行“调用内部 API”
§7.2 称网关“依据 Pod 的 SA 令牌”识别且“业务代码不携带”，E08 却要 token 随请求携带、头约定待验证；无 sidecar 时网关拿不到 Pod 令牌。调内部 API、以服务身份建任务、场景 F 对话框三步都依赖此机制。方向：①约定请求头名与 projected token 挂载路径，样例示范；②cs-auth 按源 Pod IP 反查 SA，业务零改动；③立为待决 Q 并阻塞 G0。

F02｜重要｜缺失｜design §4、§7.1、§8.3、§9.2；plan T0.3、AT-43
proposal §3 承诺的约定（身份头名、令牌头与 JWKS 地址、内部 API 与平台 API 网关地址、数据连接环境变量名）design 只写“约定”未给名；T0.3 冻结范围不含运行时约定，AT-43 只查“反映现状”。方向：①design 增“业务接入约定表”，纳入 T0.3 与契约测试；②以样例模板为事实来源，AT-43 断言一致；③以能力说明 MCP resource Schema 为唯一来源。

F03｜重要｜矛盾｜design §2.4、§7.1、§8.5、§13.1、EventProducer.ingress；plan AT-09、§10.3 步骤 9
入向：§7.1 未登录一律跳转，ingress.path 需免用户鉴权路由却无定义；出向：cs-events 直推 handlerPath，与 §13.1“业务服务只接受网关流量”矛盾；EventDelivery 载荷、事件 ID、traceId、签名、确认语义未定义；样例模板无订阅，步骤 9 无接收方。方向：①放行表增“Webhook 免鉴权入口”与“平台身份推送”路由，NetworkPolicy 放行 cs-events；②推送经网关以平台身份进入；③定义 EventDelivery 头与 2xx 确认入 T0.3，样例加一条订阅。

F04｜重要｜缺失｜design §8.4、§5.9、§2.1；plan T4.5、AT-06
Swagger 调试页与操作 MCP 均“以 preview 身份经网关试调”，但浏览器与 MCP 都不在 preview Pod 内，按工作负载身份键控的放行表无法匹配。方向：①统一经开发容器 TaskRunner 转发（容器持 preview SA）；②cs-auth 为活动会话签发短期 preview 令牌；③网关对“项目成员＋active 会话”映射 preview 放行表；AT-06 加断言。

F05｜重要｜缺失｜design §10.3、§4.4、§4.1；plan T0.3、T5.1、AT-26
agentProfile、outputContract 仅是引用名：Manifest 无字段、API 无登记、TaskRunner Verifying 校验依据不明。方向：①Manifest 增 tasks.agentProfiles/outputContracts 随发布登记；②子任务请求内联完整定义，平台存 digest；③新增登记 API；均入 T0.3。

F06｜重要｜矛盾｜plan §2 依赖链、T1.10、G1、AT-01；design §5.1 步骤 5
G1 要求样例部署到 preview、T1.10“以首个 v 标签部署”，但标签构建与 Release→preview 是 M2 的 T2.5/T2.6。方向：①M1 用预构建样例镜像，首标签构建移 M2 并在 AT-01 注明；②T2.5/T2.6 最小路径前移 M1；③G1 改为“仓库与地址就绪、preview 待 M2”并同步 §5.1。

F07｜重要｜不可验证｜plan §10 AT 表、§11 R24 行、G5、§10.3 步骤 6；design §14.2
“traceId 可追溯”与“Agent 调工具打标签”无 AT 条目；事件投递是否携带 traceId 并延续到任务无定义。方向：①新增两条 AT（traceId 回放；Agent 经操作 MCP 发布走完 T2.8）；②扩 AT-27、AT-03；③§14.2 明确事件 traceId 延续规则。

F08｜建议｜缺失｜design §4.3、§5.2 步骤 2、Q12；plan T3.10、T4.7
API 概览缺：建会话前的分支列表与落后计算；负责人审批 TaskDataBinding；管理员撤销 Grant/停用上游连接。方向：①补三个端点；②分支信息并入 GET /v1/projects/:id，审批走通用 approvals；③标注为 Q12 关闭前占位。

F09｜建议｜缺失｜design §1.2 旧对象调整、§5.3、§4.3；proposal 场景 C
业务任务容器如何取得产品仓库与 Git 凭据无机制：TaskWorkspaceBinding 删除未替代。方向：①新增 TaskRepositoryBinding，平台注入短期 token；②业务经命令子任务自行 clone，凭据经凭据服务下发；③首版限定任务目录输入，场景 C 标后置。

F10｜建议｜缺失｜proposal §3“配置与 Secret 引用”；design §4.1、§12.5、Release
Manifest 无 config/secret 引用段，Release“配置版本”无来源。方向：①Manifest 增 config/secretRefs；②环境级配置经平台 API 由负责人维护；③首版声明不支持并改述 §3。

F11｜建议｜不可验证｜design §8.2、§8.3、exposes；plan T4.9、G4
数字人互调：目标环境、“附加平台标识”的调用方头名、被调方 NetworkPolicy 未定；T4.9 无 AT，G4 未提。方向：①定 exposes 目标为 prod 与调用方头名；②限同项目 preview 互调；③增 AT。

F12｜建议｜矛盾｜design §11.2、§11.4 步骤 5 vs 不变量 18、§2.2；plan T6.5
内置 GitLab EventProducer 由安装器镜像部署，无项目、仓库与 Release，与“接入容器走项目流程标签发布”及 T6.5 不一致。方向：①安装器为其建“系统项目”与 Release 记录；②列为平台组件随 Helm 升级，不变量 18 加例外；③安装器只导入镜像，管理员从模板一键创建。

结论：团队线与管理员线可闭合；业务侧线卡在“服务如何向网关呈现工作负载身份”（F01），调内部 API、建任务、样例对话框三步同时受阻，尚不能达成。最短补齐：定下身份携带方式和一张接入约定表并纳入 T0.3；补 traceId 与 Agent 发布两条 AT。

---

# 视角 2 架构一致性与领域模型完整性（原始报告）

F01｜阻断｜缺失元素｜Design §1.3、§4.4、§10.3、§4.2
agentProfile（驱动、模型、工具）与 outputContract（Verifying 校验依据）在对象表、持久化表、Manifest、API 中均无定义与登记途径；TaskRunner 无法校验未定义契约，G5/AT-26 不可执行。方向：Manifest 增 agentProfiles/contracts 段并落表；提交子任务时内联 Schema；平台级目录 API。

F02｜重要｜矛盾｜Design §0.1、§1.2、§4.2、§10.4、§14.1
§0.1 称 DevSession 已并入开发会话，§1.2 仍与 TaskEnvironment(intent) 并列；两表都持 container_ref/volume_ref，trace_id 与 quota_slot 仅在 task_environments，而 §10.4 配额、§14.1 追溯均含开发会话。方向：dev_sessions 外键指向 task_environments；删 dev_sessions 改为 purpose=intent 行加分支字段；明确开发会话不入追溯链并改 §14.1。

F03｜重要｜矛盾｜Design §2.1、§5.6 vs §3.1(E11)、§6.2
§2.1/§5.6 写 TaskRunner“暴露接口、只接受连接”，§3.1 写“出向 WebSocket 连接 cs-session”；出向模型下 cs-api/cs-controller 向 TaskRunner 下发发布检查（§6.2）与 exec 的通道未指明。方向：统一出向并规定经 cs-session 转发；cs-controller 也接受出向连接；并入 Q17 原型后定。

F04｜重要｜缺失元素｜Design §4.1、§4.2、§6.7、§8.3
api_grants/subscriptions 按 service_env，但 Manifest apis.requested/subscriptions 与申请 API 不带环境；晋级 prod 后授权与订阅是否生效、preview 是否接收真实事件、接入容器自身有无 preview/prod 及放行表指向哪个实例均未定；task_environments 无 service_env。方向：申请默认覆盖双环境、管理员可分环境；仅 prod 生效；Release 固化每环境授权与订阅快照。

F05｜重要｜矛盾｜Design §2.4、§3.2、§7.1、§13.1
§13.1 要求服务只接受网关流量，§7.1 网关对未登录一律跳转登录，§2.4 Webhook 路径却不经网关；EventProducer ingress 字段无对应 GatewayPolicy 规则，服务间调用同样需免登录路径。方向：GatewayPolicy 增匿名/服务身份路由类别；EventProducer 独立 Ingress 并写入 §13.1 例外；按 Host 分用户域与服务域。

F06｜重要｜矛盾｜Design §4.1、§4.2、§8.1、§8.3
§8.1 目录键为方法加路径，Manifest apis.requested 却用 issues.v1.getIssue；operation_key 全局唯一，两个 proxy 暴露同路径即冲突，放行表“方法加路径→目标 proxy”无法路由。方向：键=proxy 名+方法+路径并按前缀路由；改用 operationId 映射方法路径；每 proxy 独立 Host。

F07｜重要｜缺失元素｜Design §4.3、§10.3
业务子任务状态含 AwaitingInput，但消息 API 仅对开发会话 Agent；业务子任务无输入端点或回调约定，该状态不可退出。方向：增 POST …/subtasks/:id/messages；业务子任务禁交互，AwaitingInput 转 Failed/TimedOut；经事件流通知业务处理路径。

F08｜重要｜不可验证｜Plan §11 R24、§10；Design §4.2、§14.2
矩阵 R24→AT-27 实为 R31 的文件读取；AT 目录无“traceId 索引全部 sessionId”断言，仅 §10.2 步骤 9；execution_events 缺 §14.2 要求记入的 OTel trace_id 字段；traceId 生成点（Requested 或 Admitted）未定。方向：新增 AT-44 并改矩阵；步骤 9 并入 AT-26；§14.1 明确生成点与字段。

F09｜重要｜缺失元素｜Design §4.3、§7.3、§5.5、§9.7
POST /v1/projects（谁建项目、首任负责人）与 restores 在角色表无归属；数据访问审批（AwaitingApproval）、成员管理、配额分配、项目暂停/删除/归档（T6.7、AT-35）无 API；api-requests 有 approve 无 reject。方向：补 API 与角色行；声明为控制台内部接口；首版收窄为管理员代办。

F10｜重要｜矛盾｜Design §4.3、§5.2；Proposal §4.4
§4.3 建会话即指定分支，§5.2 先记录会话再选分支算落后数，Proposal 要求选分支在拉容器前；落后提交数只能经 GET /v1/dev-sessions/:id 取得，会话前无 API 供下拉框。方向：增 GET /v1/services/:id/branches 返回部署 SHA 与落后数；会话两阶段，选分支后才 Provisioning；保留 §4.3 删 §5.2 步骤 2。

F11｜建议｜缺失元素｜Design §1.2、§4.2、§5.1、§5.5、§6.4
TaskVolume 无表；§6.4 关联图的 Build 无对象与表；rollbacks 无记录与状态；Release 缺被后续标签替换的 Superseded 态；§5.1 首个 v 标签无来源开发会话。方向：补表与状态；注明内嵌于 task_environments/releases/promotions；从对象表删 TaskVolume、Build。

F12｜建议｜矛盾｜Plan §0、T0.1、§2、§11；Proposal §0.2、R12
Plan 写 D01–D37，Design 已有 D38；Proposal §0.2 与 Plan 称 R10–R13 由 R44–R46 替代，R12 行却写 R44、R47；依赖 T4.6→T5.2 指向样例对话框而非事件任务。方向：改 D01–D38、R44–R47；依赖改 T5.3 或删；Design §0.1 补 v0.3.1 编号变更。

F13｜建议｜风险｜Plan §10.2；Design §1.2、§4.1
Plan §10.2 步骤 2/4/5 以“分析／编码／审核 Agent 子任务”命名，与 D30 相悖；§1.2 保留 SandboxLease 名称但无定义与表；APIProxy Manifest openPolicy.default 由项目包设定策略，与不变量 9 有张力。方向：脚本改用 agentProfile 名；删名称或补定义；openPolicy 声明为管理员建议值并写入 §4.1 约束。

F14｜建议｜矛盾｜Proposal R43、§3；Design §10.2、§10.4；Plan AT-19
R43“超额被拒”，§10.4“排队或拒绝由业务选择”，AT-19 二者皆可；§10.2 无排队态。方向：统一为拒绝；增 Queued 态与请求参数；排队后置到 Plan §13。

结论：骨架可达；但 §16 所需“经契约层并发提交子任务并由 traceId 追溯”当前不可实现亦不可验证；最短缺口是 F01 契约与 agentProfile 的定义载体、F02 开发会话与 TaskEnvironment 统一、F04 授权与订阅的环境维度、F05 Webhook 入口例外、F08 追溯 AT。

---

# 视角 3 安全、身份与多租户（原始报告）

F01｜阻断｜矛盾｜Proposal §3、§4.7；Design §7.2、§8.4；TE E08
“服务身份自动携带、业务代码不携带”与“无 SDK、无 sidecar、E08 待验证请求头约定”不能同时成立：SA token 是 Pod 内文件，须有进程置入请求。操作 MCP、Swagger 试调以 preview 身份调用，用户会话换取服务身份的路径未定义。方向：a) 约定业务代码读 token 置指定头并改 §7.2；b) 出口 sidecar 自动附头；c) cs-auth 增代会话换取 preview 身份接口。

F02｜阻断｜矛盾｜Design §2.4、§7.1、§8.3、§8.5、Q16
业务服务“只接受网关流量”，但 cs-events 推送不经网关；服务间调用“附加平台标识”头名与签名未定，跨服务转发的用户令牌无 aud 绑定；处理路径暴露在用户入口，登录用户可伪造事件；EventProducer 入口需免登录例外，规则未写。方向：a) 非用户流量经网关并注入签名来源令牌，用户令牌 aud＝目标服务；b) 直连但定 HMAC 头与 NetworkPolicy 例外；c) 处理路径限前缀，网关拒用户流量。

F03｜重要｜矛盾｜Design §10.8、§11.3、§13.1
平台级模型 Secret 以文件注入每个任务容器，可被读取外带，与“不访问平台凭据”矛盾，且无用量预算。方向：a) 模型访问经平台代理按工作负载身份限流；b) 按会话签发短期令牌；c) 接受并标注残余风险。

F04｜重要｜缺失｜Design §1.3、§4.3、§5.6、§7.3、§13.1；AT-21
业务任务容器出站含网关，但其身份、可调平台/内部 API、MCP 凭据均未定义；服务身份可调的平台 API 子集与任务归属校验未写；同容器同 UID 的 TaskRunner 契约校验与凭据可被 Agent 篡改读取，符号链接可绕路径边界；AT-21 无断言。方向：a) 任务容器无内部 API 身份，TaskRunner 独立 UID＋realpath；b) 任务级短期身份并裁剪放行表；c) 列服务身份端点白名单，AT-21 补断言。

F05｜重要｜缺失｜Design §8.1、§8.3、§8.5；Proposal §4.10、§7.3
接入容器 preview 环境（含共用其身份的开发会话）可取真实上游凭据；preview EventProducer 事件是否投给 prod 订阅者未写；凭据按连接而非调用方下发，上游只见单一主体，实为共享账号。方向：a) 连接只绑 prod，每 APIGrant 独立凭据；b) 传调用方标识，投递按生产者环境隔离；c) 接入容器不开开发会话，资源级明确归业务。

F06｜重要｜矛盾｜Design §5.4、§9.6、§9.8、§9.2
production-change 绑定进入会话容器后全部 Agent 可见，与“Agent 不获得生产迁移身份”冲突；三模式执行点未写，共享池下 dev 与 prod 同主机仅靠账号隔离。方向：a) 该模式不注入容器，仅经独立 Job；b) 写明执行点为库账号＋网络策略；c) prod 库独享实例。

F07｜重要｜风险｜Design §5.7、§7.1、§11.3；AT-22
apps 与 preview 同注册域，业务应用可设父域 Cookie 篡改网关会话；iframe 预览需 SameSite=None，业务不写登录，CSRF 无平台控制点。方向：a) 会话 Cookie 按 Host，应用域分开注册域；b) 网关对非安全方法校验 Sec-Fetch-Site；c) 接入约定写明 CSRF 归业务并给样例。

F08｜重要｜缺失｜Design §4.1、§4.3、§13.1；TE E09
命名空间模型未定，网络策略、配额、Secret 范围无法落地；任务 Pod 的 SA token 即凭据，automount、空 RBAC、API server 出站阻断未写；项目自有 Secret 无对象与环境分离。方向：a) 每项目命名空间并增 ProjectSecret；b) 禁 automount，仅投影自定义 audience；c) 首版声明不支持自定义 Secret。

F09｜重要｜缺失｜Design §5.1、§13.1；TE E11、E19
会话级 Git 凭据范围、期限、署名未定义；出站白名单缺 GitLab、JWKS、cs-session、MCP；域名白名单在 L3/4 网络策略不可执行。方向：a) 单 Project 短期 token，推送署名开发者；b) 补全清单并选 FQDN egress 代理；c) Git 经网关受控路径。

结论：主链可达成；但 F01、F02 使“服务身份自动携带”与“事件安全到达业务”无法落地，F03–F06 使“不接触平台凭据、preview 与 prod 隔离”不可验证。最短补法：写明服务身份携带与换取机制、非用户流量来源签名约定、任务容器凭据面三件，入 Design §7、§8、§13 与 T0.5。

---

# 视角 4 规模、可用性与可靠性（原始报告）

F01｜阻断｜矛盾/缺失｜Design §2.4、§8.3 对 §3.1、D02、E06；§7.1、§13.2；AT-10、AT-40
前者称放行表下发网关本地执行、不逐请求查询；后者称每请求 ForwardAuth 到 cs-auth 决策。按后者，cs-auth 处于页面、内部 API、平台 API、预览、事件推送的同步路径，其不可用或元数据库切换即全站拒绝（§13.2 失联即拒）；“取会话”的存储未定，若查库则每请求一次 DB。仅 AT-10 测 cs-api 重启。方向：a) 放行表由网关本地执行，ForwardAuth 仅无有效令牌时触发；b) 规定 cs-auth 本地缓存（会话、放行表、身份）与失联有界降级，AT-40 增加 cs-auth 整体不可用及 DB 切换期间网关行为；c) 启用 E06 备选。

F02｜阻断｜不可验证｜R38；Design §13.3；Plan §1.2、T5.7、T6.10、AT-41
“数百”未落为负载参数（服务数、任务容器数、事件与网关 QPS、长连接数），AT-41 无判定依据；T5.7、T6.10 依赖数百节点/多节点测试集群，无任务供给该环境；HA 与规模到 M6 才首次验证。方向：a) M0 增加“目标档位负载模型”与“测试集群供给”任务；b) 早期以 kind 多节点或虚拟节点验证控制面逻辑，真实集群只验存储网络；c) cs-session、controller 副本故障验证前移到 M3、M2。

F03｜重要｜矛盾/缺失｜Design §3.1、§5.8、§2.1、§2.3、§5.6、§10.7；E11；Q17；T6.10
§3.1/E11 为 TaskRunner 出向连接，§5.8 却写 cs-session“重新连接 TaskRunner”；cs-controller 直连 TaskRunner 在出向模型下路径未定。缺：副本归属租约与过期、重连退避抖动、心跳与失联时限、events(cursor) 缓冲位置与上限（在容器内则容器亡即丢）、副本间转发通道故障。T6.10 未规定连接规模。方向：a) 统一方向并写明 controller 经 cs-session 或 K8s 对象下达指令；b) 补归属租约、退避、缓冲上限参数；c) T6.10 明确数百连接同时迁移。

F04｜重要｜缺失/不可验证｜Design §3.1、§4.2、§10.7；E04、E05、E17；T5.7
元数据、表队列、租约、inbox/outbox/deliveries、execution_events、连接归属共用一库。缺：租约 TTL 与故障切换时长关系、队列表膨胀与保留清理任务、平台库连接池、轮询节流。E05 待验证“锁竞争”未进 T5.7 文本。方向：a) §10.7 写明租约参数与切换时序；b) 增加分区/保留任务与轮询策略；c) T5.7 加队列吞吐与锁竞争维度。

F05｜重要｜缺失｜Design §10.2、§10.4、§4.2；AT-19、AT-39
准入未规定多副本下的原子化（行锁或唯一槽位）；“排队”顺序与超时未定；Failed、Suspended、Pending 是否占槽未定；AT-39 无并发竞争用例。方向：a) 同事务行锁准入；b) 状态机各态标注配额归属；c) AT-39 增加同时 N 请求仅上限个通过。

F06｜重要｜缺失｜Design §10.4、§10.8、§13.3；Q15；E09
只有每数字人并发配额，无集群/租户总量准入与请求限流；Q15 空闲释放未定，长驻 Pod 无限累积；Pod Pending、PVC 供给失败、大镜像拉取超时的时限与状态未定义；无预拉。方向：a) 集群与租户级上限、Pending 超时转 Failed；b) 网关按工作负载身份限流；c) Q15 提为首版必需并加镜像预拉任务。

F07｜重要｜缺失｜Design §9.4、§9.7、§10.6、§12.2；T5.8、AT-11
开发会话不可重建，节点 drain、升级、宕机即会话丢失，无 PDB、驱逐策略与提醒；Pod 被外部删除时 follow-container 卷回收责任未定（PVC 泄漏）；persistent 恢复的卷拓扑（RWO 卷可用区）未提。T5.8 仅测容器被杀。方向：a) 节点维护流程（cordon、通知、等待释放）；b) generic ephemeral volume 或 controller 回收孤儿卷；c) T5.8/AT-11 增加节点失联用例。

F08｜重要｜缺失｜Design §8.5、§3.2；T4.6；AT-09
仅有重试、最大尝试、死信、重放；缺退避抖动、按订阅并发上限与熔断、推送超时、重放节流；EventProducer 在 cs-events 或 DB 不可用时行为未定。方向：a) 写明退避、并发、熔断参数；b) EventProducer 契约加背压与确认语义；c) AT-09 增加订阅方不可用后恢复不丢不炸。

F09｜重要｜缺失｜Design §2.2、§5.2、§6.6、§13.1；Q18；T5.7
每服务环境 Deployment+Service+HTTPRoute(+NetworkPolicy)，每任务 Pod+PVC+预览 HTTPRoute；数百服务与频繁开关会话导致路由高频变更；Traefik Gateway API 配置重建频率及对长连接影响、NetworkPolicy 控制器压力、命名空间策略未描述。方向：a) 对象数量模型与命名空间策略；b) 预览用通配 Host 加网关内映射，避免逐会话 HTTPRoute；c) T5.7 加路由变更速率。

F10｜重要｜缺失｜Design §7.2；E08；T0.5
“TokenReview 或集群 OIDC 发现”未决；TokenReview 每次调用请求 kube-apiserver，数百服务内部 API 调用会把 apiserver 拉入数据面；无缓存策略。方向：a) 本地 JWKS 验签加短缓存；b) TokenReview 加缓存与限流；c) T0.5 测该路径时延与 apiserver 负载。

F11｜建议｜缺失/不可验证｜Design §6.4、§6.7；E14；T2.5、T5.7
构建仅按服务顺序排队，无全局并发上限、资源规格、超时与缓存策略；发布高峰无压测维度。方向：a) 全局与租户构建并发配置入表队列；b) T5.7 加 N 并发构建；c) 增加缓存隔离设计任务。

F12｜建议｜缺失｜Design §2.1、§11.4、§12.4；E19；AT-17
persistent 任务可长期运行，cs-session 须同时兼容多版本 TaskRunner 协议，无版本协商与兼容窗口；两个 MCP 副本数与 Streamable HTTP 会话亲和未定，操作 MCP 在发布链上。方向：a) 协议加版本字段与 N-1 承诺；b) MCP 多副本形态；c) AT-17 加混合版本用例。

结论：功能闭环可达，但“数百服务并发＋控制面高可用”尚不能判定达成：放行决策位置未统一使 cs-auth 成为全数据面单点；目标档位与 HA 验证缺负载定义和测试环境；连接模型、租约参数、配额原子性与集群级容量控制缺失。最短补齐：统一 F01 路径并加缓存降级；写出负载模型与测试集群供给任务；补 §5.8/§10.7 的租约、退避、缓冲参数。

---

# 视角 5 业务接入与日常运营（原始报告）

F01｜阻断｜缺失｜Proposal §3“发布与环境”；Design §4.1、§12.5、§13.1
仅提“配置与 Secret 引用”“配置版本”“项目 Secret”，但无对象、表、API、界面、角色，也无注入约定（变量名、分环境）；Plan 无任务与 AT。方向：a. 增 Config/Secret 对象与 Manifest env 段，prod 值由负责人维护；b. 仅支持管理员代录的 K8s Secret 引用；c. 明示首版不支持并列入限制清单。

F02｜阻断｜缺失｜Proposal §3“观测与追溯”；Design §2.1、§14.4；E20
日志仅“JSON 到 stdout”，部署实体无日志存储，§14.4 用户可见项无日志与指标；preview/prod 部署与构建、迁移 Job 无任何日志入口。方向：a. 日志聚合并加工作台日志页；b. 只读日志拉取 API 供 CLI；c. 对接公司日志平台并写入约定。

F03｜重要｜缺失｜Design §5.5、§6.5、§14.4
状态表无“运行中服务”健康态；崩溃循环、健康检查持续失败、死信、任务 Failed、配额耗尽均无通知。方向：a. 部署健康状态与项目级告警订阅；b. 首版仅状态页加死信计数；c. 约定指标输出，告警交公司监控。

F04｜重要｜缺失｜Proposal §1.1“扩缩”；Design §4.1、§9.4、§13.3、§11.2 profiles
Manifest 无 resources/replicas，无服务算力套餐，未定谁可调副本、业务任务容器规格如何选。方向：a. Manifest 加 service.plan/replicas，管理员定套餐表；b. 固定单套餐单副本，扩容归管理员；c. 支持 HPA 声明。

F05｜重要｜缺失｜Design §9.6 vs §4.1；§6.8；Q07
§9.6 要求声明兼容范围、破坏性、回退方式，Manifest 只有 migrationCommand；迁移半途失败后的状态、日志、修复路径未定义。方向：a. 加 release.migration 字段与 Failed 修复流程；b. 只允许向前兼容迁移，破坏性走人工；c. 并入 Q07。

F06｜重要｜缺失｜Design §13.1“批准的依赖源”；§7.3；§11.3；T0.8、T2.5
出站白名单无管理入口、申请流与被阻提示；开发容器与构建 Job 的依赖源是否一致未写；Agent 联网查文档默认被阻。方向：a. 管理员维护源清单并可按项目开放，工作台显示被阻请求；b. 仅公司镜像源并明示；c. Manifest 申请项目白名单。

F07｜重要｜不可验证｜Proposal §3、R48；Design §7.1、§8.5、§9.2、§4.3 末段、§12.2；T0.3、T6.8
变量名、身份头名、EventDelivery 载荷与确认语义、服务携带工作负载令牌方式、任务 API 兼容承诺均未具名；“开发说明”排 M6，M4/M5 已需团队接入。方向：a. “接入约定手册”作 T0.3 产出并设 AT；b. 最小样例代码即规范并经能力 MCP 暴露；c. Design 附录逐项具名。

F08｜重要｜缺失｜Design §1.2 Tenant/Team、§4.3、§7.3、§5.1、§9.7；T6.7
团队如何建立、谁可 POST /v1/projects、首个负责人如何产生、成员来自 IdP 组还是手加、单 groupId 是否按团队分 Subgroup、项目删除/归档归谁，均无 API 与角色。方向：a. 定义 Team 与团队管理员角色；b. 任意认证用户可建项目并成负责人，管理员可收回；c. 管理员代建。

F09｜重要｜矛盾｜Design §5.2 步骤4、§5.4、§9.8、§6.5、§7.3；场景 A/D
preview 部署环境访问者未定且无测试者角色；开发会话与 preview 部署是否共用一库、并发迁移冲突未写；“关闭生产副作用”无机制（需环境标识约定）；preview 是否接收订阅事件未定；无种子数据。方向：a. 环境变量约定，preview 默认不订阅，加观察者角色；b. preview 仅成员且与开发会话分库；c. Manifest 加 seed 命令。

F10｜重要｜缺失｜Design §4.3 admin API、§7.3、§14.4；§5.7、E18；T4.2；Q12
审批仅有后端 API：无队列界面、无通知、拒绝无理由字段、审计表无查看 API。方向：a. Plan 增管理控制台任务；b. 首版 CLI 加 IM 通知；c. 并入 Q12。

F11｜重要｜矛盾｜Design §1.1#18、§2.1 vs §11.2、§11.4 步骤5、T6.2；§4.1 APIProxy、§8.1、§8.3；§4.3 upstream-connections
内置 EventProducer 由安装器直接部署与“接入容器走项目流程”矛盾；APIProxy 单一 upstream 无分环境，preview 发布是否即登记目录、放行表指向哪个环境的 proxy、EP preview 是否收真实 Webhook 未定；上游凭据录入方式、类型、轮换、下发协议、自研 EP 验签密钥来源未定。方向：a. 内置 EP 安装时自动建平台项目，接入容器只保留 prod；b. upstream 与凭据按环境映射并定义录入 API；c. 凭据复用 F01 机制。

F12｜重要｜矛盾｜R43 vs Design §10.4、AT-19；§4.3、§7.3、§11.3；§13.3、§14.4；Plan §13
超额“拒绝”与“排队或拒绝由业务选择”不一致；无配额查看/申请/调整 API；默认 3 含开发会话，事件驱动数字人易饱和；任务时长、模型用量不可见。方向：a. 配额申请流加项目用量视图；b. 统一为拒绝，管理员 CLI 调整；c. 明示不计量并删该触发条件。

F13｜建议｜风险｜Design §1.2“一服务”；§8.2；T2.5
一团队多数字人即多项目、多成员表、多配额；同团队互调需平台管理员审批；共享库私有依赖范围未写。方向：a. 团队内互调负责人自批；b. 团队级成员继承或项目多服务；c. 维持并把审批时长列入 §9 指标。

结论：闭环可搭成，但“可持续运行的业务服务”与“团队自行运营”达不到：服务上线后没有配置与 Secret 入口，看不到日志与运行状态，出问题无人被通知。最短补三件：分环境配置与 Secret 对象及注入约定；服务运行日志与健康状态查看入口；具名接入约定手册前移到 M0/M1。

---

# 视角 6 复制改造可行性（原始报告，依据 agent-workflow HEAD c4965ab；路径相对 packages/backend/src/services）

F01｜阻断｜矛盾｜design §5.5、§5.6、§10.3；E12
两驱动都是一次性无交互进程：claude -p --output-format stream-json＋stdin（runtime/claudeCode/spawn.ts:58-63,267），opencode run --format json --auto -- <prompt>（runtime/opencode/spawn.ts:101-132）；追问只能起新进程 --resume/--session。sendMessage 与 AwaitingInput 无法由复制驱动产生（permissionMap.ts:20-21：headless 下 ask 无意义）。方向：a) 定义 sendMessage＝新进程恢复会话并删 AwaitingInput；b) 改用 CLI 流式输入模式，登记为对“一致运行”的偏差并在 T0.4 验证。

F02｜阻断｜矛盾｜E09、E12、§4；design §3.1
业务 spawn 默认写 per-run settings 开启 Claude 自带 sandbox（claudeCode/spawn.ts:166-194）；Linux 需 bwrap＋socat，缺失只告警继续（boundary.ts:198-209；driver.ts:188-200），容器内还需非特权 userns 与 seccomp 放行；来源 CI 未装 bwrap，Linux 沙箱路径未被验证。“不加沙箱层”与“与 agent-workflow 一致”只能取一。方向：a) 走 persona 路径（不传 taskMounts）关沙箱并记偏差；b) 镜像装 bwrap/socat 并在 T0.4 验证所需 securityContext；c) 接受告警降级并写入验收。

F03｜阻断｜缺失｜E12、§0；design §3.2
runtime/ 的值依赖远超六处：execution/agentInjection（11 处）、readonlySqliteDatabase（bun:sqlite）、util/git（3538 行）、safePath、fileTrust、platformExec、sessionEventSink、resourcePolicy、embed.generated，及 shared 的 Agent/Mcp/AgentPermission schema（18 处）。runner.ts 是 DAG 节点编排（RunNodeOptions 46 字段，绑定 persistence、ws、memory、envelope），事件泵实际在 execution/managedProcess.pump 与 agentProcess.ts；驱动还嵌有 appHome 布局假设（claudeCode/driver.ts:331-338）。方向：a) 复制单元改为 drivers＋agentInjection＋agentProcess/managedProcess＋shared 子集，编排新写；b) T0.4 产出逐文件依赖清单。

F04｜重要｜缺失｜E01、E10、§0
“约 25 处 Bun API”遗漏 bun:sqlite（opencode 会话捕获必需）、managedProcessLauncher 以 process.execPath 自再入、embed.generated 文件嵌入；落 Node 需换 sqlite、重做 launcher 与打包。方向：a) 先验 Bun PTY 避免 Node 分支；b) Node 备选下登记三项改造；c) 放弃 launcher 直接 spawn。

F05｜重要｜风险｜design §10.3、§10.4；Q03
恢复会话的单写者保护在 runner 与 persistence port 而非驱动（runner.ts:951-1080，1465-1530）；多 Agent 并行且显式 resumeSessionId 时，两进程可同时恢复同一会话。取消为 detached 进程组＋kill(-pid) 升级（managedProcess.ts:502,774-795），可用。方向：a) TaskRunner 内做会话租约；b) cs-session 按 agentSessionId 串行；c) 记录风险。

F06｜重要｜矛盾｜design §9.4、§10.6、§10.8、§14.1
两 CLI 的凭据与会话都靠 env 透传与宿主目录：不注入凭据（claudeCode/spawn.ts:284-296；opencode/spawn.ts:173-183），Claude 转写在 $HOME/.claude/projects（不设 CLAUDE_CONFIG_DIR），opencode 会话在 $XDG_DATA_HOME/opencode/opencode.db，且每次运行覆盖 OPENCODE_CONFIG_DIR 为 <runRoot>/.opencode，机器级 provider 配置是否仍生效未测。§10.8“配置目录注入引用”与事实不符；persistent 模式 Pod 重建后 --resume 必失败。方向：a) Secret→env 作凭据通道，HOME/XDG 落 PVC；b) 显式设 CLAUDE_CONFIG_DIR/XDG_DATA_HOME 指向卷；c) 声明恢复后不支持 resume。

F07｜重要｜不可验证｜E19；design §5.9
远程 MCP 注入形状已有：opencode mcp.<name>{type:'remote',url,headers}，claude --mcp-config 文件 {type:'http',url,headers} 0600（execution/agentInjection.ts:135-165）；但 headers 凭据落 per-run 文件，且无 agent.permission 时 claude 走 bypassPermissions（spawn.ts:207）。方向：a) 写明注入形状、凭据轮换与清理；b) 定义 agentProfile→permission 映射；c) 明示默认 bypassPermissions。

F08｜重要｜缺失｜E13、E17；design §5.1、§8.5
code-host 动作仅 comment/mr/pipeline/read/custom（shared/codeHost/actions.ts）；call.ts/connections.ts 依赖 secretBox、RepositoryTransport port、taskExecutionParticipants，且“POST 5xx 不重试”要求建仓/打标签自带核对。webhook 可复用 gitlabAdapter 验签归一化；webhookDispatch（1096 行）、deliveryStore 绑定任务模型不可复用；事件枚举需映射。方向：a) 只复制 url/call 纪律与 adapter，新写 Projects/Tags/ProtectedTags 与投递；b) 先用 custom 动作跑 T0.9。

F09｜重要｜缺失｜E10、E11；design §5.6
无参照：PTY、出向 WebSocket 客户端、预览守护、契约校验；文件接口只有 list/read（worktreeFiles.ts）；命令执行可参照 scriptRun.ts。managedProcess 用 detached:true，孤儿孙进程重挂 PID 1，TaskRunner 作容器主进程须收割僵尸。方向：a) 镜像用 tini；b) TaskRunner 处理 SIGCHLD。

F10｜建议｜不可验证｜§0；plan T0.2
文档统计（33 文件 6955 行）与 HEAD（34 文件 7157 行）已漂移且未记源 commit；113 个相关测试与 system-mocks 是否随复制未说明。方向：a) T0.2 登记源 commit 与复制清单；b) 复制 system-mocks 作 TaskRunner CI。

结论：当前选型可以支撑最终目标，但须先关闭三项裁定：Agent 交互定义为“一次性进程＋恢复会话”（F01）；Claude 自带沙箱在 Pod 内开或关并验证 securityContext（F02）；复制单元改为 drivers＋agentInjection＋agentProcess/managedProcess 并列全依赖（F03）。

---

# 视角 7 计划可执行性与验收覆盖（原始报告）

结构：里程碑无环，§11 矩阵未引用已删除/作废任务，抽查 30 余条 R 的 Design 章节号与内容对得上。

1｜阻断｜缺失｜Plan G4、AT-04/06/09/42、§10.3 步4/9、T1.3/T5.2、§2“T4.6→T5.2”、R44
无任务交付任何已部署的 APIProxy 或模拟上游，最小样例未声明事件处理路径，G4、AT-09、步4/步9 没有验收主体；“T4.6→T5.2”与 T5.2 内容不符。R44“接入容器按项目流程开发发布”本身无任务：EventProducer kind 的 ingress 验签、produces 登记、投递身份均无任务无 AT。方向：a) 新增 T4.10 参考 APIProxy＋接入容器 kind 登记控制器与 AT，T5.2 为样例加事件处理路径；b) 内置 GitLab EventProducer 改走项目流程部署，兼作流程验收样本；c) 首版限内置，R44 同步收窄。

2｜重要｜风险｜G5、T5.7、AT-41、§2 M5 进入条件、§1.2
G5 要求目标档位压测报告成文，但 M5 进入条件无环境项，多节点集群仅在 T6.10 出现，无任务负责供给。方向：a) 新增集群供给任务并写入 M5/M6 进入条件；b) T5.7 移 M6，G5 改为 kind 功能性并发。

3｜重要｜缺失｜§11 R24、T5.4、AT-19/27/41、§12.1
“traceId→sessionId 可索引、OTel 关联”无 AT；无证据目录。方向：a) 新增 AT-44；b) §10.2 步9 升为独立 AT 入矩阵。

4｜重要｜缺失｜R03、AT-02/43、T3.6、G3、§10.3 步6；Design §5.9；E19
CLI 无任何 AT；Agent 经操作 MCP 发布/调 API、MCP 调用经 cs-api 校验会话授权、会话释放后拒绝均无 AT；E19“容器内 Agent 连接鉴权”无 M0 任务。方向：a) 新增 MCP 发布与越权 AT，步6 加 Agent 调工具分支，CLI 复用脚本；b) T0.4 增 MCP 连接鉴权原型；c) CLI 延后并修 R03。

5｜重要｜矛盾｜Proposal §3、R43；Design §10.4；AT-19/39
超额语义三处不同。方向：a) 统一为拒绝；b) 双路径，T5.1 写明参数，AT-19/39 分别断言；c) Proposal 改述。

6｜重要｜缺失｜tech-eval §4 行1、E01/E03/E04/E06/E09；T0.2/T0.4/T0.5/T0.6、G0
“Bun 长驻稳定性、PG 驱动、Hono WebSocket、OTel 兼容”归 T0.2/T0.4，两任务内容与完成条件均未提及；E01 回退 Node 以“M0 原型发现阻塞”为触发，无原型不可触发；放行时延、供给时延未进 T0.5/T0.6 产出；G0 未断言 T0.3 契约冻结，而 M3/M4 并行以其为前提。方向：a) 新增 T0.11 控制面运行时原型入 G0；b) 扩写四任务完成条件并在 G0 加契约冻结；c) 移 M1 并改 E01 触发条件。

7｜重要｜矛盾｜G1、G2、T2.11、T4.7；§2、T3.5/T3.6/T4.5、G3
G1“开发者不能晋级”但晋级由 M2 T2.11 交付；G2“不恢复旧权限”但撤权在 M4 T4.7。T3.5/T3.6 与 T4.5 重复承载 Swagger 调试页与调 API 工具，构成 §2 未声明的 M3↔M4 双向依赖；G3“固定桩驱动”无任务。方向：a) G1 改授权表单元测试，G2 限已存在对象；b) 删 T4.5 并入 T3.5/T3.6，§2 补依赖，T3.3 增桩驱动。

8｜重要｜缺失｜Design Q07/Q08/Q09/Q14/Q15、§4.1；Plan G0 关联
Q07/Q08/Q09 在 Plan 中零次出现，Q14/Q15 仅“识别”，无任务写明关闭；Q15 未闭合则遗忘会话永久占用一项目一会话与配额槽；模板语言“评审时确认”无决策任务，T0.3 冻结 build profile 依赖它。方向：a) T2.7/T2.10/T6.6/T3.1 完成条件写明关闭对应 Q，T0.1 加模板语言决策；b) 新增 T3.14 空闲提醒/释放；c) Q15 定为“仅提醒”入 §13。

9｜建议｜不可验证｜AT-02/08/13/15/17/21/24、§10 首段
“只改应用自身”“一服务一运行单元”“并发正确”“兼容检查”“被约束”“语义不同”不可断言；AT-17 五项合一；§10.2/§10.3 之外无 AT 有前置条件与步骤。方向：a) 逐条改为可枚举用例与期望结果；b) 拆分 AT-17/21；c) 补安全类与 M6 类脚本规范。

10｜建议｜缺失｜Proposal §10 风险5/6/7、§9；T1.6、T2.8、T4.2、AT-03
“手工标签界面标为未发布”无任务（AT-03 却断言“标注”）；“登记时标注资源语义”未进 T4.2；“就绪时间作为指标”与 §9 五项时长无任务、无 AT、无目录。方向：a) T1.6/T2.8 增标签扫描标注；b) T4.2 增资源语义字段；c) §12.1 增 metrics/ 由 T1.8/T3.1/T2.8 记录。

11｜建议｜缺失｜§12.1、§12.2
缺能力说明 MCP/能力页/CONTRIBUTING.md（AT-43）、配额（AT-39）、追溯（T5.4）的目录与状态行。方向：a) 增 capabilities/、quota/、trace/ 及状态行；b) 归入现有目录并注明；c) §12.2 每行标对应 AT。

12｜建议｜矛盾｜§0、§0.1、§2、T0.1、T0.10、§11 R38、R10–R13、§10.2
写 D01–D37 而 Design 有 D38；依据仍写 v0.3.0；“所有任务初始未执行”与 T0.10 已结项矛盾，R38 又挂已结项 T0.10；“R10–R13 由 R44–R46 替代”漏 R47；§10.2“分析/编码/审核 Agent”与已删角色同名。方向：a) 改 D38、v0.3.1、补 R47、T0.10 标已完成；b) R38 改挂 T0.2/T5.7；c) §10.2 改用 agentProfile 名。

13｜建议｜缺失｜§13；Proposal §7.2/§7.3；Design §3.1
缺“更多模板/语言”、Kafka、Longhorn、业务缩容到零；“与 v0.2.0 相同的触发条件”引用本版不存在的文本。方向：a) 补行并写触发条件；b) 条件性选项统一放 tech-eval 并引用。

结论：结构完整、无环、无失效引用，主链有任务与门槛支撑。但无法完整验证最终目标：M4/M5 验收缺接入容器与事件接收主体，追溯与操作 MCP 无 AT，目标档位环境无供给任务，M0 未原型化 Bun 运行时风险。最短补齐：一个参考 APIProxy、样例事件处理路径、多节点测试集群任务、追溯与 MCP 越权两条 AT。
