import {releaseHandoffUseCases} from '../application/execution/handoff';
import type {CreateDatabaseRestore} from '@crewstation/contracts';
import {ManifestSchema} from '@crewstation/contracts';
import {conflict,noopLogger} from '@crewstation/kernel';
import {databaseRestoreCoordination} from '../adapters/persistence/databaseRestores';
import {databaseRestoreCommands} from '../application/database-restore/commands';
import {databaseRestoreProgress} from '../application/database-restore/progress';
import {executionHandoffFixture} from './executionHandoffFixture';
import type {ReleaseUseCaseDeps} from '../application/dependencies';
import type {DatabaseRestoreOperation,RestoreJobProof} from '../domain/databaseRestore';
import type {RepositoryScope,UnitOfWork} from '../ports/unitOfWork';
import type {JobProjection,JobRecordRef} from '../ports/ledger';
export async function databaseRestoreFixture(){
 const base=await executionHandoffFixture(),store=base.uow.read.databaseRestores!,source=Bun.randomUUIDv7(),records=new Map<string,JobRecordRef>(),declared:JobProjection[]=[],observed:string[]=[];
 const state={admin:true,envAvailable:true,barrier:false,ready:false,phase:'source',maintenance:false,target:undefined as string|undefined,lastRestore:null as string|null,binding:{generationId:source,revision:1,restoreOperationId:null as string|null},
  proofs:new Map<string,RestoreJobProof>(),jobError:undefined as Error|undefined,abandoned:[] as string[],withdrawn:[] as string[],exits:[] as string[],entries:[] as string[],image:'registry/app@sha256:'+'a'.repeat(64)};
 const manifest=ManifestSchema.parse({...base.target.manifest,spec:{...base.target.manifest!.spec,service:{...base.target.manifest!.spec.service,databaseRestore:{command:['app','restore'],verifyCommand:['app','verify']}}}});
 await base.uow.read.releases.update({...base.target,manifest,image:state.image,pipeline:{step:1,readyAt:new Date().toISOString()}});
 const ledger:NonNullable<RepositoryScope['ledger']>={sync:async()=>{},slot:async()=>({id:'slot',generation:1,phase:state.ready?'ready':'starting',children:[{kind:'Deployment',phase:'running',appliedGeneration:1,replicas:1,readyReplicas:state.ready?1:0}]}),job:async input=>{declared.push(input);records.set(input.releaseId,{id:input.releaseId,phase:'pending',spec:{children:[],job:input.job},conditions:[]});},jobRecord:async id=>records.get(id),restoreJobObserved:async id=>{observed.push(id);},failJob:async()=>{throw new Error('restore cannot abandon original job');}};
 const uow:UnitOfWork={read:{...base.uow.read,ledger},run:effect=>base.uow.run(scope=>effect({...scope,ledger}))};
 const generations={active:async()=>({...state.binding}),list:async()=>({active:state.binding,items:[]}),reserve:async(input:{id:string;operationId:string})=>{state.target=input.id;state.binding={...state.binding,restoreOperationId:input.operationId};return {};},prepare:async()=>({ready:true,identity:{serverId:'server',databaseOid:'1',roleOid:'2'}}),
  envFor:async(_service:string,id:string)=>{if(!state.envAvailable)throw new Error('original target lost');return {CS_DATABASE_URL:'postgres://'+id,CS_DATABASE_GENERATION_ID:id};},assertUnreserved:async()=>{},
  commit:async(input:{operationId:string})=>{if(state.lastRestore!==input.operationId)state.binding={generationId:state.target!,revision:state.binding.revision+1,restoreOperationId:state.binding.restoreOperationId};state.lastRestore=input.operationId;return {...state.binding};},finish:async()=>{state.binding={...state.binding,restoreOperationId:null};},
  abandon:async(_service:string,id:string)=>{if(state.lastRestore===id)throw conflict('原恢复已提交数据库切换',{code:'database_restore_switched'});if(state.binding.restoreOperationId===id)state.binding={...state.binding,restoreOperationId:null};state.abandoned.push(id);}};
 const deps={...base.deps,uow,creation:'ledger',logger:noopLogger,settings:{userDomain:'user.test',serviceDomain:'svc.test'},config:{validate:async()=>({missing:[]}),render:async()=>({values:{},version:4})},
  data:{envFor:async()=>({CS_DATABASE_URL:'postgres://source'}),databaseGenerations:generations},
  databaseRestore:{coordination:databaseRestoreCoordination(base.database.db),objectReadUrl:'http://objects.test/readonly',encrypt:async(plain:string)=>'encrypted:'+Buffer.from(plain).toString('base64'),decrypt:async(box:string)=>Buffer.from(box.slice(10),'base64').toString(),token:(id:string)=>'token-'+id,isAdmin:async()=>state.admin,
   jobs:{observe:async(input:{jobId:string})=>{if(state.jobError)throw state.jobError;return state.proofs.get(input.jobId)??null;},candidate:async()=>state.ready?{deploymentUid:'deployment',secretUid:'secret',environmentDigest:'a'.repeat(64)}:null}},
  maintenance:{open:async()=>state.maintenance,enterRestore:async(_actor:unknown,_service:string,id:string)=>{state.maintenance=true;state.entries.push(id);return {revision:1,wasOpen:false};},exitRestore:async(_actor:unknown,_service:string,id:string)=>{state.maintenance=false;state.exits.push(id);}},
  executionHandoff:{...base.deps.executionHandoff,migrationBarrier:async()=>({ready:state.barrier}),observeWritersStopped:async()=>state.barrier,withdrawMigrationBarrier:async(_service:string,id:string)=>{state.withdrawn.push(id);}},
  plans:{getServicePlan:async()=>({maxReplicas:1,cpu:'75m',memory:'256Mi'})},repo:{readFile:async()=>undefined}} as unknown as ReleaseUseCaseDeps;
 const api=databaseRestoreCommands(deps),worker=()=>databaseRestoreProgress(deps),input={requestId:Bun.randomUUIDv7(),expectedActiveGenerationId:source,expectedActiveReleaseId:base.old.id,restoreReleaseId:base.target.id,backupReference:'aw-backup:immutable'};
 const load=async(id=input.requestId)=>(await store.get(id))!;
 const proof=(op:DatabaseRestoreOperation,verify:boolean,failed=false):RestoreJobProof=>({receipt:{name:verify?'verify':'restore',uid:verify?'verify-uid':'restore-uid',image:op.image,target:{serverId:'server',databaseOid:'1',roleOid:'2'},state:failed?'failed':'succeeded',exitCode:failed?9:0,...(failed?{failure:'exit' as const}:{})},secretUid:'original-secret',environmentDigest:'a'.repeat(64),podUid:'original-pod',...(verify&&!failed?{verification:{version:1,backupReferenceDigest:op.backupReferenceDigest,schemaDigest:'b'.repeat(64),complete:true,autoResumeSuspended:true}}:{})});
 const prepared=async(request:CreateDatabaseRestore=input)=>{await api.createDatabaseRestore(base.actor,base.serviceId,request);await worker()();await worker()();return load(request.requestId);};
 const verified=async(request:CreateDatabaseRestore=input)=>{let op=await prepared(request);state.proofs.set(op.restoreJobId,proof(op,false));await worker()();op=await load(request.requestId);state.proofs.set(op.verifyJobId,proof(op,true));await worker()();return api.getDatabaseRestore(base.actor,base.serviceId,op.id);};
 const handoffWorker=()=>releaseHandoffUseCases(deps);
 /** Drives a confirmed restore through maintenance, candidate, binding commit and the execution handoff. */
 const complete=async(id:string)=>{
  const ready=await api.getDatabaseRestore(base.actor,base.serviceId,id);
  await api.switchDatabaseRestore(base.actor,base.serviceId,id,{expectedRevision:ready.revision,confirmationDigest:ready.confirmationDigest!});
  state.barrier=true;state.ready=true;for(let i=0;i<4;i++)await worker()();
  base.state.authority={epoch:base.state.authority.epoch+1,stage:'inactive',quiescent:false};base.state.quiescent=true;base.state.routed=false;
  await handoffWorker().progressHandoffs();base.prepared();await handoffWorker().progressHandoffs();await handoffWorker().progressHandoffs();
  base.state.routed=true;await handoffWorker().progressHandoffs();base.state.authority.stage='complete';await handoffWorker().progressHandoffs();
  await worker()();return load(id);
 };
 return {...base,deps,state,api,store,worker,input,load,prepared,verified,complete,proof,declared,records,observed,handoffState:base.state,handoffWorker,prepareHandoff:base.prepared};
}
