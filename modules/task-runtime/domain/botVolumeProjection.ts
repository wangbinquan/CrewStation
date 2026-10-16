import type { ProjectedRecord } from './environmentProjection';
import type { TaskEnvironment } from './taskEnvironment';

/** Private Bot data follows the parent workspace's retention policy, never an execution Pod. */
export function botVolumeProjection(env: TaskEnvironment, release?: ProjectedRecord['release']): ProjectedRecord | undefined {
  const volume = env.render?.botVolume;
  if (env.native || !volume) return undefined;
  const released = release && env.volumeMode === 'follow-container' && release.code !== 'retention-expired';
  return {
    kind: 'volume', ref: `${env.id}/bot-context`, projectId: env.projectId, parentId: env.id,
    children: [{ kind: 'PersistentVolumeClaim', namespace: env.namespace, name: volume.pvcName }],
    reclaim: env.volumeMode === 'follow-container' ? 'delete' : 'retain',
    display: { purpose: 'bot-context', capacity: volume.size, conversation: volume.conversationId, mode: env.volumeMode },
    conditions: [{ type: 'Provisioning', status: !volume.volumeUid && !release ? 'true' : 'false' }],
    render: { pvc: { size: volume.size, labels: { 'crewstation.io/task': env.id, 'crewstation.io/project': env.labels['crewstation.io/project'] ?? '', 'crewstation.io/storage': 'bot-context' } } },
    ...(released ? { release } : {}),
  };
}
