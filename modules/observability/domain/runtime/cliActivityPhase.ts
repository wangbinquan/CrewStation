import type {NativeActivityEvent,RuntimePhase,TaskId} from '@crewstation/contracts';
export interface CliTurnPhase {agentId:string;turnId:string;segment:string;kind:'active'|'waiting';startedAt:string;lastAt:string;pending:readonly string[];closed:boolean;unknown:boolean}
export interface CliSourcePhase {runnerId:string;sequence:number;ready:boolean;unknown:boolean;ended:boolean}
/** Native signals are the only activity authority. Gaps and unmatched outcomes never turn silence or residence into active time. */
export function cliActivityPhase(source:CliSourcePhase|undefined,turn:CliTurnPhase|undefined,event:NativeActivityEvent,taskId:TaskId,asOf:string){const signal=event.signal,rows:RuntimePhase[]=[],state:CliSourcePhase=source?{...source}:{runnerId:event.runnerId,sequence:0,ready:false,unknown:false,ended:false};let next=turn?{...turn,pending:[...turn.pending]}:undefined;
 const unknown=(reason:string)=>{state.unknown=true;rows.push({key:event.eventId+'/unknown',taskId,agentId:event.agentId,turnId:signal.turnId,kind:'unknown',source:'native-activity',quality:'unknown',startedAt:next?.startedAt??null,endedAt:null,durationMs:null,open:true,reason});if(next)next.unknown=true;};
 if(state.runnerId!==event.runnerId||event.seq!==state.sequence+1)unknown('activity-sequence-gap');state.sequence=event.seq;
 if(['session-observed','tool-started','tool-completed'].includes(signal.kind))return {source:state,turn:next,rows};
 if(Date.parse(signal.occurredAt)>Date.parse(asOf)||next&&Date.parse(signal.occurredAt)<Date.parse(next.lastAt))unknown('activity-clock-skew');
 if(signal.kind==='source-ready'){state.ready=!state.unknown;return {source:state,turn:next,rows};}
 if(signal.kind==='source-unavailable'){unknown(signal.reason??'activity-source-unavailable');return {source:state,turn:next,rows};}
 if(['session-observed','tool-started','tool-completed'].includes(signal.kind))return {source:state,turn:next,rows};
 if(signal.kind==='process-ended'){state.ended=true;if(next&&!next.closed)unknown('activity-outcome-unconfirmed');return {source:state,turn:next,rows};}
 if(!state.ready||state.unknown||state.ended){unknown('activity-source-unqualified');return {source:state,turn:next,rows};}
 const close=()=>{if(!next||next.unknown)return;const duration=Date.parse(signal.occurredAt)-Date.parse(next.startedAt);if(duration<0){unknown('activity-clock-skew');return;}rows.push({key:next.segment,taskId,agentId:event.agentId,turnId:next.turnId,kind:next.kind,source:'native-activity',quality:'known',startedAt:next.startedAt,endedAt:signal.occurredAt,durationMs:String(duration),open:false,reason:null});};
 if(signal.kind==='turn-started'){if(next&&!next.closed){unknown('activity-turn-conflict');return {source:state,turn:next,rows};}next={agentId:event.agentId,turnId:signal.turnId!,segment:event.eventId,kind:'active',startedAt:signal.occurredAt,lastAt:signal.occurredAt,pending:[],closed:false,unknown:false};}
 else if(!next||next.closed||next.turnId!==signal.turnId)unknown('activity-turn-unmatched');
 else if(signal.kind==='request-opened'){const id=signal.request!.id;if(!next.pending.includes(id)){if(!next.pending.length){close();next.kind='waiting';next.startedAt=signal.occurredAt;next.segment=event.eventId;}next.pending=[...next.pending,id];}}
 else if(signal.kind==='request-resolved'){const id=signal.request!.id;if(!next.pending.includes(id))unknown('activity-request-unmatched');else{next.pending=next.pending.filter(value=>value!==id);if(!next.pending.length){close();next.kind='active';next.startedAt=signal.occurredAt;next.segment=event.eventId;}}}
 else if(['turn-completed','turn-cancelled','turn-failed'].includes(signal.kind)){close();next.closed=true;next.pending=[];}
 else if(signal.kind==='turn-unconfirmed'){unknown('activity-outcome-unconfirmed');next.closed=true;}
 if(next)next.lastAt=signal.occurredAt;return {source:state,turn:next,rows};
}
