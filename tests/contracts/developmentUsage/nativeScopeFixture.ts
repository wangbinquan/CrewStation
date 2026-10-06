import { UsageRecordSchema, type UsageRecord } from '../../../packages/contracts/index';
import { jsonHash } from '../../../packages/kernel/index';
import type { TestDatabase } from '../../../packages/testkit/index';
import { prepareDevelopmentNativePacket } from '../../../modules/observability/domain/developmentUsage/packet';
import { developmentNativeMetadata } from '../../../modules/observability/domain/developmentUsage/metadata';
import { developmentNativePathNamespace, developmentNativePathDigest } from '../../../modules/observability/domain/developmentUsage/paths';
import { developmentCaptureSourceId } from '../../../modules/observability/domain/developmentNative';
import { drizzleUsageLedger } from '../../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { originalReportSnapshotSession } from '../../../packages/persistence/index';
import { completeDevelopmentNativeScopeSource } from '../../../modules/observability/adapters/persistence/completeDevelopmentNativeScopeSource';
import { completeUsageWorkspace } from '../../../modules/observability/adapters/persistence/completeUsageWorkspace';
import { completeExternalSort } from '../../../modules/observability/application/completeExternalSort';
import { completeWorkingCache } from '../../../modules/observability/application/completeWorkingCache';
import type { CompleteNativeCacheFactory } from '../../../modules/observability/ports/completeNativeScope';
import { selectCompleteUsage } from '../../../modules/observability/application/completeUsageSelection';
import { runtimeContributionEvidence } from '../../../modules/observability/domain/completeUsageEvidence';
import type { CompleteWorkingPage } from '../../../modules/observability/ports/completeWorkingRows';
import { nativePassFixture } from './nativePassFixture';

/** Generated validation-only WAL records, read by the real reader and retained in the original PG metadata. */
export async function nativeScopeFixture(database: TestDatabase, count = 1201, depth = 70, finish = true) {
  const source = await nativePassFixture(count, depth, true, 1000);
  const records: UsageRecord[] = [];
  let first: ReturnType<typeof prepareDevelopmentNativePacket> | undefined;
  let cursor: string | null = source.reader.initialCursor;
  while (cursor !== null) {
    const raw = source.reader.next(cursor), packets = source.packets(raw).map(prepareDevelopmentNativePacket);
    first ??= packets[0]!;
    for (const packet of packets) {
      const scope = { projectId: packet.registration.identity.projectId, taskId: packet.registration.identity.taskId };
      await drizzleUsageLedger(database.db).changeDevelopment(scope, packet.streamSourceId, tx => tx.developmentPacket(packet));
      const meta = developmentNativeMetadata(packet), namespace = developmentNativePathNamespace(meta.pass);
      let digest = namespace, parent: string | null = null;
      for (let index = 0; index <= depth; index++) {
        const id = 'fixture-session-' + String(index).padStart(4, '0');
        digest = developmentNativePathDigest(digest, id, parent); parent = id;
      }
      for (const step of packet.measurements) {
        const turnIndex = packet.original.preparation.turnIndex;
        records.push(UsageRecordSchema.parse({ identity: packet.registration.identity,
          sourceId: developmentCaptureSourceId(packet.streamSourceId, packet.page.identity.turn, turnIndex),
          recordId: 'fixture-original:' + step.stepId, revision: 1, kind: 'usage', adapterVersion: 'fixture-native-page-v2',
          occurredAt: step.occurredAt === null ? null : new Date(step.occurredAt).toISOString(), observedAt: packet.event.occurredAt,
          modelRef: step.model === null ? null : jsonHash(step.model), reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid',
          scope: { root: packet.page.identity.rootSessionId, session: step.id, parentSession: step.parentSessionId,
            turn: packet.page.identity.turn, turnIndex, level: 'request', native: { passKey: meta.passKey, identity: packet.page.identity,
              ownerReceiptId: packet.original.admission.ownerReceiptId, pageOrdinal: packet.page.ordinal,
              cumulativeDigest: packet.page.cumulativeDigest, sourceNamespace: namespace, pathDigest: digest, depth: String(depth) } },
          coveredThroughTurn: null, usage: step.usage,
          projection: { projectionRevision: 1, observedRevision: 1, ...(step.model === null ? {} : {modelRevision: 1}), contribution: step.usage,
            coveredThrough: {input: turnIndex, cacheRead: turnIndex, cacheWrite: turnIndex, output: turnIndex}, complete: true, issues: [] },
          basis: {kind: 'invocation'} }));
      }
      if (!finish) return {records, first: first!, close: source.close};
    }
    source.reader.acknowledge(raw.ordinal, raw.payloadDigest); cursor = raw.nextCursor;
  }
  const scope = {projectId: first!.registration.identity.projectId, taskId: first!.registration.identity.taskId};
  await drizzleUsageLedger(database.db).changeDevelopment(scope, first!.streamSourceId, tx => tx.developmentPaths(developmentNativeMetadata(first!).passKey));
  return {records, first: first!, close: source.close};
}
export async function selectNativeScope(database: TestDatabase, records: UsageRecord[]) {
  return originalReportSnapshotSession(database.handle).run(async snapshot => {
    const namespace = 'fixture-native-selection/' + crypto.randomUUID();
    const nativeCache: CompleteNativeCacheFactory = <T>(space: string) => completeWorkingCache<T>(snapshot.workspace, space);
    const nativeSource = completeDevelopmentNativeScopeSource({db: snapshot.executor, rows: snapshot.workspace, namespace: namespace + '/source', keyOf: jsonHash, cache: nativeCache});
    const workspace = completeUsageWorkspace({rows: snapshot.workspace, namespace, nativeSource, nativeCache, keyOf: jsonHash,
      identity: (record: ReturnType<typeof runtimeContributionEvidence>) => JSON.stringify([record.sourceId, record.measurement.invocationId, record.measurement.recordId]), order: completeExternalSort});
    await workspace.append(records.map(runtimeContributionEvidence)); workspace.seal(String(records.length));
    const total = await selectCompleteUsage(workspace.workspace); await workspace.flush();
    const allocations: Array<{record: ReturnType<typeof runtimeContributionEvidence>; contribution: UsageRecord['usage']}> = [];
    let cursor: string | null = null;
    do {
      const page: CompleteWorkingPage<(typeof allocations)[number]> = await snapshot.workspace.page(workspace.allocationsNamespace, cursor, 137);
      allocations.push(...page.items.map(row => row.document)); cursor = page.nextCursor;
    } while (cursor !== null);
    let bindings = 0n; cursor = null;
    do {
      const page: CompleteWorkingPage<unknown> = await snapshot.workspace.page(namespace + '/native-ancestry', cursor, 137);
      bindings += BigInt(page.items.length); cursor = page.nextCursor;
    } while (cursor !== null);
    return {total, allocations, bindings: String(bindings)};
  });
}
