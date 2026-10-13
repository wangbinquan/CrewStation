/** RFC-034: mergeable HTTP counters and latency buckets; URL values never become metric labels. */
export const HTTP_DURATION_BUCKETS = [1,5,10,25,50,100,250,500,1000,2500,5000,10000,30000,60000] as const;
const escape = (value:string) => value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n');
interface Metric {count:bigint;sum:number;buckets:bigint[]}
export function createRuntimeHttpMetrics(component:string,startedAt=Date.now()) {
 const rows=new Map<string,{method:string;route:string;code:string;context?:{plannedMaintenanceRefusal:true;projectSlug?:string};metric:Metric}>();
 const streams={opened:0n,closed:0n,cancelled:0n,active:0n};
 return {
  observe(method:string,route:string,code:number,durationMs:number,context?:{plannedMaintenanceRefusal:true;projectSlug?:string}) {
   if(!Number.isFinite(durationMs)||durationMs<0)throw new RangeError('HTTP duration is invalid');
   const labels={method:method.toUpperCase(),route:route||'unmatched',code:String(code)},key=JSON.stringify([labels,context]);
   let row=rows.get(key);if(!row){row={...labels,...(context?{context}:{}),metric:{count:0n,sum:0,buckets:HTTP_DURATION_BUCKETS.map(()=>0n)}};rows.set(key,row);}
   row.metric.count++;row.metric.sum+=durationMs;
   HTTP_DURATION_BUCKETS.forEach((bound,index)=>{if(durationMs<=bound)row!.metric.buckets[index]=row!.metric.buckets[index]!+1n;});
  },
  stream() {streams.opened++;streams.active++;let done=false;return (cancelled=false)=>{if(done)return;done=true;streams.active--;streams.closed++;if(cancelled)streams.cancelled++;};},
  render() {
   const lines=['# TYPE cs_http_requests_total counter','# TYPE cs_http_duration_milliseconds histogram'];
   const base=`component="${escape(component)}"`;
   for(const row of rows.values()) {
    const labels=`${base},method="${escape(row.method)}",route="${escape(row.route)}",code="${escape(row.code)}"${row.context?`,disposition="planned-maintenance",project_slug="${escape(row.context.projectSlug??'')}"`: ''}`;
    lines.push(`cs_http_requests_total{${labels}} ${row.metric.count}`);
    HTTP_DURATION_BUCKETS.forEach((bound,index)=>lines.push(`cs_http_duration_milliseconds_bucket{${labels},le="${bound}"} ${row.metric.buckets[index]}`));
    lines.push(`cs_http_duration_milliseconds_bucket{${labels},le="+Inf"} ${row.metric.count}`,`cs_http_duration_milliseconds_count{${labels}} ${row.metric.count}`,`cs_http_duration_milliseconds_sum{${labels}} ${row.metric.sum}`);
   }
   for(const kind of ['opened','closed','cancelled'] as const)lines.push(`# TYPE cs_sse_${kind}_total counter`,`cs_sse_${kind}_total{${base}} ${streams[kind]}`);
   lines.push('# TYPE cs_sse_active gauge',`cs_sse_active{${base}} ${streams.active}`,'# TYPE cs_process_start_time_seconds gauge',`cs_process_start_time_seconds{${base}} ${startedAt/1000}`);
   return lines.join('\n')+'\n';
  },
 };
}
