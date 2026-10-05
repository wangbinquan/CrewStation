import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { rm, symlink } from 'node:fs/promises';
import { Resources } from '@crewstation/k8s';
import { createFilesystemMetricsHandler } from '@crewstation/filesystem-metrics';
import { consumerFixture } from '../../../../packages/filesystem-metrics/consumerFixture';
import { nativeGarageFixture } from './nativeGarage/sourceFixture';
import { nodeFileConsumerSource } from './nodeFileConsumers';

const token = 'whole-node-consumer-token-1234567890';
test('node source checks every thread and page, retains original boot/instance and sees held descriptor zero until actual close', async () => {
  await consumerFixture(async proc => {
    const f = await nativeGarageFixture();
    try {
      const main = await proc.process('101'), thread = await proc.thread('101', '102');
      await symlink(proc.file, join(main, 'fd', '0')); await symlink(proc.file, join(thread, 'fd', '3'));
      const pod = (await f.k8s.get(Resources.Pod!, 'probe', 'system'))!, spec = pod['spec'] as { hostPID?: boolean; containers: Array<{ securityContext?: object }> };
      spec.hostPID = true; spec.containers[0]!.securityContext = { runAsUser: 0, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { add: ['SYS_PTRACE', 'DAC_READ_SEARCH'] } };
      (pod['status'] as Record<string, unknown>)['containerStatuses'] = [{ name: 'probe', ready: true, state: { running: {} }, containerID: 'containerd://' + 'a'.repeat(64), imageID: 'image@sha256:' + 'b'.repeat(64) }]; await f.k8s.apply(pod);
      const handler = createFilesystemMetricsHandler({ token, roots: {}, procRoot: proc.root }); let calls = 0;
      const source = nodeFileConsumerSource(f.k8s, { namespace: 'system', port: 8095, token }, (async (url, init) => { calls++; return handler(new Request(String(url), init)); }) as typeof fetch);
      const identities = [proc.identity, ...Array.from({ length: 256 }, (_, i) => ({ device: '0', inode: String(i + 1) }))];
      const original = await source.capture({ uid: 'original-node', name: 'node' }, identities);
      expect(calls).toBe(2); expect(original.count).toBe(2); expect(original.source).toMatchObject({ probeUid: 'original-probe', bootId: '12345678-1234-1234-1234-123456789abc', namespace: 'pid:[701]' });
      await rm(join(main, 'fd', '0')); await rm(join(thread, 'fd', '3'));
      expect((await source.observe(original.source, identities)).count).toBe(0);
      await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { status: { containerStatuses: [{ name: 'probe', ready: true, state: { running: {} }, containerID: 'containerd://' + 'c'.repeat(64), imageID: 'image@sha256:' + 'b'.repeat(64) }] } });
      await expect(source.observe(original.source, identities)).rejects.toThrow('全部文件消费者');
    } finally { await f.drop(); }
  });
});
test('a ready same-node probe confined to its own PID namespace cannot certify whole-node consumer exit', async () => {
  const f = await nativeGarageFixture(); let calls = 0;
  try {
    const source = nodeFileConsumerSource(f.k8s, { namespace: 'system', port: 8095, token }, async () => { calls++; return new Response('{}'); });
    await expect(source.capture({ uid: 'original-node', name: 'node' }, [])).rejects.toThrow('局部 PID'); expect(calls).toBe(0);
  } finally { await f.drop(); }
});
