import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DevelopmentAgentIdentitySchema, DevelopmentStartIntentSchema, DevelopmentUsageDrainReasonSchema, DevelopmentUsageRegistrationSchema, ServiceIdSchema, TraceIdSchema } from '@crewstation/contracts';

export const DevelopmentUsagePreparationSchema = z.strictObject({
  intent: DevelopmentStartIntentSchema,
  context: z.strictObject({ serviceId: ServiceIdSchema, traceId: TraceIdSchema, branch: z.string().max(1024).nullable() }),
}).refine((value) => value.intent.launch.protocol !== 'terminal', '开发 headless 必须使用模型协议');
const price = z.strictObject({
  identity: DevelopmentAgentIdentitySchema,
  profile: z.strictObject({ id: DevelopmentStartIntentSchema.shape.profileId, revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), protocol: z.enum(['opencode', 'claude-code']) }),
  acceptedAt: z.iso.datetime(), priceBookRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const DevelopmentUsagePreparedSchema = DevelopmentUsagePreparationSchema.safeExtend({
  digestNonce: z.string().regex(/^[a-f0-9]{64}$/), payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), price,
}).superRefine((value, ctx) => {
  const intent = value.intent;
  if (JSON.stringify(value.price.identity) !== JSON.stringify(intent.identity) || value.price.profile.id !== intent.profileId || value.price.profile.revision !== intent.profileRevision || value.price.profile.protocol !== intent.launch.protocol)
    ctx.addIssue({ code: 'custom', message: '人民币受理必须绑定原开发身份和算力修订' });
  if (value.payloadDigest !== developmentOwnerIntentDigest(value)) ctx.addIssue({ code: 'custom', message: '开发稳定摘要不符合原意图' });
});
export const DevelopmentUsageOwnerRecordSchema = DevelopmentUsagePreparedSchema.safeExtend({
  binding: DevelopmentUsageRegistrationSchema.nullable(), unsupported: z.boolean(), closeReason: DevelopmentUsageDrainReasonSchema.nullable(),
}).superRefine((value, ctx) => {
  const binding = value.binding;
  if (binding && (value.unsupported || binding.key.payloadDigest !== value.payloadDigest || JSON.stringify(binding.identity) !== JSON.stringify(value.intent.identity) || binding.profileId !== value.intent.profileId || binding.profileRevision !== value.intent.profileRevision))
    ctx.addIssue({ code: 'custom', message: '原 journal 绑定不能替换开发受理或未支持状态' });
});
/** Same normalized shape and byte order as Runner: credentials never enter this digest. */
export function developmentOwnerIntentDigest(input: { intent: unknown; digestNonce: string }): string {
  const intent = DevelopmentStartIntentSchema.parse(input.intent);
  return createHash('sha256').update(input.digestNonce).update('\n').update(JSON.stringify(intent)).digest('hex');
}
