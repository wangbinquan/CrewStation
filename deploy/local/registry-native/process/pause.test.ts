import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { jsonHash } from '../../../../packages/kernel';
import { originalRegistryPause } from './pause';
import type { RegistryPauseGuardian } from './guardian';

const original = { pid: 123, containerId: 'containerd://' + 'a'.repeat(64), podUid: randomUUID(), bootId: randomUUID(), namespace: 'pid:[1234]', startTicks: '77',
  cgroup: jsonHash('original'), executable: '/bin/registry' as const, executableIdentity: jsonHash('original executable') };
async function fixture(guardian?: () => Promise<RegistryPauseGuardian>) {
  let current = structuredClone(original), dead = false, closed = false, stopped = false; const signals: string[] = [];
  const pause = await originalRegistryPause(original, { inspect: async () => structuredClone(current), stopped: async () => { if (!stopped) throw Error('running'); },
    guardian, open: async () => ({ assertAlive: async () => { if (dead) throw Error('original exited'); }, signal: async value => { if (dead) throw Error('original exited'); signals.push(value); stopped = value === 'stop'; }, close: () => { closed = true; } }) });
  return { pause, signals, replace: () => { current = { ...current, startTicks: '88' }; }, die: () => { dead = true; }, closed: () => closed };
}
test('original pause covers the actual awaited callback and resumes only in finally, including failure and revocation', async () => {
  const f = await fixture(), signal = new AbortController();
  await expect(f.pause.assertStopped(signal.signal)).rejects.toThrow('exited');
  await expect(f.pause.exclusive(signal.signal, async () => {
    await f.pause.assertStopped(signal.signal); expect(f.signals).toEqual(['stop']);
    expect(() => f.pause.close()).toThrow('during');
    await expect(f.pause.exclusive(signal.signal, async () => {})).rejects.toThrow('unavailable');
    signal.abort(); throw Error('actual work failed');
  })).rejects.toThrow('actual work failed');
  expect(f.signals).toEqual(['stop', 'continue']);
  f.pause.close(); expect(f.closed()).toBe(true);
});
test('a replacement birth cannot be paused; an exited pidfd cannot signal a reused process', async () => {
  const f = await fixture(); f.replace();
  await expect(f.pause.exclusive(AbortSignal.timeout(1000), async () => {})).rejects.toThrow('birth changed'); expect(f.signals).toEqual([]); f.pause.close();
  const g = await fixture(); g.die();
  await expect(g.pause.exclusive(AbortSignal.timeout(1000), async () => {})).rejects.toThrow('original exited'); expect(g.signals).toEqual([]); g.pause.close();
});
test('successful work retains the fixed descriptor until explicit idle shutdown', async () => {
  const f = await fixture();
  expect(await f.pause.exclusive(AbortSignal.timeout(1000), async () => 7)).toBe(7); expect(f.signals).toEqual(['stop', 'continue']); expect(f.closed()).toBe(false);
  f.pause.close(); await expect(f.pause.exclusive(AbortSignal.timeout(1000), async () => {})).rejects.toThrow('unavailable');
});
test('guardian establishment precedes every stop; failed setup leaves Registry running and allows a subsequent guarded callback', async () => {
  let attempts = 0, disarmed = 0;
  const f = await fixture(async () => { if (!attempts++) throw Error('guardian startup failed'); return { signal: new AbortController().signal, disarm: async () => { expect(f.signals).toEqual(['stop', 'continue']); disarmed++; } }; });
  await expect(f.pause.exclusive(AbortSignal.timeout(1000), async () => {})).rejects.toThrow('startup failed'); expect(f.signals).toEqual([]);
  await f.pause.exclusive(AbortSignal.timeout(1000), async () => {}); expect(disarmed).toBe(1); f.pause.close();
});
test('guardian loss aborts the actual callback and finally resumes before disarming its retained guard', async () => {
  const controller = new AbortController(); let exits = 0;
  const f = await fixture(async () => ({ signal: controller.signal, disarm: async () => { expect(f.signals.at(-1)).toBe('continue'); exits++; } }));
  await expect(f.pause.exclusive(AbortSignal.timeout(1000), async signal => { controller.abort(Error('guardian lost')); signal.throwIfAborted(); })).rejects.toThrow('guardian lost');
  expect(f.signals).toEqual(['stop', 'continue']); expect(exits).toBe(1); f.pause.close();
});
