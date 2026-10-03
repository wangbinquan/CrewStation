import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const RuntimeWorkOriginSchema = z.strictObject({ complete: z.literal(true), id: ResourceIdSchema,
  scope: z.enum(['project', 'platform']), projectIds: z.array(ProjectIdSchema), revision: digest,
}).superRefine((value, context) => {
  if (value.projectIds.length !== (value.scope === 'project' ? 1 : 0)) context.addIssue({ code: 'custom', message: '运行回调原来源范围不完整' });
});
export const RuntimeWorkPodSchema = z.strictObject({ podUid: z.uuid(), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253) });
export const RuntimeWorkProcessSchema = RuntimeWorkPodSchema.extend({ containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/),
  pid: z.number().int().positive(), pidNamespace: z.string().regex(/^[0-9]+$/), bootId: z.uuid(), startTicks: z.string().regex(/^[0-9]+$/) });
export const RuntimeWorkGrantSchema = z.strictObject({ operationId: ResourceIdSchema, generation: z.number().int().positive(),
  phase: z.enum(['stop', 'purge', 'prove', 'namespace', 'metadata', 'verify']),
});
export const RuntimeWorkCallbackSchema = z.strictObject({ id: ResourceIdSchema, projectId: ProjectIdSchema,
  originKind: z.enum(['project', 'service', 'task', 'rebuild', 'parent-ending']), originKey: z.string().min(1), originId: ResourceIdSchema,
  kind: z.enum(['project-api', 'service-api', 'task-api', 'native-job', 'rebuild-job', 'parent-ending', 'reconcile', 'observe-startup', 'archive', 'ledger-resync', 'parent-recovery', 'deletion', 'effect']),
  reference: ResourceIdSchema, consumerId: ResourceIdSchema, inputDigest: digest, originRevision: digest,
  backendPid: z.number().int().positive(), process: RuntimeWorkProcessSchema, exitKeyDigest: digest, grant: RuntimeWorkGrantSchema.nullable(),
  exited: z.boolean(), exitDigest: digest.nullable(), recoveryDigest: digest.nullable(),
}).superRefine((value, context) => {
  if (value.exited !== !!value.exitDigest || value.recoveryDigest && !value.exited
    || value.exited && value.exitDigest !== runtimeWorkIdentity(value, value.recoveryDigest ?? undefined)
    || value.kind === 'deletion' && !value.grant || value.grant && !['deletion', 'effect'].includes(value.kind))
    context.addIssue({ code: 'custom', message: '运行原回调退出或删除许可事实不完整' });
});
export type RuntimeWorkCallback = z.infer<typeof RuntimeWorkCallbackSchema>;
export type RuntimeWorkPod = z.infer<typeof RuntimeWorkPodSchema>;
export type RuntimeWorkProcess = z.infer<typeof RuntimeWorkProcessSchema>;
export type RuntimeWorkInput = Pick<RuntimeWorkCallback, 'projectId' | 'originKind' | 'originKey' | 'kind' | 'reference' | 'inputDigest'>;
export function runtimeWorkIdentity(value: RuntimeWorkCallback, recoveryDigest?: string): string {
  const { exited: _exited, exitDigest: _exit, recoveryDigest: _recovery, ...birth } = value;
  return jsonHash({ ...birth, ...(recoveryDigest ? { recoveryDigest } : {}) });
}
