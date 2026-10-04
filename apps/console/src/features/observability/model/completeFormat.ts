import type {CompleteRuntimeMetricsDto} from '@crewstation/contracts';
import type {Translate} from '../../../shared/lib/useT';
export const completeCount=(value:string)=>BigInt(value).toLocaleString();
export function completeTokenValues(metrics:CompleteRuntimeMetricsDto) {return metrics.state==='ready'?metrics.tokens:metrics.state==='not-ready'?metrics.recordedUsage?.tokens:undefined;}
export function completeTokens(metrics:CompleteRuntimeMetricsDto,bucket?:'input'|'cacheRead'|'cacheWrite'|'output') {const value=completeTokenValues(metrics)?.[bucket??'total'];return value===null||value===undefined?'—':completeCount(value);}
export function completeCny(metrics:CompleteRuntimeMetricsDto,t:Translate) {
  const amount=metrics.state==='ready'&&metrics.cost.state==='complete'?metrics.cost.amount:'recordedCost' in metrics?metrics.recordedCost?.amount:undefined;
  if(amount!==null&&amount!==undefined){const [whole='0',fraction='']=amount.split('.'),trimmed=fraction.replace(/0+$/,'');return `¥${completeCount(whole)}${trimmed?'.'+trimmed:''}${metrics.state==='ready'&&metrics.cost.state==='complete'?'':t('runtime.recordedCostSuffix')}`;}
  if(metrics.state==='ready')return t(metrics.cost.state==='hidden'?'runtime.hiddenCost':'runtime.unpricedCost');
  if(metrics.state==='not-ready'&&metrics.costCoverage)return t(metrics.costCoverage.visibility==='hidden'?'runtime.hiddenCost':'runtime.unpricedCost');
  return '—';
}
export function completeDuration(value:string|null) {
  if(value===null)return '—';const ms=BigInt(value);
  if(ms<1000n)return `${completeCount(value)} ms`;
  const divisor=ms<60000n?1000n:60000n,tenths=ms*10n/divisor;
  return `${completeCount(String(tenths/10n))}.${tenths%10n} ${ms<60000n?'s':'min'}`;
}
/** Only the bounded screen ratio becomes a Number; original counts remain exact decimal strings. */
export const completePercent=(value:string,total:string)=>Number(BigInt(value)*1000000n/(BigInt(total)||1n))/10000;
