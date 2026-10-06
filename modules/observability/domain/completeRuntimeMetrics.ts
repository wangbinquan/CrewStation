import type { UsageValuation, CompleteRuntimeMetricsDto } from '@crewstation/contracts';
import { cnyPicos } from './cnyPricing';
import { TOKEN_BUCKETS, tokenCount, type TokenUsage } from './tokenUsage';

export interface CompleteRuntimeFold {
  tokens: Record<keyof TokenUsage,string>;
  bucketRecords: Record<keyof TokenUsage,string>;
  executions: string;
  observedExecutions: string;
  records: string;
  pricedRecords: string;
  partiallyPricedRecords?: string;
  picos: string;
  visible: boolean;
  priced: boolean;
  gaps: string[];
}
export type CompleteRuntimeMetrics = CompleteRuntimeMetricsDto;
export function emptyCompleteRuntimeFold(visible:boolean, executions='0'):CompleteRuntimeFold {
  return {tokens:{input:'0',cacheRead:'0',cacheWrite:'0',output:'0'},bucketRecords:{input:'0',cacheRead:'0',cacheWrite:'0',output:'0'},executions,observedExecutions:'0',records:'0',pricedRecords:'0',picos:'0',visible,priced:true,gaps:[]};
}
export function completeRuntimeGap(fold:CompleteRuntimeFold, reason:string) {
  if (!fold.gaps.includes(reason)) fold.gaps.push(reason);
}
/** Original ambiguous evidence counts once but cannot contribute guessed values or prices. */
export function addCompleteRuntimeAllocation(fold:CompleteRuntimeFold, contribution:TokenUsage, value:UsageValuation|undefined, whole:boolean, usageRevision:number, qualified=true) {
  fold.records=(BigInt(fold.records)+1n).toString();
  if(!qualified){fold.priced=false;completeRuntimeGap(fold,'coverage-incomplete');return;}
  let knownBuckets=0;
  for (const bucket of TOKEN_BUCKETS) {
    const count=tokenCount(contribution[bucket]);
    if (count===null) completeRuntimeGap(fold,'usage-incomplete');
    else {knownBuckets++;fold.tokens[bucket]=(BigInt(fold.tokens[bucket])+BigInt(count)).toString();fold.bucketRecords[bucket]=(BigInt(fold.bucketRecords[bucket])+1n).toString();}
  }
  if (whole&&value?.usageRevision===usageRevision&&value.availability==='priced') {
    if(value.completeness==='complete'&&knownBuckets===TOKEN_BUCKETS.length){fold.picos=(BigInt(fold.picos)+cnyPicos(value.amountDecimal)).toString();fold.pricedRecords=(BigInt(fold.pricedRecords)+1n).toString();}
    else {fold.priced=false;if(fold.visible&&knownBuckets>0){fold.picos=(BigInt(fold.picos)+cnyPicos(value.amountDecimal)).toString();fold.partiallyPricedRecords=(BigInt(fold.partiallyPricedRecords??'0')+1n).toString();}}
  } else fold.priced=false;
}
export function mergeCompleteRuntimeFold(into:CompleteRuntimeFold, next:CompleteRuntimeFold) {
  for (const bucket of TOKEN_BUCKETS) {into.tokens[bucket]=(BigInt(into.tokens[bucket])+BigInt(next.tokens[bucket])).toString();into.bucketRecords[bucket]=(BigInt(into.bucketRecords[bucket])+BigInt(next.bucketRecords[bucket])).toString();}
  for (const field of ['executions','observedExecutions','records','pricedRecords','picos'] as const) into[field]=(BigInt(into[field])+BigInt(next[field])).toString();
  const partial=BigInt(into.partiallyPricedRecords??'0')+BigInt(next.partiallyPricedRecords??'0');if(partial>0n)into.partiallyPricedRecords=partial.toString();
  into.visible &&= next.visible; into.priced &&= next.priced;
  for (const reason of next.gaps) completeRuntimeGap(into,reason);
}
export function exactCompleteCny(picos:string) {
  const n=BigInt(picos),fraction=(n%1_000_000_000_000n).toString().padStart(12,'0').replace(/0+$/,'');
  return `${n/1_000_000_000_000n}${fraction?'.'+fraction:''}`;
}
/** Recorded values are separate from the unknown entire total and retain the original population. */
export function completeRuntimeMetrics(fold:CompleteRuntimeFold):CompleteRuntimeMetrics {
  const partial=BigInt(fold.partiallyPricedRecords??'0'),partialFields=partial>0n?{partiallyPricedRecords:partial.toString()}:{};
  const costCoverage={records:fold.records,pricedRecords:fold.pricedRecords,...partialFields,visibility:fold.visible?'visible' as const:'hidden' as const};
  const recordedCost=fold.visible&&BigInt(fold.pricedRecords)+partial>0n?{currency:'CNY' as const,amount:exactCompleteCny(fold.picos),records:fold.records,pricedRecords:fold.pricedRecords,...partialFields}:undefined;
  const total=TOKEN_BUCKETS.reduce((sum,bucket)=>sum+BigInt(fold.tokens[bucket]),0n).toString();
  if (fold.gaps.length) {
    const recordedUsage=TOKEN_BUCKETS.some(bucket=>fold.bucketRecords[bucket]!=='0')?{executions:fold.executions,observedExecutions:fold.observedExecutions,records:fold.records,tokens:{input:fold.bucketRecords.input==='0'?null:fold.tokens.input,cacheRead:fold.bucketRecords.cacheRead==='0'?null:fold.tokens.cacheRead,cacheWrite:fold.bucketRecords.cacheWrite==='0'?null:fold.tokens.cacheWrite,output:fold.bucketRecords.output==='0'?null:fold.tokens.output,total},bucketRecords:{...fold.bucketRecords}}:undefined;
    return {state:'not-ready',gaps:[...fold.gaps],costCoverage,...(recordedUsage?{recordedUsage}:{}),...(recordedCost?{recordedCost}:{})};
  }
  if (fold.executions==='0') return {state:'not-applicable'};
  const state=!fold.visible?'hidden':fold.priced?'complete':'unpriced';
  return {state:'ready',tokens:{...fold.tokens,total},executions:fold.executions,observedExecutions:fold.observedExecutions,records:fold.records,cost:{currency:'CNY',state,amount:state==='complete'?exactCompleteCny(fold.picos):null},...(state==='unpriced'?{costCoverage,...(recordedCost?{recordedCost}:{})}:{})};
}
