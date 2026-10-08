import { describe, expect, test } from 'bun:test';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import { nativeFixture, reviseNative } from '../../../../packages/gitlab-client/native/fixture';
import { storageFixture, reviseStorage } from '../../../../packages/gitlab-client/native/storage/fixture';
import type { GitLabActivityReceipt, GitLabActivityRequest, GitLabDestructionReceipt, GitLabFenceReceipt, GitLabFenceRequest } from '@crewstation/gitlab-client';
import type { ScmDeletionPlan } from '../../ports/projectDeletion';
import { gitLabDeletionPhysicsAdapter } from './deletionPhysics';

/** Controlled protocol sources only; real native observations are separately recorded. */
function fixture() {
  const f = nativeFixture(), storage = storageFixture().inventory, projectId = newResourceId() as ProjectId;
  for (const category of f.inventory.categories) for (const row of category.objects) if (row.model === 'LfsObject') row.projectIds = ['383'];
  reviseNative(f.inventory); storage.roots = structuredClone(f.inventory.roots); storage.runtime = structuredClone(f.inventory.runtime); reviseStorage(storage);
  const plan: ScmDeletionPlan = { projectId, serviceIds: [], credentialIds: [], repositories: [{ remoteProjectId: '383', pathWithNamespace: f.inventory.project.pathWithNamespace, createdAt: f.inventory.project.createdAt }],
    credentials: [{ remoteProjectId: '383', remoteTokenId: '513', createdAt: f.inventory.project.createdAt, userId: '541' }] };
  const context: ProjectDeletionContext = { operationId: newResourceId(), generation: 1, phase: 'stop',
    target: { id: projectId, slug: 'native-proof', name: 'Native proof', namespace: 'cs-native-proof', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'native.test', previewHost: 'preview.native.test', serviceHost: 'native.svc.test' },
    confirmed: { participant: 'scm', revision: jsonHash('controlled source grant'), complete: true, resources: [], references: [], blockers: [] } };
  const state = { parent: 1, children: 0, foreign: 0, requests: 0, consumers: 0, grant: true, missingSource: false, fenced: true, lostDelete: false,
    replacement: false, afterActivity: undefined as (() => void) | undefined, afterMutation: undefined as (() => void) | undefined };
  const calls: string[] = [], originals: unknown[] = [], activityQueries: GitLabActivityRequest['identities'][] = [];
  const beforeAfter = () => ({ before: structuredClone(f.instance), after: { ...f.instance, ...(state.replacement ? { id: 'c'.repeat(64) } : {}) } });
  const nativeRemaining = (): GitLabDestructionReceipt => {
    const facts = { project: structuredClone(f.inventory.project), parentRemaining: state.parent, credentialsRemaining: 0, pipelinesRemaining: 0, foreignReferences: state.foreign,
      categories: f.inventory.categories.map(row => ({ kind: row.kind, complete: true as const, count: row.kind === 'lfs' ? state.children : 0 })), nativeRemaining: state.parent + state.children };
    return { ...facts, version: 1, requestDigest: jsonHash({ mode: 'observe', original: f.inventory }), revision: jsonHash(facts), observedAt: new Date().toISOString(), runtime: structuredClone(f.inventory.runtime),
      physicalReclamationProven: false, producersClosed: false, consumersStopped: false };
  };
  const sources = {
    instance: f.instance,
    native: { observe: async () => { calls.push('capture-native'); return { ...beforeAfter(), inventory: structuredClone(f.inventory) }; } },
    files: { observe: async (_original: unknown, retained?: unknown) => { calls.push('files'); if (state.missingSource) throw Error('original files unavailable');
      if (retained) originals.push(retained); return { ...beforeAfter(), footprint: { version: 1 as const, nativeRevision: f.inventory.nativeRevision, inventory: structuredClone(storage) } }; } },
    activity: { observe: async (query: { identities: GitLabActivityRequest['identities'] }) => {
      calls.push('activity'); activityQueries.push(structuredClone(query.identities)); const facts = { nativeRevision: f.inventory.nativeRevision, identitiesDigest: jsonHash(query.identities), workhorseInFlight: state.requests,
        gitalyInFlight: 0, sidekiqInFlight: 0, queuedProjectJobs: 0, consumers: state.consumers && query.identities[0]
          ? [{ ...query.identities[0], pid: 7, tid: 8, startedTick: '11', kind: 'descriptor' as const }] : [] };
      const receipt: GitLabActivityReceipt = { ...facts, version: 1, complete: true, revision: jsonHash(facts), observedAt: new Date().toISOString(), runtime: structuredClone(f.inventory.runtime),
        physicalReclamationProven: false, producersClosed: false, consumersStopped: false }; state.afterActivity?.(); return { ...beforeAfter(), receipt };
    } },
    fence: { fence: async (query: GitLabFenceRequest) => {
      calls.push('fence'); const credentials = structuredClone(query.credentials); credentials.tokens.forEach(row => { row.revoked = true; }); credentials.users.forEach(row => { row.state = 'blocked'; });
      const facts = { project: query.project, credentials, pendingDelete: state.fenced, deletionInProgress: state.fenced, cancelablePipelines: 0, permissions: [] };
      const receipt: GitLabFenceReceipt = { ...facts, version: 1, requestDigest: jsonHash(query), revision: jsonHash(facts), observedAt: new Date().toISOString(), runtime: structuredClone(f.inventory.runtime),
        physicalReclamationProven: false, producersClosed: false, consumersStopped: false }; return { ...beforeAfter(), receipt };
    } },
    destruction: { run: async (query: { mode: 'observe' | 'destroy' | 'purge'; original: typeof f.inventory }) => {
      calls.push(query.mode); originals.push(query.original);
      if (query.mode === 'destroy') { state.parent = 0; state.afterMutation?.(); if (state.lostDelete) { state.lostDelete = false; throw Error('native response lost'); } }
      return { ...beforeAfter(), receipt: nativeRemaining() };
    } },
    removal: { remove: async (original: typeof storage) => {
      calls.push('remove'); originals.push(original); const revision = original.revision, count = original.locations.reduce((sum, row) => sum + row.entries.length, 0);
      storage.locations.forEach(row => { row.present = false; row.entries = []; }); reviseStorage(storage); state.afterMutation?.();
      const facts = { originalRevision: revision, remainingRevision: storage.revision, removedEntries: count, roots: original.roots,
        locations: original.locations.map(({ present: _present, entries: _entries, ...row }) => row) };
      return { ...beforeAfter(), receipt: { ...facts, version: 1 as const, observedAt: new Date().toISOString(), revision: jsonHash(facts), runtime: structuredClone(f.inventory.runtime),
        physicalReclamationProven: false as const, producersClosed: false as const, consumersStopped: false as const } };
    } },
    assertGrant: async () => { calls.push('grant'); if (!state.grant) throw precondition('original project grant expired'); },
  };
  const physics = gitLabDeletionPhysicsAdapter(sources);
  return { ...f, projectId, plan, context, storage, state, sources, physics, calls, originals, activityQueries };
}

describe('SCM physical deletion with native protocol sources', () => {
  test('activity retains original birth and a later birth sharing its device and inode', async () => {
    const f = fixture(), scope = (await f.physics.capture(f.plan)).scope!, originalScope = structuredClone(scope);
    const entry = f.storage.locations[0]!.entries[0]!, originalBirth = entry.birthtimeNs;
    entry.birthtimeNs = (BigInt(originalBirth) + 1n).toString();
    entry.identity = jsonHash({ device: entry.device, inode: entry.inode, birthtimeNs: entry.birthtimeNs, kind: entry.kind }); reviseStorage(f.storage);
    expect((await f.physics.prove(scope)).kind).toBe('waiting');
    const sameInode = f.activityQueries[0]!.filter(row => row.device === entry.device && row.inode === entry.inode);
    expect(sameInode.map(row => row.birthtimeNs).sort()).toEqual([originalBirth, entry.birthtimeNs].sort());
    expect(scope).toEqual(originalScope); expect(f.calls).not.toContain('remove');
  });
  test('capture retains full native and filesystem identities; stop, purge and independent proof require all sources', async () => {
    const f = fixture(), captured = await f.physics.capture(f.plan), scope = captured.scope!;
    expect(captured.complete).toBe(true); expect(scope.coverage).toHaveLength(11); expect(scope.retained).toHaveLength(1);
    expect(JSON.parse(scope.retained![0]!.contents).native.project.id).toBe('383');
    expect((await f.physics.inspect(scope)).complete).toBe(true); expect(f.calls).not.toContain('activity');
    const stopped = await f.physics.stop(f.context, scope); expect(stopped).toMatchObject({ kind: 'done', nativeRemaining: 0, storageRemaining: 3, producersClosed: true, consumersStopped: true });
    expect(f.calls.indexOf('fence')).toBeLessThan(f.calls.indexOf('destroy'));
    expect(await f.physics.purge({ ...f.context, phase: 'purge' }, scope)).toMatchObject({ kind: 'done', nativeRemaining: 0, storageRemaining: 0, scopeDigest: jsonHash(scope) });
    expect((await f.physics.prove(scope)).kind).toBe('done'); expect(f.calls.filter(row => row === 'capture-native')).toHaveLength(1);
    expect(f.originals.some(row => JSON.stringify(row) === JSON.stringify(JSON.parse(scope.retained![0]!.contents).footprint.inventory))).toBe(true);
  });
  test('held descriptors and in-flight producers prevent erasure even after the parent disappears', async () => {
    const f = fixture(), scope = (await f.physics.capture(f.plan)).scope!;
    f.state.requests = 1; expect((await f.physics.stop(f.context, scope)).kind).toBe('waiting'); expect(f.calls).not.toContain('destroy');
    f.state.requests = 0; f.state.consumers = 1; expect((await f.physics.stop(f.context, scope)).kind).toBe('waiting'); expect(f.state.parent).toBe(0);
    expect((await f.physics.purge({ ...f.context, phase: 'purge' }, scope)).kind).toBe('waiting'); expect(f.calls).not.toContain('remove');
    f.state.consumers = 0; f.state.children = 1; expect((await f.physics.purge({ ...f.context, phase: 'purge' }, scope)).kind).toBe('waiting'); expect(f.calls).not.toContain('remove');
    f.state.children = 0; expect((await f.physics.purge({ ...f.context, phase: 'purge' }, scope)).kind).toBe('done');
  });
  test('native deletion ACK loss replays retained origins and never substitutes a new parent', async () => {
    const f = fixture(), scope = (await f.physics.capture(f.plan)).scope!; f.state.lostDelete = true;
    await expect(f.physics.stop(f.context, scope)).rejects.toThrow('native response lost'); expect(f.state.parent).toBe(0);
    expect((await f.physics.stop({ ...f.context, generation: 2 }, scope)).kind).toBe('done'); expect(f.calls.filter(row => row === 'destroy')).toHaveLength(1);
    expect(f.calls.filter(row => row === 'capture-native')).toHaveLength(1);
  });
  test('another project, changed birth, missing retained source or expired grant cannot reach a destructive call', async () => {
    const f = fixture(), scope = (await f.physics.capture(f.plan)).scope!;
    await expect(f.physics.stop({ ...f.context, target: { ...f.context.target, id: newResourceId() as ProjectId } }, scope)).rejects.toThrow();
    await expect(f.physics.purge(f.context, scope)).rejects.toThrow();
    await expect(f.physics.prove({ ...scope, retained: [] })).rejects.toThrow();
    const changed = { ...scope, retained: scope.retained!.map(row => ({ ...row, identity: 'e'.repeat(64) })) };
    await expect(f.physics.prove(changed)).rejects.toThrow();
    await expect(f.physics.prove({ ...scope, source: { ...scope.source, identity: 'e'.repeat(64) } })).rejects.toThrow();
    f.state.grant = false; await expect(f.physics.stop(f.context, scope)).rejects.toThrow('grant expired');
    expect(f.calls).not.toContain('destroy'); expect(f.calls).not.toContain('remove');
  });
  test('foreign references, missing source, incomplete fence and substituted installation preserve resources', async () => {
    const f = fixture(), scope = (await f.physics.capture(f.plan)).scope!;
    f.state.foreign = 1; expect((await f.physics.inspect(scope)).complete).toBe(false); expect((await f.physics.stop(f.context, scope)).kind).toBe('blocked');
    f.state.foreign = 0; f.state.missingSource = true; expect((await f.physics.inspect(scope)).complete).toBe(false);
    f.state.missingSource = false; f.state.fenced = false; expect((await f.physics.stop(f.context, scope)).kind).toBe('waiting'); expect(f.calls).not.toContain('destroy');
    f.state.replacement = true; await expect(f.physics.capture(f.plan)).rejects.toThrow('原安装实例变化');
    await expect(f.physics.prove(scope)).rejects.toThrow('原安装实例变化'); expect(f.calls).not.toContain('remove');
  });
  test('a final write during producer draining invalidates early file absence', async () => {
    const f = fixture(), scope = (await f.physics.capture(f.plan)).scope!, old = structuredClone(f.storage.locations); f.state.parent = 0;
    f.storage.locations.forEach(row => { row.present = false; row.entries = []; }); reviseStorage(f.storage);
    f.state.afterActivity = () => { f.state.afterActivity = undefined; f.storage.locations = old; reviseStorage(f.storage); };
    expect((await f.physics.prove(scope)).kind).toBe('waiting'); expect(f.calls).not.toContain('remove');
  });
  test('missing birth and shared LFS ownership block capture; post-effect grant loss prevents proof', async () => {
    const f = fixture(); await expect(f.physics.capture({ ...f.plan, repositories: [{ ...f.plan.repositories[0]!, createdAt: null }] })).rejects.toThrow();
    const lfs = f.inventory.categories.flatMap(row => row.objects).find(row => row.model === 'LfsObject')!;
    if (lfs.model !== 'LfsObject') throw Error('LFS fixture absent'); lfs.projectIds.push('384'); reviseNative(f.inventory);
    await expect(f.physics.capture(f.plan)).rejects.toThrow(); lfs.projectIds = ['383']; reviseNative(f.inventory);
    const scope = (await f.physics.capture(f.plan)).scope!; f.state.afterMutation = () => { f.state.grant = false; };
    await expect(f.physics.stop(f.context, scope)).rejects.toThrow('grant expired'); expect(f.calls).not.toContain('remove');
  });
});
