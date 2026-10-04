import {describe,test,expect} from 'bun:test';
import {CompleteRuntimeMetricsSchema,RuntimeCompleteReportSchema,RuntimeReportPageQuerySchema} from './completeRuntimeReport';
const tokens={input:'9007199254740993',cacheRead:'3',cacheWrite:'5',output:'7',total:'9007199254741008'};
const ready={state:'ready' as const,tokens,executions:'10001',observedExecutions:'10001',records:'20001',cost:{currency:'CNY' as const,state:'complete' as const,amount:'18014398509.481986000001'}};
describe('complete statistics contract',()=>{
 test('counts and four token buckets have no population or digit-width cap',()=>{
  expect(CompleteRuntimeMetricsSchema.parse(ready)).toEqual(ready);
  const huge='1'+'0'.repeat(300);expect(CompleteRuntimeMetricsSchema.parse({...ready,executions:huge,records:huge,tokens:{input:huge,cacheRead:'0',cacheWrite:'0',output:'0',total:huge}})).toMatchObject({tokens:{total:huge}});
  for(const pageSize of [1,100,500])expect(RuntimeReportPageQuerySchema.parse({section:'tasks',pageSize}).pageSize).toBe(pageSize);
 });
 test('unknown, missing bins and inconsistent totals never parse as ready metrics',()=>{
  expect(CompleteRuntimeMetricsSchema.safeParse({...ready,tokens:{...tokens,total:'9007199254741007'}}).success).toBe(false);
  expect(CompleteRuntimeMetricsSchema.safeParse({...ready,tokens:{...tokens,output:null}}).success).toBe(false);
  expect(CompleteRuntimeMetricsSchema.safeParse({...ready,observedExecutions:'10002'}).success).toBe(false);
 });
 test('unpriced or hidden valuations have no partial amount; incomplete reports have no totals',()=>{
  for(const state of ['unpriced','hidden']){
   expect(CompleteRuntimeMetricsSchema.safeParse({...ready,cost:{currency:'CNY',state,amount:null}}).success).toBe(true);
   expect(CompleteRuntimeMetricsSchema.safeParse({...ready,cost:{currency:'CNY',state,amount:'0'}}).success).toBe(false);
  }
  const reportId=Bun.randomUUIDv7();
  for(const report of [{state:'building',phase:'collecting'},{state:'not-ready',gaps:[{source:'original','reason':'missing'}]},{state:'failed',error:'missing original page',retryable:true}]){
   expect(RuntimeCompleteReportSchema.safeParse({reportId,...report}).success).toBe(true);
   expect(RuntimeCompleteReportSchema.safeParse({reportId,...report,summary:{metrics:ready}}).success).toBe(false);
  }
 });
});

// Missing numeric evidence must preserve the independent execution facts without upgrading readiness.
describe('sealed execution facts',()=>{
 test('strict not-ready facts retain counts and timing but reject every nested token or amount subtotal',()=>{
  const reportId=Bun.randomUUIDv7(),metrics={state:'not-ready' as const,gaps:['native-capture-incomplete']};
  const header={reportId,projectionVersion:2 as const,scope:'system' as const,projectId:null,filters:{from:'2026-10-03T00:00:00.000Z',to:'2026-10-04T00:00:00.000Z',timezone:'Asia/Shanghai'},asOf:'2026-10-04T00:00:00.000Z',snapshotId:'original-facts',generation:'1',sourceRevision:'2',coverage:'complete-facts' as const,buildMs:1};
  const summary={tasks:'201',metrics,durations:{state:'complete' as const,samples:'201',p50Ms:'10000',p95Ms:'10000',maxMs:'10000'},trend:[{from:header.filters.from,to:header.filters.to,tasks:'201',metrics}],sources:[{kind:'business-task' as const,tasks:'201',metrics,collectionState:'available' as const}]};
  const report={state:'not-ready' as const,reportId,gaps:[{source:'original',reason:metrics.gaps[0]!}],facts:{header,summary}};
  const parsed=RuntimeCompleteReportSchema.parse(report);expect(parsed.state).toBe('not-ready');expect(parsed).toEqual(report);
  expect(RuntimeCompleteReportSchema.safeParse({...report,reportId:Bun.randomUUIDv7()}).success).toBe(false);
  expect(RuntimeCompleteReportSchema.safeParse({...report,facts:{header:{...header,coverage:'complete'},summary}}).success).toBe(false);
  for(const replacement of [
   {...summary,metrics:ready},
   {...summary,trend:[{...summary.trend[0]!,metrics:ready}]},
   {...summary,sources:[{...summary.sources[0]!,metrics:ready}]},
   {...summary,metrics:{...metrics,tokens:ready.tokens}},
   {...summary,metrics:{...metrics,cost:ready.cost}},
  ])expect(RuntimeCompleteReportSchema.safeParse({...report,facts:{header,summary:replacement}}).success).toBe(false);
  expect(RuntimeCompleteReportSchema.safeParse({reportId,state:'ready',header,summary:{...summary,metrics:ready}}).success).toBe(false);
 });
});
