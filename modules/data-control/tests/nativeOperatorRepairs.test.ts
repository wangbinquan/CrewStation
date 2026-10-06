import { expect, test } from 'bun:test';
import postgres from 'postgres';
import type { Actor } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { withSharedDatabaseAdmission } from '@crewstation/persistence';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { nativeAdmissionKey } from '../adapters/persistence/nativeWork';
import { nativeOwnerFixture, nativeOwnerUrl } from './nativeDeletionFixture';

const available = await testDatabaseAvailable();
type Fixture = Parameters<Parameters<typeof nativeOwnerFixture>[0]>[0];
async function legacyCallback(f: Fixture, bind = true) {
  const client = postgres(nativeOwnerUrl, { max: 1, onnotice: () => undefined }), work = newResourceId();
  try {
    const [native] = await client.unsafe<{ pid: number; started: string; identifier: string }[]>("SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS started,(SELECT system_identifier::text FROM pg_control_system()) AS identifier");
    const endpoint = new URL(nativeOwnerUrl); endpoint.username = ''; endpoint.password = ''; endpoint.pathname = '/postgres';
    await withSharedDatabaseAdmission(f.database.db, nativeAdmissionKey(f.origin.projectId), async (guard) => {
      const [backend] = await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      await guard.execute(sql`SELECT set_config('crewstation.shared_admission_pid',${String(backend!.pid)},true)`);
      await guard.execute(sql`INSERT INTO data_control.deletion_work(work_id,resource_id,project_id,backend_pid,names,pod_uid,container_id,node_uid,node_name)
        VALUES(${work},${f.origin.resourceId},${f.origin.projectId},${backend!.pid},${JSON.stringify([f.name, f.role])}::jsonb,'controlled-original-pod','controlled-original-container','controlled-node','controlled-node-name')`);
      if (bind) await guard.execute(sql`UPDATE data_control.deletion_work SET native_pid=${native!.pid},native_started=${native!.started},source_identity=${jsonHash({ endpoint: endpoint.toString(), identifier: native!.identifier })} WHERE work_id=${work}`);
      await guard.execute(sql`SELECT set_config('crewstation.data_control_work_exit',${work},true)`);
      await guard.execute(sql`UPDATE data_control.deletion_work SET state='finished' WHERE work_id=${work}`);
    });
  } finally { await client.end(); }
  return work;
}
const actor: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true };
test.skipIf(!available)('explicit current registered-name baseline handles missing resource versions without rewriting legacy history and still completes physical cleanup', () => nativeOwnerFixture(async (f) => {
  const work = await legacyCallback(f), original = [...await f.database.db.execute(sql`SELECT to_jsonb(r) AS body FROM data_control.deletion_work r WHERE work_id=${work}`)];
  f.historyValue.complete = false;
  f.historyValue.blockers = [{ participant: 'data-control', code: 'native-revisions-unavailable', message: '原资源旧版本正文未保留', resourceId: f.origin.resourceId }];
  Object.assign(f.historyValue, { currentRecordsComplete: true });
  const owner = () => f.owner(), [item] = await owner().repairs!.inspect(f.target);
  expect(item!.allowedDecisions).toEqual(['reclaim']);
  expect(item!.facts.some((fact) => fact.label === '旧资源版本' && fact.value.includes('未恢复'))).toBe(true);
  expect((await owner().inspect(f.target)).complete).toBe(false);
  await owner().repairs!.confirm(f.target, actor, { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'reclaim' });
  expect(f.historyValue.complete).toBe(false);
  expect([...await f.database.db.execute(sql`SELECT to_jsonb(r) AS body FROM data_control.deletion_work r WHERE work_id=${work}`)]).toEqual(original);
  const report = await owner().inspect(f.target); expect(report.complete).toBe(true);
  for (const phase of ['seal', 'stop', 'purge', 'prove', 'namespace', 'metadata', 'verify'] as const) expect(await owner().run(f.context(report, phase))).toMatchObject({ kind: 'done' });
  expect(await f.catalog()).toHaveLength(0);
}));
test.skipIf(!available)('current name completeness cannot excuse invalid aliases, foreign endpoints, compacted identities or an incomplete source', () => nativeOwnerFixture(async (f) => {
  await legacyCallback(f); f.historyValue.complete = false;
  for (const code of ['native-identity-compacted', 'native-declaration-invalid', 'native-owner-unknown', 'legacy-endpoint-unverified', 'native-name-unregistered']) {
    Object.assign(f.historyValue, { currentRecordsComplete: true });
    f.historyValue.blockers = [{ participant: 'data-control', code, message: code }];
    const [item] = await f.owner().repairs!.inspect(f.target); expect(item!.allowedDecisions).toEqual([]);
  }
  f.historyValue.blockers = [{ participant: 'data-control', code: 'native-revisions-unavailable', message: 'missing original versions' }];
  for (const currentRecordsComplete of [false, undefined]) {
    Object.assign(f.historyValue, { currentRecordsComplete });
    expect((await f.owner().repairs!.inspect(f.target))[0]!.allowedDecisions).toEqual([]);
    expect((await f.owner().inspect(f.target)).complete).toBe(false);
  }
  expect(await f.catalog()).toHaveLength(2);
}));
test.skipIf(!available)('current native baseline survives timestamp-only rereads/restarts, preserves legacy NULL and still requires all physical phases and directory proof', () => nativeOwnerFixture(async (f) => {
  const work = await legacyCallback(f), original = [...await f.database.db.execute(sql`SELECT to_jsonb(r) AS body FROM data_control.deletion_work r WHERE work_id=${work}`)];
  const owner = () => f.owner(), repair = () => owner().repairs!;
  expect((await owner().inspect(f.target)).complete).toBe(false);
  const [item] = await repair().inspect(f.target); expect(item!.allowedDecisions).toEqual(['reclaim']); expect(item!.confirmed).toBeNull(); expect(item!.blockers).toEqual([]);
  expect((await repair().inspect(f.target))[0]!.evidenceDigest).toBe(item!.evidenceDigest);
  const input = { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'reclaim' as const };
  await expect(repair().confirm(f.target, { ...actor, isAdmin: false }, input)).rejects.toThrow();
  expect((await repair().confirm(f.target, actor, input)).confirmed?.actorId).toBe(actor.userId);
  expect((await repair().inspect(f.target))[0]!.confirmed?.actorId).toBe(actor.userId);
  expect([...await f.database.db.execute(sql`SELECT to_jsonb(r) AS body FROM data_control.deletion_work r WHERE work_id=${work}`)]).toEqual(original);
  const report = await owner().inspect(f.target); expect(report.complete).toBe(true); const catalog = await f.catalog(); expect(catalog).toHaveLength(2);
  await expect(f.database.db.execute(sql`DELETE FROM data_control.operator_confirmations`).then(() => undefined)).rejects.toThrow();
  await expect(owner().run(f.context(report, 'purge'))).rejects.toThrow();
  for (const phase of ['seal', 'stop', 'purge', 'prove', 'namespace', 'metadata', 'verify'] as const) expect(await owner().run(f.context(report, phase))).toMatchObject({ kind: 'done' });
  expect(await f.catalog()).toHaveLength(0);
  for (const entry of catalog.filter((entry) => entry.kind === 'database')) expect((await f.admin.unsafe('SELECT (pg_stat_file($1,true)).isdir AS directory', ['base/' + entry.oid]))[0]?.directory).toBeNull();
}));
test.skipIf(!available)('native current confirmation rejects active consumers, missing original backend and replaced independent source without catalog deletion', () => nativeOwnerFixture(async (f) => {
  await legacyCallback(f);
  const repair = f.owner().repairs!, [item] = await repair.inspect(f.target), input = { owner: item!.owner, key: item!.key, originalDigest: item!.originalDigest, evidenceDigest: item!.evidenceDigest, decision: 'reclaim' as const };
  const url = new URL(nativeOwnerUrl); url.pathname = '/' + f.name; const consumer = postgres(url.toString(), { max: 1 });
  try { await consumer.unsafe('SELECT 1'); expect((await repair.inspect(f.target))[0]!.allowedDecisions).toEqual([]); await expect(repair.confirm(f.target, actor, input)).rejects.toThrow(); }
  finally { await consumer.end(); }
  await repair.confirm(f.target, actor, input); f.replaceSource(); expect((await f.owner().inspect(f.target)).complete).toBe(false); await expect(repair.confirm(f.target, actor, input)).rejects.toThrow();
  expect(await f.catalog()).toHaveLength(2);
}));
test.skipIf(!available)('finished legacy work with missing original backend remains blocked despite current catalog and volume', () => nativeOwnerFixture(async (f) => {
  await legacyCallback(f, false); const [item] = await f.owner().repairs!.inspect(f.target);
  expect(item!.allowedDecisions).toEqual([]); expect(item!.blockers.join(' ')).toContain('原实际连接'); expect((await f.owner().inspect(f.target)).complete).toBe(false); expect(await f.catalog()).toHaveLength(2);
}));
