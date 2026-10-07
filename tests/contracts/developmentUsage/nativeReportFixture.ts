// Actual native live consumer, original PG snapshot/report files, controlled owner admission and CNY rates.
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {TestDatabase} from '../../../packages/testkit';
import {originalReportSnapshotSession} from '../../../packages/persistence';
import {createFakeK8sClient} from '../../../packages/k8s';
import {jsonHash} from '../../../packages/kernel';
import {RuntimeTaskHeaderFactSchema,RuntimeAttemptFactSchema,ServiceIdSchema,type ProjectId,type RuntimeCompleteReport,type RuntimeTaskHeaderFact} from '../../../packages/contracts';
import {createObservabilityModule} from '../../../modules/observability/wiring';
import {nativeLiveFixture} from './nativeLiveFixture';
export async function nativeReportFixture(database:TestDatabase,options:Parameters<typeof nativeLiveFixture>[1]={}) {
 const live=await nativeLiveFixture(database,options),r=live.execution.registration,accepted=(await live.price.pricing.get(r.identity))!;
 const root=await mkdtemp(join(tmpdir(),'cs-native-paged-report-'));
 const task=RuntimeTaskHeaderFactSchema.parse({id:r.runtimeTaskId,projectId:r.identity.projectId,projectName:'原生分页验收项目',serviceId:ServiceIdSchema.parse(Bun.randomUUIDv7()),name:'原生分页验收开发执行',
  source:{kind:'development-agent',identity:r.identity,workspaceName:'原始验收工作区'},protocol:'development',state:'running',createdAt:accepted.acceptedAt,closedAt:null,traceId:null});
 const attempt=RuntimeAttemptFactSchema.parse({id:r.identity.agentId,taskId:r.identity.taskId,name:'原生分页验收 Agent',kind:'agent',state:'running',attempt:1,
  executionId:r.identity.executionId,agentId:r.identity.agentId,profileId:r.profileId,profileName:'验收专用原生算力（不代表供应商账单）',profileRevision:r.profileRevision,
  createdAt:accepted.acceptedAt,startedAt:null,endedAt:null});
 const empty=async()=>[];
 const module=createObservabilityModule({db:database.db,reportSnapshot:originalReportSnapshotSession(database.handle),reportDataRoot:root,
  reportFacts:(_db,query,snapshotId)=>{
   const reader=<T,>(items:readonly T[])=>({next:async(after:string|null)=>{if(after!==null)throw new Error('Controlled owner has original EOF');return {items,snapshotId,nextCursor:null};}});
   const selected=(!query.projectId||query.projectId===task.projectId)&&(!query.taskId||query.taskId===task.id);
   return {tasks:{'business-task':reader<RuntimeTaskHeaderFact>([]),'development-agent':reader(selected?[task]:[])},attempts:()=>reader([attempt]),projectName:async()=>task.projectName??null,profileName:async()=>attempt.profileName??null};
  },k8s:createFakeK8sClient(),isAdmin:async()=>true,authorizer:{authorize:async()=>undefined},services:{resolveServiceOfProject:async()=>undefined},slots:{slotRoles:async()=>undefined},
  traces:{environments:{traceKeys:empty,activeTraceIds:empty,list:empty},deliveries:{traceKeys:empty,activeTraceIds:empty,list:empty},businessTasks:{list:empty},sessions:{summarize:empty,events:empty}}});
 async function drainLive() {
  for(;;) {
   await live.module.api.reconcileExecutionUsage();
   const [pending]=await database.handle.client`SELECT EXISTS(SELECT 1 FROM observability.development_native_passes WHERE work_state='pending') AS waiting`;
   if(!pending!.waiting&&!await live.session.api.nextDevelopmentUsageSource())return;
  }
 }
 const actor=live.price.actor,window={from:new Date(Date.parse(accepted.acceptedAt)-60_000).toISOString(),to:new Date(Date.parse(accepted.acceptedAt)+60_000).toISOString(),timezone:'Asia/Shanghai'};
 async function settle(projectId:ProjectId|null=null,detail=false) {
  let report:RuntimeCompleteReport=detail?await module.api.runtimeCompleteTaskReport(actor,projectId,task.id):await module.api.runtimeCompleteReport(actor,projectId,window);
  while(report.state==='building'){for(const worker of module.reportWorkers)await worker.drain();report=await module.api.runtimeCompleteReportStatus(actor,projectId,report.reportId);}return report;
 }
 return {...live,task,attempt,reportModule:module,actor,settle,drainLive,attemptKey:jsonHash(JSON.stringify(['development-agent',r.identity.projectId,r.identity.taskId,r.identity.agentId,r.identity.executionId,1])),
  close:async()=>{for(const worker of module.reportWorkers)await worker.stop();await live.close();await rm(root,{recursive:true,force:true});}};
}
