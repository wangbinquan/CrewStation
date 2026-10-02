import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { WorkloadConsumerIntentSchema } from './workloadSafety';

export const DEVELOPMENT_PARENT_ENDING_ANNOTATION = 'crewstation.io/development-parent-ending';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const original = { version: z.literal(1), endingId: ResourceIdSchema, epochHash: digest,
  originalRenderStart: revision.nullable(), podName: z.string().min(1).max(253) };
const physical = { consumer: WorkloadConsumerIntentSchema.refine((value) => value.purpose === 'development' && value.finalization === null, '只允许原父结束物理观察消费者'),
  podUid: z.uuid(), pvcUid: z.uuid(), nodeName: z.string().min(1), nodeUid: z.uuid(), materialsHash: digest };
/** Early seal carries no fabricated Start identity. Only prepared permits the independent observation ACK. */
export const DevelopmentParentEndingProjectionSchema = z.discriminatedUnion('phase', [
  z.strictObject({ ...original, phase: z.literal('admission-sealed') }),
  z.strictObject({ ...original, phase: z.literal('children') }),
  ...(['prepared', 'stop-intent', 'proved', 'complete'] as const).map((phase) => z.strictObject({ ...original, ...physical, phase: z.literal(phase) })),
]).superRefine((value, context) => {
  if ('consumer' in value && value.consumer.id !== value.endingId) context.addIssue({ code: 'custom', message: '父观察消费者必须绑定原 ending' });
});
export type DevelopmentParentEndingProjection = z.infer<typeof DevelopmentParentEndingProjectionSchema>;
