# 原覆盖索引的空关系读取

原正式完整报告中，只有 request 用量、没有 self/tree-total 覆盖区间时，每个 Task 的不同 group／session／model／四桶仍反复查询同一个原 TEMP roots 空关系。本次未改数据选择、求和、分页或统计人口，仅缓存原关系的空 EOF 事实。

`completeCoverageWorkspace` 第一次未缓存 root 时读取原私有 namespace 的一页、大小1。只有 items 为空且 nextCursor 为 null 才证明根关系完全为空；这个包大小只回答存在性，不作为统计总量上限。首次仍保留原 point read；后续缺 root 才复用空 EOF 返回 null。任何 `setRoot` 都先使空关系证明失效，正常原 point reads、LRU与dirty flush继续；若读取期间写入同一root，还要复读原cache以保留该新root。已有非空原关系保持逐根原读。原覆盖区间、逐条 ancestry、四桶选择、allocation、人民币估值和最终真实 EOF全部保持。

新增三项有限 unit 回归覆盖10001个独立未命中root、后续写入并跨过原4096缓存淘汰、已有非空原关系、原异步空页读取期间的同根写入。原真实PG的201 Task／1001 attempt回归、原60000ms预算和全部断言不变。

2026-10-06 原完整本地检查自然完成：6174 pass、158 skip、5 fail、3 errors。三项本会话原观测回归在60000ms超时；另外一项本机原测试库 max_prepared_transactions=0，及一项并行内容盘点回归失败，原日志保留，不宣称全门通过。精确原件 `/private/tmp/observability-cs-full-scale-full-gate-v1.log` 与 `.json`。后继使用本会话已有独立PostgreSQL17.11验收库（max_prepared_transactions=10），不改部署库或原用例预算；该修复的真实针对性回归与新候选完整检查另留证。

此优化不证明100K Task／10M usage规模通过，也不启用开发native v2 producer。规模、远端CI、CS本机部署和原生产启用各自验收，RFC仍开放。

## 原回归的实际后继结果

同一本会话独立PostgreSQL17.11上，15项针对性回归全部通过，0 fail，共20665个expect：原masked Task用例24353.39ms，原system／project同胞用例26746.05ms／27056.42ms，原60000ms预算和完整原断言逐字保持。其余原historical cache／项目费用隐藏／损坏数字拒绝回归、三项新增空关系回归及四项物理正式链验收均通过。日志 `/private/tmp/observability-cs-original-empty-coverage-targeted-v1.log`，首末候选指纹一致；这不替代后继完整门或100K／10M验收。


## 首次原读取约定的修正

后继完整检查v2自然结束，旧 `completeWorkspace.test.ts` 的原回归报告 Expected 1／Received 0：第一版空 EOF 复用提前省略了首次原 point read。原断言和预算保持；生产修正为仅后续未缓存 root 复用已确认的空 EOF，首次原 point read继续执行。v2失败原件 `/private/tmp/observability-cs-full-scale-full-gate-v2.log` 与 `.json` 保留。修正后的原完整 workspace 用例、真实PG 201／1001 回归、三项新空关系用例和物理链验证全部通过，实际日志 `/private/tmp/observability-cs-empty-coverage-correction-targeted-v2.log` 与 `.json`，原用例逐字保持；这不替代新候选完整检查或100K／10M规模验收。


## 同一候选的完整检查与精确发布

修正候选的完整检查v3自然结束：6196 pass、157 skip、1 fail，285220个expect，6354项用例／1257个文件。结构、lint、后端与工作台类型检查及本会话全部观测用例均通过；唯一失败是并行未提交 `packages/filesystem-metrics/registry/inventory.test.ts` 的 stalled successful body timeout，Expected Error／Received deadline escaped，不属于本次12文件清单。原失败日志与回执保留，不称全门绿色；不修改或收编该并行用例，也不重跑内容未变的全门。按开发规则§3对并行在制品的归因约定，以已通过的19项针对性回归与精确lint提交本会话文件，实际提交的全仓判定交远端exact-SHA六个CI作业。100K／10M另行固定人口验收，不能用本结果代替。


## 2026-10-06 精确 CI 与本机部署完成

本片随本会话12文件提交 `52c8eb74fd8354f15c9f1254106cb38d08b0949d` 独立推送，未收编并行内容盘点用例。提交树的 [CI 37394722389](https://github.com/wangbinquan/CrewStation/actions/runs/37394722389) 六个作业全部成功；上述本地完整检查的一项并行失败继续保留，不追记为本地全绿。

2026-10-06T01:11:55.370Z 本机八组件均 Ready，实际 Pod imageID 与节点 OCI 源码匹配该提交，250 项原已发布迁移逐项核对。原资源 UID、数据库/角色、native 存储、既有执行镜像保持；新默认 Runner 使用同 SHA 构建镜像。部署前检查最初误用更早快照而遗漏当前已经存在的 cs-session/cs-auth Pod UID 来源，未执行任何集群变更；修正后保留并核对全部现存来源，再完成实际升级。

固定100000物理任务/10000000用量的 [全规模 37395130449](https://github.com/wangbinquan/CrewStation/actions/runs/37395130449) 与部署后正式页面复验分别待闭合，开发 native v2 producer 继续 OFF。此部署和六项 CI 不代表全规模、生产原生采集或 RFC 全部完成。
