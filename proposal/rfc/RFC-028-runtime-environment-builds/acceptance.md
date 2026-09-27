# RFC-028 实施证据

2026-09-27。作者已批准完整实现、提交上库与本地部署；仍为 In Progress。此文区分源码用例与实机产品验收，RI-01～RI-28 尚未完成。

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
