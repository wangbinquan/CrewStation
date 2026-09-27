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

RFC-029 恢复接入：Manifest 显式声明 `resume-task`、`rebuild-workspace`、`retry-subtask`、`resume-subtask` 和 `restart-task`。只有持有当前执行权的控制器才会认领管理员提交的持久恢复请求；先在本业务数据库保存不可变目标，再以 `recovery:<请求编号>` 调用平台原卷恢复／重建或所选 fresh／native retry 接口。网络丢回执、实例切换和认领过期均保留这个键。已绑定的平台操作仍用原键重放，使额度不足或旧世代尚未派发的操作可被接续，平台保证不重复执行；实际成功或失败由平台观测决定，应用没有“上报成功”接口。此持久恢复请求允许控制器继续处理暂时失败的受理，普通 `/actions` 的 429 仍要求调用方显式重试。重建固定原卷与原镜像，只有实际就绪才完成；原生续跑必须携带原会话标识，缺失时拒绝，不能自动改成fresh。原卷不可用时，重新执行通过专用 restart 入口创建关联的新任务，继续沿用原契约、镜像及资源配置；回执记录新任务 ID，旧任务保持失败。新任务实际启动后才完成恢复请求，不自动重放旧子任务的外部副作用。
