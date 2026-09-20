import { createHash } from 'node:crypto';
import { conflict, precondition } from '@crewstation/kernel';
import type { K8sClient, JsonPatch } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import type { SlotControl } from '../../ports/slotControl';
import type { ClusterResource } from '@crewstation/contracts';
const marker = 'crewstation.io/cluster-operation';
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value; }
const rec = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
export function kubernetesSlotControl(k8s: K8sClient, physicalOperationId: (id: string) => Promise<string> = async (id) => id): SlotControl {
  const get = (r: ClusterResource) => k8s.get(Resources.Deployment!, r.name, r.namespace, AbortSignal.timeout(15_000));
  const inspect: SlotControl['inspect'] = async (r) => {
    const live = await get(r); if (!live || live.metadata.uid !== r.uid) throw conflict('发布槽实例已变化');
    const autoscalers = await k8s.list(Resources.HorizontalPodAutoscaler!, r.namespace);
    if (autoscalers.some((h) => rec(rec(h.spec).scaleTargetRef).name === r.name)) throw precondition('副本数由 HPA 管理，请先处理自动伸缩策略');
  };
  return {
    inspect,
    apply: async (op, replicas) => {
      const operationId = await physicalOperationId(op.operationId);
      const r = op.target, live = await get(r);
      if (op.action === 'delete' && (!live || live.metadata.uid !== r.uid)) return;
      if (!live || live.metadata.uid !== r.uid) throw conflict('发布槽已被新实例替换');
      if (live.metadata.annotations?.[marker] === operationId) return;
      const revision = createHash('sha256').update(JSON.stringify(canonical({ uid: live.metadata.uid, spec: live.spec, data: live.data, type: live.type, owners: live.metadata.ownerReferences, labels: live.metadata.labels }))).digest('hex');
      if (revision !== r.revision) throw conflict('发布槽期望配置发生变化，请重新检查');
      if (op.action === 'delete') { await k8s.delete(Resources.Deployment!, r.name, r.namespace, { propagationPolicy: 'Foreground', preconditions: { uid: r.uid, resourceVersion: live.metadata.resourceVersion! } }); return; }
      const patch: JsonPatch[] = [{ op: 'test', path: '/metadata/uid', value: r.uid }, { op: 'test', path: '/metadata/resourceVersion', value: live.metadata.resourceVersion }, { op: 'add', path: '/metadata/annotations', value: { ...live.metadata.annotations, [marker]: operationId } }];
      if (op.action === 'restart') patch.push({ op: 'add', path: '/spec/template/metadata/annotations', value: { ...rec(rec(rec(live.spec).template).metadata).annotations as object, [marker]: operationId } });
      else patch.push({ op: 'add', path: '/spec/replicas', value: replicas });
      await k8s.jsonPatch(Resources.Deployment!, r.name, r.namespace, patch);
    },
    observe: async (op, replicas) => {
      const live = await get(op.target);
      if (op.action === 'delete') return { done: !live || live.metadata.uid !== op.target.uid, reason: '等待原发布槽 UID 删除', replicas: 0, readyReplicas: 0 };
      if (!live || live.metadata.uid !== op.target.uid) return { done: true, failed: true, reason: '发布槽实例已变化', replicas: 0, readyReplicas: 0 };
      const status = rec(live.status), desired = Number(rec(live.spec).replicas ?? 1), ready = Number(status.readyReplicas ?? 0), actual = Number(status.replicas ?? 0);
      const done = Number(status.observedGeneration ?? 0) >= Number(live.metadata.generation ?? 0) && ready === desired && actual === desired && (replicas === undefined || desired === replicas) && (op.action !== 'restart' || Number(status.updatedReplicas ?? 0) === desired && Number(live.metadata.generation) > Number(op.target.generation ?? 0));
      return { done, reason: done ? '发布槽已就绪' : `等待发布槽就绪：${ready}/${desired}`, replicas: desired, readyReplicas: ready };
    },
  };
}
