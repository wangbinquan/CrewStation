import {installRuntimeCompleteFixture} from './runtimeCompleteFixture';
import type { RuntimeTaskObservation, RuntimeUsageMetrics, RuntimeTaskSummary } from '@crewstation/contracts';
import { RuntimeTaskObservationSchema, SystemRuntimeStatisticsSchema, ProjectRuntimeStatisticsSchema, UsageNativeCaptureSchema } from '@crewstation/contracts';
import { runtimeStatisticsFixture } from './runtimeStatisticsFixture';
const hide = <T,>(value: T): T => JSON.parse(JSON.stringify(value), (key, item) => key === 'cost' ? { ...item, visible:false,complete:false,amount:null } : item) as T;
function total(rows: RuntimeUsageMetrics[]): RuntimeUsageMetrics {
  const first = rows[0]!;
  const bucket = (key: 'input'|'output'|'cacheRead'|'cacheWrite'|'total') => rows.reduce((n,r) => n+BigInt(r.tokens[key]),0n).toString();
  const picos = rows.reduce((n,r) => { const [whole='0',tail='']=(r.cost.amount ?? '0').split('.'); return n+BigInt(whole)*1000000000000n+BigInt(tail.padEnd(12,'0')); },0n);
  const amount = `${picos/1000000000000n}.${(picos%1000000000000n).toString().padStart(12,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
  return { ...first, tokens:{ ...first.tokens,input:bucket('input'),output:bucket('output'),cacheRead:bucket('cacheRead'),cacheWrite:bucket('cacheWrite'),total:bucket('total'),hasKnown:rows.length>0,complete:rows.length>0 },
    cost:{ ...first.cost,amount:rows.length ? amount : null },executions:rows.length,observedExecutions:rows.length,records:rows.reduce((n,r)=>n+r.records,0) };
}
function developmentRows(base: RuntimeTaskObservation, options: { differentCompute?: boolean; zero?: boolean }): RuntimeTaskObservation[] {
  const workspaceId=Bun.randomUUIDv7(),profileId=Bun.randomUUIDv7();
  return ['9007199254740993','7'].map((value, n) => {
    const id=Bun.randomUUIDv7(),agentId=Bun.randomUUIDv7(),identity={sourceKind:'development-agent',projectId:base.projectId,taskId:workspaceId,agentId,executionId:id,executionGeneration:1};
    const input=options.zero?'0':value;
    const metrics={...base.metrics,tokens:{...base.metrics.tokens,input,output:'0',total:input},records:options.zero?0:base.metrics.records,cost:{...base.metrics.cost,amount:options.zero?'0':input==='7' ? '0.000014' : '18014398509.481986'},reasons:['timing-missing']};
    const captures=options.zero?[UsageNativeCaptureSchema.parse({id:'zero-'+id,identity,sourceId:'zero-proof',state:'complete',issues:[],receivedSteps:0,receivedBaselineSteps:0,unresolvedBaselineSteps:0,revisedBaselineSteps:0,historicalRevisionGap:false,proof:{contract:'opencode-child-steps-v1',lineageKey:'actual-zero-lineage',turn:'zero',turnIndex:0,state:'complete',observedAt:base.createdAt,root:'zero-root',baseline:{kind:'fresh',fingerprint:null},fingerprint:'complete-zero',sessions:1,steps:0,emitted:0,baselineSteps:0,priorRevisionGap:false,issues:[]}})]:[];
    return RuntimeTaskObservationSchema.parse({...base,id,name:agentId,protocol:'development',source:{kind:'development-agent',identity,workspaceName:null},closedAt:null,wallMs:null,cumulativeMs:0,activeUnionMs:0,unknownIntervals:1,metrics,
      attempts:[{...base.attempts[0]!,id:agentId,taskId:workspaceId,executionId:id,agentId,name:agentId,startedAt:null,endedAt:null,durationMs:null,open:false,metrics,nativeCaptures:captures,profileId:options.differentCompute&&n?Bun.randomUUIDv7():profileId,profileName:options.differentCompute?(n?'Accepted Compute B':'Accepted Compute A'):'Accepted Dev Compute',profileRevision:options.differentCompute&&n?8:7}]});
  });
}
function groupedProfiles(details: RuntimeTaskObservation[]) {
  const groups=new Map<string,RuntimeTaskObservation[]>();
  for(const task of details) { const a=task.attempts[0]!,key=JSON.stringify([a.profileId,a.profileRevision]);const rows=groups.get(key)??[];rows.push(task);groups.set(key,rows); }
  return [...groups].map(([key,rows])=>({key,profileId:rows[0]!.attempts[0]!.profileId,profileName:rows[0]!.attempts[0]!.profileName,profileRevision:rows[0]!.attempts[0]!.profileRevision,metrics:total(rows.map(r=>r.metrics)),tasks:rows.map(r=>({taskId:r.id,metrics:r.metrics,attempts:1}))}));
}
/** HTTP-shape fixture only: it neither launches a model nor claims production collection. */
export function runtimeSourceStatisticsFixture(options: { development?: boolean; differentCompute?: boolean; zero?: boolean; multiProfileBusiness?: boolean } = {}) {
  const f=runtimeStatisticsFixture(),delegate=globalThis.fetch,details=[...f.details.slice(0,2),...(options.development===false?[]:developmentRows(f.details[0]!,options))];
  if (options.multiProfileBusiness) {
    const business=details[0]!,first=business.attempts[0]!;
    business.attempts=[{...first,profileName:'Accepted Business A',profileRevision:7},{...first,id:Bun.randomUUIDv7() as typeof first.id,executionId:Bun.randomUUIDv7() as typeof first.executionId,profileId:Bun.randomUUIDv7() as typeof first.profileId,profileName:'Accepted Business B',profileRevision:8}];
    business.attemptCount=2;
  }
  const summaries=details.map(({attempts:_a,scope:_s,asOf:_at,partial:_p,...r})=>({...r,acceptedProfiles:details.find(d=>d.id===r.id)!.attempts.filter(a=>a.kind==='agent').map(a=>({profileId:a.profileId,profileName:a.profileName,profileRevision:a.profileRevision}))}));
  globalThis.fetch=(async(raw,init)=>{
    const url=new URL(String(raw),'http://localhost'); if(!url.pathname.includes('/observability/')) return delegate(raw,init);
    f.reads.push(url.pathname+url.search);if((init?.method??'GET')!=='GET') throw new Error('Read-only source fixture');
    const project=url.pathname.startsWith('/v1/projects/'),id=url.pathname.split('/tasks/')[1];
    if(id){const row=details.find(r=>r.id===id);return row?Response.json(project?hide({...row,scope:'project'}):row):Response.json({error:'not_found',message:'missing',details:{}},{status:404});}
    if(f.state.error)return Response.json({error:'unavailable',message:'Source temporarily unavailable',details:{}},{status:503});
    const kind=url.searchParams.get('sourceKind'),q=url.searchParams.get('q'),selected=summaries.filter(r=>(!kind||(r.source?.kind??'business-task')===kind)&&(!q||`${r.name} ${r.id} ${r.projectName} ${r.projectId}`.toLowerCase().includes(q.toLowerCase())));
    const picked=details.filter(r=>selected.some(x=>x.id===r.id)),metrics=total(picked.length?picked.map(r=>r.metrics):[f.metrics]);if(!picked.length)metrics.tokens.hasKnown=false;
    const data=SystemRuntimeStatisticsSchema.parse({...f.data,sourceScope:'project-executions',filters:{...f.data.filters,...(kind?{sourceKind:kind}:{})},tasks:selected,metrics,
      profiles:groupedProfiles(picked),projects:[{projectId:f.projectId,projectName:details[0]!.projectName,tasks:selected.length,metrics}],
      agents:picked.map(r=>{const a=r.attempts[0]!;return {key:a.agentId!,sourceKind:r.source?.kind??'business-task',projectId:r.projectId,projectName:r.projectName,agentId:a.agentId,profileId:a.profileId,profileName:a.profileName,profileRevision:a.profileRevision,kind:'agent',name:a.name,metrics:r.metrics,tasks:[{taskId:r.id,metrics:r.metrics,attempts:1}]};}),
      sources:(['business-task','development-agent'] as const).map(source=>{const rows=picked.filter(r=>(r.source?.kind??'business-task')===source);const m=total(rows.length?rows.map(r=>r.metrics):[f.metrics]);if(!rows.length){m.tokens={...m.tokens,input:'0',output:'0',total:'0',hasKnown:false,complete:false};m.cost={...m.cost,amount:null,complete:false};m.executions=0;m.observedExecutions=0;m.records=0;}return {kind:source,objects:rows.length,metrics:m,collectionState:source==='development-agent'?'production-disabled':'available'};}),
      trend:f.data.trend.map((r,n)=>({...r,tasks:n===0?picked.length:0,metrics:n===0?metrics:r.metrics})),durations:{samples:picked.filter(r=>!r.source).length,p50Ms:20000,p95Ms:20000,maxMs:20000}});
    if(!project)return Response.json(data);const{models:_m,...common}=data;return Response.json(ProjectRuntimeStatisticsSchema.parse(hide({...common,scope:'project',projectId:f.projectId})));
  }) as typeof fetch;
  installRuntimeCompleteFixture(()=>details,f.reads);
  return {...f,details,summaries,development:details.filter(r=>r.source?.kind==='development-agent')};
}
export function sourceTaskButton(id:string){return document.querySelector<HTMLButtonElement>(`[data-runtime-task-id="${id}"] button`)!;}
export function sourceTaskSummary(task:RuntimeTaskSummary){return task.source?.kind??'business-task';}
