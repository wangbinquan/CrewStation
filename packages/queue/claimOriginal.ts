import { sql } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import { precondition } from '@crewstation/kernel';
import type { ClaimedJob } from './jobs';
import { parseJsonColumn, rowsOf } from './jobs';

export interface OriginalJobSelection {
  readonly kind: string;
  readonly dedupKey: string;
  readonly payload: unknown;
}

/** A deletion owner may resume only its exact original delivery, using the ordinary durable job fence. */
export async function claimOriginalJob(executor: Executor, selection: OriginalJobSelection, owner: string, leaseSeconds: number): Promise<ClaimedJob | undefined> {
  if (!selection.kind || !selection.dedupKey || !owner || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1)
    throw precondition('原作业认领缺少完整选择或有效租约');
  const rows = rowsOf<{ id: number; kind: string; payload: unknown; attempts: number; max_attempts: number; fencing_token: number }>(await executor.execute(sql`
    UPDATE platform_infra.jobs SET state='running',lease_owner=${owner},
      lease_until=clock_timestamp()+make_interval(secs=>${leaseSeconds}),fencing_token=fencing_token+1,
      attempts=attempts+1,updated_at=clock_timestamp()
    WHERE id IN(SELECT id FROM platform_infra.jobs WHERE kind=${selection.kind} AND dedup_key=${selection.dedupKey}
      AND payload=${JSON.stringify(selection.payload ?? null)}::jsonb AND run_at<=clock_timestamp()
      AND(state='pending' OR(state='running' AND lease_until<clock_timestamp()))
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id,kind,payload,attempts,max_attempts,fencing_token`));
  const row = rows[0];
  return row ? { id: Number(row.id), kind: row.kind, payload: parseJsonColumn(row.payload), attempts: row.attempts,
    maxAttempts: row.max_attempts, fencingToken: Number(row.fencing_token) } : undefined;
}
