import { describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { eventsMigrations } from '../wiring';
import { eventsDeletionFixture } from './projectDeletionFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('delivery infrastructure origins (real PG; not a physical stop receipt)', () => {
  test('recipient and producer projects stay distinct; unrelated delivery jobs do not enter the target scope', async () => {
    const f = await eventsDeletionFixture();
    try {
      const own = await f.events.api.originalDeliveryOwnership(f.ids.delivery);
      const incoming = await f.events.api.originalDeliveryOwnership(f.ids.incomingDelivery);
      const foreign = await f.events.api.originalDeliveryOwnership(f.ids.foreignDelivery);
      expect(own?.projectIds).toEqual([f.own.id,f.source.id].sort());
      expect(incoming?.projectIds).toEqual([f.own.id,f.other.id].sort());
      expect(foreign?.projectIds).toEqual([f.source.id,f.other.id].sort());
      expect(foreign?.projectIds).not.toContain(f.own.id);
      expect(own).toMatchObject({complete:true,id:f.ids.delivery,scope:'project'});
      expect(own?.revision).toMatch(/^[a-f0-9]{64}$/);
      expect(await f.events.api.originalDeliveryOwnership(Bun.randomUUIDv7())).toBeUndefined();
      expect(await f.events.api.originalDeliveryOwnership('unknown-old-key','legacy')).toBeUndefined();
    } finally { await f.database.drop(); }
  });
  test('old alias resolves the original UUID before and after owner metadata purge; minimum source relationships stay the same', async () => {
    let oldId = '';
    const f = await eventsDeletionFixture(async (db) => {
      const rows = await db.execute<{id:string}>(sql`SELECT id FROM events.deliveries WHERE last_error='erase-error'`);
      oldId = rows[0]!.id;
      await db.execute(sql`INSERT INTO events.resource_identity_aliases(kind,key,id) VALUES('delivery',${JSON.stringify(['old-delivery'])},${oldId})`);
    });
    try {
      const directory = resourceIdentityDirectory(f.database.db,() => [eventsMigrations]);
      const resolved = await directory.resolve('delivery',['old-delivery']);
      expect(resolved).toBe(f.ids.delivery); expect(resolved).toBe(oldId);
      const before = await f.events.api.originalDeliveryOwnership(resolved!);
      expect(await f.events.api.originalDeliveryOwnership('old-delivery','legacy')).toEqual(before);
      const started = await f.begin(); await f.proceed(started,'metadata');
      expect((await f.database.db.execute(sql`SELECT id FROM events.deliveries WHERE id=${resolved}`)).length).toBe(0);
      expect(await directory.resolve('delivery',['old-delivery'])).toBe(resolved);
      expect(await f.events.api.originalDeliveryOwnership(resolved!)).toEqual(before);
      expect(await f.events.api.originalDeliveryOwnership('old-delivery','legacy')).toEqual(before);
      expect(JSON.stringify(before)).not.toContain('erase-error'); expect(JSON.stringify(before)).not.toContain('old-delivery');
    } finally { await f.database.drop(); }
  },15_000);
  test('missing original links or a conflicting current parent are rejected instead of becoming another-project or empty scope', async () => {
    const f = await eventsDeletionFixture();
    try {
      await f.database.db.execute(sql`DELETE FROM events.deletion_links WHERE kind='delivery' AND entity_key=${f.ids.delivery} AND project_id=${f.source.id}`);
      await expect(f.events.api.originalDeliveryOwnership(f.ids.delivery)).rejects.toThrow('历史原项目');
      await f.database.db.execute(sql`DELETE FROM events.deletion_links WHERE kind='delivery' AND entity_key=${f.ids.delivery}`);
      await expect(f.events.api.originalDeliveryOwnership(f.ids.delivery)).rejects.toThrow('不完整');
      await expect(Promise.resolve(f.database.db.execute(sql`UPDATE events.deliveries SET project_id=${f.own.id} WHERE id=${f.ids.foreignDelivery}`))).rejects.toThrow();
    } finally { await f.database.drop(); }
  });
});
