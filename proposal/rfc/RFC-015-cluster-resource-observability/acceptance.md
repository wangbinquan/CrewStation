# RFC-015 验收记录

日期：2026-09-21。范围为已批准的全集群只读容量、CrewStation 受管 Pod／容器／PVC 用量、平台内置资源以及最近七天趋势；RFC-010 的操作范围保持不变。

## 部署与真实数据

环境：`docker-desktop`，节点 `desktop-control-plane`，Kubernetes `v1.36.1`，节点 UID `1d907504-da49-4ad5-bcf1-05bf3de4139d`。已应用 `0006_resource_observability.sql`、Node／PV 只读及固定用途的 node proxy RBAC、独立监控凭据、Prometheus、只读存储 probe、API／controller／console。

最终控制面 `cs-control-plane:rfc015-20260921-3`（`sha256:e81fe8243ca9b6fbcaea3df2d26b02fed1cc907593decebbcdbd753b168fd6a4`）；console `cs-console:rfc015-20260921-2`（`sha256:8665c3ece33a13621a0fe1462b79b8124ac88a78254818ba7995e6af05ea20af`）。控制面最后一个补丁镜像复用已验证的第二候选，仅覆盖 metricValues.ts，避免重复大层。工作台构建包含同期管理导航输出，已由其任务以 `4d4414a` 独立提交；本轮精确清单不纳入导航文件。

- 节点 1／Ready 1／可调度 1，10 CPU，33,598,459,904 bytes 内存，125,658,222,592 bytes 节点文件系统容量。
- 无临时验收 Pod 时，申请 CPU **9.505**、内存 **33,422,311,424 bytes = 31,874Mi**、临时存储 **56Gi**；CPU 限制 **16.825**、内存限制 **43,014Mi**。独立 `kubectl describe node` 的申请／限制／超配百分比一致。
- 真实节点 CPU、内存、默认接口网络差分、各接口错误、`/dev/vda` 等设备读写／操作速率可读。设备不求和冒充整机物理 I/O，镜像／容器文件系统不叠加到节点容量。原始 Summary 与 cAdvisor 保存于 `/tmp/cs-rfc015-raw-*`；对账对象与 API 结果保存于 `/tmp/cs-rfc015-live-*`。
- 平台 Prometheus、probe 及指标 PVC 经系统组件图归属为平台内置资源；现有项目归属和 Pod 用途继续来自 RFC-010 的业务身份与 Kubernetes UID。

## 卷与容器实机对账

专用资源位于已有验收项目 `cs-rfc010-cluster-qa`，名称 `rfc015-storage-qa`，只修改本轮新建卷。

| 项目 | 实测 |
|---|---|
| Pod UID／资源 UUID | `64d7a601-29f2-4e4f-85de-47aeb2da53ec`／`01a0c1c1-146d-70d7-b4b4-110add568c91` |
| PVC UID／资源 UUID | `0eb0cb9f-c742-46d0-845f-c48053221656`／`01a0c1c1-146d-7177-af5e-d30ec3bb492f` |
| PVC 申请／绑定 | 16Mi／16Mi，standard，RWO，Filesystem |
| 初始目录分配 | 4,096 bytes |
| 写入内容 | 2MiB 实际文件＋同 inode 硬链接＋1GiB 稀疏文件＋外部符号链接 |
| probe 实际值／节点 `du -s -B1` | **2,101,248／2,101,248 bytes**，完全一致 |
| 删除挂载 Pod 后 | mounts 为空，仍采集 **2,101,248 bytes**，未显示假空闲 |
| 容器投影 | writer＝application（5m／16Mi），prepare＝init（1m／8Mi），sidecar＝常驻 sidecar（1m／8Mi）；部署节点正确 |

最终全部 **13 个受管 PVC** 的用量均为 fresh（含 PostgreSQL、registry、buildkit、Prometheus 与工作区卷），证据 `/tmp/cs-rfc015-final-volumes.json`。

probe 停机演练通过临时、专属 nodeSelector 停止本轮新建 DaemonSet，随后自动恢复。API 返回 `volumeUsed.state=error`、`Storage probe address is unavailable or inconsistent`，不带 `value: 0`；证明采集失败不会被当作空卷。现已恢复正常采集。删除 PVC 后，原 UUID 历史仍可查到 2,101,248 bytes；同名重建得到 UID `52a094db-de8a-48be-acc8-447cc6bc0797`／UUID `01a0c1d4-01ae-7175-97de-c91d444f1cb0`，实际用量为 unavailable，不继承旧值。两代测试 PVC 均已清理。

原始证据 `/tmp/cs-rfc015-storage-{baseline,written,unmounted}.json`、`/tmp/cs-rfc015-probe-outage.json`。

## 七天历史

内部 Prometheus **3.13.3 LTS**，采样间隔 15s，真实 flags：`storage.tsdb.retention.time=8d`、`storage.tsdb.retention.size=0B`（不按容量提前截断）。对外查询最多最近 7 天、8 项指标、每项 1,440 桶；小时窗 15s、日窗 60s、七天窗 600s，均值／峰值／覆盖率分别计算，缺失桶保留 null。

- 生产 CPU 可用数据起点 **2026-09-21 10:12:14 Asia/Shanghai**，没有向生产库伪造过去七天样本。
- 指标 PVC `data-prometheus-0` UID **300f495c-c79c-4add-8612-e45b144cb001**。真实滚动重启后，使用同一 PVC，最早源时间仍为 Unix **1789956734**，HTTP 200。TCP readiness 与 Service 端点切换间发生过一次短暂连接拒绝；后续查询已恢复，实时和管理接口保持独立。
- 隔离真实 TSDB 的 3 项回归通过：读取七天前样本／断点与过期 gauge，稳定 UID 归属变更无重复或相加，八天边界清理与重启持久化。测试种子仅写入专用临时目录，未写生产指标卷。CI module 作业必须提供 `prometheus` 能力，不允许永久跳过。
- 生产观测约 **4,522 条序列**，启动约十分钟时 TSDB 实际分配 **1,208KiB**。短期实测不能外推为稳定七天占用；需按实际增长和资源重建频率持续定容。

## 页面与接口

真实 Chrome 152，1280／390／320px × 明／暗 × zh-CN／en-US 共 **12 组**：总览、历史图表、容器详情无整页横向溢出；表格在自身区域滚动；图表方向键选中时间桶并更新读数；控制台无异常。截图和测量 `/tmp/cs-rfc015-history-*.png`、`/tmp/cs-rfc015-visual.json`。部署 E2E 新增 4 项、48 assertions：系统资源／真实历史与三档宽度全部通过。

最终修正实机核对：历史选择项目实际发送 `scope=project&projectId=…`，全局总览维持全集群；节点设备列表仅为 `/dev/vda`、`/dev/vdb`。两项均有先红后绿的回归，记录 `/tmp/cs-rfc015-final-live.json`。

普通用户 `dev-member` 的 capacity、nodes、usage、history/resources 实机均 **403**；现有管理员路径 **200**。内部 exporter 与 Prometheus 的无凭据请求均 **401**，未新增外部入口。

## RO-01…RO-29 对应防护

| 条目 | 证据与边界 |
|---|---|
| 01、02、05 | 上述独立 kubectl 与真实 API 对账；global／managed／system／project 分项，部分采集不输出整体利用率 |
| 03、04 | resourceDemand 单元向量：init／常驻 sidecar／overhead／Pod-level／DRA／resize、未调度、终态、缺失和超配；有效申请遵循 K8s 1.36 helper |
| 06、07 | 上述真实三类容器；临时调试容器、hostNetwork 与缺失指标由模块和渲染用例覆盖，本轮未在业务 Pod 注入调试容器 |
| 08、09、10、12 | 真实 local-path／卸载后用量对账；CSI UID 链、RWX 去重、不同观测取最新与超过 100% 由模块／组件用例覆盖；本机不冒称具备 CSI 卷统计 |
| 11 | 文件系统用例与真实 Linux probe：硬链、稀疏、软链、路径拒绝、目录替换、取消、不可访问；生产 Linux 用 pinned fd、O_NOFOLLOW 固定目录身份 |
| 13、14、15 | 节点真实网络／设备样本；uint64、计数重置、时钟偏差、0 时间差、过期、迟到和默认接口去重向量 |
| 16、17 | UID 错配、拓扑／kubelet 故障、无数据、部分覆盖与旧观测标记；故障不得刷新申请量、容器或设备的源时间 |
| 18、19 | 真实 PostgreSQL：独立作业、租约接管／fencing／迟到回写拒绝、10 分钟快照、410、固定分页、完整范围汇总 |
| 20、21 | 上述普通用户／内部认证／真实 probe 停止恢复；技术包认证及固定路径协议回归 |
| 22、23 | 12 组浏览器与新增部署 E2E；既有 RFC-010 模块／平台组合／工作台回归、操作草稿与日志／事件不退化 |
| 24 | 最终门禁／覆盖率／发布信息见下节 |
| 25、26 | 固定范围／步长／尾桶、真实 TSDB 的断点／过期源时间，UI 均值／峰值／覆盖率／时区和键盘用例 |
| 27、28 | PostgreSQL 历史身份版本／删除标记／八天清理、真实 TSDB 归属变化不混算、生产重启持久化；稳定 UUID 不依赖名称 |
| 29 | 历史后端故障与实时采集解耦；新组件可见；下述磁盘约束明确披露，未把声明容量当物理空间 |

## 物理容量与恢复

本机 Docker 节点在部署前仅约 1.7GiB 空闲。镜像导入期间曾短暂满盘，PostgreSQL 出现 `could not write lock file "postmaster.pid": No space left on device` 并重启；空间回收后完成自动恢复，真实 OIDC 登录与管理员业务读取恢复。未删除或改写数据库文件。

仅清理本轮首个候选镜像、两个 0 副本 ReplicaSet、对应旧 DaemonSet revision，以及精确列出的未共享构建缓存；保留所有部署前的镜像／回退对象和业务 PVC。回收后约 **768MiB** 可用。**10Gi PVC 申请不是新增磁盘，当前节点余量仍不足以承受下一次完整镜像叠加；七天保留配置已启用，但不能保证其他工作负载继续增长时仍有足够物理空间。** 后续共享环境释放空间，最终复核空闲约 **5.6GiB**，不将这部分回收归因于本轮精确清理；应按真实增长重新定容后再增加工作负载。指标起点、覆盖率和空闲量在界面可见，不把这一环境限制隐藏为“已满七天”。

## 最终门禁与发布

最终完整 `bun run check`：**2029 pass／5 skip／0 fail，12863 assertions，343 文件，343.84s**。包含静态四关、真实 PostgreSQL、隔离 Prometheus、真实网关／OIDC／浏览器；5 项跳过为可选第二身份、原生 CLI／显式集群环境用例，不替代上述独立普通用户实测。日志 `/tmp/cs-rfc015-final-check.log`，lcov／junit `/tmp/cs-rfc015-final-gate/`，本任务生产／测试内容哈希 `/tmp/cs-rfc015-final-candidate.json` 与门禁开始时一致。

首轮为 2027 pass／5 skip／0 fail；其后实机发现虚拟挂载和历史项目筛选两项问题，先分别稳定复现，再修正并重新完成上面的最终完整门禁。工作台 production build、迁移锁与管理契约类型检查通过。新增代码防护 **1219／1232 行 = 98.9%**（下限 80%），所有改动生产文件均被用例加载；基线 `4d4414a520f9`。精确 SHA GitHub CI 待发布回填。
