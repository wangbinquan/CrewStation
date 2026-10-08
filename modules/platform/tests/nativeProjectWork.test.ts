import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { Resources } from '@crewstation/k8s';
import { jsonHash } from '@crewstation/kernel';
import { createClusterControlModule } from '@crewstation/module-cluster-control';
import { nativeRuntimeProjectWork } from '../adapters/k8s/nativeProjectWork/runtime';
import { nativeReleaseProjectWork } from '../adapters/k8s/nativeProjectWork/release';
import { removeWorkObjects } from '../adapters/k8s/nativeProjectWork/catalog';
import { withNativeWork } from './nativeWorkFixture';
import type { PodWorkHistory } from '../adapters/k8s/nativeProjectWork/bindings';
import { nativePodWork } from '../adapters/k8s/nativeProjectWork/pods';

test('runtime work stops original controllers and Pods with actual resource-participant context before deleting retained credentials', () => withNativeWork(async f => {
  await f.installWork('runtime-environment'); const source = nativeRuntimeProjectWork(f.options), original = await source.capture(f.target, { consumers: [{ id: f.consumerId }], callbacks: [{ process: f.callback }] });
  expect(original.native.objects).toHaveLength(3); expect(JSON.stringify(original.native)).not.toContain('private-original');
  expect(await source.prove(f.context('stop', 'runtime-environment'), original.native)).toMatchObject({ nativeRemaining: 1 }); expect(await source.callbackExit({ process: f.callback })).toBeUndefined();
  f.calls.pending = true; expect((await source.stop(f.context('stop', 'runtime-environment'), original.native)).kind).toBe('waiting');
  expect(await f.k8s.get(Resources.Secret!, 'credential', 'project')).toBeDefined(); f.calls.pending = false;
  const stopped = await source.stop(f.context('stop', 'runtime-environment'), original.native); expect(stopped).toMatchObject({ kind: 'done', nativeRemaining: 0, storageRemaining: 1 });
  expect(f.calls.participant).toBe('resources'); expect(f.calls.stops.every(key => JSON.parse(key).kind === 'Pod')).toBe(true);
  expect(await source.callbackExit({ process: f.callback })).toBeString(); await source.purge(f.context('purge', 'runtime-environment'), original.native);
  expect(await f.k8s.get(Resources.Secret!, 'credential', 'project')).toBeUndefined(); expect(await source.prove(f.context('verify', 'runtime-environment'), original.native)).toMatchObject({ nativeRemaining: 0, storageRemaining: 0, independent: true });
  await expect(source.prove(f.context('verify', 'release'), original.native)).rejects.toThrow('许可');
  await expect(source.inspect({ ...original.native, body: { version: 2 } })).rejects.toThrow('出生');
}));
test('empty runtime work still uses a complete original host; replaced, unknown and unreadable work never become zero', () => withNativeWork(async f => {
  const source = nativeRuntimeProjectWork(f.options), empty = await source.capture(f.target, { consumers: [], callbacks: [] });
  expect(await source.prove(f.context('verify', 'runtime-environment'), empty.native)).toMatchObject({ storageRemaining: 0 });
  await f.installWork('runtime-environment'); await expect(source.capture(f.target, { consumers: [], callbacks: [] })).rejects.toThrow('未登记');
  const original = await source.capture(f.target, { consumers: [{ id: f.consumerId }], callbacks: [] }); const work = (original.native.body as { work: PodWorkHistory }).work;
  // Same name and equal bytes do not permit deletion of a replacement birth.
  await f.k8s.mergePatch(Resources.Secret!, 'credential', 'project', { metadata: { uid: 'replaced' } });
  await expect(source.inspect(original.native)).rejects.toThrow('替换'); await expect(removeWorkObjects(f.options, work.catalog, false, async () => {})).rejects.toThrow();
  await rm(join(f.proc.root, 'self/ns/cgroup')); await expect(source.callbackExit({ process: f.callback })).rejects.toThrow();
}));
test('native Pod stop uses the complete confirmed resource key through the public cluster-control factory', () => withNativeWork(async f => {
  await f.installWork('runtime-environment');
  const pod = (await f.k8s.get(Resources.Pod!, 'work', f.target.namespace))!, originalSpec = structuredClone(pod['spec']);
  const key = JSON.stringify({ apiVersion: pod.apiVersion, kind: pod.kind, namespace: pod.metadata.namespace, name: pod.metadata.name });
  const resource = { kind: 'protected:Pod', id: key, identity: JSON.stringify({ uid: f.workUid, nodeName: 'node', nodeUid: f.ids['node'], specDigest: jsonHash(originalSpec) }), count: 1 };
  const sourceContext = f.context('stop', 'runtime-environment'), resourceContext = { ...sourceContext, confirmed: { ...sourceContext.confirmed, participant: 'resources' as const, resources: [resource] } };
  const project = { ...f.options.project(), projectDeletionParticipantContext: async () => resourceContext };
  const store = { get: async (_context: typeof sourceContext, actualKey: string, uid: string) => {
    expect(actualKey).toBe(key); expect(uid).toBe(f.workUid);
    return { key, uid, nodeUid: f.ids['node']!, digest: jsonHash('persisted fixture stop'), observedAt: new Date().toISOString() };
  }, save: async () => { throw Error('An existing original stop receipt must be reused'); } };
  const control = createClusterControlModule({ k8s: f.k8s, systemNamespace: 'system', isAdmin: async () => true,
    legacy: { resolveTaskId: async () => undefined, task: async () => undefined },
    ledger: { get: async () => undefined, claimOf: async () => undefined, listLive: async () => [], changesSince: async () => [], latestChange: async () => 0,
      observe: async () => ({ status: 'unchanged' }), observeConditions: async () => ({ status: 'unchanged' }), adoptOrphanVolume: async () => undefined, children: async () => [] },
  });
  const options = { ...f.options, project: () => project, cluster: () => control.api,
    resources: () => ({ ...f.options.resources(), projectDeletion: { ...f.options.resources().projectDeletion, podStopReceipts: () => store } }) };
  const source = nativePodWork(options), original = await source.capture({ mode: 'runtime-environment', target: f.target, consumerIds: [f.consumerId] }, []);
  const frozen = structuredClone(original);
  await f.k8s.mergePatch(Resources.Pod!, 'work', f.target.namespace, { metadata: { annotations: { 'crewstation.io/project-delete-operation': sourceContext.operationId }, finalizers: ['crewstation.io/project-delete-stop-proof'], deletionTimestamp: new Date().toISOString() } });
  // The real public callee rejects a key missing apiVersion before reading the saved original UID receipt.
  expect(await source.stop(sourceContext, original)).toMatchObject({ kind: 'done', evidence: { count: 1 } });
  expect(original).toEqual(frozen); expect((await f.k8s.get(Resources.Pod!, 'work', f.target.namespace))?.['spec']).toEqual(originalSpec);
  expect((await f.k8s.get(Resources.Pod!, 'work', f.target.namespace))?.metadata.finalizers).not.toContain('crewstation.io/project-delete-stop-proof');
  const protection = control.api.projectPodProtection({ assertGrant: project.assertProjectDeletionGrant, seal: async () => {}, assertSealed: async () => {} }, store);
  await expect(protection.stopSelected(resourceContext, [JSON.stringify({ apiVersion: 'v1', kind: 'Pod', namespace: 'foreign', name: 'work' })])).rejects.toThrow('确认范围');
}));
const available = await testDatabaseAvailable();
describe.skipIf(!available)('native release work with real PostgreSQL writer exclusion', () => {
  test('finished callback selectors change the full snapshot while original object births stay fixed; same-UID credential changes still change birth binding', async () => {
    const db = await createTestDatabase();
    try { await withNativeWork(async f => {
      await f.installWork('release'); const source = nativeReleaseProjectWork(f.buildOptions);
      const content = { consumers: [{ id: f.consumerId, aliases: [] }], callbacks: [] };
      const before = await source.capture(f.target, content);
      const after = await source.capture(f.target, { ...content, consumers: [...content.consumers, { id: 'finished-callback', aliases: [] }] });
      // Public native source identity previously included every finished callback selector and made safe reconfirmation impossible.
      expect(after.native.identity).not.toBe(before.native.identity);
      expect(after.native.epoch).toBe(before.native.epoch);
      expect(after.native.objects).toEqual(before.native.objects);
      await f.k8s.mergePatch(Resources.Secret!, 'credential', 'project', { data: { token: 'private-changed' } });
      const changed = await source.capture(f.target, content);
      expect(changed.native.epoch).toBe(before.native.epoch);
      const original = before.native.objects.find(row => row.kind === 'credential')!;
      expect(changed.native.objects.find(row => row.id === original.id)?.sourceIdentity).not.toBe(original.sourceIdentity);
      await expect(source.inspect(before.native)).rejects.toThrow('替换');
    }, db.db); } finally { await db.drop(); }
  }, 30_000);
  test('native exact history deletion and exact cache prune leave independent native files, original leases and inode users at zero', async () => {
    const db = await createTestDatabase();
    try { await withNativeWork(async f => {
      await f.installWork('release'); const source = nativeReleaseProjectWork(f.buildOptions), original = await source.capture(f.target, { consumers: [{ id: f.consumerId, aliases: [] }], callbacks: [] });
      expect((original.native.body as { cache: { cacheIds: string[] } }).cache.cacheIds).toHaveLength(1);
      expect(await source.prove(f.context('stop', 'release'), original.native)).toMatchObject({ nativeRemaining: 1 });
      expect((await source.stop(f.context('stop', 'release'), original.native)).kind).toBe('done');
      const purged = await source.purge(f.context('purge', 'release'), original.native); expect(purged).toMatchObject({ kind: 'done', nativeRemaining: 0, storageRemaining: 0 });
      expect(f.cache.methods).toContain('UpdateBuildHistory'); expect(f.cache.methods).toContain('Prune');
      expect((await source.inspect(original.native)).complete).toBe(true);
      await expect(source.prove(f.context('verify', 'runtime-environment'), original.native)).rejects.toThrow('许可');
      await expect(source.inspect({ ...original.native, identity: '0'.repeat(64) })).rejects.toThrow('出生');
    }, db.db); } finally { await db.drop(); }
  }, 30_000);
});
