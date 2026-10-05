import type { ProjectDeletionContext, ProjectDeletionStepResult } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { ClusterDeletionAdmission } from '../../../api/projectDeletion';
import type { ClusterPodStopReceipts, ProjectPodProtection } from '../../../api/projectPodProtection';
import { PROJECT_STOP_ANNOTATION, PROJECT_STOP_FINALIZER, assertProjectPodProtection, originalPodIdentity, projectPodTerminated } from '../../../domain/deletion/podStop';
import type { ProjectPodIdentity } from '../../../domain/deletion/podStop';
import type { LedgerObservations } from '../../../ports/ledger';
import { inspectProjectCluster } from './inspection';
import { originalUid } from '../../../domain/deletion/objects';
import { nodeEvidence } from '../safety/workloadStop';

const keyOf = (id: string): { name: string; namespace: string } => { const key = JSON.parse(id); if (key.kind !== 'Pod' || !key.name || !key.namespace) throw precondition('Pod 盘点键不完整'); return key; };
const expectedPods = (context: ProjectDeletionContext) => context.confirmed.resources.filter((entry) => entry.kind === 'protected:Pod');
const done = (context: ProjectDeletionContext, phase: string): ProjectDeletionStepResult => ({ kind: 'done', evidence: { kind: phase === 'seal' ? 'metadata' : 'physical', count: expectedPods(context).length, digest: jsonHash({ operationId: context.operationId, phase, original: expectedPods(context) }), description: phase === 'seal' ? '原 Pod 按 UID 加入停止观测保护；停止证明必须先持久保存才释放自己的 finalizer' : '原 Pod 的 kubelet 终止／从未启动证明已持久确认，并且没有同名替换实例' } });
async function currentPod(k8s: K8sClient, id: string, uid: string): Promise<K8sObject | undefined> {
  const { name, namespace } = keyOf(id), pod = await k8s.get(Resources.Pod!, name, namespace, AbortSignal.timeout(15_000));
  if (pod && pod.metadata.uid !== uid) throw precondition('项目停止许可不能修改同名替换 Pod');
  return pod;
}
async function protect(k8s: K8sClient, pod: K8sObject, context: ProjectDeletionContext) {
  const op = pod.metadata.annotations?.[PROJECT_STOP_ANNOTATION];
  if (op && op !== context.operationId) throw precondition('Pod 已被其他删除操作保护');
  if (pod.metadata.finalizers?.includes(PROJECT_STOP_FINALIZER) && op === context.operationId) return;
  if (pod.metadata.deletionTimestamp) throw precondition('原 Pod 已开始终结，不能补造丢失的停止观测保护');
  await k8s.jsonPatch(Resources.Pod!, pod.metadata.name, pod.metadata.namespace, [
    { op: 'test', path: '/metadata/uid', value: pod.metadata.uid }, { op: 'test', path: '/metadata/resourceVersion', value: pod.metadata.resourceVersion },
    { op: 'add', path: '/metadata/annotations', value: { ...pod.metadata.annotations, [PROJECT_STOP_ANNOTATION]: context.operationId } },
    { op: 'add', path: '/metadata/finalizers', value: [...pod.metadata.finalizers ?? [], PROJECT_STOP_FINALIZER] },
  ]);
}
async function release(k8s: K8sClient, context: ProjectDeletionContext, id: string, original: ProjectPodIdentity) {
  const pod = await currentPod(k8s, id, original.uid); if (!pod) return;
  if (pod.metadata.annotations?.[PROJECT_STOP_ANNOTATION] !== context.operationId) throw precondition('原 Pod 保护操作变化');
  if (!pod.metadata.finalizers?.includes(PROJECT_STOP_FINALIZER)) return;
  assertProjectPodProtection(pod, original, context.operationId);
  if (!pod.metadata.deletionTimestamp) throw precondition('尚未终结的 Pod 不能移除停止保护');
  await k8s.jsonPatch(Resources.Pod!, pod.metadata.name, pod.metadata.namespace, [
    { op: 'test', path: '/metadata/uid', value: original.uid }, { op: 'test', path: '/metadata/resourceVersion', value: pod.metadata.resourceVersion },
    { op: 'replace', path: '/metadata/finalizers', value: pod.metadata.finalizers.filter((entry) => entry !== PROJECT_STOP_FINALIZER) },
  ]);
}
export function kubernetesProjectPodProtection(k8s: K8sClient, ledger: Pick<LedgerObservations, 'claimOf' | 'get'>, admission: ClusterDeletionAdmission, store: ClusterPodStopReceipts, systemNamespace: string, now: () => Date): ProjectPodProtection {
  const inspect: ProjectPodProtection['inspect'] = async (target) => {
    const report = await inspectProjectCluster(k8s, ledger, admission, target, systemNamespace), resources = [];
    for (const entry of report.resources.filter((resource) => resource.kind === 'Pod')) {
      const pod = await currentPod(k8s, entry.id, originalUid(entry)); if (!pod) throw precondition('盘点中的 Pod 已消失，需重新核对原停止证明');
      const nodeName = (pod['spec'] as { nodeName?: string })?.nodeName ?? null, node = nodeName ? await nodeEvidence(k8s, nodeName, now(), AbortSignal.timeout(15_000)) : undefined;
      if (nodeName && !node) throw precondition('原 Pod 节点身份不可确认');
      resources.push({ kind: 'protected:Pod', id: entry.id, identity: JSON.stringify({ uid: pod.metadata.uid, nodeName, nodeUid: node?.uid ?? null, specDigest: jsonHash(pod['spec'] ?? {}) }), count: 1 });
    }
    return { participant: 'resources', complete: report.complete, revision: jsonHash(resources), resources, references: report.references, blockers: report.blockers };
  };
  const authorize = async (context: ProjectDeletionContext) => { if (context.confirmed.participant !== 'resources' || expectedPods(context).some((entry) => keyOf(entry.id).namespace !== context.target.namespace)) throw precondition('Pod 物理停止许可来源不符'); await admission.assertGrant(context); };
  return { inspect,
    seal: async (context) => { if (context.phase !== 'seal') throw precondition('Pod 保护许可阶段不符'); await authorize(context); for (const entry of expectedPods(context)) { const original = originalPodIdentity(entry.identity), pod = await currentPod(k8s, entry.id, original.uid); if (!pod || jsonHash(pod['spec'] ?? {}) !== original.specDigest) throw precondition('原 Pod 在保护前变化或消失'); await authorize(context); await protect(k8s, pod, context); } return done(context, 'seal'); },
    observeTerminating: async (context) => { if (context.phase !== 'stop') throw precondition('Pod 观测许可阶段不符'); await stopPods(k8s, context, store, authorize, now, false); },
    stop: async (context) => { if (context.phase !== 'stop') throw precondition('Pod 停止许可阶段不符'); return stopPods(k8s, context, store, authorize, now, true); },
    stopSelected: async (context, keys) => {
      if (context.phase !== 'stop') throw precondition('Pod 停止许可阶段不符');
      const selected = new Set(keys);
      if (selected.size !== keys.length || keys.some(key => !expectedPods(context).some(row => row.id === key))) throw precondition('所选消费者不属于完整的原 Pod 确认范围');
      const result = await stopPods(k8s, context, store, authorize, now, true, selected);
      return result.kind === 'done' ? { ...result, evidence: { ...result.evidence, count: selected.size, digest: jsonHash({ proof: result.evidence.digest, selected: [...selected].sort() }), description: '所选原 Pod 的实际停止证明已持久确认；其余 Pod 保持原保护' } } : result;
    },
    verify: async (context) => {
      if (!['prove', 'verify'].includes(context.phase)) throw precondition('Pod 物理证明许可阶段不符');
      await authorize(context);
      for (const entry of expectedPods(context)) { const uid = originalPodIdentity(entry.identity).uid;
        if (!await store.get(context, entry.id, uid)) return { kind: 'waiting', reason: '原 Pod 的持久停止证明尚未齐全' };
        if (await currentPod(k8s, entry.id, uid)) return { kind: 'waiting', reason: '等待原 Pod 正常终结；不会强删其他 finalizer' };
      }
      const live = await inspect(context.target);
      if (live.resources.length || live.blockers.length) return { kind: 'blocked', blockers: live.blockers.length ? live.blockers : [{ participant: 'resources', code: 'new-pod', message: '闭准入后仍出现新的 Pod；先核对已确认控制器的迟到实例' }] };
      return done(context, 'verify');
    },
  };
}
async function stopPods(k8s: K8sClient, context: ProjectDeletionContext, store: ClusterPodStopReceipts, authorize: (context: ProjectDeletionContext) => Promise<void>, now: () => Date, initiate: boolean, selected?: ReadonlySet<string>): Promise<ProjectDeletionStepResult> {
  await authorize(context);
  let waiting = false;
  for (const entry of expectedPods(context).filter(row => !selected || selected.has(row.id))) {
    const original = originalPodIdentity(entry.identity); let pod = await currentPod(k8s, entry.id, original.uid);
    const saved = await store.get(context, entry.id, original.uid);
    if (saved) { await authorize(context); await release(k8s, context, entry.id, original); continue; }
    if (!pod) throw precondition('API 中的 Pod 不存在不能替代原容器停止证明');
    assertProjectPodProtection(pod, original, context.operationId);
    await authorize(context);
    if (!pod.metadata.deletionTimestamp) {
      if (!initiate) { waiting = true; continue; }
      await k8s.delete(Resources.Pod!, pod.metadata.name, pod.metadata.namespace, { preconditions: { uid: original.uid }, propagationPolicy: 'Foreground' }); pod = await currentPod(k8s, entry.id, original.uid);
    }
    if (!pod) throw precondition('原 Pod 在保存停止证明前消失');
    const node = original.nodeName ? await nodeEvidence(k8s, original.nodeName, now(), AbortSignal.timeout(15_000)) : undefined;
    const containers = projectPodTerminated(pod, original, context.operationId, node);
    if (!containers) { waiting = true; continue; }
    const proof = { uid: original.uid, nodeUid: node?.uid ?? null, resourceVersion: pod.metadata.resourceVersion, containers };
    await store.save(context, { key: entry.id, uid: original.uid, nodeUid: proof.nodeUid, digest: jsonHash(proof), observedAt: now().toISOString() });
    await authorize(context); await release(k8s, context, entry.id, original);
  }
  return waiting ? { kind: 'waiting', reason: '等待原节点新鲜心跳和所有普通／初始化／临时容器的实际停止状态' } : done(context, 'stop');
}
