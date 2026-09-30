# RFC-037｜算力分配与构建凭据清理候选

日期：2026-10-01。本批仍是候选；本文不表示 Registry 物理回收或全部项目删除通过。

## 归属与清理

`modules/agent-runtime/adapters/persistence/deletionRepository.ts` 完整聚合本项目的 `project_compute_policies` 和 `allocation_receipts`，不使用目录视图的分页上限。未登记的内容表使盘点失败。共享档位、修订、测试、加密凭据及凭据版本不属于项目清理范围。

新迁移 `0009_project_deletion_fences.sql` 在升级时登记所有历史分配 operationId 的原项目，之后的 SQL 触发器固定归属；旧 ID 不能移给其他项目，项目根消失后不能重建其内容。普通写事务持 shared 咨询锁，seal 持排他锁等待实际提交，取得锁后重新检查正式 project 删除许可。变化的确认材料持久保留 `scope_verified=false`，重复旧确认不能成功；新完整确认只能继续原操作的高世代。

## 凭据与实际请求

旧签名构建凭据保持原格式，从不可变的 push prefix 识别项目。异步 ForwardAuth 逐请求核对源项目、目标项目及 blob mount 的来源，项目关闭或准入来源不可读均拒绝。未到期旧凭据对平台底座和 `/v2/` 探测也失效；共享管理员凭据不能访问已关闭的项目仓库。普通全局仓库及其他项目保持正常。

该证明覆盖未来请求的准入。此前已放行的上传、原构建进程、上传会话、私有制品及共享底层 digest/blob 的停止与物理回收仍待 runtime-environment 和存储 owner；本批不以 HTTP 403 代替这些来源。

## 定向证据及已修正失败

- 真实隔离 PostgreSQL 从旧迁移升级，完整清除 1205 条本项目历史分配回执；实际最后调用 project 的 `completeProjectDeletion` 后才断言根记录消失。
- 删除前后共享档位、修订、测试、加密凭据和版本的完整 JSON 相同；原凭据版本仍可通过公开启动材料 API 解密使用。其他项目原分配正文和后续写入保持。
- 实际 `pg_locks` 的原项目排他等待证明 seal 等待未提交写事务；提交后摘要变化，seal 返回 blocked，旧重试及普通 DELETE 被拒。
- 正式 project 重新盘点、确认与高世代许可能恢复原操作；旧材料、错误 participant、无原许可拒绝。未知新内容表不能解释为空项目。
- 公开 HTTP ForwardAuth 验证未到期旧凭据、共享管理员请求、目标项目读取和跨仓 mount 的关闭，以及其他项目和平台构建的正常请求。

初始新回归因缺少 workspace 测试依赖不能加载，补齐现有依赖及两行锁后恢复；首次夹具误在 verify 之后、完成删根之前断言根不存在，已按真实公开 API 顺序修正，未改变最后删根规则。新增 parser 测试的一处 ProjectId 品牌类型已修正。全部历史失败不计入通过数。

修订后模块及迁移定向覆盖运行为 **55 pass／1 skip／0 fail、380 断言、11 文件**，日志 `/private/tmp/cs-rfc037-compute-coverage-2.log`。唯一跳过项为现有真实 Registry mount 环境未启用，不能作为本机 Registry 物理验收。初次改动行汇总发现平台组合文件未加载，随后补平台真实迁移及目录路由组合检查；最终覆盖、完整门禁及发布回执接续记录。

基于 main `6c21cc852ead944bf5d99d25bf3ed7a552055185` 和精确候选路径的内存类型检查，后端与 console 均为 0 诊断；精确 lint 和结构检查通过，197 项迁移锁中仅增加本批新迁移，既有锁项不变。共享工作树当时另有两处并行在制品类型错误，未修改其内容。本节是本会话自查，不称独立 PASS。

组合覆盖运行 **62 pass／1 skip／0 fail、408 断言、13 文件**，平台真实安装及目录路由检查执行；改动行 **98／98（100%）**，所有改动生产文件均加载，日志 `/private/tmp/cs-rfc037-compute-coverage-3.log` 和 `/private/tmp/cs-rfc037-compute-patch-coverage-3.json`。最后又补未装配许可的拒绝／事务回滚回归，随完整用例运行。

完整 `bun run check` 的结构阶段通过，lint 被并行 task-runtime 在制测试的未使用 TaskId 导入中止，没有执行全量用例；未将它记为全量通过。全仓用例独立启动并让其自然完成，冻结的 22 个源码／测试／配置指纹保持；精确候选后端与 console 类型再次均为 0 诊断。本批源码完整结果、精确提交和 CI 继续。

算力候选完整用例运行 4663 pass／143 skip／5 fail（4811 tests、933 文件、30499 断言、959.04 秒）；五项失败落于并行修改的开发容器直接写入／准入检查，未作为全仓通过。22 个冻结源码／测试／配置指纹保持，算力全部新回归包括缺失许可的拒绝与回滚通过；改动覆盖 98／98、所有改动生产文件加载，精确候选后端与 console 类型无诊断。完整 check 的 lint 也被并行在制测试的未使用导入阻断；本批精确 lint／结构通过。按精确候选清单继续发布并等精确 SHA 的六项 hosted CI，不提交并行在制源码。永久删除全链路仍关闭。 日志 `/private/tmp/cs-rfc037-compute-full-tests-1.log`，失败路径清单 `/private/tmp/cs-rfc037-compute-full-tests-failures.json`。
