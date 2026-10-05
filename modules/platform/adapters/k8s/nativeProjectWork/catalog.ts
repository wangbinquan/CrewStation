import { Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { jsonHash, precondition } from '@crewstation/kernel';
import { completeRegistryObjects } from '../nativeRegistry/origin';
import type { NativeWorkOptions, WorkCatalog, WorkObject } from './bindings';
import { objectKey } from './bindings';

const kinds: WorkObject['kind'][] = ['Job', 'Deployment', 'ReplicaSet', 'Pod', 'Secret', 'ConfigMap'];
export const workObjectIdentity = (row: K8sObject) => jsonHash({ uid: row.metadata.uid, spec: row['spec'] ?? null, data: row['data'] ?? null,
  binaryData: row['binaryData'] ?? null, type: row['type'] ?? null, immutable: row['immutable'] ?? null });
/** Read every retained native object of these producers; no bounded execution
 * history or current slot is substituted for the complete module inputs. */
export async function captureWorkCatalog(options: NativeWorkOptions, raw: Omit<WorkCatalog, 'objects'>) {
  const input = structuredClone(raw), signal = AbortSignal.timeout(30_000), records = await options.resources().list({ projectId: input.target.id });
  const ledger = records.filter(row => row.owner.module === input.mode), declarations = new Set(ledger.flatMap(row => [...row.spec.children, ...row.children].map(child => objectKey({ ...child, namespace: child.namespace ?? input.target.namespace } as WorkObject))));
  const all: K8sObject[] = [];
  for (const kind of kinds) all.push(...await completeRegistryObjects(options.k8s, Resources[kind]!, input.target.namespace, '', signal));
  const selected = new Set<string>();
  for (const row of all) {
    const labels = row.metadata.labels ?? {}, consumer = labels['crewstation.io/release'] ?? labels['crewstation.io/image-build'] ?? labels['crewstation.io/image-validation'];
    const ownConsumer = input.mode === 'release' ? labels['crewstation.io/release'] : labels['crewstation.io/image-build'] ?? labels['crewstation.io/image-validation'];
    if (ownConsumer && !input.consumerIds.includes(ownConsumer)) throw precondition('原工作完整目录出现未登记的生产者，不能省略后回收');
    if (declarations.has(objectKey({ kind: row.kind, namespace: row.metadata.namespace!, name: row.metadata.name } as WorkObject)) || consumer && input.consumerIds.includes(consumer)) {
      if (!row.metadata.uid || row.metadata.labels?.['app.kubernetes.io/managed-by'] !== 'crewstation') throw precondition('原工作对象缺少受管 UID 归属'); selected.add(row.metadata.uid);
    }
  }
  for (let depth = 0; depth < 8; depth++) for (const row of all) if (row.metadata.ownerReferences?.some(parent => parent.controller && selected.has(parent.uid))) {
    if (!row.metadata.uid) throw precondition('原工作控制器子对象缺少 UID'); selected.add(row.metadata.uid);
  }
  if (all.some(row => !selected.has(row.metadata.uid!) && row.metadata.ownerReferences?.some(parent => parent.controller && selected.has(parent.uid)))) throw precondition('原工作控制器子树没有达到完整 EOF');
  const objects = all.filter(row => selected.has(row.metadata.uid!)).map(row => ({ kind: row.kind as WorkObject['kind'], namespace: row.metadata.namespace!, name: row.metadata.name, uid: row.metadata.uid!, identity: workObjectIdentity(row) })).sort((a, b) => objectKey(a).localeCompare(objectKey(b)));
  return { catalog: { ...input, objects }, pods: all.filter(row => row.kind === 'Pod' && selected.has(row.metadata.uid!)) };
}
export async function inspectWorkCatalog(options: NativeWorkOptions, original: WorkCatalog) {
  const actual = await captureWorkCatalog(options, original);
  for (const row of actual.catalog.objects) if (!original.objects.some(before => objectKey(before) === objectKey(row) && before.uid === row.uid && before.identity === row.identity)) throw precondition('封写后出现新的原工作实例或同名替换对象');
  return actual;
}
export async function removeWorkObjects(options: NativeWorkOptions, original: WorkCatalog, controllerOnly: boolean, grant: () => Promise<void>) {
  const current = await inspectWorkCatalog(options, original);
  for (const row of current.catalog.objects.filter(row => controllerOnly ? ['Job', 'Deployment'].includes(row.kind) : !['Pod', 'ReplicaSet'].includes(row.kind))) {
    await grant(); const actual = await options.k8s.get(Resources[row.kind]!, row.name, row.namespace, AbortSignal.timeout(15_000));
    if (!actual) continue;
    if (actual.metadata.uid !== row.uid || workObjectIdentity(actual) !== row.identity) throw precondition('原工作对象在实际删除前被替换');
    if (!actual.metadata.deletionTimestamp) await options.k8s.delete(Resources[row.kind]!, row.name, row.namespace, { preconditions: { uid: row.uid }, propagationPolicy: 'Foreground' });
    await grant();
  }
}
