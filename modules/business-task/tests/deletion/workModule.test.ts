import { describe, expect, test } from 'bun:test';
import type { BusinessControlDto, BusinessTaskV3Dto } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { executionHttpFixture } from '../executionHttpFixture';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('business dispatch lifetime factory (real HTTP and PG; controlled Project/TaskRuntime ports)', () => {
  test('the module mounts original callback admission for both HTTP dispatch and the real recovery worker', async () => {
    const f = await businessWorkFixture();
    try {
      const business = await executionHttpFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      expect(business.module.projectWork).toBeUndefined();
      const mounted = business.make({ deletionWorkSources: f.sources }); expect(mounted.module.projectWork).toBeDefined();
      const instanceId = newResourceId(), root = '/v3/business-execution/control';
      const claimed = await mounted.request(root + '/claim', { instanceId }); expect(claimed.status).toBe(200);
      const lease = await claimed.json() as BusinessControlDto;
      const active = await mounted.request(root + '/activate', { instanceId, expectedEpoch: lease.epoch, leaseId: lease.leaseId, preparationDigest: 'a'.repeat(64) });
      expect(active.status).toBe(200);
      const fence = { instanceId, epoch: lease.epoch, leaseId: lease.leaseId };
      business.behavior.unknown = true;
      const accepted = await mounted.request('/v3/business-tasks', { requestKey: 'original', taskContractVersion: 'v1', fence });
      expect(accepted.status).toBe(202); const task = await accepted.json() as BusinessTaskV3Dto;
      const initial = await mounted.module.projectWork!.history(business.projectId);
      const [birth] = initial.filter((row) => row.kind === 'task-admission');
      expect(initial.filter((row) => row.kind === 'service-api')).toHaveLength(3);
      expect(birth).toMatchObject({ projectId: business.projectId, serviceId: business.serviceId, kind: 'task-admission', exited: true, recoveryDigest: null });
      business.behavior.unknown = false;
      await mounted.module.api.v3.runOnce();
      const history = await mounted.module.projectWork!.history(business.projectId);
      const admissions = history.filter((row) => row.kind === 'task-admission');
      expect(admissions).toHaveLength(2); expect(history.every((row) => row.exited)).toBe(true);
      expect(new Set(admissions.map((row) => row.reference))).toEqual(new Set([birth!.reference]));
      expect(new Set(history.map((row) => row.consumerId)).size).toBe(5); expect(business.behavior.starts).toBe(1);
      const response = await mounted.request('/v3/business-tasks/' + task.id); expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: task.id, state: 'creating' });
    } finally { await f.drop(); }
  });
});
