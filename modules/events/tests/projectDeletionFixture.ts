import { BUILTIN_RESOURCES, PROJECT_DELETION_PARTICIPANTS, PROJECT_DELETION_PHASES } from '@crewstation/contracts';
import type { Actor, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase, ProjectId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { createEventsModule, eventsMigrations } from '../wiring';
import type { EventPusher } from '../ports/eventPusher';
import type { DeliveryProcessOwners } from '../ports/deliveryProcesses';

export async function eventsDeletionFixture() {
  const database = await createTestDatabase([eventbusMigrations, queueMigrations, identityMigrations, projectMigrations,
    { ...eventsMigrations, files: eventsMigrations.files.filter((f) => !f.name.startsWith('0006_')) }]);
  const identity = createIdentityModule({ db: database.db, settings: { adminEmails: ['events-delete@tests.invalid'] } });
  const user = await identity.api.ensureUser({ externalId: 'events-admin', name: 'Admin', email: 'events-delete@tests.invalid' });
  const admin: Actor = { userId: user.id, isAdmin: true };
  const project = createProjectModule({ db: database.db, identity: identity.api, hosts: { prodHost: (s) => `${s}.test`, previewHost: (s) => `preview.${s}.test`, serviceHost: (s) => `${s}.svc.test` },
    settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
  const make = (slug: string) => project.api.createProject(admin, { slug, name: slug, kind: 'EventProducer', template: BUILTIN_RESOURCES.minimalTemplate });
  const own = await make('events-delete'), other = await make('events-keep'), source = await make('events-source');
  const ids = { producer: newResourceId(), foreignProducer: newResourceId(), type: newResourceId(), foreignType: newResourceId(),
    subscription: newResourceId(), incoming: newResourceId(), foreignSubscription: newResourceId(), event: newResourceId(), foreignEvent: newResourceId(),
    delivery: newResourceId(), incomingDelivery: newResourceId(), foreignDelivery: newResourceId() };
  for (const [p, id, code] of [[own, ids.producer, 'erase-source'], [source, ids.foreignProducer, 'retain-source']] as const) {
    await database.db.execute(sql`INSERT INTO events.producers(id,name,producer,service_id,project_id,project_slug,service_identity,updated_at) VALUES (${id},${code},${code},${p.serviceId},${p.id},${p.slug},${`${p.slug}/${p.slug}`},now())`);
  }
  for (const [id, producer, code, p] of [[ids.type, ids.producer, 'erase.updated', own], [ids.foreignType, ids.foreignProducer, 'retain.updated', source]] as const) {
    await database.db.execute(sql`INSERT INTO events.event_types(id,name,state,event_type,producer_id,producer,producer_project,schema_ref) VALUES (${id},${code},'active',${code},${producer},${p === own ? 'erase-source' : 'retain-source'},${p.slug},${'private-schema'})`);
  }
  for (const [id, p, type, code, path] of [[ids.subscription, own, ids.foreignType, 'retain.updated', '/erase-handler'], [ids.incoming, other, ids.type, 'erase.updated', '/retain-handler'], [ids.foreignSubscription, other, ids.foreignType, 'retain.updated', '/unrelated-handler']] as const) {
    await database.db.execute(sql`INSERT INTO events.subscriptions(id,service_id,project_id,event_type_id,event_type,handler_path,state,updated_at) VALUES (${id},${p.serviceId},${p.id},${type},${code},${path},'active',now())`);
  }
  for (const [id, p, producer, type, code, payload] of [[ids.event, own, ids.producer, ids.type, 'erase.updated', 'erase-payload'], [ids.foreignEvent, source, ids.foreignProducer, ids.foreignType, 'retain.updated', 'retain-payload']] as const) {
    await database.db.execute(sql`INSERT INTO events.inbox(id,producer_id,producer,producer_project,event_type_id,event_type,dedup_key,occurred_at,received_at,trace_id,payload) VALUES (${id},${producer},${p === own ? 'erase-source' : 'retain-source'},${p.slug},${type},${code},${id},now(),now(),${id},${JSON.stringify({ private: payload })}::jsonb)`);
  }
  for (const [id, p, event, subscription, type, code, error] of [[ids.delivery, own, ids.foreignEvent, ids.subscription, ids.foreignType, 'retain.updated', 'erase-error'], [ids.incomingDelivery, other, ids.event, ids.incoming, ids.type, 'erase.updated', 'source-error'], [ids.foreignDelivery, other, ids.foreignEvent, ids.foreignSubscription, ids.foreignType, 'retain.updated', 'retain-error']] as const) {
    await database.db.execute(sql`INSERT INTO events.deliveries(id,event_id,subscription_id,service_id,project_id,event_type_id,event_type,state,attempts,next_attempt_at,last_error,trace_id,delivered_at,created_at,updated_at) VALUES (${id},${event},${subscription},${p.serviceId},${p.id},${type},${code},'pending',0,now(),${error},${event},null,now(),now())`);
  }
  await runMigrations(database.db, [eventsMigrations]);
  const directory = [own, other, source];
  const application = (pusher?: EventPusher, processes?: DeliveryProcessOwners) => createEventsModule({ db: database.db, projects: project.api,processes,
    services: { resolveService: async (id) => { const p = directory.find((p) => p.serviceId === id); return p ? { projectId: p.id, serviceId: id, slug: p.slug, identity: `${p.slug}/${p.slug}` } : undefined; } },
    endpoints: { resolve: async () => ({ baseUrl: 'http://receiver' }) }, pusher: pusher ?? { push: async () => ({ ok: false, error: 'simulated-receiver-unavailable' }) } });
  const events = application();
  const begin = async (projectId: ProjectId = own.id) => {
    const target = await project.api.deletionScope(projectId), report = await events.api.deletionOwner!.inspect(target), metadata = await project.api.inspectProjectDeletionMetadata(projectId);
    // 其他 owner 的空范围只是本模块授权夹具，不代表平台物理资源清理验收。
    const reports: ProjectDeletionInventory[] = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'events' ? report : participant === 'project' ? metadata
      : { participant, revision: jsonHash(participant), complete: true, resources: [], references: [], blockers: [] });
    const plan = await project.api.prepareDeletionPlan(admin, projectId, reports);
    const operation = await project.api.acceptProjectDeletion(admin, projectId, { planId: plan.id, requestKey: newResourceId(), confirm: 'delete' }, reports);
    const claimed = (await project.api.claimProjectDeletion(operation.id, 'events-delete-test'))!;
    const context: ProjectDeletionContext = { operationId: operation.id, generation: claimed.lease.generation, target: plan.target, confirmed: plan.participants.find((p) => p.participant === 'events')!, phase: 'seal' };
    return { plan, operation, lease: claimed.lease, context };
  };
  const proceed = async (started: Awaited<ReturnType<typeof begin>>, through: ProjectDeletionPhase) => {
    let progress = await project.api.readProjectDeletion(admin,started.operation.id);
    for (const phase of PROJECT_DELETION_PHASES.slice(0,PROJECT_DELETION_PHASES.indexOf(through)+1)) {
      for (const participant of [...PROJECT_DELETION_PARTICIPANTS.filter((p) => p !== 'project'),'project' as const]) {
        if (progress.receipts.some((r) => r.phase === phase && r.participant === participant)) continue;
        const owner = participant === 'events' ? events.api.deletionOwner : participant === 'project' ? project.api.deletionOwner : undefined;
        const context = { ...started.context,phase,confirmed: started.plan.participants.find((p) => p.participant === participant)! };
        const step = owner ? await owner.run(context) : { kind: 'done' as const,evidence: { kind: 'not-applicable' as const,digest: jsonHash({ participant,phase }),description: '其他 owner 空范围，仅用于本模块许可测试',count: 0 } };
        if (step.kind !== 'done') throw new Error(`Module cleanup ${participant}/${phase}: ${step.kind}`);
        progress = await project.api.recordProjectDeletionReceipt(started.lease,participant,phase,step.evidence);
      }
    }
  };
  return { database, project, own, other, source, ids, admin, application, events, begin, proceed };
}
export type EventsDeletionFixture = Awaited<ReturnType<typeof eventsDeletionFixture>>;
