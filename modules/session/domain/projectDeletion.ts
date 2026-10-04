import { ProjectDeletionEvidenceSchema, ProjectDeletionPhaseSchema, ResourceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { z } from 'zod';
import { SessionProcessSchema } from './deletion/process';
import { SessionWorkBirthSchema } from './deletion/work';
import { SessionStopSnapshotSchema } from './deletion/stopSnapshot';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const SessionBirthSchema = z.strictObject({ id: ResourceIdSchema, taskId: TaskIdSchema, replica: z.string().url(), at: z.iso.datetime(), exitKeyHash: hash, identity: hash, process: SessionProcessSchema.optional() });
export const SessionDeletionScopeSchema = z.strictObject({ taskKeys: z.array(z.string().min(1)), births: z.array(SessionBirthSchema),
  callbacks: z.array(SessionWorkBirthSchema).optional(), stopped: SessionStopSnapshotSchema.optional(),
  digest: hash, count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), compacted: z.boolean() }).superRefine((scope, context) => {
  if (scope.compacted && (scope.taskKeys.length || scope.births.length || scope.callbacks?.length)) context.addIssue({ code: 'custom', message: '已压缩会话清理范围只能保留摘要与数量' });
});
export const SessionDeletionProofsSchema = z.partialRecord(ProjectDeletionPhaseSchema, ProjectDeletionEvidenceSchema);
