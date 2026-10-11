# RFC-034 原执行收尾重连修复（2026-10-11）

状态：限定设计已通过独立功能门，源码修复与 14 条新回归已实现，相关 58 例定向检查通过；完整检查已结束并保留一个既有 Registry 用例超时。用户已批准此次本地失败发布例外，只有对应 SHA 的六 CI 全部通过后才部署。精确提交与 CI、新后端部署、原 A 实际停止回执及物理释放尚未验收。承接已批准 RFC-034 的原键停止、数字排空和原 UID 回收合同，修复已选择的独立开发 Agent 在物理清理等待期间无法保持原诊断连接的断点。

## 实际问题与范围

本机明确标记的 A 执行 `01a11899-ca07-7000-ada8-94539c911c9c` 的原 Pod UID 是 `b7e5c737-ac6a-483a-a937-b8c8d422af68`。2026-10-11 的原 API 返回 environment.state=releasing、native.state=cleaning；原容器仍 Running，日志反复发送原 hello 后收到“环境已变化，请由当前容器重新连接”。A 已有绑定和数字闭合，但实际停止证据仍缺失，不能结束或释放占额。

`modules/task-runtime/application/runnerLifecycle.ts` 在 tokenMatches 后只允许 creating/running 与 native starting/running，因此在原释放等待状态拒绝 hello。`modules/session/application/runnerHub.ts` 只有该回调成功后才建立原 RunnerConnection，持久结束作业的原键 stop 因而无法抵达仍存活的原容器。`modules/dev-session/application/development/cleanup.ts` 与 `modules/task-runtime/application/development/cleanup.ts` 正确要求原数字出口与实际停止证明；本批保持这些判据。

B 的原 Pod UID 为 `5e560268-cd02-49af-ae55-b58d88198896`；其主容器尚未启动，数字 owner 未绑定。这个事实不等于历史已知零，不由本次重连修复关闭其结束或补造绑定。实际只读证据分别保存在 `/private/tmp/observability-cs-original-agent-ending-diagnostic-20261011-v279/` 和 `/private/tmp/observability-cs-original-agent-environment-state-20261011-v285/`。

## 限定实现设计

只在 task-runtime application 的原 onRunnerConnected 项目事务中增加原清理执行的诊断分支。仍先核当前环境、原 tokenMatches 和 businessWorkspace 非 pausing。只有 environment.state=releasing、native.state=cleaning 的独立开发 Agent 才尝试既有 `developmentCleanupSelection`；该领域函数必须成功读取完整原 protection、render、consumer、启动修订、父工作卷和 Pod/Runner Secret 绑定。缺省旧执行和其他状态继续原分支。

候选诊断连接还必须经过原父上下文：先在原项目事务中核对父任务仍是同项目的独立开发工作区，并且其当前 Pod UID 与 child.native.parentPodUid 完全相等；缺失或改变都拒绝，不能借用 legacy CLI 例外。此核对同时覆盖已封闭与普通父。已封闭父随后调用原 `wakeRelatedDevelopmentParentEnding` 校验并唤醒同一持久 epoch；普通父随后调用原 `assertDevelopmentWriter`，保留原维护快照和准入判据。连接受理只写 connected=true、lastActivityAt、updatedAt。environment.state、native.state、原 token hash、Pod/Secret UID、render、启动修订、算力/价格、rebuild、诊断字段、清理证据、占额及实际终态时间全部原样保留。普通 running/creating 路径仍执行原初始化和状态收束。

不添加新的跨模块私有 import、公共业务字段、协议、迁移、环境变量或删除许可。调用既有 domain selection 与同模块 application 父准入函数，保持仓库结构和模块边界。网络、Session 和集群 I/O 不进入项目锁。

Runner ready 使用现有接线。AgentExecutionLifecycle 在原 env=cleaning 时不派发模型，已结束记录只能接续原 observation.end；owner.closeReason 的原 dispatch 提前返回 ending，不能创建新 key、材料或模型调用。原 RunnerConnection 不持久排队重发 start 命令；结束 worker 仍只发原 admission 的 stop/drain，并等待原 StopReceipt 和 Session closure。

## 回归与实机验收计划

1. 用原真实 PG/native admission fixture 创建并绑定执行，正常连接后释放至 releasing/cleaning；新增正向回归在未改源码时必须复现原 false。数字出口仍 waiting 时，重连不能删除 Pod/Secret、释放额度或生成实际结束。
2. 修复后首次、重复及重建同模块后的原连接均只更新三个诊断字段；完整原环境、集群实体及占额逐项比较。已有 rejection/message 保留。
3. 原 token 不匹配，缺失或冲突的 Pod/Secret/protection/consumer，已改变的父 UID、legacy/CLI 和 released/finished 路径继续拒绝或原 precondition；失败零状态推进和物理写入。
4. 锁定 pending/dispatched 的 selected Agent 在 cleaning 上的 ready 接续：不 start、不 bind、不签新材料，只保留原逻辑关闭和未知实际时间。现有全部正向连接、父结束和 legacy 诊断回归保持。
5. 在原 Linux 容器与原测试库运行定向回归及一次稳定候选完整 `bun run check`。源码/用例/预算不变时不重复全量追逐新的 main SHA。功能复核、精确提交、对应 SHA 六 CI 与本机部署分别验收。
6. 部署后只让同一原 A 自行重连，经原结束 worker 取得真实 stop/closure 和物理回收回执；检查原父 Pod/PVC、数字四桶/CNY/缺口及外项目资源保持。未取到回执仍保持等待。B 的未绑定结束需要其独立原事实链，不由此宣称完成。

本批不能代签性能达标、CLI/算力自测、托管 AW 联合验收或完整 RFC。名称前端修复 `67b6d44594c8239721c8a836bbd6d3203b155645` 的 CI 与 console 部署单独验收。

## 本批实现与验证记录

生产仅修改 `modules/task-runtime/application/runnerLifecycle.ts`：完整 `developmentCleanupSelection` 和同一原父 UID 共同前置，普通与已封闭父随后接原 writer / ending 唤醒。原 creating/running、legacy、初始化、拒绝、断开及停止回收实现保持。没有公共字段、协议或迁移变更。新增真实 PG `developmentCleanupConnection.test.ts` 12 例覆盖首次、重复、模块重建、原父封闭、错误 token、缺失 Pod/Secret UID、冲突 Pod UID、非法 protection、普通/已封闭父 UID 改变或缺失、旧执行拒绝。既有 `developmentObservationLifecycle.test.ts` 七例全文保留，仅追加 pending/dispatched 清理 ready 两例。

设计原门 v290 保留；根复核发现旧 ending helper 自身不比较 child 原 parentPodUid，因此补强同一父实例守卫，并由 v293 全文件复核为 VALID/PASS；根于 2026-10-11 13:30:10 UTC 全文消费 JSON/Markdown 并核对全部 13 项材料当前指纹。该门只签设计，未代签实机或源码。

未改生产时，v294 原环境 10 例得到 2 pass/8 fail，其中两个封闭父用例停在新增 fixture 的工作卷就绪前提；v295 仅复核这两例仍停在该前提，两份失败均保留。修正为原默认套餐资源快照后，v296 两例进入实际原回调，分别复现 true 预期收到 false、原父冲突预期拒绝而收到 false；生产 SHA 仍为 eda0799698da7cd64b627a7fd4d545d53ba840a80143751923bcaa124f6edebe。

源码修复后，原 Linux 容器、原隔离测试环境的 v297 四文件 49 pass/0 fail、292 expects，v298 原 selected 生命周期九例 9 pass/0 fail、81 expects；总计 58 例与 373 expects。命令和完整原日志分别在 `/private/tmp/observability-cs-original-ending-reconnect-targeted-20261011-v297/` 与 `/private/tmp/observability-cs-original-ending-reconnect-ready-targeted-20261011-v298/`，首末源码/测试指纹稳定。未改任何既有用例、断言、超时或数字/物理证据判据。这些是定向功能验证，不能代替新候选完整检查、托管六 CI 或 A/B 实机完成。


v303 对原四文件候选及全部声明材料的独立功能源码检视为 VALID/PASS，根已全文消费原 JSON/Markdown 并复核当前指纹。v299 在同一原 Linux 容器、原环境与原测试库运行一次完整 `bun run check`：6,603 pass、153 原条件 skip、1 fail、453,228 expects；失败仅为既有 `runtime-environment: actual native unlink and independent final proof preserve a shared foreign layer; rebuilt factory replays the retained original scope` 在原 5,000 ms 预算下超时。四文件在检查前后指纹一致，完整日志和退出 1 的回执保存在 `/private/tmp/observability-cs-original-ending-reconnect-full-20261011-v299/`，此结果明确不是通过。

v311 只在原容器导入 primary checkout 的原 fixture 运行分阶段诊断，没有修改源码、原用例、断言或超时，也不作为完整门禁或重跑通过依据。运行环境路径耗时 3,645.925 ms，原来源核对 102 次共 3,411.287 ms；release 路径耗时 3,459.749 ms，核对 90 次共 3,244.559 ms。原完整失败仍保留，不能由诊断回执覆盖。记录在 `/private/tmp/observability-cs-native-registry-phase-diagnostic-20261011-v311/`。

用户随后明确答复“允许这一次例外，CI 全绿后部署”，批准仅将已检视的四个观测修复文件发布，由对应提交的 GitHub Actions 完整结果决定是否部署。这是本次的单次本地门禁例外，不修改仓库通用规则，不豁免远端任何作业，不重跑同一候选完整检查，也不放宽原数字闭合、停止证明和物理 UID 清理条件。本段只补充验证状态与原失败记录，生产源码和全部用例仍与 v303 候选相同。
