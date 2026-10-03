import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DevelopmentWorkCallbackSchema } from '../../../domain/deletion/work';
import type { DevelopmentWorkCallback } from '../../../domain/deletion/work';

interface Row extends Record<string, unknown> {
  id: string; project_id: string; origin_kind: string; origin_key: string; origin_id: string; kind: string;
  reference: string; consumer_id: string; input_digest: string; origin_revision: string; backend_pid: number;
  original_process: unknown; exit_key_hash: string; exited_at: unknown; exit_digest: string | null; recovery_digest: string | null;
}
/** Read terminal and pending original callbacks to EOF; no scheduler window is a deletion boundary. */
export async function developmentWorkHistory(db: Executor, project: ProjectId): Promise<DevelopmentWorkCallback[]> {
  const history: DevelopmentWorkCallback[] = []; let after: string | null = null;
  for (;;) {
    const rows: Row[] = await db.execute<Row>(sql`SELECT * FROM dev_session.original_callbacks WHERE project_id=${project}
      AND ${after === null ? sql`true` : sql`id COLLATE "C">${after} COLLATE "C"`} ORDER BY id COLLATE "C" LIMIT 200`);
    if (!rows.length) return history;
    for (const row of rows) {
      history.push(DevelopmentWorkCallbackSchema.parse({ id: row.id, projectId: row.project_id, originKind: row.origin_kind,
        originKey: row.origin_key, originId: row.origin_id, kind: row.kind, reference: row.reference, consumerId: row.consumer_id,
        inputDigest: row.input_digest, originRevision: row.origin_revision, backendPid: row.backend_pid, process: row.original_process,
        exitKeyDigest: row.exit_key_hash, exited: row.exited_at !== null, exitDigest: row.exit_digest, recoveryDigest: row.recovery_digest }));
      after = row.id;
    }
  }
}
