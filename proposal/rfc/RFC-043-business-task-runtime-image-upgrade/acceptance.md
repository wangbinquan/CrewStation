# RFC-043 验收记录

> 实现 `660a6185`（准确 SHA CI `39286683024` 全部成功）。本机部署与 AW 正式实例的联合验收见文末。

## 集中验证

- 完整 `bun run check`（独立测试库，`CS_TEST_REQUIRE=database`）：5821 pass / 176 skip / 6 fail。
  - 其中 1 项是本次改动：契约面金样的 schema 名单没加 `UpgradeBusinessTaskRuntimeImage`，已在同一提交修复。
  - 另外 5 项是本机已知的环境用例，所在文件本次未改动：macOS 下的 `/proc` 与 filesystem-metrics 取消语义（2 项）、runtimes/task 归档协议（3 项）。
- 修复后，与 RFC-043 相关的 12 个文件定向复跑 69/69 通过，无跳过。
- 契约锁：新增 3 处、破坏性 0 处；迁移锁新增 `business-task/0040_runtime_image_upgrade.sql`。

## 逐项

| 编号 | 结论 | 证据 |
| ---- | ---- | ---- |
| RIU-01 | 通过 | 选择集外的版本受理阶段 400 `runtime_image_not_allowed`；镜像不同 `runtime_image_mismatch`、版本不可用 `image_unavailable`、用途未验证 `image_usage_unvalidated` 时操作 `failed`，原钉住版本不变（`runtimeImageUpgrade.test.ts`）。缺省目标取调用方发布的声明版本。 |
| RIU-02 | 通过 | 未暂停 409 `task_not_paused`；缺 fence 400，fence 过期 409；代次过期 409 `stale_generation`。暂停、持久卷与活动子执行检查与生命周期受理共用同一事务。task-runtime 拒绝暂停中、跨项目与卷已变化的环境（`businessWorkspace.test.ts`）。 |
| RIU-03 | 通过 | 改钉后任务身份、卷 UID 不变，代次加一；视图的 `runtimeImage` 与 `image` 为新版本。恢复后台账规格的 `pod.image` 为新镜像，`businessStorage.initialize: false`，原 PVC 不变。 |
| RIU-04 | 通过 | 同键重放返回同一操作且无新副作用；同键改目标 409 `idempotency_conflict`；已钉住目标立即完成且代次不变；进行中的升级使恢复与关闭 409；并发升级只受理一个。 |
| RIU-05 | 通过 | 改钉未知错误时操作保持 `pending`，后台重放后完成且旧引用只释放一次；丢失租约时由下一个认领者重放预留与改钉；改钉被明确拒绝时释放新引用，原钉住版本不变。 |
| RIU-06 | 通过 | 关闭释放当前与准入两个版本的任务引用；拥有者证明随钉住版本迁移；材料证明与重建按当前钉住版本核对，不再误报 `original_image_incompatible`；升级前的恢复评估过期；重新执行复制当前钉住版本的引用（`runtimeImageUpgradeRecovery.test.ts`）。 |
| RIU-07 | 待验收 | AW 正式实例上，早于本批镜像的持久父任务被升级后，新的卷内命令可用。 |

## 联合验收中发现的缺陷

- **未启动尝试阻塞终结**：RFC-040 的 `failBeforeStart` 把从未启动的尝试记为派发 `failed`，终结排空只认 `accepted`，带这种尝试的任务一直停在 draining（`finalization_execution_pending`），父任务占着额度与 2 GiB 内存。
  - 发现于 `rfc042-aw-restore`：一个融合引擎任务的合并 Agent 因节点内存不足调度不上（`agent_environment_unavailable`），一小时后父任务仍在终结，而终结预览显示活动与未知执行均为 0。
  - 修复：排空把这种尝试与启动前取消同样作为从未启动的证明，会话证明仍拒收；卷消费者的停止证明照旧另行核对。回归用例修复前红、修复后绿。
  - 完整本地门禁 5823 pass / 176 skip / 5 fail，5 项均为前述本机已知环境用例。
