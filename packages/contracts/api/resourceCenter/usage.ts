import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, TaskIdSchema } from '../../ids';

export const ResourceWorkloadSchema = z.object({ id: TaskIdSchema, projectId: ProjectIdSchema, kind: z.string(), state: z.string(), taskProfileId: z.string(), parentTaskId: TaskIdSchema.nullable(), computeProfileId: z.string().nullable(), runtimeImageVersionId: z.string().nullable(), runtimeImageId: z.string().nullable(), cpu: z.string().nullable(), memory: z.string().nullable(), storage: z.string().nullable(), volumeMode: z.string(), podUid: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const ResourceWorkloadPageSchema = z.object({ items: z.array(ResourceWorkloadSchema), nextCursor: z.string().nullable() });
export const ReleaseResourceUsageSchema = z.object({ releaseId: ResourceIdSchema, physical: z.enum(['blue', 'green']), role: z.enum(['prod', 'preview']), servicePlanId: z.string().nullable(), taskProfileId: z.string().nullable(), computeProfileIds: z.array(z.string()), runtimeImageVersionIds: z.array(z.string()), objectPlanId: z.string().nullable(), configDefinitionIds: z.array(z.string()), requestedApiIds: z.array(z.string()), eventTypeIds: z.array(z.string()) });
export type ResourceWorkload = z.infer<typeof ResourceWorkloadSchema>;
export type ResourceWorkloadPage = z.infer<typeof ResourceWorkloadPageSchema>;
export type ReleaseResourceUsage = z.infer<typeof ReleaseResourceUsageSchema>;
