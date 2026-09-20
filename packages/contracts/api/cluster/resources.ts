import { z } from 'zod';

export const ClusterViewSchema = z.enum(['workloads', 'pods', 'network', 'storage', 'namespaces']);
export const ClusterPurposeSchema = z.enum(['development-workspace', 'development-cli', 'development-agent', 'business-workspace', 'business-subtask', 'profile-test', 'digital-worker-service', 'api-proxy', 'event-producer', 'build', 'migration', 'platform-service', 'platform-infrastructure', 'unknown']);
export const ClusterOwnershipSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('project'), projectId: z.string(), projectName: z.string(), slug: z.string(), projectKind: z.string(), archived: z.boolean() }),
  z.object({ scope: z.literal('system'), component: z.string() }),
  z.object({ scope: z.literal('unresolved'), reason: z.string() }),
]);
export const ClusterActionSchema = z.enum(['restart', 'scale', 'restore-replicas', 'delete']);
export const ClusterActionCapabilitySchema = z.object({ action: ClusterActionSchema, enabled: z.boolean(), reason: z.string(), executionRoute: z.enum(['kubernetes', 'release', 'task', 'none']), impactSummary: z.array(z.string()), minReplicas: z.number().optional(), maxReplicas: z.number().optional() });
export const ClusterContainerSchema = z.object({ name: z.string(), init: z.boolean(), image: z.string(), ready: z.boolean(), restarts: z.number(), state: z.string(), reason: z.string().optional(), message: z.string().optional(), exitCode: z.number().optional(), requests: z.record(z.string(), z.string()), limits: z.record(z.string(), z.string()), ports: z.array(z.number()) });
export const ClusterResourceSchema = z.object({
  resourceId: z.string(), apiVersion: z.string(), kind: z.string(), namespace: z.string(), name: z.string(), uid: z.string(), resourceVersion: z.string(), revision: z.string(), observedAt: z.string(), createdAt: z.string().optional(), deletingAt: z.string().optional(), generation: z.number().optional(), observedGeneration: z.number().optional(),
  view: ClusterViewSchema, ownership: ClusterOwnershipSchema, purpose: ClusterPurposeSchema, phase: z.string(), ready: z.boolean(), abnormal: z.boolean(), reason: z.string(), topLevel: z.boolean(), standalone: z.boolean(),
  desired: z.number().optional(), actual: z.number().optional(), readyReplicas: z.number().optional(), restarts: z.number(), node: z.string().optional(),
  labels: z.record(z.string(), z.string()), owners: z.array(z.object({ kind: z.string(), name: z.string(), uid: z.string(), resourceId: z.string().optional() })), references: z.array(z.string()), containers: z.array(ClusterContainerSchema), facts: z.record(z.string(), z.string()),
  taskId: z.string().optional(), parentTaskId: z.string().optional(), agentId: z.string().optional(), terminalId: z.string().optional(), releaseId: z.string().optional(), serviceId: z.string().optional(), physicalSlot: z.enum(['blue', 'green']).optional(), slotRole: z.enum(['prod', 'preview']).optional(), profile: z.string().optional(), profileRevision: z.number().optional(), domainRevision: z.string().optional(),
  availableActions: z.array(ClusterActionCapabilitySchema),
});
export const ClusterSourceSchema = z.object({ key: z.string(), kind: z.string(), namespace: z.string(), batchId: z.string(), observedAt: z.string().optional(), resourceVersion: z.string(), state: z.enum(['complete', 'stale', 'error', 'unsupported']), count: z.number(), reason: z.string().optional() });
export const ClusterFilterSchema = z.object({ snapshotId: z.string().optional(), view: ClusterViewSchema.optional(), scope: z.enum(['all', 'project', 'system', 'unresolved']).default('all'), projectId: z.string().optional(), namespace: z.string().optional(), kind: z.string().optional(), purpose: ClusterPurposeSchema.optional(), status: z.string().optional(), q: z.string().max(200).optional(), cursor: z.string().max(3000).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const ClusterSummarySchema = z.object({ snapshotId: z.string(), startedAt: z.string(), finishedAt: z.string(), complete: z.boolean(), sources: z.array(ClusterSourceSchema), total: z.number(), workloads: z.number(), pods: z.number(), runningPods: z.number(), readyPods: z.number(), standalonePods: z.number(), services: z.number(), pvcs: z.number(), abnormal: z.number(), kinds: z.record(z.string(), z.number()), phases: z.record(z.string(), z.number()), purposes: z.record(z.string(), z.number()), projects: z.array(z.object({ id: z.string(), name: z.string() })) });
export const ClusterPageSchema = z.object({ snapshotId: z.string(), complete: z.boolean(), items: z.array(ClusterResourceSchema), total: z.number(), nextCursor: z.string().optional() });
export const ClusterDetailSchema = z.object({ resource: ClusterResourceSchema, related: z.array(ClusterResourceSchema), complete: z.boolean(), sources: z.array(ClusterSourceSchema) });
export const ClusterEventsSchema = z.object({ items: z.array(z.object({ uid: z.string(), type: z.string(), reason: z.string(), message: z.string(), count: z.number(), at: z.string().optional() })) });
export const ClusterLogsQuerySchema = z.object({ container: z.string().min(1), tailLines: z.coerce.number().int().min(1).max(2000).default(200), since: z.iso.datetime().optional(), previous: z.enum(['true', 'false']).default('false') });
export const ClusterLogsSchema = z.object({ uid: z.string(), container: z.string(), previous: z.boolean(), text: z.string(), truncated: z.boolean() });
export type ClusterResource = z.infer<typeof ClusterResourceSchema>;
export type ClusterFilter = z.infer<typeof ClusterFilterSchema>;
export type ClusterSummary = z.infer<typeof ClusterSummarySchema>;
export type ClusterPage = z.infer<typeof ClusterPageSchema>;
export type ClusterDetail = z.infer<typeof ClusterDetailSchema>;
export type ClusterSource = z.infer<typeof ClusterSourceSchema>;
export type ClusterOwnership = z.infer<typeof ClusterOwnershipSchema>;
export type ClusterPurpose = z.infer<typeof ClusterPurposeSchema>;
export type ClusterAction = z.infer<typeof ClusterActionSchema>;
export type ClusterActionCapability = z.infer<typeof ClusterActionCapabilitySchema>;
export type ClusterContainer = z.infer<typeof ClusterContainerSchema>;
export type ClusterEvents = z.infer<typeof ClusterEventsSchema>;
export type ClusterLogsQuery = z.infer<typeof ClusterLogsQuerySchema>;
export type ClusterLogs = z.infer<typeof ClusterLogsSchema>;
