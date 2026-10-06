// Same original ledger valuation, with exact known amounts, unknown bins and exclusive full/partial record counts.
import {expect,test} from 'bun:test';
import {CompleteRuntimeMetricsSchema,ExecutionObservationIdentitySchema,UsageValuationSchema} from '@crewstation/contracts';
import {newResourceId} from '@crewstation/kernel';
import {addCompleteRuntimeAllocation,completeRuntimeMetrics,emptyCompleteRuntimeFold,mergeCompleteRuntimeFold,type CompleteRuntimeFold} from '../../domain/completeRuntimeMetrics';
import {valueTokenUsage} from '../../domain/cnyPricing';
import type {TokenUsage} from '../../domain/tokenUsage';
const identity=ExecutionObservationIdentitySchema.parse({projectId:newResourceId(),taskId:newResourceId(),subtaskId:newResourceId(),executionId:newResourceId(),executionGeneration:1}),at='2026-10-04T00:00:00.000Z';
const partialUsage={input:'120',cacheRead:null,cacheWrite:'0',output:null};
function valuation(usage:TokenUsage=partialUsage) {
 const priced=valueTokenUsage(usage,{input:'1',cacheRead:'0.5',cacheWrite:'3',output:'8'});
 const value=UsageValuationSchema.parse({kind:'valuation',identity,sourceId:'original',recordId:'record',revision:1,occurredAt:at,observedAt:at,valuationId:'value',valuationRevision:1,usageRevision:7,currency:'CNY',completeness:priced.completeness==='complete'?'complete':'partial',availability:'priced',priceVersionRef:'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL-PARTIAL',amountDecimal:priced.knownAmount});
 if(value.availability!=='priced')throw new Error('Original priced fixture expected');return value;
}
function partialFold(usage:TokenUsage=partialUsage){const fold=emptyCompleteRuntimeFold(true,'1');fold.observedExecutions='1';addCompleteRuntimeAllocation(fold,usage,valuation(usage),true,7);return fold;}
test('a partial original amount preserves all known buckets and its exact CNY without any complete priced record',()=>{
 const metrics=completeRuntimeMetrics(partialFold());expect(metrics).toMatchObject({state:'not-ready',recordedUsage:{records:'1',tokens:{...partialUsage,total:'120'},bucketRecords:{input:'1',cacheRead:'0',cacheWrite:'1',output:'0'}},costCoverage:{records:'1',pricedRecords:'0',partiallyPricedRecords:'1',visibility:'visible'},recordedCost:{currency:'CNY',amount:'0.00012',records:'1',pricedRecords:'0',partiallyPricedRecords:'1'}});expect(metrics).not.toHaveProperty('cost');expect(CompleteRuntimeMetricsSchema.parse(metrics)).toEqual(metrics);
});
test('restored and merged original folds accumulate full and partial amounts exactly once and keep their original record population',()=>{
 const partial=JSON.parse(JSON.stringify(partialFold())) as CompleteRuntimeFold,full=emptyCompleteRuntimeFold(true,'1'),unknown=emptyCompleteRuntimeFold(true,'1'),usage={input:'20',cacheRead:'0',cacheWrite:'0',output:'0'};
 addCompleteRuntimeAllocation(full,usage,valuation(usage),true,7);addCompleteRuntimeAllocation(unknown,{input:'0',cacheRead:'0',cacheWrite:'0',output:'0'},undefined,true,7);
 const overall=emptyCompleteRuntimeFold(true);for(const next of [partial,full,unknown])mergeCompleteRuntimeFold(overall,next);
 const metrics=completeRuntimeMetrics(overall);expect(metrics).toMatchObject({state:'not-ready',costCoverage:{records:'3',pricedRecords:'1',partiallyPricedRecords:'1'},recordedCost:{amount:'0.00014',records:'3',pricedRecords:'1',partiallyPricedRecords:'1'}});expect(CompleteRuntimeMetricsSchema.parse(metrics)).toEqual(metrics);
 const legacy=completeRuntimeMetrics(full);expect(legacy.state).toBe('ready');expect(legacy).not.toHaveProperty('costCoverage');expect(legacy).not.toHaveProperty('partiallyPricedRecords');
});
test('known partial zero is recorded zero; wholly unknown zero and unqualified original amounts are not evidence',()=>{
 const zero=completeRuntimeMetrics(partialFold({...partialUsage,input:'0'}));expect(zero).toMatchObject({recordedCost:{amount:'0',pricedRecords:'0',partiallyPricedRecords:'1'}});expect(CompleteRuntimeMetricsSchema.parse(zero)).toEqual(zero);
 const unknown=completeRuntimeMetrics(partialFold({input:null,cacheRead:null,cacheWrite:null,output:null}));expect(unknown).not.toHaveProperty('recordedCost');expect(unknown).toMatchObject({costCoverage:{records:'1',pricedRecords:'0'}});if(unknown.state!=='not-ready')throw new Error('Unknown original bins must remain incomplete');expect(unknown.costCoverage).not.toHaveProperty('partiallyPricedRecords');
 for(const [whole,revision,qualified,visible] of [[false,7,true,true],[true,8,true,true],[true,7,false,true],[true,7,true,false]] as const){const fold=emptyCompleteRuntimeFold(visible,'1');addCompleteRuntimeAllocation(fold,partialUsage,valuation(),whole,revision,qualified);const metrics=completeRuntimeMetrics(fold);expect(metrics).not.toHaveProperty('recordedCost');expect(CompleteRuntimeMetricsSchema.parse(metrics)).toEqual(metrics);}
});
test('partial contracts keep canonical exclusive counts, real bucket evidence and one shared cost population',()=>{
 const metrics=completeRuntimeMetrics(partialFold());if(metrics.state!=='not-ready'||!metrics.recordedUsage||!metrics.recordedCost||!metrics.costCoverage)throw new Error('Original partial facts missing');
 for(const value of [{...metrics,costCoverage:{...metrics.costCoverage,partiallyPricedRecords:'2'}},{...metrics,costCoverage:{...metrics.costCoverage,pricedRecords:'1'}},{...metrics,costCoverage:{...metrics.costCoverage,partiallyPricedRecords:'01'}},{...metrics,recordedCost:{...metrics.recordedCost,partiallyPricedRecords:'0'}},{...metrics,recordedUsage:undefined},{...metrics,costCoverage:{...metrics.costCoverage,visibility:'hidden'}},{...metrics,recordedCost:{...metrics.recordedCost,records:'2'}}])expect(CompleteRuntimeMetricsSchema.safeParse(value).success).toBe(false);
});
