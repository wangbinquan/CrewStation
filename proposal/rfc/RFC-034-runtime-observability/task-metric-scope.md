# 单任务用量恢复与完整范围保留

2026-10-04。修复已批准 RFC-034 的正式页面回归，不改变完整统计要求。

## 实际问题

正常本机管理员登录后，系统观测七天范围实际含 24 条任务，所有任务用量被全范围缺口一起隐藏。
同一页筛选原任务 `01a0f805-6505-7000-bde3-0f060757c9bc`，原始完整报告为输入 5641、
缓存读取 2240、缓存写入 0、输出 394，总计 8275，人民币 0.015554。
因此恢复已有单任务完整折叠，不能让另一任务缺用量抹掉它。

## 资格与持久报告

沿用原两个 Task owner 到真实 EOF、同一原数据库 cohort、原数值投影和人民币估值。
只在普通 `tasks` 行上保留已有严格 `CompleteRuntimeMetricsSchema` 通过的原始 metrics，
包括完整四桶、人民币状态、单任务缺口和没有模型调用的 not-applicable。
不重新计算、不合并当前页、不用已知任务小计替代全范围。
全范围 summary、趋势、sources、Agent、项目、算力、尝试与泳道的用量仍遵守原全范围资格。
完整事实不能开放 numeric records/captures 等原本禁止的集合。

原 file spool、页摘要、seal、隐藏 staging、build owner、发布 CAS、全人口计数与 EOF 核对保留。
事实页写入采用同一严格单任务 metrics 资格；其他行继续严格 GapMetrics，拒绝泄漏数值。
持久读取保留全部原人口检查。SQL 对普通 tasks 接受既有三态，其余事实行仍拒绝 ready 与
numeric 字段；返回的每一条事实页再按原 domain 资格核验，包括完整四桶求和、十进制计数、
人民币状态和未知行不能带数值。读页失败沿原 console hook 撤下旧报告，不显示之前的数值。
不加任务、调用、使用记录或页数上限。

项目费用显示设置沿用现有行为。完整事实恢复可见 Task 费用后，读取旧报告也必须核对该设置。
private report cache 增加按原 reportId 的 hasVisibleTaskCosts 查询，仅判定该不可变报告是否含
费用未隐藏的 ready Task；不统计或截断人口。系统范围及原全范围 ready 分支保持。
该设置变为隐藏时，旧含可见费率的项目报告要求刷新；刷新后 Token 仍可见而费用 hidden。

后台 requestKey 的 executionFactsVersion 从 1 升到 2，公开 projectionVersion 仍为 2。
console queryKey 和 active scope 同时加入 task-scope-metrics/2，避免复用旧已遮蔽报告。
旧不可变 reportId、原 filters、Task/项目归属、cursor、pinnedId、返回与滚动行为不重写。
不修改业务契约、contracts/index、迁移、共享 STATE 或并行开发文件。

## 验收

在现有真实 PostgreSQL completeFacts 夹具加入一个独立完整的兄弟任务，其原捕获、native step、
usage event 和 valuation 均真实落库，并用原单任务生命周期报告独立核对。
完整 Task EOF 中保留一个缺口任务、一个完整四桶任务及全部没有模型调用的任务；系统和项目
均核对完整人数，其他维度/总范围继续未知。项目费率隐藏及旧费用显示设置变化有回归。
保留原删除 retained row 拒绝、spool 校验、完整人口与等待预算；补畸形单任务 metrics 拒绝。
console 使用真实 QueryClient 种入原 key 的旧报告，核新 POST、四桶/人民币及旧缓存原件不改。

一次完整本机 check 仅在候选稳定后执行；真实 PG 使用既有 prepared10 测试实例，保留默认实例
此前 prepared0 的失败原件。确切 SHA 六项 CI 与八组件部署分开核对，之后在同一正式页取消
单任务搜索，验证七天全部任务显示各自正确用量。缺原生最终记录的任务继续明确未知。
原 native producer 全量接线、100K/10M 规模及两 RFC 的其他剩余验收保持开放。

## 本候选验证与共享在制品边界

原三次完整检查的自然失败保持：v1 在本候选 cache mock 的 Bun fetch.preconnect 类型失败，已由单测试 delta 修复并通过独立功能复核与该用例回归；v2 在并行删除接线的结构中间态失败；v3 结构与全树 lint 已通过，仅在 packages/contracts/api/projectDeletion/values.test.ts 的三个品牌 ID 测试类型错误结束。后两批均没有修改本观测15个代码／用例文件，不把它们记为整仓通过，也不重复同内容完整门。

依据 docs/engineering/development-rules.md §3 的“别人的在制品”条款，对当前观测候选执行一次完整专项回归：真实 prepared10 PostgreSQL、全部6个相关测试文件，共23 pass／0 fail／5578断言，369.81秒，精确15路径lint通过。原201 Task／1001尝试的完整EOF、普通独立兄弟Task、四桶／人民币、缓存升级、错误总量拒绝、费用隐藏和页面末行返回均跑过；默认大夹具及所有原等待预算保持。运行前核对原数据库实例身份与prepared10配置；未另作数据库和角色数量的前后对拍。本次专项通过不能代替确切提交树六项CI。

发布仅包含这16个观测Task用量代码、用例和说明路径。共享STATE、contracts/index、迁移锁、删除／Session／SCM在制品及native owner底座均保留且不收编。远端CI、两镜像八组件本机部署和正式七天页面核对继续；不宣称部署完成、所有Token已可恢复或RFC关闭。
