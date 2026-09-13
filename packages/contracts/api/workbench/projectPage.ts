import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../../ids';
import { ManifestKindSchema } from '../../manifest/serviceSpec';
import { ProjectDtoSchema, ProjectStateSchema } from '../project';

export const ProjectPageQuerySchema = z.object({
  q: z.string().trim().max(120).default(''),
  state: ProjectStateSchema.optional(), ownerUserId: UserIdSchema.optional(),
  kind: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v,
    z.array(ManifestKindSchema).min(1).max(3).default(['DigitalWorker']).transform((kinds) => [...new Set(kinds)].sort())),
  limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(2048).optional(),
});
export const ProjectPageEntrySchema = z.object({
  project: ProjectDtoSchema, role: z.enum(['admin', 'owner', 'developer', 'tester']), ownerName: z.string().optional(),
});
export const ProjectPageSchema = z.object({ items: z.array(ProjectPageEntrySchema).max(50), nextCursor: z.string().optional() });
export const ProjectPageIdsSchema = z.array(ProjectIdSchema).max(50);
export type ProjectPageQuery = z.infer<typeof ProjectPageQuerySchema>;
export type ProjectPageEntry = z.infer<typeof ProjectPageEntrySchema>;
export type ProjectPage = z.infer<typeof ProjectPageSchema>;
