// RFC-034: full mergeable distributions, exact counter population and independent stream lifecycle.
import {expect,test} from 'bun:test';
import {Hono} from 'hono';
import {createRuntimeHttpMetrics} from './runtimeMetrics';
import {installRuntimeTelemetry} from './runtimeTelemetry';
import type {AppEnv} from './identity';
test('every request contributes once to cumulative buckets, including failures and long tail latency',()=>{
 const metrics=createRuntimeHttpMetrics('cs-api',1000);for(let n=0;n<10001;n++)metrics.observe('GET','/v1/projects/:projectId',n===10000?500:200,n===10000?90000:10);
 const text=metrics.render();expect(text).toContain('route="/v1/projects/:projectId",code="200"} 10000');
 expect(text).toContain('code="200",le="10"} 10000');expect(text).toContain('code="500",le="+Inf"} 1');expect(text).toContain('cs_process_start_time_seconds{component="cs-api"} 1');
 expect(()=>metrics.observe('GET','/',200,-1)).toThrow();
});
test('source stream closure is idempotent and does not become a long HTTP request',()=>{
 const metrics=createRuntimeHttpMetrics('cs-session');const a=metrics.stream(),b=metrics.stream();a();a(true);b(true);const text=metrics.render();
 expect(text).toContain('cs_sse_opened_total{component="cs-session"} 2');expect(text).toContain('cs_sse_closed_total{component="cs-session"} 2');expect(text).toContain('cs_sse_cancelled_total{component="cs-session"} 1');expect(text).toContain('cs_sse_active{component="cs-session"} 0');expect(text).not.toContain('cs_http_duration_milliseconds_count{');
});
test('formal route templates replace concrete values and scrapes do not count themselves',async()=>{
 const app=new Hono<AppEnv>();let signalReads=0;installRuntimeTelemetry(app,'cs-api','fixture',async component=>{signalReads++;expect(component).toBe('cs-api');return 'controlled_application_metric 7\n';});app.get('/v1/projects/:projectId',c=>c.json({ok:true}));
 await app.request('/v1/projects/one');await app.request('/v1/projects/two');
 expect((await app.request('/internal/runtime/metrics')).status).toBe(401);
 const read=async()=> (await app.request('/internal/runtime/metrics',{headers:{authorization:'Bearer fixture'}})).text();
 const first=await read(),second=await read();expect(second).toBe(first);expect(first).toContain('route="/v1/projects/:projectId"');expect(first).not.toContain('route="/v1/projects/one"');expect(first).toContain('code="200"} 2');expect(first).toContain('controlled_application_metric 7');expect(signalReads).toBe(2);
});
