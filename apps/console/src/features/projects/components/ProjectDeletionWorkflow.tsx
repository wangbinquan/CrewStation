import type { ProjectDeletionsResource } from '@crewstation/api-client';
import { useState, type RefObject } from 'react';
import { useProjectDeletion } from '../hooks/useProjectDeletion';
import { ProjectDeletionDialog } from './ProjectDeletionDialog';
import { ProjectDeletionRepairForm } from './ProjectDeletionRepairForm';
import type { ProjectRepairDraft } from './ProjectDeletionRepairForm';
import { api } from '../../../shared/api/client';

/** The administrator caller stays mounted; the product entry is gated by complete backend cleanup owners. */
export function ProjectDeletionWorkflow({ project, userId, open, resource, returnFocusTo, onClose }: {
  readonly project: { id: string; name: string; slug: string }; readonly userId: string; readonly open: boolean;
  readonly resource?: ProjectDeletionsResource; readonly onClose: () => void;
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const flow = useProjectDeletion(project.id, userId, open, resource);
  const [repairOpen, setRepairOpen] = useState(false), [repairDraft, setRepairDraft] = useState<ProjectRepairDraft>({}), repairResource = resource ?? api.projectDeletions;
  return <>{open ? <ProjectDeletionDialog project={project} plan={flow.plan} operation={flow.operation} loading={flow.loading} pending={flow.pending} error={flow.error} returnFocusTo={returnFocusTo}
    onReview={() => { void flow.session.review(); }}
    onConfirm={(plan) => flow.session.confirm(plan)} onRetry={() => { void flow.session.retry(); }}
    onRecover={flow.canRecover ? () => { void flow.session.recover(); } : undefined} onRepair={repairResource.repairItems ? () => setRepairOpen(true) : undefined} onClose={onClose} /> : null}
    <ProjectDeletionRepairForm projectId={project.id} open={open && repairOpen} resource={repairResource} draft={repairDraft} onDraft={setRepairDraft}
      onClose={() => setRepairOpen(false)} onSaved={() => { void flow.session.review(); }} /></>;
}
