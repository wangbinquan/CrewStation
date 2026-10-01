# SCM 删除协议与来源盘点

本批接续已批准的 RFC-037 §6.2；只完成远端协议基础，不开放永久删除入口，也不计 T9、PD-15/22 已完成。创建继续使用统一弹窗。SCM 生产文件仍为 40 个，没有借新目录扩大模块。

## 实际协议与原身份

`packages/gitlab-client/projectDeletion.ts` 读取原数字 ID/创建时间/当前路径和 GitLab 自报的存储位置；删除日期未返回时保留未知。存储接口兼容文档数组与实际 19.2.4 单对象，不能用项目 ID 猜路径。空或不完整身份、错误原 ID、非法日期/位置拒绝。

项目凭据接口读尽所有状态和页，保留过期/撤销身份，排除明文及额外字段。分页中断、缺少满页游标、跳页/回退/重复、非数组和重复凭据 ID 拒绝，不输出部分结果。永久 DELETE 只接受有效原数字 ID 和当前完整路径；SCM 适配器发请求前再次比对 ID/创建时间/路径。返回受理不等于实际回收，403/404/连接故障仍为明确错误。

接口依据 [Projects API](https://docs.gitlab.com/api/projects/) 与 [Project access tokens API](https://docs.gitlab.com/api/project_access_tokens/)；这些协议定位及权限要求不能代替原物理来源和文件消失证明。Gitaly [RemoveRepository 协议](https://gitlab.com/gitlab-org/gitaly/-/blob/HEAD/proto/repository.proto)描述先移到 `+gitaly/tmp/<relative_path>_removed` 后续再清理，后续适配器必须核对当前实际部署行为及暂存内容。

## 本机只读核对

2026-10-01T22:05:22.324Z，实际 API 原 Pod `6eac56d3-2a68-413f-8a2f-171a5fc4aa6a` 使用既有平台 GitLab 身份读成功，该身份当前有管理员权限，未切换身份。GitLab 为 19.2.4。原项目绑定远端 ID `383`、路径 `crewstation/rfc037-creation-proof`、创建时间 `2026-09-30T16:00:35.872Z`；原 token ID `513` 已过期但未撤销，仍纳入盘点。该部署 `/projects/383/storage` 返回单对象；先前私有观测器假定数组而失败的原件保留，修正观测器后成功，不修改远端数据。

候选 SDK/SCM 适配器单独打包，在同一实际 API Pod 中执行 **四次仅 GET**，身份前后相同，读回实际原存储位置和 token 身份。它是未发布候选的真实协议核对，不能当成产品已安装、正式 owner 已装配或实际资源已回收。原件 `/private/tmp/cs-rfc037-scm-candidate-live-receipt.json`。

独立只读 `docker exec` 固定原 GitLab 容器 ID，读取其实际 Gitaly 配置、原卷和文件 stat，不读取仓库内容，不执行任何删除。实际 `default` 位于 `/var/opt/gitlab/git-data/repositories`，原目录 device=65025/inode=1229425。API 返回的原 hashed 路径下主仓库 inode=1205801、26986 字节/114688 分配字节，Wiki inode=1244562、87 字节/36864 分配字节，design 仓库不存在，没有匹配临时删除目录。这仅是本次时点盘点，LFS/附件等尚未完整盘点，不能报告完整存储范围或回收证明。原件 `/private/tmp/cs-rfc037-scm-original-storage-stdout.jsonl` 与容器/卷记录保留。

当前安装源码也已只读核对：`Projects::DestroyService` 先标记 pending_delete，验证无仓库迁移，停止流水线，并通过 `Repositories::DestroyService` 的 after_commit 回调处理主/Wiki/design；LFS 此处仅删除项目关联。`LfsObject` 用项目关联限制销毁，`RemoveUnreferencedLfsObjectsWorker` 为无项目参数的全局定时清理。因此不把该 worker 用作本项目的单项删除接口，不以解除引用或 API 404 报告字节归零。安装源文件副本保留于 `/private/tmp/cs-rfc037-scm-installed-destroy-service.rb`、`-repositories-destroy_service.rb`、`-models-lfs_object.rb` 和 `-workers-remove_unreferenced_lfs_objects_worker.rb`；本批没有调用这些销毁方法或触发全局清理。

## 候选验证与后续

新协议先红 **0/7**，补齐后专项含既有客户端/适配器 **27/0、160 断言**，较宽 SCM/SDK **75/0、454 断言**，包括本机 GitLab 集成用例。完整原名字/状态和错误断言保留。结构/lint/后端类型通过，官方改动行 **65/65**，无未加载生产文件。11 个源码/测试文件冻结后执行本批一次完整检查，结果接续记录，不重复未变化候选。

正式 SCM owner 仍需：所有在途建仓/签发/打标/推送的持久准入与原副作用意图，原远端及凭据的不可变范围，原消费者实际排空，全部存储/临时目录/LFS/附件/关联共享对象的独立来源和回收证明，以及本模块元数据/alias 清理和最小墓碑。未绑定的未知远端、同名替换、丢创建回执和来源缺口不能按当前路径认领；平台组与全局令牌保持。22 owner Root 注册、其他内容回收和管理员二次确认仍待接续，原实机项目未删除。

## 稳定候选完整门禁

本批一次 `bun run check` 静态四层成功，**4986 pass/144 环境 skip/1 fail**，5131 tests、975 文件、33406 断言、1136.39 秒；11 个源码/测试指纹保持。全部 SDK/SCM 新旧用例及创建弹窗回归通过。唯一失败位于未改动的 `modules/data-control/tests/nativeProjectDeletion.test.ts` 预备事务反例：这次命令没有沿用既有隔离 PG 地址，默认实例 `max_prepared_transactions=0`，在执行 PREPARE 时返回 55000；它不是本批 SCM 协议失败，不将本次全仓称为通过。原日志 `/private/tmp/cs-rfc037-scm-protocol-full-check.log` 与回执保留，不改测试/断言、不跳过预备事务检查、不重复未变化全量。GitHub module 作业已配置 `POSTGRES_INITDB_ARGS=--set=max_prepared_transactions=10`；按规则§3精确发布并等待本 SHA 全部 hosted CI。

门禁期间 resources 维护结束协议出现并行在制文件，未改动或提交这些输出；本批没有迁移或业务契约锁变更。默认 PG 上的原生用例仍按各自实际夹具正常收尾，不清理其他项目、容器或共享设施。
