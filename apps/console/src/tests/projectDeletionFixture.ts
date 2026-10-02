import { ProjectDeletionOperationSchema, ProjectDeletionPlanSchema, PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';

export const deletionProjectId = '01a0f30b-c652-7000-8d6f-553e3b5f6135';
export function deletionPlan(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return ProjectDeletionPlanSchema.parse({ id: '01a0f30b-c652-7000-8d6f-553e3b5f6136',
    target: { id: deletionProjectId, slug: 'original-project', name: '原项目', namespace: 'cs-original-project', kind: 'DigitalWorker', state: 'active', revision: '4',
      prodHost: 'original-project.apps.test', previewHost: 'preview.original-project.apps.test', serviceHost: 'original-project.services.test' },
    digest: 'a'.repeat(64), expiresAt, complete: true, blockers: [],
    participants: PROJECT_DELETION_PARTICIPANTS.map((participant) => ({ participant, revision: 'b'.repeat(64), complete: true, resources: [], references: [], blockers: [] })),
  });
}
export function deletionOperation(state: 'running' | 'needs-attention' | 'succeeded' = 'running') {
  const plan = deletionPlan();
  return ProjectDeletionOperationSchema.parse({ id: '01a0f30b-c652-7000-8d6f-553e3b5f6137', project: { id: deletionProjectId, name: plan.target.name, slug: plan.target.slug },
    state, phase: state === 'succeeded' ? 'verify' : 'stop', confirmationDigest: plan.digest, receipts: [], blockers: [], canRetry: state === 'needs-attention',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
}
