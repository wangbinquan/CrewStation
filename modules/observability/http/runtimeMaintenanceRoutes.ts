import {Hono,type Context} from 'hono';
import {actorFrom,parseBody,type AppEnv} from '@crewstation/http';
import {RuntimeMaintenanceRequestSchema,RuntimeMaintenanceConfirmSchema,ResourceIdSchema,type UserId} from '@crewstation/contracts';
import {forbidden} from '@crewstation/kernel';
import type {ObservabilityModuleApi} from '../api/moduleApi';
export function runtimeMaintenanceRoutes(api:ObservabilityModuleApi,isAdmin:(id:UserId)=>Promise<boolean>){
 const r=new Hono<AppEnv>(),actor=async(c:Context<AppEnv>)=>{const a=await actorFrom(c,id=>isAdmin(id as UserId));if(!a.isAdmin)throw forbidden();return {userId:a.userId as UserId,isAdmin:true};};
 r.post('/v1/admin/observability/maintenance/preview',async c=>c.json(await api.runtimeMaintenancePreview(await actor(c),await parseBody(c,RuntimeMaintenanceRequestSchema)),202));
 r.get('/v1/admin/observability/maintenance/:id',async c=>c.json(await api.runtimeMaintenanceStatus(await actor(c),ResourceIdSchema.parse(c.req.param('id')))));
 r.post('/v1/admin/observability/maintenance/:id/confirm',async c=>c.json(await api.runtimeMaintenanceConfirm(await actor(c),ResourceIdSchema.parse(c.req.param('id')),(await parseBody(c,RuntimeMaintenanceConfirmSchema)).expectedDigest)));
 return r;
}
