import type { ScmModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type ScmModuleDeps = Record<string, never>;

export interface ScmModule {
  readonly api: ScmModuleApi;
}

export function createScmModule(_deps: ScmModuleDeps): ScmModule {
  return { api: { name: 'scm' } };
}
