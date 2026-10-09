import { z } from 'zod';
import { ReleaseJourneySnapshotSchema, ReleaseJourneyStatusSchema, ReleaseJourneyVerificationSchema, ReleaseTargetRevisionSchema, ResourceIdSchema, TrafficSwitchDtoSchema } from '@crewstation/contracts';

export const ReleaseJourneySchema = z.object({
  id: ResourceIdSchema, snapshot: ReleaseJourneySnapshotSchema, status: ReleaseJourneyStatusSchema,
  revision: z.number().int().nonnegative(), updatedAt: z.iso.datetime(), targetRevision: ReleaseTargetRevisionSchema.optional(),
  verification: ReleaseJourneyVerificationSchema.optional(),
  verificationIntent: z.object({ requestKey: z.string().min(1).max(128), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  launch: z.object({ requestKey: z.string().min(1).max(128).optional(), digest: z.string().regex(/^[a-f0-9]{64}$/),
    targetRevision: ReleaseTargetRevisionSchema, physical: z.enum(['blue', 'green']), operation: TrafficSwitchDtoSchema }).strict().optional(),
}).strict();
