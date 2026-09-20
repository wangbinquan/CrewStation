# RFC-010 验收记录

> 2026-09-20，Done：T1–T11 与 CM-01–25 全部完成，生产代码、实机验收、本地完整检查与精确 SHA CI 通过。作者已批准完整实现、提交上库及本机 RBAC 应用。

## 范围、环境与部署

入口为 `http://console.cs.localhost/admin/cluster`，context `docker-desktop`。使用真实 OIDC `dev-admin`，普通用户边界使用已有 `dev-member`，不修改其角色。只纳入 CrewStation 项目与内置组件。

`deploy/k8s/platform/00-rbac.yaml` 已在本次“批准”后成功应用；原服务账号和绑定未变。ReplicaSet／StatefulSet／DaemonSet／CronJob／HPA 等来源读取不再返回 403。先前两次自动审批拒绝和未完成实机范围属于历史记录，已由本次具体授权解除。

专用项目 `prj_01a0bece32717000b24fb87ed5a19323`，服务 `svc_01a0bece32717001a18d98f9f4aeeb8d`，namespace `cs-rfc010-cluster-qa`。所有任务、发布槽、Job、finalizer 均在本次专用资源上验收；未修改其他 RFC 的业务资源。内置 `mcp-operations` 重启前已说明目标并与正在操作本机平台的任务协调窗口。

最终 API／controller 镜像 `cs-control-plane:rfc010-20260920-4`：Docker image ID `sha256:8bfc807d59dc90c02247164e7f2303eb183f060e1b87bef1c6912e98459f0731`，节点导入 manifest `sha256:55eb2f9a2cfba1a42903ffe81e51848c82863e3fd55e1e2c989d7dd9c9faebae`，两份 Deployment rollout 成功，实际 Pod imageID 与上述 Docker image ID 一致，部署后核对时均 Ready／0 次重启。后续磁盘故障恢复后的最终核对仍全部 Ready：API 1 次、controller 2 次、console 0 次重启；PostgreSQL 累计 27 次（本轮前已有 24 次），未隐藏环境故障导致的重启。console 当前共享镜像为 `cs-console:rfc011-buttons-20260920`、实际 imageID `sha256:319b4c7df3e5e41c133ab462b4e4b8c2315071e69b9df9d082f0194fd50e0a90`，集群功能与已验收版本一致；本次重新检查确认和中英文结果。`mcp-operations` 只滚动原镜像，没有更换版本。

## 清单与只读行为

最终快照 `1c891dd2-7fcd-40da-9be6-b206d9d28c0a`：**248 个来源、0 个错误、complete=true，450 项资源、32 个工作负载、43 个 Pod、39 Running／39 Ready、35 Service、12 PVC**。五页结果有 450 个唯一 UID。直接读取 Kubernetes 的控制器和 Pod，以项目 namespace、内置目录和实际 owner UID 链独立计算，32 个工作负载和 43 个 Pod 的 UID 集合均完全相同，无缺失或多计；系统 Pod 没有未知用途。

这些数值是该时点记录，不是将来固定期望。工作负载去重，不把 Deployment 的 ReplicaSet 再加一次；终态构建 Job／Pod 仍在清单，Running 与 Ready 独立统计。三种项目的服务用途、正式／试用映射、内置目录及引用对象均可见；`kube-system` 和无归属的外部对象未被纳入。

普通用户直达 `/admin/cluster` 可见“仅平台管理员可见”和返回入口，HTTP summary 返回 403“集群管理仅限平台管理员”，浏览器错误为空。

实际服务 Pod UID `4e2e2e60-789a-46fd-bb06-e3c0119c3e49`：当前日志 HTTP 200／27ms、139 字符、未截断，响应 UID 一致；从未重启过的容器请求 previous 日志返回 HTTP 503／25ms，明确说明 `previous terminated container ... not found`。已清理构建 Pod UID `e455c1d3-6eec-48d8-b3c8-71af2d568637` 的日志查询返回 HTTP 404 和对象不存在原因。普通读取没有 trace header，不补造 trace；写操作 trace 见下表。

## 动作与生命周期证据

以下操作均由真实产品接口受理（202），并等待真实资源／领域终态；重复同一幂等请求返回同一个 operationId。发布槽重启另由实际浏览器依次点击“重启 → 检查影响 → 确认执行”完成。

| 动作 | operationId | HTTP／耗时 ms | traceId |
|---|---|---|---|
| 浏览器重启发布槽 | `4825c3c3-1e98-4e0e-b095-ca8b14cf71ba` | 200／9072 | `e372502f-c30d-4707-a33a-e39af49e3995` |
| 副本调整为 2 | `9ab6e7cd-6411-4670-a626-ccefe82ecfb4` | 200／4780 | `b3754c8a-a3ce-43df-9256-af832e4fe1b5` |
| 恢复 Manifest 副本 | `839493e3-f821-4215-b588-07cb4edaeb40` | 200／3045 | `738d6e5b-2e2e-469a-a148-258ee4f31dd3` |
| 删除试用槽 | `c922a42f-830c-494d-ad15-48548f13c2db` | 200／3089 | `44f45896-7b22-4a31-b69c-ed23e1c14194` |
| 开发工作区保卷重启 | `941e3e47-7d9d-46b6-90d3-99860743650e` | 200／192092 | `bced7141-a001-4314-ad65-8d11924e1410` |
| 单 CLI 重启 | `4274a26c-6f92-48fb-b121-f8c4fda2d7b8` | 200／30893 | `ddd58e68-8c7c-4734-998b-bd7ae021a5e2` |
| 结束另一 CLI | `551fbaac-3012-40d5-8254-a4d793d798b4` | 200／15293 | `fd8e3d23-ad7f-4b24-8e52-c9d0529378c0` |
| 工作区重启并回收子执行 | `83af6067-dd10-4f93-9938-336a2f43da53` | 200／43367 | `bd4c75d5-effc-493e-838e-7716aaab8e54` |
| 开发 Agent 重启 | `7a3402ef-44c2-4cab-8d51-0262c39f3b3a` | 200／20142 | `78f84e48-dd9b-4281-a535-20292b53a0dd` |
| 结束开发 Agent | `dbc7f5b8-cf07-4098-8142-8f3b5793cad8` | 200／10684 | `c0189d64-0a3a-46e6-98ca-5a9f403d7341` |
| 业务工作区重启 | `67c4736d-3972-46cf-aaed-b1942c31394d` | 200／19773 | `5bdaa148-c44e-4c6c-bf13-a01b4a3ba4ca` |
| 取消业务子任务 | `21ab2a89-f3a0-48a6-8a3f-f13522532d51` | 200／18659 | `a89efff1-d152-4135-bf85-b9da6703d80d` |
| 关闭业务任务 | `fae9eefe-96de-42f3-9514-8bd6b82d30e9` | 200／939 | `f5790fe3-3cc9-4ac0-b2f4-44c8b1e34865` |
| 停止档位测试 | `ba889869-1994-4982-a594-acd1d15f9e3a` | 200／809 | `3735f629-a107-4074-bec0-a1c31497188a` |
| 内置 mcp-operations 重启 | `491be2f7-1a17-4911-a417-5c4773ecc10e` | 200／2269 | `4e4a6495-fa3e-40e9-a7f8-cab9d586b901` |
| 清理终态构建 Job | `68aecf2d-8e99-4a72-97a4-a54cf7165e78` | 200／2368 | `e80dcd1f-d48c-4e81-b0d6-2a58c62ba1ab` |
- 发布槽：重启保留 release `rel_01a0bed93f3d7000a8642fe3535c9769` 与配置版本。副本调整为 2 后，发布 `rel_01a0bedef5fe70008bf816a08e32fc78` 仍保留运维覆盖 2；恢复 Manifest 为 1。删除试用槽后发布 `rel_01a0bee131d2700094a571cf68c038ee` 成功重建，Deployment UID 从 `d7de42f0-520a-42e9-aa0c-f3e288e85afb` 变为 `c143074e-2e5e-4dae-a519-0470eed2dd6f`；Service UID `1586fa84-003b-4a24-841a-49b9646eba11` 和发布历史保持。实际切流后 green 显示 prod，删除检查明确要求先切流。副本 4 超过套餐上限 3，检查禁用。
- 开发工作区：`tsk_01a0bed2ba5a700099f0f3e55874b305` 重启保留 PVC UID `d054e3db-20d9-4a1c-9c85-6de101c65de9` 与 `/work/rfc010-preserve.txt`，新 Pod UID `f4fbd7bf-d755-4fde-93b4-6c2b80b932fb`，Runner／预览恢复；释放后配额归零。首次受本机调度容量影响耗时 192092ms，如实保留，未用手动创建代替产品结果。
- CLI／Agent：第二工作区 `tsk_01a0bee1cf957000894ea9bd9a88bcae` 同时启动两条 CLI。重启 A 只生成 A 的新执行 `tsk_3b93942e8fdcc160032fccfd65314da9`，B 的原执行保持；结束 B 不影响 A。重启父工作区才回收其余子执行，保留 taskId／PVC。开发 Agent 重启前后固定原档位修订 3，随后结束选定新执行，父会话仍运行且配额为 1。
- 业务任务：由专用服务 Pod 经真实服务域调用创建 `tsk_01a0befe541070008a74ad15b1fad8ca`。重启保留 taskId、PVC UID `014155ee-a7b7-4d33-a0c8-b314e677bffc` 与 `/work/rfc010-business.txt`，新 Pod UID `fa3b2c63-7ce0-4da8-a249-498d0dc15cca`。已成功命令 `sub_01a0befece197000991b1e658d0f9aea` 仍为 succeeded／attempt 1。取消 Agent 子任务 `sub_01a0beff3fca7000889fe356f72d65c2` 后，服务调用方读到 cancelled，父任务 running／配额 1；关闭后调用方读到 closed／配额 0，持久卷保持。有引用 PVC 的删除检查被拒绝。
- 档位测试：真实 Pod 不携带 profile-test ID 标签，仍从 UID 绑定的任务记录关联 `pft_01a0befd83f27000a2b349f452ae5fa1`。停止后记录为 unknown／environment-lost，并显示“管理员停止了本次档位测试，不能判定为通过”；执行环境已释放。
- 系统组件：`mcp-operations` 原 Pod UID `e830c146-6d81-44b9-aa0f-e467dfbb4f79` 被新 UID `e40195de-5cdf-447c-8284-63494f761164` 替换且 Ready。`cs-api` 的副本调整检查 disabled，核心删除检查明确显示“平台组件由安装流程管理，不支持删除”。
- 原生清理：终态构建 Job `build-16a08e32fc78` UID `3e997d94-814d-4ca5-9146-8a379a5184d7` 精确删除，从属 Pod 回收，发布记录仍保留。

### Finalizer、继续核对与长操作刷新

专用 ConfigMap 原 UID `8489aeca-68a3-4ee8-94a9-516af2c6a493` 带验收 finalizer。操作 `0dfd70de-bad9-4f55-8b44-b6d1be087422` 在 302028ms 后进入 needs-attention／HTTP 504，明确显示等待原实例终止、可能有 finalizer；trace `29f8e3b0-88f3-41ea-9782-584ca7d03d0e`。

只移除该测试对象的 finalizer，并创建同名新 UID `79143eb0-4a8f-40b9-b7a2-b5435254e8fd` 后，点击语义相同的“继续核对”接口令**同一个操作**变为 succeeded／HTTP 200／resumeCount 1。原 trace 保持，总历时 1291007ms（包含等待人工解除阻塞）；替换对象仍存在，随后由针对新 UID 的独立操作清理。

该操作仍 observing 时手动刷新得到完整快照 `7d6a701b-5cba-409b-a701-0883aaf1400b`，耗时 5156ms。采集 worker 与操作 worker 分开，长操作不再占住所有刷新容量。

## 界面与 CM 对账

实际浏览器在 1280／390／320px 检查浅／深色及中英文。确认框、结果和长 UID／trace 正确换行，全部 `scrollWidth == clientWidth`，浏览器错误为空。320px 下“确认执行”键盘焦点可见；最后一次检查没有再提交动作。列表点击和直接 URL 进入详情都会获得焦点，关闭后返回原资源行。结果区保留 operationId／UID／HTTP／耗时／trace；重启成功的 9.1s 可直接看到。

| CM | 结论与证据 |
|---|---|
| 01 | 真实管理员／普通用户 UI 和 HTTP 边界通过 |
| 02–04 | 完整来源、三类项目和实际系统目录／owner UID 对照；旧对象、冲突／归档／外部对象边界有投影及数据库回归 |
| 05–09 | 六种任务用途均在专用实际生命周期中出现；构建、三类服务、槽映射及计数实际核对；异常状态／退出码／引用／正文边界有回归 |
| 10–11 | 450 条跨五页、唯一 UID 与总数一致；长操作期间刷新实跑；continue／410／局部失败／取消／刷新合并有模块回归 |
| 12–13 | URL、返回、筛选、详情、事件、当前／previous／已删除 UID 日志通过，失败原因可见 |
| 14–15 | 浏览器重启、真实副本收敛、跨发布覆盖、恢复配置和超限检查通过 |
| 16–18 | 工作区保卷、CLI／Agent 隔离、业务调用方终态、已成功业务不重放、档位测试停止实跑通过 |
| 19–20 | 试用删除后重建、正式槽保护、Service／历史／持久卷保留、终态 Job／孤立资源 UID 清理通过 |
| 21 | 协调窗口后的实际系统重启与单实例扩缩／核心删除限制通过 |
| 22–23 | 幂等重放、finalizer 超时和继续核对同名替换实跑；过期、租约、响应丢失和崩溃恢复回归通过 |
| 24 | 三种宽度、主题、语言、确认／结果及键盘焦点通过 |
| 25 | 生产构建、完整本地检查与发布 7237ecc 的六项 CI 全部通过；跳过范围及历史失败分别记录于下节 |

## 自动化、构建与发布

本次三项实机发现均补回归：档位测试 ID 从持久化记录解析；采集与长操作队列分离；业务恢复先等原 UID 消失，再创建同名 Pod，等待期间保持 paused／不占配额，替换 UID 和 finalizer 超时保留可见原因。

新生命周期定向验证 **106 pass／0 fail／753 assertions**，24 文件；真实 PostgreSQL。业务恢复的延迟删除与替换实例用例先红后绿；超时有界回归通过。静态检查和 console 生产构建通过。E2E 帮助函数显式支持 `CS_E2E_AUTH=dev-oidc`，经真实 Provider 选择已有身份并校验 `/v1/me`；默认 CI 的密码路径保持可用，没有通过不可达浏览器端口屏蔽验收。

最终完整本地检查 **1875 pass／5 skip／0 fail，10393 assertions，303 文件，265.13s**；架构、lint、两套类型检查通过。五个跳过是未提供该自动化环境的非管理员浏览器、真实集群客户端和三条原生 CLI 场景，前者与集群管理的实际边界另有上述实机证据。本次发布相对 `a694465` 的新增可执行行覆盖 **47／48（97.9%）**，无防护违规。

完整门禁候选已发布至 `7237ecce628e4693d69127bea766e13fca0ff13e`，包含实现 `119bf59` 与测试同步修正 `7237ecc`，并保留三个并行任务各自提交的输出；推送后 `HEAD == origin/main`，共享索引为空。精确 SHA 的 [CI 35516088549](https://github.com/wangbinquan/CrewStation/actions/runs/35516088549) 六个作业全部成功：static、unit、module、console、gate、e2e。

此前已发布主体 `b7fb3e5`／`73ad1a0`、共享接线 `b3d8d0e`、文档基线 `da4f437` 的 [CI 35509904421](https://github.com/wangbinquan/CrewStation/actions/runs/35509904421) 六个作业通过；此历史结果不代替本次修复的最终 CI。

本机临时证据位于 `/tmp/cs-rfc010-*.log`、`*-evidence.json` 和截图 `confirm-visible-{1280,390,320}.png`／`result-visible-{1280,390,320}.png`；它们不是跨机器发布附件，本文件保留可追踪的实际 ID 与结果。专用验收任务全部结束、配额 0；三个临时隐藏算力档位已停用，验收项目／发布历史与按语义保留的两份业务 PVC 留存。

### 未计为通过的轮次与环境事件

- 批准 RBAC 前是部分清单（84 个 403 来源），不作为完整清单通过证据；批准后已经替换为上述全来源实测。
- 初次业务工作区重启 `61555223-6284-4790-ba27-a606b8ea8160` 碰到旧 Pod 仍在删除的 HTTP 409；已由等待原实例消失的修复与新操作复验闭环。
- 档位停止 `e5b63194-0038-412d-b621-71bed4702597` 缺少测试 ID 映射返回 404，已修；另一排队操作 `8c632889-2cc1-43a1-a586-fee2afbeed79` 执行时旧测试 Pod 已自行结束，按旧 UID 拒绝 404。最终停止证据为仍在运行的新测试，不把失败重命名为成功。
- 13:03Z 本机 API 曾报 Bun SQL `08P01: bind message has 2 result formats but query has 7 columns`，同池健康检查失败后由 liveness 自动重启。保存旧日志后观察恢复；表现与已登记的数据库客户端池问题（dev-gotchas／I16）一致，具体触发原因未独立复现；本次未扩展修改持久化层。滚动窗口的临时 502 也没有计为通过。
- 第一轮本次 full check：1830 pass／4 skip／6 fail／4 errors，认证读取遇到上述 API 重启，另有并发首页修复中间状态。第二轮：1871 pass／5 skip／4 fail，10345 assertions，303 文件，259.22s；真实 OIDC E2E 与本次所有用例通过，四个失败是运行中新增的语言双按钮／去重复导航回归，等待其对应候选收口。不取消运行，也不丢弃他人测试来制造绿色。
- 随后共享候选的 1874 pass／5 skip／1 fail 为原生状态 HTTP 用例预期 403、收到 503；该处理器没有 503 分支，单文件复核通过。代理与直连的临时环回对照各 100 次均返回 403，未复现，因此不将代理猜测写成已确认原因。
- 下一轮 1819 pass／5 skip／46 fail（235.01s）在 PostgreSQL `checkpoint request failed` 后连续进入 recovery mode；节点磁盘 100%，数据库实际日志为 `No space left on device`。按仓库恢复规则核对全量 Pod、工作负载及 ReplicaSet 引用，仅回收无引用的 21 个 CrewStation 节点旧镜像缓存及仍存在的 16 个宿主旧标签；未删卷、数据库或其他项目镜像，释放约 1.2GB。数据库自动恢复后，重建失效的本地测试转发，临时测试库创建／删除通过，再运行完整检查。
- 环境恢复后的 1873 pass／5 skip／2 fail（265.88s）定位到集群装配测试的握手竞态：它把数据库 `creating` 当作 Pod 已创建，提前读到空对象，未等候的操作随后在夹具关闭后污染相邻网关用例。改为由实际 Fake Kubernetes 创建完成触发 Runner 握手，并完整等候队列操作；明确断言 `creating` 时新 Pod 仍不存在、握手返回 true。相邻两个文件定向 **8 pass／0 fail／54 assertions**，生产逻辑不变，再对修正后的测试候选执行完整检查。

实机修复精确提交为 `119bf592b2413dd02c9c3e1ccaa9894b4fb4293d`（21 个路径）；共享 STATE 中并行任务的已有记录完整保留。该提交对 `a694465` 的新增可执行行覆盖 **22／23（95.7%）**，无防护违规。随后仅测试夹具修正为 `7237ecc`；最终 14 个代码／测试文件已按该候选冻结，完整检查至推送的内容哈希一致。文档收口提交 `207cc4a` 未改动生产与测试内容，追加测试修复见下节。

### 收口提交的 CI 追加核对

文档提交 `207cc4a` 的 [CI 35516626912](https://github.com/wangbinquan/CrewStation/actions/runs/35516626912) 在控制台层发现一条既有历史 Agent 用例失败（499 pass／1 fail）：名册未返回就向禁用输入框合成输入，随后快捷键期望发送 1 次、实际 0 次。通过延迟首个名册回执稳定复现相同断言，修正测试为等待输入框实际可编辑再输入；保留重复快捷键、在途输入和回执隔离的全部断言。两个相关文件 14 pass／0 fail／133 assertions；只修改测试同步，生产代码未变。

追加完整检查为 **1871 pass／5 skip／7 fail，10394 assertions，303 文件，270.71s**；这次集群与历史 Agent 用例全部通过，七个失败来自运行期间并行市场改造新增的 trial 字段与旧详情跳转断言。保留该轮真实结果，不改动并行任务文件。
