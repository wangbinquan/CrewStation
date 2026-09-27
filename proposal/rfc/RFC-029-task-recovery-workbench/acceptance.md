# RFC-029 恢复工作台验收记录

状态：In Progress。以下为分层证据，不将存储／HTTP 模块测试等同于已部署页面可点击恢复。

## 2026-09-28：最终候选完整门禁通过，准备发布

使用明确的dev-admin OIDC／独立CDP9368及`CS_TEST_REQUIRE=database,e2e`的新完整`bun run check`自然退出0：**3706 pass／11 skip／0 fail，23517断言，710文件，629.95秒**。81份冻结源码前后SHA256相同；静态、真实PG、HTTP、工作台及部署页面用例都在本次检查中通过。11个跳过保留各自能力缺席说明，不声称本机执行了可选Linux原生／独立registry／Prometheus长历史等项目。日志`/tmp/cs-rfc029-workbench-v2-full-check.log`。

最新改动行防护合并最后显式路由的覆盖记录，745/746（99.866%）、零违规，`/tmp/cs-rfc029-workbench-v2-patch.json`。发布前fetch确认main/origin 0/0，index空；精确88路径分为5个实机验收驱动／断言修复和83个恢复实现／文档。第三方referenceResources的2增1删不纳入提交；本地完整检查包含该共享在制文件，因此最终清洁提交树仍由精确SHA CI裁定。

当前准备按授权提交／推送，尚无本批精确SHA CI及部署回执；TR实际恢复按钮与剩余RI继续，不以本次全绿代替实机业务恢复。专用业务的三文件消费者升级已在`/tmp/cs-rfc029-owned-app-upgrade-prepared.json`准备，远程源码未改；既有main／client／migration额外标记均保留。

## 2026-09-28：完整门禁失败定位与验收驱动修复

83路径候选的完整check自然结束：3609 pass／54 skip／49 fail、22632断言、709文件、1421.92秒，退出1；原76源码指纹相同。48失败来自本轮未配置OIDC导致页面停留公司身份登录；另1失败为接口面扫描不识别恢复路由变量拼接，不能全部归因环境。原日志`/tmp/cs-rfc029-workbench-full-check.log`保留。恢复路由改为与仓库一致的显式路径，接口面＋真实PG/HTTP复验8/0、57断言，`/tmp/cs-rfc029-recovery-surface-green.log`。

同时复现并修复旧实机失败，未改第三方referenceResources：

- 成员角色说明位于shared Dialog portal，旧断言只取main漏掉preview测试者；修正为同时检查当前弹窗，实际7/0。
- CDP只等load既等待慢预览iframe，也无法处理同文档导航；导航命令迟到时还会留下无主Promise拒绝。一次性真实慢iframe页面复现“main已ready但goto超时”。最终先停止本测试页旧加载，等待主文档DOM，统一总超时及监听清理，拒绝迟到停止回执再次导航。纯回归5/0、10断言；旧故意挂起红测试已取证后仅终止其专属PID37969（143），没有停止完整检查。
- 只改DOMContentLoaded仍有3个真实超时，记录于`/tmp/cs-rfc029-navigation-membership-green.log`；加入stopLoading后18项中17过，唯一剩余设置页五组断言落后于RFC028新增第六组。补逐项运行镜像入口后该项1/0、14断言。不是通过加时／重试隐藏失败。
- 拓扑原失败UID长期相同，并非资源瞬时更换：RFC025以资源台账ID绘制工作区／执行／卷，旧测试要求全部节点ID等于Pod UID。现从真实台账children的Pod/PVC UID严格映射对应节点，逐个检查存在与详情；实机7/0、1个未配置第二身份的显式skip、42断言。

日志：`/tmp/cs-rfc029-cdp-navigation-{red,final}.log`、`/tmp/cs-rfc029-navigation-membership-final.log`、`/tmp/cs-rfc029-settings-six-green.log`、`/tmp/cs-rfc029-topology-{diagnosis,green}.log`。恢复功能原定向／浏览器证据仍适用；本批未改releaseDelivery，其定向13/0、140断言只能证明本次通过，不抹掉历史异步失败。

新增5个验收驱动／用例路径后，88路径清单`/tmp/cs-rfc029-workbench-v2-paths.json`、81源码指纹`/tmp/cs-rfc029-workbench-v2-candidate.json`。原完整检查结束且确认无重复gate后，显式`CS_E2E_AUTH=dev-oidc`、`CS_E2E_USERNAME=dev-admin`、独立CDP9368、`CS_TEST_REQUIRE=database,e2e`启动一次新完整check，日志`/tmp/cs-rfc029-workbench-v2-full-check.log`。当前运行中；仍未提交／推送／部署，不标RFC完成。

## 2026-09-28：完整任务详情与恢复工作台候选（未发布）

已接通管理员任务／子任务详情与服务端状态筛选，游标绑定筛选条件；详情不泄露sealed plan。任务列表打开共享Dialog，选择父工作区或具体子执行，确认中说明固定材料及副作用，提交后回读持久进度。双击防重、丢回执保留原键、重新评估变化阻止旧确认、撤权阻止操作、关联新任务在同一弹窗打开、可读失败原因与原始信息均有对应回归。

- API最终12 pass／0 fail、91断言、3文件，`/tmp/cs-rfc029-workbench-api-final.log`。最初详情Schema放置引入依赖环，已移入taskList叶端；缺updatedAt的PG夹具修正后通过，不保留伪造数据契约。
- 前后端联合96 pass／0 fail、692断言、20文件，`/tmp/cs-rfc029-workbench-covered.log`；此后仅失败原因展示更新，最终console及中英文键检查25 pass／0 fail、101断言，`/tmp/cs-rfc029-workbench-console-final.log`。
- 最终覆盖合并保留后端结果，并用最终console结果替换旧console行号：改动可执行行745/746（99.866%）、零违规，`/tmp/cs-rfc029-workbench-patch.json`。未覆盖防守分支保留，不能写100%。
- 独立浏览器上下文、30行长列表夹具，中文／英文×明／暗×1440／390／320共12组：最后一行点击后弹窗在视口内、无整页横溢出；真实键盘Enter打开确认、Esc逐层关闭，焦点和滚动回原行。0写请求、0浏览器错误。`/tmp/cs-rfc029-workbench-browser.json`和`/tmp/cs-rfc029-workbench-browser-v5.log`。初轮非安全HTTP测试域不提供crypto.randomUUID，改为与部署同样的localhost安全上下文后通过；历史失败不删除。该夹具证据不冒充真实业务恢复，新增失败原因分支只有console回归证据。
- 当前83路径清单`/tmp/cs-rfc029-workbench-paths.json`，76源码／测试文件指纹`/tmp/cs-rfc029-workbench-candidate.json`。冻结后唯一完整check运行中，日志`/tmp/cs-rfc029-workbench-full-check.log`：静态已通过，实机用例当前拿到登录页面而非管理员界面。检查自然结束后记录终态，不能记绿或重复启动。

第三方referenceResources完整保留并排除。main/origin重新fetch为0/0，未提交／推送／部署，无跨session消息。TR-01／02／06／08／10增加API、console和夹具浏览器证据，真实任务恢复和其余RI矩阵继续。

## 2026-09-28：原卷重建与关联新任务（未发布）

失败持久工作区的 rebuild 已接通 runtime、生命周期事务、服务 HTTP、api-client 和模板消费者；原操作重放不重复启动，实际连接才结束恢复。restart 已接通独立新任务准入：原契约／发布材料／镜像引用／资源配置保持，原任务仍失败，新任务独立卷与初始化；原恢复请求保存新任务关联，额度拒绝沿原键继续。当前默认改变不重新选择镜像；并发落败候选释放镜像引用；迁移冻结禁止未派发操作。

- 先红后绿：runtime 新入口缺失两项失败（`/tmp/cs-rfc029-restart-runtime-red.log`）；HTTP restart 尚未注册两项失败（`/tmp/cs-rfc029-restart-execution-red.log`）。runtime 13/0、124断言；HTTP 扩展后6/0、68断言。重建此前26/0、208断言。
- 当前联合真实PG／HTTP／模板／api-client **67 pass／0 fail／554断言，15文件**，日志 `/tmp/cs-rfc029-restart-covered.log`。改动生产行 **433/434（99.77%）**，零防护违规，见 `/tmp/cs-rfc029-restart-patch.json`；未覆盖行是原卷重建遇到原环境记录缺失的防守分支，不冒充100%。
- 架构与全仓lint通过；类型检查发现测试夹具把 selectionSource 写成 manifest（真实枚举为 configuration），已修正并复验该文件6/0。后端与console类型最终均退出0，定向lint绿。静态回执 `/tmp/cs-rfc029-restart-static-receipt.json`。无新增SQL迁移；contracts:lock报告金样没有变化。
- 当前72路径清单 `/tmp/cs-rfc029-restart-paths.json`，源码指纹 `/tmp/cs-rfc029-restart-candidate.json`。保留并排除第三方 `tests/e2e/referenceResources.test.ts`。本批未提交／推送／部署，没有本候选完整门禁；旧完整门禁失败记录仍保留。当前实现证据不等于页面可点击或真实集群恢复验收。

下一步接通管理员完整任务／子任务详情、状态筛选、shared Dialog确认与请求进度，处理完整门禁未解失败，再做精确提交／CI／部署及独立任务实机闭环；RFC029继续In Progress。RFC028已交付的无仓库构建不受影响，其剩余RI矩阵另行继续。本轮无跨session交互。

## 2026-09-28：管理员评估与原资源证明候选（未发布）

新增管理员 GET `/v1/admin/business-execution/tasks/:taskId/recovery`（可选 subtaskId）、POST 同路径与 GET `/requests`。每次经实时管理员权限，所属服务从持久任务取得，不要求手填身份、不冒充业务 Pod。评估读取当前发布能力／在线控制权、原任务世代与材料、旧执行停止投影、原卷及原镜像引用；没有资源观察证据时明确不可用。新请求重新评估，再由原仓储事务检查能力／世代／材料与互斥；同键回执先恢复，即使后续应用离线仍可读取，撤销管理员权限后读取和重放均403。

- task-runtime 新增只读 `inspectBusinessRecovery`：限定项目／服务／父任务，核对原卷 UID、Bound、标签所有权、删除状态；Pod 必须物理不存在且连接已关闭才证明父执行停止。子环境即使标记 finished，仍查实际 Pod；观察期间持久环境变化则拒绝本次证明。不续租、不对账、不创建／删除资源。
- runtime-environment 新增只读 `inspectReference`：原 owner／项目、完整快照、版本 digest／architecture 和原通过的用途验证必须一致；停用不替换已有快照，不读取当前默认、不新建引用或解密最新配置。
- Agent 评估读取原加密计划与持久会话，核对原卷、原镜像、固定算力能力、空闲会话和原执行释放；fresh 与 native resume 分开呈现，原会话不兼容不冒充 resume 可用。此为模块证据，未冒充工作台按钮实机验收。
- 先红后绿：资源检查缺方法3失败，镜像检查缺方法1失败，管理员端点缺路由；另外定向复现并修复“第二次点击评估中首次提交导致假412”及“105条终态历史挤掉未结束请求”。未结束请求排序提前，互斥查询不再受100条展示上限影响。
- 最终定向真实PG／HTTP／客户端／应用组合50 pass、0 fail、396 assertions、13文件；日志 `/tmp/cs-rfc029-admin-covered.log`。此前一次46/0未包含原执行关联文件，本次显式包含 `taskRecoveryExecution.test.ts`，不把遗漏作为通过。
- 改动行226/226=100%，32个受保护生产文件无未加载或违规，`/tmp/cs-rfc029-admin-patch.json`；本轮51路径清单 `/tmp/cs-rfc029-admin-paths.json`，排除第三方referenceResources。契约金样无变化；没有新增平台迁移。架构／lint通过；最后一次静态检查发现长历史夹具state被推断为string，补literal类型后后端与console类型、该文件lint均通过，前次失败保留，最终分项回执 `/tmp/cs-rfc029-admin-static-receipt.json`。

本批继续在制，未提交／推送／部署。旧全量3659/11skip/7fail/3errors仍保留，不记为新候选全绿；未重复启动全量。失败持久工作区重建、从头新建关联任务、示例三种剩余动作、完整详情／状态过滤／确认与进度、浏览器矩阵和部署验收未完成。TR-02～08已有后端分层补证，不据此关闭整个TR或RFC。

## 2026-09-28：基础发布与应用收件候选

基础32路径已发布为 `8ed094d3f3458b4e7e518e31983fbe4cbdf57f18`，精确 SHA CI [36332276173](https://github.com/wangbinquan/CrewStation/actions/runs/36332276173) 第二次运行六项全部 success。首次 module 唯一失败为既有 `data-control/tests/dataControlModule.test.ts:130` 在读取 credential 时得到 undefined，其余1709项通过；恢复相关用例和实机E2E通过。该文件未改，定向6/0后重跑失败作业；保留首次失败记录，不写成首跑全绿。基础仍未部署。

接续候选新增服务域读取／认领／拒绝端点和 api-client。来源服务 Pod 与当前 holder／epoch／lease 每次检查，跨服务请求不可读，读取不改变请求或审计，拒绝在同一事务再次核对当前恢复能力。fence 置于请求体，避免放进查询 URL；没有应用上报 success 的端点。

v3 独立示例明确声明 resume-task／retry-subtask，两种动作由当前 controller 接收。在应用 PG 内先保存不可变目标，再以 `recovery:<id>` 调原 resume／fresh retry；新 claim 不改变幂等键。已有 operation／attempt 仍用原键和当前 fence 重放，使额度不足或旧 epoch 尚未派发的操作可接续；平台复用同一操作／attempt，不重复执行。普通 actions 的容量错误仍显式重试；管理员已提交的持久恢复意图由 controller 接续处理暂时失败。其余三种恢复动作未声明，不冒充已实现。

- 先红：新 HTTP 端点404；示例缺恢复消费者。新增后真实PG／HTTP、客户端、契约与示例组合25 pass／0 fail、209 assertions。日志 `/tmp/cs-rfc029-intake-covered.log`。
- 改动行73/73=100%，生产文件全部加载，零违规：`/tmp/cs-rfc029-intake-patch.json`。架构、lint、后端与console类型均通过；契约金样无新增差异，没有平台新迁移，应用迁移新增独立恢复收件表。
- 首个16路径冻结候选完整check自然结束3658 pass／11 skip／6 fail／3 errors、23134断言、703文件、933.37秒；源码前后未变。失败均在既有实机页面加载／布局／角色／referenceResources，新增恢复用例通过。日志 `/tmp/cs-rfc029-intake-full-check.log`，不记为全绿。
- 新增回归证明“已有回执”不等于完成：消费者必须原键重放，才能接续旧epoch和额度拒绝；两条消费者用例先红后绿，真实PG／HTTP另证429后新epoch同operationId恢复成功、只有一个操作和一次启动。认领队列同时按最近处理时间公平排队，长任务重领不能持续挡住新请求。
- 修正候选27 pass／0 fail、228断言；改动行71/71=100%、零未加载。17路径重新冻结 `/tmp/cs-rfc029-intake-v2-candidate.json` 后执行一次完整check，自然结束3659 pass／11 skip／7 fail／3 errors、23145断言、704文件、950.29秒，冻结源码前后相同。日志 `/tmp/cs-rfc029-intake-v2-full-check.log`；前次完整检查未取消，只有修正后才启动本次。6项实机失败仍在既有工作台布局／拓扑／角色／referenceResources，另releaseDelivery:130在“读取发布记录…”时断言目标文字失败；不把未定位修复的失败记作通过，也不以重跑覆盖。本地门禁未绿，本批保留待处理，不推送。管理员评估／请求端点、资源证明、失败工作区重建及UI确认／进度仍未完成；本批未提交或部署。

以上更新替代下文同项“未发布”“无服务收件”的历史进度，不改变其他TR缺口。

## 2026-09-27：持久请求与操作关联候选

本批实现恢复动作与明确能力声明、纯恢复评估、持久请求／审计、幂等与目标排他、带当前服务 fence 的认领／租约与拒绝，以及恢复请求与既有 v3 resume／retry 操作的同事务关联。新 holder 接续同一请求；原 claim、原 epoch 和不同来源 Pod 不能继续写入。完成状态只来自持久平台生命周期／子执行结果，应用没有提交 success 的接口。

恢复输入固定目标 taskId、generation、原材料摘要；子执行另固定 subtaskId／attempt，原生会话恢复另固定 sessionId，保卷恢复另固定 volumeUid。数据库在服务锁中重查业务归属、世代、当前应用能力、停止证明与后继 attempt。首次请求存 requestedBy，认领、运行、终态各有独立审计。幂等重放沿用原请求；不同参数同 key 409，目标已有活动恢复时不新增请求。认领 token 不参与 retry 参数摘要，租约接续不会创建第二个 attempt。

公开 Manifest 增加可选 `tasks.recovery.actions`，要求 fenced 执行控制；原无字段应用行为保持。v3 resume／retry 的可选 recovery 参数只能关联已认领请求，不能冒用该字段 close／pause 或执行另一目标。本批尚未接入工作台评估／请求 HTTP 端点、服务收件接口和示例应用循环，因此不能宣称按钮已经可用。

### 候选证据

- 6 个定向文件：21 pass／0 fail，213 assertions；包括真实 PostgreSQL 并发、重新实例化模块、实际 v3 HTTP resume／retry 路由和原生命周期兼容用例。日志 `/tmp/cs-rfc029-recovery-covered.log`。
- 实际路由验证四次并发 resume 只启动一次、四次并发 retry 只产生一个新 attempt；认领过期后接续、完成后的同键重放均无第二次派发。拒绝或伪造 key、claim、generation、epoch、会话策略的请求没有 runtime 副作用。
- 定向用例首次暴露 PostgreSQL 原始 SQL Date 参数序列化错误，已改用类型化时间比较并复验；取消前未启动执行使用原有平台 `cancelled-before-start` 持久证明，不把缺失 sourceStopped 当作已经停止。
- 改动行防护：295 可执行新增行中 294 行执行，99.661%；受保护生产文件全部加载，零违规。报告 `/tmp/cs-rfc029-recovery-patch.json`，包括未跟踪的新文件。
- 架构、lint、后端和工作台类型检查通过。新迁移 `0028_task_recovery.sql` 在隔离测试数据库执行；未修改已部署数据库。该迁移在本批未发布期间补充观察游标时间，锁摘要已同步，既有迁移未改。
- 契约金样：4 处新增、0 处破坏性变化；恢复 DTO 和 Manifest 的未知键、重复动作、fenced 要求有专门回归。
- 完整 `bun run check` 使用既有 dev-admin OIDC 身份自然结束：3651 pass／11 skip／7 fail／3 errors，23086 assertions，701文件，800.95秒；不能记为全绿。6项失败及3个错误来自既有实机页面加载／布局／角色断言；另1项原90秒命令用例记录89,986ms，比90,000ms断言小14ms，实际命令已正常退出。新增恢复用例全通过。没有修改这些无关用例或重跑完整门禁。日志 `/tmp/cs-rfc029-recovery-full-check.log`，冻结源码清单 `/tmp/cs-rfc029-recovery-candidate.json`，源码运行前后相同。本批准备精确提交；远端CI／部署尚未完成。

### 仍需完成的范围

| 验收项 | 当前证据与缺口 |
|---|---|
| TR-01 | 既有新旧任务列表、失败优先、弹窗已部署；状态筛选、完整详情仍需按本 RFC 核对。 |
| TR-02 | 持久请求、原子绑定和 HTTP retry 并发已证实；管理员点击到应用消费、刷新／平台重启实机未证实。 |
| TR-03 | 原 resume 关联和结果推进已通过模块测试；本 RFC 按钮链及默认变化后的同卷实机未证实。 |
| TR-04 | 动作评估拒绝旧执行未停止、原卷未验证；失败工作区明确重建状态机尚未接入。 |
| TR-05 | 契约区分 fresh／resume；RFC028专用业务已实证fresh新会话、resume同会话、同原镜像／档位，均exit0。管理员会话兼容评估和按钮链路尚未完成，不能据此关闭TR-05。 |
| TR-06 | 能力与在线 fence 检查、撤销后禁止认领、重新开放后同请求接续有真实 PG 证据；应用收件与离线页面未完成。 |
| TR-07 | 认领租约、同请求接续、旧 epoch／Pod 迟到拒绝和操作绑定有真实 PG 证据；真实发布交接仍需验收。 |
| TR-08 | 服务控制权和目标／材料篡改有回归；管理员 HTTP 权限、跨服务收件端点与读取撤权尚未接入。 |
| TR-09 | 旧票据接口沿原逻辑；完整任务详情与旧协议说明待整体验收。 |
| TR-10 | 本批没有 UI 改动；后续恢复确认和进度须沿用共享 Dialog 并做真实浏览器矩阵。 |
| TR-11 | 当前仅定向／静态通过；完整门禁、精确 SHA CI、部署与独立项目实机仍未闭合。 |

RFC-028 的未完成 RI 矩阵继续独立保留，不被本批覆盖。第三方 `tests/e2e/referenceResources.test.ts` 未纳入本批。
