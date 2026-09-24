import { z } from 'zod';
import { ProjectIdSchema } from '../../ids';
import { ResourceRecordSchema } from '../resources/resourceRecord';
import { ClusterPurposeSchema } from './purpose';

export const ClusterViewSchema = z.enum(['workloads', 'pods', 'network', 'storage', 'namespaces']);
export const ClusterOwnershipSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('project'), projectId: z.string(), projectName: z.string(), slug: z.string(), projectKind: z.string(), archived: z.boolean() }),
  z.object({ scope: z.literal('system'), component: z.string() }),
  z.object({ scope: z.literal('unresolved'), reason: z.string() }),
]);
export const ClusterActionSchema = z.enum(['restart', 'scale', 'restore-replicas', 'delete']);
export const ClusterActionCapabilitySchema = z.object({ action: ClusterActionSchema, enabled: z.boolean(), reason: z.string(), executionRoute: z.enum(['kubernetes', 'release', 'task', 'none']), impactSummary: z.array(z.string()), minReplicas: z.number().optional(), maxReplicas: z.number().optional() });
export const ClusterContainerSchema = z.object({ name: z.string(), init: z.boolean(), type: z.enum(['application', 'init', 'sidecar', 'ephemeral']).optional(), image: z.string(), ready: z.boolean(), restarts: z.number(), state: z.string(), reason: z.string().optional(), message: z.string().optional(), exitCode: z.number().optional(), requests: z.record(z.string(), z.string()), limits: z.record(z.string(), z.string()), ports: z.array(z.number()) });
/**
 * 台账认领这个对象时，所属标准记录的阶段、原因与可做操作（RFC-025 T13，I29 裁定）：读清单时按记录叠加，不存进快照。
 * `maintained`：对象由资源中心按期望建出、改回（路由、限流中间件、命名空间与额度、网络策略），删掉会被补回。
 */
export const ClusterLedgerSchema = ResourceRecordSchema.pick({ id: true, kind: true, phase: true, phaseSince: true, reason: true, actions: true, version: true }).extend({ maintained: z.boolean() });
export const ClusterResourceSchema = z.object({
  resourceId: z.string(), apiVersion: z.string(), kind: z.string(), namespace: z.string(), name: z.string(), uid: z.string(), resourceVersion: z.string(), revision: z.string(), observedAt: z.string(), createdAt: z.string().optional(), deletingAt: z.string().optional(), generation: z.number().optional(), observedGeneration: z.number().optional(),
  view: ClusterViewSchema, ownership: ClusterOwnershipSchema, purpose: ClusterPurposeSchema, phase: z.string(), ready: z.boolean(), abnormal: z.boolean(), reason: z.string(), topLevel: z.boolean(), standalone: z.boolean(),
  desired: z.number().optional(), actual: z.number().optional(), readyReplicas: z.number().optional(), restarts: z.number(), node: z.string().optional(),
  labels: z.record(z.string(), z.string()), owners: z.array(z.object({ kind: z.string(), name: z.string(), uid: z.string(), resourceId: z.string().optional() })), references: z.array(z.string()), containers: z.array(ClusterContainerSchema), facts: z.record(z.string(), z.string()),
  taskId: z.string().optional(), parentTaskId: z.string().optional(), agentId: z.string().optional(), terminalId: z.string().optional(), releaseId: z.string().optional(), serviceId: z.string().optional(), physicalSlot: z.enum(['blue', 'green']).optional(), slotRole: z.enum(['prod', 'preview']).optional(), profile: z.string().optional(), profileRevision: z.number().optional(), domainRevision: z.string().optional(),
  availableActions: z.array(ClusterActionCapabilitySchema),
  ledger: ClusterLedgerSchema.optional(),
});
export const ClusterSourceSchema = z.object({ key: z.string(), kind: z.string(), namespace: z.string(), batchId: z.string(), observedAt: z.string().optional(), resourceVersion: z.string(), state: z.enum(['complete', 'stale', 'error', 'unsupported']), count: z.number(), reason: z.string().optional() });
export const ClusterFilterSchema = z.object({ snapshotId: z.string().optional(), view: ClusterViewSchema.optional(), scope: z.enum(['all', 'project', 'system', 'unresolved']).default('all'), projectId: z.string().optional(), namespace: z.string().optional(), kind: z.string().optional(), purpose: ClusterPurposeSchema.optional(), status: z.string().optional(), q: z.string().max(200).optional(), cursor: z.string().max(3000).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
/** 每项目计数只在快照完整时给出（RFC-019）；缺席表示来源失败，不能用 0 冒充。 */
export const ClusterProjectCountsSchema = z.object({ id: z.string(), name: z.string(), workloads: z.number().optional(), pods: z.number().optional(), readyPods: z.number().optional(), abnormal: z.number().optional(), devSessions: z.number().optional() });
export const ClusterSummarySchema = z.object({ snapshotId: z.string(), startedAt: z.string(), finishedAt: z.string(), complete: z.boolean(), sources: z.array(ClusterSourceSchema), total: z.number(), workloads: z.number(), pods: z.number(), runningPods: z.number(), readyPods: z.number(), standalonePods: z.number(), services: z.number(), pvcs: z.number(), abnormal: z.number(), kinds: z.record(z.string(), z.number()), phases: z.record(z.string(), z.number()), purposes: z.record(z.string(), z.number()), projects: z.array(ClusterProjectCountsSchema) });
/** 项目成员的只读盘点（RFC-019）：同一份快照按项目过滤，没有管理动作。 */
export const ProjectClusterResourcesParamsSchema = z.object({ projectId: ProjectIdSchema });
export const ProjectClusterResourcesQuerySchema = z.object({ snapshotId: z.string().max(200).optional() });
export const ProjectClusterResourcesSchema = z.object({ snapshotId: z.string(), observedAt: z.string(), complete: z.boolean(), sources: z.array(ClusterSourceSchema), items: z.array(ClusterResourceSchema), truncated: z.boolean() });
export const ClusterPageSchema = z.object({ snapshotId: z.string(), complete: z.boolean(), items: z.array(ClusterResourceSchema), total: z.number(), nextCursor: z.string().optional() });
export const ClusterDetailSchema = z.object({ resource: ClusterResourceSchema, related: z.array(ClusterResourceSchema), complete: z.boolean(), sources: z.array(ClusterSourceSchema) });
export const ClusterEventsSchema = z.object({ items: z.array(z.object({ uid: z.string(), type: z.string(), reason: z.string(), message: z.string(), count: z.number(), at: z.string().optional() })) });
export const ClusterLogsQuerySchema = z.object({ container: z.string().min(1), tailLines: z.coerce.number().int().min(1).max(2000).default(200), since: z.iso.datetime().optional(), previous: z.enum(['true', 'false']).default('false') });
export const ClusterLogsSchema = z.object({ uid: z.string(), container: z.string(), previous: z.boolean(), text: z.string(), truncated: z.boolean() });
export type ClusterResource = z.infer<typeof ClusterResourceSchema>;
export type ClusterLedger = z.infer<typeof ClusterLedgerSchema>;
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
export type ClusterProjectCounts = z.infer<typeof ClusterProjectCountsSchema>;
export type ProjectClusterResourcesQuery = z.infer<typeof ProjectClusterResourcesQuerySchema>;
export type ProjectClusterResources = z.infer<typeof ProjectClusterResourcesSchema>;
