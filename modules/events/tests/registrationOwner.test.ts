import { afterEach,describe,expect,test } from 'bun:test';
import { BUILTIN_RESOURCES,ManifestSchema } from '@crewstation/contracts';
import type { DomainPayload,ReleaseId,ServiceId } from '@crewstation/contracts';
import { systemClock } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { registerReleaseUseCase } from '../application/registerRelease';
import type { ServiceResolver } from '../ports/serviceResolver';
import { eventsDeletionFixture,type EventsDeletionFixture } from './projectDeletionFixture';

const available=await testDatabaseAvailable();let f:EventsDeletionFixture;
afterEach(async()=>{await f?.database.drop();});
function processor(resolve:ServiceResolver['resolveService']){
  return registerReleaseUseCase({uow:drizzleUnitOfWork(f.database.db,{jobMaxAttempts:8,assertAvailable:f.project.api.assertProjectAvailable}),clock:systemClock,
    services:{resolveService:resolve},projects:{isAdmin:f.project.api.isAdmin,authorize:f.project.api.authorize},
    endpoints:{resolve:async()=>undefined},pusher:{push:async()=>({ok:true})},hold:{holds:async()=>false},settings:{maxAttempts:3,pushTimeoutMs:1000}});
}
describe.skipIf(!available)('事件登记的原服务归属（真实 PG）',()=>{
  test('从未登记的删除中服务不能借另一个活跃项目登记；缺失或错误目录身份拒绝，真实匹配消费者仍可登记',async()=>{
    f=await eventsDeletionFixture();
    const make=(slug:string)=>f.project.api.createProject(f.admin,{slug,name:slug,kind:'DigitalWorker',template:BUILTIN_RESOURCES.minimalTemplate});
    const closing=await make('events-new-closing'),live=await make('events-new-live');
    const started=await f.begin(closing.id);expect((await f.events.api.deletionOwner!.run(started.context)).kind).toBe('done');
    const service={command:['app'],port:3000,servicePlanId:BUILTIN_RESOURCES.servicePlanSmall};
    const manifest=ManifestSchema.parse({apiVersion:'crewstation/v2',kind:'DigitalWorker',spec:{service,subscriptions:[{eventTypeId:f.ids.foreignType,handlerPath:'/valid-handler'}]}});
    const event:DomainPayload<'release.registered'>={projectId:live.id,serviceId:closing.serviceId!,releaseId:Bun.randomUUIDv7() as ReleaseId,tag:'v1.0.0',commitSha:'a'.repeat(40),occurredAt:new Date().toISOString(),manifest};
    const resolve:ServiceResolver['resolveService']=async(id)=>{const s=await f.project.api.getService(f.admin,id);return{projectId:s.projectId,serviceId:s.id,slug:s.name,identity:s.identity};};
    // 原服务还没有任何 events 关系时，不能只信迟到事件内的另一个 projectId。
    await expect(processor(resolve)(event)).rejects.toThrow();
    expect((await f.database.db.execute(sql`SELECT id FROM events.subscriptions WHERE service_id=${closing.serviceId!}`)).length).toBe(0);
    const valid={...event,serviceId:live.serviceId!};
    await expect(processor(async()=>undefined)(valid)).rejects.toThrow();
    const resolved=(await resolve(live.serviceId!))!;
    await expect(processor(async()=>({...resolved,serviceId:Bun.randomUUIDv7() as ServiceId}))(valid)).rejects.toThrow();
    await processor(resolve)(valid);
    expect((await f.database.db.execute(sql`SELECT project_id,handler_path FROM events.subscriptions WHERE service_id=${live.serviceId!}`))[0]).toEqual({project_id:live.id,handler_path:'/valid-handler'});
  },15_000);
});
