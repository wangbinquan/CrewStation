export const PROJECT_PATHS = {
  workbench: {
    overview: '/projects/$projectId', development: '/projects/$projectId/dev-session',
    conversations: '/projects/$projectId/dev-session/conversations', release: '/projects/$projectId/release',
    resources: '/projects/$projectId/resources', operations: '/projects/$projectId/operations', settings: '/projects/$projectId/settings',
  },
  admin: {
    overview: '/admin/integrations/$projectId', development: '/admin/integrations/$projectId/dev-session',
    conversations: '/admin/integrations/$projectId/dev-session/conversations', release: '/admin/integrations/$projectId/release',
    resources: '/admin/integrations/$projectId/resources', operations: '/admin/integrations/$projectId/operations', settings: '/admin/integrations/$projectId/settings',
  },
} as const;
export type ProjectPage = keyof typeof PROJECT_PATHS.workbench;
export type ProjectSpace = keyof typeof PROJECT_PATHS;

/** 只在已知业务页间接续；未知路径保持路由自身的 404。 */
export function projectPageFromPath(pathname: string, projectId: string, space: ProjectSpace): ProjectPage | undefined {
  return (Object.keys(PROJECT_PATHS[space]) as ProjectPage[]).find((page) => PROJECT_PATHS[space][page].replace('$projectId', encodeURIComponent(projectId)) === pathname.replace(/\/$/, ''));
}
