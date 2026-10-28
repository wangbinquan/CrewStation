import { createHash, createHmac } from 'node:crypto';
import type { DatabaseMigrationPlanView } from '@crewstation/contracts';
import { ManifestSchema } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import { releaseHandoffUseCases } from '../application/execution/handoff';
import { databaseMigrationCommands } from '../application/database-migration/commands';
import { databaseMigrationProgress } from '../application/database-migration/progress';
import { databaseMigrationCallback } from '../application/database-migration/callbacks';
import { databaseMigrationCallbackRoutes } from '../http/databaseMigrationCallbacks';
import { migrationCanonical, migrationDigest } from '../domain/database-migration/evidence';
import { migrationOperationKey } from '../domain/database-migration/operation';
import type { DatabaseMigrationOperation, MigrationJobProof } from '../domain/database-migration/operation';
import { databaseRestoreFixture } from './databaseRestoreFixture';

export async function databaseMigrationFixture(){
 const f=await databaseRestoreFixture(),{deps}=f,source=f.input.expectedActiveGenerationId,store=deps.uow.read.databaseMigrations!;
 try {
 const state={binding:{generationId:source,revision:1,restoreOperationId:null as string|null,migrationOperationId:null as string|null},target:'',scratch:'',opened:false,finished:false,stopped:true,epoch:4,buildFailed:false,removed:[] as string[]};
 const manifest=ManifestSchema.parse({...f.target.manifest,spec:{...f.target.manifest!.spec,service:{...f.target.manifest!.spec.service,databaseMigration:{command:['app','migrate'],verifyCommand:['app','verify-migration'],sourceKeyConfig:'AW_SECRET_KEY'}},env:[{name:'AW_SECRET_KEY',from:'secret',configDefinitionId:'01a1428f-eabe-7000-af4c-887037988571'}]}});
 deps.repo={...deps.repo,readFile:async(_service,_ref,path)=>path==='crewstation.yaml'?JSON.stringify(manifest):undefined,buildSource:async()=>({httpUrl:'https://git.test/app.git'}),buildToken:async()=>({token:'build-token'})} as typeof deps.repo;
 deps.settings={...deps.settings,registryBase:'registry',builderImage:'buildkit',buildkitAddress:'tcp://buildkit',buildTimeoutSeconds:3600};
 deps.runtimeImages={pinBuiltImage:async()=>f.state.image,reserve:async()=>{throw new Error('unexpected runtime image reservation');},confirm:async()=>{}};
 deps.config={...deps.config,render:async()=>({values:{'01a1428f-eabe-7000-af4c-887037988571':'source-key'},version:4})};
 deps.deployer={...deps.deployer,removeWorkload:async(_ns,_service,_slot,ids)=>{state.removed.push(...ids??[]);return true;}};
 const ledger=deps.uow.read.ledger!,declare=ledger.job;
 ledger.job=async input=>{await declare(input);if(input.kind==='build-job')f.records.set(input.releaseId,{id:input.releaseId,phase:'ready',spec:{children:[],job:input.job},conditions:[{type:'Finished',status:'true',reason:state.buildFailed?'failed':'succeeded'}]});};
 ledger.failJob=async()=>{};
 deps.data.databaseGenerations={...deps.data.databaseGenerations!,active:async()=>({...state.binding}),
  reserveMigration:async input=>{if(state.binding.migrationOperationId&&state.binding.migrationOperationId!==input.operationId)throw conflict('reserved');state.target=input.id;state.scratch=input.scratchId;state.binding.migrationOperationId=input.operationId;return {} as never;},
  envFor:async(_s,id)=>({CS_DATABASE_URL:'postgres://'+id}),
  commitMigration:async input=>{if(state.binding.generationId===source)state.binding={...state.binding,generationId:input.targetGenerationId,revision:2};return {...state.binding};},
  revertMigration:async()=>{if(state.opened)throw conflict('opened');if(state.binding.generationId===state.target)state.binding={...state.binding,generationId:source,revision:3};return {...state.binding};},
  openMigration:async()=>{state.opened=true;},finishMigration:async()=>{state.binding.migrationOperationId=null;state.finished=true;},
 };
 deps.databaseMigration={...deps.databaseRestore!,controlUrl:'http://api/internal/database-migrations',token:(id,digest)=>createHmac('sha256','fixture-key').update('database-migration-control\0'+id+'\0'+digest).digest('base64url')};
 deps.executionHandoff={...deps.executionHandoff!,freeze:async(_service,request)=>{f.handoffState.authority={...request,epoch:state.epoch+1,stage:'frozen',quiescent:true};return f.handoffState.authority;},migrationBarrier:async()=>({ready:f.state.barrier,epoch:state.epoch,preparationDigest:f.state.barrier?'a'.repeat(64):undefined,blocked:f.state.barrier?[]:['waiting']}),observeWritersStopped:async()=>state.stopped};
 const api=databaseMigrationCommands(deps),tick=()=>databaseMigrationProgress(deps)(),input={requestId:Bun.randomUUIDv7(),expectedActiveReleaseId:f.old.id,expectedActiveGenerationId:source,branch:'main',expectedCommitSha:'b'.repeat(40)};
 const load=async()=>{const op=await store.get(input.requestId);if(!op)throw new Error('missing operation');return op;};
 const router=databaseMigrationCallbackRoutes(request=>databaseMigrationCallback(deps,request));
 const callback=async(action:string,body?:unknown,job?:DatabaseMigrationOperation)=>{const op=job??await load(),attempt=op.currentAttempt!;
  const path=`/internal/database-migrations/${attempt.jobId}/${deps.databaseMigration!.token(attempt.jobId,op.requestDigest)}/v1/operations/${migrationOperationKey(op.id)}/${action}`;
  return router.request(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 };
 const write=async(name:string,text:string)=>{const op=await load(),operationId=migrationOperationKey(op.id),digest='sha256:'+createHash('sha256').update(text).digest('hex');
  const response=await callback('artifacts',{operationId,name,digest,bytes:Buffer.from(text).toString('base64'),requestKey:`${operationId}:${name}:${digest}`});if(response.status!==200)throw new Error(await response.text());return digest;
 };
 const proof=(op:DatabaseMigrationOperation,output?:MigrationJobProof['output'],failure?:NonNullable<MigrationJobProof['receipt']['failure']>):MigrationJobProof=>({receipt:{name:'dbm-'+op.currentAttempt!.jobId.replaceAll('-',''),uid:'uid-'+op.currentAttempt!.jobId,image:op.image!,target:{serverId:'server',databaseOid:'1',roleOid:'2'},state:failure?'failed':'succeeded',exitCode:failure?1:0,...(failure?{failure}:{})},secretUid:'secret-'+op.currentAttempt!.jobId,environmentDigest:'a'.repeat(64),podUid:'pod-'+op.currentAttempt!.jobId,...(output?{output}:{}),logTail:'last log'});
 const evidence=databaseMigrationEvidence({load,callback,write,proof,proofs:f.state.proofs,tick});
 const until=async(stage:DatabaseMigrationOperation['stage'])=>{for(let n=0;n<20;n++){const op=await load();if(op.stage===stage)return op;if(op.error)throw new Error(op.error);await tick();}throw new Error('did not reach '+stage+': '+JSON.stringify(await load()));};
 const planned=async()=>{await api.createDatabaseMigration(f.actor,f.serviceId,input);await until('planning');await tick();await evidence.plan();return load();};
 const frozen=async()=>{const op=await planned();await api.approveDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:op.revision,approvalDigest:op.plan!.plan.approvalDigest});const dto=await api.getDatabaseMigration(f.actor,f.serviceId,op.id);await api.switchDatabaseMigration(f.actor,f.serviceId,op.id,{expectedRevision:dto.revision,confirmationDigest:dto.confirmationDigest!});f.state.barrier=true;await until('migrating');await tick();return load();};
 const verified=async()=>{await frozen();await evidence.receipt('run');f.state.ready=true;await until('verifying');await tick();await evidence.receipt('verify');return load();};
 const handoff=async()=>{for(let n=0;n<12;n++){const current=await deps.uow.read.handoffs.get(input.requestId);if(current?.stage==='complete')return;if(current?.stage==='preparing')f.prepareHandoff();if(current?.stage==='activating'){f.handoffState.routed=true;if(f.handoffState.authority.stage==='routed')f.handoffState.authority.stage='complete';}await releaseHandoffUseCases(deps).progressHandoffs();}throw new Error('handoff incomplete');};
 return {...f,deps,state,restoreState:f.state,store,api,input,load,tick,until,planned,frozen,verified,callback,write,proof,handoff,...evidence};
 } catch(error) { await f.close();throw error; }
}
function databaseMigrationEvidence(f:{load:()=>Promise<DatabaseMigrationOperation>;callback:(action:string,body?:unknown)=>Promise<Response>;write:(name:string,text:string)=>Promise<string>;proof:(op:DatabaseMigrationOperation,output?:MigrationJobProof['output'])=>MigrationJobProof;proofs:Map<string,MigrationJobProof>;tick:()=>Promise<number>}){
 const plan=async(blocks:DatabaseMigrationPlanView['plan']['payload']['blocks']=[],compact=false)=>{
  const op=await f.load(),operationId=migrationOperationKey(op.id),payload={operationId,source:{provider:'postgresql',generationId:op.sourceGenerationId,epoch:1},target:{provider:'postgresql',generationId:'dbg_'+'a'.repeat(32),location:{kind:'postgresql-target',profileRef:'crewstation:target'},epoch:2},blocks,estimates:{requiredBytes:30*1024**3}},digest=migrationDigest(payload);
  const view:DatabaseMigrationPlanView={operationId,plan:{payload,digest,approvalDigest:migrationDigest({approval:payload})},jsonPath:null,markdownPath:null,acknowledgeable:[],requiresApproval:true,guidance:[]};
  await f.write(`plans/${digest}.json`,migrationCanonical(view.plan));await f.write(`plans/${digest}.md`,'# Plan\n');
  const text=JSON.stringify(compact?{operationId,runId:'run-one',planDigest:digest,approvalDigest:view.plan.approvalDigest,planPath:null}:view);
  f.proofs.set(op.currentAttempt!.jobId,f.proof(op,{kind:'plan',text}));await f.tick();return view;
 };
 const receipt=async(kind:'run'|'verify'|'rollback'|'complete')=>{
  const op=await f.load(),operationId=migrationOperationKey(op.id),generationId=op.plan!.plan.payload.target.generationId;
  const payload=kind==='run'?{operationId,target:op.plan!.plan.payload.target,approvalDigest:op.approval!.digest}:kind==='rollback'?{operationId,generationId,kind:'rolled-back',firstLiveWriteAt:null}:{operationId,generationId,kind:kind==='verify'?'verified':'completed',activationReceiptDigest:op.receipts.run!.digest};
  const value={payload,digest:migrationDigest(payload)},text=migrationCanonical(value),names={run:'activation',verify:'switch',rollback:'rollback',complete:'completion'};
  await f.write(names[kind]+'-receipt.json',text);
  if(kind==='run'){const response=await f.callback('prepared',{operationId,generationId,receiptDigest:value.digest,location:op.plan!.plan.payload.target.location,requestKey:`${operationId}:${value.digest}`});if(response.status!==200)throw new Error(await response.text());}
  if(kind==='rollback')await f.callback('rollback',{requestKey:operationId+':rollback'});
  f.proofs.set(op.currentAttempt!.jobId,f.proof(op,{kind:'receipt',text}));await f.tick();return value;
 };
 return {plan,receipt};
}
export type DatabaseMigrationFixture=Awaited<ReturnType<typeof databaseMigrationFixture>>;
