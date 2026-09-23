import { expect, test } from 'bun:test';
import type { Actor, AgentActivityPage, TaskId } from '@crewstation/contracts';
import { rosterActivity } from '../application/nativeActivity';

const actor = (userId: string) => ({ userId }) as unknown as Actor;
const task = '01a0cd02-0444-7000-8c5a-b505fe579de8' as TaskId;

test('名册顺带的原生活动页：同一任务、同一人 5 秒内只查一次（进行中的也共用），过期再查；不同的人各查各的（已读状态按人）', async () => {
  let now = Date.parse('2026-09-23T07:45:00.000Z'), release: (() => void) | undefined;
  const calls: string[] = [];
  const page = (userId: string) => ({ sync: 'ready', states: [], unread: [], userId }) as unknown as AgentActivityPage;
  const read = rosterActivity(async (who, taskId) => {
    calls.push(`${taskId.slice(-4)}:${who.userId}`);
    await new Promise<void>((resolve) => { release = resolve; });
    return page(who.userId);
  }, { now: () => new Date(now) });
  // 每秒一读的名册，第一次还没回来时第二次到了：共用同一次。
  const first = read(actor('dev'), task);
  now += 1000;
  const second = read(actor('dev'), task);
  release!();
  expect(await first).toBe(await second);
  expect(calls).toEqual(['9de8:dev']);
  now += 3999;
  await read(actor('dev'), task);
  expect(calls).toHaveLength(1);
  // 过了 5 秒重新查；另一个人不复用这个人的。
  now += 1;
  const third = read(actor('dev'), task);
  release!();
  await third;
  const other = read(actor('admin'), task);
  release!();
  expect((await other as unknown as { userId: string }).userId).toBe('admin');
  expect(calls).toEqual(['9de8:dev', '9de8:dev', '9de8:admin']);
});

test('名册顺带的原生活动页：拒绝（权限错误）不留在缓存里，下一次重新查', async () => {
  let fail = true, calls = 0;
  const read = rosterActivity(async () => { calls++; if (fail) throw Object.assign(new Error('forbidden'), { kind: 'forbidden' }); return { sync: 'ready' } as unknown as AgentActivityPage; }, { now: () => new Date(0) });
  await expect(read(actor('dev'), task)).rejects.toMatchObject({ kind: 'forbidden' });
  await Bun.sleep(0);
  fail = false;
  expect(await read(actor('dev'), task)).toMatchObject({ sync: 'ready' });
  expect(calls).toBe(2);
});
