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
- [并发开发与 Agent 协作](#并发开发与-agent-协作)

## 工具链与依赖

### typescript-eslint 不支持 TS 7.0，TypeScript 必须锁在 6

`typescript-eslint@8.70` 遇到 TypeScript 7 直接报 `does not support TS 7.0` 并整轮 lint 红。
根 `package.json` 的 `typescript` 锁 `6`，升级前先确认 typescript-eslint 的支持矩阵。

### `bun install --production=false` 不是合法参数

控制面镜像最初写了这一条，构建当场 `exit code 1`。Bun 没有这个开关，装全量依赖就是**不带任何参数**的 `bun install`。

### 基础镜像里没有的东西，要自己装

`oven/bun:1.3.13` **不带 git**。cs-controller 建仓时以子进程调用 git，于是开通链停在
`Executable not found in $PATH: "git"`。凡是以子进程调用外部命令的，都要回头确认镜像里真的有它
（本仓已踩过 git；`setsid` / `setpriv` 来自 util-linux，任务镜像里显式装了）。

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

### 节点 CPU 预约 10／10 时滚动更新排不进新 Pod

控制面每个部署请求 100m，RollingUpdate 默认先起新再停旧，节点满额时新 Pod 一直 Pending，`rollout status` 超时。
两种做法都用过：单副本服务改 `strategy: Recreate`（console 先改，2026-09-16 cs-api 卡死后 `rollout restart` 的新 Pod Pending 了六分钟，七个平台部署的清单全部写回 Recreate）；发布构建 Job 的 Pod 请求 1 CPU，节点占满时它会一直 Pending、发布停在“正在构建”（2026-09-16 v0.1.2 等了 11 分钟，缩四个 CLI Pod 到 150m 后 20 秒内完成）；新版本的 Deployment 按部署时的套餐请求 CPU（v0.1.2 的 preview Pod 500m，正式槽 50m），随后 cs-api／console 的 Recreate 又因此 Pending 10 分钟——重建平台镜像前先看 `kubectl describe node` 的 cpu 请求余量；或临时把闲置 CLI Pod 原地缩到 150m 再恢复——
`kubectl patch pod … --subresource resize`，requests 与 limits 要一起改，否则 Guaranteed QoS 变化会被拒绝；容器名等于 Pod 名。


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

### 按任务建的资源，路由也要按任务建

开发预览的目标 Service 是随任务 Pod 建的，放进 gateway 的「按服务重算路由」里对不上生命周期。
这类资源的 IngressRoute 要**随 Pod 建、随 Pod 删**（`modules/task-runtime/adapters/k8s/taskCluster.ts`）。

### 项目命名空间到宿主机的出站是被网络策略挡住的

`crewstation-system` 能到 `host.docker.internal:8929`，项目命名空间不能。
部署在项目命名空间里的接入容器访问本机测试 GitLab 会 504，这不是代理的 bug。

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

### 源码层断言要先去掉注释

「代码里不许出现 localStorage」这类断言，会被解释「为什么不用 localStorage」的注释绊倒。
`apps/console/src/tests/sourceScan.ts` 同时给出原文与去注释后的正文，断言用后者。

### 设了 HTTP_PROXY 时，「fetch 没抛异常」不等于目标活着

实机验收要先探测网关与调试浏览器在不在，不在就整套跳过。本机若设了 `HTTP_PROXY`（这台机器上是
`http://127.0.0.1:1087`），Bun 的 `fetch` 会走代理；目标关着时**代理替它回一个 503**，于是
`try { await fetch(url) } catch` 永远不进 catch，探测把「连不上」读成「可用」，用例随后在连接处崩掉而不是跳过。

探测要校验回来的东西对不对，别只看抛没抛：网关要求状态码 < 500，调试浏览器要求 `/json/version`
真的给出 `webSocketDebuggerUrl`。见 `tests/e2e/consoleSession.ts`。

## 并发开发与 Agent 协作

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
