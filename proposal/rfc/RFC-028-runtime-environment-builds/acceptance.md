# RFC-028 实施证据

2026-09-27。作者已批准完整实现、提交上库与本地部署；仍为 In Progress。此文区分源码用例与实机产品验收，RI-01～RI-28 尚未完成。

## 2026-09-28：停用定义保留已有任务及版本

专用镜像 `01a0e233-bd86-7000-936f-2f9a9ec692a1` 暂时enabled=false后，既有父任务 `01a0e30e-e096-7000-be22-db3c8ecd4171` 仍running，完整runtimeImage快照相同；原版本 `01a0e27f-4ef9-7000-bd34-538122dfbb26` 仍可读且摘要不变，历史接口200。随后用停用回执的expectedRevision恢复enabled=true，返回200，未改业务默认／允许集合。

实际Pod前后UID均 `f748cdc5-645f-4982-96bf-835e648f38e1`、imageID相同、Running、restartCount=0。证据 `/tmp/cs-rfc028-owned-disable-retain.json`、`/tmp/cs-rfc028-owned-disable-pod-{before,after}.json`。最初脚本假设快照含imageId而失败，无写操作；改为按原构建回执解析定义，再验证versionId／digest一致后才执行。补RI-22停用定义不影响原引用执行子项，未执行版本删除／服务回退，不代替这些剩余条件。

## 2026-09-28：错误校验和真实构建反例

平台无仓库构建 `01a0e3b1-aa54-7000-b530-0357389118c3` 上传payload.txt并执行故意错误的SHA256校验。实际BuildKit日志包含 `/tmp/payload.txt: FAILED`、`1 computed checksum did NOT match` 与该RUN步骤exit1；平台最终failed、unknown=false，版本列表为空。专用定义 `01a0e3b1-aa47-7000-b349-0a9e1ebed3d1` 创建时defaultVisible=false，验收后已停用；没有授权或修改现有业务绑定。

本轮Job／Pod／PVC清单中已无该buildId和resourceId `01a0e3b1-aa54-7001-b08f-2005d84e429f` 对应资源，实际失败不会发布可用版本。证据 `/tmp/cs-rfc028-owned-checksum-{setup,build,final,disabled,resources}.json`；补齐RI-04错误校验和反例，不替代其他构建／权限／初始化验收。

## 2026-09-28：父任务／Agent 镜像允许集合实机

实际业务v0.3.1入口分别尝试父任务显式选Agent B专用镜像、Agent A选B镜像、Agent B选A镜像；三个请求全部HTTP400、`runtime_image_not_allowed`，明确拒绝而非回退默认。原父任务仍running，子任务列表结构比较完全一致；blue／green／父Pod UID分别仍为c16c7158…、f14b69c2…、f748cdc5…。没有新增执行容器。结合既有权限与无副作用模块回归，RI-10闭合。

证据 `/tmp/cs-rfc028-owned-image-boundaries.json`、`/tmp/cs-rfc028-owned-image-boundaries-pods.json`；三次稳定请求键分别negative-parent-agent-b、negative-agent-a-image-b、negative-agent-b-image-a（均带rfc028前缀和20260928后缀）。请求经所属应用真实fence处理，未冒用服务身份。

## 2026-09-28：同键及 fresh／原生 resume 的实际镜像快照

专用业务父任务原键重放返回原taskId；同键改为另一个允许的镜像返回409（应用持久写屏障）。Agent A原attempt1为 `01a0e396-b094-7000-afab-eefa0b89679d`，fresh retry产生attempt2 `01a0e3c4-f29f-7000-b69c-9603aa89afcb`，其原生续跑产生attempt3 `01a0e3c7-7c7d-7000-a5e1-568cd2d03321`。两次均succeeded／exited／exit0，同键重放分别只返回已有attempt，各原执行只有一个后继。

fresh会话由 `ses_f1c68aa1cffera84chsszm2eP5` 换为 `ses_f1c3a6296ffeYsLtFaGWa9aaIL`；resume保持后者。三次image、完整runtimeImage（含初始化和工具）、computeProfileId、profileRevision=3、agentProfileId结构比较完全一致。实际Pod imageID均为原 `sha256:77ffe8bfa44f95d5874f168f8a3aeeb265831c3f29ecfca8c6da7de5b980bd5f`。新Pod UID分别0d7d36af…与10c28649…，均已自动回收；原blue／green／父Pod UID保持。

首次resume收到应用写屏障／租约409，未创建新意图；原键重试成功，首次失败保存在 `owned-agent-a-resume-first.json`。fresh及resume结果文件均已通过业务文件入口回读，七项工具结果成功。这里用的是已部署业务的原v3 retry入口，不是尚未部署的RFC029管理员按钮。结合此前真实PG幂等与原镜像回归，RI-21闭合；RI-22服务回退／停用引用等其余子项仍继续。

证据 `/tmp/cs-rfc028-owned-idempotency-retry.json`、`/tmp/cs-rfc028-owned-agent-a-{retry,resume}-{pods,final}.json`、相应cleanup.log和 `/tmp/cs-rfc028-owned-retry-resume-final-pods.json`。

## 基础与定向验证

- runtime-environment：标准脚手架 L4，images／revisions／builds／versions／validations／references／build_logs／development_policies；0001、0002 精确入迁移锁，未部署迁移。
- 镜像目录／修订和权限真实 PG：3 pass。SHA 固定、乐观锁、分页、共享只开放目录与版本，源码／Secret 引用／构建日志不向外项目开放；tester、服务身份、跨项目拒绝。
- 构建准入／日志真实 PG：2 pass。并发同 key 仅一条，异参 409，满额拒绝，取消中不退额；续传重新授权，完成后日志过期 410。
- 用途／引用真实 PG：4 pass。构建成功不能直接执行，验证固定用途／档位；契约变化不改原恢复快照，新准入须重验。过期但未核对调用方的 reservation 继续保护；逻辑删除明确 physicalDeletion=retained／pending-maintenance，不伪报空间释放。
- 构建控制器真实 PG＋外部执行器测试替身：6 pass。取消立刻使旧租约失效、旧结果不可复活，超期接管不覆盖已完成记录；未确认物理停止不退额，日志上限与游标去重，伪造 receipt epoch 拒绝，仓库失联 unknown，deadline 回收后失败，existing 登记不创建 builder。
- Dockerfile AST、路径／Git tree、引用优先级、状态机、仓库适配器：13 pass；源码预检另 2 pass。仓库按实际响应字节复核 digest，多架构索引选择单平台清单，前缀隔离、配置层数／谱系校验。网络为 HTTP 测试替身，尚非真实 registry 证据。
- SCM 模块＋GitLab 适配器：9 pass。固定 SHA 与 tree、跨项目绑定拒绝，构建 token 仅 read_repository／reporter，开发会话原有 read/write_repository／developer 不变；库只留哈希，提前撤销幂等。
- arch:check：通过；后续代码仍需最终类型／lint／完整候选门禁。无 CI、发布或部署结论。

数据库用例通过 `CS_TEST_REQUIRE=database bun test <定向路径>`，使用 testkit 创建并删除的独立 cs_test 数据库。本机 55432 初次在沙箱内不可达，允许本机连接后实际执行；没有以 skip 代替通过。

## 构建执行与初始化接线（本机自动化，非集群验收）

- 独立 BuildKit 执行器已接平台与资源台账，绑定 Job／Pod UID、epoch 和摘要收据；Secret／Job／Pod 均消失且 SCM 凭据撤销后才确认停止。K8s 执行器／掩码日志／调和器／Pod 渲染 7 pass、52 assertions；脚本 2 pass、20 assertions。
- 构建推送凭据限制到本项目本构建，底座仅拉取；真实 PG 档位模块与构建意图 15 pass、106 assertions。Calico 高优先级拒绝 builder 直连 registry 写端口，平台校验此策略存在且完整后才创建构建；策略静态用例 1 pass、5 assertions。尚未在实际集群证明网络隔离或完成构建。
- 初始化 Secret 维护权限与版本戳：配置模块 6 pass、58 assertions。生产项需要生产维护权，只解密显式引用；所选 Secret 轮换使新用途验证摘要变化，普通配置变更不影响。
- Runner 初始化：私有 SQLite 日志、同容器去重、新容器重执行、结果不明不重复、超时／取消、临时 Secret 清理和输出掩码；真实 WebSocket 证明连接先于 ready，exec 被门控。最终两文件 6 pass、38 assertions；此前 Runner 生命周期与启动回归另 13 pass、89 assertions。
- 任务接线：内部创建接口分别接受任务与 Agent 自己的验证快照，不继承父镜像；Pod 加独立初始化状态卷与 Downward API UID；平台仅在匹配当前实例的成功回执后进入 running，失败先删 Pod 确认再退额，保留工作卷。保卷重建固定原镜像，恢复增加启动代次。新增 task-runtime/0013 已精确锁定，仅隔离测试库执行。
- 真实 PG 新接线＋既有台账创建／执行＋镜像引用回归 21 pass、143 assertions。类型、架构和定向 ESLint 通过（后续契约变更仍需复核）。
- Manifest v3 新字段分别覆盖 service／tasks／agentProfiles；v2 明确拒绝新字段并提示升级。旧 Manifest＋业务契约 10 pass、24 assertions；新增镜像版本用例 3 pass、19 assertions。服务用途摘要现在也包含显式 probes。

## 独立选择、用途验证与工作台（本机自动化，非集群验收）

- Secret 精确版本消费：配置与初始化引用 8 pass、76 assertions；Secret 轮换使新验证失效，已受理快照仍读取原版本，跨项目／owner／篡改快照先拒绝再解密。
- 开发 v2 接线：新镜像／原隔离 CLI／恢复 13 pass、81 assertions；开发策略 CAS／权限／引用保留与原 task-runtime 6 pass、33 assertions。Agent 与任务各自选择，恢复复制原引用；CLI 同 key 改镜像冲突，旧字段缺省保持原指纹。
- 用途验证控制器：租约、unknown、取消、身份、物理停止先于终态。控制器与生命周期 7 pass、45 assertions；独立任务探针 PG 与控制器 5 pass、37 assertions。验证环境不用业务卷，不带租户配置，停止墓碑阻止迟到创建。
- 服务用途检查标记 `service-contract`，不会填写虚构 observedImageId，也不执行生产迁移；服务 wrapper 与开发接口 4 pass、32 assertions。实际发布／迁移仍沿原链路与所选摘要；发布链定向 5 pass、34 assertions。
- cluster-control 在 Secret 与 Pod 创建前复核 desired，初始化容器的迟到创建可中止：9 pass、46 assertions。
- 客户端目录／构建／日志／验证／开发策略与 v2 严格路由：2 pass、15 assertions。
- 管理员跨项目目录新 HTTP 路由与验证控制器复核：7 pass、49 assertions。
- 业务 v3 父任务选择接线与既有准入：17 pass、124 assertions。固定来源 release 的任务默认／允许集合，请求覆盖，快照进入容器；重复 key 不再解析，改镜像 409；429 后同键仍用原镜像；缺端口不能回退；command 子任务拒绝换镜像字段。后续 Agent v3 已消费新字段，见最新接线证据。
- 工作台新增独立选择、目录／修订、构建／日志／取消、静态服务验证说明、开发默认配置与管理目录：7 pass、31 assertions；原有历史 Agent／CLI／失败任务／保卷重建 26 pass、207 assertions。测试使用真实 React／Query／api-client 与 HTTP 替身，没有真实浏览器或集群证据。
- 发布构建脚本真实 Git 仓库执行：1 pass、6 assertions。分支后移仍检出指定提交，buildctl 看不到 .git／GIT_TOKEN／askpass 文件，非 SHA 引用明确失败。

## 发布引用、模板与浏览器补充证据（2026-09-27）

- 发布默认／允许版本按 task 和每个 Agent 档案分别验证并保留引用；先持久化 release 引用清单再确认。端口 2 pass／9 assertions；发布真实 PG 4 pass／20 assertions。测试修正 JSONB 键序比较，改用 jsonHash，不把键顺序当事务失败。
- 运行镜像执行快照地址必须带相同 digest。构建参数最多 32 个、JSON UTF-8 总大小 8192 字节且无 NUL；平台生成脚本独立限定 65536 字节，覆盖单引号转义膨胀。契约与脚本定向通过；最终脚本组 3 pass／23 assertions。
- 初始化包含首次 Runner 连接五分钟期限和之后按步骤预算的期限；同代次重连不续期。首次连接问题先红后绿；task-runtime 镜像＋原台账＋验证探针最终 16 pass／118 assertions。物理 Pod 消失后退额，工作卷保留。
- 继承的项目环境凭据也在工具输出持久化前掩码；实际工具比较在掩码前完成。宿主初始化 6 pass／36 assertions；原生 arm64 Linux 镜像中初始化和真实 WS 合计 8 pass／47 assertions（含实际 setpriv worker 与临时 Secret 文件权限）。容器只读挂载当前 runtime/contracts/kernel/ws/agent-drivers，不读取 .local 凭据。
- 镜像模块及服务／任务／开发接线综合真实 PG 回归 67 pass／435 assertions。随后新增版本名称查询项目隔离／共享边界，生命周期组 5 pass／32 assertions；不返回配方。
- 工作台配方改为共享 FormField 表单，保留高级 JSON；新增引用显示、停用后禁验证、管理权限、受引用阻断删除、CAS 冲突后的明确丢弃重读。目录用例 7 pass／28 assertions，独立选择 3 pass／15 assertions。服务端仍最终裁定选择合法性。
- Chrome 152 独立上下文＋本任务 Vite 5178 预览，**HTTP 为测试替身**：320／390／1440px 均 document.scrollWidth==viewport；配方弹窗边界分别 [16,304]、[16,374]、[420,1020]，内无溢出，Escape 后焦点恢复至新增修订按钮，console errors=[]。截图 `/tmp/cs-rfc028-ui-320.png`、`-390.png`、`-1440.png`。已关闭浏览器上下文和预览进程、删除仅本任务临时入口。此证据不能勾 RI-25 的真实平台选择／日志验收。
- contracts:lock 记录作者获批 RFC028 P3～P5／E10；金样中 Manifest apiVersion 从 const 变为兼容 v2/v3 的 enum，无删除原 v2。Manifest＋锁测试 10 pass／35 assertions。

## 工具模板真实 Docker 验证（非平台构建链路）

模板 `deploy/examples/runtime-tools/` 包含多阶段 C 编译、pip venv、npm 锁文件安装、脚本与带 SHA256 校验下载脚本，工具检查清单覆盖五项。模板／下载脚本自动化 2 pass／11 assertions，校验失败不会覆写旧二进制。

构建前只读检查：Docker VM `/var/lib/containerd` 实际约 71 GiB 可用；没有删除他人镜像、缓存或卷。固定既有 arm64 Runner 本地 image ID `sha256:869800826c8140458659f039ac5af1f318a501557af37fa14005852caafdd2e0` 为本任务标签 `cs-rfc028-template-base:20260927`，构建 `cs-rfc028-tools:20260927` 成功。产物本地 image ID 为 `sha256:40aca8b4977df7b1fafe33f91ff96e5dd4a044448a8c7d909391497d40634f7c`，不是 registry manifest digest；未推送该镜像、未修改集群服务。

另起 `--rm --network none --read-only --user 10001:10001` 容器，输出依次为 `10001 / ready / ready / ready / script-ready / worker:10001`；ldd 确认链接 `/lib/aarch64-linux-gnu/libc.so.6` 与 `/lib/ld-linux-aarch64.so.1`。临时容器退出已自动删除。本地镜像标签保留供后续实机验证，构建日志 `/tmp/cs-rfc028-template-build.log`。RI-03／04 仍缺平台构建、父 command 与实际 Agent 工具调用组合证据。

## 未闭环内容

### 最新自动化与并发接线状态

- 受管模块装配新增真实 PG、假 K8s 与按实际 JSON 字节计算摘要的 registry：3 pass／26 assertions。覆盖源码固定 SHA、底座实际摘要、不受管底座拒绝、网络隔离缺失不声明资源／不发凭据、凭据先记台账、取消撤销及退额、已有服务镜像无构建资源登记。
- 恢复引用复制覆盖停用后复用、同身份幂等、跨项目与快照冲突拒绝、原引用释放后副本仍阻止删除：生命周期 6 pass／38 assertions。镜像与稳定接线综合覆盖运行 78 pass／513 assertions；runtime-environment 非测试文件均达到 80% 行覆盖，此定向指标不是全仓改动行门禁。
- 工具检查关闭竞态先红（`Cannot use a closed database`）后绿：取消先等正在执行的工具进程结束并写取消记录，再关闭私有日志库；重启后成功检查去重、未确认检查不重复执行。宿主真实 WS 与原生 arm64 Linux 工具镜像各 11 pass／53 assertions。Linux 容器无网络，结束自动删除。
- 工作台新增源码项目仓库选择、具名镜像／摘要选择默认与允许集合、旧修订分页；配置不串到其他 Agent。目录最终 10 pass／38 assertions；console 整层 919 pass／0 fail／6350 assertions，当前 console 类型与定向 lint 通过。
- 最新 Chrome 独立上下文＋HTTP 替身：320／390／1440px 的配置弹窗含目录与版本选择器，页面和弹窗均无横向溢出；Escape 恢复「配置默认与允许镜像」焦点，console errors=[]。截图 `/tmp/cs-rfc028-policy-ui-{width}.png`，已视觉检查 390px；Vite 和临时入口已清理。仍不是 RI 实机验收。
- RFC027 Agent 派发入口接入后，追加 Agent 请求 `runtimeImageVersionId`、结果快照与创建前确认；独立 HTTP／PG 3 pass／28 assertions，证明请求覆盖、默认、无默认不继承父镜像、跨 Agent 允许集合拒绝、重复键、429 同键固定原容器／镜像、缺端口拒绝。中途平台组合因重复 reserveAgent 失败，后续并发文件更新消除重复；最终实际平台端口＋父任务／Agent＋原 Agent 派发 11 pass／92 assertions，保留 agent owner 与显式请求。此前协调问题不再阻塞此接线。

业务 Agent retry/resume 原镜像与引用（依赖 RFC027 对应接口）；引用最终释放／回收；服务／业务 Manifest 选择界面及开发配置选项体验；初始化重连／工具检查恢复剩余边界；完整最终候选门禁与新增行防护；本地部署、28 项 RI 实机、精确提交及 SHA CI。构建执行器、用途验证与新页面尚未在集群验收。全仓 typecheck/arch 最近出现 RFC027 在制 materials 接口／未入锁迁移，属于并发工作，未改写。不得将以上描述为完整交付。

## 默认摘要、执行回显与安装补充

- 平台默认任务镜像在首次准入时固定实际 manifest 摘要，同请求 replay 不再查 tag，新任务才采用更新后的 tag。保卷重建沿原 render.image，启动代次递增；解析失败发生于占额前，显式镜像不依赖默认仓库解析。真实 PG 默认／重建／父子任务／开发与仓库组合 19 pass／143 assertions（随后仅增加 DTO 回显断言，待组合复核）。
- 任务、Agent、CLI DTO 返回受理快照中的 image；工作台用固定摘要展示，不查询当前默认，旧记录缺字段不猜测。显示与原租户选择／开发镜像组合 11 pass／63 assertions；console 类型和相关 ESLint 通过。业务契约锁新增 5 项，无 breaking；Agent/CLI 是非业务面，不影响业务金样。
- 用途验证新增表单：任务、Agent 精确档位修订、服务 command/port/healthPath，保留高级 JSON；目录用例 12 pass／42 assertions。此批尚未浏览器复核。
- 仅运行 install-platform 的升级路径此前漏应用 builder 隔离策略，测试先红后修；现在控制器更新前 apply 21-image-build-policy.yaml。安装脚本 10 pass／48 assertions，尚未执行整平台升级。
- 最新全仓静态检查受并发 RFC027 新会话接口与迁移影响：0022_execution_sessions.sql 未锁、agentPlan 暂缺 sessionKey/volumeUid。对方仍在实施，不代锁迁移或改写其接口。

## 独立 builder 与网络实机预检（非平台端到端构建）

2026-09-27 docker-desktop／desktop-control-plane，原生 arm64；Docker VM 71 GiB 可用。使用产品 imageBuildJobObject 与 imageDaemonScript，在本任务命名空间 cs-rfc028-builder-probe 创建独立 Job；checkout 替换为固定公开 BusyBox Dockerfile，输出仅本 Pod 缓存，未签发 Git／包／平台推送凭据，也未登记平台版本。实际完成 RUN id 与 COPY，Job/Pod Succeeded；Pod UID `060a1d8d-61d7-427b-bfd3-1e87b74d7448`，buildkitd、buildctl 均 Linux UID 1000、退出码 0。daemon 实际限制 500m／1Gi／4Gi ephemeral，client 100m／256Mi／1Gi ephemeral，无业务 PVC、无 ServiceAccount token。

临时安装产品 Calico 策略，两个相同镜像的对照探针，仅一者带 image-build 标签：未标记 Pod 对 registry Service:5000、节点 IP:30500、registry Pod IP:5000 全部可达；构建标签 Pod 三者全部阻断；两者仍可连 registry-push.svc.cs.internal:80。证明网络层路径，不等同于网关鉴权或平台 push 端到端通过。

日志 `/tmp/cs-rfc028-builder-probe-client.log`、`-daemon.log`、`/tmp/cs-rfc028-network-control.log`、`-blocked.log`，实际 Pod 对象 `/tmp/cs-rfc028-builder-probe-observed.json`。探针命名空间已删除；策略原先不存在，验证后删除恢复原状态。前后 JSON 对比其他 63 个 Pod/PVC 名称与 UID 完全一致，未留验证 Pod／Secret／卷。整平台升级与 RI-01～28 仍未完成。

默认摘要／保卷重建／开发 DTO／契约锁后续定向复核 **20 pass／110 assertions**，使用真实隔离 PostgreSQL，没有跳过。

## 恢复、布局与宽覆盖检查补充

- 新出现的 RFC027 resume 接线原先重新 reserve 镜像：停用后返回 412，也可能刷新初始化 Secret。新增用例先红后绿，改为按原 agent owner 复制引用，缺端口／引用拒绝，不改变执行快照；实际端口／原生会话／独立选择／引用生命周期 **16 pass／122 assertions**。fresh retry 的当前并行实现重新解析档位，与 RFC028 §6.2 有差异，已记 I34 并询问作者，尚未代为裁定。
- 实际用途表单在 Chrome 独立上下文、HTTP 替身下验证 Agent／service 两种表单：320／390／1440px 均无页面或弹窗横向溢出，Escape 恢复启动按钮焦点，console errors=[]；截图 `/tmp/cs-rfc028-validation-{agent,service}-{width}.png`，已视觉检查 service 390px。随后只修正文案，将提交前的「已检查」改为本次验证范围；目录／选择／展示 **16 pass／65 assertions**。临时入口、Vite 与浏览器上下文已清理。
- 设置缺省任务镜像现在由受管仓库与底座 repository/tag 组合，与部署清单一致；不再缺省为仅节点本地标签。设置回归先红后绿 **7 pass／18 assertions**。
- 代码候选指纹 `/tmp/cs-rfc028-code-candidate.json`。宽覆盖方法层 **826 pass／0 fail／5037 assertions（187 files）**；模块层 **1597 pass／7 skip／6 fail／9072 assertions（296 files）**。7 个跳过是未启用的真实 K8s、Agent TUI／Linux终端与 Prometheus 环境，数据库用例实际执行。不能称完整门禁通过。
- 其中 4 个失败来自工具示例被业务模板扫描：已有 templateIdentity 用例复现后，将目录从 templates/runtime-tools 移至 **deploy/examples/runtime-tools/**，不改变业务模板解析器。另 1 个失败来自新增默认摘要读取侵入旧 owner 容器路径；现在仅 ledger 准入解析默认摘要，旧路径保持兼容且继续拒绝显式新镜像字段。两项修复组合 **16 pass／115 assertions**，覆盖实际平台装配、模板列表／物化、原容器恢复与新摘要固定。
- 第 6 个失败是并行 RFC027 execution 目录新增到 21 个生产文件，超过结构上限 20；未调整其模块分组。此结果和继续变化的并发候选需最终复核。

- 宽覆盖 console 最终 **922 pass／0 fail／6362 assertions（140 files）**，console 类型与本任务定向 ESLint 通过。unit/module/console 加修复组的工作树覆盖预检（包含未跟踪新增文件）为 6700／6834=98.04%，发现并发新加 executionRunnerTaskId 尚未被此轮用例加载；由于来源包含失败的初始模块轮次及仍变化的并发内容，此数只用于缺口定位，不是可发布闸门通过。报告 `/tmp/cs-rfc028-patch-audit.json`。
- 全仓静态最终仍红：RFC027 execution 目录 21 文件超限，若干新 inline import type 与 releaseHandoff 用例类型；本任务新增旧路径 fixture 的 creation 类型已更正。CommonJS 示例移出 templates 原忽略目录后单独声明其 require 语义，平台 TypeScript 的 ESM 规则未放宽。
- 新增平台／项目运行镜像目录的实浏览器能力清单用例，待部署后执行；没有以当前旧部署冒充通过。最终 fetch origin/main 后 main…origin/main 为 0/0、index 为空；未 commit／push／整平台部署。

## I34 等待期间的最新静态复核

同一 fresh retry 裁定连续三个工作轮次仍未收到答复，`retry.ts` 仍调用 `prepareAgentPlan` 重新解析档位；不覆盖并行实现，也不擅自修改已批准的 RFC028 语义。此前 execution 目录超限已由并行工作消除。当前重新检查得到：`modules/platform/wiring.ts` 601 行超过 600 行；全仓 ESLint 25 项 inline import 类型错误；TypeScript 在 `modules/release/application/queries.ts:79` 报 `releaseId` 不属于 `ActiveEndpoint`。日志分别是 `/tmp/cs-rfc028-static-recheck.log`、`/tmp/cs-rfc028-lint-recheck.log`、`/tmp/cs-rfc028-types-recheck.log`，检查进程均已结束。

此次未重跑宽覆盖测试，未提交、推送或整平台部署。目标收口等待 I34 裁定及共享候选稳定；此前独立预检、定向测试和宽覆盖证据仍按各自范围保留，不能替代尚未完成的 RI 验收。

## I34 裁定实施与业务引用释放

作者回复「按你推荐来做」，采用原快照方案。fresh 不再重新解析档位或预留新版本；保留原 compute、镜像、初始化、材料与凭据版本，生成新的执行身份、nonce 和原生目录，清除 resume 会话参数。已有停用镜像通过原引用复制；缺引用、固定凭据撤销、卷 UID 改变均拒绝。RFC027 design §7～8／BE-15 已按该裁定同步，历史的“fresh 可换修订”记录由此取代。

- 回归先红：3 项失败分别证明新档位漂移、停用镜像被重新准入、原引用缺失仍允许重试。修复后的 fresh/resume／命令重试／Agent 镜像组合 **15 pass／0 fail／136 assertions**，真实隔离 PG，日志 `/tmp/cs-rfc028-fresh-complete.log`。
- 发现业务关闭无释放镜像引用的接线，用例先红后绿。关闭操作先等父容器物理释放及 Agent 资源释放，再幂等释放引用；失败保留操作，重建模块后仍可继续。暂停保留引用。原生命周期／引用目录／平台端口组合 **12 pass／0 fail／88 assertions**；追加 live Pod／暂停与恢复组 **13 pass／0 fail／104 assertions**，日志 `/tmp/cs-rfc028-cleanup-green.log`、`/tmp/cs-rfc028-cleanup-complete.log`。
- 本批定向 ESLint、全仓 TypeScript 通过；架构检查通过。共享全仓 ESLint 仍有并行 inline import 类型写法，最新检查为 28 项。未重跑全量测试，也未提交、推送或整平台部署。跨任务协调已向作者请求授权，尚未发送消息。
- T11 仍未完整完成：未确认保留租约没有所有者稳定终结证明时继续保护，不能仅按超时时间删除；这不等于自动回收已实现。RI-01～28 的平台完整验收仍待执行。

## 并发准入未采用引用的回收

真实 PostgreSQL 并发屏障复现父任务、Agent 与 fresh retry 三条路径：三个同键请求分别预留镜像，数据库只采用一个候选，其余两个引用原先没有释放。三项先红后绿。现在准入返回已存在的另一候选时释放当前候选引用，明确事务拒绝亦释放；同一已受理身份、429 后续派发重试、未知 COMMIT 回执则保留，不把单次查不到或超时当成未提交证明。Runner 能力预检和凭据物化移到引用预留前，避免已知准备失败留下引用。

定向组合 **31 pass／0 fail／244 assertions（9 files）**，含父子并发、fresh/resume、关闭清理、生命周期和平台端口；日志 `/tmp/cs-rfc028-admission-final.log`，覆盖文件 `/tmp/cs-rfc028-admission-coverage/lcov.info`。方法级负例证明 `COMMIT response lost` 保留引用，未配置释放端口不能伪报成功。定向 ESLint、全仓 TypeScript、架构检查通过；共享 index 为空，未提交、推送或部署。

保留限制：进程在预留后中断、或撤销调用本身失败时，仍须所有者稳定证明及持久恢复流程；本批仅补明确未采用候选的回收，不宣称已实现所有过期租约自动清理。RFC027 任务的当前句柄仍为 active/inProgress，正在补真实 Agent 能力验证；跨任务协调授权尚未收到，未向该任务发送消息。

## 获批跨任务协调与所有者终态对账

作者「批准」已授权与 RFC027 任务直接协调；双方共享候选尚在实现，约定不并发全量门禁、Git 发布或整平台部署。此项替代上文未授权的历史状态。

- 新增只读所有者端口和每轮 20 条的游标扫描。过期只触发查询，不是删除依据；active、unknown、缺记录及查询异常均保留。仅 released 证明允许在摘要锁内重读、比较完整引用内容后删除；并发确认或替换使旧候选失效。
- 业务所有者由 RFC027 提供：父任务不可逆 closed、关闭操作清空，Agent 还要求 runtimeReleased；父仍开放时已结束 Agent 继续保留用于 fresh/resume。
- 开发所有者由 task-runtime 提供：匹配项目、版本与类别，父开发会话已经不可恢复地 released、相关资源台账期望 absent、实际 Pod 消失后才给 released。failed、正在回收、仍有 Pod、父可恢复的已结束 Agent 均保持保护。平台组合根先查业务所有者，仅 unknown 才查开发所有者；任一查询失败不继续猜测释放。
- 真实隔离 PostgreSQL 定向组合 **19 pass／0 fail／120 assertions（6 files）**：平台实际装配、两个所有者查询、分页、确认竞态、用途验证与停用删除、受管模块。日志 `/tmp/cs-rfc028-reference-final.log`。开发物理边界使用假 Kubernetes，不能算实机 Pod 验收。
- 全仓 TypeScript、架构检查与本批 ESLint 通过：`/tmp/cs-rfc028-reference-final-types.log`、`/tmp/cs-rfc028-development-reference-arch.log`、`/tmp/cs-rfc028-reference-final-lint.log`。平台接线严格保持 600 行上限，新增 runtime-images 子目录符合结构门禁。console 生产构建通过，日志 `/tmp/cs-rfc028-console-production-build.log`。
- 发布历史引用继续保留用于回滚；没有稳定所有者的未知准入仍保守保留，不宣称存在按 TTL 自动清理孤儿的能力。未执行新的完整候选门禁、提交、推送或整平台部署；T14/T15、RI-01～28 的完整平台验收仍未完成。

## 真实仓库已有镜像登记验收

使用本机实际 `crewstation-system/registry`，通过仅监听 127.0.0.1 的临时 port-forward 读取 `verify/hello:1`。模块目录／构建／验证／引用状态写入独立临时 PostgreSQL；Kubernetes 与准入权限仍是测试替身，未部署控制面、未执行服务或生产迁移。本次新增可重复执行的 `modules/runtime-environment/tests/liveRegistry.test.ts`，显式设置 `CS_RUNTIME_IMAGE_REGISTRY_URL`、`CS_RUNTIME_IMAGE_REGISTRY_REFERENCE`（可选 `CS_RUNTIME_IMAGE_REGISTRY_ARCH`）；未启用时会说明跳过，不冒充真实仓库证据。

真实 HTTP 响应字节解析结果为 `sha256:958919c03188d53691a706915dfed8a4081e0d66254eb73e8993f8bf00376f47`、`linux/arm64`。source=existing 修订固定此摘要，登记成功且 builder／SCM／包／推送凭据调用为 0；服务验证明确 `service-contract`、没有伪造 observedImageId。已确认发布引用阻止停用版本退休；释放引用后逻辑退休成功且 physicalDeletion=pending-maintenance，真实仓库摘要仍可读取。实际产物使用错误架构以及非授权前缀都被拒绝。

结果 **1 pass／0 fail／13 assertions**，日志 `/tmp/cs-rfc028-live-registry.log`。类型、架构和新增用例 lint 均通过，日志前缀 `/tmp/cs-rfc028-live-registry-{types,arch,lint}.log`。临时测试库已删除、port-forward 进程已结束；无仓库写入或集群资源变更。此证据补强 RI-05／RI-18／RI-23 的 registry 子链路，不代表 service 真正运行、源码平台构建完成或这些 RI 全项通过。

## 原样生成脚本的真实源码构建与 frontend 修复

专用命名空间 `cs-rfc028-source-probe` 内运行本任务生成的 Git 智能 HTTP 夹具和临时 registry（全部 emptyDir，不接业务 PVC）。`runtimeImageBuildPlan`、`imageBuildJobObject` 原样生成 checkout／rootless daemon／buildctl 命令，未用手写替代构建脚本。实际 SHA256 源码指纹保存在 `/tmp/cs-rfc028-source-probe-code.sha256`，验收后复核三文件相同。

首次实际构建失败，明确暴露 `build-arg:BUILDKIT_SYNTAX=` 在 BuildKit v0.33.0 中会被当作无效外部 frontend 引用，报 `invalid context name : invalid reference format`。保存原失败 Job／Pod／日志，未因等待超时直接重建。回归断言先红，随后移除空参数；继续使用固定 `--frontend dockerfile.v0`，既有 AST 拒绝 `#syntax`、契约拒绝用户 `BUILDKIT_SYNTAX` 的限制保留。脚本／Dockerfile 策略／契约回归 **13 pass／0 fail／72 assertions**，日志 `/tmp/cs-rfc028-source-frontend-{red,green}.log`；定向 lint、架构通过。

修复后的独立执行 `01a0e204-d3a1-7000-9dca-0490f05e050c` 成功：

- Job UID `c26e378e-1123-455c-a1bd-893d2120e649`，Pod UID `b3964df4-e7f8-49a6-8d31-1a1f57835f88`；checkout、buildctl、buildkitd 均 exit 0，实际架构 linux/arm64。
- 夹具 main 已移动到 `c43d36fffb1d7a6fd60f5eccff1fd60fcf4083dd`，checkout 仍检出受理的 `441eb9668f2b76c29bc5a155fbff3a77548bac4b`。最终镜像 marker 为 `accepted-commit`；上下文清单只有 Dockerfile／marker，没有 `.git` 或凭据文件。
- 多阶段 RUN／COPY、BuildKit package Secret mount、临时 registry push 成功。工具结果为 `tools-ready`；逐层下载并复核层摘要、解压检查，最终层和 buildctl 日志均无测试 canary 凭据。此处没有使用生产凭据。
- 实际 Pod 收据经 `observeImageBuild` 解析，再由真实仓库适配器核对为 `sha256:f0e9a2297156b81d0b44d773f2d3fbb35a791767451190b10bf9ae0df2f492e0`；未信任 Dockerfile 日志作为产物身份。
- 完整证明 `/tmp/cs-rfc028-source-probe-proof.json`，实际对象 `/tmp/cs-rfc028-source-probe-observed.json`，日志 `-checkout.log`／`-client.log`／`-daemon.log`，失败原件 `-failed.json`／`-failed-client.log`／`-failed-plan.json`。

临时 port-forward 已关闭，整个命名空间已确认删除，两个 Job／Pod、Git 夹具、临时 registry、测试 Secret 与 emptyDir 随之清理。前后原有 **62 个 Pod/PVC UID 全部保持**，无新增外部对象，证明 `/tmp/cs-rfc028-source-probe-cleanup.json`。

本次证明真实生成脚本、固定源码、rootless 多阶段构建、包 Secret mount 和产物收据／仓库内容；Git 及 registry 是隔离测试服务，不是平台 GitLab 短期令牌、受管推送网关鉴权或 API→资源台账→controller 全链路。RI-04／13／16／17 的这些子项已有实机证据，完整平台 RI 验收仍继续，不将本探针冒充整平台部署完成。

## 构建推送凭据的跨仓库挂载边界

核对网关时发现旧 `registryDecision` 忽略查询参数，只验证目标仓库写权；Distribution 的 `POST .../blobs/uploads/?mount=<digest>&from=<repository>` 还会读取来源仓库。[官方 API 规范](https://github.com/distribution/distribution/blob/main/docs/content/spec/api.md) 要求调用方具有来源读取权限。已先红后绿补齐来源校验、缺失／重复 from 与 mount 拒绝；没有尾部 `/` 的只读仓库精确匹配，显式尾部 `/` 仍表示前缀。普通上传与允许底座挂载不受影响。

- 签名／路径与原档位模块真实隔离 PG：**19 pass／0 fail／130 assertions**，`/tmp/cs-rfc028-registry-mount-green.log`；原失败 `/tmp/cs-rfc028-registry-mount-red.log`。
- 新增 opt-in `modules/agent-runtime/tests/liveRegistryMount.test.ts`，环境变量 `CS_REGISTRY_MOUNT_ACCEPTANCE_URL` 必须指向本机一次性 registry，未启用时明确说明跳过。本次独占 Docker registry 3.1.1 使用 127.0.0.1:31530 与 tmpfs，测试签发实际构建凭据、运行实际 `/forward-auth/registry` 路由，用临时 HTTP 转发器连接真实 registry。
- 允许底座来源返回201并读取同一 blob；另一项目来源、无来源及重复来源返回403且转发计数不变，目标 GET 私有 blob 为404。对照请求直达一次性 backend 能完成同样挂载（201），证明拦截来自来源权限校验，而非 registry 不支持此操作。普通上传202、过期401及Basic质询保持。
- 实测 **1 pass／0 fail／11 assertions**，`/tmp/cs-rfc028-registry-mount-live.log`。测试 HTTP 服务关闭，`cs-rfc028-mount-probe` 已停止并因 `--rm` 自动删除，内存 blob 随之清理。未操作共享仓库或集群。
- TypeScript、架构、本批 lint 通过，日志 `/tmp/cs-rfc028-registry-mount-{types,arch,lint}.log`。此证据覆盖真实鉴权路由＋registry 的 mount 边界；转发器不是部署中的 Traefik，仍不能视为完整平台推送入口的实机结论。

## 真实资源台账与控制器构建闭环

在独占 `cs-rfc028-ledger-probe` 命名空间和一次性 PostgreSQL 内，实际装配 `runtime-environment`、`resources`、`cluster-control`；使用真实租约、台账变更流、Kubernetes list/watch、Secret／Job 渲染、构建 worker、registry HTTP 字节校验。Kubernetes 适配器对写操作强制限定本命名空间，孤儿回收关闭。Git 和 registry 为本次临时服务，权限／SCM 凭据与网络隔离前置检查仍为测试端口，不代表平台身份、GitLab 或 Traefik 验收。

- 受理源码 SHA `b7af8089bb514673a33ed286984fd6ca6d67a70d`；构建 `01a0e215-bb77-7000-8cca-094da3225da2` 经 queued→preparing→building→inspecting→succeeded，约18秒。版本摘要 `sha256:d5b7be0a329308df6703fd5d6230a97d495cacbe4a70e66f75c249cd937f14bd`，实际 arm64 多阶段 RUN/COPY、包 Secret mount 与 push 完成。
- 同项目活动构建上限为1；第二个不同请求键得到 `quota_exceeded`。成功产物登记后活动数为0，资源记录 `stopped/absent`，实际 Job 消失，所签发测试 Git 凭据全部撤销。
- 第二次构建 `01a0e216-027b-7000-954a-2ba4c6ad76b8` 的 buildctl 已实际运行，Pod UID `c3e1dbf5-32c5-4f2a-a6eb-dbc991fafb73`。停止并重建控制器实例，随后提交取消：立即仍占1个活动名额，直到实际 Job／Pod／Secret 消失后才变 cancelled 和活动数0。该构建没有生成新版本，两条台账均 `stopped/absent`。
- 探针结束时构建 Job=0、Secret=0，只有独立 Git／registry 两个支持 Pod；两个签发测试凭据ID均有撤销记录。所有 workers／controller 已停止，一次性测试库已删除。日志 `/tmp/cs-rfc028-ledger-probe.log`，包含记录、状态和观测统计的证明 `/tmp/cs-rfc028-ledger-probe-proof.json`；执行脚本 `/tmp/cs-rfc028-ledger-probe.ts`。

该链路补齐 RI-14 的真实额度／物理退额和 RI-15 的运行中取消／控制器重启子项；未测试真实进程崩溃、deadline或整平台HTTP鉴权，不将其当作全部RI完成。清理结果以 `/tmp/cs-rfc028-ledger-probe-cleanup.json` 为准。

清理复核完成：临时 registry port-forward 已关闭，命名空间已删除；前后原有 **62个Pod/PVC UID全部一致**，无探针遗留。该证明与 RFC027 同时运行的停止屏障探针互相区分命名空间，不把对方正常清理误判为业务资源变化。

## RFC027／028 共同冻结候选的首次完整门禁

双方冻结生产／测试候选后，由 RFC028 会话独占执行完整 static＋unit／module／console 三层覆盖率。全文件 SHA256 快照 `/tmp/cs-rfc027-028-final-gate/candidate.json`；运行中只变更 README 和 proposal 基线三件套四份文档，没有生产／测试候选变化。分层审计 `audit.json`：无遗漏用例文件，无禁止跳过。

| 检查 | 结果 |
|---|---|
| 架构 | 58单元／2781源码文件，通过 |
| static | lint 10项阻断（类型导入9项、函数行数1项）；链后类型检查未执行，待修后补齐 |
| unit | 836 pass／0 fail，5086 assertions，192文件 |
| module | 1655 pass／9 skip／5 fail，9503 assertions，315文件 |
| console | 925 pass／0 fail，6385 assertions，141文件 |
| 改动行防护 | 7907／8084＝97.81%，但两个可执行文件未被加载，因此尚未通过 |

5项模块失败均关联新增 `business-execution-v3` 模板的缺失元数据及目录期望；两处未加载为 `modules/business-task/domain/executionSubtask.ts` 和该模板的 `src/migrate.ts`。RFC027 会话承担这批定向修复，不以跳过／覆盖例外消除失败。成功的完整层保留，修复后按影响补验；该结果不能写为完整门禁绿色。

9项跳过分别是3个真实Prometheus、两个opt-in registry、真实K8s、两个原生CLI以及Linux Ctrl+C。数据库明确 `CS_TEST_REQUIRE=database`，没有因数据库不可达漏跑。两个registry已在本RFC前文独立真实执行；其他跳过继续保留其证据边界，不计作本轮通过。

后续集成验收分成五组，部署完成后在专属新项目中执行：实际平台源码／已有镜像构建与受管推送（RI04/05/11–17）；任务／Agent用途组合及初始化（RI02/03/06–10）；服务与业务v3绑定／回退恢复（RI01/18–24，由RFC027业务验收协调引用同批镜像）；开发父容器／Agent／CLI独立选择和保卷恢复（RI27/28）；真实浏览器与完整清理（RI25/26）。不得把前文子链路预检替代这些集成步骤。

上述门禁问题已定向闭合：RFC027模板元数据／目录断言12/0（68 assertions），行为补测15/0（136 assertions）；启动日志提取8/0（53 assertions），驱动类型导入后的现有回归19/0（55 assertions）。补跑完整 `check:static` 通过（arch／lint／根类型／console类型），console生产构建通过。完整三层成功结果与这批受影响文件定向结果组合，形成当前发布候选验证证据；未再次运行相同全量测试。

最终改动行防护 **7929／8102＝97.8647%，473个生产文件，violations=[]**。依据候选SHA256识别修改文件，删除这些文件的旧全量行号记录，仅采用修复后的定向coverage；未变文件沿用完整三层coverage，避免类型导入／函数提取导致旧覆盖错位。脚本 `/tmp/cs-rfc027-028-release-patch.ts`，报告 `/tmp/cs-rfc027-028-release-patch.json`；静态日志 `/tmp/cs-rfc027-028-final-static.log`，前端构建日志 `/tmp/cs-rfc027-028-console-build.log`。定向coverage分别在 `/tmp/rfc027-gate-template-coverage`、`/tmp/rfc027-gate-behavior-coverage`、`/tmp/cs-rfc027-028-final-startup-coverage`、`/tmp/cs-rfc027-028-final-driver-coverage`。

两会话已约定由RFC027会话在唯一窗口精确发布共同候选，保留完整并发输出与真实贡献署名；第三方 `tests/e2e/referenceResources.test.ts` 明确排除。此刻尚未提交／推送／精确SHA CI或部署，部署后RI仍待执行。

## 共同发布、本地部署与真实平台首轮（2026-09-27）

共同候选已发布为 `73855918d43ea0fe608ad08a453cee016b0a02dc`（735条精确路径，含两会话并发产物，第三方 referenceResources 未纳入）。[精确 SHA CI 36309067072](https://github.com/wangbinquan/CrewStation/actions/runs/36309067072) 六个作业 static、unit、module、console、gate、e2e 全部成功。本地版本 `rfc027-028-73855918` 由 RFC027 会话统一部署；8个 Deployment 就绪，33项迁移与角色初始化成功，备份可解码，原非平台 Pod／PVC 46个 UID 未变。上述部署资源证明由协调会话提供；本会话独立核对了精确 SHA CI。

真实平台专属项目 `rfc028-images-20260927`（`01a0e231-5614-7000-be6b-82ee33fb22ba`），仓库分支 `rfc028-images`、固定 SHA `2283600436f0afa798b860447daa022136f40f71`。全部通过真实登录后的公共 API 创建；原算力档位不变，复制独立档位、100m测试套餐并限定项目可见。为释放节点容量，仅下线本项目自动生成的待命服务。

- 首次源码构建 `01a0e233-be54-7000-8ea1-bed35fe66126`：多阶段编译、pip PyYAML、npm CJS／ESM、脚本与动态链接二进制均在 worker UID10001 下输出预期结果；最终推送 HTTPS 返回 Traefik 404，因此构建正确登记 failed，没有可用版本。完整分页日志 `/tmp/cs-rfc028-platform-parent-build-full-logs.json`。
- 根因是 `41-registry-gateway.yaml` 的内部域名只在 HTTP 路由，TLS 路由遗漏。新增 `registryGateway.test.ts` 先1 fail，修复后连既有网关回归3 pass／31 assertions，定向lint通过；协调窗口仅 apply 此文件，只有 `registry-push-tls` 改变，没有滚动平台 Pod。真实 push 仍待后续构建确认。
- 重试构建 `01a0e23c-e914-7000-b001-18ccfc1214d6` 在 checkout 的 git fetch 停滞；同 Pod 禁用凭据的新 Git 请求可快速收到401。为释放共享容量，经公共取消接口停止，不能将网络诊断或路由单测计为 push 成功。
- 真实 API 七项负向检查：绝对 context、父级遍历、保留底座参数、自定义 frontend 参数、外部 registry、不存在绑定、非平台任务底座均返回4xx，配方数量仍为1。证据 `/tmp/cs-rfc028-platform-preflight.json`；不存在绑定的404不等于双项目隔离已验收。
- 实际项目设置运行镜像列表在320／390／1440px下整页宽度等于视口，零console错误；截图已人工查看，窄屏表格保留内部横向滚动。证据 `/tmp/cs-rfc028-platform-ui.json` 与相应PNG。此处仅列表布局，尚非RI25全部对象选择／键盘／日志路径通过。

Agent档位真实能力测试另暴露 RFC027 probe 在 schema 补缺省值前计算摘要的问题，由 RFC027 会话修复并独立复验。完整 RI01～28继续保持未完成，不以提交、CI或部署成功替代。

取消终态补证：09:44:26 `cancelling`→09:44:58 `cancelled`，归属标签下 Job／Pod／Secret全部为0；`/tmp/cs-rfc028-platform-cancel-build.json`记录真实API状态。真实UI后续通过键盘Enter打开配方、Escape回到「新增构建修订」，弹窗三宽分别[16,304]／[16,374]／[420,1020]且内部不溢出；分页续读失败构建直到404尾部，console错误为空，见`/tmp/cs-rfc028-platform-ui-interactions.json`。独立GitLab分支推进至`213b07686be79a81a5c333b8a81b8f7ceb8d1336`后，原配方仍固定`228360…`，自定义frontend实际拒绝。额外COPY素材被保存为未构建修订2；RFC的路径预检针对context／Dockerfile及源码链接，不把COPY指令未提前拒绝误判为承诺违约。

TLS修复后的整平台构建已成功：`01a0e245-2543-7000-baf3-84967051278a` 在09:55:26 UTC登记版本`01a0e24a-78f7-7000-8b99-fbc0cc97fe86`，仓库manifest摘要`sha256:f19e42be27ac695355e655f2fa2f7c2794d7cb90c4833466b95f84d8471ab77e`。链路为真实登录API→固定GitLab源码→独立BuildKit→受管HTTPS鉴权推送→停止资源→registry检查→版本登记。完整状态与版本在`/tmp/cs-rfc028-platform-parent-rebuild-final.json`。本配方仍按受理时旧底座固定；发现部署遗漏的CS_BASE_IMAGE_TAG后，协调会话已同步新版标签并滚动API/controller，新Runner用途验收将使用新配方，不篡改已受理快照。


## 工作台完整流程修复（2026-09-27，尚未发布／部署）

作者指出新增只有空定义、管理信息难以理解、无法追溯使用任务。本批按 design §9.1 实施：项目与平台目录均可新增，首份配方和镜像定义原子保存、请求幂等；构建受理单独重试，失败不重复创建定义。配方提供 Dockerfile 安装说明，Agent 底座按名称选择当前修订。目录分开展示构建、产物及验证，详情含版本、构建日志、使用记录、名称／说明／启停和配置。开发选择与使用记录展示名称／短摘要，内部编号放入高级项。

使用记录新增只读端口，task-runtime／release 各查自有持久快照，经 platform 合并、分页；项目隔离先于查询，已释放环境和失败／下线发布仍可见。防删除引用不再冒充执行历史，档位／用途验证环境不混入业务使用。全镜像和指定版本均可追溯，详情链接落调用链或精确发布。

定向证据：镜像与任务列表 console 19/0（83 assertions），实际 PostgreSQL 新增与历史5/0（33 assertions），端口／API-client4/0（22 assertions）。首次沙箱数据库连接被限制，该次0/3 errors不算通过；允许本机连接后在独立临时库复验通过。contracts:lock报告业务契约面无变化；新增0003创建幂等迁移已精确入锁。

真实 Chrome 的临时预览（HTTP测试数据，**不是已部署平台验收**）：中英文320／390／1440无文档溢出，新增弹窗边界[16,304]／[16,374]／[420,1020]，Escape回到新增按钮，零控制台错误；管理员实际通过选择项目→填写名称／已有镜像来源→保存并构建表单。历史三宽截图、JSON位于`/tmp/cs-image-ux-*`。查看截图后修正fieldset默认边框／间距并复验；临时Vite与两个入口文件已清理。最终候选检查见下段。任务恢复页仅接通实际任务列表、失败优先与相关旧票据排障；RFC029恢复请求执行尚未接通，不宣称恢复完成。


最终候选核验：完整 `check:static`（架构、lint、后端类型、console类型）与 console 生产构建通过。unit **838/0，5105 assertions**；首次 module **1672 pass/9 skip/1 fail，9640 assertions**，唯一失败是租户档位摘要新增 revision 后的精确字段断言，保留敏感字段排除并补 revision 正整数断言，真实PG定向 **16/0，103 assertions**。没有重新运行整层 module，也不将首次失败报告写成全绿。首次 console 4 fail 涉及动作链接规范、运行中候选变更及并发集群布局断言；本批动作链接和权限查询已修正，集群用例由其所属会话更新。本批最终候选冻结后完整 console **934/0，6432 assertions，142文件**，本批代码哈希未变化。

复核另补旧 native 执行未保存 purpose 的兼容：先红证明历史误标 Agent，改为复用领域 purposeOf 后真实PG **1/0，8 assertions**，旧记录显示 CLI。本批67条精确路径（含未跟踪新文件）新增代码防护 **563/567＝99.2945%，47生产文件，violations=[]**；更新过行号的历史适配器只采用修复后的定向覆盖。报告 `/tmp/cs-image-ux-patch.json`，最终代码快照 `/tmp/cs-image-ux-final-candidate.json`，日志 `/tmp/cs-image-ux-{unit,module,profile-repair,history-final,console-final,static-final,build-final}.log`。共享 contracts 导出等文件保留 RFC027 并发输出，第三方集群布局与 referenceResources 不纳入本批清单。尚待统一提交／精确SHA CI／部署，RFC028实机矩阵与RFC029真正恢复执行仍未完成。


## 2026-09-27 详情弹窗与平台归属纠正

- 作者重申点击详情必须为统一弹窗或新页面。业务恢复任务详情、项目／平台运行镜像详情复用 Dialog，不再追加于长表尾；关闭保持筛选、分页、滚动与焦点。嵌套确认 cancel/close 阻断 React portal 冒泡，避免一起关掉父详情。
- 定向 console 46 pass／0 fail／233 assertions（6 文件）；5 个生产文件新增可执行行16/16覆盖；console 类型、定向 lint、生产 build 通过。日志 `/tmp/cs-detail-dialog-final-tests.log`、`/tmp/cs-detail-dialog-build.log`；覆盖 `/tmp/cs-detail-dialog-coverage/lcov.info`。
- 实际 Chrome，实际组件＋HTTP 替身，30任务末行＋20诊断记录：中英文、明暗、320／390／1440，12组；另项目／平台镜像详情2页。弹窗在视口内、正文内部滚动、嵌套确认Esc只关顶层、关闭恢复末行焦点和原滚动位置，零控制台错误。证据 `/tmp/cs-detail-dialog-browser.json`，截图 `/tmp/cs-task-detail-{lang}-{theme}-{width}.png`。验收临时入口已删除，Vite已停止。尚非部署后的页面证据。
- 持久约束写入 AGENTS.md、开发规则 §7、testing.md，包含长列表末行用例要求。
- 运行镜像平台归属／业务授权按 `platform-catalog-amendment.md` 继续实施；本批弹窗修复不代表授权模型已完成。

## 2026-09-27 弹窗最终部署与统一能力界面在制批

弹窗18路径已经提交推送为 `33ec331399d87eacf7e36d1d4f1fed342474bba7`，精确SHA CI六作业全部成功（run `36315539477`）。console镜像`cs-console:dialogs-33ec3313`，实际imageID `sha256:1a61c2c11a7b26339eb6d02765f86547f78e56d2539734e64bf12fdf990ec951`，Ready1／restarts0。后续部署验收真实API任务详情12组及镜像嵌套Esc／焦点恢复成功，零业务写入、零浏览器错误。交付回执 `/tmp/cs-detail-dialog-delivery.json` 和 `/tmp/cs-detail-dialog-live.json`，覆盖上一节的“尚非部署证据”。

新授权批尚未提交／部署：运行镜像列表与算力档位共同使用 `CapabilityCatalog.module.css`，列表密度、状态／操作区、窄屏卡片布局统一。业务资源页运行镜像授权与算力授权并列，用同一多选CSS和Card／Stack／ActionRow；明确继承／指定范围、空集合禁止、保存后修订更新、冲突保留草稿、统一丢弃确认。后端0004迁移保存业务镜像策略；直接版本读取和新准入均校验有效范围，分页前过滤；与策略写入同锁，已接受快照回执及原引用恢复保持。

- 先红确认策略HTTP入口缺失、策略方法未接线；真实PG＋客户端最终20/0（128断言），包含非管理员拒绝、非法／重复ID、空集合、分页、直传版本绕过拒绝、并发CAS与撤销后新准入／原引用差别。
- console定向组合28/0（127断言）；具名选择、空集合、身份变化、读取失败、冲突、取消丢弃及跨100条目录页选择均覆盖。
- 真实Chrome，实际组件＋HTTP替身，目录／授权×中英文×明暗×320／390／1440共24组通过；样式类／字号相同、无文档横溢出、窄屏布局在视口内、丢弃弹窗Esc保留草稿，零浏览器错误。证据 `/tmp/cs-capability-browser.json`、`/tmp/cs-capability-{catalog,grants}-{lang}-{theme}-{width}.png`；临时预览入口和服务已清理。
- 本批还保留原项目所有权与平台新增所属项目步骤，继承策略兼容旧可见范围；仅为平台归属迁移的先行授权基础，不代表作者最新目标完成。禁止将它单独描述为平台目录已整改。平台目录／版本归属、源码来源与构建资源分离、全局管理接口、业务只读入口、授权业务与全局历史仍需继续。

本在制批最终全仓 `check:static` 与 console 生产构建通过（`/tmp/cs-capability-final-static.log`、`/tmp/cs-capability-final-build.log`）。这不替代后续平台归属迁移完成后的整体验证；当前未提交部署。

## 2026-09-27 平台归属与统一目录候选

本节替代上一节“仍保留项目所有权”的在制状态，尚未提交或部署。0005 移除 images／versions 项目归属；旧私有镜像只保留原业务授权，shared 转默认开放，旧 ID／digest／引用不变。配方保留源码业务及初始化凭据边界；旧构建保留原资源计划，新构建使用平台命名空间、独立 registry 前缀和平台额度。0005 尚未发布、仅在已清理的隔离测试库执行；为修正架构扫描对 SQL 别名的误判，将本次新迁移改成等价相关子查询，并手工更新其未发布锁摘要，旧迁移未改。

平台管理路径扩展 `/v1/admin/runtime-image-catalog`；新增不要求所属项目，已有镜像登记无需来源业务，源码构建才选择具名来源业务。业务页没有新增／编辑入口；业务写 API 不能靠 develop 权限绕过平台管理。默认范围、业务受限策略、旧授权保留共同计算有效范围。详情显示授权业务与资源配置链接、全局实际执行历史；业务历史和引用详情强制本业务。验证依然明确选消费业务，使用其授权、凭据和额度。

镜像与算力共用目录样式、搜索、新增位置及窄屏结构。版本用途／历史和构建日志统一使用嵌套 Dialog，不在列表后追加。管理表单可保留草稿，新增重试继续原请求，业务授权修改保持 OCC。

- 镜像模块与关联 PG／API 客户端／算力凭据组 71 pass、1 skip、0 fail，482 assertions（21文件）；唯一 skip 为未配置真实 registry 地址的专项，不能作为真实构建证据。`/tmp/cs-platform-catalog-suite.log`。
- 新平台 API／授权／迁移专项 7/0，68 assertions；升级用例核对旧私有与共享范围、初始化 Secret 来源、旧构建现场、创建请求命名空间、版本摘要和执行引用。`/tmp/cs-platform-catalog-newtests.log`。
- console 原组合27/0、124 assertions，新增平台新增／业务只读／授权入口／三层验证弹窗后工作流10/0、51 assertions。`/tmp/cs-platform-console-tests.log`、`/tmp/cs-platform-workflow-newtests.log`。
- 平台端口／持久执行历史／构建台账补测通过，`/tmp/cs-platform-image-ports.log`。首次全仓 static 通过；候选后续增加授权锁后二次校验和业务引用隔离，仍需最终门禁、行覆盖、浏览器验收与部署实测。
- 最终实际Chrome组件＋HTTP替身12组（中英文／明暗／320、390、1440）全部通过，零浏览器错误；同目录样式、视口边界、不要求所属项目、业务授权资源入口、三层弹窗逐层Esc和焦点恢复均核对。证据 `/tmp/cs-platform-image-browser.json` 和 `/tmp/cs-platform-catalog-{lang}-{theme}-{width}.png`。前期脚本在异步详情加载时点击错位，改为等待真实数据与稳定布局后通过；临时预览及服务已清理。生产build通过，`/tmp/cs-platform-image-build.log`。完整本地门禁执行中，不能视为已经发布。
- 最终候选定向覆盖组108 pass／1 skip／0 fail、676 assertions；算力与业务资源补充14/0、140 assertions，双语键对账通过。96路径候选，64个生产文件新增可执行行563/565＝99.646%，violations=[]。报告 `/tmp/cs-platform-image-patch.json`，代码快照 `/tmp/cs-platform-image-candidate.json`，路径 `/tmp/cs-platform-image-paths.txt`；包括本会话所有平台归属、授权、界面与迁移改动，不包含并发市场实现和共享Dialog修复。
- 全仓静态与生产build已绿。一次完整 `CS_TEST_REQUIRE=database bun run check` 使用默认密码模式，当前本机只开放OIDC，实机用例落在登录页导致失败；原门禁继续至终态，不重跑整个门禁。用既有已授权dev-admin、`CS_E2E_AUTH=dev-oidc`、CDP9368定向重验两个失败文件为28 pass／2 skip／1 fail、107 assertions；剩余是当前部署拓扑清单未含查询所得Pod UID，与平台镜像候选无代码重合，不修改该用例或用户资源来制造绿。日志 `/tmp/cs-platform-image-full-check.log`、`/tmp/cs-platform-image-e2e-auth-recheck.log`。此证据是旧部署的环境排查，不是新镜像模型部署验收。
- 正确OIDC登录补查6个布局文件为34 pass／1 fail、329 assertions（`/tmp/cs-platform-image-e2e-layout-recheck.log`）。算力相关布局、集群布局与紧凑表格、外壳滚动、平台设置均通过；剩余成员角色旧断言从main读取文字，而角色已在统一Dialog中，未改无关测试。已有本任务工具与服务镜像的验证状态仍为passed（只读复核），不将历史验证当作新平台模型的构建／部署证明。
- 原完整门禁自然结束：2854 pass／54 skip／140 fail、90 errors，16447断言、680文件、1311.28秒，退出1；session81831已结束。50个明确失败为48项默认密码登录下的实机失败、并发0013_app_icons.sql未入锁、并发projects图标英文键尚未补齐；另90项为运行中新增图标契约但旧Bun模块缓存没有APP_ICON_MAX_BYTES／validAppIconUrl导出的加载错误。正确OIDC的最后metrics复验4/0、48断言。没有以定向绿改写全仓失败。门禁前后本候选生产只变化公共contracts/index.ts（并发appIcon导出），本任务实现未变；该导出依赖另一个会话的未提交文件，已做必要发布协调，不删除导出、不绕过共享文件提交。
- 新进程加载当前契约后，镜像目录／工作流／业务授权／接口面锁4文件定向28 pass／0 fail、123断言，`/tmp/cs-platform-image-post-gate-targeted.log`。未重新运行全门禁；必要发布交接记录 `/tmp/cs-platform-image-publication-handoff.md` 已交既有授权窗口，当前等待共享契约依赖明确，未提交或部署。

## 2026-09-27 预构建服务与父任务真实运行补证

本节在已部署的旧项目归属 API 上完成，不是新平台目录／业务授权迁移的部署证明。共享候选发布仍等待图标契约与目录样式交接，未提交／部署本批。

- 原失败发布 `01a0e284-2097-7000-8a63-40a98afec963` 确认为用途验证不匹配。重新验证原有工具版本 `01a0e27f-4ef9-7000-bd34-538122dfbb26`，验证 `01a0e2e7-b58f-7000-8bc7-b178d4afdebc` 通过：worker UID10001、Python YAML、Node CJS/ESM、脚本、二进制均成功；新task契约摘要与旧记录不同。服务版本 `01a0e280-fce1-7000-8d46-0be477b24995` 的新验证 `01a0e2e7-b5a0-7000-b278-8299fc64710c` 也通过，服务契约摘要保持。证据 `/tmp/cs-rfc028-refresh-validations-observed.json`。
- 固定源码 `bf452e72d431aad7a750946db80fd3f6a8df5f4f` 发布为 v0.2.2，release `01a0e2e8-7ef2-7000-8b2c-a3ae9c29c684` 实际ready，message为“使用已有镜像”。迁移Job退出0，输出 `RI_SERVICE_MIGRATION_COMPLETED`；迁移与service Pod实际imageID均为选定 `sha256:8bc0d325f8da1ba95fb1a39337755c3378e3ae04011848612324d6cd19818e66`，service Ready1/1、零重启。证据 `/tmp/cs-rfc028-service-runtime-proof.json`、`/tmp/cs-rfc028-platform-bound-release-ready.json`。
- 仅将本任务验收应用从空正式槽晋级，切换 `01a0e2ea-72a9-7000-a53a-88dfacb34c7d`，业务正常网关读取确认active、epoch3；未操作其他业务。首次浏览器新页误入空上下文返回401，改用原已登录隔离上下文后200，未复制Cookie、授予角色或伪造身份。
- 由真实业务 `/actions` 创建父任务 `01a0e2eb-876e-7000-8a97-bf5d06a95d17`。首次尚未ready时子任务412，同一requestKey在容器ready后继续，只有同一父任务。命令 `01a0e2eb-ec0d-7000-b05f-e558c7f140f7` 连续90秒，返回first/last、退出0，proof.txt内容preserved。父Pod实际imageID为独立工具摘要 `sha256:b8b7ea382910b483608c41db9b55f189a1f66358a11c7e3628f963359848575b`，不同于service。
- 暂停后原Pod物理消失；恢复后的Pod UID从 `0d522928-875d-4556-b11d-528dd6f9df95` 改为 `365c0fcd-9200-4d06-a921-e006b5a0c84a`，实际imageID不变、原卷UID `907826a7-edbe-44c0-acc0-d970e288f2ae` 不变、proof.txt内容及版本摘要不变。初始化记录从一行增加为两行，符合新Pod重执行、原卷保留；恢复后的generation3。证据 `/tmp/cs-rfc028-parent-{runtime-proof,resumed-runtime-proof,pause,resume,close}.json`。
- 已通过业务自身入口关闭这个验收父任务，最终closed、generation4，容器已物理回收；持久事件仍保留唯一成功命令结果，关闭后工作区读取412符合契约。服务保留运行用于后续同一验收业务。`/tmp/cs-rfc028-parent-command-observed.json` 为最终关闭状态。

本节补齐RI-18的真实成功发布／迁移／探针路径，以及RI-01的service与parent独立镜像、RI-08的新Pod初始化、RI-21同键重试、RI-22父任务原卷原镜像恢复子项。各RI的其他要求（不同Agent镜像、Agent实际工具调用、故障初始化、服务回退、权限变更等）仍须继续，不据此将完整RI或RFC标Done。

发布候选追加边界：上述运行验收期间，RFC031继续修改共享算力／镜像目录组件、文案与样式，迁移锁也出现其他任务内容。先前12组浏览器和28项定向仅证明当时快照，不能自动覆盖后来并发改动；需等待稳定交接，对最终共同页面补定向和浏览器验证。原96路径 `git diff --check` 通过，清单外ProjectListPage的在制空白未改动。

## 2026-09-27 独立 Agent 镜像与共享目录接续验证

本轮只操作既有隔离验收业务 `rfc028-images-20260927`（GitLab332）；没有更新其他业务或替换现有开发容器。算力档位 `01a0e236-f6e4-7000-a430-4799233e7f2f` 升到修订3，沿用已有凭据，底座固定当前 `rfc027-final-0c8be5fd` 摘要；测试 `01a0e2f3-75b9-7000-9b9e-4cc782164717` 的 model/events/resume/systemPrompt/skills/mcp 全部通过。

- Agent A 构建 `01a0e2f8-f969-7000-9a34-fd9952ef5cd1` 成功，版本 `01a0e2fc-4e15-7000-8737-7773cab4ef32`，摘要 `sha256:77ffe8bfa44f95d5874f168f8a3aeeb265831c3f29ecfca8c6da7de5b980bd5f`。Agent用途验证 `01a0e2fd-308d-7000-a45f-2d09be15b9a2` passed：UID10001、Agent协议和全部工具检查通过。该验证在Pod删除与控制面清理完成之间曾仍显示running，后续正常收敛passed，未重复创建。
- 同一Agent A版本的任务用途验证 `01a0e302-0588-7000-b5ff-29797b3fbbbb` passed。开始因节点CPU不足Pending，构建资源释放后正常完成；不能将调度等待判为镜像不兼容。以上仅证明复用的用途兼容性，实际父任务／Agent共同使用仍待执行。
- Agent B 首次构建 `01a0e2fc-bcb5-7000-af8f-9dba396fd3bd` 因 Debian node-webassemblyjs 下载503、apt退出100失败；一次显式重试 `01a0e301-924b-7000-bddf-56d3390ce8b3` 成功。版本 `01a0e304-bd22-7000-a856-da92d38a100e`，摘要 `sha256:4eea778bfe121e8a58b991f5690fa5237a534610bd2114501cec1f0c58a18934`。Agent验证 `01a0e307-f5ac-7000-9228-dde6437cba9d` 已受理且实际Pod imageID匹配，当前仍running，未宣称通过。
- 隔离验收服务新增明确的父任务／Agent镜像覆盖、子任务读取、产物读取及retry/resume操作入口；仅写入本任务GitLab332。源码SHA `8f85b6ce598189d45aaa8989694b501900abdd96` 的服务构建 `01a0e300-c2f9-7000-9f02-053542a66fb6` 成功，Dockerfile内 `bun build` 语法检查成功；版本 `01a0e301-4109-7000-9867-e94d908bcf3e`、摘要 `sha256:ad0b08d0f741737e6c8ec9b4ccff520ec16980eab3bd6fa1d7cd0e492977bfbf`。服务契约验证 `01a0e301-f669-7000-9be9-41af74fa2210` passed，但本版本尚未发布，实际启动／就绪须由发布探针确认。当前线上仍v0.2.2。

验证原始记录：`/tmp/cs-rfc028-agent-test-current-base-observed.json`、`/tmp/cs-rfc028-agent-a-validation-observed.json`、`/tmp/cs-rfc028-agent-a-task-validation-observed.json`、`/tmp/cs-rfc028-agent-b-image-observed.json`、`/tmp/cs-rfc028-complete-service-validation-observed.json`。Manifest候选已按契约解析通过，记录 `/tmp/cs-rfc028-agent-manifest-candidate.json`；未在Agent B验证通过前发布。

共享目录发生RFC031后续修改后的定向回归：runtimeImageConsole／runtimeImageWorkflow／projectRuntimeImages／computeProfilesPage四文件 **36 pass／0 fail、225断言**，`/tmp/cs-platform-image-shared-final-targeted.log`。共享UI最新112组浏览器矩阵由RFC031验收记录提供（实际SPA＋HTTP夹具，非部署后数据），不把原12组结果套用于后改动。完整发布仍待共享依赖和统一Git窗口，RFC028 T16–T18和完整RI未完成。

### 同轮后续：v0.3.0 发布、镜像复用与 Agent 准入修复

Agent B 验证 `01a0e307-f5ac-7000-9228-dde6437cba9d` 最终 **passed**，UID／协议／全部工具通过，取代上段running状态。四类绑定清单已在本任务GitLab332提交 `24fdcfcc7e682f838860d35ae3bb400b15483c61`；v0.3.0 release `01a0e30d-f204-7000-810e-68d3de3fbd35` ready并切入本任务活动槽，保留v0.2.2回退槽。新service实际Pod UID `c16c7158-9923-439a-a81a-ef8589a6224c`、imageID为ad0b08d0摘要、Ready且重启0；迁移Pod同摘要、Succeeded、日志 `RI_SERVICE_MIGRATION_COMPLETED`。记录 `/tmp/cs-rfc028-agent-bound-release-observed.json`、`/tmp/cs-rfc028-four-images-pods-current.json`、`/tmp/cs-rfc028-v030-migration.log`。

新父任务 `01a0e30e-e096-7000-be22-db3c8ecd4171` 默认采用b8b7ea38工具摘要，实际Pod UID `f748cdc5-645f-4982-96bf-835e648f38e1`，工具命令 `01a0e30f-3c89-7000-a6c2-2ee002e7bc7f` succeeded/exit0，输出UID10001、parent、三项ready、script-ready、worker:10001。真实产物读取返回对应57字节文件，记录 `/tmp/cs-rfc028-four-images-observed.json`。父任务选择B专属镜像返回400／runtime_image_not_allowed，不回退。

显式复用Agent A镜像的新父任务 `01a0e311-9ea9-7000-864f-4be0fe16c1b3` selectionSource=request，实际Pod UID `6f6f64fc-9181-40c9-be18-3d47146451e3`、imageID为77ffe8bf摘要。命令 `01a0e311-ff87-7000-8058-11657dd81783` succeeded/exit0，输出UID10001、agent-a及同样完整工具结果。关闭动作平台已完成，但验收应用记录响应时遇写屏障409；后续权威读取已closed，未重复创建／关闭。最终读取 `/tmp/cs-rfc028-reuse-parent-observed.json`，命令持久结果保留；工作区关闭后读取不可用符合约定。原四镜像主父任务保留等待Agent验证。

实际Agent提交与A选择B负例均暴露500：cs-api的ZodError是 `Unrecognized keys: "id", "name", "compute"`。根因为agentPlan将完整AgentProfile作为严格RuntimeImageSelection传给runtime-environment。仅修复 `modules/business-task/application/execution/agentPlan.ts`，向边界投影默认镜像和允许集合，不放宽schema。测试替身改为使用实际严格schema，先红复现500；修改后Agent选择／恢复／父任务三文件 **13 pass／0 fail、99断言**，定向lint与diff-check通过，日志 `/tmp/cs-agent-image-selection-red.log`、`/tmp/cs-agent-image-selection-green.log`。三路径已交唯一发布窗口，本地修复未部署；Agent A/B业务执行和A选择B拒绝实机仍待部署后同键复验，不把500当授权拒绝。当前子任务列表仅有已成功工具命令，失败Agent请求未产生子任务。


## 精确发布闭包与补充回归（2026-09-27）

原96路径补齐共享目录组件、根文案、路由／算力列表返回、对应测试、appIcon独立契约与测试、共享锁内0013迁移，以及Agent选择投影修复，形成118路径；保留完整并发输出，未扫入其余市场／图标实现。最新41/0、258断言；候选编译宿主按HEAD＋精确文件读取，后端与console均0诊断。两个完整check的非绿终态保留在STATE及原日志，不重跑或改写结果。

发布复核发现业务镜像页传search但业务目录SQL未过滤；新增真实PG回归先红，补为授权范围内、分页前按名称／说明匹配，三文件8/0、80断言，lint通过。Agent准入把完整profile误传严格镜像选择契约的修复，按既有交接三路径纳入，真实PG13/0、99断言。当前仅提交候选，精确SHA CI、部署迁移与实机回执另记；RFC028整体RI及T16–T18仍未完成。

## 发布后 CI 与跨业务验收准备（2026-09-27）

118路径已发布为 `4f3ee7f5fbce18486e11507f8da80d1b72638509`，包含完整共享目录依赖及搜索／Agent选择修复。精确CI `36323120743` 的static、unit、module、console、gate均success；e2e为63 pass／45 skip／1 fail，唯一失败是 `platformCapabilities.test.ts` 仍期待旧标题“运行镜像目录”，实际页面为已统一的“运行镜像”。不能称本提交六项全绿。发布会话随后单独修正断言并发布 `d2852b3274fc7d3e0179cad7b2adaa430ea3e1ae`（包含中间目录／图标提交6c5605c2），新精确CI `36323815806` 正在运行。平台部署尚未切换，当前未据此宣布迁移或Agent修复实机通过。

第二个专用隔离验收业务已新建并active：`rfc028-grants-20260927`，项目 `01a0e31f-a71a-7000-98d4-345a4c7170f9`。用于同一平台镜像跨业务授权／撤销验证，没有发布服务、没有修改其他业务授权。创建回执 `/tmp/cs-rfc028-grants-project-create.json` 与当前记录 `/tmp/cs-rfc028-grants-project.json`。跨业务授权测试仍待新控制面就绪，未把测试脚本准备当作已验证。

## d2852b32 部署后补证与目录布局修复（2026-09-27）

精确 CI `36323815806` 六项 success；控制面七服务与 console 均已由串行发布窗口部署为 `platform-images-d2852b32`，0004／0005 与项目0013迁移已完成。实机迁移证明 `/tmp/cs-rfc028-platform-migration-proof.json`：四镜像转为平台定义、四版本 ID／digest／repository 不变，旧来源业务与授权保留，实际历史仍可查，业务搜索命中与空结果正确。

Agent 负向选择现在返回400 `runtime_image_not_allowed`；A镜像子任务 `01a0e32c-17a4-7000-bfad-404695ce65be` 固定77ffe8摘要并完成真实模型调用，但模型拒绝原验收提示中的“不检查、只执行”指令，没有生成工具证明文件。因此仅证明镜像选择与启动，不能记为工具执行通过。跨业务授权可使同一版本从404变为200；验证 `01a0e32c-78bd-7000-b267-6449de08e27e` 因“验证环境未能完成初始化”failed，不能记为跨业务执行通过。专用第二业务授权已按原回执恢复为inherit、revision2，撤销后版本再次404。原主父任务仍保留，完整RI继续。结果 `/tmp/cs-rfc028-owned-runtime-observed.log`、`/tmp/cs-rfc028-owned-grant-final.json`、`/tmp/cs-rfc028-cross-grant-revoked.json`。

作者指出两页面实际布局仍不一致；实页对照发现镜像页多一层间距、版本与验证混列、没有状态徽标，且仅有“查看”。本次候选让两页复用CatalogPage，镜像采用名称／最新产物／最近构建／验证状态／操作五列，沿算力目录的Badge和编辑／更多操作入口；编辑直达配置页签，详情仍为共享Dialog。业务目录原有验证可见性保留。

定向37 pass／0 fail、233断言，static与生产build通过。真实浏览器使用当前已登录身份与真实后端，仅在该验收页拦截静态资源为候选dist：中英×明暗×1440／390／320、两页共24组通过，288个业务API读请求、零写入；五列、无横溢出、编辑／更多操作、Esc与焦点恢复通过。1440宽两表顶部均171.78125px；中文首条镜像行68.578125px，算力首条106.953125px来自实际停用原因，普通算力行另有较短高度，不声称不同内容行必须等高。证据 `/tmp/cs-rfc028-owned-layout-candidate.json` 与 candidate截图。首次主题脚本使用无效data属性，已改为真实prefers-color-scheme媒体仿真并重新核验；初次立即焦点断言改为等待共享组件下一帧恢复。全量check正在执行，当前尚未发布此布局候选。

无仓库构建现状与建议见 `repository-free-build-amendment.md`，当前仅为待确认方案，未实现inline构建，也未将登记已有镜像描述成该能力。

## 2026-09-27 仓库无关构建与目录布局候选（未发布）

作者已明确批准 `repository-free-build-amendment.md`。新增 `inline` 配方，固定 Dockerfile、文件字节／路径／执行位和普通参数；不选择业务或仓库、不申请 Git 凭据。构建文件通过隔离挂载准备，复用 BuildKit、可信产物回执及资源物理回收。源码与已有镜像入口保留。任务／Agent 沿用固定平台底座与兼容验证。

新增弹窗默认直接编写，上传期间禁止提交，晚到上传不会覆盖新来源或最新 Dockerfile，来源切换保留仓库业务草稿；固定修订可查看 Dockerfile／文件清单。镜像与算力页共用 CatalogPage，五列表格、独立构建／验证徽标以及编辑／更多操作，详情仍为共享 Dialog。

候选验证（不等同于部署或实际构建）：

- 定向 139 pass／1 opt-in registry skip／0 fail、928 断言、41 文件；后续草稿回归连同关键端口／日志与工作流 24 pass／0 fail、128 断言。真实 PG 覆盖管理员原子保存、401／403／400、幂等、固定修订、取消及物理回收；真实 shell 覆盖二进制、执行位、路径转义。
- 改动行覆盖合并双语检查 242／242，30 个生产文件全部加载，无违规。证据 `/tmp/cs-rfc028-owned-inline-{coverage.log,patch.json,i18n.log}`。
- 候选静态资源＋真实后端：目录两页中英／明暗／三宽共24组，288读／0写；两表桌面顶部同为171.78125px。新增无仓库弹窗12组、192读／0写，实传二进制 `00 ff 80 0a`、修改路径、Esc恢复焦点、无横向溢出。证据 `/tmp/cs-rfc028-owned-{layout-candidate,inline-browser}.json`。这些浏览器用例没有真正提交构建。
- 早期完整检查的沙箱版因 localhost 监听权限失败；正常版自然结束3510 pass／54 skip／56 fail，其中48项实机登录等待、2项运行进程缓存旧镜像模块、4项并行模板变动、2项预览／GitLab问题。不得称全量通过。镜像两项已定向通过。候选冻结后使用既有dev-admin OIDC方式的新完整检查仍在执行，记录 `/tmp/cs-rfc028-owned-inline-full-check.log`。

当前没有本批提交、精确SHA CI或部署；真实无仓库构建、授权业务执行与跨业务复用仍待补证。原 RFC028 的 RI 未完成项及 RFC029 恢复执行不因本批源码实现而关闭。

### a12c7d13 发布与本机部署进展

49路径已精确提交并推送 `a12c7d137800d35ae6cae78c20b060c2bd8cec8a`，保留第三方referenceResources；发布后main/origin 0/0、index空。两镜像从该提交归档直接构建，7控制面运行 `cs-control-plane:inline-a12c7d13`、console运行 `cs-console:inline-a12c7d13`，8个rollout成功。部署后的页面6组双语／主题／三宽、105读／0写通过；真实API越界路径400、Dockerfile超限400、匿名创建401。

冻结后完整check自然结束：3631 pass／11 skip／7 fail／3 errors、22893断言、694文件、807.88秒。7项失败均在既有实机页面（加载超时、429与状态断言），3 errors也在实机用例链；本批模块和工作台用例通过，仍不得称全量绿。精确CI `36327737192` 最终六项全部success，回执 `/tmp/cs-rfc028-owned-inline-ci-final.json`。

真实无仓库定义 `01a0e361-522b-7000-a97f-a6422abd20c7`、修订 `01a0e361-522b-7001-ad81-413f86cc9cbe`、构建 `01a0e361-5247-7000-a960-0cb10de288d1` 已受理。保存记录无sourceProjectId/repositoryBindingId/commitSha，实际Pod只含context-input及push卷、没有Git卷。当前CPU requests不足600m导致FailedScheduling，尚不能认定构建成功。已通过平台下线本任务第二业务无正式流量的闲置preview `01a0e31f-c6f5-7000-b129-23bf0c63d1de`（500m），保留业务、数据与版本；其后并发验收资源占用增加，正在协调串行资源验收。主验收任务仍保留，未操作其他会话资源。

无仓库构建已于15:10:53Z成功，版本 `01a0e36b-4768-7000-b8d3-2b93c54edac0`，摘要 `sha256:112511b70b8bb528e6e6881512d3222f508b0cd4fd876c344aedafe37264b202`，产物在 `runtime/platform/<buildId>/image`。构建Job／Pod已物理回收；构建过程中已执行示例里的Python、CJS／ESM、脚本和原生二进制检查，另外直接执行了上传的755脚本。后续独立验证 `01a0e36b-8f24-7000-825e-227c8ebd64ea` 固定默认1CPU，当前因集群仅余770m处于调度等待，工具验证尚未完成，不将镜像available当作passed。

### 仓库无关构建补充验收完成（2026-09-27）

本节取代前述调度等待状态；其余旧RI未完成项仍保持原边界。

- 无仓库构建成功，版本 `01a0e36b-4768-7000-b8d3-2b93c54edac0`、摘要 `sha256:112511b70b8bb528e6e6881512d3222f508b0cd4fd876c344aedafe37264b202`。固定配方9个文件，包含二进制输入及执行位；构建不读取业务仓库。
- 主业务验证 `01a0e36b-8f24-7000-825e-227c8ebd64ea`、第二业务验证 `01a0e36e-6b09-7000-876c-41b0ea1e0546` 均passed；同一镜像实测UID10001及7项工具检查。第二业务原授权已恢复为inherit/revision4，新版本在该业务404，配方摘要与文件内容保持不变。第一次临时断言因JSON键顺序比较误报；改为结构比较及摘要双核对通过，仅重读，没有重复写授权。
- 本任务专用业务v0.3.1（release `01a0e36e-86ad-7000-9769-4ba8842daab1`）只扩展任务允许镜像集合，沿用既有服务摘要；经fenced切换后由真实业务入口创建任务 `01a0e36f-c884-7000-b9e7-3ff652cde99d`。任务selectionSource=request，实际Pod imageID等于上述摘要；运行态初始化7项检查全部passed，证明工具在真实业务任务容器执行。本条证明启动检查，未声称新增业务命令子任务。
- 已通过业务close入口结束该临时任务：closed、quotaHeld=false、resourceState=released；真实页面「使用记录」仍显示该已释放任务，详情在共享弹窗，截图 `/tmp/cs-rfc028-owned-inline-history.png`。旧主父任务 `01a0e30e-e096-7000-be22-db3c8ecd4171` 未动。
- 主验收业务保留新增镜像授权和v0.3.1供查看；第二业务临时授权已恢复、空闲preview保持下线以释放容量。没有修改其他业务的镜像授权、任务或Agent容器。构建与验证临时资源已回收。

完整证据：`/tmp/cs-rfc028-owned-inline-{live-final,validation-primary,validation-secondary,business-proof,business-pod,business-task-closed,revoke-proof-final,final-history,ci-final}.json`。本批代码a12c7d13六项CI成功、8组件已部署就绪、部署页6组及真实401／400已通过；非管理员403由真实PG＋HTTP路由测试验证。T19–T21闭合，不据此将整个RFC028或RFC029标Done。


### Agent A／B 实际工具调用闭环（2026-09-28）

在原专用父任务 `01a0e30e-e096-7000-be22-db3c8ecd4171` 下顺序新建两条 Agent 子执行。A `01a0e396-b094-7000-afab-eefa0b89679d`、B `01a0e39a-1a89-7000-97cd-65a5a18f806e` 均 `succeeded / exited / exitCode=0`。本次提示允许先核对指定工具再执行，不再使用之前模型拒绝的“不要检查、只执行”表述；旧拒绝记录保留。

- A 实际 Pod `sub-01a0e396b0947002b20fd7d81d4ccc19`，UID `1a36211d-4a6a-4e68-aef0-51fbee88af8f`，imageID 摘要 `77ffe8bfa44f95d5874f168f8a3aeeb265831c3f29ecfca8c6da7de5b980bd5f`。
- B 实际 Pod `sub-01a0e39a1a897002bd9dfafb44ed65f0`，UID `c8d4c146-7239-4488-b680-7d51ed8c595d`，imageID 摘要 `4eea778bfe121e8a58b991f5690fa5237a534610bd2114501cec1f0c58a18934`。
- 两者均实际调用 bash 执行 UID、role、PyYAML、Node CommonJS／ESM、脚本、原生动态链接工具七项；依次得到 `10001`、`agent-a` 或 `agent-b`、三个 `ready`、`script-ready`、`worker:10001`。通过业务 `/events` 读取到每条命令的持久 tool-start，再回读各自写入的 `/work/agent-a-tools-v2.txt`／`agent-b-tools-v2.txt`，不是仅依据模型最终文字或镜像验证脚本。
- A 32 条持久事件含指定 bash 调用、写文件与回读；B 也包含七次 bash、写文件与回读。事件本身没有 tool-end 记录，不将其表述为每条独立工具结束事件；子执行终态、实际文件与原镜像工具验证共同证明本项结果。
- 原 service／迁移 imageID 为 `ad0b08d0…977bfbf`，父任务为 `b8b7ea38…848575b`，A／B 为上述另外两个摘要，完成 RI-01 的四种独立镜像实际执行。结合此前显式复用 A 镜像的父任务 `01a0e311-9ea9-7000-864f-4be0fe16c1b3` 与工具输出，RI-02 的同镜像父任务／Agent 工具复用也完成。RI-03 的父命令和 Agent 真实工具调用缺口已补；其他 RI 条件继续按矩阵核对。
- 两个 Agent Pod 均已物理消失；原父任务 Pod UID `f748cdc5-645f-4982-96bf-835e648f38e1` 与两个服务 Pod UID `c16c7158-9923-439a-a81a-ef8589a6224c`／`f14b69c2-5fc8-4706-9651-d55128c5103b` 保持。父任务与原卷保留供后续恢复验收，没有结束或替换其他会话资源。

证据 `/tmp/cs-rfc028-owned-agent-{a,b}-tools-v2-observed.json`、`...-events-v2.json`、`...-pods-v2.json`，最终回收清单 `/tmp/cs-rfc028-owned-agents-final-pods-v2.json`。此次实机运行使用已部署的 inline-a12c7d13 控制面；并行开发的 RFC029 事务候选尚未部署，不混淆两者。
