import { Outlet, useParams } from '@tanstack/react-router';
import { ProjectScopeProvider } from '../../shared/project/ProjectScope';

export function ProjectLayout() {
  const { projectId = '' } = useParams({ strict: false });
  return <ProjectScopeProvider value={{ projectId, space: 'workbench' }}><Outlet /></ProjectScopeProvider>;
}
