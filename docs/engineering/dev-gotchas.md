# 踩坑记录

> 跨 RFC 的**通用**踩坑与命令级 tips。动手前扫一遍，踩到新的通用坑也补进来。
> RFC 专属的细节留在各自的 RFC 目录里，不进本文。
> 每条都写清**是怎么撞上的**与**判据**，让读者能自行复核，而不是记一句结论。

## 目录

- [工具链与依赖](#工具链与依赖)
- [Drizzle 与 Bun SQL](#drizzle-与-bun-sql)
- [Kubernetes 与本机集群](#kubernetes-与本机集群)
- [GitLab](#gitlab)
- [进程与终端](#进程与终端)
- [WebSocket](#websocket)
- [契约变更](#契约变更)
- [前端与测试](#前端与测试)
- [用例与 CI](#用例与-ci)
- [并发开发与 Agent 协作](#并发开发与-agent-协作)

## 工具链与依赖

### typescript-eslint 不支持 TS 7.0，TypeScript 必须锁在 6

`typescript-eslint@8.70` 遇到 TypeScript 7 直接报 `does not support TS 7.0` 并整轮 lint 红。
根 `package.json` 的 `typescript` 锁 `6`，升级前先确认 typescript-eslint 的支持矩阵。

### 删掉一个工作区包之后，本机照绿而 CI 在装依赖这一步就全红

`bun.lock` 记着每个工作区包。删模块时改完 `package.json` 的依赖行还不够——**必须再跑一次 `bun install` 并把锁文件一起提交**。
本机的 `bun install` 会顺手修好锁文件，所以本地门禁一路绿；CI 的 setup 用的是 `bun install --frozen-lockfile`，
于是停在 `error: lockfile had changes, but lockfile is frozen`，**五个作业一个不剩全红**，而日志里看不到任何跟你改动有关的字样。

看到「全部作业都失败」先去看最早那个作业的 setup 步骤，不要从用例错误往回找。
本机要复现只需带上同一个开关：`bun install --frozen-lockfile`。2026-09-22 RFC-018 删 `modules/egress` 时实撞。

### `bun install --production=false` 不是合法参数

控制面镜像最初写了这一条，构建当场 `exit code 1`。Bun 没有这个开关，装全量依赖就是**不带任何参数**的 `bun install`。

### 基础镜像里没有的东西，要自己装

`oven/bun:1.3.13` **不带 git**。cs-controller 建仓时以子进程调用 git，于是开通链停在
`Executable not found in $PATH: "git"`。凡是以子进程调用外部命令的，都要回头确认镜像里真的有它
（本仓已踩过 git；`setsid` / `setpriv` 来自 util-linux，任务镜像里显式装了）。

### OpenCode Zen 免费档拒绝没有 bash 工具的请求（403 FreeTierError）

2026-09-18 实测：`opencode run` 用 `opencode/big-pickle` 时，只要 agent 的权限表把 `bash` 设成 `deny`（平台的 read-only 与 edit 两档都是），
服务端就答 `403 … OpenCode's free tier can only be used from within OpenCode`（`FreeTierError`），其余 deny（edit、webfetch）不影响。
错误只出现在 stdout 的 `{"type":"error",…}` 那一行里，归一后的事件文案只剩「运行时报告错误」。所以：档位测试按 agent-workflow 冒烟取全放行；
本机只有这个免费模型时，read-only／edit 的 Agent（包括最小示例的 `chat-v1`）真实轮次会被拒，这是模型服务的限制，不是平台故障。

### 两个 Agent CLI 的安装器只写 root 家目录

`claude` 与 `opencode` 的官方安装器把二进制放进 root 的家目录，uid 10001 的 worker 进不去。
任务镜像装完必须把它们挪到 `/usr/local/bin`，并**以 worker 身份实跑一次 `--version` 验证**。

## Drizzle 与 Bun SQL

### jsonb 列会被存成 JSON 字符串

drizzle 的 `jsonb()` 配 Bun 的 SQL 驱动时，写进去的是一个 **JSON 字符串**而不是 jsonb 对象，
读出来是字符串，`->>` 之类的查询全部失效。本仓的解法是 `packages/persistence/jsonDocument.ts`：

```ts
toDriver: (value) => sql`${JSON.stringify(value)}::text::jsonb`,
fromDriver: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
```

**所有模块的 jsonb 列一律用 `jsonDocument`**，不要直接用 `jsonb()`。

### `= ANY(${array}::text[])` 会报 malformed array literal

参数化数组传不进去。改成把每个元素单独参数化再拼：

```ts
sql`kind = ANY(ARRAY[${sql.join(kinds.map((k) => sql`${k}`), sql`, `)}]::text[])`
```

### 删角色前要先处理它拥有的对象

`DROP ROLE` 遇到该角色拥有的对象会报 `cannot be dropped because some objects depend on it`。
必须先**在目标库里**跑 `REASSIGN OWNED` / `DROP OWNED` 再删——注意是「在目标库里」，
连着别的库跑不算数（`modules/data` 的 `dropRole` 就是为此带上 `databaseName` 的）。

### 咨询锁排队会把整个连接池拖死：写锁只 try 不等，读取不取锁，服务端限制事务内空闲

2026-09-16 实撞：cs-api 一条事务取得 `pg_advisory_xact_lock('dev_session.native_activity', task)` 后停在 idle in transaction 八分钟
（最后一条语句竟是 `identity.users` 的读取——说明这条连接带着未结束的事务回到了池子里，原因未复现）；其余九条连接全部排在这把锁后面，
池子 `max: 10` 耗尽，`/v1/me` 也 502，工作台每页都停在“载入中”。Pod 仍 Running、健康检查仍 200，只有 `pg_stat_activity`
（`state`、`wait_event`、`pg_blocking_pids`）能看出来。

三层处理，缺一不可：写事务用 `pg_try_advisory_xact_lock` 每 100ms 轮询、最多 1.5s，拿不到就正常提交并在事务外抛 `precondition`
（第一版用 `set local lock_timeout` 让锁语句报错，集群里随即出现无关查询撞上 “current transaction is aborted”——事务里不要制造
服务端错误）；读取改用 `repeatable read` 只读事务，不再取锁；`connectDatabase` 给连接串补
`options=-c idle_in_transaction_session_timeout=60000`（Bun SQL 会把 libpq 的 `options` 交给服务端，`show` 返回 `1min`），
持锁空闲的事务 60s 内被服务端终止。回归见 `modules/dev-session/tests/nativeActivityPersistence.test.ts` 与
`packages/persistence/connection.test.ts`；本机 10 连接／60 并发混合失败事务的压测，四种模式结束后池子全部 idle、无残留咨询锁。

**任何 `pg_advisory_xact_lock` 都要问：等待有没有上限、读路径是不是也在排队。** 顺带：Bun SQL 里 `= any(${array}::int[])`
传数组参数会报 `insufficient data left in message`（08P01），和上面“malformed array literal”是同一个坑。

### 池子卡死但服务端一切空闲：健康检查必须走同一个连接池

2026-09-16 第三次 cs-api 卡死（07:25Z）与第一次不同：`pg_stat_activity` 里十条连接全部 idle、没有锁，CPU 五秒只用 16ms，
容器内 `/healthz` 200、无 cookie 的 `/v1/me` 401 都是 4ms，但任何要查库的请求都挂到 Bun 服务器 10s `idleTimeout` 后被网关 502。
这是数据库**客户端**（Bun SQL 池）认为连接都在忙；服务端和进程指标都看不出来，原来的 `/healthz` 也看不出来。

处理：`createApp({ readiness: () => databaseReady(db) })`——`/healthz` 走同一连接池做 `select 1`，3s 内无回应即 503；
五份清单的探针补 `timeoutSeconds: 5`（默认 1s，慢查询会误判）。同类卡死 15s 内 NotReady、约 45s 由 liveness 重启。
排查顺序：先 `curl` 带身份的 `/v1/me` 计时，再看 `pg_stat_activity` 是不是全 idle，再进容器打 `/healthz`——三者都“正常”而外部 502，就是这个坑。
触发条件未复现（本机八种事务形态压测阴性），运行时／驱动的取舍见 `implementation-open-questions.md` I16。
**重启前先把 `kubectl logs` 存下来**：Recreate 会把旧 Pod 连日志一起删掉，第三次的现场就这样丢了。

## Kubernetes 与本机集群

### 反复导入镜像会把 docker-desktop 的 118G 磁盘填满，先崩的是 PostgreSQL

`install-platform.sh` 每次把四个镜像 `docker save | ctr import` 到节点，旧标签（`cs-console:rfc003-*` 等几十个）一直留在 containerd，
加上宿主侧的构建缓存与悬空镜像，2026-09-16 一次导入后节点 `/` 100%，`postgres-0` 报 `could not write lock file "postmaster.pid": No space left on device`，
迁移 Job 连续 `Connection closed`。判据：`docker exec desktop-control-plane df -h /`、`crictl images` 里成片的 `<none>` 与 `import-*`。
清理只碰可再生内容：`docker builder prune -af`、`docker image prune -f`、`ctr -n k8s.io images rm` 未被任何 Pod 引用的旧 `cs-*` 标签、`crictl rmi` 悬空引用；
不要 prune 卷（GitLab、测试库都在卷里），也不要删别的项目的镜像。部署前先看磁盘。
2026-09-18 RFC-006 实机验收时复发：一小时内连跑六次 `install-platform.sh`（每次都重导四个镜像，任务镜像约 1 GB），`/` 从 95% 到 100%，
`postgres-0` 同样起不来（崩溃恢复本身没问题，腾出空间后自动恢复）。只改了控制面代码时不要跑整套安装：`docker build` 控制面镜像 →
`docker save | ctr import` 只导这一个 → `rollout restart` 七个平台部署 → `docker image prune -f` → `crictl rmi` 被取代的旧镜像；磁盘持平。

### 节点 CPU 预约 10／10 时滚动更新排不进新 Pod

控制面每个部署请求 100m，RollingUpdate 默认先起新再停旧，节点满额时新 Pod 一直 Pending，`rollout status` 超时。
两种做法都用过：单副本服务改 `strategy: Recreate`（console 先改，2026-09-16 cs-api 卡死后 `rollout restart` 的新 Pod Pending 了六分钟，七个平台部署的清单全部写回 Recreate）；发布构建 Job 的 Pod 请求 1 CPU，节点占满时它会一直 Pending、发布停在“正在构建”（2026-09-16 v0.1.2 等了 11 分钟，缩四个 CLI Pod 到 150m 后 20 秒内完成）；新版本的 Deployment 按部署时的套餐请求 CPU（v0.1.2 的 preview Pod 500m，正式槽 50m），随后 cs-api／console 的 Recreate 又因此 Pending 10 分钟——重建平台镜像前先看 `kubectl describe node` 的 cpu 请求余量；或临时把闲置 CLI Pod 原地缩到 150m 再恢复——
`kubectl patch pod … --subresource resize`，requests 与 limits 要一起改，否则 Guaranteed QoS 变化会被拒绝；容器名等于 Pod 名。
构建 Job 有截止时间：一直排不进去时约 30 分钟后发布记为「构建失败：Job was active longer than specified deadline」（2026-09-18 首次发布即如此），
要重新发布而不是等它自己恢复。缩别的会话或项目的 Pod 之前先征得它的所有者同意。


### kubelet 1.36 可能坚持重拉本机导入的镜像：任务父容器改用平台仓库里的底座

本机的平台镜像都是 `docker save | ctr import` 进节点的，Pod 用 `IfNotPresent` 引用本地标签。kubelet 1.36 会在
`/var/lib/kubelet/image_manager/pulling` 记下拉取意图：某次拉取失败过（2026-09-18 磁盘写满、导入被打断时新建的开发会话就撞上了），
之后即使镜像已经在 containerd 里、`ctr images check` 显示完整，kubelet 仍要求重新拉取来校验，而 `docker.io/library/cs-task-runtime:dev`
根本不在任何仓库里，于是 `ImagePullBackOff`（`pull access denied … insufficient_scope`）一直不消失。不要去改 kubelet 的状态文件：
`CS_TASK_IMAGE` 改指 `publish-base-image.sh` 推进集群内仓库的同一底座（摘要相同），脚本同时在节点上给这个名字打标签，
平时 `IfNotPresent` 直接命中，kubelet 要重拉时也拉得到。

### `.dockerignore` 会静默吃掉构建需要的目录

控制面镜像的 `.dockerignore` 排除了 `templates`，于是开通链停在「模板 minimal-sample 不存在」，
而镜像构建是绿的。**改完 Dockerfile 后进容器 `ls` 一眼**，别只看构建成功。

### Secret 的键名要对着看，不要猜

安装脚本最初从 `postgres-credentials` 里取 `POSTGRES_PASSWORD`，而那个 Secret 暴露的是 `url`，
迁移 Job 于是 `password authentication failed`。取 Secret 前先 `kubectl get secret -o jsonpath='{.data}'` 看键名。

### 任务容器镜像「有就不重建」会让改动到不了集群

`deploy/local/install-platform.sh` 曾经写成「`docker images -q cs-task-runtime:dev` 非空就跳过构建」。
改了 `runtimes/task` 之后集群里跑的还是旧镜像，现象是事件里少一个字段而代码看着完全正确——
从契约查到适配器再查到运行时，绕了一整圈才想起镜像。现在默认重建，要跳过用 `SKIP_TASK_RUNTIME_BUILD=1`。

**凡是「为了快而跳过构建」的条件，都要能在报告里看出它跳过了。**

### 改了哪个模块，就要重启读它的那些进程

放行表的判定逻辑在 `modules/gateway`，但**执行判定的是 cs-auth**（ForwardAuth）。
只重启 cs-api 与 cs-controller，403 照旧。**先想清楚这段代码跑在哪个进程里**，再决定重启谁。

同一个 ConfigMap 开关往往被**多个进程**读，只重启一个会让界面与实际各说各话。
2026-09-18 实撞：`CS_PASSWORD_LOGIN=force-on`（RFC-005 的破窗口）只重启 cs-auth 后，登录页照收密码，
而管理面的认证页由 cs-api 应答、它的 `forcedOn` 还是 `false`，于是卡片写着「已关闭」、还给出一个按下去必然 409 的开关。
改这类开关前先 `grep` 一遍谁读它（`packages/settings` 的字段名最好找），把读它的进程一起重启，运维文档也要写全。

### 开发登录器不该反过来依赖平台登录（本机，2026-09-22 实撞，当天已治本）

`crewstation-dev-auth`（本机 dev-oidc 登录器）跑的是 `cs-control-plane` 同一个镜像，按标签批量 `kubectl set image` 滚控制面时它也会被重建。
当时这一滚把本机登录整条锁死了，**因为它把三件事绑成了一件**：

1. 启动时先用管理员**密码**登录平台播种角色，而库内策略 `password_login_enabled` 自 2026-09-20 起是关的；
2. `routePrefix` 与客户端口令都是**每次进程启动现摇**的，而写回平台的 `ensureProvider` 排在密码登录之后——
   于是库里 `identity.oidc_providers` 那条 `dev-roles` 的 `issuer_url` 指向上一个已死 Pod 的前缀，`/auth/oidc/dev-roles/start` 直接 503 `endpoints-unresolved`；
3. `/readyz` 绑在播种结果上，于是 Pod 不 Ready。

第 3 条还带出一个单独的坑：清单里那句 `publishNotReadyAddresses: true`（写着是为了避免 readiness 自锁）**在 Traefik 3.7 上本就不管用**：
它只把 EndpointSlice 的 `ready` 抬成 true，`serving` 仍是 false，而 Traefik 按 `serving` 过滤，日志里是
`no servers found for crewstation-system/crewstation-dev-auth`，整条 router 被丢掉——现象是 **404 而不是 503**，连那个写着「重新准备」按钮的页面都打不开。
**判据**：网关对某个 Service 404 而 Endpoints 看着有地址时，先 `kubectl get endpointslice -o yaml` 看 `conditions.serving`，别去查 IngressRoute。

**已治本**（四条一起）：`CS_DEV_AUTH_ROUTE_ID` 与 `CS_DEV_AUTH_CLIENT_SECRET` 改由 `install-dev-auth.sh` 一次生成、写进
`crewstation-dev-auth` Secret 并跨重装沿用，库里那条 Provider 因此能活过重启；`/readyz` 只看端口，播种状态改看 `/` 与 `/status.json`；
Service 不再依赖 `publishNotReadyAddresses`；**管理员会话优先走 dev-auth 自己的 OIDC**，密码登录只作首次注册与漂移时的回落。
实测：密码登录关闭时冷启动仍能播种到 `ready`，滚镜像后登录与「一键换角色」都自愈。

**固定前缀带来的第二个竞态**：issuer 不再变，cs-auth 的 Provider／JWKS 缓存就会活过 dev-auth 重启，而新进程换了签名 kid，
首轮播种会撞 `/start` 503（旧 issuer）或 `/callback` 400（旧公钥），几十秒后自行收敛。播种失败已自动重试 5 轮兜住它，
日志里每一轮都记原因；看到这两条别当成配置错了。

剩下的注意：**换了那两个 Secret 字段（或重建了这个 Secret）就等于作废库里的 Provider**，而重新注册要密码登录；
`install-dev-auth.sh` 已经会先读旧值，别绕过它直接 `kubectl create secret`。只有这种情况（以及全新安装、固定账户被降权）
才需要上面那条破窗口（`CS_PASSWORD_LOGIN=force-on` → 重启 cs-auth 与 cs-api → `install-dev-auth.sh` → 去掉开关再重启两个服务），
这一步要作者授权。日常重启、滚镜像都不再需要它。

### 按任务建的资源，路由也要按任务建

开发预览的目标 Service 是随任务 Pod 建的，放进 gateway 的「按服务重算路由」里对不上生命周期。
这类资源的 IngressRoute 要**随 Pod 建、随 Pod 删**（`modules/task-runtime/adapters/k8s/taskCluster.ts`）。

### Pod 连 Service ClusterIP 不通，直连 Pod IP 正常（本机 kind，2026-09-22 起）

同一个 Pod 里做对照就能分辨：Traefik 的 ClusterIP `10.96.199.52:80` 连不上（`Unable to connect`），
它的 Pod IP `:8000` 返回 200。DNS 是好的——`api.svc.cs.internal` 正确解析到那个 ClusterIP，
坏的是 kube-proxy 的 VIP 转换。同一现象还表现为 cs-api 连不上 Prometheus、e2e 的 `clusterMetrics`
历史新鲜度时红时绿。注意它**不是**全面失效：cs-api 经 Service 名连 PostgreSQL 一直正常。

**判据**：实机验证里出现「网关／某个平台服务连不上」，先在同一个 Pod 内用 Pod IP 对照一次，
再去查网络策略或平台代码。策略是放行的（`crewstation-default` 允许到 `crewstation-system`），查策略会白费时间。

**绕过办法**：验证时用目标的 Pod IP 加 `Host:` 头发起，例如
`fetch('http://<traefik-pod-ip>:8000/api/<proxy>/...', { headers: { host: 'api.svc.cs.internal' } })`。
这样绕过的只是 VIP 转换，网关路由、源 Pod IP 身份解析、放行表判定都照常经过。

### 项目命名空间的出站由标签决定，不同负载看到的网络不一样

一个项目命名空间里有三到四条 NetworkPolicy，取并集生效，所以「这个 Pod 能不能出站」要看它的标签：

| 负载 | 策略 | 出向 |
|---|---|---|
| 默认（含数字人服务槽） | `crewstation-default` | 只到 DNS 与 `crewstation-system` |
| `workload=dev-session`／`business-task` | `crewstation-task-egress` | 全放行 |
| `component=build` | `crewstation-build-egress` | 全放行 |
| `workload=service`，且项目是 `APIProxy`／`EventProducer` | `crewstation-integration-egress` | 全放行（RFC-018） |

因此同一个命名空间里，开发容器连得上 `host.docker.internal:8929`，数字人服务槽连不上——这不是代理或业务代码的 bug。
接入容器项目自 RFC-018 起有自己的放行策略；数字人服务槽访问公司系统要经接口目录与网关放行表。

**策略形状变了，存量命名空间不会自己跟上。** 开通链只在建项目时跑过一次，所以 `packages/k8s/objects/cluster.ts` 里改了策略之后，
要靠 cs-controller 启动时的命名空间重下发（`modules/provisioning/workers/namespaceReapply.ts`）把新形状铺到已有项目上。
换过版没见到新策略，先看 cs-controller 日志里的 `namespace reapply done`。

## GitLab

### 刚签发的项目访问令牌偶尔还没在 Git HTTP 认证路径上生效

构建 Job 克隆时会以 `HTTP Basic: Access denied` 失败，而几分钟后同一个 Secret 里的同一个令牌
手工克隆是好的。**克隆要退避重试**（本仓重试三次），不要把它当配置错误去查。

### 分支列表有约 30 秒的响应缓存

推送后立刻查分支列表，看到的还是旧 HEAD。集成测试里要么等，要么改用别的接口取 HEAD。

### 全局 git 配置会静默劫持认证

宿主机 `~/.gitconfig` 里针对测试 GitLab 的 `credential.*.username` 会让脚本里的令牌失效。
在脚本里跑 git 时用 `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` 隔离。

### 克隆完把远端地址改回不带令牌的形式

否则令牌会留在 `.git/config` 里，容器内 `git remote -v` 就能看到。

## 进程与终端

### 首次状态握手不能套用运行中的心跳超时

2026-09-20 实测：OpenCode 1.18.29 在 150m CPU 的 CLI Pod 中冷启动，03:20:30Z 建立观测通道，
03:20:50Z 就被 20 秒心跳租约永久降级；CLI 到 03:20:53Z 才开始创建实例，随后才加载配置和插件。
GLM-5.2 已正常回复，页面仍显示「轮次状态未确认」，原因是正常冷启动被当成了观测链失联。

`nativeActivityChannel.ts` 将首次 `ready` 的等待上限独立为 120 秒；握手后仍按 20 秒检测心跳。
首次握手超时、序号缺口及已连接后的失联仍永久降级，不能用迟到的 `ready` 掩盖可能丢失的轮次事件。
回归用例先让初始化超过心跳周期，再断言握手成功、后续失联正常降级；另测首次握手确实有独立上限。

### 降权后的 shell 没有控制终端就没有作业控制

`setpriv` 只换身份、不建新会话。PTY 不是 shell 的控制终端时，bash 每次都先打印
`cannot set terminal process group` 与 `no job control in this shell`，Ctrl+C 与 fg/bg 都不工作。
终端子进程前面要加 `setsid --wait --ctty`。

**`--wait` 是必需的**：没有它 setsid 立刻退出，`Subprocess.exited` 会在 shell 还活着时就 resolve，
终端的生命周期就跟丢了。

### `mkdirSync(recursive, { mode })` 会把权限刷到每一级

想让叶子目录 0700，写成 `mkdirSync(leaf, { recursive: true, mode: 0o700 })` 会把**沿途每一级**
都创建成 0700，父目录于是只有 root 能进，降权后的子进程连自己的运行目录都进不去。
父级用默认权限建，只对叶子 `chmod` + `chown`。

## WebSocket

### 握手是异步的，握手期间到达的帧会被当成第二个握手

cs-session 的 `onHello` 要查令牌、读 maxSeq、抢注册表，全是 await。期间到达的帧因为
`connection` 还没赋值而走了 hello 分支，于是以 1008「首帧必须是 hello」断开。
TaskRunner 收到 welcome 后立刻补发重放事件，**本机集群里稳定触发，每秒两次重连，会话永远建不起来**。

解法是把整条连接的帧处理串到**单条 Promise 链**上：既保证握手期间的帧排在其后，也保证事件按 seq 顺序落库。

**链上每一环要单独兜错**：链上任何一次拒绝都会让后续 `.then` 整体跳过，帧会被静默丢光。

### 串行化之后，回调里不能再等对端的回执

上面那条改完，`onRunnerConnected` 里若 `await` 一个需要 TaskRunner 回执的命令，
**回执要经同一条串行链回来**，必然自锁到命令超时。这类回调里的派发要 fire-and-forget 并记日志。

### 退出前要等发送队列写出

`close()` 紧跟 `process.exit` 会把尾部事件丢在发送队列里。退出前等 `bufferedAmount` 归零
（有界，本仓 2 秒），否则 agent cancelled、terminalClosed 这些收尾事件到不了对端。

### Docker 节点磁盘满时，业务服务 Ready 不代表数据库可用

2026-09-14 的 RFC-003 实机验收中，API／控制器／console 均 Ready，但登录超时。
PostgreSQL 原 Pod 已 CrashLoop，启动错误为 `could not write lock file "postmaster.pid": No space left on device`；
节点 `df` 显示可用空间为 0。数据库卷实际只占约 160MiB，不能据此去删数据库内容或重建卷。

构建／导入前核对 Docker 节点实际可用空间；发生此类故障，先查数据库 Ready 和端点、启动错误及磁盘容量。
精确盘点本任务产物时，交叉核对 Docker 与节点运行时的容器／镜像引用；镜像标签清理也不等于构建缓存已释放。
本次只清理已被新版取代的自有镜像和九个精确 ID、可回收且不共享的旧 console 编译缓存，保留当前／回退镜像与所有卷。
原数据库 Pod 随后自行恢复。用事件等待确认 Ready 后，还需重新走真实登录及业务读取，不能仅以 rollout 成功作为恢复证明。

## 契约变更

### 无兼容期的契约变更，先问「改它的那条路径会不会被自己挡住」

RFC-001 一次性把 `agentProfiles` 的 `driver` / `model` 换成 `compute`，并给 Schema 加了 `.strict()`。
老仓库的 `crewstation.yaml` 于是全部非法——这是预期内的。**预期外的是**：开发会话在开的时候
硬解析 Manifest，解析不过就不给开，而开发容器正是改这个文件的地方。等于同一次变更既把门锁了，
又把钥匙收走了。现在会话照开、只是没有预览，发布仍然硬拒。

判据很简单：**列出所有会因这次变更而失败的入口，看其中有没有「修复它本身要走的那一个」。**

### 抬高持久化派生文档的版本号时，要同时回答「谁来把它重建出来」

RFC-013 把放行表的 `identityVersion` 升到 2，读取侧随之把旧文档当作不存在——这一步是对的，旧文档里的授权还是按操作键写的，
不能沿用。**漏掉的是另一半**：放行表只在授权／目录变更与手动「重算」时重建，升级本身不触发任何一个。于是本机升级后库里最新一份
仍是旧格式（v39），服务域 ForwardAuth 对每个请求都回 `403 放行表尚未生成`，业务调平台 API、开发容器里的 Agent 连 MCP 全部被拒，
而用户域的浏览器旅程一切正常，验收因此没撞上（2026-09-21，从业务 Pod 里 `fetch('http://api.svc.cs.internal/healthz')` 才看见）。
现在评估侧发现没有当前版本的文档会就地重建一次（同进程合并、跨进程靠主键冲突兜底），管理页的读取仍是纯读取。

判据：**给任何「派生后落库、带格式版本」的文档抬版本时，列出它的全部重建触发点，确认升级之后至少有一个会自己发生**；
验收里要有一条走服务域的真实调用，浏览器里看不出这类故障。

同一份放行表半年后又被同一类疏漏咬了一次，这次与版本号无关：它是「当前已登记服务」的投影，而**建项目不触发重建**——
`project.created` 只重算了该服务的路由。新项目于是根本不在表里，它的开发容器一连内置 MCP 就是
`403 <project>/<service> 不能调用平台端点 mcp-capabilities.svc.cs.internal`，平台 API 同样被拒，
要等某次无关的授权／目录变更或管理员手动「重算」才顺带被带上；已有项目全都正常，所以平时看不见
（2026-09-22，在 `cs-demo` 里起一个带 `crewstation.io/workload=dev-session` 标签、项目名未登记的 Pod，
`POST http://mcp-capabilities.svc.cs.internal/mcp` 即可复现）。归档是同一条反向的漏：条目会一直留着继续被放行。

判据扩一句：**派生文档的重建触发点要覆盖它输入集合的每一次增删，不只是格式升级**。
写法上有个省力的自检——把投影的输入源（这里是 `listServices()`）点开，看它读的每张表分别由哪些事件改动，
逐个对照订阅列表；缺哪个就补哪个。

### 一个「已过滤」的清单不能同时当解析器用：归档项目的网关路由因此永远删不掉

同一次排查里还翻出对称的另一半。组合根把网关要的三件事都接在同一个 `listServices()` 上，而它**已经滤掉归档项目**：
`archiveProject` 在一个事务里把 state 改成 `archived` 再发 `project.archived`，消费者跑到时按 projectId 查不到服务、
按 serviceId 也查不到，`removeService` 一进门就 return——归档项目的 IngressRoute 于是原样留在集群里继续对外服务，
而工作台上这个项目已经「冻结访问」了。

判据：**给一个端口写实现时，分清它的每个方法要的是「当前在册的那一批」还是「按 id 解析任意一个」**。
两者共用一份已过滤的清单，凡是「处理消失事件」的路径都会在最需要它的那一刻查不到东西。
本仓的处理是把 `ServiceDirectory` 的两个方法的取值范围写进注释并分别实现：`listServices` 不含归档，
`getService` 含归档并带 `archived` 标记，`reconcileService` 见到归档的就不再规划路由。

### `.strict()` 是必需的，但错误信息要自带出路

zod 默认剥掉未知键：不加 `.strict()`，旧写法的 `driver` / `model` 会被静默丢弃，
业务以为自己指定了驱动，实际没有。加了之后报 `Unrecognized keys: "driver", "model"`——
定位准确，但没说该改成什么。`describeManifestFailure` 把「改成 `compute: <档位名>`、
可用档位去哪儿看」接在后面，发布与开会话共用同一套说法。

### 开发容器的 `HOME` 就是 `/work`

`runtimes/task/Dockerfile` 有意把 worker 的家目录设成工作区挂载点（两个 Agent CLI 都要可写 HOME）。
代价是 `.bun/`、`.cache/` 这些会落进 git 工作区，而发布前置检查会把它们当成「未提交的更改」
拒绝发布——平台被自己产生的文件挡住。模板 `.gitignore` 先挡住；真要治本得给 worker 一个
不在仓库里的家目录。

## 前端与测试

### 多身份、明暗主题与全程键盘的实机核对：无头 Chrome＋CDP 浏览器上下文

Chrome 扩展只有一份登录态、一个系统主题，测不了“同一时刻四个真实角色各看到什么”“暗色下每页长什么样”。
2026-09-16 起用本机 `Google Chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<scratch>` 配一段 ~150 行的
CDP 脚本（会话草稿目录，不入库）：每个身份一个 `Target.createBrowserContext`（独立 cookie 罐），`Page.navigate` 到工作台被
ForwardAuth 带到登录页后填用户名密码并 `form.requestSubmit()`（口令来自 `.local/admin.env`；配了 OIDC 时登录页上是
`a.provider` 入口，点进去在 IdP 页面上再点一次就回来了）；`Emulation.setEmulatedMedia` 切 `prefers-color-scheme`，
`Emulation.setDeviceMetricsOverride` 定 1280×720／390；`Input.dispatchKeyEvent` 走 Tab／方向键／Escape 并读 `document.activeElement`
的 `outline-style`；`Page.captureScreenshot` 留证。踩过的坑：`Target.createTarget` 的 `width/height` 只对上下文里第一个窗口有效，
第二个页面再传会报 “Target position can only be set for new windows”；页面就绪要等 `main h1` 且正文里没有“载入中／读取中”，
只等 `loadEventFired` 拿到的是骨架。
**真点击要分两步量坐标**：`scrollIntoView()` 之后在**同一次** `Runtime.evaluate` 里读 `getBoundingClientRect()`，
拿到的还是滚动前的位置，`Input.dispatchMouseEvent` 于是点在别的元素上——页面照常、断言照绿、什么也没发生。
先滚动、`sleep` 一下、再量一次坐标，并用 `document.elementFromPoint()` 确认那个点确实落在目标上，落不上就报错而不是空点。
另外，浏览器里换过前端代码要 `Network.setCacheDisabled`：镜像换了而 index.html 还在缓存里时，核对的是上一版界面。

### Chrome 扩展量窄屏：窗口压不到 500px 以下，用同源 iframe 模拟视口

Claude in Chrome 的 `resize_window` 到 390／320 会被 macOS Chrome 的最小窗口宽度吞掉（`innerWidth` 不变），全屏窗口更是完全不响应。
在页面里注入同源 `<iframe src=location.pathname style="width:390px">` 即可得到真实的 390px 布局视口（cookie 同站、媒体查询按 iframe 宽度生效），
用 `contentDocument.documentElement.scrollWidth` 比 `contentWindow.innerWidth` 判断整页横向溢出；1280×720 的高度量测同理。


### 路由库不会替你装错误边界：没有 `defaultErrorComponent`，一页渲染抛错整个工作台就没了

TanStack Router 只给声明了 `errorComponent`（或路由器上有 `defaultErrorComponent`）的路由装 `CatchBoundary`。两样都没有时，
任何页面在渲染期抛错都会一路冒到根上，顶栏、左栏连同页面一起被库自带的英文 “Something went wrong!” 顶掉。
2026-09-21 实撞：网关页对放行表响应直接 `allowlist.data?.entries.length`，响应缺 `entries` 就是这个下场。
现在 `app/router/router.ts` 配了 `defaultErrorComponent: RouteErrorPanel`（`renderApp` 同步配了同一项，整页旅程用例看到的出错形态才和生产一致），
出错只换掉那一页；面板的「重试」会先丢掉无人订阅的查询缓存再重画，否则读到的还是让它崩掉的那份数据。
**边界只是兜底**：页面读响应仍要先过形状检查，把「格式不合」转成读取失败显示出来（`MarketPage`、`gatewayStatus.ts` 都是这个写法），
而且读取失败时不要拿 `?? 0` 充数——「0 条」「为空」是会被当真的结论。

### happy-dom 里 React 的 onChange 走 IE 时代的 input 事件 polyfill：先 focus，再 keyup

对受控 `<input>` 只 `dispatchEvent(new Event('input'))`，React 一次 onChange 都不触发；而先 `focus()` 再写值再派发 `keyup` 就能触发。
原因是 happy-dom 没有让 React 的 `isEventSupported('input')` 通过，React 退回 IE9 polyfill：只在 `focusin` 时记住活动元素，
只在 `keyup`／`keydown`／`selectionchange` 时比对该元素的值跟踪器。判据：不 focus 直接 keyup，触发的是**上一次聚焦过的**那个输入框的 onChange，
而 `event.target` 却是当前元素——`apps/console/src/tests/resourceCatalog.test.tsx` 的 `input()` 助手就是这样写的，新测试照抄它，不要自己简化。

### `bun test` 要在仓库根运行，`apps/console` 目录下没有 CSS Module 预加载

根 `bunfig.toml` 的 `[test] preload` 把 `*.module.css` 换成“键即类名”的代理。在 `apps/console` 里跑 `bun test`，
`styles.level` 这类类名变成 `undefined`，`styles.link`／`styles.sub` 命中 `String.prototype` 上的同名方法，React 报 `Invalid value for prop className`，
按类名断言的测试成片失败（`logMetadata`、`splitGrid`、`projectNavigation`…），看起来像是自己改坏了。先看运行目录，再怀疑代码。

### bun test 里 CSS Module 是一个字符串，不是对象

`import styles from './X.module.css'` 在 bun test 里返回**文件路径字符串**。于是 `styles.link`
命中 `String.prototype.link`（一个真实存在的遗留方法），React 对着 className 报
「Invalid value for prop」。`bunfig.toml` 的 `[test] preload` 注册了一个插件，把 CSS Module
换成「键即类名」的代理。

### 渲染测试要先注册 DOM，再 import react-dom

`@happy-dom/global-registrator` 必须在任何 react-dom 求值之前跑。把注册单独放一个模块
（`apps/console/src/tests/domSetup.ts`），测试文件把它写成**第一条 import**——ESM 按 import
顺序求值依赖。同一个文件里还要设 `IS_REACT_ACT_ENVIRONMENT = true`，否则 `act()` 每次都只
警告一句「not configured to support act」然后什么也不等，测试看起来通过其实没渲染完。

### TanStack Router 的无路径布局路由会进到路由 id 里

`createRoute({ id: 'workbench' })` 不占路径段，`fullPath` 不变；但**子路由的 id** 会变成
`/workbench/projects/$projectId`。`useParams({ from: '/projects/$projectId' })` 因此编译失败。
用 `projectRoute.useParams()` 而不是写死 `from` 字符串——本来就不该知道 id 长什么样。

### TanStack Router 在跳转一开始就发布新地址：旧页面读 `useLocation()` 会读到要去的地址

`router.load()` 开头就把 `stores.location` 换成目标地址（`status: 'pending'`），新页面的匹配要等 beforeLoad、懒加载和提交之后才换上；
这段时间旧页面仍挂着，`useLocation()` 已经是要去的地址，而 `useSearch({ strict: false })`、`useParams` 取本页的匹配，还是旧值。
2026-09-23 实撞：开发页「无参数进入就把个人布局里的面板写回地址」读的是 `useLocation()`，把离开途中的 `/release`（没有 `view`）
当成无参数进入，`replace` 回 `dev-session?view=reference`——左栏点什么都被拽回开发页，作者以为页面卡死。
**判据**：Chrome 会话文件（`~/Library/Application Support/Google/Chrome/Default/Sessions/Session_*`）里同一历史条目的原始地址是要去的页、
最终地址却是开发页；或在页面里挂钩 `history.pushState`／`replaceState`，看到 push 之后几十毫秒紧跟一个 replace。
**做法**：按地址自动导航（`replace` 写回）或改持久状态的效应，只认本页路径上的地址——见 `useDevelopmentLocation` 的 `usePageLocation`：
路径不是本页时沿用本页最后一次的地址，并且不发 `replace`。只做显示的读取（导航高亮、记住位置）不受影响。

### 源码层断言要先去掉注释

「代码里不许出现 localStorage」这类断言，会被解释「为什么不用 localStorage」的注释绊倒。
`apps/console/src/tests/sourceScan.ts` 同时给出原文与去注释后的正文，断言用后者。

### 设了 HTTP_PROXY 时，「fetch 没抛异常」不等于目标活着

实机验收要先探测网关与调试浏览器在不在，不在就整套跳过。本机若设了 `HTTP_PROXY`（这台机器上是
`http://127.0.0.1:1087`），Bun 的 `fetch` 会走代理；目标关着时**代理替它回一个 503**，于是
`try { await fetch(url) } catch` 永远不进 catch，探测把「连不上」读成「可用」，用例随后在连接处崩掉而不是跳过。

探测要校验回来的东西对不对，别只看抛没抛：网关要求状态码 < 500，调试浏览器要求 `/json/version`
真的给出 `webSocketDebuggerUrl`。见 `tests/e2e/consoleSession.ts`。

### 换查询时面板塌成一行，浏览器会把滚动位置钳住

2026-09-21 换快照回顶用 `useApiQuery` 的 `keepPrevious` 解决（条件没变只换快照，留住旧数据）。2026-09-22 集群管理切页签又撞上同一类：
条件变了必须重读，面板只剩一行「载入中」，文档变短，浏览器把 `scrollY` 钳到新的最大值（实测 979 → 262），回执到了页面也不会滚回去，页签条和列表一起被顶出视口。
**判据**：切页签／换筛选的瞬间量 `scrollY` 与 `document.documentElement.scrollHeight`，文档高度掉下去再回来而 `scrollY` 没回来，就是这个。
**做法**：条件没变用 `keepPrevious`；条件变了用 `shared/lib/useHeldHeight(contentKey)` 把面板撑在上一次的高度，等 `QueryStatus` 的 `data-query-state="pending"` 消失再放开。
下限必须在**换内容的那次提交**就带上（hook 按内容键在渲染期判断）：先塌再在效应里撑是没用的——同一次提交里别处的布局读取（页签条量宽度）已经让浏览器按塌掉的高度钳了滚动位置，之后撑高也回不来（2026-09-23 第二次实机就红在这里）。
也不要用固定 `min-height` 兜底——它挡不住深滚动位置，还会在内容真的变短时留一大块空白。

## 用例与 CI

规范正文在 `testing.md`；这里只记撞过的坑。

### 不要对全仓开 `bun test --randomize`：模块集成用例是同一个库上的有序场景

2026-09-20 想加一条「随机序巡检」来抓用例间的隐性依赖，实测 `bun test --randomize --seed=20260920`：1649 条里 100 条失败，
逐条看全是模块集成用例——它们在 `beforeAll` 建一个库，后面的用例接着前面写下的状态推进（先建项目、再发布、再切流），
`--randomize` 连文件内的顺序也打乱，于是「还没建就去查」。这是有意的写法，不是缺陷。文件之间的独立性另有保证：每个文件自己建库、自己删。
要抓偶发失败用 `--rerun-each`（按文件重跑），不要用随机序。

### `.only` 在本机静默吃掉同文件的其余用例，只有 CI 才报错

Bun 在 `CI=true` 时拒绝 `.only`（`.only is disabled in CI environments`），本机不设这个变量：实测同文件里一条 `test.only` 加一条必然失败的用例，
本机输出 `2 pass, 0 fail`，失败的那条根本没跑。调试时留下的 `.only` 因此会让你「本机全绿」地把红推上去。
现在由 `tools/arch` 的 `test-discipline` 规则在门禁第一步拦下；无条件 `.skip`、`.todo`、`.failing`、恒真 `skipIf` 与 `retry:` 同理。

### 子进程里跑的代码不进覆盖率：命令行脚本的逻辑要放在可 import 的模块里

`bun test` 的 lcov 只记录用例进程自己加载的文件。用 `Bun.spawn` 起子进程去测一个脚本，被测脚本那几行在覆盖率里是 0，
新增代码防护（`testing.md` §8.3）会把它判成「没有用例执行到」。做法是入口只留参数解析与输出，逻辑放进旁边可 import 的模块直接测
（`tools/arch/lockMigrations.ts` 只有十来行，逻辑在 `migrationLockUpdate.ts`）；入口文件本身不在防护范围内。
需要验证「进程真的非零退出」这类只有子进程才能看到的行为时，再补一条子进程用例（`packages/testkit/capability.test.ts`）。

### 不要在 `bunfig.toml` 里常开覆盖率：每次运行留一个 `.tmp`，单文件运行还会冲掉全量结果

2026-09-20 实撞：为了让本机与 CI 共用一条命令，曾在 `bunfig.toml` 写了 `coverage = true`。Bun 1.3.13 每次覆盖 `coverage/lcov.info`
都会在旁边留下一个 `.lcov.info.<hash>.tmp`（全量一次约 500 KB，跑一次多一个）；更糟的是，共享工作树上任何人跑一次
`bun test 某个文件`，全量的 `lcov.info` 就被那一个文件的结果冲掉，随后的新增代码防护预演全是误报。
现在覆盖率只在 `bun run test:cover` 与各层的 `--cover`（CI 用的是后者）里打开。另一个相关的坑：`--reporter=junit` **不会自己建输出目录**，
目录不存在时用例全过、最后报 `JUnitReportFailed … ENOENT` 并以非零退出，所以脚本里先 `mkdir -p coverage`。

### 新增工作区单元后要 `bun install` 并提交 `bun.lock`

`tools/testguard` 只是多了一个没有任何依赖的 `package.json`，`bun.lock` 的 workspaces 段也会多一条。
本机不装照样能跑，CI 的 `bun install --frozen-lockfile` 会当场失败。加完单元跑一次 `bun install`，确认 lock 的 diff 只有自己那一条，再一起提交。

## 并发开发与 Agent 协作

### 就地改写共享文件：`open(p,'w').write(f(open(p).read()))` 会先清空再读

2026-09-20 实撞：给 `STATE.md` 追加一段时写了 `open(p,'w').write(apply(open(p).read()))`。Python 先求值 `open(p,'w')`——文件当场被清空——
再去读，读到的是空串，`apply` 里的断言随即失败，留下一个 0 字节的 `STATE.md`。那一刻工作树里还有三个并行会话**尚未提交**的接力段落，git 里没有它们。
最后是靠其他会话的操作记录里保存的补丁原文逐个重放，并用对方一分钟前自己量到的 `git diff --numstat`（+20／−3）对上数，才原样恢复。

改写任何共享文件都按这个顺序：**先读进变量、算出新内容、断言通过，再写临时文件并 `os.replace`**（`Path.write_text(new)` 也必须在 `new` 已经算好之后）。
`STATE.md` 是全仓最热的共享文件，别的会话的未提交内容随时都在里面；只想提交自己那一段时，用 `git hash-object -w` 加
`git update-index --cacheinfo` 把「HEAD 版本＋自己的段落」放进暂存区，工作树里的别人内容原样留着。

### ADR、RFC 与待决问题的编号会被并行会话抢占：提交前再看一眼

2026-09-20 实撞：写 ADR-0006 的五分钟前，另一个会话已经建了未提交的 `docs/adr/0006-cluster-management-module.md` 并在它的 RFC 里引用了四处。
两边都只看了已提交的历史，于是都取了下一个号。编号类文件（`docs/adr/NNNN-*`、`proposal/rfc/RFC-NNN-*`、待决问题的 `I` 号）落盘前先 `ls` 目录并看 `git status` 里的未追踪文件；
撞号时后来者让号（对方先建、引用更多），并把自己文件里的全部引用一起改掉。

### 整文件批量替换会把「定义处」也换掉：抽助手函数后它开始调用自己

2026-09-18 实撞：把一批路由里的 `await c.req.json()` 换成新助手 `await body(c)`，用的是整文件
`s.replace("await c.req.json()", "await body(c)")`——助手**自己的函数体**也在这个文件里，于是
`const body = async (c) => await body(c)`，每条读 body 的管理路由都稳定回「请求体必须是 JSON」。
抽助手时先写定义、再改调用点，替换后**读一遍定义**；助手名别跟局部变量重名（`body` → `readJsonBody`）。
错误里带上原始原因（`{ reason: error.message }`），这类自伤才不会伪装成「客户端发的不是 JSON」。

### 每条路由的**成功路径**都要有用例，只测失败分支等于没测

上面那个 bug 能进集群，是因为管理面路由的 HTTP 测试只断言了「缺字段 400」「越权 403」这类失败分支——
它们在 body 读坏时照样绿。判据很简单：**关掉的功能能不能让测试变红**。加完成功路径用例后，
把 bug 再种回去确认它确实红，再删掉——红过一次的测试才算数（开发规则 §3）。

### `git commit -- <pathspec>` 会漏掉 `git mv` 的删除侧

2026-09-18 实撞：把 `packages/contracts/api/auth.ts` 用 `git mv` 移成 `api/auth/session.ts` 后，
按路径提交时写的是 `git commit -- packages/contracts/api/auth ...`——这个 pathspec 匹配**新目录**，
但匹配不到被删除的 `api/auth.ts`（它不在 `api/auth/` 下）。结果：新文件进了提交，删除留在暂存区，
远端同时存在两份同名内容，`api/` 的文件数也差一。CI 恰好还是绿的，所以没人会注意到。

移动文件后提交前看一眼 `git diff --cached --stat` 里有没有 `D` 行落在 pathspec 之外；
更稳的做法是把旧路径也写进 pathspec（`git commit -- packages/contracts/api/auth.ts packages/contracts/api/auth`）。

### 并发会话改同一个共享文件时，门禁可能是别人的红

同一棵工作树上另一个会话正在重构契约时，`bun run typecheck` 会有几十条不属于你的错误，
此时**本地全量门禁跑不绿不等于你的改动有问题**。做法：按自己的路径过滤输出
（`bun run typecheck 2>&1 | grep -E "^(modules/你的模块|packages/你的包)"`）确认自己这侧干净，
自己的测试文件逐个跑绿，然后等对方提交后再提交自己的——**不要**把对方未完成的 hunk 一起提上去，
那会让主干变红且难以归因（开发规则 §2「绝不删除、绝不回退别人的改动」的另一面）。

### 不要 reset 已经推送的提交

2026-09-12 实撞：一个子 Agent 看到工作树里出现了它没创建的提交，判断成「harness 自动提交」，
执行 `git reset --mixed HEAD~1` 撤了它——而那笔提交已经推上 `origin/main`。
看到意料之外的提交先 `git log` 与 `git branch -r --contains` 查来源；已在远端的只能用新提交纠正。

**派活给子 Agent 时要写清「也不要动已有的提交」**，只说「不要提交」不够。

### 并行派活时公共件要有唯一所有者

十个工作台页面由四个并行 Agent 写成，各自被禁止改 `shared/`，同一个东西被抄了三到五份，
事后专门开一轮把 19 份副本收回去。**先把公共件建好再派活**，或者指定一个 `shared/` 的所有者。

### 子 Agent 的产出要自己复核，不能只看它的报告

一个 Agent 报告「加了回归测试」，实际写的是 `expect(A).toEqual(A)` 这类自证的断言。
另一个把 `queryKeys` 改名却没改完调用方，中途的 typecheck 是红的。
**收到报告后自己跑门禁、自己读关键文件**。

### 子 Agent 中途死掉会留下半截文件

会话限流或额度用尽时，Agent 会在任意一步停下，留下能过 lint 但过不了 typecheck 的半成品。
接手时先 `bun run typecheck` 定位断面，再决定是补完还是回退。

### 对 happy-dom 节点的失败断言看起来像整套用例卡死

`expect(document.querySelector('textarea')).toBeNull()` 失败时，bun 会去序列化那个 happy-dom 节点（带 parent／ownerDocument 的循环引用），
一条断言能花几十秒到几分钟，进程被 alarm 杀掉后缓冲的输出也一并丢失——表现就是「整套文件不出任何一行结果」，单独跑某条又是绿的（2026-09-23，RFC-020）。
断言 DOM 存在性只比较数量或文本：`expect([...querySelectorAll('textarea')].filter((n) => !n.closest('[hidden]'))).toHaveLength(0)`。
反过来，真卡死时先在 `beforeEach`／`afterEach` 用 `appendFileSync` 打点定位，不要相信 stdout。

### `renderApp.click` 不点闭合 `<details>` 里的项，目标可能还要等一拍

工具行的「⋯」菜单与拆分按钮都是 `<details>`；闭合时里面的按钮用户看不见，用例也点不到，先点开 `summary`。
`click` 找不到目标时会再等几拍（最多 8 次 `settle`），因为面板里的内容常在一次读取之后才出现——不要在用例里再手写 `settle` 循环。

### 实机验收脚本会改掉验收身份的个人布局，作者看到的页面会跟着跳

开发页的面板状态存在**每个用户每个任务**的个人布局里，e2e／量测脚本以 `dev-admin` 打开 `?view=code`、`panel=full` 等地址都会保存进去；
作者本人也是 `dev-admin` 时，从左栏进开发页就会落到脚本最后留下的那个面板（2026-09-23「页面自己在到处跳」）。
跑完实机验收把布局收起（打开一次 `/dev-session?view=cli`），或改用 `dev-developer` 之类的第二身份；不要在作者正在看的会话上跑量测。
