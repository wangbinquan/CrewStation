import {RUNTIME_DAILY_FIELDS,type RuntimeDailyDelta,type RuntimeDailyNumbers} from './runtimeDailyDelta';
import type {CompleteRuntimeFold} from '../completeRuntimeMetrics';
export interface OccurrenceScope {projectId:string|null;sourceKind:string;hour:string}
function numbers(f:CompleteRuntimeFold,platform:boolean):RuntimeDailyNumbers{return {tasks:platform?'0':'1',input:f.tokens.input,cache_read:f.tokens.cacheRead,cache_write:f.tokens.cacheWrite,output:f.tokens.output,input_records:f.bucketRecords.input,cache_read_records:f.bucketRecords.cacheRead,cache_write_records:f.bucketRecords.cacheWrite,output_records:f.bucketRecords.output,executions:f.executions,observed:f.observedExecutions,records:f.records,priced_records:f.pricedRecords,partial_records:f.partiallyPricedRecords??'0',picos:f.picos,unpriced_tasks:f.priced?'0':'1'};}
/** Platform purpose has system membership only; no invented project or business task. */
export function runtimeOccurrenceDeltas(scope:OccurrenceScope,before:CompleteRuntimeFold|undefined,after:CompleteRuntimeFold|null):RuntimeDailyDelta[]{
 const values=Object.fromEntries(RUNTIME_DAILY_FIELDS.map(k=>[k,'0'])) as RuntimeDailyNumbers,gaps:Record<string,string>={};
 for(const [f,sign]of [[before,-1n],[after,1n]] as const){if(!f)continue;const n=numbers(f,scope.projectId===null);for(const k of RUNTIME_DAILY_FIELDS)values[k]=String(BigInt(values[k])+sign*BigInt(n[k]));for(const reason of new Set(f.gaps))gaps[reason]=String(BigInt(gaps[reason]??'0')+sign);}
 return [...new Set(['',...(scope.projectId===null?[]:[scope.projectId])])].map(owner=>({scope:owner,day:scope.hour,sourceKind:scope.sourceKind,numbers:{...values},gaps:{...gaps}}));
}
