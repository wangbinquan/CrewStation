# 原观测数值排空生产接线

2026-10-04：源码候选，未提交、未部署。创建弹窗保持已交付，整项目删除尚未开放。原专用项目、原运行容器、模型和工作盘保持。本记录证明数字消费者与数据库清理，不能替代独立容器、存储或 SCM 的物理停止及回收证明。

## 实现与边界

- Session 提供独立的原封写任务目录：当前 Session seal／stop 许可、持久完整范围、canonical TaskId、每页 200，继续读到实际 EOF。没有伪造全局任务，也不使用普通轮询器排除关闭项目的路径。
- 孤立数字事件、缺少登记、越过原复制水位或尚未接入的旧任务键明确阻断，不能被当作无数据。旧键的原数字适配仍需继续，相关项目不能提前完成。
- 平台正式向 Observability 工厂注入专用 Session 客户端、独立业务／开发归属 resolver 和原价格受理。每个任务及业务执行完整分页，业务／开发原数字页到 EOF；普通每轮 20 页和执行目录 100 条上限不限制删除排空。
- 原页复用现有证据、原生选择、投影、计价和修复实现；全部提交完成后才 ACK。请求丢失重放原页，响应丢失从已确认的下一页继续，重复提交不重复计量。
- 私有 SQL 事务使用真实原项目独占准入、当前 Root 许可、已封存任务、实际 backend／transaction 和不共享 nonce；提交前检查 Root 并移除准入，失败或撤销整体回滚。普通写入保持关闭，不能写非数字内容、其他任务或用伪造 GUC 绕过。
- STOP 保存完整最终内容摘要／数量；metadata 核对最终范围，包含合法尾页，最终范围不可改写。其他项目继续提交，独立价格目录保留。
- 实际控制器依赖为 DevSession／BusinessTask／TaskRuntime 停止 → Observability 排空 → Session 关闭 → Resources／ClusterControl 停止，以持久回执核对。资源等待时仍观测已终结原 Pod。
- 真实 PG 先红证明私有 UPDATE 能改到同项目另一任务；只追加 0020 核对 OLD／NEW，0019 字节保持。普通批量插入先返回，不查询私有准入表。
- 结构检查误把标量 PL/pgSQL 函数内合法 typed row 识别为跨 schema 对象；补充反例后修正，foreign relation／function 仍阻断。中间根目录 wiring 文件移回既有 wiring，新增文件按删除概念分组。

## 回归证据

| 检查 | 实际结果与日志 |
| --- | --- |
| PG、Session HTTP、计价、报告清理、阶段依赖及结构较宽回归 | 78 pass／0 fail、585 断言、14 文件、51.29 秒；`/private/tmp/cs-rfc037-observation-broader-tests-v1.log` |
| 实际模块工厂／原数字页 | 106 业务＋8 开发用量及估值、丢请求／丢响应、最终范围清理与健康项目保留均通过；Root 与上游物理停止受控，PG／HTTP／ledger／valuation 是真实实现 |
| 私有准入、Root 回滚与跨任务保护 | 包含于较宽门；`/private/tmp/cs-rfc037-observation-task-transfer-red.log` 真实先红保持 |
| 全量目录与页数边界 | 403 原任务通过真实 PG／HTTP；101 业务执行／26 页边界通过应用端口受控用例，均包含于较宽门 |
| 新目录严格 Schema／业务契约金样 | 11 pass／0 fail、46 断言；`/private/tmp/cs-rfc037-observation-contracts-final-v1.log`，金样未变化 |
| 后端类型／精确 lint／结构 | `cs-rfc037-observation-types-v6.log`、`cs-rfc037-observation-lint-final-v1.log` 通过；较宽门包含真实仓库结构检查，日志均在 `/private/tmp/` |
| 不可变迁移 | 官方锁 246，原 244 项校验和全保持，只新增观测 0019／0020；原件 `/private/tmp/cs-rfc037-observation-prior-migrations.lock.json` |

先红及中间失败日志全部保留，不用后续通过覆盖。本候选没有另起完整 `bun run check`，没有新提交、CI 或部署证据；和原停止候选共同接续整条链路，不分批发布底层。

## 剩余交付

全部 22 owner 正式组合、旧数字键／未启动原执行兼容、SCM 十一类正式物理来源与回收、管理员入口及 `delete` 二次确认、精确发布树 CI、本机部署、原专用项目全资源实际回收仍须完成。普通 producer／删除入口 OFF，RFC 不关闭。
