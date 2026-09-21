# RFC-015｜技术设计

> 状态：In Progress · 日期：2026-09-21
> 配套：[提案](./proposal.md) · [计划](./plan.md) · [核对证据](./audit.md)

## 目录

- [1. 现状与落位](#1-现状与落位)
- [2. 数据模型与接口](#2-数据模型与接口)
- [3. 容量与申请计算](#3-容量与申请计算)
- [4. 实时统计](#4-实时统计)
- [5. 卷用量](#5-卷用量)
- [6. 采集部署与权限](#6-采集部署与权限)
- [7. 失败、并发与保留](#7-失败并发与保留)
- [8. 测试与验收](#8-测试与验收)
- [9. 七天历史与指标存储](#9-七天历史与指标存储)

## 1. 现状与落位

源码基线 `0abf8e2dc114af29d98844e12e7ec9ec8aa06d17`。行为断言及具体行号见 [audit.md](./audit.md)。现有 `cluster-management` 是 L6，负责资源与操作投影；指标保持同一归属，不让 observability 同层反向依赖它。

| 位置 | 职责与拟新增内容 |
|---|---|
| `packages/contracts/api/cluster/` | Node、容量、资源需求、带状态的指标、PVC 用量与内部目录测量协议；平台 API Schema |
| `packages/k8s/` | Node／PV ResourceRef、限定为节点 summary／cAdvisor 的只读客户端方法、Quantity 与受限指标文本解析等无业务语义能力 |
| `modules/cluster-management/domain/` | 有效申请、范围聚合、速率、覆盖率与 UID 关联纯规则 |
| `modules/cluster-management/ports/` | 节点指标读取、目录测量、当前指标仓储和时序查询端口 |
| `modules/cluster-management/adapters/` | kubelet／本地卷来源、PostgreSQL 当前样本与来源状态、Prometheus 固定查询模板 |
| `modules/cluster-management/application/`、`workers/` | 有界采集、聚合与查询，独立于操作 worker 和完整资源扫描 |
| `modules/platform/` | 现有组合根注入采集配置、固定存储根与认证信息，不放计算或 SQL |
| `packages/filesystem-metrics/` | 技术性目录占用测量与有界服务：只认识根目录、相对路径、opaque key 与数值，不认识项目、PVC 或平台数据库 |
| `apps/cs-storage-probe/` | 独立进程，只读配置并装配上面的服务；业务归属判断仍在 cluster-management |
| `apps/console/src/features/cluster/` | 容量面板、节点表、Pod 容器资源表、PVC 表、七天趋势查询、单位格式化与双语状态 |
| `apps/console/src/shared/ui/` | 复用或新增无领域语义的可访问时序图组件，缺口／均值／峰值和键盘读取 |
| `deploy/` | probe DaemonSet、Prometheus StatefulSet／配置／持久卷、目录白名单、认证 Secret 引用、内网访问策略、安装及升级接线 |

不新增领域模块，无需调整现有 layer 或 ADR 规则。当前模块 22 个生产 TS 文件、725 行；实时观测及历史查询合计预留不超过 18 个新生产文件，维持 40／6000 上限。技术包和新应用加入 workspace 后更新 `bun.lock`。函数／文件／目录尺寸仍受现有门禁约束；需要超出预算时先按结构规则调整设计，不能靠深目录规避。

已有容器资源 JSON 展示在本 RFC 改为结构化表格；本 RFC 不改项目设置和开发工作台的其他结构。没有暂存 facade、跨模块内部 import 或跨 schema join。

## 2. 数据模型与接口

保留原 `ClusterResource`、快照与管理接口的语义，新字段可选或有明确兼容默认值。新增独立 metrics 查询，不让旧目录快照持续更新可变指标。

### 2.1 共同形状

- `MetricValue`：`value`、`unit`、`state`、`observedAt`、`windowStart/End`、`source`、`reasonCode`／`reason`；状态为 fresh、warming-up、stale、unavailable、unsupported、error。没有数值的状态不得回 0。stale 可携带最后成功值及原时间。
- `Coverage`：expected／observed／fresh／missing、来源错误、最早／最晚时间、complete。总览完整性按指标维度计算，CPU 成功不替磁盘成功。
- Kubernetes 数量保留原始字符串；计算使用精确基单位，较大整数跨 JSON 边界用十进制字符串，避免字节或累计纳秒溢出 JS 安全整数。展示层按量纲格式化。
- 节点、PVC、Pod 以 Kubernetes UID 关联；前端对象选择沿用 RFC-013 的平台 UUIDv7 资源 ID，名称仅用于展示／搜索。容器关联为 Pod UID＋容器名＋本次启动身份；外部设备、接口名不伪造为平台资源 ID。

### 2.2 公共查询

均沿用集群管理员守卫；请求受共享 Zod Schema 约束。

| 接口 | 响应／约束 |
|---|---|
| `GET /v1/admin/cluster/capacity` | 节点数量、全局容量、已调度／未调度申请、全局实时指标、CrewStation 分项和逐维度覆盖率；明确 `scope=cluster` |
| `GET /v1/admin/cluster/nodes` | 有界游标节点页，节点 UUID、UID、名称、角色／版本／压力、容量与指标；以同一 observationId 固定分页 |
| `GET /v1/admin/cluster/nodes/:nodeId` | 单节点详情、设备／接口指标、受管 Pod 引用及来源状态，无节点写动作 |
| `GET /v1/admin/cluster/usage` | 批量查询最多 100 个资源 UUID，返回 Pod／容器／PVC 实时用量，支持现有项目／系统筛选的完整汇总；不得把一页行量当总量 |
| `GET /v1/admin/cluster/history` | 固定 scope、节点／资源 UUID、可选容器、最多 8 个指标名、from／to；最多七天，服务端确定 step 与查询模板，返回均值／峰值／覆盖率和明确缺口 |
| `GET /v1/admin/cluster/history/resources` | 七天内出现过的受管资源身份目录，分页／种类／项目／名称筛选；已删除标记，无写动作 |
| 既有 resource detail | 增补结构化容器种类、资源需求、QoS、Pod 级资源、PVC 申请／绑定及挂载信息；原字段兼容 |

新 metrics 接口返回 `observationId`、inventorySnapshotId 和各来源时间。列表用量由一批结果回填，避免逐 Pod HTTP；Pod／PVC 的 UID 与目录快照不匹配时不回填。过期 observation 游标返回 410，采用现有页面恢复方式。

`cluster_management` 新迁移存储最新观测、每个计数器的前样本、来源状态及历史资源身份索引；沿用 `jsonDocument`，不修改旧迁移。用于速率和固定分页的观测仅保留最近 10 分钟；历史值进入独立 Prometheus，不向业务 PostgreSQL 追加七天高频 JSON 快照。目录扫描结果独立保存，不每 15 秒复制一份全量目录。身份索引的最小元数据保留至少八天，覆盖七天查询和回收边界。

## 3. 容量与申请计算

Node `.status.capacity` 与 `.status.allocatable` 分别作为总量和可分配量。总节点数包含控制面和不可调度节点，另有 Ready、可调度分项；不会因为 cordon 而凭空丢失机器的物理容量。

全局申请来自全集群分页 Pod 读取；只读取计算需要的 Node／Pod 形状，非 CrewStation 对象不登记到可操作目录。归属分项复用平台 UID 解析，归属缺失给单独计数。

每一资源键按 Kubernetes v1.36 的有效资源算法实现并列明测试向量：普通容器求和、串行 init 峰值、常驻 sidecar 与各阶段重叠、Pod overhead、Pod 级资源覆盖、原地 resize 中 spec／allocated／actual 的处理。以 [上游 `PodRequests` 实现](https://github.com/kubernetes/kubernetes/blob/v1.36.1/staging/src/k8s.io/component-helpers/resource/helpers.go) 核对，不使用“把所有 containers 与 initContainers 相加”的近似值。临时调试容器不捏造资源声明；未设置限制保留其无限制语义。

已调度且未终态 Pod 的有效申请计入对应 Node；未调度 Pending 的需求独立汇总，Succeeded／Failed 不计当前预留。同名新 UID 替换后不叠加旧对象，分页及跨来源 UID 去重。

CPU／内存已用比例分别以节点 capacity 为分母，申请比例以 allocatable 为分母；未申请量可能为负。没有容量或容量为 0 时不给百分比。CPU 使用以核表示，内存主数值采用 workingSetBytes，详情可给 usageBytes／availableBytes，标签不能混用。

扩展资源动态展示实际键；无实时设备指标只显示容量与申请，标明设备利用率来源缺失。当前没有 GPU 的集群不产生虚构 GPU 卡片。

## 4. 实时统计

官方 [Node metrics](https://kubernetes.io/docs/reference/instrumentation/node-metrics/) 说明 Summary 提供节点、Pod、容器和卷信息；[Metrics API](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/) 只提供基础 CPU／内存。因此单装 metrics-server 不能覆盖本次存储和网络要求。

后台每 15 秒通过 API Server 查询各 Node 的 `/stats/summary`，需要磁盘 I/O 时读取 `/metrics/cadvisor` 的固定指标白名单。客户端方法只接受已发现的节点名，不开放任意 URL／路径代理；响应有尺寸、超时和解析限制。节点读取并发初值 4，单次期限 10 秒；完整一轮超时按部分来源处理，不拖延到下一轮堆积。这些都是待验证默认值。

| 数值 | 来源与处理 |
|---|---|
| CPU | 两个 `usageCoreNanoSeconds` 样本差／源时间差，转核；首次样本等待；若采用 usageNanoCores 必须明确其来源窗口，不与差分值混算 |
| 内存 | Summary 节点／Pod／容器的 workingSetBytes 等 gauge，保留各自 time |
| 临时存储 | Pod 的 ephemeral-storage；容器 rootfs 与 logs 分项，不把节点整个文件系统容量作为容器实际已用 |
| 节点磁盘 | node.fs 与 runtime.imageFs／containerFs 分开展示；capacity、used、available 均取原字段，available 不用 capacity-used 伪造 |
| 网络 | 同一节点 UID、启动时间、接口名的 rxBytes／txBytes／error 累计值做差分；默认用 Summary 默认接口，可配置多个明确的对外接口 |
| 磁盘 I/O | cAdvisor 根 cgroup 的 `container_fs_reads_bytes_total`、`container_fs_writes_bytes_total`、read／write operation counters；按原设备分项 |

网络默认接口与 `interfaces[]` 的同名记录只取一次；不把所有隧道／veth／loopback 一起相加。Pod 使用自己 network 样本，不向共享网络命名空间中的每个容器复制；hostNetwork Pod 的网络统计不归入受管 Pod 网络合计，给共享节点网络说明。

I/O 依据 [cAdvisor 指标定义](https://github.com/google/cadvisor/blob/master/docs/storage/prometheus.md) 做白名单解析，不能把同设备不同容器、整盘与分区、device-mapper 与底层设备全部相加。根设备有可验证映射时提供其读写速率；无法确定设备去重关系时只提供设备分项和原因，不声称精确全机 I/O 合计。网络无链路速率数据时不给“带宽使用率”。

所有 rate 只接受同一实例、严格递增时间且计数非递减的两个样本；重启、样本过旧、计数回退、缺字段、乱序、间隔为 0 都返回 warming-up／stale 等状态。不得 `max(0, delta)` 掩盖重置。采集到迟到的旧样本不能覆盖最新结果。

全局实际量仅对同一周期内、处于允许时间偏差的成功样本聚合；建议偏差上限 30 秒，需用例固定。部分覆盖显示“已观测合计 N／M 节点”；最后成功值可单列，不能与本轮新值混成“实时全量”。

## 5. 卷用量

### 5.1 声明与优先来源

PVC `.spec.resources.requests.storage` 是申请，`.status.capacity.storage` 是已绑定声明容量；PV capacity 用于对账而不是实际使用。配额 used 与实际磁盘 bytes 分开。

优先使用 Summary `volume[].pvcRef` 或 kubelet 提供的卷使用统计。pvcRef 没有 UID，因此还必须通过当前 Pod UID、挂载名、Pod PVC 引用、当前 PVC UID 及 PV claimRef 核对。共享 RWX 卷按 PVC UID 选择新鲜有效观测，不按挂载次数相加；值冲突展示来源与时间，不取任意最大值冒充一致。

卷 usedBytes 与底层文件系统 capacity／available 并非必然同一统计对象，遵守 [Summary `FsStats` 定义](https://kubernetes.io/docs/reference/kubelet-api/stats.v1alpha1/)。本地目录不能把底层整盘容量当 PVC 硬上限。

### 5.2 local-path 补充采集

实机 `standard`／`hostpath` 均为 rancher.io/local-path，12 个 PVC 没有 PVC 统计，卷根为 `/var/local-path-provisioner/`，见 audit。对此形态交付可用的目录计量，不能以“存储驱动不支持”为由留下全部空值。

`cs-storage-probe` 按节点 DaemonSet 部署，只读挂载管理员声明的卷根（本机为上述路径）。controller 使用 live PVC UID／PV claimRef UID／nodeAffinity 验证目标属于受管范围，向对应 probe 发送有界目标数组：opaque key、根标识、相对目录；返回 allocatedBytes、测量时间、耗时和逐项错误。业务关联只存在 controller 中。

技术库测量实际分配块数（与 `du -B1 -s -x -P` 口径一致），不是 apparent size；只读目录项和文件元数据，不读取文件内容，不返回目录文件清单。根／相对路径与 realpath 均校验，不跟随软链接、不跨文件系统，扫描前后确认目录身份。重建或删除的路径不回填给新 UID。硬链接在一次目录测量中不重复计数，稀疏文件有专门用例。

每节点并发初值 1，60 秒后台轮询；单卷扫描有超时、取消及队列合并。大卷未能按期完成时保留原时间并明确 stale，不阻断其他指标。未挂载但仍存在的受管本地卷同样计量。非白名单路径、未支持驱动、原始块卷、无法访问目录各给原因，不偷偷改用进入业务 Pod 执行命令。

PVC 使用／声明容量比例可大于 100%，标记“非硬配额”。卷申请之和可以超过 node.fs 容量，这是两个不同层次，不能据此伪造磁盘扩容或可用空间。

## 6. 采集部署与权限

新增内容须与 RFC 一并呈作者确认，获批后才应用到本机：

- controller 增加 Node、PersistentVolume 的 get／list／watch 与 `nodes/proxy` 的 get，以访问 kubelet 指标。**API Server 的 `nodes/proxy` RBAC 不能把授权限定到 stats 两个子路径**；实现只调用这两个固定指标入口，部署文档如实写明权限边界，不将其描述成 Kubernetes 自带的“仅统计”授权。
- probe 不挂 Kubernetes ServiceAccount token、不连接平台数据库；配置固定只读卷根，不使用特权模式、host PID 或业务容器 exec。不挂整个宿主机根目录。
- probe 只在内部端口提供有界测量协议，用独立 Secret 的认证值校验 controller 请求，认证值不得进入日志／观测数据；网络策略仅允许 controller 访问，不建立 Ingress。API 不允许浏览器提交目录测量目标。
- 读取权限受限的 PostgreSQL 等卷目录时，probe 使用 UID 0，drop ALL 后仅加只读目录遍历需要的 DAC_READ_SEARCH；全部业务卷以 readOnly 挂载，不授 SYS_ADMIN／写入能力。不把“非特权容器”误写成“无需任何读取权限”；初始化、就绪、请求鉴权、非法路径和真实受限目录均有回归。
- probe 在受管组件目录登记为平台基础设施，本功能自身的 Pod／CPU／内存也会进入资源计数和用量。节点控制面 taint 的容忍仅用于读本地卷，不改变业务调度。
- 内部 Prometheus 使用固定版本／摘要的镜像、独立 StatefulSet 和持久卷；只抓取经过认证的 controller 指标导出入口。平台 API 使用独立内部查询凭据访问，浏览器不直连 Prometheus，不开放外部 Ingress／任意 PromQL、管理 API 或 remote-write 接收入口。
- controller 的 `/internal/cluster/metrics` 由 L6 模块构造，组合根挂到现有 8082 HTTP 服务；固定 Service 单 scrape 目标，全部 controller 副本从同一持久化最新投影导出，避免每副本重复计数。独立只读凭据限于该内部入口，不复用管理员登录态。

正式集群的白名单存储根来自安装配置，未配置则禁用此后备来源并说明；不能假设所有 CSI 后端都在本机路径。CSI 有原生卷指标时优先用原生数据。本机路径能力是本次必须验收的交付项。

## 7. 失败、并发与保留

- metrics、PVC 扫描、inventory、operations 四类工作独立分配队列容量。共享 PostgreSQL 租约保证每来源只一个有效采集者；fencing 与采样时间共同阻断旧 owner 迟到回写。
- Node／Pod／PVC 列表分页沿用完整批次语义，410 后重读；拓扑失败不从缓存造出完整容量。
- metrics 错误不把已健康的资源目录标错，也不影响原来的执行能力判定；观测值不能参与资源删除授权或代替原有 live UID 校验。
- 建议 CPU／内存／网络超过 45 秒标 stale，卷超过 180 秒标 stale；从源 observedAt 判定，不从“前端刚收到响应”判定。时间偏差显式提示。
- 当前值、前样本、10 分钟分页观测和卷结果均有过期清理与容量上限；七天历史另按 §9 保留。多浏览器不会增加 Kubernetes／磁盘扫描次数。进程重启第一轮速率显示采集中，已有历史保持。
- 403、404、超时、指标缺失、畸形数量、同名替换、节点下线、卷被卸载／删除独立表达。对无法获得物理存储池容量或设备利用率的来源，不伪造百分比。

## 8. 测试与验收

按 `docs/engineering/testing.md` 分层：Quantity、Pod 资源与聚合／速率就近单测；适配器与数据库查询在模块 tests；工作台整页 journey 在 console tests；真实节点／卷／浏览器在 tests/e2e。

必须覆盖：DecimalSI／BinarySI／指数／小数与大数；普通／init／sidecar／overhead／Pod-level／resize；Pending、终态和未设置限制；共享卷／重复接口／分区重复；重置与迟到样本；跨 UID 不回填；每种来源失败与部分覆盖；目录软链、硬链、稀疏文件、路径替换和扫描取消；管理员／普通用户；双语窄屏与键盘。

真实验收使用独立项目与专用 PVC，写入已知数据量前后测量，与独立文件系统工具和 Kubernetes 声明对账；只清理本验收创建的文件与对象。保留请求 HTTP 状态、持续时间、目标 UID、采集时间／窗口、来源状态和可见错误。最终本地完整门禁与精确 SHA CI 是实现完成条件，不能用草图、夹具或 API 返回成功代替实际用量证据。

七天范围、清理边界、PromQL 模板、超范围／高点数拒绝、历史身份变更和同名 UID 隔离需有专门回归；在隔离的真实 Prometheus 用专用历史样本验证，不往生产实例补造七天数据。实机验证重启保卷、已采集历史仍在、缺口可见，并如实记录新装数据起点。

## 9. 七天历史与指标存储

### 9.1 采集与持久化

作者已经明确选择最近七天。采用内部 Prometheus TSDB 保存历史；当前视图仍由原观测投影服务，以免历史存储暂时不可用时连容量与资源目录也消失。

controller 导出当前有效容量／申请／实际数值、源时间和状态，Prometheus 每 15 秒 scrape；卷值源时间按实际扫描结果保持。过期数值不继续导出为 fresh，仅导出缺失／状态和最后成功时间。历史查询必须按当时源时间与 freshness 门槛过滤，不能把反复抓取同一个过期 gauge 当成连续成功采样。

指标名和标签为有限清单：实例层次（cluster／node／pod／container／pvc）、稳定平台资源 ID／K8s UID、projectId、受管 scope，以及明确的容器／设备／接口维度。项目／资源显示名、任意 Kubernetes labels、错误正文和路径不进入高基数标签；这些从历史身份索引读取。节点、Pod、容器、项目、全局分别有明确指标族，禁止跨层相加。

七天原始观测不在应用中降采样丢弃；图表粒度只影响查询。为保证任意最近七天范围不被块边界截短，部署保留时间建议 8d，产品 API 始终限定最近 7d；多出一天是内部回收余量，不扩张用户的历史查询范围。采用独立 PVC 和 WAL，进程／Pod 重建不删除卷。

### 9.2 历史查询与图表

平台用固定模板调用 Prometheus [range query API](https://prometheus.io/docs/prometheus/latest/querying/api/)，只接受有类型的资源／指标／范围，不能接收用户原始 PromQL。查询可取消、限时、限 series、限点数；结果必须验证 matrix 形状、时间、有限数值与预期标签。

建议默认：1h 为 15 秒、6h 为 1 分钟、24h 为 1 分钟、7d 为 10 分钟；自定义范围每条线最多 1440 个桶、一次最多 8 个指标。范围按桶划分，查询桶结束点，处理 query_range 两端包含的边界，24h 不多生成第 1441 个点。返回真实 step、窗口均值／最大值及有效样本覆盖率。采样缺口即使落在同一显示桶，也保留不完整标记；前端不在缺口之间连线。统计比例按同时间窗口的分子／分母计算，不能拿今日容量作七天前的分母。

历史身份索引包含资源 UUID、K8s UID、种类、项目归属、名称、首次／末次出现和已删除状态；名称／归属变化保留有效时间区间。资源消失后仍能从“包含已结束资源”找到七天内历史，项目归属与 UID 不按当前同名对象反推。容器重启标记新启动时间，速率不跨启动实例拼接。

新装图表只显示真正存在的时间段；返回 `availableFrom`、requestedRange 和覆盖率，避免把“配置保留七天”说成“已有七天生产数据”。历史源暂时不可用时，历史图显示错误与重试，实时值和管理操作继续可用。

### 9.3 保留量与容量边界

根据 [Prometheus 存储文档](https://prometheus.io/docs/prometheus/latest/storage/) 按采样速率、保留时间估算数据块，再单列 WAL／head／索引与压缩工作空间余量，不把经验估算当实测容量。初始本机 PVC 申请建议 10Gi，可配置；大集群依据实际 series、scrape 样本量和一日增长重新定容，并提供当前 series／样本速率／存储占用与数据起点。

不设置一个会静默提前裁短七天的更小 size-retention；如正式环境同时配置 size 限制，必须验证足以保留目标窗口，无法满足时显式报告历史不足。服务停止或磁盘不足不得通过覆盖最旧数据而继续声称完整七天。

本次调研时节点实际可用约 1.15GiB，部署前必须重新核查并给新指标卷留足物理容量；local-path 的 10Gi PVC 声明不等于已经扩容。不能为装指标服务删除现有业务卷或重置数据库。容量不足时先完成代码／测试，具体容量处置必须基于当时盘点和授权。

单实例本地 TSDB 不等于高可用历史存储；接口通过端口支持已有 Prometheus 兼容后端，部署配置要声明其实际可用性。该观测组件故障不会中止平台任务／管理流程，不能把本机部署验收外推成大集群性能或 HA 验收。

## 实施补充（2026-09-21）

有效申请跟随 Kubernetes 1.36 的资源 helper，包括 DRA 节点可分配声明与 resize 的已生效／已分配量。文件系统 probe 在生产 Linux 使用固定目录 fd 与 O_NOFOLLOW，不通过解析后的路径重新打开目标；非 Linux 仅用于本机测试的目录身份核对。cAdvisor 中 tmpfs／overlay 只有占位操作计数，不作为物理磁盘导出；仅保留 /dev 下带块设备字节计数的根 cgroup 分项，仍不将整盘／分区相加。

采集拓扑失败保留上一份事实及原始时间，禁止借新 observation ID 把请求量或嵌套容器／设备数据刷新为新鲜值。历史资源 UUID 固定，归属变更可能产生不同 project_id 序列，固定模板先按最新源时间选一份，再去掉变化标签分桶，避免双计。历史页只保留真正作用于该页的项目筛选，选择项目直接切到项目曲线；资源目录筛选仍用于原有列表。
