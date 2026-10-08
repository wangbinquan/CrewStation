import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { NATIVE_REGISTRY_ADMISSION, ProjectDeletionContextSchema } from '../../../packages/contracts';
import { consumerFixture } from '../../../packages/filesystem-metrics/consumerFixture';
import { jsonHash, newResourceId } from '../../../packages/kernel';
import { withSharedDatabaseAdmission } from '../../../packages/persistence';
import { createTestDatabase, testDatabaseAvailable } from '../../../packages/testkit';
import { registryArtifactFixture } from '../../../modules/platform/adapters/k8s/nativeRegistry/artifactFixture';
import { nativeRegistryAuthority } from './authority';
import type { OriginalRegistryPause } from './process/pause';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('native Registry original PostgreSQL exclusion', () => {
  test('an actual active writer finishes before pause; fixed native pause and zero file consumers cover the whole exclusive callback', async () => {
    const tdb = await createTestDatabase();
    try { await consumerFixture(async proc => {
      const bootId = randomUUID(); await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), bootId); await proc.process('101');
      const f = await registryArtifactFixture(proc.root), projectId = newResourceId();
      try {
        const history = await f.source.capture(projectId, f.query), original = { pid: 321, containerId: 'containerd://' + 'c'.repeat(64), podUid: f.ids.pod, bootId, namespace: history.consumers.namespace,
          startTicks: '100', cgroup: jsonHash('original cgroup'), executable: '/bin/registry' as const, executableIdentity: jsonHash('original executable') };
        let paused = false, resumes = 0, grants = 0, originals = 0, observations = 0; const entered = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
        const process: OriginalRegistryPause = { original, close: () => {}, assertStopped: async () => { if (!paused) throw Error('original pause exited'); }, exclusive: async (signal, work) => {
          paused = true; try { return await work(signal); } finally { paused = false; resumes++; }
        } };
        const context = ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'purge', target: { id: projectId, name: 'Original', slug: 'original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'deleting', revision: '1', prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' },
          confirmed: { participant: 'release', complete: true, revision: jsonHash('original'), resources: [], references: [], blockers: [] } });
        const native = nativeRegistryAuthority({ db: tdb.db, process, signal: AbortSignal.timeout(10_000), context, history,
          assertGrant: async () => { grants++; }, assertOriginalSource: async () => { originals++; },
          observe: async (files, root, signal) => {
            observations++; signal?.throwIfAborted(); expect(root).toBe('/proc'); expect(files.length).toBeGreaterThan(0);
            for (const file of files) expect([...history.original.entries, ...history.original.blobs].some(row => row.device === file.device && row.inode === file.inode && row.birthtimeNs === file.birthtimeNs)).toBe(true);
            return { version: 1, complete: true, bootId, namespace: original.namespace, consumers: [], blockers: [] };
          } });
        const request = { query: history.query, original: history.original };
        await expect(native.assertClosed(request, AbortSignal.timeout(1000))).rejects.toThrow('exited');
        const writer = withSharedDatabaseAdmission(tdb.db, NATIVE_REGISTRY_ADMISSION, async () => { entered.resolve(); await finish.promise; }); await entered.promise;
        const eraser = native.exclusive(request, async () => {
          expect(paused).toBe(true); for (let unlink = 0; unlink < 100; unlink++) await native.assertClosed(request, AbortSignal.timeout(1000));
          const locks = await tdb.handle.client<{ held: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND granted) AS held`;
          expect(locks[0]!.held).toBe(true); return 'actually returned';
        });
        const deadline = Date.now() + 3000;
        while (!(await tdb.handle.client<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS waiting`)[0]!.waiting) {
          if (Date.now() > deadline) throw Error('Original exclusive callback never reached the actual lock'); await Bun.sleep(10);
        }
        expect(paused).toBe(false); finish.resolve(); await writer; expect(await eraser).toBe('actually returned');
        expect(resumes).toBe(1); expect(grants).toBeGreaterThan(3); expect(originals).toBeGreaterThan(3); expect(observations).toBe(2);
        await expect(native.assertClosed(request, AbortSignal.timeout(1000))).rejects.toThrow('exited');
        await expect(native.exclusive({ ...request, query: { ...request.query, exact: ['another'] } }, async () => {})).rejects.toThrow('changed');
      } finally { await f.drop(); }
    }); } finally { await tdb.drop(); }
  }, 15_000);
  test('retained inode users, an incomplete namespace or another native source deny erasure and still resume the original process', async () => {
    const tdb = await createTestDatabase();
    try { await consumerFixture(async proc => {
      const bootId = randomUUID(); await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), bootId); await proc.process('101');
      const f = await registryArtifactFixture(proc.root), projectId = newResourceId();
      try {
        const history = await f.source.capture(projectId, f.query), original = { pid: 321, containerId: 'containerd://' + 'c'.repeat(64), podUid: f.ids.pod, bootId, namespace: history.consumers.namespace,
          startTicks: '100', cgroup: jsonHash('original'), executable: '/bin/registry' as const, executableIdentity: jsonHash('original executable') };
        const context = ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'purge', target: { id: projectId, name: 'Original', slug: 'original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'deleting', revision: '1', prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' },
          confirmed: { participant: 'release', complete: true, revision: jsonHash('original'), resources: [], references: [], blockers: [] } });
        let paused = false, resumes = 0;
        const process: OriginalRegistryPause = { original, close: () => {}, assertStopped: async () => { if (!paused) throw Error('pause exited'); }, exclusive: async (signal, work) => {
          paused = true; try { return await work(signal); } finally { paused = false; resumes++; }
        } };
        for (const mode of ['users', 'late-user', 'incomplete', 'replacement', 'grant', 'source'] as const) {
          let observations = 0;
          const native = nativeRegistryAuthority({ db: tdb.db, process, signal: AbortSignal.timeout(5000), context, history,
            assertGrant: async () => { if (mode === 'grant' && paused) throw Error('grant revoked'); }, assertOriginalSource: async () => { if (mode === 'source' && paused) throw Error('original source changed'); },
            observe: async files => ({ version: 1, complete: mode !== 'incomplete', bootId: mode === 'replacement' ? randomUUID() : bootId, namespace: original.namespace,
              blockers: [], consumers: mode === 'users' || mode === 'late-user' && ++observations > 1 ? [{ pid: 101, tid: 101, startedTick: '1', kind: 'descriptor', ...files[0]! }] : [] }) });
          const request = { query: history.query, original: history.original };
          await expect(native.exclusive(request, async () => native.assertClosed(request, AbortSignal.timeout(1000)))).rejects.toThrow(); expect(paused).toBe(false);
        }
        expect(resumes).toBe(6);
        expect(() => nativeRegistryAuthority({ db: tdb.db, process: { ...process, original: { ...original, podUid: randomUUID() } }, signal: AbortSignal.timeout(1000), context, history,
          assertGrant: async () => {}, assertOriginalSource: async () => {} })).toThrow('original native process');
      } finally { await f.drop(); }
    }); } finally { await tdb.drop(); }
  }, 15_000);
});
