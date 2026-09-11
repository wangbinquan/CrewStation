import { sql } from 'drizzle-orm';
import type { Executor, MigrationSet } from '@crewstation/persistence';
import { readMigrationDir } from '@crewstation/persistence';

export const queueMigrations: MigrationSet = {
  module: 'platform_infra.queue',
  layer: 0,
  files: readMigrationDir(new URL('./migrations', import.meta.url).pathname),
};

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  /** 同 kind 下处于 pending／running 的任务按此键去重。 */
  dedupKey?: string;
}

export interface ClaimedJob {
  id: number;
  kind: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  /** 每次租约递增；完成、失败、心跳都必须携带，过期租约的写入会被拒绝。 */
  fencingToken: number;
}

export async function enqueueJob(executor: Executor, kind: string, payload: unknown, options: EnqueueOptions = {}): Promise<{ id: number | null; deduplicated: boolean }> {
  const rows = rowsOf<{ id: number }>(await executor.execute(sql`
    INSERT INTO platform_infra.jobs (kind, payload, run_at, max_attempts, dedup_key)
    VALUES (${kind}, ${payload as Record<string, unknown>}, ${options.runAt ?? new Date()}, ${options.maxAttempts ?? 5}, ${options.dedupKey ?? null})
    ON CONFLICT (kind, dedup_key) WHERE dedup_key IS NOT NULL AND state IN ('pending', 'running') DO NOTHING
    RETURNING id`));
  const id = rows[0]?.id;
  return id === undefined ? { id: null, deduplicated: true } : { id: Number(id), deduplicated: false };
}

/** 租约认领：pending 或租约过期的 running 任务，SKIP LOCKED 保证多副本不互相阻塞。 */
export async function claimJobs(executor: Executor, kinds: string[], owner: string, leaseSeconds: number, limit: number): Promise<ClaimedJob[]> {
  const rows = rowsOf<{ id: number; kind: string; payload: unknown; attempts: number; max_attempts: number; fencing_token: number }>(await executor.execute(sql`
    UPDATE platform_infra.jobs SET state = 'running', lease_owner = ${owner},
      lease_until = now() + make_interval(secs => ${leaseSeconds}), fencing_token = fencing_token + 1,
      attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM platform_infra.jobs
      WHERE kind = ANY(ARRAY[${sql.join(kinds.map((k) => sql`${k}`), sql`, `)}]::text[]) AND run_at <= now()
        AND (state = 'pending' OR (state = 'running' AND lease_until < now()))
      ORDER BY run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, payload, attempts, max_attempts, fencing_token`));
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, payload: parseJsonColumn(r.payload), attempts: r.attempts, maxAttempts: r.max_attempts, fencingToken: Number(r.fencing_token) }));
}

export async function heartbeatJob(executor: Executor, id: number, fencingToken: number, leaseSeconds: number): Promise<boolean> {
  const rows = rowsOf(await executor.execute(sql`
    UPDATE platform_infra.jobs SET lease_until = now() + make_interval(secs => ${leaseSeconds}), updated_at = now()
    WHERE id = ${id} AND fencing_token = ${fencingToken} AND state = 'running' RETURNING id`));
  return rows.length === 1;
}

export async function completeJob(executor: Executor, id: number, fencingToken: number): Promise<boolean> {
  const rows = rowsOf(await executor.execute(sql`
    UPDATE platform_infra.jobs SET state = 'done', lease_until = NULL, updated_at = now()
    WHERE id = ${id} AND fencing_token = ${fencingToken} AND state = 'running' RETURNING id`));
  return rows.length === 1;
}

/** 失败：未达上限则按退避重排，否则标 dead。 */
export async function failJob(executor: Executor, job: ClaimedJob, error: string): Promise<'retry' | 'dead' | 'stale'> {
  const dead = job.attempts >= job.maxAttempts;
  const backoff = Math.min(300, 5 * 2 ** job.attempts) * (0.75 + Math.random() / 2);
  const rows = rowsOf(await executor.execute(sql`
    UPDATE platform_infra.jobs SET state = ${dead ? 'dead' : 'pending'}, last_error = ${error.slice(0, 2000)},
      run_at = now() + make_interval(secs => ${dead ? 0 : backoff}), lease_until = NULL, updated_at = now()
    WHERE id = ${job.id} AND fencing_token = ${job.fencingToken} AND state = 'running' RETURNING id`));
  if (rows.length !== 1) return 'stale';
  return dead ? 'dead' : 'retry';
}

export async function getJobState(executor: Executor, id: number): Promise<{ state: string; attempts: number; lastError: string | null } | undefined> {
  const rows = rowsOf<{ state: string; attempts: number; last_error: string | null }>(await executor.execute(sql`SELECT state, attempts, last_error FROM platform_infra.jobs WHERE id = ${id}`));
  const row = rows[0];
  return row ? { state: row.state, attempts: row.attempts, lastError: row.last_error } : undefined;
}

/** 驱动可能把 jsonb 作为字符串返回；统一在这里解析。 */
export function parseJsonColumn(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : []) as T[];
}
