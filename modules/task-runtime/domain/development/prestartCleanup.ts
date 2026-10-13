import { z } from 'zod';
import { DevelopmentObservedIdentitySchema, DevelopmentUsageDrainReasonSchema, ResourceIdSchema, WorkloadConsumerSchema, WorkloadStopProofSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const DevelopmentCleanupSelectionSchema = z.strictObject({
  version: z.literal(1), identity: DevelopmentObservedIdentitySchema, profileId: ResourceIdSchema, profileRevision: revision,
  podUid: z.uuid(), consumerId: ResourceIdSchema, renderStart: revision, selectionHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const DevelopmentCleanupOwnerSchema = z.strictObject({
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), firstReason: DevelopmentUsageDrainReasonSchema,
  acceptedAt: z.iso.datetime(), profileId: ResourceIdSchema, profileRevision: revision, protocol: z.enum(['opencode', 'claude-code']),
  priceBookRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
/** Physical closure for an original admission that has never acquired a start permit. Numeric usage remains unknown. */
export const DevelopmentPrestartCleanupEvidenceSchema = z.strictObject({
  version: z.literal(2), kind: z.literal('unbound-no-grant'), phase: z.enum(['stopping', 'closed']), numericState: z.literal('unknown'),
  selection: DevelopmentCleanupSelectionSchema, owner: DevelopmentCleanupOwnerSchema, consumer: WorkloadConsumerSchema,
  stopProof: WorkloadStopProofSchema.nullable(), stopProofDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).superRefine((e, ctx) => {
  const s = e.selection, c = e.consumer;
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (c.id !== s.consumerId || c.resourceId !== s.identity.executionId || c.taskId !== s.identity.taskId || c.revision !== s.renderStart
    || c.purpose !== 'agent' || c.finalization !== null || e.owner.profileId !== s.profileId || e.owner.profileRevision !== s.profileRevision) invalid('未获准启动清理必须保持原消费者、身份与人民币受理');
  if (e.phase === 'stopping') {
    if (e.stopProof !== null || e.stopProofDigest !== null) invalid('停止意图不能冒充实际物理闭合');
  } else if (!e.stopProof || e.stopProofDigest !== jsonHash(e.stopProof) || e.stopProof.podUid !== s.podUid
    || jsonHash(e.stopProof.consumer) !== jsonHash(c)) invalid('未获准启动闭合必须有原 Pod 与完整消费者的实际停止证明');
});
export type DevelopmentPrestartCleanupEvidence = z.infer<typeof DevelopmentPrestartCleanupEvidenceSchema>;
