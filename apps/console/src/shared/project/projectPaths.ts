export const PROJECT_PATHS = {
  workbench: {
    overview: '/projects/$projectId', development: '/projects/$projectId/dev-session',
    conversations: '/projects/$projectId/dev-session/conversations', release: '/projects/$projectId/release',
    observability: '/projects/$projectId/observability', resources: '/projects/$projectId/resources', resourceCenter: '/projects/$projectId/resource-center', operations: '/projects/$projectId/operations', settings: '/projects/$projectId/settings',
  },
  admin: {
    overview: '/admin/integrations/$projectId', development: '/admin/integrations/$projectId/dev-session',
    conversations: '/admin/integrations/$projectId/dev-session/conversations', release: '/admin/integrations/$projectId/release',
    observability: '/admin/integrations/$projectId/observability', resources: '/admin/integrations/$projectId/resources', resourceCenter: '/admin/integrations/$projectId/resource-center', operations: '/admin/integrations/$projectId/operations', settings: '/admin/integrations/$projectId/settings',
  },
} as const;
export type ProjectPage = keyof typeof PROJECT_PATHS.workbench;
export type ProjectSpace = keyof typeof PROJECT_PATHS;

export const RELEASE_PATHS = {
  workbench: { publish: '/projects/$projectId/release/publish', journey: '/projects/$projectId/release/journeys/$journeyId', version: '/projects/$projectId/release/versions/$releaseId' },
  admin: { publish: '/admin/integrations/$projectId/release/publish', journey: '/admin/integrations/$projectId/release/journeys/$journeyId', version: '/admin/integrations/$projectId/release/versions/$releaseId' },
} as const;

/** 只在已知业务页间接续；未知路径保持路由自身的 404。 */
export function projectPageFromPath(pathname: string, projectId: string, space: ProjectSpace): ProjectPage | undefined {
  if (pathname.startsWith(PROJECT_PATHS[space].release.replace('$projectId', encodeURIComponent(projectId)) + '/')) return 'release';
  return (Object.keys(PROJECT_PATHS[space]) as ProjectPage[]).find((page) => PROJECT_PATHS[space][page].replace('$projectId', encodeURIComponent(projectId)) === pathname.replace(/\/$/, ''));
}
