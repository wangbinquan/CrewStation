// Storage/actual queue fairness only. These synthetic ending identities are not physical completion or model producer evidence.
import { afterEach, describe, expect, test } from 'bun:test';
import { TaskIdSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { developmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';
import type { DevelopmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';
import { developmentParentRecovery } from '../adapters/persistence/developmentParentRecovery';
import { DEVELOPMENT_PARENT_ENDING_JOB_KIND } from '../ports/developmentParentEnding';
import { REBUILD_JOB_KIND } from '../ports/rebuilds';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('original parent durable recovery fairness (real PG)', () => {
  let f: DevelopmentParentEndingStorageFixture;
  afterEach(async () => { await f?.close(); });
  const refill = (cutoff: Date, limit = 25) => f.db.transaction((tx) => developmentParentRecovery(tx, true).refill(cutoff, limit));
  const jobs = () => f.db.execute<{ id: number; kind: string; state: string; attempts: number; max_attempts: number; dedup_key: string }>(sql`SELECT id,kind,state,attempts,max_attempts,dedup_key
    FROM platform_infra.jobs WHERE kind IN (${DEVELOPMENT_PARENT_ENDING_JOB_KIND},${REBUILD_JOB_KIND}) ORDER BY id`);
  const cursor = async () => (await f.db.execute<{ kind: string; after_id: string; epoch: number }>(sql`SELECT kind,after_id,epoch FROM task_runtime.development_parent_recovery_sweep`))[0]!;
  test('two populated families retain a total 25 cap with the third family empty, retain distinct keysets after recreation and refill a dead original job', async () => {
    f = await developmentParentEndingStorageFixture(); const endings: string[] = [], claims: string[] = [];
    for (let i = 0; i < 27; i++) {
      const ending = await f.admit(f.identity(TaskIdSchema.parse(Bun.randomUUIDv7()))), claim = f.claim(ending.id);
      endings.push(ending.id); claims.push(claim.currentRebuildId); expect(await f.claims.insert(claim)).toBe(true);
    }
    endings.sort(); const cutoff = new Date();
    expect(await refill(cutoff)).toBe(17); const first = await jobs(), firstCursor = await cursor();
    expect(first.filter((j) => j.kind === DEVELOPMENT_PARENT_ENDING_JOB_KIND)).toHaveLength(9);
    expect(first.filter((j) => j.kind === REBUILD_JOB_KIND)).toHaveLength(8);
    expect(firstCursor.kind).toBe('claim'); expect(JSON.parse(firstCursor.after_id)).toEqual({ version: 2, ending: endings[8], claim: endings[7], rebuild: null, next: 'claim' });
    const dead = first.find((j) => j.kind === DEVELOPMENT_PARENT_ENDING_JOB_KIND)!;
    await f.db.execute(sql`UPDATE platform_infra.jobs SET state='dead',attempts=5,last_error='controlled original attempt budget exhausted' WHERE id=${dead.id}`);
    expect(await refill(cutoff)).toBe(25); const secondCursor = await cursor();
    expect(secondCursor.kind).toBe('claim'); expect(JSON.parse(secondCursor.after_id)).toEqual({ version: 2, ending: endings[24], claim: endings[16], rebuild: null, next: 'rebuild' });
    expect(await refill(cutoff)).toBe(12); const all = await jobs();
    expect(new Set(all.filter((j) => j.kind === DEVELOPMENT_PARENT_ENDING_JOB_KIND).map((j) => j.dedup_key))).toEqual(new Set(endings));
    expect(new Set(all.filter((j) => j.kind === REBUILD_JOB_KIND).map((j) => j.dedup_key))).toEqual(new Set(claims));
    expect(JSON.parse((await cursor()).after_id)).toEqual({ version: 2, ending: null, claim: null, rebuild: null, next: 'ending' });
    expect(await refill(cutoff)).toBe(17); const recovered = (await jobs()).filter((j) => j.dedup_key === dead.dedup_key);
    expect(recovered).toHaveLength(2); expect(recovered[0]?.state).toBe('dead');
    expect(recovered[1]).toMatchObject({ state: 'pending', attempts: 0, max_attempts: 5 }); expect(recovered[1]?.id).not.toBe(dead.id);
    expect(Number((await cursor()).epoch)).toBe(Number(firstCursor.epoch) + 3);
    expect((await f.endings.get(endings[0]!))?.phase).toBe('admission-sealed');
  });
  test('empty or future families remain unknown; transaction and total-budget violations do not advance durable state', async () => {
    f = await developmentParentEndingStorageFixture(); const ending = await f.admit(), claim = { ...f.claim(ending.id), retryAt: new Date(Date.now() + 60000) };
    await f.claims.insert(claim); const cutoff = new Date(); expect(await refill(cutoff, 1)).toBe(1);
    const before = await cursor();
    for (const invalid of [0, -1, 1.5, 26, Number.NaN]) await expect(refill(cutoff, invalid)).rejects.toThrow('总预算 25');
    await expect(developmentParentRecovery(f.db, false).refill(cutoff)).rejects.toThrow('实际事务');
    expect(await cursor()).toEqual(before); expect((await jobs()).filter((j) => j.kind === REBUILD_JOB_KIND)).toHaveLength(0);
    expect(await refill(new Date(0))).toBe(0); expect((await f.endings.get(ending.id))?.completionWitness).toBeNull();
  });

  test('three families keep separate persistent positions, rotate fairly across recreation, and bound malformed candidate scanning', async () => {
    f = await developmentParentEndingStorageFixture(); const endings: string[] = [], rebuilds: string[] = [], claims: string[] = [];
    const columns = await f.db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
      WHERE table_schema='task_runtime' AND table_name='environments' AND is_generated='NEVER' ORDER BY ordinal_position`);
    const names = sql.join(columns.map((c) => sql.identifier(c.column_name)), sql`, `);
    const values = sql.join(columns.map((c) => sql`copy.${sql.identifier(c.column_name)}`), sql`, `);
    for (let i = 0; i < 27; i++) {
      const ending = await f.admit(f.identity(TaskIdSchema.parse(Bun.randomUUIDv7()))), claim = f.claim(ending.id);
      endings.push(ending.id); claims.push(claim.currentRebuildId); await f.claims.insert(claim);
      const id = Bun.randomUUIDv7(), taskId = Bun.randomUUIDv7(); rebuilds.push(id);
      // Synthetic SQL candidates exercise only bounded scanning. No completion witness or readiness is fabricated.
      await f.db.execute(sql`INSERT INTO task_runtime.environment_rebuilds
        (id,task_id,project_id,input,namespace,original_pod_name,pod_name,pvc_name,secret_name,image,state,creation,created_at,updated_at,development_parent_binding)
        VALUES (${id},${taskId},${f.projectId},'{}'::jsonb,${f.parent.namespace},'old','new','retained','new-runner','test','queued','owner',clock_timestamp(),clock_timestamp(),${JSON.stringify(i === 0 ? false : { storageOnly: true })}::jsonb)`);
      await f.db.execute(sql`INSERT INTO task_runtime.environments (${names}) SELECT ${values} FROM task_runtime.environments original
        CROSS JOIN LATERAL jsonb_populate_record(NULL::task_runtime.environments,to_jsonb(original)||jsonb_build_object(
          'id',${taskId}::text,'pod_name','new','state','creating','rebuild_id',${id}::text,'parent_ending',NULL,'render',NULL,'native',NULL)) copy WHERE original.id=${f.parent.id}`);
    }
    endings.sort(); rebuilds.sort(); const cutoff = new Date();
    expect(await refill(cutoff)).toBe(25); const first = await jobs();
    expect(first.filter((j) => j.kind === DEVELOPMENT_PARENT_ENDING_JOB_KIND)).toHaveLength(9);
    expect(first.filter((j) => rebuilds.includes(j.dedup_key))).toHaveLength(8);
    expect(first.filter((j) => claims.includes(j.dedup_key))).toHaveLength(8);
    expect(JSON.parse((await cursor()).after_id)).toEqual({ version: 2, ending: endings[8], claim: endings[7], rebuild: rebuilds[7], next: 'claim' });
    expect(await refill(cutoff)).toBe(25);
    expect(JSON.parse((await cursor()).after_id)).toEqual({ version: 2, ending: endings[16], claim: endings[16], rebuild: rebuilds[15], next: 'rebuild' });
    expect(await refill(cutoff)).toBe(25);
    expect(JSON.parse((await cursor()).after_id)).toEqual({ version: 2, ending: endings[24], claim: endings[24], rebuild: rebuilds[24], next: 'ending' });
    expect(await refill(cutoff)).toBe(6);
    expect(JSON.parse((await cursor()).after_id)).toEqual({ version: 2, ending: null, claim: null, rebuild: null, next: 'claim' });
    const all = await jobs(); expect(new Set(all.map((j) => j.dedup_key)).size).toBe(81);
    expect(all.every((j) => j.max_attempts === 5 && j.state === 'pending')).toBe(true);
    expect((await f.db.execute(sql`SELECT id FROM task_runtime.environments WHERE state='running' AND id<>${f.parent.id}`))).toHaveLength(0);
    expect((await f.endings.get(endings[0]!))?.completionWitness).toBeNull();
  });
  test('old scalar/v1 positions migrate once; malformed v2 control never resets other family positions', async () => {
    f = await developmentParentEndingStorageFixture(); const endings: string[] = [];
    for (let i = 0; i < 3; i++) { const ending = await f.admit(f.identity(TaskIdSchema.parse(Bun.randomUUIDv7()))); endings.push(ending.id); await f.claims.insert(f.claim(ending.id)); }
    endings.sort(); const cutoff = new Date(); await refill(new Date(0));
    await f.db.execute(sql`UPDATE task_runtime.development_parent_recovery_sweep SET kind='ending',after_id=${endings[0]}`);
    expect(await refill(cutoff, 1)).toBe(1);
    expect(JSON.parse((await cursor()).after_id)).toEqual({ version: 2, ending: endings[1], claim: null, rebuild: null, next: 'claim' });
    await f.db.execute(sql`UPDATE task_runtime.development_parent_recovery_sweep SET kind='claim',after_id=${JSON.stringify({ version: 1, ending: endings[1], claim: endings[0] })}`);
    expect(await refill(cutoff, 1)).toBe(1);
    expect(JSON.parse((await cursor()).after_id)).toEqual({ version: 2, ending: endings[1], claim: endings[1], rebuild: null, next: 'rebuild' });
    for (const invalid of [{ version: 2, ending: endings[1], claim: endings[1], rebuild: null, next: 'unknown' }, { version: 2, ending: endings[1], claim: endings[1], next: 'ending' }]) {
      await f.db.execute(sql`UPDATE task_runtime.development_parent_recovery_sweep SET after_id=${JSON.stringify(invalid)}`);
      const before = await cursor(); await expect(refill(cutoff)).rejects.toThrow(); expect(await cursor()).toEqual(before);
    }
  });
});
