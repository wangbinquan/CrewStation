import { z } from 'zod';
import { ManifestSchema } from './manifest';

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`));
/** The complete original envelope is checked separately from the current producer contract. */
export const HistoricalReleaseRegisteredInventorySchema = z.object({
  occurredAt: z.iso.datetime(), traceId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  projectId: prefixed('prj'), serviceId: prefixed('svc'), releaseId: prefixed('rel'), tag: z.string(), commitSha: z.string(),
  manifest: ManifestSchema, openapiDocument: z.unknown().optional(),
}).strict();
