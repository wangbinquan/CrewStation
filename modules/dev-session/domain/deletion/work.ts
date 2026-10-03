import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const DevelopmentWorkOriginSchema = z.strictObject({ complete: z.literal(true), id: ResourceIdSchema,
  scope: z.literal('project'), projectIds: z.array(ProjectIdSchema).length(1), revision: digest });
export const DevelopmentWorkPodSchema = z.strictObject({ podUid: z.uuid(), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253) });
export const DevelopmentWorkProcessSchema = DevelopmentWorkPodSchema.extend({ containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/),
  pid: z.number().int().positive(), pidNamespace: z.string().regex(/^[0-9]+$/), bootId: z.uuid(), startTicks: z.string().regex(/^[0-9]+$/) });
export const DevelopmentWorkCallbackSchema = z.strictObject({ id: ResourceIdSchema, projectId: ProjectIdSchema,
  originKind: z.enum(['project', 'task', 'cluster-operation']), originKey: z.string().min(1), originId: ResourceIdSchema,
  kind: z.enum(['project-api', 'task-api', 'agent-dispatch', 'native-dispatch', 'reminder', 'usage', 'ending', 'effect']),
  reference: ResourceIdSchema, consumerId: ResourceIdSchema, inputDigest: digest, originRevision: digest,
  backendPid: z.number().int().positive(), process: DevelopmentWorkProcessSchema, exitKeyDigest: digest,
  exited: z.boolean(), exitDigest: digest.nullable(), recoveryDigest: digest.nullable(),
}).superRefine((value, context) => {
  if (value.exited !== !!value.exitDigest || value.recoveryDigest && !value.exited
    || value.exited && value.exitDigest !== developmentWorkIdentity(value, value.recoveryDigest ?? undefined))
    context.addIssue({ code: 'custom', message: '开发原回调退出事实不完整' });
});
export type DevelopmentWorkCallback = z.infer<typeof DevelopmentWorkCallbackSchema>;
export type DevelopmentWorkPod = z.infer<typeof DevelopmentWorkPodSchema>;
export type DevelopmentWorkProcess = z.infer<typeof DevelopmentWorkProcessSchema>;
export type DevelopmentWorkInput = Pick<DevelopmentWorkCallback, 'projectId' | 'originKind' | 'originKey' | 'kind' | 'reference' | 'inputDigest'>;
export function developmentWorkIdentity(value: DevelopmentWorkCallback, recoveryDigest?: string): string {
  const { exited: _exited, exitDigest: _exit, recoveryDigest: _recovery, ...birth } = value;
  return jsonHash({ ...birth, ...(recoveryDigest ? { recoveryDigest } : {}) });
}
