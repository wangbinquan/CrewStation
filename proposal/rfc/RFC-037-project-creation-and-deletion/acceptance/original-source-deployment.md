# 原事件来源发布、部署与真实入口验证

`25d0f545657aae2706c04827c76aa8cf2602c8f4` 的 53 个路径已精确提交并推送，完整提交清单、署名、暂存区与远端同步已核对。[CI 36794371836](https://github.com/wangbinquan/CrewStation/actions/runs/36794371836) 六项均为终态 success，包括实机端到端和新增代码防护。本机冻结候选完整门禁为 4694 pass／143 skip／0 fail、30,883 断言；第一轮升级快照失败和修正仍记录在 [来源验收](original-event-source.md)。

本机于 `2026-10-01T00:26:27.670Z` 完成升级，镜像只从上述提交归档构建。平台库先以 0600 备份；原迁移 Job `rfc037-migrate-25d0f545657a` 实际应用 events/0007_original_project_lineage.sql、gateway/0010_original_pod_identity.sql，applied=2。先升级控制器，再核对当前 35 个受管运行中 Pod 的原 UID 索引，missing=[]，随后升级认证及其他组件。

| 组件 | generation / observedGeneration | Ready |
|---|---|---|
| cs-controller | 173 / 173 | 1 |
| cs-session | 125 / 125 | 1 |
| cs-api | 208 / 208 | 1 |
| cs-auth | 106 / 106 | 1 |
| cs-events | 76 / 76 | 1 |
| mcp-capabilities | 72 / 72 | 1 |
| mcp-operations | 72 / 72 | 1 |
| console | 215 / 215 | 1 |

控制面摘要为 `b54172022eec5f82cc4c87d8a597e254b974911454991ef53d8918001d99c602`，console 为 `cf4a367cb97e313c5b914ba589339b9bf43b6f88c256fc01923cfa51ae42c258`。storage-contract=1；events 的 Pod UID Downward API 字段保持。部署前当前 Runner 摘要 `e7b0153ee23280606b90f88f6cf198543f1fb8d467e13f904c089d0f2cdd6da4` 保持；该值与前一批不同，不能将前一批 b229 摘要写成此次仍在运行。

原 22 个项目 Namespace、48 个 Pod/PVC、19 个 PV 的 UID 全部保持，三个 missing 列表均为空。完整回执位于 `/private/tmp/cs-rfc037-25d0f545657a-deployment-receipt.json`，原 Pod 索引回执位于 `/private/tmp/cs-rfc037-25d0f545657a-original-pod-index-refresh.json`。

真实 GitLab 生产方原 Pod `gitlab-event-producer-green-74bc66454f-wcbxc`（UID `231483d4-03e9-4b76-ba51-8f81b45c1dc4`）分别访问服务域 v1、v2 生产入口，空正文均得到 400 validation。它实际经过网关、ForwardAuth、签名原项目/服务、原生 Pod 归属及 events 入口后进入正文校验；未提交合法事件。当前 cs-events 容器直接访问两个入口，缺来源均得到 401 unauthenticated，伪造来源头和无效签名均得到 403 forbidden。负向探针最初把所有拒绝都断言为 403，因此命令退出 1；实际输出完整保留，缺身份的 401 符合入口合同，没有将命令退出码伪称通过，也没有为取得绿色重复发送请求。

部署后用原管理员会话刷新专用项目发布页，待验证 v0.1.0、提交 `544e2ccbed1953d201c60452928cfab45a0e0dd4`、1/1 副本就绪保持。列表打开创建弹窗时 URL 保持 `/projects?q=`，标识即时显示正式与待验证完整域名，模板用途和初始内容可见；1280×720 下弹窗 880×688、页面无横向溢出，取消后没有弹窗且焦点回到“新建项目”。此次浏览器尺寸覆盖没有实际改变视口，不能把 320px 尝试计为新的窄屏验收；既有 390/320px 实际证据保留在创建验收，共享弹窗改动另有 36 项兼容回归通过。

本批已取得真实网络入口的合法来源与缺失/伪造拒绝证据。旧项目重建、迟到正文及替换 Pod 的拒绝仍由真实 PG/HTTP 与假 K8s 模块证据支持，尚未在真实集群删除原项目。消费者停止、各 owner 的物理回收、管理员永久删除界面及完整实机对账继续，删除入口仍关闭。
