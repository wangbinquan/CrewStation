// Explicit original Task-owner port fixtures; native usage and all report retention are real PostgreSQL.
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {newResourceId,fixedClock} from '@crewstation/kernel';
import {originalReportSnapshotSession} from '@crewstation/persistence';
import {createFakeK8sClient} from '@crewstation/k8s';
import {createTestDatabase} from '@crewstation/testkit';
import {UserIdSchema,type Actor,type RuntimeTaskHeaderFact,type RuntimeCompleteReport,type ProjectId} from '@crewstation/contracts';
import {createObservabilityModule,observabilityMigrations} from '../wiring';
import {completeCohortFixture,completeCohortWindow,seedCompleteCohort} from './completeCohortFixture';
export async function completeFactsFixture() {
 const tdb=await createTestDatabase([observabilityMigrations]),f=completeCohortFixture();await seedCompleteCohort(tdb,f,true);
 const root=mkdtempSync(join(tmpdir(),'cs-sealed-facts-')),actor:Actor={userId:UserIdSchema.parse(newResourceId()),isAdmin:true},controls={broken:false};
 const module=createObservabilityModule({db:tdb.db,reportSnapshot:originalReportSnapshotSession(tdb.handle),reportDataRoot:root,
  reportFacts:(_db,query,snapshotId)=>{
   const facts=f.facts(snapshotId),tasks=f.tasks.filter(task=>(!query.taskId||task.id===query.taskId)&&(!query.projectId||task.projectId===query.projectId));
   const reader=<T,>(rows:readonly T[])=>({next:async(after:string|null)=>{const start=after===null?0:Number(after),items=rows.slice(start,start+37);return {items,snapshotId,nextCursor:start+items.length<rows.length?String(start+items.length):null};}});
   return {...facts,tasks:{'business-task':{next:async(after:string|null)=>{if(controls.broken)throw new Error('Original Task source unavailable');return reader(tasks).next(after);}},'development-agent':reader<RuntimeTaskHeaderFact>([])}};
  },k8s:createFakeK8sClient(),clock:fixedClock(completeCohortWindow.to),isAdmin:async()=>true,authorizer:{authorize:async()=>{}},services:{resolveServiceOfProject:async()=>undefined},slots:{slotRoles:async()=>undefined},
  traces:{environments:{traceKeys:async()=>[],activeTraceIds:async()=>[],list:async()=>[]},deliveries:{traceKeys:async()=>[],activeTraceIds:async()=>[],list:async()=>[]},businessTasks:{list:async()=>[]},sessions:{summarize:async()=>[],events:async()=>[]}},
 });
 async function settle(projectId:ProjectId|null,taskId?:typeof f.tasks[number]['id']) {
  let report:RuntimeCompleteReport=taskId?await module.api.runtimeCompleteTaskReport(actor,projectId,taskId):await module.api.runtimeCompleteReport(actor,projectId,completeCohortWindow);
  while(report.state==='building'){for(const worker of module.reportWorkers)await worker.drain();report=await module.api.runtimeCompleteReportStatus(actor,projectId,report.reportId);}
  return report;
 }
 return {f,tdb,module,actor,controls,settle,close:async()=>{for(const worker of module.reportWorkers)await worker.stop();await tdb.drop();rmSync(root,{recursive:true,force:true});}};
}
