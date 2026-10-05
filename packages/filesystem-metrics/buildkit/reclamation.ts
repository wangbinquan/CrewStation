import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createBuildKitControlClient } from './control';
import { BuildKitHistorySchema, BuildKitUsageSchema } from './controlRecords';
import type { BuildKitHistory, BuildKitUsage } from './controlRecords';
import { protoFields, protoInteger, protoMessage, protoText } from './protobuf';
import type { BuildKitControlTransport } from './controlTransport';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const BuildKitReclamationScopeSchema = z.strictObject({ version: z.literal(1), sourceIdentity: hash,
  workerId: z.string().regex(/^[a-z0-9]{20,40}$/), revision: z.string().regex(/^[a-f0-9]{40}$/),
  caches: z.array(BuildKitUsageSchema), histories: z.array(BuildKitHistorySchema),
  protectedCaches: z.array(BuildKitUsageSchema), protectedHistories: z.array(BuildKitHistorySchema),
}).refine(scope => {
  const caches = [...scope.caches, ...scope.protectedCaches], histories = [...scope.histories, ...scope.protectedHistories];
  return new Set(caches.map(row => row.id)).size === caches.length && new Set(histories.map(row => row.ref)).size === histories.length
    && scope.histories.every(row => row.event === 'complete' && !!row.completedAt);
}, 'Original native BuildKit selected and protected scope is incomplete or overlapping');
export type BuildKitReclamationScope = z.infer<typeof BuildKitReclamationScopeSchema>;
/** Deployment-owned callbacks hold the original producer exclusion and check
 * the grant, original daemon, all native files and actual consumer exits. */
export interface BuildKitReclamationAuthority {
  exclusive<T>(original: BuildKitReclamationScope, effect: () => Promise<T>): Promise<T>;
  assertClosed(original: BuildKitReclamationScope, signal: AbortSignal): Promise<void>;
}
const birth = (row: BuildKitUsage) => JSON.stringify({ id: row.id, createdAt: row.createdAt, mutable: row.mutable, recordType: row.recordType, parents: row.parents });
function cacheScope(scope: BuildKitReclamationScope, actual: readonly BuildKitUsage[]) {
  const all = [...scope.caches, ...scope.protectedCaches], protectedIds = new Set(scope.protectedCaches.map(row => row.id));
  for (const current of actual) {
    const original = all.find(row => row.id === current.id);
    if (!original || birth(current) !== birth(original)) throw Error('Original native BuildKit cache acquired a new or replaced identity');
  }
  for (const row of scope.protectedCaches) if (!actual.some(current => current.id === row.id)) throw Error('Protected native BuildKit cache disappeared');
  return actual.filter(row => !protectedIds.has(row.id));
}
function historyScope(scope: BuildKitReclamationScope, actual: readonly BuildKitHistory[]) {
  const all = [...scope.histories, ...scope.protectedHistories], protectedRefs = new Set(scope.protectedHistories.map(row => row.ref));
  for (const current of actual) {
    const original = all.find(row => row.ref === current.ref);
    if (!original || current.nativeIdentity !== original.nativeIdentity) throw Error('Original native BuildKit history acquired a new or replaced identity');
  }
  for (const row of scope.protectedHistories) if (!actual.some(current => current.ref === row.ref)) throw Error('Protected native BuildKit history disappeared');
  return actual.filter(row => !protectedRefs.has(row.ref));
}
async function observe(client: ReturnType<typeof createBuildKitControlClient>, original: BuildKitReclamationScope, closed: () => Promise<void>, signal: AbortSignal) {
  await closed(); const info = await client.info(signal), workers = await client.workers(signal);
  if (info.revision !== original.revision || workers.length !== 1 || workers[0]?.id !== original.workerId || workers[0].revision !== original.revision) throw Error('Original native BuildKit daemon or worker changed');
  const usage = await client.diskUsage(signal), history = await client.history(signal);
  const caches = cacheScope(original, usage), histories = historyScope(original, history);
  await closed(); return { caches, histories, history, usage };
}
function pruneAcknowledgement(raw: Uint8Array) {
  const fields = protoFields(raw), id = protoText(fields, 1, true), size = protoInteger(fields, 4);
  if (!/^[a-z0-9]{20,40}$/.test(id ?? '')) throw Error('Native BuildKit prune acknowledgement identity is invalid');
  // Native Prune does not emit the original cache creation time. The stream
  // is an acknowledgement; original births are checked independently above.
  return { id: id!, size };
}
/** Exact ID filters and exact history refs only; never invoke global prune or
 * prune-histories. A successful native mutation is not physical completion. */
export async function reclaimBuildKitScope(rpc: BuildKitControlTransport, raw: BuildKitReclamationScope, authority: BuildKitReclamationAuthority,
  signal: AbortSignal = AbortSignal.timeout(90_000)) {
  const original = BuildKitReclamationScopeSchema.parse(structuredClone(raw)), client = createBuildKitControlClient(rpc);
  return authority.exclusive(structuredClone(original), async () => {
    const closed = async () => { signal.throwIfAborted(); await authority.assertClosed(structuredClone(original), signal); signal.throwIfAborted(); };
    let current = await observe(client, original, closed, signal);
    if (current.caches.some(row => row.inUse) || current.history.some(row => row.event === 'started')) return { kind: 'waiting' as const, reason: 'Original native builds or selected cache consumers have not exited' };
    const removedHistories: string[] = [], removedCaches: string[] = [];
    for (const history of current.histories) {
      await closed();
      const response = await rpc('UpdateBuildHistory', protoMessage([{ number: 1, value: history.ref }, { number: 3, value: 1n }]), signal);
      if (response.length !== 1 || protoFields(response[0]!).length) throw Error('Native BuildKit history deletion did not provide an exact empty acknowledgement');
      await closed(); removedHistories.push(history.ref);
      current = await observe(client, original, closed, signal);
    }
    for (const id of original.caches.map(row => row.id)) {
      current = await observe(client, original, closed, signal);
      const cache = current.caches.find(row => row.id === id); if (!cache) continue;
      if (cache.inUse || cache.shared) return { kind: 'waiting' as const, reason: 'Original selected BuildKit cache remains in use or externally referenced' };
      await closed();
      const response = (await rpc('Prune', protoMessage([{ number: 1, value: 'id==' + id }, { number: 2, value: 1n }]), signal)).map(pruneAcknowledgement);
      if (new Set(response.map(row => row.id)).size !== response.length || response.some(row => row.id !== id)) throw Error('Native BuildKit prune acknowledged an identity outside the exact original filter');
      await closed(); removedCaches.push(...response.map(row => row.id));
    }
    current = await observe(client, original, closed, signal);
    return { kind: 'acknowledged' as const, removedHistories, removedCaches, remainingCaches: current.caches.length, remainingHistories: current.histories.length,
      sourceIdentity: original.sourceIdentity, nativeRevision: createHash('sha256').update(JSON.stringify({ usage: current.usage, history: current.history })).digest('hex'), physicalReclamationProven: false as const };
  });
}
