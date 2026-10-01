# 网关 owner 与原数据库物理来源部署

源码批精确提交并推送为 65545ab44dddf09edb358cd0f7af5060cb5ae3f9，57 个允许路径与署名、共享 index 和远端同步均已核对；保留共享 platform/wiring 中原 owner 已发布的 RFC-034 统计接线。[精确 CI 36813913732](https://github.com/wangbinquan/CrewStation/actions/runs/36813913732) 六项终态成功。稳定候选的全量及定向数字见 [数据库物理来源](./database-physics.md) 与 [网关 owner](./gateway-owner.md)，未因文档、HEAD 前进或部署重复运行完整本地门禁。

## 并发部署与实际版本

65545ab4 的精确镜像已构建并导入。首次部署在更新 controller 和 session 后发现 cs-api generation／容器内容被并发部署改变，CAS 检查停止，没有回滚或覆盖并行配置，也没有把部分更新报告为完成。原日志保留于 /private/tmp/cs-rfc037-65545ab44ddd-local-deploy.log。

并发镜像的实际 revision 为 557cb50c5b6800771a5d016526d7a4d49d61eb77。Git 证明它是 65545ab4 的后继，唯一差异为 RFC-034 的四个 Markdown 文档；所有产品源码与本批实现相同。[后继精确 CI 36813933923](https://github.com/wangbinquan/CrewStation/actions/runs/36813933923) 六项终态成功。核对无其他实际部署脚本运行后，从当前配置重新捕获身份与版本，以该后继的已校验镜像完成部署；未复用旧 resourceVersion 或倒退已更新组件。

完成时间为 2026-10-01T04:32:58.487Z，docker-desktop / crewstation-system。八个 Deployment 均 generation=observedGeneration、Ready=1：

| 组件 | generation |
|---|---:|
| cs-controller | 177 |
| cs-session | 130 |
| cs-api | 211 |
| cs-auth | 109 |
| cs-events | 79 |
| mcp-capabilities | 75 |
| mcp-operations | 75 |
| console | 220 |

控制面实际摘要为 8b58a290e9bd5dd96dd3771d89c429f5ab3a736655d1790efb82e74b7e73a46f，console 为 9096366dd272ba413a7dbc8016b6762d9f2910eb4a36f12315e346a4f1071bb1。保留部署前当前 Runner 摘要 587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928，storage-contract=1。原 22 个 cs-* Namespace、48 个 Pod/PVC、19 个 PV 全部原 UID 保持；missing 均为空。controller 先刷新并核对 35 个原 Pod 身份，再更新后续平台组件；API、controller、events 均保留 metadata.uid 的 Downward API 来源。

每次迁移前保存本会话独占的 0600 平台备份。本次 gateway/0011_project_deletion_fences.sql 最先由并发后继迁移 Job 于 2026-10-01T04:24:30.37044Z 实际应用，后续两个本会话迁移 Job 为 applied=0。正式平台库只读查询确认校验和 f287a26d2471fd7472faef4bf9d54d450868f94a4cb48dfbf9b2cb73000e17af 与部署源码一致，不能把两个零应用日志写成又执行了新迁移。

## 原数据库只读实机证明

2026-10-01T04:34:21.017Z 在正式 API 容器运行已部署原生适配器，对原专用项目的 cs_rfc037_creation_proof、OID 276598 做 capture/verify。结果为 present、catalogPresent=true、remainingDirectories=1；原 source 摘要 6b27c1abe8802ccd9ec896e74185ddd8711ef7a0f062dc8b5aec11731b246f2b、identity 摘要 14c53edd3a2c0545deacfe95642cd9a2b65db1d3e43ef518d3019f002dfcb120。原生平台前缀的 48 个数据库名字/OID 清单在观测前后完全一致。

这证明实际源权限、catalog 与原目录读取得到本批实现的 present 结果；没有删除或新建数据库，不计作 PD-13 完整回收。首次临时脚本从根 stdin 解析 postgres 包失败，使用 data-control 自身依赖解析后通过；首次失败日志保留，不计成功。

## 创建弹窗回归

复用既有 dev-admin 管理员会话，不切换身份。旧验收标签页出现 0×0 视口且无法点击／截图；没有计作布局证明。按同一浏览器的恢复流程新建验收标签页后，实际视口分别为：

| 视口 | 统一 dialog 位置与尺寸 | 页面 scrollWidth |
|---|---|---:|
| 1280×720 | x=200, y=16, 880×688 | 1280 |
| 390×844 | x=16, y=16, 358×812 | 390 |
| 320×720 | x=16, y=16, 288×688 | 320 |

输入仅为本会话未提交草稿。界面实时显示 rfc037-domain-check.cs.localhost 与 preview.rfc037-domain-check.cs.localhost，说明不可变标识、正式手动上线和待验证验收含义；默认基础应用说明页面、API 示例及发布配置。窄屏内容在弹窗内滚动，底部创建／取消／清空操作保持视口内，没有横向溢出。清空后两输入为空；取消后 dialog=0、焦点返回「新建项目」，URL 保持 /projects?q=。已恢复临时视口覆盖、隐藏并关闭本会话新标签页。

桌面、390 与 320 实际截图保存于 /private/tmp/cs-rfc037-557cb50c5b68-creation-dialog*.jpg，320 几何另存 JSON。原专用项目仍已开通，待验证 v0.1.0 健康，正式版本未部署。未提交新的项目，也没有把未提供的 Network/CDP 接口包装成零网络写入证据。

## 证据与剩余工作

本次最小回执前缀为 /private/tmp/cs-rfc037-557cb50c5b68-：descendant-ci.json、predeploy.json、targets.json、migration-receipt.json、deployment-receipt.json、original-pod-index-refresh.json、database-live-probe-2.json、gateway-migration-live-probe.json、browser-320.json。失败尝试分别保留在 65545ab4 和数据库临时脚本首次日志中；未修改其他会话回执。

永久删除入口仍关闭。原数据库／角色的正式 owner、全部新旧写入者与原外部工作排空、存储／SCM／registry 物理回收、全部 owner 组合、管理员二次确认及原专用项目实机删除继续实施；本回执不将网关内容清零或数据库 present 观测称为完整删除。
