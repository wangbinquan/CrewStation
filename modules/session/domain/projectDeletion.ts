import { ProjectDeletionEvidenceSchema, ProjectDeletionPhaseSchema, ResourceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const SessionProcessSchema = z.strictObject({ podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/), nodeUid: z.uuid(), nodeName: z.string().min(1).max(253),
  pid: z.number().int().positive(), pidNamespace: z.string().regex(/^[0-9]+$/), bootId: z.uuid(), startTicks: z.string().regex(/^[0-9]+$/) });
export const SessionBirthSchema = z.strictObject({ id: ResourceIdSchema, taskId: TaskIdSchema, replica: z.string().url(), at: z.iso.datetime(), exitKeyHash: hash, identity: hash, process: SessionProcessSchema.optional() });
export const SessionDeletionScopeSchema = z.strictObject({ taskKeys: z.array(z.string().min(1)), births: z.array(SessionBirthSchema),
  digest: hash, count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), compacted: z.boolean() }).superRefine((scope, context) => {
  if (scope.compacted && (scope.taskKeys.length || scope.births.length)) context.addIssue({ code: 'custom', message: '已压缩会话清理范围只能保留摘要与数量' });
});
export const SessionDeletionProofsSchema = z.partialRecord(ProjectDeletionPhaseSchema, ProjectDeletionEvidenceSchema);
