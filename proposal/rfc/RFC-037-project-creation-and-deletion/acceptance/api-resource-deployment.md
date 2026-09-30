# API／资源申请／重新确认批发布与本机部署

源码提交 `8ea3355da25947f2012eb8aeaf96de1b7b699b4a` 已精确发布 70 个任务相关路径。共享 platform 接线、迁移锁和 STATE 保留并行输出；提交包含 `Co-Authored-By: Codex <noreply@openai.com>`。完整本地门禁为 4612 pass／143 skip／0 fail，30036 断言，69 个冻结候选路径指纹一致；随后补齐文档路径，源码未变。发布前 HEAD Git blob＋精确候选在内存验证，后端 2741、console 937 文件，均无类型错误。

[精确 SHA CI 36757785782](https://github.com/wangbinquan/CrewStation/actions/runs/36757785782) 的 static／unit／module／console／gate／e2e 六项终态均为 success。CI 原回执 `/private/tmp/cs-rfc037-8ea3355da259-ci.json`，发布路径、提交消息及发布前后同步记录在 `/private/tmp/cs-rfc037-next-owner-*`。本记录不把后继提交的 CI 当作本提交证明。

## 实际部署

从该精确提交导出构建材料，不创建开发 checkout。镜像 revision 标签核对后，2026-09-30T18:36:07.370Z 完成本机 `docker-desktop`／`crewstation-system` 部署：

| 组件 | 实际 generation／observedGeneration | Ready |
| --- | --- | --- |
| cs-session | 120／120 | 1 |
| cs-api | 203／203 | 1 |
| cs-auth | 101／101 | 1 |
| cs-controller | 168／168 | 1 |
| cs-events | 71／71 | 1 |
| mcp-capabilities | 67／67 | 1 |
| mcp-operations | 67／67 | 1 |
| console | 209／209 | 1 |

- 控制面实际镜像为 `docker.io/library/cs-control-plane@sha256:4a63694572fe6c7d18ac7c5bd1a3844b851a11ea08f6ea92138a50db925403b3`。
- 工作台实际镜像为 `docker.io/library/cs-console@sha256:52e1db6ae6b45f3c8bab71a9720bd6577dde09a4802820f7b7990f1a51b15b88`。
- 部署前真实平台 PostgreSQL 独立备份后，唯一 Job `rfc037-migrate-8ea3355da259` 为 Complete；实际库已记录 `api-catalog/0007_project_deletion_fences.sql` 与 `resource-access/0002_project_deletion_fences.sql`。
- 切换使用原 Deployment UID／resourceVersion 检查，保留当时实际默认 Runner `task-runtime@sha256:12f04644221524f256bcd21f7ade3bfad0e8403dbcd674a84406d798689495ba`。
- 原 22 个业务 Namespace、49 个 Pod／PVC 对象及 19 个 PV 身份均保持；三类 missing 列表为空。

部署日志 `/private/tmp/cs-rfc037-8ea3355da259-local-deploy.log`、原快照 `/private/tmp/cs-rfc037-8ea3355da259-predeploy.json`、完整回执 `/private/tmp/cs-rfc037-8ea3355da259-deployment-receipt.json` 保存本机来源。以上镜像和代数为本次完成时的事实，不承诺后续并行部署不改变它们。

## 产品检查与范围

同一既有管理员登录在部署后重新打开专用项目 `01a0f30b-c652-7000-8d6f-553e3b5f6135` 的发布页，实际待验证版本 `v0.1.0`／源码 `544e2ccbed1953d201c60452928cfab45a0e0dd4` 为 1／1，就绪地址仍是 `preview.rfc037-creation-proof.cs.localhost`。未切换身份、未删除项目、未启动新的原生执行。

这一批落实 API 目录和资源申请完整内容清理、实际在途屏障及封闭期间重新确认。真实 SQL／HTTP 模块用例与精确 CI 证明其候选行为；尚未组合全部 22 个 owner，尚未完成专用项目全部物理资源对账。管理员永久删除入口继续关闭，RFC 和原目标继续。
