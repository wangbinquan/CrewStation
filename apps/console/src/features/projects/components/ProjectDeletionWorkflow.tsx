import type { ProjectDeletionsResource } from '@crewstation/api-client';
import type { RefObject } from 'react';
import { useProjectDeletion } from '../hooks/useProjectDeletion';
import { ProjectDeletionDialog } from './ProjectDeletionDialog';

/** The administrator caller stays mounted; the product entry is gated by complete backend cleanup owners. */
export function ProjectDeletionWorkflow({ project, userId, open, resource, returnFocusTo, onClose }: {
  readonly project: { id: string; name: string; slug: string }; readonly userId: string; readonly open: boolean;
  readonly resource?: ProjectDeletionsResource; readonly onClose: () => void;
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const flow = useProjectDeletion(project.id, userId, open, resource);
  return open ? <ProjectDeletionDialog project={project} plan={flow.plan} operation={flow.operation} loading={flow.loading} pending={flow.pending} error={flow.error} returnFocusTo={returnFocusTo}
    onReview={() => { void flow.session.review(); }}
    onConfirm={(plan) => flow.session.confirm(plan)} onRetry={() => { void flow.session.retry(); }}
    onRecover={flow.canRecover ? () => { void flow.session.recover(); } : undefined} onClose={onClose} /> : null;
}
