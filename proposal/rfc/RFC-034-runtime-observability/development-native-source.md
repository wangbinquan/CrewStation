# RFC-034 下一阶段：开发 Agent 实际原生来源证明

状态：限定设计候选，尚未实现；生产仍 OFF。原键停止底座bebb3d9b已精确CI成功及本机部署，本页只细化其后的实际来源，不解除生产准入。

## 当前问题及选择

`DevelopmentStartIntent.nativeUsageLineageKey` 是 owner 在 Hook 前冻结的命名空间，不是实际数据库证明。`ManagedAgentProcess` 在 Hook 完成后生成环境，OpenCode 最后使用 `prepared.plan(...).env`；其 `OPENCODE_DB` / `XDG_DATA_HOME` 可能指向其他数据库。普通 headless 的 HOME 默认是每 Agent 的临时 runDir/home，release 会删除，父工作区 PVC 不证明这个 HOME 持久。

选择保留原执行环境，不为统计改变 HOME、数据库路径、配置或原生目录创建规则。临时 HOME 支持本执行内实际数值及原生子树采集，目录释放前持久末次数字证据；不承诺跨执行 resume 来源。实际工作区数据库仅在有平台固定挂载身份并且最终路径落在该挂载内时标为 workspace；不能凭 '/work' 字符串猜 PVC。移动、复制、替换、sidecar 丢失或不能证明一致的文件保留缺口，不自动把旧步骤接到新来源，也不把已有数值归零。健康的同库重启与同库旧步骤 10→15 必须可归属原执行和原 CNY 价格。

## 合同边界

1. 旧 business native v1、普通 Agent 和旧 receipt 不变。新增可选 `developmentNativeSourceV1:1`，依赖 developmentUsageV1/usageObservationsV1。明确由 Hook 前冻结的 `DevelopmentStartIntent.nativeSource?: {version:1}` 选择：选项进入原 intent/digest，省略时不补字段、不改旧 JSON/digest；不能按当前 hello 给已经受理的旧命令补开来源。选中时 Session 先核新能力，Supervisor 只据同一冻结 intent 传内部 DriverSpec 选项；生产 owner 当前仍不写该选项，将来完整准入还要求停止能力。未宣告的新/旧 Runner 不能被解释为支持实际来源证明。
2. 原 intent/digest 在 Hook 前固定，现有 lineage 字符串只作为 expected namespace。Hook 后不回写、重算原摘要。平台需要持久来源时另外持久固定期望挂载约束（原项目/工作区、PVC UID、挂载路径）；本批不凭现有配置补造这个约束，也不新增生产调用。
3. 在开发数字帧上增加可选、严格 `nativeSource`，旧帧省略时 JSON 原形不变；只由新能力选择的开发路径产生。它绑定同一 turn、expected namespace、原执行/key/Pod（由数字帧头与 journal 提供），并保存：stage=begin|finish、plannedPathDigest、scope=execution-local|workspace|unverified、beginStore/finalStore、continuity=same|new|changed|unverified 和受限问题枚举。store 含 observer 生成的 sourceEpoch、actualPathDigest、fileIdentityDigest；未绑定必须用明确 pending/unavailable 状态，不能用零/空串冒充。schema 保证 complete 来源必须有 final verified store；resume 的历史连续性另外校验。
4. common nativeProof/nativeBaseline 的旧 lineage 字段不作为开发路径跨执行去重权威。新的开发 consumer 只有收到同 turn 的实际 final verified 来源后，才按 expected namespace + 实际 store 身份决定原生步骤的跨执行归属；早到页先持久保存，不能用任意 intent 字符串提前连接旧 owner。此 consumer 接线属于后续批次，生产仍 OFF。本批可以保留旧 numeric capture 数值，但不会宣布完整开发消费或扩大 sourceScope。
5. source 元数据只含白名单摘要、代次与枚举；不写整个 env、路径原文、prompt、Hook 脚本、令牌或模型凭据。实际 provider/model 仍仅来自匹配原生 assistant message，不从配置模型补值。

## 驱动落位和存储身份

- 捕获点在每轮最终 plan.env、native baseline 与 spawn 之间。复用 OpenCode 固定版本的数据库路径解析；planned path 与最终打开文件的 canonical realpath 摘要分别记录，符号链接或路径变化不能静默合并。
- 原生库保持只读。扩展 observer 已有的 `*.crewstation-usage.sqlite` sidecar，独立表保存数据库文件绑定与 sourceEpoch；不把 snapshot_order.epoch 当库身份，也不修改 upstream DB。只在实际原生目录已经存在时创建 observer sidecar，不为统计 mkdir 原生数据目录。
- 每次快照在 sidecar immediate 锁下，记录原生文件的 dev/ino/birthtimeNs 摘要，打开只读事务并采集，再核同一文件身份。健康写入/WAL/checkpoint 不改变 sourceEpoch；主库替换、删除再建或身份不可用必须换代或 unavailable。普通 order sequence 继续其现有独立含义。硬链接、多路径与复制不凭相同 session/part IDs 宣告同库。
- 首轮 begin 时库未创建：保留 planned/pending 来源，不创建空原生库。模型按原路径运行。finish 时可绑定实际已存在库并给本轮实际来源证明；begin/final 差异如实表达，不能将 pending 名称作为已验证 store，也不能改原 intent。resume begin 库缺失没有历史基线，保持 partial/unverified。
- 同库共享 sidecar 序列化绑定和采样；数据库与 sidecar一起复制、路径迁移、PVC UID更换或 stat身份变化不自动建立连续性。复用健康原路径、原库及原挂载时稳定 sourceEpoch；如果宿主迁移导致无法证明文件身份，保留缺口，后续受控映射另行设计。
- 原生模型补采 cache 同样绑定实际来源，不得在库已替换后用旧 session/part ID 的缓存补出旧 provider/model。stdout 数值不因此丢弃，缺实际模型为未定价。
- begin/final 来源帧进入独立数字 journal，随 Session 的连续数字复制和固定页 outbox 持久化；采集故障保持真实已有数据及 partial/unknown，不能影响正常模型结果或触发补起模型。完整来源证明需要相应数字帧持久存在，普通终态/临时日志不替代。

## 分批实施

第一批只做严格可选能力/来源帧、最终环境解析、sidecar 库身份、临时目录末次采集和 schema/driver/journal 回归；既有 business 路径保持原 v1，生产 OFF。owner 挂载约束、开发 consumer 的实际来源去重/历史修订、删除屏障及 UI 在后续批次一起接通和验收；不得用第一批 source 帧宣称全链路完成。

## 必须验收的反例

- 同 namespace、同 PVC 的 a.db/b.db 复制相同 session/part IDs，实际来源必须不同；同库健康重开/Runner重启稳定，同库 10→15 留给原执行原价修订，不能用每 execution 随机 lineage 断开。
- Hook 修改 XDG_DATA_HOME/OPENCODE_DB，证据与实际 spawn.env 一致；原 intent/digest 不变。临时 HOME 不标 workspace，final 帧在 release 删除目录前持久化；resume 临时历史丢失保持未知。
- begin 无文件随后 CLI 创建；已有库被替换/删除重建；复制 DB+sidecar、sidecar 丢失/损坏；采样中路径/文件身份变化、符号链接别名、不同宿主 stat 不可证明。不得把 order epoch 单独当数据库身份。
- 源帧重复、乱序、同版冲突、frame/page/spool 限额、sink/SQLite/PG失败与重开；数值尾部仍可读/ACK，不从 receipt 提高 Session 水位。旧协议金样、旧普通 Agent、business v1 无新增字段。
- 原生 assistant model精确匹配、来源改变后旧模型cache不可借用，未知模型仍有Token且CNY未定价。begin持久化失败不能靠最终普通通知补造完整来源。

限定设计门、独立实现门、相关真实 SQLite/PG+假驱动、一次冻结完整门禁、精确 CI 和部署分别留回执。实际身份/模型/集群资源验收仍待已有授权问题回复，不以假驱动替代。


## 严格帧与完整性判据（补充）

本批新建严格开发专用 `DevelopmentRunnerUsageCaptureSchema`，从原严格 capture 形状扩展可选 `nativeSource`，只供开发 journal/event/page 与开发数字 sink 验证。共享 `RunnerUsageCaptureSchema`、business v1 和普通 AgentEvent 的严格接受面保持原样，继续拒绝新字段；开发来源不经过普通业务事件流。不选来源的开发帧依旧省略该字段且 JSON 原样。`nativeSource` 字段固定为 version=1、stage、lineageKey、turn、turnIndex、observedAt、plannedPathDigest、scope、beginStore、finalStore、continuity、issues。digest 为64位小写hex；turn/namespace沿用既有512长度，代次为UUID，问题是有限枚举且去重。store为strict判别联合：pending/unavailable时不接受store身份；observed时必须包含sourceEpoch、actualPathDigest、fileIdentityDigest。第一批scope只提供execution-local与unverified；前者表示仅证明本执行观测，不承诺路径持久性或跨Pod沿革。workspace必须等owner真实固定挂载约束实现，不能根据HOME或路径名启用。

begin仅与同一nativeProof的pending/unsupported帧同帧，finalStore必须为空；finish仅与final proof同帧且保存beginStore摘要，begin/final缺失明确为unverified。schema禁止namespace、turn、turnIndex、observedAt不一致以及源帧夹带measurement/baseline。已有的普通数字measurement和历史分页仍保留，但consumer不得在final来源证据到达前建立跨执行owner关系。

开发来源存在时，nativeProof complete除既有根、遍历、数值和order要求外，还必须有finish observed finalStore且continuity为new或same、无来源issues。resume必须begin/final均observed且同sourceEpoch/路径/文件身份；pending→observed可为fresh的new，不能成为resume的same。文件变化/sidecar换代即使session与part ID相同也只允许partial，历史修订保持待归属，不能先按旧intent lineage合并。begin不存在/未持久/无法读会保持partial。source能力选中时，不支持协议也产生明确unsupported的begin与finish来源元数据，不能静默退回无来源的complete。

同frame schema检验只能证明内容一致；跨frame是否有同turn的持久begin由新consumer查询其同原key/Pod、连续数字副本验证。该consumer未接通前，receipt的finalThrough仍只证明连续数字传输，不扩大数值/来源完整性的含义。读/ACK旧帧与page上限不变，业务v1和未选中的开发路径省略新增字段。

## 观测强度、ABA与并发界限

文件身份是固定版本CLI路径解析加同一路径在快照前后读取到的文件元数据，属于观测事实，不是防恶意程序替换数据库的安全证明。实现须实际读取canonical realpath与bigint dev/ino/birthtimeNs；缺birthtime、非普通文件、stat失败、采样前后不一致保持unavailable，不补造身份。健康WAL写入不能用ctime/mtime作为换代依据。

observer sidecar使用immediate事务序列化自己的绑定与采样；CLI本身没有采用这个锁。文件若在stat检查之间被替换后又恢复，通用SQLite只读API没有提供实际打开fd的身份，这个ABA不能被本批接口排除，因此本批不将观测元数据称为存储安全证明，也不开放跨执行计费归属。将来跨执行consumer必须以平台固定真实PVC/挂载身份、实际来源观测及不可证明时partial的规则共同受理；需要抵御同UID恶意ABA时须另加可核验的实际fd/固定路径策略，不能静默把统计sidecar当锁住上游数据库。

observer表与native order表各自有version与独立epoch，已有order表升级不得被清空。绑定只记录数字身份摘要，文件权限为0600；损坏sidecar返回unavailable，不删除或重建他人文件。副本携带旧sidecar或新路径时重绑新sourceEpoch，不把旧order epoch误作库身份。原生目录尚不存在时不创建目录或数据库；本批不修改管理员配置或运行HOME。

模型cache仅在已观测且身份未变的同store内可回退；身份丢失、变化或不能重新证明时不给旧provider/model。stdout原数值继续保留。development路径的normalizer使用最终plan.env，旧business normalizer不改；normalizer与snapshot共享同turn source observer，防止一方引用新库另一方缓存旧库。只有实际原生assistant记录为模型依据。

## 冻结实施边界

本批允许修改contracts内部taskrunner/DriverAgentSpec、agent-drivers原生捕获及normalizer、Runner受能力选择的开发sink与Session能力协商，带真实SQLite重开/复制/替换和假ProcessHost/env回归。独立schema文件遵循模块/包布局，不往platform拼跨owner私表读取。owner生产start、cleanup/drain终结、开发consumer、项目/系统facts/UI、CLI/平台测试采集均留在其已有待办。本批不新增生产调用或授予资源删除权限。设计门的PASS仅覆盖此边界；真实身份/模型验证仍等待已有授权答复。


## 限定设计复核修订（2026-09-30）

首轮静态设计门FAIL：两项P2为共享business严格schema扩张和按可变hello补选能力。已按开发专用schema与Hook前冻结intent选项修正，旧回执重发不提升能力；修订版待复审。没有生产代码变更、没有运行测试；本批及两RFC均未完成。

## 第一批限定实现回执（2026-09-30；待发布）

新开发专用 schema 从既有 developmentUsage 合同出口转导出，共享 business capture/普通 AgentEvent 仍拒绝 nativeSource。来源选项只从 Hook 前原 intent/digest 进入 Supervisor、Runner CLI 适配及 DriverSpec；当前 hello 不提升旧回执。source begin/finish 走独立数字 sink，数字日志在原 FULL/WAL 受理头记录是否选择新能力，旧 receipt 的严格形状不变，读/ACK/分页/原键重放继续其原语义。

OpenCode 使用最终 plan.env 的数据库路径、同轮 observer 和独立 sidecar 绑定；库尚不存在不创建原生目录/空库，健康重开与 WAL 写入保留代次，DB/sidecar 复制、替换或身份丢失留显式缺口。实际模型只来自原生 assistant；待补模型的数字修订绑定原轮次观察器，换库后不能借旧模型缓存。结束来源先于原目录 dispose，spawn/cancel 窗口和 unsupported 协议保留末帧；数值故障不能改变普通模型结果。

独立实现首轮发现 P2：Runner 的 cliDriver 显式映射遗漏新开关。补真实适配工厂→包内驱动→假启动器及真实 SQLite 的 selected/unselected 回归，旧映射稳定缺 begin/finish而失败；精确转交后通过。最终30源码/测试路径静态功能门PASS、指纹一致，无剩余P1/P2。73项/414断言相关用例以及3项/17断言真实适配回归通过，精确 ESLint 通过；这是相关检查，完整一次冻结check、精确SHA hosted六项与本机部署仍待回执。

并行资源中心会话在共享 contracts/index.ts 新增6条导出，完整保留并排除出本批提交；本批只从既有开发合同出口提供新schema。无任何生产owner调用nativeSource选项；owner固定真实挂载、consumer跨frame/原key/Pod校验与历史原价归属、删除排空、同快照事实及两级UI继续按remaining-work推进。实际身份/模型验收未执行，不以本页假启动器或SQLite夹具替代。

### 最终限定候选与本机检查边界

最终独立静态实现门再次PASS；目录超限已将本批新schema/test分组到taskrunner/development。另补悬空sidecar符号链接的真实红→绿回归，lstat拒绝此来源且不创建链接目标。最终相关77 pass/0 fail、434断言/10文件，合同族34 pass/0 fail、170断言/8文件，精确30源码/测试路径ESLint通过。原严格合同roundtrip仅用unknown处理未定型负测夹具的matcher类型，不削弱相等/拒绝断言。

最终候选一次bun run check止于4条并行项目资源迁移未入锁（project/0014、resource-access/0001、agent-runtime/0008、runtime-environment/0006），没有进入全量测试；本批目录上限错误已消除。全项目typecheck仅余并行resourceAccessModule.test的依赖fixture错误，本批无类型错误。按docs/engineering/development-rules.md §3共享在制品规则，采用精确自有文件lint/相关真实SQLite与假启动器回归及独立门，并以干净提交的六项hosted CI为权威；不删除并行迁移，不改其锁或用例，不把本机check写成通过。

精确发布候选为30源码/测试与6份RFC034文档共36路径。STATE.md新增了并行导航记录，共享STATE与RFC索引完整留在工作树后续登记，本批不提交它们；其他并行资源/导航代码保持原样。精确CI六项与部署仍待回执，生产开发来源OFF。
