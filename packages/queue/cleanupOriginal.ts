import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { OriginalJobSelection } from './claimOriginal';
import type { ClaimedJob } from './jobs';
import { parseJsonColumn, rowsOf } from './jobs';

/** Private cleanup resumes an existing delivery atomically; it never enqueues a replacement task. */
export async function claimOriginalCleanupJob(executor: Executor, selection: OriginalJobSelection, owner: string, leaseSeconds: number): Promise<ClaimedJob | undefined> {
  if (!selection.kind || !selection.dedupKey || !owner || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1)
    throw precondition('原清理作业缺少完整选择或有效租约');
  const rows = rowsOf<{ id: number; kind: string; payload: unknown; attempts: number; max_attempts: number; fencing_token: number }>(await executor.execute(sql`
    UPDATE platform_infra.jobs SET state='running',lease_owner=${owner},
      lease_until=clock_timestamp()+make_interval(secs=>${leaseSeconds}),fencing_token=fencing_token+1,
      attempts=attempts+1,updated_at=clock_timestamp()
    WHERE id IN(SELECT j.id FROM platform_infra.jobs j WHERE j.kind=${selection.kind} AND j.dedup_key=${selection.dedupKey}
      AND j.id=(SELECT max(original.id) FROM platform_infra.jobs original WHERE original.kind=j.kind AND original.dedup_key=j.dedup_key)
      AND j.payload=${JSON.stringify(selection.payload ?? null)}::jsonb
      AND(j.state IN('pending','done','dead') OR(j.state='running' AND j.lease_until<clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM platform_infra.jobs busy WHERE busy.kind=j.kind AND busy.dedup_key=j.dedup_key
        AND busy.state='running' AND busy.lease_until>=clock_timestamp())
      FOR UPDATE SKIP LOCKED)
    RETURNING id,kind,payload,attempts,max_attempts,fencing_token`));
  const row = rows[0];
  return row ? { id: Number(row.id), kind: row.kind, payload: parseJsonColumn(row.payload), attempts: row.attempts,
    maxAttempts: row.max_attempts, fencingToken: Number(row.fencing_token) } : undefined;
}
