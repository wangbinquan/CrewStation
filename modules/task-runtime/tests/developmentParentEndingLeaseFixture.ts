import { DomainTopic } from '@crewstation/contracts';
import { claimJobs, enqueueJob } from '@crewstation/queue';
import type { ClaimedJob } from '@crewstation/queue';
import { sql } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import type { RepositoryScope } from '../ports/unitOfWork';
import { DEVELOPMENT_PARENT_ENDING_JOB_KIND } from '../ports/developmentParentEnding';
import { REBUILD_JOB_KIND } from '../ports/rebuilds';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { developmentParentEndingStorageFixture } from './developmentParentEndingStorageFixture';

export function endingCheckpoint() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
export async function waitForParentSqlLock(db: Executor, text: string, event: string): Promise<void> {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    const [row] = await db.execute<{ present: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event=${event} AND query LIKE ${'%' + text + '%'}) AS present`);
    if (row?.present) return;
    await db.execute(sql`SELECT pg_sleep(0.02)`);
  }
  throw new Error('actual PostgreSQL lock wait missing: ' + text);
}
export async function developmentParentEndingLeaseFixture(mode: 'ending' | 'rebuild', seconds = 120) {
  const f = await developmentParentEndingStorageFixture(), ending = await f.admit();
  const reference = mode === 'ending' ? ending.id : Bun.randomUUIDv7(), kind = mode === 'ending' ? DEVELOPMENT_PARENT_ENDING_JOB_KIND : REBUILD_JOB_KIND;
  const payload = mode === 'ending' ? { endingId: reference } : { requestId: reference };
  await enqueueJob(f.db, kind, payload, { dedupKey: reference });
  const [job] = await claimJobs(f.db, [kind], 'original-parent-lease-test', seconds, 1);
  if (!job) throw new Error('actual original queue claim missing');
  // Stage a real owner condition: the unchanged Task state alone is a no-op projection.
  const ledger = { ...f.ledger, within: (executor: object) => {
    const writer = f.ledger.within(executor);
    return { ...writer, declare: async (input: Parameters<typeof writer.declare>[0]) => {
      const record = await writer.declare(input);
      await writer.report(record.id, { conditions: [{ type: 'ParentEndingCommitFixture', status: 'unknown', message: reference }] });
      return record;
    } };
  } };
  const uow = drizzleUnitOfWork(f.db, { ledger });
  const authorize = (scope: RepositoryScope, identity: Pick<ClaimedJob, 'id' | 'fencingToken'> = job) => {
    const lease = { jobId: identity.id, fencingToken: identity.fencingToken };
    return mode === 'ending' ? scope.parentEnding!.lease.requireCurrent(lease, reference) : scope.parentEnding!.rebuildLease.requireCurrent(lease, reference);
  };
  const write = async (scope: RepositoryScope) => {
    const parent = (await scope.environments.getForUpdate(f.parent.id))!;
    await scope.environments.update({ ...parent, message: 'signed storage transaction', parentEnding: { version: 1, endingId: ending.id, epochHash: ending.epochHash, phase: 'children' } });
    await scope.parentEnding!.endings.progress(ending.id, 'admission-sealed', { phase: 'children', status: 'pending', afterChildId: null,
      progress: { storageOnly: true }, completionWitness: null, message: null, retryAt: new Date() }, new Date());
    await scope.parentEnding!.claims.insert(f.claim(ending.id));
    await scope.events.publish(DomainTopic.taskReleased, { occurredAt: new Date().toISOString(), traceId: f.parent.traceId,
      projectId: f.projectId, taskId: f.parent.id, kind: f.parent.kind, reason: 'user' });
  };
  const snapshot = async () => {
    const [events] = await f.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM platform_infra.domain_events`);
    return { parent: await f.uow.read.environments.getById(f.parent.id), resource: await f.resources.api.get(f.parent.id),
      ending: await f.endings.get(ending.id), claim: await f.claims.get(ending.id), events: events!.count };
  };
  return { ...f, ledger, ending, mode, reference, kind, job, uow, authorize, write, snapshot };
}
export type DevelopmentParentEndingLeaseFixture = Awaited<ReturnType<typeof developmentParentEndingLeaseFixture>>;
