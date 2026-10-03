# SCM 独立来源与正式 owner 接续

本文件接续已批准设计 §6.2。准入和副作用 journal 已部署，正式 owner 与不可变范围／阶段存储形成[未发布候选](acceptance/scm-owner.md)；下列实际独立来源仍未接线／验收，不据此开放管理员永久删除。

## 原容器的读取权限和实际持有者验证

2026-10-02 在同一个原 GitLab 容器中启动临时的只读观察进程，取得 `SYS_PTRACE` 后能够直接读取全部线程的描述符与映射；不再依赖切换文件系统身份。Root 的 real／effective／filesystem UID 均保持 0，容器 ID、启动时间、镜像、原 PID 命名空间和 boot ID 前后相同。没有安装运行时、重启服务、读业务内容／参数／环境或修改原项目。

两项在扫描期间关闭的描述符不能直接忽略：观察器在同一原线程启动 tick 下再次检查其缺失，并在收尾重新核对完整线程集合及启动身份；重新出现、无法读取、线程退出或替换仍令本次观察不完整。第一次真实扫描遇到线程退出，保留不完整结果。普通采样能碰到这些变化，正式来源仍须处理原生产者关闭与原身份，不能把它当成自动成功。

实际正反例只打开原仓库既有 HEAD 的只读句柄，没有创建文件或读取内容。独立观察在原 PID `1139756`、启动 tick `98720576`、设备 `65025`、inode `1245629` 上发现两条线程 FD 引用：**269 个线程、37215 次 FD 元数据读取、154833 条映射、0 读取错误**，完整元数据读取为 true。关闭自己的验证句柄后，另一份观察为 **268 个线程、37463 次 FD 元数据读取、154579 条映射、0 读取错误、0 匹配引用**。主仓库 14 个文件和 Wiki 3 个文件保持；原容器没有改变。

首次验证句柄因 Python heredoc 的 stdin 已结束而提前退出；第二次独立工具调用间的句柄期限也已到，均没有算成通过。改为在一个连续执行单元中启动、核对存活、观察并 finally 关闭后，才取得上述实际持有者反例。失败观察和回执仍保留。

这关闭了原范围消费者元数据读取的权限／实际持有者反例，仍不构成完整物理源或回收证明。正式受限观察服务尚未接线，全部存储类别与旧令牌沿革仍需核对，生产者没有关闭，原仓库仍有文件。`complete_physical_source`、`producers_closed`、`consumer_stop_proved` 和 `physicalReclamationProven` 均保持 false，管理员删除入口继续关闭。

实际回执为 `/private/tmp/cs-rfc037-scm-privileged-thread-reader-positive-v4-receipt.json` 和 `cs-rfc037-scm-privileged-thread-reader-after-witness-v5-receipt.json`；首能力核对、遇到线程变化和过期验证句柄分别保留在同前缀的 `reader-capability-v1.json`、`thread-reader-v2-receipt.json`、`thread-reader-positive-v3-receipt.json`。下方旧观察保留为历史，不再将 7855 次拒绝读取解释为尚无可行权限方案。

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

### 原容器既有运行时探测

2026-10-02 只读核对原GitLab容器6c4126f06a4baee9e51f6699cd45de7f8d8c69b2ebc51d200072765a0d5d7bb0仍运行，StartedAt为2026-09-21T04:17:30.022274546Z，镜像24e30def586d87987fd23d5d3b454ed6c0bfb1248a604b59ce975e88c6b33d3d。已有embedded/node与/usr/bin/node均不可用，已发布的全线程Node消费者原语不能直接在这个原容器执行。未安装运行时、未创建替代验证容器、未重启或修改原容器。旧Ruby盘点只枚举进程领导者描述符且保留7855权限错误，不能当成全线程完整来源；需要继续接实际原来源的线程、映射及权限证明，不能用新原语用例通过关闭实机缺口。

### 2026-10-03 当前凭据归属与历史缺口

实际 API Pod `373718ae-2158-4ffd-9ed9-66e98c9f872a` 的已安装 SCM 历史端口仍读到两条凭据、两条回调和一个原仓库来源。原项目 383 的历史来源为 `legacy-binding`，历史创建时间仍为 NULL；旧令牌 513 没有原 `returned` 事实，新令牌 549 有完整创建时间和 userId。对同一实际库调用已安装的 owner 工厂，明确得到 `scm-origin-unrecorded`／`scm-credential-history-incomplete`，物理 capture 没有被调用。该读取没有挂载正式 Root owner，也没有删除项目。

安装的 GitLab SDK 跨全部状态读取访问令牌，原数字 ID／路径／创建时间在前后读取中一致；513 和 549 的名称分别精确对应同一平台凭据 UUID 的 `cs-session-`／`cs-build-` 名称。原 19.2.4 容器的 READ ONLY、repeatable-read 事务独立读取原 token、user、全部 Member 和关联 PAT 元数据：user 541、577 都是 `project_bot`，各有且只有项目 383 的成员关系，没有其他项目／组成员关系或额外 PAT。原容器身份、平台历史摘要和原项目身份保持；未读取明文或密文令牌，未归档、撤销、删除或更新原历史。

当前出生身份与旧调用事实分开处理。旧 513 的历史返回仍缺失，当前原 token 的创建时间／原 userId、机器人创建时间与成员关系能够由两个当前来源交叉核对；这些当前事实不能补写成旧回调结果。安装源码同时确认平台普通 SHA256 hex 与 GitLab 的加盐 Base64 SHA256 不可直接比对，不能用两个摘要“相等”来补造旧调用来源。

私有当前归属 witness 原型仅覆盖这一个原验收仓库，使用上述真实只读输入通过 21 项核验。其反例覆盖原实例／父仓库替换、缺少全部状态、遗漏或重复凭据、跨项目／组机器人、额外 PAT、未知历史请求、历史／当前身份冲突、缺少成员来源和秘密字段；历史 NULL、原回调缺失及原输入摘要保持。原型没有修改正式生产源码或挂载 owner，输出 `deletionAuthorized=false`／`fullPhysicalSource=false`／`physicalReclamationProven=false`。

私有证据为 `/private/tmp/cs-rfc037-scm-legacy-current-origin-v1.jsonl`、`cs-rfc037-scm-current-origin-root-snapshot-v1.jsonl`、`cs-rfc037-scm-current-credential-native-source-receipt-v1.json` 和 `cs-rfc037-scm-current-origin-witness-check-v1.json`。两个数据库的分别一致快照不是跨库原子快照。后续正式范围需要分别持久保留历史材料与核实的当前原身份，继续阻断未知请求和共享引用；全部文件、生产者和消费者来源以及完整 22 owner Root 仍须接齐，不能据本节开放永久删除或计全回收通过。

## 2026-10-03 正式当前归属端口接续

已把当前归属核对移入 SCM application/ports，并接入正式 owner 的可选来源。旧来源缺少时间或令牌返回时，只有完整来源覆盖原 ID/路径、全部 API/数据库令牌、project_bot、全部成员关系和全部个人令牌，且前后原实例及原历史稳定，才建立独立当前事实。已知历史冲突、未知归属、外部引用或未闭合请求仍阻断。物理范围必须匹配同一来源/时代与当前身份，确认摘要包含独立见证；旧 scope 保持兼容，历史 NULL 和未返回回调没有回填。当前见证不能替代消费者退出或完整十一类物理范围。

四文件定向 26 pass/0 fail、218 断言；来源校验器行覆盖 100%，正式 owner 96.71%。后端类型、精确 lint、结构检查通过。首版两个旧库 fixture 在迁移前误走现代封写 API，随后旧库种子原始 SQL 的 Date 参数也失败；失败日志保留，改为真实旧 schema 种子及 ISO 参数后同样断言通过。定向验证不称完整门禁，新的来源端口尚未挂载生产 Root。

新实现还读取了已部署 `463f24d8` 的实际 API Pod、原 GitLab 19.2.4 的只读重复读事务与全部状态 API；正式校验器接受一仓库/两凭据，旧令牌的一份历史返回继续缺失，原历史及原容器身份不变。首份只读 Root 读取误用 app 选择器，在执行 SDK 前失败；改用 Deployment 实际 selector 后通过。私有实机回执 `cs-rfc037-scm-current-origins-formal-live-check-v1.json` 的摘要为 `79d660a72059a1da2c89cdea044d3778925093ce719532361d3628c223cf0873`。此处只证明真实当前归属的数据校验；没有执行撤销、归档、删除或安装完整物理/22 owner Root，原项目保持。
