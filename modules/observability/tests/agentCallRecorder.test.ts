// RFC-034 v2 §4（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md）：Agent 执行记录的写入——
// 派发前受理一行、运行中整份替换用量、结束一次且不被晚到快照覆盖、同一 Agent 只一行运行中、执行环境释放兜底、
// 价格按执行开始冻结（回填不改已开始的执行）、没有档位的执行用协议内置价格线。真实 PostgreSQL。
import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { ADMIN, PROFILE, T0, agentCallFixture, dropFixtures, minutes, snapshot, start } from './agentCallFixture';

const available = await testDatabaseAvailable();
afterEach(dropFixtures);
const price = (model: string, input: string, output: string | null, effectiveFrom: number, expectedLatestId: string | null = null) =>
  ({ model, rates: { input, cacheRead: '0.5', cacheWrite: null, output }, effectiveFrom: new Date(effectiveFrom).toISOString(), note: '', expectedLatestId });

describe.skipIf(!available)('RFC-034 v2 Agent call recorder', () => {
  test('accept is idempotent, snapshots replace in place, the end is written once and late snapshots never overwrite it', async () => {
    const f = await agentCallFixture(), call = start({ taskId: 'task-life' });
    const id = await f.recorder.accept(call);
    expect(await f.recorder.accept({ ...call, id })).toBe(id);
    expect((await f.api.task(ADMIN, null, 'task-life')).calls).toMatchObject([{ id, status: 'running', usageState: 'pending', input: 0, models: [], profileId: PROFILE, profileRevision: 3 }]);
    await f.recorder.usage(call, snapshot('partial', [{ model: 'zhipu/glm-5', input: 100, output: 20 }, { model: 'other', input: 5 }]));
    await f.recorder.usage(call, snapshot('partial', [{ model: 'zhipu/glm-5', input: 300, output: 40, reasoning: 10 }]));
    expect((await f.api.task(ADMIN, null, 'task-life')).calls[0]).toMatchObject({ usageState: 'partial', input: 300, output: 40, reasoning: 10, models: [{ model: 'zhipu/glm-5', input: 300 }] });
    await f.recorder.finish(call, { status: 'done', at: minutes(10), snapshot: snapshot('complete', [{ model: 'zhipu/glm-5', input: 400, cacheRead: 50, output: 60, reasoning: 10 }]) });
    await f.recorder.usage(call, snapshot('partial', [{ model: 'late', input: 9999 }]));
    await f.recorder.finish(call, { status: 'failed', at: minutes(20) });
    expect((await f.api.task(ADMIN, null, 'task-life')).calls).toMatchObject([{ id, status: 'done', endedAt: minutes(10).toISOString(), usageState: 'complete',
      input: 400, cacheRead: 50, output: 60, reasoning: 10, models: [{ model: 'zhipu/glm-5', input: 400, cacheRead: 50 }] }]);
  });

  test('canceled complete usage is a lower bound, an empty end is unknown, and a released environment interrupts only its running calls', async () => {
    const f = await agentCallFixture(), canceled = start({ taskId: 'task-end' });
    const silent = start({ taskId: 'task-end', runtimeTaskId: canceled.runtimeTaskId, agentId: 'reviewer-agent', agentKey: 'reviewer', startedAt: minutes(1) });
    const elsewhere = start({ taskId: 'task-end', startedAt: minutes(2) });
    for (const call of [canceled, silent, elsewhere]) await f.recorder.accept(call);
    await f.recorder.finish(canceled, { status: 'canceled', at: minutes(5), snapshot: snapshot('complete', [{ model: 'zhipu/glm-5', input: 10 }]) });
    expect(await f.recorder.closeRuntimeTask(canceled.runtimeTaskId, minutes(6))).toBe(1);
    expect(await f.recorder.closeRuntimeTask(canceled.runtimeTaskId, minutes(7))).toBe(0);
    const calls = (await f.api.task(ADMIN, null, 'task-end')).calls;
    expect(calls.map((call) => [call.agentKey, call.status, call.usageState])).toEqual([['coder', 'canceled', 'partial'], ['reviewer', 'interrupted', 'none'], ['coder', 'running', 'pending']]);
    expect(calls[1]!.endedAt).toBe(minutes(6).toISOString());
  });

  test('a new run of the same Agent in the same environment interrupts the previous running row', async () => {
    const f = await agentCallFixture(), first = start({ taskId: 'task-retry' });
    await f.recorder.accept(first);
    await f.recorder.usage(first, snapshot('complete', [{ model: 'zhipu/glm-5', input: 70 }]));
    const second = { ...first, attempt: 2, startedAt: minutes(3) };
    await f.recorder.accept(second);
    const calls = (await f.api.task(ADMIN, null, 'task-retry')).calls;
    expect(calls.map((call) => [call.attempt, call.status, call.usageState, call.input])).toEqual([[1, 'interrupted', 'partial', 70], [2, 'running', 'pending', 0]]);
    // Runner 按（执行环境, Agent）寻址：结束写到正在运行的那一次，已中断的上一行不再改变。
    await f.recorder.finish(second, { status: 'done', at: minutes(9) });
    expect((await f.api.task(ADMIN, null, 'task-retry')).calls.map((call) => [call.attempt, call.status])).toEqual([[1, 'interrupted'], [2, 'done']]);
  });

  test('prices freeze at the run start: a later backdated version never reprices it and unpriced models make the cost partial', async () => {
    const f = await agentCallFixture();
    f.clock.at = T0 - 60_000;
    const first = await f.api.savePrice(ADMIN, PROFILE, price('zhipu/glm-5', '2', '8', T0 - 3_600_000));
    await f.api.savePrice(ADMIN, 'builtin:claude-code', price('claude-sonnet', '3', null, T0 - 3_600_000));
    f.clock.at = T0 + 3_600_000;
    await f.api.savePrice(ADMIN, PROFILE, price('zhipu/glm-5', '100', '100', T0 - 7_200_000, first.id));
    const run = start({ taskId: 'task-price' });
    await f.recorder.accept(run);
    await f.recorder.finish(run, { status: 'done', at: minutes(5), snapshot: snapshot('complete', [{ model: 'zhipu/glm-5', input: 1000, output: 100 }, { model: 'other/unpriced', input: 10 }]) });
    expect((await f.api.task(ADMIN, null, 'task-price')).calls[0]).toMatchObject({ costState: 'partial', costNano: '2800000',
      models: [{ model: 'other/unpriced', costNano: null }, { model: 'zhipu/glm-5', costNano: '2800000' }] });
    const test = start({ projectId: null, source: 'platform', kind: 'profile-test', taskId: 'profile-test-1', subtaskId: null, attempt: null, profile: null, protocol: 'claude-code' });
    await f.recorder.accept(test);
    await f.recorder.finish(test, { status: 'done', at: minutes(1), snapshot: snapshot('complete', [{ model: 'claude-sonnet', input: 1000, output: 5 }]) });
    expect((await f.api.task(ADMIN, null, 'profile-test-1')).calls[0]).toMatchObject({ profileId: 'builtin:claude-code', projectId: null, costState: 'partial', costNano: '3000000' });
  });
});
