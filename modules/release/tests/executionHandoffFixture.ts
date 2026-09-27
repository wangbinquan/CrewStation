import type { Actor, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { ManifestSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { releaseHandoffUseCases } from '../application/execution/handoff';
import { switchTrafficUseCase } from '../application/switchTraffic';
import type { Release } from '../domain/release';
import { initialSlots, withSlot } from '../domain/slots';
import type { ExecutionHandoff, HandoffAuthority } from '../ports/executionHandoff';
import { releaseMigrations } from '../wiring';

export async function executionHandoffFixture(initial = false) {
  const database = await createTestDatabase([eventbusMigrations, releaseMigrations]), uow = drizzleUnitOfWork(database.db);
  const serviceId = newResourceId() as ServiceId, projectId = newResourceId() as ProjectId, actor: Actor = { userId: newResourceId() as UserId, isAdmin: true };
  const now = new Date('2026-09-27T00:00:00Z');
  const manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: { service: { command: ['bun'], port: 3000, servicePlanId: newResourceId() }, tasks: { taskProfileId: newResourceId(), executionControl: 'fenced', acceptedTaskContractVersions: ['v1'] } } });
  const release = (targetSlot: 'blue' | 'green', nth: number): Release => ({ id: newResourceId() as ReleaseId, serviceId, projectId, manifest, targetSlot, tag: `v0.0.${nth}`, commitSha: 'a'.repeat(40), branch: 'main', status: 'ready', pipeline: { step: 1 }, createdBy: actor.userId, createdAt: new Date(now.getTime() + nth), updatedAt: now });
  const old = release('blue', 1), target = release('green', 2);
  await uow.read.releases.insert(old); await uow.read.releases.insert(target);
  let slots = initialSlots(serviceId, now);
  if (!initial) slots = withSlot(slots, { ...slots.blue, releaseId: old.id, state: 'ready', replicas: 1, readyReplicas: 1 }, now);
  slots = withSlot(slots, { ...slots.green, releaseId: target.id, state: 'ready', replicas: 1, readyReplicas: 1 }, now);
  await uow.read.slots.initialize(slots);
  const state = { compatible: true, quiescent: false, routed: false, window: true, fail: undefined as string | undefined, freezeCalls: 0, routeCalls: 0,
    authority: { epoch: 1, stage: 'inactive', quiescent: false } as HandoffAuthority };
  const executionHandoff: ExecutionHandoff = {
    precheck: async () => ({ supported: state.compatible, blocked: state.compatible ? [] : [{ taskId: 'task', taskContractVersion: 'v1' }] }),
    freeze: async (_id, request) => {
      state.freezeCalls++;
      if (!state.authority.operationId) state.authority = { ...request, epoch: 2, stage: 'frozen', quiescent: state.quiescent };
      state.authority.quiescent = state.quiescent;
      if (state.fail) throw new Error(state.fail);
      return state.authority;
    },
    inspect: async () => state.authority,
    observeRoute: async () => state.routed,
    routeObserved: async () => { state.routeCalls++; state.authority.stage = 'routed'; return state.authority; },
  };
  const deps = { uow, executionHandoff, services: { resolveServiceById: async () => ({ projectId, slug: 'handoff', name: 'handoff', namespace: 'cs-handoff' }) }, authorizer: { authorize: async () => {} }, clock: { now: () => now }, maintenance: { open: async () => state.window } };
  const input = { toSlot: 'preview' as const, expectedActiveRelease: initial ? null : old.id, expectedTargetRelease: target.id, requestKey: newResourceId() };
  const start = () => switchTrafficUseCase(deps)(actor, serviceId, input);
  const worker = () => releaseHandoffUseCases(deps);
  const prepared = () => { state.quiescent = true; state.authority = { ...state.authority, stage: 'prepared', quiescent: true, preparationDigest: 'a'.repeat(64) }; };
  return { database, uow, serviceId, actor, old, target, state, deps, input, start, worker, prepared, close: () => database.drop() };
}
