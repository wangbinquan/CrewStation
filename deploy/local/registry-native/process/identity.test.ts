import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, readlink, stat, symlink } from 'node:fs/promises';
import { consumerFixture } from '../../../../packages/filesystem-metrics/consumerFixture';
import { assertRegistryThreadsStopped, inspectOriginalRegistryProcess, processStat, revalidateOriginalRegistryProcess } from './identity';

test('original process capture reads a complete proc fixture, exact container/pod cgroup and executable birth; every thread must actually stop', async () => consumerFixture(async proc => {
  const bootId = randomUUID(), input = { containerId: 'containerd://' + 'a'.repeat(64), podUid: randomUUID() }, path = await proc.process('101');
  await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), bootId);
  await Bun.write(join(path, 'cgroup'), '0::/../../kubelet-kubepods-burstable-pod' + input.podUid.replaceAll('-', '_') + '.slice/cri-containerd-' + 'a'.repeat(64) + '.scope\n');
  await symlink('/bin/registry', join(path, 'exe'));
  const readExecutable = async (directory: string) => ({ name: await readlink(join(directory, 'exe')), file: await stat(proc.file, { bigint: true }) });
  const original = await inspectOriginalRegistryProcess(input, proc.root, AbortSignal.timeout(1000), readExecutable);
  expect(original).toMatchObject({ pid: 101, bootId, startTicks: '311', namespace: 'pid:[701]', ...input });
  expect(await revalidateOriginalRegistryProcess(original, proc.root, AbortSignal.timeout(1000), readExecutable)).toEqual(original);
  await expect(revalidateOriginalRegistryProcess({ ...original, startTicks: '999' }, proc.root, AbortSignal.timeout(1000), readExecutable)).rejects.toThrow('changed');
  await expect(assertRegistryThreadsStopped(original, proc.root)).rejects.toThrow('not stopped');
  await Bun.write(join(path, 'stat'), (await readFile(join(path, 'stat'), 'utf8')).replace(') S ', ') T '));
  await assertRegistryThreadsStopped(original, proc.root);
  await proc.thread('101', '202'); await expect(assertRegistryThreadsStopped(original, proc.root)).rejects.toThrow('not stopped');
}));
test('additional original-container producers, wrong pod cgroup, changed executable or a capture-time cgroup replacement fail closed', async () => {
  for (const mode of ['additional', 'wrong-pod', 'executable', 'changed'] as const) await consumerFixture(async proc => {
    const input = { containerId: 'containerd://' + 'a'.repeat(64), podUid: randomUUID() }, path = await proc.process('101'), bootId = randomUUID();
    await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), bootId);
    const cgroup = '0::/kubepods-pod' + (mode === 'wrong-pod' ? randomUUID() : input.podUid).replaceAll('-', '_') + '.slice/cri-containerd-' + 'a'.repeat(64) + '.scope\n';
    await Bun.write(join(path, 'cgroup'), cgroup); await symlink(mode === 'executable' ? '/bin/another' : '/bin/registry', join(path, 'exe'));
    if (mode === 'additional') { const other = await proc.process('202'); await Bun.write(join(other, 'cgroup'), cgroup); await symlink('/bin/registry', join(other, 'exe')); }
    await expect(inspectOriginalRegistryProcess(input, proc.root, AbortSignal.timeout(1000), async directory => {
      if (mode === 'changed') await Bun.write(join(directory, 'cgroup'), cgroup + '1:name=changed:/new\n');
      return { name: await readlink(join(directory, 'exe')), file: await stat(proc.file, { bigint: true }) };
    })).rejects.toThrow();
  });
  expect(() => processStat('101 (name) malformed', '101')).toThrow();
});
