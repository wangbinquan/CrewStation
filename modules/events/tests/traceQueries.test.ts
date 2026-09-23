import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { DeliveryState, EventId, ProjectId, ServiceId, TraceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newId } from '@crewstation/kernel';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleDeliveryRepository } from '../adapters/persistence/drizzleDeliveryRepositories';
import type { Delivery } from '../domain/delivery';
import type { EventsModule } from '../wiring';
import { createEventsModule, eventsMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase, events: EventsModule;
const project = '01a0bf5d-8f4b-7b01-8b95-1301eee8667f' as ProjectId, other = '01a0bf5d-8f4b-7b02-8b95-1301eee8667f' as ProjectId;
const trace = (n: number) => n.toString(16).padStart(32, '0') as TraceId;
const at = (minute: number, ms = 0) => new Date(Date.UTC(2026, 8, 23, 10, minute, 0, ms));

function delivery(input: { traceId: TraceId; created: Date; state: DeliveryState; updated?: Date; projectId?: ProjectId }): Delivery {
  return {
    id: newId('delivery'), eventId: newId('event') as EventId, subscriptionId: newId('subscription'), serviceId: newId('service') as ServiceId, projectId: input.projectId ?? project,
    eventTypeId: newId('type'), eventType: 'gitlab.push', state: input.state, attempts: input.state === 'pending' ? 0 : 1, traceId: input.traceId,
    ...(input.state === 'delivered' ? { deliveredAt: input.updated ?? input.created } : {}), ...(input.state === 'dead' ? { lastError: 'HTTP 500' } : {}),
    createdAt: input.created, updatedAt: input.updated ?? input.created,
  };
}

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, queueMigrations, eventsMigrations]);
  events = createEventsModule({
    db: tdb.db, projects: { isAdmin: async () => false, authorize: async () => 'owner' },
    services: { resolveService: async () => undefined }, endpoints: { resolve: async () => undefined },
  });
  const repo = drizzleDeliveryRepository(tdb.db);
  for (const row of [
    delivery({ traceId: trace(1), created: at(0), state: 'delivered', updated: at(1) }),
    delivery({ traceId: trace(2), created: at(10), state: 'dead', updated: at(15) }),
    delivery({ traceId: trace(3), created: at(20), state: 'retrying', updated: at(21) }),
    // 同一个事件投给另一个订阅项目：共用 traceId，但不属于本项目。
    delivery({ traceId: trace(1), created: at(0, 5), state: 'dead', projectId: other }),
    delivery({ traceId: trace(4), created: at(30), state: 'delivered', projectId: other }),
  ]) await repo.insert(row);
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('调用链查询（events）', () => {
  test('本项目的投递按 traceId 分组、按开始时间倒序，投递中的算进行中', async () => {
    expect(await events.api.traceKeys(project, { limit: 10 })).toEqual([
      { traceId: trace(3), firstAt: at(20).toISOString(), lastAt: at(21).toISOString(), active: true },
      { traceId: trace(2), firstAt: at(10).toISOString(), lastAt: at(15).toISOString(), active: false },
      { traceId: trace(1), firstAt: at(0).toISOString(), lastAt: at(1).toISOString(), active: false },
    ]);
    const next = await events.api.traceKeys(project, { limit: 2, before: { at: at(10).toISOString(), traceId: trace(2) } });
    expect(next.map((k) => k.traceId)).toEqual([trace(1)]);
  });

  test('有活动的链：投递中的不看时间，其余看最后变化', async () => {
    expect((await events.api.activeTraceIds(project, at(12).toISOString())).sort()).toEqual([trace(2), trace(3)]);
    expect(await events.api.activeTraceIds(project, at(50).toISOString())).toEqual([trace(3)]);
  });

  test('按 trace 取投递只取本项目那一条，带创建与最后变化时间', async () => {
    const rows = await events.api.listTraceDeliveries(project, [trace(1), trace(4)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ traceId: trace(1), state: 'delivered', eventType: 'gitlab.push', createdAt: at(0).toISOString(), updatedAt: at(1).toISOString(), deliveredAt: at(1).toISOString() });
    expect(await events.api.listTraceDeliveries(project, [])).toEqual([]);
  });
});
