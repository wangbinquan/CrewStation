import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { heldDelivery, waitForDeliveryFact } from './projectDeletionWorkFixture';
import { eventsDeletionFixture, type EventsDeletionFixture } from './projectDeletionFixture';

const available = await testDatabaseAvailable(); let f: EventsDeletionFixture;
afterEach(async () => { await f?.database.drop(); });
describe.skipIf(!available)('事件实际推送屏障（真实 PG、真实在途回调）',() => {
  test('删除等待两端原推送退出；其他项目继续；更新回执后须在原操作重新确认',async () => {
    f = await eventsDeletionFixture(); const work = heldDelivery(f); await work.entered;
    let sealing: ReturnType<NonNullable<typeof work.application.api.deletionOwner>['run']> | undefined;
    const started = await f.begin();
    try {
      expect(started.context.confirmed.resources.find((r) => r.kind === 'deletion_work')?.count).toBe(1);
      let finished = false; sealing = work.application.api.deletionOwner!.run(started.context).finally(() => { finished = true; });
      expect(await waitForDeliveryFact(f,'exclusive-wait')).toBe(true); expect(finished).toBe(false);
      expect((await work.application.api.deliver(f.ids.foreignDelivery)).state).toBe('delivered'); expect(work.calls()).toBe(2);
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE events.deletion_work SET state='finished' WHERE delivery_id=${f.ids.delivery}`))).rejects.toThrow();
      await expect(Promise.resolve(f.database.db.execute(sql`DELETE FROM events.deletion_work WHERE delivery_id=${f.ids.delivery}`))).rejects.toThrow();
    } finally { work.release(); await work.running; }
    expect(await sealing).toMatchObject({ kind: 'blocked',blockers: [{ code: 'inventory-changed' }] });
    expect(await waitForDeliveryFact(f,'finished')).toBe(true);
    expect((await work.application.api.deletionOwner!.run(started.context)).kind).toBe('blocked');
    await f.project.api.blockProjectDeletion(started.lease,[{ participant: 'events',code: 'inventory-changed',message: '原投递已经完成，更新材料确认' }]);
    const report = await work.application.api.deletionOwner!.inspect(started.context.target),reports = started.plan.participants.map((r) => r.participant === 'events' ? report : r);
    const plan = await f.project.api.prepareProjectDeletionReconfirmation(f.admin,started.operation.id,reports);
    await f.project.api.reconfirmProjectDeletion(f.admin,started.operation.id,{ planId: plan.id,requestKey: newResourceId(),confirm: 'delete' },reports);
    const claimed = (await f.project.api.claimProjectDeletion(started.operation.id,'events-reconfirmation'))!;
    await expect(work.application.api.deletionOwner!.run({ ...started.context,generation: claimed.lease.generation })).rejects.toThrow();
    expect((await work.application.api.deletionOwner!.run({ ...started.context,generation: claimed.lease.generation,target: plan.target,confirmed: plan.participants.find((p) => p.participant === 'events')! })).kind).toBe('done');
    expect(work.calls()).toBe(2);
  },20_000);
  test('真实 pg_terminate_backend 后仍有回调在运行；只凭断线不能 seal，迟到结果不能复活内容',async () => {
    f = await eventsDeletionFixture(); const work = heldDelivery(f); await work.entered;
    try {
      const started = await f.begin();
      const [row] = await f.database.db.execute<{ backend_pid: number }>(sql`SELECT backend_pid FROM events.deletion_work WHERE delivery_id=${f.ids.delivery}`);
      expect(row?.backend_pid).toBeGreaterThan(0); await f.database.db.execute(sql`SELECT pg_terminate_backend(${row!.backend_pid})`);
      expect(await work.running).toEqual({ disconnected: true });
      expect((await work.application.api.deletionOwner!.run(started.context)).kind).toBe('waiting');
      expect((await f.database.db.execute(sql`SELECT state FROM events.deletion_work WHERE delivery_id=${f.ids.delivery}`))[0]?.state).toBe('running');
      await expect(work.application.api.deliver(f.ids.delivery)).rejects.toThrow(); expect(work.calls()).toBe(1);
      work.release(); expect(await waitForDeliveryFact(f,'finished')).toBe(true);
      expect((await work.application.api.deletionOwner!.run(started.context)).kind).toBe('done');
      expect((await f.database.db.execute(sql`SELECT state FROM events.deliveries WHERE id=${f.ids.delivery}`))[0]?.state).toBe('delivering');
      expect(work.calls()).toBe(1);
    } finally { work.release(); await work.running; await waitForDeliveryFact(f,'finished'); }
  },15_000);
});
