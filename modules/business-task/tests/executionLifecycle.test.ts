import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { BusinessOperationDto, BusinessSubtaskV3Dto } from '@crewstation/contracts';
import { quotaExceeded } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 durable parent lifecycle', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const fixture = async () => {
    const f = await executionCommandFixture(tdb.db), behavior = { calls: 0, unknown: false, quota: false, pausePending: false };
    f.environmentPort.pauseEnvironment = async () => {
      behavior.calls++; if (behavior.unknown) throw new Error('lost response');
      f.env.connected = false;
      if (!behavior.pausePending) f.env.state = 'paused';
      return f.env;
    };
    f.environmentPort.resumeEnvironment = async () => { behavior.calls++; if (behavior.quota) throw quotaExceeded('full'); f.env.state = 'creating'; return f.env; };
    f.environmentPort.releaseEnvironment = async () => { behavior.calls++; f.env.state = 'releasing'; return f.env; };
    const root = `/v3/business-tasks/${f.task.id}`, body = { requestKey: 'lifecycle', expectedGeneration: 1, fence: f.fence };
    return { ...f, root, body, lifecycle: behavior };
  };
  test('pause is durable, concurrent replay is one generation, and paused tasks cannot accept commands', async () => {
    const f = await fixture(); f.lifecycle.pausePending = true;
    const responses = await Promise.all(Array.from({ length: 4 }, () => f.request(`${f.root}/pause`, f.body)));
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202, 202]);
    const operations = await Promise.all(responses.map((r) => r.json() as Promise<BusinessOperationDto>));
    expect(new Set(operations.map((o) => o.operationId)).size).toBe(1);
    expect(await (await f.request(f.root)).json()).toMatchObject({ state: 'pausing', generation: 2 });
    f.env.connected = true; // Even a lagging runtime observation cannot bypass the transaction barrier.
    expect((await f.request(f.path, f.input)).status).toBe(409); expect(f.behavior.starts).toBe(0);
    expect((await f.request(`${f.root}/close`, { ...f.body, requestKey: 'other' })).status).toBe(409);
    f.lifecycle.pausePending = false;
    for (let i = 0; i < 8 && f.env.state !== 'paused'; i++) await f.make().module.api.v3.runOnce();
    expect(await (await f.request(f.root)).json()).toMatchObject({ state: 'paused', generation: 2 });
    expect(await (await f.request(`${f.root}/operations/${operations[0]!.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    const calls = f.lifecycle.calls; expect((await f.request(`${f.root}/pause`, { ...f.body, fence: undefined })).status).toBe(202); expect(f.lifecycle.calls).toBe(calls);
    expect((await f.request(`${f.root}/pause`, { ...f.body, expectedGeneration: 2 })).status).toBe(409);
  });
  test('active commands prevent pause and close; stale fences never invoke the runtime', async () => {
    const f = await fixture(); const child = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    expect(child.state).toBe('running');
    for (const action of ['pause', 'close']) expect((await f.request(`${f.root}/${action}`, f.body)).status).toBe(409);
    expect(f.lifecycle.calls).toBe(0);
    const other = await fixture(); expect((await other.request(`${other.root}/pause`, { ...other.body, fence: undefined })).status).toBe(409); expect(other.lifecycle.calls).toBe(0);
    expect((await other.request(`${f.root}/pause`, other.body)).status).toBe(404);
  });
  test('resume quota rejection never autoqueues; explicit same-key retry retains operation and generation', async () => {
    const f = await fixture(); await f.request(`${f.root}/pause`, f.body);
    f.lifecycle.quota = true;
    const input = { ...f.body, expectedGeneration: 2 };
    const rejected = await f.request(`${f.root}/resume`, input); expect(rejected.status).toBe(429); expect(rejected.headers.get('retry-after')).toBe('1');
    const calls = f.lifecycle.calls;
    await f.make().module.api.v3.runOnce(); expect(f.lifecycle.calls).toBe(calls);
    expect(await (await f.request(f.root)).json()).toMatchObject({ state: 'paused', generation: 3 });
    f.lifecycle.quota = false;
    const operation = await (await f.request(`${f.root}/resume`, input)).json() as BusinessOperationDto;
    expect(operation.state).toBe('pending'); expect(await (await f.request(f.root)).json()).toMatchObject({ state: 'creating', generation: 3 });
    f.env.state = 'running'; f.env.connected = true;
    for (let i = 0; i < 8; i++) await f.make().module.api.v3.runOnce();
    expect(await (await f.request(`${f.root}/operations/${operation.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
    expect((await f.request(f.path, f.input)).status).toBe(201);
  });
  test('crash with unknown side effect keeps admission blocked until original operation is reconciled', async () => {
    const f = await fixture(); f.lifecycle.unknown = true;
    const operation = await (await f.request(`${f.root}/pause`, f.body)).json() as BusinessOperationDto;
    expect(operation).toMatchObject({ state: 'pending', message: 'lifecycle_unknown' });
    expect((await f.request(f.path, f.input)).status).toBe(409);
    await tdb.db.execute(sql`UPDATE business_task.execution_lifecycles SET state='running', owner='crashed', lease_until=now()-interval '1 second' WHERE id=${operation.operationId}`);
    f.lifecycle.unknown = false; f.env.state = 'paused'; f.env.connected = false;
    const calls = f.lifecycle.calls;
    for (let i = 0; i < 8; i++) await f.make().module.api.v3.runOnce();
    expect(f.lifecycle.calls).toBe(calls);
    expect(await (await f.request(`${f.root}/operations/${operation.operationId}`)).json()).toMatchObject({ state: 'succeeded' });
  });
});
