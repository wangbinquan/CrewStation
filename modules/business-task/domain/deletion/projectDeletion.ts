import { ProjectDeletionEvidenceSchema, ProjectDeletionPhaseSchema } from '@crewstation/contracts';
import { z } from 'zod';
import { BusinessWorkCallbackSchema } from './work';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const BusinessDeletionScopeSchema = z.strictObject({
  contents: z.array(z.strictObject({ table: z.string().min(1), key: z.string().min(1), digest: hash, ownership: hash })),
  callbacks: z.array(BusinessWorkCallbackSchema), digest: hash, count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), compacted: z.boolean(),
}).superRefine((scope, context) => {
  if (scope.compacted && (scope.contents.length || scope.callbacks.length)) context.addIssue({ code: 'custom', message: '已压缩业务清理范围只能保留摘要与数量' });
});
export type BusinessDeletionScope = z.infer<typeof BusinessDeletionScopeSchema>;
export const BusinessDeletionProofsSchema = z.partialRecord(ProjectDeletionPhaseSchema, ProjectDeletionEvidenceSchema);
