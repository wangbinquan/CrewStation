import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { Actor, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase, ProjectDto, ProjectId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import type { ResolvedService } from '@crewstation/module-project';
import { createFakeK8sClient } from '@crewstation/k8s';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createGatewayModule, gatewayMigrations, type GatewayModuleDeps } from '../wiring';
import { gatewayDeletionRepository } from '../adapters/persistence/projectDeletion';
import type { GatewayOriginalDirectory, GatewayProcess } from '../ports/repositories';
import type { DirectoryService } from '../ports/directories';

export const gatewayContentTables = ['allowlists', 'pod_identities', 'routes', 'service_maintenance', 'maintenance_events', 'rate_limits', 'rate_limit_receipts'] as const;
export async function gatewayContent(db: Database) {
  const result: Record<string, unknown> = {};
  for (const table of gatewayContentTables) result[table] = [...await db.execute(sql`SELECT to_jsonb(c) AS body FROM gateway.${sql.identifier(table)} c ORDER BY to_jsonb(c)::text`)];
  return result;
}
const directory = (s: ResolvedService): DirectoryService => ({ serviceId: s.serviceId, projectId: s.projectId, projectSlug: s.slug, serviceName: s.name, namespace: s.namespace, identity: s.identity, kind: s.kind, archived: s.state === 'archived' });
const callerOf = (p: ProjectDto) => `${p.slug}/${p.slug}`;
function historyDocument(version: number, own: ProjectDto, other: ProjectDto, operation: string, otherOperation: string) {
  const base = { version, generatedAt: '2026-10-01T00:00:00.000Z', defaultOpen: [otherOperation, operation], maxStaleSeconds: 300,
    privateOtherField: { marker: 'retain-unrelated-document-field', order: [3, 1, 2] },
    entries: [{ caller: callerOf(other), operations: [otherOperation, operation], platformApi: true, platformHosts: ['platformApi'], marker: 'retain-other-entry' },
      { caller: callerOf(own), operations: [otherOperation], platformApi: true, platformHosts: ['platformApi'], marker: 'erase-owned-entry' }] };
  return version === 1 ? base : { ...base, identityVersion: 2, operationRoutes: [
    { id: otherOperation, proxy: other.slug, method: 'GET', path: '/keep' }, { id: operation, proxy: own.slug, method: 'GET', path: '/erase' },
  ] };
}
async function seedHistory(db: Database, admin: Actor, own: ProjectDto, other: ProjectDto, ids: { operation: string; otherOperation: string; release: string }, versions: number) {
  for (let version = 1; version <= versions; version += 1) {
    const doc = historyDocument(version, own, other, version === 1 ? 'gateway-delete:GET:/erase' : ids.operation, version === 1 ? 'gateway-keep:GET:/keep' : ids.otherOperation);
    await db.execute(sql`INSERT INTO gateway.allowlists(version,document,generated_at) VALUES (${version},${JSON.stringify(doc)}::jsonb,${doc.generatedAt}::timestamptz)`);
  }
  for (const p of [own, other]) {
    const marker = p === own ? 'erase-owned' : 'retain-other', uid = p === own ? 'own-original' : 'other-original';
    const source = { releaseId: ids.release, podUid: uid, physicalSlot: 'blue', ip: p === own ? '10.1.1.1' : '10.1.1.2', ready: false };
    await db.execute(sql`INSERT INTO gateway.pod_identities(namespace,pod_name,ip,project,service,workload,physical_slot,version,updated_at,pod_uid,service_source) VALUES (${p.namespace},${marker},${source.ip},${p.slug},${p.slug},'service','blue',7,now(),${uid},${JSON.stringify(source)}::jsonb)`);
    await db.execute(sql`INSERT INTO gateway.routes(service_id,service_name,routes,updated_at) VALUES (${p.serviceId},${p.slug},${JSON.stringify([{ private: marker }])}::jsonb,now())`);
    const body = { switches: { users: true, services: false, events: true }, reason: marker, allowUserIds: [], startedBy: admin.userId, startedAt: new Date().toISOString(), updatedBy: admin.userId };
    await db.execute(sql`INSERT INTO gateway.service_maintenance(service_id,project_id,body,revision,updated_at) VALUES (${p.serviceId},${p.id},${JSON.stringify(body)}::jsonb,1,now())`);
    await db.execute(sql`INSERT INTO gateway.maintenance_events(id,service_id,kind,actor_user_id,at,body) VALUES (${newResourceId()},${p.serviceId},'entered',${admin.userId},now(),${JSON.stringify(body)}::jsonb)`);
    await db.execute(sql`INSERT INTO gateway.rate_limits(scope,body,revision,updated_at,updated_by) VALUES (${p.id},${JSON.stringify({ private: marker })}::jsonb,1,now(),${admin.userId})`);
    await db.execute(sql`INSERT INTO gateway.rate_limit_receipts(operation_id,project_id,body) VALUES (${newResourceId()},${p.id},${JSON.stringify({ hash: marker, revision: '1', effect: marker, applied: true })}::jsonb)`);
  }
  await db.execute(sql`INSERT INTO gateway.rate_limits(scope,body,revision,updated_at,updated_by) VALUES ('platform','{"private":"retain-platform"}'::jsonb,1,now(),${admin.userId})`);
}

export async function gatewayDeletionFixture(options: { versions?: number; beforeUpgrade?: (db: Database) => Promise<void>; application?: Partial<GatewayModuleDeps> } = {}) {
  const db = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations, { ...gatewayMigrations, files: gatewayMigrations.files.filter((file) => file.name < '0011_') }]);
  try {
  const identity = createIdentityModule({ db: db.db, settings: { adminEmails: ['gateway-delete@test.invalid'] } });
  const user = await identity.api.ensureUser({ externalId: 'gateway-admin', name: 'Admin', email: 'gateway-delete@test.invalid' });
  const admin: Actor = { userId: user.id, isAdmin: true };
  const hosts = { prodHost: (s: string) => `${s}.test`, previewHost: (s: string) => `preview.${s}.test`, serviceHost: (s: string) => `${s}.svc.test`, platformApiHost: () => 'api.svc.test' };
  const project = createProjectModule({ db: db.db, identity: identity.api, hosts, settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
  const create = (slug: string) => project.api.createProject(admin, { slug, name: slug, kind: 'DigitalWorker', template: BUILTIN_RESOURCES.minimalTemplate });
  const own = await create('gateway-delete'), other = await create('gateway-keep'), ids = { operation: newResourceId(), otherOperation: newResourceId(), release: newResourceId() };
  await seedHistory(db.db, admin, own, other, ids, options.versions ?? 2); await options.beforeUpgrade?.(db.db);
  const before = await gatewayContent(db.db); await runMigrations(db.db, [gatewayMigrations]);
  const operation = async (key: string) => key === ids.operation || key === 'gateway-delete:GET:/erase' ? own.id : key === ids.otherOperation || key === 'gateway-keep:GET:/keep' ? other.id : undefined;
  const service = async (key: string) => { const s = await project.api.resolveServiceById(key as NonNullable<ProjectDto['serviceId']>) ?? await project.api.resolveServiceIdentity(key); return s ? directory(s) : undefined; };
  const originals: GatewayOriginalDirectory = { service, operation, pod: async (record) => record.podUid === 'own-original' ? own.id : record.podUid === 'other-original' ? other.id : undefined };
  // 固定过程身份用于数据库 owner 夹具，不是实际容器停止验收。
  const process: GatewayProcess = { podUid: 'gateway-process', containerId: 'containerd://gateway-original', nodeUid: 'original-node', nodeName: 'node' };
  const processes = { protectCurrent: async () => process, sweep: async () => {} };
  const available = async (id: ProjectId) => { const s = await project.api.resolveServiceOfProject(id); return Boolean(s && s.state !== 'deleting'); };
  const admission = gatewayDeletionRepository(db.db, { originals, processes, assertGrant: project.api.assertProjectDeletionGrant, assertAvailable: project.api.assertProjectAvailable, availableMany: project.api.availableProjectIds });
  const application = (extra: Partial<GatewayModuleDeps> = {}) => createGatewayModule({
    db: db.db, k8s: createFakeK8sClient(), originals, processes, projects: { ...project.api, available, availableMany: project.api.availableProjectIds }, hosts,
    services: { listServices: async () => (await project.api.listServices()).map(directory), getService: async (id) => service(id),
      resolveIdentity: service, resolveProjectSlug: async (slug) => { const s = await project.api.resolveServiceOfSlug(slug); return s ? directory(s) : undefined; },
      serviceIdOfProject: async (id) => (await project.api.resolveServiceOfProject(id))?.serviceId },
    slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }), notePreviewAccess: async () => {} },
    grants: { originalOperationProject: operation, grantedOperations: async () => ({ operations: [ids.operation, ids.otherOperation], defaultOpen: [ids.operation, ids.otherOperation],
      operationRoutes: [{ id: ids.operation, proxy: own.slug, method: 'GET', path: '/erase' }, { id: ids.otherOperation, proxy: other.slug, method: 'GET', path: '/keep' }] }), listCallers: async () => [], proxyNameOf: async () => undefined },
    access: { authorize: project.api.authorize, isMemberOrAdmin: async () => false }, users: { describe: async () => undefined }, isAdmin: async () => true,
    settings: { systemNamespace: 'system', serviceDomain: 'svc.test', userAuthMiddleware: 'user', serviceAuthMiddleware: 'service', dropIdentityHeadersMiddleware: 'drop', allowlistMaxStaleSeconds: 300, consumerName: 'gateway-delete-test' },
    ...extra,
  });
  const gateway = application(options.application), permit = fixturePermit(project.api, gateway.api.deletionOwner!, admin, own.id);
  return { db, identity, project, admin, own, other, ids, before, create, originals, admission, process, application, gateway, ...permit };
  } catch (error) { await db.drop(); throw error; }
}

export function fixturePermit(project: ReturnType<typeof createProjectModule>['api'], owner: NonNullable<ReturnType<typeof createGatewayModule>['api']['deletionOwner']>, admin: Actor, projectId: ProjectId) {
  const begin = async () => {
    const target = await project.deletionScope(projectId), report = await owner.inspect(target), metadata = await project.inspectProjectDeletionMetadata(projectId);
    // 其他 owner 空范围只供本模块许可测试，不代表实际平台清理通过。
    const reports: ProjectDeletionInventory[] = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'gateway' ? report : participant === 'project' ? metadata : { participant, revision: jsonHash(participant), complete: true, resources: [], references: [], blockers: [] });
    const plan = await project.prepareDeletionPlan(admin, projectId, reports);
    const operation = await project.acceptProjectDeletion(admin, projectId, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
    const claimed = (await project.claimProjectDeletion(operation.id, 'gateway-test'))!;
    const context: ProjectDeletionContext = { operationId: operation.id, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((p) => p.participant === 'gateway')!, phase: 'seal' };
    return { plan, operation, lease: claimed.lease, context };
  };
  const proceed = async (started: Awaited<ReturnType<typeof begin>>, through: ProjectDeletionPhase = 'verify') => {
    let progress = await project.readProjectDeletion(admin, started.operation.id);
    for (const phase of PROJECT_DELETION_PHASES.slice(0, PROJECT_DELETION_PHASES.indexOf(through) + 1)) {
      for (const participant of [...PROJECT_DELETION_PARTICIPANTS.filter((p) => p !== 'project'), 'project' as const]) {
        if (progress.receipts.some((r) => r.phase === phase && r.participant === participant)) continue;
        const handler = participant === 'gateway' ? owner : participant === 'project' ? project.deletionOwner : undefined;
        const context = { ...started.context, phase, confirmed: started.plan.participants.find((p) => p.participant === participant)! };
        const step = handler ? await handler.run(context) : { kind: 'done' as const, evidence: { kind: 'not-applicable' as const, digest: jsonHash({ participant, phase }), description: '其他 owner 空范围仅供本模块许可测试', count: 0 } };
        if (step.kind !== 'done') throw new Error(`Module cleanup ${participant}/${phase}: ${step.kind}`);
        progress = await project.recordProjectDeletionReceipt(started.lease, participant, phase, step.evidence);
      }
    }
  };
  return { begin, proceed };
}
export type GatewayDeletionFixture = Awaited<ReturnType<typeof gatewayDeletionFixture>>;
