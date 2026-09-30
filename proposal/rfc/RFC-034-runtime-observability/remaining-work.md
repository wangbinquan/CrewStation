# RFC-034 剩余工作与关闭条件

更新：2026-09-30。状态：In Progress。本文是当前待办入口；[plan.md](./plan.md) 的批次是历史回执。源代码已存在、通过门禁、已推送、已部署、真实用户/模型验收分别记录，不互相替代。

## 当前已实现与实际部署

当前本机源码版本：`1d48fb1703744acfc06841e3a34e8f742e8c98bd`，2026-09-30T09:29:13.385Z部署完成；[精确CI36694912441](https://github.com/wangbinquan/CrewStation/actions/runs/36694912441)六项成功，八组件Ready=1、storage-contract=1、迁移Complete/applied=0，公开登录HTTP200、未登录根HTTP401符合现有认证合同。实际原生来源、原键持久停止和原选择接口底座已部署；生产开发采集仍OFF，完整consumer、owner派发/清理屏障和两级开发明细尚未接通。源码与后继回执文档分别记录，历史d01/bebb批次保留在下方。

正式项目/系统统计已有业务任务、Agent/尝试、四桶 Token、人民币估值、基础泳道、算力贡献下钻和采集质量；项目与算力显示名称，保留稳定 ID/受理修订。已有价格配置与冻结目录、OpenCode 根/子树采集、原归属修订和原价补算；资源/容量和当前服务槽/平台 Pod 健康已有入口。

页面修正、实际 Token 柱形数字、时间按钮对齐、项目/算力名称和取消 CSV 已在本机部署。当前业务统计来源仍被合同显式限定为 `business-tasks`；开发内部身份扩展不能当成开发 Token 已接通。

| 批次 | 已有证据 | 尚缺的关闭条件 |
| --- | --- | --- |
| 正式页与 CSV 移除 | `84ae1bbbbed1a0f7b9f5de4550e78e4c7e12aa14`；[CI 36508083945](https://github.com/wangbinquan/CrewStation/actions/runs/36508083945) 六项 success；2026-09-29 01:31:46Z 本机八 Deployment Ready | 正式构建加只读夹具的浏览器证据不是实际身份/模型验收 |
| 开发身份/账本基础 | `ca2ff256317b8ebc5cb914c1310865f916996345`；完整 4191 pass/142 skip/0 fail；[CI 36512613256](https://github.com/wangbinquan/CrewStation/actions/runs/36512613256) success | 已随 v2 本机部署；生产开发来源仍关闭，实际开发采集待完成，不能显示开发已知零 |
| 采集证明 v2 服务端 | 独立功能门 PASS；冻结 15 路径指纹一致；2026-09-29 03:00:12Z 完整门禁结束：4197 pass/142 skip/0 fail、26633 断言、838 文件 | 已随 `94aabd6dfe641e46bbfc2e736f0632c7fdf6fc12` 推送；[CI 36619175682](https://github.com/wangbinquan/CrewStation/actions/runs/36619175682) 六项 success；本机八组件已升级；与 AW 实际联动/托管验收待完成 |
| 开发 Agent Stage 1（已推送/CI通过，生产关闭） | [内部身份与总体接入](./development-usage.md)；[headless 实施细化](./development-headless.md#9-stage-1-实现检查点2026-09-30底座已发布)；协议/Runner/双卷绑定/驱动底座，79 定向回归通过 | 独立实现功能门PASS，完整4226/142/0通过、41路径指纹一致；`fc491a4d6b31c6476d3222209ced880810936c3e` 已推送，[CI 36640100860](https://github.com/wangbinquan/CrewStation/actions/runs/36640100860) 六项 success。生产关闭。Session PG/outbox、owner 固定原键/价格/排空、查询与正式两级界面仍须接通及验收 |
| 开发 Session PG/outbox（Stage 2 部分，已推送/CI通过/已部署） | [Session 实施检查点](./development-headless.md) §10；54相关用例/335断言，精确lint/类型/结构/旧契约金样通过；首轮两项P2已回归修复，最终Session范围独立静态门PASS | 完整4263/142skip/0通过、35路径指纹一致；`1326fdd1ac3a0fdd0205bc0e4857a4423cc7df9d`已推送，精确CI六项success、本机八组件已部署；生产仍关闭。owner原键/稳定意图/CNY受理/实际清理屏障、platform消费及两级明细仍待接通，CS-R02不关闭 |
| 开发owner稳定受理底座（已推送/CI成功/已部署，生产不调用） | [owner限定范围与下一批屏障](./development-owner.md)；独立静态实现门PASS，40项/283断言相关覆盖、PG/SQLite/冻结CNY原价回归通过 | 修正候选完整4277/142skip/0、26路径指纹未变；8d2e547a精确发布、六项CI成功、本机八组件已部署；详见下方回执。实际派发、等待排空的重连、保留期删除、三类重建、platform消费及两级事实/UI仍待共同接通 |
| 双路径render/固定元数据（已推送/CI成功/已部署，生产不调用） | 独立设计/限定实现门PASS；实际PG/渲染24项/188断言通过；完整4288/142skip/0、23路径指纹未变 | bc8522cb精确发布、六项CI成功、本机八组件已部署；最终实际原生来源/沿革与持久停止、实际派发/清理/消费/两级事实UI继续 |
| 原键持久停止（已推送/CI成功/本机部署，生产不调用） | 独立限定实现门PASS；相关47/0与完整4307/142skip/0、23路径指纹一致 | bebb3d9b精确发布、六项CI成功及八组件本机部署；仍需实际原生来源、owner全派发/删除屏障、consumer/两级事实UI |
| 实际原生来源第一批（已推送/CI成功/本机部署，生产不调用） | 严格可选能力与Hook前选择、实际环境/文件身份、同轮模型、独立begin/finish和journal，最终30源码/测试独立门PASS；相关77/0、合同族34/0及精确lint通过 | d01ba8223的六项CI全部success，本机八组件Ready；本机全量被并行迁移阻断的记录保留。owner挂载/派发/完整删除屏障、consumer原价历史归属、两级事实/UI及实际验收继续 |

内部持久consumer候选已通过限定功能复核：70项相关回归/374断言、精确16文件lint通过；真实Session PG outbox、全meter所选模型、原价、根会话/文件分区、原子cursor及ACK恢复均覆盖。生产source尚未注入，两级开发事实/UI、owner派发/删除排空仍须接通，CS-R02不关闭。消费者源码已本地提交965b45e8，尚未推送/部署：提交前复核共享迁移锁仍含6份项目删除迁移与本批dev-session/0013未进入提交树，须由各所属会话正常提交；最初检查点为11份并行引用；不得删锁条目或扫入他人源码。单次本机完整check因并行identity/ports目录上限失败，单独typecheck被三项外部测试字面量/品牌类型错误阻断，不能写作本机全绿。详见[消费者候选回执](./development-consumer.md#内部持久消费者实现候选2026-09-30)。

源码锚点：[统计合同](../../../packages/contracts/api/observability/runtimeStatistics.ts) 的 `sourceScope` 仍为业务任务、cohort 仍为 started；[platform 装配](../../../modules/platform/wiring.ts) 仅注入业务事实/业务数值来源；[开发生命周期](../../../modules/dev-session/application/agentExecution.ts) 仍由普通事件结束并回收；[平台健康说明](../../../apps/console/src/features/observability/i18n/zh-CN.ts) 明确应用级指标尚未采集。

## 执行顺序与依赖

1. CS-R01：发布已通过门禁的 v2 候选并升级本机，保留部署回执。
2. CS-R02～05：优先闭环“本项目开发/任务分别用了哪个算力、各消耗多少”。headless、CLI、平台测试分别验收，不能一次开启全部能力标识。
3. CS-R06～09：补真实调用与时间片段、网关 RED、发布角色历史和平台应用健康。
4. CS-R10～12：异常、真实窗口消耗、历史维护与规模对账。
5. CS-R13：按项目/系统两级真实验收矩阵收口。

CS-R01 的失败若不影响开发设计，可以并行推进文档与其他非冲突工作。每个候选先独立复核和相关检查，再只跑一次完整本地 check；无关主干变化不触发重复门禁。

## 待办清单

### CS-R01 v2 发布、部署与 AW 对拍〔已推送/CI成功/已部署，实际联合验收待完成；T3/T11、PO-04/10/13〕

- 精确发布本批默认 v1/显式 v2 服务端；capture、usage、valuation 共用持久水位，分页上限、固定快照、版本错用和费用权限均保留严格验证。
- 等待精确 SHA hosted CI；构建该提交镜像，经现有存储合同预检后更新本机平台服务，记录镜像摘要、配置和 rollout。旧执行/算力档位固定的 Runner 不自动替换。
- 与 AW-R02 联合验证纯空树为零、没有证明为未知、迟到量与历史修订、跨页恢复、v1/v2 升降、费用开放/撤回；证明整条链只有一笔用量/估值。
- 退出证据：两仓 SHA、CI 终态、服务 API/Runner 版本、实际部署及原始合同/真实同步对拍。RFC-370 托管准入仍由其 owner 关闭。

### CS-R02 开发 Agent 持久数字链路〔Runner Stage 1 已发布/CI通过，生产未开启；T1～3/T9、PO-02/04/06〕

- [headless 细化设计](./development-headless.md) 已通过独立功能设计门：存储跨进程/容器/Pod、旧 Runner、日志故障、稳定重发、可读末尾排空及不可取回缺口已明确；实现仍须逐条符合该合同。
- Stage 1 已有可选协议、稳定摘要、Runner 数字日志、双卷归属、同步采集 sink、读/ACK/重放；独立实现功能门 PASS，首轮完整门禁4225/142/1因旧导航异步断言失败，已补测试等待并通过23项回归及独立复核，修正候选完整4226/142/0通过，41路径指纹一致；已随 `fc491a4d6b31c6476d3222209ced880810936c3e` 精确发布，[CI 36640100860](https://github.com/wangbinquan/CrewStation/actions/runs/36640100860) 六项 success。新 render 仍未被生产准入选择，现有 Pod 不迁移/重建。
- Stage 2 的 Session PG 逐页副本、公平固定页 outbox 和排空回执已在制并通过定向/独立复核，见 §10 检查点；全量4263/142skip/0及35路径指纹一致已确认；1326fdd1精确发布、六项CI成功、本机部署完成。下一阶段 owner 在首次发送前持久固定原 journal 键/稳定意图/nonce，接通 CNY 受理、实际生命周期清理屏障、platform 数字消费和两级明细后才启用真实来源。
- [原键派发与排空实施设计](./development-dispatch.md) v2独立设计门PASS；限定派发participant v3独立功能门PASS、28项相关回归通过，全量25项外部失败及1错误保留。内部消费者已本地提交965b45e8，提交前复核远端推送仍待共享锁6份项目删除迁移与本批dev-session/0013引用齐备（最初检查点为11份并行引用）。持久结束队列、task-runtime/resources/项目删除全部许可和两级事实/UI仍未接，生产OFF。
- [owner/资源删除屏障剩余接线](./development-owner.md) 已明确实际落位和反例。内部稳定受理底座已通过独立限定范围复核与完整4277/142skip/0，生产尚不调用；不能以关闭准入替代Session排空，也不能在native cleaning/父releasing时先发布资源中心删除期望。
- [实际原生来源与持久停止](./development-owner.md#下一阶段必须补齐实际原生来源与持久停止)仍须先完成：普通headless实际HOME为每Agent临时目录，不能由父PVC猜原生来源；Hook后最终环境须有独立实际证明。reserve→resolveCwd→running的取消窗口和迟到Start须用原key＋Pod的持久停止收敛，drain后禁止新派发；空receipt/not_found与finalThrough=0都不独自证明Token零。来源沿革/临时HOME策略及对应回归在实现前裁定。[原键持久停止限定设计与实现](./development-stop.md)已通过限定静态实现复核、47项定向验证及本页末尾完整门禁；精确发布/CI/部署待回执。实际来源证明及完整owner接线仍未完成；已补interrupted finished不能仅按phase/result判进程退出的反例，具有独立从未许可证明的prevented除外。
- 实现受理时冻结项目/工作区/Agent/实际环境/算力修订/CNY 目录；Runner 独立数字 journal 与能力协商；Session 连续持久副本和公平 outbox；账本/估值成功后确认消费。
- 普通终态事件不能直接当数值完成；正常数值出口需数字复制到 finalThrough，中断出口需先排空可读末尾，或持久实际已复制水位及明确不可取回缺口；取消、父工作区释放、强制清理及 Pod 丢失都有完整或中断证据。不得因补采自动重复模型调用。
- 退出证据：真实 PG 与实际驱动链的重复、乱序、同版冲突、丢 ACK、容器重启、日志/Pod 丢失、多页末尾、排空屏障、旧 Runner；未采集保持未知，不拿 DTO 测试替代。

### CS-R03 开发 CLI 原生采集〔尚未接通；T1/T3/T6、PO-02/05/06〕

- 独立验证 OpenCode CLI 的原生来源及运行前基线、会话切换、恢复和每轮结束证明，不能复用 headless 的完成结论。
- 100→130 只归本次 30；旧步骤 10→15 校正回原执行/原价；缺前置基线或来源归属时保留部分/未知。Claude CLI 仅接受真实数值，通用 Terminal 明确不支持。
- 活跃轮次与容器/终端驻留分别记录；一小时驻留、两次十秒调用应显示二十秒已知活动，不画连续一小时模型执行。
- 依赖：CS-R02 的传输/清理机制和各 CLI 固定版本证据。
- 退出证据：真实 CLI、交互/恢复/取消/切会话、并行 Agent 与历史修订对拍；不可用能力在正式界面可辨认。

### CS-R04 平台算力测试归因〔尚未接通；T1/T3/T9、PO-06/09〕

- 接入真实档位测试执行、算力修订、实际 provider/model、数字与冻结价格；平台用途独立身份和归属，不能塞进虚构项目。
- 系统统计单列平台测试/其他平台用途，与项目总和的差额可解释；不纳入业务成功率和业务完成耗时。
- 依赖：Runner 数字能力及 agent-runtime 的真实受理事实，旧测试没有来源时不补历史零。
- 退出证据：失败/取消测试也保留消耗，重复回执不重计、零/未知/未定价区分，项目接口不可见平台内部金额。

### CS-R05 项目→来源→算力→执行明细〔业务下钻已有，开发待接；T4～6/T9、PO-01/02/03/11〕

- dev-session/task-runtime 各自提供有界事实查询，通过 platform 在同一快照装配；observability 不联查其他 owner 的私表。
- 开发执行按受理时间进入样本，不能因为父工作区很早创建就漏掉今日消耗。详情 ID 用真实独立环境，读账本时按父工作区再按完整执行身份过滤。
- 项目与系统页同时补来源分组、工作区/任务名称、算力名称及修订、各执行四桶和人民币；任务行中的某算力贡献不得替换成整个任务总额。
- 依赖：CS-R02/03/04 分别按实际能力启用；无来源仍显示不支持。来源操作直接可见，不增加“更多筛选”。
- 退出证据：业务/开发及同/不同算力两两对账、跨项目同 trace 不串账、费用隐藏/撤回、管理员进入项目页仍按项目字段、长列表末行/返回上下文。

### CS-R06 实际模型、工具与原生内部 Agent〔部分来源已有；T1/T2/T6/T9〕

- OpenCode 根/子树和实际模型补证已有实现；补对应真实运行证据。Claude 的实际 provider/model、最终输出、含子 Agent 的累计范围和恢复基线仍需逐版本证明。
- 补调用级模型/工具/内部 Agent 片段及父子联系，不把配置 model 当真实调用，不因父子视图产生重复 Token。
- 依赖：实际驱动/原生存储证据；CS 只记录平台可证事实，应用编排关系由应用声明。
- 退出证据：缺 provider 时 Token 已知但 CNY 未定价、部分桶、模型切换、并发子树、未知父关系、失败与取消；每个能力独立声明。

### CS-R07 执行阶段与时间口径〔基础泳道已有；T6、PO-05/11〕

- 串联真实受理、排队、调度、拉镜像、初始化、Runner 就绪、活动、人工等待、暂停/恢复、清理和保留；分别保留来源与时间质量。
- 业务完成、Agent 累计活动、活动并集、父容器存活分开；窗口内等待不因 lack of events 被算成运行。没有应用因果边不计算关键路径。
- 依赖：各 owner 的阶段/轮次事实及 CS-R02/03/06。
- 退出证据：并发/等待/取消/恢复/结果后保留的逐段手算、未知缺段、实际阶段泳道下钻、键盘与窄屏几何。

### CS-R08 网关 RED、发布角色历史与长连接〔未闭环；T8、PO-07/08/10〕

- 采集请求数、4xx/5xx/429、请求完成延迟，标签限 route template/service/release/environment；按原始计数和分布聚合，不平均每日或项目 P95。
- 切流时保留物理 release/槽位和当时 prod/preview 角色；历史不能随当前角色被重标。计划维护拒绝保留事实，排除视图明确说明。
- WebSocket/SSE 的连接成功、断开、重连和滞后独立计量，不塞入普通 HTTP 请求延迟。
- 退出证据：真实流量、切流前后、维护、低样本、超时/断连的路由→发布→项目→系统对账；日志尾部不冒充历史指标。

### CS-R09 平台应用健康〔Pod/槽健康已有，应用指标未接；T7/T8、PO-09/10〕

- 接入 cs-api 错误/延迟、Session Runner 接入/重放积压、controller 调和队列/耗时、events 重试/死信、gateway 限流、数据库连接池/查询指标。
- 每项独立采样时间、窗口、来源能力与缺失/过期状态；Pod Ready 不能替代应用成功率。
- 复用已有资源/容量入口，受管项目、平台内置、其他/未分配占用分开；资源操作仍在既有管理入口。
- 退出证据：组件不可用、采集停止、积压/恢复、过期与无样本的两级隔离；真实 API/组件故障样本，不用全绿假数据。

### CS-R10 异常与质量生命周期〔基础原因/旧告警已有；T10、PO-10/11〕

- 补执行失败/重试、等待、服务错误、缺数、积压、时钟偏差、未定价等规则的最小样本、窗口、持续、去重、恢复及影响项目。
- 关联任务/算力/资源/发布/来源证据，详情走统一 Dialog 或独立路由；保留既有 firing/resolved 记录。
- 退出证据：触发、抑制、重复、恢复、权限、源故障与业务失败分离；没有采样不判定健康。
- D61 继续生效：只做异常记录，不恢复通知订阅/渠道，不触发预算停任务或自动扩缩。

### CS-R11 真实窗口、历史维护与归属〔当前 started 样本；T2/T3/T7/T9、PO-02/07/08/09〕

- 增加真实发生时间窗口消耗；当前开始时间 cohort 的生命周期趋势保留并明示。未知发生时间进未分配池，不按采集时间或工作区创建时间归日。
- 原生修订/原价补算已有实现；补受控历史回填、重建和价格纠错预览/审计。历史受理快照缺失保持 legacy/未定价，冻结原价不可静默覆盖。
- 历史资源按采样时项目/UID 归属；CPU 核时、内存 GiB·h、PVC 申请/实际分开，共享 PVC 只算一次。七天现有历史限制不能被时间选择器伪装成三十天。
- 退出证据：跨天/时区、迟到修订、发生时间未知、发布/项目归属变化、PVC 父子共享、保留/删除与撤权、业务/开发/平台合计对拍。共享费用分摊不默认启用。

### CS-R12 有界全量统计与性能〔预算未验收；T3/T5/T7、PO-08/09/13〕

- 当前读取最多 200 任务/2000 尝试/20000 数值记录并显式 partial；补分页/rollup 或相应查询方案，不能靠抬上限把截断总数包装成完整总数。
- 对 100K 执行/10M usage 验证七天 warm P95 <1s、首批 200 片段 <1s、初始 <300KB gzip；单列写放大、断连补采与 outbox 公平性。
- 退出证据：固定种子数据、真实 PostgreSQL 报告、查询计划/索引、低样本与原始分母、不同来源公平恢复；不平均项目 P95。

### CS-R13 两级实机验收、发布与最终收口〔待以上依赖；T11、PO-01～13〕

- 用真实身份验证项目成员/非成员、系统管理员、管理员进入项目视角及费用撤回；当前本机登录身份授权仍待回复，先前部署授权保持有效。
- 真实模型/CLI/档位测试资源的创建、运行、结束和保留须有明确范围授权；已有测试/只读夹具不算实机模型证据，已固定旧镜像的会话不自动重建。
- 正式页中文/英文、明/暗、390/768/1440px、长名称、空/错/部分、末行 Dialog、Escape 焦点与返回 URL/分页/滚动、卡片间距逐项验收。
- 每次发布记录完整 SHA、精确 CI 终态、镜像 digest、存储合同/迁移、八组件 rollout、Runner/档位配置和清理/保留回执。所有必要证据完成后才将 RFC 标记 Done。

## 排除与后续范围

- 已取消：同步/异步 CSV、额外“更多筛选”入口；不列入后续待办，也不借报表名称恢复。
- P3 另行细化：应用自定义业务结果/因果合同、长期趋势与 SLO、受控 OTel；不是当前第一版关闭门槛。
- 明确不默认增加：告警通知、自动停任务、自动扩缩、跨项目数据共享、账单结算、共享费用分摊。
- AW 的编排关键路径由 AW owner 负责；CS 只暴露有证据的执行/资源事实，关联不重复计费。

## 回执模板

每项完成追加：CS-R 编号；实际实现范围；完整提交 SHA；独立功能门；定向/完整候选结果；hosted CI URL 与终态；实际运行或夹具；本机部署/Runner/档位版本；剩余限制。待授权、未实现和失败分别记录，不以“已加页面”关闭采集任务。


### CS-R01 本批发布/部署回执（2026-09-30）

- 文档检查点：`693ef50c9ff0fa4d4e60409e7d3b876e02945795` 的 [CI 36622441175](https://github.com/wangbinquan/CrewStation/actions/runs/36622441175) 六项 success；只更新剩余清单、设计与回执，不改变下列部署代码。
- 实现提交：`94aabd6dfe641e46bbfc2e736f0632c7fdf6fc12`；[CI 36619175682](https://github.com/wangbinquan/CrewStation/actions/runs/36619175682) static/unit/module/console/gate/e2e 六项 success。完整候选门禁 4197 pass／142 skip／0 fail，代码/测试/夹具指纹未因后续文档变化而改变。
- 本机：2026-09-29 19:46:51.122Z 部署完成，公开 `/auth/login` 返回 HTTP 200。八组件 generation/observedGeneration 相等、Ready=1：console 199，API 193，auth 91，controller 158，events 61，Session 110，两个 MCP 各57。
- 镜像：console `sha256:ce1c2a64b0542841dcd7dd7ba98213dfbe8ad3643a250808fc85e84cd7f6f321`；control-plane `sha256:b9c0e7f8b6a3f2af2fd364b1b35d976894307306f89437293069affd1ff29e68`；默认 Runner `sha256:426f1987e5d9f0be7e2cf295897d43d0c6deac720fd897521adf0ad7457d9926`。storage-contract=1，无新迁移。已有档位固定的镜像/既有执行未重建。
- 边界：上述 hosted E2E 与本机 rollout 不能替代真实开发用量、AW 托管装配和身份/模型验收；CS-R01 的实际联合验收仍未关闭，CS-R02～13继续。

### CS-R02 Stage 1 发布回执（2026-09-30）

- 源码提交：`fc491a4d6b31c6476d3222209ced880810936c3e`；41 路径精确提交，推后 main/origin 同步。独立实现功能门 PASS；修正候选完整4226 pass/142 skip/0 fail，原失败与修复历史保留。
- [精确 CI 36640100860](https://github.com/wangbinquan/CrewStation/actions/runs/36640100860) 已终态 success：static、unit、module、console、gate、e2e 六项全部成功。
- 本机仍为 `94aabd6dfe641e46bbfc2e736f0632c7fdf6fc12`。本批尚未部署，生产开发采集继续关闭；Session PG/outbox、owner 原键/CNY受理/排空、两级明细及真实开发验收仍未闭环，CS-R02 保持进行中。

### CS-R02 Stage 2 Session 在制回执（2026-09-30）

- 边界：Session独立数字PG副本/outbox与owner内部接口；没有生产开发受理或观测消费。54相关回归/335断言，精确静态与金样通过，独立Session范围静态功能门PASS；初轮两项P2与跨层测试导入修正历史保留。
- 固定单次完整门禁、源码SHA与精确CI待回执；本机仍94aabd6d，未部署本批。后续owner/CNY/清理、platform与两级明细未完成，CS-R02及两RFC保持In Progress。


Stage 2 Session 冻结候选完整门禁回执：2026-09-29T23:43:16Z，结构、全仓lint、后端/console类型全部通过；4263 pass／142 skip／0 fail、27,020断言、852文件，测试591.90秒（完整命令637.67秒）。31源码/测试/迁移/锁+4文档共35路径指纹全部未变；独立Session实现功能门及文档复核PASS。只追加本回执后精确发布，同源代码不重跑完整本地门禁。142跳过项与真实身份/模型/集群验收不计为通过；本机仍94aabd6d、生产开发来源关闭，owner/CNY/实际释放屏障、platform消费及两级明细继续。


### CS-R02 owner候选门禁与删除屏障规划（2026-09-30）

本批独立私表只落地稳定意图/nonce、首次CNY受理、实际子Pod UID查询、原journal CAS、关闭准入和不含启动材料的精确来源解析；没有生产派发/删除授权。初轮层级/长度/夹具问题及完整检查非空断言问题已保留历史，修正后的完整4277 pass/142 skip/0、26路径指纹一致确认。独立owner preparation实现功能门PASS。精确发布、CI、部署另记，本机仍1326fdd1。

下一批只读规划复核补明确排空重连与失败保留期的两条旁路：不能提前换原Runner凭据、不能经ready回调重发模型；resources保留期、cluster-control删除、三类rebuild及task-runtime持久补队列全部经过原键/原Pod/清理版本屏障。Agent已finalized和Controller重启仍能继续排空；资源行锁内不回取项目锁。细项及新验收矩阵已放入[owner剩余接线](./development-owner.md#下一批删除屏障的补充反例与落位)。规划结论不是下一批实现PASS，CS-R02～05和两RFC继续。

### CS-R02 owner 稳定受理底座发布与部署回执（2026-09-30）

- 精确源码：`8d2e547adc3251ab3307b61b3faa5134ed08aa67`，26路径提交，推后main/origin一致；独立限定范围功能门PASS，完整4277 pass/142 skip/0 fail、27123断言、854文件，候选内容未变。首轮未进入测试的类型失败及修正历史保留。
- [精确 CI36653568384](https://github.com/wangbinquan/CrewStation/actions/runs/36653568384) 终态success，static/unit/module/console/gate/e2e六项全部success。
- 本机于2026-09-30T01:20:19Z升级完成；迁移Job `rfc034-owner-migrate-8d2e547a` complete，owner与Session数字表存在，storage-contract=1。八组件generation=observedGeneration且Ready=1：console201、API195、auth93、controller160、events63、Session112、两个MCP各59。公开`/auth/login`只读HTTP200。
- 实际镜像摘要：console `b596d245352af9c4d5c725605acd3b38a549aff325153761070185a26e9068bb`；control-plane `f53b151f943a77ff898b2c56fa35e7a5c95121ef60571558e1d223a9ba857738`；默认Runner `10fb9e1c2357a77197a13bd01405deed9466ac3e0b8b333f815b1b395bb26577`。三张构建镜像OCI revision均为完整源码SHA，部署引用固定到摘要。
- 边界：未登录、未创建真实模型/开发验证资源、未重建旧会话或已固定档位。生产开发采集仍关闭；派发/排空删除、消费、正式两级事实/UI及真实身份/模型验收继续。142跳过项不是通过，CS-R02和两RFC不关闭。

后续在制：受理快照的双路径透传与固定启动元数据见development-owner末节设计，独立设计门PASS；生产尚不调用，相关检查与限定实现门继续，不提前记完整门禁通过。

### 受理快照透传与固定元数据候选检查点（2026-09-30）

本批仅补18个源码/测试路径与5份观测交接文档：developmentUsageStorage从实际受理/PG经投影、解析到公共Pod构造器；direct保存render而省略execution，ledger保留原workspace；同执行增删选择双向冲突。launchMetadata按固定修订读取，不取凭据或Hook；显示名仍是当前目录名称，不能覆盖owner受理名称。生产派发仍未调用，清理/consumer/两级事实UI不在本批完成范围。

相关24 pass/0 fail、188断言、6文件（真实PG/实际渲染/假K8s）；后端类型、18路径lint、修正后两测试lint、3368源文件结构检查通过；改到并被lcov识别的可执行行在相关用例中全部执行。独立限定实现功能门PASS（静态，未跑测试）。首轮20 pass/4 fail由套餐ID非UUID和直接准备队列夹具顺序造成，另有测试品牌类型/expected类型未收窄；已修夹具与类型，未放宽原断言。首次结果不计通过。冻结23路径后只跑一次完整本地候选门禁，精确发布/CI/本机回执另记；真实身份/模型验收未执行。

### 双路径 render/固定元数据完整候选门禁回执（2026-09-30）

2026-09-30T01:55:33Z，冻结23路径的一次完整本地门禁结束：结构、全仓lint、后端/console类型通过；4288 pass／142 skip／0 fail、27227断言、857文件，测试976.92秒，完整命令1035.26秒。18源码/测试与5文档在检查期间全部指纹一致；独立限定实现功能门PASS，24项相关回归通过。仅补本回执及下一阶段规划，不重复运行同内容完整门禁。精确发布/hosted CI/本机部署另记；生产开发采集仍关闭，真实身份/模型验收未执行，142跳过项不计通过。

### CS-R02 render/固定元数据发布与本机部署回执（2026-09-30）

精确源码bc8522cb7c98a6ef308065a5b5821ce181775ad9已推送，23路径独立限定功能门PASS，完整4288 pass/142 skip/0 fail且指纹未变。[精确CI36657789922](https://github.com/wangbinquan/CrewStation/actions/runs/36657789922)六项success。2026-09-30T02:18:01Z本机八组件generation=observedGeneration、Ready=1：console202、API196、auth94、controller161、events64、Session113、两个MCP60；storage-contract=1，迁移Job rfc034-render-migrate-bc8522cb完成，数字表存在，公开/auth/login只读HTTP200。

实际镜像摘要：console sha256:7b530e71a889fe12c0c20d0b16c55a461aad65d6ba23cb561dd2e9e2e628c494；control-plane sha256:becb085ec393e49755e6de24d71a27da256c44ca35e84bafd74e5c3665e06cb4；默认Runner sha256:f8543bd2dfe21ee3efd8f18f2076762283c0321987e6bd90a3fe0b63c707eb60。固定摘要及OCI revision核对完整源码SHA。未登录、未运行真实模型或重建既有会话/档位；生产开发采集仍关闭。实际原生来源、原键停止、完整派发/清理/消费/两级事实UI继续，142skip不冒充通过。


### 原键持久停止限定实现检查点（2026-09-30）

原数字受理和 stopRequested/launchPermitted/prevented 已在同一 FULL/WAL SQLite 即时事务中持久化；Hook 后、driver.start 前同步申请许可，停止可先于迟到 Start。Supervisor 覆盖等待 CWD、Hook 与已启动进程；Session 校验原登记、能力、key、Pod，停止回执复制到 PostgreSQL 后才返回，drain 后拒绝新数字 Start。初始化等待仍允许数字 stop/info/read/ACK。旧普通命令及 v1 receipt 保持兼容；任何无独立退出证明的 interrupted finished 都为 unknown；已有独立从未许可证明的 prevented 除外。旧控制缺失不补造从未启动证明。

17 个源码/测试文件冻结 hash 的独立限定实现功能门 PASS；复核仅为静态。相关回归使用真实 SQLite、临时 PostgreSQL 与假驱动：47 pass、0 fail、224 断言、8 文件；后端类型、本批 lint、架构检查（58 单元/3372 源码）通过。首轮相关测试 38 pass/7 fail，7 项均因新夹具缺 numeric 目录而在行为前失败，已修正目录权限并重跑；首轮测试类型检查的协议数组字面量也已修正。独立复核发现 Stop 可能覆盖缓存失败终态、丢失原 interruption，已修复并新增两条真实 SQLite 重开回归；真实驱动取消委托疑点经退出等待链静态核对排除，不作为缺陷或实机验收。

一次完整冻结候选门禁、精确提交/CI及本机部署仍待回执。生产数字准入继续 OFF；本批只完成原键持久停止底座，不包含完整 owner 派发、实际原生来源证明、清理删除屏障、consumer、同快照事实或两级 UI。Session 数字副本 closure 仅证明传输终结，不替代实际进程退出；owner 必须同时核停止状态和数字排空后才能清理。CS-R02 与两 RFC 不关闭，实际身份/模型验收没有执行。


### 原键持久停止完整候选门禁回执（2026-09-30）

2026-09-30T03:15:42.642302+00:00，冻结17源码/测试及6文档共23路径的一次完整本地门禁结束：结构、全仓lint、后端/console类型通过；4307 pass／142 skip／0 fail、27307断言、860文件，完整命令957.71秒。全部候选指纹未变，独立限定实现门PASS，相关47/0与224断言通过。只修正文档当前状态及prevented例外、标注设计阶段历史并补本回执，不重复同内容完整门禁。精确提交/CI/本机部署另记；生产仍OFF，实际身份/模型验收及上述剩余依赖未完成，跳过项不计通过。


### 原键停止精确发布与本机部署回执（2026-09-30）

源码 `bebb3d9b3b2a879a8e8ecf9b56b818fc912b15b7` 已精确推送，[CI 36665601664](https://github.com/wangbinquan/CrewStation/actions/runs/36665601664) 六项全部success。已完成2026-09-30T04:11:33.945Z本机升级：storage-contract=1、迁移Job `rfc034-stop-migrate-bebb3d9b` Complete、八组件generation=observedGeneration且Ready=1，公开登录页HTTP200。Runner默认镜像为 `registry.crewstation-system.svc.cluster.local:5000/crewstation/task-runtime@sha256:a5308d4a17749c03afa0fe53c24a5c64fb1cfb8f977b8662ce7560156ee2d88c`；不替换旧执行固定镜像或现有会话。

这只完成持久停止底座，生产开发数字准入仍OFF；实际原生来源证明、owner派发/完整清理屏障、consumer及两级事实/UI继续，CS-R02与两个RFC不关闭。没有进行真实身份/模型验收。下一批限定设计见 [development-native-source.md](./development-native-source.md)，当前仍为设计候选，不声称已采集。

## CS-R02 实际来源第一批接续（2026-09-30）

[实际原生来源底座](./development-native-source.md)限定v2设计与最终30源码/测试路径独立静态实现门PASS；相关73/0、真实Runner适配3/0与精确ESLint通过。首轮漏传开关已稳定红→绿修正。此候选尚待完整check、精确CI和部署；不会关闭CS-R02。生产仍OFF，后续owner固定真实挂载/全派发/删除排空、consumer原key/Pod/持久begin与final校验和原执行原CNY价格历史修订、同快照两级事实/UI仍必须完成。


最终限定来源候选已再次独立门PASS，相关77/0、合同族34/0及精确lint通过。本机最终完整check被4条并行资源迁移未入锁阻断，类型仅余并行resourceAccessModule fixture错误；按共享在制品规则精确发布36自有源码/测试/RFC文档、由干净提交的hosted CI裁决，不宣称本机全量通过。共享STATE/RFC索引以及并行资源/导航输出保持原样后续登记。详见development-native-source最终回执；生产OFF、两RFC仍未完成。


### CS-R02 实际来源第一批精确发布与本机部署（2026-09-30）

源码 `d01ba8223fc08c8b2b70ee4db859e560c2151668` 已精确推送，[CI 36682129650](https://github.com/wangbinquan/CrewStation/actions/runs/36682129650) 六项全部success。2026-09-30T07:30:51.933Z完成本机升级：storage-contract=1、迁移Job `rfc034-native-source-migrate-d01ba822` Complete、八组件generation=observedGeneration且Ready=1；console204、API198、auth96、controller163、events66、Session115、两MCP各62。登录页HTTP200，匿名根路由按现有ForwardAuth返回401；三镜像OCI revision核对源码SHA，固定摘要见[完整回执](./development-native-source.md#精确发布hosted-ci-与本机部署回执2026-09-30)。默认Runner摘要52db50f761af211ce4b766e6a2244c6e1c61af4d8c019fd408f725c44f9b4413。

生产采集仍OFF、sourceScope仍business-tasks。第一批来源证明不等同项目开发消耗已接通；CS-R02后续实际owner派发/挂载约束、停止与数字排空/删除屏障、consumer固定原执行与原CNY价格历史修订、同快照事实及两级UI尚未完成，其他CS-R待办继续。真实身份/模型验收未执行；共享STATE/RFC索引及并行资源工作完整保留，未提交。AW edd56ebe3的主CI与九种默认定时配置正在验证，不将旧候选八绿当新候选全绿；两RFC不关闭。


## 2026-09-30 开发实际来源消费者限定设计 v3

[development-consumer.md](./development-consumer.md)限定v3独立设计门PASS，保留v1三项/v2一项P2失败历史并逐项修正。明确Session独立registration与owner原绑定对拍、实际sourceVerified先于数字完整性、stream游标与每turn完整meter分离、所有普通数字的所选模型证据同页持久化及已ACK旧模型恢复；原价/未知/超预算语义与复制库隔离均有反例。当前仅设计通过，没有消费代码、生产派发、删除屏障或两级事实/UI验收。

此前三份发布/部署回执文档b643e53196e2eea0d61a6160df7f543263c5a561的[CI 36685062165](https://github.com/wangbinquan/CrewStation/actions/runs/36685062165) 已success；本机源码仍为已验证d01ba8223、八组件Ready，生产开发采集OFF/sourceScope business-tasks。AW edd56ebe3主CI和完整E2E已success，WebKit最终终态仍待验收。继续内部消费者及原owner/CNY/排空/正式明细，CS-R02和两RFC不关闭；共享STATE/RFC索引与并行资源工作原样保留。

## 2026-09-30 消费者原选择接口限定实现

[development-consumer.md](./development-consumer.md#原选择接口实现候选2026-09-30)第1项四路径实现门PASS；精确原key下仅从持久intent投影非敏感nativeSelection，legacy省略字段、原绑定和首次CNY受理不变。新增真实PG反例先红后绿，最终11pass/0、96断言；四文件eslint/diff-check成功。一次完整本机check被七份并行未锁迁移、data目录上限和console拓扑文件环阻断，未进入后续阶段，不把它写作全绿，也不改写他人工作；精确源码提交/托管CI另记。

此步不接通完整消费者，不注入生产worker、不启用开发采集，也不关闭CS-R02。独立Session归属、按turn持久来源/模型证据、实际文件分区及原价修订/固定页ACK、原owner派发/清理和两级事实/UI继续。本机源码仍为d01ba8223。AW主CI和九种原默认定时配置已在edd56ebe3全部成功，7886ac97b仅四文档回执、精确文档CI待终态。共享STATE/RFC索引与并行资源/拓扑工作完整保留。

## 2026-09-30 原选择接口测试字面量类型补正

接口提交`54243196a23f8a5f65a5ca2ea5e6820e615dbc09`的[CI36692696016](https://github.com/wangbinquan/CrewStation/actions/runs/36692696016)终态failure：unit/module/console/e2e四项success；干净树arch/lint成功，static类型和gate失败。两个TS2769都在新回归的同一预期对象：nativeSelection.version被推断成number，严格接口要求字面量1。本批只给测试预期version加as const，保持全部原key/关闭后重读/原价/选择/隐私断言；三份生产文件字节未变、此前限定实现门仍适用，不把接口或合同放宽为number。

修正后真实PG同一11项/96断言全部成功，改单文件eslint成功。单独类型检查核对自有错误，精确新提交/六项托管CI另记；没有重复启动已被并行架构在制品阻断的全量check。失败版本未部署，本机仍为d01ba8223；只有新精确提交六项CI全部成功后才能部署。完整消费者/原owner清理/两级事实与真实运行尚未关闭，生产开发仍OFF。AW最新7886ac97b的CI36691067775也已50项全部成功，源码edd56ebe3的主CI与九种原默认定时配置10运行/75作业完整成功回执继续有效。

## 原选择接口精确发布、CI与本机部署回执（2026-09-30）

限定原选择接口/测试类型补正源码 `1d48fb1703744acfc06841e3a34e8f742e8c98bd` 已推送；[精确CI36694912441](https://github.com/wangbinquan/CrewStation/actions/runs/36694912441)已六项全部success：static、unit、module、console、e2e、gate。此前54243196的类型失败、单行as const修正与11项真实PG/96断言、文件lint及单独完整typecheck成功记录保留；三份生产文件内容未因测试类型补正改变。限定原选择接口实现门PASS不扩大为完整consumer PASS。

本机于2026-09-30T09:29:13.385Z完成该源码部署。迁移job `rfc034-consumer-owner-selection-types-migrate-1d48fb17` Complete=True，日志applied=0；原owner与Session数字表存在。八Deployment均generation=observedGeneration、Ready=1，storage-contract=1；默认Runner和三幅镜像OCI revision均严格指向同一完整源码SHA：

| 组件 | generation / observed | Ready |
| --- | --- | --- |
| console | 205 / 205 | 1 |
| cs-api | 199 / 199 | 1 |
| cs-auth | 97 / 97 | 1 |
| cs-controller | 164 / 164 | 1 |
| cs-events | 67 / 67 | 1 |
| cs-session | 116 / 116 | 1 |
| mcp-capabilities | 63 / 63 | 1 |
| mcp-operations | 63 / 63 | 1 |

| 镜像 | 不可变摘要 |
| --- | --- |
| cs-console:dev | `sha256:003194963bc8d1dab45df2384cdcadb03110a1385f034b33f59e52017551dbc3` |
| cs-control-plane:dev | `sha256:5fb9f79845e7b47bfea4e57ae1a817a21b87a00a664021bc867e36236641d026` |
| cs-task-runtime:dev | `sha256:91b61a26f0e573afa78dbdbccbea62d40c4eac3135e85a5d9cc93d31c4f2391f` |

默认Runner：`registry.crewstation-system.svc.cluster.local:5000/crewstation/task-runtime@sha256:91b61a26f0e573afa78dbdbccbea62d40c4eac3135e85a5d9cc93d31c4f2391f`。公开匿名路由核对：`/auth/login` HTTP200、`/` HTTP401符合现有forward-auth合同；没有切换真实身份、调用模型或创建/停止业务验证会话。构建使用git archive的该精确提交，未混入并行资源/拓扑工作；部署前验证原d01组件和默认镜像未变、更新时使用resourceVersion CAS。

生产开发采集仍OFF，sourceScope仍business-tasks；仅原选择接口底座已部署，Session独立registration对拍、按turn固定页/真实文件分区、全部数字所选模型证据的同事务持久、原价修订/ACK、owner派发/完整清理屏障与两级事实/UI继续。CS-R02与两个RFC不关闭。该回执后继只写三份观测文档，不改变已部署源码；后继文档精确CI另外验证，共享STATE/RFC索引与并行输出完整保留。

## 2026-09-30 原键派发能力恢复缺口修正

限定实现首轮FAIL一项P2，首次hello支持但info失败、重连能力消失时会误降级普通启动。真实owner PG两轮与迟到缺能力并发先9pass/2fail；现在info前持久CAS原Pod capabilityPodUid，已知支持不可降级或换Pod，关闭/legacy不能升级，旧owner payload省略新可选字段。新增自有dev-session/0013迁移与锁值，完整共享锁继续原样保留并行引用，不单独推缺依赖的main。最终相关28pass/0fail/0skip、260断言（包含既有11项原价/原键）；本批第一次全量arch的domain→ports三项自有问题已修正并保留失败历史。修正后限定功能复核与一次完整候选门禁待回执；持久结束作业、资源/项目删除全路径许可、production wiring与两级事实/UI继续，详见[原键派发设计与候选](./development-dispatch.md)。

## 限定派发 v3 功能与完整门禁回执（2026-09-30）

v3限定静态功能门PASS，18路径首尾指纹一致，自有dev-session/0013迁移实际SHA-256与锁值一致7b48d83a7fa771c6ac25b90586c5dd16f3c73f0bb5b9ca8e48d7809f0f245ac4。首轮能力消失P2已关闭，没有新的限定功能阻断；该复核未跑测试，也不涵盖持久结束队列、删除许可或production。12个自有TS文件eslint与单独后端typecheck通过，真实owner PG相关28pass/0fail/0skip、260断言及旧原价/原键断言保留。

自有结构/能力修正后该稳定候选仅启动一次完整check：arch、全仓lint、后端及console类型均成功；测试4480pass/143skip/25fail/1error，28,833断言、894文件、690.61秒。18路径未变；此前domain→ports三项自有架构失败及修正历史保留，不能把这次全量写成全绿。25失败在本批以外13份用例：资源升级新删除触发器缺resources.task_volume_safety、命名空间回收超时及其未处理错误、runtime-environment并发配置/镜像目录，以及角色主页/项目资源/限流/按钮/申请面板/导航/接口面。全部自有派发及既有开发owner相关用例通过；保留这些失败与日志，不修正或删除其他会话源码，也不因其后续提交重复全量。整仓最终结果仍需依赖齐备后的clean精确SHA hosted CI。

门禁期间RFC036三笔自有提交推进共享main到492a63d241c59ef3fc892702a30327285e6ddf14，origin/main仍2d4555323；该HEAD变化没有改本批候选。共享锁尚有五份项目删除迁移与本批dev-session/0013未入提交树；先精确本地提交自有源码/迁移/五份RFC文档，整个共享锁留在工作树。其他owner提交其五份迁移且所有引用齐备后才能在短时临界区同步并推送累计提交；不声称已远端发布或已部署。本机当前已验证源码仍1d48fb170，生产开发采集OFF。

[持久结束作业细化](./development-ending.md) v2独立设计门PASS，保留v1登记恢复P2；下一批实现原登记补全、目标行原子状态保护、结束队列/恢复，随后所有删除旁路与两级事实/UI。CS-R02和两个RFC继续In Progress。
