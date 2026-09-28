import type { BusinessStorageFinalization } from '@crewstation/contracts';

export interface ArchiveExecution extends BusinessStorageFinalization {
  readonly purpose?: 'archive' | 'binding';
  readonly id: string;
  readonly volumeUid: string;
  readonly state: 'queued' | 'admitted' | 'stopping' | 'stopped';
  readonly namespace: string;
  readonly pvcName: string;
  readonly podName: string;
  readonly consumerId: string;
  readonly image: string;
  readonly workerUid: number;
  readonly projectSlug: string;
  readonly serviceSlug: string;
  readonly expiresAt: string | null;
  readonly podUid: string | null;
  readonly secretUid: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function archiveDeclaration(execution: ArchiveExecution) {
  const e = execution, at = (kind: string, name: string) => ({ kind, namespace: e.namespace, name });
  return { id: e.id, kind: 'archive-execution' as const, ref: e.id, projectId: e.projectId, parentId: e.taskId, purpose: 'archive-helper' as const,
    display: { taskId: e.taskId, finalizationId: e.operationId, finalizationRevision: String(e.revision) },
    conditions: [{ type: 'Provisioning', status: e.state === 'admitted' && !e.podUid ? 'true' as const : 'false' as const }],
    spec: { workloadConsumerId: e.consumerId, children: [at('Pod', e.podName), at('Secret', `${e.podName}-grant`), at('Secret', `${e.podName}-admission`)],
      pod: { archive: { ownerTaskId: e.taskId, ...(e.purpose === 'binding' ? { bindOnly: true } : {}) }, image: e.image, workerUid: e.workerUid, workload: 'archive-helper', project: e.projectSlug, service: e.serviceSlug,
        pvc: e.pvcName, expectedVolumeUid: e.volumeUid, secret: `${e.podName}-grant`, resources: { cpu: '100m', memory: '256Mi', storage: '32Mi' },
        consumer: { id: e.consumerId, taskId: e.taskId, purpose: 'archive', revision: e.revision, finalization: { operationId: e.operationId, revision: e.revision } } },
    } };
}
