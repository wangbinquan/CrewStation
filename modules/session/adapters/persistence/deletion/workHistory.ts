import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { SessionWorkCallbackSchema } from '../../../domain/deletion/work';
import type { SessionWorkCallback } from '../../../domain/deletion/work';

interface Row extends Record<string, unknown> {
  id: string; project_id: string | null; task_key: string; task_id: string; origin_revision: string; kind: string;
  reference: string; input_digest: string; backend_pid: number; original_process: unknown; deletion_grant: unknown;
  exit_key_hash: string; identity: string; exited_at: unknown; exit_digest: string | null; recovery_digest: string | null;
}
/** 全部原命令和清理尝试读到 EOF；pending 为空或 backend 消失都不替代原退出。 */
export async function sessionWorkHistory(db: Executor, projectId: ProjectId): Promise<SessionWorkCallback[]> {
  const callbacks: SessionWorkCallback[] = []; let after: string | null = null;
  for (;;) {
    const rows: Row[] = await db.execute<Row>(sql`SELECT * FROM session.original_callbacks WHERE project_id=${projectId}
      AND ${after === null ? sql`true` : sql`id COLLATE "C">${after} COLLATE "C"`} ORDER BY id COLLATE "C" LIMIT 200`);
    if (!rows.length) return callbacks;
    for (const row of rows) {
      callbacks.push(SessionWorkCallbackSchema.parse({ id: row.id, projectId: row.project_id, taskKey: row.task_key, taskId: row.task_id,
        originRevision: row.origin_revision, kind: row.kind, reference: row.reference, inputDigest: row.input_digest,
        backendPid: row.backend_pid, process: row.original_process, grant: row.deletion_grant, exitKeyDigest: row.exit_key_hash,
        identity: row.identity, exited: row.exited_at !== null, exitDigest: row.exit_digest, recoveryDigest: row.recovery_digest }));
      after = row.id;
    }
  }
}
