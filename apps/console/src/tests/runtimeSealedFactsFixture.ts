// Formal sealed-facts API fixture: missing usage never creates token or cost subtotals.
import {CompleteRuntimeTaskSummarySchema,CompleteRuntimeAttemptSummarySchema,CompleteRuntimeAgentSchema,CompleteRuntimeProfileSchema,CompleteRuntimeContributionSchema,RuntimeCompleteReportSchema,runtimeCompleteReportContent,type RuntimeReportSection,type RuntimeCompleteReport} from '@crewstation/contracts';
import {runtimeStatisticsFixture} from './runtimeStatisticsFixture';
interface Row {section:RuntimeReportSection;parent:string|null;key:string;document:unknown}
export function runtimeSealedFactsFixture() {
 const f=runtimeStatisticsFixture(),delegate=globalThis.fetch,base=f.details[0]!,metrics={state:'not-ready' as const,gaps:['native-capture-incomplete']};
 const tasks=Array.from({length:201},(_,n)=>CompleteRuntimeTaskSummarySchema.parse({id:Bun.randomUUIDv7(),source:{kind:'business-task'},projectId:f.projectId,projectName:'Original Execution Project',serviceId:base.serviceId,name:'Sealed Task '+n,protocol:'v3',state:'closed',createdAt:f.from,closedAt:base.closedAt,traceId:null,attemptCount:'1',metrics,timing:{wallMs:'20000',range:{from:f.from,to:'2026-09-28T00:00:10.000Z'},intervals:{state:'complete',unknown:'0',cumulativeMs:'10000',activeUnionMs:'10000'}}}));
 const profileId=Bun.randomUUIDv7(),agentId=Bun.randomUUIDv7(),profileKey=JSON.stringify([profileId,7]),agentKey=JSON.stringify(['original-agent',profileId,7]);
 const attempts=tasks.map((task,n)=>CompleteRuntimeAttemptSummarySchema.parse({id:Bun.randomUUIDv7(),key:'original-attempt-'+n,taskId:task.id,executionId:Bun.randomUUIDv7(),agentId,profileId,profileRevision:7,profileName:'Original Compute',name:'Original Agent '+n,kind:'agent',state:'succeeded',attempt:1,createdAt:f.from,startedAt:f.from,endedAt:'2026-09-28T00:00:10.000Z',metrics,durationMs:'10000',open:false}));
 const stored=new Map<string,{report:RuntimeCompleteReport;rows:Row[]}>(),reads:{section:string;parent:string|null;count:number;after:string|null}[]=[],controls={failedPage:false,brokenSnapshot:false};let revision=0;
 function build(project:boolean,taskId?:string) {
  const selected=taskId?tasks.filter(task=>task.id===taskId):tasks,reportId=Bun.randomUUIDv7(),rows:Row[]=[],append=(section:RuntimeReportSection,parent:string|null,key:string,document:unknown)=>rows.push({section,parent,key,document});
  for(const task of selected){append('tasks',null,task.id,task);const attempt=attempts[tasks.indexOf(task)]!;for(const section of ['attempts','swimlane'] as const)append(section,task.id,attempt.key,attempt);}
  if(!taskId){
   append('agents',null,agentKey,CompleteRuntimeAgentSchema.parse({key:agentKey,profileId,profileRevision:7,profileName:'Original Compute',projectId:f.projectId,projectName:'Original Execution Project',agentId,name:'Original Agent',kind:'agent',sourceKind:'business-task',tasks:'201',metrics}));
   append('profiles',null,profileKey,CompleteRuntimeProfileSchema.parse({key:profileKey,profileId,profileRevision:7,profileName:'Original Compute',tasks:'201',metrics}));
   append('projects',null,f.projectId,{projectId:f.projectId,projectName:'Original Execution Project',tasks:'201',metrics});
   for(const task of selected){const contribution=CompleteRuntimeContributionSchema.parse({taskId:task.id,taskName:task.name,projectId:f.projectId,projectName:'Original Execution Project',sourceKind:'business-task',attempts:'1',metrics});append('agent-tasks',agentKey,task.id,contribution);append('profile-tasks',profileKey,task.id,contribution);}
   const document={taskId:tasks[0]!.id,taskName:tasks[0]!.name,projectId:f.projectId,projectName:'Original Execution Project',reason:'native-capture-incomplete'};append('quality',null,JSON.stringify([document.reason,document.taskId]),document);append('quality',document.reason,document.taskId,document);
  }
  const report=RuntimeCompleteReportSchema.parse({reportId,state:'not-ready',gaps:[{source:'original-fixture',reason:'native-capture-incomplete'}],facts:{header:{reportId,projectionVersion:2,scope:project?'project':'system',projectId:project?f.projectId:null,filters:{from:f.from,to:f.to,timezone:'Asia/Shanghai'},asOf:f.to,snapshotId:'original-facts-'+String(++revision),generation:'1',sourceRevision:String(revision),coverage:'complete-facts',buildMs:1,...(taskId?{taskId}:{})},summary:{tasks:String(selected.length),metrics,durations:{state:'complete',samples:String(selected.length),p50Ms:'20000',p95Ms:'20000',maxMs:'20000'},trend:taskId?[]:[{from:f.from,to:f.to,tasks:'201',metrics}],sources:[{kind:'business-task',tasks:String(selected.length),metrics,collectionState:'available'},{kind:'development-agent',tasks:'0',metrics,collectionState:'production-disabled'}]}}});
  stored.set(reportId,{report,rows});return report;
 }
 globalThis.fetch=(async(raw,init)=>{
  const url=new URL(String(raw),'http://localhost');if(!url.pathname.includes('/observability/'))return delegate(raw,init);
  if((init?.method??'GET')!=='GET')throw new Error('Unexpected observation mutation');
  const route=url.pathname.match(/\/reports\/([^/]+)(\/pages)?$/);
  if(route){const value=stored.get(route[1]!);if(!value)return Response.json({error:'not_found',message:'Original report missing',details:{}},{status:404});if(!route[2])return Response.json(value.report);
   const section=url.searchParams.get('section')!,parent=url.searchParams.get('parent'),rowKey=url.searchParams.get('rowKey'),after=url.searchParams.get('after'),size=Number(url.searchParams.get('pageSize')??100);
   if(['models','calls','captures'].includes(section))throw new Error('Incomplete native usage must not request numeric sections');
   if(controls.failedPage&&section==='tasks'&&after!==null)return Response.json({error:'precondition',message:'Original retained report population missing',details:{}},{status:412});
   const rows=value.rows.filter(row=>row.section===section&&row.parent===parent&&(!rowKey||row.key===rowKey)),start=after===null?0:Number(after),page=rows.slice(start,start+size),content=runtimeCompleteReportContent(value.report)!;reads.push({section,parent,count:page.length,after});
   return Response.json({reportId:route[1],snapshotId:controls.brokenSnapshot?'different-original-snapshot':content.header.snapshotId,section,parent,total:String(rows.length),items:page.map(row=>row.document),nextCursor:start+page.length<rows.length?String(start+page.length):null});
  }
  if(url.pathname.endsWith('/statistics')||url.pathname.includes('/tasks/'))return Response.json(build(url.pathname.startsWith('/v1/projects/'),url.pathname.split('/tasks/')[1]));
  return delegate(raw,init);
 }) as typeof fetch;
 return {...f,tasks,attempts,reads,controls,stored,agentKey,profileKey};
}
