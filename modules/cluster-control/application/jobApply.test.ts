import { expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import type { ObservedObject } from '../domain/observation';
import type { ClusterWriter, ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import { applyJob } from './jobApply';
import { newObservationStats } from './observeChange';

const children = [{ kind: 'Job', namespace: 'cs-demo', name: 'migrate-r1' }, { kind: 'Secret', namespace: 'cs-demo', name: 'migrate-r1-env' }];
const job = { releaseId: 'r1', purpose: 'migration', image: 'app:1', command: ['bun', 'migrate'], env: {}, resources: { cpu: '500m', memory: '512Mi' }, activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 3600, envSecret: 'migrate-r1-env' };
const record = (conditions: LedgerRecordView['conditions'] = [], spec: LedgerRecordView['spec'] = { children, job }): LedgerRecordView => ({ id: 'job-1', kind: 'migration-job', desired: 'present', generation: 1, phase: 'provisioning', children: [], conditions, spec });

function harness(objects: Readonly<Record<string, ObservedObject>> = {}) {
  const calls: string[] = [], warns: string[] = [];
  const feed = { cached: (kind: string, namespace?: string, name?: string) => objects[`${kind}/${namespace}/${name}`] } as unknown as ManagedObjectFeed;
  const cluster = {
    remove: async (target: { kind: string; name: string; uid: string }) => { calls.push(`remove:${target.kind}/${target.name}:${target.uid}`); },
    ensureJobSecret: async (_job: unknown, values: () => Promise<Record<string, string>>) => { calls.push(`secret:${Object.keys(await values()).join(',')}`); return { uid: 'u-s', created: true }; },
    ensureJob: async () => { calls.push('job'); return { uid: 'u-j', created: true }; },
  } as unknown as ClusterWriter;
  const ledger = { observeConditions: async (_id: string, conditions: readonly { type: string; status: string }[]) => { calls.push(`condition:${conditions[0]!.type}=${conditions[0]!.status}`); return { status: 'recorded' as const }; } } as unknown as LedgerObservations;
  const jobs = { jobEnvValues: async (ref: { purpose: string }) => { calls.push(`asked:${ref.purpose}`); return { CS_DATABASE_URL: 'x' }; } };
  const deps = { ledger, feed, cluster, stats: newObservationStats(), logger: { ...noopLogger, warn: (msg: string) => { warns.push(msg); } }, jobs };
  return { deps, calls, warns };
}

test('建：先建凭据 Secret（建时要值）再建 Job，写 Created；旧形状不碰，期望不完整只告警，没接 release 不建', async () => {
  const h = harness();
  await applyJob(h.deps, record());
  expect(h.calls).toEqual(['asked:migration', 'secret:CS_DATABASE_URL', 'job', 'condition:Created=true']);
  expect(h.deps.stats.applied).toBe(2);
  const idle = harness();
  await applyJob(idle.deps, record([], { children: children.slice(0, 1) }));
  await applyJob(idle.deps, record([], { children, job: { ...job, command: [] } }));
  await applyJob({ ...idle.deps, jobs: undefined }, record());
  expect(idle.calls).toEqual([]);
  expect(idle.warns).toEqual(['resource job spec incomplete']);
});

test('建过就不再建：观测到 Job 补记已建；记过已建、Job 没了（TTL、被删）不补建', async () => {
  const running = harness({ 'Job/cs-demo/migrate-r1': { kind: 'Job', metadata: { name: 'migrate-r1', uid: 'u-j' } } });
  await applyJob(running.deps, record());
  expect(running.calls).toEqual(['condition:Created=true']);
  const gone = harness();
  await applyJob(gone.deps, record([{ type: 'Created', status: 'true' }]));
  expect(gone.calls).toEqual([]);
});

test('结束了或流水线已放弃：删凭据 Secret（删除中的不重复删）；建不成写原因后抛出', async () => {
  const secret = { kind: 'Secret', metadata: { name: 'migrate-r1-env', uid: 'u-s' } } as ObservedObject;
  const finished = harness({ 'Secret/cs-demo/migrate-r1-env': secret });
  await applyJob(finished.deps, record([{ type: 'Finished', status: 'true' }]));
  expect(finished.calls).toEqual(['remove:Secret/migrate-r1-env:u-s']);
  const abandoned = harness({ 'Secret/cs-demo/migrate-r1-env': { ...secret, metadata: { ...secret.metadata, deletionTimestamp: '2026-09-24T09:00:00Z' } } });
  await applyJob(abandoned.deps, record([{ type: 'Failed', status: 'true' }]));
  expect(abandoned.calls).toEqual([]);
  const broken = harness();
  broken.deps.cluster.ensureJob = async () => { throw new Error('exceeded quota'); };
  expect(await applyJob(broken.deps, record()).then(() => 'ok', (error: Error) => error.message)).toBe('exceeded quota');
  expect(broken.calls.at(-1)).toBe('condition:Created=false');
});
