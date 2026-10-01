import { afterEach, describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { gatewayDeletionFixture, type GatewayDeletionFixture } from './gatewayDeletionFixture';
import { gatewayDeletionRepository } from '../adapters/persistence/projectDeletion';
import type { GatewayProcess } from '../ports/repositories';

const available = await testDatabaseAvailable(); let f: GatewayDeletionFixture;
afterEach(async () => { await f?.db.drop(); });
function heldRoutes() {
  const entered = Promise.withResolvers<void>(), held = Promise.withResolvers<void>(); let calls = 0;
  const application = f.application({ applier: { applyRoutes: async (name) => { calls += 1; if (name === f.own.slug) { entered.resolve(); await held.promise; } },
    applyMiddlewares: async () => {}, removeRoutes: async () => {} } });
  const running = application.api.reconcileService(f.own.serviceId!).then((result) => ({ result }), () => ({ disconnected: true }));
  return { application, running, entered: entered.promise, release: () => held.resolve(), calls: () => calls };
}
async function waitForFact(kind: 'exclusive-wait' | 'finished') {
  const query = kind === 'finished' ? sql`SELECT EXISTS(SELECT 1 FROM gateway.deletion_work WHERE project_id=${f.own.id} AND state='finished') AS found`
    : sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objsubid=1
      AND classid::bigint=((hashtextextended(${'gateway.project-admission:' + f.own.id},0) >> 32) & 4294967295) AND objid::bigint=(hashtextextended(${'gateway.project-admission:' + f.own.id},0) & 4294967295)) AS found`;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if ((await f.db.db.execute<{ found: boolean }>(query))[0]?.found) return true; await Bun.sleep(10); }
  return false;
}

describe.skipIf(!available)('网关原外部回调退出（真实 PG、实际挂起回调）', () => {
  test('seal 等原实际回调；其他项目仍可调和；回调新内容需要原操作重新确认', async () => {
    f = await gatewayDeletionFixture(); const work = heldRoutes(); await work.entered; const started = await f.begin();
    let sealed = false; const sealing = work.application.api.deletionOwner!.run(started.context).finally(() => { sealed = true; });
    try {
      expect(started.context.confirmed.resources.filter((r) => r.kind === 'gateway-callback')).toHaveLength(1);
      expect(await waitForFact('exclusive-wait')).toBe(true); expect(sealed).toBe(false);
      expect((await work.application.api.reconcileService(f.other.serviceId!)).length).toBe(3); expect(work.calls()).toBe(2);
      await expect(Promise.resolve(f.db.db.execute(sql`UPDATE gateway.deletion_work SET state='finished' WHERE project_id=${f.own.id}`))).rejects.toThrow();
      await expect(Promise.resolve(f.db.db.execute(sql`DELETE FROM gateway.deletion_work WHERE project_id=${f.own.id}`))).rejects.toThrow();
    } finally { work.release(); await work.running; }
    expect(await sealing).toMatchObject({ kind: 'blocked', blockers: [{ code: 'inventory-changed' }] });
    expect(await waitForFact('finished')).toBe(true);
    expect((await work.application.api.deletionOwner!.run(started.context)).kind).toBe('blocked');
    expect(work.calls()).toBe(2);
  }, 20_000);

  test('真实 pg_terminate_backend 不代表回调结束；finally 独立登记退出，迟到结果不能恢复路由内容', async () => {
    f = await gatewayDeletionFixture(); const work = heldRoutes(); await work.entered;
    try {
      const started = await f.begin(), [row] = await f.db.db.execute<{ backend_pid: number; pod_uid: string; container_id: string; node_uid: string; node_name: string }>(sql`SELECT backend_pid,pod_uid,container_id,node_uid,node_name FROM gateway.deletion_work WHERE project_id=${f.own.id} AND state='running'`);
      expect(row?.backend_pid).toBeGreaterThan(0); expect(row).toMatchObject({ pod_uid: f.process.podUid, container_id: f.process.containerId, node_uid: f.process.nodeUid, node_name: f.process.nodeName });
      await f.db.db.execute(sql`SELECT pg_terminate_backend(${row!.backend_pid})`); expect(await work.running).toEqual({ disconnected: true });
      expect((await work.application.api.deletionOwner!.run(started.context)).kind).toBe('waiting');
      expect((await f.db.db.execute(sql`SELECT state FROM gateway.deletion_work WHERE project_id=${f.own.id}`))[0]?.state).toBe('running');
      await expect(work.application.api.reconcileService(f.own.serviceId!)).rejects.toMatchObject({ kind: 'precondition' }); expect(work.calls()).toBe(1);
      work.release(); expect(await waitForFact('finished')).toBe(true);
      expect((await work.application.api.deletionOwner!.run(started.context)).kind).toBe('done');
      expect((await f.db.db.execute(sql`SELECT routes FROM gateway.routes WHERE service_id=${f.own.serviceId}`))[0]?.routes).toEqual([{ private: 'erase-owned' }]);
      expect(work.calls()).toBe(1);
    } finally { work.release(); await work.running; await waitForFact('finished'); }
  }, 15_000);

  test('只有原 Pod、containerID、Node UID、节点名的停止摘要能恢复原回调；替换来源不排空', async () => {
    f = await gatewayDeletionFixture(); const work = heldRoutes(); await work.entered;
    try {
      const started = await f.begin(), [row] = await f.db.db.execute<{ backend_pid: number }>(sql`SELECT backend_pid FROM gateway.deletion_work WHERE project_id=${f.own.id} AND state='running'`);
      await f.db.db.execute(sql`SELECT pg_terminate_backend(${row!.backend_pid})`); await work.running;
      let stopped: GatewayProcess | undefined, releasable = false;
      const repository = gatewayDeletionRepository(f.db.db, { originals: f.originals, assertGrant: f.project.api.assertProjectDeletionGrant,
        processes: { protectCurrent: async () => f.process, sweep: async (accept) => { if (stopped) await accept.stopped(stopped, jsonHash(stopped)); releasable = await accept.releasable(f.process.podUid); } } });
      for (const patch of [{ podUid: 'replacement' }, { containerId: 'containerd://replacement' }, { nodeUid: 'replacement' }, { nodeName: 'replacement' }]) {
        stopped = { ...f.process, ...patch }; expect(await repository.seal(started.context)).toBe('waiting'); expect(releasable).toBe(false);
      }
      stopped = { ...f.process }; expect(await repository.seal(started.context)).toBe('sealed'); expect(releasable).toBe(true);
      expect((await f.db.db.execute(sql`SELECT state,proof_digest FROM gateway.deletion_work WHERE project_id=${f.own.id}`))[0]).toEqual({ state: 'finished', proof_digest: jsonHash(f.process) });
      await expect(Promise.resolve(f.db.db.execute(sql`UPDATE gateway.deletion_process_stops SET node_uid='rewrite'`))).rejects.toThrow();
      // 这里只验证数据库消费原来源证明；证明的物理真实性由平台适配器及后续原容器验收承担。
    } finally { work.release(); await work.running; await waitForFact('finished'); }
  }, 15_000);
});
