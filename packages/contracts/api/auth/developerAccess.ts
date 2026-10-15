import { z } from 'zod';
import { ResourceIdSchema, UserIdSchema } from '../../ids';
import { pageOf } from '../envelope';

export const DeveloperAccessStateSchema = z.enum(['pending', 'approved', 'rejected']);
export const RequestDeveloperAccessSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const ReviewDeveloperAccessSchema = z.object({ decision: z.enum(['approved', 'rejected']), expectedRevision: z.number().int().min(1), note: z.string().trim().min(1).max(500) }).strict();
export const DeveloperAccessQuerySchema = z.object({ state: DeveloperAccessStateSchema.default('pending'), cursor: ResourceIdSchema.optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const DeveloperAccessRequestDtoSchema = z.object({
  id: ResourceIdSchema, userId: UserIdSchema, userName: z.string(), userEmail: z.string(), reason: z.string(), state: DeveloperAccessStateSchema,
  revision: z.number().int().min(1), createdAt: z.iso.datetime(), reviewedAt: z.iso.datetime().nullable(), reviewerId: UserIdSchema.nullable(), note: z.string().nullable(),
}).strict();
export const DeveloperAccessPageSchema = pageOf(DeveloperAccessRequestDtoSchema);
export const MyDeveloperAccessSchema = z.object({ request: DeveloperAccessRequestDtoSchema.nullable() }).strict();
export type RequestDeveloperAccess = z.infer<typeof RequestDeveloperAccessSchema>;
export type ReviewDeveloperAccess = z.infer<typeof ReviewDeveloperAccessSchema>;
export type DeveloperAccessQuery = z.infer<typeof DeveloperAccessQuerySchema>;
export type DeveloperAccessRequestDto = z.infer<typeof DeveloperAccessRequestDtoSchema>;
export type DeveloperAccessPage = z.infer<typeof DeveloperAccessPageSchema>;
