import type {RuntimePhase,RuntimeAttemptFact} from '@crewstation/contracts';
import type {CompleteWorkingRows} from '../../ports/completeWorkingRows';
import {jsonHash} from '@crewstation/kernel';
import {completeWorkingPages} from '../completeWorkingTraversal';
/** Alias names are retained from original owner facts only; ambiguous names stay unresolved. */
export async function enrichRuntimePhases(rows:CompleteWorkingRows,phases:string,attempts:string,signal?:AbortSignal){
 signal?.throwIfAborted();const first=await rows.page<RuntimePhase>(phases,null,1);
 if(!first.items.length){if(first.nextCursor!==null)throw Error('Complete working cursor did not advance');return;}
 const names=phases+'/owner-names';
 for await(const page of completeWorkingPages<RuntimeAttemptFact>(rows,attempts,signal)){
  const aliases=page.flatMap(row=>[...new Set([row.document.id,row.document.agentId,row.document.executionId].filter((id):id is string=>!!id))].map(id=>({key:jsonHash(id),name:row.document.name}))),keys=[...new Set(aliases.map(row=>row.key))];
  const found=new Map((await rows.getMany<{name:string|null}>(names,keys)).map(row=>[row.key,row.document]));
  for(const alias of aliases){const old=found.get(alias.key);found.set(alias.key,{name:old&&old.name!==alias.name?null:alias.name});}
  if(found.size)await rows.upsert(names,[...found].map(([key,document])=>({key,document})));
 }
 for await(const page of completeWorkingPages<RuntimePhase>(rows,phases,signal)){
  const found=new Map((await rows.getMany<{name:string|null}>(names,[...new Set(page.map(row=>jsonHash(row.document.agentId)))])).map(row=>[row.key,row.document])),changed=[];
  for(const row of page){const name=found.get(jsonHash(row.document.agentId))?.name;if(name)changed.push({key:row.key,document:{...row.document,agentName:name}});}
  if(changed.length)await rows.upsert(phases,changed);
 }
}
