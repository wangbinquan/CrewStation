import { and, asc, eq, isNotNull, isNull, lte, ne, notExists, or, sql } from 'drizzle-orm';
import type { TaskId } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import type { Clock } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import { conflict, jsonHash } from '@crewstation/kernel';
import { DEVELOPMENT_ENDING_BATCH, DevelopmentEndingJobSchema, developmentEndingDeadline, mergeDevelopmentEnding } from '../../../domain/developmentEnding';
import type { DevelopmentEndingEvidence, DevelopmentEndingLease } from '../../../domain/developmentEnding';
import type { DevelopmentEndingStore } from '../../../ports/developmentEnding';
import { developmentAgentUsage as owners } from '../developmentUsageTable';
import { developmentAgentEndings as table } from './tables';
import { withEndingTransaction } from './transaction';
import { requestDevelopmentEndingJob } from './requests';

const instant = (raw: string) => { const value = new Date(raw); if (!Number.isFinite(value.getTime())) throw new Error('Invalid ending clock'); return value.toISOString(); };
const due = (now: string) => and(ne(table.stage, 'evidence-complete'), or(isNull(table.leaseUntil), lte(table.leaseUntil, now)));
function matches(lease: DevelopmentEndingLease, job: DevelopmentEndingLease['job'] | undefined, now: string): boolean {
  return !!job && job.version === lease.job.version && job.fence === lease.job.fence && !!job.leaseUntil && job.leaseUntil > now;
}
function commitEnding(db: Database, clock: Clock, lease: DevelopmentEndingLease, evidence: DevelopmentEndingEvidence) {
  instant(evidence.observedAt); // Evidence observation is distinct from the authoritative lease clock.
  return withEndingTransaction(db, lease.job.executionTaskId, async ({ tx, original, job }) => {
    const now = instant(clock.now().toISOString()); // AFTER every original owner/AgentStart/job row lock.
    if (!matches(lease, job, now)) return undefined;
    if (!original.binding || jsonHash(original.binding) !== jsonHash(lease.registration)) throw conflict('结束租约原绑定不匹配');
    const merged = mergeDevelopmentEnding(job!, original.binding, evidence);
    const changed = jsonHash({ stop: merged.stop, closure: merged.closure, logicalResult: merged.logicalResult }) !== jsonHash({ stop: job!.stop, closure: job!.closure, logicalResult: job!.logicalResult });
    const next = DevelopmentEndingJobSchema.parse({ ...merged, leaseUntil: null, version: job!.version + (changed ? 1 : 0) });
    await tx.update(table).set(next).where(eq(table.executionTaskId, next.executionTaskId)); return next;
  });
}
export function developmentEndingStore(db: Database, clock: Clock = systemClock): DevelopmentEndingStore {
  return {
    request: (input) => requestDevelopmentEndingJob(db, input),
    get: async (id) => { const row = (await db.select().from(table).where(eq(table.executionTaskId, id)))[0]; return row ? DevelopmentEndingJobSchema.parse(row) : undefined; },
    listPending: async (raw) => (await db.select({ id: table.executionTaskId }).from(table).where(due(instant(raw))).orderBy(asc(table.lastAttemptAt), asc(table.executionTaskId)).limit(DEVELOPMENT_ENDING_BATCH)).map((r) => r.id as TaskId),
    claim: (id, raw) => withEndingTransaction(db, id, async ({ tx, original, job }) => {
      instant(raw); const now = instant(clock.now().toISOString());
      if (!job || job.stage === 'evidence-complete' || (job.leaseUntil && job.leaseUntil > now)) return undefined;
      const next = DevelopmentEndingJobSchema.parse({ ...job, fence: job.fence + 1, lastAttemptAt: now, leaseUntil: developmentEndingDeadline(now) });
      await tx.update(table).set(next).where(eq(table.executionTaskId, id)); return { job: next, registration: original.binding };
    }),
    commit: (lease, evidence) => commitEnding(db, clock, lease, evidence),
    retry: (lease, raw) => withEndingTransaction(db, lease.job.executionTaskId, async ({ tx, job }) => {
      instant(raw); if (!matches(lease, job, instant(clock.now().toISOString()))) return false;
      await tx.update(table).set({ leaseUntil: null }).where(eq(table.executionTaskId, job!.executionTaskId)); return true;
    }),
    takeRecoveryOwners: (raw) => db.transaction(async (tx) => {
      const now = instant(raw);
      const rows = await tx.select({ id: owners.executionTaskId }).from(owners).where(and(eq(owners.unsupported, false), isNotNull(owners.binding),
        notExists(tx.select({ id: table.executionTaskId }).from(table).where(eq(table.executionTaskId, owners.executionTaskId)))))
        .orderBy(asc(sql`coalesce(${owners.endingCheckedAt}, ${owners.acceptedAt})`), asc(owners.executionTaskId)).limit(DEVELOPMENT_ENDING_BATCH).for('update', { skipLocked: true }); // Sole outer FROM is owner; the ending NOT EXISTS does not acquire ending row locks.
      for (const row of rows) await tx.update(owners).set({ endingCheckedAt: now }).where(eq(owners.executionTaskId, row.id));
      return rows.map((row) => row.id as TaskId);
    }),
  };
}
