# RFC-034 新数字布局的普通 Agent 启动屏障

状态：限定设计门v1与9路径实现门v2 PASS；相关35pass/0fail/184断言，精确lint与后端types通过；唯一完整check保留1项外部迁移失败，登记后比例核验通过；尚未提交/推送/CI/部署。承接实际布局查询808c5af0（已推送、自身六项CI成功及本机部署）；生产开发采集仍 OFF，两个 RFC 保持 In Progress。本批不提供未绑定零、实际退出、结束排空或删除许可。

## 断点与范围

新数字布局已持久选择独立 journal/binding 挂载，但 Runner 的 reserveDevelopmentUsage 在 startAgent 不带 developmentUsage 时直接返回；openDevelopmentUsage 打开失败又返回 undefined。结果是该实际数字执行仍能接受迟到的普通 startAgent，甚至在数字日志失效后启动普通模型。Session 只对带数字 admission 的命令查登记，普通路径同样能够写 socket。不能仅凭 owner.binding=null 与 Session absent 推断此前及未来都没有普通启动。

本批只关闭 startAgent 这条具体旁路：选中数字布局的新版 Runner 在首次 await、CWD、Hook、驱动或进程之前拒绝不带数字 admission 的 startAgent；日志打开失败也保留选择。接收副本按新的明确能力位在 socket 写入前作相同拒绝。旧未选布局的 Runner 和没有该新能力位的 Session 普通路径保持现有契约。不启用生产 source，不接 owner/endings、不新增持久表或迁移、不改变公开环境 DTO、其他命令或日志失败处理。

## 选择与能力合同

在 Runner 组合根将 developmentUsageRequired 固定为 config.developmentUsage 存在或实际注入了数字 journal。它不根据日志当前能否打开而撤销。AgentSupervisor 将此布尔选择传给 reserveDevelopmentUsage；有 journal 的内部直接调用默认要求数字 admission。选中但没有 journal 的数字 startAgent 继续明确 development_usage_unsupported；选中却省略 admission 的普通 startAgent 明确 development_usage_required。拒绝前不建立待启动 entry、不读取 CWD、不执行 Hook、不创建模型，也不生成数字 receipt 或零事实。

RunnerHello.capabilities 新增可省略的 literal(1) developmentStartAgentFenceV1，仅声明这条 startAgent 屏障的实现。新版实际选中时才发送；即使数字日志不可用也声明屏障，而不虚报 developmentUsageV1/native/数字采集能力。能力位不依赖 developmentUsageV1，因为日志失效时屏障仍必须存在。不升协议版本；既有旧 hello 合同与数字/原生能力依赖不变。新能力不代表完整来源、终态、其他任意执行命令的约束或清理授权。

Session 的本地发送路径在握手已声明该屏障、命令为 startAgent 且 developmentUsage 省略时拒绝，发生在 legacy outgoing、pending 注册和 socket.send 之前。sendCommand 的本地连接与转发接收副本 sendLocalOnly 共用这一入口；发送方不根据远端旧注册推断能力。可靠数字命令仍必须通过原 Session 登记/归属/排空检查；ACK、stop、info、业务和非 Agent 命令保持原行为。连接没有新能力位时沿用旧路径，避免把现有数字能力位解释为从未承诺的屏障。

## 恢复、并发与证明边界

一次 Runner 创建固定模式，日志损坏、重连和不带 admission 的迟到原命令不能把新版选中执行变为普通启动。Runner 端最终守卫不依赖 Session 在线、数据库调用或 owner 查询；Session 的提前拒绝减少无效发送，但本身不是原子 owner 关闭证明。新版本不能替旧 Pod 宣称该能力；未来未绑定结束必须独立核对实际新 layout、原 Pod UID、新能力和 owner 首次派发前/关闭等证据，再核 Session 显式 absent 与最终拥有者事务快照。未声明、离线或日志故障保持等待/未知，不能补零。

本批没有处理 startAgentTerminal/exec/终端等其他执行入口，也没有给所有进程授权作一般性承诺。这些入口、原数字 stop/closure、实际 Pod 退出、强制丢失、重建/保留期/父环境/项目删除和原 owner 版本对拍仍属于后续屏障。单个普通启动拒绝及 receipt=null 绝不证明 Pod 没有任意进程或 Token 为零。

## 文件与验收

预期 5 个实现路径：
- packages/contracts/taskrunner/protocol.ts
- runtimes/task/src/runner.ts
- runtimes/task/src/agents/agentSupervisor.ts
- runtimes/task/src/agents/developmentAgentUsage.ts
- modules/session/application/commandDispatch.ts

测试放在合同、实际 Runner 协议、实际 SQLite supervisor 与 Session 真实隔离 PG 现有边界内，保留旧普通启动与持久停止断言。新合同测试验证能力位可省略、版本仅 1、单独声明屏障可解析但不赋数字能力；实际 Runner 测试用专属临时目录及本机 WebSocket 替身观察真实 hello/ACK，选中但日志无法打开时仍拒绝普通/数字启动且驱动未调用，旧未选路径继续启动替身。Supervisor 覆盖实际 journal 有无 admission、选中但 journal 缺失、既有数字原键重放及停止/重启；拒绝时 SQLite 没有 receipt、Hook/CWD/驱动计数为零。Session 本地与转发接收副本验证新位拒绝前无 pending/socket/legacy 转换，旧能力省略路径保持兼容、带 admission 继续原登记约束。

先独立设计门，再实现及有意义的相关用例、精确 lint/后端类型和独立功能实现门；稳定候选只跑一次完整 check。本批不切换真实身份、不调用模型、不创建或结束真实项目/开发验证资源，也不替换旧会话或已固定算力。提交前核对精确路径、共享索引及远端；候选自己的 CI 与本机部署另记，已有 808c5af0 成功不能代作此批验收。

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
