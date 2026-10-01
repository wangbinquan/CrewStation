# RFC-034 开发原执行的通用删除守卫

状态：原准入回执第一片已发布部署；通用删除第二片实施 v2 / 测试修订 v3 独立 PASS，规范完整 `bun run check` 4,956 pass / 143 环境 skip / 0 fail，33,168 断言，候选与参考指纹稳定。原规范 v2 的 2 fail 保留，修订后新候选单次 gate 通过；当前精确发布、远端自身 CI 与本机升级待做。父操作、未绑定、全部 writer 封口、未知回执与真实开发采集仍待，生产 producer OFF；不关闭 CS-R02 或整体 RFC。

## 提案与实际缺口

开发 Agent 的数字副本需要在原执行 Pod 被回收前持久确认。目前 Task 专用 cleaner 已先保存 `native.developmentCleanup`，再提交 Pod 删除，最后等待独立容器停止证明并回收原凭据。Controller 的通用 `remove` 仍只有 UID 条件；Failed / Paused / absent 与 orphan 都会进入该口。`releaseWorkloadStop` 在已有 deletionTimestamp 时直接完成自己的 finalizer，是另一条实际删除完成入口。两条共同边界均纳入本片。

Resources `claimOf` 在 compact 后失去 children，任务标签也不是原归属证明。Task 保留 namespace / podName / 原 native 元数据，但当前没有定向物理名称查询。原数字 selection hash 包含 Runner token hash；专用 cleaner 最终事务旋转 token 后，现有 cleaning/releasing 查询返回 undefined，不能据此降为未保护对象，也不能用新 token 重算旧许可。

本片只复用已批准的、原绑定且有实际数字出口的路径。直接管理员删除、Task 父重建 / 父工作卷、项目与 namespace 级联、全 writer seal、未绑定及整个日志头未知仍各有后续实施门。producer 始终 OFF。本片不生成未知尾部 closure，不新增通用删除许可 owner，不让 observability 授权清理。外部直接删 Pod 已经可能使容器停止，本片只能在自己的 finalizer 尚存在时保留对象供读取，不能撤销外部删除，也不承诺抵抗 force delete / 外部移除 finalizer。

## 原目标与接口

Task 新增内部只读 `inspectDevelopmentRemoval`：输入 kind=Pod|Secret、namespace、物理 name、请求 UID、operation=delete|stop-finalizer；输出 `unselected`、`waiting(reason)`、`permitted(resourceVersion)` 或 `absent`。不增加 HTTP、MCP 或用户清理指令，不返回 Secret 内容、原 token hash 或完整 owner 证据。Cluster 只声明结构兼容的中性查询端口，由 platform 使用 Task 公开 API 装配。

Task repository 按 namespace + 原 pod_name 查询，Pod 使用完整物理 name，Secret 只对严格 `-runner` / `-admission` 后缀取得原 Pod 名；最多返回两行，包含 finished / released / failed 等全部状态。先查原行，再判断显式选择，不在 SQL 里按 truthy flag 排除坏值，不扫 `listClusterTasks`，不依赖标签、当前台账或反推历史 UID。两行即歧义 waiting。增加 0018 非唯一 `(namespace,pod_name)` 索引，不改变旧行唯一性；只用官方带单一路径的 migration lock 生成器追加登记。已有迁移与并行条目完整保留。

`developmentRemovalProtection` 缺失是旧选择，继续既有清理行为；字段存在但版本、依赖的 usage protection / layout / 原元数据无效一律 waiting，包括 null / false / 0 / 空对象。新选择由实际 Pod、Runner Secret、admission Secret 渲染共同写 `crewstation.io/development-removal-protection: "1"` 注解，常量放在已有 contracts developmentAdmission 文件。注解仅用于端口缺失或行缺失时识别保留，不是许可。值存在但非法、标记与原行选择矛盾、标记对象查无原行均 waiting。标记仅由实际新建对象的渲染发出：ledger 模式的 workloadObjects Pod / Runner，native 模式的 createOrRead，以及实际 admission Secret builder；不写入 Task 受理 render / labels、ledgerProjection 的期望 annotations、WorkloadAdmissionPod 校验期望或 selection hash。既有同名对象只读取核验，不能补 apply / patch 标记。正常组合必须装配 Task 查询；查询失败不可返回 unselected。第一片已创建而无注解的对象仍由正式组合的物理查询识别，不回填 UID 或注解；未装配查询的旧调用方不承诺识别这类对象，生产开启前必须证明完整装配。

## 原数字出口与终态

active 路径仅 cleaning + releasing，复用现有 `developmentCleanupSelection` 与 `requireDevelopmentCleanupEvidence`。尚无绑定、其他状态、缺实际数字出口、原 journal / identity / profile / CNY 受理或已知 N/M 中断证据不一致均 waiting；Session absent、空页、Pod 缺失不是数值零或无 writer 证明。

新选择的专用 cleaner 在最终、原 jobId / fencingToken / 项目锁事务内，先再次验证原 selection 和数字 evidence，再原子保存 `native.developmentRemovalSeal={version:1, originalRunnerTokenHash, selectionHash}`，与 finished、额度释放及新 token hash 同一次写。原 hash 只留在 Task 私有 JSON，不进入公开 DTO。旧未选择路径不增加 seal；旧终态没有 seal 不倒填，明确 waiting。

finished 路径严格解析 seal，要求 env released 或 failed、native finished，seal 的 selectionHash 等于已保存 evidence selectionHash；以私有原 token hash、临时 cleaning/releasing 状态重建同一 selection，并重新核所有现存受理不变字段。任何修改、UID 冲突或混入其他执行 evidence 都拒绝。seal 不是单独许可，必须与原数字 evidence、Resources 原 consumer / permit / admission UID 和实际对象一同通过。后续查询没有持久写或锁内 Kubernetes I/O。

## 数字与物理条件

| 动作 | 必要条件 | 不可替代的事实 |
| --- | --- | --- |
| 原 Pod delete 意图 | 原数字 evidence 已保存；原 selection 完整；Resources 原 consumer 身份、closed admission 的两份 ACK、原 startPermit / Pod / Node / intent 与原 admission UID 一致；live Pod UID 和完整受理规格一致 | 此动作不先要求由删除才能产生的全部容器 stopProof，避免互等 |
| Controller finalizer 完成 | 上述数字与原身份条件；Resources 已持久同一原 permit / Node 的 kubelet-terminated proof；覆盖原全部 init / 主容器；live 原 Pod 已 deletionTimestamp、实际 UID / 规格仍一致 | 已物理停止不代替数字复制出口；只移 Controller 自己的 finalizer |
| 原 Runner / admission Secret delete | 上述原数字、closed admission、原全部容器 stopProof；live API 确认原 Pod 当前不存在；Secret immutable / 物理名称 / 原归属 / 原 UID 及实际材料全部复用专用 cleaner 校验 | Runner 校验原 token hash，finished 使用 seal 中原 hash；admission 必须原持久 UID及原 permit 四元，缓存已剔除 data，不能只看 metadata |

Task 内部 K8s 只读 adapter 复用专用 cleaner 的 admittedSpec / originalSecret / allOriginalContainers 纯核验，保持旧校验强度；不把 Secret 数据交给 Controller、日志或缓存。每次 live 读有 15 秒 deadline，错误 waiting，暂时不可读不生成不可取回出口。目标确实 absent 可返回 absent，表示本次物理操作没有对象可删；该结果不写 Task 终态、数字 closure、stopProof、额度释放或任何无 writer 证明。

selected 正向结果携带实际读取对象的 resourceVersion，实际 Pod / Secret DELETE 同时使用原 UID 与该版本前置条件；版本竞争等待下一轮，不沿用旧许可删除同名新对象。finalizer 在 live UID / resourceVersion JSON Patch CAS 前查询同一数字 guard，许可版本必须等于将 patch 的当前版本；发生竞争 waiting，下一轮完整重查。正常旧未选对象保留原 UID-only 删除和原错误语义。

## 两个实际边界与等待进展

默认 Kubernetes writer 的 remove、releaseWorkloadStop 在实际调用 API 前共用同一 guard；未装配端口时读取 live 标记并保留新选择对象。createClusterControlModule 传入的自定义 ClusterWriter 也由同一 adapter wrapper 守卫，不能仅保护默认 factory 而使注入路径旁路。默认 writer 不重复包两层。其他 kind 和旧未选对象保留现有行为。platform 只接 Task 公开查询，不读取 Task / Dev / Session 私表，不启 producer 或改变默认算力。

ClusterWriter 的删除和 finalizer 返回 `void | {kind:waiting,reason}`，以保留旧替身成功返回 void 的接口兼容。waiting 必须返回给调用方，不是成功 no-op。removeChildren 遇 waiting 不增 removed、不写 removed 成功日志，按现有 enqueue / retryMs 安排同记录重试，并继续同记录其他对象。workloadSafety 遇 finalizer waiting 不写 WorkloadStopped=true，保留 unknown / waiting 并重排。orphan 所有 Pod / Secret 分支（包括无任务标签的旧 Secret sweep）逐对象记录 reason，继续后面的对象；可返回仅在有等待时出现的 waiting 计数，旧零等待结果形状不变。API 其他错误继续传播，不能泛化吞错。

这里只读既有 owner 数字出口，不在 Controller 查询里推进 Task 生命周期、伪造作业或关闭 Session。缺原 job 或 Task 尚未进入 cleaning 时保持等待，其 owner 协调与全入口 seal 继续属于后续；本片不能单独宣告所有 Failed 执行均可最终回收。parent / namespace 入口不能借本片许可放宽自身屏障。

## 验证与退出计划

1. 冻结精确源码 / 测试 / 迁移 / 文档 allowlist、当前参考指纹和并行 WIP；独立设计 PASS 后才改源码。若必要路径超出冻结范围，先更新设计门，不静默扩包。
2. Task PostgreSQL +实际 module query：物理名称而非标签定位，compact 后仍能识别；两行歧义、跨 namespace、错误原 UID、各种坏 flag、缺 consumer / admission UID / 数字出口、PG 故障均 waiting；旧业务 / CLI / 未选开发仍 unselected；两种创建模式分别覆盖第一片已创建但无 marker 与新创建带 marker 的对象，原 inspectWorkloadStart / 原 cleanup 校验期望不变，数字许可前两者均等待，许可后均用同一原 UID 与材料校验。
3. 正向绑定执行复用真正原数字证据；清理最终事务保存 seal，当前 token 已旋转仍可检查原残留；缺 seal 与不可变字段变化拒绝。Job fence 被接管或最终提交失败不产生 finished seal / 额度释放。既有完整与已知中断的 raw-to-PG 用例继续。
4. K8s 实际 factory 和注入 writer：数字缺失无 DELETE；Pod 意图先于容器停止；外部 deletionTimestamp / proof 已持久而数字尚无时不移 finalizer；数字之后原全部停止才完成；Secret 实际材料、原 UID、resourceVersion 与替换竞争都核验，无凭据输出。
5. 调和 Failed / Paused / absent、orphan 带标签和无标签路径：waiting 不记 removed / stopped=true；一对象等待后仍回收独立旧孤儿；数字原出口出现后下一轮恢复。同源 E2E 组合真实 Task / Resources / Session / Dev 的现有 PG 与 fake Kubernetes 链，不用测试直接塞 permitted 替代链路。
6. 运行针对性用例、类型 / lint / 架构及一次完整 CS gate；候选字节不变复用该 gate，源或依赖改变才重跑。精确提交、远端同步、精确 CI、冻结 SHA 两镜像及本机八组件部署另取回执。producer OFF、真实开发与全 writer seal 仍不关闭。

测试事实与真正本机任务区分记录，不把 fake K8s 或独立数字替身宣称生产开发实采。上一片实际业务分类 24,423 Token / ¥0.026922 不用于证明本片开发停止或托管联合装配。

## v1 设计失败与 v2 修订

v1 独立设计复核 FAIL 的唯一 P2 是新识别标记可能进入原期望 annotations，导致 `assertWorkloadGate` 的 covers 把第一片无标记原 Pod 误判为不符。v2 明确只在三个实际创建渲染点发出，补入 `modules/cluster-control/adapters/k8s/workloadObjects.ts`，保留原期望和 selection hash，并补两种创建模式下旧无标记 / 新有标记的兼容回归。原 FAIL 没有覆盖为 PASS；v2 的 44 路径候选与指纹另行冻结并独立复核；设计复核时尚未改源码，PASS 后才进入本片实现。

## v2 实现中的分层与已复现回归

内部 Task API 和 Task 端口各自声明结构兼容的只读目标与判定，不跨层反向 import；Controller 的中性查询合同归自己的 ledger 端口，writer 端口只复出类型，避免类型环。终态私有 JSON 在 TaskEnvironment 中只声明数据形状，所有读取与最终生成仍由严格的 removalEvidence schema 核验，不能仅凭形状取得许可。接口形状和三个物理动作的必要事实不变。

真正 finalizer 等待回归先红：原调用方把 waiting 记为 WorkloadStopped=true；修正后 unknown / 同记录重排通过。实际 JSON Patch CAS 回归也先红：相同 UID 的版本竞争直接抛错；修正为 selected 等待并重查，旧未选错误语义保持。初轮隔离 PG / SQLite / K8s 组合 46 pass / 1 fail，唯一失败是 checkout 非选择测试传了空 UID，正确触发非法目标 waiting；修正测试 UID 后，精确修正路径 20 pass / 0 fail。失败原件保留，尚未以此代替完整门禁、实现门、远端 CI 或本机部署。

## 注入实际 factory 的修订设计 v3

实施 v1 的唯一 P2-01 是注入 `kubernetesClusterWriter(k8s)` 没有配置 owner query：外层 Task 查询许可 R 已传入 target，但内层对旧无标记对象降为 unselected，DELETE 丢掉 R；finalizer 改用重读的 R2；新标记对象则一直 owner-unavailable。原实现 FAIL 回执 `83d4f599cd09fddd40a97765adaee8208d9c7b910f786738ee10fd232c0764d5` 完整保留，不能用已有替身参数转发断言代替真正 factory 的执行。

修订仍在已批准 44 路径内，代码只需改变 `developmentGuard.ts`、`managedObjects.ts`、`safety/workloadStop.ts` 及现有 `managedObjects.test.ts`。Task owner、真正数字证据、creator receipt buffer、查询合同及 marker 规则均保持原样。不得重建原 writer 或清空其原准入回执，不往公开 target 增加可伪造的数字许可。

1. Guard adapter 私有 `AsyncLocalStorage` 只转发原只读 owner query。外层获 permitted 后，在委派该原 writer 的实际调用期间绑定 kind / namespace / name / UID / operation / 已获准 resourceVersion 六元组。内层没有显式 query 时，仅在六元组完全相同、scope 尚有效时读取该 query；每次仍调用真实 Task owner，重新核完整数字与材料及 RV，不复用已返回的 permitted。内层显式配置的 owner query 始终优先，拒绝不得覆盖。
2. scope 不公开、不进入 DTO/日志/缓存，不是跨请求许可；并发调用、其他 kind / 名称 / namespace / UID / operation / 版本不能借用。委派 settle 的 finally 将 scope 撤销，包括异常；随后异步后代不能取得 query。外层拒绝或 absent 不创建 scope。任意调用方单独传 resourceVersion 都不等于选中对象数字授权，新 marker 缺 owner 仍等待。
3. 实际 DELETE 总是保留显式传入的 UID 和 resourceVersion；selected 时继续使用内层真正 owner 当次 permitted RV。显式 RV 或 selected CAS 竞争返回 waiting，重新走原查询；完全未带 RV 的旧未选对象继续 UID-only 与既有 UID 替换行为。
4. 实际 finalizer 首次 live 对象的 RV 必须与显式传入 RV 相等，否则直接 waiting；数字 guard 返回 permitted RV 也必须等于当前将 patch 的 RV。JSON Patch 同时 test 原 UID 和上述同一个 RV，只移自己的 finalizer；任何显式 RV / selected 版本竞争 waiting。普通旧未选、未传 RV 路径保持原错误语义。

先添加真实 `guardedClusterWriter(actualFactory)` 反例并验证现有代码红，再实施上述修订：旧无 marker / 新 marker 两者在原 owner 尚未许可时无 DELETE/patch，许可后真正执行成功；外层许可后、内层读之前的同 UID 材料/RV 变更仍等待且真正 owner 再查；内层许可之后实际 DELETE/JSON Patch 的竞争也等待；下一轮完整 owner 重查后恢复。另覆盖内层显式 owner 拒绝、上下文目标/动作/版本不匹配、并发 scope 隔离、委派结束后撤销及普通参数不能伪造许可。保留原 creator 实例和回执方法引用的断言。

v3 精确文档与当前实现 v1 源码指纹冻结后先做独立设计门，PASS 才添加回归/改源码。随后冻结实现 v2 做独立实现门，稳定候选只运行一次规范完整 CS gate，再精确上库、CI 和本机部署。生产 producer 保持 OFF；这仍不关闭 CS-R02 的全入口 seal、未知尾部、跨进程回执或真实开发实采。

## 修订设计 v3 与实施 v2 的定向证据

限定独立设计 v3 PASS，回执摘要 `796c8743ce32c33a6e9e1690b9df6a269f7c979136b06cf598a7c0e36fb0d56e`；只改既有四条 adapter / 测试路径，marker / 原 Task 证据和 creator 实例均未放宽。真实嵌套 factory 新反例在旧实现上 2 pass / 11 fail；修订后最终 Controller 三文件 36 pass / 0 fail、227 断言。新旧 marker 的 DELETE / finalizer 均覆盖数字未就绪、外层后材料变化和 API CAS 竞争；内层显式拒绝、目标六元组、并发及调用成功/异常结束后仍注册的异步后代不能借 query。原 writer 回执方法引用保留。

实际隔离 PG / SQLite / Task / Resources / Session / K8s 链三文件 23 pass / 0 fail、213 断言；后端 typecheck、四条精确 ESLint、59 单元 / 3,773 源码 arch:check 与 diff 空白检查通过。原实施 v1 FAIL、设计 v1 FAIL 及红回归原件全部保留。此处不是规范完整门禁或真实生产开发实采，下一步冻结实施 v2 独立复核、稳定候选一次完整 gate、精确上库 / CI / 本机部署。

## 规范完整门禁 v2 的原始失败及小范围修订设计

实际 `bun run check` 已完整结束：结构、lint、后端与工作台类型通过；4,945 pass / 143 环境 skip / 2 fail，33,097 断言。全部 44 候选路径和 65 参考指纹前后稳定，生产 producer OFF。原失败回执与完整日志保留，不能用定向重跑替代其失败结论。

两个失败文件均与当时已提交 HEAD 相同，没有把它们归因于并行在制品：`projectReconfirmation.test.ts` 的全流程重新确认、全部 owner 清理和删根后重放用例超出默认 5 秒；`referencePanel.test.tsx` 的申请用例在目录读取完成前直接访问 `list().querySelectorAll`，列表为 null。真实删除夹具只装配 Project / Identity / EventBus 与有状态外部替身，不调用本批通用物理 writer；参考面板为真实工作台路由加 fetch 夹具，本片无 console 生产改动。一次定向诊断 7 / 0 和 6 / 0 只是缩小故障条件，原全量 FAIL 保持。

后续仅增加两个精确测试路径，原 44 变为 46：全流程真实 PG 重确认用例采用相邻 `projectDeletion.test.ts` 同类全部 owner 清理的 15 秒单用例时限，保留所有权限、原封闭证明、失效许可、终态和删根重放断言，不修改生产 deadline、不增加 retry / skip。参考面板申请用例等待既有 `listReady()` 的真实列表完成；该用例用可释放的目录读取 gate，确保渲染刚返回时尚无列表，再异步释放，锁定等待而非依赖固定睡眠。旧立即 DOM 读取必须在此 gate 下变红，修复后对原弹窗、取消、侧栏形态、行内不展开断言保持。

独立修订设计通过后改这两个测试；定向红绿及原 guard / PG 全链结果分别留存，再冻结新候选作独立实现复核。因为原规范 gate 已失败且该候选测试内容实际改变，新候选允许一次 `bun run check`；不因 unrelated main 推进重跑，也不删除或改名原 FAIL。发布仍须精确 allowlist / 独立实现 / 成功本机 gate / 自身远端 CI，之后才升级本机。该修订不改变 Task/Controller 产品语义，不关闭 CS-R02、producer 或完整 RFC。

### 测试修订实施与候选 v3

修订设计 v4 独立 PASS，原源码／迁移 41 路径保持实施 v2 指纹。受控目录场景进一步确认：平台 `/business-tasks` 可先显示，申请 `/invoices` 尚未返回，因此 `listReady` 在申请用例必须等待指定目标行，其他用例的默认平台行条件保持。反例不带目标行等待为 5 pass / 1 fail，实际 rowOf(undefined) 变红；补指定等待后两个文件 13 pass / 0 fail、117 断言，精确 ESLint 无输出。最初“目录未就绪意味着列表容器必为 null”的夹具假设被撤销，那个失败和被停止的递归 DOM 输出诊断留存，不作为有效红绿证据。

PG 仅完整重确认清理用例明确 15 秒，与相邻全部 owner 清理预算一致，所有功能断言保持；UI 的读 gate 通过 finally 释放，不增加固定睡眠、retry 或 skip。46 路径候选 v3 将复用已通过的 41 路径独立源审与真实 PG／Controller 回归，只新增复核两个测试与文档证据。原规范 gate v2 仍 FAIL，待新候选独立实现与一次规范 gate，未发布、未部署、producer OFF。

### 新候选规范 gate 与精确发布准备

测试修订的独立实现 v3 PASS；实际规范 `bun run check` 2026-10-01 18:59:53Z 至 19:15:57Z 完整完成，4,956 pass / 143 环境 skip / 0 fail、33,168 断言、5,099 用例／971 文件。结构、lint、后端／工作台类型及完整用例均成功，候选 46 路径与 72 参考的字节前后相同。143 skip 为本机缺少外部实机依赖，不能据此宣称这些路径已实采验收；远端六层自身 CI 仍待。原 4,945／143／2 fail 的规范 v2 和有效页面红例保持原结论。

检查期间其他会话正常提交与本片没有路径交集的数据控制修订，本片源内容和直接依赖未变；依共享候选验证规则复用本次成功门，不因为新 main 再跑全量。发布候选只包含 46 allowlist 中 44 个实际改动文件，三个文档在成功 gate 后只补当前证据；不收编并行 Data 或 RFC-036 架构设计输出。生产 producer OFF，父生命周期／全 writer seal／未绑定／unknown-tail／开发实采均不在这一步的完成声明中。
