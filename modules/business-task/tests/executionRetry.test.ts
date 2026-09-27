import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionCommandFixture } from './executionCommandFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 explicit fresh retry preserves prior attempt', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const cancelled = async () => {
    const f = await executionCommandFixture(tdb.db); f.behavior.disconnectAfterInfo = true;
    const original = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    expect((await f.request(`${f.path}/${original.id}/cancel`, { requestKey: 'cancel', expectedAttempt: 1, fence: f.fence })).status).toBe(202);
    f.behavior.disconnectAfterInfo = false; f.env.connected = true;
    return { ...f, original, retryPath: `${f.path}/${original.id}/retry` };
  };

  test('same-key concurrent retry is one new ID and attempt; old result and request replay remain immutable', async () => {
    const f = await cancelled(), before = await (await f.request(`${f.path}/${f.original.id}`)).json();
    // Identical text keys in different operation scopes do not collide.
    const input = { requestKey: f.input.requestKey, expectedAttempt: 1, resumePolicy: 'fresh', fence: f.fence };
    const responses = await Promise.all(Array.from({ length: 5 }, () => f.request(f.retryPath, input)));
    expect(responses.every((response) => [200, 201].includes(response.status))).toBe(true);
    const next = await Promise.all(responses.map((response) => response.json() as Promise<BusinessSubtaskV3Dto>));
    expect(new Set(next.map((view) => view.id)).size).toBe(1); expect(f.behavior.starts).toBe(1);
    expect(next[0]).toMatchObject({ attempt: 2, previousId: f.original.id, name: f.original.name }); expect(next[0]?.executionId).not.toBe(f.original.executionId);
    expect(await (await f.request(`${f.path}/${f.original.id}`)).json()).toEqual(before);
    const restarted = f.make(), replay = await restarted.request(f.retryPath, { ...input, fence: undefined });
    expect(replay.status).toBe(200); expect((await replay.json()).id).toBe(next[0]?.id); expect(f.behavior.starts).toBe(1);
    expect((await f.request(f.retryPath, { ...input, requestKey: 'second-successor' })).status).toBe(409);
    expect((await f.request(f.retryPath, { ...input, expectedAttempt: 2 })).status).toBe(409);
    const dispatched = f.commands.find((command) => command.type === 'startBusinessCommand');
    expect(dispatched).toMatchObject({ command: f.input.argv, env: f.input.env, attempt: 2 });
  });

  test('live or stale attempts, command session resume, offline workspace and missing execution authority reject', async () => {
    const f = await cancelled(), input = { requestKey: 'retry', expectedAttempt: 1, resumePolicy: 'fresh', fence: f.fence };
    expect((await f.request(f.retryPath, { ...input, fence: undefined })).status).toBe(409);
    expect((await f.request(f.retryPath, { ...input, expectedAttempt: 2 })).status).toBe(409);
    expect((await f.request(f.retryPath, { ...input, resumePolicy: 'resume', resumeSessionId: 'session' })).status).toBe(412);
    f.env.state = 'paused'; expect((await f.request(f.retryPath, input)).status).toBe(409); f.env.state = 'running';
    f.env.connected = false; expect((await f.request(f.retryPath, input)).status).toBe(412); f.env.connected = true;
    const next = await (await f.request(f.retryPath, input)).json() as BusinessSubtaskV3Dto;
    expect((await f.request(`${f.path}/${next.id}/retry`, { ...input, requestKey: 'live-retry', expectedAttempt: 2 })).status).toBe(409);
    const other = await executionCommandFixture(tdb.db); expect((await other.request(f.retryPath, input)).status).toBe(404);
    expect(f.behavior.starts).toBe(1);
  });
});
