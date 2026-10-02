import { z } from 'zod';
import { ResourceIdSchema, WorkloadConsumerSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';

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
