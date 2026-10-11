# RFC-034 正式观测任务名称显示修复

2026-10-11 对已部署 `63ae4bbb6c1a4412cfa24ad23424297bdf9f8afa` 的正式算力明细进行检查，开发 Agent 贡献行的主标题仍为 Agent UUID，任务列表的「查看全部算力与执行」弹窗也直接使用了原始名称。这与任务列表和任务详情已有的本地化名称不一致。

复用 `runtimeTaskName`：完整任务使用实际 `source.identity.agentId`；贡献行使用同一原始 `taskName`（开发事实中保存实际 Agent ID）与 `sourceKind`。两者显示相同的「开发 Agent 执行 · Agent ID 后八位」。业务任务名称保持原文；贡献行保留完整执行 UUID 作为次要身份。所有导航仍传原始完整 UUID，没有改变 API、数据、分页、Token、金额或统计完整性判据。

修改落在 console 观测功能内部的 `model/runtimeFormat.ts`、`components/RuntimeDimensions.tsx` 与 `components/RuntimeTaskComputes.tsx`。继续使用公共 `Button`、`Dialog` 和现有 `identity` 样式，不添加视觉样式或公共接口。

回归用例追加到原 `runtimeSourceStatistics.test.tsx`，原八例及全文保留。新增两例在原实现上实际失败，分别复现贡献行主标题和算力弹窗标题为 UUID；修复后原定向文件实际 10 pass、0 fail。新增覆盖系统与项目两级、Agent 与算力两种贡献弹窗、完整执行身份、贡献数量、任务路由与返回原弹窗的名称。全量 `bun run check`、独立功能复核、新确切 SHA CI 与部署后正式页面检查另行验收。

同日通过原正式 API 实测，而非使用快照时间推算耗时：系统七个执行的报告生成 279 ms、从请求到可读完整事实 1142.964 ms；本项目筛选五个执行为 405 ms／1127.844 ms；项目级五个执行为 228 ms／1165.736 ms（包含原一秒状态轮询）。六次任务／算力明细分页读取为 59.428～92.501 ms，全部返回实际 EOF。三份报告的已知四桶一致：输入 45656、缓存读 63424、缓存写 0、输出 446，总量 109526，已冻结验收费率的人民币金额 0.126592。缺失原生采集的执行继续标记缺口；此次小样本读数不证明规模性能或缺口已经补齐。

原 `63ae4bbb` 的全量检查、CI 与部署记录保持；本修复的定向通过不替代新候选全量检查或确切 SHA CI，旧失败不改记成功。
