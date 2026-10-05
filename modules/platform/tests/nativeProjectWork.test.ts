import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { Resources } from '@crewstation/k8s';
import { nativeRuntimeProjectWork } from '../adapters/k8s/nativeProjectWork/runtime';
import { nativeReleaseProjectWork } from '../adapters/k8s/nativeProjectWork/release';
import { removeWorkObjects } from '../adapters/k8s/nativeProjectWork/catalog';
import { withNativeWork } from './nativeWorkFixture';
import type { PodWorkHistory } from '../adapters/k8s/nativeProjectWork/bindings';

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
const available = await testDatabaseAvailable();
describe.skipIf(!available)('native release work with real PostgreSQL writer exclusion', () => {
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
