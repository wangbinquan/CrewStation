import { z } from 'zod';
import { ResourceIdSchema, TaskIdSchema } from '../../ids';

const identity = { namespace: z.string().min(1), name: z.string().min(1), uid: z.string().min(1), pvName: z.string().min(1), pvUid: z.string().min(1) };
export const TaskVolumeClaimSchema = z.strictObject({ namespace: identity.namespace, name: identity.name, uid: identity.uid });
export type TaskVolumeClaim = z.infer<typeof TaskVolumeClaimSchema>;
/** Private controller evidence; paths and backend handles are never accepted from application HTTP. */
export const TaskVolumeTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...identity, kind: z.literal('local-path'), nodeName: z.string().min(1), nodeUid: z.string().min(1), root: z.string().min(1), directory: z.string().regex(/^[A-Za-z0-9_.-]{1,253}$/) }),
  z.strictObject({ ...identity, kind: z.literal('csi'), driver: z.string().min(1), handleDigest: z.string().regex(/^[a-f0-9]{64}$/), deletionFinalizer: z.literal('external-provisioner.volume.kubernetes.io/finalizer') }),
]);
export type TaskVolumeTarget = z.infer<typeof TaskVolumeTargetSchema>;
export const TaskVolumeDeletionPermitSchema = z.strictObject({
  id: ResourceIdSchema, taskId: TaskIdSchema, operationId: ResourceIdSchema, revision: z.number().int().positive(), receiptId: ResourceIdSchema,
  volumeUid: z.string().min(1).nullable(), allConsumersStoppedDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TaskVolumeDeletionPermit = z.infer<typeof TaskVolumeDeletionPermitSchema>;
export const TaskVolumeReclaimProofSchema = z.strictObject({
  id: ResourceIdSchema, permitId: ResourceIdSchema, volumeUid: z.string().min(1).nullable(), pvUid: z.string().min(1).nullable(),
  disposition: z.enum(['deleted', 'never-provisioned']), storageReclaimed: z.literal(true).nullable(), observedAt: z.iso.datetime(),
  source: z.enum(['local-path-probe', 'csi-provisioner', 'never-provisioned']),
});
export type TaskVolumeReclaimProof = z.infer<typeof TaskVolumeReclaimProofSchema>;
export interface TaskVolumeSafetyState {
  /** PVC identity is available before WaitForFirstConsumer has provisioned a PV. It is not reclaim evidence. */
  readonly claim?: TaskVolumeClaim;
  readonly resourceId: string; readonly taskId: string; readonly provisionIssued: boolean; readonly target: TaskVolumeTarget | null;
  readonly permit: TaskVolumeDeletionPermit | null; readonly proof: TaskVolumeReclaimProof | null;
}
