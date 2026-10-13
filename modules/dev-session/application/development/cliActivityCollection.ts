import type { NativeTerminalStart } from '../../ports/nativeTerminals';
import type { NativeActivityRepository } from '../../ports/nativeActivity';
import type { Runner } from '../../ports/runtime';
export function cliActivityCollection(runner:Pick<Runner,'listEvents'>,store:Pick<NativeActivityRepository,'cursor'|'apply'>){
 return async (start:NativeTerminalStart,drain=false):Promise<boolean>=>{
  const source=start.execution?.taskId;if(!source)return true;
  let cursor=await store.cursor(start.taskId,source);
  do{const events=await runner.listEvents(source,{sinceSeq:cursor,kinds:['nativeActivity','nativeTerminal'],limit:500});
   if(events.some(e=>e.seq<=cursor)||events.some((e,i)=>i>0&&e.seq<=events[i-1]!.seq))throw new Error('CLI original source cursor regressed');
   const next=await store.apply(start.taskId,cursor,events,source);if(events.length && next<=cursor)throw new Error('CLI original source did not advance');cursor=next;
   if(events.length<500)return true;
   if(!drain)return false;
  }while(true);
 };
}
