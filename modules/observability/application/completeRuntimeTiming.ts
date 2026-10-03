import type {RuntimeAttemptFact,RuntimeTaskHeaderFact} from '@crewstation/contracts';
import type {CompleteRuntimeMetrics} from '../domain/completeRuntimeMetrics';
import {completeAttemptTiming,completeIntervalTotals,completeTaskWallMs,type CompleteInterval,type CompleteTaskTiming} from '../domain/completeRuntimeTiming';
import type {CompleteWorkingRows} from '../ports/completeWorkingRows';
import {completeWorkingPages,completeWorkingTraversal} from './completeWorkingTraversal';
import {completeExternalSort} from './completeExternalSort';
export interface CompleteTimedAttempt extends RuntimeAttemptFact {readonly metrics:CompleteRuntimeMetrics;readonly durationMs:string|null;readonly open:boolean}
/** All original child timing rows are retained for pagination and sorted outside JS memory. */
export async function buildCompleteTaskTiming(input:{readonly task:RuntimeTaskHeaderFact;readonly asOf:string;readonly rows:CompleteWorkingRows;readonly attemptsNamespace:string;readonly namespace:string;readonly signal?:AbortSignal}):Promise<CompleteTaskTiming> {
  let unknown=0n,rangeStart:number|undefined,rangeEnd:number|undefined;const asOf=Date.parse(input.asOf),intervalSpace=input.namespace+'/input';
  for await(const page of completeWorkingPages<RuntimeAttemptFact&{metrics:CompleteRuntimeMetrics}>(input.rows,input.attemptsNamespace,input.signal)) {
    const intervals:Array<{key:string;document:CompleteInterval}>=[];
    const attempts=page.map(row=>{
      const timing=completeAttemptTiming(input.task,row.document,asOf);
      if(timing.interval) {intervals.push({key:row.key,document:timing.interval});rangeStart=Math.min(rangeStart??timing.interval.start,timing.interval.start);rangeEnd=Math.max(rangeEnd??timing.interval.end,timing.interval.end);}else unknown++;
      return {key:row.key,document:{...row.document,durationMs:timing.durationMs,open:timing.open}};
    });
    await input.rows.upsert(input.attemptsNamespace,attempts);await input.rows.insert(intervalSpace,intervals);
  }
  const wallMs=completeTaskWallMs(input.task,asOf),range=rangeStart===undefined||rangeEnd===undefined?null:{from:new Date(rangeStart).toISOString(),to:new Date(rangeEnd).toISOString()};
  if(unknown) return {wallMs,range,intervals:{state:'not-ready',unknown:String(unknown)}};
  const sorted=await completeExternalSort({workspace:input.rows,namespace:input.namespace+'/merge',records:(async function*(){for await(const row of completeWorkingTraversal<CompleteInterval>(input.rows,intervalSpace,input.signal)) yield row.document;})(),compare:(a,b)=>a.start-b.start||a.end-b.end,signal:input.signal});
  return {wallMs,range,intervals:{state:'complete',unknown:'0',...await completeIntervalTotals(sorted.records())}};
}
