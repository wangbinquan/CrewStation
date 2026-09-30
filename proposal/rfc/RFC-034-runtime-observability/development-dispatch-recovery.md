# RFC-034 已选择数字布局后的派发恢复

状态：3480032ce74b672dbe71184dc00f238bb3ba1bf7已精确推送，自身六项CI成功，并于2026-09-30T18:16:51.254Z完成本机部署；八组件与匿名入口已核验。限定设计及3路径实现门PASS，相关38pass/0fail/343断言、lint/types通过；唯一完整check保留1项外部客户端失败，原开发修复后4项比例核验通过。生产开发采集仍OFF，本批不接实际生命周期或清理，不提供未绑定零、完整来源或退出证明。

## 实际断点与行为

developmentStartAgentFenceV1=1 的实际新 Runner 即使 journal 打开失败仍拒绝普通 startAgent，且不宣称 developmentUsageV1/native 数字来源能力。现有 bindOriginal 在缺少所需数字能力且 capabilityPodUid 未持久时会 owner.unsupported()，返回 legacy。该结果与已选择且不可普通启动的 Runner 不一致，并会永久把原受理标为旧来源。

明确新屏障不是“没有选择数字来源”。对未绑定、已准备原意图的执行，在当前 hello 宣告 developmentStartAgentFenceV1=1、但不满足原意图所需数字能力时，先通过已有 owner.observeSupported 固定实际原子执行 Pod UID，再返回 waiting/source-unavailable。不读取 info、不注册 Session、不取得启动材料、不签发新 admission、不标 unsupported、不发送任何 startAgent。这里复用 capabilityPodUid 的既有语义“已观察且不能退回 legacy 的实际原 Pod”，不把它当数字日志打开成功、受理或 Token 证明。方法名保留；端口注释明确屏障同样只决定禁止降级。

该 CAS 成功后，进程/owner 重启、hello 丢失数字能力、或迟到的旧能力响应均不能重新赋予 legacy。现有 owner.unsupported 与 observeSupported 的相互排斥事务规则直接承接；CAS/环境读取失败返回既有 waiting/retry，不修改原价、nonce、payloadDigest、绑定或未支持状态。若 owner 已关闭/已绑定/原 Pod 发生冲突，继续既有持久状态及恢复分支；不把请求时间写为实际结束时间。

来源恢复后，仍由原正常 supported → info → 原 Pod/journal bind → Session 原登记 → 原固定材料的顺序派发。不得由于屏障位为 1 就绕过所需 usage/stop/native 能力。已绑定执行仍优先恢复原持久回执；旧已明确 unsupported 的执行不事后升级。本批不要求已有健康数字 Runner 宣告新屏障：旧未选和旧缺能力路径及已经绑定的旧键保持既有兼容契约，生产准入是否强制新屏障由后续实际 producer 单独处理。

## 范围与文件

只改 modules/dev-session/application/development/dispatch.ts、modules/dev-session/ports/developmentUsage.ts 的语义注释，以及现有真实隔离 PG 的 modules/dev-session/tests/developmentDispatch.test.ts。不新增合同、能力位、表或迁移，不装配 production，不改 Session/Runner 屏障候选九路径，不触碰并行项目删除文件。

原数字能力支持判断保持不变。原 capabilityPodUid 不支持或缺失 info 的保护保持不变。新分支只处理“新屏障明确存在、所需来源尚不可用”，并保持实际原 Pod 的持久身份。

## 有意义的验证

先补可稳定复现的真实隔离 PG 回归，观察 owner 持久记录与真实 participant 行为，而不只断言源码。覆盖：

- 只有屏障、缺全部数字能力，以及逐项缺原意图必需能力，均 WAIT，无 info/登记/材料/启动，原价/nonce/digest 不变，实际 Pod 固定。
- 新 owner 重载后 hello 丢失能力，仍不能 fallback；数字来源恢复后按原意图、原价、原 Pod 正常绑定/受理。
- 迟到旧能力判断与屏障 CAS 并发时，旧 unsupported 无法覆盖已固定身份；CAS/环境故障仍 WAIT，不静默旧启动。
- 既有未选择/旧缺能力/已 unsupported、原键恢复、ACK 丢失、取消、原 Pod 冲突等原断言全部保留。

独立设计门后才改代码。稳定候选相关测试、精确 lint/类型与独立实现门通过后只运行一次完整 check；按共享主树候选内容规则保留外部失败，迁移登记变动只作比例核验。精确发布、候选自身 hosted CI、本机部署与真实开发验收分别记录。已有808c5af0部署和新屏障相关用例不代作本批证据。

## 2026-10-01 屏障发布与派发恢复检查点

普通启动屏障17路径已精确提交并推送7682fff348a1a671384cd67072539fb2f075ac92，共享索引为空、main/origin同步；[自身CI36750655646](https://github.com/wangbinquan/CrewStation/actions/runs/36750655646)的static/unit/module/console/e2e/gate六项均completed/success。并行资源删除/迁移登记和新派发恢复设计未随该提交上库。原完整1项外部失败与登记后定向闭环回执完整保留，不冒充全量0fail。该提交尚未本机部署，实际版本仍808c5af0；下次已验证部署将包含本批。

[派发恢复](./development-dispatch-recovery.md)限定设计及3路径静态实现门均PASS、指纹一致。新反例组修复前13pass/9fail、116断言/1文件；最终实际PG/原价受理/领域三文件38pass/0fail、343断言，精确lint-v2/types-v2通过。首轮types只因新测试nullable binding，增加明确非空断言和控制流收窄后通过。首次related实际27pass/2文件，一个错误的第三owner路径未执行；已改为存在的developmentUsagePreparation文件，最终三个文件确实执行，不虚报首次覆盖。

当前派发恢复只新增“新屏障但来源不全→原Pod CAS→WAIT”的内部路径，不读取info/材料、登记或启动；来源恢复仍用原能力、原键、原意图与原价。旧未选、已unsupported、已绑定恢复不改变。三路径稳定候选的唯一完整check正在运行，不取消或因HEAD变化重跑；它尚未提交/推送/CI/部署。生产OFF、sourceScope=business-tasks，没有真实身份/模型验收，CS-R02及两个RFC保持In Progress。所有清理/重建/保留期/项目删除与两级开发事实/UI仍待接通。

## 2026-10-01 派发恢复稳定候选完整检查与比例闭环

唯一完整check于2026-09-30T17:46:33.547236Z结束：结构、全仓lint、后台/console类型通过；4610pass/143环境skip/1fail、30026断言、920文件，测试696.30s、完整747.54s，三路径首尾指纹一致，main仍7682fff3。没有因无关在制变化取消或重跑。

唯一失败为packages/api-client/tests/projectDeletion.test.ts:54新增“重新盘点不能接受首次计划或另一个原操作的材料”；其客户端/测试及新项目删除合同均是并行在制内容，不在本批路径。结束后的当前客户端已由原开发补上请求原操作匹配，按比例只查该文件得到4pass/0fail、18断言/1文件；外部四依据及本批三路径在定向检查前后指纹未变。完整1fail原始回执保留，不改写为全量0fail，也不提交、剥离或修写并行文件。

本批限定设计/静态实现门PASS、38项相关回归/343断言、精确lint/types仍有效。依据开发规则§3外部WIP失败的限定核验，以及用户同候选最多一次完整门禁要求，按8条本人精确路径准备提交/推送；候选自身hosted CI和本机部署另记。实际本机仍808c5af0，生产开发采集OFF，sourceScope=business-tasks，无未绑定零、退出或删除许可；两个RFC及CS-R02保持In Progress。

## 2026-10-01 精确发布、CI与本机部署

8个本人路径已精确提交并推送为`3480032ce74b672dbe71184dc00f238bb3ba1bf7`；提交路径、内容指纹及Co-Authored-By已核对，推送后main/origin=0/0、共享索引为空。新清理规划和并行资源删除/迁移登记文件未混入该提交。此前未发布、未部署段落为各时刻检查点，本节为后继实际回执。

[候选自身CI36754924240](https://github.com/wangbinquan/CrewStation/actions/runs/36754924240)的static/unit/module/console/e2e/gate六项全部completed/success、headSha严格等于3480032c。前继屏障[CI36750655646](https://github.com/wangbinquan/CrewStation/actions/runs/36750655646)也为自身六项success；没有用前继或后继绿色代作本批精确CI。

本机于2026-09-30T18:16:51.254Z（北京时间2026-10-01 02:16:51.254）完成部署，包含普通屏障7682fff3及本批派发恢复。先保存私有平台PostgreSQL备份42,657,042 bytes，SHA256 `137b43985a238520daaf04df128d5907158e29b3e4abad3b444fb90f3be02f69`；随后校验storage-contract=1、不可变镜像及并发部署版本，迁移Job `rfc034-development-dispatch-recovery-migrate-3480032c` Complete/applied=0。备份只留本机私有临时证据目录，未上库。

| 组件 | generation / observedGeneration | Ready |
| --- | --- | --- |
| console | 208 / 208 | 1 |
| cs-api | 202 / 202 | 1 |
| cs-auth | 100 / 100 | 1 |
| cs-controller | 167 / 167 | 1 |
| cs-events | 70 / 70 | 1 |
| cs-session | 119 / 119 | 1 |
| mcp-capabilities | 66 / 66 | 1 |
| mcp-operations | 66 / 66 | 1 |

实际manifest摘要：console `sha256:4aaacc69e5033b3c377b0fc1f0da78b8075e494bb4db333699c29d80c4a3703f`；control-plane `sha256:95b9ef2c2e10b41e11573b1ba2d865025023e0ae15b1bf24daa9c69995d79208`；task-runtime `sha256:12f04644221524f256bcd21f7ade3bfad0e8403dbcd674a84406d798689495ba`。三个构建来源标签均严格为3480032c，默认Runner为同task-runtime摘要。

2026-09-30T18:19:40.666612Z只读验收再次对拍八组件generation、Ready及镜像、默认Runner；`console.cs.localhost/auth/login`匿名HTTP200，未登录根HTTP401。没有切换身份、调用模型或创建/结束真实验证资源。生产开发采集OFF，sourceScope仍business-tasks；数字清理、实际调用者、两级开发事实/UI继续。不能把已部署内部底座视为CS-R02或两个RFC完成。
