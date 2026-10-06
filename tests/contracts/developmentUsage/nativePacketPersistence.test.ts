import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { NativeUsagePassPageSchema, TaskIdSchema } from '../../../packages/contracts/index';
import { connectDatabase } from '../../../packages/persistence/index';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit/index';
import { jsonHash } from '../../../packages/kernel/index';
import { prepareDevelopmentNativePacket } from '../../../modules/observability/domain/developmentUsage/packet';
import { developmentNativeMetadata } from '../../../modules/observability/domain/developmentUsage/metadata';
import { drizzleUsageLedger } from '../../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { pendingDevelopmentNativePasses } from '../../../modules/observability/adapters/persistence/developmentUsage/packets';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { nativePassFixture } from './nativePassFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await database?.drop(); });
type Packet = ReturnType<typeof prepareDevelopmentNativePacket>;
const scope = (packet: Packet) => ({ projectId: packet.registration.identity.projectId, taskId: packet.registration.identity.taskId });
async function retain(packet: Packet, fail = false) {
  return drizzleUsageLedger(database.db).changeDevelopment(scope(packet), packet.streamSourceId, async (tx) => {
    const result = await tx.developmentPacket(packet);
    if (!result.duplicate) await tx.advance('original-ordinary:' + packet.event.sequence, packet.fingerprint);
    if (fail) throw new Error('fixture rollback before ordinary ACK');
    return result;
  });
}
describe.skipIf(!available)('actual original WAL pages retained in the one platform PG usage transaction', () => {
  test('all 1201 original steps and deep parents survive split packets, new connections, ordinary cursor ACK and source EOF', async () => {
    const source = await nativePassFixture(1201, 70, true, 1000);
    try {
      let cursor: string | null = source.reader.initialCursor, first = true, passKey = '';
      while (cursor !== null) {
        const raw = source.reader.next(cursor), packets = source.packets(raw).map(prepareDevelopmentNativePacket);
        for (const [index, packet] of packets.entries()) {
          const result = await retain(packet); passKey = result.passKey;
          if (first && index === 0) {
            expect(packets.length).toBeGreaterThan(1); expect(result.sourceComplete).toBe(false);
            const fresh = connectDatabase(database.url);
            try {
              const pending = await pendingDevelopmentNativePasses(fresh.db, null);
              const restored = pending.items.find((row) => row.pass_key === passKey)!;
              expect(restored.progress.ordinal).toBe('0'); expect(restored.state).toBe('receiving');
              expect(await drizzleUsageLedger(fresh.db).cursor(scope(packet), packet.streamSourceId)).toBe('original-ordinary:' + packet.event.sequence);
              expect(await drizzleUsageLedger(fresh.db).changeDevelopment(scope(packet), packet.streamSourceId, (tx) => tx.developmentPacket(packet))).toMatchObject({ duplicate: true, sourceComplete: false });
            } finally { await fresh.close(); }
          }
        }
        first = false; source.reader.acknowledge(raw.ordinal, raw.payloadDigest); cursor = raw.nextCursor;
      }
      const [pass] = await database.handle.client`SELECT progress,state,work_state FROM observability.development_native_passes WHERE pass_key=${passKey}`;
      expect(pass).toMatchObject({ state: 'source-eof', work_state: 'pending', progress: { eof: true, counts: { sessions: '71', parts: '2402', steps: '1201' } } });
      const [counts] = await database.handle.client`SELECT
        (SELECT count(*)::text FROM observability.development_native_steps WHERE pass_key=${passKey}) AS steps,
        (SELECT count(*)::text FROM observability.development_native_sessions WHERE pass_key=${passKey}) AS sessions,
        (SELECT count(*)::text FROM observability.development_native_pages WHERE pass_key=${passKey} AND NOT complete) AS incomplete`;
      expect(counts).toEqual({ steps: '1201', sessions: '71', incomplete: '0' });
      const [row] = await database.handle.client`SELECT document FROM observability.development_native_steps WHERE pass_key=${passKey} ORDER BY original_id LIMIT 1`;
      expect(Object.keys(row!.document).sort()).toEqual(['fingerprint','id','index','ordinal','parentSessionId','sessionId']);
      for (const name of ['usage_evidence','usage_projections','execution_valuations']) {
        const [count] = await database.handle.client.unsafe('SELECT count(*)::text AS total FROM observability.' + name);
        expect(count!.total).toBe('0');
      }
    } finally { await source.close(); }
  }, 60_000);
  test('failed platform transactions retain neither a packet nor the ordinary source cursor', async () => {
    const source = await nativePassFixture(1, 0);
    try {
      const packet = prepareDevelopmentNativePacket(source.packets(source.reader.next(source.reader.initialCursor))[0]!);
      await expect(retain(packet, true)).rejects.toThrow('fixture rollback');
      const meta = developmentNativeMetadata(packet);
      const rows = await database.handle.client`SELECT pass_key FROM observability.development_native_passes WHERE pass_key=${meta.passKey}`;
      expect(rows).toHaveLength(0); expect(await drizzleUsageLedger(database.db).cursor(scope(packet), packet.streamSourceId)).toBeNull();
      expect(await retain(packet)).toMatchObject({ duplicate: false, sourceComplete: true });
      expect(await retain(packet)).toMatchObject({ duplicate: true, sourceComplete: true });
    } finally { await source.close(); }
  });
  test('changed frames at the same packet position are rejected without altering retained work or source progress', async () => {
    const source = await nativePassFixture(1, 0);
    try {
      const input = source.packets(source.reader.next(source.reader.initialCursor))[0]!, packet = prepareDevelopmentNativePacket(input);
      await retain(packet); const meta = developmentNativeMetadata(packet);
      const changed = structuredClone(input); changed.event.occurredAt = '2026-10-06T00:00:02.000Z';
      await expect(retain(prepareDevelopmentNativePacket(changed))).rejects.toThrow('原帧内容');
      const [row] = await database.handle.client`SELECT fingerprint FROM observability.development_native_packets WHERE pass_key=${meta.passKey}`;
      expect(row!.fingerprint).toBe(packet.fingerprint);
      expect(await drizzleUsageLedger(database.db).cursor(scope(packet), packet.streamSourceId)).toBe('original-ordinary:' + packet.event.sequence);
    } finally { await source.close(); }
  });
  test('a later original page waits for every earlier packet instead of skipping incomplete source population', async () => {
    const source = await nativePassFixture(1201, 0, true, 1000);
    try {
      const raw = source.reader.next(source.reader.initialCursor), first = source.packets(raw).map(prepareDevelopmentNativePacket);
      expect(first.length).toBeGreaterThan(1); const result = await retain(first[0]!);
      source.reader.acknowledge(raw.ordinal, raw.payloadDigest);
      const nextRaw = source.reader.next(raw.nextCursor!), next = source.packets(nextRaw).map(prepareDevelopmentNativePacket);
      await expect(retain(next[0]!)).rejects.toThrow('完整人口');
      const rows = await database.handle.client`SELECT ordinal FROM observability.development_native_pages WHERE pass_key=${result.passKey}`;
      expect(rows.map((row) => row.ordinal)).toEqual(['0']);
      for (const packet of first.slice(1)) await retain(packet);
      for (const packet of next) await retain(packet);
      const [pass] = await database.handle.client`SELECT progress FROM observability.development_native_passes WHERE pass_key=${result.passKey}`;
      expect(pass!.progress.ordinal).toBe('2');
    } finally { await source.close(); }
  }, 60_000);
  test('the original transaction head and stream cannot acquire a different task packet', async () => {
    const source = await nativePassFixture(1, 0);
    try {
      const packet = prepareDevelopmentNativePacket(source.packets(source.reader.next(source.reader.initialCursor))[0]!);
      await expect(drizzleUsageLedger(database.db).changeDevelopment({ ...scope(packet), taskId: TaskIdSchema.parse(Bun.randomUUIDv7()) }, packet.streamSourceId,
        (tx) => tx.developmentPacket(packet))).rejects.toThrow('原用量事务');
      await expect(drizzleUsageLedger(database.db).changeDevelopment(scope(packet), 'different-original-stream',
        (tx) => tx.developmentPacket(packet))).rejects.toThrow('原用量事务');
    } finally { await source.close(); }
  });
  test('pending work pagination visits all 121 distinct actual source passes, including unknown root birth', async () => {
    const keys = new Set<string>();
    for (let index = 0; index < 121; index++) {
      const source = await nativePassFixture(1, 0, false);
      try {
        const packet = prepareDevelopmentNativePacket(source.packets(source.reader.next(source.reader.initialCursor))[0]!);
        const result = await retain(packet); keys.add(result.passKey);
      } finally { await source.close(); }
    }
    let after: string | null = null;
    const visited = new Set<string>();
    do {
      const page = await pendingDevelopmentNativePasses(database.db, after, 20);
      for (const row of page.items) {
        expect(visited.has(row.pass_key)).toBe(false); visited.add(row.pass_key);
        if (keys.has(row.pass_key)) { expect(row.document.rootCreatedAt).toBeNull(); expect(row.work_state).toBe('pending'); }
      }
      after = page.nextCursor;
    } while (after !== null);
    expect([...keys].every((key) => visited.has(key))).toBe(true); expect(keys.size).toBe(121);
  }, 60_000);
  test('original pass metadata remains the same source binding across JSONB ordering', async () => {
    const source = await nativePassFixture(1, 0);
    try {
      const packet = prepareDevelopmentNativePacket(source.packets(source.reader.next(source.reader.initialCursor))[0]!), meta = developmentNativeMetadata(packet);
      await retain(packet);
      const [row] = await database.handle.client`SELECT document,fingerprint FROM observability.development_native_passes WHERE pass_key=${meta.passKey}`;
      expect(row!.fingerprint).toBe(jsonHash(row!.document)); expect(row!.fingerprint).toBe(meta.passFingerprint);
      const fakeRaw = NativeUsagePassPageSchema.parse(JSON.parse(packet.original.document));
      expect(fakeRaw.eof!.counts).toEqual(packet.page.counts);
    } finally { await source.close(); }
  });
});
