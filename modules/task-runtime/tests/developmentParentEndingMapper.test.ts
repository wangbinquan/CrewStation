// Actual SQL presence/type survives every parent read path; private markers never become a valid seal.
import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { assertDevelopmentParentAdmission, readDevelopmentParentEnding } from '../domain/development/parentEnding';
import { developmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';
import type { DevelopmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';
const available = await testDatabaseAvailable();
describe.skipIf(!available)('parent ending original JSON mapping (real PG)', () => {
  let f: DevelopmentParentEndingStorageFixture;
  afterEach(async () => { await f?.close(); });
  const readAll = async () => {
    const repository = f.uow.read.environments;
    return [(await repository.getById(f.parent.id))!, (await repository.getForUpdate(f.parent.id))!,
      ...(await repository.listByProject(f.projectId)), ...(await repository.listByStates(['running'])),
      ...(await repository.listByProjectTraces(f.projectId, [f.parent.traceId])),
      ...await repository.findByPhysicalPod!(f.parent.namespace, f.parent.podName)];
  };
  test('valid object seal round trips; explicit undefined/null cannot erase presence; missing property clears only SQL NULL', async () => {
    f = await developmentParentEndingStorageFixture(); const ending = await f.admit();
    const pointer = { version: 1, endingId: ending.id, epochHash: ending.epochHash, phase: 'admission-sealed' } as const;
    for (const env of await readAll()) expect(Object.hasOwn(env, 'parentEnding')).toBe(false);
    await f.uow.run((s) => s.environments.update({ ...f.parent, parentEnding: pointer }));
    for (const env of await readAll()) { expect(readDevelopmentParentEnding(env)).toEqual(pointer); expect(() => assertDevelopmentParentAdmission(env)).toThrow(); }
    for (const parentEnding of [null, undefined]) {
      await f.uow.run((s) => s.environments.update({ ...f.parent, parentEnding }));
      for (const env of await readAll()) { expect(Object.hasOwn(env, 'parentEnding')).toBe(true); expect(() => readDevelopmentParentEnding(env)).toThrow(); }
      const [raw] = await f.db.execute(sql`SELECT parent_ending_present AS present,parent_ending_kind AS kind FROM task_runtime.environments WHERE id=${f.parent.id}`);
      expect(raw).toMatchObject({ present: true, kind: 'null' });
    }
    await f.uow.run((s) => s.environments.update(f.parent));
    for (const env of await readAll()) { expect(Object.hasOwn(env, 'parentEnding')).toBe(false); expect(() => assertDevelopmentParentAdmission(env)).not.toThrow(); }
  });
  test('JSON scalar text containing a fully valid pointer remains malformed rather than silently double-decoding', async () => {
    f = await developmentParentEndingStorageFixture(); const ending = await f.admit();
    const pointer = { version: 1, endingId: ending.id, epochHash: ending.epochHash, phase: 'admission-sealed' } as const;
    for (const value of ['scalar', JSON.stringify(pointer), false, null, [], {}]) {
      await f.db.execute(sql`UPDATE task_runtime.environments SET parent_ending=${JSON.stringify(value)}::jsonb WHERE id=${f.parent.id}`);
      for (const env of await readAll()) {
        expect(Object.hasOwn(env, 'parentEnding')).toBe(true); expect(() => assertDevelopmentParentAdmission(env)).toThrow();
        expect(() => readDevelopmentParentEnding(env)).toThrow();
      }
    }
    const current = (await f.uow.read.environments.getById(f.parent.id))!;
    await f.uow.run((s) => s.environments.update({ ...current, message: 'malformed seal remains pending' }));
    expect(Object.hasOwn((await f.uow.read.environments.getById(f.parent.id))!, 'parentEnding')).toBe(true);
  });
});
