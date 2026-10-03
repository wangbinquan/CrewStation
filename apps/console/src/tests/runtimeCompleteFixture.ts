// HTTP contract fixtures only; immutable report pages do not launch or validate a model.
import {RuntimeCompleteReportSchema,type RuntimeStatistics,type RuntimeTaskObservation,type RuntimeUsageMetrics,type RuntimeReportSection,type RuntimeCompleteReport,type CompleteRuntimeMetricsDto} from '@crewstation/contracts';
type Row={section:RuntimeReportSection;parent:string|null;key:string;document:unknown};
function metric(m:RuntimeUsageMetrics):CompleteRuntimeMetricsDto {
 if(!m.tokens.hasKnown)return {state:'not-applicable'};
 if(m.partial||!m.tokens.complete||Object.values(m.tokens.unknownBuckets).some(n=>n>0))return {state:'not-ready',gaps:m.reasons.length?m.reasons:['usage-incomplete']};
 return {state:'ready',tokens:{input:m.tokens.input,cacheRead:m.tokens.cacheRead,cacheWrite:m.tokens.cacheWrite,output:m.tokens.output,total:m.tokens.total},executions:String(m.executions),observedExecutions:String(m.observedExecutions),records:String(m.records),cost:{currency:'CNY',state:!m.cost.visible?'hidden':!m.cost.complete||m.cost.amount===null?'unpriced':'complete',amount:m.cost.visible&&m.cost.complete?m.cost.amount:null}};
}
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
/** Wrap legacy test data with the formal v2 API. Every request creates an immutable full snapshot. */
export function installRuntimeCompleteFixture(details:()=>RuntimeTaskObservation[],reads:string[]) {
 const delegate=globalThis.fetch,reports=new Map<string,{report:RuntimeCompleteReport;rows:Row[]}>();let revision=0n;
 globalThis.fetch=(async(raw,init)=>{
  const url=new URL(String(raw),'http://localhost'),route=url.pathname.match(/\/observability\/reports\/([^/]+)(\/pages)?$/);
  if(route){reads.push(url.pathname+url.search);const stored=reports.get(route[1]!);if(!stored)return Response.json({error:'not_found',message:'Report missing',details:{}},{status:404});
   if(!route[2])return Response.json(stored.report);
   if(stored.report.state!=='ready')return Response.json({error:'precondition',message:'Complete report not ready',details:{}},{status:412});
   const section=url.searchParams.get('section')!,parent=url.searchParams.get('parent'),rowKey=url.searchParams.get('rowKey'),after=url.searchParams.get('after'),size=Number(url.searchParams.get('pageSize')??100);
   const selected=stored.rows.filter(row=>row.section===section&&(!parent||row.parent===parent)&&(!rowKey||row.key===rowKey)),start=after===null?0:Number(after),page=selected.slice(start,start+size);
   return Response.json({reportId:route[1],snapshotId:stored.report.header.snapshotId,section,parent,total:String(selected.length),items:page.map(row=>row.document),nextCursor:start+page.length<selected.length?String(start+page.length):null});
  }
  const response=await delegate(raw,init);if(!response.ok||!url.pathname.match(/\/observability\/(statistics|tasks\/[^/]+)$/))return response;
  const original=await response.json() as RuntimeStatistics|RuntimeTaskObservation,project=url.pathname.startsWith('/v1/projects/'),single='attempts' in original;
  const tasks=single?[original]:original.tasks.map(task=>({...details().find(row=>row.id===task.id)!,...task}));
  const hide=(m:RuntimeUsageMetrics)=>project?{...m,cost:{...m.cost,visible:false,complete:false,amount:null}}:m;
  const reportId=Bun.randomUUIDv7(),rows:Row[]=[],append=(section:RuntimeReportSection,parent:string|null,key:string,document:unknown)=>rows.push({section,parent,key,document});
  const sourceStats=single?undefined:original;
  const metrics=metric(hide(single?original.metrics:sourceStats!.metrics));
  const pending=tasks.flatMap(task=>task.attempts.flatMap(attempt=>(attempt.nativeCaptures??[]).filter(capture=>capture.state!=='complete'||capture.historicalRevisionGap||capture.proof.state!=='complete')));
  let report:RuntimeCompleteReport;
  if(metrics.state==='not-ready'||!single&&sourceStats!.partial||pending.length)report={reportId,state:'not-ready',gaps:[{source:'original-fixture',reason:pending.length?'native-capture-incomplete':'usage-incomplete'}]};
  else {
   for(const task of tasks){const starts=task.attempts.flatMap(a=>a.startedAt===null||a.durationMs===null?[]:[Date.parse(a.startedAt)]),ends=task.attempts.flatMap(a=>a.startedAt===null||a.durationMs===null?[]:[Date.parse(a.startedAt)+a.durationMs]);
    const {attempts,scope:_scope,asOf:_at,partial:_partial,wallMs,cumulativeMs,activeUnionMs,unknownIntervals,attemptsPartial:_ap,...header}=task;
    append('tasks',null,task.id,{...header,attemptCount:String(task.attemptCount),metrics:metric(hide(task.metrics)),timing:{wallMs:wallMs===null?null:String(wallMs),range:starts.length?{from:new Date(Math.min(...starts)).toISOString(),to:new Date(Math.max(...ends)).toISOString()}:null,intervals:unknownIntervals?{state:'not-ready',unknown:String(unknownIntervals)}:{state:'complete',unknown:'0',cumulativeMs:String(cumulativeMs),activeUnionMs:String(activeUnionMs)}}});
    for(const attempt of attempts){const {nativeCaptures:_captures,...fact}=attempt,key=JSON.stringify([task.id,attempt.id,attempt.executionId,attempt.attempt]),document={...fact,key,metrics:metric(hide(attempt.metrics)),durationMs:attempt.durationMs===null?null:String(attempt.durationMs)};append('attempts',task.id,key,document);append('swimlane',task.id,key,document);for(const capture of attempt.nativeCaptures??[])append('captures',key,capture.id,capture);}
   }
   for(const agent of sourceStats?.agents??[]){const {tasks:parts,...fields}=agent,contributions=parts.filter(part=>tasks.some(task=>task.id===part.taskId));if(!contributions.length)continue;append('agents',null,agent.key,{...fields,sourceKind:agent.sourceKind??'business-task',tasks:String(new Set(contributions.map(r=>r.taskId)).size),metrics:metric(hide(agent.metrics))});for(const contribution of contributions){const task=tasks.find(r=>r.id===contribution.taskId)!;append('agent-tasks',agent.key,task.id,{taskId:task.id,taskName:task.name,projectId:task.projectId,projectName:task.projectName??null,sourceKind:task.source?.kind??'business-task',attempts:String(contribution.attempts),metrics:metric(hide(contribution.metrics))});}}
   for(const profile of sourceStats?.profiles??[]){const {tasks:parts,...fields}=profile,contributions=parts.filter(part=>tasks.some(task=>task.id===part.taskId));if(!contributions.length)continue;append('profiles',null,profile.key,{...fields,tasks:String(new Set(contributions.map(r=>r.taskId)).size),metrics:metric(hide(profile.metrics))});for(const contribution of contributions){const task=tasks.find(r=>r.id===contribution.taskId)!;append('profile-tasks',profile.key,task.id,{taskId:task.id,taskName:task.name,projectId:task.projectId,projectName:task.projectName??null,sourceKind:task.source?.kind??'business-task',attempts:String(contribution.attempts),metrics:metric(hide(contribution.metrics))});}}
   if(sourceStats?.scope==='system'){for(const group of sourceStats.projects)append('projects',null,group.projectId,{...group,tasks:String(group.tasks),metrics:metric(hide(group.metrics))});for(const model of sourceStats.models)append('models',null,JSON.stringify(model.modelRef),{...model,tasks:String(tasks.length),metrics:metric(hide(model.metrics))});}
   for(const quality of sourceStats?.quality??[])for(const taskId of quality.taskIds){const task=tasks.find(t=>t.id===taskId);if(task)append('quality',quality.reason,taskId,{taskId,taskName:task.name,reason:quality.reason});}
   report=RuntimeCompleteReportSchema.parse({state:'ready',reportId,header:{reportId,projectionVersion:2,scope:project?'project':'system',projectId:project?tasks[0]?.projectId??url.pathname.split('/')[3]:null,filters:sourceStats?.filters??{from:taskDate(tasks),to:original.asOf,timezone:'Asia/Shanghai'},asOf:original.asOf,snapshotId:'fixture-'+String(++revision),generation:'1',sourceRevision:String(revision),coverage:'complete',buildMs:1},summary:{tasks:String(tasks.length),metrics,durations:{state:'complete',samples:String(sourceStats?.durations.samples??(tasks[0]?.wallMs===null?0:1)),p50Ms:sourceStats?.durations.p50Ms===null?null:String(sourceStats?.durations.p50Ms??tasks[0]?.wallMs??0),p95Ms:sourceStats?.durations.p95Ms===null?null:String(sourceStats?.durations.p95Ms??tasks[0]?.wallMs??0),maxMs:sourceStats?.durations.maxMs===null?null:String(sourceStats?.durations.maxMs??tasks[0]?.wallMs??0)},trend:(sourceStats?.trend??[]).map(row=>({...row,tasks:String(row.tasks),metrics:metric(hide(row.metrics))})),sources:(sourceStats?.sources??[]).map(({objects,...row})=>({...row,tasks:String(objects),metrics:metric(hide(row.metrics))}))}});
  }
  reports.set(reportId,clone({report,rows}));return Response.json(report);
 }) as typeof fetch;
 return {reports};
}
function taskDate(tasks:RuntimeTaskObservation[]){return tasks[0]?.createdAt??'2026-09-28T00:00:00.000Z';}
