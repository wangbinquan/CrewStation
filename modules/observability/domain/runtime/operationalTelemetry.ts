import type {OperationalTelemetry,OperationalTelemetryQuery} from '@crewstation/contracts';
import type {OperationalMetricSeries} from './operationalMetricSeries';
/** Counter deltas retain resets and gaps. Histograms merge original buckets, never project/day P95s. */
export function operationalTelemetryRows(series:readonly OperationalMetricSeries[],query:OperationalTelemetryQuery) {
 type Row=OperationalTelemetry['rows'][number];
 const groups=new Map<string,{row:Row;buckets:Map<number,bigint>;total:bigint}>(),gaps=new Set<string>();let observedAt:number|null=null;
 const counter=(points:OperationalMetricSeries['values'])=>{
  let previous:bigint|undefined,previousAt:number|undefined,value=0n;
  for(const [at,raw] of points) {
   const n=Number(raw);if(!Number.isSafeInteger(n)||n<0){gaps.add('counter-precision-or-invalid');previous=undefined;continue;}
   const current=BigInt(n);if(previous!==undefined){value+=current>=previous?current-previous:current;if(previousAt!==undefined&&at-previousAt>45)gaps.add('sampling-gap');}
   previous=current;previousAt=at;observedAt=Math.max(observedAt??at*1000,at*1000);
  }
  if(points.length<2)gaps.add('counter-baseline-missing');return value;
 };
 const gauges:NonNullable<OperationalTelemetry['gauges']>=[];
 for(const item of series) {
  const name=item.labels.__name__;if(name==='cs_application_metric'||name==='cs_application_source_available'){const l=item.labels,last=item.values.at(-1),key=JSON.stringify(Object.entries(l).sort(([a],[b])=>a.localeCompare(b))),valid=last&&Number.isFinite(Number(last[1]))&&Number(last[1])>=0,stale=last&&Date.parse(query.to)-last[0]*1000>45000;gauges.push({key,component:l.component??'unknown',source:l.source??'unknown',kind:l.kind??'source.available',unit:l.unit??'boolean',value:valid?last[1]:null,observedAt:last?new Date(last[0]*1000).toISOString():null,state:!valid?'invalid':stale?'stale':name==='cs_application_source_available'&&last[1]==='0'?'unavailable':'available',replica:l.pod??l.instance??null,dimensions:Object.fromEntries(Object.entries(l).filter(([key])=>['queue','state'].includes(key)))});if(last)observedAt=Math.max(observedAt??0,last[0]*1000);if(!valid||stale||name==='cs_application_source_available'&&last![1]==='0')gaps.add('application-source-unavailable');continue;}
 }
 for(const item of series){if(item.labels.__name__==='cs_application_metric'||item.labels.__name__==='cs_application_source_available')continue;
  const labels=item.labels,name=labels.__name__??'',component=labels.component??'gateway',route=labels.route??labels.router??labels.service??'all',service=labels.service??null;
  if(labels.role==='unknown'||labels.role==='transition-unknown')gaps.add('historical-role-unassigned');
  const key=JSON.stringify([component,route,service,labels.role,labels.release_id,labels.maintenance,labels.role_segment,labels.disposition]);let group=groups.get(key);
  if(!group){group={row:{key,component,route,physicalService:service,...(labels.disposition==='planned-maintenance'?{plannedMaintenance:true}:{}),...(labels.role?{role:labels.role,releaseId:labels.release_id==='unknown'?null:labels.release_id??null,releaseName:labels.release_name==='unknown'?null:labels.release_name??null,physicalSlot:labels.physical_slot??null,maintenance:labels.maintenance==='true'?true:labels.maintenance==='false'?false:null}:{}),requests:'0',errors4xx:'0',errors5xx:'0',limited:'0',p95UpperMs:null,samples:'0',streamOpened:'0',streamClosed:'0',streamCancelled:'0',activeStreams:null},buckets:new Map(),total:0n};groups.set(key,group);}
  const add=(field:'requests'|'errors4xx'|'errors5xx'|'limited'|'streamOpened'|'streamClosed'|'streamCancelled',value:bigint)=>{group!.row[field]=String(BigInt(group!.row[field])+value);};
  if(name==='cs_http_requests_total'||name==='traefik_service_requests_total') {
   const value=counter(item.values),code=labels.code??'';add('requests',value);if(code.startsWith('4'))add('errors4xx',value);if(code.startsWith('5'))add('errors5xx',value);if(code==='429')add('limited',value);
  }else if(name.endsWith('_bucket')) {
   const value=counter(item.values);if(labels.le==='+Inf')group.total+=value;else {const bound=Number(labels.le)*(name.startsWith('traefik')?1000:1);if(Number.isFinite(bound))group.buckets.set(bound,(group.buckets.get(bound)??0n)+value);else gaps.add('histogram-bound-invalid');}
  }else if(name==='cs_sse_active') {const last=item.values.at(-1);if(last&&Number.isFinite(Number(last[1]))){group.row.activeStreams=(group.row.activeStreams??0)+Number(last[1]);observedAt=Math.max(observedAt??0,last[0]*1000);}}
  else {const field=({cs_sse_opened_total:'streamOpened',cs_sse_closed_total:'streamClosed',cs_sse_cancelled_total:'streamCancelled'} as const)[name as 'cs_sse_opened_total'];if(field)add(field,counter(item.values));}
 }
 for(const group of groups.values()) {group.row.samples=String(group.total);if(group.total>0n){const target=(group.total*95n+99n)/100n;group.row.p95UpperMs=[...group.buckets].sort(([a],[b])=>a-b).find(([,n])=>n>=target)?.[0]??null;if(group.row.p95UpperMs===null)gaps.add('latency-upper-tail');}}
 // Scrapes are samples; the unobserved request prefix/tail is never advertised as exact coverage.
 if(groups.size)gaps.add('sampling-boundary');
 if(observedAt!==null&&Date.parse(query.to)-observedAt>45000)gaps.add('source-stale');
 return {gauges,rows:[...groups.values()].map(g=>g.row).sort((a,b)=>a.key.localeCompare(b.key)),gaps:[...gaps].sort(),observedAt:observedAt===null?null:new Date(observedAt).toISOString()};
}
