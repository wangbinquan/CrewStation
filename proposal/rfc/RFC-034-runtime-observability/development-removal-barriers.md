# RFC-034 开发采集的通用删除与未绑定退出屏障

状态：下一阶段草案的独立只读设计复核 v2 已 PASS，尚无任何实施批次的精确源码 allowlist，未开始本草案的实现。原绑定清理已部署；开发明细 35 路径与完整组合根已在 `557cb50c5b6800771a5d016526d7a4d49d61eb77` 完整部署八组件 Ready，consumer 与两级事实已接通；回执提交 `1d896ab777b9dbe133a4db79f98d585fb5600831` 六项 CI 成功。生产开发 producer 仍 OFF；本草案 PASS 不构成通用删除、未绑定和全 writer 封口的实现或验收结论。

## 必须解决的问题

Token 数值保存在执行容器内的独立日志中。取消或清理不能先删除唯一可读副本，再把无数据记成零。正常数字出口、显式缺口与物理停止是三类独立证据。

| 当前入口 | 现有事实与缺口 | 下一阶段约束 |
| --- | --- | --- |
| [原绑定 Task 清理](../../../modules/task-runtime/application/development/cleanup.ts) | 已持久原数字许可，真实 job fence 内两次确认；Session/Kubernetes I/O 在项目锁外 | 保留现有成功路径与原价/原身份，不拿它覆盖未绑定 |
| [通用删除](../../../modules/cluster-control/adapters/k8s/managedObjects.ts) | `remove` 带 UID 条件；尚无数字 owner 许可核对 | Pod/Runner Secret/准入 Secret 的实际 UID 与明确选择分别核对，缺数字许可等待 |
| [调和删除](../../../modules/cluster-control/application/reconcileObservations.ts) | Failed、Paused、absent 等分支调用同一删除能力 | 未排空不增加 removed 统计，不把等待写成删除成功 |
| [孤儿回收](../../../modules/cluster-control/application/orphanSweep.ts) | 按年龄、台账认领和旧任务状态判定 | 台账缺失、旧缓存及逻辑终态均不是数字清理许可；单个等待不饿死其他对象 |
| [保留期](../../../modules/resources/application/maintenance.ts) | 到期直接更新 desired=absent；结束记录随后可能压缩 | owner 在资源事务外持久请求结束；等待期间保持原物理期望及 owner 记录 |
| [父环境重建](../../../modules/task-runtime/application/requestRebuild.ts) | 管理员重启先调度 child 清理，但随后立即更换父 Runner/Pod/render | 固定 child 集合闭合之前保持父材料与工作卷；重建不能只等待逻辑 child 终态 |
| [未绑定 owner](../../../modules/dev-session/application/development/cleanup.ts) | 原 owner 无 binding 返回 waiting | 独立新出口；不虚构 Session receipt、binding、closure 或已知零 |
| [命令派发](../../../modules/session/application/commandDispatch.ts) | 当前 startAgent 屏障不承诺 exec/CLI 等所有入口 | 如证明从未启动，必须覆盖选中执行所有可创建 writer 的路径；没有证明则保留未知 |
| [物理准入](../../../modules/resources/api/workloadSafety.ts) | closed admission/no permit 有持久 no-writer tombstone；不能冒充 Pod 停止 proof | 与原选择、实际 job 和容器布局对拍；有 permit 必须走独立容器停止 |
| [namespace 退出](../../../modules/cluster-control/adapters/k8s/namespaceRetirement.ts) | 完整发现和 UID CAS 已存在 | 资源为空不能代替 owner/writer seal；项目删除参与者由 RFC-037 承接 |

## 证据与边界

每个原执行固定项目、父工作区、Agent、真实 execution ID/generation、算力修订、CNY 受理、consumer、renderStart、原 Pod/PVC/Node 与凭据 UID。当前绑定清理的准入 Secret 只核原四元许可及当次读取 UID，不能据此声称历史 UID 已保存。下一阶段先在新受理/实际创建回执中持久原准入 Secret UID；缺历史 UID 的旧记录继续按原批准路径，不能回填一个看起来相同的 UID。

数字证明与物理证明分开。正常完整和原已知 N/M 中断路径保留现有先数字出口、后 Pod 删除意图的顺序。整个日志头未知的路径另分两阶段：先持久保全原归属/原价、已知且实际已复制的前缀、明确不可取回的未知尾部原因，以及覆盖全部 writer/在途受理的 seal；该停止准入前缀只允许对原 Pod 发出停止/删除意图，不是最终数字 closure，也不许可 Secret 删除或额度释放。随后 Controller 持久原全部容器停止 proof，再完成最终未知出口与 owner 闭合，最后才清理凭据和占用。不得用需要该 Pod 删除动作才能产生的 stop proof 反过来阻止唯一停止动作。Controller 仅在自己的独立物理 proof 持久成功后移自己的 finalizer，Task 不移 finalizer。暂时的网络/Session/PG 故障、查询超时或 Session absent 不能充当不可取回证据；能够读取的原页必须先复制。消费估值失败保持 outbox/partial，原数字副本已安全保存时不扣留物理资源。

通用删除 guard 由 cluster-control 的中性端口声明，platform 只以 Task/Dev/Resources 的公开 owner 能力装配。observability 不授权删除，也不读其他 owner 私表。任何具有新明确数字保护选择的对象在端口缺失、格式冲突、owner 查询失败或 UID 替换时等待；业务、CLI 和旧未选开发保持原行为。新选择的识别标记须来自原受理/渲染，不能只靠一个可伪装的 task label 或现有通用 consumer 注解。

不可将 guard 的等待实现成返回成功的 no-op。调和器需要可重试的等待结果；孤儿回收逐对象保留等待原因并继续其他对象。直接管理员删除、Kubernetes rebuild 私有删除以及 native 清理也纳入入口清单，不能只包一层 `ClusterWriter.remove` 就声称全入口完成。

Resources 的到期/压缩过程先在锁外取得单调 owner 状态或请求结束，再在自己的行锁内对拍资源 id/generation/原选择；不得持资源行锁反取项目锁。Task/Dev 最终事务对拍真实 job fencingToken、固定 child 集合和原受理，不在锁内做 Session、定价或 Kubernetes I/O。

## 未绑定与不可取回

| 状态 | 可接受出口 | 不能采用的推论 |
| --- | --- | --- |
| 无 binding，原准入已关闭且从未 grant | 独立证明 Task 原作业与后续创建受理已封闭、选中实际 init/容器布局不能绕过保护、owner/AgentStart 已关闭，才允许相应物理回收；数值仍未知或不支持 | binding=null、Session absent、列表不见 Pod 不能单独证明没有 writer 或 Token=0 |
| 无 binding，但曾发放 permit/曾可执行命令 | 先取得实际原来源副本，或持久可读末尾与明确不可取回缺口，再取原全部容器停止 proof；保持无 binding 的事实 | 不为复用绑定成功分支伪造 registration 或 receipt，不因超时写 loss |
| 已复制 M、原日志头 N 已知 | 复用原显式 interrupted 出口，保留 M/N、缺口、原价和原归属 | 不把 M 当完整 N；不重跑模型来补账 |
| 整个日志头未知 | 先持久原已知数字前缀、实际不可取回原因与全 writer seal，取得仅原 Pod 停止意图准入；独立全部容器停止后才形成最终 unknown-tail 出口。前缀不授权凭据/额度回收 | 不填写 finalThrough=0、空页或从未启动的结果；不要求停止动作前先取得由该动作产生的最终 proof |
| 原 Pod/Node/凭据被替换，或原记录要求持久的历史 UID 缺失 | 等待或明确需处理，保持原记录和占用，不能授权新对象。旧批准准入 Secret 路径没有历史 UID 要求，仍保留原四元许可加当次读取 UID/CAS 的既有规则；不把它升级为历史 UID 证明 | 同名、相同许可内容或超时不是已要求持久的原实例证明；不以新增要求否定旧准入例外 |

全 writer seal 与 Session/Runner 在途命令的边界必须另行冻结：仅在发送前查一次数据库不能排除检查后迟到写入；取消 request/ACK 也不是封闭证明。设计门应明确各入口、持久 seal、在途集合、恢复和真正结束来源。未完成这个证明之前，新 producer 继续 OFF。

## 分批实施与退出条件

1. 原准入 Secret UID 与明确新选择的持久来源：列出 ledger/direct 两路的实际创建者、回执和失败恢复，不改旧 v1 协议的承诺。
2. 通用数字删除许可：中性端口、公开 owner 查询/持久请求、原 UID/CAS、逐对象等待；先覆盖通用 remove、Failed/Paused/absent 与孤儿，保留直接/管理员/rebuild 入口待办。
3. 到期与全部父操作：保留期/压缩、父释放/分支切换/worktree 重建/管理员重启，关闭新 child 受理并冻结真实集合，在所有 child 的数字与物理出口后推进父操作。
4. 未绑定、unknown tail 和全 writer seal：独立版本证据，保持旧绑定成功路径，禁止虚构零。实际 Pod 丢失或替换不自动终结。
5. 完整装配：只在上述全部出口、consumer 和两级事实已通过各自 CI/部署后选择新生产组合；CLI/算力测试仍按自己的能力矩阵独立启用。

每批实现之前读取现行模块原语并冻结精确文件/参考指纹，通过独立设计复核后动源码。当前草案尚不构成任何一批的冻结源码 allowlist；不凭这里的路径链接直接开始跨模块实现。共享 STATE/RFC 索引及 RFC-037 在制品不收编。

回归至少覆盖：数字未复制时所有物理材料保持；原 Pod/Secret UID 替换；无 grant/有 grant 的未绑定分别验证；迟到创建/迟到 Start/exec、seal ACK 丢失与实例重启；真实 job 过期接管；到期与 owner 同时请求结束；child 集合变化；重建期间原父令牌/Pod 保持；单个孤儿等待时其他旧对象仍清理；数字/CNY 消费重复与估值失败；原副本可恢复、M/N 缺口及完全 unknown tail。使用实际 PG/SQLite 和受控 Kubernetes/Runner 传输，夹具不得手写 grant/closure 绕过实际链路。

本草案是 CS-R02 后续依赖的落档，不关闭 CS-R02、真实身份/模型验收或完整 RFC。

## 原准入 Secret 回执第一步的精确设计

[原准入 UID 回执设计](./development-admission-receipts.md)明确 ledger/direct 都由 Controller 在实际准入创建后登记，提出独立新选择和 Resources 持久回执，保留旧批准四元许可/current UID 例外。缺失真实创建回执不得倒填历史 UID；生产 producer 仍 OFF。本批精确源码冻结和独立设计门尚待完成，后续通用删除/父操作/未绑定/全 writer seal 不因此关闭。

### 第一步 v1 失败与 v2 补交边界

第一步 v1 独立 FAIL 的真实 P2 是已知 create UID 在 PG 保存失败后被 closure/ReleasePending 早退跳过。v2 以同 creator 的 128 项有界原回执、成功 CAS 才 ACK、公共 reconcileRecord 在 ledger/关闭判断前的仅补交入口及有限 pending ID resync 覆盖此缺口；不重开准入，不凭同名对象倒填，不冒称跨进程 unknown 回执恢复。v2 独立设计门待验，所有源码仍未改，完整删除/全部 writer seal 与生产 producer OFF 边界保持。共享 migration lock 的并行条目由 owner 保留并准备发布依赖，观测文档继续独立提交。


### 原准入回执第一步 v2 设计门（2026-10-01）

[限定回执设计](./development-admission-receipts.md#v2-独立设计复核与共享前置条件2026-10-01)独立复核 PASS；原 v1 已知 UID 在 PG 失败后被关闭早退跳过的 P2 已在设计层闭合，原 FAIL 保留。共享 migration lock 已由并行 owner 随 `b6999edf` 发布；四份观测设计可独立提交，不收编共享登记或并行源码。43 路径实现、完整验证和部署仍未完成，producer OFF；全部 writer seal、通用删除、未绑定与跨进程 unknown receipt 继续，不能据此关闭 CS-R02。
