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

export function requireDevelopmentCleanupEvidence(raw: unknown, selection: DevelopmentCleanupSelection): DevelopmentCleanupEvidence {
  const evidence = DevelopmentCleanupEvidenceSchema.parse(raw);
  if (jsonHash(evidence.selection) !== jsonHash(selection)) throw precondition('清理凭证不属于当前原执行选择');
  return evidence;
}
