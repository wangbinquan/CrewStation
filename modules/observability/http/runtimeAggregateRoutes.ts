import {precondition} from '@crewstation/kernel';
import {Hono,type Context} from 'hono';
import {streamSSE} from 'hono/streaming';
import {actorFrom,parseQuery,parseParams,type AppEnv} from '@crewstation/http';
import {ProjectIdSchema,RuntimeStatisticsQuerySchema,type ProjectId,type UserId} from '@crewstation/contracts';
import {z} from 'zod';
import type {ObservabilityModuleApi} from '../api/moduleApi';
export function runtimeAggregateRoutes(api:ObservabilityModuleApi,isAdmin:(id:UserId)=>Promise<boolean>){const r=new Hono<AppEnv>(),actor=async(c:Context<AppEnv>)=>{const a=await actorFrom(c,id=>isAdmin(id as UserId));return {userId:a.userId as UserId,isAdmin:a.isAdmin};},pid=(c:Context<AppEnv>)=>parseParams(c,z.object({projectId:ProjectIdSchema})).projectId as ProjectId;
 r.get('/v1/admin/observability/storage',async c=>{if(!api.runtimeStorage)throw precondition('观测存储状态尚未接入');return c.json(await api.runtimeStorage(await actor(c)));});
 r.get('/v1/admin/observability/anomalies',async c=>c.json(await api.runtimeAnomalies(await actor(c),null,parseQuery(c,RuntimeStatisticsQuerySchema),c.req.query('after'))));
 r.get('/v1/projects/:projectId/observability/anomalies',async c=>c.json(await api.runtimeAnomalies(await actor(c),pid(c),parseQuery(c,RuntimeStatisticsQuerySchema),c.req.query('after'))));
 r.get('/v1/admin/observability/aggregate',async c=>c.json(await api.runtimeAggregate(await actor(c),null,parseQuery(c,RuntimeStatisticsQuerySchema))));
 r.get('/v1/projects/:projectId/observability/aggregate',async c=>c.json(await api.runtimeAggregate(await actor(c),pid(c),parseQuery(c,RuntimeStatisticsQuerySchema))));
 const events=async(c:Context<AppEnv>,projectId:ProjectId|null)=>{const a=await actor(c);await api.runtimeProjectionState(a,projectId);return streamSSE(c,async stream=>{let previous:string|undefined,ended=false;stream.onAbort(()=>{ended=true;});while(!ended){const state=await api.runtimeProjectionState({...a,isAdmin:await isAdmin(a.userId)},projectId),value=JSON.stringify(state);if(value!==previous){await stream.writeSSE({event:'runtime-projection',data:value,id:state.generation+':'+state.revision});previous=value;}await stream.sleep(1000);}});};
 r.get('/v1/admin/observability/projection-stream',c=>events(c,null));r.get('/v1/projects/:projectId/observability/projection-stream',c=>events(c,pid(c)));return r;}
