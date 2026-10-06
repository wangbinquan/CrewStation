import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { NativeUsagePassPageSchema, type NativeUsagePassPage } from '../../../packages/contracts/index';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '../../../packages/testkit/index';
import { textHash } from '../../../packages/kernel/index';
import { prepareDevelopmentNativePacket } from '../../../modules/observability/domain/developmentUsage/packet';
import { developmentNativeMetadata } from '../../../modules/observability/domain/developmentUsage/metadata';
import { developmentNativePathDigest, developmentNativePathNamespace } from '../../../modules/observability/domain/developmentUsage/paths';
import { drizzleUsageLedger } from '../../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { observabilityMigrations } from '../../../modules/observability/wiring';
import { nativePassFixture } from './nativePassFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([observabilityMigrations]); });
afterAll(async () => { await database?.drop(); });
type Packet = ReturnType<typeof prepareDevelopmentNativePacket>;
const scope = (packet: Packet) => ({ projectId: packet.registration.identity.projectId, taskId: packet.registration.identity.taskId });
async function retain(packet: Packet) {
  return drizzleUsageLedger(database.db).changeDevelopment(scope(packet), packet.streamSourceId, (tx) => tx.developmentPacket(packet));
}
async function qualify(packet: Packet) {
  const key = developmentNativeMetadata(packet).passKey;
  return drizzleUsageLedger(database.db).changeDevelopment(scope(packet), packet.streamSourceId, (tx) => tx.developmentPaths(key));
}
// A shape-valid changed fixture tests parent-population qualification independently of byte hashes.
function resign(page: NativeUsagePassPage): void {
  const body = { identity: page.identity, ordinal: page.ordinal, scanPositionBefore: page.scanPositionBefore,
    scanPositionAfter: page.scanPositionAfter, scannedRawRows: page.scannedRawRows, counts: page.counts,
    sessions: page.sessions, steps: page.steps, issues: page.issues, eof: page.eof };
  page.payloadDigest = textHash(JSON.stringify(body));
  page.cumulativeDigest = textHash(JSON.stringify([page.previousDigest, page.payloadDigest]));
  page.nextCursor = page.eof ? null : JSON.stringify([page.identity.passId, String(BigInt(page.ordinal) + 1n), page.cumulativeDigest]);
}
describe.skipIf(!available)('original native parent links qualified without an ancestor array or depth/population cap', () => {
  test('all 71 original sessions and 1201 steps get persistent exact root paths, including depth 70 and repeat qualification', async () => {
    const source = await nativePassFixture(1201, 70, true, 1000);
    try {
      let cursor: string | null = source.reader.initialCursor, first: Packet | undefined;
      while (cursor !== null) {
        const raw = source.reader.next(cursor), packets = source.packets(raw).map(prepareDevelopmentNativePacket);
        first ??= packets[0]!;
        for (const packet of packets) await retain(packet);
        source.reader.acknowledge(raw.ordinal, raw.payloadDigest); cursor = raw.nextCursor;
      }
      const meta = developmentNativeMetadata(first!), result = await qualify(first!);
      expect(result).toMatchObject({ state: 'complete', sessions: '71', issues: [] });
      expect(await qualify(first!)).toEqual(result);
      let digest = developmentNativePathNamespace(meta.pass);
      for (let index = 0; index <= 70; index++) {
        const id = 'fixture-session-' + String(index).padStart(4, '0'), parent = index ? 'fixture-session-' + String(index - 1).padStart(4, '0') : null;
        digest = developmentNativePathDigest(digest, id, parent);
        const [row] = await database.handle.client`SELECT depth,path_digest,parent_session_id FROM observability.development_native_paths
          WHERE pass_key=${meta.passKey} AND session_id=${id}`;
        expect(row).toEqual({ depth: String(index), path_digest: digest, parent_session_id: parent });
      }
      const [count] = await database.handle.client`SELECT count(*)::text AS total FROM observability.development_native_paths WHERE pass_key=${meta.passKey}`;
      expect(count!.total).toBe('71');
    } finally { await source.close(); }
  }, 60_000);
  test('incomplete source packets never qualify even when an early page already contains parent references', async () => {
    const source = await nativePassFixture(1201, 70, true, 1000);
    try {
      const raw = source.reader.next(source.reader.initialCursor), packet = prepareDevelopmentNativePacket(source.packets(raw)[0]!);
      await retain(packet); expect(await qualify(packet)).toEqual({ state: 'source-pending', issues: ['native-source-pending'] });
      const meta = developmentNativeMetadata(packet);
      const rows = await database.handle.client`SELECT session_id FROM observability.development_native_paths WHERE pass_key=${meta.passKey}`;
      expect(rows).toHaveLength(0);
    } finally { await source.close(); }
  });
  test('source EOF with missing parents, disconnected cycles or changed step parents keeps explicit gaps', async () => {
    const changes: Array<{ reason: string; change: (page: NativeUsagePassPage) => void }> = [
      { reason: 'native-parent-missing', change: (page) => { page.sessions[1]!.parentSessionId = 'unreported-parent'; } },
      { reason: 'native-parent-cycle-or-other-root', change: (page) => { page.sessions[1]!.parentSessionId = page.sessions[2]!.id; page.sessions[2]!.parentSessionId = page.sessions[1]!.id; } },
      { reason: 'native-step-parent-conflict', change: (page) => { page.steps[0]!.parentSessionId = page.identity.rootSessionId; } },
    ];
    for (const changed of changes) {
      const source = await nativePassFixture(1, 2, true, 1000);
      try {
        const page = NativeUsagePassPageSchema.parse(source.reader.next(source.reader.initialCursor)); changed.change(page); resign(page);
        const packet = prepareDevelopmentNativePacket(source.packets(page)[0]!); await retain(packet);
        const result = await qualify(packet); expect(result.state).toBe('incomplete'); expect(result.issues).toContain(changed.reason);
        const meta = developmentNativeMetadata(packet);
        const [count] = await database.handle.client`SELECT count(*)::text AS total FROM observability.development_native_steps WHERE pass_key=${meta.passKey}`;
        expect(count!.total).toBe('1');
      } finally { await source.close(); }
    }
  });
  test('a changed retained path does not silently overwrite the original proof or mark the pass complete', async () => {
    const source = await nativePassFixture(1, 2, true, 1000);
    try {
      const packet = prepareDevelopmentNativePacket(source.packets(source.reader.next(source.reader.initialCursor))[0]!); await retain(packet);
      expect((await qualify(packet)).state).toBe('complete'); const meta = developmentNativeMetadata(packet);
      const different = 'f'.repeat(64);
      await database.handle.client`UPDATE observability.development_native_paths SET path_digest=${different}
        WHERE pass_key=${meta.passKey} AND session_id='fixture-session-0002'`;
      const result = await qualify(packet); expect(result.state).toBe('incomplete'); expect(result.issues).toContain('native-parent-reference-conflict');
      const [row] = await database.handle.client`SELECT path_digest FROM observability.development_native_paths WHERE pass_key=${meta.passKey} AND session_id='fixture-session-0002'`;
      expect(row!.path_digest).toBe(different);
    } finally { await source.close(); }
  });
  test('the original SQL and pure digest agree on Unicode and delimiter-containing session identifiers', async () => {
    const prefix = '亲:子😀\n', source = await nativePassFixture(1, 2, true, 1000, prefix);
    try {
      const packet = prepareDevelopmentNativePacket(source.packets(source.reader.next(source.reader.initialCursor))[0]!); await retain(packet);
      expect((await qualify(packet)).state).toBe('complete'); const meta = developmentNativeMetadata(packet);
      let digest = developmentNativePathNamespace(meta.pass);
      for (let index = 0; index <= 2; index++) digest = developmentNativePathDigest(digest, prefix + String(index).padStart(4, '0'), index ? prefix + String(index - 1).padStart(4, '0') : null);
      const [row] = await database.handle.client`SELECT path_digest FROM observability.development_native_paths WHERE pass_key=${meta.passKey} AND session_id=${prefix + '0002'}`;
      expect(row!.path_digest).toBe(digest);
      expect(developmentNativePathDigest('a', 'bc', null)).not.toBe(developmentNativePathDigest('ab', 'c', null));
    } finally { await source.close(); }
  });
  test('before/final locators keep one actual path namespace, while another store generation or Pod remains distinct', async () => {
    const source = await nativePassFixture(1, 0);
    try {
      const packet = prepareDevelopmentNativePacket(source.packets(source.reader.next(source.reader.initialCursor))[0]!);
      const { pass } = developmentNativeMetadata(packet), namespace = developmentNativePathNamespace(pass);
      const before = structuredClone(pass); before.admission.identity.phase = 'baseline'; before.admission.identity.passId = 'another-before-pass'; before.admission.ownerReceiptId = 'another-before-receipt';
      expect(developmentNativePathNamespace(before)).toBe(namespace);
      const generation = structuredClone(pass); generation.admission.identity.sourceGeneration = 'another-real-generation';
      expect(developmentNativePathNamespace(generation)).not.toBe(namespace);
      const pod = structuredClone(pass); pod.registration.podUid = 'another-original-pod';
      expect(developmentNativePathNamespace(pod)).not.toBe(namespace);
    } finally { await source.close(); }
  });
});
