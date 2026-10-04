import {z} from 'zod';
import {RuntimeTaskHeaderFactSchema,RuntimeAttemptFactSchema,RuntimeStatisticsQuerySchema} from './runtimeStatistics';
import {ResourceIdSchema,ProjectIdSchema,TaskIdSchema} from '../../ids';
import {UsageExecutionIdentitySchema,UsageRecordSchema} from './usageLedger';
const count=z.string().regex(/^(0|[1-9]\d*)$/);
const amount=z.string().regex(/^(0|[1-9]\d*)(\.\d{1,12})?$/);
export const CompleteRuntimeGapMetricsSchema=z.strictObject({state:z.literal('not-ready'),gaps:z.array(z.string())});
export const CompleteRuntimeMetricsSchema=z.discriminatedUnion('state',[
  CompleteRuntimeGapMetricsSchema,
  z.strictObject({state:z.literal('not-applicable')}),
  z.strictObject({state:z.literal('ready'),tokens:z.strictObject({input:count,cacheRead:count,cacheWrite:count,output:count,total:count}),executions:count,observedExecutions:count,records:count,cost:z.strictObject({currency:z.literal('CNY'),state:z.enum(['complete','unpriced','hidden']),amount:amount.nullable()})}).refine(v=>v.cost.state==='complete'?v.cost.amount!==null:v.cost.amount===null,{message:'非完整估值不得包含金额'}).refine(v=>BigInt(v.tokens.input)+BigInt(v.tokens.cacheRead)+BigInt(v.tokens.cacheWrite)+BigInt(v.tokens.output)===BigInt(v.tokens.total)&&BigInt(v.observedExecutions)<=BigInt(v.executions),{message:'分类 Token 或原执行数量不一致'}),
]);
export type CompleteRuntimeMetricsDto=z.infer<typeof CompleteRuntimeMetricsSchema>;
export const CompleteTaskTimingSchema=z.strictObject({wallMs:count.nullable(),range:z.strictObject({from:z.iso.datetime(),to:z.iso.datetime()}).nullable(),intervals:z.discriminatedUnion('state',[
  z.strictObject({state:z.literal('complete'),unknown:z.literal('0'),cumulativeMs:count,activeUnionMs:count}),
  z.strictObject({state:z.literal('not-ready'),unknown:count}),
])});
export const CompleteRuntimeTaskSummarySchema=RuntimeTaskHeaderFactSchema.extend({attemptCount:count,metrics:CompleteRuntimeMetricsSchema,timing:CompleteTaskTimingSchema});
export type CompleteRuntimeTaskSummary=z.infer<typeof CompleteRuntimeTaskSummarySchema>;
export const CompleteRuntimeAttemptSummarySchema=RuntimeAttemptFactSchema.extend({key:z.string().min(1),metrics:CompleteRuntimeMetricsSchema,durationMs:count.nullable(),open:z.boolean()});
export type CompleteRuntimeAttemptSummary=z.infer<typeof CompleteRuntimeAttemptSummarySchema>;
const duration=z.discriminatedUnion('state',[
  z.strictObject({state:z.literal('complete'),samples:count,p50Ms:count.nullable(),p95Ms:count.nullable(),maxMs:count.nullable()}),
  z.strictObject({state:z.literal('not-ready'),gaps:z.array(z.string())}),
]);
export const RuntimeCompleteSummarySchema=z.strictObject({
  tasks:count,metrics:CompleteRuntimeMetricsSchema,durations:duration,
  trend:z.array(z.strictObject({from:z.iso.datetime(),to:z.iso.datetime(),tasks:count,metrics:CompleteRuntimeMetricsSchema})),
  sources:z.array(z.strictObject({kind:z.enum(['business-task','development-agent']),tasks:count,metrics:CompleteRuntimeMetricsSchema,collectionState:z.enum(['available','production-disabled'])})),
});
export type RuntimeCompleteSummary=z.infer<typeof RuntimeCompleteSummarySchema>;
export const RuntimeReportHeaderSchema=z.strictObject({reportId:ResourceIdSchema,projectionVersion:z.literal(2),scope:z.enum(['project','system']),projectId:ProjectIdSchema.nullable(),filters:RuntimeStatisticsQuerySchema,asOf:z.iso.datetime(),snapshotId:z.string().min(1),generation:count,sourceRevision:count,taskId:TaskIdSchema.optional(),coverage:z.literal('complete'),buildMs:z.number().nonnegative()});
export const RuntimeFactReportHeaderSchema=RuntimeReportHeaderSchema.extend({coverage:z.literal('complete-facts')});
export type RuntimeReportHeader=z.infer<typeof RuntimeReportHeaderSchema>|z.infer<typeof RuntimeFactReportHeaderSchema>;
export const RuntimeCompleteFactSummarySchema=RuntimeCompleteSummarySchema.extend({
 metrics:CompleteRuntimeGapMetricsSchema,
 trend:z.array(RuntimeCompleteSummarySchema.shape.trend.element.extend({metrics:CompleteRuntimeGapMetricsSchema})),
 sources:z.array(RuntimeCompleteSummarySchema.shape.sources.element.extend({metrics:CompleteRuntimeGapMetricsSchema})),
});
export const RuntimeCompleteFactsSchema=z.strictObject({header:RuntimeFactReportHeaderSchema,summary:RuntimeCompleteFactSummarySchema});
const base={reportId:ResourceIdSchema};
export const RuntimeCompleteReportSchema=z.discriminatedUnion('state',[
 z.strictObject({...base,state:z.literal('building'),phase:z.string()}),
 z.strictObject({...base,state:z.literal('not-ready'),gaps:z.array(z.strictObject({source:z.string(),reason:z.string()})),facts:RuntimeCompleteFactsSchema.optional()}).refine(v=>!v.facts||v.reportId===v.facts.header.reportId,{message:'原事实报告标识不一致'}),
 z.strictObject({...base,state:z.literal('failed'),error:z.string(),retryable:z.boolean()}),
 z.strictObject({...base,state:z.literal('ready'),header:RuntimeReportHeaderSchema,summary:RuntimeCompleteSummarySchema}).refine(v=>v.summary.metrics.state!=='not-ready',{message:'未完整采集的报告不得发布统计数字'}),
]);
export type RuntimeCompleteReport=z.infer<typeof RuntimeCompleteReportSchema>;
export interface RuntimeCompleteReportContent {readonly header:RuntimeReportHeader;readonly summary:RuntimeCompleteSummary}
/** Select sealed execution content while retaining the original numeric readiness state. */
export function runtimeCompleteReportContent(report:RuntimeCompleteReport):RuntimeCompleteReportContent|undefined {
 return report.state==='ready'?report:report.state==='not-ready'?report.facts:undefined;
}
export const RUNTIME_REPORT_FACT_SECTIONS:readonly RuntimeReportSection[]=['tasks','agents','agent-tasks','projects','profiles','profile-tasks','attempts','swimlane','quality'];
export const RuntimeReportSectionSchema=z.enum(['tasks','agents','agent-tasks','projects','profiles','profile-tasks','models','attempts','calls','swimlane','captures','quality']);
export type RuntimeReportSection=z.infer<typeof RuntimeReportSectionSchema>;
export const RuntimeReportPageQuerySchema=z.strictObject({section:RuntimeReportSectionSchema,parent:z.string().optional(),rowKey:z.string().min(1).optional(),after:z.string().optional(),pageSize:z.coerce.number().int().min(1).max(500).default(100)});
export type RuntimeReportPageQuery=z.infer<typeof RuntimeReportPageQuerySchema>;
/** Each ready page belongs to the same full immutable report; pageSize never limits total. */
export interface RuntimeReportPage<T> {readonly reportId:string;readonly snapshotId:string;readonly section:RuntimeReportSection;readonly parent:string|null;readonly total:string;readonly items:readonly T[];readonly nextCursor:string|null}

const profileFields={profileId:ResourceIdSchema.nullable(),profileName:z.string().nullable(),profileRevision:z.number().int().nonnegative().nullable()};
export const CompleteRuntimeProjectSchema=z.strictObject({projectId:ProjectIdSchema,projectName:z.string().nullable(),tasks:count,metrics:CompleteRuntimeMetricsSchema});
export const CompleteRuntimeProfileSchema=z.strictObject({key:z.string(),...profileFields,tasks:count,metrics:CompleteRuntimeMetricsSchema});
export const CompleteRuntimeAgentSchema=CompleteRuntimeProfileSchema.extend({projectId:ProjectIdSchema,projectName:z.string().nullable(),agentId:ResourceIdSchema.nullable(),name:z.string(),kind:z.literal('agent'),sourceKind:z.enum(['business-task','development-agent'])});
export const CompleteRuntimeModelSchema=z.strictObject({modelRef:z.string().nullable(),tasks:count,metrics:CompleteRuntimeMetricsSchema});
export const CompleteRuntimeContributionSchema=z.strictObject({taskId:TaskIdSchema,taskName:z.string(),projectId:ProjectIdSchema,projectName:z.string().nullable(),sourceKind:z.enum(['business-task','development-agent']),attempts:count,metrics:CompleteRuntimeMetricsSchema});
export const CompleteRuntimeCallSchema=z.strictObject({taskId:TaskIdSchema,projectId:ProjectIdSchema,projectName:z.string().nullable(),identity:UsageExecutionIdentitySchema,sourceId:z.string(),recordId:z.string(),modelRef:z.string().nullable(),occurredAt:z.iso.datetime().nullable(),scope:UsageRecordSchema.shape.scope,agentName:z.string(),...profileFields,metrics:CompleteRuntimeMetricsSchema});
export type CompleteRuntimeProject=z.infer<typeof CompleteRuntimeProjectSchema>;
export type CompleteRuntimeProfile=z.infer<typeof CompleteRuntimeProfileSchema>;
export type CompleteRuntimeAgent=z.infer<typeof CompleteRuntimeAgentSchema>;
export type CompleteRuntimeModel=z.infer<typeof CompleteRuntimeModelSchema>;
export type CompleteRuntimeContribution=z.infer<typeof CompleteRuntimeContributionSchema>;
export type CompleteRuntimeCall=z.infer<typeof CompleteRuntimeCallSchema>;
