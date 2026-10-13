import {renderRuntimeSignals} from '@crewstation/kernel';
import type {Hono} from 'hono';
import type {AppEnv} from './identity';
import {createRuntimeHttpMetrics} from './runtimeMetrics';
/** Scraping cannot change ordinary request counters. SSE connect and close are separate from HTTP latency. */
export function installRuntimeTelemetry(app:Hono<AppEnv>,component:string,token:string|undefined,readSignals:typeof renderRuntimeSignals=renderRuntimeSignals) {
 const metrics=createRuntimeHttpMetrics(component);
 app.use('*',async(c,next)=>{
  if(c.req.path==='/internal/runtime/metrics')return next();
  const started=performance.now();
  try {await next();}finally {
   const route=c.req.routePath==='*'?'unmatched':c.req.routePath;
   if(c.res.headers.get('content-type')?.startsWith('text/event-stream')&&c.res.body) {
    const close=metrics.stream(),reader=c.res.body.getReader();
    const stream=new ReadableStream<Uint8Array>({
     async pull(controller) {try {const result=await reader.read();if(result.done){close();controller.close();}else controller.enqueue(result.value);}catch(error){close(true);controller.error(error);}},
     async cancel(reason) {close(true);await reader.cancel(reason);},
    });
    c.res=new Response(stream,{status:c.res.status,statusText:c.res.statusText,headers:c.res.headers});
   }else metrics.observe(c.req.method,route,c.res.status,performance.now()-started,c.get('runtimeMetricContext'));
  }
 });
 app.get('/internal/runtime/metrics',async c=>{
  if(!token||c.req.header('authorization')!==`Bearer ${token}`)return c.text('Metrics unavailable',401);
  return c.text(metrics.render()+await readSignals(component),200,{'content-type':'text/plain; version=0.0.4; charset=utf-8'});
 });
 return metrics;
}
