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
