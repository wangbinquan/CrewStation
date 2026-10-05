# Data 原对象请求候选

实际 Data 工厂已将普通对象 PUT、GET、验证、删除和不确定写入检查接入原请求登记。Root 在原平台 Pod 配置存在时接独立 `crewstation.io/data-project-stop` 保护、原 PID 出生与实际 Project 准入；默认无 Pod 配置的组合保留原行为。这一候选尚未提交、CI 或部署，不能计为永久删除已上线。

每次请求从 Data 自己的原上传、attempt、空间和后端解析唯一位置，并经公开服务归属核对项目。原 key 必须等于 `spaces/{spaceId}/attempts/{attemptId}`；错 key、placement、服务归属、PUT 大小或不可读取的原进程，均在字节副作用之前拒绝。出生登记携带原 Pod／容器／节点、boot、PID namespace／startTicks 和实际 shared 锁 backend。私有随机退出键只保留 SHA-256；可信内部只读历史不返回该键或其 hash，没有 HTTP 注册／退出能力。

请求持有原 `data.project-admission` shared 准入，自己的 durable finally 才能结束记录。实际 admission socket 被终止后，SQL 锁已释放，但原字节回调仍在进行，删除继续等待；期限、锁消失和旧容器 lastState 均不算退出。恢复只接受完整受保护原 Pod 的正向停止证明，按原 UID／节点匹配，保留别的 owner 和 sidecar 保护。原回调退出与完整 Pod 停止都只证明这个平台回调，不证明远端 Garage 请求、版本、副本或文件已回收。

GET 立即交付字节流。上游 completed 提前成功时，返回的原字节流未消费到 EOF 或取消仍保留准入。实际源码回归先得到错误的提前退出，修正后通过；原 body 读取失败曾被 completed 当成成功，第二个真实红例也已修正。上游错误和取消均经过实际 reader 收尾。Data seal 在 durable 原请求仍运行时返回 waiting，并在排他准入内再次核对；请求退出后的完整内容变化仍要求重新确认原范围。

追加 `0008_project_object_work.sql`，新增一张项目内容表，Data 登记范围现在是 21 内容＋8 共享／最小身份＋2 删除控制表，共 31 表。出生验证、不可替换的原身份、私有退出、原 Pod 恢复、metadata 阶段删除和 TRUNCATE 保护在 SQL 端执行。完整请求历史按原稳定 key 每页 200 遍历；201 原请求的真实 PG 用例核对完整范围，metadata 清理保留其最小原身份与原 byte location，其他项目的请求、对象、key 和共享后端保持。

## 检查原件

- `/private/tmp/cs-rfc037-object-work-check-v3.log`：整仓结构、lint、后端及工作台类型通过；完整 Data 与相关实际 Root／K8s 组合 278 pass／11 Garage 环境 skip／0 fail，1952 断言、60 文件、78.78 秒。不是整仓所有测试，也不是生产物理回收验收。
- 最后仅 `admittedPlane.ts` 的原 body 错误收尾及其测试变化；未重跑未变内容的全部检查。`object-work-static-v4.log` 静态四层通过，`object-work-tests-v4.log` 全部原请求用例 8 pass／0 fail、79 断言、8.60 秒。
- `object-work-downstream-red.log` 和 `object-work-read-failure-red.log` 保留两个真实失败；初始 fixture 漏 `planId` 的类型失败、旧恢复测试未消费 body 的超时原件均保留。
- `/private/tmp/cs-rfc037-object-work-patch-v1.json`：官方改动行包含未追踪源码，426／428、99.53%，无违规。未变源码使用 v3 覆盖，最终变化的 `admittedPlane.ts` 使用 v4 覆盖，不将旧行号套到新源码。
- `/private/tmp/cs-rfc037-object-work-candidate-v1.json`：19 功能／锁路径固定；28 项并行文件首尾 SHA 保持，共享 index 为空。迁移锁增至 248；原已发布 246 和先前候选 0007 均保持。
- 超时遗留的自有隔离测试库，只在原时间窗口、原出生、精确两份对象 fixture、单条恢复记录及无活动连接同时匹配后移除；其他 37 库名字／OID 全保持。回执 `/private/tmp/cs-rfc037-object-work-test-cleanup-v1.json`。未触碰原验证项目，也未创建真实模型任务或 Garage 资源。

## 仍需完成

追加的完整处理器候选已覆盖同一原请求的 metadata finally，见下方验收。这一历史只覆盖正式接线后的原平台处理器，不补造部署前请求历史，不替代远端消费者证明。正式 objectPhysics 仍须覆盖原对象历史、未确定 PUT、版本、副本、完整生产者／消费者闭合及底层存储；这些正向来源尚未装到生产启动。独立 SCM 十一类、镜像／发布回收、剩余 legacy／未启动原执行、管理员两层确认及原专用项目全回收继续。入口／普通 producer OFF，原项目保持，RFC／总目标不关闭。

发布授权持续有效。必要 `git fetch` 已被自动审批两次以本评审环境禁止联网及 Git 引用写入拒绝，执行状态未变；没有绕过、重复尝试或将未提交源码部署。缓存 `8db68361` 不算新鲜远端同步。当前组合候选不能复用旧 c58 的六项 CI 或八组件部署作为自己的发布验收。

## 完整处理器收尾候选

普通上传、验证、不确定写入检查及回收、对象删除包裹完整原回调，包含结果落库与 heartbeat finally。Console、service 和任务输入下载经实际内容仓库核对原对象／空间／项目／服务／环境后进入同一 GET；响应仍立即返回，字节 EOF／取消和读取租约／计数／完整性结果收尾均完成后才执行 private exit。每个实际 runner 的异步上下文只允许同类型、同 backend／placement／key 的内部字节操作借用当前出生；破损准入仍拒绝新的内部字节操作，不重复登记请求。

真实 PG 用例分别暂停原 `uploads.finish`、`uploads.verified`，核对只有一条 running 出生、删除返回 waiting、没有封写行；放行后实际上传进入 verifying／ready，原记录 finished、后端活动计数归零。实际 Data 工厂下载在真实 `data.object-storage` 排他锁下，观测原事务 try-lock 未取得后仍保留 running，读 body 和删除不提前完成；释放原锁后读取租约和计数正常收尾。

- `/private/tmp/cs-rfc037-object-handler-tests-v5.log`：完整 Data 与相关实际 Root／K8s 组合 282 pass／11 Garage 环境 skip／0 fail，1982 断言、60 文件、82.07 秒。这不是整仓测试或生产物理回收证明。
- `object-handler-check-v4.log`：整仓结构、lint 通过，后端类型仅报并行观测用例 `recordedRuntimeMetrics.test.ts:35` 的 string/null 错误；工作台类型另行 `object-handler-console-typecheck-v1.log` 通过，不将整仓静态检查计为全绿。没有改动并行观测文件。
- `/private/tmp/cs-rfc037-object-handler-patch-v1.json`：官方改动行检查包含未追踪源码，207／210、98.57%，无违规；全部使用本次 v5 对应行号的覆盖。
- `/private/tmp/cs-rfc037-object-handler-candidate-v1.json`：15 功能路径固定，合并候选 79 路径，当前 52 项外部在制文件单独记录；先前 28 项 SHA 保持、index 空。迁移 0007／0008 和 248 项锁没有变化。当前候选未提交、CI 或部署。
- 原测试误用“等待锁队列”，而实际 metadata 使用 try-lock 重试；该 fixture 失败原件保留，不称为产品红例。旧函数改名后的测试 import 错误，以及 upload／attempt 状态混写导致的类型错误均已修正并保留原件。

原平台完整回调收尾的缺口在本候选闭合；部署前历史与正式远端／底层物理来源仍未闭合。删除入口和普通 producer 继续 OFF，原项目及其资源保持，完整 RFC 未完成。没有新增真实项目、模型任务、Garage 资源或跨会话消息。
