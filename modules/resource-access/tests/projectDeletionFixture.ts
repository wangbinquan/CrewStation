import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import type { Actor, ProjectDeletionContext, ProjectDeletionInventory } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createResourceAccessModule, resourceAccessMigrations } from '../wiring';
import type { ResourceAdapter } from '../ports/resources';

export async function resourceAccessDeletionFixture(options: { withoutIdentityGuard?: boolean } = {}) {
  const db = await createTestDatabase([eventbusMigrations, queueMigrations, identityMigrations, projectMigrations, { ...resourceAccessMigrations, files: resourceAccessMigrations.files.filter((f) => f.name < '0002_') }]);
  const identity = createIdentityModule({ db: db.db, settings: { adminEmails: [] } });
  const user = await identity.api.ensureUser({ externalId: 'resource-admin', name: 'Admin', email: 'resource@test.invalid' });
  const admin: Actor = { userId: user.id, isAdmin: true };
  const project = createProjectModule({ db: db.db, identity: identity.api, hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.svc.test` }, settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
  const make = (slug: string) => project.api.createProject(admin, { slug, name: slug, kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
  const own = await make('resource-delete'), other = await make('resource-keep');
  const ids = { own: newResourceId(), other: newResourceId(), policy: newResourceId() };
  for (const [p, id, marker] of [[own, ids.own, 'erase-owned-reason'], [other, ids.other, 'retain-other-reason']] as const) await db.db.execute(sql`INSERT INTO resource_access.changes VALUES (${id},${p.id},${admin.userId},${newResourceId()},${id},'pending',1,${JSON.stringify({ private: marker })}::jsonb,now())`);
  await db.db.execute(sql`INSERT INTO resource_access.catalog_policies VALUES (${ids.policy},'object-plan',${ids.policy},1,1,${admin.userId},now())`);
  await runMigrations(db.db, [{ ...resourceAccessMigrations, files: resourceAccessMigrations.files.filter((f) => !options.withoutIdentityGuard || f.name < '0003_') }]);
  const application = (adapters: readonly ResourceAdapter[] = []) => createResourceAccessModule({ db: db.db, project: project.api, adapters, userName: async () => 'Admin', instance: 'resource-delete-test' });
  const resourceAccess = application();
  const begin = async () => {
    const target = await project.api.deletionScope(own.id), report = await resourceAccess.api.deletionOwner!.inspect(target), metadata = await project.api.inspectProjectDeletionMetadata(own.id);
    // 空范围只用于本 owner 的权限和阶段测试，不能作为平台其他 owner 的回收证明。
    const reports: ProjectDeletionInventory[] = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'resource-access' ? report : participant === 'project' ? metadata : { participant, revision: jsonHash(participant), complete: true, resources: [], references: [], blockers: [] });
    const plan = await project.api.prepareDeletionPlan(admin, own.id, reports);
    const operation = await project.api.acceptProjectDeletion(admin, own.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
    const claimed = (await project.api.claimProjectDeletion(operation.id, 'resource-delete-test'))!;
    const context: ProjectDeletionContext = { operationId: operation.id, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((p) => p.participant === 'resource-access')!, phase: 'seal' };
    return { plan, operation, lease: claimed.lease, context };
  };
  return { db, project, own, other, ids, admin, application, resourceAccess, begin };
}
export type ResourceAccessDeletionFixture = Awaited<ReturnType<typeof resourceAccessDeletionFixture>>;
