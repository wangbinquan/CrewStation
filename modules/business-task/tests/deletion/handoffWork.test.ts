import { describe, expect, test } from 'bun:test';
import type { BusinessControlDto, ReleaseId } from '@crewstation/contracts';
import { ManifestSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { executionHttpFixture } from '../executionHttpFixture';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('release handoff shares original business request lifetime (actual PostgreSQL/module)', () => {
  test('both the internal handoff and held object-control delivery remain pending until their private finally; late reply cannot ACK', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pending: Promise<unknown> | undefined;
    try {
      const business = await executionHttpFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      const instanceId = newResourceId(), lease = await (await business.request('/v3/business-execution/control/claim', { instanceId })).json() as BusinessControlDto;
      expect((await business.request('/v3/business-execution/control/activate', { instanceId, leaseId: lease.leaseId, expectedEpoch: lease.epoch, preparationDigest: 'a'.repeat(64) })).status).toBe(200);
      const targetReleaseId = newResourceId() as ReleaseId;
      await business.module.api.registerContracts({ projectId: business.projectId, serviceId: business.serviceId, releaseId: targetReleaseId, occurredAt: new Date().toISOString(), tag: 'next', commitSha: 'b'.repeat(40),
        manifest: ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: { service: { command: ['bun'], port: 3000, servicePlanId: newResourceId() }, tasks: { taskProfileId: business.taskProfileId, executionControl: 'fenced', acceptedTaskContractVersions: ['v1'] } } }) });
      const mounted = business.make({ deletionWorkSources: { ...f.sources, assertGrant: async () => undefined }, storageControl: { apply: async () => { entered.resolve(); await release.promise; return true; } } });
      pending = mounted.module.api.releaseHandoff.freeze(business.serviceId, { operationId: newResourceId(), expectedActiveReleaseId: business.releaseId, targetReleaseId, targetSlot: 'green' });
      const rejected = pending.catch((error: unknown) => error); await entered.promise;
      const births = (await mounted.module.projectWork!.history(business.projectId)).filter((row) => !row.exited);
      expect(births.map((row) => row.kind).sort()).toEqual(['lifecycle', 'service-api']);
      await f.database.db.execute(sql`SELECT pg_terminate_backend(${births[0]!.backendPid})`); expect(await rejected).toBeInstanceOf(Error);
      const context = f.context();
      expect([...(await mounted.module.projectWork!.seal({ ...context, target: { ...context.target, id: business.projectId, serviceId: business.serviceId } })).pending].sort()).toEqual(births.map((row) => row.id).sort());
      release.resolve(); for (const birth of births) await f.waitExit(birth.id);
      expect(await f.database.db.execute(sql`SELECT service_id FROM business_task.storage_control_outbox WHERE service_id=${business.serviceId}`)).toHaveLength(1);
      expect((await mounted.module.projectWork!.history(business.projectId)).every((row) => row.exited)).toBe(true);
    } finally { release.resolve(); await pending?.catch(() => undefined); await f.drop(); }
  });
});
