import { describe, expect, test } from 'bun:test';
import { ProjectIdSchema, ServiceIdSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { businessContentSnapshot } from '../../adapters/persistence/deletion/inspection';
import { BUSINESS_CONTENT } from '../../adapters/persistence/deletion/contentTables';
import type { BusinessDeletionOrigin } from '../../domain/deletion/content';
import type { BusinessDeletionSources } from '../../ports/deletion/sources';
import { businessTaskMigrations } from '../../wiring';

const available = await testDatabaseAvailable();
async function fixture() {
  const database = await createTestDatabase([eventbusMigrations, businessTaskMigrations]);
  const project = ProjectIdSchema.parse(newResourceId()), otherProject = ProjectIdSchema.parse(newResourceId());
  const service = ServiceIdSchema.parse(newResourceId()), otherService = ServiceIdSchema.parse(newResourceId());
  const origins = new Map<string, BusinessDeletionOrigin>(), requests: string[] = [];
  const bind = (kind: 'service' | 'task', id: string, projectId = project) => {
    const value: BusinessDeletionOrigin = { complete: true, id, scope: 'project', projectIds: [projectId], revision: jsonHash({ kind, id, projectId }) };
    origins.set(kind + ':' + id, value); return value;
  };
  bind('service', service); bind('service', otherService, otherProject);
  const sources: BusinessDeletionSources = { resolve: async (kind, key, representation) => { requests.push(kind + ':' + key + ':' + representation); return origins.get(kind + ':' + key); } };
  const seedTask = async (id = newResourceId(), projectId = project, serviceId = service) => {
    await database.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
      VALUES(${id},${serviceId},${projectId},'private-caller','closed','private-trace','persistent','private-profile','{"private":"labels"}',now(),now())`);
    bind('task', id, projectId); return id;
  };
  return { database, project, otherProject, service, otherService, origins, requests, sources, bind, seedTask,
    inspect: () => businessContentSnapshot(database.db, sources, project) };
}

describe.skipIf(!available)('business content inspection (actual PG; controlled original Project/TaskRuntime identities)', () => {
  test('a migrated UUIDv4 task alias retains the current inventory and the original directory', async () => {
    const f = await fixture();
    try {
      const task = await f.seedTask(), before = await f.inspect(), legacy = '49ecbb6a-611e-4d26-82d9-f12be88c57a8';
      const directory = resourceIdentityDirectory(f.database.db, () => [businessTaskMigrations]);
      await directory.bind('business_task', 'task', [legacy], task);
      expect(await f.inspect()).toEqual(before);
      expect(await directory.resolve('task', [legacy])).toBe(task);
    } finally { await f.database.drop(); }
  });

  test('large inventory bounds relation scans and still verifies foreign rows through EOF', async () => {
    const f = await fixture();
    try {
      const target = await f.seedTask(), other = await f.seedTask(newResourceId(), f.otherProject, f.otherService);
      const materials = Array.from({ length: 10001 }, (_, index) => ({ id: newResourceId(), key: 'inventory-' + index, other_project: index % 2 === 1 }));
      await f.database.db.execute(sql`INSERT INTO business_task.execution_materials(id,service_id,task_id,request_key,digest,sealed,size_bytes,created_at)
        SELECT x.id,CASE WHEN x.other_project THEN ${f.otherService} ELSE ${f.service} END,
          CASE WHEN x.other_project THEN ${other} ELSE ${target} END,x.key,${jsonHash('original')},'private-material',64,now()
        FROM jsonb_to_recordset(${JSON.stringify(materials)}::jsonb) x(id text,key text,other_project boolean)`);
      let scans = 0;
      const database = drizzle({ client: f.database.handle.client, logger: { logQuery(query) {
        if (query.includes('FROM business_task.execution_materials r')) scans++;
      } } });
      const inspected = await businessContentSnapshot(database, f.sources, f.project);
      expect(inspected.traversal.counts.execution_materials).toBe(10001);
      expect(inspected.inventory.resources.find((row) => row.id === 'execution_materials')?.count).toBe(5001);
      // The live deletion dialog stalled because every 200-row page rescanned and sorted the whole relation.
      expect(scans).toBe(2);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_materials(id,service_id,task_id,request_key,digest,sealed,size_bytes,created_at)
        VALUES(${newResourceId()},${f.otherService},${target},'tail-conflict',${jsonHash('conflict')},'private-material',64,now())`);
      await expect(businessContentSnapshot(database, f.sources, f.project)).rejects.toThrow('项目归属冲突');
    } finally { await f.database.drop(); }
  }, 30000);

  test('reads all 25 content tables to EOF, includes more than 200 closed historical tasks and keeps private payloads in PostgreSQL', async () => {
    const f = await fixture();
    try {
      const target = await f.seedTask(), other = await f.seedTask(newResourceId(), f.otherProject, f.otherService);
      const tasks = Array.from({ length: 205 }, () => ({ id: newResourceId(), child: newResourceId() }));
      await f.database.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
        SELECT x.id,${f.service},${f.project},'private-caller','closed','private-trace','persistent','private-profile','{"private":"labels"}',now(),now()
        FROM jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb) x(id text,child text)`);
      await f.database.db.execute(sql`INSERT INTO business_task.subtasks(id,task_id,name,kind,state,attempt,spec,output,created_at)
        SELECT x.child,x.id,'private-child','agent','succeeded',1,'{"private":"spec"}','private-output',now()
        FROM jsonb_to_recordset(${JSON.stringify(tasks)}::jsonb) x(id text,child text)`);
      await f.database.db.execute(sql`INSERT INTO business_task.contracts(release_id,service_id,tag,agent_profiles,output_contracts,registered_at)
        VALUES(${newResourceId()},${f.service},'private-tag','{"private":"agent"}','{"private":"contract"}',now()),
              (${newResourceId()},${f.otherService},'other-project-tag','{}','{}',now())`);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_controls(service_id,body) VALUES(${f.service},'{"private":"control"}'),(${f.otherService},'{"private":"other-control"}')`);
      await f.database.db.execute(sql`INSERT INTO business_task.legacy_mutations(id,service_id,kind,task_id,state) VALUES(${newResourceId()},${f.service},'launch',${target},'complete')`);
      await f.database.db.execute(sql`INSERT INTO business_task.cluster_commands(id,body,legacy_body)
        VALUES(${newResourceId()},${JSON.stringify({ operation: { target: { taskId: target } }, private: 'command-secret' })}::jsonb,${JSON.stringify({ operation: { target: { taskId: 'old-original-task' } } })}::jsonb)`);
      f.origins.set('task:old-original-task', f.origins.get('task:' + target)!);
      const materials = Array.from({ length: 205 }, (_, i) => ({ id: newResourceId(), key: 'private-request-' + i }));
      await f.database.db.execute(sql`INSERT INTO business_task.execution_materials(id,service_id,task_id,request_key,digest,sealed,size_bytes,created_at)
        SELECT x.id,${f.service},${target},x.key,${jsonHash('original')},'private-sealed-material',64,now()
        FROM jsonb_to_recordset(${JSON.stringify(materials)}::jsonb) x(id text,key text)`);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_materials(id,service_id,task_id,request_key,digest,sealed,size_bytes,created_at)
        VALUES(${newResourceId()},${f.otherService},${other},'other-key',${jsonHash('other')},'other-secret',64,now())`);
      const before = await f.database.db.execute('SELECT id FROM business_task.tasks ORDER BY id');
      const inspected = await f.inspect();
      expect(inspected.inventory.complete).toBe(true); expect(BUSINESS_CONTENT).toHaveLength(25);
      expect(inspected.traversal.counts.tasks).toBe(207); expect(inspected.traversal.counts.subtasks).toBe(205); expect(inspected.traversal.counts.execution_materials).toBe(206);
      expect(inspected.inventory.resources.find((row) => row.id === 'tasks')?.count).toBe(206);
      expect(inspected.inventory.resources.find((row) => row.id === 'execution_materials')?.count).toBe(205);
      expect(inspected.contents.every((row) => !row.key.includes(other))).toBe(true);
      for (const privateText of ['private-caller', 'private-output', 'private-sealed-material', 'command-secret', 'other-secret'])
        expect(JSON.stringify(inspected)).not.toContain(privateText);
      expect(JSON.stringify(inspected.inventory)).not.toContain('old-original-task');
      expect(inspected.origins.find((row) => row.key === 'old-original-task')).toMatchObject({ kind: 'task', id: target, projectId: f.project });
      expect(f.requests.filter((value) => value === 'service:' + f.service + ':current')).toHaveLength(1);
      expect(await f.database.db.execute('SELECT id FROM business_task.tasks ORDER BY id')).toEqual(before);
      expect(await f.inspect()).toEqual(inspected);
      await f.database.db.execute(sql`UPDATE business_task.execution_materials SET sealed='changed-original-material' WHERE id=${materials[204]!.id}`);
      expect((await f.inspect()).inventory.revision).not.toBe(inspected.inventory.revision);
    } finally { await f.database.drop(); }
  }, 15000);

  test('native accepted roots, child projections, finalization proofs and recovery audits keep their original parent identity', async () => {
    const f = await fixture();
    try {
      const task = newResourceId(), child = newResourceId(), operation = newResourceId(), request = newResourceId(), finalization = newResourceId();
      await f.database.db.execute(sql`INSERT INTO business_task.execution_operations(id,service_id,kind,parent_id,request_key,request_digest,effective_digest,intent,state,created_at,updated_at)
        VALUES(${operation},${f.service},'create-task','','original-key',${jsonHash('request')},${jsonHash('effective')},
        ${JSON.stringify({ projectId: f.project, task: { id: task, serviceId: f.service }, private: 'accepted-private' })}::jsonb,'succeeded',now(),now())`);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_subtasks(id,service_id,task_id,request_key,request_digest,sealed_payload,payload_digest,fenced,view,dispatch,updated_at)
        VALUES(${child},${f.service},${task},'child-key',${jsonHash('request')},'private-payload',${jsonHash('payload')},false,
          ${JSON.stringify({ id: child, taskId: task })}::jsonb,'accepted',now())`);
      await f.database.db.execute(sql`INSERT INTO business_task.subtask_projections(subtask_id,stdout,stderr) VALUES(${child},'private-stdout','private-stderr')`);
      await f.database.db.execute(sql`INSERT INTO business_task.recovery_requests(id,service_id,project_id,task_id,target_key,request_key,request_digest,requested_by,target,assessment_digest,state,created_at,updated_at)
        VALUES(${request},${f.service},${f.project},${task},'private-target','recovery-key',${jsonHash('request')},'private-user','{}',${jsonHash('assessment')},'succeeded',now(),now())`);
      await f.database.db.execute(sql`INSERT INTO business_task.recovery_audit(id,request_id,event,actor,at) VALUES(${newResourceId()},${request},'succeeded','private-user',now())`);
      const finalBody = { id: finalization, projectId: f.project, serviceId: f.service, view: { taskId: task }, private: 'archive-private' };
      await f.database.db.execute(sql`INSERT INTO business_task.finalizations(id,service_id,task_id,body,phase) VALUES(${finalization},${f.service},${task},${JSON.stringify(finalBody)}::jsonb,'completed')`);
      await f.database.db.execute(sql`INSERT INTO business_task.finalization_execution_proofs(operation_id,subtask_id,body) VALUES(${finalization},${child},'{"private":"proof"}')`);
      await f.database.db.execute(sql`INSERT INTO business_task.finalization_revisions(id,finalization_id,request_key,body) VALUES(${newResourceId()},${finalization},'revision-key','{"private":"revision"}')`);
      const inspected = await f.inspect();
      expect(inspected.inventory.resources).toHaveLength(8);
      for (const table of ['execution_operations', 'execution_subtasks', 'subtask_projections', 'recovery_requests', 'recovery_audit', 'finalizations', 'finalization_execution_proofs', 'finalization_revisions'])
        expect(inspected.inventory.resources.find((row) => row.id === table)?.count).toBe(1);
      expect(JSON.stringify(inspected)).not.toContain('private');
      await f.database.db.execute(sql`UPDATE business_task.execution_subtasks SET view=jsonb_set(view,'{taskId}',to_jsonb(${newResourceId()}::text)) WHERE id=${child}`);
      await expect(f.inspect()).rejects.toThrow('原内容关系');
    } finally { await f.database.drop(); }
  });

  test('unavailable service, orphan task and disagreeing historical runtime identity block complete confirmation', async () => {
    const f = await fixture();
    try {
      const task = await f.seedTask();
      f.origins.delete('service:' + f.service); await expect(f.inspect()).rejects.toThrow(); f.bind('service', f.service);
      await f.database.db.execute(sql`INSERT INTO business_task.subtasks(id,task_id,name,kind,state,attempt,spec,created_at)
        VALUES(${newResourceId()},${newResourceId()},'orphan','agent','failed',1,'{}',now())`);
      await expect(f.inspect()).rejects.toThrow('原任务根');
      await f.database.db.execute(sql`DELETE FROM business_task.subtasks`);
      const otherRuntime = newResourceId(); f.bind('task', otherRuntime);
      f.origins.set('task:wrong-old-task', f.origins.get('task:' + otherRuntime)!);
      await f.database.db.execute(sql`INSERT INTO business_task.cluster_commands(id,body,legacy_body)
        VALUES(${newResourceId()},${JSON.stringify({ operation: { target: { taskId: task } } })}::jsonb,${JSON.stringify({ operation: { target: { taskId: 'wrong-old-task' } } })}::jsonb)`);
      await expect(f.inspect()).rejects.toThrow('同一原对象');
    } finally { await f.database.drop(); }
  });

  test('unknown tables and conflicting project links cannot produce an apparently empty complete inventory', async () => {
    const f = await fixture();
    try {
      expect((await f.inspect()).inventory.resources).toEqual([]);
      await f.database.db.execute('CREATE TABLE business_task.unknown_history(project_id text,payload jsonb)');
      await expect(f.inspect()).rejects.toThrow('未登记');
      await f.database.db.execute('DROP TABLE business_task.unknown_history');
      const task = await f.seedTask(); f.bind('service', f.service, f.otherProject);
      await expect(f.inspect()).rejects.toThrow('原服务项目冲突');
      f.bind('service', f.service);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_materials(id,service_id,task_id,request_key,digest,sealed,size_bytes,created_at)
        VALUES(${newResourceId()},${f.otherService},${task},'conflict',${jsonHash('request')},'private',7,now())`);
      await expect(f.inspect()).rejects.toThrow('项目归属冲突');
    } finally { await f.database.drop(); }
  });

  test('shared or replaced original identities and a contradictory current alias cannot be confirmed', async () => {
    const f = await fixture();
    try {
      const task = await f.seedTask(), original = f.origins.get('service:' + f.service)!;
      f.origins.set('service:' + f.service, { ...original, id: newResourceId() }); await expect(f.inspect()).rejects.toThrow('原对象 ID');
      f.origins.set('service:' + f.service, { ...original, projectIds: [f.project, f.otherProject] }); await expect(f.inspect()).rejects.toThrow('共享');
      f.origins.set('service:' + f.service, { ...original, scope: 'platform', projectIds: [] }); await expect(f.inspect()).rejects.toThrow('原服务项目冲突');
      f.origins.set('service:' + f.service, original);
      const directory = resourceIdentityDirectory(f.database.db, () => [businessTaskMigrations]);
      await directory.bind('business_task', 'task', [task], newResourceId()); await expect(f.inspect()).rejects.toThrow('原标识目录冲突');
    } finally { await f.database.drop(); }
  });

  test('a cancellation cannot borrow another project child and a native session alias cannot borrow another execution', async () => {
    const f = await fixture();
    try {
      const task = await f.seedTask(), other = await f.seedTask(newResourceId(), f.otherProject, f.otherService);
      const child = newResourceId(), otherChild = newResourceId(), home = newResourceId(), cancellation = newResourceId(); f.bind('task', home);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_session_homes(session_key,service_id,task_id,volume_uid,state)
        VALUES(${home},${f.service},${task},'original-volume','idle')`);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_subtasks(id,service_id,task_id,request_key,request_digest,sealed_payload,payload_digest,fenced,view,dispatch,session_key,session_volume_uid,updated_at)
        VALUES(${child},${f.service},${task},'child',${jsonHash('request')},'private',${jsonHash('payload')},false,
          ${JSON.stringify({ id: child, taskId: task, executionId: 'original-execution' })}::jsonb,'accepted',${home},'original-volume',now()),
          (${otherChild},${f.otherService},${other},'other-child',${jsonHash('request')},'other-private',${jsonHash('payload')},false,
          ${JSON.stringify({ id: otherChild, taskId: other, executionId: 'other-execution' })}::jsonb,'accepted',NULL,NULL,now())`);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_cancellations(id,service_id,task_id,subtask_id,request_key,request_digest,expected_attempt,state,updated_at)
        VALUES(${cancellation},${f.service},${task},${otherChild},'cancel',${jsonHash('request')},1,'pending',now())`);
      await expect(f.inspect()).rejects.toThrow('原内容关系');
      await f.database.db.execute(sql`UPDATE business_task.execution_cancellations SET subtask_id=${child} WHERE id=${cancellation}`);
      expect((await f.inspect()).inventory.complete).toBe(true);
      await f.database.db.execute(sql`INSERT INTO business_task.execution_sessions(service_id,task_id,session_id,session_key,source_execution_id)
        VALUES(${f.service},${task},'private-session',${home},'other-execution')`);
      await expect(f.inspect()).rejects.toThrow('原内容关系');
      await f.database.db.execute(sql`UPDATE business_task.execution_sessions SET source_execution_id='original-execution' WHERE task_id=${task}`);
      expect((await f.inspect()).inventory.resources.find((row) => row.id === 'execution_sessions')?.count).toBe(1);
      await f.database.db.execute(sql`UPDATE business_task.execution_session_homes SET volume_uid='replacement-volume' WHERE session_key=${home}`);
      await expect(f.inspect()).rejects.toThrow('原内容关系');
      expect(await f.database.db.execute(sql`SELECT id FROM business_task.execution_subtasks WHERE id=${otherChild}`)).toHaveLength(1);
    } finally { await f.database.drop(); }
  });
});
