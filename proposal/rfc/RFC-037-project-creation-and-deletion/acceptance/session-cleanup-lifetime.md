# Session 原连接回调与停止依赖基础

本批 21 源码路径在既有主检出 main 中实现。上一批 43 路径 `427cc8c68bbf6203e76702f464b612d8f2b38e9d` 已通过 [CI37167948510](https://github.com/wangbinquan/CrewStation/actions/runs/37167948510) 全部六项并部署，实际八组件就绪、241 项安装迁移 checksum 和 OCI 源码一致。原项目与存储、数据库/角色 OID、原生容器及 Runner 身份保持。本批源码尚未提交部署，删除入口和 producer OFF，原专用项目保留。

## 命令与真实回调退出

私有命令校验只允许原开发/业务执行的停止、信息、分页和持久水位 ACK；原 project、task、Pod、profile、原数字键和业务 attempt/incarnation/payload digest 必须一致。ACK 和分页起点不能超出 PostgreSQL 已持久连续水位。取消业务的可选 registration 只验证原身份，不走新增注册；其他启动、执行、写文件等命令均拒绝。

Runner lifetime 的 `withOriginal` 只接受原完整出生、原副本、当前持有连接和内部私有 key。回调保留在 RunnerConnection 的实际 commands 集合，socket pending 为空不能当成所有回调退出。外层错误先返回时，已经发出的内部回调仍保留到真实 finally；新关闭连接和同名替换连接不能继续原工作。正式数字通道仍须将已发 I/O 放在内部命令回调内，本批不声称已完成通道装配。

## 持久停止依赖与只观测

原业务数字任务仍待收尾时，旧编排会继续调用 Session/resources/cluster-control 的 stop。反例 `/private/tmp/cs-rfc037-stop-dependency-red-v1.log` 在提前关闭连接的断言先红；该共享夹具的等待标志未复位还导致三个后继失败，修正为 finally 清理测试控制，不解释为四个独立生产缺陷。

新依赖按原操作当前持久 stop 回执判断：Session 等待 dev-session、business-task、task-runtime，resources 等待全部前序消费者，cluster-control 等待 resources。排序、发起停止或部分观测都不能替代完成回执。其他独立来源继续推进，purge 仍要求所有 stop 完成。

resources 提供只观测能力，校验当前 Root 许可、原 sealed 范围和 stop 阶段后转发 Pod 来源。活动 Pod 不发起 DELETE；已进入终结的原 UID 必须有原节点新鲜心跳和全部普通/init/临时容器实际终止证据，先持久保存摘要才释放本操作 finalizer。前面的 Pod 未完成也继续观测后面的原 Pod，避免任务等待保护释放、保护又等待任务完整 stop 的环。存储 purge 不参与只观测。来源掉线、许可替换、阶段变化和同名 UID 替换均阻断，不补造空来源或完成证明。

## 验证与剩余范围

原连接与命令定向 `/private/tmp/cs-rfc037-session-cleanup-lifetime-target-v4.log`：15 pass、0 fail、142 断言、4 文件、7.04 秒。停止依赖与只观测定向 `/private/tmp/cs-rfc037-stop-dependency-target-v2.log`：29 pass、0 fail、343 断言、7 文件、36.93 秒，含真实 PostgreSQL 编排/资源许可与有状态 API Server 替身。首次新增测试误把公开 DTO 当 lease generation、在存在旧 Pod 时直接 create 替换，17 pass/2 fail 记录保留；修正夹具为实际持久 stop 回执世代和明确旧实例消失后替换，未放宽生产许可。

精确 `427cc8c68bbf6203e76702f464b612d8f2b38e9d` 提交树叠加 21 路径后类型 0 错，精确 lint 0。首次完整门禁冻结 21 路径及 Session 原接线/迁移锁依赖，继续原进程，不因无关 SHA 移动重跑。正式跨进程 Session 清理数字通道、停止后完整内容快照和逐表 CAS、TaskRuntime 实际停止端口、全 22 方/SCM 物理来源和原专用项目永久回收仍未完成；本批受控测试不替代实际集群删除验收。

首次完整门禁自然终态失败：5660 pass、143 环境 skip、3 fail、221177 断言、1116 文件、1610.61 秒，21 源码和 2 依赖首尾摘要保持。回执 `/private/tmp/cs-rfc037-session-stop-full-v1.json`。两个在制观测 facts 用例的 quality 页为空，另一个在制观测组件文案键尚未登记；该会话源码保持，失败日志不覆盖，不把删除专项通过当成此次完整门禁成功。正式持久回调和数字通道继续补齐后形成新内容候选。

## 2026-10-04 正式数字客户端与开发停止接线

封写后的 Session 内部数据端口和 `packages/session-client/projectDeletionClient.ts` 已接通现有原数字副本。只接受实际当前 Session stop 许可、原封写 taskKeys、尚未完成停止的范围；每次 PG 操作有实际持久出生和私有 finally。原连接返回的只有原 id/task/replica，实际命令仍由持有连接的副本再次核对原出生及当前许可。开发登记接口只核对既有原登记，不插入新执行；没有不可用／丢失／物理停止替代操作。业务消费只接受实际完整终态，禁止 stopped=true 伪造容器证明。

业务／开发数字页按原执行选择，原行锁不能通过 SKIP LOCKED 冒充空页。失去消费 ACK 时重放相同原页，连续 PG 水位之后才可向原 Runner ACK；大整数仍保留字符串。普通队列继续跳过封写项目，不将其返回空页当成删除来源为空。

平台向 DevSession 的删除专用清理接口注入真实 Session 客户端，并用 `projectDeletionParticipantContext` 从实际持久计划恢复 Session 确认材料。先核对原项目、Agent、Pod、档位和 Task 选择，才关闭该原准入。每轮原 stop 后读取原 info、至多一页、ACK 已复制水位，再由既有 owner ending 和独立 Session 副本决定数字许可。普通开发 producer 保持关闭。完整 TaskRuntime 停止器及业务／观测消费接线仍需接续，此接线不等于完整生产删除已经可用。

较宽验证首次129／4，旧API/预览命令用例揭示 `await handle?.check()` 在无handle时也切换微任务，导致普通命令未同步进入pending。改为仅有handle时await，保持原普通派发行为；未把用例改成等待。修正后全Session、开发清理／原许可、平台适配与客户端135／0、989断言、38文件、32.18秒；全后端类型0错、精确lint0、结构0。日志 `/private/tmp/cs-rfc037-session-cleanup-data-composition-v2.log`，覆盖目录 `/private/tmp/cs-rfc037-session-cleanup-data-composition-coverage-v2`。此前两个夹具导入／依赖错误和数字页容量／UUID错误记录保留，严格生产Schema未放宽。

实际PG先红记录 `/private/tmp/cs-rfc037-session-business-origin-red-v1.log` 证明0013/0014旧guard用错真实回执字段 attempt/incarnation。追加0015触发器只约束封写后的原执行绑定；此前锁定迁移字节不改。原0014封写库、既有回执和阶段升级到0015保持，实际替换attempt/incarnation被拒。官方新增一项至244，fa187原241校验和全一致。当前内容尚未完整门禁、提交、CI或部署；入口OFF、原资源保持，完整22方／SCM及实机永久回收继续。

最终两文件增量为每次原stop生成新的传输命令id，避免ending固定id重放旧stopping回执而永远等待；原执行身份和停止意图保持。该增量2／0、26断言，精确lint0；最终后端类型v4为0错。28路径摘要及明确增量记录 `/private/tmp/cs-rfc037-session-cleanup-data-composition-receipt-v1.json`；不把增量检查说成重新执行过整条链路。
