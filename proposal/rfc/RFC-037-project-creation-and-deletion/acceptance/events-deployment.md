# events 精确发布与本机部署

本批源码为 `6c21cc852ead944bf5d99d25bf3ed7a552055185`，精确 43 路径提交；共享 STATE 保留其他任务内容，未提交 RFC-034 的独立在制路径。发布后 main／origin/main 精确一致。完整候选与来源边界见 [events-owner.md](./events-owner.md)，不是完整永久删除验收。

[CI 36777322814](https://github.com/wangbinquan/CrewStation/actions/runs/36777322814) 的 static、unit、module、console、gate、e2e 六项均终态 success，headSha 与本批完整提交一致。镜像仅从该提交的 Git archive 构建，没有另建开发 checkout，也没有把后续算力 owner 在制代码带入部署。

本机部署于 **2026-09-30T21:26:02.415Z** 完成。实际平台数据库先以 0600 独占文件备份，再运行 `rfc037-migrate-6c21cc852ead`；作业 Complete，日志记录 `events/0006_project_deletion_fences.sql` 已应用。备份及含基础设施来源的完整回执只留在本机 `/private/tmp/`，不提交秘密或数据库内容。

| 组件 | generation＝observedGeneration | Ready |
| --- | --- | --- |
| cs-session | 122 | 1 |
| cs-api | 205 | 1 |
| cs-auth | 103 | 1 |
| cs-controller | 170 | 1 |
| cs-events | 73 | 1 |
| mcp-capabilities | 69 | 1 |
| mcp-operations | 69 | 1 |
| console | 211 | 1 |

控制面实际使用 `cs-control-plane@sha256:8d6baecb75580077bcb5c00e6c68cc9da5a27b14e361176db57c56cd1a2d7ca5`，console 为 `cs-console@sha256:25f5b963494aee6194eb7aeeda93cda69e9098cf868ccfcfa3337240aa8479e0`，镜像 revision 标签均为本批完整提交。

`cs-events` 同步原提交新增的 Downward API `CS_PLATFORM_POD_UID=metadata.uid`，而非仅换镜像。实际进程 `printenv CS_PLATFORM_POD_UID` 返回 `274f53e9-1c4b-4067-a3ed-b522940e1549`，与 API Server 上 Running 原 Pod `cs-events-cddbfbc67-2bxlx` 的 UID 相同；实际容器身份为 `containerd://b5bdf830daaf956cf5654b9f844e9c5d9eaf5b14ce2e7c0b1b82c80c21fcbe65`。最初按 app 标签的查询为空，随后按实际容器名核对，没有把空查询当证明。本检查证明运行时源字段接线，未声称该原容器已经终止。

部署前的 **22 Namespace、48 Pod／PVC、19 PV** 原 UID 全部仍在，缺失集合均为空。Runner 在部署前已由其他任务更新；本次保留实际当前 `crewstation/task-runtime@sha256:b229e919f43ea5d5e283f474dad1c5fa2b7792f264fa5986c90dad53c77454b0`，没有恢复更早的镜像。

同一管理员会话重载专用验收项目 `01a0f30b-c652-7000-8d6f-553e3b5f6135` 的发布页，`v0.1.0` 与提交 `544e2ccbed1953d201c60452928cfab45a0e0dd4` 仍为 1／1 就绪。实际打开 `preview.rfc037-creation-proof.cs.localhost` 显示 CrewStation 最小样例、原项目／服务和 green 槽，未切换身份；临时试用 tab 已关闭。该样例尚未收到事件，未将普通访问当作实际投递／原进程停止验收。

完整本机日志及回执为 `cs-rfc037-6c21cc852ead-{ci.json,local-deploy.log,deployment-receipt.json}`。其余 owner、正式 22 方组合、管理员二次确认与专用项目真实回收继续；永久删除入口仍关闭。
