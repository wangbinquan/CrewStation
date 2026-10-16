import {releaseHandoffUseCases} from '../application/execution/handoff';
import {ManifestSchema} from '@crewstation/contracts';
import {noopLogger} from '@crewstation/kernel';
import {databaseRestoreCoordination} from '../adapters/persistence/database/restores';
import {databaseRestoreCommands} from '../application/database-restore/commands';
import {databaseRestoreProgress} from '../application/database-restore/progress';
import {executionHandoffFixture} from './executionHandoffFixture';
import type {ReleaseUseCaseDeps} from '../application/dependencies';
import type {DatabaseRestoreOperation,RestoreJobProof} from '../domain/databaseRestore';
import type {RepositoryScope,UnitOfWork} from '../ports/unitOfWork';
import type {JobProjection,JobRecordRef} from '../ports/ledger';
export async function databaseRestoreFixture(){
 const base=await executionHandoffFixture(),store=base.uow.read.databaseRestores!,source=Bun.randomUUIDv7(),records=new Map<string,JobRecordRef>(),declared:JobProjection[]=[],observed:string[]=[];
 const state={admin:true,envAvailable:true,barrier:false,ready:false,phase:'source',maintenance:false,target:undefined as string|undefined,binding:{generationId:source,revision:1,restoreOperationId:null as string|null},proofs:new Map<string,RestoreJobProof>(),image:'registry/app@sha256:'+'a'.repeat(64)};
 const manifest=ManifestSchema.parse({...base.target.manifest,spec:{...base.target.manifest!.spec,service:{...base.target.manifest!.spec.service,databaseRestore:{command:['app','restore'],verifyCommand:['app','verify']}}}});
 await base.uow.read.releases.update({...base.target,manifest,image:state.image,pipeline:{step:1,readyAt:new Date().toISOString()}});
 const ledger:NonNullable<RepositoryScope['ledger']>={sync:async()=>{},slot:async()=>({id:'slot',generation:1,phase:state.ready?'ready':'starting',children:[{kind:'Deployment',phase:'running',appliedGeneration:1,replicas:1,readyReplicas:state.ready?1:0}]}),job:async input=>{declared.push(input);records.set(input.releaseId,{id:input.releaseId,phase:'pending',spec:{children:[],job:input.job},conditions:[]});},jobRecord:async id=>records.get(id),restoreJobObserved:async id=>{observed.push(id);},failJob:async()=>{throw new Error('restore cannot abandon original job');}};
 const uow:UnitOfWork={read:{...base.uow.read,ledger},run:effect=>base.uow.run(scope=>effect({...scope,ledger}))};
 const deps={...base.deps,uow,creation:'ledger',logger:noopLogger,settings:{userDomain:'user.test',serviceDomain:'svc.test'},config:{validate:async()=>({missing:[]}),render:async()=>({values:{},version:4})},
  data:{envFor:async()=>({CS_DATABASE_URL:'postgres://source'}),databaseGenerations:{active:async()=>state.binding,list:async()=>({active:state.binding,items:[]}),reserve:async(input:{id:string;operationId:string})=>{state.target=input.id;state.binding.restoreOperationId=input.operationId;return {};},prepare:async()=>({ready:true,identity:{serverId:'server',databaseOid:'1',roleOid:'2'}}),envFor:async(_service:string,id:string)=>{if(!state.envAvailable)throw new Error('original target lost');return {CS_DATABASE_URL:'postgres://'+id,CS_DATABASE_GENERATION_ID:id};},assertUnreserved:async()=>{},commit:async()=>{state.binding={generationId:state.target!,revision:2,restoreOperationId:state.binding.restoreOperationId};return state.binding;},finish:async()=>{state.binding.restoreOperationId=null;}}},
  databaseRestore:{coordination:databaseRestoreCoordination(base.database.db),objectReadUrl:'http://objects.test/readonly',encrypt:async(plain:string)=>'encrypted:'+Buffer.from(plain).toString('base64'),decrypt:async(box:string)=>Buffer.from(box.slice(10),'base64').toString(),token:(id:string)=>'token-'+id,isAdmin:async()=>state.admin,jobs:{observe:async(input:{jobId:string})=>state.proofs.get(input.jobId)??null,candidate:async()=>state.ready?{deploymentUid:'deployment',secretUid:'secret',environmentDigest:'a'.repeat(64)}:null}},
  maintenance:{open:async()=>state.maintenance,enterRestore:async()=>{state.maintenance=true;return {revision:1,wasOpen:false};},exitRestore:async()=>{state.maintenance=false;}},
  executionHandoff:{...base.deps.executionHandoff,migrationBarrier:async()=>({ready:state.barrier}),observeWritersStopped:async()=>state.barrier},
  plans:{getServicePlan:async()=>({maxReplicas:1,cpu:'1',memory:'1Gi'})},repo:{readFile:async()=>undefined}} as unknown as ReleaseUseCaseDeps;
 const api=databaseRestoreCommands(deps),worker=()=>databaseRestoreProgress(deps),input={requestId:Bun.randomUUIDv7(),expectedActiveGenerationId:source,expectedActiveReleaseId:base.old.id,restoreReleaseId:base.target.id,backupReference:'aw-backup:immutable'};
 const load=async()=>(await store.get(input.requestId))!;
 const proof=(op:DatabaseRestoreOperation,verify:boolean,failed=false):RestoreJobProof=>({receipt:{name:verify?'verify':'restore',uid:verify?'verify-uid':'restore-uid',image:op.image,target:{serverId:'server',databaseOid:'1',roleOid:'2'},state:failed?'failed':'succeeded',exitCode:failed?9:0},secretUid:'original-secret',environmentDigest:'a'.repeat(64),podUid:'original-pod',...(verify&&!failed?{verification:{version:1,backupReferenceDigest:op.backupReferenceDigest,schemaDigest:'b'.repeat(64),complete:true,autoResumeSuspended:true}}:{})});
 const prepared=async()=>{await api.createDatabaseRestore(base.actor,base.serviceId,input);await worker()();await worker()();return load();};
 const verified=async()=>{let op=await prepared();state.proofs.set(op.restoreJobId,proof(op,false));await worker()();op=await load();state.proofs.set(op.verifyJobId,proof(op,true));await worker()();return api.getDatabaseRestore(base.actor,base.serviceId,op.id);};
 return {...base,deps,state,api,store,worker,input,load,prepared,verified,proof,declared,records,observed,handoffState:base.state,handoffWorker:()=>releaseHandoffUseCases(deps),prepareHandoff:base.prepared};
}
