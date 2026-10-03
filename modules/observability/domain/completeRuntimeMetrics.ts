import type { UsageValuation,CompleteRuntimeMetricsDto } from '@crewstation/contracts';
import { cnyPicos } from './cnyPricing';
import { TOKEN_BUCKETS, tokenCount, type TokenUsage } from './tokenUsage';

export interface CompleteRuntimeFold {
  tokens: Record<keyof TokenUsage,string>;
  executions: string;
  observedExecutions: string;
  records: string;
  picos: string;
  visible: boolean;
  priced: boolean;
  gaps: string[];
}
export type CompleteRuntimeMetrics = CompleteRuntimeMetricsDto;

export function emptyCompleteRuntimeFold(visible:boolean, executions='0'):CompleteRuntimeFold {
  return { tokens:{input:'0',cacheRead:'0',cacheWrite:'0',output:'0'},executions,observedExecutions:'0',records:'0',picos:'0',visible,priced:true,gaps:[] };
}
export function completeRuntimeGap(fold:CompleteRuntimeFold, reason:string) {
  if (!fold.gaps.includes(reason)) fold.gaps.push(reason);
}
/** Only a whole current canonical valuation can contribute; partial prices are never a total. */
export function addCompleteRuntimeAllocation(fold:CompleteRuntimeFold, contribution:TokenUsage, value:UsageValuation|undefined, whole:boolean, usageRevision:number) {
  fold.records=(BigInt(fold.records)+1n).toString();
  for (const bucket of TOKEN_BUCKETS) {
    const count=tokenCount(contribution[bucket]);
    if (count===null) completeRuntimeGap(fold,'usage-incomplete');
    else fold.tokens[bucket]=(BigInt(fold.tokens[bucket])+BigInt(count)).toString();
  }
  if (!whole || !value || value.usageRevision!==usageRevision || value.availability!=='priced' || value.completeness!=='complete') fold.priced=false;
  else fold.picos=(BigInt(fold.picos)+cnyPicos(value.amountDecimal)).toString();
}
export function mergeCompleteRuntimeFold(into:CompleteRuntimeFold, next:CompleteRuntimeFold) {
  for (const bucket of TOKEN_BUCKETS) into.tokens[bucket]=(BigInt(into.tokens[bucket])+BigInt(next.tokens[bucket])).toString();
  for (const field of ['executions','observedExecutions','records','picos'] as const) into[field]=(BigInt(into[field])+BigInt(next[field])).toString();
  into.visible &&= next.visible; into.priced &&= next.priced;
  for (const reason of next.gaps) completeRuntimeGap(into,reason);
}
export function exactCompleteCny(picos:string) {
  const n=BigInt(picos),fraction=(n%1_000_000_000_000n).toString().padStart(12,'0').replace(/0+$/,'');
  return `${n/1_000_000_000_000n}${fraction?'.'+fraction:''}`;
}
/** Non-ready and non-applicable values cannot carry any statistical numbers. */
export function completeRuntimeMetrics(fold:CompleteRuntimeFold):CompleteRuntimeMetrics {
  if (fold.gaps.length) return {state:'not-ready',gaps:[...fold.gaps]};
  if (fold.executions==='0') return {state:'not-applicable'};
  const state=!fold.visible?'hidden':fold.priced?'complete':'unpriced';
  return {state:'ready',tokens:{...fold.tokens,total:TOKEN_BUCKETS.reduce((sum,bucket)=>sum+BigInt(fold.tokens[bucket]),0n).toString()},executions:fold.executions,observedExecutions:fold.observedExecutions,records:fold.records,cost:{currency:'CNY',state,amount:state==='complete'?exactCompleteCny(fold.picos):null}};
}
