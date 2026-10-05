import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import { Resources } from '../../../packages/k8s';
import { newResourceId } from '../../../packages/kernel';
import { consumerFixture } from '../../../packages/filesystem-metrics/consumerFixture';
import { registryArtifactFixture } from '../../../modules/platform/adapters/k8s/nativeRegistry/artifactFixture';
import { captureRegistryNativeInstallation, registryNativeSourceValidator, RegistryNativeOriginSchema } from './source';

async function fixture(run: (f: Awaited<ReturnType<typeof registryArtifactFixture>>, history: Awaited<ReturnType<Awaited<ReturnType<typeof registryArtifactFixture>>['source']['capture']>>, installation: Awaited<ReturnType<typeof captureRegistryNativeInstallation>>) => Promise<void>) {
  await consumerFixture(async proc => {
    await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), randomUUID()); await proc.process('101');
    const f = await registryArtifactFixture(proc.root);
    try {
      const history = await f.source.capture(newResourceId(), f.query), origin = RegistryNativeOriginSchema.parse(history.origin);
      const installation = await captureRegistryNativeInstallation(f.k8s, { namespace: 'system', service: 'registry', pod: 'registry', pvc: 'registry', pv: 'registry', probe: 'probe', container: 'registry', root: f.root, origin }, AbortSignal.timeout(1000));
      await run(f, history, installation);
    } finally { await f.drop(); }
  });
}
test('the original native installation remains bound during a paused readiness change, while runtime, full specs and real filesystem births are rechecked', async () => fixture(async (f, history, installation) => {
  const inspect = registryNativeSourceValidator(f.k8s, installation);
  await inspect(history, AbortSignal.timeout(1000));
  await f.k8s.mergePatch(Resources.Pod!, 'registry', 'system', { status: { conditions: [{ type: 'Ready', status: 'False' }], containerStatuses: [{ name: 'registry', containerID: installation.origin.containerId, imageID: installation.origin.imageId, ready: false, state: { running: {} } }] } });
  await inspect(history, AbortSignal.timeout(1000)); expect(installation.pins).toHaveLength(7);
  await rename(join(f.root, 'volume'), join(f.root, 'original-volume')); await mkdir(join(f.root, 'volume/docker/registry/v2'), { recursive: true });
  await expect(inspect(history, AbortSignal.timeout(1000))).rejects.toThrow('volume was replaced');
}));
test('a new native process, modified full mount or stale original node heartbeat cannot authorize erasure', async () => {
  for (const mode of ['runtime', 'mount', 'heartbeat'] as const) await fixture(async (f, history, installation) => {
    const inspect = registryNativeSourceValidator(f.k8s, installation);
    if (mode === 'runtime') await f.k8s.mergePatch(Resources.Pod!, 'registry', 'system', { status: { containerStatuses: [{ name: 'registry', containerID: 'containerd://' + 'e'.repeat(64), imageID: installation.origin.imageId, state: { running: {} } }] } });
    if (mode === 'mount') await f.k8s.mergePatch(Resources.Pod!, 'registry', 'system', { spec: { containers: [{ name: 'registry', volumeMounts: [{ name: 'data', mountPath: '/var/lib/registry', subPath: 'new' }] }] } });
    if (mode === 'heartbeat') await f.k8s.mergePatch({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', plural: 'leases', namespaced: true }, 'node', 'kube-node-lease', { spec: { renewTime: new Date(Date.now() - 60_000).toISOString() } });
    await expect(inspect(history, AbortSignal.timeout(1000))).rejects.toThrow();
  });
});
test('a substituted history, duplicate installation pin or same-name Kubernetes birth cannot become the original source', async () => fixture(async (f, history, installation) => {
  const inspect = registryNativeSourceValidator(f.k8s, installation);
  await expect(inspect({ ...history, query: { ...history.query, directory: 'other' } }, AbortSignal.timeout(1000))).rejects.toThrow('another installation');
  expect(() => registryNativeSourceValidator(f.k8s, { ...installation, pins: [...installation.pins.slice(0, 6), installation.pins[0]!] })).toThrow('incomplete');
  const pod = (await f.k8s.get(Resources.Pod!, 'registry', 'system'))!; await f.k8s.apply({ ...pod, metadata: { ...pod.metadata, uid: randomUUID() } });
  await expect(inspect(history, AbortSignal.timeout(1000))).rejects.toThrow('replaced');
  await expect(captureRegistryNativeInstallation(f.k8s, installation, AbortSignal.timeout(1000))).rejects.toThrow('changed before');
}));
