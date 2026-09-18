# 0004. Agent 运行配置拥有独立领域模块

- 状态：已接受，2026-09-16 已实施（`modules/agent-runtime` 已创建，随 RFC-004 落地）；其中「现有算力档位继续归 project」一条随 RFC-006 的实施改由 [ADR-0005](0005-compute-profile-in-agent-runtime.md) 规定（2026-09-18 起实施，待作者复核）
- 日期：2026-09-14
- 关联：[RFC-004](../../proposal/rfc/RFC-004-admin-agent-runtime/proposal.md)

## 背景

管理员定义 Agent 启动前的配置文件／目标路径和 Shell／Python／JS 初始化脚本，并维护版本与检查，是新的领域对象。Claude Code／OpenCode 是首批配置预设。它既不是项目的开发／生产业务配置，也不是 TaskEnvironment 的容器生命周期。project 与 dev-session 已分别有 39／40 个生产源码文件，不适合继续承接整个管理子系统。

## 决策

新增 L3 `agent-runtime` 模块，拥有运行环境、启动前 Hook 步骤、不可变版本、凭据引用、检查记录与解析服务，使用自有 `agent_runtime` PostgreSQL schema。运行检查通过 ports，由 platform 注入 task-runtime 执行器，L3 不 import L4。

现有算力档位继续归 project（L2），增加运行配置引用及 revision。project 的引用验证走窄端口，platform 回填 agent-runtime 实现，沿用 ADR-0003 的装配约定。不同模块只经公开 API／端口交互，不跨 schema join，不把业务逻辑移入组合根。

dev-session 与 business-task 经统一 compute 解析端口获得快照，task-runtime 管理检查任务及容器，session 负责受控传输。两类动作的协议归 contracts，通用文件预置／脚本执行、进程组控制、环境输出与实际启动归 runtimes/task；CLI 最终配置合成归 packages/agent-drivers。beforeStart 不挂到 Claude 的工具 hooks 或 OpenCode 插件里，不让 CLI 专有事件拥有平台初始化流程。

## 后果

- 新增一个有明确生命周期与存储归属的模块；批准后更新结构文档模块表／依赖图。
- 现有模块只扩展绑定、端口与运行记录，不横向增加跨模块 facade。
- 不提高源码／函数／目录尺寸上限，不引入门禁例外。
- 旧 Secret 与旧档位的兼容行为由 RFC-004 明确约束，不能借结构调整删除既有运行能力。

2026-09-14 作者批准 RFC-004，并明确在 RFC-003 完结后启动开发；关联的新模块及职责边界随方案接受。2026-09-16 作者以会话目标要求立即落地：`modules/agent-runtime`（L3，`agent_runtime` schema）经 `bun run scaffold:module` 创建，检查执行器与档位引用两个端口由 `modules/platform/wiring.ts` 回填，结构文档模块表／依赖图已同步；`tools/arch` 六项规则在本批全部通过，未新增例外。
