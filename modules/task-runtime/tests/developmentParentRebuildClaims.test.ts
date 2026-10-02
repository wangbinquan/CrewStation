// Fenced storage handoffs only: actual rebuild publication and physical proof remain separate gates.
import { afterEach, describe, expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { developmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';
import type { DevelopmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';
import { drizzleDevelopmentParentRebuildClaims } from '../adapters/persistence/developmentParentEndings';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original completed parent rebuild claim CAS (real PG)', () => {
  let f: DevelopmentParentEndingStorageFixture;
  afterEach(async () => { await f?.close(); });
  test('revision, original transition and request identity fence a second and third handoff; published claims cannot be replaced', async () => {
    f = await developmentParentEndingStorageFixture(); const ending = await f.admit(), first = f.claim(ending.id);
    expect(await f.claims.get('missing')).toBeUndefined(); expect(await f.claims.byRequest('missing')).toBeUndefined();
    expect(await f.claims.insert(first)).toBe(true); expect(await f.claims.insert(first)).toBe(false);
    expect(await f.claims.byRequest(first.currentRebuildId)).toEqual(first);
    expect(await f.db.transaction((tx) => drizzleDevelopmentParentRebuildClaims(tx).get(ending.id, true))).toEqual(first);
    const second = { ...first, currentRebuildId: Bun.randomUUIDv7(), revision: 2 };
    expect(await f.claims.replace(first, { ...second, sourceEndingId: Bun.randomUUIDv7() })).toBe(false);
    expect(await f.claims.replace(first, { ...second, afterTransitionHash: '0'.repeat(64) })).toBe(false);
    expect(await f.claims.replace(first, { ...second, revision: 3 })).toBe(false);
    expect(await f.claims.replace(first, { ...second, state: 'released' })).toBe(false);
    expect(await f.claims.replace(first, second)).toBe(true);
    expect(await f.claims.publish(first)).toBe(false); expect(await f.claims.retry(first, new Date(1))).toBe(false);
    expect(await f.claims.replace(first, second)).toBe(false);
    const third = { ...second, currentRebuildId: Bun.randomUUIDv7(), revision: 3 };
    expect(await f.claims.replace(second, third)).toBe(true);
    expect(await f.claims.byRequest(first.currentRebuildId)).toBeUndefined();
    expect(await f.claims.retry(third, new Date(1))).toBe(true);
    expect(await f.claims.publish(third)).toBe(true); expect(await f.claims.publish(third)).toBe(false);
    const published = { ...third, state: 'published' as const, retryAt: new Date(1) };
    expect(await f.claims.replace(published, { ...third, revision: 4 })).toBe(false);
    expect(await f.claims.retry(published, new Date(2))).toBe(false); expect(await f.claims.publish(published)).toBe(false);
    expect(await f.claims.get(ending.id)).toEqual(published);
  });
  test('ending and rebuild recovery have durable fair bounded pages beyond 25 and honor retry time', async () => {
    f = await developmentParentEndingStorageFixture(); const identities: string[] = [];
    for (let i = 0; i < 27; i++) {
      const ending = await f.admit(f.identity(TaskIdSchema.parse(Bun.randomUUIDv7())));
      identities.push(ending.id); expect(await f.claims.insert(f.claim(ending.id))).toBe(true);
    }
    identities.sort(); const cutoff = new Date();
    expect(await f.endings.due(null, cutoff, 1000)).toEqual(identities.slice(0, 25));
    expect(await f.endings.due(identities[24]!, cutoff, 1000)).toEqual(identities.slice(25));
    expect((await f.claims.due(null, cutoff, 1000)).map((c) => c.sourceEndingId)).toEqual(identities.slice(0, 25));
    expect((await f.claims.due(identities[24]!, cutoff, 1000)).map((c) => c.sourceEndingId)).toEqual(identities.slice(25));
    expect(await f.endings.due(null, new Date(0), 25)).toEqual([]);
    expect(await f.endings.due(null, cutoff, 1)).toEqual(identities.slice(0, 1));
    const claim = (await f.claims.get(identities[26]!))!;
    expect(await f.claims.retry(claim, new Date(cutoff.getTime() + 60000))).toBe(true);
    expect(await f.claims.due(identities[25]!, cutoff, 25)).toEqual([]);
    expect(await f.move(identities[26]!, 'complete')).toBe(true);
    expect(await f.endings.due(identities[25]!, cutoff, 25)).toEqual([]);
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(f.endings.due(null, cutoff, invalid)).rejects.toThrow('预算无效');
      await expect(f.claims.due(null, cutoff, invalid)).rejects.toThrow('预算无效');
    }
  });
  test('a released original claim may be reacquired, but request uniqueness prevents another source from adopting it', async () => {
    f = await developmentParentEndingStorageFixture(); const a = await f.admit(), first = { ...f.claim(a.id), state: 'released' as const };
    expect(await f.claims.insert(first)).toBe(true); expect(await f.claims.publish(first)).toBe(false);
    const next = { ...first, state: 'pending' as const, currentRebuildId: Bun.randomUUIDv7(), revision: 2 };
    expect(await f.claims.replace(first, next)).toBe(true);
    const b = await f.admit(f.identity(TaskIdSchema.parse(Bun.randomUUIDv7())));
    expect(await f.claims.insert({ ...f.claim(b.id), currentRebuildId: next.currentRebuildId })).toBe(false);
    expect(await f.claims.get(b.id)).toBeUndefined();
  });
});
