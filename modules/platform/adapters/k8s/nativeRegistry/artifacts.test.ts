import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Resources } from '@crewstation/k8s';
import { consumerFixture } from '../../../../../packages/filesystem-metrics/consumerFixture';
import { registryArtifactFixture } from './artifactFixture';

test('actual native graph plus all-node original inode consumers: HTTP/catalog unlink cannot hide an old held payload', async () => {
  await consumerFixture(async proc => {
    await writeFile(join(proc.root, 'sys/kernel/random/boot_id'), randomUUID() + '\n');
    const f = await registryArtifactFixture(proc.root);
    try {
      const parent = await proc.process('101'), fd = join(parent, 'fd', '0'); await symlink(f.path(f.layer), fd);
      const history = await f.source.capture(randomUUID(), f.query);
      expect((await f.source.inspect(history)).consumerCount).toBe(1);
      await rm(join(f.base, 'repositories/apps/original'), { recursive: true });
      await rename(f.path(f.layer), join(f.root, 'original-held-payload')); await rm(fd); await symlink(join(f.root, 'original-held-payload'), fd);
      await rm(f.path(f.config)); await rm(f.path(f.manifest));
      const held = await f.source.inspect(JSON.parse(JSON.stringify(history)));
      expect(held).toMatchObject({ native: 0, storage: 0, consumerCount: 1, independent: true, physicalReclamationProven: false });
      await rm(fd); expect((await f.source.inspect(history)).consumerCount).toBe(0);
      expect(f.calls.filter(url => url.endsWith('/consumers')).length).toBeGreaterThan(3);
    } finally { await f.drop(); }
  });
});
test('original source recheck refuses a replacement probe runtime and rejects an isolated PID namespace', async () => {
  await consumerFixture(async proc => {
    await writeFile(join(proc.root, 'sys/kernel/random/boot_id'), randomUUID() + '\n'); await proc.process('101');
    const f = await registryArtifactFixture(proc.root);
    try {
      const history = await f.source.capture(randomUUID(), f.query);
      await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { status: { containerStatuses: [{ name: 'probe', ready: true, state: { running: {} }, containerID: 'containerd://' + 'e'.repeat(64), imageID: 'probe@sha256:' + 'b'.repeat(64) }] } });
      await expect(f.source.inspect(history)).rejects.toThrow('消费者');
      await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { spec: { hostPID: false } });
      const before = f.calls.length; await expect(f.source.capture(randomUUID(), f.query)).rejects.toThrow('局部 PID');
      expect(f.calls.slice(before).some(url => url.endsWith('/consumers'))).toBe(false);
    } finally { await f.drop(); }
  });
});
