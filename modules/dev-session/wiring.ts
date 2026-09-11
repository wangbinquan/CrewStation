import type { DevSessionModuleApi } from './api/moduleApi';

/** 装配期注入：其他模块的能力以端口形式出现在这里，由应用提供实现。 */
export type DevSessionModuleDeps = Record<string, never>;

export interface DevSessionModule {
  readonly api: DevSessionModuleApi;
}

export function createDevSessionModule(_deps: DevSessionModuleDeps): DevSessionModule {
  return { api: { name: 'dev-session' } };
}
