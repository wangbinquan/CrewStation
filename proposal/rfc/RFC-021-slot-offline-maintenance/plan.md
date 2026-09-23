# RFC-021｜实施计划

> 状态：Done · 2026-09-23（T1–T13 已完成；实机验收见 [acceptance.md](./acceptance.md)）
> 配套：[提案](./proposal.md) · [技术设计](./design.md)

## 目录

- [1. 任务与依赖](#1-任务与依赖)
- [2. 验收清单](#2-验收清单)
- [3. 交付门禁](#3-交付门禁)

## 1. 任务与依赖

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| RFC-021-T1 | 作者七轮裁定 M1–M28；三件套落档并登记 | 作者 | 已完成（2026-09-23，作者要求「实施＋部署＋实机验收」） |
| RFC-021-T2 | 契约：槽的 `retention`／`offline`、`redeployable`、三个请求、`SlotEventDto`、自动下线策略；`maintenance.ts`；`ReleaseStatus.offline`、`DeliveryState.held`、`gateway.maintenance-changed`；`MarketAppDto.maintenance`；删 `ProjectState.paused`；Schema 用例；api-client 方法 | T1 | 已完成（1c3586c） |
| RFC-021-T3 | `release` 领域：`slotLifecycle.ts`（计时、推迟、提醒、下线迁移、旧槽归一、策略校验）；`slots.ts` 切流写回退目标；`release.ts` 新迁移；纯函数用例 | T2 | 已完成（1c3586c） |
| RFC-021-T4 | `release` 用例与适配器：下线、推迟、重新部署、巡检、访问记录、策略；表、仓储、迁移、`removeWorkload`；路由；RFC-010 槽删除改走下线；破坏性迁移改用 `MaintenanceWindow` 端口（部署与切流）；删 `maintenanceWindow` 设置；模块用例 | T3 | 已完成（1c3586c；验收中补 2e2600b：下线同时认 RFC-013 之前的旧 `rel_…` 标签） |
| RFC-021-T5 | `gateway`：维护领域、用例、表与迁移、路由、领域事件、缓存；`evaluate` 的服务域判定；`userEntry`；模块用例 | T2 | 已完成（1c3586c；验收中补 692207c：Pod 身份索引重列后清旧行） |
| RFC-021-T6 | `identity`：`ServiceEntry` 端口、ForwardAuth 两域 503、维护页与未部署页；用例 | T5 | 已完成（1c3586c；验收中补 80c4e1b：Traefik `allowEmptyServices`，否则未部署页出不来） |
| RFC-021-T7 | `events`：`DeliveryHold` 端口、暂存、补发、兜底巡检、事件消费；用例 | T5 | 已完成（1c3586c） |
| RFC-021-T8 | `project` 两个新动作、删 `paused`；`capabilities` 市场维护标注；`cluster-management` 文案；组合根接线；用例 | T4–T7 | 已完成（1c3586c；验收中补 56ff345：改开放策略后立即重算放行表） |
| RFC-021-T9 | 工作台：发布页维护与待验证卡、重新部署、时间线、概览版本卡、市场卡片、平台设置页、事件暂存状态、去掉暂停；`MemberLookup` 移到 `shared/project/`；中英文；工作台用例 | T2、T8 | 已完成（1eeb576、3c4076e） |
| RFC-021-T10 | e2e：平台设置页、维护入口与两类 503 的实机用例 | T9 | 已完成（1eeb576；本机部署后实跑 4／4） |
| RFC-021-T11 | 本地 gate、改动行防护、提交推送、精确 SHA CI 六项 | T10 | 已完成（最后一笔 80c4e1b 的 CI 35825463850 六项成功；逐笔见 acceptance.md） |
| RFC-021-T12 | 本机部署（控制面与工作台镜像，迁移 Job）与五个身份的实机验收，`acceptance.md` | T11 | 已完成（2026-09-23，见 [acceptance.md](./acceptance.md)） |
| RFC-021-T13 | 基线回填：Proposal／Design／Plan 升版本（新需求、决策、验收编号；作废暂停项目；改写维护窗口）；README、STATE.md 收口 | T12 | 已完成（基线 v0.3.9：Proposal R56、R57 与改写的 R19；Design §6.9、D56、D57，暂停项目作废；Plan AT-57、AT-58 与矩阵行） |
| RFC-021-T14 | 2026-09-23 修订（作者当面裁定，不另立 RFC）：① 提醒发出之后才能推迟——领域 `canPostpone`、`SlotRetentionDto.postponable`、推迟接口 412、待验证卡只在可推迟时显示「推迟 72 小时下线」／「推迟 14 天下线」、平台设置说明；② 待验证版本可以选版本部署——空着时卡片主按钮「部署版本…」，重新部署确认第一行是版本下拉（`redeployCandidates`）；单元、模块、工作台与只读 e2e 用例；本机部署与实机核对 | T13 | 进行中（① cd80eac） |

## 2. 验收清单

对应提案 §7 的 SM-01…SM-18。实机时每项记录身份、页面或接口、`kubectl` 与数据库核对结果，写进 `acceptance.md`。

| 编号 | 证据 |
|---|---|
| SM-01 | 发布页下线前后截图；`kubectl get deploy,svc -n <ns>`；`slot-events` 返回的记录 |
| SM-02 | preview 地址的浏览器页面与 `curl -H 'Accept: application/json'` 的 503 |
| SM-03 | 重新部署前后 `kubectl get jobs`（没有新的构建与迁移 Job）；切流成功；兼容拒绝的模块用例 |
| SM-04 | 切流后的 `slots` 响应 `retention.deadline`；preview 访问前后 deadline 对比 |
| SM-05 | 调短策略后制造临期：提醒记录、页面提醒；推迟两次的 deadline 变化；未提醒不下线的用例 |
| SM-06 | 自动下线的 `slot-events` 原因；进行中发布期间巡检跳过的用例 |
| SM-07 | 部署后巡检给已有待命槽补的 `since` 等于升级时刻 |
| SM-08 | 进入、调整、切流、退出维护的页面与 `maintenance` 响应；开发者／测试者视图；非成员 404 |
| SM-09 | 五个身份分别访问 prod 地址（维护页或放行）；API 503 与 `Retry-After` |
| SM-10 | 从其他项目 Pod 与本项目开发容器分别调用服务域地址的结果 |
| SM-11 | 暂存投递的状态与尝试次数；退出后投递成功的顺序 |
| SM-12 | 含破坏性迁移的发布在维护前后的结果（模块用例＋实机一次） |
| SM-13 | 市场卡片截图（被拦的人与放行的人） |
| SM-14 | 平台设置保存、校验错误、非管理员 403 |
| SM-15 | 权限矩阵的模块用例与实机抽查 |
| SM-16 | 集群管理删除非正式槽后发布页的状态与重新部署 |
| SM-17 | `grep` 无 `CS_MAINTENANCE_WINDOW`、`paused`（项目状态）；拒绝分支用例清单 |
| SM-18 | `bun run check`、`test:patch`、CI 运行号 |

## 3. 交付门禁

- 每个任务与它的用例在同一笔提交；`bun run check` 通过才提交；按显式路径 `git add` 与 `git commit --`。
- 新迁移用 `bun run migrations:lock <文件>` 只锁自己的；契约改动后跑 `bun run contracts:lock` 确认不涉及业务契约面。
- 本机部署前看节点磁盘；只重建控制面与工作台镜像并逐个 `ctr import`，迁移用安装脚本的迁移 Job；部署后 `crictl rmi` 旧镜像。
- 升级后巡检会从升级时刻起给已有待命槽计时（M26）。本机其他项目的待命槽会在 72 小时（回退目标）或 14 天（待验证版本）后自动下线，下线前 24 小时提醒，这是按裁定的预期行为，要在 STATE.md 写明。
- 实机验收不改真实项目的授权。需要临期、临时指定的人时，用验收专用项目和可回滚的策略值，并在 `acceptance.md` 记下恢复。
