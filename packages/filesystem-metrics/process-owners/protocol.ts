import { z } from 'zod';
const source = z.strictObject({ bootId: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/), namespace: z.string().regex(/^pid:\[[1-9][0-9]*\]$/), cgroupNamespace: z.string().regex(/^cgroup:\[[1-9][0-9]*\]$/) });
const owner = z.strictObject({ key: z.string().min(1).max(200), podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/).optional() });
export const ProcessOwnerRequestSchema = z.strictObject({ owners: z.array(owner).max(128).refine(rows => new Set(rows.map(row => row.key)).size === rows.length), source: source.optional() });
export const ProcessOwnerResponseSchema = z.strictObject({ version: z.literal(1), bootId: z.string(), namespace: z.string(), cgroupNamespace: z.string(), complete: z.boolean(),
  owners: z.array(z.strictObject({ key: z.string(), threads: z.array(z.strictObject({ pid: z.number().int().positive(), tid: z.number().int().positive(), startTicks: z.string().regex(/^[1-9][0-9]*$/), identity: z.string().regex(/^[a-f0-9]{64}$/) })) })),
  blockers: z.array(z.strictObject({ code: z.enum(['source-unreadable', 'source-changed', 'process-unreadable', 'process-changed']), pid: z.number().int().positive().optional() })),
}).refine(row => !row.complete || !row.blockers.length && source.safeParse({ bootId: row.bootId, namespace: row.namespace, cgroupNamespace: row.cgroupNamespace }).success);
export type ProcessOwnerRequest = z.infer<typeof ProcessOwnerRequestSchema>;
export type ProcessOwnerResponse = z.infer<typeof ProcessOwnerResponseSchema>;
