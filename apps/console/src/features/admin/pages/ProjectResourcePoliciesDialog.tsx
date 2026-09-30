import { useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { Stack } from '../../../shared/ui/Stack';
import { useT } from '../../../shared/lib/useT';
import { ProjectComputeCard } from '../components/projects/ProjectComputeCard';
import { ProjectServiceCard } from '../components/projects/ProjectServiceCard';
import { ProjectRuntimeImageCard } from '../components/projects/ProjectRuntimeImageCard';

/** Range mode and inheritance use the existing CAS editors inside the same resource page. */
export function ProjectResourcePoliciesDialog({ projectId, viewerId, onClose, open }: { projectId: string; viewerId: string; onClose: () => void; open: boolean }) {
  const t = useT(), client = useQueryClient();
  return <Dialog open={open} title={t('resourceCenter.managePolicies')} size="large" onClose={() => { void client.invalidateQueries({ queryKey: ['resource-center', projectId] }); onClose(); }}><Stack><ProjectServiceCard projectId={projectId} viewerId={viewerId} /><ProjectComputeCard projectId={projectId} viewerId={viewerId} /><ProjectRuntimeImageCard projectId={projectId} viewerId={viewerId} /></Stack></Dialog>;
}
