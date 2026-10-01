# 平台档位自测受理修复（2026-10-01）

本批恢复 RFC-006 / RFC-025 已有平台自测语义，属于 RFC-034 真任务分类验收发现的故障修复。不会新增租户权限、修改默认算力或跳过档位可用性检查。设计门与限定实现已完成；完整检查、发布与部署回执另行补入。

## 实际故障

专用验收档位 `01a0e236-4779-7000-99e6-6e096bd1c2bf` 修订 4 的自动测试 `01a0f780-ca76-7000-87c1-67c7bd232102` 于 12:46:48Z～12:48:48Z 在排队阶段失败。Controller 九次调和都报告哨兵项目 `01a0bf5d-8f4b-7006-9d13-970deb06320c` 不存在；Pod 未创建，后续阶段 skipped，最终错误被归类为 runner-unavailable。保留原失败记录，不当成真实模型执行。

`modules/task-runtime/domain/profileTestEnvironment.ts:4-14` 已明确该哨兵仅服务平台并发准入计数，不是真实项目。`application/testEnvironment.ts:37-42` 在系统命名空间创建 profile-test 环境；`domain/ledgerProjection.ts` 把环境的哨兵无条件投影为资源项目。`modules/cluster-control/application/reconcileObservations.ts:302` 调和 present 资源时通过 resources 的 projectDeletion.withAdmission 获取项目可用性和删除共享锁，从而在物理创建前失败。

## 修复落位与不变量

1. task-runtime domain 的资源投影把 projectId 定义为可选。普通档位测试是平台资源，工作负载投影不带 projectId；task_runtime.environments 与 admissions 的原哨兵、并发上限 4、平台标签和临时 emptyDir 均保留。
2. 带 runtimeValidation 的镜像验证仍属于其请求中的真实项目：投影使用固定的 runtimeValidation.projectId，继续进入项目可用性和删除共享锁。开发 / 业务工作区、Agent 子任务、工作卷和预览仍使用原真实 projectId。
3. persistence 的声明按存在与否传递项目归属，不能把 undefined 变成伪造项目。resources / cluster-control 的所有真实项目校验和删除保护保持。
4. 不创建哨兵项目，不按某个 UUID 对通用项目校验开豁免，不直接把档位设为 available。修复部署后通过标准手动自测生成新测试；只有成功终态才继续真实业务模型验收。
5. 旧资源记录的项目归属不可变（resources/application/ownerWrites.ts:39-49）。不迁移或改写历史记录。已经结束的失败测试保持；升级期间仍在进行的旧自测尚未创建 Pod 的按其既有两分钟创建宽限结束后；已创建的按原 Runner / 模型预算结束后通过标准新测试重试，不复活原测试或重建原 Pod。租户资源不受影响。

## 可判定回归与验收

- 纯投影验证普通档位自测没有 projectId / PVC；带真实项目的 runtimeValidation 保留原项目；开发、业务和原子任务项目不变。
- 扩展实际 PG 的 ledgerProfileTest 组合，用真正的 cluster-control 公共模块和 Kubernetes writer 建 Pod / Secret，接入真正的 resources.projectDeletion.withAdmission。projectAvailable 在遇到哨兵或不存在项目时必须失败；普通平台自测仍完整通过、正确释放并发计数、没有读取租户配置 / 数据。
- 真实项目资源继续经过原 withAdmission；缺失项目、已封闭项目不建物理对象。原关闭和迟到写保护用例全部保留。
- 修订候选按精确指纹跑一次完整本地 gate；独立功能复核、精确提交 / 六项 hosted CI，再更新本机需要的镜像。
- 部署后保留原失败 test，标准手动自测成功后继续专用 profile revision 4 的 single / sequential / command 原始数字对账；只读原父任务卷，费用使用明确标注的人民币验收费率。

本修复不关闭 CS-R02 / CS-R04、两 RFC 或整个观测能力；CLI / 平台自测数字采集、开发全入口清理及真实两级验收仍按 remaining-work 推进。

## 独立设计回执

独立设计门 PASS（25 条文档 / 源码指纹首尾一致），回执 `observability-cs-profile-test-admission-design-review.json` / SHA256 `0fcd672915bba4bf612ddace5a2b4e58d072265d26dae553d0591725a0583b2f`。旧未创建 Pod 的测试可正常失败 / 释放后以新测试 ID 重试；两分钟是创建宽限，已进入 Runner / 模型阶段仍按原预算结束。源码修复与实际验证继续。

## 限定修复与定向证据

只改 task-runtime 两个投影源码，ProjectedRecord.projectId 可选；平台自测省略项目，runtimeValidation.projectId 经 ProjectIdSchema 校验后固定到真实项目。resources / cluster-control 通用项目存在校验、删除共享锁、哨兵计数 / 释放和生产配置均未改。

先新增三份回归再改生产源码：原实现 16 pass / 3 fail，失败分别是实际 Controller 不能创建平台 Pod、镜像验证投影仍为哨兵、平台自测仍错误携带项目。日志 `observability-cs-profile-test-admission-red.log` 保留。修复后真实隔离 PostgreSQL 17（55334，database 必须可用）与真实 Kubernetes writer / 假 API Server 的六文件组合为 39 pass / 0 fail / 292 断言；包含原投影、资源删除与集群删除保护。禁止项目配置 / 数据读取的原断言保持，模型与释放的原断言保持。日志 `observability-cs-profile-test-admission-target.log`。

精确五文件 ESLint 通过。初轮后端类型只报新测试期望值未标注 ProjectId，修正类型后通过，不改运行数值或断言。结构检查唯一阻断是并行 data-control/0005_native_identity_journal 尚未登记锁文件；未删除、改写或代登记该迁移。尚未启动本候选完整本地 gate，不把定向检查计作完整检查。


## v2 空值边界修订与独立复核（2026-10-01）

v1 独立实现复核 FAIL，仅一项 P2：持久环境从 JSON 读取后，显式 `runtimeValidation: null / false / 0 / ""` 被真假值判断误归为普通平台自测，可能跳过真实项目归属。保留原回执 `observability-cs-profile-test-admission-implementation-review.json` / SHA256 `ee7ccc3e9521dc08ed4650040a9bda3d24ec782574bd62c2b4f0c15209cfb853`，不把 v1 写为通过。

先补四个 JSON 往返反例，原实现实际 14 pass / 4 fail；v2 只允许 `runtimeValidation === undefined` 表示缺省。任何显式无效材料仍必须经过 `ProjectIdSchema` 并拒绝，普通平台自测和有效真实项目行为保持。日志 `observability-cs-profile-test-admission-v2-red.log` 保留。

v2 六文件真实隔离 PostgreSQL / 实际 Controller 组合于 `2026-10-01T13:40:52.708448Z` 完成：43 pass / 0 fail、296 断言，12.40 秒；日志 `observability-cs-profile-test-admission-v2-target.log`。精确五文件 ESLint、后端类型均通过。没有更改通用项目或删除校验。

并行迁移现已由其 owner 登记，规范完整 `bun run check` 于 `2026-10-01T13:48:45Z` 启动（PID 40619，日志 `cs-rfc037-native-identity-journal-full-check-1.log`）。本批五个源码 / 测试文件均早于该时间完成且保持原内容；复用这次等价完整检查，不启动重复门禁。终态与首尾内容校验尚待回执。v2 独立实现复核、精确发布 / hosted CI、本机升级和标准新自测继续，不提前记录成功。


## v2 独立实现与规范完整门禁终态（2026-10-01）

v2 独立实现复核 PASS，原 P2 已关闭、无新增阻断；7 候选、20 参考和 5 份证据首尾一致。回执 `observability-cs-profile-test-admission-implementation-review-v2.json` / SHA256 `947d306ae1b809044d01341e06696cd1bf95e172b4134422a1d66a3db31c633c`。原 v1 FAIL 及四项空值红回归保持。

同候选的规范共享 `bun run check` 于 `2026-10-01T14:05:47.403690Z` 终态 exit=0：结构、全仓 lint、后端及 console 类型均通过；4,905 pass / 143 环境 skip / 0 fail、32,761 断言，5,048 tests / 968 files。完整 1,021.970 秒，测试 970.26 秒。本批五个源码 / 测试在门禁开始前已定稿且完成后指纹保持；三个回归文件实际执行。复用该等价检查，未重复运行全量。回执 `observability-cs-profile-test-admission-full-v2.json`，规范日志 SHA256 `66fec994d45bf5374d3c2492cbc7ffd90ff896b95cfa84a7b07a81fa4cce2265`；仅保留命令退出元数据，私有数据库材料不入库。

追加本节回执不改变已经检查的源码。精确七路径提交 / hosted 六项 CI、本机升级、标准新手动自测与真实分类数字 / 人民币验收继续；143 跳过不作为实际模型或部署验收，生产开发 producer 仍 OFF，CS-R02 / 04 / 13 及两 RFC 不关闭。
