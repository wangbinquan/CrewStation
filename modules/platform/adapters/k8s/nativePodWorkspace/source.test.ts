import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createFilesystemMetricsHandler } from '@crewstation/filesystem-metrics';
import { Resources } from '@crewstation/k8s';
import { consumerFixture } from '../../../../../packages/filesystem-metrics/consumerFixture';
import { registryArtifactFixture } from '../nativeRegistry/artifactFixture';
import { nativePodWorkspaceSource } from './source';

const token = 'native-pod-workspace-original-token'.repeat(2);
async function fixture(work: (f: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
  await consumerFixture(async proc => { const f = await prepare(proc); try { await work(f); } finally { await f.drop(); } });
}
async function prepare(proc: Parameters<Parameters<typeof consumerFixture>[0]>[0]) {
  const f = await registryArtifactFixture(proc.root), root = join(f.root, 'kubelet'), uid = randomUUID(), staticUid = 'd'.repeat(32), file = join(root, uid, 'volumes/kubernetes.io~empty-dir/work/result');
  await proc.process('101');
  await mkdir(join(root, staticUid), { recursive: true }); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, 'private bytes');
  await f.k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'original', namespace: 'project', uid }, spec: { nodeName: 'node', volumes: [{ name: 'work', emptyDir: {} }], containers: [{ name: 'builder' }] } });
  await f.k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'static', namespace: 'kube-system', uid: randomUUID(), annotations: { 'kubernetes.io/config.mirror': staticUid, 'kubernetes.io/config.source': 'file' } }, spec: { nodeName: 'node' } });
  await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { spec: { volumes: [{ name: 'kubelet', hostPath: { path: '/var/lib/kubelet/pods' } }], containers: [{ name: 'probe', env: [{ name: 'CS_STORAGE_PROBE_POD_ROOT', value: '/kubelet-pods' }],
    volumeMounts: [{ name: 'kubelet', mountPath: '/kubelet-pods', readOnly: true }], securityContext: { runAsUser: 0, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { add: ['SYS_PTRACE', 'DAC_READ_SEARCH'] } } }] } });
  const handler = createFilesystemMetricsHandler({ token, roots: {}, podWorkspaceRoot: root, procRoot: proc.root });
  const fetcher = (url: URL, init: RequestInit) => handler(new Request(url, init));
  const source = nativePodWorkspaceSource(f.k8s, { namespace: 'system', port: 8095, token, hostRoot: '/var/lib/kubelet/pods', mountPath: '/kubelet-pods' }, fetcher);
  const pod = (await f.k8s.get(Resources.Pod!, 'original', 'project'))!;
  return { ...f, root, uid, staticUid, file, source, pod, proc };
}
test('actual complete kubelet and API identities bind the original Pod; file disappearance keeps retained inode consumers', () => fixture(async f => {
  const process = await f.proc.process('111'), held = await open(f.file, 'r');
  try {
    const stat = await held.stat({ bigint: true }), major = (stat.dev >> 8n & 0xfffn) | (stat.dev >> 32n & ~0xfffn), minor = (stat.dev & 0xffn) | (stat.dev >> 12n & ~0xffn);
    await writeFile(join(process, 'maps'), `1000-2000 r--p 00000000 ${major.toString(16)}:${minor.toString(16)} ${stat.ino} [original mapping]\n`);
    const original = await f.source.capture(f.pod); expect(original.inventory.allPodUids).toContain(f.staticUid); expect(original.inventory.volumes[0]!.files).toHaveLength(2);
    const initial = await f.source.inspect(original); expect(initial.consumerCount).toBe(1); expect(initial.physicalReclamationProven).toBe(false);
    await f.k8s.delete(Resources.Pod!, 'original', 'project'); await rm(join(f.root, f.uid), { recursive: true });
    const removed = await f.source.inspect(original); expect(removed.storageRemaining).toBe(0); expect(removed.consumerCount).toBe(1);
    expect(String((await held.stat({ bigint: true })).ino)).toBe(original.inventory.volumes[0]!.files.find(row => row.kind === 'file')!.inode);
    await writeFile(join(process, 'maps'), ''); await held.close(); expect((await f.source.inspect(original)).consumerCount).toBe(0);
  } finally { await held.close().catch(() => {}); }
}));
test('unattributed node residue, a replaced original tree and a different or writable probe are denied', () => fixture(async f => {
  const original = await f.source.capture(f.pod), orphan = randomUUID();
  await mkdir(join(f.root, orphan)); await expect(f.source.inspect(original)).rejects.toThrow('不能独立归属'); await rm(join(f.root, orphan), { recursive: true });
  await rm(join(f.root, f.uid), { recursive: true }); await mkdir(join(f.root, f.uid)); await expect(f.source.inspect(original)).rejects.toThrow('出生已替换');
  await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { spec: { containers: [{ name: 'probe', volumeMounts: [{ name: 'kubelet', mountPath: '/kubelet-pods', readOnly: false }],
    securityContext: { runAsUser: 0, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { add: ['SYS_PTRACE', 'DAC_READ_SEARCH'] } } }] } });
  await expect(f.source.capture(f.pod)).rejects.toThrow('完整只读挂载');
}));
