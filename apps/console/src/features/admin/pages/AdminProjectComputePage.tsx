import { Navigate, useParams } from '@tanstack/react-router';

export function AdminProjectComputeLegacyPage() {
  const { projectId } = useParams({ strict: false });
  return <Navigate to="/admin/projects/$projectId/resources" params={{ projectId: projectId! }} replace />;
}
