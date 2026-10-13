import {z} from 'zod';
import {ResourceIdSchema} from '../../ids';
import {RunnerUsageMeasurementSchema} from '../../taskrunner/usageObservation';
import {RuntimeStatisticsQuerySchema} from './runtimeStatistics';
export const PlatformUsageIdentitySchema=z.strictObject({kind:z.literal('profile-test'),testId:ResourceIdSchema,executionId:z.string().min(1),executionGeneration:z.number().int().positive()});
export type PlatformUsageIdentity=z.infer<typeof PlatformUsageIdentitySchema>;
export const PlatformUsageAdmissionSchema=z.strictObject({testId:ResourceIdSchema,profileId:ResourceIdSchema,profileRevision:z.number().int().positive(),protocol:z.enum(['opencode','claude-code','terminal']),acceptedAt:z.iso.datetime(),priceBookRevision:z.number().int().nonnegative()});
export type PlatformUsageAdmission=z.infer<typeof PlatformUsageAdmissionSchema>;
export const PlatformUsageEventSchema=z.strictObject({identity:PlatformUsageIdentitySchema,sourceId:z.string().min(1),eventId:z.string().min(1),measurement:RunnerUsageMeasurementSchema});
export type PlatformUsageEvent=z.infer<typeof PlatformUsageEventSchema>;

const count=z.string().regex(/^(0|[1-9]\d*)$/);
export const PlatformUsageMetricsSchema=z.strictObject({executions:count,observedExecutions:count,records:count,tokens:z.strictObject({input:count.nullable(),cacheRead:count.nullable(),cacheWrite:count.nullable(),output:count.nullable(),total:count}),tokenComplete:z.boolean(),currency:z.literal('CNY'),amount:z.string().regex(/^(0|[1-9]\d*)(\.\d{1,12})?$/).nullable(),priceComplete:z.boolean(),gaps:z.array(z.string())});
export type PlatformUsageMetrics=z.infer<typeof PlatformUsageMetricsSchema>;
export const PlatformUsageRowSchema=z.strictObject({admission:PlatformUsageAdmissionSchema,profileName:z.string().nullable(),metrics:PlatformUsageMetricsSchema});
export const PlatformUsagePageSchema=z.strictObject({scope:z.literal('system-platform'),window:RuntimeStatisticsQuerySchema,windowBasis:z.literal('test-admission'),asOf:z.iso.datetime(),summary:PlatformUsageMetricsSchema,items:z.array(PlatformUsageRowSchema),nextCursor:z.string().nullable()});
export type PlatformUsagePage=z.infer<typeof PlatformUsagePageSchema>;
