// RFC-034: lifecycle capture must preserve the original write admission, current
// stop grant, project/profile-test ownership and complete retained history.
import {describe,expect,test} from 'bun:test';
import {testDatabaseAvailable} from '@crewstation/testkit';
import {sql} from 'drizzle-orm';
import {BUILTIN_RESOURCES} from '@crewstation/contracts';
import {expectParentStorageRejection} from './developmentParentEndingStorageFixture';
import {runtimeWorkFixture} from './deletion/workFixture';
const available=await testDatabaseAvailable();
describe.skipIf(!available)('original lifecycle history inherits an admitted environment write',()=>{
 test('ordinary and current granted stop state changes each retain their event while sealed and forged writes fail',async()=>{
  const f=await runtimeWorkFixture(),db=f.database.db;
  try{
   const rows=()=>db.execute<{project_id:string|null;document:{state:string}}>(sql`SELECT project_id,document FROM task_runtime.observation_lifecycle WHERE task_id=${f.parent} ORDER BY sequence`);
   expect(await rows()).toHaveLength(1);
   await db.execute(sql`UPDATE task_runtime.environments SET state='ready',updated_at='2026-10-02T00:00:00.345Z' WHERE id=${f.parent}`);
   expect(await rows()).toHaveLength(2);expect((await rows()).at(-1)).toMatchObject({project_id:f.project,document:{state:'ready'}});
   // Even an exact copy cannot be invented outside the actual environment trigger.
   await expectParentStorageRejection(db.execute(sql`INSERT INTO task_runtime.observation_lifecycle(task_id,project_id,observed_at,document) SELECT task_id,project_id,observed_at,document FROM task_runtime.observation_lifecycle WHERE task_id=${f.parent}`),'admitted original environment write');
   await f.work.run(f.input(),async()=>undefined);await f.seal();
   await expectParentStorageRejection(db.execute(sql`UPDATE task_runtime.environments SET state='released' WHERE id=${f.parent}`),'permanently sealed');expect(await rows()).toHaveLength(2);
   const context=await f.context('stop'),input={originKind:'task' as const,originKey:f.parent,reference:f.input().reference,inputDigest:f.input().inputDigest};
   await f.work.runGranted(context,input,()=>db.transaction(tx=>tx.execute(sql`UPDATE task_runtime.environments SET state='released',updated_at='2026-10-02T00:00:10.567Z' WHERE id=${f.parent}`)));
   expect(await rows()).toHaveLength(3);expect((await rows()).at(-1)).toMatchObject({project_id:f.project,document:{state:'released'}});
   expect((await f.work.history(f.project)).every(row=>row.exited)).toBe(true);
  }finally{await f.drop();}
 });
 test('platform profile tests retain a shared origin while project validation retains its actual project',async()=>{
  const f=await runtimeWorkFixture();try{
   const input={kind:'profile-test',projectId:BUILTIN_RESOURCES.profileTestProject,serviceId:BUILTIN_RESOURCES.profileTestService};
   const shared=await f.environment(input),project=await f.environment({...input,render:{runtimeValidation:{projectId:f.project}}});
   const rows=await f.database.db.execute<{task_id:string;project_id:string|null}>(sql`SELECT task_id,project_id FROM task_runtime.observation_lifecycle WHERE task_id IN(${shared},${project})`);
   expect(rows.find(row=>row.task_id===shared)?.project_id).toBeNull();expect(rows.find(row=>row.task_id===project)?.project_id).toBe(f.project);
   const all=await f.inspect();expect(all.inventory.resources.find(row=>row.id==='observation_lifecycle')?.count).toBe(2);
   expect(all.contents.filter(row=>row.table==='observation_lifecycle')).toHaveLength(2);
   expect((await f.database.db.execute(sql`SELECT sequence FROM task_runtime.observation_lifecycle`))).toHaveLength(4);
   expect(all.inventory.complete).toBe(true);
  }finally{await f.drop();}
 });
});
