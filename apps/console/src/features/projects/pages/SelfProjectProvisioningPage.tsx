import { useParams } from '@tanstack/react-router';
import { ProjectProvisioningPage } from './ProjectProvisioningPage';

export function SelfProjectProvisioningPage() {
  const { projectId = '' } = useParams({ strict: false });
  return <ProjectProvisioningPage key={projectId} projectId={projectId} />;
}
