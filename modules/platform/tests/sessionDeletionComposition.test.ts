import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, TaskIdSchema } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { jsonHash, newResourceId, noopLogger } from '@crewstation/kernel';
import { resourceIdentityDirectory, runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('session deletion actual composition (PG ownership/grants; no physical resource cleanup)', () => {
  test('root mounts actual runtime ownership, EOF task pages and Project grant; old task aliases are resolved without exposing content', async () => {
    const tdb = await createTestDatabase();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url, CS_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9' });
      const root = createPlatformModule({ db: tdb.db, settings, k8s: createFakeK8sClient(), logger: noopLogger, instance: 'session-deletion-composition' });
      await runMigrations(tdb.db, root.api.migrations);
      const admin = await root.modules.identity.api.ensureUser({ externalId: 'session-admin', name: 'Admin', email: 'session-admin@test.invalid' });
      const project = await root.modules.project.api.createProject({ userId: admin.id, isAdmin: true }, { name: '会话删除', slug: 'session-delete', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
      const target = await root.modules.project.api.deletionScope(project.id), taskId = TaskIdSchema.parse(newResourceId());
      await tdb.db.execute(sql`INSERT INTO task_runtime.environments(id,project_id,service_id,kind,state,volume_mode,profile,namespace,pod_name,pvc_name,trace_id,runner_token_hash,labels,created_at,updated_at,last_activity_at)
        VALUES(${taskId},${project.id},${target.serviceId},'dev-session','released','persistent',${BUILTIN_RESOURCES.taskProfileMedium},${project.namespace},'original-task','original-work','private trace','private token hash','{}',now(),now(),now())`);
      const directory = resourceIdentityDirectory(tdb.db, () => root.api.migrations);
      await directory.bind('task_runtime', 'task', ['legacy-session-task'], taskId);
      await tdb.db.execute(sql`INSERT INTO session.runner_events(task_id,seq,at,kind,event,legacy_event) VALUES('legacy-session-task',1,now(),'agent','{"private":"original payload"}','{"private":"legacy payload"}')`);
      const owner = root.modules.session.api.deletionOwner!;
      expect(owner).toBeDefined(); const inventory = await owner.inspect(target);
      expect(inventory.complete).toBe(true); expect(inventory.resources).toHaveLength(1); expect(inventory.resources[0]).toMatchObject({ kind: 'runner_events', id: 'legacy-session-task', count: 1 });
      expect(JSON.stringify(inventory)).not.toContain('private');
      expect(await root.modules.taskRuntime.api.originalProjectTaskIds(project.id, null)).toEqual([taskId]);
      await expect(owner.run({ operationId: newResourceId(), generation: 1, target, confirmed: inventory, phase: 'seal' })).rejects.toThrow();
      expect(await tdb.db.execute('SELECT project_id FROM session.project_deletions')).toHaveLength(0);
      expect(await tdb.db.execute('SELECT task_id FROM session.runner_events')).toHaveLength(1);
      if (!(await root.modules.identity.api.isAdmin(admin.id))) await root.modules.identity.api.setPlatformRole(admin.id, { expectedRole: 'user', platformRole: 'admin' });
      const actor = { userId: admin.id, isAdmin: true }, projectApi = root.modules.project.api;
      // Other participants are controlled reports in this isolated grant test, not physical cleanup evidence.
      const reports = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'session' ? inventory : { participant,
        revision: jsonHash({ participant }), complete: true, resources: [], references: [], blockers: [] });
      const plan = await projectApi.prepareDeletionPlan(actor, project.id, reports);
      const accepted = await projectApi.acceptProjectDeletion(actor, project.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
      const claimed = await projectApi.claimProjectDeletion(accepted.id, 'session-composition');
      expect(claimed).toBeDefined();
      expect((await owner.run({ operationId: accepted.id, generation: claimed!.lease.generation, target: claimed!.plan.target, phase: 'seal', confirmed: inventory })).kind).toBe('done');
      expect(await tdb.db.execute('SELECT project_id FROM session.project_deletions')).toHaveLength(1);
      await expect(tdb.db.execute(sql`INSERT INTO session.runner_events(task_id,seq,at,kind,event) VALUES(${taskId},2,now(),'agent','{}')`).then(() => undefined)).rejects.toMatchObject({ cause: { message: expect.stringContaining('closed') } });
    } finally { await tdb.drop(); }
  }, 30_000);
});
