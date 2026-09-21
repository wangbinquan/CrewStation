# RFC-015｜源码与实机核对

> 日期：2026-09-21；源码基线 `0abf8e2dc114af29d98844e12e7ec9ec8aa06d17`。
> 本文件为只读调研证据，不是新增功能验收记录。

## 仓库现状

| 事实 | 证据 |
|---|---|
| RFC-010 限定 namespace 级受管清单，节点只作为调度信息；未接 metrics 时不展示伪实时 | `proposal/rfc/RFC-010-cluster-management/design.md:59`、`:106` |
| 已采集普通／init 容器 requests、limits、镜像与状态，但未区分常驻 sidecar／临时容器，无用量 | `modules/cluster-management/domain/resourceStatus.ts:5` |
| Pod nodeName 已投影 | `modules/cluster-management/domain/resourceStatus.ts:25` |
| PVC 只有 requested／capacity JSON，没有 actual usedBytes | `modules/cluster-management/domain/resourceStatus.ts:30` |
| 容器详情直接展示 requests／limits JSON | `apps/console/src/features/cluster/components/ClusterDetail.tsx:24` |
| 首屏是工作负载／Pod／Service／PVC／异常数量，没有节点和容量总览 | `apps/console/src/features/cluster/pages/ClusterPage.tsx:30` |
| 库存 30 秒后台队列刷新，和操作 worker 独立 | `modules/cluster-management/wiring.ts:21` |
| 当前 ClusterRole 没有 Node／PV 或 nodes/proxy 读取项 | `deploy/k8s/platform/00-rbac.yaml:11` |
| 本机使用节点容器内 local-path 目录，非 HA 生产存储参考 | `deploy/README.md:200` |

调研时 `main == origin/main`。已有未提交修改涉及下拉样式、对应 E2E、历史会话测试和 STATE；本次不改这些生产／测试文件。

## 实机只读抽样

context `docker-desktop`，Node `desktop-control-plane`，Kubernetes v1.36.1；2026-09-21 00:35:59Z 附近的一次样本：

| 观测 | 本次实际结果 |
|---|---|
| 节点数量 | 1 |
| CPU capacity／allocatable | 10／10 核 |
| memory capacity／allocatable | 32810996Ki／32810996Ki |
| ephemeral-storage capacity／allocatable | 122713108Ki／122713108Ki |
| Pod 容量 | 110 |
| Summary 中 Pod 记录 | 48（含非 CrewStation 组件，非原管理页 Pod 计数） |
| Node CPU usageNanoCores | 593546620；这是原始瞬时样本，不是本功能的已实现指标 |
| Node memory workingSetBytes | 11066310656 |
| node.fs capacity／used／available | 125658222592／118002401280／1239117824 bytes |
| PVC 数量 | 12；全部 StorageClass standard；申请之和 122Gi |
| Summary 有 pvcRef 的卷统计 | 0；不能据此显示 PVC 已用为 0 |
| StorageClass | standard 和 hostpath 均为 rancher.io/local-path，WaitForFirstConsumer |
| 本地卷路径 | PV hostPath 位于 `/var/local-path-provisioner/`，PV claimRef 含真实 PVC UID，nodeAffinity 指向该节点 |
| cAdvisor 根 cgroup | 提供 CPU、网卡累计字节及设备读／写累计字节；磁盘有 `/dev/vda`、`/dev/vdb` 等分项 |

node.fs 的 available 不等于 capacity-used；镜像／容器 fs 的本次 capacity 与 node.fs 相同，不能把三者相加。上述数值只描述该时点，不作为将来固定期望，不代表物理磁盘余量已处理。

只读命令为 `kubectl get nodes`、`get deployment,daemonset -A`、`get pvc -A`、`get pv`、`get storageclass`，以及 API Server 代理的该节点 `/stats/summary` 和 `/metrics/cadvisor`。原始抽样在 `/tmp/cs-cluster-resource-summary.json`、`/tmp/cs-cluster-resource-cadvisor.txt`；没有应用 RBAC、安装组件、进入业务 Pod 或修改存储。

## 一手来源

- [Kubernetes Node metrics](https://kubernetes.io/docs/reference/instrumentation/node-metrics/)：Summary 的节点／Pod／容器／卷数据入口。
- [Kubelet Summary API](https://kubernetes.io/docs/reference/kubelet-api/stats.v1alpha1/)：计数、时间、文件系统与卷字段的含义。
- [Resource metrics pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)：Metrics API 覆盖 CPU／内存，不能独立完成网络与卷观测。
- [Kubernetes v1.36.1 resource helpers](https://github.com/kubernetes/kubernetes/blob/v1.36.1/staging/src/k8s.io/component-helpers/resource/helpers.go)：有效请求计算的实现基准。
- [cAdvisor Prometheus metrics](https://github.com/google/cadvisor/blob/master/docs/storage/prometheus.md)：设备与网络计数器。
- [Local Path Provisioner](https://github.com/rancher/local-path-provisioner/blob/master/README.md)：本地路径存储实现背景；当前卷统计缺失的结论来自本机抽样，不能外推成所有驱动都不支持。
- [Prometheus storage](https://prometheus.io/docs/prometheus/latest/storage/) 与 [HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/)：作者明确选择七天趋势后，核对持久化、保留和范围查询机制；实际实例尚未安装。
