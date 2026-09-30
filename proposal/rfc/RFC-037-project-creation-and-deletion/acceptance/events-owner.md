# 事件内容、实际投递与原进程恢复

本批实现 events 所有者、两端项目准入、持久在途事实，以及原平台投递进程的停止来源。它是 RFC-037 删除链的一部分，完整 22 owner 组合和管理员删除界面仍待完成。下面分别记录真实 PostgreSQL／子进程与物理端口替身的证明边界。

## 清理和准入范围

- `producers`、`event_types`、`subscriptions`、`inbox`、`deliveries` 及 `deletion_work` 全量聚合进入盘点；未知内容表或缺少原生产方／事件／类型归属的历史阻断。
- 原生产方、消费方、serviceId、事件／订阅／投递 ID 在本 schema 最小实体和关系表固定。SQL 触发器拒绝改换原关系，删根后也拒绝借旧 ID 写到另一项目。墓碑不保留载荷、handler、trace、错误正文。
- 本项目拥有的事件和消费投递，以及本来源派生到其他项目的投递，均清除。其他来源 inbox 和无关投递原文保持；其他项目订阅配置保持并暂停失效来源，可由其所属项目正常移除，不能恢复失效来源。
- 登记、生产、投递、重放、暂存补发保护所有相关项目，按稳定次序使用同一实际 backend 的 shared 咨询锁。独立普通 UOW 通过实际锁／PID／项目 key 校验；现有准入上下文不能临时扩大覆盖面。
- seal 取本项目排他锁，持久关闭准入并核对完整确认修订。内容变化保留 false scope，普通重试不能绕过；只有原操作更高世代的完整重新确认能刷新。

## 实际在途和停止来源

外部推送前持久记录原 deliveryId、backend PID、世代和原 Pod／容器／节点四项身份。回调退出后的 finally 独立提交 finished；连接中断导致外层拒绝，仍不能推断回调退出。任何未结束的持久事实让 seal 返回 waiting，阻止后续内容清理。

平台适配器在实际推送前以原 Pod UID／resourceVersion 添加 `crewstation.io/events-delivery-stop`，保留其他 finalizer。原节点必须 Ready、kubelet 至少 1.27，原 Node UID 和新鲜 Lease 同时可读。分页完整且有超时；来源故障和重复游标不能当作空集合。

恢复只接受原 containerID 的实际 terminated 状态，以及原 Pod／Node UID／nodeName 四项匹配。相同 Pod 重启后的新容器不能证明旧容器。最小物理摘要先持久化，再结束匹配的原世代工作；不会补发第二次推送。移除 Pod 保护还需普通／init／ephemeral 容器全部停止及无待恢复工作，用 UID／resourceVersion 检查，仅移除本 owner finalizer。原 Pod 缺失、节点替换或未知状态不能伪造停止证明。

恢复工作器运行在 controller，单轮不重入，停止等待当前实际来源探测；错误只记录固定代码。`cs-events` 部署新增 Downward API 的 `CS_PLATFORM_POD_UID`。本批部署时必须同步这一源字段，单独替换镜像会安全拒绝推送，不能视为部署完成。

## 当前证据

| 检查 | 结果与来源 | 能证明的范围 |
| --- | --- | --- |
| 原模块全部事件行为 | 22 pass／0 fail、184 断言、7 文件；`cs-rfc037-all-events-1.log` | 当时的事件兼容行为和三个内容删除用例 |
| 在途及物理适配组合 | 15 pass／0 fail、81 断言、4 文件；`cs-rfc037-events-inflight-1.log` | 真实 PG 回调／断线屏障；K8s 来源使用假 API Server |
| 独立原进程 | 1 pass／0 fail、20 断言；`cs-rfc037-events-original-process-1.log` | 实际 Bun 子进程与 PG；物理停止端口显式替身，非实集群验收 |
| 最新事件／恢复／持久层组合 | 46 pass／0 fail、322 断言、13 文件；`cs-rfc037-events-combined-2.log` | 最新关系固定、外部订阅移除及来源边界 |
| 修订迁移升级 | 5 项事件删除通过，平台迁移执行成功后因未入锁的预期清单失败；`cs-rfc037-events-migration-upgrade-3.log` | 老数据映射和全新平台迁移实际执行；清单仍需入锁后重验 |

日志均在 `/private/tmp/`。1502 条追加历史加原事件共 1503 条，删除后实际模块内容归零、外部原文不变；模块授权夹具的其他 owner 空范围不充当平台物理清理证明。真实 `pg_terminate_backend` 后原回调继续运行而 owner 等待；实际杀死独立 Bun 子进程后，没有完整原物理端口证明仍等待，替换任一原身份无法恢复。

最初 owner 缺失为 0 pass／3 fail；补入 owner 后测试确认修订必须使用正式规范化计划、全阶段许可回执。其后修正历史用例超时、Drizzle thenable 断言和假分页 cursor 夹具，不降低产品来源规则。初次结构检查发现 SQL 非显式 AS 别名与新迁移未锁；只修正自有未发布迁移，未修改已发布迁移。初次后端类型曾被并行测试的两处类型错误阻断，未更改其内容；最新后端类型已通过。

新 events `0006_project_deletion_fences.sql` 经旧库和全新真实 PG 后精确入锁，现共 196 个迁移，业务契约金样无变化。入锁后平台迁移清单 1 pass／0 fail、2 断言，`cs-rfc037-events-migration-lock-4.log`；最新结构 59 单元／3675 源文件无违规。

精确候选 ESLint、后端类型及 HEAD Git blob＋42 路径内存候选的前后端类型均通过，不引入其他 checkout。带平台迁移的覆盖运行 **47 pass／0 fail、324 断言、14 文件**，日志 `cs-rfc037-events-coverage-1.log`。复用正式新增代码判定函数核对精确生产候选与全部未追踪新文件，**294／294 可执行改动行（100%）**、无未加载生产文件，回执 `cs-rfc037-events-patch-coverage-1.json`；这份定向覆盖不是全仓 gate 或真实集群回收证明。

首次冻结 42 路径（36 源码／测试／配置）的完整 `bun run check` **4642 pass／143 skip／0 fail**，4785 tests、927 文件、30320 断言、941.10 秒；日志 `cs-rfc037-events-full-check-1.log`，检查中源码指纹未变。

随后源码自查发现 DigitalWorker 的登记未和生产方一样核对 canonical serviceId／projectId：从未有 events 关系的删除中服务可以借另一个活跃 projectId 登记。真实 PG 红回归 **0 pass／1 fail**，`cs-rfc037-events-registration-owner-red.log`；现已对两种登记统一验证真实服务目录，未知、错误 serviceId／归属均拒绝，正确消费者继续。修订后完整 events 目录 **28 pass／0 fail、240 断言、10 文件**，`cs-rfc037-events-registration-owner-green.log`。

独立 Bun 夹具现保持原回调和进程在数据库断线后仍存活，并断言实际 `exitCode=null`，再由父进程 SIGTERM／等待 exited；不由外层断线异常自动结束进程。canonical 登记与强化原进程组合 **2 pass／0 fail、27 断言**，`cs-rfc037-events-native-canonical-2.log`；测试夹具首次出现的三处类型缺项已修正，当前后端类型和精确 lint 通过。

修订覆盖运行 **48 pass／0 fail、330 断言、15 文件**，`cs-rfc037-events-coverage-2.log`；精确生产候选 **296／296（100%）**，无未加载文件，`cs-rfc037-events-patch-coverage-2.json`。覆盖结束后只强化上述夹具的进程存活断言，生产源码未变。因 canonical 登记实际源码变化，首次完整门禁不作为最终候选回执；43 路径修订候选继续一次完整门禁、精确提交／CI／部署。本材料与 implementation-review.md 是本会话实现自查，未声称独立实现 PASS。永久删除产品和真实项目物理回收仍未完成。

最终修订候选的完整 `bun run check` **4643 pass／143 skip／0 fail**，4786 tests、928 文件、30329 断言、701.27 秒，日志 `cs-rfc037-events-full-check-2.log`。43 路径冻结快照中的 37 个源码／测试／配置指纹检查后均相同。基于 `d3acac1f` Git blob 与精确允许路径的内存候选，后端／console 均 0 类型错误，日志 `cs-rfc037-events-candidate-types-2.log`；没有建立其他 checkout。追加回执不改变候选源码，后续精确提交、六项 CI 和实际部署另记。143 个环境跳过项不证明平台原容器或项目物理资源回收。
