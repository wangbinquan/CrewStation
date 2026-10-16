import {expect,test} from 'bun:test';
import postgres from 'postgres';
import type {ProjectId} from '@crewstation/contracts';
import {jsonHash} from '@crewstation/kernel';
import {createTestDatabase,testDatabaseAvailable,DEFAULT_TEST_DATABASE_URL} from '@crewstation/testkit';
import {nativePostgresWork,readNativeJournalSnapshot} from '../adapters/persistence/nativeWork';
import {postgresDatabaseGenerationInspector} from '../adapters/postgres/databaseGenerations';
import {dataControlMigrations} from '../wiring';
import type {NativePostgresSource,NativePostgresStorageSource} from '../api/storageSource';
const available=await testDatabaseAvailable(),adminUrl=process.env.CS_TEST_DATABASE_URL??DEFAULT_TEST_DATABASE_URL;
test.skipIf(!available)('RFC-042 original native DB OIDs and storage prove empty birth; foreign adoption and recreation are forbidden',async()=>{
 const database=await createTestDatabase([dataControlMigrations]),admin=postgres(adminUrl,{max:1,onnotice:()=>{}}),name='cs_restore_'+Bun.randomUUIDv7().replaceAll('-','');
 const origin={resourceId:Bun.randomUUIDv7(),projectId:Bun.randomUUIDv7() as ProjectId,independentDatabase:true as const};
 const storage:NativePostgresStorageSource={identity:jsonHash('restore-volume'),serviceUid:'db-service',server:{podUid:'db-pod',containerId:'containerd://db',nodeUid:'db-node',address:'127.0.0.1'},volumes:[{pvcUid:'pvc',pvUid:'pv',nodeUid:'db-node',mountPath:'/pg',providerPath:'/data',rootEpoch:jsonHash('root'),volumeEpoch:jsonHash('volume'),entries:[{key:'pgdata',relativePath:'pgdata',kind:'directory',identity:jsonHash('pgdata')},{key:'control',relativePath:'pgdata/global/pg_control',kind:'file',identity:jsonHash('control')}]}],observedAt:new Date().toISOString()};
 const source:NativePostgresSource={capture:async()=>storage,verify:async()=>{}},work=nativePostgresWork({db:database.db,adminUrl,source});
 const inspector=postgresDatabaseGenerationInspector(adminUrl,{read:projectId=>database.db.transaction(tx=>readNativeJournalSnapshot(tx,projectId))},source);
 const input={projectId:origin.projectId,resourceId:origin.resourceId,databaseName:name};
 try{
  expect(await inspector.inspect(input)).toBeNull();
  await work.native.run(origin,[name],async c=>{await c.query('CREATE ROLE "'+name+'" NOLOGIN');await c.query('CREATE DATABASE "'+name+'" OWNER "'+name+'"');});
  const born=(await inspector.inspect(input))!;expect(born.empty).toBe(true);expect(born.birthDigest).toMatch(/^[a-f0-9]{64}$/);
  await work.native.run(origin,[name],async()=>{});
  await expect(work.native.run({...origin,resourceId:Bun.randomUUIDv7()},[name],async()=>{throw new Error('must not reach foreign side effect');})).rejects.toThrow('不属于原供给');
  const targetUrl=new URL(adminUrl);targetUrl.pathname='/'+name;const target=postgres(targetUrl.toString(),{max:1,onnotice:()=>{}});try{await target.unsafe('CREATE TABLE restore_marker(id integer)');}finally{await target.end();}
  expect((await inspector.inspect(input))!.empty).toBe(false);
  await admin.unsafe('DROP DATABASE "'+name+'"');await expect(work.native.run(origin,[name],async()=>{throw new Error('must not recreate');})).rejects.toThrow('禁止同名重建');
  await admin.unsafe('CREATE DATABASE "'+name+'" OWNER "'+name+'"');const replacement=(await inspector.inspect(input))!;expect(replacement.identity.databaseOid).not.toBe(born.identity.databaseOid);expect(replacement.birthDigest).toBeNull();
 }finally{await admin.unsafe('DROP DATABASE IF EXISTS "'+name+'"');await admin.unsafe('DROP ROLE IF EXISTS "'+name+'"');await admin.end();await database.drop();}
});
