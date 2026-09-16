# agent-runtime（L3）

管理员定义 Agent 启动前 Hook（预置文件、执行脚本）、不可变版本、凭据引用、运行环境检查与启动材料解析（RFC-004、ADR-0004）。

- 算力档位仍归 `project`：它只保存 `runtimeConfigId` 与 revision，绑定校验经 `RuntimeConfigDirectory` 端口回到本模块。
- 检查在平台专属短期任务里执行，由 `CheckExecutor` 端口注入（platform 用 task-runtime 实现），本模块不 import L4。
- 密钥只以 SecretBox 密文落库；GET 从不返回原值，启动材料只经受控 Runner 命令通道发给目标任务。

模板与规则见 `docs/engineering/repository-structure.md` §3。
