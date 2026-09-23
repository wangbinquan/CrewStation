import type { ClusterActionCapability, ClusterResource } from '@crewstation/contracts';
import type { InventoryFacts, ResourceObject, SystemComponent } from './inventory';
import { objectRecord, resourceKey } from './inventory';
import { referencesOf } from './resourceGraph';

export function resourceCapabilities(row: ClusterResource, facts: InventoryFacts, system: SystemComponent | undefined, objects: ResourceObject[]): ClusterActionCapability[] {
  const actions: ClusterActionCapability[] = (['restart', 'scale', 'restore-replicas', 'delete'] as const).map((action) => ({ action, enabled: false, reason: '该资源不支持此操作', executionRoute: 'none', impactSummary: [] }));
  const hpa = objects.some((o) => o.kind === 'HorizontalPodAutoscaler' && o.metadata.namespace === row.namespace && objectRecord(objectRecord(o.spec).scaleTargetRef).kind === row.kind && objectRecord(objectRecord(o.spec).scaleTargetRef).name === row.name);
  const allow = (action: ClusterActionCapability['action'], route: ClusterActionCapability['executionRoute'], impact: string[], limits?: { minReplicas?: number; maxReplicas?: number }) => Object.assign(actions.find((a) => a.action === action)!, { enabled: !(hpa && (action === 'scale' || action === 'restore-replicas')), reason: hpa && (action === 'scale' || action === 'restore-replicas') ? '副本数由 HPA 管理' : '', executionRoute: route, impactSummary: impact }, limits);
  const denyAll = (reason: string) => actions.map((a) => ({ ...a, reason }));
  if (!facts.complete) return denyAll(facts.reason ?? '平台归属信息读取不完整');
  if (row.ownership.scope === 'unresolved') return denyAll(row.ownership.reason);
  if (row.deletingAt) return denyAll('资源正在终止，请等待当前操作完成');
  if (row.kind === 'Namespace') return denyAll('命名空间由项目和安装流程管理');
  if (row.ownership.scope === 'project' && row.ownership.archived) return denyAll('项目已归档，请先核对项目清理状态');
  if (row.taskId) {
    allow('delete', 'task', ['通过任务所属生命周期结束执行；工作卷影响会在确认前检查']);
    allow('restart', 'task', ['受控重建或单次重开；确认前检查子执行、未推送变更与工作卷']);
    return actions;
  }
  if (row.kind === 'Deployment' && row.serviceId && row.physicalSlot) {
    allow('restart', 'release', ['保留当前发布、配置和物理槽，等待新 Pod 就绪']);
    allow('scale', 'release', ['副本覆盖保留到管理员恢复发布配置'], { minReplicas: 1, maxReplicas: Number(row.facts.maxReplicas ?? 1) });
    allow('restore-replicas', 'release', ['清除运维覆盖，应用当前发布的 Manifest 副本数']);
    // RFC-021 B7：与项目侧「下线」是同一个结果。
    if (row.slotRole !== 'prod') allow('delete', 'release', ['下线待验证版本：删除工作负载，槽标为已下线（集群管理）；保留发布记录与 Service，负责人可从发布记录重新部署']);
    else actions.find((a) => a.action === 'delete')!.reason = '正式槽正在承接流量，请先切流到就绪目标';
    return actions;
  }
  if (row.ownership.scope === 'system') {
    if (system?.restart && ['Deployment', 'StatefulSet', 'DaemonSet'].includes(row.kind)) allow('restart', 'kubernetes', system.impact);
    if (system?.minReplicas && system.maxReplicas && row.kind === system.kind && row.name === system.name) allow('scale', 'kubernetes', system.impact, { minReplicas: system.minReplicas, maxReplicas: system.maxReplicas });
    actions.find((a) => a.action === 'delete')!.reason = '平台组件由安装流程管理，不支持删除';
    return actions;
  }
  const key = `${row.namespace}/${row.kind}/${row.name}`;
  const retained = facts.retained.find((r) => `${r.namespace}/${r.kind}/${r.name}` === key) ?? facts.tasks.find((t) => t.namespace === row.namespace && t.pvcName === row.name && row.kind === 'PersistentVolumeClaim');
  const refs = objects.filter((o) => resourceKey(o) !== key && referencesOf(o).includes(key));
  if (retained || refs.length || row.owners.length) actions.find((a) => a.action === 'delete')!.reason = retained ? '平台保留此资源；必须通过所属业务流程清理' : `仍被引用：${refs.map((r) => r.metadata.name).join(', ') || row.owners.map((o) => o.name).join(', ')}`;
  else if ((row.kind === 'Pod' || row.kind === 'Job') && !['Succeeded', 'Failed'].includes(row.phase)) actions.find((a) => a.action === 'delete')!.reason = '运行中的任务须经所属业务流程结束';
  else if (!['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'CronJob', 'ReplicationController', 'HorizontalPodAutoscaler'].includes(row.kind)) allow('delete', 'kubernetes', ['按 UID 删除无活动引用的受管资源，无法撤销']);
  return actions;
}
