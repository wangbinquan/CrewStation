// Project/system readers use the public owner namespace, never a front-end project filter.
import {expect,test} from 'bun:test';
import {newResourceId} from '@crewstation/kernel';
import type {ProjectId,UserId,ServiceId} from '@crewstation/contracts';
import {operationalTelemetryQueries} from '../application/runtime/operationalTelemetry';
import {prometheusOperationalSource} from '../adapters/http/operationalTelemetry';
const id=newResourceId() as ProjectId,actor={userId:newResourceId() as UserId,isAdmin:false},query={from:'2026-10-12T00:00:00.000Z',to:'2026-10-12T00:01:00.000Z'};
test('project scope is authorized before source reading; administrator project view still reads only its namespace',async()=>{
 const calls:string[]=[],source={read:async(_q:unknown,namespace?:string)=>{calls.push(namespace??'system');return [];}};
 const read=operationalTelemetryQueries({source,authorizer:{authorize:async()=>{calls.push('authorize');}},services:{resolveServiceOfProject:async()=>({serviceId:newResourceId() as ServiceId,slug:'sample',name:'sample',namespace:'original-project'})}});
 for(const isAdmin of [false,true]){const result=await read({...actor,isAdmin},id,query);expect(result.scope).toBe('project');expect(result.state).toBe('no-samples');}
 expect(calls).toEqual(['authorize','original-project','authorize','original-project']);await expect(read(actor,null,query)).rejects.toMatchObject({kind:'forbidden'});expect(calls).toHaveLength(4);
});
test('unconfigured and failed collection never become a healthy zero',async()=>{
 const ports={authorizer:{authorize:async()=>{}},services:{resolveServiceOfProject:async()=>undefined}},admin={...actor,isAdmin:true};
 expect((await operationalTelemetryQueries(ports)(admin,null,query)).state).toBe('unavailable');
 expect((await operationalTelemetryQueries({...ports,source:{read:async()=>{throw Error('offline');}}})(admin,null,query)).state).toBe('error');
});
test('all original time packets and series survive; conflicting overlapping source points are rejected',async()=>{
 let calls=0;const from=Date.parse(query.from)/1000;
 const source=prometheusOperationalSource('http://history.test','fixture',async input=>{const originalUrl=new URL(String(input));if(originalUrl.pathname==='/api/v1/status/flags')return Response.json({status:'success',data:{'storage.tsdb.retention.time':'8d'}});calls++;const url=new URL(String(input)),start=Number(url.searchParams.get('start')),end=Number(url.searchParams.get('end'));expect(url.searchParams.get('query')).toContain('service=~"original-project-.*"');return Response.json({status:'success',data:{resultType:'matrix',result:Array.from({length:201},(_,n)=>({metric:{__name__:'traefik_service_requests_total',service:'original-project-'+n,code:'200'},values:[[start,String(start-from)],[end,String(end-from)]]}))}});},()=>Date.parse('2026-10-13T00:00:00.000Z'));
 const rows=await source.read({...query,to:'2026-10-13T00:00:00.000Z'},'original-project');expect(calls).toBe(4);expect(rows).toHaveLength(201);expect(rows.at(-1)?.values).toHaveLength(5);
});

test('conflicting overlap is a source error rather than double-counted counters',async()=>{let n=0;const source=prometheusOperationalSource('http://history.test','fixture',async url=>{const originalUrl=new URL(String(url));if(originalUrl.pathname==='/api/v1/status/flags')return Response.json({status:'success',data:{'storage.tsdb.retention.time':'8d'}});n++;const u=new URL(String(url)),at=Number(u.searchParams.get('start'));return Response.json({status:'success',data:{resultType:'matrix',result:[{metric:{__name__:'traefik_service_requests_total',service:'original-project-test',code:'200'},values:[[at,String(n)],[Number(u.searchParams.get('end')),'999']]}]}});},()=>Date.parse('2026-10-13T00:00:00.000Z'));await expect(source.read({...query,to:'2026-10-13T00:00:00.000Z'},'original-project')).rejects.toThrow();});

test('retention is the original upstream flag, clipping queries never relabels a 30-day request as fully sampled',async()=>{const now=Date.parse('2026-10-13T00:00:00.000Z'),starts:number[]=[],source=prometheusOperationalSource('http://history.test','fixture',async url=>{if(url.pathname==='/api/v1/status/flags')return Response.json({status:'success',data:{'storage.tsdb.retention.time':'8d'}});starts.push(Number(url.searchParams.get('start')));return Response.json({status:'success',data:{resultType:'matrix',result:[]}});},()=>now);await source.read({...query,from:'2026-09-13T00:00:00.000Z',to:'2026-10-13T00:00:00.000Z'});expect(source.availableFrom?.()).toBe('2026-10-05T00:00:00.000Z');expect(starts[0]).toBe(Date.parse('2026-10-05T00:00:00.000Z')/1000);expect(starts).toHaveLength(32);});
