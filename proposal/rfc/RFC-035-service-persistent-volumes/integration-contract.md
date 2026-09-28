# RFC-035｜业务应用与 AW 接入边界

本 RFC 修改 CS，AW 仓库不写入。CS 提供对象数据面、任务原卷归档和终结回收；AW 仍需在自己的 RFC 中改造持久化与运行时。

| AW 内容／动作 | 目标与合同 |
|---|---|
| 配置、流程定义、任务状态、运行句柄、请求键、事件游标、对象 ID／摘要 | AW PG；所有服务副本共用，业务写事务同时检查平台执行权和 AW 数据库世代 |
| skills／plugins 不可变版本、附件、归档日志／结果 | CS 对象空间；发布后只读，更新生成新 objectId，用 application 或 material-version 引用保护 |
| 仓库、worktree、iso、Git merge、CLI 会话文件 | 一个 persistent 业务任务拥有的 `/work` PVC；多个环节 Pod 顺序挂载，Agent 仍逐次占平台额度 |
| 从对象创建任务输入 | `inputObjects[{objectId,sha256,path}]` 与新任务同一请求；平台持久 pin 和物化，不让 AW 服务依赖本地文件 |
| 人工等待／可恢复失败 | pause 或既有显式重试；不调用 finalize、不删卷 |
| 最终成功／失败／取消 | 封存分页归档清单，按固定键 finalize；分别观察业务 outcome、归档状态和 storageReclaimed |

`@crewstation/api-client` 的 `createServiceStorageClient({baseUrl: CS_PLATFORM_API_URL})` 使用服务域，不走用户登录域；`CS_OBJECTS_URL` 已含 `/v3/objects`，直接 HTTP 客户端以它作为对象资源根。SDK 字节入口传入 ReadableStream／Content-Length，下载返回未缓冲的 Response，支持 Range 与取消；PUT 没有自动重试。先 reserve，再发送一次内容，commit 后查询同一 uploadId；ready 才能使用 objectId。未知写结果保持容量和阻塞，不能换 requestKey 重复上传绕过保护。

SDK `createBusinessExecutionClient` 新增 finalize、finalization、reviseArchive。接入前检查 capabilities.storage。服务仍不从 `CS_SLOT=blue|green` 推断执行权，不以本机 PID 判断远端进程，也不在旧服务退出时把所有任务标中断。稳定 requestKey、taskId、subtaskId、attempt／generation、原生 sessionId 和最终收据均存 AW PG。

事件长期保存是应用显式责任：持续消费现有游标页，保存有范围／摘要的 NDJSON 对象并 pin，最终清单引用这些对象。410／gap 必须显示不完整；长期终态证明不是完整日志副本。独立可运行示例见 `templates/business-execution-v3`，有丢回执、换实例、游标冲突和过期日志回归。

已归档对象的损坏恢复使用本 RFC [隔离备份恢复流程](./backup-runbook.md)：只接受原摘要的副本、生成新物理位置并保留 objectId／引用与审计，不提供业务客户端覆盖写。该流程不恢复活跃任务卷或 AW 自有 PG。对象存储管理页面显示后端、配额、在途预留、流量、阻塞、备份和归档；读页面不触发修复、清理或新任务。
