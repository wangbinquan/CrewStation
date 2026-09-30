import type { EventDelivery } from '@crewstation/contracts';
import { sql } from 'drizzle-orm';
import type { EventsDeletionFixture } from './projectDeletionFixture';

export function heldDelivery(f: EventsDeletionFixture) {
  const entered = Promise.withResolvers<void>(),held = Promise.withResolvers<void>(); let calls = 0;
  const application = f.application({ push: async (_url,body) => {
    calls += 1;
    if ((body as EventDelivery).deliveryId === f.ids.delivery) { entered.resolve(); await held.promise; }
    return { ok: true,status: 200 };
  } });
  const running = application.api.deliver(f.ids.delivery).then((result) => ({ result }),() => ({ disconnected: true }));
  return { application,running,entered: entered.promise,release: () => held.resolve(),calls: () => calls };
}
export async function waitForDeliveryFact(f: EventsDeletionFixture, kind: 'exclusive-wait' | 'finished') {
  const query = kind === 'finished' ? sql`SELECT EXISTS(SELECT 1 FROM events.deletion_work WHERE delivery_id=${f.ids.delivery} AND state='finished') AS found`
    : sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objsubid=1
      AND classid::bigint=((hashtextextended(${`events.project-admission:${f.own.id}`},0) >> 32) & 4294967295) AND objid::bigint=(hashtextextended(${`events.project-admission:${f.own.id}`},0) & 4294967295)) AS found`;
  const deadline = Date.now()+3000;
  while (Date.now() < deadline) { if ((await f.database.db.execute<{ found: boolean }>(query))[0]?.found) return true; await Bun.sleep(10); }
  return false;
}
