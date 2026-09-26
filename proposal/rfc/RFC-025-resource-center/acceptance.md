# RFC-025｜验收记录

> 配套：[提案](./proposal.md) · [技术设计](./design.md) · [实施计划](./plan.md) · [现状盘点](./audit.md)

## 目录

- [1. 第一期：基础（T2–T5）](#1-第一期基础t2t5)
- [2. 与验收清单的对应](#2-与验收清单的对应)
- [3. 第二期：任务类容器（T6、T7）](#3-第二期任务类容器t6t7)
- [4. 第三期：服务槽（T8）](#4-第三期服务槽t8)
- [5. 第三期后半：路由（T9）](#5-第三期后半路由t9)
- [6. 第三期：限流（T10）](#6-第三期限流t10)
- [7. 第四期：命名空间、额度与网络策略（T11）](#7-第四期命名空间额度与网络策略t11)
- [8. 第四期：数据资源（T12）](#8-第四期数据资源t12)
- [9. 第五期：集群管理（T13）](#9-第五期集群管理t13)
- [10. 多副本分工（T16）](#10-多副本分工t16)
- [11. 第六期：收编（T14）](#11-第六期收编t14)

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
| RC-12 | 第四期：命名空间（Namespace＋额度）与网络策略有标准记录；实机把额度改大后被改回、删掉一条网络策略后被补回（§7）。数据库与数据访问绑定随 T12 |

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
- **到期实测（09-24，控制面是 b35ea86d）**：04:18:58.674 维护作业的保留期一步处理 3 条（`resource ledger maintenance` step retention，count 3），三条工作区记录改成「不要了」、原因 `retention-expired`；随后 0.3 秒内调和器按 UID 删掉 rfc006-verify 的失败 Pod 与三个会话的预览 Service、IngressRoute（共 7 个，日志 `resource child removed` 的原因都是 `retention-expired`），三条记录进入「已结束」、子对象清空；三个 PVC 没有删，它们的工作卷记录进入「已结束」、条件「待回收」（原因 `retention-expired`，带项目 ID）。04:20:58–59 task-runtime 的补投影（每 5 分钟一轮）把三个环境从「失败」记为「已释放」（`released: retention-expired`）。集群管理的「待回收的工作卷」随之从 3 个变成 6 个，新增的三个写着所属项目（「RFC-006 实机验收」等）与「失败会话的保留期已满，容器已回收」。
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

### 3.5 第四步：额度经台账受理（84e1fc50）

- 门禁（干净导出树）：check:static 通过；unit 577、module 1296、console 874；改动行 54／54。CI [35913161843](https://github.com/wangbinquan/CrewStation/actions/runs/35913161843) 六项成功。
- 部署（UTC）：20:09:11 cs-controller、20:09:13 cs-api、20:09:45 cs-session 换到 `cs-control-plane:rc025-t6a-20260924`（`git archive 84e1fc50`；cs-session 此前还是 `rc025-p2b-20260923`），无迁移，各一次就绪、0 重启；三个服务上线后 2 分钟内没有告警或错误日志。
- 切换前查库：每个项目的台账占用（占额度的种类、阶段在运行或结束中的记录数）与旧计数器 `task_runtime.admissions.running` 一致。
- 20:32 复核：3 个项目各有一条运行中的开发工作区记录、各占 1 个额度，与集群里 3 个在跑的任务 Pod（cs-demo、cs-rfc003-ux、cs-rfc003-verify-workbench）一一对上；旧计数器停在各 1，不再随受理与释放变化（只剩行锁的用处）。
- 到上限拒绝（文案照各入口原来的说法、台账不多一条）、释放之后额度回来、结束中仍占、暂停后恢复与失败后重建重新受理，由模块用例 `ledgerAdmission.test.ts` 与 task-runtime 的额度用例核对；实机上开会话与 CLI 要在网关登录之后，没有替作者登录。

### 3.6 CLI 名册照台账（7551a493，§11.2）

- 门禁（干净导出树）：check:static 通过；unit 578、module 1296、console 874；改动行 11／11。CI [35914868755](https://github.com/wangbinquan/CrewStation/actions/runs/35914868755) 六项成功。
- 部署：随 3ddccf23 的镜像一起上线（§5）。名册接口在网关登录之后，没有替作者登录去调；执行记录已结束即 `ended`（Runner 报的 `failed` 照旧）、失败即 `failed`、结束中仍报 `running`、读不到台账时照 Runner 的说法，由 `terminalPhase.test.ts` 逐条核对。上线后 cs-api 没有这个接口的告警或错误日志。

### 3.7 第五步：工作区的创建移交调和器（a30d1846，I25 第一步）

- 门禁（干净导出树）：check:static 通过；unit 663、module 1348、console 892；改动行 242／242。CI [35958096926](https://github.com/wangbinquan/CrewStation/actions/runs/35958096926)：static、unit、module、console、gate 成功；e2e 第一次在「启动调试浏览器」一步失败（CI 上的无头 Chrome 60 秒内没起来，前面的平台安装一步成功），重跑后六项成功。
- 部署（UTC）：05:02:53 用新镜像跑一次迁移 Job（只有 `task_runtime/0010_environment_render.sql`：`environments` 加 `render` 列），05:03:44 前 cs-api、cs-auth、cs-controller、cs-session 换到 `cs-control-plane:rc025-i25a-20260924`（`git archive a30d1846`；951f4159 的孤儿卷修复随之上线）。三个在跑的开发会话（旧形状，Pod 由 task-runtime 建）的 Runner 在 cs-session 换版后 2 秒内重连；cs-controller 没有告警或错误日志。
- 实机（rfc006-verify：在正式 Pod 里以服务身份调样例的 `/chat` 建业务任务，没有登录）：
  - 05:04:48.912 受理（启动记录的起点）；05:04:49.618 调和器照卷记录建出 PVC；卷进了观测缓存后，05:04:51.638 建出 Runner Secret `task-…-runner-1`、05:04:51.645 建出 Pod，05:04:51.651 交回实例，`Created` 为真——「排队分配容器」2.7 秒，其中约 2 秒是等卷进缓存的重试间隔；05:04:55.451 Runner 连上（容器 3.3 秒、连接 0.45 秒）。
  - Pod 规格里没有明文环境变量，只有 `envFrom` 引用那个 Secret；标签与旧路径一致（`workload: business-task`、项目与服务）。记录的期望里只有镜像、运行 UID、资源、PVC 与 Secret 的名字，查不到令牌、口令或连接串。
  - 子任务的执行 Pod（这一步仍由 task-runtime 建）调度不上：`0/1 nodes are available: 1 Insufficient cpu`——节点可分配 10 核、已请求 8.855 核，加上工作区的 1 核与执行 Pod 的 150m，超出 5m。`/chat` 120 秒后按超时返回 502，样例随即释放业务任务：05:06:55.22–.27 调和器删掉执行 Pod、它的 Secret、工作区 Pod、`-runner-1` 与 PVC，记录停在「已结束」（原因 business）。Agent 输出这一段要等本机空出 CPU 再走一遍。
- 没有实机走过的：开发会话（检出 init 容器、开发预览的 Service 与路由）——开会话要在网关登录之后，没有替作者登录，由 task-runtime 的 `ledgerCreation.test.ts` 与 cluster-control 的模块用例核对；建不成时的 `Created` 为假与重试、恢复暂停的业务任务（换成 `-runner-2`）也只有用例。

### 3.8 第六步：执行环境的创建移交调和器（0cfa6cba，I25 第二步）

- 门禁（干净导出树）：check:static 通过；unit 672、module 1354、console 893；改动行 127／127。CI [35961051411](https://github.com/wangbinquan/CrewStation/actions/runs/35961051411)：六项成功。
- 部署（UTC）：05:42:51 前 cs-api、cs-auth、cs-controller、cs-session 换到 `cs-control-plane:rc025-i25b-20260924`（`git archive 0cfa6cba`），无迁移；三个在跑的开发会话的 Runner 随即重连，cs-controller 没有告警或错误日志。
- 实机（rfc006-verify：在正式 Pod 里以服务身份照样例的调用顺序建业务任务、提交子任务，没有登录）。业务任务指定 150m 的 `rfc006-agent` 套餐——默认套餐的 1 核在本机放不下（§3.7）；子任务用这个服务发布时登记的 `chat-v1` 档案：
  - 05:45:45.971 调和器照卷记录建出 PVC；05:45:46.037 建出 Runner Secret `-runner-1`（卷进缓存后 66 毫秒，第一步里要等 2 秒）、05:45:46.054 建出 Pod；05:45:52.613 工作区的 Runner 连上。
  - 子任务随即受理：05:45:52.997 调和器建出执行环境的 Runner Secret `sub-…-runner`、05:45:53.007 建出执行 Pod；05:45:55.903 它的 Runner 连上，05:45:55.983 派发子任务。执行 Pod 钉在父工作区的节点、挂父工作区的卷、带所属工作区标签与受理意图注解，只 `envFrom` 那个不可变 Secret，镜像按摘要；Secret 带同样的标签与注解。
  - 子任务 11.6 秒进入运行、46.2 秒成功，输出「收到」。关闭后 05:46:32 调和器删掉工作卷、执行环境的 Secret、工作区 Pod 与 `-runner-1`；执行 Pod 由 task-runtime 的清理作业按意图注解认领后删掉（新摘要认得出），05:46:44 执行环境记为已结束，05:47:08 工作区记为已释放。
- 没有实机走过的：「＋ CLI」与 headless Agent（在开发会话里，要在网关登录之后）；父工作区变了、要值时父工作区已断开、过了宽限仍在排队——由 task-runtime 的 `ledgerExecutions.test.ts` 与 cluster-control 的模块用例核对。

### 3.9 第七步：检出用的 Git 凭据归这一次启动（6185e4b4，I25 第三步）

- 门禁（干净导出树；`modules/platform/wiring.ts` 按「HEAD＋本批改动」导出，工作树里并行会话未提交的三处不在内）：check:static 通过；unit 674、module 1355、console 893；改动行 43／48（89.6%，没执行到的 5 行是原样挪进 `taskCheckout` 的旧 `checkoutFor` 函数体，此前同样没有用例走到）。CI [35962547321](https://github.com/wangbinquan/CrewStation/actions/runs/35962547321)：六项成功。
- 部署（UTC）：06:03:02 前 cs-api、cs-auth、cs-controller、cs-session 换到 `cs-control-plane:rc025-i25d-20260924`（`git archive 6185e4b4`），无迁移；三个在跑的开发会话照常连着，cs-controller 没有告警或错误日志。
- 回归：rfc006-verify 以服务身份再跑一次子任务（同 §3.8 的小套餐），13.8 秒进入运行、53.9 秒输出「收到」，工作区与执行环境照常建出、收尾。
- 没有实机走过的：开发会话本身（检出只有开发会话有，开会话要在网关登录之后）。受理只要仓库地址、记录多一个 `-checkout-1` 子对象、调和器在 Pod 之前建它（键 `token`、不可变）、init 容器按它取令牌，由 task-runtime 的 `ledgerCreation.test.ts`、cluster-control 的模块用例与对象用例核对；下一次有人在本机开开发会话时应看到这个 Secret，建不出来可设 `CS_WORKLOAD_CREATION=owner` 回退。

### 3.10 第八步：档位测试的 Pod 由调和器建（66c76d8b，I25 第四步）

- 门禁（干净导出树）：check:static 通过；unit 676、module 1356、console 893；改动行 19／19。提交前 HEAD 前进到并行会话的 3a7f4cb5（与本批不重叠），在「3a7f4cb5＋本批」上复核 check:static 与 task-runtime、cluster-control、platform、resources 的用例（284 条）。CI [35964244559](https://github.com/wangbinquan/CrewStation/actions/runs/35964244559)：六项成功。
- 部署（UTC）：06:25:25 前 cs-api、cs-auth、cs-controller、cs-session 换到 `cs-control-plane:rc025-i25c-20260924`（`git archive 66c76d8b`，含并行会话已上线的 3a7f4cb5，它的迁移 project/0012 由那边先跑过）；三个在跑的开发会话照常连着，cs-controller 没有告警或错误日志。
- 回归：rfc006-verify 以服务身份再跑一次子任务（同 §3.8），11.6 秒进入运行、45.3 秒输出「收到」。
- 没有实机走过的：档位测试本身（管理员在工作台里触发，要登录）。台账模式下跑一次档位测试（模拟调和器晚 150 毫秒建出 Pod，等 Runner 的轮询不判失败，测完释放）由 task-runtime 的 `ledgerProfileTest.test.ts` 核对；临时目录的渲染与不等卷由 cluster-control 的用例核对。

## 4. 第三期：服务槽（T8）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `4aeaa892` 服务槽投影进台账，调和器观测 Deployment | check:static 通过；unit 568、module 1266（12 跳过）、console 867；改动行 121／122（99.2%） | [35891997767](https://github.com/wangbinquan/CrewStation/actions/runs/35891997767) 六项成功 | 17:02:17 cs-controller、17:02:19 cs-api 换到 `cs-control-plane:rc025-p3a-20260923` |
| `6d54a25f` 槽的旧接口状态就绪之后照台账 | check:static 通过；unit 569、module 1267（12 跳过）、console 867；改动行 21／21 | [35893472583](https://github.com/wangbinquan/CrewStation/actions/runs/35893472583) 六项成功 | 17:17:59 cs-controller、17:18:01 cs-api 换到 `cs-control-plane:rc025-p3b-20260923` |
| `7c3e68d0` 形态图槽带的入口与 Deployment 状态照槽记录 | check:static 通过；unit 569、module 1279、console 868；改动行 4／4 | [35894218920](https://github.com/wangbinquan/CrewStation/actions/runs/35894218920) 六项成功 | 17:22:38 console 换到 `cs-console:rc025-p3c-20260924` |
| `25bf918e` 槽的副本由槽记录认领、崩溃重启汇总成条件，健康接口、告警巡检与健康卡照槽记录；视图列出稳定记录；压缩只限终态 | check:static 通过；unit 573、module 1283、console 869；改动行 119／120（99.2%） | [35899013397](https://github.com/wangbinquan/CrewStation/actions/runs/35899013397) 六项成功 | 18:04:06 cs-controller、18:04:08 cs-api 换到 `cs-control-plane:rc025-p3d-20260924`，18:05:18 console 换到 `cs-console:rc025-p3d-20260924` |
| `2b61586f` 槽记录带上保留计时，就绪之后槽 DTO 的副本数照台账；发布页槽卡随推送流原位重读 | check:static 通过；unit 575、module 1284、console 870；改动行 53／53 | [35901463457](https://github.com/wangbinquan/CrewStation/actions/runs/35901463457) 六项成功 | 18:25:34 cs-controller、18:25:36 cs-api 换到 `cs-control-plane:rc025-p3e-20260924`，18:26:12 console 换到 `cs-console:rc025-p3e-20260924` |
| `b2e19fdc` 统一预检接到发布侧：标准原因、集群 dry-run、预检查询，受理之后的失败记进发布记录 | check:static 通过；unit 575、module 1289、console 871；改动行 149／152（98.0%） | [35904861577](https://github.com/wangbinquan/CrewStation/actions/runs/35904861577) 六项成功 | 18:57:03 cs-controller、18:57:05 cs-api 换到 `cs-control-plane:rc025-p3f-20260924`，18:57:37 console 换到 `cs-console:rc025-p3f-20260924` |
| `c2be2128` 发布受理时就按那次提交的 Manifest 预检 | check:static 通过；unit 575、module 1290、console 871；改动行 46／47（97.9%） | [35906164790](https://github.com/wangbinquan/CrewStation/actions/runs/35906164790) 六项成功 | 19:06:57 cs-controller、19:06:59 cs-api 换到 `cs-control-plane:rc025-p3g-20260924` |
| `3c5315e0` 构建与迁移 Job 进台账，结束时记下结果 | check:static 通过；unit 577、module 1292、console 873；改动行 73／73 | [35908456352](https://github.com/wangbinquan/CrewStation/actions/runs/35908456352) 六项成功 | 19:27:10 cs-controller、19:27:11 cs-api 换到 `cs-control-plane:rc025-p3h-20260924`，19:27:43 console 换到 `cs-console:rc025-p3h-20260924` |
| `26033e7c` 概览摘要随推送流立即重读；发布页与概览共用按记录重读的钩子 | check:static 通过；unit 577、module 1292、console 874；改动行 18／18 | [35910235072](https://github.com/wangbinquan/CrewStation/actions/runs/35910235072) 六项成功 | 19:44:18 cs-controller、19:44:20 cs-api 换到 `cs-control-plane:rc025-p3i-20260924`（含其他会话的 9413aa8f、8406d9a6），19:44:56 console 换到 `cs-console:rc025-p3i-20260924` |
| `42fcec04` 服务槽的 Deployment、Service 与环境 Secret 由调和器建出，流水线照槽记录判铺开，集群管理的槽运维改为写期望 | check:static 通过；unit 698、module 1368（12 跳过）、console 900；改动行 281／286（98.3%，补了下线与推进超时两支的用例） | [35974875090](https://github.com/wangbinquan/CrewStation/actions/runs/35974875090) 六项成功 | 08:24:15 cs-api、cs-auth，08:24:52 cs-controller、cs-session 换到 `cs-control-plane:rc025-t8a-20260924`（含并行会话的 e4f15449） |
| `9505f329` 构建、迁移 Job 由调和器建出，凭据 Secret 建的时候才要、结束或放弃即删，流水线照 Job 记录判结果 | check:static 通过；unit 710、module 1372（12 跳过）、console 900；改动行 179／180（99.4%） | [35976923499](https://github.com/wangbinquan/CrewStation/actions/runs/35976923499) 六项成功 | 08:44:25 cs-api、cs-auth，08:44:27 cs-controller、cs-session 换到 `cs-control-plane:rc025-t8b-20260924` |

镜像都由 `git archive <提交>` 构建，只含已提交内容；无迁移，各一次就绪、0 重启。

- **槽记录接上真实数据**（p3a 部署后）：补投影 14 个服务、28 条记录。20 条「运行中」，各自的 Deployment 观测为 Available、原因「副本 1／1 就绪」；8 条「已结束」——demo 的绿槽原因 `offline-manual`（已由成员手动下线），其余 7 条 `not-deployed`（rfc003-ux、rfc003-verify-files、rfc006-verify、rfc010-cluster-qa、rfc011-role-home、rfc022-verify、rfc023-verify 各有一个从没部署过的物理槽）。
- **p3b 部署后**：20 条在跑的槽记录仍全是「运行中」、Deployment 都是 Available，槽的旧接口状态不变（只在流水线判定就绪之后、观测不是运行中时才改写）。降级那一支（新版本铺完后副本没全就绪）由模块用例 `slotLedger.test.ts` 核对；实机上要对共享集群里的槽做一次运维重启才能看到，这一步被权限拦下，没有做。
- **p3c 部署后**：工作台已换新；浏览器的登录已过期，没有替作者重新登录，形态图槽带的显示由组件用例 `topologyAssembly.test.ts` 核对。
- **25bf918e 部署后**：首轮观测汇总 `recorded 59、unchanged 11、unowned 102`（部署前 `unowned 122`）——20 个槽副本被各自的槽记录认领。28 条槽记录逐条核对：20 条「运行中」，各带 Deployment（观测 Available、就绪 1／期望 1）与 1 个副本 Pod（Running、重启 0），`CrashLooping` 为假；8 条「已结束」（Deployment 不在）。cs-controller 与 cs-api 3 分钟内没有告警或错误日志；告警巡检改照槽记录后没有新告警（表里只有早先已恢复的 20 条 `health-failing`）。
- **压缩条件**：部署前查库，没有被压缩过的记录；期望仍在、已结束的有 8 条服务槽与 3 个孤儿卷，按旧条件会从 09-30 起被压掉子对象，改正后不再压缩。
- 健康接口的返回值与工作台健康卡由模块用例与组件用例核对（接口在网关登录之后，没有替作者登录）。
- **2b61586f 部署后**：补投影 14 个服务后，10 个在计时的待命槽记录都带上 `RetentionDeadline`，到期时刻与按平台策略（回退目标 72 小时、无人访问 14 天、提前 24 小时提醒）手算的一致——4 个回退目标到 09-26 05:14:23Z（09-23 05:14 切流起 72 小时），1 个推迟过一次的回退目标到 09-27 07:41:20Z，5 个待验证版本按就绪或最近一次访问起 14 天（其中一个按 09-23 10:22:25Z 的访问推后到 10-07 10:22:25Z）；4 个空的待命槽条件为假、没有到期字段。都还没到提醒时刻，没有提醒字段。发布页槽卡的推送重读由组件用例核对（浏览器登录已过期）。
- **统一预检（RC-07）**：四种情形由模块用例逐一核对——旧写法 Manifest（`manifest-outdated`，重新部署）、档位被删（`profile-missing`，发布受理与流水线部署）、套餐被收回（`plan-unavailable`，重新部署与发布受理；project 模块直接拒绝时同样归为它）、额度已满（任务类入口，`quota_exceeded`，随 T6 的额度经台账受理再核对一次）；每种都返回 412、原因码与出路，发布与槽不变、台账没有新记录。实机上这些接口在网关登录之后，没有替作者登录去点；集群 dry-run 与现在的部署用同一个动词与身份（cs-api 的服务账号对 Deployment 与 Service 做服务端 apply）。
- **42fcec04 部署后（服务槽由调和器建出）**：首轮观测 `recorded 0、unchanged 291、applied 0、removed 0`；上线前后 27 个受管 Deployment 逐个比 generation，只有滚动的四个平台组件变了，20 个槽的 Deployment 一个没动——台账里 28 条槽记录都是旧形状（期望里没有 `slot`），调和器照规则不碰（20 条运行中、8 条已结束，generation 都没变）。真正建一次槽要发布或重新部署（要登录、会打标签），没有做；用同一套构造函数渲染 rfc006-verify 绿槽的新形状对象，以服务端 dry-run 提交：环境 Secret、Service 与套在现有旧 Deployment 上的新 Deployment 都被接受（选择器不变），结果里 Deployment 的明文环境变量没有了（原有 12 个）、只 `envFrom` 这个 Secret、带重启注解；dry-run 之后线上 generation 仍是 2、Secret 不存在。建、铺开、失败、下线、运维与重新部署的每一支由模块用例（真实台账＋模拟调和器）与 cluster-control 的贯通用例（真实台账＋假集群）核对。
- **9505f329 部署后（构建、迁移 Job 由调和器建出）**：首轮观测同样 `recorded 0、applied 0、removed 0`，没有告警；本机台账里眼下没有构建或迁移 Job 记录（上一次发布早于 Job 进台账），28 条槽记录的更新时间仍是 01:28Z，两次上线都没碰。真跑一次构建与迁移同样要发布，没有做；用同一套构造函数渲染构建与迁移 Job 及其凭据 Secret，在 cs-rfc006-verify 以服务端 dry-run 创建：四个对象都被接受——构建 Job 的明文环境只有仓库地址、标签与镜像名，令牌只经 `envFrom` 引用凭据 Secret；迁移 Job 只 `envFrom` 凭据 Secret；两个 Secret 都是不可变的——之后命名空间里没有留下任何对象。要凭据、Job 结束删凭据、TTL 之后不补建、没建成与超时判失败并报 Failed，由模块用例与贯通用例核对。
- **3c5315e0 部署后**：观测缓存加上 Job 之后照常同步（首轮 `recorded 19、unchanged 51、unowned 102`，本机眼下没有受管的 Job），cs-controller 的服务账号 `crewstation-control` 可在全集群 list／watch Job（部署前 `kubectl auth can-i` 核对）。真正跑一次构建与迁移要在共享集群上发布（会在 GitLab 打标签），没有得到许可不做；Job 记录的认领、阶段与 TTL 之后的结果由模块用例核对。

## 5. 第三期后半：路由（T9）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `3ddccf23` 服务的路由投影成 `route` 记录，每 5 分钟按路由表补投影 | check:static 通过；unit 581、module 1298、console 874；改动行 65／70（92.9%，未执行的 5 行是一个右括号与四行注释，由 5cb1060b 修正合并规则后为 65／65） | [35917333817](https://github.com/wangbinquan/CrewStation/actions/runs/35917333817) 六项成功 | 20:47:14 cs-controller、20:47:16 cs-api、20:47:48 cs-session 换到 `cs-control-plane:rc025-t9a-20260924`（`git archive 3ddccf23`，含 7551a493） |
| `aed62f71` 身份索引墓碑保留 7 天、每小时清理；定时作业收成 `periodicJob` | check:static 通过；unit 582、module 1301、console 874；改动行 47／47 | [35918700319](https://github.com/wangbinquan/CrewStation/actions/runs/35918700319) 六项成功 | 21:00:39 cs-controller、21:00:42 cs-api、21:01:14 cs-session 换到 `cs-control-plane:rc025-t9b-20260924` |
| `0c97dfb5` 服务路由的 IngressRoute 改由调和器照记录建、改、删 | check:static 通过；unit 588、module 1302、console 874；改动行 90／90 | [35921300629](https://github.com/wangbinquan/CrewStation/actions/runs/35921300629) 六项成功 | 21:24:33 cs-controller、21:24:34 cs-api、21:25:06 cs-session 换到 `cs-control-plane:rc025-t9c-20260924`；**21:26 回滚**到 `rc025-t9b-20260924`（见下） |
| `5a5591f2` 身份索引改由 cluster-control 的观测缓存驱动，gateway 的 Pod watch 去掉 | check:static 通过；unit 588、module 1304、console 874；改动行 29／29 | 随 cb13edb7 一起跑（下一行） | 随 cb13edb7 上线 |
| `cb13edb7` 台账比较子对象不看先后，观测里的 generation 存得下、读得回 | check:static 通过；unit 588、module 1306、console 874；改动行 10／10 | [35923652797](https://github.com/wangbinquan/CrewStation/actions/runs/35923652797) 六项成功 | 21:46:58 cs-controller、21:47:00 cs-api、21:47:32 cs-session 换到 `cs-control-plane:rc025-t9d-20260924`（含 0c97dfb5、5a5591f2） |
| `3de12b3a` 放行表每 10 分钟全量核对，不一致就重算并在服务域路由记录上写 `AllowlistDrift` | check:static 通过；unit 591、module 1308、console 874；改动行 46／46 | [35925776928](https://github.com/wangbinquan/CrewStation/actions/runs/35925776928) 六项成功 | 22:08:51 cs-controller、22:08:53 cs-api、22:09:25 cs-session 换到 `cs-control-plane:rc025-t9e-20260924` |

镜像由 `git archive <提交>` 构建；无迁移，各一次就绪、0 重启；三个服务上线后没有告警或错误日志。

- **路由进台账**：上线 1 秒后补投影完成（`resource ledger routes resynced`，14 个服务），台账里 55 条 `route` 记录全是「运行中」——正式、待验证、服务域各 14 条，内部 API 前缀 13 条；每条的 IngressRoute 子对象都已观测到（`resources.children` 55／55）。集群里按 `<服务>-{prod,preview,service,internal-api}` 命名的 IngressRoute 正好 55 条，一一对应；其余是系统命名空间的平台路由（不入台账）与开发预览路由（仍挂在开发工作区记录下）。
- 首轮观测汇总 `recorded 22、unchanged 52、unowned 99` 在路由记录建出之前（20:47:16，补投影在 20:47:17），所以这 55 个 IngressRoute 在那一轮仍算未认领；认领由子对象表核实。
- **空写循环：发现、回滚与修复**：
  - 0c97dfb5 上线后首轮汇总 `applied 0`——新渲染与线上 55 条服务路由一致，部署前后每条的 resourceVersion 与 generation 都没变；但观测新加的 `generation` 没写进台账的 `observed` 列，读回来少一个字段，同样的观测每次都算变化，按记录核对自己跟自己转圈：21:25 这一分钟台账变更 4629 条。21:26 把三个服务回滚到 aed62f71 的镜像，路由记录的空写随即停下。
  - 查的时候发现此前每分钟约 1800 条的底子本身也是这种循环：6 条开发工作区记录（3 个运行中的会话、3 个失败的会话）每条每秒被空写 4–8 次，隔一秒取两次快照内容完全相同而 `version` 在涨（其中一条已写到 14 万次）；按小时统计，从 09-23 16:22（99e93569 上线，开发工作区记录从 1 个子对象变成 4 个）起每小时约 11 万行。根因是子对象从库里按种类与名字读回、合并却按期望里的顺序排，按数组一比就「变了」，整组重写并追加一行变更，这行变更又触发下一次核对。开着的工作台概览会随记录变化重读摘要，也跟着被拉高。
  - cb13edb7 修掉两处：比较子对象不看先后，`generation` 随观测存下、读回；两条回归用例在修复前的代码上都失败。21:46:58 上线后，21:47 这一分钟台账变更 28 条（上线本身的补投影与观测），此后空闲时为 0；首轮 `applied 0`，55 条路由对象部署前后逐条不变，路由子对象的观测都带上了 `generation`。上线后 1 秒内有 9 条「路由期望不完整」告警：回滚期间旧代码把路由记录的期望写回了旧形状，补投影完成（21:47:00.95）之后不再出现。
- **身份索引改读观测（5a5591f2，随 cb13edb7 上线）**：观测缓存首次同步后 30 条在册身份全部被刷新（`pod identities pruned after relist` 清掉 1 条旧行）；新起的 cs-controller、cs-api、cs-session Pod 拿到 IP 后约 1 秒内入索引；gateway 自己的 Pod watch 已删去，全平台只剩观测缓存这一条 Pod watch。改动路由对象后「改回」由模块用例核对（在共享集群上手工改线上路由没有做）。
- **放行表核对（3de12b3a 部署后）**：启动时的第一轮核对没有告警——库里最新一版（第 61 版，09-23 11:19 生成）与按当前在册服务和授权推导的内容一致，没有重算；14 条服务域路由记录各写了一次 `AllowlistDrift` 为假（22:08 这一分钟台账正好 14 条变更），之后台账无变更。不一致时重算与写真由模块用例核对（在共享集群上改授权没有做）。
- **墓碑清理（aed62f71 部署后）**：部署前 `gateway.pod_identities` 在册 30 行、墓碑 727 行（最早 09-11 14:54），其中 189 行标为删除已超过 7 天；上线 2 秒后 `pod identity tombstones purged`（189），之后墓碑 541 行、最早 09-18 05:18，没有超过 7 天的，在册 30 行不变。这次首轮观测汇总 `recorded 19、unchanged 106、unowned 47`——上一轮的 99 里有 55 个是服务路由，这次已被路由记录认领。三个补投影作业改用 `periodicJob` 后日志照旧（槽 14、任务环境 21、路由 14）。


说明页（I26 裁定之后）：

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `b35ea86d` 槽「已结束」时待验证与正式主机改指 cs-api 的说明页，ForwardAuth 的未部署分支退役 | check:static 通过；unit 650、module 1342、console 892；改动的可执行行 126／126 | [35954487460](https://github.com/wangbinquan/CrewStation/actions/runs/35954487460) 六项成功 | 04:10 cs-api、cs-auth（此前是 `iface-20260923`），04:11 cs-controller、cs-session，都换 `cs-control-plane:rc025-i26-20260924` |

- **改指**：部署前台账里有 8 个「已结束」的槽——demo 的待验证槽（v0.1.2，09-23 手动下线），rfc003-ux、rfc003-verify-files、rfc010-cluster-qa 的待验证槽与 rfc006-verify、rfc011-role-home、rfc022-verify、rfc023-verify 的正式槽（都尚未部署）。cs-controller 起来后 1.2 秒内（04:11:00.7–01.9）建出 8 个说明页中间件（replacePath 的路径带各自路由记录的 ID，组件标签是路由），8 条 IngressRoute 随之改指 `crewstation-system/cs-api:8080`，中间件链是原来的去身份头、ForwardAuth、两个限流，末尾接说明页中间件；目标是这几个槽的服务域与内部 API 路由（8 条）不动，有工作负载的槽的路由不动。
- **登录照旧先过**：不带会话访问 `preview.demo.cs.localhost` 与 `rfc006-verify.cs.localhost`，接口请求 401、浏览器 302 到登录页。
- **页面与错误体**（作者已登录的 dev-admin 会话，只读查看）：待验证主机给「未部署待验证版本」页——「demo 当前没有待验证版本」「v0.1.2 已于 … 下线：负责人手动下线」；在同一主机上发一个 POST 接口请求，得到 503、`Cache-Control: no-store`、`{ error: 'not-deployed', message: 'demo 当前没有待验证版本', details: { at: '2026-09-23T07:55:51.915Z', reason: 'manual', tag: 'v0.1.2' } }`；正式主机 `rfc006-verify.cs.localhost` 给「尚未上线」页。Traefik 的访问日志里这几次请求的上游都是 cs-api 的 Pod。有版本的 `demo.cs.localhost` 照常是样例应用（身份头照常注入）。
- **没有实机走过的**：重新部署后指回槽与「正在切换」（要在共享集群上重新部署一个项目；由模块用例核对：`clusterControlModule.test.ts` 的说明页用例、`unavailableRoutes.test.ts`）。
## 6. 第三期：限流（T10）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `cef5b880` 限流策略的存取与管理接口（平台默认与项目覆盖） | check:static 通过；unit 595、module 1312、console 874；改动行 126／126 | [35927939112](https://github.com/wangbinquan/CrewStation/actions/runs/35927939112) 六项成功 | 随 989e07f7 上线 |
| `989e07f7` 策略写成 `rate-limit-policy` 记录，调和器照记录渲染 Traefik Middleware | check:static 通过；unit 602、module 1315、console 874；改动行 134／134 | [35929308762](https://github.com/wangbinquan/CrewStation/actions/runs/35929308762) 六项成功 | 22:45:19 迁移 Job 应用 `gateway/0006_rate_limits.sql`；22:45:32 cs-controller、22:45:38 cs-api、22:46:10 cs-session 换到 `cs-control-plane:rc025-t10b-20260924` |
| `de9dcb5b` 用户域、服务域与平台接口的路由挂上限流，工作台读请求按 `Retry-After` 自动重读 | check:static 通过；unit 604、module 1315、console 875；改动行 37／37 | [35930651526](https://github.com/wangbinquan/CrewStation/actions/runs/35930651526) 六项成功 | 23:01:35 cs-controller、23:01:37 cs-api、23:02:09 cs-session 换到 `cs-control-plane:rc025-t10c-20260924`；23:02 `kubectl apply -f deploy/k8s/platform/40-gateway.yaml`；23:03:31 console 换到 `cs-console:rc025-t10c-20260924` |
| `5fb115ba` 管理端的网关限流：平台设置里的平台默认，项目管理页里的单独设置与撤销 | check:static 通过；unit 604、module 1315、console 880；改动行 292／292 | [35932937164](https://github.com/wangbinquan/CrewStation/actions/runs/35932937164) 六项成功 | 23:26:51 console 换到 `cs-console:rc025-t10d-20260924`（只换工作台） |

镜像由 `git archive <提交>` 构建；这次有一个迁移，先用新镜像跑一次 `cs-api migrate` 的 Job（`deploy/k8s/platform/20-migrate-job.yaml` 换镜像）再滚动服务；各一次就绪、0 重启，三个服务上线后没有告警或错误日志。

- **策略进台账、中间件建出（989e07f7 部署后）**：上线 3 秒内调和器建出 58 个限流中间件（`resource child applied` 58 条）——系统命名空间里的 `rate-limit-platform-api`（`rateLimit` 平均 20、突发 40、周期 1 秒，按 `x-cs-user-id`）与 `in-flight-platform-api`（`inFlightReq` 16），14 个项目命名空间各 4 个（`rate-limit-user`、`rate-limit-host`、`rate-limit-source`、`rate-limit-target`）；15 条 `rate-limit-policy` 记录（平台 1 条、项目 14 条）全部运行中，平台那条的展示字段是 `20/s·40`、`16`。渲染出的中间件都带平台标签、组件标签 `rate-limit` 与所属记录的资源 ID。22:45 这一分钟台账变更 73 条（一次性声明与观测），之后空闲时为 0。这一步还没有路由引用这些中间件，放行不变。
- 管理接口（平台默认与项目覆盖的读写、409、403、404）由模块用例经 HTTP 核对；实机上这些接口在网关登录之后，没有替作者登录去调。
- **挂上限流（de9dcb5b 部署后）**：上线 4 秒内补投影按新计划重算 14 个服务，调和器改写 55 条服务路由（`resource child applied` 55 条）；逐条核对线上对象，正式与待验证路由的链是 `drop-identity-headers → forward-auth-user → rate-limit-user → rate-limit-host`，服务域与内部 API 是 `… → forward-auth-service → rate-limit-source → rate-limit-target（→ strip-api-<proxy>）`，55／55。Traefik 没有「中间件不存在」一类的错误（日志里只有部署前就有的 7 个从没部署过的物理槽的 `service not found`）。系统路由清单应用后，`console-api` 的链末尾是 `rate-limit-platform-api → in-flight-platform-api`，新路由 `console-resource-streams`（两条资源推送流）只挂令牌桶；两个平台中间件的取值与资源 ID 标签在 `kubectl apply` 之后保留。未登录的请求照旧在 ForwardAuth 被拒（`/v1/me`、资源推送流、工作台首页、demo 正式主机都是 401）。
- **管理端界面（5fb115ba 部署后）**：两张卡的读、改、撤销与 409 由工作台组件用例驱动假接口核对（`adminRateLimits.test.tsx`，含服务端返回不合形状的响应时不崩溃）；实机上这两个页面在登录之后，没有替作者登录去点。
- **服务域突发实测**：从 cs-api 的 Pod 同时向 `demo.svc.cs.internal/healthz` 发 130 个请求——100 个 200、30 个 429 且带 `Retry-After: 1`，正是「每个来源服务对每个目标」那只桶的突发 100；停 3 秒后再发 60 个全是 200（按每秒 50 补回）。平台接口与用户域的突发要登录后才能打到限流（在 ForwardAuth 之后），没有替作者登录；留给 T15 校准时与作者一起测。

## 7. 第四期：命名空间、额度与网络策略（T11）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `6db2d958` 命名空间、额度与网络策略写成台账记录，调和器照记录建出、被改或被删就补回 | check:static 通过；unit 615、module 1319、console 880；改动行 173／175（98.9%） | [35936041472](https://github.com/wangbinquan/CrewStation/actions/runs/35936041472) 六项成功 | 23:57:25 cs-controller、23:58:14 cs-api、23:58:16 cs-session 换到 `cs-control-plane:rc025-t11a-20260924`（没有迁移） |

镜像由 `git archive 6db2d958` 构建；三个服务各一次就绪、0 重启，上线后没有告警或错误日志。

- **切换前比对**：按新渲染（provisioning 的期望 → cluster-control 的渲染输入 → 与原来同一组构造函数）逐个比对本机 14 个项目的 73 个对象——14 个命名空间、14 个额度、45 条网络策略（11 个数字人项目各 3 条，3 个接入项目各 4 条）——用调和器的比对函数判定，全部一致；项目命名空间里也没有期望之外的受管网络策略。
- **上线**：23:57:30 启动重下发写完 14 个项目（`namespace reapply done`，14／14），28 条记录（`namespace`、`network-policy-set` 各 14 条）全部运行中，73 个子对象都观测到了；调和器没有 apply 任何对象（`resource child applied` 0 条）。部署前后逐个对照线上对象——命名空间与网络策略的 `resourceVersion`、额度上 `crewstation` 这个字段管理者的 Apply 时间——73／73 不变。23:57 这一分钟台账变更 101 条（一次性声明与首轮观测），之后空闲时每分钟 0 条。
- **被改动时改回（RC-12）**：把验证项目 `cs-rfc023-verify` 的额度上限 `pods` 从 30 改成 31（字段管理者 `rc12-drill`），23:59:34.820 调和器改回（`resource child applied`，原因 `drift`），额度上的字段归属回到 `crewstation`。额度不带 `generation`，这一次走的是「观测到变化就核对」那条路径。
- **被删除时补回（RC-12）**：删掉 `cs-rfc023-verify` 的 `crewstation-build-egress`（23:59:50；当时没有构建在跑，选的是放行方向的那条，删掉期间只会更严），23:59:50.910 调和器按期望建回（原因 `missing`），台账记下新 UID，记录回到运行中。
- 新建项目时「写期望后等两条记录运行中再建仓」只有模块用例（`namespaceRecords.test.ts`：等到；等不到时写明还缺哪个对象）：本机新建项目要登录管理端，没有替作者登录去建；CI 的 e2e 在全新集群里也不建项目。
- 命名空间标签被改后改回、网络策略等命名空间、命名空间删除中不动（记录降级）、期望不完整不渲染：模块用例（`clusterControlModule.test.ts`、`phase.test.ts`）；实机没有去改共享集群的命名空间标签。
- 项目归档后两条记录不释放；怎样收尾待 [I27](../../../docs/engineering/implementation-open-questions.md#i27-项目归档后命名空间记录与命名空间怎样收尾) 裁定。

## 8. 第四期：数据资源（T12）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `5e49a657` 生产库、开发库与数据访问绑定投影成台账记录，新模块 data-control 观测数据面 | check:static 通过；unit 627、module 1327、console 880；改动行 222／222（与下一笔一起过的门禁） | 随 ff561324 | 随 ff561324 上线 |
| `ff561324` 超时的终端探测命令退出码一律为空（整层跑时发现的偶发失败） | 同上 | [35938775938](https://github.com/wangbinquan/CrewStation/actions/runs/35938775938) 六项成功 | 00:31:58 cs-controller、00:32:53 cs-api、00:32:54 cs-session 换到 `cs-control-plane:rc025-t12a-20260924`（没有迁移）；探测跑在任务容器里，这一行修复随下次任务镜像生效 |
| `5e088e66` 「不要了」的访问绑定，还在的临时角色由 data-control 删 | check:static 通过；unit 629、module 1329、console 880；改动行 78／78 | [35939664717](https://github.com/wangbinquan/CrewStation/actions/runs/35939664717) 六项成功 | 00:43:39 cs-controller、00:43:44 cs-api、00:43:50 cs-session 换到 `cs-control-plane:rc025-t12b-20260924`（没有迁移） |

镜像由 `git archive ff561324` 构建；三个服务各一次就绪、0 重启，上线后没有告警或错误日志。

- **上线**：00:32:02 补投影写完 28 个数据资源（14 个项目的生产库、开发库），28 条 `database` 记录全部运行中；56 个子对象（库与同名运行角色各 28）都观测到了，记下的 UID 与线上 OID 逐一相同（抽查 demo：生产库 16829、角色 16828，开发库 16831、角色 16830）。00:32 这一分钟台账变更 84 条（28 条声明加 56 条首轮观测），之后空闲时每分钟 0 条。
- **访问绑定**：本机 6 条都已结束（到期 1、收回 5），都在台账接上之前结束，按规则不补记录；本机没有进行中的绑定。申请、批准、收回、拒绝、到期的投影与台账写失败时的补投影只有模块用例（`modules/data/tests/dataLedger.test.ts`）——新建绑定要登录工作台，没有替作者登录。
- **数据面上的孤儿**：另有两组不属于任何数据资源的库与角色（`cs_cluster_business`、`cs_cluster_business_dev`），不在任何记录里，本期不动；孤儿的处理随第六期收编（T14）。
- **删除移交（5e088e66）**：上线后 28 条数据库记录仍都运行中，重启与补投影没有产生台账写入（期望未变）；没有告警或错误日志。本机没有进行中的访问绑定，调和器删临时角色这条路径只有用例：模块用例（假数据面，删掉后记录已结束；期望里没写库名的旧记录跳过并告警）与对测试库的真实用例（`postgresDataPlane.test.ts`：临时角色拥有的表转给运行角色后删掉；OID 对不上不删；不在的算完成；不是平台名字的拒绝）。
- `5e49a657` 顺带提交了并行会话 crewstation-8a 在工作树里备好的 `README.md`（data-control 一行），内容未改动，那笔的提交说明漏写了。

- **建库移交（0b0c43db，I28 第一步）**：门禁（干净导出树）check:static 通过；unit 682、module 1371、console 900；改动行 126／127（99.2%，没执行到的一行是等待循环里拿不到口令时的分支）。提交前 HEAD 前进到并行会话的 dcb60115（与本批不重叠），在合并后的树上复核 check:static 与 data、data-control、platform、settings、provisioning、cluster-control 的用例（144 条）。CI [35966617907](https://github.com/wangbinquan/CrewStation/actions/runs/35966617907) 模块层一条用例失败——cluster-control「构建 Job 被 TTL 删掉之后仍是已结束」（本地门禁与之前的 CI 都通过）：按记录核对读到旧版本的 Job（还在跑），写回的 Finished 为假覆盖了事件刚写下的为真，Job 被删之后再没有事件能改回来。这是真竞态，由 7fef93f0 修（台账合并条件时 Finished 为真之后不再改），它的 CI [35967963428](https://github.com/wangbinquan/CrewStation/actions/runs/35967963428) 六项成功。06:52:53 用新镜像跑迁移 Job（只有 `data_control/0001_credentials.sql`），06:53:40 前 cs-api、cs-auth、cs-controller、cs-session 换到 `cs-control-plane:rc025-i28a-20260924`（`git archive 0b0c43db`，含并行会话已上线的 dcb60115）。上线后口令表是空的——本机 28 个数据资源都存着连接串（旧形状），期望里没有「由 data-control 建」，调和器一个也没建；28 条 `database` 记录仍都运行中，cs-controller 没有告警或错误日志。回归：rfc006-verify 的业务子任务 42.2 秒输出「收到」（容器环境里的库连接串走旧库那条路）。新项目的开通要在管理端登录后建项目，没有实机走过；由 data 的贯通用例在真实 PostgreSQL 上核对（`dataControlProvisioning.test.ts`：resources＋data-control＋data，开通等 data-control 建好才就绪，data 不存连接串，拼出的连接串用 data-control 存的口令、真的连得上；超时记失败），数据面适配器的建库另有真实用例（建角色与库、换口令后旧口令连不上、别的角色没有 CONNECT、口令格式不对拒绝）。

- **临时角色移交（784ab558，I28 第二步）**：门禁（干净导出树）check:static 通过；unit 684、module 1374、console 900；改动行 63／64（98.4%，没执行到的一行是等超时时的告警）。CI [35969868721](https://github.com/wangbinquan/CrewStation/actions/runs/35969868721) 六项成功。07:30:41 前 cs-api、cs-auth、cs-controller、cs-session 换到 `cs-control-plane:rc025-i28b-20260924`（`git archive 784ab558`，同时带上 7fef93f0 的竞态修复），没有迁移。上线后口令表仍为空、28 条库记录运行中、没有告警；子任务回归 42.1 秒「收到」。本机没有进行中的访问绑定，新建绑定要在工作台登录后申请、负责人批准，没有实机走过；由真实 PostgreSQL 上的贯通用例核对（批准诊断只读的绑定后等 data-control 建好临时角色才答复，渲染出的连接串能读、写不进去，data 不存连接串；开发模式照开发库现取），临时角色的适配器另有真实用例（只读能读不能写、可写的能写、换口令不重建、到期时间照写）。

## 9. 第五期：集群管理（T13）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `903167c7` 删除待回收的工作卷由资源中心自己受理，期望改为「不要了」，调和器删 PVC | check:static 通过；unit 629、module 1330、console 880；改动行 20／21（未执行的一行是块的右花括号） | [35940783388](https://github.com/wangbinquan/CrewStation/actions/runs/35940783388) 六项成功 | 随 bddf3d39 上线 |

- 受理与权限由模块用例核对（`viewsAndActions.test.ts`：管理员删除即「不要了」、原因 `volume-deleted`，已受理的不能再删，非管理员 403、版本已变 409）；调和器随之按 UID 删 PVC、记录进入已结束，由 `clusterControlModule.test.ts` 核对。
- 本机有 3 个孤儿工作卷在「待回收」（归 cluster-control，原因 `orphaned`）：删不删是管理员的决定，没有替作者删；集群管理里还没有入口，界面等 I29。

I29 裁定（三个 (a)）之后：

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `a89589ab` 集群清单叠加台账记录、台账维护的对象不给直接删、「待回收的工作卷」一类；标准输出里没有执行者的操作如实写不支持 | check:static 通过；unit 639、module 1339、console 892；改动的可执行行 239／239 | [35952227817](https://github.com/wangbinquan/CrewStation/actions/runs/35952227817) 六项成功 | 03:39 控制面三个服务换 `cs-control-plane:rc025-t13-20260924`，03:40 工作台换 `cs-console:rc025-t13-20260924`（同一笔提交的 git archive 构建；74687800 的观察期限修正随之上线） |

实机（经网关，作者已登录的 dev-admin 会话，只读查看；没有点任何删除或确认）：

- **认领覆盖**：「网络」一类 237 个对象里，项目命名空间的全部带上所属记录——55 条服务路由与 6 条开发预览 IngressRoute、58 个限流中间件与 13 个前缀剥离中间件、45 条网络策略、27 个 Service（服务槽 21、开发预览 6）；没有叠加的 33 个全是系统命名空间里安装流程建的平台组件。路由、中间件、网络策略都是「资源中心维护」。
- **删除禁用**：`demo-prod`（IngressRoute）的行上「状态」是「运行中」、小字「集群观测：Active」；详情里「删除／结束」不可用，写着「由资源中心按期望维护，删除后会被补回；要移除请从所属功能下线或释放」，下面「资源中心记录 · 路由 · 运行中」。服务端同样拒：对它发删除的影响检查，回执里这项操作不可做、原因同上（没有受理）。项目命名空间的 11 个 PVC 全由工作卷记录认领，直接删除一律指向「待回收的工作卷」；系统命名空间的 4 个 PVC 仍是「平台组件由安装流程管理，不支持删除」。
- **待回收的工作卷**：页签排在「存储与配置」之后，不带筛选条；列出 3 个孤儿卷（`cs-rfc006-verify/task-01a0b3e0c77e-work`、`cs-rfc010-cluster-qa` 的两个），原因「集群里有、台账里没有的工作卷」，每行「删除工作卷」可点——删不删仍由作者定。「所属项目」一栏是「—」：孤儿收编时没有按命名空间找项目，记录没有项目 ID（声明后项目 ID 不可改），卷名下面照样写着所在命名空间；以后收编的孤儿卷带上项目，记在 T14 的后续。

## 10. 多副本分工（T16）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `bddf3d39` 调和器接上租约，多个 cs-controller 副本按记录分工、持有者没了由别的副本接手 | check:static 通过；unit 633、module 1330、console 880；改动行 32／32 | [35941463160](https://github.com/wangbinquan/CrewStation/actions/runs/35941463160) 六项成功 | 01:07:23 cs-controller、01:07:26 cs-api、01:07:28 cs-session 换到 `cs-control-plane:rc025-t16a-20260924`（含 903167c7；没有迁移） |

镜像由 `git archive bddf3d39` 构建；三个服务各一次就绪、0 重启，上线后没有告警或错误日志；空闲时租约表为空（处理完即释放）。

- **两个副本**：01:08:23 把 cs-controller 扩到 2 个副本（`2frtw`、`l2gxl`），60 秒里每 100 毫秒采样一次租约表：数据面全量那把作业租约 `data-control:resync` 轮流由两个副本持有（`l2gxl` 采到 6 次、`2frtw` 4 次），同一时刻只有一个。01:08:38 把验证项目 `cs-rfc023-verify` 的额度 `pods` 改成 31：同一秒改回，只有 `l2gxl` 记了一行 `resource child applied`，另一个副本没有重复写。两个副本都没有告警或错误日志。
- **持有者崩溃、别的副本接手**：在租约表里给这条命名空间记录放一行「已崩溃副本」持有、30 秒后过期的租约（`crashed-replica-drill`），01:10:10 再把额度改大：两个副本都抢不到、按 5 秒的间隔再排；01:10:40.515 租约过期，01:10:40.597 `2frtw` 抢到并改回（改大之后 30 秒）。之后租约表为空。
- **缩回一个副本**：01:10:54 缩回 1 个（留下 `l2gxl`），01:11:06 再改一次额度，当即改回；记录的阶段与计数和扩容前相同。
- 两个副本期间集群管理的历史用量会多一份采样、空闲提醒可能重复一次（这些定期作业不分工，设计 §6.3 补记），这几分钟里没有去核对它们。控制面的高可用整体（M6）不在本期。

## 11. 第六期：收编（T14）

| 提交 | 门禁（干净导出树） | CI | 部署（UTC） |
|---|---|---|---|
| `ed208846` 服务槽的 Service 与内部 API 的前缀剥离中间件入账，孤儿回收扩到没人认领也没人引用的中间件 | check:static 通过；unit 633、module 1331、console 880；改动行 44／44 | [35942984716](https://github.com/wangbinquan/CrewStation/actions/runs/35942984716) 六项成功 | 01:28:19 cs-controller、01:28:23 cs-api、01:28:24 cs-session 换到 `cs-control-plane:rc025-t14a-20260924`（没有迁移） |
| `151b0267` RFC-013 之前的 tsk_… 旧身份写成台账记录的别名 | check:static 通过；unit 634、module 1332、console 880；改动行 2／2 | [35943960313](https://github.com/wangbinquan/CrewStation/actions/runs/35943960313) 模块级红：cluster-management 用例偶发（与本提交无关，见下一行），其余五项成功 | 01:41:10 cs-controller、01:41:14 cs-api、01:41:16 cs-session 换到 `cs-control-plane:rc025-t14b-20260924`（没有迁移） |

| `74687800` 运维操作的观察先看一次再判期限（修上一行 CI 的偶发失败） | check:static 通过；unit 634、module 1333、console 889；改动行 2／2 | [35945073725](https://github.com/wangbinquan/CrewStation/actions/runs/35945073725) 六项成功 | 没有单独部署（生产的观察期限是 300 秒，行为不变），随下一次部署上线 |

两次上线三个服务都各一次就绪、0 重启，没有告警或错误日志。151b0267 的 CI 红在 cluster-management 的「执行、观察、日志」用例：它把观察期限设成 100 毫秒、用真实时钟，实现先判期限再观察，CI 负载下一次都没观察就判「观察期限内尚未收敛」；74687800 改成先观察一次，并加一条期限为 0 的用例（旧实现必失败）。

- **上线前的核对**：带受管标签、却没有任何记录认领的对象（系统命名空间之外）有三类——各项目服务槽的 Service、内部 API 的前缀剥离中间件、服务的 Git 凭据 Secret（`git-cred-*`、`git-checkout-*`）。按新规则预测孤儿回收只会删两个没人引用的旧前缀剥离中间件。
- **入账（ed208846）**：上线后 83 条服务槽与路由记录的阶段与原因和上线前逐条相同（下线的槽照旧「已结束」，没有因为 Service 还在变成结束中）；21 个槽 Service 与 13 个前缀剥离中间件被记录认领、观测为在（另 7 个从没部署过的物理槽没有 Service，记为不在）。之后还没被认领的只剩那两个旧中间件与 Git 凭据 Secret。
- **孤儿回收**：观测缓存同步 10 分钟后的第一轮（01:38:24）按 UID 删掉 `cs-gitlab-event-producer/strip-api-gitlab-event-producer` 与 `cs-reference-api-proxy/strip-api-reference-api-proxy`（原因 `unreferenced`），与预测一致；正在用的 `strip-api-test-gitlab` 和各项目的限流中间件都在。
- **别名（151b0267）**：上线后别名表写进 6 条 `tsk` 别名（demo 等开发工作区与失败保留中的旧会话），按旧 ID 能找回记录；其余带旧身份的是执行环境（没有旧任务 ID）或已释放的记录。
- Git 凭据 Secret 带凭据、按服务共用，设计里没有对应种类，本期不动（随 I25）。


## 12. 2026-09-27 接手：T13 集群项目拓扑与开发摘要

接手基线 `1fbbde8d9b6b11f48db9e82631307959758286c4`，已 fetch 核对本地与远端一致；基线 CI [35978999719](https://github.com/wangbinquan/CrewStation/actions/runs/35978999719) 成功。本机实际四个控制面为 `cs-control-plane:rc025-t14c-20260924`，工作台为 `cs-console:app-access-2-20260924`，均 1/1；不把 STATE 中较早的 t8b 标签当当前部署。既有未提交的 `tests/e2e/referenceResources.test.ts` 保持原样，不属于本批。

本批实现（本地门禁通过，发布与部署证据接续记录）：

- 集群拓扑展开项目后读取管理员全平台资源快照与一条共享 SSE，按项目过滤记录；CLI／工作区节点跟随标准阶段变化。集群采集仍提供系统组件、Pod 细节与历史容量（I29）。资源流与项目流缓存隔离，reset 后重读正确的全平台快照并续传。
- `capabilities` 开发摘要保留原会话身份、分支与时间，阶段、原因、Runner 连接事实改读资源中心；缺失或错归属的记录返回未知，台账不可用不回退旧 running。返回标准 `phase`，旧 `state` 仅作为兼容映射；服务槽和健康来源沿用此前已经接入台账的公开接口。
- 集群项目拓扑新增回归在旧代码失败（应显示的 CLI 节点缺席）；摘要的两个回归在旧代码失败（错误地仍报 running、台账缺失仍报 ready）。实现后定向 28 pass / 0 fail；静态门禁通过，unit 713/0、module 1380 pass / 7 skip / 0 fail、console 902/0；新增可执行行 52/52（100%）被覆盖。模块维护用例原先固定 09-23 时钟与数据库时间错位，两条失败已通过对齐测试时钟修复，未改变生产保留期；先定向 22/0，再完整重验模块层通过。部署证据接续记录。
- I27 作者选择 (a)：归档后保留命名空间、额度与网络策略，工作卷与其他资源清完后由管理员删除。裁定已记录；管理员删除命名空间入口尚未实现。

边界：此批不代表 T13 或 RFC 全部完成。集群项目层的容量统计仍按采集快照；开发预览路由统一、失败会话重建移交、轮换、归档清理入口、限流校准和最终 RC 清单仍需后续实现或验收。


### 12.1 已发布与本机验收

- 提交 `ee032c95755294e0ebd654393f739d1f291a91c4` 已推 main，本地和 origin/main 完全一致；[精确 SHA CI](https://github.com/wangbinquan/CrewStation/actions/runs/36258625492) 六项均成功（含 gate 与 e2e，09-26 17:27Z 终态）。
- 从 `git archive ee032c95` 构建，09-26 17:20Z 左右只更新 cs-api 与 console，均为 `rc025-t13b-ee032c95`、1/1；cs-api 启动日志无错误。其余控制面保持 `rc025-t14c-20260924`。
- 09-26 17:21:50Z 正常开发角色登录取得管理员身份，经 `/v1/admin/resources` 读到 160 条记录、游标 602638。3 个开发工作区（demo、rfc003-ux、rfc003-verify-workbench）与 `/v1/workbench/project-summaries/:projectId` 逐项核对，均 `phase=ready`、`RunnerConnected=true`，摘要 `phase=ready`、`connected=true`；身份、分支与创建时间保留。
- 重新加载已部署 Console，管理员集群拓扑展开 demo：工作区节点「运行中」，待验证入口为「已结束 · 已由成员手动下线」，与台账一致；项目开发列表的三条活跃会话均「会话运行中／已连接」，过期会话对应项目为「尚无开发会话」。此次只读验收未创建或结束真实 CLI，阶段切换与流 reset 由新增回归锁住，不将静态页面冒充 RC-02 双窗口结束验收。

### 12.2 接手时补核 T14 遗留对象

基线 `1fbbde8d` 已实现 Secret 孤儿回收，但旧计划未回填。本机现运行 `rc025-t14c-20260924`，09-27 只读核对（只读 Secret 元数据，不读内容）：全集群已没有 `git-cred-*` 或 `git-checkout-*`；任务 Runner Secret 仅剩 3 个，分别属于 demo、rfc003-ux、rfc003-verify-workbench 的当前工作区。不能从当前缺席反推每个历史 Secret 的准确删除时间。

`cs-rfc006-verify` 的旧失败 Pod 与开发预览 Service／IngressRoute 已消失；旧工作卷 `task-01a0bc96ee15-work` 留在，资源记录为 stopped／retention-expired。`cs-rfc022-verify` 的两只旧卷也保留 Bound，记录均为 stopped／retention-expired。全平台 21 条工作卷记录中，5 条为失败到期后保留，3 条为 orphaned；8 个待回收现场均未执行删除。其余为当前在用或已释放且无子对象的记录。

## 13. 2026-09-27 T15：三类流量的本机突发校准

保持现有策略 revision=0，没有修改默认值或项目覆盖。按正常开发角色登录获取管理员会话（不输出 Cookie），平台和用户域经本机真实 Traefik；服务域从 cs-api Pod 经 Traefik 发出，Host 为 `demo.svc.cs.internal`。只用读取接口与演示服务健康接口，未修改业务数据。时间为 09-26 17:23Z（本地 09-27）。

| 流量 | 突发结果 | 耗时／P95 | 等 3 秒后的恢复 |
|---|---|---|---|
| 平台 `/v1/me`，80 个并发请求 | 38×200；39×429 带 `Retry-After: 1`；3×429 不带此头（并发上限） | 101 ms／97 ms | 10/10 为 200 |
| 用户域 `demo.cs.localhost/healthz`，100 个并发请求 | 60×200；40×429，均 `Retry-After: 1` | 145 ms／143 ms | 20/20 为 200 |
| 服务域 `demo.svc.cs.internal/healthz`，130 个并发请求 | 105×200；25×429，均 `Retry-After: 1` | 125 ms／95 ms | 60/60 为 200 |

服务域在请求窗口内有令牌补回，105 个成功不等于 burst 被改为 105。测试前打开一条管理员资源 SSE；整个突发与恢复期间连接保持 HTTP 200、未结束，收到 2 块数据（含后续心跳），约 180 KB；说明资源 SSE 没被平台 API 的同时处理上限占用或切断。尚未把 WebSocket 并发保持、匿名 IP、多个用户／来源叠加到项目／目标合计上限当作已实测。

结论：现值的三种单身份突发限制、429 头与恢复均有本机证据；本轮结果不是吞吐容量上限或生产流量容量证明。按提案 Q4／T15，已把现值报作者最终确认；未登录 `/auth` 按 IP 的默认值另询问，裁定前不改变登录入口行为。Q4 未裁定前 T15 不标完成。
