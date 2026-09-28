import { SQL } from 'bun';
import type { Fence } from './client';
import type { RecoveryRequest } from './recovery';

export class Store {
  readonly db: SQL;
  constructor(url: string) { this.db = new SQL(url); }
  async migrate(): Promise<void> {
    await this.db`CREATE TABLE IF NOT EXISTS execution_sample_control (id integer PRIMARY KEY CHECK(id=1), epoch bigint NOT NULL, owner text, phase text NOT NULL, expires_at timestamptz)`;
    await this.db`CREATE TABLE IF NOT EXISTS execution_sample_requests (request_key text PRIMARY KEY, digest text NOT NULL, response jsonb)`;
    await this.db`CREATE TABLE IF NOT EXISTS execution_sample_recovery (request_id text PRIMARY KEY, request jsonb NOT NULL, response jsonb)`;
    await this.db`CREATE TABLE IF NOT EXISTS execution_sample_log_state (task_id text PRIMARY KEY, cursor text, pending_key text, complete boolean NOT NULL DEFAULT true, sealed boolean NOT NULL DEFAULT false, sealed_key text, manifest jsonb)`;
    await this.db`CREATE TABLE IF NOT EXISTS execution_sample_log_chunks (request_key text PRIMARY KEY, task_id text NOT NULL, draft jsonb NOT NULL)`;
  }
  async ready(): Promise<boolean> { try { await this.db`SELECT epoch FROM execution_sample_control LIMIT 1`; return true; } catch { return false; } }
  async prepare(epoch: number, owner: string | null, phase: 'preparing' | 'active' | 'frozen', expiresAt: string | null): Promise<void> {
    const rows = await this.db`INSERT INTO execution_sample_control(id,epoch,owner,phase,expires_at) VALUES(1,${epoch},${owner},${phase},${expiresAt})
      ON CONFLICT(id) DO UPDATE SET epoch=EXCLUDED.epoch,owner=EXCLUDED.owner,phase=EXCLUDED.phase,expires_at=EXCLUDED.expires_at
      WHERE execution_sample_control.epoch < EXCLUDED.epoch OR (execution_sample_control.epoch=EXCLUDED.epoch AND execution_sample_control.owner IS NOT DISTINCT FROM EXCLUDED.owner)
      RETURNING epoch`;
    if (!rows.length) throw new Error('应用数据库拒绝旧世代或旧实例');
  }
  async read(key: string): Promise<unknown> { return (await this.db`SELECT response FROM execution_sample_requests WHERE request_key=${key}`)[0]?.response; }
  async guard<T>(fence: Fence, run: (tx: SQL) => Promise<T>): Promise<T> {
    return this.db.begin(async (tx) => {
      const rows = await tx`SELECT epoch FROM execution_sample_control WHERE id=1 AND epoch=${fence.epoch} AND owner=${fence.instanceId}
        AND phase='active' AND expires_at > clock_timestamp() FOR UPDATE`;
      if (!rows.length) throw new Error('应用写屏障关闭或执行租约失效');
      return run(tx as SQL);
    });
  }
  async admit(key: string, digest: string, fence: Fence): Promise<unknown> {
    return this.guard(fence, async (tx) => {
      await tx`INSERT INTO execution_sample_requests(request_key,digest) VALUES(${key},${digest}) ON CONFLICT DO NOTHING`;
      const row = (await tx`SELECT digest,response FROM execution_sample_requests WHERE request_key=${key}`)[0]!;
      if (row.digest !== digest) throw new Error('幂等键已用于不同动作');
      return row.response;
    });
  }
  async record(key: string, response: unknown, fence: Fence): Promise<void> {
    await this.guard(fence, async (tx) => { await tx`UPDATE execution_sample_requests SET response=${response}::jsonb WHERE request_key=${key}`; });
  }
  async admitRecovery(request: RecoveryRequest, fence: Fence): Promise<unknown> {
    return this.guard(fence, async (tx) => {
      await tx`INSERT INTO execution_sample_recovery(request_id,request) VALUES(${request.id},${request}::jsonb) ON CONFLICT DO NOTHING`;
      const row = (await tx`SELECT response, request->'target' = ${request.target}::jsonb AS matches FROM execution_sample_recovery WHERE request_id=${request.id}`)[0]!;
      if (!row.matches) throw new Error('恢复请求内容已变化');
      return row.response;
    });
  }
  async recordRecovery(id: string, response: unknown, fence: Fence): Promise<void> {
    await this.guard(fence, async (tx) => { await tx`UPDATE execution_sample_recovery SET response=${response}::jsonb WHERE request_id=${id}`; });
  }
}
