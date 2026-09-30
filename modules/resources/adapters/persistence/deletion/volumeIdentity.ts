import type { ProjectId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

/** 用原 PV 或 PVC UID 证明归属；名字、标签或所在 namespace 本身不能认领卷。 */
export async function ownsDeletionVolume(db: Executor, projectId: ProjectId, volume: { name: string; uid: string; claim?: { namespace: string; uid: string } }): Promise<boolean> {
  if (!volume.name || !volume.uid) return false;
  const rows = await db.execute<{ owned: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM resources.task_volume_safety WHERE resource_id IN (SELECT id FROM resources.records WHERE project_id = ${projectId}) AND body->'target'->>'pvUid' = ${volume.uid} AND body->'target'->>'pvName' = ${volume.name})
    OR EXISTS (SELECT 1 FROM resources.deletion_volume_receipts WHERE project_id = ${projectId} AND pv_uid = ${volume.uid} AND original_target->>'pvName' = ${volume.name})
    OR EXISTS (SELECT 1 FROM resources.children WHERE resource_id IN (SELECT id FROM resources.records WHERE project_id = ${projectId}) AND resource_id NOT IN (SELECT resource_id FROM resources.task_volume_safety WHERE body->'target'->>'pvUid' IS NOT NULL) AND kind = 'PersistentVolumeClaim' AND uid = ${volume.claim?.uid ?? ''} AND namespace = ${volume.claim?.namespace ?? ''}
      AND NOT EXISTS (SELECT 1 FROM resources.deletion_volume_receipts WHERE project_id = ${projectId} AND pvc_uid = ${volume.claim?.uid ?? ''})) AS owned`);
  return rows[0]?.owned === true;
}
