import { ProjectDeletionEvidenceSchema, ProjectDeletionPhaseSchema } from '@crewstation/contracts';
import { z } from 'zod';
import { jsonHash } from '@crewstation/kernel';
import { DevelopmentWorkCallbackSchema } from './work';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const contents = z.array(z.strictObject({ table: z.string().min(1), key: z.string().min(1), digest: hash, ownership: hash }));
export const DevelopmentStoppedScopeSchema = z.strictObject({ contents, callbacks: z.array(DevelopmentWorkCallbackSchema),
  digest: hash, count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).superRefine((scope, context) => {
  if (scope.contents.length !== scope.count || scope.callbacks.some((row) => !row.exited)
    || scope.digest !== jsonHash({ contents: scope.contents, callbacks: scope.callbacks }))
    context.addIssue({ code: 'custom', message: '开发停止快照的原内容、退出事实或摘要不完整' });
});
export const DevelopmentDeletionScopeSchema = z.strictObject({
  contents,
  callbacks: z.array(DevelopmentWorkCallbackSchema), digest: hash, count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), compacted: z.boolean(),
  stopped: DevelopmentStoppedScopeSchema.nullable().default(null),
}).superRefine((value, context) => {
  if (value.compacted && (value.contents.length || value.callbacks.length || value.stopped)) context.addIssue({ code: 'custom', message: '开发已压缩清理范围只能保留数量与摘要' });
});
export type DevelopmentDeletionScope = z.infer<typeof DevelopmentDeletionScopeSchema>;
export const DevelopmentDeletionProofsSchema = z.partialRecord(ProjectDeletionPhaseSchema, ProjectDeletionEvidenceSchema);
