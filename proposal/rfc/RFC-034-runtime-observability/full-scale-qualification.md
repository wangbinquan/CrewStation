# 项目与系统完整统计的实际规模验收

本片执行已批准完整统计的 100K Task／10M usage 验收。公开分页只限制单包，不选择统计人口。所有计数、Token 四桶和人民币估值必须来自完整原来源和真实 EOF；不能以原 201 Task／1001 attempt 的数组 facts fixture、SQL 预汇总、缩小人口或已有小规模 PASS 替代此验收。本片是明确标记的合成验证，非实际模型任务和供应商账单。

## 原始人口与原正式链

独占的新 PostgreSQL 17 验收数据库按原迁移初始化。通过有界批次写入原 business-task 的 `execution_operations` 与 `execution_subtasks`，共 100,000 个 v3 Task、100,000 个真实原表 attempt；每 Task／attempt／execution 的原身份独立。名称、项目与算力目录同样使用原已持久来源。不得给正式 facts factory 注入由种子循环构造的 Task 数组或自制 aggregate。原 `readBusinessObservationTaskPage` 与 `readBusinessObservationAttemptPage` 从物理原关系按原 keyset 一直读取至 EOF，开发来源同样运行原来源查询并证明为空。

原 observability 关系写 10,000,000 个唯一 request 用量，每 Task 100 条，对应原 Native capture／step membership、原投影和原 valuation 身份。每条用量输入1、缓存读3、缓存写5、输出7；100K Task 的每条 request 身份均可由独立序号逆解。人民币验收配置明确标记 `ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL`，四桶费率分别为每百万 Token 1／2／3／4 元，每记录价值 0.00005 元。独立精确预言为四桶 10M／30M／50M／70M、总 160M Token、人民币500元。

调用原 `createObservabilityModule` 中正式 complete report 装配，使用原 report snapshot、platform 完整 facts factory、`buildCompleteRuntimeCohort`／`buildCompleteRuntimeTask`、原完整 ledger sources、原 TEMP 排序与覆盖 workspace、file spool 和 report cache。必须实际 drain 原 worker，不能用测试自制 seal／store 替代原装配。分别核对系统和指定项目报告；原运行时、项目、算力、模型名称与受理身份保持。除空的无关能力依赖外，不伪造来源或完整性。

发布 ready 后，通过原 API 逐页读完整 Task、execution 与 allocation 到 null。100K／10M 位图只验证重复、缺失和原 identity，不参与统计。不将全量 Task／用量／结果保存在 Map／数组。每条 allocation 的所属 Task／attempt／execution、model、scope、四桶与人民币必须一致；库存、summary、项目汇总、算力与趋势也必须匹配独立预言。原来源末尾、末页和原 snapshot 水位必须一致。

## 同组大 summary 与测量

另一个独立 hosted Linux job 在原 PostgreSQL snapshot 的 TEMP workspace 写入 10,000,000 条同 source／execution／root 的非覆盖 `self-total`。每条有独立叶 session 与 root→leaf 的原完整 ancestry，保持原排序、持续覆盖 prefix maximum 和 selection。原消费者必须 selected=10M、excluded=0、unavailable=0、ambiguous=0，四桶精确；再读所有原 allocations 至 EOF。这个场景不冒充价格报告或真实模型请求。

首次完整构建、种子、全量 EOF 对拍的时长分开记录。ready 的原 status、第一页及末页各100次，报告 P50／P95／最大值，并保留既有 P95 <500ms 目标。失败不能通过改动数量或只测头部变为 PASS。

使用真实 OS 测量：GNU time 记录被测 Bun 的峰值 RSS；原 PostgreSQL service 的实际进程内存单独记录，不混为 Bun RSS。每5秒测量原 DB/WAL、TEMP、report spool、已 unlink 但原进程仍打开的临时文件和实际根盘剩余空间，明确为采样最大值。控制台保留阶段／人口进度，避免 runner 终止后只剩最后结果。TERM／KILL 的实际测量控制仅验证中断证据，不算全规模 PASS。所有原失败日志、资源原文和 partial measurement 保留。

AW 的原确切 hosted 规模运行 37366135115 attempt 2 在原人口全部写入后因 TEMP 累积耗尽磁盘，其实际证据不证明 CS 同一失败。CS 本片继续使用原算法，必须实际量测；如自身失败，只据自己的真实证据修复，不假定数组 fixture 或复杂度说明已经证明规模能力。

## 交付路径与独立预算

验收代码落在 `modules/platform/tests/observability-scale`／`tests/contracts`；Linux OS 观测器在 `tests/scale/observability`，原数据库和模块 composition 仍是唯一生产入口；不新增生产 numeric ledger、统计来源或后台服务。新增固定两场景的专用 `workflow_dispatch`，PostgreSQL 版本与完整 source SHA 固定，不提供缩小任务或用量的参数。新专用规模 job 可使用明确的240分钟独立预算；不修改任何已有 CI 或 test 的预算、skip 或 retry。

普通回归以原真实 PostgreSQL 的3个物理 Task／6条用量验证同一生产入口、全 identity、四桶／CNY、EOF与空／非法种子拒绝；另有原 TEMP 的小型非覆盖大组验证。原 full check 对同候选至多一次，已有等价 full check 未结束时不争用或重启；共享未提交产物保留，按自有路径精确发布。hosted 普通六项检查和两个真实规模 job 各自记录确切 SHA，均不能互相替代。

本片不代表 v2 development native consumer／before/final producer 已经装配，也不替代 CS 本机正式页面及真正模型任务验收。项目与系统两层完整统计、原 v2 接线、默认生产启用、远端 CI、本机部署与真实任务仍全部需要闭合；两个 RFC 保持未完成。

## 同一正式链的小规模先验

2026-10-06 新增验收代码的小规模原 PostgreSQL 回归 4 pass／0 fail：3 个物理 Task、3 个 attempt、6 条用量／步骤，系统与项目正式 worker/spool/cache 的全部输出及四桶／人民币一致；7 条同组 `self-total` 走原 TEMP 选择并逐条 EOF 对拍；删除一条原 capture 后报告保持未完整，原已记录 Token／人民币仍保留。精确 lint 与后端类型检查通过。第一次依赖解析落位失败、第二次 capture／step 父记录顺序失败与后继通过回执分别保留，没有修改生产约束。原件 `/private/tmp/observability-cs-full-scale-small-physical-v1.log`、`v2.log`、`v3.log`。完整本地门、推送后的六项 CI 和两项真实完整规模尚待；小规模通过不替代它们。

## 原完整门失败与后继候选

原九文件候选在一次完整检查中保持字节不变，检查自然完成，结果6174 pass／158 skip／5 fail／3 errors。三项原观测201 Task／1001 attempt回归达到既有60000ms预算；生产链发现空覆盖roots的重复原point查询，修复依据见 `empty-coverage-workspace.md`。新增原EOF空关系缓存及三项回归，不修改原测试数量、断言或预算；另两项并行内容盘点／本机预备事务配置错误分列保留。后继新候选才进行新一轮完整检查，原失败不覆盖、不重写为通过。

原覆盖索引修复后的15项针对性真实回归通过，首末候选指纹相同，原三个60秒超时用例分别24.4／26.7／27.1秒完成。原任务／尝试数量、全部断言与预算均保持。新候选完整门与确切hosted规模证据继续单独验收。OS观测器也保留采样期间已真实退出的PostgreSQL子进程语义：只允许该进程已经不存在，仍存活但无法读取的进程继续使测量失败。
