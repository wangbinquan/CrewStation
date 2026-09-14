# 0004. Agent 运行配置拥有独立领域模块

- 状态：提议
- 日期：2026-09-14
- 关联：[RFC-004](../../proposal/rfc/RFC-004-admin-agent-runtime/proposal.md)

## 背景

管理员配置 Claude Code／OpenCode 的连接、认证、运行参数、版本与检查是新的领域对象。它既不是项目的开发／生产业务配置，也不是 TaskEnvironment 的容器生命周期。project 与 dev-session 已分别有 39／40 个生产源码文件，不适合继续承接整个管理子系统。

## 提议

新增 L3 `agent-runtime` 模块，拥有运行配置、不可变版本、凭据引用、检查记录与解析服务，使用自有 `agent_runtime` PostgreSQL schema。运行检查通过 ports，由 platform 注入 task-runtime 执行器，L3 不 import L4。

现有算力档位继续归 project（L2），增加运行配置引用及 revision。project 的引用验证走窄端口，platform 回填 agent-runtime 实现，沿用 ADR-0003 的装配约定。不同模块只经公开 API／端口交互，不跨 schema join，不把业务逻辑移入组合根。

dev-session 与 business-task 经统一 compute 解析端口获得快照，task-runtime 管理检查任务及容器，session 负责受控传输。无领域含义的驱动配置 renderer 归 packages/agent-drivers，实际加载归 runtimes/task。

## 后果

- 新增一个有明确生命周期与存储归属的模块；批准后更新结构文档模块表／依赖图。
- 现有模块只扩展绑定、端口与运行记录，不横向增加跨模块 facade。
- 不提高源码／函数／目录尺寸上限，不引入门禁例外。
- 旧 Secret 与旧档位的兼容行为由 RFC-004 明确约束，不能借结构调整删除既有运行能力。

本文件尚未获批，不表示模块已加入实现或结构规则已经修改。
