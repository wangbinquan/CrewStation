import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sql} from 'drizzle-orm';
import {ProjectIdSchema,ProjectDeletionTargetSchema,type ProjectId,type ProjectDeletionContext,type ProjectDeletionInventory,type RuntimeCompleteReport,type Actor} from '@crewstation/contracts';
import {createFakeK8sClient} from '@crewstation/k8s';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {connectDatabase,originalReportSnapshotSession,resourceIdentityDirectory,type ReportSnapshotSession} from '@crewstation/persistence';
import {createTestDatabase} from '@crewstation/testkit';
import {createObservabilityModule,observabilityMigrations} from '../wiring';
import {completeCohortFixture,completeCohortWindow,seedCompleteCohort} from './completeCohortFixture';
import {target as originalTarget} from './projectDeletionFixture';
import {completeRuntimeReportCache} from '../adapters/persistence/reports/reportStore';
import {completeRuntimeFileSpool} from '../adapters/persistence/reports/fileSpool';
import {nativeSteps} from '../adapters/persistence/tables';
import {drizzleCostVisibility} from '../adapters/persistence/drizzleTokenPricing';
export async function reportDeletionFixture() {
 const database=await createTestDatabase([observabilityMigrations]),handle=connectDatabase(database.url,{max:1}),root=mkdtempSync(join(tmpdir(),'cs-report-deletion-'));
 const originalA=completeCohortFixture(),originalB=completeCohortFixture(),a={...originalA,projectId:ProjectIdSchema.parse(originalA.projectId)},b={...originalB,projectId:ProjectIdSchema.parse(originalB.projectId)};
 for(const f of [a,b]){f.tasks.splice(1);f.attempts.splice(1);f.records.splice(1);f.captures.splice(1);f.captures[0]={...f.captures[0]!,id:'capture-'+f.projectId};await seedCompleteCohort(database,f);
  const taskKey=jsonHash({projectId:f.projectId,taskId:f.tasks[0]!.id});await database.db.insert(nativeSteps).values({captureId:f.captures[0]!.id,recordId:'record-0',taskKey,nativeKey:jsonHash([f.identity(0),f.captures[0]!.proof.turn]),root:'root-0',revision:1,fingerprint:f.captures[0]!.proof.fingerprint!});
 }
 await drizzleCostVisibility(database.db).save(b.projectId,{expectedRevision:0,requestKey:newResourceId(),visibility:'project-members-and-services'},new Date());
 const actor={userId:newResourceId(),isAdmin:true} as Actor,operationId=newResourceId(),target=ProjectDeletionTargetSchema.parse({...originalTarget,id:a.projectId}),snapshot=originalReportSnapshotSession(handle);
 const controls:{entered?:()=>void;hold?:boolean;signal?:AbortSignal}={};
 const session:ReportSnapshotSession={run:(work,signal,key)=>{controls.signal=signal;return snapshot.run(work,signal,key);}};
 const module=createObservabilityModule({db:handle.db,reportSnapshot:session,reportDataRoot:root,reportFacts:(tx,query,snapshotId)=>{
  const reader=<T>(items:readonly T[])=>({next:async()=>({items,snapshotId,nextCursor:null})});
  const selected=[a,b].filter(f=>!query.projectId||query.projectId===f.projectId);
  return {tasks:{'business-task':{next:async()=>{await tx.execute(sql`SELECT 1`);controls.entered?.();if(controls.hold){const signal=controls.signal!;signal.throwIfAborted();await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}return {items:selected.flatMap(f=>f.tasks),snapshotId,nextCursor:null};}},'development-agent':reader([])},attempts:task=>reader([a,b].find(f=>f.tasks[0]!.id===task.id)!.attempts),projectName:async id=>id===a.projectId?'Original A':'Original B',profileName:async()=> 'Original Compute'};
 },k8s:createFakeK8sClient(),isAdmin:async()=>true,authorizer:{authorize:async()=>{}},services:{resolveServiceOfProject:async()=>undefined},slots:{slotRoles:async()=>undefined},
 traces:{environments:{traceKeys:async()=>[],activeTraceIds:async()=>[],list:async()=>[]},deliveries:{traceKeys:async()=>[],activeTraceIds:async()=>[],list:async()=>[]},businessTasks:{list:async()=>[]},sessions:{summarize:async()=>[],events:async()=>[]}},
 deletion:{identities:resourceIdentityDirectory(handle.db,()=>[observabilityMigrations]),tasks:{list:async()=>({ids:a.tasks.map(t=>t.id),complete:true})},assertGrant:async context=>{if(context.operationId!==operationId)throw new Error('wrong original deletion');}},
 });
 const owner=module.api.deletionOwner!,store=completeRuntimeReportCache(handle.db),spool=completeRuntimeFileSpool(root);
 const context=(confirmed:ProjectDeletionInventory,phase:ProjectDeletionContext['phase']):ProjectDeletionContext=>({operationId,target,confirmed,phase,generation:1});
 async function ready(projectId:ProjectId|null){let report=await module.api.runtimeCompleteReport(actor,projectId,completeCohortWindow);while(report.state==='building')report=await module.api.runtimeCompleteReportStatus(actor,projectId,report.reportId);if(report.state!=='ready')throw new Error('Original report failed: '+JSON.stringify(report));return report;}
 async function population(){const rows=await handle.db.execute<{table_name:string;count:string}>(sql`SELECT 'reports' AS table_name,count(*)::text AS count FROM observability.runtime_reports UNION ALL SELECT 'pages',count(*)::text FROM observability.runtime_report_pages UNION ALL SELECT 'rows',count(*)::text FROM observability.runtime_report_rows UNION ALL SELECT 'counts',count(*)::text FROM observability.runtime_report_counts UNION ALL SELECT 'receipts',count(*)::text FROM observability.runtime_report_receipts`);return rows.map(row=>row.count);}
 async function preservedB(){const taskKey=jsonHash({projectId:b.projectId,taskId:b.tasks[0]!.id});return (await handle.db.execute(sql`SELECT (SELECT document FROM observability.usage_projections WHERE task_key=${taskKey}) AS usage,(SELECT document FROM observability.execution_valuations WHERE task_key=${taskKey}) AS valuation,(SELECT document FROM observability.native_captures WHERE task_key=${taskKey}) AS capture`))[0];}
 async function close(){await module.reportWorkers[0]!.stop();await handle.close();await database.drop();rmSync(root,{recursive:true,force:true});}
 return {database,handle,root,a,b,actor,target,context,module,owner,store,spool,controls,ready,population,preservedB,close,snapshot};
}
export function expectedReportMetrics(report:Extract<RuntimeCompleteReport,{state:'ready'}>){return report.summary.metrics;}
