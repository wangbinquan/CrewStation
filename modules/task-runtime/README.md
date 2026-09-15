# task-runtime（L4）

TaskEnvironment 生命周期、Pod 与两种持久卷模式、配额原子准入、TaskRunner 归属与协议服务端语义

RFC-003 I15 的原生 CLI 使用带 `native.parentTaskId` 的独立执行环境，共享父工作卷并冻结各自资源。受理／清理通过持久作业执行，创建与释放同用项目准入锁。父会话查询排除子执行环境；子环境不拥有工作卷，父释放等待所有子执行环境回收。交互入口及动态聚合由 dev-session／session 负责，运行时不读取它们的持久表。

模板与规则见 `docs/engineering/repository-structure.md` §3。
