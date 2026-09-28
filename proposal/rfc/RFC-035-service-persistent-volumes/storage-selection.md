# RFC-035｜对象存储选型与部署设计

> 2026-09-28 · 已随 RFC 修订稿批准的选型合同；本机单节点仅 dev-only，实测与部署状态见 implementation.md。

## 1. 具体选择

**本 RFC 推荐 Garage v2.4.1 为首个受支持、自托管的对象存储后端。** CS 保持 S3 数据接口，首期验收集中于 Garage，不承诺所有“S3 兼容”产品即插即用。版本来源为[官方镜像仓库的标签记录](https://github.com/deuxfleurs-org/garage/tags)：v2.4.1 于 2026-09-08 发布，为 2.4 系列修复 Kubernetes／Consul discovery 启动问题的补丁版本。实施时必须验证镜像 ARM64 支持、固定 OCI digest 并记录源版本；本次未拉镜像，不虚构 digest。

选择依据是当前 AW 的不可变插件包、附件与任务产物，以及 CS 的单机部署规模。**不是最高吞吐率选型**：Garage 官方明确不以极限性能、纠删码和 POSIX 为目标。它提供独立二进制、以副本保存对象，适合这里的对象层；git／SQLite 类文件系统负载继续留在任务 PVC。[官方目标](https://garagehq.deuxfleurs.fr/documentation/design/goals/)

许可证记录为 AGPLv3；按原版独立组件部署，保留许可证及对应源码获取信息，不修改 Garage，不在本稿推导 CS 的许可结论。[官方项目说明](https://github.com/deuxfleurs-org/garage)

## 2. 候选对照

| 候选 | 核实的事实 | 本次判断 |
|---|---|---|
| **Garage** | 面向中小规模自托管；支持基本 S3 读写；非全量 AWS S3 功能 | 与不可变对象＋CS PG 元数据契约匹配，选为默认 |
| SeaweedFS | Apache-2.0；覆盖 S3、文件系统等，可用一个二进制启动；架构有 master／volume／filer 等角色 | 可行备选；本次不需要文件系统统一能力，暂不承担其角色和元数据部署选项的运维面 |
| Ceph RGW | 有独立 Monitor／Manager／OSD／RGW 组件及相应资源规划 | 若已有 Ceph，可另行认证接入；仅为当前单节点 AW 文件需求新建，运维代价过大 |
| MinIO 开源版 | 官方仓库已归档，README 明示不再维护 | 不作为新安装默认；不以历史知名度覆盖维护风险 |
| RustFS | 官方于 2026-09-16 宣布 1.0.0 GA，Apache-2.0 | 保留跟踪；GA 时间短是本次暂缓默认采用的判断，不声称它仍是 beta |
| AWS S3 等托管服务 | 可用同一 S3 适配边界另行接入 | 有托管需求时另定地区、费用和网络；不作为本机可复现安装的强制云依赖 |

事实来源：[Garage 兼容表](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)、[SeaweedFS 项目](https://github.com/seaweedfs/seaweedfs)、[SeaweedFS 组件](https://github.com/seaweedfs/seaweedfs/wiki/Components)、[Ceph 硬件规划](https://docs.ceph.com/en/latest/start/hardware-recommendations/)、[MinIO 仓库](https://github.com/minio/minio)、[RustFS GA 公告](https://rustfs.com/blog/announcing-rustfs-1-0-0-ga/)。判断是本项目的取舍，没有引用不同硬件上的厂商吞吐数字作为排名。

## 3. S3 兼容边界落实到合同

Garage 支持本稿所需 Put/Get/Head/Delete、ListObjectsV2、SigV4 和 path-style，但官方兼容表列明：不支持 bucket versioning、AWS bucket policy／ACL、Object Lock。其权限模型是 key 与 bucket 的授权。[官方兼容表](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)

因此 CS 明确采用以下实现合同，而不是要求 Garage 模拟缺失功能：

- 对象版本由 CS PG＋唯一 key 表达；backendVersionId 可空，不依赖 S3 VersionId、Object Lock 或条件写实现业务锁。
- 每个上传 attempt 分配全新 key，验证完成后该 key 即为不可变对象身份，不再次覆盖、不必须 rename/copy。ready 发布在 PG CAS 中完成；过期写者只能写它自己的未发布 key。
- 空间隔离、引用和删除权限由 CS 检查，访问凭据只给平台数据适配器。固定 `crewstation-objects` 私有 bucket 的读写 key 与 Garage 管理 token 分离；业务和归档 Pod 不持有原始 S3 key。
- 用平台元数据分页枚举业务对象；S3 List 只做后端盘点，不当成业务事务提交证明。校验按流与读回 SHA-256，不依赖 ETag 或供应商 checksum 扩展。
- 配置 `consistency_mode="consistent"`；不为提高可用性改为 degraded／dangerous。不可变 key＋PG 协调减少对对象覆盖一致性的依赖。

后端接入测试必须逐项验证本合同的实际 SDK 请求，尤其签名、分块传输、Range、空对象和错误映射；不能仅凭兼容表就宣告实现通过。

## 4. 本机部署方案：独立系统基础设施

本日只读盘点：`docker-desktop` 只有 `desktop-control-plane`，ARM64，allocatable CPU 10、内存 32810996 Ki；`standard` 与 `hostpath` 均为 local-path／Delete。系统 StatefulSet 当前为 postgres 和 prometheus，尚无 Garage。allocatable 不是空闲资源；实施前还须检查实际占用和宿主磁盘空间。

| 项 | 设计值（不是已部署事实） |
|---|---|
| 归属 | `crewstation-system` 系统存储组件，纳入公共 infra 与系统资源图 |
| 工作负载 | `garage` StatefulSet，单副本；镜像 `dxflrs/garage:v2.4.1` 验证后固定 digest；不使用 latest |
| 元数据 | Garage 自己的 SQLite 后端；独立 `garage-meta` RWO PVC，初始 5 GiB |
| 对象数据 | `garage-data` RWO PVC，初始 100 GiB；不与业务任务卷共享 |
| 配置 | replication_factor=1，consistent，metadata_fsync=true，data_fsync=true；固定路径及节点身份 |
| 资源建议 | request 500m CPU／1 GiB；limit 2 CPU／4 GiB；需混合负载验证后定稿 |
| 访问 | ClusterIP S3 3900；RPC 3901、管理／监控 3903 仅受控平台访问；不开放网站端口、公网入口或匿名 bucket |
| 客户端 | CS 通过内网 S3 适配器访问；业务服务只访问 CS 对象 API |
| 卷寿命 | 系统长期保留；StatefulSet 更新、CS 重装、项目／任务结束不能触发删除 |

**AW 服务零 PVC；Garage 有自己的基础设施 PVC。** 这和 PostgreSQL 需要自己的数据盘一样，不是重新给业务服务增加挂卷。任务终结只删除该任务自己的 `/work` 卷，不删除承载多个服务产物的 Garage 卷。

本机使用仓库已有 kubectl 安装方式，不新增 Helm／Operator 运行依赖；参考官方配置编写受控清单和幂等初始化步骤。第一次安装生成 RPC secret、管理 token、限定 bucket 的数据 key；重复安装复用原值与 bucket，不重置身份。只有初始化／运维路径可操作管理端点，CS 运行时不需要长期持有全局管理 token。原生 NetworkPolicy 明确允许方，不能依赖平台默认出网策略替代入站隔离。[官方 Kubernetes 指南](https://garagehq.deuxfleurs.fr/documentation/cookbook/kubernetes/)

基础设施清单由 deploy 安装器唯一声明，公共 infra 登记安装归属、UID 观测与 retain 防护；runtime 调和器不另建同名 StatefulSet。本机 local-path StorageClass 虽然 Delete，平台不发自动卷删除，管理员显式销毁另走确认。K8s 直接越权删除和重置 Docker 集群不属于这层 retain 的容灾保证。系统图必须能看到 Garage→两个 PVC→对应 PV；业务图显示服务→对象空间→Garage 后端，不画服务挂载线。

初始空间配额改为 20 GiB，后端整体可分配逻辑预算先设 60 GiB，避免在 100 GiB 数据盘上给每个服务都默许 100 GiB。实际容量还需扣除元数据、临时上传、回收滞后和其他系统开销。local-path 申请值不是硬容量隔离，必须同时观测真实磁盘可用空间；低水位拒绝新上传，但保留读取和清理。初始数字已随 RFC 批准，实际环境仍须检查磁盘和观测。

## 5. 数据可靠性与生产形态

**单节点仅用于本机开发和验收，不承诺生产容灾。** 官方明确 replication_factor=1 无冗余，仅适合测试；三副本＋consistent 可在一个故障域失效时继续读写。单节点到三副本不采用直接改 replication_factor 原地升级；官方将该变更列为不正式支持的危险操作，设计采用新建三副本集群再迁移。[配置与复制说明](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/)

生产自托管仍选 Garage，但至少三个独立主机／磁盘故障域，replication_factor=3，不能在一台电脑启动三个 Pod 冒充容灾；更大规模需依据容量和故障预算设计节点数。约三份原始对象容量另加运行余量，不能按纠删码估算。写成功采用 quorum，不保证返回时第三副本已经追平；进入自动删工作卷之前检查所选后端健康与设计耐久等级。

开启 metadata_fsync/data_fsync、使用 Garage 支持的元数据快照，降低非正常停机风险；它们不等于断电零丢失。元数据引擎、快照和复制参数在版本锁定后实测，不承诺未测的 RPO=0。Garage 不使用 CS PostgreSQL 保存自身元数据，两者都必须有恢复路径。[配置说明](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/)、[修复与校验](https://garagehq.deuxfleurs.fr/documentation/operations/durability-repairs/)

备份首期采用运维文档＋显式执行流程：按持久 backup epoch 阻止对象新写、引用变更、收据发布、GC 和新的最终删卷许可，排空在途发布／删除；固定 CS PG 元数据快照；通过 S3 导出该快照引用的不可变对象及摘要清单到独立故障域，再恢复写入。凭据／密钥按独立加密备份保管。恢复到空后端、导入元数据后逐一核对引用与摘要再开放业务。仅拷 Garage 的 data 目录、仅备份 PG 或在同 PVC 留快照，都不构成完整离线备份。这份恢复集只覆盖 CS 已归档数据；完整 AW 还须对齐其业务 PG，恢复活动任务还需任务卷与原生会话快照。本 RFC 不承诺运行中 AW 的完整灾难恢复，见 [设计自审 §12](./design-audit.md#12-一致备份与恢复)。

建议运维目标为每日一份、保留 7 日＋4 个周点；这是已批准的运维目标，不是本 RFC 悄悄新增已运行的备份调度器，也不是自动删任务卷必须等次日备份。实际数据损失窗口受最近成功备份限制；本机在重置集群前必须先导出并验证。测试可用临时独立目的地演练，正式备份目的地仍需部署时配置，不默认占用用户另一目录。

升级前保留可恢复备份、读取官方版本说明并在隔离数据上验证；不因镜像可回滚就断言元数据格式可降级。迁移外部 S3／新 Garage 时：冻结写入和 GC→复制不可变对象→完整摘要校验→更新空间后端修订与对象定位→保留旧端回退期；只换 endpoint 不算数据迁移。双端分歧时停止写，不能使用另一空 bucket 顶替。

## 6. 吞吐与运维验收

本机基线测量 4 KiB、1 MiB、64 MiB、1 GiB 对象，并发 1／4，另测 10000 小文件归档；分别记录直接后端和经 CS 代理的吞吐、P95、CPU／RSS、校验读回流量以及对普通 API 延迟的影响。先以内存有界、校验正确、无丢失、无无故超时为通过门槛；没有测量结果前不承诺 MB/s 或“最高性能”。

代理上传再读回校验会增加网络／磁盘读量；它是本期明确代价。需要更高吞吐时先依据上述结果决定独立传输进程或短期精确对象授权，不在本设计跳过验证来优化数字。备份、scrub 和积压清理须限速，避免抢占活跃任务 I/O。

生产运维需监控可用节点／副本、请求错误和延迟、真实磁盘余量、上传预留与垃圾积压、归档阻塞时间、最近备份／恢复演练结果。需要故障练习：进程退出／重启、容量不足、错误凭据、备份恢复，以及生产三节点中的单节点失效。单机测试不能替代最后一项。

本稿更新了 proposal D1；上传物理尝试、后端位置／凭据分离、配额和安装所有权按 [第二轮补充](./design-audit.md) 执行。批准对象是「Garage 默认后端＋可选本机系统组件＋以上可靠性边界」，不是仅批准一个协议名称。作者已批准整份修订稿开始实施，实际安装、测试和上线结果另行记录。
