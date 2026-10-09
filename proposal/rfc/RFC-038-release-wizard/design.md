# RFC-038｜技术设计

> In Progress · 2026-10-09。作者已批准完整实现方案、提交到远端、本地完整部署与完整验证；以下接口、留存、兼容处理和实施范围按整案执行。

## 目录

- [1. 结构落位](#1-结构落位)
- [2. 路由与视图](#2-路由与视图)
- [3. 流程对象与阶段事实](#3-流程对象与阶段事实)
- [4. 接口与数据流](#4-接口与数据流)
- [5. 连续向导状态](#5-连续向导状态)
- [6. 恢复、并发与权限](#6-恢复并发与权限)
- [7. 旧历史及现有能力兼容](#7-旧历史及现有能力兼容)
- [8. 项目删除与存储边界](#8-项目删除与存储边界)
- [9. 测试与真实验收](#9-测试与真实验收)

## 1. 结构落位

已读 `docs/engineering/repository-structure.md`。向导编排视图归 `apps/console/src/features/release`；流程事实归原 L4 `modules/release`；开发来源沿用 L5 `dev-session`，只向 release 的公开 API 传递已核对来源；跨模块观察经 ports，由 L7 `platform` 装配。无新模块、跨 schema 查询或结构规则例外。

| 位置 | 承担的工作 |
|---|---|
| `features/release/pages/` | 发布总览、向导路由；历史及当前共用向导入口 |
| `features/release/components/wizard/`、`components/history/` | 准备／部署／验证／上线／完成视图，历史列表与阶段回看 |
| `features/release/model/journey/` | DTO 到视图的纯投影、同意图恢复、本地准备草稿；UI不成为执行状态权威 |
| `shared/ui/progress/`、`shared/ui/dialog/` | 复用 StageProgress、Dialog/FormDialog/ConfirmationDialog；必要时小幅向后兼容扩展 |
| `shared/logs/` | 从现有 logs feature提取可复用的有界日志请求和展示，两处共用；不互相 import feature |
| `shared/project/`、`app/router/` | 空间内路由、深链接兼容与返回上下文 |
| `modules/release/domain/journey/` | 流程身份、步骤事件、合法投影与完成条件；零 IO |
| `modules/release/application/journey/` | 创建／查询、人工验证、关联切流、观察生效，沿用原发布与交接用例 |
| `modules/release/ports/`、`adapters/persistence/journey/` | Repository／UoW 端口与本 schema持久化；HTTP单独 journeyRoutes |
| `packages/contracts/api/`、`packages/api-client/` | 严格新 DTO／请求与客户端；旧接口新增可选字段保持兼容 |

按概念分目录以保持600／20／80尺寸；不把向导塞进现有 ReleasePage 或单一大 hook。触及存量结构承担两步：释放发布页尾详情，提取共用日志；不借本 RFC 改 unrelated 资源或观测在制功能。

## 2. 路由与视图

租户和接入管理两套路径均新增以下相对 project route；路由都归项目布局，不让 ReleasePage 本身成为无 Outlet 的父页。

| 相对路径 | 用途 |
|---|---|
| `release` | 发布总览与历史流程／原生命周期事件 |
| `release/publish` | 尚未受理的准备向导；来源和本地 draft定位在 search |
| `release/journeys/$journeyId` | 精确流程：可继续的运行态，或终态只读历史 |
| `release/versions/$releaseId` | 升级前无 journal 的历史视图，精确 release定位 |

`PROJECT_PATHS`、feature导出、租户 routeTree、adminProjectRoutes、项目导航活跃判定一起更新。开发页的准备发布直达来源=session；概览上线以当前实际 release和部署代次解析唯一可接续流程，没有已有流程时进入单独上线流程。旧 `source`、`release`、`switch` 查询链接只做精确兼容定位，不发写请求，不回退到“最新发布”。未知／别项目ID保持404或无权限。

历史列表状态存在URL与原列表恢复机制中。返回通过明确的项目空间内目的地恢复游标／筛选／滚动和触发控件；不接受任意外部return URL。日志在向导内展开有界尾部，完整诊断可新标签打开。全宽布局由现有 `main` 滚动；不改其overflow。底部操作区在宽屏内容区内吸底且留占位，窄屏自然重排。

## 3. 流程对象与阶段事实

### 3.1 身份和持久化

新增 `release.release_journeys` 和 `release.release_journey_events`，均由release owner持有。一次操作有canonical UUIDv7 `journeyId`；`releaseId`是版本身份。同一release重新部署、再次上线／回退产生新的journey，不能覆写首个流程。

Journey固定保存：原projectId／serviceId／releaseId、操作类型（publish／redeploy／promote／rollback）、来源（repository／session／legacy／external及可证taskId）、原branch／tag／完整SHA、发起人、发起时间、初始版本说明、当前步骤、流程revision及原部署身份。来自session的来源由dev-session检查成功后通过内部公开参数传递，用户不能靠请求正文伪造taskId出生事实。初始说明独立保存，不随Release.message被流水线错误覆盖。

Events追加保存：UUIDv7、journeyId、序列、阶段、状态、服务端记账时间、操作人、来源transition key、可证的目标指纹／handoffId／切流ID和短原因。用 `(journeyId, transitionKey)` 唯一键防止队列重放重复记账；同一来源事件不同内容必须报冲突。正常流水线状态更新与事件追加在原模块同一UoW中；不能在DTO查询时补造阶段。

新流程和已受理Release一同创建；已经在跑的升级前Release没有历史journal，可按原来源只读回看当前状态。后台运行继续由原publish／pipeline／handoff控制。Journey记录流程事实，不能成为另一套负责执行构建、迁移或切流的状态机。

### 3.2 阶段与时间

五个产品步骤映射：prepare → delivery → verify → launch → complete。delivery包含queued／build／migration／deploy／ready子阶段；launch包含confirm／route以及fenced需要的freeze／prepare／activate交接细节。

每段区分pending、running、succeeded、failed、skipped、unknown。无迁移命令和复用已固定镜像，必须由Manifest／流水线明确记录skipped及原因。中间阶段无证据用unknown，不能由末尾ready伪造之前每段成功。事件时间指服务端接受或观察到阶段转换的时刻，UI称“阶段用时”；不冒充Pod的实际执行时间。没有起止不显示耗时，也不以createdAt／updatedAt凑出各阶段时间。

Journal的当次终态与Release的当前状态分开。发布等待人工验证为waiting，并不因ready自动完成。后来取代／下线其验证部署时记录interrupted及原因，保留此前全部事实；当次上线complete之后不再改变其结果。当前部署是否在线通过独立投影显示。

人工验证是可审计的“操作人确认已验证此部署”。记录人、时间、选填说明及目标revision；不表示平台跑过测试。未保存说明不计入历史。旧直接上线路径没有人工验证记录时显示“未记录”，保持原功能能上线。

## 4. 接口与数据流

### 4.1 拟新增工作台接口

| 接口 | 拟定合同 |
|---|---|
| `GET /v1/services/:serviceId/release-journeys?cursor&limit` | 原view授权；50条以内一页、严格游标；摘要区分journal与legacy；返回nextCursor／hasMore，覆盖历史而非只取最新50个Release |
| `GET /v1/release-journeys/:journeyId` | 精确原project/service授权；返回固定snapshot、阶段events、revision、当前实际部署的continuation与原因 |
| `GET /v1/releases/:releaseId/journey-history` | 按原release授权，查询该版本全部操作；无journal时给带provenance的legacy只读视图 |
| `POST /v1/release-journeys/:journeyId/verification` | publish权限；requestKey、expectedRevision、expectedReleaseId、expectedCommitSha、expectedTargetRevision与≤500字说明；同键同内容幂等，不同内容409；再核当前真实待验证部署后记人工确认 |

新schema均strict，canonical IDs，客户端只消费DTO，不透传完整Manifest、pipeline凭据或任意原行。分页顺序由服务端 `(createdAt,id,recordKind)`固定；journal及legacy视图的游标可跨页，不因新记录插入重复／遗漏旧页。legacy没有伪造journeyId；按releaseId路由，GET不写数据库。读历史不要求仍在当前两个槽上。

现有publish／session publish／redeploy返回兼容ReleaseDto，新增可选journeyId，实际新受理路径必须产出该ID供向导接续。现有traffic-switch请求／响应增加可选journeyId；新向导传精确流程及requestKey；后端核对它的原service、release和实际部署代次。旧请求仍能执行：自动关联唯一匹配的待继续流程；没有明确匹配时新建单独promote／rollback流程，不能把操作塞进不相干的历史。

普通及fenced切流均在事务内以原service＋requestKey保存已受理意图和目标／原因指纹。刷新后同键同内容返回原操作，不再切第二次；同键改目标拒绝。旧未传键的普通调用保持既有语义，新向导固定传键。fenced继续复用现有handoff记录和阶段，journal与handoffId绑定，不读取service“最新handoff”来替换已选择操作。

### 4.2 正常数据流

1. GET来源、tags及当前项目状态，页面展示来源核对、具体候选tag与共享生产数据提示。输入阶段自动重读不会卸载表单。
2. 用户点击「构建并继续」，前端锁定已展示的具体tag／SHA／可证taskId并发一次原publish请求。完整Manifest／资源／迁移预检仍由原后端执行。
3. 原UoW受理Release时创建journey与prepare／queued事件，返回两个精确ID。页面原位转为delivery；URL replace为精确journey深链接。
4. 原pipeline／资源观察推进，并原事务追加真实阶段事件；跳过的阶段带理由。当前release及实际preview匹配且可打开才自动进入verify。
5. 用户在新标签验证，再点击「验证通过，继续上线」；verification元数据写成功后原位进入launch，自动只读核对正式／目标两版本。不因元数据记录触发真实切流。
6. 用户明确点击「确认上线 vX」后沿原switchTraffic执行。接受回执留在launch观察。fenced需要原handoff complete；所有形态还要求当前prod／SHA／部署就绪一致且`observeRoute`确证实际路由。新journal observer通过现有port观察普通上线，未成功就保持等待并说明，不借GET自动产生业务写。
7. 观察完成时原module事务追加complete事实。返回列表可查当次全流程；后来下线不修改该complete结果。

## 5. 连续向导状态

视图状态由权威DTO和本地“正在查看哪一段”组合；用户查看过去一段只改变displayStep。可执行actionStep仍由服务端事实和当前权限决定。future步骤可读标签，不可跳过。

| 观察到的事实 | 本页显示 | 可执行动作 |
|---|---|---|
| 尚未发送 | prepare及原输入 | 核对后明确构建；清空仅准备草稿 |
| 发布202 | delivery／排队 | 观察、展开日志、稍后继续 |
| build／migration／deploy | 对应子阶段 | 观察；不以假百分比或计时推动下一步 |
| ready且实际preview匹配 | verify | 打开验证应用、记录人工确认 |
| verification已记且目标仍匹配 | launch核对 | 有权限者确认上线；无权限者复制同流程链接 |
| switch已受理但route／handoff未完成 | launch运行 | 同一operation观察；恢复只读，不再确认第二次 |
| 当次complete | 完成与历史回看 | 正式入口或发起新的合法流程 |
| 阶段failed | 原失败阶段／原因 | 读取日志或修改后发起新发布；不虚构构建retry |
| 目标被换／下线 | interrupted及当次历史 | 根据当前redeployable发起新的重新部署 |
| 读不到／字段冲突 | 数据未知，保留旧输入和上下文 | 重读；所有依赖未确认事实的写入禁用 |

当前状态条与历史事件详情复用同一rendering model。StageProgress只接受真实可证时间；旧起点unknown时不给它假startedAt，可扩展可选时间以复用现有呈现。步骤切换将焦点放当前标题／首错误字段，live region只宣布阶段变化。

资源推送触发重读；活动journey保留当前5秒状态重读和精确handoff3秒节奏，前台恢复补读。终态停止活动轮询；历史列表沿既有有界前台刷新。一个屏幕同queryKey合并请求，不用isFetching禁用稳定入口或卸载输入。

## 6. 恢复、并发与权限

已受理流程以服务器journal＋URL为准，刷新、跨浏览器或负责人接手不依赖原组件内存。未发出草稿存在按用户／空间／项目／draft隔离的sessionStorage，长度和schema有界，恢复后重新读取来源；没有跨用户恢复，不保存凭据。storage不可用时沿既有UnsavedChangesGuard告知未保存草稿，复用ConfirmationDialog。

发布发出前持久保留明确版本／分支／SHA／source／taskId的意图。新向导不用不确定的patch值发送。回执丢失时只读按service＋唯一tag核对原release、SHA、branch、actor和来源；找到唯一一致的实际受理journey才接续，不重发。仅tag已存在、记录缺失或无法核对时停在“受理结果待确认”，显示具体事实与「重新读取结果」，不能声称未发送。明确未发送的离线拒绝才允许重新核对后发一次；恢复联网没有写队列自动执行。

切流意图含journey、两个精确release、目标revision、说明及持久requestKey；刷新后按原operation读取。身份／项目变化使本地输入隔离，服务器每次写入继续授权。developer能发布与确认自己有权限验证的部署，不能切流；owner／admin继续原切流权限；原view权限可读历史，tester工作台入口限制沿原守卫保持。

发布与切流原服务并发锁、维护、生产配置、未知来源、禁止回退、任务契约和项目封写检查保持。过期目标不被自动替换；来源变化保留版本／说明并在prepare重新核对；受理后候选不改变。历史的重新部署按钮创建新journey，并以实时preview和expectedStandbyReleaseId核对，原历史留存。

## 7. 旧历史及现有能力兼容

旧Release可证branch／tag／SHA／创建人；内部存在的buildStartedAt／migrationStartedAt／deployStartedAt／readyAt可标为“旧流水线记录”。现有switches及slot_events按精确release关联；不把最近50条缺席当作没有上线过，详情需按release查询完整关联记录。时间互相矛盾或缺失只显示未知，GET不回填。

首次发布、runtime固定镜像、无迁移、旧API发起、重新部署和回退均有测试，禁止静默关闭能力。历史旧流程没有人工验证记录不阻止合法直接上线；向导显示“未记录”，新的人工确认是新事实。迁移到完整向导后原简单维护／危险放弃确认仍用共享dialog。

日志是原有有界尾部，Job／Pod回收后可能不可读。永久留存的是步骤短摘要、操作者和时间，不承诺永久完整日志或凭据。浏览历史、打开某步骤、返回列表均零业务写入。

## 8. 项目删除与存储边界

新表／新列同批更新release原完整schema目录、归属和关系验证、封写／purge／prove及测试。每行带原projectId／serviceId／releaseId／journeyId和可信出生；关联冲突拒绝。journal observer和verification写入接原project admission，不绕过原删除许可。完整盘点不受历史API分页限制，不新增owner或把未知数据视为空。

项目永久删除按原确认范围删除自己的journal与events并独立证明全零；外项目流程、运行资源和原内容保持。新增迁移按落盘时的下一个编号追加，不改0001…0010；migrations:lock只锁本次迁移。不存在额外后台资源创建或自动删旧历史的产品策略。

## 9. 测试与真实验收

方法级：事件唯一键、非法前进、跳过／unknown、当次终态不被当前Release改写、阶段时间非负且未知不补值、cursor稳定、回执匹配、同请求指纹、草稿隔离、动作与回看步骤分离。

模块级真实PG：受理及事件原事务、队列重放幂等、单release多journey不覆盖、普通及fenced同意图防重、非法跨service／project写拒绝、验证revision过期、原切流与迁移策略、事件追加失败事务回滚、实际观察未完成不complete、完整历史分页、旧库升级、项目删除全表／关系／外项目保持。

工作台：保持原publishWizard／releaseDelivery／releaseLifecycle语义断言；新向导覆盖正常三动作、自动只读推进、失败就地、离线前后、刷新恢复、开发者交接负责人、未知精确ID、历史回看零POST、长列表末行往返、重复redeploy及旧缺失记录。中英文及所有共享入口共同测试。

浏览器：1440／1024／390／320，明暗、中英、纯键盘；量步骤／按钮几何、main内滚动、焦点与历史返回；Network轨迹证明点击历史及回看零业务写，验证应用新标签不离开原向导。原型检查单独留证，不能充当生产实现验收。

实现后按candidate内容执行一次完整门禁、精确路径提交、准确SHA六CI；部署与真实发布验收需其具体授权与资源边界。实际创建发布／切换真实流量不由浏览器预览自动触发。
