import { eventbusMigrations } from '@crewstation/eventbus';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId } from '@crewstation/kernel';
import { queueMigrations } from '@crewstation/queue';
import type { MigrationSet } from '@crewstation/persistence';
import { kubernetesTaskCluster } from '../../adapters/k8s/taskCluster';
import { createTaskRuntimeModule } from '../../wiring';
import { runtimeWorkFixture } from './workFixture';

/** Actual factory, HTTP API and PG; K8s operations and public original identities are controlled. */
export async function runtimeWorkModuleFixture(
  configure?: (f: Awaited<ReturnType<typeof runtimeWorkFixture>>, k8s: ReturnType<typeof createFakeK8sClient>) => Promise<Partial<Parameters<typeof createTaskRuntimeModule>[0]>>,
  extra: MigrationSet[] = [],
) {
  const f = await runtimeWorkFixture([eventbusMigrations, queueMigrations, ...extra]), k8s = createFakeK8sClient(), reads: string[] = [];
  const profile = { id: newResourceId(), name: 'controlled-profile', description: '', cpu: '1', memory: '2Gi', storage: '2Gi' };
  const cluster = { ...kubernetesTaskCluster(k8s, 10001), podPhase: async (env: { id: string }) => { reads.push(env.id); return { phase: 'Running' as const }; } };
  const dependencies: Parameters<typeof createTaskRuntimeModule>[0] = { db: f.database.db, k8s, cluster, deletionWorkSources: f.sources,
    authorizer: { authorize: async () => undefined }, isAdmin: async () => true, quotas: { quotaLimit: async () => 4 },
    profiles: { getTaskProfile: async () => profile, listTaskProfiles: async () => [profile] },
    services: { resolveServiceById: async (id) => ({ projectId: id === f.otherService ? f.otherProject : f.project, slug: 'controlled-runtime', name: 'service', namespace: 'cs-controlled-runtime' }) },
    sources: { configEnv: async () => ({}), dataEnv: async () => ({}), taskDataEnv: async () => ({}) },
    settings: { taskImage: 'controlled:runtime', systemNamespace: 'crewstation-system', sessionUrl: 'ws://controlled-session/runner', userDomain: 'controlled.example',
      serviceDomain: 'controlled.internal', workerUid: 10001, defaultProfile: profile.id, userAuthMiddleware: 'forward-auth-user', dropIdentityHeadersMiddleware: 'drop-identity-headers' } };
  Object.assign(dependencies, await configure?.(f, k8s));
  const module = createTaskRuntimeModule(dependencies);
  const stop = () => Promise.all(module.workers.map((worker) => worker.stop()));
  return { ...f, module, dependencies, k8s, reads, stop, drop: async () => { await stop(); await f.drop(); } };
}
