// Actual PostgreSQL/spool/facts: original ambiguous records must qualify their own scopes.
import {afterEach,expect,test} from 'bun:test';
import {sql} from 'drizzle-orm';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {runtimeCompleteReportContent,type RuntimeReportSection,type ProjectId,type RuntimeCompleteReport,UsageRecordSchema,NativeUsageProofSchema} from '@crewstation/contracts';
import {usageProjections,nativeCaptures,nativeSteps} from '../adapters/persistence/tables';
import {nativeCaptureSummary,type NativeCaptureDocument} from '../domain/usageProjection';
import {completeFactsFixture} from './completeFactsFixture';
const available=await testDatabaseAvailable();let fixture:Awaited<ReturnType<typeof completeFactsFixture>>|undefined;
afterEach(async()=>{await fixture?.close();fixture=undefined;});
async function all(f:Awaited<ReturnType<typeof completeFactsFixture>>,projectId:ProjectId|null,report:RuntimeCompleteReport,section:RuntimeReportSection,parent?:string){const items:unknown[]=[];let after:string|undefined;do{const page=await f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section,parent,pageSize:37,after});items.push(...page.items);after=page.nextCursor??undefined;}while(after!==undefined);return items;}
test.skipIf(!available)('all four overlapping buckets mark the original attempt, Agent and compute contribution incomplete without hiding received values',async()=>{
 const f=fixture=await completeFactsFixture({completeSibling:true,feePolicyCohort:true}),original=f.sibling!.record;
 // Keep the original complete capture binding: an exact overlap, not a second missing native capture, must cause this gap.
 for(const [recordId,start,end] of [['summary-a',0,2],['summary-b',1,3]] as const){
  const record=UsageRecordSchema.parse({...original,recordId,reporting:'cumulative',scope:{...original.scope!,level:'self-total',turn:start===0?original.scope!.turn:'overlap-turn',turnIndex:start},coveredThroughTurn:end,usage:{input:'80',cacheRead:'3',cacheWrite:'5',output:'7'},projection:{...original.projection,contribution:{input:'80',cacheRead:'3',cacheWrite:'5',output:'7'},coveredThrough:{input:end,cacheRead:end,cacheWrite:end,output:end}}});
  await f.tdb.db.insert(usageProjections).values({meterKey:jsonHash({identity:record.identity,sourceId:record.sourceId,recordId}),taskKey:jsonHash({projectId:record.identity.projectId,taskId:record.identity.taskId}),document:record});
  if(start===1){const taskKey=jsonHash({projectId:record.identity.projectId,taskId:record.identity.taskId}),id=newResourceId(),fingerprint=jsonHash([record.identity,'overlap-turn']);const capture:NativeCaptureDocument={id,identity:record.identity,sourceId:record.sourceId,began:true,baselineRoot:record.scope!.root,historicalRevisionGap:false,proof:NativeUsageProofSchema.parse({contract:'opencode-child-steps-v1',lineageKey:'sibling-overlap-lineage',turn:record.scope!.turn,turnIndex:start,state:'complete',root:record.scope!.root,observedAt:record.observedAt,baseline:{kind:'fresh',fingerprint:null},fingerprint,sessions:1,steps:1,emitted:1,baselineSteps:0,priorRevisionGap:false,issues:[]})};await f.tdb.db.insert(nativeCaptures).values({id,taskKey,sourceId:capture.sourceId,turn:capture.proof.turn,lineageKey:capture.proof.lineageKey,root:capture.proof.root,finalized:true,document:capture,summary:nativeCaptureSummary(capture,{steps:1,baselines:0,unresolved:0,revised:0})});await f.tdb.db.insert(nativeSteps).values({captureId:id,recordId,taskKey,nativeKey:jsonHash([record.identity,capture.proof.turn]),root:record.scope!.root,revision:1,fingerprint});}

 }
 const report=await f.settle(null,f.sibling!.task.id),summary=runtimeCompleteReportContent(report)!.summary;expect(report.state).toBe('not-ready');
 // summary-a covers the original request; summary-b overlaps and is excluded in all four buckets.
 expect(summary.metrics).toMatchObject({state:'not-ready',gaps:['coverage-incomplete'],recordedUsage:{records:'2',tokens:{input:'80',cacheRead:'3',cacheWrite:'5',output:'7',total:'95'},bucketRecords:{input:'1',cacheRead:'1',cacheWrite:'1',output:'1'}},costCoverage:{records:'2',pricedRecords:'0',visibility:'visible'}});
 expect(summary.metrics).not.toHaveProperty('tokens');expect(summary.metrics).not.toHaveProperty('recordedCost');
 const agents=await all(f,null,report,'agents') as {key:string;metrics:unknown}[],profiles=await all(f,null,report,'profiles') as {key:string;metrics:unknown}[];
 for(const row of [...agents,...profiles,...await all(f,null,report,'projects') as {metrics:unknown}[],...await all(f,null,report,'attempts',f.sibling!.task.id) as {metrics:unknown}[],...await all(f,null,report,'swimlane',f.sibling!.task.id) as {metrics:unknown}[]])expect(row.metrics).toEqual(summary.metrics);
 for(const [section,parent] of [['agent-tasks',agents[0]!.key],['profile-tasks',profiles[0]!.key]] as const){const rows=await all(f,null,report,section,parent) as {metrics:unknown}[];expect(rows).toHaveLength(1);expect(rows[0]!.metrics).toEqual(summary.metrics);}
},60000);
test.skipIf(!available)('a visible received valuation in an incomplete Task is revoked by project fee hiding and stays hidden in the fresh report',async()=>{
 const f=fixture=await completeFactsFixture({feePolicyCohort:true}),projectId=f.f.tasks[0]!.projectId;
 await f.module.api.setExecutionCostVisibility(f.actor,projectId,{expectedRevision:0,requestKey:'received-fees-show',visibility:'project-members-and-services'});
 const report=await f.settle(projectId);expect(runtimeCompleteReportContent(report)!.summary.metrics).toMatchObject({state:'not-ready',recordedCost:{currency:'CNY',amount:'0.0000745',records:'1',pricedRecords:'1'}});
 await f.module.api.setExecutionCostVisibility(f.actor,projectId,{expectedRevision:1,requestKey:'received-fees-hide',visibility:'hidden'});
 await expect(f.module.api.runtimeCompleteReportStatus(f.actor,projectId,report.reportId)).rejects.toThrow('项目费用显示配置已改变');await expect(f.module.api.runtimeCompleteReportPage(f.actor,projectId,report.reportId,{section:'tasks',pageSize:37})).rejects.toThrow('项目费用显示配置已改变');
 const fresh=await f.settle(projectId),metrics=runtimeCompleteReportContent(fresh)!.summary.metrics;expect(fresh.reportId).not.toBe(report.reportId);expect(metrics).toMatchObject({state:'not-ready',recordedUsage:{tokens:{input:'1',cacheRead:'3',cacheWrite:'5',output:'7',total:'16'}},costCoverage:{records:'1',pricedRecords:'1',visibility:'hidden'}});expect(metrics).not.toHaveProperty('recordedCost');
 await f.tdb.db.execute(sql`UPDATE observability.runtime_report_rows SET document=jsonb_set(document,'{metrics,recordedUsage,tokens,total}','"15"'::jsonb) WHERE report_id=${fresh.reportId} AND section='tasks' AND parent=''`);await expect(f.module.api.runtimeCompleteReportPage(f.actor,projectId,fresh.reportId,{section:'tasks',pageSize:37})).rejects.toThrow();
},60000);
