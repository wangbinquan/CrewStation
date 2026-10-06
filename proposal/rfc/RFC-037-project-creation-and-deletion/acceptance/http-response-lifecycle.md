# 管理员完整盘点的 HTTP 响应生命周期

2026-10-06 实际 API 的同一现有管理员、同一原项目只读 GET，在 9,368ms 出现 `The socket connection was closed unexpectedly`；没有资源写入。正式网关的候选请求返回502，首次404,712ms，当前版本一次537,099ms；中间一次重读31713ms返回200。浏览器没有保存任何逐项确认，原项目active、deletion operation0。

`994e5d1b` 已完成确切六CI及八组件实际部署。并行发布的 `1224449c` 包含994完整代码，其[确切CI](https://github.com/wangbinquan/CrewStation/actions/runs/37480058348)六项成功，当前八组件实际OCI/source一致。默认Runner由该部署更新到122版本、storage-contract1；原Runner镜像保留，原Probe UID／generation11／容器、删除原生ConfigMap和Secret完整保持。本任务没有回退或重新部署他人改动。

当前正式源码的独立只读组合读取完整77条：business1、gateway23、provisioning52、data-control1；前三者无阻断，PG一次因探针采样返回严格阻断。完整候选成功不代表界面请求已经成功，也不代表资源删除。

[Bun官方说明](https://bun.sh/docs/runtime/http/server#idletimeout)确认默认10秒闲置包括仍在执行、尚未发送响应字节的处理器。修订只在真实管理员认证完成后，为六类长请求调用当前服务器的逐请求timeout；普通API、非管理员、资源端口超时和完整删除判定不变。工作器仍须持久回收所有22方资源、154阶段回执和独立原BEFORE/AFTER，尚未完成。

真实HTTP回归覆盖六类长请求和严格管理员前置检查，普通读取／重试不延长；18秒超过Bun原生闲置时钟的粗粒度tick，修订前失败、修订后2／0和44断言。最终共享HTTP包及真实PG兼容40／0、392断言、10文件、58.45秒；冻结5个功能路径前后指纹不变，原专用PG容器身份保持。官方改动行12／12、100%、0违规；结构、精确lint和后端类型通过。一轮冻结候选完整check终态为6306 pass／157环境skip／2 fail，343318断言、1284文件、实际测试2169.68秒；五个功能文件指纹保持，原专用PG容器身份在结束后再次核实。四层静态通过，新增HTTP真实连接和权限边界在整库中也通过。两失败仅在并行改动的 `runtimeRecordedMetrics.test.tsx`，新夹具的 `partiallyPricedRecords` 与运行中已载入的严格观测契约不一致；`completeRuntimeReport.ts` 同时为其他会话在制品。完整门仍记FAIL，全部日志保留；依 development-rules §3 精确自有检查接干净提交树的确切六CI，不提交或回退观测WIP，不重复该未变化候选的全门。

私有原始回执：`cs-rfc037-i36-successor-http-readonly-v2.jsonl`、`cs-rfc037-i36-successor-full-repair-readonly-v1.jsonl`、`cs-rfc037-i36-successor-runtime-readonly-v1.json`、`cs-rfc037-i36-http-idle-targeted-v1.json`、`cs-rfc037-i36-http-idle-patch-v1.json`。修订上库／CI／部署和实际原项目删除继续，不记为RFC完成。
