# RFC-010 验收记录

> 2026-09-20，In Progress。作者已批准完整实现和提交上库；本文件区分自动化行为证据、真实部署只读证据与尚未完成的动作验收。

## 实现与验证候选

第一笔实现：`b7fb3e52b585bafc08bac8dd16d15a57007eee5b`（136 个精确路径）。共享项目目录、平台组合根、应用接线和能力 E2E 由并行 RFC-011 完整文件提交。迁移包括 cluster-management 0001–0003、task-runtime 0006、release 0004、business-task 0004，校验和已入锁。

已通过的本任务定向测试（不同调用的结果，不与完整门禁混记）：

| 测试文件/组 | 结果 | 证明的行为 |
|---|---|---|
| cluster-management/inventoryProjection | 5 pass | 三种项目、全部六种任务用途、UID 替换、旧 CLI、系统目录/引用、归档/冲突、HPA、控制器计数、OOM/退出码 |
| cluster-management/clusterManagementModule | 4 pass | 实际 PostgreSQL 快照、Secret/环境变量正文不外泄、同一快照分页、UID 检查、幂等受理/队列、刷新合并、管理员 HTTP |
| cluster-management/clusterRecovery | 5 pass | 检查过期/配置变化、心跳不失效、响应丢失后 marker 恢复、并发继续核对、fencing、finalizer、部分失败保留、取消后再次采集、HTTP 410 |
| cluster-management/clusterReader + packages/k8s/clusterPrimitives | 4 pass | continue/410 重读、取消、精确 UID 事件、init/previous 日志容量与读取中替换、JSON Patch 与分页传参 |
| release/clusterSlotMaintenance | 2 pass | 调副本→实际就绪→下一次发布保留覆盖→恢复原配置；HPA/过期检查；正式槽保护；试用删除保留 Service/历史；重启 marker 恢复 |
| task-runtime/clusterWorkspaceRestart | 2 pass | 正常工作区保留任务/PVC，新 UID、子执行回收顺序与配额；旧检查不作用于替换实例 |
| task-runtime/environmentRebuild + taskPodFailure | 10 pass | 原恢复链与 UID 删除、终止/OOM 原因不退化 |
| dev-session/clusterExecutionRestart | 2 pass | CLI/headless 新实例固定修订、重复命令不新增、父会话不释放 |
| business-task/businessTaskModule | 9 pass | 原业务工作流及成功业务不重放、取消后幂等重试、结束指定子执行而保留父任务 |
| agent-runtime/computeProfileModule | 13 pass | 测试停止后保留真实终态，迟到 passed 不能覆盖 |
| platform/clusterManagement | 2 pass | 全部模块真实 DB 装配，管理员 HTTP→业务持久工作区重启/关闭；同一任务/PVC/配额；506 项目录跨页和归档/已释放实例 |
| console/clusterManagement | 5 pass | 管理员守卫、六页签、服务端总量、URL/返回/分页、界限校验、检查与写入分离、202/trace/耗时、丢回执恢复、继续核对、日志和焦点返回 |
| console/platformSurface | 2 pass | 前端和后台管理路由对账 |

结构检查、根类型、console 类型与本任务 ESLint 定向通过。共享全量 check/coverage、console build 的结果见下文；最终发布 SHA 的 CI 另行记录，不沿用旧候选结果冒充当前版本门禁。

## 真实部署只读记录

Context：`docker-desktop`；入口：`http://console.cs.localhost/admin/cluster`。经仓库 `tests/e2e/consoleSession.ts` 的真实管理员登录与浏览器驱动访问，无 HTTP 数据夹具。

部署镜像由并行 RFC-011 构建并成功滚动，包含本 RFC 较早实现快照：

- control-plane `cs-control-plane:rfc011-20260920-1`，digest `sha256:d96f8ea4caf7b368dd45a191af0468d41c96c31640d39cf653d0cc21e575fb25`。
- console `cs-console:rfc011-20260920-1`，digest `sha256:8fa99b7f753165811d91e1d1ff2005f196c59f0d950f95481378e579c8fa98de`。
- 新页面定向真实 E2E：2 pass、0 fail、9 assertions，日志 `/tmp/cs-rfc008-shared-new-pages-e2e.log`，包含本集群页与 RFC-012 算力页。
- 19:22 CST 快照 `e705b30e-af06-472a-8271-edca0275c5e3`：已读取 274 项、26 个控制器、33 个 Pod、32 Running/32 Ready、33 Service、9 PVC。`complete=false`；84 个来源因服务账号权限缺失返回 403。上述数字是本次部分来源的结果，不是完整总量。
- 三种现有项目的服务用途可见，槽位 blue/green 与 prod/preview 展示；平台 Deployment、Service 与无 managed 标签的配置/卷由目录和实际引用纳入。
- 1280px 深色、390px 浅色中文、320px 深色英文：页面 `scrollWidth == clientWidth`；每步 `takeErrors()` 为 `[]`。截图在本次工作机 `/tmp/cs-rfc010-{1280,390,320}.png`；未作为跨机器证据附件发布。
- 最新代码对不完整来源零值、缺失控制器的独立 Pod 计数、详情关闭焦点，以及采集取消/分批读取做了补正；这些变化以自动化测试证明，待更新镜像后复核。

## CM 对账

| 编号 | 已有证据 | 仍需实机/最终证据 |
|---|---|---|
| CM-01 | HTTP 401/403、DOM 管理守卫；真实管理员能进入 | 第二身份实机拒绝已有其他 RFC 通用守卫验收，本 RFC 以自动化覆盖 |
| CM-02–04 | 归属/目录/引用/冲突/归档纯函数与真实 DB；现有三种项目和内置 Deployment 可见 | 应用 RBAC 后核对完整系统 owner 链与 UID 集合 |
| CM-05–09 | 六种任务用途、旧 CLI、替换 UID、构建/迁移、槽映射、状态/容器/引用的投影回归 | 完整权限下逐项现场比对；旧无 Pod UID 记录须 Runner 重新连接后绑定 |
| CM-10–11 | 分页、410、来源局部失败、取消、刷新合并、506 项数据库分批测试 | 本机权限恢复后的全来源 complete 与数值核对 |
| CM-12–13 | URL/返回/快照/详情/容器/事件/current+previous 日志交互与 K8s 边界测试；真 Pod 详情、事件、当前日志均 HTTP 200，UID 一致 | previous 日志与已删除 UID 的现场检查 |
| CM-14–15 | 发布槽真实 DB＋K8s 替身重启/副本跨发布/恢复/冲突测试 | 专用项目真实 Deployment、旧新 UID、Ready、发布/切流证据 |
| CM-16–18 | 任务/业务真实 DB 与所属模块成功/失败/回收/配额/保卷回归，禁止成功业务重复执行 | 专用真实工作区、CLI/Agent/业务/档位测试终态证据 |
| CM-19–20 | 试用槽状态/Service/历史、引用保留、UID 删除、检查无写入回归 | 专用真实资源删除与后续可重建 |
| CM-21 | 系统动作能力及限制测试；真实系统清单可见 | 协调具体中断窗口后记录真实重启；不触碰其他会话活跃资源 |
| CM-22–23 | 响应丢失、幂等双击、检查替换/过期、fencing、崩溃恢复、finalizer/超时继续核对；UI 显示 HTTP/trace/耗时 | 实机动作 operationId/UID/HTTP/trace/耗时 |
| CM-24 | 实际三种宽度/浅深色/中英文无整页溢出；DOM 焦点与确认交互 | 最新镜像上的操作确认/结果窄屏复核 |
| CM-25 | 定向静态和行为测试、恢复环境后的共享完整检查及 console 镜像构建通过；本地提交已核对 | 最终远端同步与精确 SHA CI |

## 本机 RBAC 阻塞

自动审批两次拒绝 `kubectl apply -f deploy/k8s/platform/00-rbac.yaml`，理由是持久增加共享服务账号的读取、patch 与 Ingress 删除权限，要求具体授权。命令未执行。

已向作者询问本机 `docker-desktop` 上 `crewstation-control` 的确切授权：读取 StatefulSet/DaemonSet/ReplicaSet/CronJob/HPA/ReplicationController/Ingress，patch StatefulSet/DaemonSet 以重启内置组件，删除经引用检查的 Ingress；原有权限不扩展。回复尚未到达。

不通过换身份执行生产 API、直接改生产数据库、临时放宽检查或换另一条命令绕过审批。现阶段不能将 RFC 标 Done；取得授权后在专用验收项目补齐真实动作，或由作者明确裁定验收范围。

## 共享门禁与末轮补正

第一轮冻结内容的完整 `bun run check --coverage --coverage-reporter=lcov --coverage-dir=coverage --reporter=junit --reporter-outfile=coverage/junit.xml` 自然结束：静态检查通过，1861 pass / 5 skip / 1 fail，302 文件，234.70 秒。唯一失败是既有 `agentExecutionStreams.test.tsx` 的历史执行异步页签定位；RFC-008 原任务在处理受控延迟回归。此结果不称为全绿；不因期间 HEAD 前进而取消或重跑。

同一覆盖产物对 origin/main `fe7efcdef1b8` 的共享已跟踪候选检查为 2192/2223（98.6%），无新增防护违规；RFC-011 纳入未跟踪文件的完整候选评估为 2483/2514（98.77%），无违规。最终整批推送的检查仍以 CI 为准。

安装清单对账补正内置登录器的真实名 `crewstation-dev-auth`（Deployment/Service/IngressRoute，并沿引用纳入 Secret），增加 `crewstation-local` 标签的真实平台装配测试；操作记录补齐 UID/阶段的 URL 筛选、操作者与受理时间。末轮定向回归与共享最终门禁结果继续追加。

末轮上述补正的定向验证：11 pass / 0 fail，93 assertions（platform + cluster-management + console），ESLint 与 console 类型通过。

第二轮完整检查自然结束为 1573 pass / 5 skip / 109 fail：一项既有开发身份隔离扫描将合法内置组件名字误判为身份接入，其余模块测试受 PostgreSQL `CREATE DATABASE` 的 `53100 No space left on device` 影响。该轮不作通过证据。扫描只对两处确切的组件目录元数据路径放行已安装对象名，固定 Provider 与账号仍在全部生产根路径禁止；仅回收未使用的可再生成 BuildKit 缓存后恢复测试库，未删除镜像、容器、数据卷或数据库。

恢复环境后的冻结候选完整检查通过：`bun run check --coverage --coverage-reporter=lcov --coverage-dir=coverage --reporter=junit --reporter-outfile=coverage/junit.xml`，**1864 pass / 5 skip / 0 fail**、302 文件、10304 assertions、228.56 秒。证据日志 `/private/tmp/rfc011-recovered-full-gate.log`；覆盖本 RFC `73ad1a0`、共享接线和历史 Agent 页签的受控延迟修复。五个能力缺席跳过不计作实机通过。

最终 console 候选镜像构建通过（Dockerfile 内执行生产 Vite build）：`cs-console:rfc010-20260920-2`，digest `sha256:b6e0e989886038c87cc8727eef84a35ded4d4ba568de8aabec548dc0ba6d0a31`；日志 `/tmp/cs-rfc010-console-build.log`。控制面最终候选由 RFC-011 构建为 `cs-control-plane:rfc011-20260920-2`，digest `sha256:c099f349e6a115f0d5448ea3ac18cd18309f255ed98f53c13684d83027f95f74`。构建通过与实际滚动部署分开记录，更新实机后再追加现场证据。

## 最终镜像的只读实机复核

控制面由 RFC-011 成功滚动后，console 于 20:03 CST 更新至上述最终镜像，generation／observedGeneration 均为 89，ready 1。实际 Pod `console-667c468d46-n5hzp` 的 imageID 与上述 console digest 完全一致；没有应用 RBAC，没有重启开发登录器。

- 浏览器入口仍为 `/admin/cluster`，实际 bundle `assets/index-BiKRq5O0.js`。快照 `c79eb016-63c8-47be-bec1-56b6f9d7ea27`（12:03:38Z）为 278 资源、27 工作负载、33 Pod、32 Running／32 Ready、34 Service、9 PVC，仍有 84 个来源403，`complete=false`。
- 实际 `crewstation-dev-auth` 的 Deployment、Service、IngressRoute、Secret 元数据均归属平台内置组件；未输出 Secret 正文。系统 Pod 因 ReplicaSet 读取缺失仍明确显示归属／用途待核对。
- 1280 深色中文、390 浅色中文、320 深色英文均 `scrollWidth == clientWidth`，浏览器错误为空。320px 操作记录 UID＋succeeded 筛选返回 HTTP 200／0 条；这是空记录筛选验收，不是操作成功证据。
- 实际 Pod `cs-api-5b465f9575-hjhbw`，UID `b21ac772-8e03-4f78-9538-41c28f314d8f`：详情、精确 UID 事件、容器 `cs-api` 当前日志分别 HTTP 200，耗时13／21／29ms；关联3项、事件5项、日志3780字符且未截断。日志 UID 与目标一致；响应没有 trace header，不补造 trace。
- 320px 列表点击及直接 URL 打开后，详情获得焦点且在可视区（顶部44.89px、底部884.08px）；关闭详情后焦点返回原资源行。布局和动作限制均可见，未提交资源变更。

本机证据 `/tmp/cs-rfc010-final-browser.jsonl`、`/tmp/cs-rfc010-focus-live.jsonl`；截图 `/tmp/cs-rfc010-final-overview-{1280,390,320}.png`、`/tmp/cs-rfc010-final-detail-click-320.png`、`/tmp/cs-rfc010-final-operations-320.png`，均为本机临时文件。共享接线已包含在 `b3d8d0e`，基线三件套回填 v0.3.6（R54／D53）；最终远端与精确 SHA CI 继续核对。权限和 CM 动作验收边界维持上文，不据此将整个 RFC 标 Done。
