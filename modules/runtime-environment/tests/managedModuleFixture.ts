import { createFakeK8sClient } from '@crewstation/k8s';
import { createManagedRuntimeEnvironmentModule } from '../wiring';
import type { BuildResourceRecord, RuntimeBuildLedger } from '../ports/buildLedger';
import { runtimeImageFixture } from './runtimeImageFixture';

function registryFixture() {
  const objects = new Map<string, string>(), calls: string[] = [];
  const add = (kind: string, value: unknown) => {
    const text = JSON.stringify(value), digest = `sha256:${new Bun.CryptoHasher('sha256').update(text).digest('hex')}`;
    objects.set(`${kind}/${digest}`, text); return digest;
  };
  const layer = `sha256:${'a'.repeat(64)}`;
  const config = add('blobs', { os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [layer] }, config: { User: '10001', Cmd: ['sh'] } });
  const digest = add('manifests', { schemaVersion: 2, config: { digest: config, mediaType: 'application/vnd.oci.image.config.v1+json', size: 100 }, layers: [{ digest: layer, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', size: 1 }] });
  objects.set('manifests/v1', objects.get(`manifests/${digest}`)!);
  const fetcher = (async (input) => {
    const path = decodeURIComponent(new URL(String(input)).pathname); calls.push(path);
    const key = path.match(/\/(manifests|blobs)\/(.+)$/), body = key ? objects.get(`${key[1]}/${key[2]}`) : undefined;
    return new Response(body ?? '', { status: body ? 200 : 404 });
  }) as typeof fetch;
  return { digest, calls, fetcher };
}

export async function managedModuleFixture() {
  const f = await runtimeImageFixture(), registry = registryFixture(), resources = new Map<string, BuildResourceRecord>();
  const revoked: string[] = [], issued: string[] = [], reads: string[] = [];
  let isolated = true, base = 'registry.internal:5000/platform/task:v1';
  const ledger: RuntimeBuildLedger = {
    get: async (id) => resources.get(id),
    within: () => ({
      declare: async (input) => { const record = { ...input, desired: 'present' as const, phase: 'queued', children: [], conditions: [] }; resources.set(input.id, record); return record; },
      requestRelease: async (id) => { const record = { ...resources.get(id)!, desired: 'absent' as const }; resources.set(id, record); return record; },
    }),
  };
  const savedFetch = globalThis.fetch;
  globalThis.fetch = registry.fetcher;
  try {
    const limits = { cpu: '1', memory: '512Mi', ephemeralStorage: '1Gi' };
    const mod = createManagedRuntimeEnvironmentModule({
      db: f.tdb.db, clock: { now: () => new Date('2026-09-27T00:00:00Z') }, isAdmin: async () => true,
      authorizer: { authorize: async () => {} }, validationContracts: { fingerprint: async () => registry.digest },
      limits: { platformBuilds: 2, projectBuilds: 1, buildTimeoutSeconds: 600, logRetentionSeconds: 60, logMaxBytes: 1024 },
      k8s: createFakeK8sClient(), ledger, leases: { acquire: async () => true, renew: async () => true, release: async () => {} }, instance: 'test',
      registry: { pullBase: 'registry.internal:5000', pushHost: 'registry.example', scheme: 'http' },
      builder: { clientImage: 'client:test', builderImage: 'builder:rootless', registryBase: 'registry.internal:5000', pushHost: 'registry.example', pushInsecure: false, builderResources: limits, clientResources: limits, workspaceSize: '1Gi', cacheSize: '1Gi' },
      bases: { resolve: async (_a, _p, source) => source.usage === 'service' ? undefined : base },
      sourceRepository: {
        resolve: async () => ({ commitSha: 'b'.repeat(40), tree: [{ path: 'Dockerfile', mode: '100644', type: 'blob' }] }),
        readFile: async (_binding, sha, path) => { reads.push(`${sha}/${path}`); return 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}\n'; },
      },
      existingImageAccess: async () => ({ prefixes: [`runtime/projects/${f.project}`] }),
      buildContext: async () => ({ namespace: 'cs-example', slug: 'example', repositoryUrl: 'https://git.example/repo.git' }),
      assertBuildIsolation: async () => { if (!isolated) throw new Error('registry isolation unavailable'); },
      credentials: {
        issueGit: async (build) => { issued.push(build.id); return { id: `git-${issued.length}`, token: 'git-secret' }; },
        revokeGit: async (_revision, id) => { revoked.push(id); },
        push: async (build) => ({ host: 'registry.example', username: build.id, password: 'push-secret' }), packages: async () => ({}),
      },
    });
    return { ...f, ...mod, registry, resources, issued, revoked, reads, isolate: (value: boolean) => { isolated = value; }, base: (value: string) => { base = value; } };
  } finally { globalThis.fetch = savedFetch; }
}
