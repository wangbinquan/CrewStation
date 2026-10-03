import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES, TaskIdSchema } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { jsonHash, newResourceId, noopLogger } from '@crewstation/kernel';
import { resourceIdentityDirectory, runMigrations } from '@crewstation/persistence';
import { loadPlatformSettings } from '@crewstation/settings';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createPlatformModule } from '../wiring';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('business deletion actual root ownership/grant (PostgreSQL; no physical cleanup claim)', () => {
  test('root joins original service, accepted task and runtime aliases; only a current Project grant seals their content', async () => {
    const tdb = await createTestDatabase();
    try {
      const settings = loadPlatformSettings({ CS_DATABASE_URL: tdb.url, CS_SECRET_KEY: Buffer.alloc(32, 1).toString('base64'), CS_GITLAB_URL: 'http://127.0.0.1:9', CS_PLATFORM_POD_UID: newResourceId() });
      const root = createPlatformModule({ db: tdb.db, settings, k8s: createFakeK8sClient(), logger: noopLogger, instance: 'business-deletion-composition' });
      await runMigrations(tdb.db, root.api.migrations);
      const admin = await root.modules.identity.api.ensureUser({ externalId: 'business-admin', name: 'Admin', email: 'business-admin@test.invalid' });
      const actor = { userId: admin.id, isAdmin: true };
      const project = await root.modules.project.api.createProject(actor, { name: '业务删除', slug: 'business-delete', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
      const target = await root.modules.project.api.deletionScope(project.id), taskId = TaskIdSchema.parse(newResourceId());
      await tdb.db.execute(sql`INSERT INTO task_runtime.environments(id,project_id,service_id,kind,state,volume_mode,profile,namespace,pod_name,pvc_name,trace_id,runner_token_hash,labels,created_at,updated_at,last_activity_at)
        VALUES(${taskId},${project.id},${target.serviceId},'business','released','persistent',${BUILTIN_RESOURCES.taskProfileMedium},${project.namespace},'original-business-task','original-work','private trace','private token','{}',now(),now(),now())`);
      await tdb.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
        VALUES(${taskId},${target.serviceId},${project.id},'private caller','closed','private trace','persistent',${BUILTIN_RESOURCES.taskProfileMedium},'{}',now(),now())`);
      const directory = resourceIdentityDirectory(tdb.db, () => root.api.migrations);
      await directory.bind('task_runtime', 'task', ['legacy-business-task'], taskId);
      await directory.bind('business_task', 'task', ['legacy-business-task'], taskId);
      await tdb.db.execute(sql`INSERT INTO business_task.legacy_mutations(id,service_id,kind,task_id,state) VALUES(${newResourceId()},${target.serviceId},'old result','legacy-business-task','complete')`);
      const owner = root.modules.businessTask.api.deletionOwner;
      const inventory = await owner.inspect(target);
      expect(inventory.blockers).toEqual([]);
      expect(inventory.complete).toBe(true); expect(inventory.resources).toHaveLength(2); expect(JSON.stringify(inventory)).not.toContain('private');
      await expect(owner.run({ operationId: newResourceId(), generation: 1, target, confirmed: inventory, phase: 'seal' })).rejects.toThrow();
      expect(await tdb.db.execute('SELECT project_id FROM business_task.project_deletions')).toHaveLength(0);
      if (!await root.modules.identity.api.isAdmin(admin.id)) await root.modules.identity.api.setPlatformRole(admin.id, { expectedRole: 'user', platformRole: 'admin' });
      // Other participants are controlled inventory reports here; this test proves the actual grant and business seal only.
      const projectApi = root.modules.project.api, projectInventory = await projectApi.inspectProjectDeletionMetadata(project.id);
      const reports = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'business-task' ? inventory : participant === 'project' ? projectInventory : { participant, revision: jsonHash(participant), complete: true, resources: [], references: [], blockers: [] });
      const plan = await projectApi.prepareDeletionPlan(actor, project.id, reports);
      const accepted = await projectApi.acceptProjectDeletion(actor, project.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
      const claimed = await projectApi.claimProjectDeletion(accepted.id, 'business-composition');
      expect(claimed).toBeDefined();
      const confirmed = claimed!.plan.participants.find((participant) => participant.participant === 'business-task')!;
      const context = { operationId: accepted.id, generation: claimed!.lease.generation, target: claimed!.plan.target, phase: 'seal' as const, confirmed };
      const sealed = await owner.run(context); expect(sealed.kind).toBe('done');
      if (sealed.kind !== 'done') throw new Error('actual business seal did not complete');
      await projectApi.recordProjectDeletionReceipt(claimed!.lease, 'business-task', 'seal', sealed.evidence);
      expect(await tdb.db.execute('SELECT project_id FROM business_task.project_deletions')).toHaveLength(1);
      await expect(tdb.db.execute(sql`INSERT INTO business_task.legacy_mutations(id,service_id,kind,task_id,state) VALUES(${newResourceId()},${target.serviceId},'late old result','legacy-business-task','open')`).then(() => undefined)).rejects.toThrow();
      const participants = [...PROJECT_DELETION_PARTICIPANTS.filter((participant) => participant !== 'project'), 'project' as const];
      for (const phase of PROJECT_DELETION_PHASES) for (const participant of participants) {
        if (phase === 'seal' && participant === 'business-task') continue;
        const materials = claimed!.plan.participants.find((item) => item.participant === participant)!;
        const step = participant === 'business-task' ? await owner.run({ ...context, phase })
          : participant === 'project' ? await projectApi.deletionOwner.run({ ...context, confirmed: materials, phase })
            : { kind: 'done' as const, evidence: { kind: 'not-applicable' as const, count: 0, digest: jsonHash({ participant, phase }), description: 'Controlled empty participant for the original grant test only.' } };
        expect(step.kind).toBe('done'); if (step.kind !== 'done') throw new Error('original phase did not complete');
        await projectApi.recordProjectDeletionReceipt(claimed!.lease, participant, phase, step.evidence);
      }
      expect(await root.modules.project.api.originalInfrastructureOwnership('service', target.serviceId!)).toBeUndefined();
      expect((await owner.inspect(target)).resources).toEqual([]);
    } finally { await tdb.drop(); }
  }, 30000);
});
