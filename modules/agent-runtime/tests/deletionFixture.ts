import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { Actor, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import { runMigrations } from '@crewstation/persistence';
import { queueMigrations } from '@crewstation/queue';
import { generateSecretKey } from '@crewstation/secretbox';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createAgentRuntimeModule, agentRuntimeMigrations } from '../wiring';

export async function computeDeletionFixture(receipts = 1) {
  const database = await createTestDatabase([eventbusMigrations, queueMigrations, identityMigrations, projectMigrations,
    { ...agentRuntimeMigrations, files: agentRuntimeMigrations.files.filter((f) => !f.name.startsWith('0009_')) }]);
  const identity = createIdentityModule({ db: database.db, settings: { adminEmails: ['compute-delete@tests.invalid'] } });
  const user = await identity.api.ensureUser({ externalId: 'compute-delete', name: 'Admin', email: 'compute-delete@tests.invalid' });
  const admin: Actor = { userId: user.id, isAdmin: true };
  const project = createProjectModule({ db: database.db, identity: identity.api, hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.svc.test` }, settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
  const own = await project.api.createProject(admin, { slug: 'compute-delete', name: 'Compute delete', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
  const other = await project.api.createProject(admin, { slug: 'compute-keep', name: 'Compute keep', kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
  const ids = Array.from({ length: receipts }, () => newResourceId()), retainedId = newResourceId();
  const policy = { mode: 'inherit' as const, allowedProfiles: [], defaultProfile: null, devTaskProfile: null };
  for (const p of [own, other]) await database.db.execute(sql`INSERT INTO agent_runtime.project_compute_policies VALUES (${p.id},1,${JSON.stringify(policy)}::jsonb,${admin.userId},now())`);
  for (const id of ids) await database.db.execute(sql`INSERT INTO agent_runtime.allocation_receipts VALUES (${id},${own.id},${JSON.stringify({ private: 'erase-allocation-' + id })}::jsonb)`);
  await database.db.execute(sql`INSERT INTO agent_runtime.allocation_receipts VALUES (${retainedId},${other.id},jsonb_build_object('private','keep-allocation'))`);
  await runMigrations(database.db, [agentRuntimeMigrations]);
  const secretKey = generateSecretKey(), layout = { pullBase: 'registry.test:5000', pushHost: 'registry.test', baseRepository: 'crewstation/task-runtime', runtimePrefix: 'runtime/' };
  const application = () => createAgentRuntimeModule({ db: database.db, isAdmin: project.api.isAdmin,
    projects: { authorize: project.api.authorize, name: async (id) => (await project.api.resolveServiceOfProject(id))?.slug, assertProjectAvailable: project.api.assertProjectAvailable, assertProjectDeletionGrant: project.api.assertProjectDeletionGrant },
    settings: { secretKeyBase64: secretKey, registry: { ...layout, scheme: 'http', baseTag: 'dev' } },
    registry: { layout, resolveDigest: async () => `sha256:${'1'.repeat(64)}` }, executor: { run: async () => ({ state: 'passed', outcome: 'passed', stages: [] }) },
    references: { listReferencingProjects: async () => [] }, taskProfiles: { exists: async () => true } });
  const compute = application();
  const begin = async () => {
    const target = await project.api.deletionScope(own.id), report = await compute.api.deletionOwner!.inspect(target), metadata = await project.api.inspectProjectDeletionMetadata(own.id);
    const reports: ProjectDeletionInventory[] = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'agent-runtime' ? report : participant === 'project' ? metadata
      : { participant, revision: jsonHash(participant), complete: true, resources: [], references: [], blockers: [] });
    const plan = await project.api.prepareDeletionPlan(admin, own.id, reports);
    const operation = await project.api.acceptProjectDeletion(admin, own.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
    const claimed = (await project.api.claimProjectDeletion(operation.id, 'compute-delete-test'))!;
    const context: ProjectDeletionContext = { operationId: operation.id, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((p) => p.participant === 'agent-runtime')!, phase: 'seal' };
    return { plan, operation, lease: claimed.lease, context };
  };
  const proceed = async (started: Awaited<ReturnType<typeof begin>>, through: ProjectDeletionPhase) => {
    let progress = await project.api.readProjectDeletion(admin, started.operation.id);
    for (const phase of PROJECT_DELETION_PHASES.slice(0, PROJECT_DELETION_PHASES.indexOf(through) + 1)) {
      for (const participant of [...PROJECT_DELETION_PARTICIPANTS.filter((p) => p !== 'project'), 'project' as const]) {
        if (progress.receipts.some((r) => r.phase === phase && r.participant === participant)) continue;
        const owner = participant === 'agent-runtime' ? compute.api.deletionOwner : participant === 'project' ? project.api.deletionOwner : undefined;
        const context = { ...started.context, phase, confirmed: started.plan.participants.find((p) => p.participant === participant)! };
        const step = owner ? await owner.run(context) : { kind: 'done' as const, evidence: { kind: 'not-applicable' as const, digest: jsonHash({ participant, phase }), description: '其他 owner 空范围，只是模块许可夹具，非平台物理清理验收', count: 0 } };
        if (step.kind !== 'done') throw new Error(`Module cleanup ${participant}/${phase}: ${step.kind}`);
        progress = await project.api.recordProjectDeletionReceipt(started.lease, participant, phase, step.evidence);
      }
    }
  };
  return { database, admin, own, other, ids, retainedId, policy, secretKey, project, compute, application, begin, proceed };
}
export type ComputeDeletionFixture = Awaited<ReturnType<typeof computeDeletionFixture>>;
