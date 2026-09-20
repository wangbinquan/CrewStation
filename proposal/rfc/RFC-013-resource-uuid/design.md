# RFC-013｜资源 UUIDv7 技术设计

> 状态：In Progress · 2026-09-20。作者已确认 UUIDv7 格式，并批准实施、部署及提交上库。
> 事实与源码锚点见 [audit.md](./audit.md)；需求、影响清单见 [proposal.md](./proposal.md)。

## 1. 身份约束

- 平台自有资源 ID 一律为小写、36 字符、带连字符的 UUIDv7，形状 `xxxxxxxx-xxxx-7xxx-[89ab]xxx-xxxxxxxxxxxx`，保留全部 128 位。由服务端统一分配，已有 ID 不允许修改。
- `packages/kernel/ids.ts` 提供无业务前缀的生成器；`packages/contracts/ids.ts` 统一格式验证，保留 ProjectId、ServiceId 等品牌类型，补齐目前退化为普通 string 的资源 ID。不要靠字符串前缀判断类型。
- 名称是展示与搜索属性。编辑名称不改主键；复制实体及独立子资源分配新 UUIDv7；同名冲突有明确规则，不能用名称 upsert 意外覆盖。
- HTTP 路径中的 method／path、环境变量名、事件编码、项目 slug 等若承担业务协议意义，使用独立 code／slug／path 字段。它们不等于显示名称，不能用 UUID 替换真实协议内容。
- `default` 不伪装成 ID：用 `{ kind: 'default' }` 或 `{ kind: 'profile', profileId }` 区分；每次新受理解析默认，受理后固定为 `{ profileId, revision }`。
- traceId、Git SHA、Kubernetes UID、外部 CLI sessionId、IdP subject、幂等键和序号按各自协议校验。平台生成的 Agent／终端／步骤／执行实体 ID 必须符合 UUIDv7；协议常量和阶段 kind 不属于资源 ID。

## 2. 模块与层次

沿用现有模块及层次，不新增领域模块，不放宽依赖方向或尺寸限制。`repository-structure.md` §3、§4、§7 仍成立。

| 归属 | 承担内容 |
|---|---|
| kernel／contracts | ID 生成与校验、品牌类型、请求响应／Manifest／事件／Runner 的新字段与显式旧版解析 |
| project L2 | ServicePlanId、TaskProfileId；已有项目／服务／用户关联和初始套餐引用 |
| scm L3 | TemplateId 与模板来源元数据；创建项目、模板物化、仓库绑定及会话凭据中的引用 |
| config L3 | 配置定义、环境取值、版本快照的身份与按 ID 修改／删除；保持变量注入语义 |
| agent-runtime L3 | ComputeProfileId、CredentialId、StepId；修订、测试、默认、引用与项目授权全链 |
| api-catalog／events L3 | 代理、操作、生产方、事件类型的独立 ID；Grant、申请、订阅、收件与投递引用 |
| identity／data／egress | 所属实体与跨模块引用；外部标识与自然去重键作为属性保留 |
| release／task-runtime L4 | 发布后的固定资源引用、环境创建、运行载荷、物理对象命名与恢复 |
| dev-session／business-task／session／gateway L5 | Agent／终端／业务子任务、历史与重连；网关目录使用 serviceId／operationId |
| capabilities／observability／cluster-management L6 | 聚合 DTO、搜索标签、运维目标与记录的 ID；外部 UID 仍用于匹配真实对象 |
| platform L7／persistence 技术包 | 在组合根编排各模块公开的升级参与者；persistence 只提供事务、锁、阶段和校验和机制，不认识业务资源 |
| api-client／console／CLI／MCP／task runtime | 路由、选择值、缓存键、工具参数、运行协议、升级后的业务使用方式 |

新增迁移与升级适配代码放各模块 `adapters/persistence/`，纯映射规则放 domain，模块根只导出所需的升级参与接口；平台不得直接 import 其他模块的内部表。前端继续只依赖 contracts 与 api-client。

## 3. 资源模型

| 资源 | 主身份 | 保留的属性／唯一约束 |
|---|---|---|
| 服务套餐、任务套餐、算力档位 | 独立 `id` | name 为展示；旧 name 只在升级映射中保存 |
| 档位修订 | `profileId + revision` | revision 是并发／版本序号；不另造会改变版本语义的主键 |
| 档位凭据 | `credentialId`，关联 profileId | 注入符号另存为 binding name；保留同一档位内符号唯一性 |
| 启动前步骤 | `stepId` | 顺序是数组位置，name 是标签；复制档位／步骤重新分配 ID |
| 项目模板 | `templateId` | sourcePath／模板显示名分离；稳定 ID 随模板元数据保存，不能启动一次换一次 |
| API 代理、事件生产方 | `proxyId`／`producerId` | serviceId、route code／producer code；重放发布沿用所属对象 ID |
| API 操作 | `operationId`，关联 proxyId | `(proxyId, method, path)` 唯一；summary 是展示；修改 method/path 是协议变化，不能仅凭列表位置继承关系 |
| 事件类型 | `eventTypeId`，关联 producerId | 协议 event code 保留；显示名独立。code 变化的身份策略必须显式处理，不能按显示名称自动合并 |
| 配置定义 | `configDefinitionId`，关联 projectId | 注入绑定符号独立；Manifest 引用定义 ID，开发／生产按环境取值 |
| 配置环境取值 | `configItemId`，关联 definitionId 与 env | `(definitionId, env)` 唯一；isSecret 与取值保留各环境现状；版本条目保存定义／取值 ID 与当时符号 |
| Manifest 的 Agent 档案／输出契约 | `agentProfileId`／`outputContractId` | 新版声明携带稳定 UUIDv7；源码符号另存，执行及结果关联使用 ID |
| 网关服务路由 | serviceId | 域名／路径是投影内容；独立路由组若有生命周期再分配自己的 ID |

项目成员、服务仓库绑定、配额等现有一对一或关系对象继续使用 UUID 组成的关系键，无须把序号、枚举和每张关系表都伪装成另一类资源。

旧库已有多个代理行指向同一个服务时，逐行保留其 ID 与 removed 状态，不自动合并历史。新发布按明确的当前所属对象匹配；多条活动归属冲突必须在预检报告中解决。

模板 sourcePath 是文件地址。内置模板元数据持有固定 UUIDv7；自定义模板首次登记后持久保存 ID。拷贝成新的可选模板分配新 ID，不能从目录名实时计算身份。固定数据 plan 标签和未实现的连接目录不在本次凭空新增 CRUD；将来成为可选资源时必须执行相同身份规则。

## 4. API 与前端

目标命名使用显式的 `*Id`，不把原 name 字段偷偷改成存 UUID。

| 现入口／引用 | 新入口／引用 |
|---|---|
| `/v1/admin/compute-profiles/:name` | `/v1/admin/compute-profiles/:profileId`；DTO 同时有 id、name |
| 服务／任务套餐以 name PUT 整个集合 | POST 创建；PUT `/:planId`／`/:profileId` 更新；重复创建不能变成覆盖 |
| 配置项 name upsert／`:name` 删除 | POST 创建取值；按 `configItemId` 更新／删除；保留显式 env 和版本条件 |
| `/v1/catalog/proxies/:proxy/openapi` | `/v1/catalog/proxies/:proxyId/openapi` |
| API `operationKey` 请求／策略／撤销 | `operationId`；展示使用 proxy label、method 和 path |
| `allowedProfiles/defaultProfile/devTaskProfile` | `allowedProfileIds/defaultProfileId/devTaskProfileId` |
| 创建项目的 template／plan | `templateId/servicePlanId`；服务端根据已登记默认值补齐，不能在 Schema 内硬编码一个安装相关 ID |
| Runner 的 compute／profile 名称 | `computeProfileId`、`profileId + revision`；必要的显示名称作为快照字段 |

所有改动同步 contracts、OpenAPI、api-client、console、CLI 与 MCP。错误要区分 malformed ID、找不到资源、作用域不匹配、版本冲突；保留字段级错误和表单草稿。

控制台列表仍显示名称；详情提供完整 ID 的复制入口。选择器 value、React key、TanStack Query key、路由参数及草稿作用域用 ID。重新命名后保留选中项和页面位置。长 ID 在 320／390px 宽度下可换行或局部滚动，不挤出整页。

新资源 UUID 由服务端分配；编辑器临时行用独立 clientKey，保存成功后绑定服务端 stepId，避免浏览器生成 UUIDv4 后误存为正式资源。新 API 不允许 `id || name`、`getById ?? getByName` 这类模糊解析。

## 5. Manifest、业务协议与固定快照

建议新增 `crewstation/v2`，旧版 parser 与新版 parser 显式分开；不要把 v1 的字段原地收紧后使已发布历史无法读取。

- 新版 service 引用 servicePlanId，tasks 引用 taskProfileId，Agent 选算力使用显式默认选择器或 computeProfileId。
- API 申请用 operationId，事件订阅用 eventTypeId，环境变量用 configDefinitionId；变量名、handlerPath 和业务调用 URL 保持协议内容。
- 自己声明的 Agent 档案、输出契约和步骤持有稳定 ID；模板物化／编辑器提供分配入口并写入新 Manifest。首次创建时分配后持久化，重复发布不得重新分配。
- v1 解析器只在导入、历史／旧版本和旧业务入口存在。解析一次得到规范引用表，保存到发布／受理记录；执行、重试和关联查询读固定 ID。
- `default` 在新受理时解析；已排队任务继续使用原 profileId 和 revision，不能借迁移重新选当前默认档位。
- API 的可读 URL 和事件 type 编码在边界解析到 ID；发布和执行的跨资源关系按 ID 保存。旧请求的符号映射限定在服务、发布、类型与有效期范围，不能全局随名查找。

发布原始 Manifest、Git commit、业务 payload、原始日志和档位 contentHash 作为历史事实保留原文。为旧快照增加带 schemaVersion 的规范引用投影；若编码变换需要新的内容哈希，另存转换摘要及原摘要，不能覆盖原摘要后宣称还是原修订。读取器先辨别版本，再使用相应投影；规范执行材料不得继续漏出旧 name 引用。

源码仓库中的旧 Manifest 通过生成可审阅补丁升级，不能批量重写用户未提交工作；旧版兼容读取仍允许打开开发会话来修正文件。

## 6. 旧库升级

### 6.1 映射与幂等

每个模块保存其拥有实体的映射：`(resourceKind, scope, legacyKey) -> uuidV7`。先分配并保存，再重写引用；已存在映射直接复用。名称式旧键必须带资源类型和作用域；同后缀的 tsk／agt／pty 不得合并。

已有正确 UUIDv7 原值保留；平台自有的前缀 ID、UUIDv4、哈希 ID、短 ID和保留虚拟主体都纳入映射。保留主体获得不同且固定的合法 UUIDv7，保持原来的内部语义，不把它们创建成普通登录用户。

首次从历史 name 解析资源时必须有唯一、可核对的归属。已删除定义的历史引用需要保留不可选的历史身份记录；若同名重建导致无法分辨原对象，预检报告具体来源与歧义，阻止该候选切换，不能绑定到现在同名的资源。

### 6.2 执行阶段

现有 SQL 运行器把所有迁移放在同一事务与咨询锁内（`packages/persistence/migrations.ts:21-46`）。本次跨模块数据升级不能用各模块独立提交拼出半完成状态。

1. **只读预检**：记录各实体／引用数量、孤儿／歧义、现有 ID 形状、活动 Runner、待处理队列、物理对象名／UID和候选代码摘要。生成逐类影响清单。
2. **备份与写入维护窗口**：备份验证可读后，暂停本次切换涉及的资源写入口和工作器；外部事件入口持久缓冲或明确返回可重试状态，不能吞事件。普通代码开发无需停。
3. **expand**：仅新增本模块 ID／引用投影／映射列与必要索引；历史 SQL 迁移不修改。结构就绪不代表应用已切换。
4. **同一数据升级事务**：先让所有模块准备自身映射，再由 platform 传递只读映射给引用方；每个参与者只读写本模块表。对已登记路径重写普通列及 JSON 字段，校验完整性和数量，然后切换主键／约束／数据版本。任何一步失败整段回滚。
5. **运行态接续**：重建可派生的目录／路由投影；服务通过显式兼容入口接受已运行旧进程的身份和帧，规范化后再入库。保留既有 Pod／PVC 的 name 与 UID。刷新客户端缓存与游标版本，恢复工作器和资源写入口。
6. **验证与回退界线**：切换失败且尚未开放新写入时可恢复本次事务或备份；已接受新写入后不得直接覆盖旧备份，需前向修复或先保存新增数据再进行明确的恢复流程。

技术落点为各模块的升级参与者与 platform 的一次编排；persistence 提供同一 Executor、升级版本、锁与阶段记录。阶段 SQL 与不可变数据转换入口均需登记校验和，迁移锁检查覆盖新增的转换入口；不得将跨模块 SQL 放到一个高层模块的 migration 文件绕过数据归属。新增 SQL 逐个路径入锁。

重写清单至少覆盖：实体列、所有 `createdBy/updatedBy/ownerUserId`、项目授权、发布／部署槽、配置信息、档位修订投影与测试 stages、Agent／终端／重建记录、业务子任务、会话事件、工作区布局、API Grant／申请、事件 inbox／delivery、网关表、运维 body、告警、outbox 和队列 payload。只转换已声明的字段路径，不对任意 JSON／业务 payload／脚本／日志做全字符串替换。

### 6.3 物理资源和幂等操作

新 Pod／PVC 命名使用完整 UUIDv7 的无连字符形态及用途前缀，校验 Kubernetes 长度与字符约束；不再取 `slice(4,16)`。已存在物理名字及 UID 不变，恢复读取持久化名称，不由新 ID 反推旧名称。

CLI 运维重启在首次受理时原子持久保存新的 taskId、agentId、terminalId，再依操作幂等键复用；不把同一段哈希当成三个实体的 UUID。崩溃重试不能再创建另一组 Pod 或记录。

## 7. 兼容入口与完成条件

旧格式只能出现在明确命名的兼容解析器、升级映射和原始历史事实中。领域 Repository、当前资源 DTO、新路由生成、项目策略和规范化执行材料只接受 UUIDv7。

旧 GET 书签可按资源类型和作用域经 legacy resolver 返回 canonical ID，再由页面替换地址。旧写接口要么在版本化业务适配器里唯一解析并固定，要么明确拒绝并给出升级指引；管理 API 不做猜测。兼容入口不允许从 UUID 查询失败退回 name 搜索。

已固定的旧档位镜像仍接受协议 2：创建容器前持久登记同一任务的 `tsk_` 协议别名，旧镜像从 `CS_RUNNER_TASK_ID` 读取；协议 3 从 `CS_CANONICAL_RUNNER_TASK_ID` 读取规范 UUID。业务 `CS_TASK_ID` 保持平台 UUID。新建档位向协议 2 下发时持久绑定独立的兼容符号，不能在正常资源 API 中按此符号查询。

持续运行的旧进程未被升级时，不能宣称已删除全部旧协议支持。完成验收必须分别列出当前资源与引用已统一、迁移后历史可读、兼容入口数量和适用范围；不把保留原文中的名称误报成新领域关系仍使用名称。

## 8. 必带验证

- ID 生成与 Schema：版本／variant／长度、非法输入、不同类型的 branded IDs、旧 ID 适配边界；生成器真正调用 UUIDv7。
- 所有资源创建／复制／名称编辑与名称冲突；数据库成功路径及按 ID 更新／删除；默认和项目作用域保持。
- 从旧迁移版本建真实 PostgreSQL 夹具，灌入跨模块引用、相同 hex 后缀、UUIDv4、虚拟主体、重复名称的不同作用域、已删除定义与孤儿；执行升级，核对数量／引用／幂等／失败回退。
- API 再发布、操作移除再声明、Grant／申请、Swagger 与真实网关解析；事件重放／去重／订阅与投递。
- 旧 Manifest、固定修订／哈希、默认切换、在途测试、Agent 重启幂等、队列旧消息、旧 Runner 重连、工作卷恢复。
- 模板创建、配置开发／生产取值和版本、console／CLI／MCP 的真实参数；名称改动后缓存与书签仍定位原 ID。
- 跨单元契约与结构扫描覆盖禁止名称主键和 ID-or-name 模式；允许的业务符号必须有明确归属，不用全仓豁免掩盖资源遗漏。
- 迁移锁、业务契约金样和协议版本同步；按作者批准的 RFC-013 能力影响清单记录 breaking change。最终按候选运行本地门禁和精确 SHA hosted CI，运行态行为另附实机记录。
