import { z } from 'zod';
import { ClusterMetricNameSchema } from './metrics';

export const ClusterHistoryQuerySchema = z.object({ scope: z.enum(['cluster', 'node', 'pod', 'container', 'pvc', 'project', 'system']), resourceId: z.string().uuid().optional(), container: z.string().min(1).max(253).optional(), device: z.string().max(256).optional(), interface: z.string().max(256).optional(), projectId: z.string().uuid().optional(), metrics: z.string().max(300).default('cpu,memory').transform((s) => [...new Set(s.split(','))]).pipe(z.array(ClusterMetricNameSchema).min(1).max(8)), from: z.iso.datetime(), to: z.iso.datetime() }).superRefine((v, c) => {
  if (['node', 'pod', 'container', 'pvc'].includes(v.scope) && !v.resourceId) c.addIssue({ code: 'custom', message: 'resourceId is required', path: ['resourceId'] });
  if (v.scope === 'container' && !v.container) c.addIssue({ code: 'custom', message: 'container is required', path: ['container'] });
  if (v.scope === 'project' && !v.projectId) c.addIssue({ code: 'custom', message: 'projectId is required', path: ['projectId'] });
  const duration = Date.parse(v.to) - Date.parse(v.from);
  if (duration <= 0 || duration > 7 * 86_400_000) c.addIssue({ code: 'custom', message: 'Choose a positive range of at most 7 days', path: ['to'] });
});
export const ClusterHistorySchema = z.object({ requestedFrom: z.string(), requestedTo: z.string(), availableFrom: z.string().optional(), stepSeconds: z.number(), source: z.literal('prometheus'), state: z.enum(['fresh', 'unavailable', 'error']), reason: z.string().optional(), series: z.array(z.object({ metric: ClusterMetricNameSchema, unit: z.string(), points: z.array(z.object({ at: z.string(), average: z.number().nullable(), peak: z.number().nullable(), coverage: z.number(), complete: z.boolean() })) })) });
export const ClusterHistoryResourceSchema = z.object({ resourceId: z.string(), uid: z.string(), kind: z.string(), namespace: z.string(), name: z.string(), scope: z.string(), projectId: z.string().optional(), firstSeen: z.string(), lastSeen: z.string(), deleted: z.boolean(), versions: z.array(z.object({ from: z.string(), to: z.string().optional(), name: z.string(), namespace: z.string(), scope: z.string(), projectId: z.string().optional() })) });
export const ClusterHistoryResourcesQuerySchema = z.object({ cursor: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(100).default(50), kind: z.enum(['Node', 'Pod', 'PersistentVolumeClaim']).optional(), projectId: z.string().uuid().optional(), q: z.string().max(200).optional() });
export const ClusterHistoryResourcesSchema = z.object({ items: z.array(ClusterHistoryResourceSchema), total: z.number(), nextCursor: z.number().optional() });
export type ClusterHistoryQuery = z.infer<typeof ClusterHistoryQuerySchema>;
export type ClusterHistory = z.infer<typeof ClusterHistorySchema>;
export type ClusterHistoryResource = z.infer<typeof ClusterHistoryResourceSchema>;
export type ClusterHistoryResourcesQuery = z.infer<typeof ClusterHistoryResourcesQuerySchema>;
export type ClusterHistoryResources = z.infer<typeof ClusterHistoryResourcesSchema>;
