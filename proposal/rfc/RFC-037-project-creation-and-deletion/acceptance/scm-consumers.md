# SCM 原容器线程读取验收

2026-10-02 接续原消费者权限反例。此次只读观察运行于原 Omnibus 19.2.4 容器 `6c4126f06a4baee9e51f6699cd45de7f8d8c69b2ebc51d200072765a0d5d7bb0`，原 StartedAt、镜像及容器身份前后保持。没有停止、重启或删除 GitLab／Runner，没有创建替代项目或容器，没有读仓库内容、进程参数或环境。

## 实际读取与正向验证

原 Ruby 3.3.11 观察进程的 real/effective UID 为 0，具备 SETUID／SETGID，缺少 SYS_PTRACE。读取非 root 线程时仅在观察进程中临时匹配 filesystem UID/GID，逐次核对实际设置结果；real/effective/saved UID/GID 保持，finally 后核对全部原 filesystem 身份与有效／许可 capability 恢复。没有修改被观察进程的凭据、内存或运行状态。

本次枚举 **85 个进程／271 个线程**，核对前后线程集合、start tick、boot ID 和 PID namespace；237 个线程使用上述受限读取。成功取得 **28097 次 FD stat、每类 271 次 cwd/root/exe stat、154850 条 maps 元数据**，EACCES／EPERM 为 **0**。原项目范围内 34 个目录／文件 inode 中主仓库仍有 14 个文件，Wiki 仍有 3 个文件。没有观察到匹配消费者，但有 2 个 FD 在读取时关闭，原严格回执仍报告 `metadata_reads_complete=false`，不能解释为已经证明停止。

另运行短暂的只读正向验证进程：只打开原仓库的一个既有文件并持有描述符，不读取内容、不写文件，进程的三个线程均被观察器按原 device/inode 和 start tick 精确识别。验证结束仅关闭本验证持有的描述符，进程正常退出；再次核对原容器身份保持。该证明验证实际检测能力，不能充当业务消费者停止证明。

## 证据及边界

私有原件均为 0600：

- `/private/tmp/cs-rfc037-scm-original-thread-reader.rb` 与 `...-receipt.json`：实际读取程序、完整计数／错误和容器前后身份。
- `/private/tmp/cs-rfc037-scm-original-thread-reader-positive-receipt.json`：已知消费者的正向检测及验证进程退出。

这关闭了原 Ruby 观察原型的实际权限不足反例；既有 7855 条 EACCES 原件仍保留。该程序尚未成为平台正式来源服务，没有提供全部挂载／命名空间的完整性、原生产者关闭、所有存储类型及回收证明；两份实际回执均保持 `complete_physical_source=false`、`producers_closed=false` 和 `consumer_stop_proved=false`。SCM owner 候选未因此接线，永久删除入口仍关闭，原项目及资源保持。

本文件在双方 63 路径共同候选冻结之后新增，不改变任何被冻结路径，不计入该候选的源码或完整门禁证明。

## 原生产者当前状态

同日另在原 Rails main／CI 各自的 READ ONLY、repeatable-read 事务只取原身份、状态和计数；Redis 的原项目 main／Wiki／design reference counter 各为 0，Snippet／移库记录为 0，9 个 build 均为终态。原项目 `archived=false`、`repository_read_only=false`、`pending_delete=false`，写入入口仍开放；当前无活跃计数不意味着持久封闭。跨 main、CI 和 Redis 的读取不是同一原子快照，回执 `producer_closure_proved=false` 保持。私有证据为 `/private/tmp/cs-rfc037-scm-original-producer-metadata-receipt.json`。

安装源码 `CanMoveRepositoryStorage#set_repository_read_only!` 的行锁与转移计数检查，以及 `Gitlab::GitAccess#check_push_access!` 的只读／归档检查提供原生准入依据；它们本身没有提供全部后台任务、Gitaly RPC、制品传输或文件消费者停止证明。没有调用原生只读设置、归档或清理服务。
