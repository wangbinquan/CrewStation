import {expect,test} from 'bun:test';
import {createApp} from '@crewstation/http';
import {forbidden} from '@crewstation/kernel';
import {databaseRestoreObjectRoutes} from './databaseRestoreObjectRoutes';
import type {ObjectServiceApi} from '../api/objectServiceApi';
test('database restore object routes expose only reads under the original job bearer identity',async()=>{
 const job=Bun.randomUUIDv7(),id=Bun.randomUUIDv7(),seen:unknown[]=[];
 const get=async(caller:{identity:string;token?:string})=>{if(caller.token!=='original')throw forbidden('wrong original token');seen.push(caller);return {id};};
 const api={space:get,list:get,get} as unknown as ObjectServiceApi,app=createApp({name:'restore-objects'});app.route('/',databaseRestoreObjectRoutes(api));
 const base='/internal/database-restore-objects/'+job;
 expect((await app.request(base+'/'+id)).status).toBe(403);
 expect((await app.request(base+'/'+id,{headers:{authorization:'Bearer wrong'}})).status).toBe(403);
 expect((await app.request(base+'/'+id,{headers:{authorization:'Bearer original'}})).status).toBe(200);
 expect(seen).toEqual([{identity:'database-restore:'+job,token:'original'}]);
 for(const method of ['POST','PUT','DELETE','PATCH'])expect((await app.request(base+'/'+id,{method,headers:{authorization:'Bearer original'}})).status).toBe(404);
 expect(seen).toHaveLength(1);
});
