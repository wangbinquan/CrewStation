# 原生写入屏障批发布、部署与实际调用

精确提交 `b6999edf15ec81a43d42bd59c3fb80218b204af8` 包含 47 个明确路径，署名和远端同步已核对；共享在制文件保留。[CI 36832635556](https://github.com/wangbinquan/CrewStation/actions/runs/36832635556) 六项终态 success；本地稳定候选门禁为 4829 pass／143 skip／0 fail，详见[执行用例与失败历史](database-execution.md)。

## 实际部署

从该提交归档构建镜像，未把共享工作树的其他在制品带入镜像。平台库先备份再迁移，Job rfc037-migrate-b6999edf15ec/UID b6659eb2-7437-492f-b779-72dbecd9750a 完成。2026-10-01T08:05:21.813Z 八组件 Ready=1、generation 与 observedGeneration 一致；control-plane 镜像摘要 78fbc0ffc362bf86b3ea16047fd5676244bb902af0cdd5cdf9b2dd7c5fa1b31c，console 摘要 91356a399e142a97341522d7288c0f79be230119980b40859393ac3b1dd0cd32。

22 个原 Namespace、48 个原 Pod/PVC 对象及 19 个原 PV UID 保持，共享 PostgreSQL Pod/PVC/PV/挂载/节点/Service 身份一致；当前 Runner 摘要 587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928 保持。回执为 `/private/tmp/cs-rfc037-b6999edf15ec-deployment-receipt.json`；这是本批部署的身份检查，不覆盖未来替换或完整删除。

部署后通过当前实际 cs-api 运行镜像，只读核对 data_control/0004_native_work.sql：应用时间 2026-10-01T08:03:42.356865Z，校验和 4664e3cc8651b06c911fca74597452e14114996f132b33889a33e2c873a2f635 与镜像源码一致。私有回执 `cs-rfc037-b6999edf15ec-native-readonly-live.jsonl`。

## 实际回调与原项目保持

2026-10-01T08:20:31.963Z 在部署后的 cs-api 公共组合根执行原专用项目数据库的 SELECT 1。未启动后台 worker，没有 CREATE/DROP 或口令修改；仅记录本次受保护回调的最小实体/在途事实与原 Pod finalizer。

在 native.run 的实际回调内部，用独立主库连接读到 work 01a0f68d-03cf-7000-b453-3437e7ae98fe 为 running，原 Pod ba1d79da-c8ab-4266-8a01-a18b5f824cb2、容器及节点四键和原生 PID 1551383/来源摘要齐全。回调退出并释放原连接之后同一 work 为 finished，原 Pod 带 data-control-native-stop 保护。通过公开 project.resolveServiceOfProject 与 data.envFor 取原生产连接串，原运行角色 SELECT 1 成功；连接串和口令没有写入回执。私有回执 `cs-rfc037-b6999edf15ec-native-admission-live.jsonl`。

2026-10-01T08:23:26.263Z 原专用库 cs_rfc037_creation_proof/OID 276598 仍在，原目录 present；原 SQL 来源与库身份摘要分别为 6b27c1abe8802ccd9ec896e74185ddd8711ef7a0f062dc8b5aec11731b246f2b 和 14c53edd3a2c0545deacfe95642cd9a2b65db1d3e43ef518d3019f002dfcb120，与上批相同。实际清单有 48 座 cs_ 数据库；未把数量相同解释为全部内容不变。

## 界面与剩余范围

新建仍使用共享 FormDialog，展示标识决定的最终域名和模板初始化用途。上批 557cb50c 的实际桌面/390/320px、内部滚动和关闭焦点证据见[网关部署回执](gateway-database-deployment.md)。本批 Chrome 会话命名与新标签页连接均失败，没有新界面截图，不把尝试当作通过。

本批尚未实施完整 data-control deletionOwner 或独立原生卷 epoch；实际 SELECT 与最小事实只能证明在途接线和原凭据可用。对象、SCM、所有内容 owner、管理员二次确认与 PD 全链路实机回收继续。永久删除入口关闭，原专用验收项目保留。
