# RFC-034 设计交付与分阶段实施计划

状态：In Progress。用户已批准完整实施两个 RFC、提交并推送及 CS 本机部署；真实身份切换与创建验证资源仍按实际验收范围处理。

当前剩余工作、依赖和退出条件统一见 [剩余工作清单](./remaining-work.md)。当前清单优先于下文历史实施回执；CSV/异步 CSV 已取消。

## 本次交付

- [x] 阅读当前规则、产品定位、两级导航、观测/用量/资源合同与现有权限。
- [x] 全景、统计口径、两级权限、采集设计与行业参考。
- [x] 两级可交互 Demo，复用 CrewStation 组件。
- [x] 浏览器验收、fixture 对账与演示边界记录。

## 生产实施任务

| 任务 | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- |
| RFC-034-T1 | 协议/驱动/来源能力矩阵、上游固定样本 | RFC批准 | incremental/final/unsupported、CLI、sidechain、resume证据 |
| RFC-034-T2 | 身份与usage账本、累计/增量修订、canonical source | T1 | PO-02/03/04/06领域对账 |
| RFC-034-T3 | 持久摄取/checkpoint/重放/回填/质量 | T2 | 崩溃与乱序恢复，不伪造历史 |
| RFC-034-T4 | 项目授权投影、系统DTO与资源L6端口接线 | T2 | PO-01/03，跨项目与撤权负测 |
| RFC-034-T5 | 两级导航、概览与任务列表 | T3/4 | 两入口、筛选/返回/空错误状态 |
| RFC-034-T6 | 任务泳道、Agent汇总/跨任务分析 | T5 | PO-02/05/11/12 |
| RFC-034-T7 | 项目资源、平台容量与健康 | T4/5 | PO-09/10，资源真实UID对账 |
| RFC-034-T8 | 网关RED、发布角色历史与长连接 | T5 | PO-07/08，切流前后不重标 |
| RFC-034-T9 | 人民币单价配置/版本、分桶成本、未定价 | T2/5 | 项目字段不泄漏；共享成本独立 |
| RFC-034-T10 | 异常/数据质量与恢复 | T3/5 | D61不变，完整性与撤权查询 |
| RFC-034-T11 | 实机与精确SHA CI收口 | T6–10 | PO-01…13逐项证据 |

项目按小批推进，只在现有 main，精确路径管理并发改动。当前不改变主产品基线版本；批准实施并验收后再回填。没有引入新模块或结构例外。

## 原型验收

2026-09-28，以本机静态 Demo 在 Codex IAB 中验收。使用 CrewStation 已安装依赖构建；不启动生产应用或集群资源。

| 范围 | 已验证结果 |
| --- | --- |
| 两级信息架构 | 项目/系统视角各 5 个页签；项目显示公开档位，管理员成本页显示内部模型示例与价格版本 |
| 任务对账 | CS-0928-01 的 4 Agent / 6 执行 = 188,000 Token；规划19K、依赖31K、实现92K、验证46K |
| 时间口径 | 业务1,120s、累计Agent1,570s、父容器1,600s；容器视图显示结果后保留480s |
| 泳道交互 | 适应/2x、业务/容器生命周期切换；2x仅时间轴局部横向滚动；失败片段打开共享Dialog |
| 汇总与未知 | 全项目24h为450,200已知Token、17/19次完整；CLI未知显示“—”，部分显示“≥”，无模型任务“不适用” |
| 项目下钻 | 系统按失败排序，7天/正式进入采购项目（210K、6/6）；返回系统后时间、环境与排序均保留 |
| 列表上下文 | 任务搜索“认证”进入详情再返回仍为同一筛选；无结果显示调整条件提示，不误报采集失败 |
| 详情与键盘 | Agent末行、执行失败、价格与平台组件均在Dialog；Enter操作、Esc关闭并回到触发片段 |
| 响应式 | 1440px和390px下body/main无横向溢出；390px时间轴局部338/760px；详情弹窗x=16、宽358px，无内部横向溢出 |
| 平台异常 | PostgreSQL未采集显示未知；平台组件快照说明独立于项目筛选；系统成本单列平台档位测试 |
| 运行质量 | 浏览器捕获的warning/error为0；临时视口覆盖已恢复 |

Bun静态bundle构建通过；最初品牌SVG解析与macOS大小写文件名冲突已修复（固定品牌白名单、聚合函数文件命名aggregation.ts）。检查针对独立原型，没有运行全仓门禁或声称精确SHA CI通过。

本次仅验证中文、当前浅色主题与上述交互；双语/深色主题/768px完整矩阵列入生产验收。图表、任务、资源、价格全是合成数据，不证明生产采集、真实鉴权、费用准确性、日志历史、告警通知、容量性能或生产CI。未进行身份切换、部署或真实任务创建。

截图：`~/.codex/visualizations/2026/09/28/01a0e5cc-0ad5-74e0-b68d-e46d7f19754d/crewstation-system-observability.png`、`crewstation-agent-swimlanes.png`。可交互入口及启动方式见[Demo说明](./demo/README.md)。

## 人民币与配置入口补充验收（2026-09-28）

用户追加每种运行时单价配置与人民币显示。新增算力档位 Token 成本独立视图，按档位/运行协议/模型列表进入共享FormDialog，成本页和侧栏均可进入；所有金额、单位和价格版本已改人民币。使用直接人工合成的CNY费率，没有调用汇率或价格服务。

- 静态bundle构建通过；金额格式、450,200 Token对账、负值/空值/指数/超精度/显式零、生效时间以及追加版本保留旧价的定向断言通过。
- 浏览器验证非法单价、过去生效时间拒绝；Esc回焦点，重新打开保留9.2草稿；代码档位保存CNY-v2、2026-09-29 09:30生效，列表与历史出现待生效版本。
- 配置返回成本页后，历史估算仍≥¥2.484314（项目≥¥2.419354、平台¥0.064960）；再进入配置已保存的演示版本保留。当前历史始终使用CNY-v1。
- 初轮原生日期输入的自动填值与React状态不同步，增加input同步后复测，过去日期拒绝、新日期准确保存均通过。
- 390px页面宽度390/390无溢出；表单x=16、宽358、高812位于844高视口内，footer可操作。恢复正常视口，浏览器warning/error为0。
- 截图：`~/.codex/visualizations/2026/09/28/01a0e5cc-0ad5-74e0-b68d-e46d7f19754d/crewstation-cny-pricing.png`。

上述原型验收阶段未写入真实算力档位/价格库，也未部署、提交或推送，不宣称生产采集与计费功能已完成。

## 设计发布范围（2026-09-28）

用户已要求将 CrewStation 与 AW 两份设计提交上库。本 RFC 发布范围为三件套、可重建的独立 Demo 源码及 RFC 索引/状态记录，包含项目/系统两级观测与人民币 Token 单价配置。生成 bundle 不纳入版本控制；真实采集、权限、费用账本及配置持久化仍待实施，RFC 继续 Draft。设计发布不涉及现有平台部署或集群变更。


发布前本地检查：修正 Demo 两处未使用 import 后，`bun run check` 的结构、lint、双类型检查通过；测试 **3,636 pass / 117 skip / 0 fail，22,700 assertions，718 files**。本轮显式将实机 URL/CDP 端口指向不可用 loopback，未接触当前集群；跳过项不记为实机通过，完整环境验收交给精确 SHA hosted CI。独立 Demo bundle 构建通过。

## 实施接续（2026-09-28）

用户要求 AW 同时支持独立部署与 CS 托管部署，双方领域口径一致，事实/价格 owner 分离。新增执行级业务观测合同，Token 与估值各自修订，托管 AW 不重复本地计费。实现从精确四桶计量、人民币定价和区间统计开始；这些领域实现不代表持久采集、页面和实机验收已经完成。

用户明确共享登记稍后补交，STATE.md 与 RFC 索引中的 RFC-035 并行文档不纳入本次提交；完整保留其工作树内容。

## 实施批次 1：计量基础与管理员价格配置

2026-09-28：实现四桶 nullable 精确计量、pico 元人民币估值与执行区间并集；管理员算力页增加独立 Token 成本页签、不可变价格版本、幂等保存、并发修订检测及历史查询。运行时启动配置不随价格保存变更。任务采集、受理价格快照、账本与观测页面仍待后续批次，不能将本批记为 RFC 完成。

独立实现门首次 FAIL（丢失响应后跨生效时间无法重试、档位变更后旧草稿无法继续）；缓存原请求并增加显式核对新档位修订后，复审 PASS。6 项界面用例 / 46 次断言通过，包含这两个反例；后端价格用例已覆盖真实 PostgreSQL 并发、回执、回滚与 HTTP。完整门禁及发布证据另行补充。共享状态和 RFC 索引按用户指示留待补交。


### 2026-09-28 托管观测合同与历史价格选择（未接服务）

新增 executionObservations 合同，usage 与 valuation 独立修订，金额仅 CNY；增量和冻结快照均含可见性版本、原生祖先/轮次覆盖，以及可独立恢复的当前四桶投影。合同定向 7 pass / 0 fail、48 断言；独立 projectionRevision 与 native observedRevision 分离，迟到旧测量重建也会产生可同步的新投影，合同功能复核 PASS。CS 价格持久层按已接受执行的 profile ID / revision / protocol / provider / 实际模型 / 条件与 acceptedAt 选择不可变版本；跨生效边界、未知模型、档位删除及单连接池与受理目录上界定向合计 8 pass / 0 fail、62 断言。选择端必填 priceBookRevision，目录 0 保持未定价；已复现上界缺失会读到后发布价格的红例，再增加上界及修订校验修复。

以上未接入执行受理、观测 HTTP、AW 同步或正式页面，不记端到端通过。共享合同索引及平台 wiring 仍包含对象存储会话的未提交依赖；本会话继续保留，未擅自提交这些依赖，也未执行本机部署。

## 实施批次 2：可重建的用量投影基础

- usageProjection 按保留的原生修订排序重建单个计量单元，原生 observedRevision 与 projectionRevision 独立；旧修订迟到也能生成可同步的新投影，相同投影重放保持原修订。
- 无效终态、不明下降与身份冲突保留已有贡献并标部分；恢复减去同谱系已知基线，未知不补零。原始 reported 用量和内部保留的已知量分开，四桶覆盖水位独立推进。
- 新增纯领域用例最终 8 pass / 0 fail、29 assertions，两个文件 lint 通过。独立功能复核发现首次无效样本仍被下一次缺失桶继承；先复现无效零值、非零值与基线超限三个红例，再令首次诊断只保留身份、可复用四桶为 null，复核 PASS。价格目录上界小改亦已通过独立功能复核。
- 尚未接入生产可靠事件源、持久投影、执行级 HTTP 或 AW 平台同步；这批基础不代表两级统计页面或 CS 本机部署验收完成。共享索引依赖的并行对象存储/持久卷代码仍未提交，维持原提交边界。


## 实施批次 3：持久用量账本与冻结快照

- 用量原始修订、当前投影、增量同步日志、整页回执和 source cursor 同事务持久化；同事件或同原生修订内容冲突时整页回滚。较早已提交页重放只返回最新游标，不回退检查点。
- 任务头行锁串行分配跨 source 同步序号，避免数据库 sequence 先分配后提交的空洞导致漏读；读取限定已提交上界。迟到旧样本重建原生修订，发布新的 projectionRevision。
- 新增 0006 用量账本、0007 冻结快照迁移，只按路径登记本会话迁移。快照持久保存水位与 30 分钟有效期，各计量单元按该水位前最后一版分页；后到修订与新单元不能漂入后续页，完成后从快照水位续读增量。
- 真实 PostgreSQL 定向 9 pass / 0 fail、54 assertions；原投影领域 8 pass / 0 fail、29 assertions。账本初版独立功能复核 PASS；快照复审发现空 snapshotId 可沿用旧游标创建新快照，先复现红例再拒绝空 ID，最终功能复审 PASS。定向 lint 与快照追加后的后端 typecheck 均通过。
- 尚未接入观测 HTTP、生产 Runner 来源、估值同步和正式两级页面；以上不替代整套 RFC 或双部署验收。共享索引与 platform wiring 依赖的并行未提交代码继续保留，未擅自一起上库。


## 实施批次 4：执行观测 HTTP 与项目金额可见性

- 独立 `/v3/business-tasks/:taskId/observations` 读取已提交用量日志与冻结快照；platform 通过业务任务与项目 owner API 映射范围，保持原 BusinessUsage 事件合同。抽出 observationPorts，保持组合文件不超过 600 行。
- 管理员项目金额可见性有独立 revision、CAS 和 requestKey 回执；快照绑定可见性版本，读取期间变化或旧快照续页明确要求重取，空增量页也返回当前可见性。新增 0008 迁移已按精确路径入锁。
- 系统管理→算力档位→Token 成本→项目金额可见性：有界项目分页，选中一项才读取配置；统一嵌套弹窗保留筛选、页码、焦点与关闭后的草稿。并发修改可核对当前版本；保存回执不明时保持未确认状态，改回原值仍可继续保存或采用当前版本。
- 功能门先后发现错误游标返回 500 和丢回执后改回原值失去保存入口，均先复现红例再修正，复审最终 PASS。HTTP/账本 14 pass、80 assertions；配置与价格前端 11 pass、86 assertions；客户端 2 pass、6 assertions；平台装配 2 pass、4 assertions。前端类型与定向 lint 通过。
- 后端类型检查期间遇到并行 finalizationIntake 与 task-runtime 在制类型错误；本批两处测试类型另行修正，未改并行文件。全仓 check 仍不能用本批定向结果替代。估值项与生产可靠来源、正式两级总览、部署及 AW 同步未完成。

## 实施批次 5：执行价格受理快照

- 新增不可变执行计价受理存储，以 executionId/generation 固定完整项目/任务/子任务身份、档位修订、受理时间与价格目录上界。重试返回首份快照，冲突身份或档位不能覆盖；0 明确表示当时空目录，后配价格不回填该执行。
- 读取按冻结目录和受理时间精确匹配实际 provider/model/condition；缺失档位、未知实际模型、终端协议或不匹配保持未定价。使用当前默认模型代替实际模型的做法不在实现内。0009 迁移已按精确路径入锁，单连接池无需嵌套占用。
- 真实 PostgreSQL 5 pass、29 assertions，独立功能复核 PASS。内部 acceptExecutionPrice 已装配；业务任务正式受理调用、估值日志与费用回传仍待下一批，不据此声称生产费用已产生。

共享 contracts 索引、platform wiring 及迁移集合仍依赖其他会话未提交输出。按原提交范围保留，不擅自收编依赖；CS 实现尚未提交或部署，等待可安全发布的共享状态。


## 实施批次 6：独立人民币估值与同步

- 新增 execution_valuations 当前投影与 immutable requestKey 回执；按用量 projectionRevision、实际 provider/model/条件和冻结执行价目表估值。金额用 pico 元精度计算，未知价格不补 0，部分桶保留已知小计与 partial。
- valuationRevision 独立递增；同一依据换请求键或丢回执重试不追加用量、不同证据复用键拒绝。价格查询在事务外结束，提交时锁任务头、复核用量修订并原子写估值、同步日志和回执，单连接池不嵌套占用。
- 增量和冻结快照共同返回 usage/valuation，但采用独立计量单元；中途用量修订不会污染已冻结快照。项目关闭金额可见性时保留 Token，估值投影为 not-authorized；再开启可通过快照恢复历史估值。
- 0010 迁移只登记本会话路径。真实 PG 与 HTTP 定向 21 pass / 0 fail、117 assertions，类型及精确 lint 通过，独立功能复审 PASS。首轮价格夹具重复了生效时间，修正为后续生效后通过，未放宽价格约束。

## 实施批次 7：业务子任务价格准入

- v3 子任务首次提交、fresh 重试、resume 重试及新子任务续跑，通过平台注入的价格参与者，在业务 reserve 前固定完整 executionId/attempt、项目/父任务/子任务和已选择的档位修订。幂等返回既有子任务时不再抓取新价；命令执行显式没有模型档位。
- 价格元数据的准备属于准入前步骤；失败时尚未调用子任务 reserve，不启动运行资源。已接受执行的采集与后续估值仍走独立链路。并发落败候选可能留有无用量的价格绑定，该表不作为执行数量或时长的统计事实。
- 功能复审先 FAIL：价格准备失败绕过运行镜像引用清理。新用例先复现 released=[]，再为 admitWithRuntimeImage 加入独立 prepare 步骤；准备失败释放镜像，真正 reserve 提交结果不确定时仍沿用既有恢复规则。首次、fresh、resume 和 submit-resume 均覆盖，复审 PASS。
- 原有 Agent/重试/镜像回归连同新增初版共 24 pass / 0 fail、189 assertions；进一步补齐三种恢复失败后的成功重试，最终新增与装配两文件 9 pass / 0 fail、87 assertions。该夹具会驱动全局 worker，改为独立测试数据库后避免其他待执行任务干扰，产品调度未为测试修改。
- 结构检查发现观测 API 引用了持久端口，platform 用例直接引入其他模块类型；已改为独立公开值类型和本模块最小 ports 声明，跨模块装配保留在 wiring。最终类型和 lint 通过，结构复核后只有并行六个未入锁迁移；HTTP/装配重构 10 pass / 0 fail、40 assertions，独立功能复审仍 PASS。platform wiring 为 597 行；observability 为 40 个生产源码文件，后续增加文件须先按仓库规则提出拆分 ADR。

以上内部采集与估值用例已实现，但生产 Runner 数值来源、后台可靠消费、AW 平台同步、正式项目/系统总览和双部署实机验收仍未完成。CS 共享索引和装配依赖的并行 RFC035 输出尚未提交；继续保留原发布边界，没有部署本批实现，不能把定向通过当作全仓交付。


## 实施批次 8：根执行数值来源与版本协商

- `usageObservationsV1` 由 Runner hello 和显式 info 请求协商；旧请求不增加响应字段。只有精确的不支持能力错误可回退旧启动路径，临时失败保持重试，已接受的执行重放沿用原回执。
- 原有 usage 事件可附带严格的数值证据，保留 BusinessUsage 形状；原生身份去重、更高修订替换、四桶缺失与大整数精度均独立处理。Claude 根 final 的模型汇总与 OpenCode 根 step 是本批来源；未知实际 provider/model 及恢复基线不猜测、不补零。
- 新证据经过真实 Agent pump、Runner WebSocket 与既有持久执行日志；37 pass / 0 fail、175 assertions，包含旧 Runner、新能力协商、临时失败重试、两轮 resident 以及日志重开。文件级 lint、后端类型检查通过；结构检查仅剩并行 RFC035 的七个未登记迁移。独立功能复审 PASS。
- 后台可靠消费、子会话来源、实际模型补全、开发/测试执行来源与正式统计页面尚未完成。不能把根事件已持久化视作投影、计价或完整托管观测验收通过。共享登记及并行依赖仍留待原边界发布，尚未部署。


## 实施批次 9：独立数值副本与业务用量后台投影

- Session 在可靠事件事务内保存数值副本；原日志七天过期不删除数值证据。来源按连续水位和五事件分页读取，失败来源公平轮转，确认水位独立于原 Runner ACK。新增 0009 数值来源迁移。
- 自审先复现“统计已提交但 ACK 丢失、随后有新事件”会改变重放页的红例；现在 offeredThrough 在确认前固定，重启仍重放同一页，确认后才读新增数值。
- 业务 owner 用运行环境 ID、执行 ID、attempt、incarnation 与 payloadDigest 核对不可变归属；运行资源消失后仍可映射到原项目、任务与子任务代次。controller 每秒恢复消费，账本、投影和游标同事务提交后才确认来源；并发调用合并，停止等待当前处理，随后可重启。
- 定向真实 PG 来源/原日志回归 12 pass / 0 fail、93 assertions；追加冻结页及后台投影后最终 16 pass / 0 fail、77 assertions，覆盖丢 ACK 重开、超过一页的覆盖修订、未知恢复基线、未映射来源公平恢复及 worker 生命周期。后端类型与精确 lint 通过，独立功能复核 PASS。
- 结构检查剩八项未登记迁移：七项属于并行 RFC035，本批 Session 0009 排在其未锁的 0008 后。暂不提前锁 0009，否则会把对方的 0008 判为插队；迁移与共享根的发布顺序仍待协调，未修改或提交并行迁移。
- 本批接通业务根执行用量投影；独立估值的后台触发、实际模型补全、子会话及开发/档位测试来源、AW 同步与正式两级统计页面仍待完成，未部署或宣告完整 RFC 验收通过。


## 实施批次 10：后台人民币估值联动

- 用量提交后读取当前 projection 的 observedRevision 对应原生数值/模型证据，调用独立 valuation 修订与 CAS；成功后再确认来源。读取或估值暂时失败时保留已提交 Token 和待处理页，重启后继续，不重复增加 Token 或金额。
- Session 保留精确原生 record/revision 的读接口；只读连续水位内、属于原执行的数值，遇到同修订不同内容显式冲突。原日志过期后仍能读取其数值副本供估值使用。
- 实际 provider/model 缺失或与已提交模型引用不符时返回未定价，金额为 null；不使用运行时配置默认模型。不变价格选择仍引用执行受理时目录水位，所有金额为 CNY。
- 最终定向 23 pass / 0 fail、116 assertions，覆盖自动价格选择、模型读取失败后补算、独立估值修订、丢 ACK 重放、原生证据冲突和日志过期。精确 lint、独立功能复核 PASS；最终后端类型检查通过。完整门禁仍被未登记迁移阻塞，不能宣称全仓检查通过。
- 真实 Driver 的 provider/model 来源仍不完整，目前 Claude 根模型名可得而 provider 未齐全，OpenCode 根 step 未提供完整实际模型；合成来源的计价通过不等于真实模型路径验收。子会话、开发/档位测试来源、AW 托管同步与正式页面仍待完成。未发布 CS 实现、未部署，迁移和共享依赖边界沿用批次 9。


## 实施批次 11：OpenCode 实际模型与迟到补算

- OpenCode driver 从实际子进程环境定位原生库，只用已观察 step 的 session/part/message 精确关联 assistant 的实际 provider/model。未知模型先保存 Token；模型迟到时修订同一记录，不额外累计 Token，也不重发旧 BusinessUsage。
- 每 Agent 的模型待补队列上限 200，单次排水重试预算 50ms，超限明确记录缺口。已证明模型在临时读取失败后仍供新数值修订使用；发生实际模型冲突则保留此前有效投影并显示部分覆盖。
- 估值读取当前选中 revision 的模型证据。真实 PostgreSQL 用例覆盖未定价 → ¥1.000009 → 新用量 ¥2.000009，以及冲突模型不抹去已知费用；保留独立 usage/valuation 修订与受理价格快照。
- 独立功能门发现输出 pump 异常会跳过补算，已改 chained/resident 的 finally 排水并加入回归，原错误仍原样抛出。最终复审 PASS；六文件 55 pass / 0 fail、260 assertions，后端类型检查通过。这是夹具 SQLite、mock CLI 与真实 PG 的组合证据，尚非实际模型调用验收。
- CS 实现仍未发布或部署；共享合同、装配和八项未登记迁移的发布顺序保持原阻塞，不替其他会话收编改动。Claude 实际 provider、原生子会话、开发/档位测试来源、AW 托管同步、正式项目/系统页面和双部署实机验收仍待完成。


批次 11 补充复核：AW 功能门发现的“模型已到但附带较小数字”反例同样适用于 CS，现同步独立 modelRevision 合同、持久投影和原生证据读取。百万 Token 的较小 90 万样本补来模型时，仍估为 ¥1.000009 并保持 partial；后续两百万更新为 ¥2.000009，冲突继续保留。最终七文件 64 pass / 0 fail、319 assertions，精确 15 文件 lint 与后端类型检查通过，独立只读功能复核 PASS。合同锁及整体发布仍待共享依赖顺序解决，未提交或部署 CS。


## 正式页面布局与交付边界复核

用户指出原型与正式页面的丰富度差距，以及新入口卡片间距异常。CS 目前已落价格配置与计量基础，两级正式统计页仍未完成，不能用原型完成状态代替正式交付。

算力页加入 Token 成本页签后，Tabs 面板隔断了 CatalogPage 的直接子级分区间距。现复用公共 `CapabilityCatalog.catalogSections` 包住原有页签内容，恢复档位／镜像卡片的标准间距，保留 RuntimeImagesCard 的挂载及 DialogVisibility 行为。追加 layoutSpacing 实机用例，在 1280/390px 根据两张可见卡片的几何边界对拍 `--cs-space-4`；不是只检查 class 或 DOM 相邻关系。

页面修复经独立静态功能复核 PASS，文件 lint 通过；新增实机用例尚未执行，未部署。共享依赖和迁移的发布顺序阻塞仍在，本段不宣称 CS 已发布或页面已验收。


## 实施批次 12：两级正式统计与业务任务泳道

- 项目与系统管理接入独立「运行观测与统计」入口，提供总览、任务明细、跨任务 Agent 汇总、四桶用量与人民币费用、终态性能与数据质量五视图。系统模型采用实际观测的不透明引用，项目不展示内部模型；未开放费用的项目由服务端投影隐藏金额。
- 同一个 PostgreSQL repeatable-read 快照读取 business-task owner 的旧协议/v3 生命周期与尝试，以及 observability 的 canonical 用量、独立估值和费用可见性。读取上限分别为 200 任务、2,000 尝试、20,000 条用量/估值证据；截断、计量冲突、缺失与真实零分别表达。任务墙钟、执行时长总和和活跃并集分开，不以容器存活代替执行时间。
- 任务进入独立详情路由；Agent 和泳道执行使用共享 Dialog，URL 筛选、返回滚动、末行触发器焦点保留。弹窗按稳定执行 ID 读取最新快照；极小未完整费用保持精确下界，不能显示完整费用的上界。
- 使用 Card、Stack、ActionRow、DataTable、Tabs、Dialog。修复算力页嵌套 Tabs 隔断原目录卡片间距的问题。正式统计页面实际浏览器几何：项目/系统 × 1280px中文浅色、390px中文浅色、390px英文深色，六组总览均为指标卡间距 16px、分区间距 12px，符合共享 token；24 柱趋势和五页签无整页水平溢出，2x 泳道仅局部滚动，执行弹窗可 Esc 关闭。
- 独立后端与 UI 功能复核最终 PASS。本任务精确自有文件 lint 通过；32 个定向文件 184 pass / 0 fail、1,146 断言；前端类型、结构检查与正式 Vite 构建通过。真实 PG 用例包括项目与系统 HTTP、四桶未知/零、旧/v3 事实映射、重试、稳定 Agent 身份、父任务已结束但子尝试缺结束时间，以及并发费用策略变化的快照一致性。
- 浏览器使用正式构建及有界 HTTP 夹具，不创建集群任务，不能当成生产采集实机验收。实机回归脚本另包含部署后真实统计 HTTP 读取；尚待发布部署后执行。
- 2026-09-29 本候选完整 `bun run check` 已自然结束于并行 `modules/dev-session/application/sessionLifecycle.ts` 81 行函数 lint；同期后端类型有并行 gateway TaskId 与 HTTP stream 类型问题。保留其他会话输出，未为通过门禁删改其代码。精确候选清单记录在 `/private/tmp/rfc034-runtime-candidate.json`，共享文件必须连同现有并行依赖协调发布；本批仍未提交、推送或部署。
- 本批正式统计来源明确为业务任务。开发/平台档位测试来源、容器生命周期、服务 RED、资源容量、完整异常与导出以及完整双部署采集验收仍按总计划继续，不将此批标作 RFC 完成。


## 实施批次 13：筛选一致的人民币 CSV

- 项目与系统新增当前窗口的同步有界 CSV。服务端 q、状态和质量筛选作用于全部摘要、趋势、维度及 Agent 贡献，导出按同一语义重新读取一个授权快照；Agent 选择保留稳定分组键、实际 Agent/profile 修订及调用类别。
- 四桶 Token 和 pico 元均输出精确十进制，币种固定 CNY；未知、真实零、项目费用隐藏、截断和来源/快照/窗口分别保留。前端反馈导出行数与部分状态，导出失败不抹去读页。
- 独立功能复核发现 Agent 修订未写入 CSV，以及页面未将筛选作用于 Agent 总量，两项均已修正并补红绿回归；最终复审 PASS，25 pass / 0 fail、171 断言。导出加入后重新构建正式控制台并完成六组浏览器几何验证，标准间距及窄屏局部泳道滚动保持。
- 完整 `bun run check` 第二轮已自然结束：结构、lint、后端/前端类型均通过；测试 4078 pass、142 skip、6 fail。六个失败均为新观测入口对应的旧导航预期/双语测试清单；保留 RFC035 对象存储条目后补齐，三个文件定向回归 44 pass / 0 fail、265 断言。完整最终门禁仍待新候选验证，不把定向通过当作全仓通过。
- 当前业务任务快照有界，不代替大范围异步导出或其他执行来源。CS 实现尚未发布部署；共享依赖发布顺序仍待明确协调。

完整门禁第三轮静态全通过，4085 pass / 142 skip / 1 fail；仅原生终端测试假设30毫秒内必有多次续约，在全量调度下仅到一次。以实际续约回执取代正向固定等待，仍验证离开停止与回来恢复，并在 finally 释放；该文件13 pass / 0 fail、54断言，lint通过。新的最终全量候选继续执行，旧失败证据保留。

## 实施批次 14：项目资源与系统容量、服务及平台健康

- 两级正式统计页新增资源与容量、服务与健康／平台健康两页签，全部七页签保持同一 Tabs 实例；统计来源故障不影响独立资源、历史和健康读取。项目读接口在 cluster-management owner 内限定项目，不以管理员全集前端过滤。
- 项目 Pod/PVC 保留原 UID、快照分页和整个项目汇总；系统视图区分物理集群、受管资源、平台与项目。CPU、内存、PVC 使用共享 MetricValue，七天内历史沿用真实采样接口，缺口不补零；观察到的采样时间与页面读取时间分开。服务页使用现有两槽健康与恢复事件，平台页显示组件原 Pod 身份和重启状态。应用 RED 等未接入来源继续保持未知，不能用 Pod 就绪冒充应用健康。
- 独立功能复核四项 P2 均关闭：分页后刷新使用新查询代次，来源失败不显示完整零资源，空快照 ID 拒绝，跨七页签方向键保持焦点；缓存回归按生产 30 秒新鲜期及五分钟保留期执行。平台不完整空列表已先红后绿，最终复审 PASS。
- HTTP、owner 查询、客户端与正式路由四文件 26 pass／170 assertions；补平台空状态后最终界面 7 pass／45 assertions。后端与 console 类型、结构及全量 lint 通过；完整本地门禁仍在执行，终态另补。
- 正式构建的只读夹具预览核对 1280／390 宽度：网格卡片 gap=16px，纵向 Stack gap=12px，无整页／main 横向溢出；英文窄屏项目资源表保持局部滚动和缺失值。资源明细复用 Card stacked，为表格与分页按钮提供统一间距；该一行样式接线在完整门禁启动后追加，已做相关 7 项回归、文件 lint 和重新构建。此证据为正式代码加 HTTP 夹具，不冒充真实集群数据验收。
- 已部署旧批次所含提交 948404d3 的 exact-SHA CI 36468495910 已终态 success；本批发布、实际部署与其自身 CI 另记，RFC 仍在实施。

本批首次全量终态：静态检查全部通过，4099 pass／142 skip／3 fail。发布生命周期测试在数据到齐前断言，已等待可观察的生命周期动作再验证，未放宽原断言；存储归档 owner 问题由并行会话修正并推送 6ae2aca0，本批不包含它。按钮规范守卫发现本页手动更新入口，已移除并取代上文旧的刷新方案：首页按公共 AUTO_REFRESH 自动更新，分页保持固定快照，分页与失败状态提供“首页资源”导航；返回首页新代次避开旧缓存。此修正先红后绿，三个失败项及本页共 26 pass／183 assertions；独立功能复审 PASS。修正候选唯一一轮完整门禁正在执行，保留首轮失败记录，不把定向结果当作全仓绿。

正式构建更新后，系统平台健康页在 1280px 与 390px、中英文均无 document/main 横向溢出；首屏无刷新动作，原 Pod UID、样本时间、重启次数与未支持应用指标声明保留。浏览器视口已恢复。实际本机工作台当前需要登录，管理员浏览器会话授权仍待用户回复；未自动切换身份。

修正候选完整门禁已终态通过：结构、全仓 lint、后端类型及 console 类型全部通过；4104 pass／142 skip／0 fail，26,095 断言（830 文件，617.28 秒）。20 个源码/用例文件指纹与本轮候选清单一致，未因主干中的无关变更重复跑全量。真实集群浏览器验收在本轮按环境跳过，不能算作本机正式页验收。


### 资源与健康批次发布及本机部署（2026-09-29）

提交 `987b68dcf23768d9db74a4f5cc245801640d4be1` 已推送；其精确 SHA CI `36474426282` 已终态 success，五个作业均成功。前述本地完整门禁 4104 pass／142 skip／0 fail 与此发布候选对应。

经已批准的本机部署，在 `crewstation-system` 更新 console、cs-api、cs-auth、cs-controller、cs-events、cs-session、mcp-capabilities、mcp-operations 八个 Deployment；全部 observedGeneration 与 generation 一致且 Ready=1。镜像通过仓库对象存储兼容预检后按不可变摘要绑定：console 为 `sha256:3d8e74ba64da85089bad123d1b97516f9d1625b98449f24fe25ce3140fb26d68`，control-plane 为 `sha256:9c0a47d9c8784ba24e708e59f620d6baa6a8a466317c2e6debbc763ed8871420`，revision 标签均为上述提交，storage-contract=1。部署完成于 `2026-09-28T20:04:41.519Z`；仅更新上述容器镜像，没有重新创建会话或任务资源。

`http://console.cs.localhost/auth/login` 可读 HTTP 200。正式浏览器仍停在登录页，管理员浏览器会话的身份授权待用户回复；现有几何/键盘证据仍属于正式构建加只读 HTTP 夹具，未将其记为真实平台数据验收。完整 RFC 和 AW 托管接线继续实施。


### 原生证据与历史修订增量（2026-09-29）

原生子树、轮次证明、持久采集已发布并按精确SHA本机部署，见[native-capture](./native-capture.md) §6。部署回执87d2d0aa的CI36500392717六项成功。当前历史原归属修订与原价CNY补算见[native-repair](./native-repair.md)：独立功能门PASS，完整候选验证和本批发布/升级待完成。两份RFC整体继续，不以该增量代替Claude来源、托管空树同步、服务RED等剩余验收。

历史修订首轮完整门禁4179/142skip/1fail；旧驱动缺口原因断言随新增持久顺序诊断补齐，生产候选未变。定向38/0与独立复核PASS，修正候选完整门禁继续。并行总览小卡片f95e06ee已发布，后续本批镜像从包含它的main提交构建，保留其全部输出。


修正候选完整门禁已终态通过：结构、全仓 lint、后端及 console 类型全部通过；4180 pass／142 skip／0 fail，26,516 断言，835 文件，876.94 秒。22 路径指纹与冻结候选一致。真实集群浏览器/模型执行未包含在这次本地门禁内；发布后的精确 SHA CI 与本机升级单独记录。


### 原生历史校正发布及本机部署回执（2026-09-29）

`b6e0111320036a255a1a4c355ecafdaf53f53c9e` 已推送，精确 SHA CI `36504508048` 终态 success。本机八个 Deployment 于 `2026-09-29T00:56:11.287Z` 完成滚动更新；先升级 Session 并执行 0012，再更新 Runner 配置和其余平台组件。console 摘要 `sha256:08376c4cceb4a9f6aa42beb7b74ae9e25a4a930745ffe98595acb72046e8c69c`，control-plane `sha256:1b2559da6e9c749873e086d478aefe7685eed9b20b6577febf9800254580cb5a`，Runner `sha256:132c8ccfbe1b9979a951057bf42c40e543386fb17709dfd89c54b50b610e55d8`，storage-contract=1。未重建既有开发会话或任务容器；登录与真实模型执行验收不包含在此回执中。

## 实施批次 15：显示名称、算力任务明细及界面简化

- 用户最新裁定取消观测 CSV 功能：同时移除项目/系统入口、客户端、HTTP 操作、契约和生成用例；原批次 13 为历史记录，当前不提供同步或异步 CSV。页面及 HTTP 回归确认入口不存在、旧路径返回 404。
- 时间控件复用 ActionRow 的末端对齐；趋势柱上直接显示精确 Token，已知零与未知不绘制虚构正值，部分值保留 ≥。卡片间距继续使用共享 Stack、Card 和 spacing token。
- 项目与算力目录名称通过 owner 读接口补充，包含归档项目、隐藏/停用档位。显示名不改变稳定 ID、受理修订或历史计量。目录暂时失败时无搜索快照保留数字与名称不可用状态；名称搜索返回明确错误，避免误报空结果。名称读取在账本事务释放后进行。
- 项目/系统用量页均按算力及受理修订汇总，点击名称查看四桶、人民币金额、每个任务的该算力贡献；不拿整个任务金额冒充某算力金额。任务表、详情与执行弹窗补所属项目和算力名称，UUID 作为次级定位依据。
- 算力/Agent 弹窗保留 URL 选择、任务下钻与返回；共享 Dialog 在关闭时恢复最新触发按钮引用。真实正式构建的 390px 浏览器验证末行算力 → Task 23 → 返回 → Esc 后焦点回到原算力按钮；弹窗 x=16、width=358，无整页溢出。1280px 两时间输入和应用按钮底部均为 201.992px，网格间距 16px、分区 12px；柱上 24 个值可读且无 CSV。
- 定向验证分别 49 pass／0 fail／307 assertions、焦点与契约 15 pass／0 fail／110 assertions、名称目录离线模块回归 4 pass／0 fail／25 assertions；独立只读功能复审 PASS。完整候选门禁随后运行，终态另记。浏览器证据来自正式构建加只读 HTTP 夹具，没有切换真实平台身份。
- 当前 Token 来源仍明确是业务任务。开发会话/档位测试消耗与其他 RFC 剩余能力继续实施，不能把本次算力下钻当成开发用量已接通。


批次 15 完整候选门禁终态通过：结构、全仓 lint、后端与 console 类型通过；4184 pass／142 skip／0 fail，26,521 断言，835 文件，873.49 秒。39 个候选路径指纹均保持不变，没有因无关主干变化重复启动全量。项目英文 390px 算力明细另确认费用隐藏显示 —、100 Token 保留、没有 CSV、document/main 横向溢出均为 0；预览与临时视口已恢复。真实集群页面登录仍待具体身份授权，不能把夹具浏览器证据代替实际身份验收。精确 SHA CI 与本机部署另补回执。


### 批次 15 远端与本机部署回执

`84ae1bbbbed1a0f7b9f5de4550e78e4c7e12aa14` 已推送，精确 SHA CI `36508083945` 六项全部 success。八个本机 Deployment 于 `2026-09-29T01:31:46.496Z` 完成滚动更新且 observedGeneration 与 generation 一致、Ready=1；先 API、其余控制面、Runner 配置，再控制台。console 摘要 `sha256:0e33481e6d27f61571ac3a08e507339c2240b99f927518c4e043584535c88855`，control-plane `sha256:6f4c7d80592acfbba13986afd6e6c966dafb63253e22bbd97645f891ac19466f`，Runner `sha256:edd24075c6affeab0157684a0e19bf49a379bcbdbba6020be3e0429a16e44730`，storage-contract=1。登录页 HTTP 200；没有切换身份或重建既有会话。此回执替代上一段“另补回执”的等待状态，不替代真实模型/身份验收。

## 实施批次 16：开发执行内部身份与冻结计价前置

[开发来源设计](./development-usage.md) 首批身份/账本范围经独立只读功能设计门 PASS。内部严格区分开发 Agent、开发 CLI 与既有业务身份，不伪造 subtaskId；业务 v1 形状与原记录键保持不变。内部用量、原生证明、恢复修订和 CNY 估值支持真实父工作区/执行身份，公开业务读取仍由原合同校验。未增加数据库结构或新模块，未启用尚未完成的开发生产来源，正式统计仍明确为 business-tasks。

69 项定向回归、350 断言通过，结构/lint/两侧类型全部通过；独立只读实现功能门 PASS。用例涵盖原价修订、旧快照、丢响应重放和严格协议反例。冻结候选的单次完整门禁与精确发布继续；Runner 持久数值日志、Session outbox、开发 owner 查询及正式两级明细仍按设计接续，不能把本批称为开发采集闭环。


批次 16 完整候选门禁于 2026-09-29T02:24:55Z 终态通过：4191 pass／142 skip／0 fail、26,577 断言，837 文件、825.50 秒；结构、lint、后端与控制台类型均通过。22 个候选文件指纹保持不变，未重复全量。只追加此回执后精确发布；源码未因回执改变。此批未启用开发生产来源，无新增迁移，后续采集与正式两级明细继续。


### 批次 16 远端回执

`ca2ff256317b8ebc5cb914c1310865f916996345` 已精确推送，推后 main/origin 0/0、工作树与索引为空；CI `36512613256` 已成功。该批没有启用开发生产来源，也没有部署新 Runner。

## 实施批次 17：兼容的原生采集证明同步

[同步设计与实现边界](./native-proof-sync.md)：公开 v1 保持，显式 v2 协商读取同一持久水位下的 usage、valuation 与 capture；统一限额分页和冻结快照保留完整历史证明，版本混用可恢复而不漏项。CS/AW 原始夹具一致，人民币及权限不回退。本批合同登记确认既有业务金样未变化；初轮真实 PG 与合同 55 项/280 断言通过，新增费用/过期反例继续验证，独立功能门与完整候选检查随后记录。AW f4d02c115 远端 CI 36513591538 / 视觉36513591563 跟踪中，部署等本批验证通过后进行。

本批静态检查已全部通过（3323 源文件、结构/lint/两侧类型），追加费用/过期与严格身份回归13 pass／0 fail、89断言。两仓原始夹具 SHA256 同为3366ce0e3bfd74937e5b743150ec7bd6895b5abf1a496d44573f47e5e494bb52。独立静态实现功能门 PASS；现冻结候选并运行单次完整门禁，不据此宣称托管实机或开发采集已完成。


批次17冻结候选完整门禁于2026-09-29T03:00:12Z终态通过：4197 pass／142 skip／0 fail、26,633断言、838文件；结构/lint/两侧类型通过。15个候选路径指纹全部一致。随后仅更新待办与回执文档，不重新跑同内容全量；精确发布、hosted CI和本机升级仍须单独记录。


批次17发布回执（2026-09-30）：`94aabd6dfe641e46bbfc2e736f0632c7fdf6fc12` 已精确推送，main/origin 同步、索引/工作树空；包含已通过候选门禁的 v2 服务端及剩余工作清单，不含开发采集实现。[CI 36619175682](https://github.com/wangbinquan/CrewStation/actions/runs/36619175682) 和本机部署继续。headless 细化首轮独立设计门 FAIL，现补受理意图摘要/receipt 优先恢复和 Session 持久中断清理出口，复审未返回前不写 PASS。


开发细化最终设计复审（2026-09-30）：[development-headless](./development-headless.md) 功能设计门 PASS；已关闭稳定重发及日志故障末尾排空/缺口两个反例。两仓剩余工作清单的范围、依赖、取消项及发布状态回填亦通过只读复核。生产采集和实现验收均未开启，不提前关闭 CS-R02～05。


批次17精确 CI 与部署回执：`94aabd6dfe641e46bbfc2e736f0632c7fdf6fc12` 的 [CI 36619175682](https://github.com/wangbinquan/CrewStation/actions/runs/36619175682) 六项全成功；本机于2026-09-29T19:46:51.122Z完成八组件滚动升级，Ready=1、generation=observedGeneration，默认 Runner 配置按精确 digest 更新，storage-contract=1、无新迁移。完整镜像摘要与组件代次见 [CS-R01 回执](./remaining-work.md#cs-r01-本批发布部署回执2026-09-30)。本机登录与业务/开发真实身份模型验收分别记录；联合实际对拍、开发采集及其他 RFC 余项继续。


剩余文档验证回执（2026-09-30）：`693ef50c9ff0fa4d4e60409e7d3b876e02945795` 的 [CI 36622441175](https://github.com/wangbinquan/CrewStation/actions/runs/36622441175) 终态 success，static/unit/module/console/gate/e2e 六项成功。本次仅补齐该回执及开发细化的复核历史表述，代码与已部署的 `94aabd6d` 相同，不重复全量本地门禁或重建运行资源；真实开发采集与两级运行验收仍按剩余清单推进。


## 实施批次 18：开发 headless 数字日志底座（Stage 1，在制）

按 [development-headless](./development-headless.md) §8.1 落地可选数值协议、固定启动摘要与 reserve-before-Hook、独立 FULL/WAL 日志及双 emptyDir 绑定、分页/ACK/原键重放、同步原生数值 sink、旧 Runner 与浏览器控制能力隔离。平台生产准入不选择新 render，开发来源仍关闭；本批不代替 Session PG/outbox、冻结价格/结束屏障和正式项目/系统采集闭环。

首轮实现功能门 FAIL 的两个 P2 已补回归与修正：数字库整体丢失时独立绑定拒绝重新创建空库；终态 SQL 写失败时 info/ACK 保留当前进程已知终态，重启不假冒完成。普通驱动流异常也在包装错误前记录 missing-terminal。79 相关用例/412 断言通过；契约金样无变化，结构3338文件和本批36源文件 lint通过。独立 Stage 1 静态实现功能门 PASS（只读，未运行测试）；冻结单次完整门禁、精确发布与 hosted CI 待回执，不写本批完成。


Stage 1 首次完整候选门禁回执：2026-09-29T22:12:32Z，4225 pass／142 skip／1 fail、26,792断言、845文件，635.93秒，40路径指纹未变化。唯一失败是旧 tasks 参考链接正确迁移后，测试未等能力目录结束“读取中”就断言 /business-tasks。只在 projectResources.test.tsx 增加最多40次 settle 的条件等待，保留两条原链接、主题及内容断言；23项导航回归/107断言和单文件lint通过，独立只读复核 PASS（未运行测试）。初次失败不算通过；因测试候选改变，冻结37源码/测试+4文档后重跑一次完整门禁。本机本轮真实登录/模型/资源 E2E 不可用，hosted精确CI和真实验收另记。


Stage 1 修正候选完整门禁回执：2026-09-29T22:29:20Z，结构/lint/两侧类型全部通过；4226 pass／142 skip／0 fail、26,792断言、845文件，830.04秒。37源码/测试+4文档共41路径指纹全部一致。独立Stage 1实现功能门及旧导航有界等待修复复核均PASS（复核未运行测试）。只补回执后精确发布；同源代码不再重跑完整本地门禁。数字协议/Runner底座通过不代表生产来源已接通；Session PG/outbox、owner原键/CNY受理/排空与两级正式明细仍继续。该本机门禁未运行真实登录/模型/平台资源E2E，hosted精确CI及实机验收单独记录。

Stage 1 底座发布回执（2026-09-30）：`fc491a4d6b31c6476d3222209ced880810936c3e` 已精确推送；[CI 36640100860](https://github.com/wangbinquan/CrewStation/actions/runs/36640100860) 六项 success。候选完整4226/142 skip/0与独立功能门 PASS 已记录。生产开发采集仍关闭，本机平台仍94aabd6d，Session PG/outbox、owner原键/CNY受理/排空及两级明细尚未完成；CS-R02继续，见[剩余清单](./remaining-work.md)。


## 实施批次 19：开发 Session PG 副本/outbox（Stage 2 的 Session 部分，在制）

按 [development-headless](./development-headless.md) §10 落地不可变原来源登记、PG连续数字副本、提交后Runner ACK、公平固定页outbox和内部owner读/排空/丢失接口。reported N与copied M分开；只有真实生命周期请求及完整持久末尾，或绑定中断/确实不可取回证明，才产生清理出口。已知缺口和未知尾部不会计成完整零。

首轮独立实现功能门FAIL的迟到null误判和PG连续尾部漏推进两项P2已修并补真实PG回归；最终Session范围静态实现功能门PASS（复核未运行测试）。54相关用例/335断言、3358源文件结构、29本批TS lint、后端类型和7项契约金样通过；实际Runner SQLite+PG的6项回归仅用传输桩，模块层另外保留真实PG回归，不冒充实机模型/身份验收。冻结单次完整门禁及精确发布/CI待回执。

尚未启用生产render、owner稳定原键/意图/CNY受理/释放屏障、platform新来源消费或正式两级明细；本机仍94aabd6d，本批不部署或重建既有执行。CS-R02与所有未满足退出证据的剩余任务继续。此前文档检查点e75939bad6fc29d1d850f6dc78afffd3aa4ea30d的两个push CI36641646598/36641645285均终态success，仅证明文档后继，不代替本批源码门禁。


Stage 2 Session 冻结候选完整门禁回执：2026-09-29T23:43:16Z，结构、全仓lint、后端/console类型全部通过；4263 pass／142 skip／0 fail、27,020断言、852文件，测试591.90秒（完整命令637.67秒）。31源码/测试/迁移/锁+4文档共35路径指纹全部未变；独立Session实现功能门及文档复核PASS。只追加本回执后精确发布，同源代码不重跑完整本地门禁。142跳过项与真实身份/模型/集群验收不计为通过；本机仍94aabd6d、生产开发来源关闭，owner/CNY/实际释放屏障、platform消费及两级明细继续。


Stage 2 Session 精确发布与本机部署回执（2026-09-30）：`1326fdd1ac3a0fdd0205bc0e4857a4423cc7df9d` 已推送，[CI36647054054](https://github.com/wangbinquan/CrewStation/actions/runs/36647054054) 终态六项 success。本机于 2026-09-30T00:04:59Z 完成 Session 先行的八组件 rollout，generation=observedGeneration、Ready=1；新增0010迁移 Job 完成，两张独立数字表存在，持久 storage-contract=1。实际镜像摘要：console `5b24dfe085612e539dd73e0d0c2ba1b42cf657edb5d6149b13529ea40f986b67`，control-plane `636479bb06e831aa7504f8ae9ccdf2f3e02e74fc6b24968edb3ccab476ed3e61`，默认 Runner `c019467571a59d8cfc4a7910453b9bb963ca8055b3393c1ef88bf7d551296121`；三个 OCI revision 均为本提交。工作台 /auth/login 只读HTTP200。没有登录、创建真实模型资源或重建旧会话/固定档位，生产开发采集仍关闭；这不是开发采集/两级真实身份验收。


## 实施批次20：开发owner稳定受理底座（在制，生产不调用）

详见 [development-owner](./development-owner.md)。本批限定独立私表的稳定意图/nonce、首次CNY受理、实际子Pod UID公开owner查询、原journal CAS绑定、关闭准入及精确原来源解析。普通AgentStart状态更新不能覆盖这份独立绑定；关闭准入不等于Pod可删。API仅内部participant，没有新HTTP或真实派发入口。

剩余派发/取消receipt恢复、真实原生沿革、双渲染透传、资源中心及task-runtime删除屏障、开发outbox消费、同快照事实及两级UI依照该页逐项接通后再启用。完整两RFC与CS-R02～05继续，不能拿内部API/合成夹具替代真实采集验收。当前本机仍是上述1326fdd1，不含本批在制源码；定向、独立实现功能门、冻结单次完整门禁及精确发布另记。


批次20限定owner preparation的独立静态实现门PASS；实际PG/SQLite/CNY交叉回归验证原摘要、凭据轮换、重启原receipt和原价`2.000025`，生产全链路仍未启用。首次层级/长度/夹具检查问题及后续pending取消修正记在[owner检查点](./development-owner.md#本批实现复核与门禁检查点)。冻结修正候选的完整门禁、精确发布与CI继续记录，不关闭CS-R02或两RFC。


批次20首轮冻结完整检查于2026-09-30T00:46:02Z在跨模块测试非空绑定精确断言的类型检查阶段失败，未执行全量测试、26路径指纹未变。只修该测试的非空断言，行为断言与生产源码保持；40项/283断言相关覆盖已通过，修正候选重新类型检查后再冻结完整门禁。


修正后的冻结候选完整门禁回执：2026-09-30T01:03:12Z，结构、全仓lint、后端/console类型全部通过；4277 pass／142 skip／0 fail、27,123断言、854文件，测试801.28秒（完整命令849.29秒）。21源码/测试/迁移/锁＋5文档共26路径指纹未变，限定owner preparation独立实现功能门PASS。本机仍1326fdd1；生产仍未调用本批participant。142跳过项和真实身份/模型/集群验收不计为通过。只补本回执与后续删除屏障规划后精确发布，同源代码不重跑完整本地门禁；精确CI及部署另外记录，CS-R02和两RFC不关闭。

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

下一批：实际原生来源限定底座。先复核严格可选能力、最终Hook环境、实际路径/文件身份与sidecar沿革，临时HOME只证明本执行；再实施schema/driver/Runner/Session能力与真实SQLite/假ProcessHost回归。owner生产派发、完整删除屏障、开发consumer和两级事实/UI仍在原待办，不能靠本批元数据扩展将sourceScope改成已覆盖开发。

## 实际原生来源第一批限定候选（2026-09-30）

development-native-source v2设计门PASS；共享业务严格面及旧receipt保持不变，来源选项固定在Hook前intent并经真实Runner CLI适配传交，最终环境/实际文件身份和模型补采共享同轮observer。首轮适配漏传已用真实适配路径回归红→绿修正；最终30源码/测试路径静态实现门PASS，相关73/0与3/0、精确ESLint通过。冻结完整check、精确SHA hosted六项及本机部署待回执。生产owner不选择，consumer/清理/事实/UI及真实身份模型验收继续，RFC保持In Progress。


最终限定来源候选已再次独立门PASS，相关77/0、合同族34/0及精确lint通过。本机最终完整check被4条并行资源迁移未入锁阻断，类型仅余并行resourceAccessModule fixture错误；按共享在制品规则精确发布36自有源码/测试/RFC文档、由干净提交的hosted CI裁决，不宣称本机全量通过。共享STATE/RFC索引以及并行资源/导航输出保持原样后续登记。详见development-native-source最终回执；生产OFF、两RFC仍未完成。


## 2026-09-30 实际来源底座精确CI与本机部署

限定30源码/测试独立门PASS、77项相关与34项合同族通过及精确lint后，按共享在制品规则只发布36自有路径为 `d01ba8223fc08c8b2b70ee4db859e560c2151668`。[CI 36682129650](https://github.com/wangbinquan/CrewStation/actions/runs/36682129650) 六项全部success；本机全量被并行迁移阻断的记录保留，不宣称本机完整通过。2026-09-30T07:30:51.933Z八组件固定摘要升级完成、generation=observedGeneration且Ready=1、storage-contract=1、迁移Job Complete、公开登录HTTP200/匿名受保护根路由401。完整源码/镜像及默认Runner回执见[实际来源底座](./development-native-source.md#精确发布hosted-ci-与本机部署回执2026-09-30)。

本批只关闭实际来源第一批发布/CI/部署依赖。生产开发采集仍OFF，sourceScope仍business-tasks；owner固定挂载/派发/删除屏障、consumer原价归属及两级事实/UI继续，真实身份/模型未验收，CS-R02和两个RFC不关闭。并行资源及共享登记原样留给其后续提交；AW新候选edd56ebe3的主CI与九个默认定时配置继续验收。


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


## 2026-09-30 内部开发消费者候选与发布依赖

开发专用持久消费完成限定候选：独立Session/owner/冻结选择与原CNY受理核对，普通数字原模型证据私表、完整meter/per-turn来源、实际文件与两阶段根归属分区，固定页原子提交、原价修订后精确ACK和有界单飞恢复。18路径范围包括自有0013迁移与共享锁；不接生产source或启动新worker，不改变正式业务sourceScope。生产OFF，完整RFC与CS-R02继续In Progress。

首轮独立实现门的唯一root错配P2已先三项红回归、再修正，最终限定功能PASS；70相关回归/374断言全部通过、没有跳过，包含真实PostgreSQL与旧业务兼容，16文件eslint通过。仅一次完整本机check被并行identity/ports目录上限阻断，单独类型检查三项错误均在并行projectDeletion/resourceCenter用例，不声称全量通过。历史失败保留，未削弱数值/预算/完整性断言。

共享锁新增11份并行资源/删除迁移引用，尚未在发布基线中；完整提交锁会导致干净CI缺失这些文件，剥离并行条目又违反共享main保护规则，因此本批发布暂等对应会话正常提交其迁移/锁。接下来先精确本地提交自有20路径（17源码/测试/迁移＋3RFC文档），不带仍有并行引用的共享锁；全部引用进入本地提交树后才协调推送累计提交。候选形成时main/origin为2d4555323、已部署源码仍1d48fb170；后续同步、精确发布/CI及本机部署另记。共享登记仍按用户要求稍后补交。完整源码/测试与根边界说明见[消费者设计和候选](./development-consumer.md)。

## 2026-09-30 内部消费者本地提交与原键派发候选

内部消费者自有20路径本地提交965b45e8710ccb1ec55b36b9429ba60a65541414完成，未带共享迁移锁，远端仍2d4555323；锁中11份并行迁移等待各owner提交，引用齐备后协调推送累计main并查精确SHA CI。保留全文件并行输出，不扫入未授权源码，不将本地提交写成远端或部署完成。

[原键派发与排空设计](./development-dispatch.md) v2独立设计门PASS，v1终态恢复P2历史保留。限定首批仅内部participant/独立Session port，14项新增检查与140断言通过，真实owner PG及明确的Session/Runner测试替身；六文件eslint通过，领域/应用执行行覆盖。实现复核/完整门禁待回执；没有生产注入、AgentStart结束或持久作业接线。下一批持久结束队列，随后task-runtime/resources/项目删除全部许可与两级事实/UI共同启用。CS-R02/两RFC继续In Progress，当前本机1d48fb170，开发采集OFF。

## 2026-09-30 原键派发能力恢复缺口修正

限定实现首轮FAIL一项P2，首次hello支持但info失败、重连能力消失时会误降级普通启动。真实owner PG两轮与迟到缺能力并发先9pass/2fail；现在info前持久CAS原Pod capabilityPodUid，已知支持不可降级或换Pod，关闭/legacy不能升级，旧owner payload省略新可选字段。新增自有dev-session/0013迁移与锁值，完整共享锁继续原样保留并行引用，不单独推缺依赖的main。最终相关28pass/0fail/0skip、260断言（包含既有11项原价/原键）；本批第一次全量arch的domain→ports三项自有问题已修正并保留失败历史。修正后限定功能复核与一次完整候选门禁待回执；持久结束作业、资源/项目删除全路径许可、production wiring与两级事实/UI继续，详见[原键派发设计与候选](./development-dispatch.md)。

## 限定派发 v3 功能与完整门禁回执（2026-09-30）

v3限定静态功能门PASS，18路径首尾指纹一致，自有dev-session/0013迁移实际SHA-256与锁值一致7b48d83a7fa771c6ac25b90586c5dd16f3c73f0bb5b9ca8e48d7809f0f245ac4。首轮能力消失P2已关闭，没有新的限定功能阻断；该复核未跑测试，也不涵盖持久结束队列、删除许可或production。12个自有TS文件eslint与单独后端typecheck通过，真实owner PG相关28pass/0fail/0skip、260断言及旧原价/原键断言保留。

自有结构/能力修正后该稳定候选仅启动一次完整check：arch、全仓lint、后端及console类型均成功；测试4480pass/143skip/25fail/1error，28,833断言、894文件、690.61秒。18路径未变；此前domain→ports三项自有架构失败及修正历史保留，不能把这次全量写成全绿。25失败在本批以外13份用例：资源升级新删除触发器缺resources.task_volume_safety、命名空间回收超时及其未处理错误、runtime-environment并发配置/镜像目录，以及角色主页/项目资源/限流/按钮/申请面板/导航/接口面。全部自有派发及既有开发owner相关用例通过；保留这些失败与日志，不修正或删除其他会话源码，也不因其后续提交重复全量。整仓最终结果仍需依赖齐备后的clean精确SHA hosted CI。

门禁期间RFC036三笔自有提交推进共享main到492a63d241c59ef3fc892702a30327285e6ddf14，origin/main仍2d4555323；该HEAD变化没有改本批候选。共享锁尚有五份项目删除迁移与本批dev-session/0013未入提交树；先精确本地提交自有源码/迁移/五份RFC文档，整个共享锁留在工作树。其他owner提交其五份迁移且所有引用齐备后才能在短时临界区同步并推送累计提交；不声称已远端发布或已部署。本机当前已验证源码仍1d48fb170，生产开发采集OFF。

[持久结束作业细化](./development-ending.md) v2独立设计门PASS，保留v1登记恢复P2；下一批实现原登记补全、目标行原子状态保护、结束队列/恢复，随后所有删除旁路与两级事实/UI。CS-R02和两个RFC继续In Progress。


提交前最新复核：并行owner随后新增resources/0005_project_pod_stop_receipts入锁，未提交锁引用从上述五份项目删除迁移增为六份，另加本批dev-session/0013。早期11份、门禁结束时五份均为当时检查点；以本次六份及实际提交树依赖为当前发布阻断，不剥离并行锁条目。仅本地精确提交自有18路径（13源码/测试/迁移＋5RFC文档），共享锁仍留工作树，依赖齐备前不push。源码限定PASS和28项回归有效，全量4480pass/143skip/25fail/1error并非全绿；生产OFF、ending仅设计PASS、完整RFC不关闭。


## 持久结束第一批候选检查点（2026-09-30）

本批17自有源码/测试/迁移路径完成内部候选：dev-session私表原执行唯一作业、首次reason/observedAt、逻辑结果与未知actualEndedAt、原目标行私有不可回退保护、有界公平owner补漏和job租约/fence/version、关闭后的Session登记恢复与原admission停止/排空participant。没有生产定时器/lifecycle装配，也没有删除许可；evidence-complete仅内部证据状态。原价格/nonce/固定算力不重新获取，旧AgentStart/ownerJSON没有新字段。forced-release/environment-lost请求没有本批证明而拒绝；unbound只能封闭准入并等待。实际时间合同仍未提供，0014保留actualEndedAt=NULL。

真实隔离PG先确认旧全行更新可把ended写回pending：1pass/1fail；目标行logicalEnding条件修复后2pass/0fail。第一批其他回归11pass/7fail：Drizzle的FOR UPDATE OF带schema限定名被PG拒绝，以及严格回执夹具误含runtimeTaskId；改为唯一外层owner关系的FOR UPDATE SKIP LOCKED，显式原回执字段。次轮17pass/1fail是旧未选择夹具仍尝试bind，修正为旧选择无数字绑定；另修测试数组类型，未调整行为断言。首次失败记录保留。

修正候选最终47pass/0fail/0skip、327断言、7文件，包括纯状态/原登记反例、真实owner/jobPG并发、0014旧库实际升级、32条公平轮转、原键派发/冻结人民币原价既有回归。精确16个TS文件eslint和后端typecheck通过；相关lcov中ending应用/领域/持久request/store/transaction可执行行全部被覆盖，这仅为本地候选证据。结构检查当前只报外部packages/persistence的connection↔transactionContext文件环，本批没有结构违规；不改其并行内容，单次稳定候选完整门禁和clean exact-SHA CI另记。

当前限定实现独立功能复核待回执。所有Session/Runner入口在本批回归仍是传输替身，实际数据库仅验证本模块owner/job；不写作真实模型、完整Session排空或实际Pod删除验收。unbound独立Session按执行查验、force/实际UID丢失、全部删除旁路、task-runtime/resources及RFC037项目删除消费、真实终态时间、生产源与两级事实/UI继续；生产OFF、sourceScope=business-tasks、CS-R02/两个RFC保持In Progress。

迁移0014追加到共享锁时保留所有并行引用，仍未提交整份锁或推送main。已本地精确提交的消费者965b45e8和原键派发646da1e9继续保留；最新锁引用和其他会话的发布状态必须在短时Git临界区再次核对，不能扫入其未提交源码或从锁剥离条目。


## ending 限定实现 v1 失败与 v2 回执

v1独立18前身17路径功能门FAIL一项P2：I/O后虽读过时钟，但commit/retry/claim在数据库取锁前固定时间，等待owner行锁期间跨越30秒截止仍可能接受过期操作。新真实PG行锁反例0pass/3fail准确复现；v2给store注入Clock，在owner→AgentStart→job全部行锁取得后再读当前时钟，evidence.observedAt只保留来源观察含义。修复后3pass/0fail；并未用超时重试或增加租约时长绕过。首次FAIL与红回归保留。

最终18路径v2限定独立静态功能门PASS，首尾指纹一致，自有0014与共享锁SHA-256一致；未发现新限定功能阻断。实际最终相关50pass/0fail/0skip、335断言、8文件，精确17TS lint通过。首次后端typecheck通过；最终全仓typecheck现在被并行packages/persistence/transactionContext.test.ts的4项缺失导出/隐式类型错误阻断，没有本批自有路径报错，不能把最终类型检查写成全绿。上段结构文件环属于当时并行检查点，单次稳定候选完整check以其实际结果另记。

该PASS只覆盖内部作业、原目标行状态保护和可单步接续的participant；实际Session/Runner仍是传输替身，未生产装配、运行模型或回收Pod。evidence-complete没有清理许可；全部删除守卫、unbound独立登记查询、实际UID丢失/force证明、实际终态时间、生产来源和两级事实/UI继续。生产OFF、sourceScope=business-tasks、完整RFC不关闭。


## ending 稳定候选单次完整门禁回执

21路径（18源码/测试/迁移＋3自有RFC文档）冻结后仅跑一次完整bun run check，候选首尾全部未变。该命令在arch阶段退出1：外部packages/persistence的connection↔transactionContext文件环，以及并行resources/0007_project_admission_lock_holder新迁移未入锁；没有进入全仓lint、类型或测试。不能把此前定向50pass/0fail或首轮类型通过写成本次完整门禁全绿，也不因其后续改动重复完整检查。精确17TS lint、50项定向回归和限定实现v2 PASS保持；最终类型四项外部错误仍以记录为准。clean提交树exact-SHA CI须待共享迁移及对应依赖齐備后再验证。

下一步只精确本地提交自有21路径，整个共享锁和外部在制源码留工作树。不得提前push缺失依赖的累计main，不将本地提交写成远端或部署完成。生产OFF、evidence-complete无清理许可，完整开发删除守卫和两级事实/UI继续。

## 2026-09-30 Session独立实际执行登记查询

[限定登记查询](./development-lookup.md)设计与11路径实现v2独立静态功能门PASS。真实隔离PG→Hono→严格client、模块API与既有存储/派发/worker回归27pass/0fail/0skip、161断言、7文件，精确11TS lint与后端typecheck通过。新增路由非法ID误返回500的实测问题已用现有parseParams修为400；测试包入口及字面量类型问题的失败历史保留。无新表/迁移；SQL成功无行才absent，禁用/PG/传输/合同故障不降级，原按key读取404/冲突不变，没有写/ACK/排空副作用。

完整稳定候选门禁4560pass/143skip/1项外部失败，11路径指纹未变；本查询尚未提交/推送/部署。持久结束21路径已本地提交943789175c1bcfbc216ee49e319ccef9c1e3a9bc，包含0014，不带共享迁移锁；消费者965b45e8及派发646da1e9仍本地。远端发布待共享迁移与对应依赖齐备。下一步须由task-runtime独立确认实际新数字layout，联合原owner首次派发前/关闭准入和原Pod证据；absent不是零、停止或删除许可。生产OFF，sourceScope=business-tasks，CS-R02和两个RFC继续In Progress。

## 2026-09-30 Session登记查询完整门禁回执

稳定11路径单次完整check于2026-09-30T14:53:28.931660Z结束；原候选及最终HEAD均943789175c1bcfbc216ee49e319ccef9c1e3a9bc，11路径SHA256未变。结构、全仓lint、后端与console类型检查均通过；全量4560pass/143skip/1fail、29303断言、911文件（Bun测试875.05s，整门927.83s）。唯一失败在本批之外的modules/runtime-environment/tests/catalogSummary.test.ts:24，select调用计数期望1实际0；本批11路径没有失败。故不是全绿，保留该共享候选阻断，不改其并行持久层/目录输出，不因无关HEAD变化重跑完整门禁。

限定查询的27项真实PG及合同/client相关回归、11TS lint、独立实现v2门和后端类型通过仍有效；完整门中的143skip包含被明确禁用的真实身份/模型验收，不能代作项目/系统页面实际验收。本批没有真实身份切换、模型调用或Pod回收，也未启用生产开发来源。精确本地提交/远端发布/CI/部署分别待回执；共享锁当时193项中仍8份RFC037迁移未进入HEAD，完整锁和其源码原样保留，待所属会话正常提交并协调发布。新内部查询不依赖新迁移，但不能单独推送仍缺迁移依赖的累计main。

## 2026-09-30 共享迁移齐备与Session查询远端回执

14路径查询源码与文档已精确本地提交05d4ca01d8414bd38f3958a225379b048d12bba3，Co-Authored-By与路径/指纹已验证；共享锁未由本批带入。其后并行提交cc56ee8818bdb87d76932a5fe3affd947d7e39ef完成其自有模块与完整193项共享迁移锁，所有引用进入提交。消费者965b45e8、派发646da1e9、持久结束94378917及查询05d4ca01均已核实为origin/main=cc56ee88的祖先，本地与远端0/0，索引为空。之前8份缺失依赖的检查点已解除，历史失败与检查点继续保留。

[共享提交精确CI36735324944](https://github.com/wangbinquan/CrewStation/actions/runs/36735324944)的static/unit/module/console/e2e/gate六项completed/success。它不是每个历史子提交各自的CI，也不包括尚未提交的实际布局查询。并行持久层修复后的catalogSummary与transactionContext真实PG定向4pass/0fail、28断言确认；未重跑历史查询完整门禁。生产开发采集OFF，sourceScope=business-tasks，实际本机部署另记，CS-R02保持In Progress。

## 2026-09-30 实际执行布局查询限定候选

[实际开发执行数字布局查询](./development-environment.md)设计与9路径实现独立静态功能门PASS；真实PG、模块重建、严格合同/投影、旧原生执行和布局回归24pass/0fail/0skip、231断言、6文件，精确9TS lint与后端types通过。一次稳定候选完整门禁4568pass/143环境skip/0fail、29430断言、914文件，结束2026-09-30T15:26:34.010689Z；base05d4ca01期间main推进cc56ee88，9个任务文件未变，没有重复门禁。只有实际SQL无行才absent，坏选择/错用途/原归属/Pod UID冲突不降级；公开EnvironmentDto unchanged，无新迁移、Runner/K8s调用或写副作用。

当前候选尚未提交/推送/部署，其精确远端CI另记；cc56ee88的六项成功不代作本批CI。下一步为owner关闭与首次派发前、迟到普通命令旁路和原Pod实际证明，随后全部删除/重建/保留期屏障、production与两级开发事实/UI。只读布局和Session登记不是零或清理许可；两个RFC继续In Progress，生产OFF。

## 2026-10-01 实际布局查询精确发布与本机部署

本批13个自有路径已精确提交并推送为 `808c5af0bf80445c8cfbaf1baca112b74c723b7f`，提交内容/路径/Co-Authored-By 已核对；推送后 main/origin/main=0/0、共享索引为空。前继消费者965b45e8、派发646da1e9、持久结束94378917与Session查询05d4ca01均随本版源码进入实际镜像；这只发布内部底座，不代表调用者已接通。

[本批精确CI36739319297](https://github.com/wangbinquan/CrewStation/actions/runs/36739319297) 的static/unit/module/console/e2e/gate六项全部completed/success，headSha严格等于808c5af0。前继cc56六项CI未代作本批验证。该CI和已记录的唯一稳定本机4568pass/143skip/0fail分别保留；没有因主干变化重复完整门禁。

本机于2026-09-30T16:05:16.903Z（北京时间2026-10-01 00:05:16.903）完成部署。先备份平台PostgreSQL，再核storage-contract=1与不可变镜像，迁移Job rfc034-development-environment-migrate-808c5af0 Complete、applied=0；八组件逐个滚动并核实际就绪。原平台库dump为42,606,924 bytes、SHA256 `20ce177dcc85ef63548cadf4dd8540cef69863ac30aa482fb32ac4ffc3162b38`，保存在本机私有临时证据目录，未上库。

镜像源码revision均核为808c5af0，实际部署manifest摘要分别是：
- console：`sha256:ed154c6b2265c8e22334e0c720ddeea1b717a5a3acb80c3d58274e5777b69758`
- control-plane：`sha256:5fed671017dda324c17588c18f3fd88eea2929baa0022a6cb38aa25267f48b01`
- task-runtime：`sha256:d1783c26996e8b21b2967739499bb134f0bb68bb6dd36a26d82f21fc039fa9b3`

默认Runner已核为同一task-runtime不可变摘要。八组件generation/observedGeneration分别为console207、cs-api201、cs-auth99、cs-controller166、cs-events69、cs-session118、mcp-capabilities65、mcp-operations65，Ready均1。2026-09-30T16:22:27.596165Z再次只读复核镜像/默认Runner/就绪一致，实际 `http://console.cs.localhost/auth/login` HTTP200、未登录根HTTP401。首次匿名探测误将CS_USER_DOMAIN裸域cs.localhost当工作台入口而得到404，随后根据实际IngressRoute修正Host；失败历史留在本机回执，没有将404写成部署成功。

生产开发采集仍OFF，sourceScope=business-tasks；没有切换真实身份、调用模型、创建/结束真实开发验证资源或替换旧会话。两项独立只读查询、内部消费者/派发/结束底座不能提供未绑定零、实际退出或清理许可。后续[普通启动屏障](./development-admission-fence.md)、owner关闭/首次派发前与原Pod证明、所有回收/重建/保留期/项目删除屏障、production消费和两级开发事实/UI继续；CS-R02及两个RFC保持In Progress。

## 2026-10-01 限定实现与回归

设计v1独立静态功能门PASS，原设计冻结SHA256=f892ce0597393d4fca0f89d16231663ed57b7495a9ba8966abf04cc0a8afd317。5个生产路径与4个测试路径完成限定实现，v2独立静态实现门PASS、9/9首尾SHA256一致；审阅未运行测试，不代作运行验收。

修复前同一反例组18pass/7fail、94断言、4文件，明确复现普通startAgent可被接受及缺失新能力。修复后最终相关35pass/0fail/0skip、184断言、5文件，包括旧协议、旧普通路径、实际Runner WebSocket两次启动日志缺失、注入实际SQLite journal后的原数字受理、Supervisor的CWD/Hook/驱动/entry/receipt保护及Session真实隔离PG本地/转发接收。精确9TS ESLint与后端types-v2通过；首轮types仅1处自有测试Exec构造遗漏env/timeout/wait，补齐现有默认值后通过，原断言完整保留。

稳定9路径的唯一一次完整check已结束（1项并行迁移清单失败）；尚未提交、推送、取得自身精确CI或部署，808c5af0成功不代作本批CI。该屏障只覆盖具体startAgent入口，尚无未绑定零、其他执行入口、实际退出、排空/清理或production许可。两个RFC及CS-R02保持In Progress。

## 2026-10-01 普通启动屏障稳定候选完整门禁

本批唯一完整check于2026-09-30T16:40:21.943661Z结束：结构、全仓lint、后端/console types均通过；4585pass/143环境skip/1fail、29852断言、918文件，测试697.40s、完整749.06s。启动base808c5af0，期间main推进020dc2f89c24d69f5d98764e4ae38c8615014b4a；9个自有候选文件首尾指纹全部未变，没有取消或重跑完整门禁。

唯一失败是platform/tests/migrationCoverage.test.ts:38：实际应用列表比锁清单多一个0002_project_deletion_fences.sql。结束后按比例只重查此真实隔离PG用例，仍0pass/1fail、1断言，相关锁/模块wiring/SQL前后指纹稳定。进一步只读确认差异为并行在制的modules/resource-access/adapters/persistence/migrations/0002_project_deletion_fences.sql尚未登记迁移锁；它不是本批新增，工作树还含并行api-catalog/0007与完整实现。不能剥离、重写或收编他人的内容，也不把全量写为通过。

当前限定设计/9路径实现门、35项相关回归、精确lint/types仍有效；完整门禁失败及定向失败历史保留。该阶段按仓库AGENTS.md前置门禁要求等待上述迁移登记/装配恢复的实际证据；登记后的比例闭环见下一节；共享索引为空，9源路径与8份自有文档留在主检出，不使用旁路分支/工作树或临时移除并行文件。后续只在变化与依赖有具体证据时作比例核验，不因无关HEAD推进重复完整门禁。此刻实际本机仍808c5af0，生产采集OFF、sourceScope=business-tasks，两个RFC及CS-R02继续In Progress。

## 2026-10-01 普通启动屏障外部失败的比例闭环

迁移锁的事件等待于登记后结束；2026-09-30T17:12:59.426126Z，只重查原 platform migrationCoverage 用例得到1pass/0fail、2断言，锁/装配/SQL/持久层5依据及9个自有源码指纹均未变。原唯一完整check4585pass/143skip/1fail和首次定向0pass/1fail的回执保留，不改写成全量0fail。随后共享持久层依赖变化的相关回归仍35pass/0fail、184断言、5文件，后台types-v3通过。

依据开发规则§3对他人在制品导致本地全量红的明确处理，以及用户共享候选“同内容完整门禁最多一次、无关变化只按比例核验”的要求，外部迁移失败已完成有证据的定向闭环；本批限定设计/实现审阅、精确lint/类型及相关用例有效。按17条精确路径进入发布，候选自身hosted CI另记；不收编并行迁移锁或资源删除文件，不重复完整门禁。此刻尚未提交/推送/取得自身CI或部署；实际本机仍808c5af0，生产OFF，sourceScope=business-tasks，CS-R02和两个RFC继续In Progress。

## 2026-10-01 屏障发布与派发恢复检查点

普通启动屏障17路径已精确提交并推送7682fff348a1a671384cd67072539fb2f075ac92，共享索引为空、main/origin同步；[自身CI36750655646](https://github.com/wangbinquan/CrewStation/actions/runs/36750655646)的static/unit/module/console/e2e/gate六项均completed/success。并行资源删除/迁移登记和新派发恢复设计未随该提交上库。原完整1项外部失败与登记后定向闭环回执完整保留，不冒充全量0fail。该提交尚未本机部署，实际版本仍808c5af0；下次已验证部署将包含本批。

[派发恢复](./development-dispatch-recovery.md)限定设计及3路径静态实现门均PASS、指纹一致。新反例组修复前13pass/9fail、116断言/1文件；最终实际PG/原价受理/领域三文件38pass/0fail、343断言，精确lint-v2/types-v2通过。首轮types只因新测试nullable binding，增加明确非空断言和控制流收窄后通过。首次related实际27pass/2文件，一个错误的第三owner路径未执行；已改为存在的developmentUsagePreparation文件，最终三个文件确实执行，不虚报首次覆盖。

当前派发恢复只新增“新屏障但来源不全→原Pod CAS→WAIT”的内部路径，不读取info/材料、登记或启动；来源恢复仍用原能力、原键、原意图与原价。旧未选、已unsupported、已绑定恢复不改变。三路径稳定候选的唯一完整check正在运行，不取消或因HEAD变化重跑；它尚未提交/推送/CI/部署。生产OFF、sourceScope=business-tasks，没有真实身份/模型验收，CS-R02及两个RFC保持In Progress。所有清理/重建/保留期/项目删除与两级开发事实/UI仍待接通。

## 2026-10-01 派发恢复稳定候选完整检查与比例闭环

唯一完整check于2026-09-30T17:46:33.547236Z结束：结构、全仓lint、后台/console类型通过；4610pass/143环境skip/1fail、30026断言、920文件，测试696.30s、完整747.54s，三路径首尾指纹一致，main仍7682fff3。没有因无关在制变化取消或重跑。

唯一失败为packages/api-client/tests/projectDeletion.test.ts:54新增“重新盘点不能接受首次计划或另一个原操作的材料”；其客户端/测试及新项目删除合同均是并行在制内容，不在本批路径。结束后的当前客户端已由原开发补上请求原操作匹配，按比例只查该文件得到4pass/0fail、18断言/1文件；外部四依据及本批三路径在定向检查前后指纹未变。完整1fail原始回执保留，不改写为全量0fail，也不提交、剥离或修写并行文件。

本批限定设计/静态实现门PASS、38项相关回归/343断言、精确lint/types仍有效。依据开发规则§3外部WIP失败的限定核验，以及用户同候选最多一次完整门禁要求，按8条本人精确路径准备提交/推送；候选自身hosted CI和本机部署另记。实际本机仍808c5af0，生产开发采集OFF，sourceScope=business-tasks，无未绑定零、退出或删除许可；两个RFC及CS-R02保持In Progress。

## 2026-10-01 派发恢复部署后的当前回执

普通启动屏障7682fff3与派发恢复3480032c已分别精确推送，各自六项hosted CI全部success；2026-09-30T18:16:51.254Z本机部署3480032c包含两批，八组件Ready=1、generation=observedGeneration，storage-contract=1、迁移Complete/applied=0，镜像来源、默认Runner及匿名入口核验通过。两批原唯一完整check的外部失败和后续比例核验均保留，没有改成全量0fail或重复完整门禁。生产source仍未注入；真实身份/模型验收、开发结束与全部清理入口、consumer调用者和两级开发事实/UI继续，CS-R02及两个RFC保持In Progress。详见[发布与实际部署回执](./development-dispatch-recovery.md#2026-10-01-精确发布ci与本机部署)。

## 2026-10-01 开发数字保护渲染候选

限定16源码/测试路径已实现，共享构造保留第一无work挂载init、原UID消费者保护及双disk布局；两投影分支登记许可Secret，旧direct对未装配的新保护选择提前拒绝。设计首轮Secret未认领P2和实现首轮API默认fieldRef P2均以稳定RED/修正回归闭合，最终独立实现门28/28指纹一致PASS。55相关用例/412断言（真实PG、0skip）、16路径lint/后端types通过；单次完整五组件检查已完成，4640pass/143skip/2项外部失败及结构14项外部违规保留；变化后的两文件30pass定向闭环见下节。

尚未提交/推送/部署，本机3480032c，生产OFF。具体不可变形状和回执见[development-protection](./development-protection.md)。实际受理与direct持久准入、原数字复制/全部清理、consumer生产注入和两级开发明细继续；CS-R02及两个RFC不关闭。

## 2026-10-01 单次完整检查与外部定向闭环

完整五组件于2026-09-30T20:06:11.436315Z结束，958.36秒；lint、后端及控制台类型通过，实际4640pass/143skip/2fail、30318断言、927文件。本批16路径首尾指纹一致。结构14项违规及两项用例失败均指向并行events的0006_project_deletion_fences.sql归属解析/迁移登记；完整aggregate=1原回执保留，不改写为全量绿色。

原开发随后修改迁移并完成登记；只定向运行原结构规则和平台真实隔离PG迁移清单两个文件，2026-09-30T20:08:37.676464Z得到30pass/0fail、45断言。本批源码16路径和外部4依据在定向检查前后均未变，没有重复完整门禁、提交或删改并行文件。依据开发规则§3与用户单次候选规则，限定设计/实现审阅及55相关回归仍有效，按自有20路径准备发布；候选自身hosted CI与本机部署另记，当前本机仍3480032c，生产OFF。

## 2026-10-01 工作负载保护渲染的发布部署回执

限定20路径`d3acac1fe0daab77e1ce741604f9e77131f943a4`已精确推送，[自身CI36771444783](https://github.com/wangbinquan/CrewStation/actions/runs/36771444783)六项全部success。2026-09-30T20:33:55.504Z本机八组件已升级，Ready=1且代次一致；storage-contract=1、实际迁移Complete/applied=0，三镜像源码标签、默认Runner和公开入口复核通过。原本地完整2项外部失败与30项定向闭环历史保留。

实际resources准入目前仅接受business-workspace/taskStorage；纯渲染、严格解析和Secret认领不等于开发ledger实际启动已接通。该边界已纠正，下一批实际归属/PVC准入与direct持久恢复，继而数字复制/全部清理、production消费及两级开发事实/UI仍待完成。生产OFF、sourceScope=business-tasks，CS-R02及两个RFC保持In Progress。详见[实际发布与部署回执](./development-protection.md#2026-10-01-精确发布ci与本机部署)。

## 2026-10-01 原开发消费者实际准入候选设计

接续[工作负载实际准入与持久接续](./development-workload-admission.md)。拟在自有27源码/测试路径接通原开发台账/PVC消费者登记、项目锁外受理与直接创建、原controller持久授予/激活、同选择重放及回收等待；没有production caller。原清理全入口、数字复制、事实/UI和真实验收仍未完成，生产OFF；设计未通过前不改源码。

开发实际工作卷准入 v3 独立门发现绑定恢复 P2，原 FAIL 回执保留；v4 精确限定缺持久子 Pod UID 为 development_workload_binding_pending，让原 controller 继续读取与绑定，新增真实 PG 重启恢复验证。候选扩至 28 条源码；设计门通过前仍不改源码。

开发实际准入公开模块回归已运行：native原注册与许可正向通过；ledger实际发现pinnedVolume旧owner误认子Agent，原失败保留。v5限定原父工作卷owner修订，扩入2条现有源码/测试，精确30条源候选；完整两路与丢响应恢复仍待通过。

### 2026-10-01 开发工作负载准入实现候选（未发布）

[准入设计与验证](./development-workload-admission.md) v5限定设计门PASS；30条源码/测试中的实际准入、原卷owner和作业事务fence已接通，64项相关真实PG/公开模块回归、架构和精确lint通过。原故障及夹具/类型失败保留。整个候选独立实现门、唯一完整门禁、发布CI与部署尚待完成；现行d3部署和生产开发采集OFF边界不变。完整数字清理/消费/两级事实UI仍为后续依赖。

开发准入v2整体独立实现门PASS（51文件/6证据稳定），补公开controller清理保留组合1项/14断言通过。唯一完整门禁4659/143skip/18fail，30源码稳定、同轮相关64/0；18失败及后续7项类型错误均属并行events/来源改造。自有精确lint通过，参考兼容PASS；按开发规则§3只精确提交自有路径，保留外部结果，不重复全量，以本提交hosted CI为最终结论。发布与本机部署回执继续。
