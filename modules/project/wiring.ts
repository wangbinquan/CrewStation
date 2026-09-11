import type { ProjectModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type ProjectModuleDeps = Record<string, never>;

export interface ProjectModule {
  readonly api: ProjectModuleApi;
}

export function createProjectModule(_deps: ProjectModuleDeps): ProjectModule {
  return { api: { name: 'project' } };
}
