# RFC-028｜运行镜像构建与独立绑定技术设计

> 2026-09-27 仓库无关构建补充已获作者批准：新增直接编写 Dockerfile 和上传构建文件，配方归平台、无需来源业务或仓库；见 [补充方案](./repository-free-build-amendment.md)。本条扩展原 source/existing 范围，实施与验收状态见 acceptance。

> 2026-09-27 最新裁定：运行镜像是平台级资源，按业务授权。本文件旧项目所有权／shared 描述由 [平台目录修订](./platform-catalog-amendment.md) 覆盖；实现与迁移尚待完成。

> In Progress · 2026-09-27。服务、业务任务与每个 Agent 独立选镜像为已确认方向。以下接口和字段是目标设计，完整稿已获批，以下接口仍是实现目标，不能视为已部署 API。

## 目录

- [1. 模块与数据归属](#1-模块与数据归属)
- [2. 镜像定义与构建](#2-镜像定义与构建)
- [3. 持久对象与状态机](#3-持久对象与状态机)
- [4. 构建执行与资源边界](#4-构建执行与资源边界)
- [5. 用途验证和初始化](#5-用途验证和初始化)
- [6. 独立绑定与选择优先级](#6-独立绑定与选择优先级)
- [7. API 与权限](#7-api-与权限)
- [8. 生命周期与恢复](#8-生命周期与恢复)
- [9. 工作台与观测](#9-工作台与观测)
- [10. 实施依赖与测试](#10-实施依赖与测试)
- [11. 技术依据](#11-技术依据)

## 1. 模块与数据归属

新增 runtime-environment（L4），见 ADR-0010。该模块拥有运行镜像定义、构建、版本、用途验证与引用生命周期；产品名称为「运行镜像」。它不接管平台 Agent 配置或服务发布。

| 单元 | 负责的改动 |
|---|---|
| runtime-environment，L4，新模块 | 镜像定义／修订／构建／登记／版本、用途与组合验证、日志、引用保留；独立 schema |
| agent-runtime，L3 | 公开经授权的固定档位修订、底座摘要、启动契约及组合测试端口；模型与凭据继续由其管理 |
| scm／config／project，L3／L3／L2 | 固定源码、短期 Git 凭据、显式获准的构建 Secret、角色和可见范围 |
| release，L4 | 自己声明 RuntimeImages 端口；固定 Manifest 后分流构建／引用模式；保存服务和业务执行默认配置 |
| task-runtime，L4 | 自己声明镜像验证／引用端口；保存父／子 image 快照、初始化门控，恢复不重读最新配置 |
| business-task，L5 | 校验请求选择在固定 release 允许集合内；分别固定父任务和各 Agent 子任务的镜像与档位 |
| dev-session，L5 | 读取项目开发镜像配置；开发父环境、headless Agent 与 CLI 的创建入口独立解析选择，并保存启动快照 |
| resources／cluster-control，L1／L2 | 环境构建／验证资源种类，按台账创建 builder、Job、Secret、临时卷并按 UID 回收 |
| session／task runtime | 初始化能力、持久去重、结果与取消；复用 Runner 通道与启动进度 |
| platform，L7 | 反向端口接线与模块装配，不含业务规则 |
| contracts／api-client／console | 镜像 DTO、可选 Manifest／业务 API 字段、目录与各处镜像选择 |

遵守标准目录 api/domain/application/ports/adapters/http/workers/tests 与 600／20／80 上限。同层模块不互相 import，低层需求用端口由 platform 回填；只导入根 index.ts，不跨 schema JOIN／外键／事务。Kubernetes 写操作仍只在 cluster-control。

资源 Job 形状新增明确 owner/purpose 的判别分支，不能为镜像构建伪造 releaseId；保留现有服务构建和迁移分支。复用构建引擎仅抽无领域代码，不引入跨层 facade。

## 2. 镜像定义与构建

### 2.1 两种来源

- source：Git 绑定、commit SHA、context、Dockerfile、target、普通 build args、构建 Secret 引用、架构、工具清单和可选初始化配置。
- existing：平台仓库引用；受理时解析 digest，检查项目／管理员对仓库前缀的权限和产物可用性，再走同一用途验证流程。登记不等于验证通过。

一份修订／构建产出一个不可变镜像版本。复用公共工具时可用相同 Dockerfile／安装脚本对多个底座分别构建；每个产物各自成功、各自验证和绑定，不强制等待整组完成。公共工具集合的跨镜像比较是可选验证，不成为无关镜像的全局发布闸门。

源码必须来自项目已授权 SCM 绑定，branch/tag 在受理时解析为 SHA，取出后复核。context 与 Dockerfile 路径拒绝绝对路径、.. 和越界符号链接；尊重 .dockerignore，不复制 .git 或工作树未提交文件。LFS／子模块第一版检测后明确报不支持，不静默遗漏。已有镜像也不能用任意公网地址绕过平台仓库与项目可见范围。

### 2.2 按用途检查底座

| 用途 | 镜像要求 |
|---|---|
| service | 完整业务应用镜像；按 Manifest command/port/probes 验证，不要求 TaskRunner 或平台任务底座 |
| task | 保留平台 Runner、启动路径、协议、worker UID 和必要工具；镜像基于受支持平台任务底座 |
| agent | 满足 task 要求，并兼容被选择的 Agent 档位修订的 binaryPath、解释器、参数、beforeStart 和协议能力 |

任务／Agent 构建模板使用 ARG CS_BASE_IMAGE，平台按所选底座摘要赋值。最终阶段必须继承受支持底座；支持多阶段编译。用 Dockerfile 解析器检查阶段关系，并验证产物基础层谱系和关键路径，不靠正则 FROM 或用户可写 label 证明兼容。可信 frontend 固定，不能通过任意 #syntax 绕过检查。

Agent 镜像通常从该档位镜像扩展，但也允许另一张已验证的兼容任务镜像；因此父任务与 Agent 可以显式选同一镜像。无论来源，必须按实际档位完成组合验证。平台不自动合并两张根文件系统，不复制整个 / 伪装通用组合。

服务镜像可选自己的底座，不沿用上述 Runner 限制。使用现有服务镜像时必须包含业务程序与需要的迁移命令；原仓库仍提供该次发布的 Manifest／契约。记录「Manifest 源码 SHA」和「应用镜像来源」两个事实，不能声称外部镜像一定由这个 Git 标签构建。

### 2.3 工具、脚本与路径

Dockerfile 可安装系统／语言包、下载校验、编译和 COPY 二进制、脚本、模板、配置；脚本在构建中执行，结果进入镜像。任务／Agent 不得覆盖平台 Runner 和身份目录；平台启动参数与模型不从镜像标签读取。

默认工具目录 /opt/business/bin、venv、node、share，避开挂载的 /work。Python 使用明确 venv 解释器。Node 必须从实际业务入口验证 CJS／ESM 依赖解析，不能用全局 npm 安装冒充本地模块可导入。二进制动态库和权限按 worker 身份验证。

工具清单声明稳定 key、验证 argv、超时及期望版本／输出／文件摘要；模板生成非空清单。平台记录验证覆盖的工具，不自动穷举任意脚本全部效果。复用到多张镜像时可比较同一清单，发现差异只阻断用户明确要求一致的组合。

普通镜像 ENV 的生效与启动注入按明确优先级合成；CS_*、身份、模型／provider、Runner 路径等保留项由平台控制，不能通过选择镜像获得覆盖权。PATH 由平台结合经过验证的工具路径生成，业务动态 env 不能任意替换。共享工作卷仍可在任务运行中修改；digest 固定只保证起始镜像，不保证卷内容永不变化。

## 3. 持久对象与状态机

| 对象 | 核心字段与不变量 |
|---|---|
| RuntimeImage | UUIDv7、ownerProjectId、name、scope=project/shared、enabled；共享由管理员控制 |
| ImageRevision | definitionId、revision、source/existing、输入快照、recipeDigest；只追加，无凭据明文 |
| ImageBuild | id、revisionId、requestKey、输入摘要、attempt、状态、deadline、leaseEpoch、取消意图 |
| ImageVersion | id、definitionId、sourceRevision、repository、digest、architecture、基础检查报告；不可变，可停用 |
| ImageValidation | versionId、usage、profileRevision?、runtimeContractDigest、初始化／工具清单摘要、结果、observedImageId；对精确组合生效 |
| ImageReference | ownerType、ownerId、imageVersionId/digest、保留租约；保护发布、活动／暂停任务和可恢复会话 |
| BuildLogChunk | buildId、sequence、阶段、脱敏文本、到期时间和字节上限 |

构建状态 queued → preparing → building → inspecting → succeeded；登记 existing 从 preparing 直接 inspecting。用途验证独立 queued → running → passed/failed/unknown。构建成功只说明产物可用；下拉中的「可用于任务／Agent」还取决于具体用途验证，不能把 built 标成所有用途 ready。

失败／取消状态为 failed 或 cancelling → cancelled。构建或验证失联先核对实际资源，unknown 不等于失败已停止。失败重试生成新 attempt，成功版本不覆写。同 key 同参数返回原记录，不同参数 409。

相同 recipe 重建可能因软件源漂移得到新 digest；必须生成新版本，不宣称相同脚本天然字节可复现。锁文件、底座 digest 和下载校验进入快照；缓存命中不跳过用途验证。

工作器持久化意图后幂等声明资源，使用租约／epoch 续接；终态 compare-and-set，晚到成功不能覆写取消。结果凭据绑定 buildId、epoch、Pod UID，平台从仓库重新检查 digest／基础层；不能信任 Dockerfile 自行输出的成功 JSON。

## 4. 构建执行与资源边界

复用现有 BuildKit 技术、仓库和资源台账；新镜像构建使用每 build 独立的短生命周期 rootless builder＋客户端，本地 socket，不接入公共 TCP daemon。builder 只取得该 build 的上下文、临时缓存与受限推送凭据。服务原有仓库发布路径保持，独立镜像构建可用于产出服务镜像。

builder 与客户端都设置 CPU／内存／临时存储／deadline，平台和项目构建并发独立计数。构建容量由安装配置提供；缺配置明确不可用。不能以 buildctl Job 的 250m／512Mi 代表后台实际资源，也不能把客户端退出当成整个构建停止。

若部署使用 --oci-worker-no-process-sandbox，整个 builder 是单次构建隔离单元，不能和其他项目共享进程／凭据。无 ServiceAccount token、hostPath、Docker socket、privileged 或 hostNetwork。具体 rootless 能力由部署预检和实机确认，不能把 rootless 当成完整安全证明。

Git 凭据短期且只读；包仓库 Secret 经 BuildKit secret mount，不走 ARG/ENV，不注入模型／生产运行凭据。授权构建 Secret 等于允许构建脚本使用它；日志掩码不能阻止作者故意泄露其获准读取的值，不作这种保证。

推送前缀固定到本项目／本 build，不能覆盖底座或别人的镜像。构建网络沿现有出站政策。取消先记意图，再终止客户端和 builder，核对原 Pod UID 消失后才记 cancelled／退额／清理 Secret 和临时卷；重启可续接。半成品镜像无可绑定版本，进入孤儿保留期。

仓库网关对跨仓库 blob mount 同时检查目标写权限与 `from` 来源读取权限；禁止缺失或重复来源／挂载参数，不能让裸 registry 替调用者搜索未授权仓库。只读底座仓库按精确路径授权，只有显式以 `/` 结尾的授权才表示仓库前缀。

## 5. 用途验证和初始化

### 5.1 用途与组合验证

- task：真实镜像摘要启动 Runner；能力握手、worker UID、exec、工具导入和脚本运行通过。
- agent：按实际档位修订执行 beforeStart、工具验证和协议测试。启动二进制、解释器、参数与配置均按档位，不根据镜像猜测；模型凭据仅在受控验证运行时提供，不进构建。
- service：注册时做镜像架构与启动材料检查；发布预检验证所选服务 command/port/probes 的组合。实际部署 ready 由真实健康／就绪探针判定，不能以静态检查宣称应用可运行。测试使用隔离数据和测试身份，不在产物验证阶段执行生产迁移。

保存实际 imageID、版本、用途、档位修订或服务启动契约摘要、初始化与工具结果。验证结果只适用精确组合，新增档位修订要重测；一张镜像可同时通过多种用途。某用途失败不撤销别的用途已通过事实。

### 5.2 每容器初始化

任务／Agent 镜像可声明有序初始化步骤 {id, argv, cwd, timeoutSeconds}、普通变量与获准运行 Secret 引用，缺省为空，以 worker 执行。系统软件安装放构建阶段；服务用自己的入口／启动命令完成初始化，由 probes 把关。

顺序：Runner 连接与能力确认 → 公共初始化 → 父 command 可受理；Agent 继续执行档位 beforeStart → 工具检查 → startAgent。所有执行入口检查 ready，不能只靠前端禁按钮。初始化变量和档位配置冲突时按平台保留规则拒绝，不能悄悄覆盖。

执行 ID 绑定 environmentId＋startGeneration＋initializerDigest，控制面与 Runner 持久记录；重连不重跑已完成步骤，新容器实例重新运行。失败／超时阻止业务执行；结果 unknown 先确认旧实例终止再显式重建，不自动重复可能有外部副作用的脚本。取消终止进程树并确认后退额。

不提供跨多个容器的任意共享初始化 exactly-once。共享工作文件准备由父 command 明确执行并等待成功，再启动 Agent；业务负责外部副作用幂等，平台沿 RFC-027 保存命令结果。

## 6. 独立绑定与选择优先级

### 6.1 Manifest 字段（均为新增可选）

新字段只在 crewstation/v3 Manifest 中接受；v3 复用现有完整服务合同并增加本节字段。新平台同时支持原 v2；v2 若带新镜像字段应明确报需升级 apiVersion，不能宽松剥掉。旧平台的 apiVersion 字面量校验会拒绝 v3，从入口避免静默忽略。这里的 Manifest v3 与 RFC-027 的业务 HTTP API v3 独立，不要求无镜像选择的业务 API v3 服务改 Manifest 版本。

| 位置 | 字段 | 含义 |
|---|---|---|
| spec.service | runtimeImageVersionId | 指定完整服务镜像，存在则引用模式；缺省沿原仓库 Dockerfile 构建 |
| spec.tasks | runtimeImageVersionId | 业务父任务默认镜像 |
| spec.tasks | allowedRuntimeImageVersionIds | 允许单次父任务请求选择的其他镜像 |
| spec.tasks.agentProfiles[] | runtimeImageVersionId | 此业务 Agent 档案默认镜像 |
| spec.tasks.agentProfiles[] | allowedRuntimeImageVersionIds | 允许该 Agent 单次执行选择的其他镜像 |

字段均用平台目录版本 ID，底层解析到 digest；UI 展示名称／版本／摘要，管理员可登记平台仓库已有镜像。因此「指定镜像」既支持平台构建，也支持已有镜像，不要求重构建。API 不直接接受未经登记验证的 image 字符串。

默认版本自动属于该位置的允许集合；其他位置的允许集合不互相继承。引用列表去重且有数量上限；版本不可见／停用／用途不兼容则配置失败。不同 Agent 档案可选不同版本，同一版本可多处显式引用。

### 6.2 解析优先级

| 执行对象 | 从高到低 |
|---|---|
| 服务发布 | Manifest service.runtimeImageVersionId → 原仓库构建所得镜像 |
| 新业务父任务 | 请求 runtimeImageVersionId（必须在 tasks 允许集合内）→ tasks 默认版本 → 平台任务镜像 |
| 新 Agent 子任务 | 请求 runtimeImageVersionId（必须在对应 agentProfile 集合内）→ 该 agentProfile 默认版本 → 当前解析到的算力档位镜像 |
| 开发工作区 | 创建请求版本（项目 developmentTask 允许集合）→ 项目 developmentTask 默认 → 平台任务镜像 |
| 开发 Agent／CLI | 启动请求版本（该档位对应的项目开发允许集合）→ 项目对该档位的开发镜像默认 → 平台算力档位镜像 |
| command 子任务 | 使用已受理父任务的固定镜像；不读取 Agent 镜像，也不在已运行容器内热换镜像 |
| retry／resume | 原执行快照；不能重新选择或偷偷使用最新默认 |

Agent 不隐式继承父任务或服务的镜像。若希望相同工具，显式选择同一兼容镜像，或用公共配方构建各自版本。请求显式版本不兼容时返回错误，不退回默认。

I34 作者裁定（2026-09-27）：fresh 重试也沿用原档位、镜像、初始化和执行材料快照，仅生成新的 execution／attempt 与原生会话目录；resume 沿原会话目录恢复。需要更新运行环境时显式新建子任务。停用不阻断已有引用的重试，原引用缺失或固定凭据不可用则明确失败。

### 6.3 服务发布分流

现有 pipelineBuild 在构建后才读取 Manifest，必须调整为：固定标签对应源码 SHA → 读取并验证 Manifest → 解析镜像模式 → 构建或引用 → 原迁移／部署／健康检查链。

引用模式不创建虚假 build Job，也不伪造「构建成功」；阶段显示「使用已有镜像」。所选应用镜像不挂源码覆盖其内容。迁移仍使用该次发布的应用镜像及原 migrationCommand；命令缺失、失败或兼容性门控不通过均不得切流。两种模式都固定服务 image digest，release 保存 Manifest 来源 SHA 与镜像来源，槽和回滚沿快照。

APIProxy／EventProducer 若使用同一 service 结构，执行相同镜像分流；不能只给 DigitalWorker 分支接线后对其余种类静默忽略。

### 6.4 任务与 Agent 准入

先读取 requestKey 原回执，再处理新请求；重复请求返回原镜像，即使 defaults/tag 已变化。请求 key 相同但显式选择不同镜像报 409。

父任务从可信 release 契约读取默认／允许集合，解析、鉴权、用途检查后固定 {imageVersionId?, imageDigest, architecture, initializerDigest, validationId?}，取得引用后准入。未显式绑定时也记录最终实际摘要，旧历史任务不能伪造当时未记录的 digest。

Agent 按 release 中的业务 agentProfileId 定位允许集合，按原规则解析当前算力档位并固定修订，再解析镜像优先级。显式镜像必须已有该精确档位／能力组合的通过记录；否则 412 image_profile_incompatible，提示需要测试的档位修订。不能在正常任务中临时试用不兼容镜像。

固定 {agentProfileId, computeProfileId/revision, imageVersionId?, imageDigest, initializerDigest, validationId?}；launchMaterial 仍来自平台档位。创建独立 Pod 和额度的方式不变。任务请求选择只影响父镜像，Agent 请求选择只影响该子任务。

动态业务 env/material 不能覆盖 image、模型、provider、身份或 binaryPath；镜像选择是独立受控字段，不放宽 RFC-027 其他边界。恢复比较镜像、初始化、档位和会话兼容摘要；不匹配报 412 image_resume_incompatible，不自动新开会话。

### 6.5 开发工作区与开发 Agent

项目增加开发镜像配置快照：developmentTask 的默认／允许版本，developmentAgents 按平台 profileId 保存默认／允许版本。配置使用版本号做并发更新；只允许项目可用镜像与已授权档位，不能借配置扩大算力授权。

开发工作区创建请求可带 runtimeImageVersionId，存入父 TaskEnvironment 快照；开发 headless Agent 和 CLI 的创建请求也可分别指定。普通终端直接在开发父容器执行，不宣称终端进程能热换镜像。每次创建重新检查项目权限与该用途／档位的验证报告；不依赖业务 release。

更改项目默认不会重启活动开发会话或 Agent。现有「重建／重连」恢复原镜像快照，不能把配置修改混入故障恢复；要换镜像，显式结束并新建对应执行环境，工作卷保留规则沿现有生命周期。验证用例覆盖重建的镜像选择，不再从全局 taskImage 覆盖已固定镜像。

## 7. API 与权限

镜像目录根路径 /v1/projects/:projectId/runtime-images，服务端逐次校验对象归属与角色。

| 路由 | 输入／结果 |
|---|---|
| GET／POST 根路径 | 分页目录／创建定义 |
| GET／PATCH /:id | 定义详情／expectedRevision 乐观更新 |
| POST /:id/revisions | source/existing 输入快照，201 |
| POST /:id/builds | revisionId、requestKey，202＋buildId；existing 执行登记检查 |
| GET /:id/builds/:buildId | 真实构建／检查阶段与产物状态 |
| POST /:id/builds/:buildId/cancel | 幂等取消意图，202，物理终止后完成 |
| GET /:id/builds/:buildId/logs | after／limit 分页；过期 410 |
| GET /:id/versions／/:id/versions/:versionId | 版本、摘要、用途、兼容档位、引用 |
| POST /:id/versions/:versionId/validations | usage、profileRevision 或 serviceContract、requestKey，202 |
| GET /:id/versions/:versionId/validations/:validationId | 精确组合的阶段／结果 |
| POST /:id/versions/:versionId/disable | 禁止新采用，不删除已用镜像 |
| GET /:id/versions/:versionId/references | 受权范围内的发布／任务／恢复引用 |
| DELETE /:id/versions/:versionId | 已停用且零引用／无在途保留租约才受理回收 |

RFC-027 v3 创建父任务／创建 kind=agent 子任务新增可选 runtimeImageVersionId；kind=command 不接受该字段，使用父任务固定镜像。明确值必须来自固定 release 相应位置的允许集合。v2 旧字段保持，不伪造具有 v3 的幂等语义。

项目开发配置使用 GET／PUT /v1/projects/:projectId/development-runtime-images，PUT 带 expectedRevision；沿用 develop 权限，校验平台项目授权的档位范围。带显式镜像选择的创建请求使用新的严格解析路由 POST /v2/projects/:projectId/dev-session、POST /v2/tasks/:taskId/agents、POST /v2/tasks/:taskId/agent-terminals；它们由原 dev-session HTTP 适配器调用同一生命周期用例，不复制实现。返回实际解析快照。原 v1 路由保留原合同，新客户端不能把显式选择降级发送给可能剥字段的 v1；旧平台对新路由 404，因此不会悄悄使用默认镜像。

项目开发者与负责人沿 develop 管理定义／构建／用途测试；绑定服务沿 publish。停用／删除由负责人或管理员执行。tester/user 不获得构建和原始日志权限。管理员公共镜像入口 /v1/admin/runtime-images 需与现有同路径的推送信息端点避开：保留旧端点，新增 /v1/admin/runtime-image-catalog 管理公共目录，不能悄悄改旧响应。

业务服务只能使用本服务 release 已声明的版本；不能管理构建或读构建 Secret。失权后 API／日志流／重连撤权。构建服务身份只能提交对应结果。平台管理员才可设置公共可见范围、底座和构建容量；目录列表不得向项目泄露平台模型凭据或私有启动材料。

错误码：400 非法配置／路径，403 无权限，404 隔离对象，409 key 冲突／引用阻断／版本冲突，412 用途未验证／image_profile_incompatible／image_resume_incompatible，429 构建容量不足，503 仓库／builder 不可用。明确 imageVersionId、usage、阶段和修复动作。

## 8. 生命周期与恢复

引用协议：先幂等取得 image 保留租约，再提交调用方 release／任务快照，随后确认引用。失败可撤销；超时租约只有核对调用方没有已提交快照后才回收，查询不可用保持保留。删除原子进入 retiring，阻止新引用，再检查未确认租约与引用，避免检查后被新任务引用。

业务任务显式关闭进入持久关闭操作后阻止新执行；父容器物理关闭、所引用 Agent 执行资源均确认释放后，由业务所有者幂等释放父子镜像引用，再完成关闭操作。引用释放失败仍保持操作待处理，控制器重启后续接。暂停、单个 Agent 完成和可恢复会话均不触发此释放。

后台每轮按游标最多核对 20 条引用，通过所属模块只读端口取得 `active/released/unknown` 证明。业务所有者只有父任务不可逆 closed、关闭操作已结束且对应 Agent 资源已释放才返回 released；开发所有者要求父会话已不可恢复地 released，相关工作负载期望 absent 且 Pod 实际消失。开发 Agent 结束而父会话仍可恢复时继续保留。释放前在镜像摘要锁内复核引用身份、状态和完整内容，查询期间被确认或替换的候选留到下一轮。查无所有者、跨项目／版本不匹配、查询失败及未知提交结果都不能用于回收；发布历史继续保留以支持回滚。

停用禁止新绑定／任务，不杀正在运行的执行；原有任务／会话按快照保留镜像用于恢复，原项目／档位授权仍需检查。版本及用途报告不覆写，修改脚本／初始化产生新版本或新验证记录。旧 default 更新只影响之后的 Agent 准入，不改已受理执行。

回收按实际 digest 全局合计引用，不能删一个目录版本就删除另一个版本共享的 blob。仓库 GC 不得清除仍被发布／暂停任务／会话引用的产物。若只能逻辑删除，明确物理空间待仓库维护，不伪报释放字节。构建临时卷按独立类型、owner、UID 清理，不触碰业务 PVC。

升级先追加 schema／能力，再部署支持 Manifest v2＋v3 的控制面和兼容 Runner，最后开放绑定。带镜像选择的新 Manifest 必须用 v3；旧平台必须因 apiVersion 拒绝。任务／Agent 所需初始化能力受理前检查，不能只添加 optional schema 后宣称旧平台安全。新增 API 选择字段也采用能力发现与严格解析，不允许旧服务端静默忽略它。

历史任务没有 image 快照时保持原路径并标记历史信息缺失；迁移不能猜测原 tag 的旧内容。有新镜像绑定活动任务／恢复引用时，控制面回退必须使用能理解快照的兼容版本。业务 release 回退则按原服务镜像和任务配置，不重建镜像。

## 9. 工作台与观测

项目设置添加「运行镜像」，显示构建来源、版本、用途和兼容性。服务发布配置、任务默认配置、各 Agent 档案分别给选择器，未指定项明确标注实际默认来源；不只显示一个误导性的全项目环境选择。

任务创建／Agent 启动只展示所在位置允许的镜像。运行详情显示请求选择、最终解析来源、版本／digest；独立容器与共享文件的边界有简短提示。普通操作聚焦选择与结果，底座、Dockerfile、验证报告在详情展开。

复用现有 Query hooks、列表／表格原语、启动阶段与 resource SSE，避免后台刷新卸载内容或禁用动作。日志持久游标续传，取消显示「正在停止」直至物理确认。service 引用模式显示跳过构建的真实原因。

审计：actor、project、source SHA、image/build/version/validation ID、用途、档位修订、base/actual digest、Pod UID、阶段时间与清理结果；不存凭据。实际 builder 用量和临时空间接既有资源视图，未知不计为 0。

## 10. 实施依赖与测试

RFC-027 正在修改 contracts、business-task、session、release 和 Runner。本轮只新增 RFC／ADR 与索引、STATE 本段，不编辑其产品在制文件。获批实施前先核对最新接口和所有者；共享热点保留完整输出，不同时重写。

先完成独立构建／登记／验证模块与台账，再接 service 分流、任务／Agent 选择、初始化及工作台。业务 API 依赖 RFC-027 的 release 快照、幂等和恢复语义；其未稳定时仍可推进构建模块，不能另起一套 v3 执行语义。

方法级测试覆盖解析优先级、路径／Dockerfile 校验、用途兼容、状态机和引用保护；真实数据库覆盖并发／幂等／权限／租约恢复；Runner 验证实际 UID、解释器、导入、重连与取消；UI 覆盖独立选择及真实默认来源。

实机至少用四个不同镜像对应 service、parent、Agent A、Agent B；再显式复用一张兼容镜像证明共享定义可用。不能用父 command 冒充 Agent 工具调用，不能用镜像 tag 冒充实际 imageID。详细 RI 清单见 plan.md，开始验收后另建 acceptance.md。

## 11. 技术依据

- Docker [多阶段构建](https://docs.docker.com/build/building/multi-stage/)支持阶段产物复制，不代表任意两张镜像可直接合并。
- Docker [构建变量](https://docs.docker.com/build/building/variables/)和[构建 Secret](https://docs.docker.com/build/building/secrets/)区分普通参数与临时凭据。
- BuildKit [rootless 文档](https://github.com/moby/buildkit/blob/master/docs/rootless.md)作为执行配置依据，部署限制须实机确认。
- npm [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)与 Python [venv](https://docs.python.org/3/library/venv.html)用于模板锁文件安装与解释器隔离，实际入口的导入能力仍需验证。


### 9.1 作者补充：完整新增、管理与执行历史（2026-09-27）

作者明确指出页面无法回答如何新增、管理、每个镜像跑过哪些任务。T12须覆盖完整流程：新增时同时填写名称、说明、用途与来源、源码构建位置；安装 pip／npm、脚本及二进制的 Dockerfile 提供可复制示例并说明提交仓库后构建。保存首份配方与定义为原子操作、预检失败不残留空定义，重复提交不重复创建；构建受理独立可重试，页面持续显示同一镜像。

目录展示版本产出与构建、验证各自真实状态，不再把定义 enabled 标成镜像可运行。详情按概览／版本与验证／构建日志／使用记录组织；可修改名称说明、基于现有配方创建新修订、重新构建、停用新选择，停用不改历史执行。保留 UUID／完整摘要于技术详情，主要信息使用名称、用途、时间与原因。

使用记录读取 task-runtime 与 release 自有持久快照，通过 platform 端口组合，不跨 schema 查询。过滤项目及版本、排序后分页；环境创建失败也保留并显示状态，不能声称它实际运行成功。已释放环境保留历史；配置引用和 validation 不冒充业务执行。公开镜像的使用记录仍仅限当前项目，避免泄露其他项目。链接指向现有调用链／发布详情，缺少可证明的业务名称明确显示任务编号。数据读取失败显示错误，不能当作无历史。
