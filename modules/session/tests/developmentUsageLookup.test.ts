// Actual Session PG + Hono + strict client; no Runner, model, identity or Pod operation.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createApp } from '@crewstation/http';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createSessionClient } from '../../../packages/session-client';
import type { TaskId } from '@crewstation/contracts';
import { drizzleDevelopmentUsageStore } from '../adapters/persistence/developmentUsage';
import { developmentUsageRoutes } from '../http/developmentUsageRoutes';
import { createSessionModule, sessionMigrations } from '../wiring';
import { developmentReceipt, developmentRegistration } from './developmentUsageFixtures';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([sessionMigrations]); });
afterAll(async () => { await database?.drop(); });
const setup = () => {
  const store = drizzleDevelopmentUsageStore(database.db), app = createApp({ name: 'development-lookup' }); app.route('/', developmentUsageRoutes({ developmentUsage: store }));
  const client = createSessionClient('http://session', Object.assign(async (url: string | URL | Request, init?: RequestInit) => app.request(new Request(url, init)), { preconnect: fetch.preconnect }));
  return { store, app, client };
};
describe.skipIf(!available)('Session按实际执行查询独立原登记', () => {
  test('actual successful empty SQL lookup is explicit, does not register or write, and keyed read remains not-found', async () => {
    const { store, app, client } = setup(), r = developmentRegistration();
    const before = await database.db.execute(sql`select * from session.development_usage_streams`);
    const value = { version: 1, runtimeTaskId: r.runtimeTaskId, kind: 'absent' } as const;
    expect(await store.lookup(r.runtimeTaskId)).toEqual(value); expect(await client.lookupDevelopmentUsage(r.runtimeTaskId)).toEqual(value);
    const response = await app.request(`/internal/tasks/${r.runtimeTaskId}/development-usage/registration`); expect(response.status).toBe(200); expect(await response.json()).toEqual(value);
    expect(await database.db.execute(sql`select * from session.development_usage_streams`)).toEqual(before);
    await expect(client.getDevelopmentUsage(r.runtimeTaskId, r.key)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(store.lookup('not-an-execution' as TaskId)).rejects.toThrow();
    expect((await app.request('/internal/tasks/not-an-execution/development-usage/registration')).status).toBe(400);
  });
  test('original registered/closed snapshot survives restart and remains isolated from another runtime without advancing ACKs', async () => {
    const { store, client } = setup(), r = developmentRegistration(), other = developmentRegistration();
    await store.register(r); await store.register(other);
    await store.ingest(r.runtimeTaskId, developmentReceipt(r, 0, { phase: 'finished', result: 'completed', finalThrough: 0 }));
    const original = await store.requestDrain(r.runtimeTaskId, r.key, 'completed');
    const before = await database.db.execute(sql`select * from session.development_usage_streams where task_id=${r.runtimeTaskId}`);
    const value = { version: 1, runtimeTaskId: r.runtimeTaskId, kind: 'registered', stored: original } as const;
    expect(await store.lookup(r.runtimeTaskId)).toEqual(value); expect(await drizzleDevelopmentUsageStore(database.db).lookup(r.runtimeTaskId)).toEqual(value);
    expect(await client.lookupDevelopmentUsage(r.runtimeTaskId)).toEqual(value);
    const otherValue = await client.lookupDevelopmentUsage(other.runtimeTaskId); expect(otherValue.kind).toBe('registered');
    if (otherValue.kind === 'registered') expect(otherValue.stored).toMatchObject({ registration: other, receipt: null, complete: false });
    expect(await store.get(r.runtimeTaskId, r.key)).toEqual(original);
    await expect(client.getDevelopmentUsage(r.runtimeTaskId, { ...r.key, journalId: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await database.db.execute(sql`select * from session.development_usage_streams where task_id=${r.runtimeTaskId}`)).toEqual(before);
  });
  test('actual SQL failure, disabled storage and malformed routes remain errors rather than absent', async () => {
    const { store, app, client } = setup(), r = developmentRegistration();
    await database.db.execute(sql`alter table session.development_usage_streams rename to development_lookup_unavailable`);
    try {
      await expect(store.lookup(r.runtimeTaskId)).rejects.toBeDefined();
      expect((await app.request(`/internal/tasks/${r.runtimeTaskId}/development-usage/registration`)).status).toBe(500);
      await expect(client.lookupDevelopmentUsage(r.runtimeTaskId)).rejects.toBeDefined();
    } finally { await database.db.execute(sql`alter table session.development_lookup_unavailable rename to development_usage_streams`); }
    const disabled = createApp({ name: 'disabled-lookup' }); disabled.route('/', developmentUsageRoutes({}));
    const response = await disabled.request(`/internal/tasks/${r.runtimeTaskId}/development-usage/registration`); expect(response.status).toBe(412);
    expect(await response.json()).not.toMatchObject({ kind: 'absent' });
  });
  test('composition API and its real internal HTTP route read the same independent PostgreSQL row while Runner is offline', async () => {
    const module = createSessionModule({ db: database.db, runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'offline' }) },
      taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => {}, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
      settings: { selfAddress: 'local', commandTimeoutMs: 1000, runnerStaleMs: 60000, replayLimit: 100 } });
    try {
      const app = createApp({ name: 'module-lookup' }); app.route('/', module.http.internal);
      const client = createSessionClient('http://session', Object.assign(async (url: string | URL | Request, init?: RequestInit) => app.request(new Request(url, init)), { preconnect: fetch.preconnect }));
      const r = developmentRegistration(); expect(await module.api.lookupDevelopmentUsage(r.runtimeTaskId)).toEqual(await client.lookupDevelopmentUsage(r.runtimeTaskId));
      await module.api.registerDevelopmentUsage(r);
      expect(await module.api.lookupDevelopmentUsage(r.runtimeTaskId)).toEqual(await client.lookupDevelopmentUsage(r.runtimeTaskId));
      expect(await module.api.connectionStatus(r.runtimeTaskId)).toEqual({ connected: false });
    } finally { for (const worker of module.workers) await worker.stop(); }
  });
});
