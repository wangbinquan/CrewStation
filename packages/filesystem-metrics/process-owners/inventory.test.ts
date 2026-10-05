import { expect, test } from 'bun:test';
import { writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { consumerFixture } from '../consumerFixture';
import { observeProcessOwners } from './inventory';
const podUid = 'dfd71b84-39f1-4434-a2ed-09828378ef8a', containerId = 'containerd://' + 'a'.repeat(64);
const owner = { key: 'original', podUid, containerId };
export const ownerFixture = (run: Parameters<typeof consumerFixture>[0]) => consumerFixture(async f => {
  await symlink('cgroup:[901]', join(f.root, 'self/ns/cgroup')); await run(f);
});

test('complete native cgroups find original nonleader producers even after an API Pod or file path disappears', () => ownerFixture(async f => {
  const process = await f.process('22'), thread = await f.thread('22', '24');
  await writeFile(join(process, 'cgroup'), '0::/system.slice/native-reader.service\n');
  await writeFile(join(thread, 'cgroup'), '0::/kubepods.slice/kubepods-burstable-pod' + podUid.replaceAll('-', '_') + '.slice/cri-containerd-' + 'a'.repeat(64) + '.scope\n');
  const held = await observeProcessOwners(f.root, { owners: [owner] }); expect(held.complete).toBe(true);
  expect(held.owners[0]!.threads).toMatchObject([{ pid: 22, tid: 24, startTicks: '811' }]);
  for (const raw of ['native-reader', 'kubepods', containerId, podUid, f.root]) expect(JSON.stringify(held)).not.toContain(raw);
  await writeFile(join(thread, 'cgroup'), '0::/system.slice/finished.service\n');
  expect((await observeProcessOwners(f.root, { owners: [owner], source: { bootId: held.bootId, namespace: held.namespace, cgroupNamespace: held.cgroupNamespace } })).owners[0]!.threads).toEqual([]);
}));
test('wrong CID cannot hide another thread of the original Pod; inaccessible or malformed metadata never supplies zero proof', () => ownerFixture(async f => {
  const process = await f.process('22'); await writeFile(join(process, 'cgroup'), '2:cpu,memory:/kubepods/burstable/pod' + podUid + '/' + 'b'.repeat(64) + '\n');
  expect((await observeProcessOwners(f.root, { owners: [owner] })).owners[0]!.threads).toHaveLength(1);
  await writeFile(join(process, 'cgroup'), 'not a native cgroup'); expect((await observeProcessOwners(f.root, { owners: [owner] })).complete).toBe(false);
  await rm(join(process, 'cgroup')); expect((await observeProcessOwners(f.root, { owners: [owner] })).blockers).toEqual([{ code: 'process-unreadable', pid: 22 }]);
}));
test('source birth, empty proc, duplicate owner and cancellation fail closed', () => ownerFixture(async f => {
  expect((await observeProcessOwners(f.root, { owners: [owner] })).complete).toBe(false);
  const process = await f.process('22'); await writeFile(join(process, 'cgroup'), '0::/\n');
  expect((await observeProcessOwners(f.root, { owners: [owner], source: { bootId: 'efd71b84-39f1-4434-a2ed-09828378ef8a', namespace: 'pid:[701]', cgroupNamespace: 'cgroup:[901]' } })).blockers).toEqual([{ code: 'source-changed' }]);
  await expect(observeProcessOwners(f.root, { owners: [owner, owner] })).rejects.toThrow();
  await expect(observeProcessOwners(f.root, { owners: [owner] }, AbortSignal.abort(Error('cancelled')))).rejects.toThrow('cancelled');
}));
test('actual cgroup namespace relative metadata matches original producers; embedded traversal and namespace replacement block completion', () => ownerFixture(async f => {
  const process = await f.process('22');
  await writeFile(join(process, 'cgroup'), '0::/../../kubelet-kubepods-burstable-pod' + podUid.replaceAll('-', '_') + '.slice/cri-containerd-' + 'a'.repeat(64) + '.scope\n');
  const actual = await observeProcessOwners(f.root, { owners: [owner] }); expect(actual.complete).toBe(true); expect(actual.owners[0]!.threads).toHaveLength(1);
  await rm(join(f.root, 'self/ns/cgroup')); await symlink('cgroup:[902]', join(f.root, 'self/ns/cgroup'));
  expect((await observeProcessOwners(f.root, { owners: [owner], source: { bootId: actual.bootId, namespace: actual.namespace, cgroupNamespace: actual.cgroupNamespace } })).blockers).toEqual([{ code: 'source-changed' }]);
  await writeFile(join(process, 'cgroup'), '0::/kubepods/../pod' + podUid + '\n');
  expect((await observeProcessOwners(f.root, { owners: [owner] })).complete).toBe(false);
}));
