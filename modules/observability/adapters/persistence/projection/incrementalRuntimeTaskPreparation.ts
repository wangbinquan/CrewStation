import type {RuntimeMetadataStage,RuntimePublicRowStage} from '../../../ports/incrementalRuntimeTasks';
import {patchRuntimeMetadata} from '../incrementalRuntime/metadataPatch';
import {qualifiedProofRows} from '../incrementalRuntime/proofRows';
import {patchRuntimeProofs} from '../incrementalRuntime/proofPatch';
import {patchRuntimeRecords} from '../incrementalRuntime/recordPatch';

import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,openSync,writeSync,closeSync,rmSync,createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import type {Database,Executor,ReportSnapshotSession} from '@crewstation/persistence';
import type {RuntimeTaskHeaderFact} from '@crewstation/contracts';
import type {CompleteRuntimeFactSourceFactory} from '../../../ports/completeRuntimeFactSources';
import type {IncrementalRuntimeTask} from '../../../ports/incrementalRuntimeTasks';
import {incrementalRuntimeTaskCache} from './incrementalRuntimeTaskCache';
import {originalRuntimeSourceIdentity} from '../reports/reportStore';
import type {CompleteRuntimeTaskBuild} from '../../../ports/completeRuntimeTask';
import type {OriginalReportSnapshot} from '@crewstation/persistence';
import type {CompleteWorkingRows,CompleteWorkingRow} from '../../../ports/completeWorkingRows';
import type {IncrementalRuntimeTaskSource} from '../../../ports/incrementalRuntimeTasks';
const full={from:'0001-01-01T00:00:00.000Z',to:'9999-12-31T23:59:59.999Z',timezone:'UTC'};
export function prepareIncrementalRuntimeTasks(input:{metadata:RuntimeMetadataStage;publicRows:RuntimePublicRowStage;db:Database;snapshot:ReportSnapshotSession;facts:CompleteRuntimeFactSourceFactory<Executor>;build:(snapshot:OriginalReportSnapshot,task:RuntimeTaskHeaderFact,namespace:string,signal:AbortSignal)=>Promise<CompleteRuntimeTaskBuild>;records:(rows:CompleteWorkingRows,namespace:string,signal?:AbortSignal)=>AsyncIterable<CompleteWorkingRow>}):IncrementalRuntimeTaskSource{
 const store=incrementalRuntimeTaskCache(input.db);let stop=new AbortController();
 async function inventory(projectId?:string){
  // Metadata bootstrap/global rename only. It runs once, independently of 7/30-day requests.
  const dir=mkdtempSync(join(tmpdir(),'cs-task-inventory-')),path=join(dir,'ids.ndjson');let fd:number|undefined;
  try{fd=openSync(path,'wx',0o600);await input.snapshot.run(async snapshot=>{const sources=input.facts(snapshot.executor,{...full,...(projectId?{projectId}: {})},snapshot.snapshotId),names=new Map<string,string|null>();const name=async(id:string)=>{if(names.has(id))return names.get(id)!;const value=await sources.projectName(id);if(names.size===200)names.delete(names.keys().next().value!);names.set(id,value);return value;};for(const source of Object.values(sources.tasks)){if(!source)continue;let after:string|null=null;for(;;){stop.signal.throwIfAborted();const page=await source.next(after);for(const item of page.items)writeSync(fd!,JSON.stringify({...item,projectName:item.projectName??await name(item.projectId)})+'\n');if(page.nextCursor===null)break;if(page.nextCursor===after)throw Error('Original task inventory did not advance');after=page.nextCursor;}}},stop.signal);closeSync(fd);fd=undefined;
   let ids:RuntimeTaskHeaderFact[]=[];const stream=createReadStream(path,{encoding:'utf8',signal:stop.signal}),lines=createInterface({input:stream,crlfDelay:Infinity});try{for await(const line of lines){ids.push(JSON.parse(line));if(ids.length===200){await store.metadata(ids);ids=[];}}if(ids.length)await store.metadata(ids);}finally{lines.close();stream.destroy();}
  }finally{if(fd!==undefined)closeSync(fd);rmSync(dir,{recursive:true,force:true});}
 }
 async function qualify(work:{key:string;revision:string}){
  if(await patchRuntimeMetadata(input,work,stop.signal))return;
  if(await patchRuntimeRecords(input.db,work,stop.signal)){await patchRuntimeProofs(input.db,work,stop.signal);return;}if(await patchRuntimeProofs(input.db,work,stop.signal))return;
  const dir=mkdtempSync(join(tmpdir(),'cs-task-qualified-')),path=join(dir,'rows.ndjson');let fd:number|undefined;
  try{fd=openSync(path,'wx',0o600);const digest=createHash('sha256');let count=0n;
   const task=await input.snapshot.run(async snapshot=>{
    const query={...full,taskId:work.key},facts=input.facts(snapshot.executor,query,snapshot.snapshotId);let header:RuntimeTaskHeaderFact|undefined;
    for(const source of Object.values(facts.tasks)){if(!source)continue;let after:string|null=null;for(;;){const page=await source.next(after);for(const item of page.items){if(header)throw Error('Original task owner is not unique');header=item;}if(page.nextCursor===null)break;after=page.nextCursor;}}
    if(!header)return null;
    const namespace='incremental-runtime-task/'+randomUUID(),task={...header,projectName:await facts.projectName(header.projectId)},build=await input.build(snapshot,task,namespace,stop.signal);
    const publicRows=await input.publicRows(snapshot.workspace,build,facts,namespace+'/public',stop.signal);
    const roles={'public-rows':publicRows.rows,'public-counts':publicRows.counts,...Object.fromEntries(Object.entries(publicRows.dimensions).map(([section,space])=>['dimension-'+section,space])),attempts:build.attemptsNamespace.replace(/attempt-summaries$/,'attempts'),'attempt-summaries':build.attemptsNamespace,allocations:build.allocationsNamespace,captures:namespace+'/captures','native-pages':namespace+'/native-pages',...(build.fragmentsNamespace?{fragments:build.fragmentsNamespace}:{}),...(build.phasesNamespace?{phases:build.phasesNamespace}: {})};
    for(const [role,space]of Object.entries(roles))for await(const row of input.records(snapshot.workspace,space,stop.signal)){const line=JSON.stringify({role,...row})+'\n';writeSync(fd!,line);digest.update(line);count++;}
    for await(const row of qualifiedProofRows(snapshot.workspace,roles,stop.signal)){const line=JSON.stringify(row)+'\n';writeSync(fd!,line);digest.update(line);count++;}
    const {task:_task,fold,metrics:_metrics,attemptsNamespace:_attempts,allocationsNamespace:_allocations,phasesNamespace:_phases,fragmentsNamespace:_fragments,...metadata}=build,identity=await originalRuntimeSourceIdentity(snapshot.executor);
    return {task,fold,build:metadata,sourceRevision:identity.revision,capturedAt:snapshot.asOf,version:randomUUID()} satisfies IncrementalRuntimeTask;
   },stop.signal);
   closeSync(fd);fd=undefined;const checksum=digest.digest('hex'),expected=count;
   await store.commit(work,task,(async function*(){const hash=createHash('sha256');let count=0n;const stream=createReadStream(path,{encoding:'utf8',signal:stop.signal}),lines=createInterface({input:stream,crlfDelay:Infinity});try{for await(const line of lines){stop.signal.throwIfAborted();hash.update(line+'\n');count++;yield JSON.parse(line) as {role:string;key:string;document:unknown};}if(count!==expected||hash.digest('hex')!==checksum)throw Error('Qualified task EOF changed');}finally{lines.close();stream.destroy();}})());
  }finally{if(fd!==undefined)closeSync(fd);rmSync(dir,{recursive:true,force:true});}
 }
 return {inventory,qualify:async work=>{await qualify(work);await store.continue(work);},checkpoint:store.checkpoint,pending:store.pending,acknowledge:store.acknowledge,bootstrapDone:store.bootstrapDone,finishBootstrap:store.finishBootstrap,failed:store.failed,resume:()=>{if(stop.signal.aborted)stop=new AbortController();},stop:()=>{stop.abort();}};
}
