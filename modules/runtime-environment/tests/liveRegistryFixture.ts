import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { createManagedRuntimeEnvironmentModule } from '../wiring';
import { runtimeImageFixture } from './runtimeImageFixture';

/** Opt-in reads from a real registry; all catalog writes stay in an isolated test database. */
export async function liveRegistryFixture(url: string, reference: string, architecture: string) {
  const f = await runtimeImageFixture();
  try {
    const endpoint = new URL(url);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/') throw new Error('Registry acceptance URL must be a plain HTTP(S) origin');
    const layout = { pullBase: endpoint.host, pushHost: endpoint.host, scheme: endpoint.protocol === 'http:' ? 'http' as const : 'https' as const };
    const source = CreateRuntimeImageRevisionSchema.parse({ source: { kind: 'existing', reference, architecture, usage: 'service' } });
    const repository = reference.split('@')[0]!.replace(/:[^/]*$/, '');
    let sideEffects = 0;
    const forbiddenEffect = async (): Promise<never> => { sideEffects++; throw new Error('Existing image registration must not create build resources or credentials'); };
    const limits = { cpu: '100m', memory: '128Mi', ephemeralStorage: '1Gi' };
    const module = createManagedRuntimeEnvironmentModule({
      db: f.tdb.db, isAdmin: async () => true, authorizer: { authorize: async () => {} },
      validationContracts: { fingerprint: async () => `sha256:${'f'.repeat(64)}` },
      limits: { platformBuilds: 2, projectBuilds: 1, buildTimeoutSeconds: 600, logRetentionSeconds: 60, logMaxBytes: 1024 },
      k8s: createFakeK8sClient(), registry: layout, instance: 'live-registry-acceptance',
      ledger: { get: async () => undefined, within: () => ({ declare: forbiddenEffect, requestRelease: forbiddenEffect }) },
      leases: { acquire: forbiddenEffect, renew: forbiddenEffect, release: forbiddenEffect },
      builder: { clientImage: 'unused', builderImage: 'unused', registryBase: layout.pullBase, pushHost: layout.pushHost, pushInsecure: false, builderResources: limits, clientResources: limits, workspaceSize: '1Gi', cacheSize: '1Gi' },
      bases: { resolve: async () => undefined }, sourceRepository: { resolve: forbiddenEffect, readFile: forbiddenEffect },
      existingImageAccess: async () => ({ exact: [repository] }), buildContext: forbiddenEffect, assertBuildIsolation: forbiddenEffect,
      credentials: { issueGit: forbiddenEffect, revokeGit: forbiddenEffect, push: forbiddenEffect, packages: forbiddenEffect },
    });
    return { ...f, api: module.api, source, layout, repository, sideEffects: () => sideEffects };
  } catch (error) { await f.tdb.drop(); throw error; }
}
