import { afterEach, describe, expect, test } from 'bun:test';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { DeliveryProcess } from '../ports/deliveryProcesses';
import { eventsDeletionFixture, type EventsDeletionFixture } from './projectDeletionFixture';

const available = await testDatabaseAvailable(); let f: EventsDeletionFixture;
afterEach(async () => { await f?.database.drop(); });
describe.skipIf(!available)('原投递进程退出恢复（真实 Bun 子进程与 PG，物理容器端口替身）',() => {
  test('实际进程退出前后都不凭租约恢复；替换的 Pod／容器／节点不能证明原来源，完整原证明才结束',async () => {
    f = await eventsDeletionFixture();
    const source: DeliveryProcess = { podUid: Bun.randomUUIDv7(),containerId: 'containerd://native-fixture',nodeUid: Bun.randomUUIDv7(),nodeName: 'original-node' };
    const child = Bun.spawn([process.execPath,`${import.meta.dir}/deliveryProcessFixture.ts`],{ cwd: process.cwd(),stdout: 'pipe',stderr: 'ignore',stdin: 'ignore',
      env: { ...process.env,CS_TEST_DELIVERY_DATABASE_URL: f.database.url,CS_TEST_DELIVERY_ID: f.ids.delivery,CS_TEST_DELIVERY_PROCESS: JSON.stringify(source) } });
    let childExited = false;
    try {
      const reader = child.stdout.getReader(),first = await reader.read(); reader.releaseLock();
      expect(first.done).toBe(false); expect(new TextDecoder().decode(first.value)).toBe('PUSH_STARTED\n');
      const started = await f.begin();
      const [claim] = await f.database.db.execute<{ backend_pid: number; generation: number }>(sql`SELECT backend_pid,generation FROM events.deletion_work WHERE delivery_id=${f.ids.delivery}`);
      expect(claim?.generation).toBe(1); await f.database.db.execute(sql`SELECT pg_terminate_backend(${claim!.backend_pid})`);
      expect((await f.events.api.deletionOwner!.run(started.context)).kind).toBe('waiting');
      expect(child.exitCode).toBeNull();
      child.kill('SIGTERM'); const exitCode = await child.exited; childExited = true; expect(exitCode).not.toBe(0);
      // 实际 Bun 已退出，但物理端口没有原容器证明时仍保持 running；没有假定 Pod 缺失即停止。
      expect((await f.events.api.deletionOwner!.run(started.context)).kind).toBe('waiting');
      for (const changed of [{ podUid: Bun.randomUUIDv7() },{ containerId: 'containerd://replacement' },{ nodeUid: Bun.randomUUIDv7() },{ nodeName: 'replacement-node' }]) {
        const different = { ...source,...changed };
        const recovery = f.application(undefined,{ protectCurrent: async () => different,sweep: async (accept) => { await accept.stopped(different,jsonHash({ source: different,exitCode })); expect(await accept.releasable(source.podUid)).toBe(false); } });
        await recovery.recoveryWorker.runOnce();
        expect((await f.database.db.execute(sql`SELECT state FROM events.deletion_work WHERE delivery_id=${f.ids.delivery}`))[0]?.state).toBe('running');
      }
      const digest = jsonHash({ source,pid: child.pid,exitCode });
      const recovery = f.application(undefined,{ protectCurrent: async () => source,sweep: async (accept) => { await accept.stopped(source,digest); expect(await accept.releasable(source.podUid)).toBe(true); } });
      await recovery.recoveryWorker.runOnce(); await recovery.recoveryWorker.runOnce();
      expect((await f.database.db.execute(sql`SELECT state,proof_digest FROM events.deletion_work WHERE delivery_id=${f.ids.delivery}`))[0]).toEqual({ state: 'finished',proof_digest: digest });
      expect((await f.events.api.deletionOwner!.run(started.context)).kind).toBe('done');
      await expect(recovery.api.deliver(f.ids.delivery)).rejects.toThrow();
      expect((await f.database.db.execute(sql`SELECT attempts FROM events.deliveries WHERE id=${f.ids.delivery}`))[0]?.attempts).toBe(1);
    } finally { if (!childExited) { child.kill('SIGTERM'); await child.exited; } }
  },15_000);
});
