import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BusinessEvent, BusinessSubtaskV3Dto } from '@crewstation/contracts';
import { sql } from 'drizzle-orm';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionAgentFixture } from './executionAgentFixture';
import { drizzleExecutionSubtasks } from '../adapters/persistence/execution/subtasks';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 independent durable Agent execution', () => {
  let tdb: TestDatabase;
  beforeEach(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterEach(async () => { await tdb?.drop(); });
  test('immutable parent profile, private material and separate Pod survive duplicate admission and missing start reply', async () => {
    const f = await executionAgentFixture(tdb.db);
    const responses = await Promise.all(Array.from({ length: 4 }, () => f.request(f.path, f.input)));
    // RFC-027 design §3：首次稳定句柄可返回 201；并发调和持有 dispatching 时不保证四份回执全是 202。
    // 逐份断言保留失败状态码，不能把 409／500 淹没成一个 false（CI 36490908412）。
    for (const response of responses) expect([200, 201, 202]).toContain(response.status);
    expect(responses.filter((r) => r.status === 201).length).toBeLessThanOrEqual(1);
    const views = await Promise.all(responses.map((r) => r.json() as Promise<BusinessSubtaskV3Dto>));
    for (const view of views) expect(view).toMatchObject({ taskId: f.task.id, kind: 'agent', state: 'pending', process: 'not-started' });
    expect(new Set(views.map((v) => v.id)).size).toBe(1); expect(new Set(f.creates.map((c) => c.id)).size).toBe(1);
    const view = views[0]!; expect(view).toMatchObject({ computeProfileId: f.computeId, profileRevision: 1, agentProfileId: f.profileId });
    const stored = (await drizzleExecutionSubtasks(tdb.db).get(f.serviceId, f.task.id, view.id))!;
    expect(stored.runtimeTaskId).not.toBe(f.task.id); expect(JSON.stringify(stored)).not.toContain('provider-secret'); expect(JSON.stringify(stored)).not.toContain('private prompt');
    f.agentBehavior.revision = 2; const resolved = f.agentBehavior.resolveCount;
    await f.make().request(f.path, { ...f.input, fence: undefined }); expect(f.agentBehavior.resolveCount).toBe(resolved);
    f.ready(); f.agentBehavior.startLost = true; await f.make().module.api.v3.runOnce();
    expect((await f.get(view.id)).process).toBe('unknown'); expect(f.agentBehavior.starts).toBe(1);
    const dispatched = f.starts.find((entry) => entry.command.type === 'startBusinessAgent')!;
    expect(dispatched.taskId).toBe(stored.runtimeTaskId!); expect(dispatched.command).toMatchObject({ agent: { profileRevision: 1, initialPrompt: 'private prompt', beforeStart: { secrets: { PROVIDER_KEY: 'provider-secret-one' } } } });
    await f.make().module.api.v3.runOnce(); expect((await f.get(view.id)).process).toBe('live'); expect(f.agentBehavior.starts).toBe(1);
  });
  test('capability discovery is source scoped and untested Agent revisions reject before Pod admission', async () => {
    const f = await executionAgentFixture(tdb.db), path = '/v3/business-execution/capabilities';
    const response = await f.request(path); expect(response.status).toBe(200);
    const supported = await response.json(); expect(supported.agentProfiles).toEqual([{ agentProfileId: f.profileId, computeProfileId: f.computeId, profileRevision: 1, capabilities: expect.objectContaining({ events: true, resume: true }) }]);
    expect(JSON.stringify(supported)).not.toContain('provider-secret'); expect(supported.limits.outputBytes).toBe(64 * 1024 * 1024);
    f.agentBehavior.businessSupported = false;
    expect((await (await f.request(path)).json()).agentProfiles[0].capabilities.events).toBe(false);
    const rejected = await f.request(f.path, f.input); expect(rejected.status).toBe(412);
    expect(f.creates).toHaveLength(0); expect(f.agentBehavior.starts).toBe(0);
  });
  test('quota rejection never queues capacity retry; explicit replay uses original environment ID', async () => {
    const f = await executionAgentFixture(tdb.db); f.agentBehavior.quota = true;
    expect((await f.request(f.path, f.input)).status).toBe(429); expect(f.creates).toHaveLength(1);
    const original = f.creates[0]!; await f.module.api.v3.runOnce(); expect(f.creates).toHaveLength(1);
    f.agentBehavior.quota = false;
    expect((await f.request(f.path, f.input)).status).toBe(202); expect(f.creates).toHaveLength(2); expect(f.creates[1]!.id).toBe(original.id);
    expect(f.agentBehavior.resolveCount).toBe(1);
    expect((await f.request(f.path, { ...f.input, prompt: 'different' })).status).toBe(409);
  });
  // RFC-040 live AW acceptance (2026-10-18): a replayed submit answered 200 while the worker's own claim hit the
  // project quota. The subtask was parked as retryable-rejected, which nothing claims, so the caller saw `pending`
  // until its 30-minute deadline. Once a request is answered 2xx, capacity rejections must stay with the worker.
  test('a capacity rejection after the 2xx answer stays queued and the worker admits it without a replay', async () => {
    const f = await executionAgentFixture(tdb.db); f.agentBehavior.unavailable = true;
    const response = await f.request(f.path, f.input); expect(response.status).toBe(202);
    const view = await response.json() as BusinessSubtaskV3Dto; expect(f.creates).toHaveLength(1);
    const subtasks = drizzleExecutionSubtasks(tdb.db), dispatch = async () => (await subtasks.get(f.serviceId, f.task.id, view.id))!.dispatch;
    f.agentBehavior.unavailable = false; f.agentBehavior.quota = true;
    await f.module.api.v3.runOnce(); expect(f.creates).toHaveLength(2); expect(await dispatch()).toBe('pending');
    await f.module.api.v3.runOnce(); expect(f.creates).toHaveLength(3);
    f.agentBehavior.quota = false;
    await f.module.api.v3.runOnce(); expect(f.creates).toHaveLength(4);
    expect(new Set(f.creates.map((c) => c.id)).size).toBe(1);
    f.ready(); await f.module.api.v3.runOnce();
    expect(f.agentBehavior.starts).toBe(1); expect((await f.get(view.id)).process).toBe('live');
  });
  test('admission receipt lost never creates replacement; cancellation waits for original Pod cleanup and never starts CLI', async () => {
    const f = await executionAgentFixture(tdb.db); f.agentBehavior.createLost = true;
    const view = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    expect(f.creates).toHaveLength(1); const env = f.environments.get(f.creates[0]!.id)!;
    const response = await f.request(`${f.path}/${view.id}/cancel`, { requestKey: 'stop', expectedAttempt: 1, fence: f.fence });
    expect(response.status).toBe(202); expect((await f.get(view.id)).state).toBe('cancelling');
    await f.module.api.v3.runOnce(); expect(f.creates).toHaveLength(1); expect(f.agentBehavior.starts).toBe(0);
    env.state = 'released'; env.native = { state: 'finished' };
    await f.module.api.v3.runOnce(); expect((await f.get(view.id)).state).toBe('cancelled'); expect(f.agentBehavior.starts).toBe(0);
  });
  test('provider rotation cannot silently change accepted attempt; incompatible materials reject before another Pod', async () => {
    const f = await executionAgentFixture(tdb.db);
    const view = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    f.agentBehavior.providerKey = 'rotated-secret'; f.ready(); await f.module.api.v3.runOnce();
    expect(await f.get(view.id)).toMatchObject({ state: 'failed', process: 'not-started', error: { code: 'secret_version_unavailable' } }); expect(f.agentBehavior.starts).toBe(0);
    // AW RFC-370 hosted acceptance (2026-10-19): a dispatch failure before start ends with a terminal result event, or a
    // caller that follows the subtask's events never sees it end.
    const events = (await (await f.request(`/v3/business-tasks/${f.task.id}/events?subtaskId=${view.id}`)).json()).items as BusinessEvent[];
    const result = events.find((event) => event.type === 'result');
    expect(result).toMatchObject({ subtaskId: view.id, attempt: 1, data: { exitCode: null, reason: 'failed-before-start: secret_version_unavailable' } });
    if (result?.type === 'result') expect(result.data.finalCursor).toBe(result.cursor);
    expect((await f.get(view.id)).result).toMatchObject({ reason: 'failed-before-start: secret_version_unavailable' });
    const rows = await tdb.db.execute(sql`SELECT sealed_payload FROM business_task.execution_subtasks WHERE id=${view.id}`);
    expect(JSON.stringify(rows)).not.toContain('rotated-secret');
    expect((await f.request(f.path, { ...f.input, requestKey: 'resume', resumeSessionId: 'unowned' })).status).toBe(404);
    expect(f.creates).toHaveLength(1);
  });
});
