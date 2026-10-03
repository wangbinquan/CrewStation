import { describe, expect, test } from 'bun:test';
import type { BusinessControlDto, BusinessTaskV3Dto } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { drizzleSubtaskRepository } from '../../adapters/persistence/drizzleRepositories';
import { executionHttpFixture } from '../executionHttpFixture';
import { businessOwnerFixture } from './ownerFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('sealed business project leaves every scheduling queue (actual PostgreSQL/module)', () => {
  test('closed private bodies remain byte-identical while an unrelated original admission progresses', async () => {
    const f = await businessOwnerFixture();
    try {
      await f.seed();
      for (const state of ['running', 'pending', 'succeeded']) await f.database.db.execute(sql`
        INSERT INTO business_task.subtasks(id,task_id,name,kind,state,attempt,spec,created_at)
        VALUES(${newResourceId()},${f.task},'sealed candidate','command',${state},1,${JSON.stringify({ execution: { taskId: f.home, released: false } })}::jsonb,now())`);
      await f.database.db.execute(sql`UPDATE business_task.finalizations SET phase='requested' WHERE service_id=${f.serviceId}`);
      await f.database.db.execute(sql`UPDATE business_task.recovery_requests SET state='running' WHERE service_id=${f.serviceId}`);
      await f.database.db.execute(sql`UPDATE business_task.execution_cancellations SET state='pending' WHERE service_id=${f.serviceId}`);
      await f.database.db.execute(sql`UPDATE business_task.execution_lifecycles SET state='pending' WHERE service_id=${f.serviceId}`);
      await f.database.db.execute(sql`UPDATE business_task.execution_messages SET state='pending' WHERE service_id=${f.serviceId}`);
      const confirmed = await f.owner().inspect(f.target);
      expect(confirmed.complete).toBe(true);
      expect((await f.owner().run(f.context(confirmed))).kind).toBe('done');
      const before = (await f.repo().inspect(f.target)).scope.contents;
      const legacy = drizzleSubtaskRepository(f.database.db);
      expect(await legacy.listActive(200)).toEqual([]);
      expect(await legacy.listPendingExecutions(200)).toEqual([]);
      expect(await legacy.listUnreleasedExecutions(200)).toEqual([]);

      const other = await executionHttpFixture(f.database.db); f.bind(other.serviceId, other.projectId);
      const mounted = other.make({ deletionWorkSources: f.sources }), instanceId = newResourceId();
      const lease = await (await mounted.request('/v3/business-execution/control/claim', { instanceId })).json() as BusinessControlDto;
      const fence = { instanceId, epoch: lease.epoch, leaseId: lease.leaseId! };
      expect((await mounted.request('/v3/business-execution/control/activate', { instanceId, leaseId: fence.leaseId, expectedEpoch: fence.epoch, preparationDigest: 'a'.repeat(64) })).status).toBe(200);
      other.behavior.unknown = true;
      const accepted = await mounted.request('/v3/business-tasks', { requestKey: 'healthy-after-seal', taskContractVersion: 'v1', fence });
      expect(accepted.status).toBe(202); const task = await accepted.json() as BusinessTaskV3Dto;
      other.behavior.unknown = false;
      await mounted.module.api.v3.runOnce();
      expect(other.behavior.starts).toBe(1); expect(other.environments.has(task.id)).toBe(true);
      expect((await f.repo().inspect(f.target)).scope.contents).toEqual(before);
      for (const birth of await mounted.module.projectWork!.history(other.projectId)) if (!birth.exited) await f.waitExit(birth.id);
    } finally { await f.drop(); }
  });
});
