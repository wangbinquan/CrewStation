import { z } from 'zod';
import { ProjectIdSchema } from '../../ids';

export const NamespaceQuotaSchema = z.object({ requestsCpu: z.number().finite().min(0.1).max(100000), requestsMemoryGiB: z.number().finite().min(0.125).max(1000000), pods: z.number().int().min(1).max(100000), persistentVolumeClaims: z.number().int().min(0).max(100000) }).strict();
export const ProjectNamespaceQuotaDtoSchema = z.object({ projectId: ProjectIdSchema, revision: z.number().int().min(0), quota: NamespaceQuotaSchema, updatedAt: z.iso.datetime().nullable() });
export const SaveProjectNamespaceQuotaSchema = z.object({ expectedRevision: z.number().int().min(0), quota: NamespaceQuotaSchema }).strict();
export type NamespaceQuota = z.infer<typeof NamespaceQuotaSchema>;
export type ProjectNamespaceQuotaDto = z.infer<typeof ProjectNamespaceQuotaDtoSchema>;
export type SaveProjectNamespaceQuota = z.infer<typeof SaveProjectNamespaceQuotaSchema>;
