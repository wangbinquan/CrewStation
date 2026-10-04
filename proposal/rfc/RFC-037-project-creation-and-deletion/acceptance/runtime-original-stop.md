# 原运行停止生产接线

2026-10-04，源码候选，未提交、未部署。不是整项目删除验收，也未开放管理员删除入口。原专用项目、运行中模型、原容器与工作盘没有执行真实停止或回收。

## 已实现

- TaskRuntime 实际模块工厂产生删除 owner，平台接入原 DevSession／Session 数字通道和 Resources 的独立停止回执。私有 STOP 回调保留真实出生／finally，使用当前 Root 许可；停止事务不重做普通资源台账投影，不新建执行、归档或工作卷。
- 原队列行按 kind、dedupKey 与完整 payload 精确接续，已有 done／dead 行可进入新的真实 fence，不能插入替代行、回到普通 pending 或回退较旧匹配行。原作业持续续租，已发出的续租和原回调退出前不得提交阶段回执。
- 开发子执行先排空原数字，再请求原 Pod 退出；等待类异常让控制器获得观测机会，保存完整 Pod 证明后释放原 finalizer。清理原 Secret，保留父工作区与工作盘至统一回收阶段。
- 业务执行从真实 PG 原登记全量分页到 EOF，接原取消、读取和已提交水位 ACK；不能拿普通 pending 页、断线、terminal receipt 或 Pod 消失当成完成。
- 有 live Pod 的原确认只接受该原 UID／原节点的完整 Resources 回执。完整确认中无 live Pod 时可读取持久原消费者历史；任务、资源、修订、Pod 名称、卷、许可及停止证明必须吻合。已关闭但无 start permit 的原消费者只能证明未获准启动。缺来源仍等待。
- 已 finished 的历史执行无需找回已被正常保留期清除的队列行，仍须独立停止证明。环境的原 render、旧物理身份及标签在清理前后固定。
- 私有取消保留原 attempt／incarnation／payloadDigest，让取消先到时真实 Runner 可以生成取消墓碑；该通道不调用普通 PG 重新登记。业务 ACK 按实际 Runner 的成功空对象协议提交原水位，错误形状不改变数字副本。

## 回归与边界

| 检查 | 实际结果与日志 |
| --- | --- |
| 停止、队列、数字页及 Root 依赖较宽回归 | 89 pass／1 fail，90 tests／20 files；原续租测试直接封写而缺少来源登记，失败原文保持。修正为先走真实原回调，补验 2 pass／0 fail、8 断言。原日志：`/private/tmp/cs-rfc037-runtime-original-stop-broader-v2.log`；补验：`/private/tmp/cs-rfc037-original-jobs-test-v5.log` |
| 私有作业退出与 Root 续租 | 测试断言自身等待顺序卡住的旧进程已精确终止；修正后 2 pass／0 fail、6 断言，`/private/tmp/cs-rfc037-owner-lease-test-v2.log` |
| 原取消与运行停止修订 | 13 pass／0 fail、134 断言、5 文件，真实 PG／模块／控制器及 Runner 协议；数字／节点事实有控制替身，`/private/tmp/cs-rfc037-original-cancel-history-final-v1.log` |
| 历史停止实际组合 | 8 pass／0 fail、59 断言、3 文件；真实 Resources 工厂与 PG，Root 和原观察事实为控制来源，`/private/tmp/cs-rfc037-runtime-history-target-v3.log` |
| 取消与实际空对象 ACK | 11 pass／0 fail、106 断言、4 文件；包含旧 Runner 协议和开发清理回归，`/private/tmp/cs-rfc037-original-business-ack-target-v2.log` |
| 最终精确 lint／结构 | lint 为 0；结构通过，59 单元／4240 源文件。最后 ACK 增量另行 lint 为 0，相关 final 日志保留 |
| 全工作树类型 | 最终 v2 仅报并行在制 `modules/observability/tests/completeTaskMetricsFacts.test.ts` 的 ProjectId 类型问题。本任务旧断言字面量类型已修正，没有将全树类型记为通过：`/private/tmp/cs-rfc037-runtime-final-types-v2.log` |

这些定向回归没有合并成一个虚构的全仓 PASS；本轮没有新完整门禁、提交、精确 SHA CI 或部署。来源摘要回执存于 `/private/tmp/cs-rfc037-runtime-original-stop-composition-receipt-v1.json`。

## 继续完成

尚未接通全部 22 owner 的正式 Root；观测数字消费者、原未启动／无历史来源的兼容路径、旧业务收尾仍须闭合。SCM 十一类正式原生与文件来源、实际清理及零资源证明未实现。完成这些以后再开放管理员删除入口、输入 `delete` 二次确认并对原专用项目执行不可逆全回收验收。普通 native producer 保持 OFF。
