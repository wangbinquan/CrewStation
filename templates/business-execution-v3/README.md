# v3 业务执行与蓝绿交接示例

这是 RFC-027 的独立测试客户，服务槽只运行 HTTP 和调度控制；90 秒脚本在平台业务任务容器执行，`/work/proof.txt` 落在任务持久卷。服务槽无需挂卷、git 或模型凭据。现有 minimal-sample 保留 v2 回归，本例暂不注册为默认新项目模板。

将此目录作为独立仓库根发布。按项目授权替换 crewstation.yaml 的两个套餐 UUID，给服务声明并提供 PostgreSQL（CS_DATABASE_URL）；CS_PLATFORM_API_URL、PORT 由平台注入。镜像无需构建参数，独立迁移 Job 执行 `bun src/migrate.ts`。本例以 expand-only 建表，未示范任何破坏性 schema 升级。启动先开端口，/live 只证明进程响应，/ready 检查应用表；Web ready 与执行权分开。

控制器轮询平台 claim/renew，获得准备租约后在应用 PG 推进 epoch/owner；每个业务写事务都锁同一控制行、检查 holder/epoch/有效期。待命槽申请会被平台拒绝。交接时新槽先提交应用写屏障回执，平台确认路由后才允许 activate。租约失效停止决策，旧实例退出不修改任务状态，也不按本机 PID 恢复远程执行。

通过平台用户域访问以下 JSON 接口（网关登录身份必需）：

- GET `/state`：实例与执行控制状态。
- POST `/actions`，`{"action":"command","requestKey":"run-001"}`：持久记录意图，按固定键创建父任务和 90 秒命令；父容器尚未就绪时会返回平台错误，稍后原样重试。429 同样由调用方原样重试，不自动排队。响应包含 task 和 child 的稳定句柄。
- GET `/events?taskId=<id>&after=<cursor>`：同一持久事件日志分页，首次不带 after；保存 nextCursor，断线后补读。超过 30 秒不会自行失败，观察到首尾文本与最终事件后才完成。
- GET `/task?taskId=<id>`：读取 generation/资源状态。GET `/proof?taskId=<id>`：按文件 API 读取 proof.txt（base64 内容及版本）。
- POST `/actions`：`action` 为 cancel 时提供 taskId/subtaskId/expectedAttempt；为 pause/resume/close 时提供 taskId/expectedGeneration。每个新意图使用独立 requestKey，重发同一意图保持键和参数不变。活动子任务必须先取消并确认，再 pause。
- 迁移冻结时 POST `/drain`：支持 cancel、pause、close，字段同上。控制器只给原正式 release 使用 stopAuthority，不会恢复普通执行权；恢复、新任务和消息都不允许。应用 PG 写屏障回执不替代平台实际 Pod 清理证明。

本例没有自动清理历史任务：验证结束后显式 close 并观察平台资源回收。人工等待用 pause，恢复后读取同一 proof.txt 来检查卷内容；关闭后不能恢复。它不运行真实 aw，也不证明真实 Agent 档位的模型、skills、MCP 或原生会话能力。

## 对象存储与整个任务结束后的自动回收

可选的 RFC-035 路径使用同一份应用 PG；服务可以多副本运行，仍无 PVC。由管理员给项目授权对象档位后，在 Manifest `spec` 添加 `data: { objects: { planId: <已授权对象档位UUID> } }`，重新发布并运行迁移。平台注入 `CS_OBJECTS_URL` 和 `CS_OBJECT_SPACE_ID`，不向服务提供 Garage 凭据。新路径先读取实际 capabilities，不支持时明确拒绝；上面的 legacy 流程保持原行为。

1. POST `/actions`：`{"action":"storage-command","requestKey":"storage-run-1"}` 创建 `archive-and-delete` 的 persistent 任务，在 `/work/proof.txt` 写标记。可附加 `inputObjects: [{objectId,sha256,path}]`，平台 pin 并在任务原卷内安全物化，服务不用下载到本机盘。任务／子任务受理暂时失败时原样重试。
2. 需要保留日志时，在七天保留期内反复 POST `/actions`：`{"action":"storage-log-page","requestKey":"log-page-1","taskId":"<任务UUID>"}`。后续以新的页请求键和上次 `nextCursor` 作为 `after`；`hasMore` 为 true 时继续消费。页内容先写应用 PG，再以固定 SHA key 上传和 pin；503 或断线重试原键，不再读取一份变化后的页面，不盲目重发 PUT。页面限制 100 条／4 MiB，传输独立于普通 JSON 15 秒期限。
3. 每个 NDJSON 包含范围头和原始事件（含 execution／attempt 标识）。范围头使用平台不透明游标，始终 `fullLog:false`；410 或 gap 保存 `export-incomplete`，不承诺缺失前文存在。此例是显式逐页消费，生产应用应把该循环纳入自己的持久调度，不等到最终终结时才读取可能已经过期的日志。
4. 人工等待仍使用 pause，恢复用 resume，原任务的 PVC／PV 和输入物化世代保持。全部执行结束后 POST `/actions`：`{"action":"storage-finalize","requestKey":"finish-1","taskId":"<任务UUID>","expectedGeneration":1}`。样例固定成功结局，将 proof.txt 和已保存日志页封存为不可变清单；清单取得保护引用后释放应用临时 pin。终结提交后以 GET `/finalization?taskId=<任务UUID>` 观察归档、清理和最终回收。真实失败或取消结局应由业务自行选择 API 的 outcome，本示例动作仅演示成功结局。

每个环节 Pod 退出和任务 pause 都不会删这个新策略任务的卷。只有整个任务终结、归档收据和实际停止／物理回收证明齐全才完成；活动执行不会被 finalize 自动取消。样例已封存清单后不再接收新日志页。归档产物可通过对象 API 或项目“对象存储”页面读取，与原任务卷独立。

RFC-029 恢复接入：Manifest 显式声明 `resume-task`、`rebuild-workspace`、`retry-subtask`、`resume-subtask` 和 `restart-task`。只有持有当前执行权的控制器才会认领管理员提交的持久恢复请求；先在本业务数据库保存不可变目标，再以 `recovery:<请求编号>` 调用平台原卷恢复／重建或所选 fresh／native retry 接口。网络丢回执、实例切换和认领过期均保留这个键。已绑定的平台操作仍用原键重放，使额度不足或旧世代尚未派发的操作可被接续，平台保证不重复执行；实际成功或失败由平台观测决定，应用没有“上报成功”接口。此持久恢复请求允许控制器继续处理暂时失败的受理，普通 `/actions` 的 429 仍要求调用方显式重试。重建固定原卷与原镜像，只有实际就绪才完成；原生续跑必须携带原会话标识，缺失时拒绝，不能自动改成fresh。原卷不可用时，重新执行通过专用 restart 入口创建关联的新任务，继续沿用原契约、镜像及资源配置；回执记录新任务 ID，旧任务保持失败。新任务实际启动后才完成恢复请求，不自动重放旧子任务的外部副作用。
