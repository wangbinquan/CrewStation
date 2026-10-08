import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { BusinessWorkCallbackSchema, BusinessWorkPodSchema } from '../../../domain/deletion/work';
import type { BusinessWorkCallback, BusinessWorkPod } from '../../../domain/deletion/work';

interface Row extends Record<string, unknown> {
  id: string; project_id: string; service_id: string; kind: string; reference: string; consumer_id: string; input_digest: string; origin_revision: string;
  backend_pid: number; original_process: unknown; exit_key_hash: string; exited_at: unknown; exit_digest: string | null; recovery_digest: string | null;
}
/** Full original history, including terminal callbacks; leases and backend disappearance are never exit evidence. */
export async function businessWorkHistory(db: Executor, projectId: ProjectId, stoppedPod?: BusinessWorkPod): Promise<BusinessWorkCallback[]> {
  const original = stoppedPod ? BusinessWorkPodSchema.parse(stoppedPod) : undefined;
  const callbacks: BusinessWorkCallback[] = []; let after: string | null = null;
  for (;;) {
    const rows: Row[] = await db.execute<Row>(sql`SELECT * FROM business_task.original_callbacks WHERE project_id=${projectId}
      AND ${original ? sql`exited_at IS NULL AND original_process->>'podUid'=${original.podUid}
        AND original_process->>'nodeUid'=${original.nodeUid} AND original_process->>'nodeName'=${original.nodeName}` : sql`true`}
      AND ${after === null ? sql`true` : sql`id COLLATE "C">${after} COLLATE "C"`} ORDER BY id COLLATE "C" LIMIT 200`);
    if (!rows.length) return callbacks;
    for (const row of rows) {
      callbacks.push(BusinessWorkCallbackSchema.parse({ id: row.id, projectId: row.project_id, serviceId: row.service_id, kind: row.kind,
        reference: row.reference, consumerId: row.consumer_id, inputDigest: row.input_digest, originRevision: row.origin_revision,
        backendPid: row.backend_pid, process: row.original_process, exitKeyDigest: row.exit_key_hash,
        exited: row.exited_at !== null, exitDigest: row.exit_digest, recoveryDigest: row.recovery_digest }));
      after = row.id;
    }
  }
}
