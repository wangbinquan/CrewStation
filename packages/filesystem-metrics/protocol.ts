import { z } from 'zod';
export const MeasurementRequestSchema = z.object({ targets: z.array(z.object({ key: z.string().min(1).max(200), rootId: z.string().min(1).max(50), relativePath: z.string().min(1).max(2000) }).strict()).min(1).max(64) }).strict();
export const MeasurementResponseSchema = z.object({ items: z.array(z.object({ key: z.string(), allocatedBytes: z.string().optional(), observedAt: z.string(), durationMs: z.number(), state: z.enum(['fresh', 'error']), reason: z.string().optional() })).max(64) });
export type MeasurementRequest = z.infer<typeof MeasurementRequestSchema>;
export type MeasurementResponse = z.infer<typeof MeasurementResponseSchema>;
