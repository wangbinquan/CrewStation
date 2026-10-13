import type {RuntimeTaskHeaderFact} from '@crewstation/contracts';
interface IncrementalRuntimeTask {task:RuntimeTaskHeaderFact;fold:CompleteRuntimeFold}
import type {CompleteRuntimeFold} from '../completeRuntimeMetrics';
export const RUNTIME_DAILY_FIELDS=['tasks','input','cache_read','cache_write','output','input_records','cache_read_records','cache_write_records','output_records','executions','observed','records','priced_records','partial_records','picos','unpriced_tasks'] as const;
export type RuntimeDailyNumbers=Record<typeof RUNTIME_DAILY_FIELDS[number],string>;
export interface RuntimeDailyDelta {scope:string;day:string;sourceKind:string;numbers:RuntimeDailyNumbers;gaps:Record<string,string>}
function numeric(f:CompleteRuntimeFold):RuntimeDailyNumbers{return {tasks:'1',input:f.tokens.input,cache_read:f.tokens.cacheRead,cache_write:f.tokens.cacheWrite,output:f.tokens.output,input_records:f.bucketRecords.input,cache_read_records:f.bucketRecords.cacheRead,cache_write_records:f.bucketRecords.cacheWrite,output_records:f.bucketRecords.output,executions:f.executions,observed:f.observedExecutions,records:f.records,priced_records:f.pricedRecords,partial_records:f.partiallyPricedRecords??'0',picos:f.picos,unpriced_tasks:f.priced?'0':'1'};}
/** Remove the entire prior membership, then add the new one, including birth-date moves and lower native corrections. */
export function runtimeDailyDeltas(before:IncrementalRuntimeTask|undefined,after:IncrementalRuntimeTask|null):RuntimeDailyDelta[]{const rows=new Map<string,RuntimeDailyDelta>();
 for(const [task,sign]of [[before,-1n],[after,1n]] as const){if(!task)continue;const day=new Date(task.task.createdAt).toISOString().slice(0,10),sourceKind=task.task.source?.kind??'business-task',values=numeric(task.fold);
  for(const scope of ['',task.task.projectId]){const key=JSON.stringify([scope,day,sourceKind]),row=rows.get(key)??{scope,day,sourceKind,numbers:Object.fromEntries(RUNTIME_DAILY_FIELDS.map(k=>[k,'0'])) as RuntimeDailyNumbers,gaps:{}};for(const field of RUNTIME_DAILY_FIELDS)row.numbers[field]=String(BigInt(row.numbers[field])+sign*BigInt(values[field]));for(const gap of new Set(task.fold.gaps))row.gaps[gap]=String(BigInt(row.gaps[gap]??'0')+sign);rows.set(key,row);}}
 return [...rows].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>row);}
