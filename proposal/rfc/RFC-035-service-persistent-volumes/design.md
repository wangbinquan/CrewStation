# RFC-035｜技术设计

> In Progress · 2026-09-28 · 作者已批准实施、推送及本机部署，并追加真实对象存储可观测界面。以下为目标合同，不代表全部已可调用；实现进展见 plan.md。

本稿经两次补充自审累计记录 21 组缺口；[design-audit.md](./design-audit.md) 是本设计组成部分，接口／权限／停止证明／回收／回退合同以同步修订后的两份文档共同为准。最新一轮重点是清单／收据并发、产物删除、停止证明、冻结组合和异常完成；D1–D8 已随本稿获批。

## 目录

- [1. 结构与责任](#1-结构与责任)
- [2. 存储身份与配置](#2-存储身份与配置)
- [3. 对象数据模型与接口](#3-对象数据模型与接口)
- [4. 任务策略与终结接口](#4-任务策略与终结接口)
- [5. 持久终结状态机](#5-持久终结状态机)
- [6. 归档安全、恢复与删除边界](#6-归档安全恢复与删除边界)
- [7. 资源中心和工作台](#7-资源中心和工作台)
- [8. AW 接入合同与交付边界](#8-aw-接入合同与交付边界)
- [9. 上线、迁移与回退](#9-上线迁移与回退)

## 1. 结构与责任

| 层／位置 | 拥有的职责 |
|---|---|
| L1 resources | 对象空间与任务卷的统一身份、期望、实况、条件、操作与 SSE；不另建隐藏资源台账 |
| L2 data-control | 对象后端连接、探测、不可变字节写读／删除适配、校验和与失败重试；不决定业务归档范围 |
| L2 cluster-control | 归档辅助 Pod、Secret 与 PVC 的唯一 Kubernetes 写入和观测，删除带 UID 前置条件 |
| L3 data | 后端登记、逻辑空间、上传、对象元数据、配额预留、引用和归档收据的领域规则；只读写 data schema |
| L4 task-runtime | 任务卷拥有者、冻结准入、执行停止证明、归档辅助环境、最终资源清理及配额 |
| L5 business-task | finalize 的业务权限、幂等、generation/fence、持久阶段和外部查询合同 |
| L5 session | 通过端口提供执行终态及事件持久水位；不跨同层内部 import |
| L7 platform／apps | 接线与进程承载；不放归档编排业务逻辑 |
| packages/contracts、runtimes/task、console | 严格请求 schema、可信归档工具、复用工作台详情和资源图 |

现有分层依据 `docs/engineering/repository-structure.md:185–210`。跨模块由公开 API／端口接线和持久事件协作，不做跨 schema SQL 或跨模块事务。data-control 作为数据后端适配器扩展；业务控制仍归 data。沿用原层级，无 ADR 例外。

## 2. 存储身份与配置

默认后端为 **Garage v2.4.1**，版本依据、候选对照、S3 子集、本机系统部署、生产可靠性和备份见 [storage-selection.md](./storage-selection.md)。本机可选安装属于系统基础设施，生产登记独立 Garage 集群；并非要求业务自行架设存储服务器。

新增后端记录 backendId、endpoint、region、bucket、pathStyle、Secret 引用、revision、健康状态。 同时记录 durabilityProfile（dev-only／replicated）与验收证据修订；节点数不能由业务请求自行声明。单节点 Garage 仅可绑定显式 local/dev 部署配置中的空间和测试任务；正式生产配置拒绝 dev-only 后端，不因为业务槽名是 prod 就把本机演示误标成生产耐久。新增能力位返回耐久等级，未完成多节点证据的后端不宣告 replicated 可用。管理员只能登记可信 endpoint；应用不能指定任意 URL。凭据加密保存／注入，不进入 DTO、事件、日志或业务 Pod。位置变更产生 backendPlacementRevision，凭据轮换单独产生 credentialRevision；现有对象固定原后端位置及 key，不把换配置误认为搬迁数据。

Manifest 在 v3 DigitalWorker 新增 `spec.data.objects: { planId }`；现状没有该 data 段。v2 和其他 kind 遇到新字段明确拒绝，不静默剥离。档位目录、项目授权、空间供给和发布快照见 [自审补充 §2](./design-audit.md#2-契约和兼容基线)。逻辑空间唯一键 `(projectId, serviceId, env)`；production 的两个槽共用空间，development 独立（下文 prod/dev 为简称）。对象实际 key 使用不可猜测 ID 和平台生成前缀，应用仅传显示名，不传 bucket/key。删除再创建服务不继承旧空间身份。

服务经现有平台 API 地址和可信服务身份访问；空间绑定由源服务解析，生产／开发权限不由请求参数自行选择。开发对生产数据的诊断／变更访问沿用显式绑定授权，不能靠填写 env=prod 越权。来源检查适用于上传、读取、列表、引用和删除所有入口。

开发会话在开启时从所选分支的 v3 Manifest 固定对象档位；保卷重建和开发 CLI／Agent 继承该快照，生产发布不替它选档位。资源调和时仍验证项目授权并供给 development 空间，向预览和开发执行环境注入同一空间地址。无效 Manifest 仍可开启修复会话，但不启用对象空间。对象请求需要网关签名的任务 ID／Pod UID／源 IP，与当前 Pod 索引及运行时准入同时匹配；子执行还核对父会话当前实例。会话释放、断连、重建或 Pod 被替换后，旧来源不再可用。普通业务任务不能借此取得开发或生产的通用对象权限。

首期每个空间固定一个后端修订；后端停用阻止新空间与新上传，已有对象仍可按旧修订读取与执行清理。凭据轮换先探测新凭据，再原子切换，保留审计。已引用后端不可直接删除。物理 bucket 的持久化和备份由管理员负责；本 RFC 后续实现提供本机 Garage 安装与运维规程，不自动搭建生产三故障域集群。

## 3. 对象数据模型与接口

拟新增 data schema 记录：

- `object_spaces`：归属、后端修订、容量上限、已使用／预留字节、状态。
- `object_uploads`：uploadId、requestKey、请求摘要、spaceId、预期长度／SHA-256、临时 key、状态、租约、重试时间。
- `objects`：objectId、spaceId、不可变 key／可空的后端版本标识（Garage 不依赖 S3 VersionId）、SHA-256、size、状态、显示名、mediaType。
- `object_references`：objectId、ownerType／ownerId／revision；活动任务、材料版本和归档收据引用均阻止删除。
- `archive_receipts`：taskId、generation、finalizationId、manifestDigest、对象列表、事件水位、验证时间；提交后不可改写。
- `finalization_bindings`：data 对同一终结清单修订、收据和清理许可的唯一裁决记录；与作业租约分别版本化。

所有跨存储副作用通过持久作业接续。数据库事务只提交元数据、配额预留及 outbox；S3 调用在事务外完成。PG 提交失败时对象仍在 staging，重试可核对并接续；不能上传后直接把 ready 当作事务成功。

拟新增服务合同位于 `/v3/objects`（cs-api 路径，不含外部网关前缀）；物理尝试、工作台路由和传输承载见 [补充 §6–8](./design-audit.md#6-上传的物理尝试配额和流控制)：

| 操作 | 请求与响应 |
|---|---|
| POST `/uploads` | requestKey、name、size、sha256、mediaType → uploadId、上传状态；预留容量 |
| PUT `/uploads/:id/content` | 单个有界流；验证身份及固定长度／摘要 → verifying；不把整文件缓存在 API 内存 |
| POST `/uploads/:id/commit` | requestKey → operationId；验证后持久发布 objectId，可重试查询 |
| GET `/uploads/:id` | 上传／验证进度及 ready objectId；失败原因与是否可重试 |
| GET `/`、`/:id`、`/:id/content` | 分页元数据、详情与流式下载；下载仅 ready 对象，支持 Range |
| PUT／DELETE `/:id/references/:ref` | 同服务的稳定引用幂等创建／释放；任务／收据引用仅平台生命周期可写 |
| DELETE `/:id` | expectedRevision、requestKey；被引用返回冲突，无引用进入删除作业 |

平台第一期代理字节传输，不发通用 bucket 凭据，也不把持久 URL 当授权。下载文件名经转义，默认附件下载；业务若要展示 HTML 须自行安全渲染。平台内归档助手使用绑定 taskId、operationId、epoch、目标上传的短期凭证，不具备通用服务读写权限。

字节端口用具有 TCP 背压的独立 HTTP listener；不能仅靠业务层 ReadableStream 宣称内存有界。每进程最多同时承载 8 个传输请求，超限在读 body 前返回 429／Retry-After，普通 API 端口独立；这层资源保护叠加数据库中的空间／项目／后端／全局额度。当前固定 Bun 运行时下，S3 大对象读回按最多 8 MiB 的顺序 Range 请求推进，消费方暂停时不继续请求全文件；小对象维持单次 GET。每段验证 Content-Length、Content-Range 和固定总长，完整文件另做原有 SHA-256 校验。对外仍是一次完整／Range 下载，不改变对象协议，也不引入服务磁盘缓冲。真实 TCP 停读、取消、大文件并发和 RSS 验收覆盖整个链路。

对象状态：`staging → verifying → ready → deleting → deleted`，验证失败不能读取。服务端对上传流计算 SHA-256 和长度，落存储后再次读回计算校验，才能 ready；不使用 ETag 充当 SHA-256。临时 key 和最终对象均禁止调用方覆盖；同 uploadId 并发写用持久租约串行化，迟到写入只能落到该 attempt 的独立临时 key。发布时 CAS 绑定一个验证成功的 attempt key 作为最终不可变 key，后台回收输掉的临时对象；不依赖 bucket versioning、S3 条件写、Object Lock 或文件 rename。

容量按预留＋ready＋删除未确认的字节计算；删除真实确认后才退额。相同 requestKey 和请求摘要重放返回同一记录；不同内容返回 409。引用添加与对象删除使用同一对象行锁，删除已受理后禁止新引用，避免 GC 与使用竞态。ready 对象默认不自动到期；应用先 pin，再发布自己数据库的版本指针，旧引用释放单独重试，宁可多留对象，不悬空指针。

已批准的初始边界：单对象 1 GiB，单归档 10 GiB／10000 文件，单服务并发传输 4，单空间默认配额 20 GiB；本机后端总逻辑预算 60 GiB；管理员可在受控范围内调高。流式请求独立长传输超时和并发配额，不复用普通小 JSON 限制。不支持首期断点上传，失败重传整个对象；将来扩展分片不改变 objectId 语义。上传空闲 24 小时后清理 staging，先确认写租约过期且每个物理 attempt 无在途写者（未知结果仍需对账），不能清理仍在提交的内容。后端残留和失配显示 Failed／Unknown，不假称删完。

传输承载落实为同一 cs-api 进程的独立 8087 监听，最大请求体 1 GiB、连接空闲 65 秒；实际字节流另按 60 秒空闲和 1800 秒总期限中止。网关 `objects` 入口 8088 只开放经服务身份鉴权的 `/v3/objects`，读／写总期限 1805 秒，供给的 `CS_OBJECTS_URL` 指向该入口；可通过平台安装配置 `CS_OBJECT_API_URL` 改用等价的 TLS 入口。普通 API 仍走原监听和期限。控制台附件 GET 走用户身份链与独立传输并发上限，转发到 8087，不占普通 API 的用户并发计数。长入口不开放业务执行和后台设置路由。

## 4. 任务策略与终结接口

工作卷所有者是业务 taskId；执行 Pod／attempt 只是消费者。**Pod 生命周期与任务卷生命周期独立**：某环节完成、Pod 崩溃替换、暂停、重试和环节交接均不释放 PVC；卷也不能用任一消费 Pod／Job 的 ownerReference 触发级联删除。只有任务的 finalizationPermit 或经明确批准的 lossReceipt 许可可发出最终卷释放。

当前实现的事实边界：`subtasks.ts:46` 仅 Agent 创建独立 runtimeTaskId；`commandDispatch.ts:19–26` 把命令发给父任务 Runner；`agentDispatch.ts:82–89` 与 `nativeExecution.ts:143–152` 回收 Agent 环境而保留工作区。因此本 RFC 不把“所有环节已一环节一 Pod”写成现状，也不借此自动重构命令执行策略。无论哪种执行方式，后续消费者使用原 PVC UID，绝不能在环节之间补建同名空卷。


任务创建拟增加：

```json
{"requestKey":"aw-create-1","taskContractVersion":"aw/next","volumeMode":"persistent","completionPolicy":"archive-and-delete"}
```

新策略由 capabilities 中 `objectStorage`、`taskFinalization` 能力位明确协商，并要求空间就绪。旧客户端字段缺省与旧记录均按 `legacy` 解释，继续依旧 volumeMode 行为：persistent 保留，follow-container 照常清理；不统一回填 retain。新模板示范 archive-and-delete。该策略仅用于业务父任务，不用于开发会话、档位测试或 Agent 子任务自己的共享卷。

新增 `POST /v3/business-tasks/:taskId/finalize`，请求包括：

- requestKey、expectedGeneration、fence 或既有合法 stopAuthority。
- outcome：succeeded／failed／cancelled，由所属应用声明，并保留原业务事件。
- archive：已 seal 的 task-scoped planId、planRevision 和 manifestDigest；计划分页提交显式 `/work` 相对普通文件和本服务 ready objectId 引用，受理前先获取预备引用；允许明确 noArtifactsReason 的空计划。
- 单文件 required=true 为默认；optional 文件缺失记录为 omitted，收据中保留原因，不能静默遗漏 required 文件。

返回 202、operationId；查询返回业务 outcome、phase、phaseState、可重试错误、nextRetryAt、归档收据和资源清理情况。不得通过把任务 DTO 的 failed 改为 closed 丢掉原业务结果。`closed` 仅表示终结回收完成；业务结果与资源状态分栏保存。

finalize 在所属服务事务中校验执行权、generation、合同固定和幂等键，冻结该 task 的新执行准入，持久写入终结操作与归档清单版本。冻结与子任务受理共用原子准入锁，两个并发请求只有一个先成功。同键同内容重放不增加 generation；不同清单／outcome 返回 409。之后拒绝 resume、retry、材料写入、消息及新子任务；查询和必要的 cancel／停止确认保留。

归档策略任务的旧 close 明确返回 412 `finalization_required`，不能旁路删卷；旧 legacy 任务仍按各自原规则走 close。强制管理回收、保留期清理、项目归档也必须经过相同保护，不能绕过持久收据条件。针对不可恢复数据损失的独立确认流程按已批准 D8 执行；每次实际处置仍须负责人／管理员明确确认，绝不自动绕过。

## 5. 持久终结状态机

```text
requested → draining → archiving → archived → cleaning → completed
                ↑          ↑                       ↑
          阻塞等待证据   失败重试／修正清单          清理重试
```

阶段单调推进；错误单独存 phaseState=blocked/retrying，清单切换用 revising，不把它们当成新的业务终态。taskGeneration、finalizationRevision、planRevision 与 workerLeaseSequence 分别固定任务身份、终结合同、清单内容及作业持有者；异步回执必须携带原值。服务 controlEpoch 只管受理权限，不随切槽废弃已受理的后台操作。租约用于排他推进，不作为旧进程已停止的证明。

`requested` 先冻结 runtime／resources 的新供给准入，再固定原卷身份。受理时 UID 为空只表示尚未知晓，不能作为未建卷证明。已发出 PVC 创建请求而回执未知时持续阻塞；资源中心确认迟到的原 PVC/PV 身份后，由内部观察端口在归档 binding 创建前一次性固定 UID。固定后禁止置空或替换。只有冻结后确认从未发出供给请求，才允许记录 null 的未供给事实；未获得执行环境的任务还须留下永久准入墓碑。身份未确认前不能抢先通过清单修订建立 null 卷绑定。

1. **draining**：禁止新工作，列出尚活动／未知的命令和 Agent。应用显式取消并等待确认，平台不凭 finalize 自动杀死它们。session 提供覆盖所有 attempt 的完整终态证明（含最终 result 与连续水位、投影确认），证明独立于七天原始日志寿命长期保存。缺序号、未知进程或节点失联时保持 blocked。
2. **隔离写者**：完成 Runner 事件与执行日志持久 ACK 屏障后，停止父 Runner 和所有共享该卷的执行 Pod，确认实际退出并确认卷不再有其他写者。仅控制面删掉 Pod 记录、lease 过期或 API 查不到旧 Pod，不能证明失联节点停止；这种情况需节点／存储 fencing 证据，否则不启动归档。可信停止证明生产者及暂停时保存规则见 [补充 §4](./design-audit.md#4-停止屏障辅助环境与额度)。
3. **archiving**：task-runtime 保持父业务记录为 finalizing，为原 PVC UID 申请独立 archive-execution 的固定镜像归档辅助 Pod，按卷拓扑调度、以只读方式挂 `/work`，不运行应用任意命令。暂停任务可直接进入该路径，不偷偷恢复业务 Runner。助手只读选定文件，流式上传，通过平台适配器验证 ready；每页最多 4 个文件并行，仍受对象空间额度约束。失败后停止安排后续文件，等当前操作结束再报告失败；所有文件的持久确认齐备才提交 complete。缓存和 native session 不默认打包。该 renderer 不复用要求父 Pod 活着的 native 路径，不挂 Runner journal，不执行原镜像初始化；只注入归档最小权限。
4. **archived**：data 锁定 finalization binding，原子写入不可变收据、对象引用及 finalization-guard；包括原 task generation、PVC UID、清单摘要、每文件摘要／长度／可选缺失记录、已有对象、执行事件水位。清单修订与收据提交必须在同一 binding 上互斥，跨模块各自 CAS 不足以保证安全。business-task 通过幂等端口确认收据已持久保存，不能凭助手一句「成功」授权删除。
5. **cleaning**：先停止并确认归档 Pod、Secret 与所有旧消费者退出，再由 task-runtime 对自己拥有的卷发最终释放意图，经 resources／cluster-control 删除匹配 UID 的 PVC；不由 business-task 直接调用 K8s。
6. **completed**：普通归档核验 computeStopped、artifactsReady、pvcDeleted 和供应器确认的 storageReclaimed。从未建卷用 never-provisioned 墓碑，D8 损失完成用 lossReceipt 替代缺失数据的完整性证明；二者不能虚报 artifactsReady 或已释放字节，详见 [补充 §20](./design-audit.md#20-普通完成空任务和损失完成)。只看到 API 404 不报告物理字节已释放。计算 Pod 确认停止后及时退算力，等待存储清理不继续占算力；任务、收据、产物引用与审计保留。

要满足自动释放底层空间，创建 archive-and-delete 任务前必须验证 StorageClass 支持 Delete 和可观测回收；不支持时明确拒绝选择该策略。PVC 已删而 PV／后端删除仍未确认时，展示「卷声明已回收，存储释放待确认」，操作保持 cleaning。外部观测不足时不虚报物理字节已经释放。

归档辅助 Pod 使用独立资源 admission reservation：只有原父 Pod 确认停止才可原子转移它占用的额度；父已暂停退额则助手重新申请一个单位，额度不足持久排队。实际重叠的两个 Pod 不得只计一个。平台系统助手不启动模型／Agent；所有工作和资源占用在台账可见。不会为绕过额度开隐藏执行通道。辅助 Pod 退出后释放它实际占用的额度；不能提前释放仍活跃 Pod 的占用。

## 6. 归档安全、恢复与删除边界

归档路径只允许 `/work` 内相对普通文件；拒绝绝对路径、`..`、符号链接、设备、FIFO、socket 和跨挂载读取。目录由应用枚举文件，不接受全盘 glob 或任意 tar 命令。助手按目录 fd／禁止跟随链接方式打开，执行前后核对文件身份与长度，检测变化返回阻塞；不归档 Runner 私有 journal、Secret 及原生会话目录。未知后台写者必须先隔离，不能仅靠路径校验伪装一致快照。

归档清单错误可由所属服务当前执行权或管理员专用确认操作修正；必须 expectedRevision，产生新清单版本、记录原因，不撤销冻结。减少 required 范围须在确认中列出将丢弃的文件。以 data binding 的串行裁决为准，若旧收据抢先提交则修订失败并接续原收据；若修订先成功则旧助手禁止提交，等待其停止后换新助手，详见 [补充 §15](./design-audit.md#15-清单修订与收据提交的唯一裁决)。已落收据或已进入 cleaning 后不可再改清单／outcome。归档已有结果可按 digest 幂等复用，仍需重新确认新清单完整。普通重试不允许换 outcome。

对象存储故障按指数退避重试（1 秒起、上限 5 分钟），鉴权／配额／缺文件等错误显示 blocked 等待修正。没有强制删卷超时。API 重启、控制器重启、回执丢失、租约接替都从持久状态恢复；不能从笼统 released 状态直接补写成功。卷在收据前丢失，报告 `archive_source_lost`，不补空卷、不声称无产物；收据后丢失可核对并继续清理。

删除操作绑定 namespace/name/UID 与所属任务记录；发现同名新 UID 停止并告警，不删替代资源。先持久完成归档门槛，再进入卷释放，不得用自动父子 cascade 提前删卷。资源投影把 Pod 寿命和最终卷策略拆开：pause 不释放卷；finalizationPermit（收据 ID、操作 revision、原卷 UID）才允许 persistent 发 delete 期望。子 Agent 只有消费关系，不能取得卷所有权。

ready 产物引用随终结收据长期保留。终结回收完成前禁止用户删除产物集，平台 finalization-guard 保护全部有效归档对象；释放 guard 需持久完成回执，丢回执只多留数据。卷释放前复核对象／后端健康，已知损坏则阻塞；跨系统故障仍依赖副本和备份，不承诺零丢失。回收完成后用户在统一确认中删除任务产物集才解除收据引用，并记录「产物已删除」；任务业务历史与收据摘要仍保留。对象被其他资源版本或任务引用时继续保留。项目归档不等于对象删除，不静默创建时间到期销毁策略。切流／项目归档／备份各自冻结范围按 [补充 §18](./design-audit.md#18-各种冻结的作用范围与优先级)，不能以一个停写开关阻断所有清理。

## 7. 资源中心和工作台

新增 object-space 资源种类与存储后端关联，由 data 声明、data-control 报实况；展示容量、预留、健康、归属和后端，单个文件通过分页产物目录查看，不把百万文件逐一画成拓扑节点。任务卷继续沿原 volume 台账，增加 lifecyclePolicy、归档阻塞、回收进度和最后观测时间。

项目／系统拓扑表示：服务→对象空间→存储后端（标明系统内置或外部）；系统 Garage 另外画出自身 Pod→元数据／对象数据 PVC→PV；业务任务→工作卷→PVC→PV；归档助手→同一 PVC。对象空间不能画成服务挂载卷。无 Pod 的 retained／blocked 卷仍可见；已删卷在操作历史显示墓碑，活动图不画成仍挂载。

每类供给必须同时注册资源身份、投影、观测、清理、详情和拓扑消费者；合同测试比较声明集合、观测集合与图节点／边集合。遗漏和观测不完整显示明确提示，不能仅靠前端画一个装饰图标。这是防止「公共 infra 已创建但图仍漏」的验收约束。

管理员后端设置用现有 FormDialog；任务详情显示业务结果／归档／资源三段和产物下载；重试仅在明确可重试时出现。详情复用 Dialog 或独立路由，保留列表筛选、分页、滚动、焦点；不在列表末尾 append。两语言、两主题、宽窄屏和长列表末行均验收。

作者追加的对象存储可观测界面属于本次交付必需项。管理员存储页显示后端就绪／离线／降级、耐久等级、物理可用容量与逻辑已用／预留、读写字节和请求速率、错误率与 P95、验证／GC 积压及最老等待时间、最近成功观测和备份记录；项目存储页仅返回已授权空间，显示配额、ready／staging／删除未确认字节、对象目录及归档／清理阻塞任务，可下钻至既有任务和资源详情。注册但未采集、采集失败、数据过期分别展示，不用 0 代替未知值。

业务元数据和积压来自 data 的持久记录，物理健康／容量来自 data-control 的受支持后端探测，吞吐／延迟来自真实传输计量并接既有指标查询设施；不以抽样下载制造流量数字。计量标签只使用后端／空间／操作／结果，禁止 objectId、taskId、文件名、用户内容或凭据成为指标标签。查询支持现有时间窗口，返回 window、observedAt、stale／unavailable 原因；所有值注明逻辑／物理、累计／速率及单位。备份无记录显示未执行，不推断已受保护。图表、列表和详情复用工作台公共组件，页面只读查询不启动校验或清理作业。

## 8. AW 接入合同与交付边界

AW 需另行实施：PG 冷启动、配置和世代指针外移；skills 内容端口接 PG／对象；插件缓存绝对路径改为不可变 objectId＋digest，并在任务卷物化；主密钥注入；执行层适配 CS；最终业务状态提交 finalize，保存 operationId 后可靠重试。待命槽不得因为重启重复终结任务，仍使用 RFC-027 的执行权和 requestKey。

物化下载不能用服务本地路径传给远程 Agent；任务中的可信助手按 objectId 获取有界下载授权，校验 digest 后生成文件，版本固定并 pin 到任务直到终结。不扩大 RFC-027 现有 1 MiB 材料／文件读接口来假装支持大文件，使用本 RFC 独立对象传输通道。插件包解包的路径与运行环境兼容验证属于 AW 适配，CS 不声称任意归档都可执行。

本 RFC 的 CS 验收使用独立合成服务验证重建后对象读取、任务暂停及终结回收，不以此冒称真实 AW 已接入。对象持久化不会自动解决 AW 蓝绿单主、schema 回退或原生会话迁移。

## 9. 上线、迁移与回退

采用加表／可选字段／能力位扩展，先部署支持新合同的 API、控制器、Runner 与 console，再启用空间和新模板；旧记录按 legacy 保持原 volumeMode 的语义。旧服务和旧 Runner 不声明新能力时不得承接归档任务。

首次启用对象空间后，即使没有在途终结，也不得直接回退到 RFC-035 前版本；已存在的新对象、引用和资源种类需要兼容版本持续管理。持久 storage-contract-version 由更新后的官方部署入口及 RFC035 起的新进程检查，旧消费者退出前不能启用；不声称旧二进制会自行识别新标记。管理员绕过入口直接运行旧程序不在首期保护保证内，见 [补充 §21](./design-audit.md#21-回退保护可落实的边界)。首期仅支持本合同兼容补丁间回退，恢复旧功能另走维护导出／迁移或一致恢复。外部后端缺失或未通过真实验收时能力位为 unavailable，RFC 不标 Done。

设计核对和测试落位见 [review.md](./review.md)、[plan.md](./plan.md)；当前实施记录见 [implementation.md](./implementation.md)。
