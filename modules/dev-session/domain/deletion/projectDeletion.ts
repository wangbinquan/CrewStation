import { ProjectDeletionEvidenceSchema, ProjectDeletionPhaseSchema } from '@crewstation/contracts';
import { z } from 'zod';
import { DevelopmentWorkCallbackSchema } from './work';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const DevelopmentDeletionScopeSchema = z.strictObject({
  contents: z.array(z.strictObject({ table: z.string().min(1), key: z.string().min(1), digest: hash, ownership: hash })),
  callbacks: z.array(DevelopmentWorkCallbackSchema), digest: hash, count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), compacted: z.boolean(),
}).superRefine((value, context) => {
  if (value.compacted && (value.contents.length || value.callbacks.length)) context.addIssue({ code: 'custom', message: '开发已压缩清理范围只能保留数量与摘要' });
});
export type DevelopmentDeletionScope = z.infer<typeof DevelopmentDeletionScopeSchema>;
export const DevelopmentDeletionProofsSchema = z.partialRecord(ProjectDeletionPhaseSchema, ProjectDeletionEvidenceSchema);
