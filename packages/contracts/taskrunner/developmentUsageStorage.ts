import { z } from 'zod';
import { TaskIdSchema } from '../ids';
import { DevelopmentUsageKeySchema, DevelopmentUsageReceiptSchema } from './developmentUsage';

const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Owner-persisted binding, not a fabricated Runner acceptance receipt. Contains no prompt or credentials. */
export const DevelopmentUsageRegistrationSchema = z.strictObject({ key: DevelopmentUsageKeySchema, podUid: DevelopmentUsageReceiptSchema.shape.podUid, identity: DevelopmentUsageReceiptSchema.shape.identity, profileId: DevelopmentUsageReceiptSchema.shape.profileId, profileRevision: DevelopmentUsageReceiptSchema.shape.profileRevision, runtimeTaskId: TaskIdSchema }).superRefine((value, ctx) => {
  if (value.runtimeTaskId !== value.key.executionId || value.identity.executionId !== value.key.executionId) ctx.addIssue({ code: 'custom', message: '数字副本必须绑定实际开发执行环境' });
});
export const DevelopmentUsageDrainReasonSchema = z.enum(['completed', 'error', 'cancelled', 'workspace-released', 'forced-release', 'environment-lost']);
/** A timeout or temporary PG failure is deliberately absent: neither proves data loss. */
export const DevelopmentUsageLossSchema = z.strictObject({
  key: DevelopmentUsageKeySchema, podUid: z.string().min(1).max(128),
  reason: z.enum(['pod-lost', 'journal-replaced', 'journal-corrupt', 'journal-unavailable', 'workspace-released', 'forced-release']),
});
export const DevelopmentUsageClosureSchema = z.strictObject({
  status: z.enum(['complete', 'interrupted']), persistedThrough: sequence, reportedThrough: sequence.nullable(),
  missingAfter: sequence.nullable(), missingThrough: sequence.nullable(), tailUnknown: z.boolean(),
  reason: z.string().min(1).max(128).nullable(), closedAt: z.iso.datetime(),
});
export const StoredDevelopmentUsageSchema = z.strictObject({
  registration: DevelopmentUsageRegistrationSchema, receipt: DevelopmentUsageReceiptSchema.nullable(),
  persistedThrough: sequence, runnerAcknowledgedThrough: sequence, sourceAcknowledgedThrough: sequence, offeredThrough: sequence,
  complete: z.boolean(), drainReason: DevelopmentUsageDrainReasonSchema.nullable(), loss: DevelopmentUsageLossSchema.nullable(), closure: DevelopmentUsageClosureSchema.nullable(),
}).superRefine((value, ctx) => {
  const r = value.registration, receipt = value.receipt;
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (value.runnerAcknowledgedThrough > value.persistedThrough || value.sourceAcknowledgedThrough > value.offeredThrough || value.offeredThrough > value.persistedThrough) invalid('开发数字确认不能越过实际连续复制水位');
  if (receipt && (JSON.stringify(receipt.key) !== JSON.stringify(r.key) || receipt.podUid !== r.podUid || JSON.stringify(receipt.identity) !== JSON.stringify(r.identity) || receipt.profileId !== r.profileId || receipt.profileRevision !== r.profileRevision)) invalid('数字副本回执不能替换原归属');
  if ((!receipt && value.persistedThrough > 0) || (receipt && value.persistedThrough > receipt.lastSequence)) invalid('复制水位不能越过原回执末尾');
  if (receipt && receipt.acknowledgedSequence > value.runnerAcknowledgedThrough) invalid('Runner 回执确认必须已登记到副本');
  if (value.complete && (!receipt || receipt.finalThrough !== value.persistedThrough)) invalid('完整副本必须到达原持久终态');
  if (value.loss && (JSON.stringify(value.loss.key) !== JSON.stringify(r.key) || value.loss.podUid !== r.podUid)) invalid('数字缺口必须绑定原来源');
  const closure = value.closure;
  if (closure && (!value.drainReason || closure.persistedThrough !== value.persistedThrough || closure.reportedThrough !== (receipt?.lastSequence ?? null) || (closure.status === 'complete') !== value.complete || closure.tailUnknown === value.complete)) invalid('排空出口必须匹配实际复制状态和生命周期请求');
  if (closure) {
    const reported = receipt?.lastSequence ?? null;
    const missing = !value.complete && (reported === null || value.persistedThrough < reported);
    if (closure.missingAfter !== (missing ? value.persistedThrough : null) || closure.missingThrough !== (missing ? reported : null)) invalid('排空缺口必须保留实际复制与原回执末尾');
    if (value.complete ? closure.reason !== null : (!value.loss && (!receipt?.interruption || value.persistedThrough < receipt.lastSequence)) || (closure.reason !== value.loss?.reason && closure.reason !== receipt?.interruption)) invalid('中断排空需要原来源不可取回或可读末尾已复制的证明');
  }
});
/** Independent actual-execution lookup; absence is not a usage/stop/cleanup proof. */
export const DevelopmentUsageLookupSchema = z.discriminatedUnion('kind', [
  z.strictObject({ version: z.literal(1), runtimeTaskId: TaskIdSchema, kind: z.literal('absent') }),
  z.strictObject({ version: z.literal(1), runtimeTaskId: TaskIdSchema, kind: z.literal('registered'), stored: StoredDevelopmentUsageSchema }),
]).superRefine((value, ctx) => {
  if (value.kind === 'registered' && value.stored.registration.runtimeTaskId !== value.runtimeTaskId)
    ctx.addIssue({ code: 'custom', message: '登记查询必须属于同一实际执行环境' });
});
export type DevelopmentUsageLookup = z.infer<typeof DevelopmentUsageLookupSchema>;
export type DevelopmentUsageRegistration = z.infer<typeof DevelopmentUsageRegistrationSchema>;
export type DevelopmentUsageDrainReason = z.infer<typeof DevelopmentUsageDrainReasonSchema>;
export type DevelopmentUsageLoss = z.infer<typeof DevelopmentUsageLossSchema>;
export type DevelopmentUsageClosure = z.infer<typeof DevelopmentUsageClosureSchema>;
export type StoredDevelopmentUsage = z.infer<typeof StoredDevelopmentUsageSchema>;
