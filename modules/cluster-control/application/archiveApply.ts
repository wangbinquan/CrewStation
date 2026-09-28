import { precondition } from '@crewstation/kernel';
import type { ArchiveOwners, LedgerRecordView } from '../ports/ledger';
import type { WorkloadApplyDeps } from './workloadApply';
import { workloadRenderOf } from '../domain/workloadRender';
import { prepareWorkloadAdmission, reconcileWorkloadAdmission } from './workloadAdmission';

/** The parent may already be paused or gone. Only the original volume and finalization admission grant matter. */
export async function applyArchive(deps: WorkloadApplyDeps & { archives?: ArchiveOwners }, record: LedgerRecordView, enqueue: (id: string, delay?: number) => void): Promise<void> {
  const provisioning = record.conditions.some((c) => c.type === 'Provisioning' && c.status === 'true');
  // A replay can find an already scheduled Pod whose credential binding has not committed yet.
  if (!provisioning) await reconcileWorkloadAdmission(deps, record, enqueue);
  if (record.desired !== 'present' || !deps.archives || !provisioning) return;
  try {
  const render = workloadRenderOf(record.id, record.spec);
  if (!render?.pod.archive || render.preview) throw precondition('归档助手期望无效');
  const volume = deps.feed.cached('PersistentVolumeClaim', render.pod.namespace, render.pod.pvc!);
  if (!volume || volume.metadata.deletionTimestamp || volume.metadata.uid !== render.pod.expectedVolumeUid) throw precondition('归档原工作卷缺失或已替换', { code: 'workspace_volume_changed' });
  const pod = await prepareWorkloadAdmission(deps, render.pod, volume);
  if ((await deps.ledger.get(record.id))?.desired !== 'present') return;
  const secret = await deps.cluster.ensureRunnerSecret(pod, () => deps.archives!.values(record.id), deps.signal);
  if ((await deps.ledger.get(record.id))?.desired !== 'present') return;
  deps.signal?.throwIfAborted();
  const created = await deps.cluster.ensurePod(pod, deps.signal);
  await deps.archives.bind(record.id, created.uid, secret.uid);
  await reconcileWorkloadAdmission(deps, record, enqueue);
  await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'true' }]);
  } catch (error) {
    await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'false', reason: 'archive-create-failed', message: '归档助手尚未建成，正在重试；原任务卷保留' }]).catch(() => undefined);
    throw error;
  }
}
