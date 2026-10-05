import { expect, test } from 'bun:test';
import { buildKitHistory, buildKitUsage } from './controlRecords';
import { reclaimBuildKitScope } from './reclamation';
import type { BuildKitReclamationAuthority, BuildKitReclamationScope } from './reclamation';
import { protoFields, protoMessage, protoText } from './protobuf';
import type { BuildKitControlMethod, BuildKitControlTransport } from './controlTransport';

const own = '8irdm36x5aeaig4ys10bximdo', foreign = 'mwaxyrvfjx2rszrl3ap12kjvo', worker = 's4agj5nk6vy5bxmlc1gdws62k', revision = 'b'.repeat(40);
const ownRef = 'qfk2gtho4quq0ntwbha4pdrji', foreignRef = '24w9w5k8k321hr2i311pssoc9';
const version = protoMessage([{ number: 1, value: 'github.com/moby/buildkit' }, { number: 2, value: 'v0.33.0' }, { number: 3, value: revision }]);
const time = protoMessage([{ number: 1, value: 1_790_784_077n }, { number: 2, value: 263_787_585n }]);
function usage(id: string, inUse = false, shared = false, created = time) {
  return protoMessage([{ number: 1, value: id }, { number: 3, value: inUse ? 1n : 0n }, { number: 4, value: 120n }, { number: 6, value: created }, { number: 11, value: shared ? 1n : 0n }]);
}
function history(ref: string, event = 1n, generation = 0n) {
  return protoMessage([{ number: 1, value: event }, { number: 2, value: protoMessage([{ number: 1, value: ref }, { number: 6, value: time },
    ...event === 1n ? [{ number: 7, value: time }] : [], { number: 12, value: generation }]) }]);
}
function fixture() {
  const state = { usage: [usage(own), usage(foreign)], histories: [history(ownRef), history(foreignRef)], mutations: [] as Array<{ method: BuildKitControlMethod; body: ReturnType<typeof protoFields> }>,
    exclusive: false, checks: 0, returnedPruneId: own, pruneRemoves: true, pruneResponse: true, historyResponse: [new Uint8Array()] };
  const scope: BuildKitReclamationScope = { version: 1, sourceIdentity: 'a'.repeat(64), workerId: worker, revision,
    caches: [buildKitUsage(state.usage[0]!)], protectedCaches: [buildKitUsage(state.usage[1]!)], histories: [buildKitHistory(state.histories[0]!)], protectedHistories: [buildKitHistory(state.histories[1]!)] };
  const authority: BuildKitReclamationAuthority = {
    exclusive: async (_original, effect) => { expect(state.exclusive).toBe(false); state.exclusive = true; try { return await effect(); } finally { state.exclusive = false; } },
    assertClosed: async (original, signal) => { expect(state.exclusive).toBe(true); expect(original.sourceIdentity).toBe(scope.sourceIdentity); signal.throwIfAborted(); state.checks++; },
  };
  const rpc: BuildKitControlTransport = async (method, body) => {
    expect(state.exclusive).toBe(true);
    if (method === 'Info') return [protoMessage([{ number: 1, value: version }])];
    if (method === 'ListWorkers') return [protoMessage([{ number: 1, value: protoMessage([{ number: 1, value: worker }, { number: 5, value: version }]) }])];
    if (method === 'DiskUsage') return [protoMessage(state.usage.map(value => ({ number: 1, value })))];
    if (method === 'ListenBuildHistory') return state.histories;
    const fields = protoFields(body); state.mutations.push({ method, body: fields });
    if (method === 'UpdateBuildHistory') { state.histories = state.histories.filter(value => buildKitHistory(value).ref !== protoText(fields, 1)); return state.historyResponse; }
    if (state.pruneRemoves) state.usage = state.usage.filter(value => buildKitUsage(value).id !== own);
    return state.pruneResponse ? [protoMessage([{ number: 1, value: state.returnedPruneId }, { number: 4, value: 120n }])] : [];
  };
  return { state, scope, authority, rpc };
}
test('original cache and exact history are reclaimed with held authority, single-ID filters and fresh protected EOF checks', async () => {
  const f = fixture(), original = structuredClone(f.scope), result = await reclaimBuildKitScope(f.rpc, f.scope, f.authority);
  expect(result).toMatchObject({ kind: 'acknowledged', removedHistories: [ownRef], removedCaches: [own], remainingCaches: 0, remainingHistories: 0, sourceIdentity: f.scope.sourceIdentity, physicalReclamationProven: false });
  expect(f.state.mutations).toEqual([
    { method: 'UpdateBuildHistory', body: [{ number: 1, wire: 2, value: Buffer.from(ownRef) }, { number: 3, wire: 0, value: 1n }] },
    { method: 'Prune', body: [{ number: 1, wire: 2, value: Buffer.from('id==' + own) }, { number: 2, wire: 0, value: 1n }] },
  ]);
  expect(f.state.usage.map(buildKitUsage).map(row => row.id)).toEqual([foreign]);
  expect(f.state.histories.map(buildKitHistory).map(row => row.ref)).toEqual([foreignRef]);
  expect(f.state.checks).toBeGreaterThan(10); expect(f.state.exclusive).toBe(false); expect(f.scope).toEqual(original);
  const replay = await reclaimBuildKitScope(f.rpc, f.scope, f.authority); expect(replay).toMatchObject({ kind: 'acknowledged', removedHistories: [], removedCaches: [], remainingCaches: 0 });
  expect(f.state.mutations).toHaveLength(2);
});
test('selected original in-use cache or an active native build waits without invoking any mutation', async () => {
  const cache = fixture(); cache.state.usage[0] = usage(own, true);
  expect(await reclaimBuildKitScope(cache.rpc, cache.scope, cache.authority)).toMatchObject({ kind: 'waiting' }); expect(cache.state.mutations).toHaveLength(0);
  const active = fixture(); active.state.histories[1] = history(foreignRef, 0n); active.scope.protectedHistories = [buildKitHistory(active.state.histories[1]!)];
  expect(await reclaimBuildKitScope(active.rpc, active.scope, active.authority)).toMatchObject({ kind: 'waiting' }); expect(active.state.mutations).toHaveLength(0);
});
test('externally shared selected cache remains after exact own history deletion and never becomes physical completion', async () => {
  const f = fixture(); f.state.usage[0] = usage(own, false, true);
  expect(await reclaimBuildKitScope(f.rpc, f.scope, f.authority)).toMatchObject({ kind: 'waiting' });
  expect(f.state.mutations.map(row => row.method)).toEqual(['UpdateBuildHistory']); expect(f.state.exclusive).toBe(false);
  f.state.usage[0] = usage(own); expect(await reclaimBuildKitScope(f.rpc, f.scope, f.authority)).toMatchObject({ kind: 'acknowledged', remainingCaches: 0 });
});
test('new or replaced original cache/history and missing protected records block before any outside effect', async () => {
  const replacements = [
    (f: ReturnType<typeof fixture>) => { f.state.usage[0] = usage(own, false, false, protoMessage([{ number: 1, value: 1_790_784_078n }])); },
    (f: ReturnType<typeof fixture>) => { f.state.usage.push(usage('v4mcbf4kembrwug02neh2o4k5')); },
    (f: ReturnType<typeof fixture>) => { f.state.usage.pop(); },
    (f: ReturnType<typeof fixture>) => { f.state.histories[0] = history(ownRef, 1n, 1n); },
    (f: ReturnType<typeof fixture>) => { f.state.histories.push(history('wz0xn0fro1a6ys7dukxcfkn15')); },
    (f: ReturnType<typeof fixture>) => { f.state.histories.pop(); },
  ];
  for (const change of replacements) { const f = fixture(); change(f); await expect(reclaimBuildKitScope(f.rpc, f.scope, f.authority)).rejects.toThrow(); expect(f.state.mutations).toHaveLength(0); expect(f.state.exclusive).toBe(false); }
});
test('wrong worker/revision or an overlapping/unconfirmed scope cannot authorize native cleanup', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.scope.workerId = 'v4mcbf4kembrwug02neh2o4k5'; },
    (f: ReturnType<typeof fixture>) => { f.scope.revision = 'c'.repeat(40); },
    (f: ReturnType<typeof fixture>) => { f.scope.protectedCaches.push(f.scope.caches[0]!); },
    (f: ReturnType<typeof fixture>) => { f.scope.histories[0] = buildKitHistory(history(ownRef, 0n)); },
  ]) { const f = fixture(); change(f); await expect(reclaimBuildKitScope(f.rpc, f.scope, f.authority)).rejects.toThrow(); expect(f.state.mutations).toHaveLength(0); }
});
test('a native acknowledgement cannot substitute a foreign ID, empty history receipt or actual independent cache removal', async () => {
  const foreignAck = fixture(); foreignAck.state.returnedPruneId = foreign;
  await expect(reclaimBuildKitScope(foreignAck.rpc, foreignAck.scope, foreignAck.authority)).rejects.toThrow('outside'); expect(foreignAck.state.exclusive).toBe(false);
  const repeated = fixture(); repeated.state.historyResponse = [new Uint8Array(), new Uint8Array()];
  await expect(reclaimBuildKitScope(repeated.rpc, repeated.scope, repeated.authority)).rejects.toThrow('acknowledgement');
  const populated = fixture(); populated.state.historyResponse = [Buffer.from([8, 1])];
  await expect(reclaimBuildKitScope(populated.rpc, populated.scope, populated.authority)).rejects.toThrow('acknowledgement');
  const retained = fixture(); retained.state.pruneRemoves = false; retained.state.pruneResponse = false;
  expect(await reclaimBuildKitScope(retained.rpc, retained.scope, retained.authority)).toMatchObject({ kind: 'acknowledged', remainingCaches: 1, physicalReclamationProven: false });
});
test('revoked original authority or an interrupted original lease releases exclusion and never falls back to a supplied closed flag', async () => {
  const f = fixture(); f.authority.assertClosed = async () => { throw Error('Actual original grant revoked'); };
  await expect(reclaimBuildKitScope(f.rpc, f.scope, f.authority)).rejects.toThrow('revoked'); expect(f.state.mutations).toHaveLength(0); expect(f.state.exclusive).toBe(false);
  const abort = fixture(), signal = new AbortController(); signal.abort();
  await expect(reclaimBuildKitScope(abort.rpc, abort.scope, abort.authority, signal.signal)).rejects.toThrow(); expect(abort.state.mutations).toHaveLength(0); expect(abort.state.exclusive).toBe(false);
});
