import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { DevelopmentParentMaterialsSchema } from '../../../domain/development/parentMaterials';
import type { DevelopmentParentMaterials } from '../../../domain/development/parentMaterials';
import { hashRunnerToken } from '../../../domain/runnerToken';
import type { DevelopmentParentEnding } from '../../../ports/developmentParentEnding';

type Container = { name: string; image?: string; env?: Array<{ name: string; value?: string; valueFrom?: { secretKeyRef?: { name?: string } } }>; envFrom?: Array<{ secretRef?: { name?: string } }> };
type Spec = { nodeName?: string; containers?: Container[]; initContainers?: Container[]; ephemeralContainers?: Container[];
  volumes?: Array<{ secret?: { secretName?: string }; projected?: { sources?: Array<{ secret?: { name?: string } }> }; persistentVolumeClaim?: { claimName?: string } }>; imagePullSecrets?: Array<{ name?: string }> };
type Secret = K8sObject & { data?: Record<string, string>; stringData?: Record<string, string>; immutable?: boolean };
const signal = () => AbortSignal.timeout(15_000);
export function parentObjectSource(object: K8sObject): string {
  return object.kind === 'Secret' ? jsonHash({ type: object['type'] ?? null, immutable: object['immutable'] ?? false, data: object['data'] ?? null, stringData: object['stringData'] ?? null }) : jsonHash(object['spec'] ?? null);
}
export function originalParentObject(object: K8sObject | undefined, expected: { name: string; uid: string; sourceHash: string }, namespace: string): K8sObject {
  if (!object || object.metadata.name !== expected.name || object.metadata.namespace !== namespace || object.metadata.uid !== expected.uid
    || !object.metadata.resourceVersion || parentObjectSource(object) !== expected.sourceHash) throw precondition('原父物理对象已变化，等待原实例核对');
  return object;
}
function secretNames(spec: Spec): string[] {
  const containers = [...spec.containers ?? [], ...spec.initContainers ?? [], ...spec.ephemeralContainers ?? []];
  const names = [...containers.flatMap((c) => [...c.envFrom?.map((e) => e.secretRef?.name) ?? [], ...c.env?.map((e) => e.valueFrom?.secretKeyRef?.name) ?? []]),
    ...spec.volumes?.flatMap((v) => [v.secret?.secretName, ...v.projected?.sources?.map((s) => s.secret?.name) ?? []]) ?? [], ...spec.imagePullSecrets?.map((s) => s.name) ?? []];
  return [...new Set(names.filter((n): n is string => !!n))].sort();
}
function ownedSecret(ending: DevelopmentParentEnding, secret: Secret): boolean {
  const epoch = ending.epoch, render = epoch.acceptedRender, checkout = render?.['checkout'] as { credentialSecretName?: string } | undefined;
  if (checkout?.credentialSecretName === secret.metadata.name) return false;
  const names = [epoch.podName + '-runner', ...(epoch.originalRenderStart ? [epoch.podName + '-runner-' + epoch.originalRenderStart, epoch.podName + '-checkout-' + epoch.originalRenderStart] : [])];
  return names.includes(secret.metadata.name) && secret.metadata.labels?.[LABELS.task] === epoch.parentId;
}
/** Credential bytes never leave this boundary: only immutable source digests are persisted. */
export async function inspectParentMaterials(k8s: K8sClient, ending: DevelopmentParentEnding): Promise<DevelopmentParentMaterials> {
  const e = ending.epoch;
  const [pod, pvc] = await Promise.all([k8s.get(Resources.Pod!, e.podName, e.namespace, signal()), k8s.get(Resources.PersistentVolumeClaim!, e.pvcName, e.namespace, signal())]);
  if (!pod || !pvc || pod.metadata.uid !== e.podUid || pvc.metadata.uid !== e.pvcUid || !pod.metadata.resourceVersion || !pvc.metadata.resourceVersion
    || pod.metadata.namespace !== e.namespace || pvc.metadata.namespace !== e.namespace || pvc.metadata.deletionTimestamp)
    throw precondition('原父 Pod 或保留工作卷缺少实际 UID 材料');
  const spec = pod['spec'] as Spec | undefined, taskLabel = pod.metadata.labels?.[LABELS.task];
  if (!spec?.nodeName || ![e.parentId, e.labels[LABELS.task]].filter(Boolean).includes(taskLabel)
    || !spec.volumes?.some((v) => v.persistentVolumeClaim?.claimName === e.pvcName)
    || e.acceptedRender && !spec.containers?.some((c) => c.image === e.acceptedRender!['image'])) throw precondition('原父容器布局或工作卷归属已变化');
  const [node, secrets] = await Promise.all([k8s.get(Resources.Node!, spec.nodeName, undefined, signal()),
    Promise.all(secretNames(spec).map((name) => k8s.get<Secret>(Resources.Secret!, name, e.namespace, signal())))]);
  if (!node?.metadata.uid || secrets.some((s) => !s?.metadata.uid || s.metadata.deletionTimestamp)) throw precondition('原节点或配置来源尚未完整确认');
  const all = [...spec.containers ?? [], ...spec.initContainers ?? [], ...spec.ephemeralContainers ?? []];
  const tokens = [...all.flatMap((c) => c.env?.filter((v) => v.name === 'CS_RUNNER_TOKEN').map((v) => v.value) ?? []),
    ...secrets.map((s) => s?.stringData?.CS_RUNNER_TOKEN ?? (s?.data?.CS_RUNNER_TOKEN ? Buffer.from(s.data.CS_RUNNER_TOKEN, 'base64').toString('utf8') : undefined))].filter((value): value is string => !!value);
  if (!tokens.length || tokens.some((token) => hashRunnerToken(token) !== e.runnerTokenHash)) throw precondition('原 Runner 配置不属于受理的原凭据');
  return DevelopmentParentMaterialsSchema.parse({ version: 1, epochHash: ending.epochHash, namespace: e.namespace,
    pod: { name: e.podName, uid: e.podUid, sourceHash: parentObjectSource(pod) }, pvc: { name: e.pvcName, uid: e.pvcUid, sourceHash: parentObjectSource(pvc) },
    nodeName: spec.nodeName, nodeUid: node.metadata.uid, secrets: secrets.map((s) => ({ name: s!.metadata.name, uid: s!.metadata.uid, sourceHash: parentObjectSource(s!), owned: ownedSecret(ending, s!) })),
    containers: [['init', spec.initContainers ?? []], ['container', spec.containers ?? []], ['ephemeral', spec.ephemeralContainers ?? []]].flatMap(([kind, rows]) => (rows as Container[]).map((c) => ({ kind, name: c.name }))) });
}
