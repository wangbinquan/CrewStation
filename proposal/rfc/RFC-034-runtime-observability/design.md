# RFC-034 技术与交互设计

状态：Draft。所有接口和表名均为候选合同，需设计评审后实施。

## 1. 模块落位

扩展现有 **observability（L6）**，负责运行统计口径、用量账本、时间区间、查询与数据质量；不新增同职责模块，不改变现有调度、恢复和资源生命周期 owner。

| 责任 | 唯一 owner / 接缝 |
| --- | --- |
| 业务 task/subtask/attempt/result | business-task（L5）公开只读 API/持久领域事件 |
| 环境、启动阶段、Pod 重建、固定镜像/档位 | task-runtime（L4）公开查询 |
| Runner 持久事件、连接、gap | session（L5）公开查询/事件 |
| 开发会话 | dev-session（L5）公开查询 |
| release/物理槽/角色历史/维护窗口 | release（L4）公开查询 |
| 项目可见性 | project（L2）authorizer |
| CPU/内存/PVC/七天历史 | cluster-management（L6）提供最小项目指标投影端口 |
| 资源期望、实况与历史 UID | resources（L1）公开标准视图 |
| 网关与事件投递计数 | gateway/events 的明确公开遥测合同 |
| 接线 | platform（L7）组合根 |

**同层约束**：observability 不能 import cluster-management（同为 L6），在自身 ports 声明 ResourceObservationSource，由 platform 注入 cluster-management 的根公开 API。不能调用管理员 HTTP 端点后再在前端过滤项目，更不能 join 对方 schema。

前端新 `features/observability/{pages,components,model,hooks,i18n}`；共享 ExecutionTimeline/UsageBreakdown 仅在实际存在多个消费者时放 shared/ui。正式路由与导航接线在 app 层。沿用 Card、Stack、ActionRow、Button、Tabs、Segmented、DataTable、TimeSeries、Dialog、EmptyState。

本 RFC 无结构例外。保持 600 行/文件、80 行/函数、20 源文件/目录，无 tsconfig paths 别名；若实施触发新的结构规则需另立 ADR。

## 2. 执行与计量身份

根身份为 `(projectId, ownerKind, ownerId)`；traceId 是关联标签，不是授权键或唯一计费键。CS UUID 保持 RFC-013 格式，外部 AW task/node ID 单列 externalContext，不替代平台 ID。

候选执行记录：observationId、projectId、kind（business/dev/profile-test/build/platform）、businessTaskId、subtaskId、attempt、executionTaskId、agentId、sessionKey、nativeSessionId、generation、profileId/revision、runtimeImageVersionId/digest、resourceId、podUid、releaseId、physicalSlot、roleAtTime、traceId、otelTraceId、externalContext、sourceVersion。

Agent 统计默认按项目内应用提供的稳定逻辑标识；仅有随机 session ID 时显示“执行实例”，不能按同名合并。跨项目管理员按档位/驱动聚合时，不把不同业务里叫 reviewer 的 Agent 当同一个身份。

`business-task.domain.agentProjection` 已给 scope/measurementId 加 executionId 前缀；摄取保留这一身份链，再加 source/project 边界。恢复后的相同原生会话要按 provider measurement 的原始计量范围对账；不能因为新 Pod、新 invocation 就把已累计过的历史全部再算一遍。

## 3. 用量账本与修订

扩展现有 nullable BusinessUsage，不先发布破坏性契约变更。观测内部 envelope 保存：

```text
source + sourceVersion + projectId + executionId
sourceEventId / durableCursor / measurementId / scope
mode(delta|cumulative), occurredAt?, observedAt, revision?
inputConvention(exclusive|cache-inclusive|unknown)
inputUncached?, cacheRead?, cacheWrite?, output?, reasoningSubset?
quality + inclusion(parent-includes-child|exclusive|unknown)
pricingRef?, sourceCost?, currency?
```

- event-key 幂等写；同键不同内容记录冲突，不静默覆盖。
- delta 仅首次记账；累计 scope 保存最新有效值与版本，修订以差额更正投影，不将每个快照求和。
- 版本/时序不明时不能用“最后到达”覆盖新值；无法判定的冲突降低完整性。累计下降若无 reset/revision 证据，进入待对账。
- parent inclusive 和 child 同时出现时仅选可加的贡献集合；无法拆分的余额归“未归因”，不同时给所有 Agent。
- Claude/OpenCode 的现有映射分别有 final/step 语义；上游版本样本固定之前不能宣称四桶完全互斥。CLI 只解析交互活动不能推出 Token。
- complete 在 usage scope 层定义；任务完整需要预期执行集合闭合、全部支持且最终事件到达、无未修复 gap。结束事件不自动把 partial 变 complete。
- 用量不采样。模型和工具详细 spans 可采样，但界面分别标明，不能从被采样的 spans 重建成本账本。
- 金额用 decimal 或人民币微单位整数，价格以生效日期/采购版本/模型修订快照固定；不以当前价格覆盖历史。用户可见金额统一 CNY，原采购币种仅留在管理员审计来源元数据，不能与人民币混加。

## 3.1 人民币价格配置与历史快照

UI 落在现有算力档位管理的 Token 成本区；该位置不改变模块 owner。`observability` 自有 price_versions 与 profile_price_bindings，读取 `agent-runtime` 的最小公开档位目录/固定修订（协议、模型的管理员安全摘要），不读包含解密凭据的 launchMaterial，也不修改运行配置。租户投影仍不含采购单价。

候选管理 API：`GET /v1/admin/observability/pricing/profiles`、`GET /v1/admin/observability/pricing/profiles/:profileId/versions`、`POST /v1/admin/observability/pricing/profiles/:profileId/versions`。body 包含 expectedRevision、profileRevision、protocol/provider/model匹配、currency固定CNY、四桶 decimal 字符串、effectiveFrom、sourceNote、requestKey。管理员鉴权、幂等请求、CAS及有效区间不重叠校验在服务端完成；客户端校验不代替后端。

价格为空表示未配置，0表示有依据的免费；不能把未定价执行计入已定价覆盖。示例表单要求四项均填写、非负、最多6位小数，真实不支持的桶应以能力矩阵确认“不适用”，不能默认为免费。每百万Token单价与Token精确计数相乘后再除，不逐调用过早舍入。金额显示人民币，极小正值用“小于¥0.000001”等提示。

执行受理时间选择当时生效的价格版本，并固定档位修订、模型身份与priceVersionId；已受理执行不受新价影响。usage到达时基于该快照归因；迟到/重放沿用原价。没有绑定记录的旧事实仅在身份与时间依据可证明时回填，否则保持未定价。上游实际成本与按配置估算分别存储，二者不可同时加总。

变更只追加价格版本；历史记录不可覆盖。同一运行时的不同模型不共享隐式默认价格；多模型和不同缓存写入档有明确模型/计价子类型才选规则，否则未定价。并发修改返回冲突并保留表单草稿。价格停用只终止后续有效范围，不删除已被历史引用的版本。历史重算另行审计，不提供随手“应用至全部历史”按钮。

## 4. 时间与分位数

`taskWall = businessOutcomeAt - acceptedAt`；如应用未声明完成边界，展示“平台执行历时”，不得伪装成端到端业务延迟。`containerLifetime = releasedAt/asOf - environmentCreatedAt` 独立展示。

`agentOccupied = sum(各执行活动区间长度)` 可大于 taskWall；task activity 取区间并集。排队、拉镜像、初始化、人工等待与活动可能在不同 Agent 间重叠，默认按泳道分别显示，不做假守恒饼图。只有可证明互斥的任务状态时间可组成分解条。

开放段以响应 asOf 封顶；浏览器动画只影响显示，统计值来自服务端水位。时钟漂移、负跨度标异常，不悄悄截成零。事件时间与接收时间分列，固定时区/半开窗口 `[from,to)`。

服务请求、任务、启动、工具各存独立分布与样本数；系统 P95 从原始样本或可合并 histogram/sketch 重算，不平均各项目 P95。低于配置样本阈值保留值但标“低样本”，不自动报警。

资源积分使用原始采样覆盖段，CPU 核时与内存 GiB·h 给 coverageSeconds；缺失不补零。PVC 请求容量按 UID 去重，实际存储曲线复用 RFC-015；Pod 重建不继承旧 UID 实况，历史归属带有效时间。

## 5. 可靠摄取与存储

观测 schema 增加 execution_facts、usage_measurements、usage_revisions、execution_intervals、projection_offsets、price_versions、rollup_hour/day；业务内容正文不进入统计表。

源 owner 在自己提交事务里产生持久事件/outbox，观测在提交后消费；runner/session 流量须使用已持久且有 persistedThrough 的 cursor。现有 business-task 投影与 session 流为同一底层执行时，明确 canonicalSource，不能双路重复记账。

ledger + aggregate delta + checkpoint 同事务。多个 worker 以租约和 fencing/唯一键保护，崩溃可重放；有界队列、退避、dead-letter/repair 状态可见。SSE/WS 仅提示 revision 更新，不承担唯一账本来源。故障不能倒逼平台调度卡在遥测写入；显示采集落后并按保留窗口恢复。

历史回填读取 owner 分页快照，在捕获水位前后追增量；旧 trace 只能得到粗粒度开始/结束或 final usage 时标 legacy。源缺口不可补造。记录 source checkpoint、updatedAt、firstAvailableAt、capabilityVersion、gapCount。

明细保留建议 30 天、小时 90 天、日 365 天；资源原始历史继续当前七天上限，扩容前不宣称更长。生命周期外键仅本 schema 内使用；最小项目/执行归属保留到聚合过期，否则无法满足撤权与删除。内容删除与统计匿名化按 owner 生命周期事件执行，不从跨域表直接级联。

## 6. 查询与权限合同

项目 API 候选：

- `GET /v1/projects/:projectId/observability/{overview,runs,agents,usage,services,resources,quality}`
- `GET /v1/projects/:projectId/observability/runs/:id` 与 `/timeline?parent=&from=&to=&cursor=`
- `GET /v1/projects/:projectId/observability/agents/:key/runs`

系统 API 候选：

- `GET /v1/admin/observability/{overview,projects,platform,capacity,usage,costs,quality}`
- `GET /v1/admin/observability/projects/:id/summary`

导出 `POST .../exports` 绑定 actor、筛选、asOf、scope；小结果可同步，大结果异步，下载时重新鉴权。精确数字使用十进制字符串以免 JS 安全整数溢出。返回统一 envelope：items/series、asOf、window/cohort、units、sourceVersion、coverage、unsupported、nextCursor、warnings。

项目请求 server-side authorizer 在查询前执行，资源 adapter 只接受该项目 ID 与允许字段；不从全局聚合扣除其他项目猜出结果。管理员接口独立 DTO，管理员进入项目页面也使用项目 DTO。cache key 含 actorAuthorityRevision + scope + filter + projectionVersion；角色撤销清缓存并断开已有订阅。

日志正文、Prompt、工具参数、文件路径、凭据不在指标或 trace baggage；关联业务查看继续走原 owner 权限。高基数 taskId/sessionId/traceId/PVC UID 放索引与查询，不加到通用 metrics labels。

Project/tenant 时间筛选返回可见资源时段，不能仅用“现在的项目标签”重归属历史。跨项目共享 trace 保留边界；系统项目总和与全平台的差额显示平台专用/共享未分配，而非强行摊平。

## 7. 服务与平台观测

网关 RED：请求数、HTTP 5xx/4xx/429 分开、请求完成延迟，按 route template/service/release/environment 有界标签；路径参数和查询不做 label。WebSocket/SSE 以连接成功、断开、滞后单独定义，不塞进普通 HTTP 延迟。

release 在切流时写角色映射历史；prod/preview 筛选以事件发生时的角色为准。维护导致拒绝访问仍保留真实错误，只提供“排除计划维护”解释视角。

平台组件：cs-api 错误/延迟、cs-session Runner 接入/重连/重放滞后、controller 调和积压/耗时、cs-events 投递队列/重试/死信、gateway 限流、Postgres pool/查询等。每项独立 capability，没采集则“不支持”，不是绿色。

全集群容量 = 可分配值；受管项目、CS 内置、其他工作负载、未分配各自展示。实际使用与 requests 和 limits 分图；limit 总和可能超售，不用它算剩余容量。观测页只读，资源操作经既有集群管理审批/确认流。

告警遵守 D61：只扩展既有告警记录，不恢复订阅与通知；规则具备最小样本、窗口、持续时长、去重键、恢复条件和证据。阈值默认建议在评审时确认，不在 Demo 悄悄生效。

## 8. UX、状态与性能预算

常驻筛选：项目上下文、时间、环境；任务种类仅影响执行指标，服务卡明确独立范围。项目统计不混入无主平台测试，系统成本显式显示平台用途。查询和选择同步 URL；浏览器前进/后退保留上下文；重读不卸载页面、不禁用所有入口。

任务详情使用独立路由，片段/Agent/异常简短详情复用 Dialog。窄屏横向滚动限制在 DataTable/时间轴内；固定 Agent 名称列，执行表提供读屏等价入口。键盘可选择每段，Esc 关闭并回焦点。

状态包括加载、无数据、无适用能力、未启用采集、无权限、部分来源失败、迟到、gap、过期、未定价。量的 unknown 与质量的 warning 不混淆。示例页不配置真实权限或给真实账户切角色。

预算（待实测）：100K 执行/10M usage 时，七天常用概览 warm P95 <1s，首批 200 时间段 <1s，payload <300KB gzip；异步导出限制行数/执行时间，数据库分页与 rollup 合并，不浏览器拉全量。采集压测单列断连恢复与 write amplification。

## 9. 实施测试矩阵

- 领域：互斥 Token、缓存包含关系、delta/cumulative、下调修订、父子 scope、unknown vs zero、币种和价格版本。
- 身份：同名不同 Agent、同 trace 多项目、子任务重试、原生会话继续、新 Pod 相同 PVC、旧执行迟到。
- 时间：业务结果/资源释放分离、并发等待、跨日与时钟漂移、P95 合并、缺口积分。
- 权限：project member/view、非成员、market-only、preview-only、admin；列表/聚合/搜索/导出/订阅一体负测，管理员 DTO 不能进入项目缓存。
- 故障：source persist/ledger/checkpoint 各边界断点、duplicate/late/gap、部分系统采集失败、价格服务不可用。
- 浏览器：长列表末行新路由/Dialog、返回位置、Esc/焦点、390/768/1440px、双语/主题、运行中段、缺失状态。
- 实机：两个项目不同权限、至少业务/开发/平台测试三种来源，驱动固定版本，指标与 owner/资源 UID 对账；本次设计不创建这些真实资源。
