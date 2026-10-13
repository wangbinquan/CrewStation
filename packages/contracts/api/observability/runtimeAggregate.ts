import {z} from 'zod';
import {ProjectIdSchema} from '../../ids';
import {RuntimeStatisticsQuerySchema} from './runtimeStatistics';
import {CompleteRuntimeMetricsSchema,RuntimeCompleteSummarySchema} from './completeRuntimeReport';
const count=z.string().regex(/^(0|[1-9]\d*)$/);
export const RuntimeProjectionStateSchema=z.strictObject({generation:count,revision:count,asOf:z.iso.datetime().nullable(),bootstrapCompleted:z.boolean(),pending:z.boolean()});
export type RuntimeProjectionState=z.infer<typeof RuntimeProjectionStateSchema>;
export const RuntimeAggregateSchema=z.strictObject({scope:z.enum(['project','system']),projectId:ProjectIdSchema.nullable(),filters:RuntimeStatisticsQuerySchema,windowBasis:z.literal('task-admission'),projection:RuntimeProjectionStateSchema,pendingTasks:count,summary:RuntimeCompleteSummarySchema,occurrence:z.strictObject({basis:z.literal('call-occurrence'),tasks:count,metrics:CompleteRuntimeMetricsSchema,trend:z.array(z.strictObject({from:z.iso.datetime(),to:z.iso.datetime(),tasks:count,metrics:CompleteRuntimeMetricsSchema})),unassigned:z.strictObject({tasks:count,metrics:CompleteRuntimeMetricsSchema})}).optional()});
export type RuntimeAggregate=z.infer<typeof RuntimeAggregateSchema>;
