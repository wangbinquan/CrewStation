// Real Dev owner, SQLite journal, Session PG, ledger/CNY and safe two-level facts.
// Runner transport is controlled; no live identity, model or Pod lifecycle acceptance.
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Actor,RunnerCommand,TaskId } from '../../packages/contracts';
import { fixedClock,jsonHash,newResourceId } from '../../packages/kernel';
import { createFakeK8sClient } from '../../packages/k8s';
import type { TestDatabase } from '../../packages/testkit';
import { createObservabilityModule,type ObservabilityModule } from '../../modules/observability/wiring';
import { createSessionModule } from '../../modules/session/wiring';
import { drizzleDevelopmentUsageStore } from '../../modules/session/adapters/persistence/developmentUsage';
import { ingestDevelopmentUsage } from '../../modules/session/application/developmentUsageIngestion';
import { developmentUsageFixture } from '../../modules/dev-session/tests/developmentUsageFixture';
import { developmentUsageOwner } from '../../modules/dev-session/application/developmentUsage';
import { readDevelopmentObservationFacts } from '../../modules/dev-session';
import { developmentObservationSource } from '../../modules/platform/application/developmentObservationPorts';
import { runtimeFactSources } from '../../modules/platform/application/runtimeFactSources';
import { DevelopmentUsageJournal } from '../../runtimes/task/src/agents/developmentUsageJournal';
export const developmentStatisticsWindow={from:'2026-09-30T00:00:00.000Z',to:'2026-10-01T00:00:00.000Z',timezone:'Asia/Shanghai'};
const actualModel={provider:'actual-provider',model:'controlled-M',condition:null};
const at='2026-09-30T00:10:01.000Z',clock=fixedClock(at);
function makeSession(tdb:TestDatabase){return createSessionModule({db:tdb.db,runnerAuth:{verifyRunnerToken:async()=>({ok:false,reason:'unused'})},taskAccess:{canOpenStream:async()=>false,onRunnerConnected:async()=>true,onRunnerDisconnected:async()=>{}},isAdmin:async()=>false,settings:{selfAddress:'http://copy.test',commandTimeoutMs:1000,runnerStaleMs:30000,replayLimit:100}});}
export async function developmentStatisticsChain(tdb:TestDatabase){
  const f=await developmentUsageFixture(tdb.db);await f.starts.update({...f.start,computeName:'Original accepted Compute'});
  let observations:ObservabilityModule;
  const owner=developmentUsageOwner(f.store,f.starts,f.environmentPort,{accept:input=>observations.api.acceptExecutionPrice(input)});
  let session=makeSession(tdb);const controls={lostAck:false,businessReads:0,developmentReads:0,namesAvailable:true};
  const baseSource=()=>developmentObservationSource(owner,{...session.api,acknowledgeDevelopmentUsageSource:async(key,through)=>{await session.api.acknowledgeDevelopmentUsageSource(key,through);if(controls.lostAck){controls.lostAck=false;throw new Error('ACK response lost after commit');}}});
  const profile={id:f.start.profile.profileId,revision:2,protocol:'opencode' as const,name:'Current renamed Compute',model:'configured-never-observed'},empty=async()=>[];
  const build=(business=false)=>createObservabilityModule({db:tdb.db,clock,k8s:createFakeK8sClient(),isAdmin:async()=>true,developmentUsageSource:{...baseSource(),next:async()=>{controls.developmentReads++;return baseSource().next();}},
    ...(business?{usageSource:{next:async()=>{controls.businessReads++;throw new Error('business unavailable');},measurement:async()=>undefined,resolve:async()=>undefined,acknowledge:async()=>{}}}:{}),
    authorizer:{authorize:async(_actor,p)=>{if(p!==f.workspace.projectId)throw new Error('outside project');}},services:{resolveServiceOfProject:async()=>undefined},slots:{slotRoles:async()=>undefined},pricingProfiles:{list:async()=>[profile]},
    runtimeTasks:runtimeFactSources({business:async()=>({items:[],partial:false}),development:readDevelopmentObservationFacts}),runtimeNames:async()=>{if(!controls.namesAvailable)throw new Error('directory unavailable');return {projects:{[f.workspace.projectId]:'Actual owner project'},profiles:{[profile.id]:profile.name}};},
    traces:{environments:{traceKeys:empty,activeTraceIds:empty,list:empty},deliveries:{traceKeys:empty,activeTraceIds:empty,list:empty},businessTasks:{list:empty},sessions:{summarize:empty,events:empty}}});
  observations=build();const admin:Actor={userId:newResourceId() as Actor['userId'],isAdmin:true};
  const price=await observations.api.savePrice(admin,profile.id,{expectedRevision:0,requestKey:'original-CNY-price',profileRevision:2,protocol:'opencode',...actualModel,currency:'CNY',rates:{input:'2',output:'0',cacheRead:'0',cacheWrite:'0'},effectiveFrom:at,sourceNote:'Controlled real numeric receipt'});
  const prepared=await owner.prepare(f.preparation),dir=await mkdtemp(join(tmpdir(),'cs-development-statistics-'));
  const journal=new DevelopmentUsageJournal(dir,{projectId:f.workspace.projectId,workspaceTaskId:f.workspace.id,runtimeTaskId:f.child.id,podUid:f.info.podUid},crypto.randomUUID());
  const bound=await owner.bind(f.child.id,journal.info()),registration=bound.binding!,admission={intent:prepared.intent,digestNonce:prepared.digestNonce,key:registration.key};
  journal.reserve(admission);if(!journal.permitLaunch(registration.key))throw new Error('controlled original launch denied');journal.running(registration.key);
  journal.capture(registration.key,{version:1,diagnostics:[],measurements:[{recordId:'actual-step',revision:1,occurredAt:at,observedAt:at,adapterVersion:'controlled-SQLite/1',actualModel,reporting:'delta',inclusion:'self',coverage:'complete',validity:'valid',scope:null,coveredThroughTurn:null,basis:{kind:'invocation'},usage:{input:'9007199254740993',output:'7',cacheRead:'0',cacheWrite:'0'}}]},at);
  await session.api.registerDevelopmentUsage(registration);
  const send=async(_taskId:TaskId,command:RunnerCommand)=>{
    if(command.type==='developmentUsageInfo')return journal.info(command.key);
    if(command.type==='readDevelopmentUsageEvents')return journal.read(command.key,command.after,command.limit);
    if(command.type==='ackDevelopmentUsageEvents')return journal.acknowledge(command.key,command.through);
    throw new Error('unexpected controlled numeric command');
  };
  const copy=async()=>{const store=drizzleDevelopmentUsageStore(tdb.db);await ingestDevelopmentUsage({store,send},(await store.get(f.child.id,registration.key))!);};
  const fingerprint=async()=>{const stats=await observations.api.systemRuntimeStatistics(admin,developmentStatisticsWindow);return jsonHash(stats.tasks.map(r=>r.metrics));};
  return {f,admin,owner,prepared,registration,controls,profile,price,journal,copy,fingerprint,get observations(){return observations;},get session(){return session;},
    reopen:(business=false)=>{session=makeSession(tdb);observations=build(business);},cleanup:async()=>{journal.close();await rm(dir,{recursive:true,force:true});}};
}
