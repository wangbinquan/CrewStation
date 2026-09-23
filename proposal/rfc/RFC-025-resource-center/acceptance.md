# RFC-025｜验收记录

> 配套：[提案](./proposal.md) · [技术设计](./design.md) · [实施计划](./plan.md) · [现状盘点](./audit.md)

## 目录

- [1. 第一期：基础（T2–T5）](#1-第一期基础t2t5)
- [2. 与验收清单的对应](#2-与验收清单的对应)
- [3. 第二期：任务类容器（T6、T7）](#3-第二期任务类容器t6t7)
- [4. 第三期：服务槽（T8）](#4-第三期服务槽t8)

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

### 3.3 第二步：回收移交与保留期（99e93569）

- 门禁（干净导出树）：check:static 通过；unit 564、module 1260（12 跳过）、console 864；改动行 136／136。CI [35887283150](https://github.com/wangbinquan/CrewStation/actions/runs/35887283150) 六项成功。
- 部署（UTC）：16:22:16 cs-controller、16:22:19 cs-api、16:22:25 cs-session 换到 `cs-control-plane:rc025-p2b-20260923`（`git archive 99e93569`），无迁移，各一次就绪、0 重启。首轮观测汇总 `recorded 4、unchanged 10、unowned 149、platform 7、removed 0`（多观测了 Secret、Service、IngressRoute，unowned 多出来的是服务槽的 Service 与路由、Git 凭据等第三期才认领的对象）；补投影 21 条。
- 子对象与建出的名字一一对上：3 个运行中会话的工作区各有 Pod、Runner Secret、预览 Service 与 IngressRoute，都观测为在（demo 的是 `task-r-01a0cda7…`、`task-r-01a0cda7…-runner`、`task-01a0c12ade2a705a…`），失败会话的预览 Service 与路由同样被认领。
- 保留期起点更正：3 个 09-21 04:18:35 失败的旧会话（rfc006-verify、rfc003-verify-delivery、rfc003-verify-files）的「失败」起点改为 09-21 04:18:35，保留到 **09-24 04:18:35**；rfc022-verify 的两个到 09-26 06:35。到期后由维护作业改成「不要了」、调和器删容器与路由、工作卷写「待回收」、task-runtime 把环境记为已释放——届时补记实机结果。
- 删除没有误伤：部署时台账里没有「不要了」而子对象还在的记录（部署前查库核对），`removed 0`。
- 收编空跑（新判定前）：`owned 27、adoptable 31、orphan 3`；其中 11 个「可收编」实为遗留物——demo、rfc003-ux、rfc003-verify-workbench 各有 RFC-013 改名前的同 Host 预览 Service 与 IngressRoute（`task-01a095410744` 等，Service 选择器是旧 `tsk_…` 标签，端点为空），以及 5 个重建换下的旧 Runner Secret（demo 当前 Pod 的 `envFrom` 只引用 `task-r-01a0cda7…-runner`）。第三步据此把「任务环境已在台账、记录却不列」判为孤儿。

### 3.4 第三步：孤儿回收（4d492e70）

- 门禁（干净导出树）：check:static 通过；unit 564、module 1263（12 跳过）、console 864；改动行 75／77（97.4%）。CI [35889214736](https://github.com/wangbinquan/CrewStation/actions/runs/35889214736) 六项成功。
- 部署（UTC）：16:38:18 cs-controller、16:38:25 cs-api 换到 `cs-control-plane:rc025-p2c-20260923`，无迁移，各一次就绪、0 重启。部署后的收编空跑（同一判定）：`owned 27、adoptable 20、orphan 14`——14 个孤儿即下面 11 个删除与 3 个登记。
- **16:48:25 第一轮孤儿回收**（观测缓存同步后 10 分钟）：`removed 11、volumes 3`，逐条日志——
  - 5 个重建换下的旧 Runner Secret：cs-demo 的 `task-01a095410744-r-e4e5aa6e256b-runner`（旧 `tsk_…` 标签）与 `task-r-01a0c7fc…-runner`，cs-rfc003-verify-workbench 的 3 个；
  - 3 对 RFC-013 改名前的同 Host 预览 Service＋IngressRoute：cs-demo、cs-rfc003-ux、cs-rfc003-verify-workbench 的 `task-01a095410744`、`task-01a0985a8624`、`task-01a09eb4f03f`（Service 的选择器是旧 `tsk_…` 标签，端点为空）；
  - 3 个已释放环境的 PVC（cs-rfc006-verify 一个、cs-rfc010-cluster-qa 两个）登记为资源中心名下的工作卷记录，阶段「已结束」、原因 `orphaned`，PVC 本身不动（`kubectl get pvc` 前后都是 11 个）。
- 之后：每个开发预览主机只剩一条 IngressRoute（此前 demo、rfc003-ux、rfc003-verify-workbench 各两条同 Host）；受管 Runner Secret 只剩 3 个运行中会话各自当前的那个；`dev.demo.cs.localhost` 经网关照常到 ForwardAuth（未登录 401），当前会话的预览路由与 Service（有端点）未受影响。

## 4. 第三期：服务槽（T8）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `4aeaa892` 服务槽投影进台账，调和器观测 Deployment | check:static 通过；unit 568、module 1266（12 跳过）、console 867；改动行 121／122（99.2%） | [35891997767](https://github.com/wangbinquan/CrewStation/actions/runs/35891997767) 六项成功 | 17:02:17 cs-controller、17:02:19 cs-api 换到 `cs-control-plane:rc025-p3a-20260923` |
| `6d54a25f` 槽的旧接口状态就绪之后照台账 | check:static 通过；unit 569、module 1267（12 跳过）、console 867；改动行 21／21 | [35893472583](https://github.com/wangbinquan/CrewStation/actions/runs/35893472583) 六项成功 | 17:17:59 cs-controller、17:18:01 cs-api 换到 `cs-control-plane:rc025-p3b-20260923` |
| `7c3e68d0` 形态图槽带的入口与 Deployment 状态照槽记录 | check:static 通过；unit 569、module 1279、console 868；改动行 4／4 | [35894218920](https://github.com/wangbinquan/CrewStation/actions/runs/35894218920) 六项成功 | 17:22:38 console 换到 `cs-console:rc025-p3c-20260924` |
| `25bf918e` 槽的副本由槽记录认领、崩溃重启汇总成条件，健康接口、告警巡检与健康卡照槽记录；视图列出稳定记录；压缩只限终态 | check:static 通过；unit 573、module 1283、console 869；改动行 119／120（99.2%） | [35899013397](https://github.com/wangbinquan/CrewStation/actions/runs/35899013397) 六项成功 | 18:04:06 cs-controller、18:04:08 cs-api 换到 `cs-control-plane:rc025-p3d-20260924`，18:05:18 console 换到 `cs-console:rc025-p3d-20260924` |

镜像都由 `git archive <提交>` 构建，只含已提交内容；无迁移，各一次就绪、0 重启。

- **槽记录接上真实数据**（p3a 部署后）：补投影 14 个服务、28 条记录。20 条「运行中」，各自的 Deployment 观测为 Available、原因「副本 1／1 就绪」；8 条「已结束」——demo 的绿槽原因 `offline-manual`（已由成员手动下线），其余 7 条 `not-deployed`（rfc003-ux、rfc003-verify-files、rfc006-verify、rfc010-cluster-qa、rfc011-role-home、rfc022-verify、rfc023-verify 各有一个从没部署过的物理槽）。
- **p3b 部署后**：20 条在跑的槽记录仍全是「运行中」、Deployment 都是 Available，槽的旧接口状态不变（只在流水线判定就绪之后、观测不是运行中时才改写）。降级那一支（新版本铺完后副本没全就绪）由模块用例 `slotLedger.test.ts` 核对；实机上要对共享集群里的槽做一次运维重启才能看到，这一步被权限拦下，没有做。
- **p3c 部署后**：工作台已换新；浏览器的登录已过期，没有替作者重新登录，形态图槽带的显示由组件用例 `topologyAssembly.test.ts` 核对。
- **25bf918e 部署后**：首轮观测汇总 `recorded 59、unchanged 11、unowned 102`（部署前 `unowned 122`）——20 个槽副本被各自的槽记录认领。28 条槽记录逐条核对：20 条「运行中」，各带 Deployment（观测 Available、就绪 1／期望 1）与 1 个副本 Pod（Running、重启 0），`CrashLooping` 为假；8 条「已结束」（Deployment 不在）。cs-controller 与 cs-api 3 分钟内没有告警或错误日志；告警巡检改照槽记录后没有新告警（表里只有早先已恢复的 20 条 `health-failing`）。
- **压缩条件**：部署前查库，没有被压缩过的记录；期望仍在、已结束的有 8 条服务槽与 3 个孤儿卷，按旧条件会从 09-30 起被压掉子对象，改正后不再压缩。
- 健康接口的返回值与工作台健康卡由模块用例与组件用例核对（接口在网关登录之后，没有替作者登录）。

