import {Hono,type Context} from 'hono';
import {z} from 'zod';
import {RuntimeStatisticsQuerySchema,RuntimeReportPageQuerySchema,ProjectIdSchema,ResourceIdSchema,type UserId,type RuntimeCompleteReport} from '@crewstation/contracts';
import {actorFrom,parseParams,parseQuery,type AppEnv} from '@crewstation/http';
import type {ObservabilityModuleApi} from '../api/moduleApi';
export function completeRuntimeReportRoutes(api:ObservabilityModuleApi,isAdmin:(id:UserId)=>Promise<boolean>):Hono<AppEnv> {
 const r=new Hono<AppEnv>(),actor=async(c:Context<AppEnv>)=>{const a=await actorFrom(c,id=>isAdmin(id as UserId));return {userId:a.userId as UserId,isAdmin:a.isAdmin};};
 const params=z.object({projectId:ProjectIdSchema,reportId:ResourceIdSchema});
 const reply=(c:Context<AppEnv>,report:RuntimeCompleteReport)=>c.json(report,report.state==='building'?202:200);
 r.get('/v1/projects/:projectId/observability/reports',async c=>reply(c,await api.runtimeCompleteReport(await actor(c),parseParams(c,z.object({projectId:ProjectIdSchema})).projectId,parseQuery(c,RuntimeStatisticsQuerySchema))));
 r.get('/v1/admin/observability/reports',async c=>reply(c,await api.runtimeCompleteReport(await actor(c),null,parseQuery(c,RuntimeStatisticsQuerySchema))));
 r.get('/v1/projects/:projectId/observability/reports/:reportId',async c=>{const p=parseParams(c,params);return reply(c,await api.runtimeCompleteReportStatus(await actor(c),p.projectId,p.reportId));});
 r.get('/v1/admin/observability/reports/:reportId',async c=>reply(c,await api.runtimeCompleteReportStatus(await actor(c),null,parseParams(c,z.object({reportId:ResourceIdSchema})).reportId)));
 r.get('/v1/projects/:projectId/observability/reports/:reportId/pages',async c=>{const p=parseParams(c,params);return c.json(await api.runtimeCompleteReportPage(await actor(c),p.projectId,p.reportId,parseQuery(c,RuntimeReportPageQuerySchema)));});
 r.get('/v1/admin/observability/reports/:reportId/pages',async c=>c.json(await api.runtimeCompleteReportPage(await actor(c),null,parseParams(c,z.object({reportId:ResourceIdSchema})).reportId,parseQuery(c,RuntimeReportPageQuerySchema))));
 return r;
}
