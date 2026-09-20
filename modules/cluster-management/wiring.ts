import { join } from 'node:path';
import type { UserId } from '@crewstation/contracts';
import type { K8sClient } from '@crewstation/k8s';
import type { Clock, Logger } from '@crewstation/kernel';
import { noopLogger, systemClock } from '@crewstation/kernel';
import type { Database, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';
import { createWorker } from '@crewstation/queue';
import type { ClusterMetadata, DomainOperations } from './ports/cluster';
import type { SystemComponent } from './domain/inventory';
import { kubernetesClusterReader } from './adapters/k8s/clusterReader';
import { drizzleClusterRepository, CLUSTER_OPERATION, CLUSTER_REFRESH } from './adapters/persistence/drizzleRepository';
import { clusterApi } from './application/moduleApi';
import { collectSnapshot } from './application/collection';
import { executeOperation } from './application/executeOperation';
import { clusterRoutes } from './http/clusterRoutes';
export interface ClusterManagementModuleDeps { db: Database; k8s: K8sClient; metadata: ClusterMetadata; domains: DomainOperations; isAdmin(id: UserId): Promise<boolean>; systemNamespace: string; catalog: SystemComponent[]; instance: string; logger?: Logger; clock?: Clock; wait?: (ms: number) => Promise<void>; observationMs?: number }
export const clusterManagementMigrations: MigrationSet = { module: 'cluster-management', layer: 6, files: readMigrationDir(join(import.meta.dir, 'adapters/persistence/migrations')) };
export function createClusterManagementModule(input: ClusterManagementModuleDeps) {
  const repository = drizzleClusterRepository(input.db), logger = input.logger ?? noopLogger;
  const deps = { ...input, repository, cluster: kubernetesClusterReader(input.k8s), clock: input.clock ?? systemClock, wait: input.wait ?? ((ms: number) => Bun.sleep(ms)), observationMs: input.observationMs ?? 300_000 };
  const api = clusterApi(deps); let abort = new AbortController();
  const worker = createWorker({ db: input.db, owner: `${input.instance}.cluster`, kinds: [CLUSTER_REFRESH, CLUSTER_OPERATION], concurrency: 2, leaseSeconds: 60, logger, handler: async (job, ctx) => {
    const payload = job.payload as { operationId?: string; requestId?: string; resumeCount?: number };
    if (job.kind === CLUSTER_OPERATION) await executeOperation(deps, payload.operationId!, job.fencingToken, ctx.heartbeat, payload.resumeCount ?? 0);
    else {
      const attempt = new AbortController();
      const lease = setInterval(() => { void ctx.heartbeat().then((ok) => { if (!ok) attempt.abort(); }).catch(() => attempt.abort()); }, 15_000);
      try { await collectSnapshot(deps, AbortSignal.any([abort.signal, attempt.signal, AbortSignal.timeout(120_000)])); await repository.finishRefresh(payload.requestId!); } finally { clearInterval(lease); }
    }
  } });
  let timer: ReturnType<typeof setInterval> | undefined;
  const request = () => { void repository.requestRefresh().catch((error: unknown) => logger.warn('cluster refresh request failed', { error: String(error) })); };
  const lifecycle = { start: () => { abort = new AbortController(); worker.start(); request(); timer ??= setInterval(request, 30_000); }, stop: async () => { if (timer) clearInterval(timer); timer = undefined; abort.abort(); await worker.stop(); } };
  return { api, http: [clusterRoutes(api, input.isAdmin)], workers: [lifecycle], migrations: clusterManagementMigrations, collect: (signal = new AbortController().signal) => collectSnapshot(deps, AbortSignal.any([signal, AbortSignal.timeout(120_000)])), runOnce: worker.runOnce };
}
export type ClusterManagementModule = ReturnType<typeof createClusterManagementModule>;
