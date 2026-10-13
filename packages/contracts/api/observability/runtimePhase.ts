import {z} from 'zod';
import {TaskIdSchema} from '../../ids';
export const RuntimePhaseSchema=z.strictObject({key:z.string(),taskId:TaskIdSchema,runtimeTaskId:TaskIdSchema.optional(),agentName:z.string().optional(),agentId:z.string(),turnId:z.string().nullable(),kind:z.enum(['active','waiting','unknown','queue','replace','container','checkout','connect','prepare','agent','interface','ready','residence','cleanup','retention','idle']),source:z.enum(['agent-driver','native-activity','task-runtime','owner-lifecycle']),quality:z.enum(['known','unknown']),startedAt:z.iso.datetime().nullable(),endedAt:z.iso.datetime().nullable(),durationMs:z.string().regex(/^(0|[1-9]\d*)$/).nullable(),open:z.boolean(),reason:z.string().nullable()});
export type RuntimePhase=z.infer<typeof RuntimePhaseSchema>;

const phaseCount=z.string().regex(/^(0|[1-9]\d*)$/);
export const RuntimePhaseTimingSchema=z.strictObject({range:z.strictObject({from:z.iso.datetime(),to:z.iso.datetime()}).nullable().optional(),activeMs:phaseCount,activeUnionMs:phaseCount,waitingMs:phaseCount,waitingUnionMs:phaseCount,unknownSegments:phaseCount,residenceMs:phaseCount.nullable(),queueMs:phaseCount,initializationMs:phaseCount,cleanupMs:phaseCount,retentionMs:phaseCount});
export type RuntimePhaseTiming=z.infer<typeof RuntimePhaseTimingSchema>;
