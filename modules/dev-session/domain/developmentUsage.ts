import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DevelopmentObservedIdentitySchema, DevelopmentStartIntentSchema, DevelopmentUsageDrainReasonSchema, DevelopmentUsageRegistrationSchema, ServiceIdSchema, TraceIdSchema, RunnerHelloSchema } from '@crewstation/contracts';

export const DevelopmentUsagePreparationSchema = z.strictObject({
  intent: DevelopmentStartIntentSchema,
  legacyFallbackAllowed: z.boolean().optional(),
  context: z.strictObject({ serviceId: ServiceIdSchema, traceId: TraceIdSchema, branch: z.string().max(1024).nullable() }),
}).refine((value) => value.intent.launch.protocol !== 'terminal', '开发 headless 必须使用模型协议');
const price = z.strictObject({
  identity: DevelopmentObservedIdentitySchema,
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
  capabilityPodUid: DevelopmentUsageRegistrationSchema.shape.podUid.optional(),
  unsupportedProof:z.strictObject({version:z.literal(1),podUid:DevelopmentUsageRegistrationSchema.shape.podUid,capabilities:RunnerHelloSchema.shape.capabilities}).optional(),
}).superRefine((value, ctx) => {
  const binding = value.binding;
  if(value.unsupportedProof && (!value.unsupported || value.binding || value.capabilityPodUid || value.intent.identity.sourceKind!=='development-cli' || value.unsupportedProof.capabilities.developmentNativeCliV2===2 || value.unsupportedProof.capabilities.developmentCliFenceV1===1)) ctx.addIssue({code:'custom',message:'旧 CLI 能力证明必须属于从未声称数字支持的原 Pod'});
  if (value.capabilityPodUid && (value.unsupported || (binding && binding.podUid !== value.capabilityPodUid)))
    ctx.addIssue({ code: 'custom', message: '已观察数字能力的原 Pod 不能降级或替换' });
  if (binding && (value.unsupported || binding.key.payloadDigest !== value.payloadDigest || JSON.stringify(binding.identity) !== JSON.stringify(value.intent.identity) || binding.profileId !== value.intent.profileId || binding.profileRevision !== value.intent.profileRevision))
    ctx.addIssue({ code: 'custom', message: '原 journal 绑定不能替换开发受理或未支持状态' });
});
/** Same normalized shape and byte order as Runner: credentials never enter this digest. */
export function developmentOwnerIntentDigest(input: { intent: unknown; digestNonce: string }): string {
  const intent = DevelopmentStartIntentSchema.parse(input.intent);
  return createHash('sha256').update(input.digestNonce).update('\n').update(JSON.stringify(intent)).digest('hex');
}
