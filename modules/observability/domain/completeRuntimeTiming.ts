import type {RuntimeAttemptFact,RuntimeTaskHeaderFact} from '@crewstation/contracts';
const running=new Set(['running','awaiting-input','verifying','cancelling']);
const terminal=new Set(['closed','succeeded','failed','cancelled']);
export interface CompleteInterval {readonly start:number;readonly end:number}
export function completeAttemptTiming(task:RuntimeTaskHeaderFact,attempt:RuntimeAttemptFact,asOf:number) {
  if(!Number.isSafeInteger(asOf)) throw new RangeError('Original timing snapshot is invalid');
  const start=attempt.startedAt===null?null:Date.parse(attempt.startedAt);
  const open=attempt.endedAt===null&&running.has(attempt.state)&&!terminal.has(task.state)&&task.closedAt===null;
  const end=attempt.endedAt===null?open?asOf:null:Date.parse(attempt.endedAt);
  const valid=start!==null&&end!==null&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=end&&end<=asOf;
  return {durationMs:valid?String(end-start):null,open:open&&valid,interval:valid?{start,end}:null};
}
export function completeTaskWallMs(task:RuntimeTaskHeaderFact,asOf:number) {
  if(task.source?.kind==='development-agent') return null;
  const start=Date.parse(task.createdAt),end=task.closedAt===null?terminal.has(task.state)?null:asOf:Date.parse(task.closedAt);
  return Number.isSafeInteger(start)&&end!==null&&Number.isSafeInteger(end)&&start<=end&&end<=asOf?String(end-start):null;
}
export const completeDurationSample=(task:RuntimeTaskHeaderFact)=>task.source?.kind!=='development-agent'&&terminal.has(task.state);
/** Nearest-rank quantiles have integer arithmetic even beyond JS Number's exact range. */
export function completePercentileRank(count:bigint,numerator:bigint,denominator:bigint) {
  if(count<0n||numerator<=0n||denominator<=0n||numerator>denominator) throw new RangeError('Invalid original percentile rank');
  return (count*numerator+denominator-1n)/denominator;
}
export async function completeIntervalTotals(records:AsyncIterable<CompleteInterval>) {
  let cumulative=0n,union=0n,previousEnd:number|undefined,previous:CompleteInterval|undefined;
  for await(const row of records) {
    if(!Number.isSafeInteger(row.start)||!Number.isSafeInteger(row.end)||row.start>row.end) throw new RangeError('Invalid original execution interval');
    if(previous&&(row.start<previous.start||row.start===previous.start&&row.end<previous.end)) throw new Error('Original interval merge is not ordered');
    cumulative+=BigInt(row.end-row.start);
    union+=BigInt(Math.max(0,row.end-Math.max(previousEnd??row.start,row.start)));
    previousEnd=Math.max(previousEnd??row.end,row.end);previous=row;
  }
  return {cumulativeMs:String(cumulative),activeUnionMs:String(union)};
}

export type CompleteTaskTiming={readonly wallMs:string|null;readonly range:{readonly from:string;readonly to:string}|null;readonly intervals:{readonly state:'complete';readonly unknown:'0';readonly cumulativeMs:string;readonly activeUnionMs:string}|{readonly state:'not-ready';readonly unknown:string}};
