import {z} from 'zod';
import {ProjectIdSchema,TaskIdSchema,ResourceIdSchema} from '../../ids';
export const RuntimeAnomalySchema=z.strictObject({id:ResourceIdSchema,key:z.string(),projectId:ProjectIdSchema.nullable(),taskId:TaskIdSchema.nullable(),taskName:z.string().nullable(),rule:z.string(),source:z.string(),state:z.enum(['pending','firing','resolved']),sourceState:z.enum(['available','unavailable']),firstObservedAt:z.iso.datetime(),lastObservedAt:z.iso.datetime(),firedAt:z.iso.datetime().nullable(),resolvedAt:z.iso.datetime().nullable(),samples:z.string(),minimumSamples:z.string(),durationMs:z.string(),windowMs:z.string(),evidence:z.record(z.string(),z.unknown())});
export type RuntimeAnomaly=z.infer<typeof RuntimeAnomalySchema>;
export const RuntimeAnomalyPageSchema=z.strictObject({items:z.array(RuntimeAnomalySchema),total:z.string(),nextCursor:z.string().nullable()});
export type RuntimeAnomalyPage=z.infer<typeof RuntimeAnomalyPageSchema>;
