import { z } from 'zod';
import { ProjectIdSchema } from '../../ids';
import { ResourceActionDescriptorSchema } from './actions';
import { ResourceRequestDtoSchema } from './requests';
import { ResourceValuesSchema } from './actions';
import { UserIdSchema } from '../../ids';

export const LegacyResourceRequestSchema = z.object({ id: z.string(), resourceType: z.enum(['api-operation', 'production-data']), targetResourceId: z.string(), name: z.string(), state: z.string(), reason: z.string(), requestedBy: UserIdSchema, requesterName: z.string().nullable(), createdAt: z.iso.datetime(), values: ResourceValuesSchema, canDecide: z.boolean() });
export type LegacyResourceRequest = z.infer<typeof LegacyResourceRequestSchema>;

export const ResourceQuotaMetricSchema = z.object({
  key: z.string(), label: z.string(), unit: z.string(), scopeId: z.string(),
  used: z.number().nullable(), reserved: z.number().nullable(), limit: z.number().nullable(), requestedLimit: z.number().nullable(),
  limitKind: z.enum(['value', 'shared', 'none', 'unknown', 'not-applicable']), observedAt: z.iso.datetime().nullable(),
});
export const ProjectResourceNodeSchema = z.object({
  id: z.string(), resourceId: z.string().nullable(), name: z.string(), description: z.string(), resourceType: z.string(),
  kind: z.enum(['project', 'catalog', 'allocation', 'resource', 'request', 'component', 'group']),
  category: z.enum(['service', 'execution', 'data', 'integration', 'foundation']), environment: z.enum(['project', 'production', 'development', 'shared']),
  access: z.enum(['owned', 'requestable', 'pending', 'unavailable']), source: z.enum(['automatic', 'inherited', 'granted', 'configuration', 'observed', 'request']),
  state: z.string(), stateText: z.string(), observedAt: z.iso.datetime().nullable(), stale: z.boolean(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })), metrics: z.array(ResourceQuotaMetricSchema),
  ownerId: z.string().nullable(), memberIds: z.array(z.string()), actions: z.array(ResourceActionDescriptorSchema), pendingRequestIds: z.array(z.string()),
});
export const ProjectResourceEdgeSchema = z.object({
  id: z.string(), sourceId: z.string(), targetId: z.string(),
  relation: z.enum(['owns', 'consumes-quota', 'uses', 'mounts', 'calls', 'pushes', 'grants', 'changes']),
  state: z.enum(['configured', 'observed', 'proposed']), label: z.string(), memberRelations: z.array(z.object({ sourceId: z.string(), targetId: z.string() })).optional(),
});
export const ResourceSourceStatusSchema = z.object({ id: z.string(), name: z.string(), observedAt: z.iso.datetime().nullable(), complete: z.boolean(), error: z.string().nullable() });
export const ProjectResourceSnapshotSchema = z.object({
  projectId: ProjectIdSchema, projectName: z.string(), namespace: z.string(), observedAt: z.iso.datetime(),
  role: z.enum(['owner', 'developer', 'admin']), archived: z.boolean(), complete: z.boolean(),
  nodes: z.array(ProjectResourceNodeSchema), edges: z.array(ProjectResourceEdgeSchema), sources: z.array(ResourceSourceStatusSchema),
  requests: z.array(ResourceRequestDtoSchema), requestsNextCursor: z.string().nullable(),
  legacyRequests: z.array(LegacyResourceRequestSchema),
});
export type ResourceQuotaMetric = z.infer<typeof ResourceQuotaMetricSchema>;
export type ProjectResourceNode = z.infer<typeof ProjectResourceNodeSchema>;
export type ProjectResourceEdge = z.infer<typeof ProjectResourceEdgeSchema>;
export type ResourceSourceStatus = z.infer<typeof ResourceSourceStatusSchema>;
export type ProjectResourceSnapshot = z.infer<typeof ProjectResourceSnapshotSchema>;
