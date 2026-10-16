import type { UserId } from '@crewstation/contracts';
import { AbandonDatabaseRestoreSchema,CreateDatabaseRestoreSchema,RetryDatabaseRestoreSchema,SwitchDatabaseRestoreSchema,ServiceIdSchema,ResourceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import {parseBody,parseParams,requireUser} from '@crewstation/http';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import type {ReleaseModuleApi} from '../api/moduleApi';
export function databaseRestoreRoutes(api:ReleaseModuleApi,isAdmin:(id:UserId)=>Promise<boolean>){
  const r=new Hono<AppEnv>();
  const actor=async(c:Context<AppEnv>)=>{const userId=requireUser(c).userId as UserId;return {userId,isAdmin:await isAdmin(userId)};};
  const service=(c:Context<AppEnv>)=>parseParams(c,z.object({serviceId:ServiceIdSchema})).serviceId;
  const ids=(c:Context<AppEnv>)=>parseParams(c,z.object({serviceId:ServiceIdSchema,id:ResourceIdSchema}));
  r.get('/v1/services/:serviceId/database-generations',async c=>c.json(await api.databaseGenerations(await actor(c),service(c))));
  r.get('/v1/services/:serviceId/database-restores',async c=>c.json(await api.listDatabaseRestores(await actor(c),service(c))));
  r.post('/v1/services/:serviceId/database-restores',async c=>c.json(await api.createDatabaseRestore(await actor(c),service(c),await parseBody(c,CreateDatabaseRestoreSchema)),202));
  r.get('/v1/services/:serviceId/database-restores/:id',async c=>{const p=ids(c);return c.json(await api.getDatabaseRestore(await actor(c),p.serviceId,p.id));});
  r.post('/v1/services/:serviceId/database-restores/:id/retry',async c=>{const p=ids(c);return c.json(await api.retryDatabaseRestore(await actor(c),p.serviceId,p.id,await parseBody(c,RetryDatabaseRestoreSchema)),202);});
  r.post('/v1/services/:serviceId/database-restores/:id/switch',async c=>{const p=ids(c);return c.json(await api.switchDatabaseRestore(await actor(c),p.serviceId,p.id,await parseBody(c,SwitchDatabaseRestoreSchema)),202);});
  r.post('/v1/services/:serviceId/database-restores/:id/abandon',async c=>{const p=ids(c);return c.json(await api.abandonDatabaseRestore(await actor(c),p.serviceId,p.id,await parseBody(c,AbandonDatabaseRestoreSchema)));});
  return r;
}
