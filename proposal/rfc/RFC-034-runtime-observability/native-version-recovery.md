# RFC-034 实际 v1 数字帧恢复候选

本片修复已批准的“有已知 Token 就显示数值并标记不完整”行为。原 r3 受理 version=2、原 Runner 实际只发送 v1：原 Session 原键连续保存 A1..5、B1..4，平台 source ACK=0；原九帧五笔实际修订后的已知四桶 23834/21568/0/203，总45605。文件、原受理、运行资源不转换或替换。完整 v2 producer 的后继接线单独进行，不能以本片替代。

## 落位与功能合同

1. 仍由 observability application/developmentUsage 的同一 live/delete-drain 入口处理，同一独立 owner/Session 注册/原受理价核验，原 selected version=2 与 namespace 保持。仅全部实际 v1 的原 transport 页走明确的 mismatch recovery；缺少真实 v2 原页、v2 原帧或混合页不伪造原页或 ACK。
2. prepareDevelopmentUsagePage 原 v1 同步入口继续拒绝 v2 selection；另设明确 recovery 准备函数，严格要求原 choice=2 且实际每帧 version=1。提取真实 measurement 的 recordId/revision/occurredAt/model/四桶/原 scope，不改数字、不改发生时间和模型，不把完整 v1 proof 升级成 v2 EOF。
3. domain/developmentNative 的 context 允许保留原 choice=1|2，但 v1来源 metadata 的 sourceVerified 仅原 choice=1 可成立。choice=2 下保留原 proof和来源 metadata，全部 capture 继续 native-evidence-incomplete；原 known subtotal/四桶/CNY 可见，不会因 capture 不完整隐去数字。既有 pending source namespace 不冒充实库 identity。
4. 原 pageFingerprint、eventId、meter key、record revision 仍按 original registration + sequence/index 保证幂等。原帧保留在 Session PG；账本与 source游标在原 task-head事务 COMMIT，原 accepted price 的估值完成后才发 source ACK；失败/丢 ACK 自动重放同原页，不复制另一账本、不用当前配置重估旧价格。
5. 后继真实 v2 adoption 沿 nativeNumericCommit，owner缺失时始终读取该原 root/session/step 的 legacy 候选（before有则读before，否则读final）。只有原严格 qualifyNativeLegacyAdoption 通过才认领；存在旧候选而无法证明原实库/模型/贡献/完整before时 held，不追加一笔相同调用。存在性查询包含同 task/root/record 的全部真实 capture，不再按 finalized=true 过滤；choice2 恢复的 sourceVerified=false、finalized=false 旧行也必须阻挡后继新写。可认领资格仍由原严格 qualifyNativeLegacyAdoption 单独判断。读取到候选但其 meter/model 无法解析不能被返回空数组误当确实不存在。现有 strict adoption 标准保留，不给旧九帧补造 before/文件身份。
6. 定向真实 PG 验证原 source mismatch、实际四桶与原价、未知质量、重复/丢ACK与重启、其他身份拒绝、缺原页仍拒绝；native owner 无before/无usage/不匹配不能重复追加，已有合法adoption不退化。真实 PG 增加 choice2 恢复后的同原步骤无 before 回归：必须 held，usage/valuation 零新增，五笔四桶不变。保持原用例、断言和人口。
7. 实现经独立 SOURCE、真实定向/唯一新候选完整 check、精确提交CI和本机部署后，重读原两个 Agent/三个Pod UID与原九帧，再分别收项目与系统完整EOF报表、已知四桶和人民币；原 v2完整资格仍FAIL，默认生产选择不改。

本候选不授予新执行权限、不改默认 producer、不向任何运行任务补写用量、不修改原数据库帧或人工推进 ACK。成功只代表真实已知数字恢复且保持缺口，不代签两 RFC完成。

## 落地状态（2026-10-08）

设计独立复核 v2 VALID/PASS，P1/P2=0。现按本设计实现明确的旧帧版本错配恢复；原单独 v1 准备入口、v2 原页必要性与严格 adoption 资格保留。源码审查、真实 PG 回归、完整 check、精确 SHA CI、本机部署以及原 r3 项目/系统报表验收尚待完成，不能以设计门替代。

原九帧 A1..5/B1..4 的已知值与验收专用人民币价格是校验基准，不能手工补造平台 ACK、before、原页或文件身份。完整 v2 driver producer 接线仍单独未闭合，默认配置不变。

定向真实 PG 回归已通过（1 pass / 0 fail / 62 assertions，2026-10-08）：原九帧经真实 FULL/WAL journal、Session PG、账本与原价估值落地，重启和失 ACK 重放保持五笔四桶与五项人民币金额；未来真实 v2 同步骤 final 原页被 held，零新增 owner；真实旧 capture 对应 meter 缺失会 conflict，测试只在私有数据库中恢复原样行。所用原专用 PG 容器、端口与准备事务配置未修改。类型检查与范围 lint 已通过。完整 check、独立 SOURCE、精确 CI、部署和原真实任务页面核验仍为待办。


## 2026-10-08 原九帧实机恢复通过

本片七路径已进入 `aebbda4a1646bec16590098be1ef86eeff24ca8e` 的 37 路径组合候选，独立 SOURCE、唯一完整检查 6476／0 fail／158 skip、精确六项 CI 和八组件本机部署均完成。原 r3 两 Agent／三 Pod UID、镜像和 restart=0 保持；原九帧未改，原五条 OpenCode step-finish（输出含 reasoning）逐一匹配恢复账本及受理原价。

项目和系统原范围均到真实 EOF，已记录输入 23834、缓存读 21568、缓存写 0、输出 203、总 45605、人民币验收估值 ¥0.060076；A35989／¥0.044186、B9616／¥0.01589。正式系统页面已实际显示四分类、金额、项目和算力名称，缺口继续标明不完整。原 nativeSource=2 选择与实际 v1 的不完整 capture 不提升为 v2 页或完整零。新 r4 真正 v2 producer 的完整七步对拍单独记录，见[本次真实验收](./native-real-validation-20261008.md)。
