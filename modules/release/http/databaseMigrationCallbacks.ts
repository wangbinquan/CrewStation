import { isPlatformError } from '@crewstation/kernel';
import type { AppEnv } from '@crewstation/http';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import type { MigrationCallback } from '../application/database-migration/callbacks';
export function databaseMigrationCallbackRoutes(callback:(request:MigrationCallback)=>Promise<unknown>){
 const r=new Hono<AppEnv>(),base='/internal/database-migrations/:jobId/:token/v1/operations/:operationId';
 r.use(base+'/*',bodyLimit({maxSize:32*1024*1024,onError:c=>c.json({error:'validation',message:'迁移回调请求超过 32 MiB',details:{}},413)}));
 r.onError((error,c)=>{
  const invalid=error instanceof ZodError||error instanceof SyntaxError;
  const kind=isPlatformError(error)?error.kind:invalid?'validation':'unavailable';
  const status=kind==='forbidden'?403:kind==='not_found'?404:kind==='validation'?400:kind==='conflict'||kind==='precondition'?409:503;
  if(status===503)c.header('retry-after','3');
  return c.json({error:isPlatformError(error)?String(error.details['code']??error.kind):kind,message:isPlatformError(error)?error.message:invalid?'回调请求格式不合法':'回调暂不可用',details:isPlatformError(error)?error.details:{}},status);
 });
 for(const [method,action] of [['POST','artifacts'],['GET','artifacts'],['POST','freeze/verify'],['POST','prepared'],['GET','activation'],['POST','rollback'],['GET','backup']] as const){
  r.on(method,base+'/'+action,async c=>{
   const result=await callback({jobId:c.req.param('jobId')!,token:c.req.param('token')!,operationId:c.req.param('operationId')!,method,action,input:method==='POST'?await c.req.json():c.req.query()});
   return c.json(result??null);
  });
 }
 return r;
}
