# 原停止、Session 数字清理和观测排空发布

用户最新要求最快上库和上线，原有提交、推送、部署授权持续有效；减少跨会话沟通不影响发布。151 个精确文件已发布为 `c58a3a79ad2727673dc34a9eddd59dadcb57bf8c`，发布后 main／origin/main 精确同步，共享索引空。共享 contracts/index.ts 保留并行输出，native-usage/pages.ts 由所属会话明确交接；其余并行在制文件未纳入。

## 本地检查的实际范围

完整检查 v1 在新增合同测试的品牌 ID 类型处失败；修正原夹具后，v2 静态四层通过，5734 pass／143环境skip／9 fail。九项真实 HTTP 失败来自 console DOM 注册替换 Bun 原生 Response，原失败日志全部保留。

新增 Bun.serve／node:http 回归先红，保留原生 Response 后通过。预加载 DOM 的所有 Session 删除及实际观测组合34／0、384断言；本候选全部用例加完整console层207文件1264／1。剩余旧用例仅模拟keyup，明确DOM预加载后没有产生输入；补发真实input事件并保持原草稿保护断言，原文件与HTTP回归8／0、46断言。

最后一次 `bun run check` 点名上述两个修正文件：结构、全仓lint、两层类型及8项回归全部通过。复用207文件中内容未变的通过项，原完整失败不追记为完整通过。精确提交树后端与console类型均0错；先前console VFS未指定配置文件路径的317项诊断保留。完整和补验LCOV按官方合并器核对1346可执行改动行，1328覆盖、98.66%，无违规。241份已发布迁移校验和不变，只追加五份，锁246。

私有原件在 `/private/tmp/cs-rfc037-fast-release-*`：`full-v1/v2`、`corrected-check-v3/v4`、`exact-types-v2/v3/v4`、`patch-v4`、`publication-v4`、候选首尾指纹和所有日志保留。不能用专项通过代替整仓CI或真实永久回收。

## 精确 CI、镜像与部署

[CI37192203246](https://github.com/wangbinquan/CrewStation/actions/runs/37192203246) 的 SHA 为上述提交，static／unit／module／console／gate／e2e全部终态成功。原完整本机失败和补验的范围仍按上节保留；精确提交树的整仓权威结论来自这六项CI。

两个镜像均从该 Git 提交的 archive 精确构建，未提取另一开发检出；OCI revision 和 storage-contract=1 已核对。control-plane 本地镜像 `sha256:9e1c28e9ec753773c22cdf785bc176dcfbcd228d037a703ec28fd1836d000ff3`，console `sha256:4988dab7d6618b89271dbd653a0a0cffb8bba4a90f02b958b2e2a77986cd401a`。构建回执 `/private/tmp/cs-rfc037-c58a3a79ad27-fast-release-v4-build.json`。

CI全绿后按原部署锁自动备份并安装，2026-10-04T09:55:55.169Z八组件全部就绪。实际Pod imageID与节点OCI revision核对上述提交，246份已安装迁移checksum与源文件一致；实际API报告根独占创建、fsync、回读与删除证明通过。原Namespace／项目Pod／PVC／PV、全部数据库/角色名字和OID、原GitLab容器及Runner镜像保持，没有创建模型任务。原件 `/private/tmp/cs-rfc037-c58a3a79ad27-fast-release-v4-deployment-receipt.json`。

原专用项目只读查询显示 Session origins、legacy origins、deletion operations 均0；首查询使用错误表名失败，修正为实际迁移定义的 `project.deletion_operations` 后成功，未写数据库。交接时并行观测提交 `8db68361a85baa9e18579cc8e0d1f408d0b2593c` 已继承本批，本地／远端精确同步；该并行提交自身CI/部署由其所属任务继续，本批不能把它称为已部署。

## 剩余交付

创建弹窗、用途说明和真实域名预览已交付。永久删除仍未开放：全部22 owner生产组合、旧数字键和未启动原执行兼容、SCM十一类及镜像/发布的正式物理清理来源、管理员入口实机二次确认与原项目全资源回收继续。producer OFF、原项目资源保持，RFC不关闭。本次发布不能称为整项目删除已经可用。
