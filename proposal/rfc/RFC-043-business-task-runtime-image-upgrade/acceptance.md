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
| RIU-07 | 通过 | 本机部署 `660a6185` 后，AW 正式实例发布 `v0.6.25`（V21）并切流，2026-10-19 18:10 交接完成。两条路径都在真实 PostgreSQL 与本机集群上通过，见下方「RIU-07 实机」。 |

## 联合验收中发现的缺陷

- **未启动尝试阻塞终结**：RFC-040 的 `failBeforeStart` 把从未启动的尝试记为派发 `failed`，终结排空只认 `accepted`，带这种尝试的任务一直停在 draining（`finalization_execution_pending`），父任务占着额度与 2 GiB 内存。
  - 发现于 `rfc042-aw-restore`：一个融合引擎任务的合并 Agent 因节点内存不足调度不上（`agent_environment_unavailable`），一小时后父任务仍在终结，而终结预览显示活动与未知执行均为 0。
  - 修复：排空把这种尝试与启动前取消同样作为从未启动的证明，会话证明仍拒收；卷消费者的停止证明照旧另行核对。回归用例修复前红、修复后绿。
  - 完整本地门禁 5823 pass / 176 skip / 5 fail，5 项均为前述本机已知环境用例。
  - 已随 `563322f8` 部署；卡住一小时的引擎任务随即完成终结，卷回收。
- **暂停中的工作区被判「容器不存在」**：对账按暂停开始前读到的快照判定，暂停删掉的 Pod 被当作丢失，暂停中的父任务被标记失败。
  - 发现于 `rfc042-aw-restore`：一个融合任务等人工回答，超过 2 分钟的任务宽限后，AW 暂停了它的父任务；回答提交时父任务已是 `failed: 容器不存在`。
  - 修复：`failEnvironment` 在锁内重读后，不再处理暂停中或已暂停的业务工作区。回归用例修复前红、修复后绿。
  - 同一提交让终结排空的阻塞信息写明具体子任务及其状态、派发与有无结果。此前两次排空被阻塞时，终结预览的活动与未知执行都计为 0。
- **存量未启动尝试仍阻塞终结**：`563322f8` 只认 `failBeforeStart` 写下的结果，`e0b8f149` 之前写下的未启动尝试是失败、未启动、派发 `failed`，但没有结果事件和投影。
  - 发现于正式 AW：上一条的阻塞信息指出旧 `system:shared` 父任务 `01a151b9-…` 卡在 02:14 的这样一条尝试上。父任务一直在 draining，占着一个额度；AW 跟着这个子任务事件的绑定也等不到结束（AW 侧以 RFC-370 F4 处理）。`rfc042-aw-restore` 的 `01a151ec-…` 卡在同样一条尝试上。
  - 修复（`4c735036`）：确认批次里出现这种行（失败、未启动、派发 `failed`、没有 incarnation、没有结果）时，排空在同一锁内用同一个 `failBeforeStart` 写入今天会写的结果事件与已消费的投影，再按从未启动核对；当前代码写下的行本来就是这样结束的，不受影响。回归用例修复前红、修复后绿。
  - 完整本地门禁 5824 pass / 176 skip / 6 fail：5 项为本机已知环境用例；另一项是 session 清理用例在整套并发时连不上测试 WebSocket，该文件未改动，单独复跑通过。准确 SHA CI `39320413944` 全绿。
  - 部署后两个父任务约 5 分钟内归档并关闭，额度与卷释放。

## RIU-07 实机（2026-10-19，AW `v0.6.25`）

- **主动升级**：共享 owner `resource:plugins` 的父任务 `01a14ecb-…` 一直处于暂停。切流后，AW 生命周期对账请求升级。任务视图从代次 2、旧版本，变为代次 3、`runtimeImage.versionId = 01a1546f-…`（发布声明的版本），镜像为 `…@sha256:ed227f69…`，任务仍为暂停。
- **按需升级**：旧任务 `01M57RVYMS1S6BDJM4MR5F5WWB`（10-18 创建，父任务 `01a14f8d-…` 钉在 `01a14d79-…`）的「变更」视图需要 v4 新增的 `code-review` 卷内命令。旧镜像回报未知操作后，AW 依次暂停、升级、恢复并重跑。父任务代次 3 → 6，钉住版本变为 `01a1546f-…`，卷 UID `b7253d19-…` 不变；`/api/tasks/:id/structural-diff` 返回 200（`status: ok`）。

