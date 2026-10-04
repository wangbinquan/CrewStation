// A real usage gap must retain received values without claiming an entire total.
import { describe, expect, test } from 'bun:test';
import { CompleteRuntimeMetricsSchema, UsageValuationSchema, ExecutionObservationIdentitySchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { addCompleteRuntimeAllocation, completeRuntimeMetrics, emptyCompleteRuntimeFold, completeRuntimeGap, mergeCompleteRuntimeFold } from './completeRuntimeMetrics';
const identity=ExecutionObservationIdentitySchema.parse({projectId:newResourceId(),taskId:newResourceId(),subtaskId:newResourceId(),executionId:newResourceId(),executionGeneration:1});
const at='2026-10-04T00:00:00.000Z';
const priced = () => {
  const value = UsageValuationSchema.parse({kind:'valuation',identity,sourceId:'original',recordId:'record',revision:1,occurredAt:at,observedAt:at,valuationId:'value',valuationRevision:1,usageRevision:7,currency:'CNY',completeness:'complete',availability:'priced',priceVersionRef:'acceptance-only-CNY',amountDecimal:'0.25'});
  if (value.availability !== 'priced') throw new Error('Expected actual priced test valuation');
  return value;
};
const contribution={input:'80',cacheRead:'3',cacheWrite:'5',output:'7'};
describe('received usage inside incomplete original scope',()=>{
 test('missing execution preserves the exact received bins, record population and CNY without full totals',()=>{
  const good=emptyCompleteRuntimeFold(true,'1');good.observedExecutions='1';addCompleteRuntimeAllocation(good,contribution,priced(),true,7);
  const missing=emptyCompleteRuntimeFold(true,'1');completeRuntimeGap(missing,'usage-missing');
  const overall=emptyCompleteRuntimeFold(true);mergeCompleteRuntimeFold(overall,good);mergeCompleteRuntimeFold(overall,missing);
  const metrics=completeRuntimeMetrics(overall);expect(metrics.state).toBe('not-ready');expect(metrics).not.toHaveProperty('tokens');expect(metrics).not.toHaveProperty('cost');
  expect(metrics).toMatchObject({recordedUsage:{executions:'2',observedExecutions:'1',records:'1',tokens:{...contribution,total:'95'},bucketRecords:{input:'1',cacheRead:'1',cacheWrite:'1',output:'1'}},costCoverage:{records:'1',pricedRecords:'1',visibility:'visible'},recordedCost:{currency:'CNY',amount:'0.25',records:'1',pricedRecords:'1'}});
  expect(CompleteRuntimeMetricsSchema.parse(metrics)).toEqual(metrics);
 });
 test('a bucket without any known record stays null while real zero records remain visible',()=>{
  const fold=emptyCompleteRuntimeFold(true,'1');addCompleteRuntimeAllocation(fold,{input:'0',cacheRead:null,cacheWrite:null,output:'7'},undefined,true,7);
  expect(completeRuntimeMetrics(fold)).toMatchObject({state:'not-ready',recordedUsage:{tokens:{input:'0',cacheRead:null,cacheWrite:null,output:'7',total:'7'},bucketRecords:{input:'1',cacheRead:'0',cacheWrite:'0',output:'1'}},costCoverage:{records:'1',pricedRecords:'0',visibility:'visible'}});
  expect(completeRuntimeMetrics(fold)).not.toHaveProperty('recordedCost');
  const unknown=emptyCompleteRuntimeFold(true,'1');addCompleteRuntimeAllocation(unknown,{input:null,cacheRead:null,cacheWrite:null,output:null},undefined,true,7);expect(completeRuntimeMetrics(unknown)).not.toHaveProperty('recordedUsage');
 });
 test('ambiguous original record contributes only its denominator and propagates incomplete qualification',()=>{
  const fold=emptyCompleteRuntimeFold(true,'1');addCompleteRuntimeAllocation(fold,contribution,priced(),true,7);addCompleteRuntimeAllocation(fold,{input:'1000',cacheRead:'1000',cacheWrite:'1000',output:'1000'},priced(),true,7,false);
  const metrics=completeRuntimeMetrics(fold);expect(metrics).toMatchObject({state:'not-ready',gaps:['coverage-incomplete'],recordedUsage:{records:'2',tokens:{...contribution,total:'95'},bucketRecords:{input:'1',cacheRead:'1',cacheWrite:'1',output:'1'}},costCoverage:{records:'2',pricedRecords:'1',visibility:'visible'},recordedCost:{currency:'CNY',amount:'0.25',records:'2',pricedRecords:'1'}});
 });
 test('stale and partial valuations stay in the record population, hiding never carries an amount, actual zero needs a priced record',()=>{
  for(const value of [undefined,{...priced(),usageRevision:6},{...priced(),completeness:'partial' as const}]){
   const fold=emptyCompleteRuntimeFold(true,'1');addCompleteRuntimeAllocation(fold,contribution,priced(),true,7);addCompleteRuntimeAllocation(fold,contribution,value,true,7);completeRuntimeGap(fold,'native-capture-incomplete');
   expect(completeRuntimeMetrics(fold)).toMatchObject({costCoverage:{records:'2',pricedRecords:'1',visibility:'visible'},recordedCost:{currency:'CNY',amount:'0.25',records:'2',pricedRecords:'1'}});
  }
  const hidden=emptyCompleteRuntimeFold(false,'1');addCompleteRuntimeAllocation(hidden,contribution,priced(),true,7);completeRuntimeGap(hidden,'usage-missing');expect(completeRuntimeMetrics(hidden)).toMatchObject({costCoverage:{records:'1',pricedRecords:'1',visibility:'hidden'}});expect(completeRuntimeMetrics(hidden)).not.toHaveProperty('recordedCost');
  const zero=emptyCompleteRuntimeFold(true,'1');addCompleteRuntimeAllocation(zero,contribution,{...priced(),amountDecimal:'0'},true,7);completeRuntimeGap(zero,'usage-missing');expect(completeRuntimeMetrics(zero)).toMatchObject({recordedCost:{amount:'0',pricedRecords:'1'}});
 });
 test('received contracts reject count mismatches, invented null zeroes, wrong sums and hidden amounts',()=>{
  const fold=emptyCompleteRuntimeFold(true,'1');addCompleteRuntimeAllocation(fold,contribution,priced(),true,7);completeRuntimeGap(fold,'usage-missing');
  const metrics=completeRuntimeMetrics(fold);if(metrics.state!=='not-ready'||!metrics.recordedUsage||!metrics.recordedCost||!metrics.costCoverage)throw new Error('Received evidence missing');
  for(const replacement of [
   {...metrics,recordedUsage:{...metrics.recordedUsage,records:'0'}},
   {...metrics,recordedUsage:{...metrics.recordedUsage,bucketRecords:{...metrics.recordedUsage.bucketRecords,input:'0'}}},
   {...metrics,recordedUsage:{...metrics.recordedUsage,tokens:{...metrics.recordedUsage.tokens,total:'94'}}},
   {...metrics,costCoverage:{...metrics.costCoverage,pricedRecords:'2'}},
   {...metrics,recordedCost:{...metrics.recordedCost,records:'2'}},
   {...metrics,costCoverage:{...metrics.costCoverage,visibility:'hidden'}},
   {...metrics,recordedCost:{...metrics.recordedCost,currency:'USD'}},
  ])expect(CompleteRuntimeMetricsSchema.safeParse(replacement).success).toBe(false);
 });
});
