# 业务执行内容的完整盘点

2026-10-03 的初始只读部件回执。后续七阶段 owner、完整写屏障与原回调退出已形成源码候选并接入正式 Root 来源，见[业务 owner 接续](business-owner.md)；原资源没有删除，永久删除入口保持关闭。下文保留初始盘点的范围与证据。

全部 24 张业务内容表按显式主键在同一个实际 PostgreSQL REPEATABLE READ READ ONLY 快照中，以 200 条游标遍历到 EOF。它涵盖旧任务／子任务、契约、控制记录、管理意图、原生执行、投影／事件／日志、加密材料与消息、会话目录、恢复与审计、归档终结及其证明／修订。当前标识目录仅作为最小身份来源保留；未登记或缺失的表、矛盾的当前标识目录都阻断完整确认。

原服务通过 Project 的结构化来源端口核对；任务根由本 schema 的旧任务与已受理意图共同确定；原生环境与旧标识通过 TaskRuntime 的结构化来源端口核对。跨项目、共享来源、孤儿内容、当前／旧标识不一致、子任务／会话／卷父关系冲突不能被当作本项目清理范围。私密 payload、旧副本、输出与错误只在 SQL 内形成摘要；确认库存只包含表名、数量和摘要。内部待清理范围保留最小主键及原行摘要，后续 metadata 阶段还需 CAS 核对和压缩。

最终专项为 **6 pass、0 fail、46 断言、1 文件、2.47 秒**，真实隔离 PG 加受控的原 Project／TaskRuntime 身份端口；不代表正式组合或实际物理停止。用例包含 205 条已结束任务及子任务、205 条材料、原生父链与归档／恢复证明、跨项目保护、原内容变化、未知表／孤儿／共享／原标识冲突，以及取消／会话借用其他执行的反例。架构检查、五个新 TS 文件的精确 lint 和最新共享树后端类型均通过。最初 ports 目录超限和接口行类型约束错误已修复，原失败回执保留。

证据为 `/private/tmp/cs-rfc037-business-content-v4.log`、同名 XML 与 coverage、`/private/tmp/cs-rfc037-business-content-arch-v3.log`、`/private/tmp/cs-rfc037-business-content-lint-v3.log` 和 `/private/tmp/cs-rfc037-business-content-types-v2.log`。接续仍需原回调准入／私有退出沿革、封写与七阶段持久事务，以及 TaskRuntime／DevSession owner、SCM 完整物理范围和全部正式 Root 装配；这些专项数字不与 Session 的 133 项相加作为一次完整检查。

后续任务准入沿革追加第 25 张 `original_callbacks` 内容表和受约束的最小封写／完整 Pod 停止事实；这个盘点部件仍不能独立成为完整删除 owner。见[原派发接续与实际回归](business-work.md)。
