# RFC-021 验收记录

> 2026-09-23：SM-01…SM-18 全部在本机集群实机核对或由用例覆盖（逐项见下表）；验收中发现的五个缺陷当天修复、推送并随部署上线。作者批准「实施＋部署＋实机验收」（M21）。

## 范围、环境与部署

入口 `http://console.cs.localhost`，context `docker-desktop`。专用验收项目 `rfc021-verify`（项目 `01a0ccb2-82ac-7000-a509-34177fc30fa0`，服务 `01a0ccb2-82ac-7001-af81-2e33d2125269`，namespace `cs-rfc021-verify`，负责人 dev-developer）；会改状态的操作只在这个项目上做。别的项目只做只读核对和必然被拒的写请求（带错误的确认值，即使授权出错也只会得到 409／412）。

身份（本机 dev-oidc，只走 OIDC 登录、不调登录器的角色同步）：

| 角色 | 账号 | 说明 |
|---|---|---|
| 负责人 | dev-developer | 自建 `rfc021-verify` 成为负责人 |
| 开发者 | dev-developer | 在 `demo` 里是 developer 成员（项目开发者须有平台开发者角色，dev-member 加不进去，返回 400） |
| 测试者 | dev-tester | 负责人加为 `rfc021-verify` 的 tester |
| 普通用户 | dev-member | 非成员；M4 一步中临时被指定为放行的人 |
| 平台管理员 | dev-admin | 不是 `rfc021-verify` 的成员 |

部署经过（与并行的 RFC-022 会话 crewstation-51 逐步协调）：

1. 05:12Z 迁移 Job `crewstation-migrate-rfc021`（镜像 `cs-control-plane:rfc021-20260923`）只应用了本 RFC 的三条：`events/0005_held_deliveries.sql`、`release/0007_slot_lifecycle.sql`、`gateway/0005_maintenance.sql`。镜像由「main@1c3586c＋1eeb576 的差异」导出的干净树构建，不含当时未部署的 RFC-022 代码与工作树里的在制品。
2. 05:29Z 控制面换成 `rfc021-20260923b`（加上 56ff345）。
3. 05:55–05:59Z crewstation-51 从 `692207c`（含本 RFC 全部修复）构建并滚动 `cs-control-plane:startup-20260923b`（节点镜像 `6c8dacf4253d6`），console 为 crewstation-3a 按 `6a75f9a` 构建的 `cs-console:ui-6a75f9a`（`5825f37da9a49`，含本 RFC 界面）。**以下证据除特别注明外都取自这一组镜像。**
4. 06:07Z 只 patch Traefik 的一项参数 `--providers.kubernetescrd.allowEmptyServices=true` 并滚动（约 10 秒中断，事先与 crewstation-51 约定窗口）；同一改动写入 `deploy/k8s/system/32-traefik.yaml`（80c4e1b）。
5. 验收之后 crewstation-51 从 3b95126（含本 RFC 全部提交）重建并滚动 `cs-control-plane:startup-20260923c`（七个控制面部署）与 `cs-console:startup-20260923b`。06:36Z 只读复核：`tests/e2e/slotLifecycle.test.ts` 4／4 通过；验收项目两槽就绪、待命槽为回退目标（09-26 06:14Z 到期）、没有维护、槽记录 9 条；dev-member 看到的市场卡片没有维护标注；平台设置 72／14／24（revision 2）。

## 逐项结果

| 编号 | 结果 | 证据（时间均为 2026-09-23 UTC） |
|---|---|---|
| SM-01 | 通过 | 06:03:31 负责人在发布页点「下线」→ 行内确认「确认下线 v0.1.0」：Deployment `rfc021-verify-green` 删除、Service 保留（kubectl 前后对照）；槽 `offline {reason: manual, actorUserId: dev-developer}`；发布 `status: offline, redeployable: true`；槽事件 `offline`；卡片「v0.1.0 已于 … 下线：负责人手动下线」＋「重新部署 v0.1.0」；时间线「dev-developer 下线了 v0.1.0」 |
| SM-02 | 通过（修复后） | 首测 Traefik 回裸 `404 page not found`（没有 endpoint 的路由被丢弃，ForwardAuth 不执行）；加 `allowEmptyServices` 后 06:08:07 测试者打开 `preview.rfc021-verify.cs.localhost`：平台说明页「当前没有待验证版本 / v0.1.0 已于 … 下线：切流后的回退保留期已满，平台自动下线 / 负责人可以…重新部署」；接口 503 `{error: not-deployed, details: {reason: rollback-expired, tag: v0.1.0}}` |
| SM-03 | 通过 | 06:05:37 已下线卡片「重新部署 v0.1.0」→ 确认面板写明「使用这次发布已构建的镜像，不重新构建、不重跑迁移，按当前的生产配置部署」与「待命槽上现在的版本：空」→ 6 秒后就绪，重新计时（pending 14 天）；namespace 里 Job 前后都是原来的两个 build Job。06:14:17 正式版本 v0.2.1 含破坏性迁移且 `rollback: blocked` 时，重新部署 v0.1.0 得 412「当前版本 v0.2.1 含破坏性迁移，不能重新部署更早的版本 v0.1.0」，切回 v0.1.1 得 412 |
| SM-04 | 通过 | 首个版本就绪即 `pending` 14 天（deadline＝就绪＋336h）；05:18:47 测试者访问 preview 后 deadline 从 `…05:18:25` 推到 `…05:18:47`；首次上线（原正式槽为空）不计时；05:18:49 切到 v0.1.1 后待命槽 v0.1.0 成为 `rollback-target`，deadline＝切流＋72h；发布页「作为回退目标保留到 … 之后自动下线」＋「推迟 72 小时」「下线」。5 分钟内重复访问只记一次由模块用例覆盖 |
| SM-05 | 通过 | 把验收项目待命槽的计时点移到 50 小时前（只改这一行 JSON，时间旅行），06:06:51 巡检发提醒：槽事件 `reminder`、`remindedAt`，cs-controller 日志 `slot offline notice`（发给负责人）；概览与发布页卡片「… · 已于 14:06 提醒负责人」，时间线「已提醒负责人：v0.1.0 将于 … 自动下线」；06:07:21 点「推迟 72 小时」→ deadline 由 09-24 04:06 到 09-27 04:06、提醒清掉、`postponements: 1`。未经提醒不下线、推迟不限次数由领域与模块用例覆盖 |
| SM-06 | 通过 | 06:07:51 巡检自动下线，原因 `rollback-expired`（Deployment 删除）；重新部署后 06:09:51 自动下线，原因 `idle`。发布进行中与集群运维操作期间不动由模块用例覆盖（未实机） |
| SM-07 | 通过 | 升级后首次巡检 05:14:23 给已有 8 个待命槽起算：demo、gitlab-event-producer、reference-api-proxy、rfc003-verify-delivery、rfc003-verify-integration 为 `rollback-target`（09-25 05:14 提醒、09-26 05:14 下线），rfc003-verify-workbench、rfc006-verify、rfc011-role-home 为 `pending`（10-07）；没有任何槽在升级时被提醒或下线 |
| SM-08 | 通过 | 05:22:01 负责人进入维护（三开关、原因、预计恢复时间）；调整带版本号，旧版本号 409「维护状态已被他人修改」；05:23:24 维护中回退到 v0.1.0 再切回，维护一直在（M18）；测试者读维护接口 403（测试者没有项目工作区权限，RFC-011；维护状态在市场卡片上看到，`blocked: false`）；开发者读 200、写 403（demo，见 SM-15）；非成员 404；06:02:48 退出维护：`current: null`，记录依次进入、多次调整、退出，重复退出 409，时间线带人名 |
| SM-09 | 通过 | 用户开关打开：负责人、测试者、管理员打开 prod 照常；dev-member 看到维护页（原因、预计恢复时间），接口 503 `{error: maintenance}`＋`Retry-After: 7195`；负责人把 dev-member 临时指定后照常进入；退出维护后照常 |
| SM-10 | 通过 | 06:01:39（调用方身份正确）服务域开关打开：demo/demo 调 `rfc021-verify.svc.cs.internal/api/hello` 得 503 `{error: maintenance}`＋`Retry-After: 4823`；本项目自己的待命 Pod 调同一地址 200（M25）；06:01:44 开关关掉后 demo/demo 得 200。前置：管理员把该操作设为默认开放（56ff345 之后放行表立即重算：51→53） |
| SM-11 | 通过 | 06:02:04 事件开关打开时生产方受理一条 `gitlab.push`（11 个订阅方）：本项目这条 `held`、`attempts: 0`，demo 那条照常 `delivered`；06:02:15 关掉开关，06:02:16 应用收到 `attempt: 1`。再暂存三条后退出维护：三条按接收顺序重新入队（`run_at` 依次 .183／.184／.185），并发投递后应用收到的顺序是 2、1、3，均为 `attempt: 1`——与设计「按接收顺序重新入队，之后与平时一样并发投递，不保证严格串行」一致 |
| SM-12 | 通过 | 仓库声明破坏性迁移（命令只打印一行）后：只拦用户流量时发布 v0.2.0，构建完成后失败「含破坏性迁移的版本只能在项目维护期间发布：…」，没有迁移 Job；三开关全开时 v0.2.1 构建、迁移 Job 运行（日志只有那一行）、部署到待命槽；事件开关关掉时切到 v0.2.1 得 412「v0.2.1 含破坏性迁移，只能在项目维护期间上线」，三开关全开后切流成功 |
| SM-13 | 通过 | dev-member（被拦）市场卡片「维护中 / 维护中：原因 · 预计 … 恢复 / 维护中，暂不可用」、没有打开链接，接口 `blocked: true`；测试者 `blocked: false`；被临时指定后 `blocked: false` 且有打开链接 |
| SM-14 | 通过 | 负责人读写平台设置 403；提醒不短于保留期 400；管理员把回退保留期 72→96 小时（revision 1），验收项目 deadline 立刻后移 24 小时、`periodHours: 96`，平台设置页显示新值与修改时间；随即改回 72（revision 2），deadline 复原。只调长、不调短，不影响别人的待命槽 |
| SM-15 | 通过 | 未登录 401；非成员 404；测试者写 403；开发者（demo）读维护与槽记录 200，进入／退出维护、下线、推迟、重新部署、平台设置一律 403，发布页只有到期提示、没有这些按钮；管理员不是成员也退出了维护（200）并做了集群删除 |
| SM-16 | 通过 | 06:12:38 管理员在集群管理对待命槽 Deployment 检查影响（文案「下线待验证版本：删除工作负载，槽标为已下线（集群管理）；保留发布记录与 Service…」）并执行删除，操作 `succeeded`；槽 `offline {reason: cluster, actorUserId: dev-admin}`，发布 `offline`、可重新部署，时间线「… 下线了 v0.1.0 · 平台管理员在集群管理中下线」 |
| SM-17 | 通过 | `CS_MAINTENANCE_WINDOW` 在代码与部署清单里 0 处；契约与工作台已无项目状态 `paused`（仅剩开发会话自己的 `paused`，与本 RFC 无关）；库里 13 个项目全是 `active`；每条拒绝分支都有用例 |
| SM-18 | 通过 | 见下节 |

## 门禁与 CI

本地：`check:static`、unit／module／console 三层与改动行防护（98.3%）在提交前通过；e2e 层对部署前的旧版本本来就会红，按层单独核对。精确 SHA CI（六项：static、unit、module、console、e2e、gate）：

| 提交 | 内容 | CI |
|---|---|---|
| 1c3586c | 后端 | [35819370881](https://github.com/wangbinquan/CrewStation/actions/runs/35819370881) 六项成功 |
| 1eeb576 | 工作台 | [35821116250](https://github.com/wangbinquan/CrewStation/actions/runs/35821116250) static 红：新用例的品牌类型，写完用例后没有重跑 `typecheck:console` |
| 3c4076e | 修上一条 | [35821372744](https://github.com/wangbinquan/CrewStation/actions/runs/35821372744) 六项成功 |
| 56ff345 | 开放策略变更立即重算放行表 | [35822481885](https://github.com/wangbinquan/CrewStation/actions/runs/35822481885) module 红：同目录的 `catalogIdentity` 用例库里没有事件表 |
| 2e2600b | 下线认旧 `rel_…` 标签 | [35822861123](https://github.com/wangbinquan/CrewStation/actions/runs/35822861123) module 红（同上） |
| 635359d | 修上一条 | [35823310111](https://github.com/wangbinquan/CrewStation/actions/runs/35823310111) 六项成功 |
| 692207c | Pod 身份索引重列后清旧行 | [35823746583](https://github.com/wangbinquan/CrewStation/actions/runs/35823746583) 六项成功 |
| 80c4e1b | Traefik 保留没有 endpoint 的路由 | [35825463850](https://github.com/wangbinquan/CrewStation/actions/runs/35825463850) 六项成功 |

e2e 新增 `tests/e2e/slotLifecycle.test.ts`（平台设置只读与必然被拒的写、项目维护与槽记录的只读核对、待命槽为空时的说明页）与 `platformCapabilities` 的平台设置一行；本机部署后对 dev-oidc 身份实跑 4／4 通过。

## 验收中发现并修复的缺陷

1. **改开放策略后放行表不重算**（56ff345）：`setOpenPolicy` 不发任何事件，默认开放要等某次无关的重算才生效，调用方一直 403「未对调用方开放」。现在同一事务里发 `api-catalog.open-policy-changed`，网关据此重算；实机 0.4 秒内生效。
2. **下线不认 RFC-013 之前的旧标签**（2e2600b）：本机 8 个已有待命槽的 Deployment 标签都是旧 `rel_…` ID，只认 UUID 会跳过删除、槽记已下线而 Pod 一直在跑；09-26 起的自动下线会撞上。现在按 UUID 与 `legacyResourceId` 匹配。
3. **网关 Pod 身份索引不清旧行**（692207c）：watch 断开期间被删的 Pod 行一直在册（52 个 Pod 对 144 条在册行），IP 被复用时 demo-blue 一度被认成 09-21 就不在了的 mcp-capabilities。全量重列后清掉没列到的旧行；部署后首次重列清掉 125 行。SM-10 最初 05:30 那次 503 就是在认错身份时取得的，已按正确身份重测。
4. **下线的待命槽不显示「未部署」页**（80c4e1b）：见 SM-02。
5. 两处用例问题（3c4076e、635359d），见上表。

## 事故与观察

- **cs-api 连环重启（05:35–05:51Z）**：Bun SQL 客户端在高并发下连接错位（PG 日志里出现参数带 0x00、先查询后 SET TRANSACTION、带事务的 EOF），存活探针循环重启；与迁移和两边的代码都无关（换回任一版本都一样）。诱因是无头浏览器里没关的页面持续轮询：本会话自己的 Chrome（9344）留了 26 个页面，共用 Chrome（9333）上有 109 个孤儿页面。关掉后 05:51 起稳定。本会话的驱动已改成脚本结束即关页面。登记与后续由 crewstation-51 跟进（I16）。
- 时间线里管理员（非成员）的操作显示为「成员 01a0c12a…」：名字只从成员名单解析（RFC-020 既有做法），未在本 RFC 改动。
- 提醒目前只写记录与日志、界面可见（B9，没有真实通知渠道，Q20）。

## 遗留

- 升级起算的 8 个待命槽（SM-07）会按规则在 09-25 起陆续提醒、09-26 起下线；各负责人可在发布页推迟。
- `rfc021-verify` 保留作证据：正式版本是声明了破坏性迁移的 v0.2.1，待命槽是回退目标 v0.1.1，`/api/hello` 为默认开放，可见范围为「所有登录用户」。
