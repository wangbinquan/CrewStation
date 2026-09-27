import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ManifestSchema } from '@crewstation/contracts';
import type { BusinessControlDto, ReleaseId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';
import { executionHttpFixture } from './executionHttpFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 release reverse handoff boundary', () => {
  let tdb: TestDatabase;
  beforeEach(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterEach(async () => { await tdb?.drop(); });
  async function target(f: Pick<Awaited<ReturnType<typeof executionHttpFixture>>, 'module' | 'projectId' | 'serviceId' | 'taskProfileId' | 'sources'>, accepted: string[]) {
    const releaseId = newResourceId() as ReleaseId;
    await f.module.api.registerContracts({ occurredAt: new Date().toISOString(), projectId: f.projectId, serviceId: f.serviceId, releaseId, tag: releaseId, commitSha: 'b'.repeat(40), manifest: ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: {
      service: { command: ['bun'], port: 3000, servicePlanId: newResourceId() }, tasks: { taskProfileId: f.taskProfileId, executionControl: 'fenced', acceptedTaskContractVersions: accepted, defaultVolumeMode: 'persistent' },
    } }) });
    f.sources.set('target', { ...f.sources.get('trusted')!, slot: 'preview', source: { ...f.sources.get('trusted')!.source, podUid: 'target-pod', releaseId, physicalSlot: 'green' } });
    return releaseId;
  }
  test('incompatible target never freezes; compatible target requires authenticated preparation, observed route and activation', async () => {
    const f = await executionCommandFixture(tdb.db), bad = await target(f, ['v2']), api = f.module.api.releaseHandoff;
    expect(await api.precheck(f.serviceId, bad)).toEqual({ supported: false, blocked: [{ taskId: f.task.id, taskContractVersion: 'v1' }] });
    await expect(api.freeze(f.serviceId, { operationId: newResourceId(), expectedActiveReleaseId: f.releaseId, targetReleaseId: bad, targetSlot: 'green' })).rejects.toMatchObject({ details: { code: 'task_contract_unsupported' } });
    expect((await f.request('/v3/business-execution/control')).status).toBe(200);
    const good = await target(f, ['v1']), request = { operationId: newResourceId(), expectedActiveReleaseId: f.releaseId, targetReleaseId: good, targetSlot: 'green' as const };
    expect(await api.freeze(f.serviceId, request)).toMatchObject({ stage: 'frozen', quiescent: true, operationId: request.operationId });
    expect(await api.inspect(f.serviceId)).not.toHaveProperty('leaseId');
    await expect(api.routeObserved(f.serviceId, request)).rejects.toMatchObject({ kind: 'precondition' });
    const controlPath = '/v3/business-execution/control', instanceId = newResourceId();
    const claimed = await (await f.request(`${controlPath}/claim`, { instanceId }, 'target')).json() as BusinessControlDto;
    const ready = { instanceId, expectedEpoch: claimed.epoch, leaseId: claimed.leaseId!, preparationDigest: 'a'.repeat(64) };
    expect((await f.request(`${controlPath}/handoffs/${request.operationId}/ready`, { ...ready, operationId: request.operationId, acceptedTaskContractVersions: ['v1'] }, 'target')).status).toBe(200);
    expect(await api.inspect(f.serviceId)).toMatchObject({ stage: 'prepared', preparationDigest: ready.preparationDigest });
    expect((await f.request(`${controlPath}/activate`, ready, 'target')).status).toBe(412);
    await api.routeObserved(f.serviceId, request);
    expect((await f.request(`${controlPath}/activate`, ready, 'target')).status).toBe(200);
    expect(await api.inspect(f.serviceId)).toMatchObject({ stage: 'complete', targetReleaseId: good });
    expect(await api.routeObserved(f.serviceId, request)).toMatchObject({ stage: 'complete' });
  });
  test('first controlled handoff can freeze a service that has not claimed a lease', async () => {
    const f = await executionHttpFixture(tdb.db), releaseId = await target(f, ['v1']);
    const request = { operationId: newResourceId(), expectedActiveReleaseId: f.releaseId, targetReleaseId: releaseId, targetSlot: 'green' as const };
    const frozen = await f.module.api.releaseHandoff.freeze(f.serviceId, request);
    expect(frozen).toMatchObject({ stage: 'frozen', quiescent: true });
    expect(await f.module.api.releaseHandoff.freeze(f.serviceId, request)).toEqual(frozen);
    expect((await f.request('/v3/business-execution/control/claim', { instanceId: newResourceId() })).status).toBe(403);
  });
});
