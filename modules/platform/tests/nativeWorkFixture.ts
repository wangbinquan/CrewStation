import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { createFilesystemMetricsHandler } from '@crewstation/filesystem-metrics';
import { Resources } from '@crewstation/k8s';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { consumerFixture } from '../../../packages/filesystem-metrics/consumerFixture';
import { buildKitSourceFixture } from '../adapters/k8s/nativeBuildKit/fixture';
import { blobDigest, cacheId } from '../../../packages/filesystem-metrics/buildkit/inventory/fixture';
import { boltSnapshotFixture, boltCacheFixture } from '../../../packages/filesystem-metrics/buildkit/fixture';
import { protoFields, protoMessage, protoText } from '../../../packages/filesystem-metrics/buildkit/protobuf';
import type { BuildKitWorkOptions } from '../adapters/k8s/nativeProjectWork/buildKit';

export async function withNativeWork(run: (f: Awaited<ReturnType<typeof prepare>>) => Promise<void>, db?: Database) {
  await consumerFixture(async proc => { const f = await prepare(proc, db); try { await run(f); } finally { await f.drop(); } });
}
async function prepare(proc: Parameters<Parameters<typeof consumerFixture>[0]>[0], db?: Database) {
  const f = await buildKitSourceFixture(), kubelet = join(f.root, 'kubelet'), containerId = 'containerd://' + '8'.repeat(64), workUid = randomUUID();
  await mkdir(kubelet); await symlink('cgroup:[901]', join(proc.root, 'self/ns/cgroup'));
  const init = await proc.process('101'); await writeFile(join(init, 'cgroup'), '0::/system\n');
  const pid = await proc.process('202'); await writeFile(join(pid, 'cgroup'), '0::/kubepods/pod' + workUid + '/' + containerId.slice(13) + '\n');
  const target = ProjectDeletionTargetSchema.parse({ id: newResourceId(), serviceId: newResourceId(), slug: 'project', name: 'Project', namespace: 'project', kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'project.test', previewHost: 'preview.test', serviceHost: 'project' });
  const operationId = newResourceId(), consumerId = newResourceId(), controllerUid = randomUUID(), credentialUid = randomUUID(), calls = { grants: 0, stops: [] as string[], participant: '', pending: false };
  const context = (phase: ProjectDeletionContext['phase'], participant: 'runtime-environment' | 'release'): ProjectDeletionContext => ({ operationId, target, phase, generation: 1, confirmed: { participant, revision: jsonHash('frozen'), resources: [], references: [], complete: true, blockers: [] } });
  const assertGrant = async (ctx: ProjectDeletionContext) => { calls.grants++; if (ctx.operationId !== operationId || ctx.target.id !== target.id) throw Error('actual grant denied'); };
  const project = { assertProjectDeletionGrant: assertGrant, getProject: async () => ({ id: target.id, slug: target.slug, createdAt: '2026-09-30T16:00:35.872Z' }),
    projectDeletionParticipantContext: async (ctx: ProjectDeletionContext, participant: 'resources') => ({ ...ctx, confirmed: { ...ctx.confirmed, participant } }) };
  const resourceDeletion = { sealClusterAdmission: async () => {}, assertClusterAdmission: async () => {}, podStopReceipts: () => ({ get: async () => undefined, save: async () => {} }) };
  const cluster = { projectPodProtection: () => ({ stopSelected: async (ctx: ProjectDeletionContext, keys: readonly string[]) => {
    await assertGrant(ctx); calls.participant = ctx.confirmed.participant; calls.stops.push(...keys);
    if (calls.pending) return { kind: 'waiting' as const, reason: 'original process remains' };
    for (const key of keys) { const row = JSON.parse(key); await f.k8s.delete(Resources.Pod!, row.name, row.namespace); }
    await rm(join(kubelet, workUid), { recursive: true, force: true }); await rm(pid, { recursive: true });
    return { kind: 'done' as const, evidence: { kind: 'physical' as const, digest: jsonHash(keys), description: 'Controlled original Pod stop', count: keys.length } };
  } }) };
  const originalProbe = (await f.k8s.get(Resources.Pod!, 'probe', 'system'))!;
  await f.k8s.apply({ ...originalProbe, spec: { nodeName: 'node', hostPID: true, volumes: [{ name: 'data', hostPath: { path: f.root, type: 'Directory' } }, { name: 'kubelet', hostPath: { path: '/var/lib/kubelet/pods' } }], containers: [{ name: 'probe', env: [{ name: 'CS_STORAGE_PROBE_POD_ROOT', value: '/kubelet-pods' }], volumeMounts: [{ name: 'data', mountPath: '/volumes', readOnly: true }, { name: 'kubelet', mountPath: '/kubelet-pods', readOnly: true }], securityContext: { runAsUser: 0, readOnlyRootFilesystem: true, allowPrivilegeEscalation: false, capabilities: { add: ['SYS_PTRACE', 'DAC_READ_SEARCH'] } } }] }, status: { ...originalProbe['status'] as object, containerStatuses: [{ name: 'probe', containerID: 'containerd://' + 'a'.repeat(64), imageID: 'probe@sha256:' + 'b'.repeat(64), ready: true, state: { running: {} } }] } });
  const handler = createFilesystemMetricsHandler({ token: f.options.probeToken, roots: { local: f.root }, podWorkspaceRoot: kubelet, procRoot: proc.root, buildkitTemplateRoot: join(f.root, 'template') });
  const fetcher = (async (url, init) => handler(new Request(String(url), init))) as typeof fetch;
  const options = { k8s: f.k8s, systemNamespace: 'system', probePort: 8095, probeToken: f.options.probeToken, project: () => project, resources: () => ({ list: async () => [], projectDeletion: resourceDeletion }), cluster: () => cluster, fetch: fetcher };
  const installWork = async (mode: 'release' | 'runtime-environment') => {
    const labels = { 'app.kubernetes.io/managed-by': 'crewstation', [mode === 'release' ? 'crewstation.io/release' : 'crewstation.io/image-build']: consumerId };
    await f.k8s.apply({ apiVersion: 'batch/v1', kind: 'Job', metadata: { name: 'builder', namespace: 'project', uid: controllerUid, labels }, spec: { original: 'producer' } });
    await f.k8s.apply({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'credential', namespace: 'project', uid: credentialUid, labels }, data: { token: 'private-original' } });
    await f.k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'work', namespace: 'project', uid: workUid, ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'builder', uid: controllerUid, controller: true }] }, spec: { nodeName: 'node', volumes: [{ name: 'work', emptyDir: {} }], containers: [{ name: 'builder' }] } });
    await mkdir(join(kubelet, workUid, 'volumes/kubernetes.io~empty-dir/work'), { recursive: true }); await writeFile(join(kubelet, workUid, 'volumes/kubernetes.io~empty-dir/work/result'), 'private-work');
  };
  const cache = await nativeCache(f);
  const buildOptions: BuildKitWorkOptions = { ...options, db: db!, installation: f.options, registryBase: 'registry:5000', scm: () => ({ getBinding: async () => { throw Error('empty original SCM input unexpectedly read'); } }), gitlab: {} as BuildKitWorkOptions['gitlab'], controlTransport: cache.transport };
  return { ...f, options, buildOptions, proc, pid, calls, target, context, consumerId, controllerUid, credentialUid, workUid, kubelet, containerId, installWork, cache,
    callback: { nodeUid: f.ids['node']!, nodeName: 'node', podUid: workUid, containerId } };
}
async function nativeCache(f: Awaited<ReturnType<typeof buildKitSourceFixture>>) {
  const created = Buffer.from('010000000ee24f294d1038f2cbffff', 'hex'), zero = Buffer.alloc(0), ref = 'd'.repeat(25);
  const bytes = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { digest: blobDigest, size: 12 }, layers: [{ digest: blobDigest, size: 12 }] }), manifest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(f.volume, 'runc-overlayfs/content/blobs/sha256', manifest.slice(7)), bytes);
  let used = true, history = true; const methods: string[] = [];
  const metadata = async () => {
    const content = (digests: string[]) => [{ key: 'blob', value: digests.map(key => ({ key, value: [{ key: 'createdat', value: created }, { key: 'updatedat', value: created }, { key: 'size', value: Buffer.from([24]) }] })) }, { key: 'ingests', value: [] }];
    await writeFile(join(f.volume, 'runc-overlayfs/containerdmeta.db'), boltSnapshotFixture([{ key: 'v1', value: [{ key: 'version', value: Buffer.from([5]) }, { key: 'buildkit', value: [{ key: 'content', value: content(used ? [blobDigest] : []) }, { key: 'leases', value: used ? [{ key: cacheId, value: [{ key: 'createdat', value: created }, { key: 'content', value: [{ key: blobDigest, value: zero }] }] }] : [] }] }, { key: 'buildkit_history', value: [{ key: 'content', value: content(history ? [manifest] : []) }, { key: 'leases', value: history ? [{ key: 'ref_' + ref, value: [{ key: 'createdat', value: created }, { key: 'content', value: [{ key: manifest, value: zero }] }] }] : [] }] }] }]));
  };
  await metadata(); await mkdir(join(f.root, 'template')); await writeFile(join(f.root, 'template/Dockerfile'), 'FROM scratch');
  const transport: NonNullable<BuildKitWorkOptions['controlTransport']> = url => async (method, body, signal) => {
    methods.push(method); const rpc = f.transport(url);
    if (method === 'DiskUsage') return used ? rpc(method, body, signal) : [protoMessage([])];
    if (method === 'ListenBuildHistory') {
      if (!history) return [];
      const frame = (await rpc(method, body, signal))[0]!, fields = protoFields(frame), original = fields.find(row => row.number === 2)!.value as Uint8Array;
      const descriptor = protoMessage([{ number: 1, value: 'application/vnd.oci.image.manifest.v1+json' }, { number: 2, value: manifest }, { number: 3, value: BigInt(Buffer.byteLength(bytes)) }]);
      return [protoMessage([{ number: 1, value: 1n }, { number: 2, value: Buffer.concat([original, protoMessage([{ number: 10, value: protoMessage([{ number: 1, value: descriptor }]) }])]) }])];
    }
    if (method === 'UpdateBuildHistory') { if (protoText(protoFields(body), 1) !== ref) throw Error('wrong native history mutation'); history = false; await rm(join(f.volume, 'runc-overlayfs/content/blobs/sha256', manifest.slice(7))); await metadata(); return [protoMessage([])]; }
    if (method === 'Prune') { if (protoText(protoFields(body), 1) !== 'id==' + cacheId) throw Error('global or wrong native prune'); used = false; await writeFile(join(f.volume, 'runc-overlayfs/metadata_v2.db'), boltCacheFixture([])); await writeFile(join(f.volume, 'runc-overlayfs/snapshots/metadata.db'), boltSnapshotFixture([{ key: 'v1', value: [{ key: 'snapshots', value: [] }] }])); await rm(join(f.volume, 'runc-overlayfs/snapshots/snapshots/134'), { recursive: true }); await rm(join(f.volume, 'runc-overlayfs/content/blobs/sha256', blobDigest.slice(7))); await metadata(); return [protoMessage([{ number: 1, value: cacheId }, { number: 4, value: 12n }])]; }
    return rpc(method, body, signal);
  };
  return { transport, methods, manifest };
}
