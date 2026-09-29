import { expect, test } from 'bun:test';
import { BusinessTaskV3DtoSchema, ExecutionObservationIdentitySchema, ComputeProfileListSchema, ProjectIdSchema, UserIdSchema } from '@crewstation/contracts';
import { businessObservationAdmission, observationNames, observationPorts, observationSlotRecords, observationUsageSource } from './observationPorts';

const id = (n: number) => '01a0bf5d-8f4b-7111-8111-' + String(n).padStart(12, '0');
const task = BusinessTaskV3DtoSchema.parse({ id: id(1), serviceId: id(2), state: 'running', releaseId: id(3),
  taskContractVersion: '3', contractDigest: 'a'.repeat(64), generation: 1, volumeMode: 'persistent', volumeUid: 'volume',
  taskProfileId: id(4), traceId: 'a'.repeat(32), labels: {}, resourceState: 'ready', quotaHeld: true, createdAt: '2026-09-28T00:00:00Z' });
const actor = { userId: UserIdSchema.parse(id(5)), isAdmin: true };

test('observation wiring resolves the task owner before its project and projects current pricing profile revisions', async () => {
  const calls: unknown[] = [];
  const profile = { id: id(6), name: 'model', protocol: 'opencode', description: '', enabled: true, isDefault: false, revision: 3,
    image: 'runtime', imageDigest: 'digest', binaryPath: 'opencode', availability: { state: 'ready', available: true }, updatedBy: actor.userId, updatedAt: '2026-09-28T00:00:00Z' };
  const ports = observationPorts({ getTask: async (...args) => { calls.push(args); return task; } },
    { resolveServiceById: async (...args) => { calls.push(args); return { projectId: ProjectIdSchema.parse(id(7)), serviceId: task.serviceId, slug: 'project', name: 'Project', identity: 'project/service', namespace: 'project', kind: 'DigitalWorker', state: 'active' }; } },
    { listProfiles: async (...args) => { calls.push(args); return ComputeProfileListSchema.parse({ items: [profile, { ...profile, id: id(8), model: 'actual/model' }] }); } });
  const caller = { identity: 'project/service' };
  expect(await ports.executionAccess!.task(caller, task.id)).toEqual({ projectId: ProjectIdSchema.parse(id(7)), taskId: task.id });
  expect(await ports.pricingProfiles!.list(actor)).toEqual([
    { id: id(6), name: 'model', revision: 3, protocol: 'opencode', model: null },
    { id: id(8), name: 'model', revision: 3, protocol: 'opencode', model: 'actual/model' },
  ]);
  expect(calls).toEqual([[caller, task.id], [task.serviceId], [actor]]);
});

test('an unresolved task service reports incomplete platform state', async () => {
  const ports = observationPorts({ getTask: async () => task }, { resolveServiceById: async () => undefined }, { listProfiles: async () => ({ items: [] }) });
  await expect(ports.executionAccess!.task({ identity: 'project/service' }, task.id)).rejects.toMatchObject({ kind: 'precondition' });
});

test('business observation participant resolves the composed owner at call time and preserves immutable identity', async () => {
  let owner: Parameters<typeof businessObservationAdmission>[0] extends () => infer T ? T : never = undefined;
  const port = businessObservationAdmission(() => owner), calls: unknown[] = [];
  const input = { identity: ExecutionObservationIdentitySchema.parse({ projectId: id(1), taskId: id(2), subtaskId: id(3), executionId: id(4), executionGeneration: 2 }), profile: null };
  await expect(port.accept(input)).rejects.toMatchObject({ kind: 'precondition' });
  owner = { acceptExecutionPrice: async (value) => { calls.push(value); return { ...value, acceptedAt: '2026-09-28T00:00:00Z', priceBookRevision: 0 }; } };
  await port.accept(input); expect(calls).toEqual([input]);
});

test('observation slot records preserve bounded owner filters and history', async () => {
  const calls: unknown[] = [];
  const records = observationSlotRecords({ list: async (...args) => {
    calls.push(args); const at = new Date('2026-09-28T00:00:00Z');
    return [{ display: { physical: 'blue' }, children: [], conditions: [], phaseSince: at },
      { display: {} as Record<string, string>, children: [], conditions: [], phaseSince: at }];
  } });
  const projectId = ProjectIdSchema.parse(id(7));
  expect(await records.slotRecords(projectId)).toEqual([
    { physical: 'blue', children: [], conditions: [], phaseSince: '2026-09-28T00:00:00.000Z' },
    { physical: '', children: [], conditions: [], phaseSince: '2026-09-28T00:00:00.000Z' },
  ]);
  expect(calls).toEqual([[{ projectId, kind: 'service-slot', includeStopped: true }]]);
});


test('numeric projection wiring preserves both owner resolution and journal acknowledgement', async () => {
  const calls: unknown[] = [], owner = ExecutionObservationIdentitySchema.parse({ projectId: id(1), taskId: id(2), subtaskId: id(3), executionId: id(4), executionGeneration: 1 });
  const input = { runtimeTaskId: task.id, executionId: owner.executionId, attempt: 1, incarnation: id(8), payloadDigest: 'a'.repeat(64) };
  const source = observationUsageSource({ resolveUsageSource: async (value) => { calls.push(value); return owner; } },
    { readBusinessUsageMeasurement: async () => undefined, nextBusinessUsageSource: async () => { calls.push('next'); return undefined; }, acknowledgeBusinessUsageSource: async (...args) => { calls.push(args); } });
  expect(await source.next()).toBeUndefined(); expect(await source.resolve(input)).toEqual(owner);
  await source.acknowledge(task.id, owner.executionId, 12); expect(calls).toEqual(['next', input, [task.id, owner.executionId, 12]]);
});


test('name metadata is fetched once from each owning catalog and indexed by stable IDs', async () => {
  const calls: string[] = [], read = observationNames({
    projects: { listClusterProjects: async () => { calls.push('projects'); return [{ projectId: id(1), name: 'Project display' }]; } },
    profiles: { listDisplayNames: async () => { calls.push('profiles'); return [{ id: id(2), name: 'Compute display' }]; } },
  });
  expect(await read()).toEqual({ projects: { [id(1)]: 'Project display' }, profiles: { [id(2)]: 'Compute display' } });
  expect(calls.sort()).toEqual(['profiles', 'projects']);
});
