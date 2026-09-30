# RFC-034 开发数字执行的结束与资源清理接入

状态：下一批限定设计v2，首轮独立设计门发现估值阻塞回收的P2，按实际两级ACK修正后待复核。当前生产开发采集OFF。普通启动屏障7682fff3和派发恢复3480032c均已推送、自身六项CI成功，并随3480032c本机部署。本规划不把内部结束evidence-complete、Pod不存在或Session absent解释成资源删除许可或Token零。

## 当前真实断点

- task-runtime/application/nativeExecution.ts 的 scheduleExecutionCleanup 先改 releasing/cleaning、旋转Runner令牌并connected=false；cleanupNativeExecution随后删除Pod。开发日志与绑定分别是两个emptyDir，Pod被删除后不能假定可读。
- domain/ledgerProjection.ts 的releaseOf会把releasing/cleaning投影为资源absent；Failed/Paused/ReleasePending也可能触发cluster-control删除，不能只拦releaseEnvironment一个入口。
- cluster-control/adapters/k8s/workloadObjects.ts:9明确拒绝数字布局与consumer共存；task-runtime/adapters/k8s/nativeExecutions.ts的旧Pod匹配又拒绝任何initContainer。直接把business completionPolicy套给开发执行既不兼容，也会错误继承归档语义。
- 现有resources WorkloadSafety承诺原PVC、Pod、Node和全部容器的独立停止证明；它没有承诺数字日志已复制或CNY估值已入账。原数字stop/closure反向也不证明全部容器退出。

这些是运行正确性与数据完整性问题。本批复用既有拥有者和停止证明，不另建跨模块SQL连接或依赖跨实例进程内总线。

## 选择与兼容

新production producer只选择“独立数字Agent布局 + 显式持久工作负载保护”的完整组合。原DevelopmentUsageStorage version1、Runner journal/protocol1和旧hello继续保持既有合同；单有旧数字布局不能事后冒充完整保护。保护通过task-runtime私有render的新明确选择及既有workloadConsumerId保存，二者在同一受理快照中固定。新选择必须实际渲染匹配的consumer/Pod/PVC身份、启动许可与停止finalizer；旧未选开发/CLI/业务行为保留。

不设置开发父会话的archive-and-delete，不改变它的工作卷所属与保留规则。新增条件只代表数字清理阶段，不借business policy伪装。现有actual layout v1查询仍只证明它已有字段；完整保护与清理须用独立的严格拥有者查询核对实际持久render、consumerId、renderStart及原实例。缺字段、冲突、替换、未知版本或不可读一律等待，不补零。

ledger与直接K8s两种创建路径必须都验证同一选择。数字布局与consumer共存的渲染规则、initContainer匹配及实际volume/挂载检查要作为同一个候选改动和测试，不能只放宽一端。无法装配完整保护时不选择新producer；不宣告来源已支持。

## 状态与顺序

~~~mermaid
flowchart LR
  A[固定原意图与人民币受理] --> B[实际新布局与原Pod绑定]
  B --> C[逻辑结束请求持久化]
  C --> D[停止原Agent并封闭数字写入]
  D --> E[复制原日志及原归属/原价证据]
  E --> F[持久原Session排空证据]
  F --> G[容器退出及独立停止证明]
  G --> H[核对原实例与子集合后回收]
~~~

逻辑结束请求先关闭原owner准入、保持首次原因、原价/nonce/原key，并持久队列。它可以立即告诉用户正在结束，不能把请求时间、logical finished、stop ACK或最后活动时间写为实际结束时间。数字排空期间保留原Runner通道、令牌、Pod和emptyDir；禁止提前旋转凭据、投影absent、清理Secret、移除停止finalizer或释放占用。

先停止原Agent并封闭原数字键，由现有Session把原数字、归属和模型证据持久复制，并保留owner原registration、acceptedAt和priceBookRevision，取得匹配的持久排空closure。Runner→Session的复制ACK在PG ingest后；Session→观测消费者的source ACK另由ledger ingest及估值完成后推进。前一级原副本与原价证据已完整保留时，可继续关闭工作负载创建准入、终止全部容器、取得原Pod/Node停止证明并回收。后一级估值失败只保留outbox重试和费用partial，不阻塞物理清理；消费者ACK不删除原事件。不能先终止唯一读取日志的Runner，再等待它提供日志。

Task-runtime L4不能导入dev-session L5；由L4声明数字结束/排空端口，platform L6装配原owner/ending/Session/consumer。外部Runner、K8s和定价调用均在拥有者/项目/资源锁外。最终Task-runtime事务必须重读实际环境，并对拍原项目/父任务/Agent/算力修订、布局、Pod/PVC/consumer身份、renderStart和结束请求；被替换的任何字段均撤销候选回收。

跨模块结束证据只有在确认原owner关闭、原绑定不可替换、原Session闭合及原副本/归属/原价证据可持续重放时才能作为稳定前缀。金额估值不是不可变清理证明；历史原生修订可按原证据更新估值。没有这项单调性证明就不能用旧查询结果完成最终事务；不得在持锁的AgentStart循环中反调task-runtime形成等待环。具体端口及事务参与者须在实现设计门中按现有锁顺序核实，不以“重新查一下”代替边界。

## 全部清理入口

单个子执行的用户取消、自然结束、失败、初始化失败、Runner拒绝及重连恢复使用同一持久数字结束请求。parent release先关闭新增子执行的受理，再对固定子集合逐个排空，保持工作卷与父Pod直到原子最终核验。branch切换、worktree重建、管理员重启同样等待该子集合，不能先删除父环境使child读取失效。

台账投影/补投影、失败保留期、cluster-control条件删除/孤儿回收及cluster-management直接生命周期操作都要识别这个明确选择。等待数字阶段时不能发布absent或允许Pod/Secret/finalizer删除；资源maintenance只触发拥有者持久结束，在其事务外推进，不自行认定到期即排空。项目彻底删除由RFC-037拥有者seal/inspection/原操作确认协议承接同一证据；保留并行输出，不在本批收编其实现。

缺少数字清理端口的选中记录也等待；旧未选记录继续原路径。工作卷停止proof与数字closure必须分别存在并匹配，不能相互代用。父卷/namespace的删除还须所有拥有者和全部writer的证据，不由单个Agent成功授权。

## 未绑定、实际丢失及开启条件

原binding=null和Session显式absent本身不够。当前startAgent屏障只覆盖这一个入口；exec/CLI/其他执行入口不在它的承诺内，也不能据此断言整个Pod无模型或无Token。尚未绑定的取消/准备失败继续等待，直到独立设计补齐实际原选择、首次派发前关闭和不会再受理的持久证明；本批不写零或伪造receipt/closure。真正丢失也保留未知，不能只凭Pod列表中不见它来证明退出。

所以新producer在上述未绑定分支、所有删除入口和consumer/事实接入都完成以前保持OFF。强制数据丢失与实际时间来源按原headless设计另批闭环，不新造无依据的成功结果；模型/身份/真实验收仍在实现与审核完成后按既有授权边界执行。

## 验证与实施分解

| 候选 | 关键反例与退出证据 |
| --- | --- |
| 完整受理/渲染保护 | 原profile/布局/consumer固定；ledger与直接K8s匹配；旧布局不升级，新组合缺保护不可被接受 |
| 数字结束/清理屏障 | stop ACK丢失、consumer失败、Session重启、finalized记录恢复；排空前令牌/连接/Pod/Secret/额度均保持 |
| 所有旁路 | 失败、初始化、重建、保留期、投影/补投影、孤儿和项目删除不会绕过；事务外I/O，无锁等待环 |
| 独立物理停止 | init/main/ephemeral全部容器、原Pod/Node/PVC；缺证据、Pod替换及迟到创建不完成回收 |
| 原价与同快照事实 | Runner复制ACK前原日志持久；原价/归属可重放；消费者ACK前valuation提交，失败保持outbox/partial而不扣留已排空Pod；重复无双计，未知不变零 |
| production开启 | 未绑定终结可闭环、真实项目/系统两级明细、精确CI与部署、获准的真实身份/模型验收 |

每个稳定候选先独立设计/实现门与有意义的相关回归，完整check同内容只跑一次；共享在制外部失败保留并作具体比例核验，候选自身CI及实际部署分别记录。第一候选的精确文件清单必须在读现有渲染、native队列、资源删除和模块能力后冻结；本文件是接入顺序与不变量设计，不伪称已写代码或已关闭CS-R02。


## 限定设计门的实际修订

首轮13项指纹不变的只读复核发现1处P2：把观测估值成功当成Session closure及Pod回收前置，会在原日志已完整复制但定价失败时无限保留容器与额度。现已区分Runner复制ACK和消费者source ACK，保留原始副本、原归属、模型与原价证据供回收后重放；不以金额永久不变证明清理。

依据为Session `application/developmentUsageIngestion.ts`的PG ingest后复制ACK、`adapters/persistence/developmentUsageState.ts`的独立水位closure、`developmentUsageSources.ts`只推进source ACK而不删除events；dev-session `application/developmentUsage.ts`在owner关闭后仍解析原registration/price/selection；observability `application/developmentUsage.ts`在ledger ingest及value后才source ACK，`drizzleTokenPricing.ts`沿原acceptedAt/priceBookRevision读取冻结价目。具体源码候选仍需单独冻结和设计门，首轮FAIL没有改写为PASS。
