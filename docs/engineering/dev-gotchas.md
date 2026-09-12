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

## Kubernetes 与本机集群

### `.dockerignore` 会静默吃掉构建需要的目录

控制面镜像的 `.dockerignore` 排除了 `templates`，于是开通链停在「模板 minimal-sample 不存在」，
而镜像构建是绿的。**改完 Dockerfile 后进容器 `ls` 一眼**，别只看构建成功。

### Secret 的键名要对着看，不要猜

安装脚本最初从 `postgres-credentials` 里取 `POSTGRES_PASSWORD`，而那个 Secret 暴露的是 `url`，
迁移 Job 于是 `password authentication failed`。取 Secret 前先 `kubectl get secret -o jsonpath='{.data}'` 看键名。

### 改了哪个模块，就要重启读它的那些进程

放行表的判定逻辑在 `modules/gateway`，但**执行判定的是 cs-auth**（ForwardAuth）。
只重启 cs-api 与 cs-controller，403 照旧。**先想清楚这段代码跑在哪个进程里**，再决定重启谁。

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

## 并发开发与 Agent 协作

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
