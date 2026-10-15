import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { openRunner, sessionDeletionFixture } from './deletion/fixture';

const available = await testDatabaseAvailable();
async function withinBudget<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('command replies blocked behind event admission')), 2000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

describe.skipIf(!available)('Runner replies during concurrent original commands', () => {
  for (const failure of [false, true]) test(`${failure ? 'error' : 'result'} replies release all four command guards while ordered events wait for admission`, async () => {
    const f = await sessionDeletionFixture(), task = f.task(), runner = await openRunner(f.first.address, task);
    const commands = Array.from({ length: 4 }, (_, index) => `concurrent-${index}`);
    const results = commands.map(id => f.first.module.api.sendCommand(task, { id, type: 'previewStatus' })
      .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error: String(error) })));
    try {
      await withinBudget(Promise.all(commands.map(id => runner.next(frame => frame.id === id))));
      // Live CLI acceptance: four commands occupy the guard pool; an earlier
      // event waits for that pool and must not prevent their replies settling.
      const at = new Date().toISOString();
      for (const seq of [1, 1, 2]) runner.ws.send(JSON.stringify({ type: 'event', seq, at,
        event: { kind: 'agent', event: { agentId: 'original', seq, at, type: 'text', text: `event ${seq}` } } }));
      for (const id of commands) runner.ws.send(JSON.stringify(failure
        ? { type: 'error', id, code: 'unavailable', message: 'runner command failed' }
        : { type: 'result', id, payload: { state: 'ready' } }));
      const actual = await withinBudget(Promise.all(results));
      expect(actual.every(value => value.ok === !failure)).toBe(true);
      if (failure) expect(actual.every(value => !value.ok && value.error.includes('runner command failed'))).toBe(true);
      else expect(actual.map(value => value.ok ? value.value : undefined)).toEqual(commands.map(() => ({ state: 'ready' })));
      await withinBudget((async () => {
        while ((await f.first.module.api.listEvents(task, {})).length < 2) await Bun.sleep(10);
      })());
      expect((await f.first.module.api.listEvents(task, {})).map(event => event.seq)).toEqual([1, 2]);
      runner.ws.close(); await runner.closed;
      await f.first.module.workers[0]!.stop();
      expect(await f.database.db.execute(sql`SELECT id FROM session.original_callbacks WHERE exited_at IS NULL`)).toHaveLength(0);
    } finally {
      runner.ws.close(); await f.first.module.workers[0]!.stop(); await Promise.allSettled(results); await f.drop();
    }
  }, 15_000);
});
