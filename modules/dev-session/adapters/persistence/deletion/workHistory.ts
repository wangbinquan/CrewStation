import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { DevelopmentWorkCallbackSchema, DevelopmentWorkPodSchema } from '../../../domain/deletion/work';
import type { DevelopmentWorkCallback, DevelopmentWorkPod } from '../../../domain/deletion/work';

interface Row extends Record<string, unknown> {
  id: string; project_id: string; origin_kind: string; origin_key: string; origin_id: string; kind: string;
  reference: string; consumer_id: string; input_digest: string; origin_revision: string; backend_pid: number;
  original_process: unknown; exit_key_hash: string; exited_at: unknown; exit_digest: string | null; recovery_digest: string | null;
  deletion_grant: unknown;
}
/** Read terminal and pending original callbacks to EOF; no scheduler window is a deletion boundary. */
export async function developmentWorkHistory(db: Executor, project: ProjectId, stoppedPod?: DevelopmentWorkPod): Promise<DevelopmentWorkCallback[]> {
  const original = stoppedPod ? DevelopmentWorkPodSchema.parse(stoppedPod) : undefined;
  const history: DevelopmentWorkCallback[] = []; let after: string | null = null;
  for (;;) {
    const rows: Row[] = await db.execute<Row>(sql`SELECT * FROM dev_session.original_callbacks WHERE project_id=${project}
      AND ${original ? sql`exited_at IS NULL AND original_process->>'podUid'=${original.podUid}
        AND original_process->>'nodeUid'=${original.nodeUid} AND original_process->>'nodeName'=${original.nodeName}` : sql`true`}
      AND ${after === null ? sql`true` : sql`id COLLATE "C">${after} COLLATE "C"`} ORDER BY id COLLATE "C" LIMIT 200`);
    if (!rows.length) return history;
    for (const row of rows) {
      history.push(DevelopmentWorkCallbackSchema.parse({ id: row.id, projectId: row.project_id, originKind: row.origin_kind,
        originKey: row.origin_key, originId: row.origin_id, kind: row.kind, reference: row.reference, consumerId: row.consumer_id,
        inputDigest: row.input_digest, originRevision: row.origin_revision, backendPid: row.backend_pid, process: row.original_process,
        exitKeyDigest: row.exit_key_hash, grant: row.deletion_grant ?? null, exited: row.exited_at !== null, exitDigest: row.exit_digest, recoveryDigest: row.recovery_digest }));
      after = row.id;
    }
  }
}
