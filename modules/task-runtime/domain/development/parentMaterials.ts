import { z } from 'zod';
import { WorkloadConsumerIntentSchema, WorkloadConsumerSchema, WorkloadStartPermitSchema, WorkloadStopProofSchema } from '@crewstation/contracts';
import type { WorkloadConsumer, WorkloadConsumerIntent, WorkloadStartPermit, WorkloadStopProof } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { DevelopmentParentEpoch } from './parentEnding';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const object = z.strictObject({ name: z.string().min(1), uid: z.uuid(), sourceHash: digest });
export { DEVELOPMENT_PARENT_ENDING_ANNOTATION } from '@crewstation/contracts';
export const DevelopmentParentMaterialsSchema = z.strictObject({
  version: z.literal(1), epochHash: digest, namespace: z.string().min(1),
  pod: object, pvc: object, nodeName: z.string().min(1), nodeUid: z.uuid(),
  secrets: z.array(object.extend({ owned: z.boolean() })).max(256),
  containers: z.array(z.strictObject({ kind: z.enum(['init', 'container', 'ephemeral']), name: z.string().min(1) })).min(1).max(256),
}).superRefine((value, context) => {
  if (new Set(value.secrets.map((item) => item.name)).size !== value.secrets.length
    || new Set(value.containers.map((item) => item.name)).size !== value.containers.length)
    context.addIssue({ code: 'custom', message: '原父物理材料有重复对象或容器' });
});
export type DevelopmentParentMaterials = z.infer<typeof DevelopmentParentMaterialsSchema>;
export interface DevelopmentParentPrepared {
  readonly consumer: WorkloadConsumerIntent; readonly podUid: string; readonly pvcUid: string;
  readonly nodeName: string; readonly nodeUid: string; readonly materialsHash: string;
}
type Original = { readonly id: string; readonly parentId: string; readonly epoch: DevelopmentParentEpoch; readonly epochHash: string };
export function preparedDevelopmentParent(ending: Original, raw: unknown): DevelopmentParentPrepared {
  const materials = DevelopmentParentMaterialsSchema.parse(raw), epoch = ending.epoch;
  if (materials.epochHash !== ending.epochHash || materials.namespace !== epoch.namespace || materials.pod.name !== epoch.podName
    || materials.pod.uid !== epoch.podUid || materials.pvc.name !== epoch.pvcName || materials.pvc.uid !== epoch.pvcUid)
    throw precondition('原父物理材料不属于受理的原实例');
  return { consumer: WorkloadConsumerIntentSchema.parse({ id: ending.id, taskId: ending.parentId, revision: 1, purpose: 'development', finalization: null }),
    podUid: materials.pod.uid, pvcUid: materials.pvc.uid, nodeName: materials.nodeName, nodeUid: materials.nodeUid, materialsHash: jsonHash(materials) };
}
export function developmentParentConsumer(ending: Original, materials: DevelopmentParentMaterials): WorkloadConsumer {
  const prepared = preparedDevelopmentParent(ending, materials);
  return WorkloadConsumerSchema.parse({ ...prepared.consumer, resourceId: ending.parentId, namespace: ending.epoch.namespace,
    podName: ending.epoch.podName, volumeUid: ending.epoch.pvcUid });
}
export interface DevelopmentParentStopState {
  readonly consumer: WorkloadConsumer; readonly admissionClosed: boolean;
  readonly startPermit: WorkloadStartPermit | null; readonly stopProof: WorkloadStopProof | null;
}
/** An absent Pod or an observer with no original Start ACK is never a parent stop proof. */
export function requireDevelopmentParentStop(ending: Original, materials: DevelopmentParentMaterials, state: DevelopmentParentStopState | undefined) {
  const prepared = preparedDevelopmentParent(ending, materials), expected = developmentParentConsumer(ending, materials);
  if (!state?.admissionClosed || !state.startPermit || !state.stopProof) throw precondition('等待原父观察 Start ACK 与独立停止证明');
  const consumer = WorkloadConsumerSchema.parse(state.consumer), startPermit = WorkloadStartPermitSchema.parse(state.startPermit), stopProof = WorkloadStopProofSchema.parse(state.stopProof);
  const names = (items: ReadonlyArray<{ kind: string; name: string }>) => items.map((item) => item.kind + ':' + item.name).sort();
  if (jsonHash(consumer) !== jsonHash(expected) || jsonHash(stopProof.consumer) !== jsonHash(expected)
    || startPermit.podUid !== prepared.podUid || startPermit.nodeName !== prepared.nodeName || startPermit.nodeUid !== prepared.nodeUid
    || stopProof.podUid !== prepared.podUid || stopProof.nodeName !== prepared.nodeName || stopProof.nodeUid !== prepared.nodeUid
    || stopProof.type !== 'kubelet-terminated' || jsonHash(names(stopProof.containers)) !== jsonHash(names(materials.containers)))
    throw precondition('停止证明必须覆盖原父 Pod、节点与每个实际容器');
  return { consumer, startPermit, stopProof };
}
