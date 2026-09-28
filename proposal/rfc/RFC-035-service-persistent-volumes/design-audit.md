# RFC-035｜设计自审与补充合同

> 2026-09-28 · 设计自审与补充合同。前两次自审记录了 21 组缺口，作者随后已批准修订稿 D1–D8 实施。以下历史审查结论保留以说明改稿依据；实施及验收状态以 implementation.md／plan.md 为准。
> 第三轮再次按交错时序检查，另发现 DA-15…DA-21 七组组合缺口，补充于 §15–21。前两轮结论保留为历史，当前判断见 §22。
> 本文件是 design.md 的规范性补充。与旧段落冲突处已同步修订；所有改动仍为提案，不是已实现能力。没有另起 session／Agent。

## 1. 发现清单

| 编号／优先级 | 原稿遗漏及后果 | 现有依据／补充位置 |
|---|---|---|
| DA-01／P1 | 写了不存在的 Manifest 数据段、错误 API 路径，planId 也没有目录归属；落地会被剥字段或没有供给入口 | `packages/contracts/manifest/manifest.ts:10–28`、`modules/data/ports/platform.ts:11–14`、`modules/business-task/http/executionRoutes.ts:22–31`；本稿 §2 |
| DA-02／P1 | 把全部旧任务默认为 retain，会改变原 follow-container 的自动清理行为 | `packages/contracts/manifest/tasks.ts:51`、`modules/task-runtime/application/nativeExecution.ts:162–165`；§2 |
| DA-03／P1 | 只留事件水位既不能证明完整终态，也不能保证七天后的日志存在；长暂停任务甚至取不到终态证明 | `modules/session/ports/businessExecutions.ts:3–10`、`adapters/persistence/businessRetention.ts:23–33`、`modules/business-task/adapters/persistence/execution/logRetention.ts:6–19`；§3，D6 |
| DA-04／P1 | 用原 Agent 渲染路径启动归档助手会要求已被停止的父 Pod；先把父任务 released 又会触发清理；旧写者停止证明没有具体生产者 | `modules/task-runtime/domain/ledgerProjection.ts:135–143`、`application/business/workspace.ts:36–50`；§4 |
| DA-05／P1 | 身份属于同一服务不等于当前槽有写权；旧槽可改引用／清单；finalize 与切流／迁移停写没有组合合同 | `modules/business-task/application/execution/source.ts:8–16`、`adapters/persistence/execution/lifecycles.ts:36–41`；§5 |
| DA-06／P1 | 租约排他不足以阻止已发出的 S3 写重试；旧 attempt 可能晚到，临时数据可绕过容量预算 | design §3 只有逻辑租约，缺物理传输身份及暂存计量；§6 |
| DA-07／P1 | 清单引用对象在写收据前可能被删；任务输入 pin、下载授权、失败 pin 释放没有完整状态机 | design §3、8 只写了 pin 原则；§7 |
| DA-08／P1 | 归档助手额度转移未落到资源身份；清理卡住会长期占着已无 Pod 的算力；系统安装和调和器可能双写 | `modules/task-runtime/domain/ledgerProjection.ts:98`、`modules/platform/domain/systemComponents.ts:2`；§4、9 |
| DA-09／P2 | 只有服务 API，却承诺工作台下载／删除；传输进程、大小／超时、错误码、凭证换发和清单分页缺失 | `modules/platform/wiring.ts:529,535`、design §3、7；§8 |
| DA-10／P1 | 应用失联不提交 finalize、清单错误、卷永久丢失、创建未完成都可能永远卡在“自动回收” | `modules/business-task/adapters/persistence/execution/lifecycleAdmission.ts:36–43` 的现有生命周期前提；§10，D7–D8 |
| DA-11／P2 | 对象固定 backendRevision，同时凭据轮换又修改 revision；旧对象可能永远使用失效凭据 | design §2；§11 |
| DA-12／P1 | 只备份 CS 元数据和 S3 不能恢复 AW 自己的 PG；对象写入暂停也未覆盖引用、收据和最终删卷 | storage-selection §5；§12 |
| DA-13／P2 | completed 的定义一处是 PVC 消失，另一处要求 PV／后端释放；ready 不可变也被误读成永不丢失 | design §5 与 storage-selection §5；§9 |
| DA-14／P1 | “排空终结后可回退”忽略仍存对象、引用和新资源种类；旧 API／控制器可能读不懂或漏清理保护 | `packages/contracts/api/resources/resourceRecord.ts:10`、design §9；§13 |
| DA-15／P1 | 清单修订和收据提交分属不同模块，各做 CAS 仍可能同时成功；旧助手的回执可对应旧清单 | design §5–6、本稿 §7；§15 |
| DA-16／P1 | 收据生成后、卷尚未回收前可解除产物引用；“有收据”不足以证明仍有归档副本 | design §6 的产物集删除没有终结状态前提；§16 |
| DA-17／P1 | 要求每个容器都出现 terminated 会卡住从未调度、镜像拉取失败等路径；观测证明的持久归属也未指定 | `modules/cluster-control/wiring.ts:35–64` 通过 ledger 接线、无独立存储；§17 |
| DA-18／P1 | 切槽、备份、项目归档与平台归档混用“停写”，可能阻断回收或让备份期间继续删除 | 本稿 §5、8、12 与 `modules/resources/application/namespaceRetirement.ts:16–19`；§18 |
| DA-19／P2 | D6 写了“导出接口”却没有该合同；分批读取遇日志 TTL 后也不能声称导出了完整日志 | `modules/session/adapters/persistence/businessRetention.ts:23–33`；§19 |
| DA-20／P1 | completed 统一要求 artifactsReady，会令 completed-with-loss 永远无法完成；从未有卷也无法提供删卷证明 | design §5、本稿 §9–10；§20 |
| DA-21／P1 | 新增数据库版本标记不能让 RFC035 前二进制自动拒绝启动；原稿把部署限制写成了不存在的运行保护 | `deploy/local/install-platform.sh` 当前直接应用清单；§21 |

P1 指进入实现前必须消除的设计缺口，不代表当前线上代码新增了漏洞。下面给出可实现的补充，而不是留一句“实现时注意”。

## 2. 契约和兼容基线

Manifest 首期只在 **crewstation/v3 DigitalWorker 的 `spec.data.objects`** 新增严格结构 `{ planId }`；不是扩展一个现有的 data 字段。v2 遇到该声明明确拒绝，不能被 zod 默默剥离；APIProxy／EventProducer 首期也明确拒绝，后续有场景再扩展。新字段和 schema 路径必须进入契约金样。

存储档位目录归 data：管理员创建 `{id,name,backendId,quotaBytes,maxObjectBytes,maxConcurrentTransfers,enabled,revision}`；项目绑定允许的档位，开发者不能填写任意 backendId 或突破配额。发布读取真实源 release 的声明、验证项目授权并幂等建立 production 空间；开发环境独立建立 development 空间。任务固定 spaceId、planRevision、backendPlacementRevision，普通服务多副本只消费同一空间。空间已有数据时换档位只允许同后端容量调整；跨后端迁移必须走运维迁移操作。删 Manifest 声明只撤销该发布的新写能力，不删历史对象。

旧 `completionPolicy` 缺省／存量记录值为 **legacy**，沿用原 volumeMode：persistent 保留，follow-container 仍依原规则删除。新策略只接受 `completionPolicy=archive-and-delete`＋persistent＋完整能力协商；冲突输入返回 422，不自动改另一字段。首期不提供把任意历史任务转成新策略的隐式迁移。

路由以 cs-api 实际路由为准：新增 `/v3/objects/...`、`/v3/business-tasks/:taskId/finalize`；网关外部前缀属于路由配置，不硬编码不存在的 `/api/v3/business/tasks`。operation 查询复用 `/v3/business-tasks/:taskId/operations/:operationId`。

## 3. 终态证明与日志寿命（D6 已批准）

session 在每个 attempt 完整终态入库后发布独立、不可变的 `ExecutionCompletionProof`：taskId、executionId、attempt、incarnation、payloadDigest、lastSequence、resultDigest、complete、持久时间。它只有在完整最终事件和所有此前事件均已入库且投影消费者确认之后才 ready。原始日志过期后仍保留证明；不是简单调用现有会抛 `execution_events_expired` 的 get。未启动即取消用独立的 admission tombstone 证明，不捏造 lastSequence=0 的 finished 执行。

finalize 锁定完整 attempt 集合及 task generation；集合内每条执行必须有上述证明，或经平台确认未启动／已停止的替代证明，并在收据中明确输出是否完整。没有产物不能解释为执行结果已完整。活动／unknown 执行、日志缺口继续阻塞；暂停任务如果首次进入新策略就未支持证明能力，创建时即拒绝。

**建议 D6：长期保存任务摘要、业务 outcome、收据和终态证明；原始逐条执行事件保持现有七天保留语义。** API 的日志过期继续返回 410，并提供已存在的日志产物链接；不把水位当作长期日志副本。需要长期逐条日志的应用必须在保留期内消费现有游标事件接口，把有范围／摘要的 NDJSON 分块写入对象空间并 pin；首期不新增平台全量日志导出作业，断档规则见 §19。它属于显式产物，不默默把所有事件永久保存或自动增加存储开销。新策略未把原始日志全部归档，不得在 UI 显示“全部日志已永久保存”。如作者希望默认全量日志自动归档，需要另定容量、早期归档与失败保留策略，不能到最终关闭才归档已过期事件。

## 4. 停止屏障、辅助环境与额度

作者本轮重申：任务卷跨多个环节 Pod 复用，环节 Pod 回收不等于任务终结。本稿采用 taskId 所有权＋独立消费者集合；不把 archive-and-delete 解释成 follow-container。新增 OS-44 专门验证顺序 Pod 换代和卷 UID／内容不变。当前每 Agent attempt 独立 Pod，命令仍在父 Runner；后续即便改成命令独立 Pod，也不能改变卷寿命。


task-runtime 新增业务工作区终结阶段 `finalizing` 及 finalizationId，不先走 released。该阶段禁用业务 Pod 自动恢复、rebuild、resume 与旧排队执行的物理创建；平台补发任务也需复核 generation 和终结标记。原 task 记录和卷拥有关系始终存在。

停止证据由 cluster-control 观测，通过 resources 公开端口持久保存，task-runtime 引用其 proofId；具体分类和提交顺序见 §17。证明绑定 Pod UID、node UID、任务消费者版本、容器状态、观测 revision 和时间。业务入口冻结且执行输出处理满足屏障后，发送正常终止请求；有证据才移除停止观测 finalizer，不要求进程在收到终止请求前就退出。仅 API Missing 不够；暂停及每个环节退出时均保存证明，不能到最终归档才补采。新策略父／执行／归档 Pod 创建时即携带该 finalizer，不能在删除后补加；旧 Pod 不在本 RFC 批量补改。节点失联、观测断档或已有强删时，没有可核验的节点／存储 fencing 证据就 blocked，管理员文字确认不能冒充停止证明。[Kubernetes 强制终止说明](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)

归档用独立 `archive-execution` 资源身份与 renderer，新增对应 purpose／观测／清理／拓扑映射；**不能复用 `native.execution.workspace` 的父 Pod 存活前提**。准入凭据为原 PVC UID＋当前 finalization revision＋停止证明＋固定助手镜像 digest。只挂工作区 subPath；不用会 root 初始化、修改权限和挂 Runner 私有 journal 的 `businessStorageMounts`。助手不注入生产库 DSN、Git／模型凭据、通用 Runner token、K8s service-account token，也不执行 runtimeImage 的任意初始化命令。文件不需要可执行，只需要原 worker UID／固定组可读；不 chmod 原文件来掩盖权限错误。

需要中转 scratch 时只用有 sizeLimit 的 emptyDir，列入 ephemeral-storage request／limit，归档过程流式且不要求再复制整个工作区。只读挂载不解决其他旧 Pod 的写入，因此不能跳过上述停止证明。

额度以单独 admission reservation 记在 resources：旧父 Pod 尚在时保持原占用，确认停止后可原子把该占用转给助手；中间不能先退额又无条件启动。父已暂停退额则助手正常排队申请一个单位。等待对象存储／额度时不运行助手；助手失败退出后退额并持久等待重试，不长期占一个空 Pod。父和助手两个实际 Pod 若有重叠必须分别计额，不凭逻辑归属合并。全部计算 Pod 退出后即释放算力，后续 PV 清理仅继续占存储，不等 completed 才归还算力。

## 5. 服务切流、冻结与后台推进

普通无 fenced 声明的服务对象访问以真实发布身份、空间授权和引用 CAS 为准，允许其设计内的多副本并发。AW 采用 fenced：改变引用、删除、修改归档清单等需与当前执行 epoch 一致；旧槽只保留授权读取和查询，不能仅凭相同 serviceId 写生产引用。上传中的不可变字节允许完成 staging，但失效 epoch 不能 commit／发布业务引用。

data 在自己的 schema 保存 `object_write_control`（serviceId、epoch、mode、lease expiry、已处理控制版本）；通过公开端口参与 RFC-027 freeze／activate 的持久握手。切流或迁移先冻结 data 的新发布／引用变更，等已受理短事务结束并回执，再允许执行权交接；新 epoch 的 data 激活回执成功之前服务不可获知“全面就绪”。延迟旧事件／旧续租不得回滚 epoch；不能靠异步最终同步窗口放任旧槽写。data 不读 business_task 表，组合根接线既有高层发布控制与低层冻结端口，无跨模块 SQL。

合法 finalize 意图一旦受理，后台对其固定清单的归档和清理不依赖原服务 Pod／短租约持续存活；平台操作 revision 控制其重试。切槽后新实例可查询接续同一操作；改变清单需新有效执行权及 expectedRevision。迁移停写提供的 stopAuthority 只能受理终结／取消，不能新建任意对象引用或物化；受理后平台专用归档权限只可写该操作目标产物，不可访问 AW 业务库。

## 6. 上传的物理尝试、配额和流控制

新增 `object_upload_attempts`，每次接受 PUT 的物理请求都有新 attemptId、key、owner、租约、传输状态、预留字节。禁用会对同一 key 产生不可追踪并发 PUT 的自动重试；未知结果不再次写同一个 key。重新发送的 PUT 分配新 key，已经完成的同一内容可查询原 ready 结果。只有唯一写请求确定结束、该 attempt 已 seal、读回验证通过、owner/revision 有效时才能发布。过期 worker／迟到 S3 响应只更新其未发布 attempt 的观察，不改变已发布对象。

空间逻辑预算和后端物理预算分开：逻辑容量按对象计，物理预算同时计算所有暂存 attempts、ready 数据、验证并发、删除未确认及复制／元数据安全余量。同一上传重试不能共用一笔物理预留；旧 attempt 未确认结束／清理前，其空间不退还。后端整体并发、项目并发、服务并发均使用共享持久租约，不随 API 副本数乘倍；客户端断线中止传输并留下可接续记录。

读回校验无穷重试会占 I/O，按独立后台队列、最大并发与退避执行，不持有 SQL 事务等待网络。硬限额包括单对象、归档总量、文件数、metadata JSON、name／path 长度；超限在冻结业务任务前能预检的先拒绝，归档后实际超过则 blocked，不删卷。单文件大于 1 GiB 首期明确不支持自动分块恢复，清单 seal 时拒绝；需要该能力须先扩合同。

## 7. 清单、引用和物化

大清单不塞单个 finalize JSON：增加 task-scoped `archive-plans`，分页提交（每页最多 100 项且不超过 256 KiB，总量最多 16 MiB／10000 项），相对路径上限 1024 UTF-8 字节，拒绝重复路径／同一目标别名；seal 固定 digest 后 finalize 只传 planId、planRevision、digest 或 noArtifactsReason。无目录隐式递归、无 glob。计划在冻结前可编辑；被受理后按修订修改，已落收据后只读。

data 在 seal／准备阶段为已有 objectId 获取 `archive-pending` 引用，复核归属和 ready 状态；引用未齐则 finalize 不准入。先取得引用，再通过跨模块幂等 prepare／commit 把计划绑定到终结操作；失败的预备引用用 abort／对账回收，不能 TTL 到期无条件拆掉已经被接管的引用。收据发布与引用转为 `archive-receipt` 在 data 的同一事务内完成。文件上传生成的对象从 ready 时就绑定该操作，不留可被清理抢跑的空窗。

输入物化同样走 `prepareTaskReferences(taskId,generation,objectIds)`，原子固定输入集合；任务准入失败经幂等 abort 释放，活动期间禁止应用随意解绑平台 pin。助手下载使用 task／attempt／objectId／digest 范围凭据，并在新物理 attempt 重新换发；不授权 objectKey 前缀、列表或任意 URL。平台不运行包内脚本；AW 包解包必须另外验证成员路径、大小与运行环境。终结清理完成才解除输入引用，收据产物引用保留。

## 8. API、权限与传输承载

服务 API 归 data.http；大流由 cs-api 内的 data-control 适配器承载，验证／垃圾回收作业在 cs-controller 运行。高低层通过 byte-store 端口调用；data-control 不读取 data 表，controller 从 data 的持久任务领取明确后端定位／attempt 输入。controller 不为每份字节另启动 Agent。`cs-api` 和 `cs-controller` 的后端健康、全局传输限流和内存分别验收。

工作台新增用户路由 `/projects/:projectId/object-spaces`、`.../objects/:id/content` 及任务产物集详情。项目有 view 权限者读；开发者可操作开发空间；生产配额／破坏性产物删除／代终结只限负责人或管理员，均记录 actor、reason、expectedRevision。测试访问者沿现有项目授权规则，不因知道 URL 获得对象读取；历史项目归档后的授权使用保留的归属，不能将数据变成公开。用户会话、服务来源 token、内部助手凭证是三条独立验证路径，不能让助手靠伪造 x-cs 头进入通用 API。

助手短期授权绑定 workload UID、operation revision、允许动作、对象集合与字节额度；刷新依赖当前平台作业持有权，轮换后旧 token 对新请求失效。开始请求时即扣占并发／字节，正在流式传输跨过令牌过期可在硬超时内完成；任何发布动作再次验证当前授权。用户下载走平台实时鉴权，刷新页面不丢 operationId。

拟定传输上限：首部／首次数据 30 秒、空闲 60 秒、单次流 30 分钟；元数据 JSON 普通限额 256 KiB。Bun server、网关和 SDK 三层共同配置，不能只改客户端超时。支持单 Range，非法或多 Range 返回明确 416；Range 响应不声称重新验证了整对象 SHA-256，完整校验由读回／scrub 完成；客户端中断及时释放流。这里的时间值已随 RFC 批准，仍需真实传输验收。

错误区分 401（未认证）、403（已知范围内无动作权限）、404（跨归属或不存在）、409（修订／同键内容冲突）、410（日志已过期／已删除内容）、412（能力、冻结或生命周期前提不符）、413/422（传输大小／schema）、429（并发／容量，带 retry 信息）、503（后端不可用）。非重试业务错误不套无限后台重试。新路由、角色、能力开关和 admin 删除／清单修订请求都须有契约金样与 HTTP 反例。

## 9. 资源身份、完成语义和损坏

统一区分 `computeStopped`、`artifactsReady`、`pvcDeleted`、`storageReclaimed`，并保留对应证明而非仅四个布尔值。普通完成、从未建卷和经确认损失完成分别按 §20 判定，不能要求损失分支把 artifactsReady 伪造为 true。只看到 PVC/PV 404 不能报告真实物理字节数。local-path 的回收证明要结合 provisioner 删除结果／节点目录探测，CSI 用其受支持观测；未支持的环境停留 cleaning。算力释放不等存储回收。

系统 Garage 的静态 StatefulSet／PVC 由 deploy 安装器作为唯一声明者，resources 登记安装拥有者和 retain；cluster-management／拓扑观测该身份。运行时 cluster-control 不另生成一份 Garage StatefulSet，也不把系统卷纳入任务 cascade；任务归档助手和任务 PVC 才由 runtime 的公共调和链创建／回收。管理员重启等操作继续走既有公共运维流程。安装／升级必须验证同名已存在对象的所有权及 UID，不认领未知外部卷、不重复扩副本。

ready 表示曾验证且不可被应用覆盖，不保证介质永远不坏。GET 发现对象缺失／校验失败，标记 object-space 与相关收据 degraded，保留引用和缺失记录，不变成 404 后顺手释放预算或写空对象。修复只能从匹配 digest 的副本／备份生成新物理位置，修订有审计；业务 objectId 不变。周期 scrub 和低水位监控为存储运维责任，不能通过本次 PUT 成功取代。

## 10. 终结的异常入口（D7–D8 已批准）

AW 需要在自身数据库同一事务保存业务最终状态＋finalize outbox，使用稳定 requestKey 重放；CS 保留按 taskId／requestKey 找回操作的入口。CS 不知道业务 DAG 的真正最终状态，不能用空闲时间自动判 succeeded／failed；服务下线也不等于业务取消。界面列出未提交终结意图的保留任务，避免声称全部结束都会无条件自动删除。

**建议 D7：负责人／管理员可“代为终结”失去应用接管的任务**，先看清单和停止证据，明确 outcome（通常取消）及原因、输入确认词，再走同一 finalize。已受理操作由平台持续推进；应用重启只需查回执。普通成员不能代终结。它不是跳过归档或强杀未知写者的快捷入口。

在 creating 阶段失败且从未创建原卷／执行的任务，先持久取消所有延迟准入、取得 resource admission tombstone，再生成“从未产生工作卷／产物”的收据；不能只查一次 404。已经存在过卷却丢失的任务必须 `archive_source_lost`，不能伪造空清单结案。

**建议 D8：不可恢复的丢失／损坏／永久无法归档，增加单独“确认数据损失并清理”流程**。只限负责人／管理员，列出原卷、缺失／未归档文件、在用引用与后果，要求原因和确认词；写入 lossReceipt，不生成正常归档成功收据。仍必须证明执行停止，不能绕过节点隔离；归档助手和 PVC 按原 UID 清理。UI 显示 completed-with-loss，永不冒充正常 completed。用户此前禁止自动丢唯一数据仍成立：没有此明确授权就持续 blocked。该流程原稿未设计，须作者批准后才能实施。

## 11. 后端位置、凭据和容量调整

拆成不可变 `backendPlacementRevision`（endpoint／bucket／region／key 命名空间及部署身份）与可轮换 `credentialRevision`。对象固定位置，读写解析该位置当前有效凭据；单纯轮换不要求重写所有对象定位。保留正在使用的旧凭据至有界请求完成，再撤销；强制撤销使在途请求失败重试而不是跳过鉴权。迁移到新位置与换密码是两个操作。

空间上限降低不能低于 ready＋所有临时／删除未确认预留；后端停用可分为禁止新空间、禁止新写、完全离线，读取／归档权限按状态明确反馈。不能先阻止全部对象写入，再要求 in-progress finalize 上传才能删除后端而形成死锁。系统配置和 endpoint SSRF 校验必须限制协议、重定向及允许网络，日志不携带密钥。

## 12. 一致备份与恢复

CS 内部备份屏障不仅冻结 PUT，还要冻结引用变更、收据提交、GC 和 finalization 的删除许可发放。已发出的清理可先排空到可验证状态再截取 PG 快照；不能冻结到一半又让旧作业继续删对象。后台操作持久记录 backup epoch，崩溃后保持门禁，恢复由明确操作接续。

CS 的备份恢复集含平台 PG 对象／引用／收据／任务终态、引用对象及摘要、权限归属和必要密钥／配置。**这不是 AW 整体备份**：AW 自己的业务 PG 还含 DAG、资源版本指针和权限，需 AW quiesce 与同一恢复点的快照。需要恢复运行／暂停任务时还必须有对应任务 PVC 和原生会话的一致快照；首期只承诺 CS 已归档数据恢复，不承诺活跃 AW 工作流灾难恢复。此限制必须显示在运维说明和能力影响清单。

恢复／迁移对象定位在 data 自己 schema 的受控事务中切换，不直接修改另一个模块表。新后端先按快照逐对象校验，再开放 API；目的地已存在不同 digest 拒绝合并。归档产物备份成功不能掩盖未备份的业务数据库。

## 13. 启用与回退门禁

新增 durable `storage-contract-version` 门槛，发布工具检查 API、controller、session、Runner／助手和 console 的兼容版本集合。先部署能识别对象、finalizing、archive-execution、停止证明和回收许可的新版本，再开启空间／新任务策略；旧控制器完全退出前不启用。版本门槛由本次更新后的部署入口以及理解它的新进程检查；不能声称它可以直接阻止旧二进制启动，具体保护边界见 §21。

**首次启用对象空间后，首期不支持直接回退到 RFC-035 前版本，即便没有正在终结的任务。** 新 ready 对象、引用、历史收据和系统资源仍需要新合同。关闭新准入是应急开关，不等于允许删 schema 或回退旧程序。回退只能在本合同兼容的补丁版本间进行；真要退回旧功能必须另行维护导出／迁移或全套一致恢复，不在本 RFC 自动提供降级工具。该能力影响已加入 proposal。

## 14. 第二轮交付边界（历史）

本轮仅补写设计和验收，不运行功能测试、不修改生产代码、不改真实身份或资源。所有编号保留，新增 OS-30…OS-44 用例对应上述缺口。D6–D8 未批准；本自审结论仍为“待作者裁定后复核”，不声称“已经没有任何遗漏”。

## 15. 清单修订与收据提交的唯一裁决

反例：business-task 接受清单 R2，旧助手同时让 data 提交 R1 收据；两个模块自己的 revision 都合法，最终可能按 R1 删卷却向用户展示 R2。不得以跨模块调用成功顺序代替原子裁决。

data 增加 `finalization_bindings`，以 finalizationId 唯一，记录 taskGeneration、volumeUid、finalizationRevision、planId／planRevision／digest、状态及 receiptId。**修订清单与提交收据必须锁定同一 binding 行**。taskGeneration 固定受理时的任务身份，finalizationRevision 只随合同变更递增；workerLeaseSequence 只表示作业接管，不改变清单。服务 controlEpoch 用于受理权限，不因切槽使已受理的归档失效。

1. business-task 接受修订意图并标为 revising，暂停新助手／清理准入；以持久 outbox 请求 data CAS 替换 binding，先持有新清单全部预备引用。
2. 若旧收据先提交，data 拒绝修订并返回已有收据；business-task 恢复到该收据对应的归档状态，向修订调用方返回 409，不能假称修订成功。
3. 若修订先成功，旧助手可完成在途 staging，不能提交旧收据、激活删除许可或发布旧清单引用。收到 data 回执后 business-task 才发布新 revision；丢回执按相同 requestKey 查询接续，不反向恢复旧 binding。
4. 旧助手经停止证明退出才申请新助手；旧结果仅在 digest、归属和新清单均匹配时复用。去掉的 pending 引用在确认无旧作业可提交后释放。任一处断电都可按 binding 和 outbox 对账，不新增跨 schema 事务。

收据以 finalizationId 唯一，提交后 binding 不再可修订；task-runtime 取得与它匹配的 cleanup permit 才能投影卷 absent。所有旧回执必须携带原 revision，不能由接收者补成当前值。

## 16. 归档副本在回收期间的保护

收据提交同一 data 事务创建 `finalization-guard` 引用，覆盖本次全部有效归档对象。该引用独立于用户可删除的 archive-receipt 展示关系，由平台释放；因此不能通过先删产物集再删卷，制造“有收据但两边数据都没了”。产物集销毁在普通 completed／completed-with-loss 以前返回 412 `finalization_in_progress`，UI 给出阻塞操作。回收完成通知丢失只会多保留 guard，由持久对账释放，不用 TTL 猜测。

delete permit 绑定 receiptId、finalizationRevision、原 PVC UID 和 data 清理许可。发许可前检查所引用对象仍 ready、未降级且后端满足已协商耐久等级；已发现丢失或后端离线则保留卷并阻塞。许可持有期间禁止平台主动删除这些对象或切换其物理位置；后端迁移先排空许可。`delete-started` 一旦持久登记，不允许清单修订，删除未知结果按原 UID 对账，不重新开放业务写入。

这能阻止平台自身的并发删除，不能把“健康检查→K8s 删除”变成跨系统原子事务。最后一次检查后的介质突发故障依赖副本和备份承受；不能据此承诺 RPO=0。已完成任务后来发现对象损坏，保留业务／清理历史并显示 degraded，不虚构工作卷恢复。D8 的损失许可另按 §20，仍保护已成功保存的那部分产物。

## 17. 停止证明的分类、持久化和防重建

不能以“所有 spec 容器都有 terminated 状态”作为唯一算法：未调度 Pod 没有节点，镜像拉取失败时业务容器可能根本没有启动。采用明确证据类型：

| 情况 | 可接受证据与动作 |
|---|---|
| 从未创建 Pod | runtime 取消所有该消费者的准入和延迟创建，resources 持久 admission tombstone；不是单次 GET 404 |
| 已创建但从未分配节点 | 带 finalizer 的同 UID Pod 已进入删除流程；重新读取确认 nodeName 仍为空、无容器运行记录、无待决物理创建；保存 never-scheduled 证明 |
| 已分配节点、正常退出／启动失败 | 支持的 kubelet／容器运行时终止观测，包含 init、业务、sidecar 和获准的调试容器；已运行者均退出，从未运行者明确记 never-started。Pod phase 单独不作证据 |
| 节点失联、状态缺口、强删或陌生挂载者 | unknown；恢复可信观测或取得已支持的 fencing 证明，否则保留卷并阻塞 |

Kubernetes 会为丢失节点上的 Pod 标记 Failed，因此不能只看该值认定写者退出；finalizer 只保留 API 证据，不自行停止节点进程。上表是待实现的观测分类，必须在支持的集群版本验证后开启能力。[Pod 生命周期](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)、[Finalizer 语义](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/)

cluster-control 用 resources 公开端口提交不可变 `workload_stop_proofs`；resources 持久化成功后才允许 cluster-control 以 UID／resourceVersion 前置条件移除自己的 finalizer，保留其他 finalizer。没有回执就重放相同 proofId，不先去掉保护。task-runtime 保存 proofId 与消费者身份，不依赖观测缓存或已被删除的 Pod 查询。正常平台清理、暂停、环节完成和归档助手退出共用此机制；整个任务完成前不清掉历史证明。

最终关闭还需封存完整消费者集合及创建许可。每个消费者采用不可重用的 Pod 名称／身份；未完成取消握手的 create 请求必须对账。新策略 Pod 在挂载 `/work` 的容器运行前须取得该消费者仍有效的启动准入，平台初始化写入也位于这道门之后；task 已 finalizing 或该 attempt 已关闭就拒绝普通执行，只允许当前专用归档身份。否则旧 controller 的迟到 create 即便生成不同 Pod UID，也可能在收据后复活写者。准入授予与关闭使用同一消费者锁：先授予就必须把该 UID 计为可能写入并取得停止证明；先关闭则拒绝，不能用启动票据过期假定退出。启动门使用平台范围凭证，不新增业务 K8s 权限，也不代替旧进程停止证明；管理员绕过平台创建任意挂卷 Pod 属外部越权，检测到后保持 unknown。

## 18. 各种冻结的作用范围与优先级

冻结原因分别持久化，不能用一个 mode 互相覆盖；判定取所有原因的交集。备份／后端迁移屏障优先，随后是任务终结和服务执行权。权限失败不自动当作存储失败重试。

| 场景 | 应用新写／新任务 | 已受理固定清单的归档 | 产物删除／最终删卷 |
|---|---|---|---|
| 服务执行权交接或应用数据库迁移 | 旧 epoch 禁止，新 epoch 等握手 | 平台 operation 权限可继续，不访问应用 PG | 可按原 operation 完成 |
| 项目归档／服务下线／移除 Manifest 声明 | 禁止 | 已受理操作继续；授权管理员可按 D7 提交明确清单，未终结任务不自动判取消 | 正常保护不变，命名空间删除须等卷回收 |
| 后端禁止新空间／新上传 | 分别按状态拒绝 | 已预留的终结作业保留受控完成通道；强制完全离线则 blocked | 离线不发新的正常删卷许可 |
| 一致备份／对象位置迁移 | 禁止提交新持久变化 | 在途流可结束 staging，但验证发布、引用和收据提交暂停 | 新删除许可、对象 GC 暂停，已有物理删除先排空并记录结果 |

data 的 epoch 副本是写入参与者，不能独立授予执行权。claim／renew／release 同样进入持久握手：使用单调 controlVersion，data 认可的有效期不得超过权威租约；对外返回全面可写前取得 data ACK。旧续租、延迟激活不能越过 freeze 或恢复旧 epoch。释放／抢占旧权前排空其已准入短事务；不以无限期本地缓存验证权限。

备份进入 frozen 必须等各参与者 ACK 以及全部已发删除许可确定成功／取消；未知删除结果阻塞快照，不超时假定取消。退出备份只解除同 backup epoch 的原因，不误解除任务 finalizing 或项目归档。生产算力档位停用禁止新业务计算，但保留已受理清理用的固定平台助手；助手仍正常占并发额度并可排队，不因原应用凭据过期失去换发资格。

现有命名空间退休已拒绝未结束资源及存留 PVC（`resources/application/namespaceRetirement.ts:16–19`），本稿沿用这项保护，不能把它误报成现有漏洞；新增 archive-execution／finalizing 需进入同一 blocker 集合。项目已归档时，保留原归属授权供产物读取和负责人／管理员操作，不能要求先恢复服务上线才能回收。

## 19. 日志导出的真实合同与代终结预览

撤回 §3 中“已有导出接口”的暗示：**首期没有新增平台全量日志导出作业**。按已批准 D6，由应用及时消费 RFC-027 已有游标事件接口，记录 execution／attempt、首尾 sequence、完整性和内容摘要，按有界 NDJSON 对象上传本 RFC `/v3/objects/uploads` 并 pin。之后把这些 objectId 放入终结清单；不是让归档助手在终结时回查已经过期的原始日志。

分页途中遇到 410、缺序号或重连断档，应用必须记录 export-incomplete；可以保留明确标记的部分日志，不能生成 full-log 声明。CS receipt 仅核验上传摘要与应用声明的范围，不替应用证明每条日志完整。要求永久完整日志的应用必须在自身接入方案提供持续消费／缺口补偿并验收，默认能力仍只是七天原始日志与长期终态证明。本 RFC 不顺带新增无限期日志保留租约。

D7 预览的是明确提交的文件路径／已有对象、卷身份、执行状态和归档后果，不声称自动列举了暂停卷的全部文件。管理员必须选择现有 seal 计划或提供新显式计划；路径未知时保持待补清单，不默认为空产物。文件是否存在由停止屏障后的只读助手核实；预览不先唤醒业务 Runner。发现 required 缺失允许按 §15 修订并重新确认。

## 20. 普通完成、空任务和损失完成

业务 outcome、归档 disposition 与资源 phase 独立。资源 phase 可以 completed，但 UI 必须按 disposition 区分正常完成与 completed-with-loss；不能用一个布尔 artifactsReady 覆盖所有终态。

| 分支 | 数据证明 | 资源证明 |
|---|---|---|
| 正常归档／显式空清单 | 不可变 archiveReceipt；空清单保留 noArtifactsReason；有效对象全部验证及受保护 | 全部消费者停止，原卷删除和供应器回收确认 |
| 创建失败且从未有卷 | no-admission／never-provisioned 墓碑封住迟到创建；记录无产物原因，不伪造 archive 成功文件 | 无已创建消费者／卷，资源处置为 never-provisioned；pvcDeleted／storageReclaimed 标不适用，不显示释放了虚构字节 |
| D8 明确损失完成 | 与当前清单修订绑定的 lossReceipt，列已保存对象与缺失文件／结果／事件、授权人和原因；缺失项永不标 ready | 仍需全部消费者停止；存在的卷按原 UID 清理，已经丢失的卷经供应器确认处置或保持 cleaning／unknown |

D8 可以确认不可恢复的事件／结果缺口，代替普通完成的数据完整性证明；**不能代替任何进程停止或存储回收证明**。普通 finalization 遇同样缺口仍 blocked。接收损失许可与普通收据／清单修订在同一 data binding 上互斥裁决，不允许晚到的完整收据覆盖已经确认的损失历史，也不允许新损失授权改写已完成的正常历史。所有清理分支均保留可核查的证明来源。

## 21. 回退保护可落实的边界

RFC035 前二进制没有读取 storage-contract-version 的逻辑，新加一行数据库记录不会改变它。首期保护落实在**本次更新后的官方安装／升级／回退工具**：变更镜像和执行迁移前，读取持久特性版本、核对目标不可变镜像的兼容声明；状态不可读或声明缺失就拒绝。后台自动镜像回退也用同一检查。RFC035 起的新进程另外检查版本并拒绝不支持的状态。

启用新能力前确认旧 API／controller／session 消费者全部退出，Runner／助手版本满足新策略；不是只看 Deployment desired image。采用可核对的 Pod UID／镜像 digest 与进程能力注册，无旧作业租约后才打开开关；失败则保留新特性关闭，旧业务可按原合同运行。

管理员绕开工具直接部署旧镜像／运行旧程序，首期不承诺靠旧程序自行阻断；这是受支持运维边界，不能写成已具有外部集群准入保护。本 RFC 不为此默默引入额外 admission webhook。验收明确区分：官方入口拒绝旧镜像、新程序启动检查、启用前排空旧消费者，而不是虚构“所有旧程序都懂新门槛”。

## 22. 第三轮完整性结论（批准前历史）

第三轮发现的七组缺口已补成具体设计合同，新增 OS-45…OS-51 交错时序验收；不新增 D9 之类产品选择。当前版本可供作者审视，但**尚未通过实施门禁**：D1–D8 仍是待审提案，尤其 D6–D8；Kubernetes 停止观测／迟到创建保护、供应器回收、Garage 兼容／生产耐久和流量上限仍需实现与真实证据。设计审查不等于功能验收，也不宣称能穷尽所有故障。
