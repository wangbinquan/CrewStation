import { describe,expect,test } from 'bun:test';
import { UsageValuationSchema,ExecutionObservationIdentitySchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { addCompleteRuntimeAllocation,completeRuntimeMetrics,emptyCompleteRuntimeFold,mergeCompleteRuntimeFold,completeRuntimeGap } from './completeRuntimeMetrics';
const identity=ExecutionObservationIdentitySchema.parse({projectId:newResourceId(),taskId:newResourceId(),subtaskId:newResourceId(),executionId:newResourceId(),executionGeneration:1});
const at='2026-10-03T00:00:00.000Z';
const priced=()=>UsageValuationSchema.parse({kind:'valuation',identity,sourceId:'original',recordId:'record',revision:1,occurredAt:at,observedAt:at,valuationId:'value',valuationRevision:1,usageRevision:7,currency:'CNY',completeness:'complete',availability:'priced',priceVersionRef:'acceptance-only-CNY',amountDecimal:'0.000001234567'});
const contribution={input:'9007199254740993123456789',cacheRead:'3',cacheWrite:'5',output:'7'};
describe('complete runtime metrics exact publication',()=>{
  test('10001 allocations retain four independent bins and exact CNY beyond safe-integer precision',()=>{
    const fold=emptyCompleteRuntimeFold(true,'1');fold.observedExecutions='1';
    for(let i=0;i<10001;i++) addCompleteRuntimeAllocation(fold,contribution,priced(),true,7);
    const metric=completeRuntimeMetrics(fold);expect(metric.state).toBe('ready');
    if(metric.state!=='ready') throw new Error('original known metric missing');
    expect(metric.tokens).toEqual({input:(BigInt(contribution.input)*10001n).toString(),cacheRead:'30003',cacheWrite:'50005',output:'70007',total:((BigInt(contribution.input)+15n)*10001n).toString()});
    expect(metric.records).toBe('10001');expect(metric.executions).toBe('1');
    expect(metric.cost).toEqual({currency:'CNY',state:'complete',amount:'0.012346904567'});
  });
  test('missing, stale, partially allocated and partial valuations never publish their priced subset',()=>{
    for(const [value,whole,revision] of [[undefined,true,7],[priced(),true,8],[priced(),false,7],[{...priced(),completeness:'partial' as const},true,7]] as const) {
      const fold=emptyCompleteRuntimeFold(true,'1');
      addCompleteRuntimeAllocation(fold,contribution,priced(),true,7);
      addCompleteRuntimeAllocation(fold,contribution,value,whole,revision);
      const metric=completeRuntimeMetrics(fold);expect(metric.state).toBe('ready');
      if(metric.state!=='ready') throw new Error('known token evidence missing');
      expect(metric.cost).toEqual({currency:'CNY',state:'unpriced',amount:null});
    }
    const hidden=emptyCompleteRuntimeFold(false,'1');addCompleteRuntimeAllocation(hidden,contribution,priced(),true,7);
    const metric=completeRuntimeMetrics(hidden);if(metric.state!=='ready') throw new Error('known hidden-cost token evidence missing');
    expect(metric.cost).toEqual({currency:'CNY',state:'hidden',amount:null});
  });
  test('a single missing native row keeps full totals unknown while preserving its received evidence',()=>{
    const good=emptyCompleteRuntimeFold(true,'1');addCompleteRuntimeAllocation(good,contribution,priced(),true,7);
    const missing=emptyCompleteRuntimeFold(true,'1');completeRuntimeGap(missing,'native-capture-unobserved');
    const overall=emptyCompleteRuntimeFold(true);mergeCompleteRuntimeFold(overall,good);mergeCompleteRuntimeFold(overall,missing);
    const metrics=completeRuntimeMetrics(overall);expect(metrics).toMatchObject({state:'not-ready',gaps:['native-capture-unobserved'],recordedUsage:{tokens:{...contribution,total:(BigInt(contribution.input)+15n).toString()},records:'1'},recordedCost:{currency:'CNY',amount:'0.000001234567',records:'1',pricedRecords:'1'}});expect(metrics).not.toHaveProperty('tokens');expect(metrics).not.toHaveProperty('cost');
    expect(completeRuntimeMetrics(emptyCompleteRuntimeFold(true))).toEqual({state:'not-applicable'});
  });
  test('an unknown category cannot become a numeric zero or a priced total',()=>{
    const fold=emptyCompleteRuntimeFold(true,'1');addCompleteRuntimeAllocation(fold,{...contribution,cacheRead:null},priced(),true,7);
    const metrics=completeRuntimeMetrics(fold);expect(metrics).toMatchObject({state:'not-ready',gaps:['usage-incomplete'],recordedUsage:{tokens:{...contribution,cacheRead:null,total:(BigInt(contribution.input)+12n).toString()},bucketRecords:{input:'1',cacheRead:'0',cacheWrite:'1',output:'1'}}});expect(metrics).not.toHaveProperty('tokens');expect(metrics).not.toHaveProperty('cost');
  });
});
