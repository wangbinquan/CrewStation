import type {AppEnv} from '@crewstation/http';
import {parseParams,parseQuery} from '@crewstation/http';
import {ObjectPageQuerySchema,ResourceIdSchema} from '@crewstation/contracts';
import {forbidden} from '@crewstation/kernel';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import type {ObjectServiceApi} from '../api/objectServiceApi';
import {objectDownloadResponse} from './objectDownloadResponse';
export function databaseRestoreObjectRoutes(api:ObjectServiceApi){
 const r=new Hono<AppEnv>(),base='/internal/database-restore-objects/:jobId';
 const caller=(c:Context<AppEnv>)=>{const {jobId}=parseParams(c,z.object({jobId:ResourceIdSchema})),auth=c.req.header('authorization');if(!auth?.startsWith('Bearer ')||auth.length>263)throw forbidden('缺少原恢复对象读取凭据');return {identity:'database-restore:'+jobId,token:auth.slice(7)};};
 const id=(c:Context<AppEnv>)=>parseParams(c,z.object({id:ResourceIdSchema})).id;
 r.get(base+'/space',async c=>c.json(await api.space(caller(c))));
 r.get(base,async c=>c.json(await api.list(caller(c),parseQuery(c,ObjectPageQuerySchema))));
 r.get(base+'/:id',async c=>c.json(await api.get(caller(c),id(c))));
 r.get(base+'/:id/content',async c=>objectDownloadResponse(await api.download(caller(c),id(c),{signal:c.req.raw.signal,...(c.req.header('range')?{range:c.req.header('range')}: {})})));
 return r;
}
