import { z } from 'zod';
import { ResourceIdSchema } from '@crewstation/contracts';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const original = { version: z.literal(1), endingId: ResourceIdSchema, epochHash: digest };
export const DevelopmentParentRebuildBindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...original, kind: z.literal('pending-ending') }),
  z.strictObject({ ...original, kind: z.literal('completed-ending'), completionWitnessHash: digest,
    afterTransitionHash: digest, pvcUid: z.uuid(), claimRevision: z.number().int().positive() }),
]);
export type DevelopmentParentRebuildBinding = z.infer<typeof DevelopmentParentRebuildBindingSchema>;
/** Selects compensation for this new request/epoch; never carries old physical stop proof. */
export const DevelopmentParentRebuildSelectionSchema = z.strictObject({ version: z.literal(1), requestId: ResourceIdSchema,
  sourceEndingId: ResourceIdSchema, sourceEpochHash: digest });
