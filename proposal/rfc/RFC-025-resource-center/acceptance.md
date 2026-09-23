# RFC-025｜验收记录

> 配套：[提案](./proposal.md) · [技术设计](./design.md) · [实施计划](./plan.md) · [现状盘点](./audit.md)

## 目录

- [1. 第一期：基础（T2–T5）](#1-第一期基础t2t5)
- [2. 与验收清单的对应](#2-与验收清单的对应)
- [3. 第二期：任务类容器（T6、T7）](#3-第二期任务类容器t6t7)

## 1. 第一期：基础（T2–T5）

第一期只建底座：台账（`modules/resources`）、调和器骨架（`packages/resource-runtime`、`modules/cluster-control`）、标准视图与推送流、收编空跑报告。台账此时还没有所属模块写入（第二期起 task-runtime 等改写期望），调和器只观测、不改集群。

### 1.1 提交、门禁与 CI

| 提交 | 内容 | 门禁（干净导出树） | CI |
|---|---|---|---|
| `c9499ef6` | 台账、调和器骨架、视图与推送流、契约与 api-client、组合根 | check:static 通过；unit 552、module 1249（12 跳过：本机无 GitLab／Prometheus 能力）、console 827；改动行覆盖 99.0%（1470 行中 1455 行被执行） | [35870169467](https://github.com/wangbinquan/CrewStation/actions/runs/35870169467)（head `571ea0e2`）六项成功 |
| `107883d7` | 收编空跑的三处误判修正（见 §1.4）、T2 实测补记 | check:static 通过；unit 553、module 1249（12 跳过）、console 828 | [35872803892](https://github.com/wangbinquan/CrewStation/actions/runs/35872803892) 重跑后六项成功（第一次 e2e 因 CI 机器上的无头 Chrome 没起来，一条未跑） |

### 1.2 部署（2026-09-23，UTC）

- 镜像 `cs-control-plane:rc025-p1-20260923`（`git archive 571ea0e2`，只含已提交代码）。
- 14:01:50 迁移 Job `crewstation-migrate-rc025`：只执行 `resources/0001_create_schema.sql`、`resources/0002_ledger.sql`（applied 2；部署前核对库里没有别的待执行迁移）。
- 14:02:11 cs-controller、14:02:33 cs-api 换新，各自一次就绪、0 次重启；cs-api 启动日志 `routers 34、background 1`（推送流尾随器），cs-controller `background 24`。console 未动。
- RFC-023 观察期内的计划内滚动，镜像仍是 postgres.js 驱动。

### 1.3 实机核对（经网关，开发角色登录；只读）

| 项 | 结果 |
|---|---|
| 未登录读 `GET /v1/admin/resources` | 401 |
| dev-admin 读管理员视图、demo 的项目视图 | 200，`{ items: [], counts: {}, cursor: 0 }`（台账为空） |
| dev-developer 读管理员视图、收编报告 | 403、403 |
| dev-developer（demo 成员）读 demo 的项目视图与推送流 | 200；推送流首帧快照 |
| 查询参数不合法（`kind=nope`） | 400 |
| 对不存在的资源做「释放」 | 404 `资源 … 不存在` |
| 推送流（无游标） | `text/event-stream`；快照在响应头后 3 毫秒到达（带 `id: 0`），心跳在 +15.0、+30.0 秒到达 |
| 推送流（`cursor=0`，日志为空） | 走续传分支，没有要补发的，只等心跳 |
| 推送流（`cursor=999999`，比日志新） | 先给快照 |
| 观测工作器 | 首轮后 10 分钟汇总 `unowned 121`（全是还没收编的旧对象）；14 分钟内 watch 没有一次中断 |

### 1.4 收编空跑报告与修正

第一次空跑（`c9499ef6`）：`owned 0、adoptable 23、orphan 10、retained 2、unclassified 7`。逐条核对发现三处误判，已在 `107883d7` 修正：

1. **旧 ID 没解析**：9 个 PVC 与 1 个 Pod 的任务标签是 RFC-013 之前的 `tsk_…`，按原值查任务环境必然查不到，被判「孤儿」。其中 cs-demo 的 `task-01a095410744-work` 实为 demo **正在运行**的开发会话的工作卷（`tsk_01a0954107447000b7936485fb80d15d` 经身份目录对应 `01a0c12a-de2a-705a-9de5-2680b8ed75c1`，running）。若按此回收会删掉作者正在用的会话数据。现在先经身份目录换成现 ID 再查。
2. **平台组件**：系统命名空间里的 7 个平台组件 Pod 被判「未归类」；设计 §6.4 明确它们不在收编与回收范围，新增结论 `platform`，观测工作器对它们不查不写。
3. **失败保留**：失败的开发会话一律判「保留中」；改为按最后活动时间算 72 小时，超过的判孤儿。

修正后的空跑与部署结果见 §1.5。

### 1.5 修正后的部署与空跑

- 14:33:42 cs-controller、14:33:47 cs-api 换到 `cs-control-plane:rc025-p1b-20260923`（`git archive 107883d7`；CI 35872803892 第一次 e2e 因 CI 机器上的无头 Chrome 30 秒内没起来而一条未跑，重跑后六项成功）。没有迁移，各一次就绪、0 次重启。
- 首轮汇总改为等全量带进来的变化处理完再记：`unowned 35、platform 8`（此前在列表完成那一刻记，全是 0）。
- 空跑：`owned 0、adoptable 26、orphan 5、retained 4、platform 7、unclassified 0`。
  - 可收编 26：20 个服务槽 Pod（第三期）；cs-demo、cs-rfc003-ux、cs-rfc003-verify-workbench 三个运行中的开发会话各一个 Pod 与一个工作卷——cs-demo 的 `task-01a095410744-work` 不再被误判为孤儿。
  - 孤儿 5：都是 PVC——两个失败超过 72 小时的开发会话（cs-rfc003-verify-delivery、-files）、三个已释放环境留下的（cs-rfc006-verify 一个、cs-rfc010-cluster-qa 两个）；收编时只进待回收。
  - 保留中 4：cs-rfc006-verify 一个失败会话的 Pod 与工作卷、cs-rfc022-verify 两个失败会话的工作卷。
  - 平台组件 7：系统命名空间里的 cs-* 与两个 MCP。

### 1.6 T2 实测（本机 Traefik v3.7.13，临时探针测完已删）

结论已写进设计 §7.3 与 §8：

- `rateLimit` 超额 429，带 `Retry-After`（秒，向上取整）与 `X-Retry-In`，正文纯文本 `Too Many Requests`；`inFlightReq` 超额 429，正文 `max connections reached: N`，不带 `Retry-After`。
- 计数按路由各一份（同一个中间件挂两条路由互不相加）；按请求头分桶时缺头的请求全部落进同一个空键桶——限流只能链在 ForwardAuth 之后，登录前的路由按客户端 IP 分桶。
- 分布式计数：`rateLimit.redis` 在 CRD 里可用，平台没有 Redis，未测；`inFlightReq` 没有分布式选项。
- SSE 经网关不缓冲（首帧 1 毫秒、15 秒一帧准时）；静默 70 秒、200 秒都不断；静默断流只来自上游进程自己的空闲超时（探针的 Bun 服务 120 秒）。

## 2. 与验收清单的对应

第一期只覆盖计划 §2 里的一部分；其余随各期补。

| 编号 | 第一期的状态 |
|---|---|
| RC-03 | 续传、过旧／过新游标给快照、失权断开：模块用例覆盖（`resourceStream.test.ts`）；实机核对了快照、心跳与游标分支，失权断开待第二期有记录后实机复核 |
| RC-06 | 空跑报告已能列出实查清单里的 Pod 与 PVC 并给出处理结论；路由、Secret 等种类随第三期起加入；正式处理在第六期 |
| RC-11 | 额度推导与并发抢占：模块用例覆盖（两个事务抢最后一个单位，恰好一个成功）；实机在第二期额度计数器退役后核对 |
| RC-13 | 租约抢占、续约、过期接手：模块用例覆盖；两个 cs-controller 副本的实机核对在 T16 |
| RC-16 | 本期两笔提交的门禁、改动行防护与 CI 见 §1.1 |

## 3. 第二期：任务类容器（T6、T7）

### 3.1 第一步：任务环境投影进台账（8df032a0）

- 门禁（干净导出树）：check:static 通过，unit／module／console 全绿；CI [35876463016](https://github.com/wangbinquan/CrewStation/actions/runs/35876463016) 六项成功。
- 部署（2026-09-23，UTC）：14:52:19 cs-controller、14:53:18 cs-api、14:53:19 cs-session 换到 `cs-control-plane:rc025-p2a-20260923`（`git archive 8df032a0`），无迁移，各一次就绪、0 重启。cs-controller 启动 1 秒内记「resource ledger resynced」（synced 21）。
- 台账接上真实数据：3 个运行中的开发会话的工作区为「运行中」、5 个失败会话为「失败」，8 个工作卷；收编空跑随之变为 `owned 12、adoptable 20、orphan 3、retained 0、platform 7、unclassified 0`——此前「可收编」的 3 个会话、「保留中」的 4 个对象都已由记录认领，剩下的孤儿是 3 个已释放环境留下的 PVC。
- 实机链路（验证项目 rfc023-verify，开发角色；推送流全程开着，时刻相对开流）：开会话 +0.6 秒收到工作区「分配中」与工作卷，+6.4 秒「运行中」；开 CLI +1.0 秒收到「排队中」、+1.7 秒「启动中」（原因原样是 `0/1 nodes are available: 1 Insufficient cpu`——本机节点 CPU 请求已到 98%，CLI 调度不上）；结束 CLI 后 0.1 秒「结束中」、1.1 秒「已结束」，名册随后报 ended；释放会话后 0.1 秒工作区与工作卷「结束中（用户释放）」，0.5 秒两者「已结束」。
- 发现并在后续提交修正：CLI 结束的原因写成了过程（「此CLI已结束，正在回收执行环境」），在已结束的记录上一直显示；补投影进来的失败会话按「第一次进台账」起算 72 小时（见 §3.3）。

### 3.2 T7：工作台改读台账（05bb863a、4126f4b2）

| 提交 | 门禁（干净导出树） | CI | 部署 |
|---|---|---|---|
| `05bb863a` 资源视图与推送流接进工作台；拓扑的开发会话／CLI／业务任务、概览 CLI 数改读记录 | check:static 通过；unit 558、module 1255（12 跳过）、console 857；改动行 319／319 | [35882191905](https://github.com/wangbinquan/CrewStation/actions/runs/35882191905) 六项成功 | 15:39:38 console 换到 `cs-console:rc025-t7a-20260923` |
| `4126f4b2` 开发页 CLI 标签的结束与失败以台账为准、概览会话徽标、守卫用例 | check:static 通过；unit 558、module 1255（12 跳过）、console 864；改动行 46／46 | [35884433450](https://github.com/wangbinquan/CrewStation/actions/runs/35884433450) 六项成功 | 15:58:05 console 换到 `cs-console:rc025-t7b-20260923` |

实机（浏览器，管理员身份，运行与诊断的形态页签）：页面先读快照（`GET …/resources`），随后开着 `GET …/resources/stream?cursor=68`；在 rfc023-verify 开会话后，开发会话带不等 15 秒一次的盘点就出现（工作区「启动中」→「运行中」、工作卷）；开 CLI 后 CLI 节点出现，写着「启动中 · 0/1 nodes are available…」；结束 CLI 后约 1 秒节点消失（「0 个 Agent」）；释放会话后整条开发会话带消失——当天「开发容器已关闭、拓扑上还有开发会话」的现象不再出现。同时发现记录节点的存活时长按记录进台账的时刻算（demo 的工作区显示「存活 40 分钟」），已在 4126f4b2 改为按盘点里同一 Pod 的创建时刻。开发页标签的「结束中」由组件用例驱动推送流核对（浏览器的登录在第二次核对时已过期，没有替作者重新登录）。

