import type { ClusterContainer } from '@crewstation/contracts';
import type { ResourceObject } from './inventory';
import { objectArray, objectRecord, stringRecord } from './inventory';

export function containerDetails(obj: ResourceObject): ClusterContainer[] {
  const spec = objectRecord(obj.spec), status = objectRecord(obj.status);
  const pod = obj.kind === 'Pod' ? spec : objectRecord(objectRecord(spec.template).spec);
  return [false, true].flatMap((init) => objectArray(pod[init ? 'initContainers' : 'containers']).map((c) => {
    const live = objectArray(status[init ? 'initContainerStatuses' : 'containerStatuses']).find((s) => s.name === c.name) ?? {};
    const state = objectRecord(live.state), last = objectRecord(objectRecord(live.lastState).terminated);
    const details = objectRecord(state.waiting ?? state.terminated ?? state.running), limits = objectRecord(c.resources);
    return { name: String(c.name), init, image: String(c.image ?? ''), ready: live.ready === true, restarts: Number(live.restartCount ?? 0), state: Object.keys(state)[0] ?? 'unknown', requests: stringRecord(limits.requests), limits: stringRecord(limits.limits), ports: objectArray(c.ports).map((p) => Number(p.containerPort)),
      ...(details.reason || last.reason ? { reason: String(details.reason ?? last.reason) } : {}), ...(details.message ? { message: String(details.message) } : {}), ...(details.exitCode !== undefined || last.exitCode !== undefined ? { exitCode: Number(details.exitCode ?? last.exitCode) } : {}) };
  }));
}
export function resourceStatus(obj: ResourceObject, containers: ClusterContainer[]) {
  const spec = objectRecord(obj.spec), status = objectRecord(obj.status), conditions = objectArray(status.conditions);
  const phase = String(status.phase ?? (obj.kind === 'Job' ? (conditions.some((c) => c.type === 'Complete' && c.status === 'True') || Number(status.succeeded ?? 0) >= Number(spec.completions ?? 1) ? 'Succeeded' : conditions.some((c) => c.type === 'Failed' && c.status === 'True') ? 'Failed' : 'Active') : obj.kind === 'CronJob' ? (spec.suspend ? 'Suspended' : 'Active') : 'Active'));
  const desired = obj.kind === 'DaemonSet' ? status.desiredNumberScheduled : spec.replicas;
  const readyReplicas = obj.kind === 'DaemonSet' ? status.numberReady : status.readyReplicas;
  const ready = obj.kind === 'Pod' ? conditions.some((c) => c.type === 'Ready' && c.status === 'True') : desired !== undefined ? Number(readyReplicas ?? 0) >= Number(desired) && Number(status.observedGeneration ?? 0) >= Number(obj.metadata.generation ?? 0) : obj.kind === 'PersistentVolumeClaim' ? phase === 'Bound' : phase !== 'Failed';
  const reasons = [...containers.filter((c) => c.reason).map((c) => `${c.name}: ${c.reason}${c.exitCode !== undefined ? ` (exit ${c.exitCode})` : ''}${c.message ? ` — ${c.message}` : ''}`), ...conditions.filter((c) => c.status === 'False' && (c.reason || c.message)).map((c) => String(c.message ?? c.reason))];
  if (status.reason || status.message) reasons.push(String(status.message ?? status.reason));
  return { phase, ready, abnormal: (!ready && phase !== 'Succeeded') || containers.some((c) => c.state === 'waiting' || c.reason === 'OOMKilled'), reason: reasons.join('\n'), restarts: containers.reduce((n, c) => n + c.restarts, 0),
    ...(desired === undefined ? {} : { desired: Number(desired), actual: Number(status.replicas ?? status.currentNumberScheduled ?? 0), readyReplicas: Number(readyReplicas ?? 0) }), ...(status.observedGeneration === undefined ? {} : { observedGeneration: Number(status.observedGeneration) }), ...(spec.nodeName ? { node: String(spec.nodeName) } : {}) };
}
export function visibleFacts(obj: ResourceObject): Record<string, string> {
  const spec = objectRecord(obj.spec), facts: Record<string, string> = {};
  if (obj.kind === 'Service') { facts.type = String(spec.type ?? 'ClusterIP'); facts.clusterIP = String(spec.clusterIP ?? ''); facts.ports = objectArray(spec.ports).map((p) => `${p.port} → ${p.targetPort}/${p.protocol}`).join(', '); }
  if (obj.kind === 'PersistentVolumeClaim') { facts.storageClass = String(spec.storageClassName ?? 'default'); facts.capacity = JSON.stringify(objectRecord(objectRecord(obj.status).capacity)); facts.requested = JSON.stringify(objectRecord(objectRecord(spec.resources).requests)); }
  if (['Secret', 'ConfigMap'].includes(obj.kind)) { facts.keys = [...Object.keys(objectRecord(obj.data)), ...Object.keys(objectRecord(obj.binaryData))].sort().join(', '); if (obj.kind === 'Secret') facts.type = String(obj.type ?? 'Opaque'); }
  if (obj.kind === 'ResourceQuota') { facts.hard = JSON.stringify(spec.hard); facts.used = JSON.stringify(objectRecord(obj.status).used ?? {}); }
  return facts;
}
