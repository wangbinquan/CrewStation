import type { ProjectId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { RuntimeWorkCallbackSchema } from '../../../domain/deletion/work';
import type { RuntimeWorkCallback } from '../../../domain/deletion/work';

export interface RuntimeCallbackRow extends Record<string, unknown> {
  id: string; project_id: string; origin_kind: string; origin_key: string; origin_id: string; kind: string;
  reference: string; consumer_id: string; input_digest: string; origin_revision: string; backend_pid: number;
  original_process: unknown; exit_key_hash: string; deletion_grant: unknown; exited_at: unknown; exit_digest: string | null; recovery_digest: string | null;
}
export function runtimeCallbackFromRow(row: RuntimeCallbackRow) {
  return RuntimeWorkCallbackSchema.parse({ id: row.id, projectId: row.project_id, originKind: row.origin_kind,
    originKey: row.origin_key, originId: row.origin_id, kind: row.kind, reference: row.reference, consumerId: row.consumer_id,
    inputDigest: row.input_digest, originRevision: row.origin_revision, backendPid: row.backend_pid, process: row.original_process,
    exitKeyDigest: row.exit_key_hash, grant: row.deletion_grant, exited: row.exited_at !== null, exitDigest: row.exit_digest, recoveryDigest: row.recovery_digest });
}
/** Pending and terminal callbacks are traversed to EOF, never bounded by a scheduler page. */
export async function runtimeWorkHistory(db: Executor, project: ProjectId): Promise<RuntimeWorkCallback[]> {
  const history: RuntimeWorkCallback[] = []; let after: string | null = null;
  for (;;) {
    const rows: RuntimeCallbackRow[] = await db.execute<RuntimeCallbackRow>(sql`SELECT * FROM task_runtime.original_callbacks WHERE project_id=${project}
      AND ${after === null ? sql`true` : sql`id COLLATE "C">${after} COLLATE "C"`} ORDER BY id COLLATE "C" LIMIT 200`);
    if (!rows.length) return history;
    for (const row of rows) {
      if (after !== null && Buffer.compare(Buffer.from(row.id), Buffer.from(after)) <= 0) throw precondition('运行原回调完整分页不符');
      history.push(runtimeCallbackFromRow(row)); after = row.id;
    }
  }
}
