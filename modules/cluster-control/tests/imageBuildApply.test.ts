import { expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import { createFakeK8sClient } from '@crewstation/k8s';
import { kubernetesClusterWriter } from '../adapters/k8s/managedObjects';
import { applyJob } from '../application/jobApply';
import { newObservationStats } from '../application/observeChange';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import type { ManagedObjectFeed } from '../ports/cluster';
import { imageBuildPlan } from './imageBuildFixture';

test('独立镜像 Job 由所属模块取凭据，只建一次；观测到已建后删除不会重执行', async () => {
  const plan = imageBuildPlan(), k8s = createFakeK8sClient(), conditions: Array<{ type: string; status: string }> = [], stats = newObservationStats();
  const record: LedgerRecordView = { id: plan.resourceId, kind: 'build-job', owner: { module: 'runtime-environment', ref: plan.buildId }, projectId: plan.projectId, desired: 'present', generation: 1, phase: 'pending', conditions, children: [], spec: { children: [{ kind: 'Job', namespace: plan.namespace, name: plan.name }, { kind: 'Secret', namespace: plan.namespace, name: plan.secret }], runtimeImageBuild: plan } };
  let reads = 0;
  const deps = { logger: noopLogger, stats, cluster: kubernetesClusterWriter(k8s),
    feed: { cached: () => undefined } as unknown as ManagedObjectFeed,
    ledger: { get: async () => record, observeConditions: async (_id: string, values: Array<{ type: string; status: string }>) => { conditions.push(...values); } } as unknown as LedgerObservations,
    jobs: { jobEnvValues: async () => { throw new Error('独立镜像不能借用 release 的凭据'); }, imageBuildSecretValues: async (ref: { buildId: string; executionEpoch: number }) => { expect(ref).toMatchObject({ buildId: plan.buildId, executionEpoch: 1 }); reads++; return { 'git-token': 't', 'docker-config': '{}' }; } },
  };
  await applyJob(deps, record);
  expect(reads).toBe(1); expect(stats.applied).toBe(2); expect(conditions).toContainEqual({ type: 'Created', status: 'true' });
  k8s.objects.clear(); await applyJob(deps, record);
  expect(k8s.objects.size).toBe(0); expect(reads).toBe(1);
  await applyJob(deps, { ...record, owner: { module: 'release', ref: 'wrong' }, conditions: [] });
  expect(k8s.objects.size).toBe(0);
});
