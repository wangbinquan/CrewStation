import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, TaskIdSchema, WorkloadConsumerSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { developmentParentTransitionHash } from './parentEnding';
import { sealedDevelopmentParentProjection } from './parentProjection';
import { projectEnvironment } from '../ledgerProjection';
import type { TaskEnvironment } from '../taskEnvironment';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const DevelopmentParentCompletionWitnessSchema = z.strictObject({
  version: z.literal(1), endingId: ResourceIdSchema, outcome: z.enum(['released', 'compensation', 'rebuild-published']),
  epochHash: digest, podName: z.string().min(1), podUid: z.uuid(), pvcName: z.string().min(1), pvcUid: z.uuid(),
  originalRenderStart: z.number().int().positive().nullable(), materialsHash: digest,
  consumer: WorkloadConsumerSchema, stopProofHash: digest,
  membership: z.strictObject({ revision: z.literal(1), count: z.number().int().nonnegative(), digest }),
  beforeTransitionHash: digest, afterTransitionHash: digest, runnerTokenHash: digest, completedAt: z.iso.datetime(),
}).superRefine((value, context) => {
  if (value.consumer.id !== value.endingId || value.consumer.purpose !== 'development' || value.consumer.finalization !== null
    || value.consumer.podName !== value.podName || value.consumer.volumeUid !== value.pvcUid)
    context.addIssue({ code: 'custom', message: '原完成见证必须绑定独立父观察身份' });
});
export type DevelopmentParentCompletionWitness = z.infer<typeof DevelopmentParentCompletionWitnessSchema>;
export function originalParentCompletion(raw: unknown, ending: { id: string; epochHash: string; completionWitness: unknown }) {
  const witness = DevelopmentParentCompletionWitnessSchema.parse(raw);
  if (witness.endingId !== ending.id || witness.epochHash !== ending.epochHash || jsonHash(witness) !== jsonHash(ending.completionWitness))
    throw precondition('原父完成見证不可替换');
  return witness;
}

export const DevelopmentParentRetentionTransitionSchema = z.strictObject({
  version: z.literal(1), endingId: ResourceIdSchema, epochHash: digest, sourceCompletionWitnessHash: digest,
  beforeTransitionHash: digest, afterTransitionHash: digest, runnerTokenHash: digest, retiredAt: z.iso.datetime(),
  resource: z.strictObject({ id: ResourceIdSchema, projectId: ProjectIdSchema, ownerRef: TaskIdSchema,
    kind: z.literal('dev-workspace'), generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    specHash: digest, retainUntil: z.null(), releaseReason: z.literal('retention-expired') }),
});
export type DevelopmentParentRetentionTransition = z.infer<typeof DevelopmentParentRetentionTransitionSchema>;
type CompletionTransitionSource = Parameters<typeof sealedDevelopmentParentProjection>[2] & { readonly completionWitness: unknown };

/** The expected original spec comes from the same sealed Task/ending source, never an external callback. */
export function developmentParentRetentionSpecHash(environment: TaskEnvironment, ending: CompletionTransitionSource): string {
  const { workload } = sealedDevelopmentParentProjection(projectEnvironment(environment), environment, ending);
  return jsonHash({ children: workload.children, ...(workload.reclaim ? { reclaim: workload.reclaim } : {}), ...workload.render });
}

/** Legal D9 retirement is separately witnessed; the original completion and raw transition hash stay immutable. */
export function requireParentCompletionTransition(environment: TaskEnvironment, ending: CompletionTransitionSource, witness: DevelopmentParentCompletionWitness): void {
  const actualHash = developmentParentTransitionHash(environment);
  if (!Object.hasOwn(ending.progress, 'retentionTransition')) {
    if (witness.afterTransitionHash !== actualHash) throw precondition('原父完成转换已变化');
    return;
  }
  const receipt = DevelopmentParentRetentionTransitionSchema.parse(ending.progress['retentionTransition']);
  const original = { ...environment, state: 'failed' as const };
  if (environment.state !== 'released' || environment.native || environment.kind !== 'dev-session' || witness.outcome !== 'compensation'
    || receipt.endingId !== ending.id || receipt.epochHash !== ending.epochHash || receipt.sourceCompletionWitnessHash !== jsonHash(witness)
    || receipt.beforeTransitionHash !== witness.afterTransitionHash || receipt.afterTransitionHash !== actualHash
    || receipt.runnerTokenHash !== witness.runnerTokenHash || receipt.runnerTokenHash !== environment.runnerTokenHash
    || receipt.resource.id !== String(environment.id) || receipt.resource.ownerRef !== environment.id || receipt.resource.projectId !== environment.projectId
    || developmentParentTransitionHash(original) !== witness.afterTransitionHash || receipt.resource.specHash !== developmentParentRetentionSpecHash(original, ending)
    || Date.parse(receipt.retiredAt) < Date.parse(witness.completedAt)) throw precondition('原父保留期接续与实际转换不一致');
}
