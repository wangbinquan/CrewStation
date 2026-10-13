// RFC-034: original status counters/reset segments and mergeable histogram buckets.
import {expect,test} from 'bun:test';
import {operationalTelemetryRows} from './operationalTelemetry';
import type {OperationalMetricSeries} from './operationalMetricSeries';
const query={from:'2026-10-12T00:00:00.000Z',to:'2026-10-12T00:01:00.000Z'},start=Date.parse(query.from)/1000;
const row=(name:string,values:readonly string[],labels:Record<string,string>={}):OperationalMetricSeries=>({labels:{__name__:name,component:'cs-api',route:'/v1/projects/:projectId',...labels},values:values.map((value,n)=>[start+n*15,value] as const)});
test('requests count every status and counter reset; errors and 429 remain distinct',()=>{
 const value=operationalTelemetryRows([row('cs_http_requests_total',['100','104','2','5'],{code:'200'}),row('cs_http_requests_total',['0','1','3','4'],{code:'429'}),row('cs_http_requests_total',['0','0','1','1'],{code:'500'})],query);
 expect(value.rows[0]).toMatchObject({requests:'14',errors4xx:'4',errors5xx:'1',limited:'4'});expect(value.gaps).toContain('sampling-boundary');
});
test('system latency merges original buckets instead of averaging service P95; overflow tail remains unknown',()=>{
 const samples=[row('cs_http_duration_milliseconds_bucket',['0','90'],{le:'10',instance:'a'}),row('cs_http_duration_milliseconds_bucket',['0','95'],{le:'100',instance:'a'}),row('cs_http_duration_milliseconds_bucket',['0','100'],{le:'+Inf',instance:'a'}),row('cs_http_duration_milliseconds_bucket',['0','0'],{le:'10',instance:'b'}),row('cs_http_duration_milliseconds_bucket',['0','5'],{le:'100',instance:'b'}),row('cs_http_duration_milliseconds_bucket',['0','5'],{le:'+Inf',instance:'b'})];
 const value=operationalTelemetryRows(samples,query);expect(value.rows[0]?.samples).toBe('105');expect(value.rows[0]?.p95UpperMs).toBe(100);
 const tail=operationalTelemetryRows([row('cs_http_duration_milliseconds_bucket',['0','100'],{le:'+Inf'})],query);expect(tail.rows[0]?.p95UpperMs).toBeNull();expect(tail.gaps).toContain('latency-upper-tail');
});
test('one sample, unrepresentable counters and stopped collection preserve distinct gaps',()=>{
 const value=operationalTelemetryRows([row('cs_http_requests_total',['9007199254740993']),row('cs_sse_opened_total',['7'])],{...query,to:'2026-10-12T01:00:00.000Z'});
 expect(value.gaps).toContain('counter-baseline-missing');expect(value.gaps).toContain('counter-precision-or-invalid');expect(value.gaps).toContain('source-stale');expect(value.rows[0]?.requests).toBe('0');
 expect(operationalTelemetryRows([],query).observedAt).toBeNull();
});

test('planned maintenance is an independent original request disposition; ordinary 4xx and 503 stay visible',()=>{const value=operationalTelemetryRows([row('cs_http_requests_total',['0','4'],{code:'403',disposition:'planned-maintenance',project_slug:'original'}),row('cs_http_requests_total',['0','3'],{code:'403'}),row('cs_http_requests_total',['0','2'],{code:'503'})],query);expect(value.rows.filter(r=>r.plannedMaintenance).reduce((n,r)=>n+BigInt(r.requests),0n)).toBe(4n);const regular=value.rows.filter(r=>!r.plannedMaintenance);expect(regular.reduce((n,r)=>n+BigInt(r.errors4xx),0n)).toBe(3n);expect(regular.reduce((n,r)=>n+BigInt(r.errors5xx),0n)).toBe(2n);});
