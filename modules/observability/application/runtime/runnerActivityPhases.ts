import type {RuntimeFragment,RuntimePhase,TaskId} from '@crewstation/contracts';
import type {CompleteWorkingRows} from '../../ports/completeWorkingRows';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
import {completeWorkingCache} from '../completeWorkingCache';
import {completeExternalSort} from '../completeExternalSort';
/** Actual process-running/status/permission outcomes; waiting status is idle, never human waiting. */
export async function retainRunnerActivityPhases(rows:CompleteWorkingRows,fragments:string,namespace:string,taskId:TaskId,signal?:AbortSignal){const sorted=await completeExternalSort({workspace:rows,namespace:namespace+'/sort',records:(async function*(){for await(const row of completeWorkingTraversal<RuntimeFragment>(rows,fragments,signal))if(row.document.source==='agent-driver')yield row.document;})(),compare:(a,b)=>a.agentId.localeCompare(b.agentId)||Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||(BigInt(a.sequence)<BigInt(b.sequence)?-1:BigInt(a.sequence)>BigInt(b.sequence)?1:0),signal});
 const states=completeWorkingCache<{at:string;kind:'active'|'waiting'|'idle';key:string;closed?:boolean}>(rows,namespace+'/states',signal);let count=0;
 for await(const f of sorted.records()){let kind:'active'|'waiting'|'idle'|null|undefined;
  if(f.kind==='status')kind=f.status==='running'||f.status==='active'?'active':f.status==='waiting'?'idle':undefined;
  if(f.kind==='tool-start')kind='active';if(f.kind==='permission')kind='waiting';if(['completed','cancelled','error'].includes(f.kind))kind=null;
  if(kind===undefined)continue;const old=await states.get(f.agentId);if(old&&!old.closed&&Date.parse(f.occurredAt)>=Date.parse(old.at)){const p:RuntimePhase={key:old.key+'/phase',taskId,agentId:f.agentId,turnId:null,kind:old.kind,source:'agent-driver',quality:'known',startedAt:old.at,endedAt:f.occurredAt,durationMs:String(Date.parse(f.occurredAt)-Date.parse(old.at)),open:false,reason:null};await rows.insert(namespace,[{key:p.key,document:p}]);count++;}
  await states.put(f.agentId,kind===null?{at:f.occurredAt,kind:'idle',key:f.key,closed:true}:{at:f.occurredAt,kind,key:f.key});
 }
 await states.flush();for await(const row of completeWorkingTraversal<{at:string;kind:'active'|'waiting'|'idle';key:string;closed?:boolean}>(rows,namespace+'/states',signal)){const s=row.document;if(s.closed)continue;const p:RuntimePhase={key:s.key+'/phase',taskId,agentId:row.key,turnId:null,kind:s.kind,source:'agent-driver',quality:'unknown',startedAt:s.at,endedAt:null,durationMs:null,open:true,reason:'phase-open'};await rows.insert(namespace,[{key:p.key,document:p}]);count++;}return {namespace,count};}
