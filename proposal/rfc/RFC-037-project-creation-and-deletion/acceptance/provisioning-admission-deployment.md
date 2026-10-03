# 开通原始准入与保留期恢复部署验收

2026-10-03，本任务 35 文件与 RFC-034 的 14 文件按短窗口串行提交，再一次推送。保留期提交为 `31531285c9b0a2445abeb8dd3f26b03ad70fd385`；最终部署源码为 `75dd427227fc7e3f587015c37ca411904513c625`。

稳定 49 文件共同完整门为 **5404 pass / 143 skip / 0 fail，37704 assertions，1041 files**，四项静态检查通过，检查前后候选哈希保持。旧完整门与独立 SOURCE 的失败原件保留，不用这次成功改写旧结果。[确切 SHA 的 CI 37090652986](https://github.com/wangbinquan/CrewStation/actions/runs/37090652986) 六项全部成功，包含新代码防护和实机端到端。

两张部署镜像从该提交的 `git archive` 构建。2026-10-03T03:05:09.837Z，本机八组件滚动更新完成；实际 Pod 的 imageID、节点 OCI 配置与源码 SHA 全部一致。原 Runner 保持 `sha256:587a0766440bae22f69bd6e68e101f2348ec8bda95f8b4c3ce6ddef0fa010928`。实际应用 provisioning 0001/0002/0003 与 task-runtime 0021，四项原始 SQL 校验和均与该提交一致。

部署 v1 在迁移完成后因校验脚本误用 `task-runtime` 而停止；数据库官方记录使用 `task_runtime`。诊断确认四项实际校验和与提交原始字节一致，部署源码没有变化。v2 修正核验，复用原成功 Job UID `70d39c7f-a61e-4448-8ea0-2f472af65d7a`、原备份和原导入镜像，续接滚动部署；v1 失败回执保留。

随后从实际 `cs-controller` Pod `8f7b6293-4034-4f1f-86b3-a3a78772f2f8` 的已部署组合根，用真实只读、可重复读数据库事务读取原项目开通历史。当前 Pod 的一条 `namespace-reapply` 启动回调记录与 `/proc/1` 的 PID、PID namespace、boot ID、start ticks 一致，原私有 finally 已记录退出。临时 exec 只读取记录；包解析先在已安装的 platform 模块作用域完成，构造 Root 前恢复控制器工作目录 `/app`。原失败的孤立导入尝试保留，未启动另一组后台任务。

原项目 `01a0f30b-c652-7000-8d6f-553e3b5f6135` 的 Namespace、Pod、卷、数据库及角色 OID，原生 GitLab/PG/对象存储身份与 Runner 保持；未删除原项目。该回执证明实际部署和启动回调出生／退出，**不证明 PID 与观察到的 CID 的关联、完整七阶段 owner 或全 22 owner 清理**。producer 仍 OFF，永久删除入口仍关闭。

回执存放在 `/private/tmp/cs-rfc037-admission-retention-delivery-handoff-v1.json`；其引用包含完整门、确切 CI、部署 v1 失败／v2 成功及真实控制器只读记录。部署回执为 `/private/tmp/cs-rfc037-75dd427227fc-admission-retention-v2-deployment-receipt.json`，启动回调回执为同前缀 `-controller-journal-proof.json`。

后续基础设施内容扫描、各模块原归属读取及 resource-access 0003 原映射保护均在此提交之外，仍需独立审查和正式接线。新迁移按精确路径追加锁到 222，原 220 校验和保持；其真实 PG 反例先红 0/2，修正后 18 pass / 0 fail / 287 assertions / 4 files，正常请求可追加映射，旧正文清理后不能改写、删除或截断原最小归属，旧历史不回填。该后续候选尚未提交或部署。

API 目录同类缺口随后以独立 0008 保护原实体最小映射，旧 0007 字节与历史保持。真实 PG 先红 0/1，修正后 24 pass / 0 fail / 363 assertions / 5 files；旧库无损升级、正常追加操作以及本模块七阶段清理后的拒绝改写均通过。该迁移同样尚未发布或部署。
