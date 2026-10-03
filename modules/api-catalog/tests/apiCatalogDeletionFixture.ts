import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import type { Actor, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { apiCatalogMigrations, createApiCatalogModule } from '../wiring';

export async function apiCatalogDeletionFixture(options: { withoutOriginalGuard?: boolean } = {}) {
  const db = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations, { ...apiCatalogMigrations, files: apiCatalogMigrations.files.filter((file) => file.name < '0007_') }]);
  const identity = createIdentityModule({ db: db.db, settings: { adminEmails: [] } });
  const user = await identity.api.ensureUser({ externalId: 'catalog-admin', name: 'Admin', email: 'catalog@test.invalid' });
  const admin: Actor = { userId: user.id, isAdmin: true };
  const project = createProjectModule({ db: db.db, identity: identity.api, hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.svc.test` }, settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
  const create = (slug: string) => project.api.createProject(admin, { slug, name: slug, kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
  const own = await create('catalog-delete'), other = await create('catalog-keep');
  const catalog = createApiCatalogModule({ db: db.db, projects: { ...project.api, resourceRequestable: async () => true }, hosts: { platformApiHost: () => 'api.test' }, services: {
    resolveService: async (id) => { const s = await project.api.getService(admin, id); return { projectId: s.projectId, serviceId: s.id, slug: s.name, identity: s.identity }; },
    resolveServiceIdentity: async (id) => { const resolved = await project.api.resolveServiceIdentity(id); return resolved ? { ...resolved, identity: id } : undefined; },
  } });
  const ids = { proxy: newResourceId(), otherProxy: newResourceId(), operation: newResourceId(), otherOperation: newResourceId(), request: newResourceId(), incoming: newResourceId(), allocation: newResourceId() };
  for (const [p, proxy, operation, marker] of [[own, ids.proxy, ids.operation, 'erase-owned'], [other, ids.otherProxy, ids.otherOperation, 'retain-other']] as const) {
    await db.db.execute(sql`INSERT INTO api_catalog.proxies(id,name,proxy,project_id,service_id,kind,document,state,updated_at) VALUES (${proxy},${marker},${p.slug},${p.id},${p.serviceId},'DigitalWorker',${JSON.stringify({ private: marker })}::jsonb,'active',now())`);
    await db.db.execute(sql`INSERT INTO api_catalog.operations(id,proxy_id,proxy,method,path,summary,open_policy,resource_note,state,updated_at) VALUES (${operation},${proxy},${p.slug},'GET','/items',${marker},'default',${marker},'active',now())`);
  }
  for (const [service, operation] of [[own.serviceId!, ids.otherOperation], [other.serviceId!, ids.operation], [other.serviceId!, ids.otherOperation]]) await db.db.execute(sql`INSERT INTO api_catalog.grants(service_id,operation_id,state,granted_by,granted_at) VALUES (${service},${operation},'granted',${admin.userId},now())`);
  for (const [p, request, operation, reason] of [[own, ids.request, ids.otherOperation, 'erase-own-request'], [other, ids.incoming, ids.operation, 'retain-incoming-reason']] as const) await db.db.execute(sql`INSERT INTO api_catalog.requests(id,service_id,project_id,operation_id,state,reason,requested_by,created_at) VALUES (${request},${p.serviceId},${p.id},${operation},'pending',${reason},${admin.userId},now())`);
  await db.db.execute(sql`INSERT INTO api_catalog.allocation_receipts VALUES (${ids.allocation},${own.serviceId},${JSON.stringify({ hash: 'erase-allocation', revision: '1', effect: 'private-result', applied: true })}::jsonb)`);
  await runMigrations(db.db, [{ ...apiCatalogMigrations, files: apiCatalogMigrations.files.filter((file) => !options.withoutOriginalGuard || file.name < '0008_') }]);
  const begin = async () => {
    const target = await project.api.deletionScope(own.id), report = await catalog.api.deletionOwner!.inspect(target);
    // 其他 owner 的空报告仅用于本模块许可测试，不是全平台回收证据。
    const metadata = await project.api.inspectProjectDeletionMetadata(own.id);
    const reports: ProjectDeletionInventory[] = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'api-catalog' ? report : participant === 'project' ? metadata : { participant, revision: jsonHash(participant), complete: true, resources: [], references: [], blockers: [] });
    const plan = await project.api.prepareDeletionPlan(admin, own.id, reports);
    const operation = await project.api.acceptProjectDeletion(admin, own.id, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
    const claimed = (await project.api.claimProjectDeletion(operation.id, 'catalog-test'))!;
    const context: ProjectDeletionContext = { operationId: operation.id, generation: claimed.lease.generation, target, confirmed: plan.participants.find((p) => p.participant === 'api-catalog')!, phase: 'seal' as ProjectDeletionPhase };
    return { plan, operation, lease: claimed.lease, context };
  };
  return { db, identity, project, catalog, admin, own, other, ids, begin };
}
export type ApiCatalogDeletionFixture = Awaited<ReturnType<typeof apiCatalogDeletionFixture>>;
