# RFC-023 验收记录

> 2026-09-23：DB-01…DB-07 通过（逐项见 §3），DB-08 的 72 小时观察从 11:16Z 开始，到 09-26 11:16Z 结束，结束后补写并把 RFC 置 Done。突发复现：旧驱动 6 轮每轮都错位、被探针重启，新驱动 6 轮 0 错位、0 重启（§2）。

## 1. 环境

- 本机 docker-desktop 集群，网络插件是 Calico（09-23 由 kindnet 迁移），命名空间 `crewstation-system`。
- 旧驱动镜像 `cs-control-plane:podgrace-20260923`（git archive e334544，Bun 1.3.13 内置 SQL）。
- 新驱动镜像 `cs-control-plane:pgjs-20260923`（git archive e34bdeb，postgres.js 3.4.9）。
- 突发复现只打复制出来的 `cs-api-burst`：同镜像、同配置，但换了标签，不在 cs-api 的 Service 后面，不接真实流量；真实的 cs-api 不动。
  - 客户端在同一命名空间的 `cs-burst-client` Pod 里，身份是 dev-developer。
  - 只读接口共 13 个：`/v1/me`、项目、会话、档位、能力、成员、名册、活动、数据绑定、发布、槽、工作区布局等。
  - 只打验收项目 `rfc022-verify` 和它的 main 会话。

## 2. 突发复现（T1、DB-02）

每轮的做法：删掉 `cs-api-burst` 的 Pod；新进程一开始监听，就用 60 并发发出 300 个请求；接着持续 45 秒，20 个 worker、每次间隔 100 毫秒。每轮之后统计：
- 容器重启次数；
- 当前与上一个容器日志里的 I16 特征行（`ERR_POSTGRES`、`JSON Parse error`、`Failed to read data`、`INVALID_MESSAGE`、`UNSUPPORTED_INTEGER`、`must be called before any query`、`PostgresError`）。

| 驱动 | 轮次 | I16 特征行 | 探针重启 | 请求结果 |
|---|---|---|---|---|
| Bun 内置 SQL（`podgrace-20260923`） | 6 | 102（每轮 0–35） | 6（每轮 1 次） | 每轮只有 56–414 个 2xx；其余是连接被关、连不上（进程在重启）与超时 |
| postgres.js（`pgjs-20260923`） | 6 | 0 | 0 | 50,579 个请求全部 2xx（每轮 8253–8532 个） |

- 旧驱动 10:54–11:04Z，新驱动 11:05–11:10Z。原始记录在执行会话的草稿目录，这里只摘数字。
- 旧驱动的错误和线上 I16 一致：`Failed to read data`、`ERR_POSTGRES_INVALID_MESSAGE` 等。第 3 轮日志里没有特征行，但同样被探针重启、只有 56 个请求成功；原因没有细查，可能是错误没来得及写出，也可能只是连接池被占满。
- 客户端第一版在持续阶段不限速，已中止（§4 第 3 条）。那两轮在旧驱动上同样每轮重启、各有 3 行和 13 行特征报错。
- 另一条旧驱动的证据来自并行会话（crewstation-90）：10:52:19Z 作者在 demo 开发页的一次 `PUT /v1/tasks/…/workspace-layout`，在 Bun 驱动的 cs-api 里挂了 490 秒，Traefik 记为 499。处理函数只是鉴权、读一张表加一条乐观锁 UPDATE，没有报错日志，事后 `pg_stat_activity` 也没有长事务或锁等待。

## 3. 逐项结果

| 编号 | 结果 | 证据 |
|---|---|---|
| DB-01 | 通过 | 导出树门禁 2401 pass／87 skip／0 fail；模块与包的用例在新驱动上 1134 pass／4 skip／0 fail。e34bdeb 的精确 SHA CI [35851282033](https://github.com/wangbinquan/CrewStation/actions/runs/35851282033) 六项成功，其中 e2e 在 CI 里用新驱动完整装了一套平台 |
| DB-02 | 通过 | §2 |
| DB-03 | 通过 | 11:10Z 在新驱动的 `cs-api-burst` 里，用真实配置 `CS_DATABASE_URL` 经 `connectDatabase` 建连接，`show idle_in_transaction_session_timeout` 为 `1min`。连接串自带 `options` 时按连接串（用例） |
| DB-04 | 通过 | 11:11Z 把 `cs-api-burst` 的数据库地址指向不可达的 10.255.255.1：进程照常起来，`/healthz` 在 3005 毫秒返回 503，Pod 一直不就绪 |
| DB-05 | 通过 | 11:19–11:20Z：dev-admin 为 dev-developer 新建 `rfc023-verify`，建出 `cs_rfc023_verify`、`cs_rfc023_verify_dev` 两个库和角色。开会话、申请 `diagnostic-readonly`（5 分钟）并批准，建出临时角色 `cs_t_…`（VALID UNTIL 11:24:33）；负责人收回后角色删除，库的属主不变。核对中发现到期的绑定没人收（§4 第 4 条） |
| DB-06 | 通过 | 11:18Z 用新镜像跑迁移 Job `crewstation-migrate-rfc023`：`migrations done, applied 0`。从空库应用全部迁移，由测试库（每个用例文件建新库）和 CI e2e 的全新安装覆盖 |
| DB-07 | 通过 | 删掉新驱动的 `cs-api-burst` 前它有 10 条连接，终止后是 0；正式部署时，七个旧 Pod 终止后在 `pg_stat_activity` 里都是 0 条连接 |
| DB-08 | 观察中 | 11:14:03Z 其余六个部署、11:15:56Z cs-api 换成 `pgjs-20260923`，11:16Z 开始 72 小时，到 09-26 11:16Z 结束 |

## 4. 实施中发现的问题

| # | 现象 | 处理 |
|---|---|---|
| 1 | 换驱动后，模块与包的用例 182 个一起红：`The "string" argument must be of type string … Received an instance of Object／Date`。drizzle 的 postgres-js 驱动把时间类和 json 的序列化器换成原样透传，原生 `sql` 模板里直接传的 `Date` 与对象被驱动拒绝 | e34bdeb：domain_events 与 jobs 的 payload 改为 `JSON.stringify(…)::text::jsonb`，jobs 的 `runAt` 与 oidc_flows 清理的时间改为 `toISOString()::timestamptz`。其余 40 处原生 `execute` 逐个核对过，参数都是字符串或数字。dev-gotchas 新增一条 |
| 2 | 原生 `execute` 返回 postgres.js 的 `RowList`，带 count、command 等属性。六个测试文件直接 `toEqual(普通数组)`，类型报错，比较也不会相等 | e34bdeb：先展开成数组再比较 |
| 3 | 突发复现的第一版客户端在持续阶段不限速：进程出错后 5xx 回得很快，一轮发出上百万个请求，远超真实负载 | 中止重跑：持续阶段每个 worker 请求间隔 100 毫秒，连不上时退避 500 毫秒。第一版的两轮只作参考，见 §2 |
| 4 | DB-05 核对中发现：`expireBindings`（把到期绑定标成已过期、删掉临时角色）没有接到任何后台任务，到期的绑定一直显示生效中，临时角色留在库里（数据库按 VALID UNTIL 拒绝它登录）。与换驱动无关，是既有的接线遗漏 | 7d12f70：数据模块加每分钟一次的后台任务，由 cs-controller 运行，用例覆盖到期回收。11:30Z 部署后实机核对：5 分钟的只读绑定 11:36:36 到期，11:37:06 已标成已过期、临时角色已删除。会话释放时要不要立即收回：作者 2026-09-23 裁定「要，直接释放，因为已经有了弹窗提示了」，60ef91b2：数据模块订阅「任务已释放」事件，收回该任务还没结束的绑定（Design §9.8 补一句）。12:13Z 部署后实机核对：rfc023-verify 上 30 分钟的只读绑定，释放会话后 1.2 秒即记为已收回、临时角色已删除 |

## 5. 部署

- 11:13:54–11:14:03Z：cs-auth、cs-controller、cs-events、cs-session、mcp-capabilities、mcp-operations 换成 `cs-control-plane:pgjs-20260923`，观察一分钟，都是 0 次重启、0 行报错。
- 11:15:24–11:15:56Z：cs-api 换成同一镜像，观察两分钟，0 次重启、0 行报错。
- 事先通知了并行会话，突发复现期间他们不做实机核对。复现用的 `cs-api-burst` 与 `cs-burst-client` 已删除，为复现开的 rfc022-verify 会话已释放。
- 11:30:02Z 只把 cs-controller 换成 `cs-control-plane:pgjs-20260923b`（git archive 7d12f70，驱动相同，只多了到期绑定的后台任务），观察一分钟，0 次重启、0 行报错。这是计划内的滚动，不计入 DB-08 的重启。
- 12:13:33Z 只把 cs-controller 换成 `cs-control-plane:pgjs-20260923c`（git archive 59000143，多了 60ef91b2），新的事件消费者 `data` 当即追到最新事件，0 次重启、0 行报错。
- 观察期内，并行会话对 cs-api 做过几次计划内滚动，镜像都在 e34bdeb 之后构建、仍是 postgres.js，不计入 DB-08：11:51:38Z `iface-20260923`、11:59:18Z `repo-weburl-20260923`、12:03:59Z `ops-tabs-20260923`、12:11:50Z `settings-trim-20260923`。
- 观察的局限：Pod 换得勤，旧 Pod 的日志与事件会随之消失。DB-08 结束时的依据是：当时各 Pod 的重启次数与日志、各部署的 ReplicaSet 历史（区分计划内滚动）、Traefik 访问日志里的 5xx 突发，以及并行会话报来的异常。
- 验收项目 `rfc023-verify` 保留，供作者查看。
