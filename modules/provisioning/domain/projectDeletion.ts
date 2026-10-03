import { ProjectDeletionEvidenceSchema, ProjectDeletionPhaseSchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const callback = z.object({ id: ResourceIdSchema, identity: hash }).strict();
const content = z.object({ channel: z.enum(['queue', 'event']), id: z.string().regex(/^[1-9][0-9]*$/), birthDigest: hash,
  contentDigest: hash, ownershipDigest: hash, projectIds: z.array(ProjectIdSchema).length(1), deadLetters: z.number().int().nonnegative() }).strict();
export const ProvisioningDeletionScopeSchema = z.object({ callbacks: z.array(callback), contents: z.array(content), count: z.number().int().nonnegative(),
  originDigest: hash, compacted: z.boolean() }).strict().superRefine((value, context) => {
  if (value.compacted ? value.callbacks.length !== 0 || value.contents.length !== 0
    : value.count !== value.callbacks.length + value.contents.reduce((n, row) => n + 1 + row.deadLetters, 0)
      || value.originDigest !== jsonHash({ callbacks: value.callbacks, contents: value.contents }))
    context.addIssue({ code: 'custom', message: '开通清理最小原范围不完整' });
});
export const ProvisioningDeletionProofsSchema = z.partialRecord(ProjectDeletionPhaseSchema, ProjectDeletionEvidenceSchema);
export type ProvisioningDeletionScope = z.infer<typeof ProvisioningDeletionScopeSchema>;
export type ProvisioningDeletionProofs = z.infer<typeof ProvisioningDeletionProofsSchema>;
