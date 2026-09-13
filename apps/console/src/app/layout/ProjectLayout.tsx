import { Outlet, useParams } from '@tanstack/react-router';
import { ProjectScopeProvider } from '../../shared/project/ProjectScope';
import { ProjectSpaceBoundary } from '../project/ProjectSpaceBoundary';
import type { ProjectSpace } from '../../shared/project/projectPaths';

export function ProjectLayout({ space = 'workbench' }: { readonly space?: ProjectSpace }) {
  const { projectId = '' } = useParams({ strict: false });
  return <ProjectScopeProvider value={{ projectId, space }}><ProjectSpaceBoundary><Outlet /></ProjectSpaceBoundary></ProjectScopeProvider>;
}

export function AdminProjectLayout() { return <ProjectLayout space="admin" />; }
