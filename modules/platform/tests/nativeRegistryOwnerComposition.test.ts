import { expect, test } from 'bun:test';
import { open, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { newResourceId, jsonHash } from '@crewstation/kernel';
import { ProjectIdSchema } from '@crewstation/contracts';
import { Resources } from '@crewstation/k8s';
import { consumerFixture } from '../../../packages/filesystem-metrics/consumerFixture';
import { nativeRegistryOwnerFixture } from './nativeRegistryOwnerFixture';
import { runtimeImageProjectDeletionOwner } from '../../runtime-environment/application/projectDeletion';
import { RuntimeImagePhysicalScopeSchema } from '../../runtime-environment/domain/records';

test('the actual runtime owner publishes the source binding accepted by the native factory and private service', async () => {
  await consumerFixture(async proc => {
    const f = await nativeRegistryOwnerFixture(proc.root, 'runtime-environment'); await f.prepareProc(); await proc.process('101');
    const unused = async () => { throw Error('This read-only confirmation oracle cannot mutate owner metadata'); };
    try {
      const owner = runtimeImageProjectDeletionOwner({ physics: f.api.runtimePhysics, assertGrant: async () => {}, repository: {
        content: async () => f.runtimeContent, retained: async () => undefined, seal: unused, load: unused, callbacksExited: unused,
        recoverCallbacks: unused, advance: unused, purgeMetadata: unused,
      } });
      const confirmed = await owner.inspect(f.target), scope = RuntimeImagePhysicalScopeSchema.parse((await f.api.capture()).scope);
      const context = { ...f.context(scope, 'stop'), confirmed };
      const artifact = confirmed.resources.find(row => row.id === 'registry-history:' + f.target.id)!;
      // The formal owner wraps the raw source once. Previously the adapter
      // wrapped it before publication, then expected an unwrapped grant.
      expect(artifact.sourceIdentity).toBe(jsonHash({ nativeSource: f.history().sourceIdentity, consumerId: null, consumerIdentity: null }));
      expect((await f.api.stop(context, scope)).kind).toBe('done');
      const invalid = { ...context, confirmed: { ...confirmed, resources: confirmed.resources.map(row => row.id === artifact.id ? { ...row, sourceIdentity: f.history().sourceIdentity } : row) } };
      await expect(f.api.stop(invalid, scope)).rejects.toThrow('全部原物理材料');
      expect(f.controls.reclaimed).toBe(0);
    } finally { await f.drop(); }
  });
});

for (const mode of ['runtime-environment', 'release'] as const) {
  test(`${mode}: actual native Registry scope persists through JSON and refuses catalog or private acknowledgement as byte reclamation (controlled work source)`, async () => {
    await consumerFixture(async proc => {
      const f = await nativeRegistryOwnerFixture(proc.root, mode); await f.prepareProc(); await proc.process('101');
      try {
        const captured = await f.api.capture(), scope = JSON.parse(JSON.stringify(captured.scope));
        expect(captured.complete).toBe(true); expect(scope.objects).toContainEqual(expect.objectContaining({ kind: 'artifact', id: 'registry-history:' + f.target.id, identity: f.artifactIdentity() }));
        expect((await f.api.inspect(scope)).complete).toBe(true);
        expect((await f.api.prove(scope)).kind).toBe('waiting');
        expect(await f.api.stop(f.context(scope, 'stop'), scope)).toMatchObject({ kind: 'done', independent: true, nativeRemaining: 0 });
        // HTTP success is only an acknowledgement. Native bytes remain and the
        // factory performs its own independent final read.
        f.install(); f.controls.storage = 1;
        expect((await f.api.purge(f.context(scope, 'purge'), scope)).kind).toBe('waiting'); expect(f.controls.reclaimed).toBe(0);
        f.controls.storage = 0; f.controls.closed = false;
        expect((await f.api.purge(f.context(scope, 'purge'), scope)).kind).toBe('waiting'); expect(f.controls.reclaimed).toBe(0); expect(await f.exists(f.layer)).toBe(true);
      } finally { await f.drop(); }
    });
  });
  test(`${mode}: changed original scope, grant, source and malformed zero counters reject before native mutation`, async () => {
    await consumerFixture(async proc => {
      const f = await nativeRegistryOwnerFixture(proc.root, mode); await f.prepareProc(); await proc.process('101');
      try {
        const scope = (await f.api.capture()).scope!; f.install();
        const changed = JSON.parse(JSON.stringify(scope)); changed.nativeHistory.body.registry.projectId = newResourceId(); changed.nativeHistory.digest = jsonHash(changed.nativeHistory.body);
        await expect(f.api.prove(changed)).rejects.toThrow('身份变化');
        f.controls.storage = -1; await expect(f.api.purge(f.context(scope, 'purge'), scope)).rejects.toThrow(); f.controls.storage = 0;
        f.controls.malformed = true; await expect(f.api.purge(f.context(scope, 'purge'), scope)).rejects.toThrow('observation'); f.controls.malformed = false;
        f.controls.grants = false; await expect(f.api.purge(f.context(scope, 'purge'), scope)).rejects.toThrow('grant'); f.controls.grants = true;
        const missing = f.context(scope, 'purge'); missing.confirmed = { ...missing.confirmed, resources: [] };
        await expect(f.api.purge(missing, scope)).rejects.toThrow('全部原物理材料');
        await expect(f.api.purge({ ...f.context(scope, 'purge'), target: { ...f.target, id: ProjectIdSchema.parse(newResourceId()) } }, scope)).rejects.toThrow('项目许可');
        await f.k8s.mergePatch(Resources.Pod!, 'registry', 'system', { status: { containerStatuses: [{ name: 'registry', containerID: 'containerd://' + 'e'.repeat(64), imageID: 'registry@sha256:' + 'd'.repeat(64), ready: true, state: { running: {} } }] } });
        await expect(f.api.inspect(scope)).rejects.toThrow('替换');
        expect(f.controls.reclaimed).toBe(0); expect(await f.exists(f.layer)).toBe(true);
      } finally { await f.drop(); }
    });
  });
  test.skipIf(process.platform !== 'linux')(`${mode}: original unlinked bytes remain waiting while their actual descriptor is still open`, async () => {
    await consumerFixture(async proc => {
      const f = await nativeRegistryOwnerFixture(proc.root, mode); await f.prepareProc(); const process = await proc.process('101');
      const held = await open(f.path(f.layer), 'r'), fd = join(process, 'fd', '0');
      try {
        await symlink('/proc/self/fd/' + held.fd, fd);
        const scope = (await f.api.capture()).scope!;
        await rm(join(f.base, 'repositories'), { recursive: true }); await rm(f.path(f.config)); await rm(f.path(f.manifest)); await rm(f.path(f.layer));
        expect((await f.api.prove(scope)).kind).toBe('waiting');
        await rm(fd); await held.close();
        const proof = await f.api.prove(JSON.parse(JSON.stringify(scope)));
        expect(proof).toMatchObject({ kind: 'done', sourceIdentity: scope.source.identity, scopeDigest: jsonHash(scope), nativeRemaining: 0, storageRemaining: 0 });
      } finally { await held.close().catch(() => {}); await f.drop(); }
    });
  });
  test.skipIf(process.platform !== 'linux')(`${mode}: actual native unlink and independent final proof preserve a shared foreign layer; rebuilt factory replays the retained original scope`, async () => {
    await consumerFixture(async proc => {
      const f = await nativeRegistryOwnerFixture(proc.root, mode); await f.prepareProc(); await proc.process('101');
      try {
        const foreign = join(f.base, 'repositories/foreign/_layers/sha256', f.layer.slice(7), 'link'); await mkdir(dirname(foreign), { recursive: true }); await writeFile(foreign, f.layer);
        const scope = (await f.api.capture()).scope!; f.install();
        const result = await f.api.purge(f.context(scope, 'purge'), JSON.parse(JSON.stringify(scope)));
        expect(result).toMatchObject({ kind: 'done', nativeRemaining: 0, storageRemaining: 0 });
        expect(f.controls.reclaimed).toBe(1); expect(await f.exists(f.layer)).toBe(true); expect(await f.exists(f.manifest)).toBe(false);
        const rebuilt = f.rebuild(), replay = JSON.parse(JSON.stringify(scope));
        expect((await rebuilt.prove(replay)).kind).toBe('done');
        expect((await rebuilt.purge(f.context(replay, 'purge'), replay)).kind).toBe('done'); expect(f.controls.reclaimed).toBe(2);
      } finally { await f.drop(); }
    });
  });
}
