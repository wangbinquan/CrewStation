import type { UserId } from '@crewstation/contracts';
import { ApproveDatabaseMigrationSchema,ReplanDatabaseMigrationSchema,OpenDatabaseMigrationSchema,RollbackDatabaseMigrationSchema,AbandonDatabaseMigrationSchema,CreateDatabaseMigrationSchema,RetryDatabaseMigrationSchema,SwitchDatabaseMigrationSchema,ServiceIdSchema,ResourceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import {parseBody,parseParams,requireUser} from '@crewstation/http';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import type {ReleaseModuleApi} from '../api/moduleApi';
export function databaseMigrationRoutes(api:ReleaseModuleApi,isAdmin:(id:UserId)=>Promise<boolean>){
  const r=new Hono<AppEnv>();
  const actor=async(c:Context<AppEnv>)=>{const userId=requireUser(c).userId as UserId;return {userId,isAdmin:await isAdmin(userId)};};
  const service=(c:Context<AppEnv>)=>parseParams(c,z.object({serviceId:ServiceIdSchema})).serviceId;
  const ids=(c:Context<AppEnv>)=>parseParams(c,z.object({serviceId:ServiceIdSchema,id:ResourceIdSchema}));
  r.get('/v1/services/:serviceId/database-migrations',async c=>c.json(await api.listDatabaseMigrations(await actor(c),service(c))));
  r.post('/v1/services/:serviceId/database-migrations',async c=>c.json(await api.createDatabaseMigration(await actor(c),service(c),await parseBody(c,CreateDatabaseMigrationSchema)),202));
  r.get('/v1/services/:serviceId/database-migrations/:id',async c=>{const p=ids(c);return c.json(await api.getDatabaseMigration(await actor(c),p.serviceId,p.id));});
  r.post('/v1/services/:serviceId/database-migrations/:id/retry',async c=>{const p=ids(c);return c.json(await api.retryDatabaseMigration(await actor(c),p.serviceId,p.id,await parseBody(c,RetryDatabaseMigrationSchema)),202);});
  r.post('/v1/services/:serviceId/database-migrations/:id/switch',async c=>{const p=ids(c);return c.json(await api.switchDatabaseMigration(await actor(c),p.serviceId,p.id,await parseBody(c,SwitchDatabaseMigrationSchema)),202);});
  r.post('/v1/services/:serviceId/database-migrations/:id/abandon',async c=>{const p=ids(c);return c.json(await api.abandonDatabaseMigration(await actor(c),p.serviceId,p.id,await parseBody(c,AbandonDatabaseMigrationSchema)));});
  r.get('/v1/services/:serviceId/database-migrations/:id/plan',async c=>{const p=ids(c);return c.json({markdown:await api.databaseMigrationPlanMarkdown(await actor(c),p.serviceId,p.id)});});
  r.post('/v1/services/:serviceId/database-migrations/:id/replan',async c=>{const p=ids(c);return c.json(await api.replanDatabaseMigration(await actor(c),p.serviceId,p.id,await parseBody(c,ReplanDatabaseMigrationSchema)),202);});
  r.post('/v1/services/:serviceId/database-migrations/:id/approve',async c=>{const p=ids(c);return c.json(await api.approveDatabaseMigration(await actor(c),p.serviceId,p.id,await parseBody(c,ApproveDatabaseMigrationSchema)),202);});
  r.post('/v1/services/:serviceId/database-migrations/:id/open',async c=>{const p=ids(c);return c.json(await api.openDatabaseMigration(await actor(c),p.serviceId,p.id,await parseBody(c,OpenDatabaseMigrationSchema)),202);});
  r.post('/v1/services/:serviceId/database-migrations/:id/rollback',async c=>{const p=ids(c);return c.json(await api.rollbackDatabaseMigration(await actor(c),p.serviceId,p.id,await parseBody(c,RollbackDatabaseMigrationSchema)),202);});
  return r;
}
