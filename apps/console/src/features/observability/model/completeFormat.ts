import type {CompleteRuntimeMetricsDto} from '@crewstation/contracts';
import type {Translate} from '../../../shared/lib/useT';
export const completeCount=(value:string)=>BigInt(value).toLocaleString();
export function completeTokens(metrics:CompleteRuntimeMetricsDto,bucket?:'input'|'cacheRead'|'cacheWrite'|'output') {return metrics.state==='ready'?completeCount(metrics.tokens[bucket??'total']):'—';}
export function completeCny(metrics:CompleteRuntimeMetricsDto,t:Translate) {
  if(metrics.state!=='ready')return '—';
  if(metrics.cost.state!=='complete')return t(metrics.cost.state==='hidden'?'runtime.hiddenCost':'runtime.unpricedCost');
  const [whole='0',fraction='']=metrics.cost.amount!.split('.'),trimmed=fraction.replace(/0+$/,'');
  return `¥${completeCount(whole)}${trimmed?'.'+trimmed:''}`;
}
export function completeDuration(value:string|null) {
  if(value===null)return '—';const ms=BigInt(value);
  if(ms<1000n)return `${completeCount(value)} ms`;
  const divisor=ms<60000n?1000n:60000n,tenths=ms*10n/divisor;
  return `${completeCount(String(tenths/10n))}.${tenths%10n} ${ms<60000n?'s':'min'}`;
}
/** Only the bounded screen ratio becomes a Number; original counts remain exact decimal strings. */
export const completePercent=(value:string,total:string)=>Number(BigInt(value)*1000000n/(BigInt(total)||1n))/10000;
