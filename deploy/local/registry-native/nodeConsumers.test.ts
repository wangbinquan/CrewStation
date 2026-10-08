import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { symlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createFilesystemMetricsHandler, createNodeFileConsumerClient, NodeFileConsumerRequestSchema } from '../../../packages/filesystem-metrics';
import { consumerFixture } from '../../../packages/filesystem-metrics/consumerFixture';
import { registryArtifactFixture } from '../../../modules/platform/adapters/k8s/nativeRegistry/artifactFixture';
import { nodeFileConsumerSource } from '../../../modules/platform/adapters/k8s/nodeFileConsumers';
import { jsonHash, newResourceId } from '../../../packages/kernel';
import { Resources } from '../../../packages/k8s';
import { captureRegistryNativeInstallation, RegistryNativeOriginSchema } from './source';
import { nativeRegistryConsumerReader } from './consumers';
import { nativeRegistryNodeConsumers } from './nodeConsumers';
import { nativeRegistryService } from './service';
import { nativeRegistryJournal } from './journal';

const token = 'native-node-birth-observer-token-1234567890';
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  await consumerFixture(async proc => {
    const f = await setup(proc); try { await run(f); } finally { f.journal.close(); await f.drop(); }
  });
}
async function setup(proc: Parameters<Parameters<typeof consumerFixture>[0]>[0]) {
  await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), randomUUID()); const pid = await proc.process('101');
  await symlink(proc.file, join(pid, 'fd/5'));
  const f = await registryArtifactFixture(proc.root), history = await f.source.capture(newResourceId(), f.query), origin = RegistryNativeOriginSchema.parse(history.origin);
  const installation = await captureRegistryNativeInstallation(f.k8s, { namespace: 'system', service: 'registry', pod: 'registry', pvc: 'registry', pv: 'registry', probe: 'probe', container: 'registry', root: f.root, origin }, AbortSignal.timeout(5000));
  const consumerReader = nativeRegistryConsumerReader(async req => createFilesystemMetricsHandler({ roots: {}, token: req.headers.get('authorization')!.slice(7), procRoot: proc.root })(req));
  const process = { pid: 101, containerId: origin.containerId, podUid: origin.podUid, bootId: history.consumers.bootId, namespace: history.consumers.namespace, startTicks: '311', cgroup: 'a'.repeat(64), executable: '/bin/registry' as const, executableIdentity: 'b'.repeat(64) };
  const read = nativeRegistryNodeConsumers(f.k8s, installation, process, consumerReader), journal = nativeRegistryJournal(join(f.root, 'readonly-native-journal.sqlite'), history.sourceIdentity);
  let mutations = 0;
  const handler = nativeRegistryService({ token, root: f.root, sourceIdentity: history.sourceIdentity, journal, fileConsumers: read,
    assertGrant: async () => { mutations++; throw Error('read must not acquire a deletion grant'); }, assertOriginalSource: async () => { mutations++; throw Error('read must not impersonate deletion history'); },
    authority: () => { mutations++; throw Error('read must not acquire erasure authority'); } });
  const identities = [{ ...proc.identity, birthtimeNs: String((await stat(proc.file, { bigint: true })).birthtimeNs) }];
  const input = { origin: history.consumers, identities }, transport = { baseUrl: 'http://native', token };
  const fetcher = async (url: URL, init: RequestInit) => {
    if (url.hostname === 'native') return handler(new Request(url, init));
    const parsed = await new Request(url, init).json() as Record<string, unknown>;
    if ((parsed['identities'] as Array<Record<string, unknown>>).some(row => 'birthtimeNs' in row)) throw Error('original probe binary rejects extended input');
    return createFilesystemMetricsHandler({ roots: {}, token: init.headers ? new Headers(init.headers).get('authorization')!.slice(7) : '', procRoot: proc.root })(new Request(url, init));
  };
  return { ...f, history, installation, input, read, journal, handler, identities, transport, fetcher, mutations: () => mutations };
}
test('production node source uses the existing private observer for born tuples and retains the original probe and conservative legacy callers', async () => fixture(async f => {
  const source = nodeFileConsumerSource(f.k8s, { namespace: 'system', port: 8095, token, consumerBirth: f.transport }, f.fetcher);
  const captured = await source.capture({ uid: f.ids.node, name: 'node' }, f.identities);
  expect(captured.source).toEqual(f.history.consumers); expect(captured.count).toBe(1);
  const reused = [{ ...f.identities[0]!, birthtimeNs: String(BigInt(f.identities[0]!.birthtimeNs) + 1n) }];
  expect((await source.observe(captured.source, reused)).count).toBe(0);
  expect((await source.observe(captured.source, [...reused, ...f.identities])).count).toBe(1);
  expect((await source.observe(captured.source, f.identities.map(({ device, inode }) => ({ device, inode })))).count).toBe(1);
  const legacy = nodeFileConsumerSource(f.k8s, { namespace: 'system', port: 8095, token }, f.fetcher);
  expect((await legacy.observe(captured.source, reused)).count).toBe(1);
  expect(f.journal.status()).toMatchObject({ active: 0, total: 0 }); expect(f.mutations()).toBe(0);
}));
test('authenticated private observation rejects arbitrary roots, invalid births, oversized bodies and altered original host material', async () => fixture(async f => {
  const request = (body: unknown, credential = token, method = 'POST') => f.handler(new Request('http://native/native/registry/file-consumers', { method, headers: { authorization: 'Bearer ' + credential }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
  expect((await request(f.input, 'wrong')).status).toBe(401); expect((await request(f.input, token, 'GET')).status).toBe(405);
  for (const input of [{ ...f.input, procRoot: '/other' }, { ...f.input, identities: [{ ...f.identities[0], birthtimeNs: '0' }] },
    { ...f.input, origin: { ...f.input.origin, probeUid: randomUUID() } }, { ...f.input, padding: 'x'.repeat(65_536) }]) expect((await request(input)).status).toBe(503);
  const other = { ...f.input.origin, namespace: 'pid:[702]' }; const { identity: _identity, ...material } = other;
  expect((await request({ ...f.input, origin: { ...other, identity: jsonHash(material) } })).status).toBe(503);
  expect(NodeFileConsumerRequestSchema.safeParse({ ...f.input, identities: [f.identities[0], f.identities[0]] }).success).toBe(false);
  expect(f.mutations()).toBe(0); expect(f.journal.status().total).toBe(0);
}));
test('a changed probe runtime, full mount, stale node or host namespace never becomes a successful zero proof', async () => {
  for (const mode of ['runtime', 'mount', 'heartbeat', 'namespace', 'mid-read'] as const) await fixture(async f => {
    if (mode === 'runtime') await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { status: { containerStatuses: [{ name: 'probe', ready: true, state: { running: {} }, containerID: 'containerd://' + 'e'.repeat(64), imageID: f.input.origin.imageId }] } });
    if (mode === 'mount') await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { spec: { containers: [{ name: 'probe', volumeMounts: [{ name: 'source', mountPath: '/volumes', readOnly: true, subPath: 'other' }] }] } });
    if (mode === 'heartbeat') await f.k8s.mergePatch({ apiVersion: 'coordination.k8s.io/v1', kind: 'Lease', plural: 'leases', namespaced: true }, 'node', 'kube-node-lease', { spec: { renewTime: new Date(Date.now() - 60_000).toISOString() } });
    let read = f.read;
    if (mode === 'namespace' || mode === 'mid-read') {
      const process = { pid: 101, containerId: f.installation.origin.containerId, podUid: f.installation.origin.podUid, bootId: f.input.origin.bootId, namespace: f.input.origin.namespace, startTicks: '311', cgroup: 'a'.repeat(64), executable: '/bin/registry' as const, executableIdentity: 'b'.repeat(64) };
      read = nativeRegistryNodeConsumers(f.k8s, f.installation, process, async () => {
        if (mode === 'mid-read') await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { status: { conditions: [{ type: 'Ready', status: 'False' }] } });
        return { version: 1, complete: true, bootId: process.bootId, namespace: mode === 'namespace' ? 'pid:[702]' : process.namespace, consumers: [], blockers: [] };
      });
    }
    await expect(read(f.input, AbortSignal.timeout(5000))).rejects.toThrow(); expect(f.journal.status().total).toBe(0);
  });
});
test('private client keeps an independently unavailable original probe blocked', async () => fixture(async f => {
  const client = createNodeFileConsumerClient({ ...f.transport, fetch: f.fetcher });
  expect((await client.observe(f.input)).consumers).toHaveLength(1);
  await f.k8s.mergePatch(Resources.Pod!, 'probe', 'system', { status: { conditions: [{ type: 'Ready', status: 'False' }] } });
  await expect(client.observe(f.input)).rejects.toThrow('HTTP 503');
}));
