import { BUILTIN_RESOURCES, IDENTITY_HEADERS } from '@crewstation/contracts';
import type { AcceptProjectDeletion, Actor, ProjectDeletionPlan, ProjectDto } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import { createProjectModule, projectMigrations } from '@crewstation/module-project';
import { createApp } from '@crewstation/http';
import { newId, noopLogger } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import type { ProjectDeletionIntents } from '../ports/projectDeletions';
import { projectDeletionController } from '../application/deletion/controller';
import { projectDeletionRoutes } from '../http/projectDeletionRoutes';
import { statefulDeletionOwners } from './deletionOwnersFixture';

export async function deletionFixture() {
  const database = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]);
  const identity = createIdentityModule({ db: database.db, settings: { adminEmails: [] } });
  const first = await identity.api.ensureUser({ externalId: 'admin', name: 'Admin', email: 'admin@test.invalid' });
  const second = await identity.api.ensureUser({ externalId: 'member', name: 'Member', email: 'member@test.invalid' });
  const developer = await identity.api.setPlatformRole(second.id, { expectedRole: 'user', platformRole: 'developer' });
  const admin: Actor = { userId: first.id, isAdmin: true }, member: Actor = { userId: developer.id, isAdmin: false };
  let offset = 0, sequence = 0, queueUnavailable = false;
  const project = createProjectModule({ db: database.db, identity: identity.api, clock: { now: () => new Date(Date.now() + offset) },
    hosts: { prodHost: (s) => `${s}.test.invalid`, previewHost: (s) => `preview.${s}.test.invalid`, serviceHost: (s) => `${s}.service.test.invalid` },
    settings: { defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall, defaultMaxConcurrentTasks: 3 } });
  const api = project.api;
  const intents: ProjectDeletionIntents = {
    scope: api.deletionScope, prepare: api.prepareDeletionPlan, accept: api.acceptProjectDeletion, replay: api.replayProjectDeletion,
    read: api.readProjectDeletion, find: api.findProjectDeletion, retry: api.retryProjectDeletion, claim: api.claimProjectDeletion, renew: api.renewProjectDeletion,
    prepareReconfirmation: api.prepareProjectDeletionReconfirmation, replayReconfirmation: api.replayProjectDeletionReconfirmation, reconfirm: api.reconfirmProjectDeletion,
    defer: api.deferProjectDeletion, receipt: api.recordProjectDeletionReceipt, block: api.blockProjectDeletion,
    complete: api.completeProjectDeletion, pending: api.listPendingProjectDeletions,
  };
  const external = statefulDeletionOwners(api), queued: string[] = [];
  const controller = projectDeletionController({ intents, owners: external.owners, isAdmin: identity.api.isAdmin, logger: noopLogger,
    workerOwner: 'deletion-test', enqueue: async (id) => { if (queueUnavailable) throw new Error('queue unavailable'); queued.push(id); } });
  const http = createApp({ name: 'deletion-test' }).route('/', projectDeletionRoutes(controller, identity.api.isAdmin));
  const create = async (): Promise<ProjectDto> => {
    const value = await api.createProject(admin, { slug: `delete-controller-${++sequence}`, name: '完整清理', kind: 'DigitalWorker', ownerUserId: member.userId, template: BUILTIN_RESOURCES.minimalTemplate });
    external.add(value.id); return value;
  };
  const input = (plan: ProjectDeletionPlan): AcceptProjectDeletion => ({ planId: plan.id, requestKey: newId('request'), confirm: 'delete' });
  const start = async () => {
    const value = await create(), plan = await controller.prepare(admin, value.id), request = input(plan);
    return { value, plan, request, operation: await controller.accept(admin, value.id, request) };
  };
  const call = (path: string, method = 'GET', body?: unknown, actor: Actor | null = admin) => http.request(path, {
    method, headers: { 'content-type': 'application/json', ...(actor ? { [IDENTITY_HEADERS.userId]: actor.userId } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { database, api, admin, member, intents, external, controller, create, start, input, call, queued,
    elapse: (milliseconds: number) => { offset += milliseconds; }, queueAvailable: (available: boolean) => { queueUnavailable = !available; } };
}
export type DeletionFixture = Awaited<ReturnType<typeof deletionFixture>>;
