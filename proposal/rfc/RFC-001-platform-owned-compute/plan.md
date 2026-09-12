# RFC-001 · 算力由平台统一提供｜Plan

- 状态：Draft
- 日期：2026-09-12

## 任务分解

按依赖顺序；每个子任务都自带测试（开发规则 §4），做完一批提交一次。

| 编号 | 任务 | 依赖 | 产物 |
|---|---|---|---|
| **RFC-001-T1** | contracts：新增 `ComputeProfileDto` 与租户投影；`AgentProfileSchema` 去 driver/model 加 `compute` 并 `.strict()`；`StartDevAgentRequest`、`AgentInstanceDto`、`RunnerCommand.startAgent`、`AgentEvent.spec` 同步 | — | `packages/contracts/**` ＋ Schema 测试 |
| **RFC-001-T2** | `modules/project`：档位表、迁移、CRUD 用例、两种投影、管理员校验 | T1 | `modules/project/**` ＋ 模块测试 |
| **RFC-001-T3** | `packages/settings`：`defaultComputeProfile`（`CS_DEFAULT_COMPUTE_PROFILE`，缺省 `balanced`） | T1 | `packages/settings/platformSettings.ts` |
| **RFC-001-T4** | `modules/dev-session`：起 Agent 时解析档位；不存在与默认档缺失两条失败路径；`listAgents` 显示档位名 | T2 T3 | `modules/dev-session/**` ＋ 五条用例 |
| **RFC-001-T5** | `modules/business-task`：子任务按登记的档位启动 | T2 | `modules/business-task/**` ＋ 用例 |
| **RFC-001-T6** | `modules/release`：发布校验 Manifest 的 `compute` 存在 | T2 | `modules/release/application/pipelineDeploy.ts` ＋ 用例 |
| **RFC-001-T7** | `modules/capabilities`：能力说明补「本服务可用的算力档位」 | T2 | `modules/capabilities/**` |
| **RFC-001-T8** | 组合根接线：`ComputeCatalog` 端口注入 dev-session、business-task、release | T2 T4 T5 T6 | `modules/platform/wiring.ts` |
| **RFC-001-T9** | 工作台：新建 Agent 改档位下拉（去掉自由文本模型框）；Agent 列表显示档位名 | T1 T4 | `apps/console/src/features/dev-session/**` ＋ 源码层文本断言 |
| **RFC-001-T10** | 工作台：平台管理新增算力档位页，与两类套餐并列 | T2 | `apps/console/src/features/admin/**` |
| **RFC-001-T11** | 模板与接入容器的 Manifest 改用档位名 | T1 T6 | `templates/minimal-sample/`、`integrations/*` |
| **RFC-001-T12** | 安装器种入三个初始档位（`sample-stub` / `balanced` / `deep`） | T2 | `apps/cli/src/cluster/installInitialize.ts`、`deploy/local/` |
| **RFC-001-T13** | 本机端到端复跑：开通链 → 首个标签发布 → 开发会话起 Agent → `/chat` 业务子任务链 | 全部 | 实跑证据写回 `STATE.md` |

## 提交拆分建议

单个 RFC 默认对应单次连贯的提交序列，不开分支（开发规则 §1）。建议按三段提交：

1. **T1–T3**：契约与目录对象。这一段落地后全仓会红（调用方还没改），**不推**，与第二段一起推。
2. **T4–T8**：平台侧解析与接线。与第一段合并后 `bun run check` 必须绿，此时推第一次。
3. **T9–T12**：工作台与模板、安装器。第二次推。
4. **T13**：实跑与 `STATE.md`，第三次推。

## 验收清单

- [ ] `crewstation.yaml` 里写 `driver` 或 `model` 会被发布拒绝，错误指向本 RFC
- [ ] `POST /v1/tasks/:taskId/agents` 不接受 `driver` / `model`，`compute` 可省略
- [ ] 引用不存在的档位：发布与起 Agent 都失败，错误列出可用档位名
- [ ] 默认档位未配置时报 `precondition`，不静默挑一档
- [ ] 工作台新建 Agent 只有档位下拉，全仓搜不到模型自由文本输入
- [ ] 平台管理有算力档位增删改页
- [ ] 租户面接口不返回 `driver` 与 `model`
- [ ] 本机跑通：开通 → 发布 → 开发会话起 Agent → `/chat`
- [ ] `bun run check` 全绿，CI 绿
- [ ] `proposal/rfc/README.md` 的状态改为 Done 并附 commit
- [ ] `STATE.md` 更新
