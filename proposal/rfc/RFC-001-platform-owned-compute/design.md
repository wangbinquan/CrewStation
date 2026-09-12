# RFC-001 · 算力由平台统一提供｜Design

- 状态：Draft
- 日期：2026-09-12

## 1. 落位

按 `docs/engineering/repository-structure.md` §5 的分层，本 RFC 的改动落在：

| 模块／包 | 层 | 改什么 |
|---|---|---|
| `packages/contracts` | — | `AgentProfileSchema` 去 driver/model 加 compute；新增 `ComputeProfileDto`；`StartDevAgentRequest` 同改；`RunnerCommand.startAgent` 与 `AgentEvent.spec` 加 `compute` 透传字段 |
| `modules/project` | L2 | 算力档位的 CRUD 与查询，与 `ServicePlan` / `TaskProfile` 同处（它已经拥有这两类目录对象） |
| `modules/dev-session` | L5 | 起 Agent 时把档位名解析成 driver＋model |
| `modules/business-task` | L5 | 子任务启动时同样解析 |
| `modules/release` | L4 | 发布校验 Manifest 引用的档位存在，与现有的 `ServicePlan` 校验并列 |
| `apps/console` | — | 新建 Agent 改下拉；平台管理加算力档位页；Agent 列表显示档位名 |
| `templates/minimal-sample`、`integrations/*` | — | Manifest 改用档位名 |

**零改动**：`runtimes/task`、`packages/agent-drivers`。容器里跑的仍是具体 driver 与 model，解析全部发生在平台侧，TaskRunner 协议的这两个字段语义不变。

**不新增模块**，因此不需要 ADR。`ComputeProfile` 归 `modules/project`，理由与 `ServicePlan` / `TaskProfile` 相同：它们是同一类「管理员定义、Manifest 按名引用」的目录对象，`project` 已经是它们的宿主，再开一个模块只会让组合根多一条边。

## 2. 对象与契约

### 2.1 ComputeProfile

```ts
export const ComputeProfileDtoSchema = z.object({
  name: SlugSchema,
  /** 平台内部：这一档实际用哪个驱动。租户面不返回。 */
  driver: AgentDriverSchema,
  /** 平台内部：`<provider>/<model>`。租户面不返回。 */
  model: z.string().min(1),
  /** 给业务看的一句话说明，会出现在工作台的档位下拉里。 */
  description: z.string().default(''),
});
```

与 `ServicePlanDto` / `TaskProfileDto` 同构（`name` ＋ 规格字段 ＋ `description`）。

**租户面与管理面返回不同投影**，这是本 RFC 唯一一处按角色分投影的地方：

| 面 | 路由 | 返回 |
|---|---|---|
| 租户 | `GET /v1/catalog/compute-profiles` | `{ name, description }[]` —— 够工作台画下拉，不泄露厂商与模型 |
| 管理 | `GET /v1/catalog/compute-profiles?full=true`（仅管理员） | 完整 `ComputeProfileDto[]` |
| 管理 | `PUT /v1/catalog/compute-profiles`（仅管理员） | 按 `name` 新增或覆盖，与现有两类套餐的 upsert 一致 |

非管理员带 `full=true` 时**按无此参数处理**（返回裁剪投影），不报错——这是查询参数不是权限边界，报错只会让调用方去猜。

**默认档位**：`packages/settings` 加 `defaultComputeProfile`（环境变量 `CS_DEFAULT_COMPUTE_PROFILE`，缺省 `balanced`），与已有的 `defaultServicePlan` / `defaultTaskProfile` 同形。

### 2.2 Manifest

```diff
 export const AgentProfileSchema = z.object({
   name: SlugSchema,
-  driver: AgentDriverSchema,
-  /** `<provider>/<model>`，与 agent-workflow 的写法一致。 */
-  model: z.string().min(1),
+  /** 引用管理员定义的算力档位名；算力来源由平台决定，业务不声明厂商与模型。 */
+  compute: SlugSchema,
   permission: AgentPermissionSchema.default('edit'),
   systemPromptFile: z.string().min(1).optional(),
 });
```

`zod` 的对象默认剥掉未知键，因此**旧写法不会自动报错**——`driver: claude-code` 会被静默丢弃。这不可接受：业务会以为自己指定了驱动。解决办法是给这个对象加 `.strict()`，未知键直接拒绝，错误信息指向本 RFC。这条对 `AgentProfileSchema` 单独生效，不改其他 Schema 的宽松策略。

### 2.3 开发会话

```diff
 export const StartDevAgentRequestSchema = z.object({
-  driver: AgentDriverSchema,
-  model: z.string().min(1),
+  /** 省略时用平台默认档位。 */
+  compute: SlugSchema.optional(),
   permission: AgentPermissionSchema.default('edit'),
   prompt: z.string().min(1),
   cwd: z.string().optional(),
   resumeSessionId: z.string().optional(),
 });
```

`AgentInstanceDto` 去掉 `driver` 与 `model`，加 `compute: string`。

### 2.4 TaskRunner 协议

`RunnerCommand.startAgent` **保留** `driver` 与 `model`（容器要拿它们真的去跑），**新增** `compute: string`：平台原样透传，TaskRunner 不解释，只在 `started` 事件的 `spec` 里回显。

```diff
 spec: z.object({
+  compute: z.string(),
   driver: AgentDriverSchema,
   model: z.string(),
   permission: AgentPermissionSchema,
 }).optional(),
```

**为什么要透传而不是平台侧反查**：两个档位可以指向同一个模型，从 `(driver, model)` 反查不出唯一的档位名。而 `listAgents` 是按持久事件还原的（`modules/dev-session/application/agents.ts`），事件里没有档位名就只能再编一次——这正是上一轮刚修掉的那类 bug。

## 3. 数据流

```
管理员 → PUT /v1/catalog/compute-profiles → project 模块落库
                                                   │
业务 Manifest: compute: balanced ──────────────────┤
开发会话请求:  compute: balanced（或省略→默认档）───┤
                                                   ▼
                              dev-session / business-task
                              经端口向 project 解析档位名
                                                   │
                                    ┌──────────────┴──────────────┐
                                    ▼                             ▼
                        未找到 → validation 报错          找到 → { driver, model }
                        列出当前可用档位名                        │
                                                                  ▼
                              RunnerCommand.startAgent { compute, driver, model, … }
                                                                  ▼
                                                    TaskRunner 按 driver+model 起进程
                                                    started 事件回显 spec.compute
```

**解析发生在平台侧、不在容器里**：容器拿到的是已经定好的具体值，因此任务镜像与驱动包完全不用改；也避免了「容器需要读平台目录」这条新依赖。

## 4. 与现有模块的耦合点

| 耦合 | 处理 |
|---|---|
| `dev-session`（L5）→ `project`（L2）取档位 | 新增端口 `ComputeCatalog { resolve(name): Promise<{driver, model} \| undefined>; list(): Promise<…> }`，组合根注入。方向是高层依赖低层，合规。 |
| `business-task`（L5）→ `project`（L2） | 同上，同一个端口 |
| `release`（L4）→ `project`（L2） | 已有 `plans: { getServicePlan }`，加一个 `getComputeProfile` 即可，位置在 `modules/release/application/pipelineDeploy.ts:22` 旁边 |
| `capabilities`（L6） | 能力说明里已有「配额与套餐」一节，加上本服务可用的档位名与说明 |

## 5. 失败模式

| 情形 | 行为 |
|---|---|
| Manifest 引用不存在的档位 | 发布在校验阶段失败，`validation` 错误列出当前可用档位名。与引用不存在 `ServicePlan` 的行为一致，**不**部署半截。 |
| 开发会话请求不存在的档位 | 400 `validation`，同样列出可用档位名 |
| 请求省略 `compute` 且默认档位也不存在 | 500 之外的明确失败：`precondition`「平台尚未配置默认算力档位」，指向管理员去配。**不静默 fallback 到任意一档**——静默挑一档会让业务以为自己拿到了预期算力。 |
| Manifest 写了 `driver` 或 `model` | `.strict()` 拒绝，错误指出这两个字段已由平台接管、改用 `compute` |
| 管理员删掉一个仍被引用的档位 | 首版**允许删**，下一次发布或下一次起 Agent 时按「引用不存在的档位」失败。删除前的引用检查留给后续 RFC；本 RFC 在管理页删除按钮旁给出提示。 |

## 6. 测试策略

必写的 case（开发规则 §4，CI 必须全绿）：

**contracts**
- `AgentProfileSchema` 接受 `compute`，拒绝 `driver` 与 `model`（`.strict()` 生效）
- `StartDevAgentRequest` 省略 `compute` 可解析

**modules/project**
- 档位 upsert 按 `name` 覆盖；非管理员写被拒
- 租户投影不含 `driver` 与 `model`；管理员投影含

**modules/dev-session**
- 给定档位名 → `startAgent` 命令带上正确的 driver＋model＋compute
- 省略档位 → 用默认档
- 不存在的档位 → `validation`，错误里列出可用名
- 默认档位未配置 → `precondition`
- `listAgents` 显示的是档位名（沿用上一轮那条「不编造」的回归测试，把断言从 driver/model 换成 compute）

**modules/business-task**
- 子任务按 Manifest 里登记的档位启动

**modules/release**
- 引用不存在的档位 → 发布被拒，不进入构建

**apps/console**
- 无自由文本模型输入：一条源码层文本断言锁住「`features/dev-session` 下不再出现 model 输入框」

## 7. 迁移

本仓内的全部引用一次性改完，无兼容期（§Proposal 5 已说明理由）：

- `templates/minimal-sample/crewstation.yaml`：`driver: stub, model: stub/echo` → `compute: sample-stub`
- `integrations/gitlab-event-producer`、`integrations/reference-api-proxy`：同改（若它们的 Manifest 有 agentProfiles）
- 安装器种下默认档位：与 `ServicePlan` / `TaskProfile` 一样，由 `apps/cli` 的 install 初始化阶段（`apps/cli/src/cluster/installInitialize.ts:36` 旁）种入；本机另由 `deploy/local/` 的脚本种一份，保证 `install-platform.sh` 之后即可用。

**首版种哪几档**（管理员随时可改，这只是初始值）：

| 名字 | driver | model | 说明 |
|---|---|---|---|
| `sample-stub` | `stub` | `stub/echo` | 样例与自测用，不消耗真实算力 |
| `balanced` | `claude-code` | `anthropic/claude-sonnet-5` | 默认档 |
| `deep` | `claude-code` | `anthropic/claude-opus-5` | 复杂分析与重构 |

`cheap`（opencode 档）等到有明确的模型选型再加，本 RFC 不预置一个填不出 model 的空档。

## 8. 偏离与债

- **租户面与管理面分投影**是本仓第一次按角色裁剪同一个 DTO。判据清楚（厂商与模型标识符属于平台采购信息），但它开了一个先例；若后续还有同类需求，应在那时统一成一套「按角色投影」的机制，而不是逐个手写。本 RFC 先手写这一处，债记在此。
- **删除档位不做引用检查**，见 §5 最后一行。
