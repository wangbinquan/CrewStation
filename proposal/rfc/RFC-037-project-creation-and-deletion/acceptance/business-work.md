# 业务任务原派发回调

2026-10-03，内部来源与准入部件，未提交、未部署；尚未提供 BusinessTask 七阶段 owner。永久删除入口保持关闭，原验证项目和资源继续保留。

追加 `business_task/0031_project_work.sql`，不改旧迁移字节。真实任务准入派发在独立共享准入事务下保存原项目／服务、操作与消费者、输入摘要、来源修订、实际锁 backend，以及原 Pod／Node／容器／PID 身份。私有退出许可只在原调用的 `finally` 内使用；租约到期、backend 断开和 JavaScript 的提前拒绝都不能替代退出证明。封写使用实际排他锁和原 Project 删除许可，重复或新世代只能延续同一个操作；许可在事务末尾失效会整体回滚。

HTTP 与后台任务恢复都通过实际模块 factory 的 `deletionWorkSources` 接入这个端口。对象输入、镜像确认、环境创建／重启和结算前后核对当前原 scope；断线后即使原环境请求迟到返回，也不能提交输入、重新对账或写成功回执。已封写项目不会继续认领新意图，其他项目正常推进。它当前只覆盖任务准入派发；其他业务、旧接口、契约、子执行、投影、消息、恢复与终结 worker 的完整生命周期仍需接续，正式 Root 尚未挂载这个部件。

原回调增加为第 25 张内容表，同一只读快照按 200 条游标完整盘点；封写和完整 Pod 停止事实仅保留受约束的最小字段。恢复只接受独立端口证明的原完整 Pod 和 Node 停止；单个容器停止无效。原身份与退出事实受 SQL 触发器保护，不能补造“出生即已退出”的记录、改写或截断。

并发回归先稳定复现排他封写已排队时的结算自阻塞，`/private/tmp/cs-rfc037-business-settlement-red-v1.log` 为失败回执。修复为续租和结算使用真实短事务，携带原共享锁身份，避免原在途调用被其自身的封写排队挡住；绿回执为同名 `green-v1.log`。原业务模块最终源码检查 **229 pass、0 fail、2129 断言、60 文件、53.90 秒**：`/private/tmp/cs-rfc037-business-module-v2.log`、同名 XML 和 coverage。随后仅追加事务末尾许可撤销／伪造已退出出生反例，最终原派发专项 **8 pass、0 fail、65 断言**，见 `/private/tmp/cs-rfc037-business-work-final-v1.log`、同名 XML 和 coverage；两组不相加冒充一次全量检查。

数据库为真实隔离 PostgreSQL，HTTP 使用实际业务路由，Project／TaskRuntime 与原 Pod 观察仍为受控端口；这些数字不是正式全 Root、原容器物理退出或集群永久删除验收。架构、精确 lint、共享树后端类型均通过。仍需全部业务写路径封闭、持久七阶段与 metadata CAS／最小化、DevSession／TaskRuntime owner、完整物理资源来源、全部 22 个参与者 Root 装配，以及修订全量门禁、精确 SHA CI、部署和实机二次确认回收。

后续已把其余原子执行 worker 接入原回调，最新业务模块235／0；尚缺服务请求准备、旧接口、恢复／终结及完整写入封闭。见[原执行接续](business-execution-work.md)。
