import { describe, expect, test } from 'bun:test';
import type { ClusterOperation } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory, runMigrations, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { clusterManagementMigrations, createClusterManagementModule } from '../wiring';
import { drizzleClusterRepository } from '../adapters/persistence/drizzleRepository';
import { drizzleMetricsRepository } from '../adapters/persistence/metricsRepository';
import { metricsFixture } from './metricsFixture';
import { admin } from './inventoryFixture';

const available = await testDatabaseAvailable();
async function fixture(upgrade = false) {
  const database = await createTestDatabase([queueMigrations, upgrade ? { ...clusterManagementMigrations,
    files: clusterManagementMigrations.files.filter((file) => file.name < '0008_') } : clusterManagementMigrations]);
  const unused = new Proxy({}, { get: (_target, name) => () => { throw new Error('Origin read called ' + String(name)); } });
  const module = createClusterManagementModule({ db: database.db, k8s: createFakeK8sClient(), metadata: unused, domains: unused,
    isAdmin: async () => true, authorizeProject: async () => {}, systemNamespace: 'crewstation-system', instance: 'origin-reader', catalog: [] } as unknown as Parameters<typeof createClusterManagementModule>[0]);
  const source = metricsFixture(), repository = drizzleClusterRepository(database.db), metrics = drizzleMetricsRepository(database.db);
  const target = source.inventory.resources.find((resource) => resource.ownership.scope === 'project')!;
  const operation: ClusterOperation = { operationId: newResourceId(), inspectionId: newResourceId(), idempotencyKey: newResourceId(), actorId: admin.userId,
    action: 'delete', target, params: { action: 'delete' }, phase: 'succeeded', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    durationMs: 0, traceId: '1'.repeat(32), httpStatus: 200, reason: 'private reason' };
  return { database, module, repository, metrics, operation };
}
describe.skipIf(!available)('cluster original infrastructure ownership (actual PG)', () => {
  test('replacement preserves every actual platform request; operations retain original project IDs after content purge', async () => {
    const f = await fixture();
    try {
      const read = f.module.api.originalInfrastructureOwnership;
      const refreshId = await f.repository.requestRefresh();
      const refresh = await read('cluster-refresh', refreshId);
      expect(refresh).toMatchObject({ id: refreshId, scope: 'platform', projectIds: [] });
      await f.repository.finishRefresh(refreshId); await f.repository.requestRefresh();
      expect(await read('cluster-refresh', refreshId)).toEqual(refresh);
      for (const kind of ['metrics', 'storage'] as const) {
        await f.metrics.schedule(kind);
        const old = (await f.database.db.execute<{ request_id: string }>(sql`SELECT request_id FROM cluster_management.metric_collectors WHERE kind=${kind}`))[0]!.request_id;
        const origin = await read(`cluster-${kind}`, old);
        expect(origin).toMatchObject({ id: old, scope: 'platform', projectIds: [] });
        await f.database.db.execute(sql`UPDATE cluster_management.metric_collectors SET requested_at=now()-interval '1 day' WHERE kind=${kind}`);
        await f.metrics.schedule(kind);
        expect(await read(`cluster-${kind}`, old)).toEqual(origin);
        expect(await read(`cluster-${kind}`, newResourceId())).toBeUndefined();
      }
      await f.repository.accept(f.operation, 'private-request-hash');
      const origin = await read('cluster-operation', f.operation.operationId);
      const projectId = f.operation.target.ownership.scope === 'project' ? f.operation.target.ownership.projectId : undefined;
      expect(origin).toMatchObject({ id: f.operation.operationId, scope: 'project', projectIds: [projectId] });
      await withSharedDatabaseAdmission(f.database.db, 'runtime-original-source-test:' + projectId, async () => {
        expect(await read('cluster-operation', f.operation.operationId)).toEqual(origin);
      });
      const directory = resourceIdentityDirectory(f.database.db, () => [clusterManagementMigrations]);
      await directory.bind('cluster_management', 'cluster-operation', ['private-old-operation'], f.operation.operationId);
      expect(await read('cluster-operation', 'private-old-operation', 'legacy')).toEqual(origin);
      expect(await read('cluster-refresh', refreshId, 'legacy')).toEqual(refresh);
      expect(await read('cluster-operation', 'unknown-operation', 'legacy')).toBeUndefined();
      await expect(read('cluster-operation', f.operation.operationId, 'unknown' as never)).rejects.toThrow('未登记');
      for (const value of ['private reason', 'private-request-hash', 'private-old-operation', f.operation.target.name]) expect(JSON.stringify(origin)).not.toContain(value);
      await f.database.db.execute(sql`DELETE FROM cluster_management.operations WHERE id=${f.operation.operationId}`);
      expect(await read('cluster-operation', f.operation.operationId)).toEqual(origin);
      for (const statement of [sql`UPDATE cluster_management.infrastructure_origins SET material='{"scope":"platform"}' WHERE kind='cluster-operation'`,
        sql`DELETE FROM cluster_management.infrastructure_origins`, sql`TRUNCATE cluster_management.infrastructure_origins`,
        sql`INSERT INTO cluster_management.infrastructure_origins VALUES('cluster-metrics',${newResourceId()},'{"scope":"platform"}')`]) {
        await expect(Promise.resolve(f.database.db.execute(statement))).rejects.toThrow();
      }
      expect(await read('cluster-operation', f.operation.operationId)).toEqual(origin);
    } finally { await f.database.drop(); }
  });
  test('upgrade preserves original bodies, records explicit scope, and leaves missing or unresolved history unknown', async () => {
    const f = await fixture(true);
    try {
      await f.repository.accept(f.operation, 'private-original');
      await f.metrics.schedule('metrics');
      const before = await f.database.db.execute(sql`SELECT * FROM cluster_management.operations`);
      await runMigrations(f.database.db, [clusterManagementMigrations]);
      expect([...(await f.database.db.execute(sql`SELECT * FROM cluster_management.operations`))]).toEqual([...before]);
      const read = f.module.api.originalInfrastructureOwnership;
      expect(await read('cluster-operation', f.operation.operationId)).toMatchObject({ scope: 'project' });
      expect(await read('cluster-metrics', newResourceId())).toBeUndefined();
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE cluster_management.operations SET body=jsonb_set(body,'{target,ownership,projectId}',to_jsonb(${newResourceId()}::text)) WHERE id=${f.operation.operationId}`))).rejects.toThrow();
      const unresolved = { ...f.operation, operationId: newResourceId(), idempotencyKey: newResourceId(), target: { ...f.operation.target,
        ownership: { scope: 'unresolved' as const, reason: 'private missing fact' } } };
      await f.repository.accept(unresolved, 'unresolved');
      expect(await read('cluster-operation', unresolved.operationId)).toBeUndefined();
    } finally { await f.database.drop(); }
  });
});
