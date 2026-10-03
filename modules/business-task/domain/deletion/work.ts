import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const BusinessWorkOriginSchema = z.object({ complete: z.literal(true), id: ResourceIdSchema, scope: z.literal('project'),
  projectIds: z.array(ProjectIdSchema).length(1), revision: digest }).strict();
export const BusinessWorkPodSchema = z.object({ podUid: z.uuid(), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253) }).strict();
export const BusinessWorkProcessSchema = BusinessWorkPodSchema.extend({ containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/),
  pid: z.number().int().positive(), pidNamespace: z.string().regex(/^[0-9]+$/), bootId: z.uuid(), startTicks: z.string().regex(/^[0-9]+$/) }).strict();
export const BusinessWorkCallbackSchema = z.object({ id: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ResourceIdSchema,
  kind: z.enum(['task-admission', 'subtask', 'projection', 'cancellation', 'lifecycle', 'message', 'agent-cleanup', 'service-api', 'legacy-api', 'contract']), reference: ResourceIdSchema, consumerId: ResourceIdSchema, inputDigest: digest, originRevision: digest,
  backendPid: z.number().int().positive(), process: BusinessWorkProcessSchema, exitKeyDigest: digest,
  exited: z.boolean(), exitDigest: digest.nullable(), recoveryDigest: digest.nullable(),
}).strict().superRefine((record, context) => {
  if (record.exited !== !!record.exitDigest || record.recoveryDigest && !record.exited
    || record.exited && record.exitDigest !== businessWorkIdentity(record, record.recoveryDigest ?? undefined))
    context.addIssue({ code: 'custom', message: '业务原回调退出事实不完整' });
});
export type BusinessWorkPod = z.infer<typeof BusinessWorkPodSchema>;
export type BusinessWorkProcess = z.infer<typeof BusinessWorkProcessSchema>;
export type BusinessWorkCallback = z.infer<typeof BusinessWorkCallbackSchema>;
export type BusinessWorkInput = Pick<BusinessWorkCallback, 'projectId' | 'serviceId' | 'kind' | 'reference' | 'inputDigest'>;
export function businessWorkIdentity(record: BusinessWorkCallback, recoveryDigest?: string): string {
  const { exited: _exited, exitDigest: _exit, recoveryDigest: _recovery, ...birth } = record;
  return jsonHash({ ...birth, ...(recoveryDigest ? { recoveryDigest } : {}) });
}
