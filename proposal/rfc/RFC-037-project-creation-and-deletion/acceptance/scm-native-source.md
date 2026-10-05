# 原 GitLab 元数据来源与当前归属候选

当前创建弹窗已经上线；本文件记录永久删除尚未发布的只读来源候选，不代表资源已经回收。

## 实现与边界

`packages/gitlab-client/native/reader.rb` 在原 GitLab 19.2.4 Rails 中查询实际 Main／CI 数据库，按主键读完项目、所有状态的原令牌、相关个人令牌、机器人与全部成员，以及 repository、wiki、design、snippet、lfs、upload、artifact、trace、package、registry、secure-file 十一类原生记录。查询显式选择元数据列；SecureFile 直接读取文件定位字段，避免实例化时读取加密密钥。Main／CI 各自使用 repeatable-read、只读事务，前后重复核对；这不是两库的原子快照。预算超限、来源变化和未支持布局报错，不截断后返回完整。

七类目录从原安装配置与原 uploader 取得；保留配置别名及 `/var/opt/gitlab/` 下的实际位置。Linux Ruby 的 `File::Stat#birthtime` 不可用，改用实际 libc statx 读取设备、inode 与出生时刻，保留 uint64 字符串。目录位置不是文件树盘点，也不是项目独占或物理回收证明。共享 fork／pool、历史存储迁移、远端对象存储、额外 RPM／Debian／npm／Helm／RubyGems 存储、原导出和启用的原 GitLab Registry 等未支持情况明确拒绝。

私有 handler 和 SDK 固定原 Docker ID／imageID／StartedAt 与原 boot／PID namespace；读取前后由 Rails 外部重新核对。token 至少 32 字符，请求 32 KiB、响应 8 MiB，禁止重定向；来源替换、非法 UTF-8、忙、取消和超限均不能产生成功回执。host adapter 执行固定 argv 和固定源码，项目参数只经 JSON stdin；输出只允许有限元数据。取消会结束 host CLI，不能据此宣称原容器内 Ruby 或所有原消费者已经退出。

SCM 的 `gitLabNativeOriginsAdapter` 对照实际 API／原数据库令牌，并前后重读 API 身份与全部状态令牌。除最终平台凭据行，还显式查询已经返回但未完成平台落库的原 token ID。时间按既有 API 的 UTC 毫秒精度交给现有 witness；原数据库原始精度继续保留在 native facts。历史 NULL 与旧回调不被补写或重建，共享机器人、外部成员、缺失出生及不一致集合会阻断。此工厂已由 SCM 入口导出，尚未安装到生产启动。

## 实际证据

- `/private/tmp/cs-rfc037-scm-native-reader-live-v8.json`：实际私有 handler／SDK 在同一验证进程中调用原 Docker、原 Rails 和原数据库。原实例未变化；11 类、7 个实际根目录、原 token 513／549 完整返回。原项目 repository／wiki／design 各 1、trace 9，其余原生类别为空；不能将这些空类别称为非空对象的实机验收。`physicalReclamationProven`、`producersClosed`、`consumersStopped` 全为 false。
- `/private/tmp/cs-rfc037-scm-native-sql-audit-v1.stdout`：同一实际只读 collector 的 76 条查询经 Rails SQL 事件审计。相关身份表没有 `SELECT *` 或秘密列选择，没有 INSERT／UPDATE／DELETE／DDL；仅保存查询数量与表名统计，没有保存原 SQL 绑定、秘密或内容。此证据范围为当前原项目实际数据。
- `/private/tmp/cs-rfc037-scm-native-origins-live-v1.json`：实际 REST HTTP、实际私有 handler／SDK 和原 Docker／Rails／SQL 经正式 SCM adapter 得到 1 个原仓库、2 个原凭据的当前 witness；其中 1 个历史返回出生仍为 NULL。输入是先前实际已安装 Root 留存的原历史，明确不是重新读取当前生产 Root，不能冒充生产完整装配验收。原项目未删除。随后增加已返回未落库 token ID 的查询保护；该原输入的两枚 token ID 已经在原查询内，补验由专门回归覆盖。
- `/private/tmp/cs-rfc037-scm-native-source-inventory.json`：原 GitLab 安装源码与 Gitaly 原布局的路径、摘要及原件位置，用于核对模型、uploader、原配置和删除后临时目录语义。

## 回归与检查

- `/private/tmp/cs-rfc037-scm-native-combined-tests-v3.log`：GitLab 完整技术包、host adapter、SCM adapter 与现有当前归属回归，**49 pass／0 fail、314 断言、7 文件、1.60 秒**。原 handler／SDK 的请求与响应保护、真实本地子进程的 stdin／输出预算／退出／取消、调用者期间改写范围、来源替换、当前令牌与成员归属以及两项实际 PostgreSQL owner 回归均覆盖。PG 使用先前授权的 55337 专用实例与隔离库；没有创建新的真实 GitLab 项目、Task 或集群资源。
- `/private/tmp/cs-rfc037-scm-native-patch-v1.json`：官方改动行 **212／212、100%**；额外 host 逻辑 **42／42、100%**，无违规。Ruby 不属于 TS 覆盖率闸门，其证据是上面的实际安装读取与 SQL 审计。
- 结构 `/private/tmp/cs-rfc037-scm-native-arch-v2.log`、精确 lint v3／末次 v4、后端类型 v5、工作台类型 v1 均通过；host 在仓库 TS 配置下另行包含并检查，`/private/tmp/cs-rfc037-scm-native-host-types-v1.log` 无诊断。Ruby syntax 通过。复用没有变化的前序候选结果，没有因并行 HEAD 移动重启整仓全量检查。
- 原失败保留：旧 birthtime 不支持；原字段 `hashed_storage` 与 `repository_files` 不匹配原安装，分别改为实际 `storage_version` 与 `rpm_repository_files`；初次正例 fixture 错误引用可变 options、包深路径 import 与两次测试类型错误均保留原日志，修正后通过。

## 尚未交付

原生记录、配置路径或 API 404 都不能代替全资源回收。SCM 仍需固定原历史文件／临时与删除后遗留路径、共享引用，证明原写入关闭和原消费者退出，并执行与复核真正的物理清理；当前 collector 在原 Project 消失后不能代替留存物理来源。Garage 版本／副本／在途请求、镜像与发布 writer／consumer／擦除及共享 BuildKit 归属、其余旧执行兼容、正式全 owner 启动、管理员二次确认与原专用项目完整实机回收仍未完成。入口和普通 producer 保持 OFF，原项目与其他项目资源保留。

此前候选在 Git 自动审批拒绝期间保留，未部署未提交源码。2026-10-05 用户再次明确批准提交推送后，实际 Git fetch 已成功；当前与留存文件来源一并进入精确检查和发布，见 [后续来源与发布状态](scm-retained-files.md)。无需跨会话交流；缓存 ref 或其他会话的提交／CI 不能当成本任务的精确发布证据。
