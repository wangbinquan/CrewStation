# RFC-004｜设计

> Draft · 2026-09-14；与 [proposal.md](proposal.md)、[plan.md](plan.md)、[ADR-0004](../../../docs/adr/0004-agent-runtime-module.md) 一起审阅。无生产实现改动。

## 1. 现状与断点

| 环节 | 当前源码证据 | 缺口 |
|---|---|---|
| 档位 | [plans.ts:16](../../../modules/project/domain/plans.ts#L16)、[manageQuotaAndPlans.ts:39](../../../modules/project/application/manageQuotaAndPlans.ts#L39) | 只有 driver／model；租户投影只有名称／说明，无运行配置就绪状态 |
| 开发启动 | [nativeTerminals.ts:27](../../../modules/dev-session/application/nativeTerminals.ts#L27)、[agents.ts:42](../../../modules/dev-session/application/agents.ts#L42) | 解析档位后发送驱动／模型，env 为空，没有配置版本 |
| 业务启动 | [subtaskLaunch.ts:44](../../../modules/business-task/application/subtaskLaunch.ts#L44) | 同样只有档位解析；需与原生路径一起改 |
| 下发 | [containerEnv.ts:38](../../../modules/task-runtime/application/containerEnv.ts#L38)、[taskCluster.ts:57](../../../modules/task-runtime/adapters/k8s/taskCluster.ts#L57) | 固定 Secret 名在任务命名空间挂载，可选挂载不构成管理流程 |
| 加载 | [runner.ts:84](../../../runtimes/task/src/runner.ts#L84) | 容器创建时一次性读取，所有 Agent 使用同一份旧 agentEnv |
| OpenCode 合成 | [nativeEnv.ts:6](../../../packages/agent-drivers/drivers/opencode/nativeEnv.ts#L6) | 平台当前固定选中供应方／模型，但没有管理员连接设置的输入 |
| 传输 | [commandDispatch.ts:10](../../../modules/session/application/commandDispatch.ts#L10) | 现有受控 Runner 命令通道可承载定向启动材料，不能把敏感材料转入浏览器事件 |

## 2. 落位与依赖

依据结构规则新增 L3 `modules/agent-runtime`，职责为管理员运行配置、不可变版本、验证记录、凭据存储和配置材料解析；详见 ADR-0004。采用 domain／application／ports／adapters／http／api／tests 模板，持久化只访问 `agent_runtime` schema，复用 `packages/secretbox`。

`project` 继续拥有现有算力档位，新增可选 `runtimeConfigId` 与档位 revision。不会把新对象塞进已有 39 个生产文件的 project 或 40 个文件的 dev-session。档位写入通过窄端口验证运行配置引用与驱动；组合根回填端口，沿用 ADR-0003 允许的装配方式，application 不 import 其他模块内部。运行配置被引用时不能物理删除；本期以停用代替删除。

`dev-session`、`business-task` 的 compute 端口统一返回解析后的不可变启动快照；`platform` 装配 project 的档位查询与 agent-runtime 的配置解析。`task-runtime` 承担目标任务容器与运行检查任务的生命周期；`session` 仅传输／协商，不拥有配置。`packages/agent-drivers` 合成两种 CLI 的启动配置；`runtimes/task` 在实际启动边界按版本生成进程私有配置。

前端位于 `features/admin` 的运行配置与档位页签，路由由 app 组合；租户只消费 shared 契约投影。全部输入、行内确认、错误、列表和草稿保护复用 shared；i18n 同时覆盖中英文。此方案不放宽文件／函数／目录尺寸限制。

## 3. 对象与状态

`RuntimeConfig`：id、name、description、driver、draftRevision、activeRevision、enabled、updatedBy、updatedAt。名称 3–40 位 slug，说明上限 500 字。driver 建档后固定，换驱动须新建配置，避免既有版本含义变化。

`RuntimeConfigRevision`：configId、revision、providerId、protocol、baseUrl、authMode、credentialRef、非敏感 env、driverSettings、支持的模型定义、contentHash、createdBy、createdAt。版本只追加；认证为明确的 `none`／`api-key`／`bearer`。自定义请求头中敏感值同样使用引用，不允许把令牌藏进普通 JSON 预览。

`RuntimeCredentialVersion`：版本引用、加密值、键名、修改人／时间；复用平台安装密钥与 SecretBox，不创建新的密钥体系。写请求区分 keep／replace／clear，GET 不返回原值或可重用密文。

`RuntimeValidation`：checkId、configId／revision、taskId、任务镜像 digest、CLI 实际版本、检查阶段与终态、checkedAt、脱敏错误。阶段至少为配置格式、CLI 可用、网络、认证、模型响应；没有真实响应不能标记通过。结果绑定精确配置内容与镜像，编辑或更换不兼容镜像使原检查不能用于启用。

`ResolvedAgentRuntime`：档位名／revision、运行配置 id／revision、driver、model、非敏感摘要、瞬时启动材料。每个已接受的 agentId／native clientRequestId／业务 attempt 固定一次快照；重试和重连使用同一版本，不能重新解析“当前最新”后混用旧幂等请求。

## 4. API 草案

| 接口 | 语义 |
|---|---|
| `GET /v1/admin/agent-runtime-configs` | 有界分页列表，默认 20、最多 50；按名称／driver／状态筛选 |
| `POST /v1/admin/agent-runtime-configs` | 建草稿，不自动启用 |
| `GET /v1/admin/agent-runtime-configs/:id` | 元信息、当前版本、认证已设置状态、引用档位；无密钥原值 |
| `PUT /v1/admin/agent-runtime-configs/:id/draft` | expectedRevision 比较后创建新版本；409 保留原草稿 |
| `POST /v1/admin/agent-runtime-configs/:id/checks` | 固定 revision＋clientRequestId＋目标运行环境，202 返回 checkId |
| `GET /v1/admin/agent-runtime-configs/:id/checks/:checkId` | 查询真实进度与失败阶段，断线后按 ID 恢复 |
| `POST /v1/admin/agent-runtime-configs/:id/activate` | expectedActiveRevision＋目标 revision＋checkId，验证通过后启用；旧确认拒绝 |
| `POST /v1/admin/agent-runtime-configs/:id/disable` | 固定当前版本，阻止后续新受理；不停止已受理进程 |

这些接口只对管理员开放，服务端逐个裁定。现有 `/v1/catalog/compute-profiles` 保留：管理投影增添运行配置绑定、revision 和就绪信息；租户投影只增添可用状态及可理解原因。写操作采用 expectedRevision，旧客户端写已托管档位时返回明确冲突／升级提示，不能无意清掉 runtimeConfigId。新 managed 启动记录可展示自身 runtimeRevision 和加载状态，不展示 provider／网关／认证内容。

## 5. 下发与实际生效

1. 开发／业务应用在受理启动时解析算力档位及已启用运行版本，保存无密钥快照引用。并发启用与受理必须形成可证明的先后关系；受理结束后不可再换版本。
2. 按固定引用读取加密认证并在服务端准备最小启动材料，通过既有认证 Runner 命令通道只发送给目标任务。持久记录、通道诊断、异常和浏览器广播只允许无密钥引用。
3. Runner 通过新增协议能力 `agentRuntimeConfig: 1` 协商。旧 Runner 遇到托管启动在发命令前明确拒绝并保留旧进程；不冒充成功，不自动重建会话。
4. Runner 按 agentId／配置版本生成私有文件和环境，原生与 headless 共用 renderer。私有目录不在 Git 工作树中，各 Agent 不相互覆盖；当前普通终端、预览与构建不会继承模型配置。
5. 驱动解析、认证准备、模型选择失败时返回具名的启动失败和配置版本；创建子进程不等同模型就绪。Runner 确认实际载入后才报告 loaded，模型执行另行以真实轮次状态报告。
6. 进程结束清理其瞬时材料；继续历史会话默认使用原配置快照。用户选择用新配置新开时生成新的运行记录，不冒用原 agentId。

同一容器能同时存在旧版本 Agent 与新版本 Agent，因此不能再靠容器启动时全局读一份 env 文件完成此功能。已托管 Agent 从所选配置解析认证；未迁移档位继续走现有 agentEnvFile 路径，二者不混合。

## 6. 两种 CLI 的配置合成

Claude Code：依据实际版本生成 `settings.json` 与环境变量，连接信息使用官方支持的 `ANTHROPIC_BASE_URL`、认证变量等，配置目录由 `CLAUDE_CONFIG_DIR` 指向进程私有目录。OpenCode：生成所选 provider 的 options／model 配置，与当前原生驱动的 enabled_providers／模型约束合成，不用一个只有 model 字段的占位档位代替连接设置。字段最终效果必须在随镜像固定的 CLI 版本上验证。

高级 JSON 不是拼接 shell 的文本。可配置键按驱动 schema 校验；驱动版本不认识的字段显示具体 JSON 路径错误。平台生成的任务身份、MCP 认证、轮次观测、受控模型、工作目录和启动模式为保留字段，编辑器显示来源，冲突报错。项目业务说明与已有工具授权保持；不能借运行配置默默放大工具授权。

官方依据（2026-09-14 查询，实施仍以镜像实际版本回归为准）：[Claude Code 环境变量](https://code.claude.com/docs/en/env-vars)、[Claude Code 设置](https://code.claude.com/docs/en/configuration)、[OpenCode 配置顺序](https://opencode.ai/docs/config/)、[OpenCode provider 连接配置](https://opencode.ai/docs/providers)。前两者说明环境／目录入口，后两者说明配置合并与 provider options；本 RFC 的版本管理和管理 UI 是 CrewStation 自身设计。

## 7. 兼容、失败与检查执行

迁移仅增加本模块表及 project 自有表的绑定／revision 列，旧档位 runtimeConfigId 为 null。管理页明确展示旧模式，管理员创建、检查并启用配置后显式绑定档位。绑定时校验驱动／模型和引用，原运行记录不重写。`stub` 仍按既有样例用途存在；不得计入真实 CLI 验收。

检查使用平台专属、可识别的短期任务，在指定 Runner 镜像与实际目标出口条件下运行固定测试。L3 agent-runtime 通过验证执行端口调用，由 platform 注入 task-runtime 实现，不反向 import L4。检查具有期限与幂等 ID；任务完成后清理临时资源，仍保留无敏感值结果。目录、直连探测、真实模型调用分别标记，避免把平台命名空间可达误当所有项目可达。一次检查失败不修改 activeRevision；并发编辑后旧检查不能启用新内容。

需要覆盖 401／403、DNS／连接失败、模型不存在、驱动 JSON 不兼容、配置被停用、引用冲突、旧 Runner、检查超时、重复请求、迟到结果和凭据替换／清除。首次启动指向管理员可处理原因，不转嫁给租户手工配置。精确案例见 plan。
