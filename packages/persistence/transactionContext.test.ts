import { afterEach, describe, expect, test } from 'bun:test';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { connectDatabase } from './connection';
import type { DatabaseHandle } from './connection';
import { assertSharedDatabaseAdmissionActive, withExclusiveDatabaseAdmission, withSharedDatabaseAdmission, withSharedDatabaseAdmissions } from './transactionContext';

const available = await testDatabaseAvailable(), KEY = 'resources.project-admission:test';
describe.skipIf(!available)('持久准入独立连接池（真实 PG）', () => {
  let database: TestDatabase, single: DatabaseHandle;
  afterEach(async () => { await single?.close(); await database?.drop(); });
  test('单连接普通 UOW 独立提交并携带实际 shared 锁身份；后续外部失败不回滚已提交的来源绑定', async () => {
    database = await createTestDatabase(); single = connectDatabase(database.url, { max: 1 });
    await single.db.execute(sql`CREATE TABLE public.context_fixture(id integer PRIMARY KEY)`);
    let background!: Promise<string | undefined>, release!: () => void;
    await expect(withSharedDatabaseAdmission(single.db, KEY, async (guard) => {
      const backend = Number((await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
      expect(Number((await single.db.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid)).not.toBe(backend);
      await single.db.transaction(async (tx) => {
        const [row] = await tx.execute<{ guard: string; key: string; isolation: string }>(sql`SELECT current_setting('crewstation.shared_admission_pid') AS guard,current_setting('crewstation.shared_admission_key') AS key,current_setting('transaction_isolation') AS isolation`);
        expect(row).toEqual({ guard: String(backend), key: KEY, isolation: 'repeatable read' });
        await tx.execute(sql`INSERT INTO public.context_fixture VALUES (1)`);
      }, { isolationLevel: 'repeatable read' });
      expect(Number((await database.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM public.context_fixture`))[0]!.count)).toBe(1);
      const later = new Promise<void>((resolve) => { release = resolve; });
      background = later.then(() => single.db.transaction(async (tx) => (await tx.execute<{ key?: string }>(sql`SELECT current_setting('crewstation.shared_admission_key',true) AS key`))[0]?.key));
      throw new Error('external source failed after binding');
    })).rejects.toThrow('external source failed');
    expect(Number((await single.db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM public.context_fixture`))[0]!.count)).toBe(1);
    release(); expect(await background || undefined).toBeUndefined();
  }, 10_000);
  test('排他封闭等待时不占普通池，嵌套 shared 回调沿用实际锁，完成后才封闭', async () => {
    database = await createTestDatabase(); single = connectDatabase(database.url, { max: 1 });
    let entered!: () => void, write!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; }), writing = new Promise<void>((resolve) => { write = resolve; });
    const inFlight = withSharedDatabaseAdmission(single.db, KEY, async (guard) => {
      entered(); await writing;
      await withSharedDatabaseAdmission(single.db, KEY, async (nested) => { expect(nested).toBe(guard); await single.db.transaction((tx) => tx.execute(sql`SELECT 1`)); });
      expect(() => withExclusiveDatabaseAdmission(single.db, KEY, async () => undefined)).toThrow('active shared');
    });
    await started;
    const sealing = withExclusiveDatabaseAdmission(single.db, KEY, async () => 'sealed');
    let waiting = false;
    try {
      const deadline = Date.now() + 2000;
      while (!waiting && Date.now() < deadline) { waiting = (await database.db.execute<{ found: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted) AS found`))[0]!.found; if (!waiting) await Bun.sleep(10); }
      expect(waiting).toBe(true);
    } finally { write(); }
    await inFlight; expect(await sealing).toBe('sealed');
  }, 10_000);
  test('多个来源由同一 backend 按稳定次序保护，普通单连接事务和嵌套子集无需重复锁；无关来源可继续', async () => {
    database = await createTestDatabase(); single = connectDatabase(database.url, { max: 1 });
    const keys = [KEY, 'events.project-admission:second'].sort();
    expect(() => assertSharedDatabaseAdmissionActive(single.db, KEY)).toThrow('has exited');
    await withSharedDatabaseAdmissions(single.db, [keys[1]!, keys[0]!, keys[1]!], async (guard) => {
      for (const key of keys) expect(() => assertSharedDatabaseAdmissionActive(single.db, key)).not.toThrow();
      expect(() => assertSharedDatabaseAdmissionActive(single.db, 'unrelated')).toThrow('has exited');
      expect(() => assertSharedDatabaseAdmissionActive(database.db, KEY)).toThrow('has exited');
      const backend = Number((await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid);
      await single.db.transaction(async (tx) => {
        const [row] = await tx.execute<{ keys: string; pid: string; locks: number }>(sql`SELECT current_setting('crewstation.shared_admission_keys') AS keys,current_setting('crewstation.shared_admission_pid') AS pid,(SELECT count(*)::integer FROM pg_locks WHERE pid=${backend} AND locktype='advisory' AND granted AND mode='ShareLock') AS locks`);
        expect(row).toEqual({ keys: JSON.stringify(keys), pid: String(backend), locks: 2 });
      });
      await withSharedDatabaseAdmission(single.db, keys[1]!, async (nested) => { expect(nested).toBe(guard); });
      await withSharedDatabaseAdmissions(single.db, [keys[1]!], async (nested) => { expect(nested).toBe(guard); });
      expect(() => withSharedDatabaseAdmissions(single.db, ['unprotected'], async () => undefined)).toThrow('Cannot expand');
      for (const key of keys) expect(() => withExclusiveDatabaseAdmission(single.db, key, async () => undefined)).toThrow('active shared');
      expect(await withExclusiveDatabaseAdmission(database.db, 'unrelated', async () => 'available')).toBe('available');
    });
    for (const key of keys) expect(await withExclusiveDatabaseAdmission(single.db, key, async () => 'drained')).toBe('drained');
    expect(() => withSharedDatabaseAdmissions(single.db, [], async () => undefined)).toThrow('nonempty');
    expect(() => withSharedDatabaseAdmissions(single.db, [''], async () => undefined)).toThrow('nonempty');
  }, 10_000);
  for (const mode of ['shared', 'multiple', 'exclusive'] as const) test(`${mode} 准入断线后拒绝原调用，仍在退出的外部回调不能使驱动提交已关闭的连接`, async () => {
    database = await createTestDatabase(); single = connectDatabase(database.url, { max: 1 });
    let entered!: (pid: number) => void, release!: () => void, exited!: (key?: string) => void;
    const ready = new Promise<number>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; }), late = new Promise<string | undefined>((resolve) => { exited = resolve; });
    const admission = mode === 'shared' ? withSharedDatabaseAdmission : mode === 'exclusive' ? withExclusiveDatabaseAdmission
      : (db: Parameters<typeof withSharedDatabaseAdmission>[0], key: string, work: Parameters<typeof withSharedDatabaseAdmission>[2]) => withSharedDatabaseAdmissions(db, [key, 'events.project-admission:other'], work);
    const pending = admission(single.db, KEY, async (guard) => {
      entered(Number((await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!.pid)); await held;
      expect(() => assertSharedDatabaseAdmissionActive(single.db, KEY)).toThrow('has exited');
      const key = await single.db.transaction(async (tx) => (await tx.execute<{ key?: string }>(sql`SELECT current_setting('crewstation.shared_admission_key',true) AS key`))[0]?.key);
      exited(key || undefined);
    }).then(() => 'unexpected-success', () => 'disconnected');
    try {
      await database.db.execute(sql`SELECT pg_terminate_backend(${await ready})`);
      expect(await pending).toBe('disconnected');
    } finally { release(); }
    // 2026-10-01：驱动提前拒绝事务后，迟到回调原先会触发 null socket.write 和清理超时。
    expect(await late).toBeUndefined();
    expect(Number((await single.db.execute<{ value: number }>(sql`SELECT 1 AS value`))[0]?.value)).toBe(1);
  }, 10_000);
});
