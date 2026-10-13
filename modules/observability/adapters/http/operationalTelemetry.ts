import {retentionDuration} from '../../domain/runtime/retentionDuration';
import type {OperationalMetricSeries,OperationalMetricSource} from '../../ports/operationalTelemetry';
/** Complete series/point arrays are retained. Six-hour transport packets share one caller window. */
export function prometheusOperationalSource(url:string,token:string,fetcher:(url:URL,init:RequestInit)=>Promise<Response>=(url,init)=>fetch(url,init),now:()=>number=Date.now):OperationalMetricSource {
 let retention:{duration:number;checked:number}|undefined,availableFrom:string|undefined;
 return {availableFrom:()=>availableFrom,async read(query,namespace,projectSlug) {
  if(!url)throw new Error('Operational history is not configured');
  if(!retention||now()-retention.checked>=60000){const target=new URL('/api/v1/status/flags',url),response=await fetcher(target,{headers:{authorization:`Basic ${Buffer.from(`crewstation:${token}`).toString('base64')}`},signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Original Prometheus retention unavailable');const data=await response.json() as {status?:string;data?:Record<string,unknown>},duration=retentionDuration(data.data?.['storage.tsdb.retention.time']);if(data.status!=='success'||duration===undefined)throw Error('Original Prometheus retention is unknown');retention={duration,checked:now()};}
  const earliest=now()-retention.duration;availableFrom=new Date(earliest).toISOString();
  const selectors=namespace?`{__name__=~"traefik_service_requests_total|traefik_service_request_duration_seconds_bucket",service=~${JSON.stringify(namespace+'-.*')}}${projectSlug?' or {__name__=~"cs_http_requests_total|cs_http_duration_milliseconds_bucket",project_slug='+JSON.stringify(projectSlug)+'}':''}`:'{__name__=~"cs_http_requests_total|cs_http_duration_milliseconds_bucket|cs_sse_(opened|closed|cancelled)_total|cs_sse_active|cs_application_metric|cs_application_source_available|traefik_service_requests_total|traefik_service_request_duration_seconds_bucket"}';
  const rows=new Map<string,{labels:Record<string,string>;points:Map<number,string>}>(),from=Math.max(Date.parse(query.from),earliest)/1000,to=Date.parse(query.to)/1000;
  for(let start=from;start<to;start+=21600) {
   const target=new URL('/api/v1/query_range',url);target.search=new URLSearchParams({query:selectors,start:String(start),end:String(Math.min(to,start+21600)),step:'15',timeout:'8s'}).toString();
   const response=await fetcher(target,{headers:{authorization:`Basic ${Buffer.from(`crewstation:${token}`).toString('base64')}`},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error(`Operational history HTTP ${response.status}`);
   const body=await response.json() as {status?:string;data?:{resultType?:string;result?:unknown[]}};
   if(body.status!=='success'||body.data?.resultType!=='matrix'||!Array.isArray(body.data.result))throw new Error('Invalid operational history');
   for(const raw of body.data.result) {
    const item=raw as {metric?:Record<string,unknown>;values?:unknown[]};if(!item.metric||!Array.isArray(item.values)||Object.values(item.metric).some(v=>typeof v!=='string'))throw new Error('Invalid operational series');
    const labels=item.metric as Record<string,string>,key=JSON.stringify(Object.entries(labels).sort(([a],[b])=>a.localeCompare(b))),row=rows.get(key)??{labels,points:new Map<number,string>()};
    for(const value of item.values){if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='number'||typeof value[1]!=='string'||value[0]<start||value[0]>Math.min(to,start+21600))throw new Error('Invalid operational point');const previous=row.points.get(value[0]);if(previous!==undefined&&previous!==value[1])throw new Error('Operational original point changed');row.points.set(value[0],value[1]);}
    rows.set(key,row);
   }
  }
  return [...rows.values()].map(row=>({labels:row.labels,values:[...row.points].sort(([a],[b])=>a-b)})) satisfies OperationalMetricSeries[];
 }};
}
