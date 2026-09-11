import type { ReleaseModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type ReleaseModuleDeps = Record<string, never>;

export interface ReleaseModule {
  readonly api: ReleaseModuleApi;
}

export function createReleaseModule(_deps: ReleaseModuleDeps): ReleaseModule {
  return { api: { name: 'release' } };
}
