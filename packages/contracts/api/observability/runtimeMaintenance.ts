import {z} from 'zod';
import {ResourceIdSchema,ProjectIdSchema} from '../../ids';
import {RuntimeStatisticsQuerySchema} from './runtimeStatistics';
const count=z.string().regex(/^(0|[1-9]\d*)$/),amount=z.string().regex(/^-?(0|[1-9]\d*)(\.\d{1,12})?$/);
export const RuntimeMaintenanceRequestSchema=z.strictObject({requestKey:z.string().min(8).max(128),mode:z.enum(['backfill','rebuild','reprice']),projectId:ProjectIdSchema.nullable(),filters:RuntimeStatisticsQuerySchema,profileId:ResourceIdSchema.optional(),targetPriceBookRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()}).refine(v=>v.mode!=='reprice'||v.profileId!==undefined&&v.targetPriceBookRevision!==undefined,'价格纠错需要明确算力与目录修订');
export const RuntimeMaintenanceConfirmSchema=z.strictObject({expectedDigest:z.string().regex(/^[a-f0-9]{64}$/),confirmation:z.literal('APPLY')});
export const RuntimeMaintenanceSchema=z.strictObject({id:ResourceIdSchema,request:RuntimeMaintenanceRequestSchema,state:z.enum(['preparing','preview','running','complete','partial','failed']),sourceRevision:count,scopeDigest:z.string(),createdAt:z.iso.datetime(),confirmedAt:z.iso.datetime().nullable(),tasks:count,records:count,processedTasks:count,processedRecords:count,knownOriginalCny:amount.nullable(),knownProposedCny:amount.nullable(),knownDeltaCny:amount.nullable(),unpricedRecords:count,gaps:z.array(z.string())});
export type RuntimeMaintenanceRequest=z.infer<typeof RuntimeMaintenanceRequestSchema>;
export type RuntimeMaintenance=z.infer<typeof RuntimeMaintenanceSchema>;
