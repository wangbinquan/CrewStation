# 算力 owner 发布与本机部署

`333e631ddfaac5b34ec44ee8d7fcd2fa7de420c0` 的 29 个文件已精确提交并推送，署名与清单核对通过，发布后 main 与 origin/main 同步、暂存区为空。[CI 36783829899](https://github.com/wangbinquan/CrewStation/actions/runs/36783829899) 六项均为终态 success，包括新增代码防护和真实部署端到端。共享工作树之前的五个在制失败仍记录在 compute-owner.md；不能将那次本机全量结果改称通过。

本机于 `2026-09-30T22:34:14.745Z` 完成升级，来源仅为该提交归档构建的镜像。平台库先以 0600 备份；原迁移 Job `rfc037-migrate-333e631ddfaa` 实际应用 `agent_runtime/0009_project_deletion_fences.sql`，applied=1。

| 组件 | generation / observedGeneration | Ready |
|---|---|---|
| cs-session | 123 / 123 | 1 |
| cs-api | 206 / 206 | 1 |
| cs-auth | 104 / 104 | 1 |
| cs-controller | 171 / 171 | 1 |
| cs-events | 74 / 74 | 1 |
| mcp-capabilities | 70 / 70 | 1 |
| mcp-operations | 70 / 70 | 1 |
| console | 212 / 212 | 1 |

控制面镜像摘要为 `22b5c24b1bb23732ec1a9bcad9324668140833a8567821bb29961aaa8f8619ed`，console 为 `2a4b295bdea071b44e5120ad85fe3e2bc1d7ef02793483eb66fc05bb8106edee`。当前 Runner 摘要 `b229e919f43ea5d5e283f474dad1c5fa2b7792f264fa5986c90dad53c77454b0` 保持，storage-contract=1。events 原 Pod UID 的 Downward API 源字段保持。

部署前 22 个项目 Namespace、48 个 Pod/PVC、19 个 PV 的原 UID 全部保持，missing 列表均为空。完整回执在 `/private/tmp/cs-rfc037-333e631ddfaa-deployment-receipt.json`，迁移日志是实际 Job 的输出。

本批证明算力内容清理及未来 Registry 请求封闭已部署。尚未证明已放行上传退出、Registry 物理回收、其余全部 owner 或管理员永久删除全链路；删除入口继续关闭，RFC 保持 In Progress。
