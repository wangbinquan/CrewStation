import type {RuntimePhase,RuntimePhaseTiming} from '@crewstation/contracts';
import type {CompleteWorkingRows} from '../../ports/completeWorkingRows';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
import {completeExternalSort} from '../completeExternalSort';
import {completeIntervalTotals} from '../../domain/completeRuntimeTiming';
export async function runtimePhaseTiming(rows:CompleteWorkingRows,namespace:string,signal?:AbortSignal):Promise<RuntimePhaseTiming>{
 const sums=new Map<string,bigint>();let unknown=0n,residence=false,from:number|undefined,to:number|undefined;
 const stream=()=>completeWorkingTraversal<RuntimePhase>(rows,namespace,signal);
 for await(const row of stream()){const p=row.document;for(const at of [p.startedAt,p.endedAt])if(at){const value=Date.parse(at);if(Number.isSafeInteger(value)){from=Math.min(from??value,value);to=Math.max(to??value,value);}}if(p.quality!=='known'||p.durationMs===null){unknown++;continue;}sums.set(p.kind,(sums.get(p.kind)??0n)+BigInt(p.durationMs));if(p.kind==='residence')residence=true;}
 const union=async(kind:'active'|'waiting')=>{const sorted=await completeExternalSort({workspace:rows,namespace:namespace+'/'+kind+'-sort',records:(async function*(){for await(const row of stream()){const p=row.document;if(p.kind===kind&&(p.source==='native-activity'||p.source==='agent-driver')&&p.quality==='known'&&p.startedAt&&p.endedAt)yield {start:Date.parse(p.startedAt),end:Date.parse(p.endedAt)};}})(),compare:(a,b)=>a.start-b.start||a.end-b.end,signal});return completeIntervalTotals(sorted.records());};
 const active=await union('active'),waiting=await union('waiting'),sum=(kind:string)=>sums.get(kind)??0n;
 return {range:from===undefined||to===undefined?null:{from:new Date(from).toISOString(),to:new Date(to).toISOString()},activeMs:active.cumulativeMs,activeUnionMs:active.activeUnionMs,waitingMs:waiting.cumulativeMs,waitingUnionMs:waiting.activeUnionMs,unknownSegments:String(unknown),residenceMs:residence?String(sum('residence')):null,queueMs:String(sum('queue')),initializationMs:String(['replace','container','checkout','connect','prepare','agent','interface'].reduce((n,key)=>n+sum(key),0n)),cleanupMs:String(sum('cleanup')),retentionMs:String(sum('retention'))};
}
