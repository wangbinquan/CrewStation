# 原 GitLab 留存文件观察来源

这是永久删除的后续底座，创建弹窗已上线；本批不启用永久删除。

## 实现与边界

`packages/gitlab-client/native/storage/reader.rb` 在固定原 GitLab 容器的 embedded Ruby 中直接读取目录名和文件描述符元数据，不加载 Rails、不查询 Project、不读取业务内容。七类根目录由 host 配置绑定原设备、inode 和 statx 出生时刻；HTTP 调用者只能提交根目录类别及相对位置。打开每级路径禁止跟随符号链接，并检查实际类型、设备、预算与最终一致性；缺失必须显式观察，来源不可用不能转换为空清单。

私有 handler／SDK 前后核对固定 Docker ID、imageID、StartedAt、boot 与 PID namespace；token 至少 32 字符，请求 32 KiB、响应 8 MiB，拒绝重定向和非法 UTF-8。每次最多 128 个位置、100000 个目录项、48 层，超限报错，不截断。字节、已分配字节、链接数、原 inode／出生和变更时刻均保留；只证明明确请求范围的观察，不证明全 SCM 文件归属、停止写入、消费者退出或擦除。

读取与类型判断使用当前 Ruby 的 `File` 常量，禁止假定 x86 的 Linux `O_DIRECTORY` 数值；原安装实际为 aarch64。原生父记录消失后可以继续观察已固定的位置，但 Gitaly 临时删除位置、历史迁移／共享引用等仍需独立纳入完整清理范围。三个物理完成标志始终为 false；生产装配未安装本来源。

## 原安装与回归证据

- `/private/tmp/cs-rfc037-scm-storage-live-v4.json`：实际 SDK／私有 handler 在同一验证进程中调用原 Docker 和原 embedded Ruby。固定原实例未改变；原 repository 14 个文件、26986 字节，wiki 3 个文件、87 字节，原 design 和 9 个指定 trace 位置显式缺失。请求位置取先前保留的实际原清单，全程未查 Rails／Project；原项目实际保留，不能声称已删除父记录或完成回收。
- `/private/tmp/cs-rfc037-scm-storage-ruby-tests-v1.log`：原容器的同一 Ruby 执行独立临时文件夹回归，验证树与 Unicode 文件、原出生、位置改名后留存文件可见、文件／目录类型错误、越界、符号链接、FIFO、深度上限和根目录替换。临时目录由用例自身清理；没有创建或删除 GitLab 项目、任务或集群资源。这些 Ruby 行不计入 TS 覆盖率。
- 初次实际失败日志 `/private/tmp/cs-rfc037-scm-storage-diagnostic-v1.stderr` 保留了 aarch64 错误 `O_DIRECTORY` 数值导致的 `Errno::EINVAL`；使用架构原生打开常量并检查描述符类型后，原文件读取和上述负例全部通过。

本批的完整检查、精确改动行覆盖与提交记录在后续交付状态中更新。原生元数据来源见 [scm-native-source.md](scm-native-source.md)。永久删除仍需完整原文件范围、封写、停止消费者、真正擦除及独立复核，不能以本观察来源代替。
