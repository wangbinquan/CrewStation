import { ProjectDeletionEvidenceSchema, ProjectDeletionPhaseSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { z } from 'zod';
import { RuntimeWorkCallbackSchema } from './work';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const contents = z.array(z.strictObject({ table: z.string().min(1), key: z.string().min(1), digest: hash, ownership: hash }));
export const RuntimeStoppedScopeSchema = z.strictObject({ contents, callbacks: z.array(RuntimeWorkCallbackSchema),
  digest: hash, count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).superRefine((scope, context) => {
  if (scope.contents.length !== scope.count || scope.callbacks.some((row) => !row.exited)
    || scope.digest !== jsonHash({ contents: scope.contents, callbacks: scope.callbacks }))
    context.addIssue({ code: 'custom', message: '运行停止快照缺少完整原内容、退出回执或摘要' });
});
export const RuntimeDeletionScopeSchema = z.strictObject({ contents, callbacks: z.array(RuntimeWorkCallbackSchema),
  digest: hash, count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), compacted: z.boolean(),
  stopped: RuntimeStoppedScopeSchema.nullable(),
}).superRefine((scope, context) => {
  if (scope.compacted && (scope.contents.length || scope.callbacks.length || scope.stopped !== null)
    || !scope.compacted && scope.contents.length !== scope.count)
    context.addIssue({ code: 'custom', message: '运行清理的原数量或最小压缩范围不符' });
});
export type RuntimeDeletionScope = z.infer<typeof RuntimeDeletionScopeSchema>;
export type RuntimeStoppedScope = z.infer<typeof RuntimeStoppedScopeSchema>;
export const RuntimeDeletionProofsSchema = z.partialRecord(ProjectDeletionPhaseSchema, ProjectDeletionEvidenceSchema);
