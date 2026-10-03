// Real Dev owner, SQLite journal, Session PG, ledger/CNY and safe two-level facts.
// Runner transport is controlled; no live identity, model or Pod lifecycle acceptance.
import { mkdtemp,rm } from 'node:fs/promises';
import {Database as NativeDatabase} from 'bun:sqlite';
import {originalReportSnapshotSession} from '../../packages/persistence';
import {createDevelopmentNativeUsageCapture} from '../../packages/agent-drivers/drivers/usage/developmentNativeCapture';
import {RuntimeCompleteReportSchema,type RuntimeCompleteReport,type RuntimeReportSection,type RuntimeReportPage} from '../../packages/contracts';
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
import { readDevelopmentObservationTaskPage,readDevelopmentObservationAttemptPage } from '../../modules/dev-session';
import { developmentObservationSource } from '../../modules/platform/application/developmentObservationPorts';
import {completeRuntimeFactSources} from '../../modules/platform/application/completeRuntimeFactSources';
import { DevelopmentUsageJournal } from '../../runtimes/task/src/agents/developmentUsageJournal';
export const developmentStatisticsWindow={from:'2026-09-30T00:00:00.000Z',to:'2026-10-01T00:00:00.000Z',timezone:'Asia/Shanghai'};
const actualModel={provider:'actual-provider',model:'controlled-M',condition:null};
const at='2026-09-30T00:10:01.000Z',clock=fixedClock(at);
function makeSession(tdb:TestDatabase){return createSessionModule({db:tdb.db,runnerAuth:{verifyRunnerToken:async()=>({ok:false,reason:'unused'})},taskAccess:{canOpenStream:async()=>false,onRunnerConnected:async()=>true,onRunnerDisconnected:async()=>{}},isAdmin:async()=>false,settings:{selfAddress:'http://copy.test',commandTimeoutMs:1000,runnerStaleMs:30000,replayLimit:100}});}
export async function developmentStatisticsChain(tdb:TestDatabase){
  const f=await developmentUsageFixture(tdb.db);await f.starts.update({...f.start,computeName:'Original accepted Compute'});
  const dir=await mkdtemp(join(tmpdir(),'cs-development-statistics-')),modules:ObservabilityModule[]=[];
  let observations:ObservabilityModule;
  const owner=developmentUsageOwner(f.store,f.starts,f.environmentPort,{accept:input=>observations.api.acceptExecutionPrice(input)});
  let session=makeSession(tdb);const controls={lostAck:false,businessReads:0,developmentReads:0,namesAvailable:true};
  const baseSource=()=>developmentObservationSource(owner,{...session.api,acknowledgeDevelopmentUsageSource:async(key,through)=>{await session.api.acknowledgeDevelopmentUsageSource(key,through);if(controls.lostAck){controls.lostAck=false;throw new Error('ACK response lost after commit');}}});
  const profile={id:f.start.profile.profileId,revision:2,protocol:'opencode' as const,name:'Current renamed Compute',model:'configured-never-observed'},empty=async()=>[];
  const build=(business=false)=>{const module=createObservabilityModule({db:tdb.db,reportDataRoot:dir,reportSnapshot:originalReportSnapshotSession(tdb.handle),reportFacts:completeRuntimeFactSources({business:{tasks:async()=>({items:[],nextCursor:null}),attempts:async()=>({items:[],nextCursor:null})},development:{tasks:readDevelopmentObservationTaskPage,attempts:readDevelopmentObservationAttemptPage},projectName:async()=>controls.namesAvailable?'Actual owner project':null,profileName:async()=>controls.namesAvailable?profile.name:null}),clock,k8s:createFakeK8sClient(),isAdmin:async()=>true,developmentUsageSource:{...baseSource(),next:async()=>{controls.developmentReads++;return baseSource().next();}},
    ...(business?{usageSource:{next:async()=>{controls.businessReads++;throw new Error('business unavailable');},measurement:async()=>undefined,resolve:async()=>undefined,acknowledge:async()=>{}}}:{}),
    authorizer:{authorize:async(_actor,p)=>{if(p!==f.workspace.projectId)throw new Error('outside project');}},services:{resolveServiceOfProject:async()=>undefined},slots:{slotRoles:async()=>undefined},pricingProfiles:{list:async()=>[profile]},
    traces:{environments:{traceKeys:empty,activeTraceIds:empty,list:empty},deliveries:{traceKeys:empty,activeTraceIds:empty,list:empty},businessTasks:{list:empty},sessions:{summarize:empty,events:empty}}});modules.push(module);return module;};
  observations=build();const admin:Actor={userId:newResourceId() as Actor['userId'],isAdmin:true};
  const price=await observations.api.savePrice(admin,profile.id,{expectedRevision:0,requestKey:'original-CNY-price',profileRevision:2,protocol:'opencode',...actualModel,currency:'CNY',rates:{input:'2',output:'0',cacheRead:'0',cacheWrite:'0'},effectiveFrom:at,sourceNote:'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL: controlled original numeric receipt'});
  const prepared=await owner.prepare({...f.preparation,intent:{...f.preparation.intent,nativeSource:{version:1}}});
  const journal=new DevelopmentUsageJournal(dir,{projectId:f.workspace.projectId,workspaceTaskId:f.workspace.id,runtimeTaskId:f.child.id,podUid:f.info.podUid},crypto.randomUUID());
  const bound=await owner.bind(f.child.id,journal.info()),registration=bound.binding!,admission={intent:prepared.intent,digestNonce:prepared.digestNonce,key:registration.key};
  journal.reserve(admission);if(!journal.permitLaunch(registration.key))throw new Error('controlled original launch denied');journal.running(registration.key);
  const nativePath=join(dir,'original-native.sqlite'),nativeDb=new NativeDatabase(nativePath),root=f.preparation.intent.resumeSessionId!;
  nativeDb.exec('CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT);CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT)');
  nativeDb.query('INSERT INTO session VALUES(?,?)').run(root,null);nativeDb.close();
  let revision=0;const native=createDevelopmentNativeUsageCapture({lineageKey:f.preparation.intent.nativeUsageLineageKey,turn:'original-turn',turnIndex:0,resumeSessionId:root,nextRevision:()=>++revision},{OPENCODE_DB:nativePath}),observedAt=Date.parse(at);
  journal.capture(registration.key,native.begin(observedAt),at);
  const writer=new NativeDatabase(nativePath);writer.query('INSERT INTO message VALUES(?,?,?)').run('actual-message',root,JSON.stringify({role:'assistant',providerID:actualModel.provider,modelID:actualModel.model}));writer.query('INSERT INTO part VALUES(?,?,?,?,?)').run('actual-step',root,'actual-message',observedAt,JSON.stringify({type:'step-finish',tokens:{input:'9007199254740993',output:'7',reasoning:0,cache:{read:'0',write:'0'}}}));writer.close();
  for(const frame of native.finish(root,observedAt+1))journal.capture(registration.key,frame,at);

  await session.api.registerDevelopmentUsage(registration);
  const send=async(_taskId:TaskId,command:RunnerCommand)=>{
    if(command.type==='developmentUsageInfo')return journal.info(command.key);
    if(command.type==='readDevelopmentUsageEvents')return journal.read(command.key,command.after,command.limit);
    if(command.type==='ackDevelopmentUsageEvents')return journal.acknowledge(command.key,command.through);
    throw new Error('unexpected controlled numeric command');
  };
  const copy=async()=>{const store=drizzleDevelopmentUsageStore(tdb.db);await ingestDevelopmentUsage({store,send},(await store.get(f.child.id,registration.key))!);};
  const settle=async(pending:Promise<RuntimeCompleteReport>,projectId=f.workspace.projectId as typeof f.workspace.projectId|null)=>{let report=RuntimeCompleteReportSchema.parse(await pending);while(report.state==='building')report=RuntimeCompleteReportSchema.parse(await observations.api.runtimeCompleteReportStatus(admin,projectId,report.reportId));if(report.state!=='ready')throw new Error(JSON.stringify(report));return report;};
  const page=async<T,>(report:Extract<RuntimeCompleteReport,{state:'ready'}>,section:RuntimeReportSection,parent?:string)=>{const items:T[]=[];let after:string|undefined;do{const current=await observations.api.runtimeCompleteReportPage(admin,report.header.projectId,report.reportId,{section,pageSize:37,...(parent?{parent}:{}),...(after?{after}:{})}) as RuntimeReportPage<T>;items.push(...current.items);after=current.nextCursor??undefined;}while(after);return items;};
  const fingerprint=async()=>{const stats=await settle(observations.api.systemRuntimeStatistics(admin,developmentStatisticsWindow),null);return jsonHash((await page<{metrics:unknown}>(stats,'tasks')).map(r=>r.metrics));};
  return {f,admin,owner,prepared,registration,controls,profile,price,journal,copy,fingerprint,settle,page,get observations(){return observations;},get session(){return session;},
    reopen:(business=false)=>{session=makeSession(tdb);observations=build(business);},cleanup:async()=>{for(const module of modules)for(const worker of module.reportWorkers)await worker.stop();journal.close();await rm(dir,{recursive:true,force:true});}};
}
