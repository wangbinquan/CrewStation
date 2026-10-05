# 原构建来源与完整创建准入

2026-10-05 接续 RFC-037。新建项目弹窗保持已部署行为；永久删除尚未装配全部生产物理端口，入口继续关闭，RFC 与原目标仍进行中。

## 完整创建回调

资源调和器将原台账记录传入组合根。运行镜像构建、发布构建／迁移 Job 和服务槽经各自实际 owner 登记回调，覆盖凭据读取和之后的整个 Secret／Job／Deployment apply。原项目资源准入、来源项目准入与 Registry 全局共享锁共用原 PostgreSQL backend；嵌套凭据调用复用该回调，真正返回或抛错时才独立登记退出。

组合根核对原记录 UUID、projectId、owner module/ref、构建 epoch／固定计划、发布 ID、服务和 build/migration/physical-slot 归属。非项目平台构建也经过 Registry 共享准入。封闭的原资源不能新建，替换归属不能借用其他回调。取消及已有终态构建仍可进入原调和回调清理自己的凭据。

真实 PostgreSQL 回归使用实际 release owner、runtime admissions、resources admission 和原凭据用例：凭据读取已返回、实际 apply 尚未继续时，journal 仍在途，原 native eraser 在真实 advisory lock 上等待；多来源构建的来源项目资源锁同样保持。Job/Pod apply 在这些锁生命周期用例中为受控步骤，不能称作真实集群资源删除。

## 原生控制与文件来源

BuildKit 固定为 [v0.33.0 Control 协议](https://github.com/moby/buildkit/blob/v0.33.0/api/services/control/control.proto)。读取 Info、ListWorkers、未过滤 DiskUsage 和未过滤／无限制的 EarlyExit history，必须取得成功 HTTP/2 gRPC trailers 与完整帧 EOF。原 protobuf 纳秒出生保持；Go map 的原字段按规范顺序单向摘要，私有命令、前端 URL、日志与凭据不离开解码器。

历史归属读取实际 image exporter／image.name 目的地，按完整仓库边界与受保护平台目录分类。失败或孤立尝试仍保留目的地；无目的地和混合目的地明确分类，Job 名不被解释为原生历史 Ref。受控原生 Prune 仅传单一 `id==<原ID>` 和 exact history Ref/Delete；原 authority 必须取得排他范围并重新核对固定来源、原 cache/history 与受保护项。acknowledged 明确不代表物理回收。

原节点只读文件来源读取四个实际 bbolt 数据库：cache metadata、solver result cache、overlayfs snapshot metadata 和 containerd metadata。后者按 [BuildKit 固定依赖 containerd v2.3.4](https://github.com/moby/buildkit/blob/v0.33.0/go.mod)读取 buildkit/buildkit_history namespace 的租约、content 与逻辑 snapshot 图；缺失 view 反向边明确留存。全部数据库以设备、inode 与出生固定，RAM 读取前后完整 EOF 一致，原私有字节不落盘。

完整目录清单加选定 snapshot/content 文件遍历，核对每条实际文件出生、设备、inode、分配字节和链接。仅支持 snapshot 中实际 OCI 零设备白化项，读取元数据而不打开设备；其他设备、FIFO、未知布局、跨设备、替换数据库、超出预算或原查询漏项均失败。来源将 Service／完整 EndpointSlice／唯一原 Pod／containerID／imageID／固定参数和 ConfigMap／PVC／PV／新鲜节点／只读探针重新绑定，不接受同名替换。

## 当前验证原件

- `/private/tmp/cs-rfc037-buildkit-native-all-v3.log`：47 pass／0 fail、611 assertions，11 文件；包括真实临时 bbolt／filesystem、HTTP/2 server、handler 和 SDK。
- `/private/tmp/cs-rfc037-buildkit-source-targeted-v1.log`：12 pass／0 fail、50 assertions；真实临时文件、受控 K8s/gRPC，涵盖参数、环境、镜像、配置、claim、CSI、subPath、重叠挂载、节点、探针与数据库替换。
- `/private/tmp/cs-rfc037-native-creation-targeted-v4.log`：3 pass／0 fail、27 assertions，实际 PostgreSQL、实际 owner/journal/锁；之后只将可选夹具 projectId 经正式 schema 固定以修正类型诊断，v5 补验单列。
- `/private/tmp/cs-rfc037-buildkit-native-source-readonly-v1.json`：新来源适配器在原 BuildKit 上实际联验，4 数据库、78 cache metadata、50 条完整历史（48 protected、1 owned、1 unattributed）及 27 个选定物理身份；capture 与 verify 来源一致。原 BuildKit Pod UID `71d63535-b575-47ae-82bd-0608f8a38c5b`、原 containerID 和原探针 UID `86e88863-e21e-4903-899a-ff7b903eaac7`／runtime 保持。
- 上述实际联验通过临时 port-forward 和原探针内 RAM 执行的新版只读 handler；新 `/buildkit/inventory` 尚未作为私有 HTTP 生产入口部署。它证明实际 Linux 文件与适配器绑定，不冒充生产删除接通或实际 Prune/Delete。
- 精确 source lint／结构与源文件类型补验原件在 `/private/tmp/cs-rfc037-native-source-{lint-v3,arch-v3,types-v4}.log`。旧类型 v3 的夹具可选 ID 诊断与旧测试 v1 的错误已有镜像夹具保留，不抹掉旧红。

上一批 `0ffccac530466e477d516d950bfe1db11943a8fe` 已获 [六项确切 SHA CI 成功](https://github.com/wangbinquan/CrewStation/actions/runs/37316107468)并本机部署；回执 `/private/tmp/cs-rfc037-0ffccac53046-native-physical-v8-deployment-receipt.json`。八组件及报告根实际 fsync/readback 已验证，250 项安装迁移匹配，原部署 UID、原项目／卷／数据库／GitLab／Runner 保持。该批不包含本文未提交的新构建来源。

剩余生产接线包括实际构建／迁移／槽／emptyDir／callback 的 work physics、缓存原范围与独占文件/租约/消费者闭合、Registry 原生排他进程回收与 SCM 私有 host 安装、完整 22 方装配和原专用项目的管理员两次确认实际回收。受控锁、成功原生读取、目录注销或 native ACK 均不能关闭这些验收项。

## 创建准入兼容修正与完整门禁

第一份冻结候选完整检查结束于 6106 pass／157 环境 skip／4 fail、264668 断言、1223 文件、2274.88 秒，原件 `/private/tmp/cs-rfc037-native-source-full-v1.log`。其中平台档位测试是真实本批缺陷：原项目专用回调收到 undefined 而拒绝平台资源。先增加两个实际调和器／Kubernetes writer 回归，0 pass／2 fail；随后保留旧 `withProjectAdmission` 的项目专用语义，新增正式 `withCreationAdmission` 保护全部原记录及完整 apply。拒绝全局准入时零 apply。实际档位测试、两个新回归及真实 owner／锁组合 8 pass／0 fail、65 断言，原红日志保留。

其余失败分别为默认本机 PostgreSQL 禁用预备事务、未修改开发结束批处理的五秒超时，以及本机 GitLab 新机器人令牌 push 认证失败，不把首次全量写成通过。原已存在专用 PostgreSQL `cs-rfc037-pg-native-1c243830-10a` 的实际 `max_prepared_transactions=10` 已只读核实；原生 owner／开发结束用例以该正确能力环境补验，修正后的 42 路径候选只运行其一次完整检查，实际终态另留回执。Registry pidfd／排他 authority 和 stale-result qualification 属下一候选，不包含在这 42 路径发布清单中。

完整 v2 自然终态为 6121 pass／156 skip／2 fail、264763 断言、1227 文件、2263.99 秒；静态四层通过，42 路径首尾摘要保持。原件 `/private/tmp/cs-rfc037-native-source-full-v2.log` 与回执 `/private/tmp/cs-rfc037-native-source-full-v2-receipt.json` 保留，不能写成全仓通过。两项失败是未改事件参考面板在异步目录就绪前读取，以及 Session 连接出生退出后注册表 release 尚未结束时关闭数据库产生 CONNECTION_ENDED。原两文件定向 10 pass／0 fail、119 断言，仍不抹掉全量红。Session shutdown 排空修正属下一候选，不混入本批来源／创建准入；正式全仓结论由本批确切 SHA CI 给出。

本次发布清单另含 STATE 文档更新，共 43 路径；门禁完成后只更新这两份交接文档，41 个功能／测试路径内容保持。下一候选的 Registry authority／pidfd／guardian／main、平台输入完整摘要、stale-result qualification 和 kubelet emptyDir 来源均不进入此提交，也不宣称已经安装。
