import type {TaskId,RuntimeTaskHeaderFact,RuntimePhase} from '@crewstation/contracts';
/** A business Task's physical execution environments come from its own owner; no owner-private join is performed. */
export function originalRuntimePhases<Snapshot>(ports:{origins:(e:Snapshot,t:RuntimeTaskHeaderFact,after?:string)=>Promise<{items:readonly TaskId[];nextCursor:string|null}>;phases:(e:Snapshot,t:RuntimeTaskHeaderFact,asOf:string)=>Promise<readonly RuntimePhase[]>}){
 return async(e:Snapshot,task:RuntimeTaskHeaderFact,asOf:string)=>{
  if(task.source?.kind&&task.source.kind!=='business-task')return ports.phases(e,task,asOf);
  const result:RuntimePhase[]=[];let after:string|undefined;
  for(;;){const page=await ports.origins(e,task,after);for(const runtime of page.items)for(const phase of await ports.phases(e,{...task,id:runtime},asOf))result.push({...phase,taskId:task.id,runtimeTaskId:runtime});if(page.nextCursor===null)break;if(page.nextCursor===after)throw Error('Original phase owner cursor did not advance');after=page.nextCursor;}
  return result;
 };
}
