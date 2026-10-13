import {z} from 'zod';
import {ProjectIdSchema} from '../../ids';
const count=z.string().regex(/^(0|[1-9]\d*)$/);
export const OperationalTelemetryQuerySchema=z.strictObject({from:z.iso.datetime(),to:z.iso.datetime(),excludeMaintenance:z.preprocess(v=>v==='true'?true:v==='false'?false:v,z.boolean().optional())}).refine(v=>Date.parse(v.from)<Date.parse(v.to),'观测范围无效');
export type OperationalTelemetryQuery=z.infer<typeof OperationalTelemetryQuerySchema>;
export const OperationalTelemetrySchema=z.strictObject({
 availableFrom:z.iso.datetime().optional(),excludedMaintenanceRequests:count.optional(),
 scope:z.enum(['project','system']),projectId:ProjectIdSchema.nullable(),from:z.iso.datetime(),to:z.iso.datetime(),
 source:z.literal('prometheus'),state:z.enum(['partial','no-samples','unavailable','error']),observedAt:z.iso.datetime().nullable(),gaps:z.array(z.string()),
 gauges:z.array(z.strictObject({key:z.string(),component:z.string(),source:z.string(),kind:z.string(),unit:z.string(),value:z.string().nullable(),observedAt:z.iso.datetime().nullable(),state:z.enum(['available','unavailable','stale','invalid']),replica:z.string().nullable(),dimensions:z.record(z.string(),z.string()).optional()})).optional(),
 rows:z.array(z.strictObject({key:z.string(),component:z.string(),route:z.string(),physicalService:z.string().nullable(),
  plannedMaintenance:z.boolean().optional(),physicalSlot:z.string().nullable().optional(),releaseId:z.string().nullable().optional(),releaseName:z.string().nullable().optional(),role:z.string().optional(),maintenance:z.boolean().nullable().optional(),
  requests:count,errors4xx:count,errors5xx:count,limited:count,p95UpperMs:z.number().nonnegative().nullable(),samples:count,
  streamOpened:count,streamClosed:count,streamCancelled:count,activeStreams:z.number().nonnegative().nullable(),
 })),
});
export type OperationalTelemetry=z.infer<typeof OperationalTelemetrySchema>;
