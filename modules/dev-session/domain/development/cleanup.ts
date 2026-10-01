import { z } from 'zod';
import { DevelopmentAgentIdentitySchema, DevelopmentUsageClosureSchema, DevelopmentUsageDrainReasonSchema, DevelopmentUsageRegistrationSchema, DevelopmentUsageStopReceiptSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const DevelopmentCleanupSelectionSchema = z.strictObject({
  version: z.literal(1), identity: DevelopmentAgentIdentitySchema, profileId: ResourceIdSchema, profileRevision: revision,
  podUid: z.uuid(), consumerId: ResourceIdSchema, renderStart: revision, selectionHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const DevelopmentCleanupEvidenceSchema = z.strictObject({
  version: z.literal(1), selection: DevelopmentCleanupSelectionSchema, registration: DevelopmentUsageRegistrationSchema,
  stop: DevelopmentUsageStopReceiptSchema, closure: DevelopmentUsageClosureSchema,
  owner: z.strictObject({ payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), firstReason: DevelopmentUsageDrainReasonSchema,
    acceptedAt: z.iso.datetime(), profileId: ResourceIdSchema, profileRevision: revision, protocol: z.enum(['opencode', 'claude-code']),
    priceBookRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
}).superRefine((e, ctx) => {
  const s = e.selection, r = e.registration, stop = e.stop.receipt, c = e.closure, o = e.owner;
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (jsonHash(s.identity) !== jsonHash(r.identity) || s.podUid !== r.podUid || s.profileId !== r.profileId || s.profileRevision !== r.profileRevision
    || r.key.payloadDigest !== o.payloadDigest || o.profileId !== r.profileId || o.profileRevision !== r.profileRevision) invalid('清理凭证必须保持原开发归属与人民币受理');
  if (!['prevented', 'finished'].includes(e.stop.state) || stop.phase !== 'finished' || jsonHash(stop.key) !== jsonHash(r.key)
    || jsonHash(stop.identity) !== jsonHash(r.identity) || stop.podUid !== r.podUid || stop.profileId !== r.profileId || stop.profileRevision !== r.profileRevision) invalid('清理必须有原执行的独立实际停止回执');
  if (c.persistedThrough > stop.lastSequence || c.reportedThrough !== stop.lastSequence) invalid('清理出口不能越过原数字末尾');
  const missing = c.status === 'interrupted' && c.persistedThrough < stop.lastSequence;
  if (c.missingAfter !== (missing ? c.persistedThrough : null) || c.missingThrough !== (missing ? stop.lastSequence : null)) invalid('清理凭证必须保留数字缺口');
  if (c.status === 'complete' ? c.tailUnknown || c.reason !== null || c.persistedThrough !== stop.finalThrough || stop.interruption !== null
    : !c.tailUnknown || !c.reason) invalid('完整与中断出口不能互相冒充');
});
export type DevelopmentCleanupSelection = z.infer<typeof DevelopmentCleanupSelectionSchema>;
export type DevelopmentCleanupEvidence = z.infer<typeof DevelopmentCleanupEvidenceSchema>;

import { DevelopmentUsageOwnerRecordSchema } from '../developmentUsage';
import { DevelopmentEndingJobSchema, developmentEndingStored } from '../developmentEnding';

/** Derive a permit only from the owner's immutable ending and the actual durable Session copy. */
export function developmentCleanupEvidence(input: DevelopmentCleanupSelection, ownerRaw: unknown, jobRaw: unknown, storedRaw: unknown): DevelopmentCleanupEvidence {
  const selection = DevelopmentCleanupSelectionSchema.parse(input), original = DevelopmentUsageOwnerRecordSchema.parse(ownerRaw), job = DevelopmentEndingJobSchema.parse(jobRaw);
  const binding = original.binding;
  if (!binding || original.unsupported || original.closeReason !== job.firstReason || job.stage !== 'evidence-complete' || !job.stop || !job.closure
    || job.executionTaskId !== binding.runtimeTaskId || jsonHash(selection.identity) !== jsonHash(original.intent.identity)
    || selection.profileId !== original.intent.profileId || selection.profileRevision !== original.intent.profileRevision || selection.podUid !== binding.podUid) throw precondition('原开发受理尚无匹配的数字清理出口');
  const stored = developmentEndingStored(binding, storedRaw), receipt = stored.receipt;
  if (!stored.closure || !stored.drainReason || jsonHash(stored.closure) !== jsonHash(job.closure) || !receipt || receipt.phase !== 'finished'
    || receipt.result !== job.stop.receipt.result || receipt.lastSequence !== job.stop.receipt.lastSequence
    || receipt.finalThrough !== job.stop.receipt.finalThrough || receipt.interruption !== job.stop.receipt.interruption) throw precondition('原 Session 持久副本尚未闭合或终态已冲突');
  return DevelopmentCleanupEvidenceSchema.parse({ version: 1, selection, registration: binding, stop: job.stop, closure: stored.closure,
    owner: { payloadDigest: original.payloadDigest, firstReason: job.firstReason, acceptedAt: original.price.acceptedAt,
      profileId: original.price.profile.id, profileRevision: original.price.profile.revision, protocol: original.price.profile.protocol, priceBookRevision: original.price.priceBookRevision } });
}
