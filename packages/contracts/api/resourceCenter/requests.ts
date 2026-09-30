import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, UserIdSchema } from '../../ids';
import { ResourceTargetSchema, ResourceValuesSchema } from './actions';

export const ResourceRequestStateSchema = z.enum(['pending', 'approved', 'applying', 'applied', 'rejected', 'cancelled', 'needs-review', 'apply-failed']);
export const CreateResourceRequestSchema = z.object({
  target: ResourceTargetSchema, expectedRevision: z.string().min(1).max(120), values: ResourceValuesSchema,
  reason: z.string().trim().min(5).max(2000), requestKey: z.string().min(8).max(120),
}).strict();
export const DecideResourceRequestSchema = z.object({
  expectedVersion: z.number().int().min(1), approve: z.boolean(), expectedRevision: z.string().min(1).max(120),
  values: ResourceValuesSchema.optional(), reason: z.string().trim().min(1).max(2000),
}).strict();
export const ResourceRequestVersionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();
export const ResourceRequestDtoSchema = z.object({
  id: ResourceIdSchema, projectId: ProjectIdSchema, target: ResourceTargetSchema, targetName: z.string(),
  state: ResourceRequestStateSchema, version: z.number().int(), origin: z.enum(['owner-request', 'direct-admin']),
  baseRevision: z.string(), baseValues: ResourceValuesSchema, requestedValues: ResourceValuesSchema, approvedValues: ResourceValuesSchema.nullable(),
  reason: z.string(), requestedBy: UserIdSchema, requesterName: z.string().nullable(), decidedBy: UserIdSchema.nullable(), deciderName: z.string().nullable(), decisionReason: z.string().nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), appliedAt: z.iso.datetime().nullable(),
  effect: z.string().nullable(), failure: z.string().nullable(), requestKey: z.string(),
});
export const ResourceRequestPageSchema = z.object({ items: z.array(ResourceRequestDtoSchema), nextCursor: z.string().nullable() });
export const ResourceRequestQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), inFlight: z.enum(['true', 'false']).optional() }).strict();
export type CreateResourceRequest = z.infer<typeof CreateResourceRequestSchema>;
export type DecideResourceRequest = z.infer<typeof DecideResourceRequestSchema>;
export type ResourceRequestDto = z.infer<typeof ResourceRequestDtoSchema>;
export type ResourceRequestState = z.infer<typeof ResourceRequestStateSchema>;
export type ResourceRequestPage = z.infer<typeof ResourceRequestPageSchema>;
export type ResourceRequestQuery = z.infer<typeof ResourceRequestQuerySchema>;
