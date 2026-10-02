# SCM 独立来源与正式 owner 接续

本文件接续已批准设计 §6.2。准入和副作用 journal 已形成候选，正式 owner 与下列独立来源尚未实施／验收，不据此开放管理员永久删除。

## 原安装与只读事实

2026-10-02 在原 Omnibus 19.2.4 容器 `6c4126f06a4baee9e51f6699cd45de7f8d8c69b2ebc51d200072765a0d5d7bb0` 读取安装源码，并在 GitLab main／CI 各自的 repeatable-read、READ ONLY 事务读取原项目 383。原路径／创建时间均核对：`crewstation/rfc037-creation-proof`／`2026-09-30T16:00:35.872Z`。两个事务不是跨原数据库的原子快照，也不计完整物理来源证明。

本轮原项目 LFS、Snippet、上传、pool、存储迁移、deploy token、secure file、fork 和 container repository 均为空；原安装 registry 未开启。CI 有 **2 个 pipeline／9 个 build**，job artifact／pipeline artifact 元数据为 0；不能把这个 0 解释为没有 trace 文件或未完成传输。原项目 bot 541 仅有项目 383 成员关系，无 group 成员关系；新签发凭据的 bot 还须按实际返回和全部令牌源纳入。

安装源码 `app/services/projects/destroy_service.rb` 的 `destroy_project_related_records` 包含主／Wiki／design、Snippet、CI、bot、上传导出和 LFS 关联；`delete_lfs_objects_projects` 仅删除关联。`LfsObject` 没有跨 schema 数据库 RESTRICT 外键，项目关联锁不代表已锁住所有其他项目引用。全局无项目参数的 `RemoveUnreferencedLfsObjectsWorker` 不能由本操作调用；只可等待正常后台清理并观测原独占 blob。其他项目或平台共享的原对象保留。

安装的 `lib/gitlab/ci/trace.rb:240` 调用 `job.ensure_trace_metadata!`，不是纯读；独立来源不能调用它来“查询”trace。同文件 `:263`–`:281` 的原目录为配置 `builds_path`／job 原创建月份／原 projectId／原 jobId `.log`。`app/uploaders/job_artifact_uploader.rb` 同时有原 hashed 与 legacy 布局，需由实际原记录和配置解析。实际 Gitaly Remove RPC 由 `Gitlab::Git::Repository#remove` 发出；调用成功不替代原目录、暂存删除目录和打开文件的核对。

私有只读来源：`/private/tmp/cs-rfc037-scm-original-file-types-stdout.jsonl`、`...-ci-types-stdout.jsonl` 与 `...-native-source-inventory.json`。文件内容、令牌、配置秘密、CI 命令／变量没有输出或纳入仓内回执。原远端、原数据卷和共享服务保持。

## 正式组合的必要条件

1. `scm` 自己按同一原项目读取 journal／所有绑定和原沿革，未知回调、丢返回值、无法归属的凭据继续显式阻断。旧数字 ID／路径的缺失创建时间保持未知；当前来源核实与原历史分别保存，不能补造旧调用。
2. GitLab API 源固定数字 ID／原创建时间／原路径，读取全部状态的访问令牌及其 bot 来源。原 serviceId／credentialId 及 UUID 别名与内容分别处置。来源未知、其他项目 bot／pool／LFS／制品引用阻断，不能调用原生 destroy service 删除共享用户或对象。
3. 独立原物理来源必须固定实际后端、数据卷／根 epoch、原目录与文件身份，并完整枚举主／Wiki／design／Snippet、原 trace／制品／附件／LFS、实际共享引用、移库源／目的和待清理范围。非本安装版本、Praefect、副本、远端对象存储、无法识别的 uploader 或历史位置无适配器时明确阻断，不能按名字猜原文件。
4. 原回调、原 GitLab 任务／Gitaly RPC／传输和所有文件消费者真实停止后才进入 purge；来源观察器只读，不重启或强杀共享 GitLab／Runner，不挂载 Docker socket，不执行全局 GC 或任意路径 rm。请求只作用于确认过的原数字仓库；正常原生删除和后台清理后继续核对原文件与未释放的实际占用。
5. `scm` 的不可变清理范围与每阶段证明存自己 schema，许可验证在每次副作用前后执行。seal 封写并固定范围；stop 排空；purge 请求；prove 独立核对；namespace 交由集群 owner；metadata 仅在原物理证明齐全后清理所有本项目内容／缓存／别名，保留最小墓碑；verify 重读原来源和全量元数据。重放或新世代沿原范围继续，不能改成当前同名仓库。
6. 正式 owner 通过反转端口在 Root 装配，全部 22 个 owner 齐全前不开放产品入口。原来源不完整的项目必须呈现具体阻塞，不把已实现的空模块或内部工厂当作全清理成功。

跨项目共享、原名／存储替换、API404但文件未回收、实际原消费者仍活动、原生删除受理后丢回执、旧 bot／原项目替换、隐藏／分页读取故障、metadata 清理后来源复核和未知文件类型均须有状态反例；真实原来源和全部 PD-22 对账仍须在本机独立验收。

## 当前安装的独立文件读取反例

继续在原 19.2.4 安装中读取固定来源。九个 build 均为 failed／skipped，实际 `builds_path` 中相应九个 `.log` 以及 CI trace chunk 均为 0；全部月份的该项目 trace 目录亦未找到。包、上传和 LFS 的当前关联为 0。主仓库仍有 **14 个文件、26986 字节**，Wiki 即使业务统计大小为 0，仍有 **3 个文件、87 字节**；design、该项目 hashed artifact 和上传目录当前 absent。因此业务计量的 0 不能替代目录与文件的实际读取。

Rails 仓库配置没有本地 `path`；原 `gitaly_address` 实际指向该容器的 Unix socket。另从原 Gitaly `config.toml` 只选取非秘密 storage 配置，在内存用 TOML 解析得到 default 根 `/var/opt/gitlab/git-data/repositories`，transactions／recover_pending_wal 均 false。未保存或输出原令牌／完整配置。原数据卷 `aw-local-gitlab-data` 的 Docker 挂载清单仅有原 GitLab 一个运行容器；不以这个清单代替全部文件消费者证明。

原 Gitaly 二进制自报 19.2.4，与该版本[RemoveRepository](https://gitlab.com/gitlab-org/gitaly/-/blob/v19.2.4/internal/gitaly/service/repository/remove.go)及[repoutil.Remove](https://gitlab.com/gitlab-org/gitaly/-/blob/v19.2.4/internal/gitaly/repoutil/remove.go)对拍：后者把原目录 rename 到原 storage `+gitaly/tmp/<basename>+removed-*/repo`，延后删除失败仅记录日志。原位置 absent／RPC 成功仍不能证明这个临时目录实际消失。不能沿用旧问题单中的 `+deleted` 后缀来漏掉当前暂存目录；正式 source 需覆盖原范围内对应 basename 的全部 removal staging。Gitaly WAL／partition、pool 或远端存储启用时，无完整适配则阻断，不能套用此本机布局。

私有只读文件观察原型固定项目 383 和原根，逐个读取 lstat 的设备、inode、大小与时间，未读取源码或业务内容。7 条根配置对应的 6 个独立原根存在，范围读取无错误，没有观察到匹配的打开描述符；但容器内原 Root 身份读取其他用户进程 FD 有 **7855 条 EACCES**，因此明确返回 `complete_physical_source=false`／`consumer_stop_proved=false`，绝不把未能读取解释为零占用。正式受限来源服务还须具备并验证原消费者的实际读取权限、独立身份和并发完整性；本轮没有新增、重启或强杀原服务，没有 GC 或 rm，没有封闭／删除原项目。

证据原件为私有 `cs-rfc037-scm-original-trace-footprint-2-stdout.jsonl`、`...-gitaly-roots.json`、`...-mount-consumers.json`、`...-filesystem-2-stdout.jsonl`。文件观察首次缺少 Ruby `time` 标准库而失败，补齐后仅关闭这项原型执行错误；前述消费者权限缺口和正式 source／owner 仍未关闭。

后续 `filesystem-metrics` 消费者读取原语另形成未导出／未接线候选：按实际设备／inode 读取可见 PID 命名空间内每个线程的 FD、maps、cwd、root 与 exe，并核对 boot ID、PID 命名空间、进程／线程集合和 start tick。权限／格式／身份变化返回明确 blocker，取消保持可观察，不输出路径、内容、进程名、参数或环境。6／0、25 断言覆盖非 leader 独立 FD、已关闭 FD 的映射、不可读线程与错误来源；合并改动行门禁通过。这是本地夹具层原语，不具备全部原 GitLab 命名空间／物理根／生产者闭合证明；原安装的 7855 条 EACCES 仍未关闭，不能计原消费者实际停止或 PD-15／22 完成。
